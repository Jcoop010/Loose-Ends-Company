import { computeArSummary, formatCents } from './engine'
import { simulateCashflow90Day } from './bookkeepingEngine'
import type {
  AutonomousInvoice,
  AutonomousQuote,
  BusinessPortabilityBundle,
  CollectionTouchRecord,
  ComplianceVaultItem,
  ExecutableSopRecord,
  LedgerEntryRecord,
  LivingSopRecord,
  MorningBriefApprovalItem,
  OwnerMorningBrief,
  VendorBillRecord,
  VendorFraudAlertRecord,
} from './types'

function isoMinusDays(dateIso: string, days: number): string {
  const ms = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(ms)) return dateIso.slice(0, 10)
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Pure, deterministic 60-Second Owner Morning Brief synthesizer in exact integer cents:
 * live Cash Position, Collected Yesterday, 1-Click Approval items (fraud freezes + 4A collections),
 * and 90-Day Runway status.
 */
export function compileOwnerMorningBrief(params: {
  workspaceName: string
  ledgerEntries: readonly LedgerEntryRecord[]
  invoices: readonly AutonomousInvoice[]
  vendorBills: readonly VendorBillRecord[]
  fraudAlerts: readonly VendorFraudAlertRecord[]
  collectionTouches: readonly CollectionTouchRecord[]
  startingCashCents?: number
  safetyBufferCents?: number
  asOfDate?: string
}): OwnerMorningBrief {
  const asOfDate =
    params.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)
      ? params.asOfDate
      : new Date().toISOString().slice(0, 10)
  const yesterdayIso = isoMinusDays(asOfDate, 1)
  const safetyBufferCents = Math.max(0, Math.trunc(params.safetyBufferCents ?? 500000))
  const openingCashCents = Math.max(0, Math.trunc(params.startingCashCents ?? 2500000))

  let netLedgerDeltaCents = 0
  let collectedYesterdayCents = 0
  const countedYesterdayInvRefs = new Set<string>()

  for (const entry of params.ledgerEntries) {
    const amt = Math.abs(Math.trunc(entry.amount_cents || 0))
    if (entry.entry_type === 'revenue') {
      netLedgerDeltaCents += amt
      const occ = (entry.occurred_on || '').slice(0, 10)
      if (occ === yesterdayIso || occ === asOfDate) {
        collectedYesterdayCents += amt
        if (entry.source_ref) {
          countedYesterdayInvRefs.add(entry.source_ref.trim().toLowerCase())
        }
      }
    } else if (entry.entry_type === 'cogs' || entry.entry_type === 'expense') {
      netLedgerDeltaCents -= amt
    }
  }

  for (const inv of params.invoices) {
    if (inv.status !== 'paid') continue
    const refKey = inv.invoice_number.trim().toLowerCase()
    if (countedYesterdayInvRefs.has(refKey)) continue
    const paidDate = (inv.updated_at || inv.created_at || '').slice(0, 10)
    if (paidDate === yesterdayIso || paidDate === asOfDate) {
      collectedYesterdayCents += Math.max(0, Math.trunc(inv.total_cents))
    }
  }

  const cashPositionCents = openingCashCents + netLedgerDeltaCents
  const arSummary = computeArSummary(params.invoices, asOfDate)
  const cashProjection = simulateCashflow90Day(
    cashPositionCents,
    params.invoices,
    params.vendorBills,
    { asOfDate, safetyBufferCents },
  )

  const approvalItems: MorningBriefApprovalItem[] = []
  const frozenAlerts = params.fraudAlerts.filter(a => a.status === 'frozen')
  for (const alert of frozenAlerts) {
    approvalItems.push({
      id: alert.id,
      kind: 'vendor_fraud_freeze',
      title: `Frozen Bill Guard: ${alert.vendor_name}`,
      subtitle: alert.proof_summary,
      amount_cents: alert.variance_cents,
      route: '/dashboard/bookkeeping',
      cta_label: 'Inspect Fraud Shield',
    })
  }

  const stagedCollections = params.collectionTouches.filter(t => t.status === 'staged')
  for (const touch of stagedCollections) {
    approvalItems.push({
      id: touch.id,
      kind: 'staged_collection',
      title: `Collection Touch (${touch.stage})`,
      subtitle: touch.proof_summary,
      amount_cents: touch.amount_due_cents,
      route: '/dashboard/invoices',
      cta_label: 'Review AR Cadence',
    })
  }

  const pendingApprovalTotalCents = approvalItems.reduce((s, i) => s + i.amount_cents, 0)
  const runwayStatus: OwnerMorningBrief['runway_status'] = cashProjection.any_buffer_breach
    ? 'buffer_breach'
    : 'healthy'

  return {
    workspace_name: params.workspaceName.trim() || 'Workspace',
    as_of_date: asOfDate,
    cash_position_cents: cashPositionCents,
    collected_yesterday_cents: collectedYesterdayCents,
    open_ar_cents: arSummary.openArCents,
    pending_approval_count: approvalItems.length,
    pending_approval_total_cents: pendingApprovalTotalCents,
    frozen_fraud_count: frozenAlerts.length,
    staged_collection_count: stagedCollections.length,
    runway_90d_lowest_cents: cashProjection.lowest_projected_balance_cents,
    safety_buffer_cents: safetyBufferCents,
    runway_status: runwayStatus,
    approval_items: approvalItems,
    executive_summary:
      `Cash ${formatCents(cashPositionCents)} · Collected 24h ${formatCents(collectedYesterdayCents)} · ` +
      `${approvalItems.length} 1-Click approval item(s) (${formatCents(pendingApprovalTotalCents)}) · ` +
      `90d Runway low ${formatCents(cashProjection.lowest_projected_balance_cents)} (${runwayStatus === 'healthy' ? 'Above Buffer' : 'Buffer Breach'}).`,
  }
}

export function compileFullBusinessPortabilityBundle(params: {
  workspaceName: string
  ledgerEntries?: readonly LedgerEntryRecord[]
  invoices?: readonly AutonomousInvoice[]
  vendorBills?: readonly VendorBillRecord[]
  quotes?: readonly AutonomousQuote[]
  complianceItems?: readonly ComplianceVaultItem[]
  livingSops?: readonly LivingSopRecord[]
  executableSops?: readonly ExecutableSopRecord[]
  vendorFraudAlerts?: readonly VendorFraudAlertRecord[]
  collectionTouches?: readonly CollectionTouchRecord[]
  exportedAtIso?: string
}): BusinessPortabilityBundle {
  const ledger_entries = params.ledgerEntries ?? []
  const invoices = params.invoices ?? []
  const vendor_bills = params.vendorBills ?? []
  const quotes = params.quotes ?? []
  const compliance_vault_items = params.complianceItems ?? []
  const living_sops = params.livingSops ?? []
  const executable_sops = params.executableSops ?? []
  const vendor_fraud_alerts = params.vendorFraudAlerts ?? []
  const collection_touches = params.collectionTouches ?? []

  return {
    exported_at: params.exportedAtIso ?? new Date().toISOString(),
    workspace_name: params.workspaceName.trim() || 'Workspace',
    record_counts: {
      ledger_entries: ledger_entries.length,
      invoices: invoices.length,
      vendor_bills: vendor_bills.length,
      quotes: quotes.length,
      compliance_vault_items: compliance_vault_items.length,
      living_sops: living_sops.length,
      executable_sops: executable_sops.length,
      vendor_fraud_alerts: vendor_fraud_alerts.length,
      collection_touches: collection_touches.length,
    },
    ledger_entries,
    invoices,
    vendor_bills,
    quotes,
    compliance_vault_items,
    living_sops,
    executable_sops,
    vendor_fraud_alerts,
    collection_touches,
  }
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function serializePortabilityBundleToCsv(bundle: BusinessPortabilityBundle): string {
  const rows: string[] = [
    ['Table', 'ID', 'Reference / Name', 'Status / Type', 'Amount (Cents)', 'Date'].map(csvCell).join(','),
  ]

  for (const le of bundle.ledger_entries) {
    rows.push(['ledger_entries', le.id, le.description, le.entry_type, le.amount_cents, le.occurred_on].map(csvCell).join(','))
  }
  for (const inv of bundle.invoices) {
    rows.push(['invoices', inv.id, `${inv.invoice_number} · ${inv.customer_name}`, inv.status, inv.total_cents, inv.due_date].map(csvCell).join(','))
  }
  for (const bill of bundle.vendor_bills) {
    rows.push(['vendor_bills', bill.id, `${bill.invoice_number} · ${bill.vendor_name}`, bill.match_status, bill.total_cents, bill.due_date].map(csvCell).join(','))
  }
  for (const sop of bundle.executable_sops) {
    rows.push(['executable_sops', sop.id, sop.name, sop.status, sop.safety_cap_cents, sop.created_at ?? ''].map(csvCell).join(','))
  }
  for (const alert of bundle.vendor_fraud_alerts) {
    rows.push(['vendor_fraud_alerts', alert.id, alert.vendor_name, `${alert.alert_type}:${alert.status}`, alert.variance_cents, alert.created_at ?? ''].map(csvCell).join(','))
  }
  for (const touch of bundle.collection_touches) {
    rows.push(['collection_touches', touch.id, touch.invoice_id, `${touch.stage}:${touch.status}`, touch.amount_due_cents, touch.created_at ?? ''].map(csvCell).join(','))
  }

  return rows.join('\n')
}

export function serializePortabilityBundleToJson(bundle: BusinessPortabilityBundle): string {
  return JSON.stringify(bundle, null, 2)
}
