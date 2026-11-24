// Pure CSV Import/Export & Cycle-Count Sheet Parser (Zero external deps)

import type {
  AuditReasonCode,
  CsvParseResult,
  ParsedCycleCountCsvRow,
  ParsedInventoryCsvRow,
  ReconciliationReport,
} from './types'

const VALID_REASON_CODES: ReadonlySet<AuditReasonCode> = new Set([
  'matched',
  'shrinkage',
  'damage',
  'receiving_error',
  'misplaced',
  'vendor_shortage',
  'unexplained',
])

function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function parseDollarsToCents(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!cleaned) return 0
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed * 100)
}

function parseIntSafe(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback
  const cleaned = raw.replace(/[,\s]/g, '')
  if (!cleaned) return fallback
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return fallback
  return Math.trunc(parsed)
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Parses a SKU catalog CSV file with flexible header names:
 * sku, name, barcode, category, on_hand_qty, reorder_point_qty, reorder_qty, unit_cost_dollars (or unit_cost_cents), unit_price_dollars, preferred_vendor
 */
export function parseInventoryCatalogCsv(csvText: string): CsvParseResult<ParsedInventoryCsvRow> {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return {
      rows: [],
      errors: [{ lineNumber: 1, message: 'CSV must contain a header row and at least one data row.' }],
    }
  }

  const headers = splitCsvLine(lines[0] ?? '').map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  const idx = (candidates: string[]): number => {
    for (const c of candidates) {
      const found = headers.indexOf(c)
      if (found >= 0) return found
    }
    return -1
  }

  const skuIdx = idx(['sku', 'item_sku', 'code'])
  const nameIdx = idx(['name', 'item_name', 'title', 'description'])
  const barcodeIdx = idx(['barcode', 'upc', 'ean'])
  const categoryIdx = idx(['category', 'group'])
  const onHandIdx = idx(['on_hand_qty', 'on_hand', 'quantity', 'qty'])
  const reorderPtIdx = idx(['reorder_point_qty', 'reorder_point', 'reorder_threshold'])
  const reorderQtyIdx = idx(['reorder_qty', 'reorder_quantity'])
  const costCentsIdx = idx(['unit_cost_cents', 'cost_cents'])
  const costDollarsIdx = idx(['unit_cost', 'unit_cost_dollars', 'purchase_cost', 'cost'])
  const priceCentsIdx = idx(['unit_price_cents', 'price_cents'])
  const priceDollarsIdx = idx(['unit_price', 'unit_price_dollars', 'selling_price', 'price'])
  const vendorIdx = idx(['preferred_vendor_name', 'preferred_vendor', 'vendor', 'supplier'])

  if (skuIdx < 0 || nameIdx < 0) {
    return {
      rows: [],
      errors: [{ lineNumber: 1, message: 'CSV header must include both "sku" and "name" columns.' }],
    }
  }

  const rows: ParsedInventoryCsvRow[] = []
  const errors: Array<{ lineNumber: number; message: string }> = []

  for (let i = 1; i < lines.length; i += 1) {
    const lineNumber = i + 1
    const cols = splitCsvLine(lines[i] ?? '')
    const sku = (cols[skuIdx] ?? '').trim().toUpperCase()
    const name = (cols[nameIdx] ?? '').trim()

    if (!sku || !name) {
      errors.push({ lineNumber, message: 'Missing required sku or name.' })
      continue
    }

    const unitCostCents =
      costCentsIdx >= 0
        ? Math.max(0, parseIntSafe(cols[costCentsIdx], 0))
        : parseDollarsToCents(costDollarsIdx >= 0 ? cols[costDollarsIdx] : undefined)

    const unitPriceCents =
      priceCentsIdx >= 0
        ? Math.max(0, parseIntSafe(cols[priceCentsIdx], 0))
        : parseDollarsToCents(priceDollarsIdx >= 0 ? cols[priceDollarsIdx] : undefined)

    rows.push({
      lineNumber,
      sku,
      name,
      barcode: barcodeIdx >= 0 && cols[barcodeIdx] ? cols[barcodeIdx] : null,
      category: categoryIdx >= 0 && cols[categoryIdx] ? cols[categoryIdx] : null,
      on_hand_qty: Math.max(0, parseIntSafe(onHandIdx >= 0 ? cols[onHandIdx] : undefined, 0)),
      reorder_point_qty: Math.max(0, parseIntSafe(reorderPtIdx >= 0 ? cols[reorderPtIdx] : undefined, 0)),
      reorder_qty: Math.max(1, parseIntSafe(reorderQtyIdx >= 0 ? cols[reorderQtyIdx] : undefined, 1)),
      unit_cost_cents: unitCostCents,
      unit_price_cents: unitPriceCents,
      preferred_vendor_name: vendorIdx >= 0 && cols[vendorIdx] ? cols[vendorIdx] : null,
    })
  }

  return { rows, errors }
}

/**
 * Parses a cycle-count CSV sheet: sku, barcode, counted_qty, reason_code, notes
 */
export function parseCycleCountCsv(csvText: string): CsvParseResult<ParsedCycleCountCsvRow> {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return {
      rows: [],
      errors: [{ lineNumber: 1, message: 'Cycle-count CSV must include a header and at least one row.' }],
    }
  }

  const headers = splitCsvLine(lines[0] ?? '').map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  const skuIdx = headers.findIndex(h => h === 'sku' || h === 'item_sku')
  const barcodeIdx = headers.findIndex(h => h === 'barcode' || h === 'upc')
  const countedIdx = headers.findIndex(h => h === 'counted_qty' || h === 'counted' || h === 'physical_qty')
  const reasonIdx = headers.findIndex(h => h === 'reason_code' || h === 'reason')
  const notesIdx = headers.findIndex(h => h === 'notes' || h === 'note')

  if (skuIdx < 0 || countedIdx < 0) {
    return {
      rows: [],
      errors: [{ lineNumber: 1, message: 'Cycle-count CSV requires "sku" and "counted_qty" columns.' }],
    }
  }

  const rows: ParsedCycleCountCsvRow[] = []
  const errors: Array<{ lineNumber: number; message: string }> = []

  for (let i = 1; i < lines.length; i += 1) {
    const lineNumber = i + 1
    const cols = splitCsvLine(lines[i] ?? '')
    const sku = (cols[skuIdx] ?? '').trim().toUpperCase()
    if (!sku) {
      errors.push({ lineNumber, message: 'Missing SKU.' })
      continue
    }

    const rawCount = cols[countedIdx]
    const countedQty = parseIntSafe(rawCount, -1)
    if (countedQty < 0) {
      errors.push({ lineNumber, message: `Invalid counted_qty "${rawCount ?? ''}" for ${sku}.` })
      continue
    }

    const rawReason = (reasonIdx >= 0 ? cols[reasonIdx] : 'unexplained')?.toLowerCase().trim() as AuditReasonCode
    const reasonCode: AuditReasonCode = VALID_REASON_CODES.has(rawReason) ? rawReason : 'unexplained'

    rows.push({
      lineNumber,
      sku,
      barcode: barcodeIdx >= 0 && cols[barcodeIdx] ? cols[barcodeIdx] : null,
      counted_qty: countedQty,
      reason_code: reasonCode,
      notes: notesIdx >= 0 && cols[notesIdx] ? cols[notesIdx] : null,
    })
  }

  return { rows, errors }
}

/**
 * Serializes a 3-way inventory reconciliation report to CSV for CPA/owner export.
 */
export function exportReconciliationReportCsv(report: ReconciliationReport): string {
  const header = [
    'code',
    'severity',
    'sku',
    'item_name',
    'reference_number',
    'expected_qty',
    'actual_qty',
    'variance_qty',
    'variance_bps',
    'variance_cents',
    'summary',
    'recommended_action',
  ]

  const lines = [header.join(',')]
  for (const flag of report.discrepancies) {
    lines.push(
      [
        flag.code,
        flag.severity,
        flag.sku,
        flag.item_name,
        flag.reference_number ?? '',
        flag.expected_qty,
        flag.actual_qty,
        flag.variance_qty,
        flag.variance_bps,
        flag.variance_cents,
        flag.summary,
        flag.recommended_action,
      ]
        .map(escapeCsvCell)
        .join(','),
    )
  }

  return lines.join('\n')
}
