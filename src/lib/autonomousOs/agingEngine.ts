// Pure deterministic AR/AP aging, cashflow projection, and early-pay discount engine (integer cents only)

import type {
  AgingBucketKey,
  AgingBucketSummary,
  AgingLedgerRow,
  ArApAgingSnapshot,
  AutonomousInvoice,
  CashflowProjectionWindow,
  EarlyPayDiscountOpportunity,
  VendorBillRecord,
} from './types'

const DAY_MS = 86_400_000

export const AGING_BUCKET_ORDER: readonly AgingBucketKey[] = [
  'current',
  'days_1_30',
  'days_31_60',
  'days_61_90',
  'days_90_plus',
]

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  current: 'Current',
  days_1_30: '1–30 Days',
  days_31_60: '31–60 Days',
  days_61_90: '61–90 Days',
  days_90_plus: '90+ Days',
}

function safeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.trunc(value)
}

function parseIsoUtcMs(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!match) return 0
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function diffDaysIsoUtc(fromIso: string, toIso: string): number {
  const fromMs = parseIsoUtcMs(fromIso)
  const toMs = parseIsoUtcMs(toIso)
  if (!fromMs || !toMs) return 0
  return Math.trunc((toMs - fromMs) / DAY_MS)
}

export function addDaysIsoUtc(isoDate: string, days: number): string {
  const baseMs = parseIsoUtcMs(isoDate)
  if (!baseMs) return isoDate
  return new Date(baseMs + Math.trunc(days) * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Exact half-up integer basis point multiplication:
 * e.g. computeDepositCents(100_000, 2500) = 25_000 ($1,000.00 * 25% = $250.00).
 */
export function computeDepositCents(totalCents: number, depositRequiredBps: number): number {
  const total = Math.max(0, safeInt(totalCents))
  const bps = Math.max(0, Math.min(10_000, safeInt(depositRequiredBps)))
  return Math.floor((total * bps + 5000) / 10_000)
}

export function computeInvoiceBalanceDueCents(
  invoice: Pick<AutonomousInvoice, 'total_cents' | 'amount_paid_cents' | 'balance_due_cents' | 'status'>,
): number {
  if (invoice.status === 'paid' || invoice.status === 'void') {
    return 0
  }
  const total = Math.max(0, safeInt(invoice.total_cents))
  const paid = Math.min(total, Math.max(0, safeInt(invoice.amount_paid_cents)))
  if (
    typeof invoice.balance_due_cents === 'number' &&
    Number.isSafeInteger(invoice.balance_due_cents) &&
    invoice.balance_due_cents >= 0 &&
    invoice.balance_due_cents === total - paid
  ) {
    return invoice.balance_due_cents
  }
  return Math.max(0, total - paid)
}

export function classifyAgingBucket(daysPastDue: number): AgingBucketKey {
  const d = Math.trunc(daysPastDue)
  if (d <= 0) return 'current'
  if (d <= 30) return 'days_1_30'
  if (d <= 60) return 'days_31_60'
  if (d <= 90) return 'days_61_90'
  return 'days_90_plus'
}

export interface ParsedEarlyPayTerms {
  discountBps: number
  discountDays: number
  netDays: number
  normalizedLabel: string
}

/**
 * Parses common AP trade discount terms like "2/10 Net 30", "1/15 Net 45", "3/10 N30".
 */
export function parseEarlyPayTerms(termsLabel: string | null | undefined): ParsedEarlyPayTerms | null {
  if (!termsLabel) return null
  const match = /(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*(?:net|n)?\s*(\d+)?/i.exec(termsLabel.trim())
  if (!match) return null
  const pct = Number(match[1])
  const discountDays = Math.trunc(Number(match[2]))
  const netDays = match[3] ? Math.trunc(Number(match[3])) : 30
  if (!Number.isFinite(pct) || pct <= 0 || pct > 50 || discountDays <= 0 || discountDays > 90) {
    return null
  }
  const discountBps = Math.round(pct * 100)
  return {
    discountBps,
    discountDays,
    netDays: Math.max(discountDays + 1, netDays),
    normalizedLabel: `${pct}/${discountDays} Net ${Math.max(discountDays + 1, netDays)}`,
  }
}

export function evaluateEarlyPayVendorDiscounts(
  vendorBills: readonly VendorBillRecord[],
  asOfDate: string,
): EarlyPayDiscountOpportunity[] {
  const results: EarlyPayDiscountOpportunity[] = []

  for (const bill of vendorBills) {
    if (bill.match_status === 'paid' || bill.match_status === 'disputed' || bill.match_status === 'exception_flagged') {
      continue
    }
    const totalCents = Math.max(0, safeInt(bill.total_cents))
    if (totalCents <= 0) continue

    const parsedTerms = parseEarlyPayTerms(bill.payment_terms_label)
    const discountBps =
      safeInt(bill.early_pay_discount_bps) > 0
        ? Math.min(5000, safeInt(bill.early_pay_discount_bps))
        : parsedTerms?.discountBps ?? 0
    const discountDays =
      safeInt(bill.early_pay_discount_days) > 0
        ? Math.min(90, safeInt(bill.early_pay_discount_days))
        : parsedTerms?.discountDays ?? 0

    if (discountBps <= 0 || discountDays <= 0) continue

    const billOriginDate =
      bill.bill_date?.slice(0, 10) || bill.created_at.slice(0, 10) || asOfDate
    const deadline = addDaysIsoUtc(billOriginDate, discountDays)
    const daysRemaining = diffDaysIsoUtc(asOfDate, deadline)
    const discountCents = Math.floor((totalCents * discountBps + 5000) / 10_000)
    if (discountCents <= 0) continue

    const inferredNetDays = parsedTerms?.netDays ?? Math.max(discountDays + 10, diffDaysIsoUtc(billOriginDate, bill.due_date))
    const spreadDays = Math.max(1, inferredNetDays - discountDays)
    const annualizedAprBps = Math.floor((discountBps * 365 + Math.floor(spreadDays / 2)) / spreadDays)

    results.push({
      bill_id: bill.id,
      vendor_name: bill.vendor_name,
      invoice_number: bill.invoice_number,
      terms_label: bill.payment_terms_label?.trim() || parsedTerms?.normalizedLabel || `${(discountBps / 100).toFixed(1)}/${discountDays} Net ${inferredNetDays}`,
      bill_total_cents: totalCents,
      discount_bps: discountBps,
      discount_cents: discountCents,
      net_pay_cents: totalCents - discountCents,
      discount_deadline: deadline,
      due_date: bill.due_date,
      days_remaining: daysRemaining,
      expired: daysRemaining < 0,
      annualized_apr_bps: annualizedAprBps,
    })
  }

  return results.sort((a, b) => {
    if (a.expired !== b.expired) return a.expired ? 1 : -1
    if (a.days_remaining !== b.days_remaining) return a.days_remaining - b.days_remaining
    return b.discount_cents - a.discount_cents
  })
}

export function computeArApAgingAndCashflow(params: {
  invoices: readonly AutonomousInvoice[]
  vendorBills: readonly VendorBillRecord[]
  asOfDate?: string
  startingCashCents?: number
}): ArApAgingSnapshot {
  const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10)
  const startingCashCents = safeInt(params.startingCashCents ?? 0)

  const bucketMap = new Map<AgingBucketKey, AgingBucketSummary>()
  for (const key of AGING_BUCKET_ORDER) {
    bucketMap.set(key, {
      bucket: key,
      label: AGING_BUCKET_LABELS[key],
      ar_count: 0,
      ar_cents: 0,
      ap_count: 0,
      ap_cents: 0,
      net_cents: 0,
    })
  }

  const rows: AgingLedgerRow[] = []
  let totalOpenArCents = 0
  let totalOpenApCents = 0

  for (const inv of params.invoices) {
    const balanceCents = computeInvoiceBalanceDueCents(inv)
    if (balanceCents <= 0) continue

    const daysPastDue = diffDaysIsoUtc(inv.due_date, asOfDate)
    const bucket = classifyAgingBucket(daysPastDue)
    const summary = bucketMap.get(bucket)!
    summary.ar_count += 1
    summary.ar_cents += balanceCents
    summary.net_cents = summary.ar_cents - summary.ap_cents
    totalOpenArCents += balanceCents

    rows.push({
      kind: 'ar_invoice',
      id: inv.id,
      document_number: inv.invoice_number,
      counterparty: inv.customer_name,
      title: inv.title,
      due_date: inv.due_date,
      days_past_due: daysPastDue,
      bucket,
      total_cents: Math.max(0, safeInt(inv.total_cents)),
      paid_cents: Math.max(0, safeInt(inv.amount_paid_cents)),
      balance_cents: balanceCents,
      status: inv.status,
    })
  }

  for (const bill of params.vendorBills) {
    if (bill.match_status === 'paid') continue
    const totalCents = Math.max(0, safeInt(bill.total_cents))
    if (totalCents <= 0) continue

    const daysPastDue = diffDaysIsoUtc(bill.due_date, asOfDate)
    const bucket = classifyAgingBucket(daysPastDue)
    const summary = bucketMap.get(bucket)!
    summary.ap_count += 1
    summary.ap_cents += totalCents
    summary.net_cents = summary.ar_cents - summary.ap_cents
    totalOpenApCents += totalCents

    rows.push({
      kind: 'ap_bill',
      id: bill.id,
      document_number: bill.invoice_number,
      counterparty: bill.vendor_name,
      title: bill.payment_terms_label || bill.discrepancy_summary || 'Vendor AP Bill',
      due_date: bill.due_date,
      days_past_due: daysPastDue,
      bucket,
      total_cents: totalCents,
      paid_cents: 0,
      balance_cents: totalCents,
      status: bill.match_status,
    })
  }

  rows.sort((a, b) => b.days_past_due - a.days_past_due || b.balance_cents - a.balance_cents)

  const buildWindow = (horizonDays: 7 | 15 | 30): CashflowProjectionWindow => {
    const windowEnd = addDaysIsoUtc(asOfDate, horizonDays)
    let overdueArIncludedCents = 0
    let upcomingArDueCents = 0
    let scheduledOutflowCents = 0

    for (const inv of params.invoices) {
      const balance = computeInvoiceBalanceDueCents(inv)
      if (balance <= 0) continue
      const daysUntilDue = diffDaysIsoUtc(asOfDate, inv.due_date)
      if (daysUntilDue < 0) {
        overdueArIncludedCents += balance
      } else if (daysUntilDue <= horizonDays) {
        upcomingArDueCents += balance
      }
    }

    for (const bill of params.vendorBills) {
      if (
        bill.match_status === 'paid' ||
        bill.match_status === 'disputed' ||
        bill.match_status === 'exception_flagged'
      ) {
        continue
      }
      const totalCents = Math.max(0, safeInt(bill.total_cents))
      if (totalCents <= 0) continue
      const daysUntilDue = diffDaysIsoUtc(asOfDate, bill.due_date)
      if (daysUntilDue <= horizonDays) {
        scheduledOutflowCents += totalCents
      }
    }

    const expectedInflowCents = overdueArIncludedCents + upcomingArDueCents
    const netCashflowCents = expectedInflowCents - scheduledOutflowCents

    return {
      horizon_days: horizonDays,
      label: `Next ${horizonDays} Days`,
      window_end_date: windowEnd,
      overdue_ar_included_cents: overdueArIncludedCents,
      upcoming_ar_due_cents: upcomingArDueCents,
      expected_inflow_cents: expectedInflowCents,
      scheduled_outflow_cents: scheduledOutflowCents,
      net_cashflow_cents: netCashflowCents,
      projected_ending_cash_cents: startingCashCents + netCashflowCents,
    }
  }

  const earlyPayOpportunities = evaluateEarlyPayVendorDiscounts(params.vendorBills, asOfDate)
  const totalEarlyPaySavingsCents = earlyPayOpportunities
    .filter(item => !item.expired)
    .reduce((sum, item) => sum + item.discount_cents, 0)

  return {
    as_of_date: asOfDate,
    starting_cash_cents: startingCashCents,
    total_open_ar_cents: totalOpenArCents,
    total_open_ap_cents: totalOpenApCents,
    net_working_capital_cents: totalOpenArCents - totalOpenApCents,
    buckets: AGING_BUCKET_ORDER.map(k => bucketMap.get(k)!),
    rows,
    projections: [buildWindow(7), buildWindow(15), buildWindow(30)],
    early_pay_opportunities: earlyPayOpportunities,
    total_early_pay_savings_cents: totalEarlyPaySavingsCents,
  }
}
