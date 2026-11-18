import type { CustomerImportRowInput } from './edgeFunctions'

export interface ParsedInventoryCsvRow {
  name: string
  sku: string
  barcode: string | null
  category: string | null
  description: string | null
  supplier: string | null
  location: string | null
  purchase_cost: number
  selling_price: number
  quantity: number
  reorder_threshold: number
  reorder_quantity: number
}

/**
 * RFC-4180 compliant CSV parser supporting UTF-8 BOM stripping, quoted fields,
 * escaped double quotes (`""`), embedded newlines, and fail-closed unclosed-quote detection.
 */
export function parseCsvMatrix(rawInput: string): string[][] {
  const text = String(rawInput ?? '').replace(/^\uFEFF/, '')
  if (!text.trim()) {
    return []
  }

  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let fieldStartedQuoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        currentField += ch
      }
      continue
    }

    if (ch === '"' && currentField.length === 0 && !fieldStartedQuoted) {
      inQuotes = true
      fieldStartedQuoted = true
      continue
    }

    if (ch === ',') {
      currentRow.push(fieldStartedQuoted ? currentField : currentField.trim())
      currentField = ''
      fieldStartedQuoted = false
      continue
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1
      }
      currentRow.push(fieldStartedQuoted ? currentField : currentField.trim())
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow)
      }
      currentRow = []
      currentField = ''
      fieldStartedQuoted = false
      continue
    }

    currentField += ch
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unclosed double-quoted field detected.')
  }

  if (currentField.length > 0 || currentRow.length > 0 || fieldStartedQuoted) {
    currentRow.push(fieldStartedQuoted ? currentField : currentField.trim())
    if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow)
    }
  }

  return rows
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function parseCsvObjects(rawInput: string): Array<Record<string, string>> {
  const matrix = parseCsvMatrix(rawInput)
  if (matrix.length < 2) {
    return []
  }

  const headers = matrix[0].map(normalizeHeader)
  const records: Array<Record<string, string>> = []

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex++) {
    const cells = matrix[rowIndex]
    const obj: Record<string, string> = {}
    let hasNonEmpty = false

    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const key = headers[colIndex]
      if (!key) continue
      const val = (cells[colIndex] ?? '').trim()
      if (val.length > 0) hasNonEmpty = true
      obj[key] = val
    }

    if (hasNonEmpty) {
      records.push(obj)
    }
  }

  return records
}

function pickFirst(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const val = row[key]
    if (val && val.trim().length > 0) {
      return val.trim()
    }
  }
  return ''
}

function parseNonNegativeNumber(raw: string, fallback = 0): number {
  if (!raw) return fallback
  const cleaned = raw.replace(/[$,\s]/g, '')
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round(parsed * 100) / 100
}

export function parseCustomerCsv(rawInput: string): CustomerImportRowInput[] {
  const objects = parseCsvObjects(rawInput)
  const parsedRows: CustomerImportRowInput[] = []

  for (const row of objects) {
    let firstName = pickFirst(row, ['first_name', 'firstname', 'first', 'given_name'])
    let lastName = pickFirst(row, ['last_name', 'lastname', 'last', 'surname', 'family_name'])
    const fullName = pickFirst(row, ['name', 'full_name', 'customer', 'customer_name', 'client'])

    if (!firstName && fullName) {
      const parts = fullName.split(/\s+/)
      firstName = parts[0] ?? ''
      if (!lastName && parts.length > 1) {
        lastName = parts.slice(1).join(' ')
      }
    }

    const email = pickFirst(row, ['email', 'email_address', 'e_mail']).toLowerCase()
    const phone = pickFirst(row, ['phone', 'phone_number', 'mobile', 'cell', 'telephone'])

    if (!firstName && !lastName && !email && !phone) {
      continue
    }

    parsedRows.push({
      first_name: firstName || 'Customer',
      last_name: lastName,
      email,
      phone,
    })
  }

  return parsedRows
}

export function parseInventoryCsv(rawInput: string): ParsedInventoryCsvRow[] {
  const objects = parseCsvObjects(rawInput)
  const items: ParsedInventoryCsvRow[] = []

  for (const row of objects) {
    const sku = pickFirst(row, ['sku', 'part_number', 'item_code', 'code']).toUpperCase()
    const name = pickFirst(row, ['name', 'item_name', 'title', 'part_name', 'product'])
    if (!sku || !name) {
      continue
    }

    const barcode = pickFirst(row, ['barcode', 'upc', 'ean']) || null
    const category = pickFirst(row, ['category', 'group', 'department']) || null
    const description = pickFirst(row, ['description', 'details', 'notes']) || null
    const supplier = pickFirst(row, ['supplier', 'vendor', 'manufacturer']) || null
    const location = pickFirst(row, ['location', 'bin', 'aisle', 'warehouse']) || null

    const purchaseCost = parseNonNegativeNumber(
      pickFirst(row, ['purchase_cost', 'unit_cost', 'cost', 'wholesale']),
      0,
    )
    const sellingPrice = parseNonNegativeNumber(
      pickFirst(row, ['selling_price', 'unit_price', 'price', 'retail']),
      purchaseCost,
    )
    const quantity = Math.trunc(
      parseNonNegativeNumber(pickFirst(row, ['quantity', 'qty', 'on_hand', 'stock']), 0),
    )
    const reorderThreshold = Math.trunc(
      parseNonNegativeNumber(
        pickFirst(row, ['reorder_threshold', 'min_qty', 'reorder_point', 'threshold']),
        0,
      ),
    )
    const reorderQuantity = Math.trunc(
      parseNonNegativeNumber(pickFirst(row, ['reorder_quantity', 'reorder_qty', 'order_qty']), 0),
    )

    items.push({
      name,
      sku,
      barcode,
      category,
      description,
      supplier,
      location,
      purchase_cost: purchaseCost,
      selling_price: sellingPrice,
      quantity,
      reorder_threshold: reorderThreshold,
      reorder_quantity: reorderQuantity,
    })
  }

  return items
}

/**
 * Computes a deterministic SHA-256 hex digest via Web Crypto for resumable
 * customer bulk imports and idempotent inventory CSV batch keys.
 */
export async function sha256Hex(rawInput: string): Promise<string> {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto SHA-256 is required for CSV fingerprinting.')
  }
  const bytes = new TextEncoder().encode(String(rawInput ?? ''))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export function inventoryCsvSaveKey(fileSha256: string, rowIndex: number, sku: string): string {
  return `csv-sku-save:${fileSha256.slice(0, 32)}:${rowIndex}:${sku.slice(0, 32)}`
}

export function inventoryCsvReceiptKey(fileSha256: string, rowIndex: number, sku: string): string {
  return `csv-sku-rcpt:${fileSha256.slice(0, 32)}:${rowIndex}:${sku.slice(0, 32)}`
}
