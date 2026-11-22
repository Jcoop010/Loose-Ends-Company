import { parseCsvMatrix } from '../csv'
import type {
  AgentActionLedgerEntry,
  SampleQuickBooksExport,
  ShadowActionItem,
  ShadowAnalysisResult,
  ShadowCategoryBreakdown,
  ShadowFinding,
  ShadowFindingCategory,
  ShadowSession,
  ShadowSourceSystem,
} from './types'

interface ShadowColumnIndices {
  txType: number
  reference: number
  counterparty: number
  memo: number
  date: number
  dueDate: number
  status: number
  amount: number
  openBalance: number
}

interface ShadowNormalizedRow {
  readonly row_number: number
  readonly tx_type: string
  readonly tx_type_norm: string
  readonly reference: string
  readonly counterparty: string
  readonly counterparty_key: string
  readonly memo: string
  readonly date: string | null
  readonly due_date: string | null
  readonly status: string
  readonly status_norm: string
  readonly amount_cents: number
  readonly abs_amount_cents: number
  readonly open_balance_cents: number | null
}

export const SHADOW_CATEGORY_LABELS: Readonly<Record<ShadowFindingCategory, string>> = {
  unbilled_quote: 'Unbilled Accepted Quote',
  overdue_ar: 'Overdue Receivable',
  duplicate_vendor_charge: 'Duplicate Vendor Charge',
  recurring_creep: 'Recurring Price Creep',
}

export const SHADOW_SOURCE_LABELS: Readonly<Record<ShadowSourceSystem, string>> = {
  quickbooks: 'QuickBooks Online',
  zoho: 'Zoho Books',
  stripe: 'Stripe Export',
  generic: 'Generic Bank / CSV',
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function normalizeCounterpartyKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAsciiInt(digits: string): number {
  let acc = 0
  for (let i = 0; i < digits.length; i += 1) {
    const code = digits.charCodeAt(i) - 48
    if (code < 0 || code > 9) {
      throw new Error(`Invalid numeric digit in money string: "${digits}"`)
    }
    acc = acc * 10 + code
    if (!Number.isSafeInteger(acc)) {
      throw new Error('Money value exceeds safe integer range')
    }
  }
  return acc
}

/**
 * Deterministic string-based money parser returning exact integer cents.
 * Supports "$1,240.50", "(425.00)", "-89.99", "1200", "+45.10".
 * Never accumulates floating-point binary drift.
 */
export function parseMoneyToCents(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 0
    return Math.round(raw * 100)
  }
  const input = String(raw ?? '').trim()
  if (!input || input === '-' || input === '--' || input.toLowerCase() === 'n/a') {
    return 0
  }

  let working = input
  let sign = 1
  if (working.startsWith('(') && working.endsWith(')')) {
    sign = -1
    working = working.slice(1, -1).trim()
  }

  working = working.replace(/[$€£¥,\s]/g, '')
  if (!working) return 0

  if (working.startsWith('-')) {
    sign *= -1
    working = working.slice(1)
  } else if (working.startsWith('+')) {
    working = working.slice(1)
  }

  const dotIdx = working.indexOf('.')
  let wholeDigits = ''
  let fracDigits = ''

  if (dotIdx === -1) {
    wholeDigits = working
  } else {
    wholeDigits = working.slice(0, dotIdx)
    fracDigits = working.slice(dotIdx + 1)
    if (fracDigits.includes('.')) {
      return 0
    }
  }

  if (!wholeDigits && !fracDigits) return 0
  if (wholeDigits && !/^\d+$/.test(wholeDigits)) return 0
  if (fracDigits && !/^\d+$/.test(fracDigits)) return 0

  const wholeVal = wholeDigits ? parseAsciiInt(wholeDigits) : 0
  const paddedFrac = `${fracDigits}00`
  const twoFracDigits = parseAsciiInt(paddedFrac.slice(0, 2))
  const roundUpDigit = paddedFrac.length > 2 && paddedFrac.charCodeAt(2) >= 53 ? 1 : 0
  const totalAbsCents = wholeVal * 100 + twoFracDigits + roundUpDigit

  if (!Number.isSafeInteger(totalAbsCents)) {
    throw new Error(`Parsed money exceeds safe integer cents: "${input}"`)
  }
  return totalAbsCents === 0 ? 0 : sign * totalAbsCents
}

function isValidIsoDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  )
}

export function parseFlexibleDateToIso(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s)
  if (isoMatch) {
    const y = parseAsciiInt(isoMatch[1])
    const m = parseAsciiInt(isoMatch[2])
    const d = parseAsciiInt(isoMatch[3])
    return isValidIsoDate(y, m, d)
      ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
      : null
  }

  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s)
  if (usMatch) {
    const mNum = parseAsciiInt(usMatch[1])
    const dNum = parseAsciiInt(usMatch[2])
    const yNum = parseAsciiInt(usMatch[3])
    if (!isValidIsoDate(yNum, mNum, dNum)) return null
    return `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`
  }

  return null
}

function diffUtcDays(laterIso: string, earlierIso: string): number {
  const a = Date.parse(`${laterIso}T00:00:00Z`)
  const b = Date.parse(`${earlierIso}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((a - b) / 86_400_000)
}

export function detectShadowSourceSystem(headers: readonly string[]): ShadowSourceSystem {
  const normSet = new Set(headers.map(normalizeHeader).filter(Boolean))

  if (
    normSet.has('transaction_type') ||
    (normSet.has('open_balance') && (normSet.has('num') || normSet.has('memo_description')))
  ) {
    return 'quickbooks'
  }

  if (
    normSet.has('customer_vendor') ||
    normSet.has('balance_due') ||
    normSet.has('reference_no') ||
    (normSet.has('reference') && normSet.has('total'))
  ) {
    return 'zoho'
  }

  if (
    normSet.has('reporting_category') ||
    normSet.has('created_utc') ||
    (normSet.has('customer_email') && (normSet.has('gross') || normSet.has('fee') || normSet.has('net')))
  ) {
    return 'stripe'
  }

  return 'generic'
}

function findColumnIndex(
  normalizedHeaders: readonly string[],
  aliases: readonly string[],
): number {
  for (const alias of aliases) {
    const exactIdx = normalizedHeaders.indexOf(alias)
    if (exactIdx !== -1) return exactIdx
  }
  return -1
}

function resolveColumnIndices(normalizedHeaders: readonly string[]): ShadowColumnIndices {
  return {
    txType: findColumnIndex(normalizedHeaders, [
      'transaction_type',
      'type',
      'reporting_category',
      'record_type',
      'tx_type',
      'entry_type',
      'kind',
    ]),
    reference: findColumnIndex(normalizedHeaders, [
      'num',
      'reference',
      'reference_no',
      'ref',
      'document_number',
      'invoice_number',
      'quote_number',
      'id',
      'charge_id',
    ]),
    counterparty: findColumnIndex(normalizedHeaders, [
      'name',
      'customer_vendor',
      'counterparty',
      'vendor',
      'customer',
      'customer_name',
      'merchant',
      'payee',
      'client',
      'customer_email',
    ]),
    memo: findColumnIndex(normalizedHeaders, [
      'memo_description',
      'description',
      'memo',
      'notes',
      'item',
      'service',
      'product',
      'line_description',
    ]),
    date: findColumnIndex(normalizedHeaders, [
      'date',
      'tx_date',
      'transaction_date',
      'created_utc',
      'created',
      'created_at',
      'posted_at',
      'issued_on',
    ]),
    dueDate: findColumnIndex(normalizedHeaders, [
      'due_date',
      'payment_due_date',
      'expires_on',
    ]),
    status: findColumnIndex(normalizedHeaders, [
      'status',
      'payment_status',
      'state',
      'approval_status',
    ]),
    amount: findColumnIndex(normalizedHeaders, [
      'amount',
      'total',
      'gross',
      'tx_amount',
      'debit_credit',
      'net',
    ]),
    openBalance: findColumnIndex(normalizedHeaders, [
      'open_balance',
      'balance_due',
      'amount_due',
      'remaining_balance',
      'balance',
    ]),
  }
}

function readCell(row: readonly string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return ''
  return String(row[idx] ?? '').trim()
}

function isVoidOrRefundStatus(normStatus: string, normType: string): boolean {
  const cleaned = `${normType} ${normStatus}`.replace(/credit\s+card/g, '')
  return /(refund|\bcredit\b|credit\s*memo|vendor\s*credit|chargeback|void|cancel|cancelled|declined|rejected|reversed)/.test(
    cleaned,
  )
}

function isQuoteRow(row: ShadowNormalizedRow): boolean {
  return /(quote|estimate|proposal|bid)/.test(row.tx_type_norm) ||
    /^(est|qte|quo)[-_]?\d+/i.test(row.reference)
}

function isInvoiceRow(row: ShadowNormalizedRow): boolean {
  if (
    /(\bbill\b|vendor|payable|expense|card|charge|debit|check|ach|payout|subscription|saas|fee|purchase)/.test(
      row.tx_type_norm,
    )
  ) {
    return false
  }
  return (
    /(invoice|receivable|\bar\b|payment|sale)/.test(row.tx_type_norm) ||
    /^inv[-_]?\d+/i.test(row.reference) ||
    (row.due_date !== null && row.amount_cents > 0 && !isQuoteRow(row))
  )
}

function isVendorChargeRow(row: ShadowNormalizedRow): boolean {
  if (isVoidOrRefundStatus(row.status_norm, row.tx_type_norm)) return false
  if (isQuoteRow(row) || isInvoiceRow(row)) return false
  if (
    /(expense|bill|vendor|card|charge|debit|check|ach|payout|subscription|saas|fee|purchase)/.test(
      row.tx_type_norm,
    )
  ) {
    return row.abs_amount_cents > 0
  }
  return row.amount_cents < 0
}

function makeEmptyBreakdown(): ShadowCategoryBreakdown {
  return {
    unbilled_quote: 0,
    overdue_ar: 0,
    duplicate_vendor_charge: 0,
    recurring_creep: 0,
  }
}

export function recomputeShadowLeakTotalCents(findings: readonly ShadowFinding[]): number {
  let total = 0
  for (const item of findings) {
    if (item.status === 'dismissed') continue
    if (Number.isSafeInteger(item.amount_cents) && item.amount_cents > 0) {
      total += item.amount_cents
    }
  }
  return total
}

function formatExactDollars(cents: number): string {
  return (Math.trunc(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function buildActionItem(finding: ShadowFinding): ShadowActionItem {
  const recommended =
    typeof finding.evidence_json.recommended_action === 'string'
      ? finding.evidence_json.recommended_action
      : 'Review record in Shadow Mode before promoting.'

  let title = `${SHADOW_CATEGORY_LABELS[finding.category]} — ${finding.counterparty}`
  if (finding.category === 'unbilled_quote' && typeof finding.evidence_json.reference === 'string') {
    title = `Bill accepted quote ${finding.evidence_json.reference} (${finding.counterparty})`
  } else if (
    finding.category === 'overdue_ar' &&
    typeof finding.evidence_json.reference === 'string'
  ) {
    const days =
      typeof finding.evidence_json.days_overdue === 'number'
        ? ` · ${finding.evidence_json.days_overdue}d past due`
        : ''
    title = `Collect overdue ${finding.evidence_json.reference} (${finding.counterparty}${days})`
  } else if (finding.category === 'duplicate_vendor_charge') {
    title = `Dispute duplicate charge to ${finding.counterparty}`
  } else if (finding.category === 'recurring_creep') {
    const monthlyDelta =
      typeof finding.evidence_json.monthly_delta_cents === 'number'
        ? finding.evidence_json.monthly_delta_cents
        : 0
    const deltaLabel = monthlyDelta > 0 ? ` (+$${(monthlyDelta / 100).toFixed(2)}/mo)` : ''
    title = `Renegotiate ${finding.counterparty} rate creep${deltaLabel}`
  }

  return {
    finding_id: finding.id,
    category: finding.category,
    priority: finding.amount_cents >= 50000 ? 'high' : 'medium',
    counterparty: finding.counterparty,
    amount_cents: finding.amount_cents,
    title,
    recommended_action: recommended,
  }
}

/**
 * Pure, read-only deterministic CSV analyzer for QuickBooks, Zoho, Stripe & generic exports.
 * Computes all monetary values in exact integer cents without mutating any external state.
 */
export function analyzeShadowCsv(
  rawCsv: string,
  options?: {
    workspaceId?: string
    sessionId?: string
    fileName?: string
    sourceSystem?: ShadowSourceSystem
    asOfDate?: string
  },
): ShadowAnalysisResult {
  const matrix = parseCsvMatrix(rawCsv)
  if (matrix.length < 2) {
    throw new Error('CSV must include a header row and at least one transaction row.')
  }

  const rawHeaders = matrix[0]
  const normalizedHeaders = rawHeaders.map(normalizeHeader)
  const colIdx = resolveColumnIndices(normalizedHeaders)

  if (colIdx.counterparty === -1 || (colIdx.amount === -1 && colIdx.openBalance === -1)) {
    throw new Error(
      'Unable to map required counterparty/name and amount columns from CSV header.',
    )
  }

  const workspaceId = options?.workspaceId ?? 'shadow-preview-workspace'
  const sessionId = options?.sessionId ?? 'shadow-session-preview'
  const fileName = options?.fileName?.trim() || 'shadow_export.csv'
  const sourceSystem = options?.sourceSystem ?? detectShadowSourceSystem(rawHeaders)
  const asOfDate =
    options?.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate)
      ? options.asOfDate
      : new Date().toISOString().slice(0, 10)

  const normalizedRows: ShadowNormalizedRow[] = []

  for (let i = 1; i < matrix.length; i += 1) {
    const rawRow = matrix[i]
    const counterparty =
      readCell(rawRow, colIdx.counterparty) || readCell(rawRow, colIdx.memo) || 'Unknown Counterparty'
    const txType = readCell(rawRow, colIdx.txType)
    const reference = readCell(rawRow, colIdx.reference)
    const memo = readCell(rawRow, colIdx.memo)
    const date = parseFlexibleDateToIso(readCell(rawRow, colIdx.date))
    const dueDate = parseFlexibleDateToIso(readCell(rawRow, colIdx.dueDate))
    const status = readCell(rawRow, colIdx.status)
    const amountRaw = readCell(rawRow, colIdx.amount)
    const openBalanceRaw = readCell(rawRow, colIdx.openBalance)

    const amountCents = amountRaw ? parseMoneyToCents(amountRaw) : 0
    const openBalanceCents =
      colIdx.openBalance !== -1 && openBalanceRaw !== ''
        ? parseMoneyToCents(openBalanceRaw)
        : null

    normalizedRows.push({
      row_number: i + 1,
      tx_type: txType,
      tx_type_norm: txType.toLowerCase(),
      reference,
      counterparty,
      counterparty_key: normalizeCounterpartyKey(counterparty),
      memo,
      date,
      due_date: dueDate,
      status,
      status_norm: status.toLowerCase(),
      amount_cents: amountCents,
      abs_amount_cents: Math.abs(amountCents),
      open_balance_cents: openBalanceCents,
    })
  }

  const findings: ShadowFinding[] = []
  const invoiceRows = normalizedRows.filter(isInvoiceRow)

  // 1. Unbilled Accepted Quotes / Estimates
  for (const row of normalizedRows) {
    if (!isQuoteRow(row)) continue
    if (isVoidOrRefundStatus(row.status_norm, row.tx_type_norm)) continue

    const accepted = /(accept|approv|sign|won|ready_to_bill|authorized)/.test(row.status_norm)
    const alreadyBilledStatus = /(billed|invoiced|converted|closed|paid)/.test(row.status_norm)
    if (!accepted || alreadyBilledStatus) continue

    const billableCents =
      row.open_balance_cents !== null && row.open_balance_cents > 0
        ? row.open_balance_cents
        : row.abs_amount_cents
    if (billableCents <= 0) continue

    const refLower = row.reference.toLowerCase()
    const hasMatchingInvoice = invoiceRows.some(inv => {
      if (refLower && inv.memo.toLowerCase().includes(refLower)) return true
      if (refLower && inv.reference.toLowerCase() === refLower) return true
      return (
        inv.counterparty_key === row.counterparty_key &&
        inv.abs_amount_cents === billableCents &&
        (!row.date || !inv.date || diffUtcDays(inv.date, row.date) >= -7)
      )
    })

    if (hasMatchingInvoice) continue

    const refLabel = row.reference || `Row-${row.row_number}`
    const proofSummary = `Accepted quote ${refLabel} for ${row.counterparty} ($${formatExactDollars(billableCents)} / ${billableCents.toLocaleString('en-US')} cents) has 0 matching invoice rows.`

    findings.push({
      id: `sf_quote_${row.row_number}`,
      workspace_id: workspaceId,
      session_id: sessionId,
      category: 'unbilled_quote',
      counterparty: row.counterparty,
      amount_cents: billableCents,
      proof_summary: proofSummary,
      evidence_json: {
        row_number: row.row_number,
        reference: refLabel,
        date: row.date,
        status: row.status || 'Accepted',
        memo: row.memo || null,
        reason: 'Accepted quote/estimate has no matching invoice record',
        recommended_action: 'Generate invoice and payment link from accepted quote immediately',
      },
      status: 'open',
    })
  }

  // 2. Overdue AR Invoices
  for (const row of invoiceRows) {
    if (isVoidOrRefundStatus(row.status_norm, row.tx_type_norm)) continue
    if (/(^paid$|settled|draft)/.test(row.status_norm) || row.status_norm === 'paid') continue

    const openCents =
      row.open_balance_cents !== null ? Math.max(0, row.open_balance_cents) : row.abs_amount_cents
    if (openCents <= 0) continue

    const explicitOverdue = /(overdue|past_due|past due|delinquent|unpaid|uncollectible)/.test(
      row.status_norm,
    )
    const pastDueByDate = row.due_date !== null && row.due_date < asOfDate
    if (!explicitOverdue && !pastDueByDate) continue

    const daysOverdue =
      row.due_date !== null && row.due_date < asOfDate ? diffUtcDays(asOfDate, row.due_date) : 1
    const refLabel = row.reference || `Row-${row.row_number}`
    const dueLabel = row.due_date ?? 'unspecified due date'
    const proofSummary = `Invoice ${refLabel} for ${row.counterparty} (${daysOverdue}d past due since ${dueLabel}) leaves $${formatExactDollars(openCents)} (${openCents.toLocaleString('en-US')} cents) uncollected.`

    findings.push({
      id: `sf_ar_${row.row_number}`,
      workspace_id: workspaceId,
      session_id: sessionId,
      category: 'overdue_ar',
      counterparty: row.counterparty,
      amount_cents: openCents,
      proof_summary: proofSummary,
      evidence_json: {
        row_number: row.row_number,
        reference: refLabel,
        date: row.date,
        due_date: row.due_date,
        days_overdue: daysOverdue,
        status: row.status || 'Overdue',
        memo: row.memo || null,
        reason: `Open invoice balance overdue by ${daysOverdue} day(s) as of ${asOfDate}`,
        recommended_action: 'Stage consent-gated AR collection reminder with Stripe checkout link',
      },
      status: 'open',
    })
  }

  // 3. Duplicate Vendor Charges (exact amount + same normalized counterparty within <= 14 days)
  const vendorRows = normalizedRows.filter(isVendorChargeRow)
  const duplicateRowNumbers = new Set<number>()
  const byCounterpartyAndAmount = new Map<string, ShadowNormalizedRow[]>()

  for (const row of vendorRows) {
    if (!row.counterparty_key || row.abs_amount_cents <= 0) continue
    const key = `${row.counterparty_key}::${row.abs_amount_cents}`
    const list = byCounterpartyAndAmount.get(key)
    if (list) list.push(row)
    else byCounterpartyAndAmount.set(key, [row])
  }

  for (const group of byCounterpartyAndAmount.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => {
      const dateCmp = (a.date ?? '').localeCompare(b.date ?? '')
      return dateCmp !== 0 ? dateCmp : a.row_number - b.row_number
    })

    const anchor = sorted[0]
    for (let idx = 1; idx < sorted.length; idx += 1) {
      const candidate = sorted[idx]
      const daysApart =
        anchor.date && candidate.date ? Math.abs(diffUtcDays(candidate.date, anchor.date)) : 0
      if (daysApart > 14) continue

      duplicateRowNumbers.add(candidate.row_number)
      const dupRef = candidate.reference || `Row-${candidate.row_number}`
      const origRef = anchor.reference || `Row-${anchor.row_number}`
      const dupProof = `Duplicate charge ${dupRef} (${candidate.date ?? 'same import'}) matches ${origRef} (${anchor.date ?? 'same import'}) for ${candidate.counterparty} within ${daysApart}d: +$${formatExactDollars(candidate.abs_amount_cents)} (${candidate.abs_amount_cents.toLocaleString('en-US')} cents).`

      findings.push({
        id: `sf_dup_${candidate.row_number}`,
        workspace_id: workspaceId,
        session_id: sessionId,
        category: 'duplicate_vendor_charge',
        counterparty: candidate.counterparty,
        amount_cents: candidate.abs_amount_cents,
        proof_summary: dupProof,
        evidence_json: {
          duplicate_row_number: candidate.row_number,
          duplicate_reference: dupRef,
          duplicate_date: candidate.date,
          original_row_number: anchor.row_number,
          original_reference: origRef,
          original_date: anchor.date,
          days_apart: daysApart,
          memo: candidate.memo || null,
          reason: `Identical vendor charge ($${formatExactDollars(candidate.abs_amount_cents)}) posted ${daysApart} day(s) apart`,
          recommended_action: 'Hold payment or stage duplicate-charge vendor credit memo dispute',
        },
        status: 'open',
      })
    }
  }

  // 4. Recurring Price Creep (same counterparty across cycles >= 20d, latest >= +10% & >= $10/mo)
  const chargesByVendor = new Map<string, ShadowNormalizedRow[]>()
  for (const row of vendorRows) {
    if (duplicateRowNumbers.has(row.row_number)) continue
    if (!row.counterparty_key || !row.date || row.abs_amount_cents <= 0) continue
    const existing = chargesByVendor.get(row.counterparty_key)
    if (existing) existing.push(row)
    else chargesByVendor.set(row.counterparty_key, [row])
  }

  for (const vendorGroup of chargesByVendor.values()) {
    if (vendorGroup.length < 2) continue
    const sorted = [...vendorGroup].sort((a, b) => {
      const cmp = (a.date ?? '').localeCompare(b.date ?? '')
      return cmp !== 0 ? cmp : a.row_number - b.row_number
    })

    const first = sorted[0]
    const prior = sorted[sorted.length - 2]
    const latest = sorted[sorted.length - 1]
    if (!first.date || !prior.date || !latest.date) continue

    const cycleSpanDays = diffUtcDays(latest.date, first.date)
    const stepDays = diffUtcDays(latest.date, prior.date)
    if (cycleSpanDays < 20 || stepDays < 15) continue

    const baselineCents = prior.abs_amount_cents
    const latestCents = latest.abs_amount_cents
    const monthlyDeltaCents = latestCents - baselineCents
    if (monthlyDeltaCents < 1000) continue
    if (monthlyDeltaCents * 100 < baselineCents * 10) continue

    const annualizedImpactCents = monthlyDeltaCents * 12
    const pctIncreaseBps = Math.round((monthlyDeltaCents * 10000) / baselineCents)
    const creepProof = `${latest.counterparty} rose from $${formatExactDollars(baselineCents)}/mo (${baselineCents.toLocaleString('en-US')}c) on ${prior.date} to $${formatExactDollars(latestCents)}/mo (${latestCents.toLocaleString('en-US')}c) on ${latest.date}: +$${formatExactDollars(monthlyDeltaCents)}/mo x 12 = $${formatExactDollars(annualizedImpactCents)}/yr (${annualizedImpactCents.toLocaleString('en-US')} cents).`

    findings.push({
      id: `sf_creep_${latest.row_number}`,
      workspace_id: workspaceId,
      session_id: sessionId,
      category: 'recurring_creep',
      counterparty: latest.counterparty,
      amount_cents: annualizedImpactCents,
      proof_summary: creepProof,
      evidence_json: {
        baseline_cents: baselineCents,
        latest_cents: latestCents,
        monthly_delta_cents: monthlyDeltaCents,
        annualized_impact_cents: annualizedImpactCents,
        increase_pct: Number((pctIncreaseBps / 100).toFixed(1)),
        baseline_date: prior.date,
        latest_date: latest.date,
        charge_count: sorted.length,
        latest_reference: latest.reference || `Row-${latest.row_number}`,
        memo: latest.memo || null,
        reason: `Recurring vendor charge increased from $${formatExactDollars(baselineCents)} to $${formatExactDollars(latestCents)} (+$${formatExactDollars(monthlyDeltaCents)}/mo · 12-mo impact $${formatExactDollars(annualizedImpactCents)})`,
        recommended_action: 'Stage SaaS/vendor rate-lock notice or downgrade unused seats before next cycle',
      },
      status: 'open',
    })
  }

  findings.sort((a, b) => b.amount_cents - a.amount_cents)

  const byCategoryCents = makeEmptyBreakdown()
  const countsByCategory = makeEmptyBreakdown()
  for (const item of findings) {
    byCategoryCents[item.category] += item.amount_cents
    countsByCategory[item.category] += 1
  }

  const totalLeakCents = recomputeShadowLeakTotalCents(findings)
  const flaggedRowsCount = findings.length
  const cleanRowCount = Math.max(0, normalizedRows.length - flaggedRowsCount)

  return {
    file_name: fileName,
    source_system: sourceSystem,
    as_of_date: asOfDate,
    row_count: normalizedRows.length,
    clean_row_count: cleanRowCount,
    total_leak_cents: totalLeakCents,
    by_category_cents: byCategoryCents,
    finding_counts_by_category: countsByCategory,
    findings,
    action_items: findings.map(buildActionItem),
    detected_columns: {
      tx_type: colIdx.txType >= 0 ? rawHeaders[colIdx.txType] : null,
      reference: colIdx.reference >= 0 ? rawHeaders[colIdx.reference] : null,
      counterparty: colIdx.counterparty >= 0 ? rawHeaders[colIdx.counterparty] : null,
      date: colIdx.date >= 0 ? rawHeaders[colIdx.date] : null,
      due_date: colIdx.dueDate >= 0 ? rawHeaders[colIdx.dueDate] : null,
      status: colIdx.status >= 0 ? rawHeaders[colIdx.status] : null,
      amount: colIdx.amount >= 0 ? rawHeaders[colIdx.amount] : null,
      open_balance: colIdx.openBalance >= 0 ? rawHeaders[colIdx.openBalance] : null,
    },
  }
}

export function buildShadowPromotionPlan(params: {
  workspaceId: string
  session: ShadowSession
  findings: readonly ShadowFinding[]
  nowIso?: string
}): {
  openFindingIds: string[]
  promotedFindings: ShadowFinding[]
  promotedSession: ShadowSession
  ledgerDraft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
} {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const openFindings = params.findings.filter(f => f.status === 'open')
  const impactCents = recomputeShadowLeakTotalCents(openFindings)
  const openFindingIds = openFindings.map(f => f.id)

  const promotedFindings: ShadowFinding[] = params.findings.map(item =>
    item.status === 'open'
      ? { ...item, status: 'promoted', updated_at: nowIso }
      : item,
  )

  const promotedSession: ShadowSession = {
    ...params.session,
    status: 'promoted',
    total_leak_cents: impactCents,
    updated_at: nowIso,
  }

  return {
    openFindingIds,
    promotedFindings,
    promotedSession,
    ledgerDraft: {
      workspace_id: params.workspaceId,
      agent_name: 'Shadow Mode Onboarding Engine',
      module: 'shadow',
      action_type: 'promote_shadow_session',
      autonomy_mode: 'approve_1tap',
      summary: `Promoted ${openFindingIds.length} verified Shadow Mode finding(s) from ${params.session.file_name} ($${(impactCents / 100).toFixed(2)} recoverable)`,
      impact_cents: impactCents,
      before_state: {
        shadow_session_id: params.session.id,
        session_status: params.session.status,
        open_finding_ids: openFindingIds,
      },
      after_state: {
        shadow_session_id: params.session.id,
        session_status: 'promoted',
        promoted_finding_ids: openFindingIds,
        source_system: params.session.source_system,
        file_name: params.session.file_name,
      },
      status: 'executed',
      reversed_at: null,
    },
  }
}

/**
 * Built-in QuickBooks sample export surfacing exactly $4,850.00 (485,000 cents)
 * in verifiable leaks across all 4 categories while proving zero false positives
 * on clean paid invoices, matched quotes, and normal expenses.
 */
export function loadSampleQuickBooksExport(): SampleQuickBooksExport {
  const csvText = [
    'Transaction Type,Num,Date,Due Date,Name,Memo/Description,Status,Amount,Open Balance',
    'Estimate,EST-2041,2026-11-12,2026-11-26,Harborview Medical Suites,"Approved rooftop chiller retrofit sign-off",Accepted,"$1,850.00","$1,850.00"',
    'Estimate,EST-2010,2026-10-12,2026-10-26,Oak Street Bakery,"Walk-in condenser coil swap (already billed)",Accepted,"$920.00","$0.00"',
    'Invoice,INV-3150,2026-10-14,2026-11-13,Oak Street Bakery,"Walk-in condenser coil swap per EST-2010",Paid,"$920.00","$0.00"',
    'Invoice,INV-3188,2026-10-04,2026-10-18,Mercer Family Dental,"Quarterly RTU maintenance + belt kit",Overdue,"$1,620.00","$1,620.00"',
    'Invoice,INV-3214,2026-11-18,2026-12-18,Valley Forge Logistics,"Ductless mini-split commissioning",Sent,"$2,400.00","$2,400.00"',
    'Credit Card Expense,CHG-8812,2026-11-10,,Apex Industrial Supply,"Carrier OEM blower assembly lot #44",Posted,"$840.00","$0.00"',
    'Credit Card Expense,CHG-8819,2026-11-13,,Apex Industrial Supply,"Carrier OEM blower assembly lot #44 (dup)",Posted,"$840.00","$0.00"',
    'Expense,SUB-0901,2026-09-01,,CloudDispatch Pro,"Field dispatch & GPS seat license",Paid,"$245.00","$0.00"',
    'Expense,SUB-1001,2026-10-01,,CloudDispatch Pro,"Field dispatch & GPS seat license",Paid,"$245.00","$0.00"',
    'Expense,SUB-1101,2026-11-01,,CloudDispatch Pro,"Field dispatch & GPS seat license (tier bump)",Paid,"$290.00","$0.00"',
    'Expense,UTIL-1115,2026-11-15,,Appalachian Power,"Shop bay electric utility",Paid,"$312.40","$0.00"',
  ].join('\n')

  return {
    file_name: 'ridgeway_qbo_shadow_export_nov2026.csv',
    as_of_date: '2026-11-22',
    csv_text: csvText,
    description:
      'QuickBooks Online export (11 transactions): $1,850.00 unbilled quote + $1,620.00 overdue AR + $840.00 duplicate charge + $540.00 annualized price creep = $4,850.00 recoverable.',
  }
}
