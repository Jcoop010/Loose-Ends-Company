import type {
  AutonomousInvoice,
  BookkeepingKpiSummary,
  Cashflow90DayProjection,
  CashflowWindowBucket,
  LedgerEntryRecord,
  VendorBillRecord,
} from './types'

function assertSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer in cents`)
  }
  return value
}

function addDaysIso(baseIso: string, days: number): string {
  const baseMs = Date.parse(`${baseIso.slice(0, 10)}T00:00:00Z`)
  const safeMs = Number.isFinite(baseMs) ? baseMs : Date.now()
  return new Date(safeMs + days * 86_400_000).toISOString().slice(0, 10)
}

function bucketDayDiff(asOfDate: string, dueDate: string): number {
  const startMs = Date.parse(`${asOfDate.slice(0, 10)}T00:00:00Z`)
  const dueMs = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(dueMs)) {
    return 0
  }
  return Math.round((dueMs - startMs) / 86_400_000)
}

export function simulateCashflow90Day(
  currentBalanceCents: number,
  openInvoices: readonly AutonomousInvoice[],
  scheduledBills: readonly VendorBillRecord[],
  options?: {
    asOfDate?: string
    safetyBufferCents?: number
  },
): Cashflow90DayProjection {
  const startingBalance = assertSafeInteger(currentBalanceCents, 'currentBalanceCents')
  const safetyBuffer = assertSafeInteger(
    options?.safetyBufferCents ?? 500000,
    'safetyBufferCents',
  )
  const asOfDate = (options?.asOfDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10)

  const periodInflows: Record<30 | 60 | 90, number> = { 30: 0, 60: 0, 90: 0 }
  const periodOutflows: Record<30 | 60 | 90, number> = { 30: 0, 60: 0, 90: 0 }

  let totalOpenArCents = 0
  let totalScheduledApCents = 0
  let heldDisputedApCents = 0

  for (const inv of openInvoices) {
    if (inv.status === 'paid' || inv.status === 'void') continue
    const total = Number.isSafeInteger(inv.total_cents) ? Math.max(0, inv.total_cents) : 0
    const paid = Number.isSafeInteger(inv.amount_paid_cents)
      ? Math.min(total, Math.max(0, inv.amount_paid_cents))
      : 0
    const remaining = Math.max(0, total - paid)
    if (remaining === 0) continue

    totalOpenArCents += remaining
    const dayDiff = bucketDayDiff(asOfDate, inv.due_date || asOfDate)
    if (dayDiff <= 30) {
      periodInflows[30] += remaining
    } else if (dayDiff <= 60) {
      periodInflows[60] += remaining
    } else if (dayDiff <= 90) {
      periodInflows[90] += remaining
    }
  }

  for (const bill of scheduledBills) {
    const amount = Number.isSafeInteger(bill.total_cents) ? Math.max(0, bill.total_cents) : 0
    if (amount === 0 || bill.match_status === 'paid') continue

    // Disputed / exception-flagged bills stay held until resolved with supplier credit
    if (bill.match_status === 'disputed' || bill.match_status === 'exception_flagged') {
      heldDisputedApCents += amount
      continue
    }

    totalScheduledApCents += amount
    const dayDiff = bucketDayDiff(asOfDate, bill.due_date || asOfDate)
    if (dayDiff <= 30) {
      periodOutflows[30] += amount
    } else if (dayDiff <= 60) {
      periodOutflows[60] += amount
    } else if (dayDiff <= 90) {
      periodOutflows[90] += amount
    }
  }

  const horizons: readonly (30 | 60 | 90)[] = [30, 60, 90]
  let runningBalance = startingBalance
  let cumInflows = 0
  let cumOutflows = 0
  let lowestBalance = startingBalance
  let firstBreachHorizon: 30 | 60 | 90 | null = null

  const builtWindows: CashflowWindowBucket[] = horizons.map(horizon => {
    const pIn = periodInflows[horizon]
    const pOut = periodOutflows[horizon]
    cumInflows += pIn
    cumOutflows += pOut
    runningBalance = runningBalance + pIn - pOut

    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance
    }
    const belowBuffer = runningBalance < safetyBuffer
    if (belowBuffer && firstBreachHorizon === null) {
      firstBreachHorizon = horizon
    }

    return {
      horizon_days: horizon,
      label: `${horizon} Days`,
      window_end_date: addDaysIso(asOfDate, horizon),
      period_inflows_cents: pIn,
      period_outflows_cents: pOut,
      cumulative_inflows_cents: cumInflows,
      cumulative_outflows_cents: cumOutflows,
      ending_balance_cents: runningBalance,
      below_buffer: belowBuffer,
      buffer_shortfall_cents: belowBuffer ? safetyBuffer - runningBalance : 0,
    }
  })

  return {
    as_of_date: asOfDate,
    starting_balance_cents: startingBalance,
    safety_buffer_cents: safetyBuffer,
    total_open_ar_cents: totalOpenArCents,
    total_scheduled_ap_cents: totalScheduledApCents,
    held_disputed_ap_cents: heldDisputedApCents,
    lowest_projected_balance_cents: lowestBalance,
    any_buffer_breach: firstBreachHorizon !== null,
    first_breach_horizon_days: firstBreachHorizon,
    windows: [builtWindows[0], builtWindows[1], builtWindows[2]],
  }
}

export function computeBookkeepingKpis(
  ledgerEntries: readonly LedgerEntryRecord[],
  vendorBills: readonly VendorBillRecord[],
): BookkeepingKpiSummary {
  let revenueCents = 0
  let cogsCents = 0
  let expenseCents = 0

  for (const entry of ledgerEntries) {
    const amt = Number.isSafeInteger(entry.amount_cents) ? Math.abs(entry.amount_cents) : 0
    if (entry.entry_type === 'revenue') {
      revenueCents += amt
    } else if (entry.entry_type === 'cogs') {
      cogsCents += amt
    } else if (entry.entry_type === 'expense') {
      expenseCents += amt
    }
  }

  let totalApDueCents = 0
  let openBillsCount = 0
  let autoMatchedBillsCount = 0
  let autoMatchedBillsCents = 0
  let disputedSavedCents = 0
  let disputedBillsCount = 0

  for (const bill of vendorBills) {
    const total = Number.isSafeInteger(bill.total_cents) ? Math.max(0, bill.total_cents) : 0
    const variance = Number.isSafeInteger(bill.match_variance_cents)
      ? Math.abs(bill.match_variance_cents)
      : 0

    if (bill.match_status === 'matched_clean') {
      autoMatchedBillsCount += 1
      autoMatchedBillsCents += total
    }

    if (bill.match_status === 'disputed' || bill.match_status === 'exception_flagged') {
      disputedBillsCount += 1
      disputedSavedCents += variance > 0 ? variance : total
    }

    if (bill.match_status !== 'paid' && bill.match_status !== 'disputed') {
      totalApDueCents += total
      openBillsCount += 1
    }
  }

  return {
    net_cashflow_cents: revenueCents - cogsCents - expenseCents,
    revenue_cents: revenueCents,
    cogs_cents: cogsCents,
    expense_cents: expenseCents,
    total_ap_due_cents: totalApDueCents,
    open_bills_count: openBillsCount,
    auto_matched_bills_count: autoMatchedBillsCount,
    auto_matched_bills_cents: autoMatchedBillsCents,
    disputed_saved_cents: disputedSavedCents,
    disputed_bills_count: disputedBillsCount,
  }
}
