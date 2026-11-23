export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024 // 5 MB strict document ingestion cap

export const SUPPORTED_BILL_EXTENSIONS = ['.pdf', '.txt', '.csv', '.json'] as const

export type ExtractionMethod =
  | 'plain_text'
  | 'pdf_stream_extracted'
  | 'pdf_scanned_needs_ocr'
  | 'unsupported'

export interface DocumentExtractionResult {
  file_name: string
  byte_length: number
  content_hash: string
  extraction_method: ExtractionMethod
  extracted_text: string
  extraction_confidence_bps: number
  warning: string | null
}

function unescapePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_m, oct: string) =>
      String.fromCharCode(parseInt(oct, 8) & 0xff),
    )
}

function decodeHexPdfString(hexRaw: string): string {
  const clean = hexRaw.replace(/[^0-9A-Fa-f]/g, '')
  if (clean.length < 2) return ''
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean
  // UTF-16BE BOM check (FEFF)
  if (padded.toUpperCase().startsWith('FEFF') && padded.length >= 8) {
    const chars: string[] = []
    for (let i = 4; i + 3 < padded.length; i += 4) {
      const code = parseInt(padded.slice(i, i + 4), 16)
      if (code >= 0x20 || code === 0x0a || code === 0x0d) {
        chars.push(String.fromCharCode(code))
      }
    }
    return chars.join('')
  }
  const bytes: number[] = []
  for (let i = 0; i + 1 < padded.length; i += 2) {
    const b = parseInt(padded.slice(i, i + 2), 16)
    if (b >= 0x20 && b <= 0x7e) bytes.push(b)
    else if (b === 0x0a || b === 0x0d || b === 0x09) bytes.push(b)
  }
  return String.fromCharCode(...bytes)
}

function extractTextOperators(pdfStreamText: string): string {
  const chunks: string[] = []
  const btBlocks = pdfStreamText.match(/BT[\s\S]*?ET/g) ?? [pdfStreamText]

  for (const block of btBlocks) {
    // Match TJ arrays: [(Hello) -20 (World)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g
    let arrMatch: RegExpExecArray | null = tjArrayRegex.exec(block)
    while (arrMatch !== null) {
      const inner = arrMatch[1]
      const itemRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f\s]+)>/g
      let itemMatch: RegExpExecArray | null = itemRegex.exec(inner)
      const joined: string[] = []
      while (itemMatch !== null) {
        if (itemMatch[1] !== undefined) joined.push(unescapePdfLiteral(itemMatch[1]))
        else if (itemMatch[2] !== undefined) joined.push(decodeHexPdfString(itemMatch[2]))
        itemMatch = itemRegex.exec(inner)
      }
      if (joined.length > 0) chunks.push(joined.join(''))
      arrMatch = tjArrayRegex.exec(block)
    }

    // Match Tj / ' / " literal strings
    const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|'|")/g
    let litMatch: RegExpExecArray | null = tjRegex.exec(block)
    while (litMatch !== null) {
      chunks.push(unescapePdfLiteral(litMatch[1]))
      litMatch = tjRegex.exec(block)
    }

    // Match hex Tj strings
    const hexRegex = /<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")/g
    let hexMatch: RegExpExecArray | null = hexRegex.exec(block)
    while (hexMatch !== null) {
      const dec = decodeHexPdfString(hexMatch[1])
      if (dec.trim()) chunks.push(dec)
      hexMatch = hexRegex.exec(block)
    }
  }

  return chunks
    .join('\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function tryInflateStream(rawBytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null
  const tryFormat = async (fmt: 'deflate' | 'deflate-raw'): Promise<string | null> => {
    try {
      const copy = new Uint8Array(rawBytes.byteLength)
      copy.set(rawBytes)
      const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream(fmt))
      const ab = await new Response(stream).arrayBuffer()
      return new TextDecoder('latin1').decode(new Uint8Array(ab))
    } catch {
      return null
    }
  }
  return (await tryFormat('deflate')) ?? (await tryFormat('deflate-raw'))
}

function findSequence(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * Pure deterministic binary PDF text extractor supporting uncompressed text streams,
 * compressed FlateDecode content streams (via Web Streams DecompressionStream),
 * literal/hex Tj & TJ operators, and honest detection of image-only scanned PDFs.
 * Never decodes raw compressed PDF bytes blindly with `file.text()`.
 */
export async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<{
  extraction_method: ExtractionMethod
  extracted_text: string
  warning: string | null
}> {
  if (bytes.byteLength === 0) {
    return {
      extraction_method: 'unsupported',
      extracted_text: '',
      warning: 'Uploaded file is empty (0 bytes).',
    }
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `PDF exceeds maximum allowed size of ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`,
    )
  }

  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 8))
  if (!header.startsWith('%PDF-')) {
    return {
      extraction_method: 'unsupported',
      extracted_text: '',
      warning: 'File does not carry a valid %PDF- binary header.',
    }
  }

  const latin1 = new TextDecoder('latin1').decode(bytes)
  const collectedSegments: string[] = []

  // Extract uncompressed PDF operators if any exist in content objects
  const directText = extractTextOperators(latin1)
  if (directText.length > 0 && /[A-Za-z0-9]{2,}/.test(directText)) {
    collectedSegments.push(directText)
  }

  // Locate binary `stream ... endstream` payloads for FlateDecode decompression
  const streamToken = new TextEncoder().encode('stream')
  const endStreamToken = new TextEncoder().encode('endstream')
  let cursor = 0
  let streamCount = 0

  while (cursor < bytes.length && streamCount < 64) {
    const startIdx = findSequence(bytes, streamToken, cursor)
    if (startIdx === -1) break
    let dataStart = startIdx + streamToken.length
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2
    else if (bytes[dataStart] === 0x0a || bytes[dataStart] === 0x0d) dataStart += 1

    const endIdx = findSequence(bytes, endStreamToken, dataStart)
    if (endIdx === -1) break
    streamCount += 1

    let dataEnd = endIdx
    while (dataEnd > dataStart && (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d)) {
      dataEnd -= 1
    }

    const slice = bytes.subarray(dataStart, dataEnd)
    const inflated = await tryInflateStream(slice)
    if (inflated) {
      const opText = extractTextOperators(inflated)
      if (opText.length > 0) {
        collectedSegments.push(opText)
      }
    }
    cursor = endIdx + endStreamToken.length
  }

  const merged = collectedSegments.join('\n').trim()
  if (!merged) {
    return {
      extraction_method: 'pdf_scanned_needs_ocr',
      extracted_text: '',
      warning:
        'Scanned / image-only or encrypted PDF detected (no extractable embedded text streams). Run local Ollama OCR (`npm run audit:receipt-local`) or paste structured invoice lines before posting.',
    }
  }

  return {
    extraction_method: 'pdf_stream_extracted',
    extracted_text: merged,
    warning: null,
  }
}

export async function computeDocumentSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const digest = await crypto.subtle.digest('SHA-256', copy)
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Deterministic 64-hex FNV fallback for restricted runtimes lacking SubtleCrypto
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < bytes.length; i += 1) {
    h1 ^= bytes[i]
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= bytes[i] + i
    h2 = Math.imul(h2, 0x85ebca6b)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`.padEnd(64, '0')
}

export function validateDocumentFileMeta(fileName: string, byteLength: number): string | null {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    return 'File is empty (0 bytes).'
  }
  if (byteLength > MAX_DOCUMENT_BYTES) {
    return `File "${fileName}" (${(byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds the 5 MB ingestion limit.`
  }
  const lower = fileName.trim().toLowerCase()
  const okExt = SUPPORTED_BILL_EXTENSIONS.some(ext => lower.endsWith(ext))
  if (!okExt) {
    return `Unsupported file extension for "${fileName}". Allowed formats: ${SUPPORTED_BILL_EXTENSIONS.join(', ')}.`
  }
  return null
}

/**
 * Validates extension, size cap (<= 5 MB), computes SHA-256 content hash, and performs
 * genuine PDF stream extraction or UTF-8 validation (never calling `.text()` on raw binary PDFs).
 */
export async function validateAndExtractBillDocument(params: {
  fileName: string
  bytes: Uint8Array
}): Promise<DocumentExtractionResult> {
  const err = validateDocumentFileMeta(params.fileName, params.bytes.byteLength)
  if (err) {
    throw new Error(err)
  }

  const contentHash = await computeDocumentSha256Hex(params.bytes)
  const lower = params.fileName.trim().toLowerCase()
  const isPdfHeader =
    params.bytes.byteLength >= 5 &&
    new TextDecoder('ascii').decode(params.bytes.subarray(0, 5)) === '%PDF-'

  if (lower.endsWith('.pdf') || isPdfHeader) {
    const pdfRes = await extractTextFromPdfBytes(params.bytes)
    if (pdfRes.extraction_method !== 'pdf_stream_extracted' || !pdfRes.extracted_text) {
      return {
        file_name: params.fileName,
        byte_length: params.bytes.byteLength,
        content_hash: contentHash,
        extraction_method: pdfRes.extraction_method,
        extracted_text: '',
        extraction_confidence_bps: 0,
        warning: pdfRes.warning,
      }
    }
    return {
      file_name: params.fileName,
      byte_length: params.bytes.byteLength,
      content_hash: contentHash,
      extraction_method: 'pdf_stream_extracted',
      extracted_text: pdfRes.extracted_text,
      extraction_confidence_bps: 8500,
      warning: null,
    }
  }

  const plainText = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes).trim()
  if (!plainText || /\uFFFD{3,}/.test(plainText)) {
    return {
      file_name: params.fileName,
      byte_length: params.bytes.byteLength,
      content_hash: contentHash,
      extraction_method: 'unsupported',
      extracted_text: '',
      extraction_confidence_bps: 0,
      warning: 'File appears binary or corrupted UTF-8; could not extract structured text.',
    }
  }

  return {
    file_name: params.fileName,
    byte_length: params.bytes.byteLength,
    content_hash: contentHash,
    extraction_method: 'plain_text',
    extracted_text: plainText,
    extraction_confidence_bps: 9200,
    warning: null,
  }
}

export function buildTextContentHashSync(rawText: string): string {
  const bytes = new TextEncoder().encode(rawText.trim())
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  let h3 = 0xc2b2ae35
  let h4 = 0x27d4eb2f
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]
    h1 = Math.imul(h1 ^ b, 0x01000193)
    h2 = Math.imul(h2 ^ (b + (i & 255)), 0x85ebca6b)
    h3 = Math.imul(h3 ^ (b << 1), 0xc2b2ae35)
    h4 = Math.imul(h4 ^ (i ^ b), 0x27d4eb2f)
  }
  return [h1, h2, h3, h4]
    .map(n => (n >>> 0).toString(16).padStart(8, '0'))
    .join('')
}
