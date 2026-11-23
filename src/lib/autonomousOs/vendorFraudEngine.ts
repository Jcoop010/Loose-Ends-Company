import { formatCents } from './engine'
import type {
  AgentActionLedgerEntry,
  VendorBillFraudInput,
  VendorFraudAlertRecord,
  VendorFraudAlertStatus,
  VendorFraudAlertType,
  VendorFraudScanResult,
} from './types'

export const FRAUD_ALERT_TYPE_LABELS: Readonly<Record<VendorFraudAlertType, string>> = {
  price_spike_over_10pct: 'Unit Price Spike >10%',
  duplicate_cent_amount: 'Duplicate Cent Bill (<=7d)',
  remit_change: 'Remit / Bank Info Changed',
}

export const FRAUD_ALERT_STATUS_LABELS: Readonly<Record<VendorFraudAlertStatus, string>> = {
  frozen: 'Frozen (Held from AP)',
  approved_override: 'Owner Override Approved',
  dismissed: 'Dismissed (Safe)',
}

function normalizeVendorKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function diffUtcDays(laterIso: string, earlierIso: string): number {
  const a = Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.abs(Math.round((a - b) / 86_400_000))
}

/**
 * Pure deterministic Vendor Fraud Shield in exact integer cents:
 * auto-freezes bills with >10% unit price hikes vs baseline/POs, exact-cent duplicates within 7d,
 * or changed remit/bank destinations. Never mutates input rows.
 */
export function scanVendorBillsForFraud(params: {
  workspaceId: string
  bills: readonly VendorBillFraudInput[]
  priorUnitCostsBySku?: ReadonlyMap<string, number> | Readonly<Record<string, number>>
  knownRemitByVendor?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  asOfDate?: string
}): VendorFraudScanResult {
  const asOfDate =
    params.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)
      ? params.asOfDate
      : new Date().toISOString().slice(0, 10)
  const alerts: VendorFraudAlertRecord[] = []
  const alertedBillReasons = new Set<string>()

  const getPriorSkuCost = (sku: string): number | null => {
    if (!params.priorUnitCostsBySku) return null
    const clean = sku.trim().toUpperCase()
    if (params.priorUnitCostsBySku instanceof Map) {
      return params.priorUnitCostsBySku.get(clean) ?? null
    }
    const rec = params.priorUnitCostsBySku as Record<string, number>
    return typeof rec[clean] === 'number' ? rec[clean] : null
  }

  const getKnownRemit = (vendorKey: string): string | null => {
    if (!params.knownRemitByVendor) return null
    if (params.knownRemitByVendor instanceof Map) {
      return params.knownRemitByVendor.get(vendorKey) ?? null
    }
    const rec = params.knownRemitByVendor as Record<string, string>
    return typeof rec[vendorKey] === 'string' ? rec[vendorKey] : null
  }

  // Track historical line unit costs from bills in ascending date order if no PO map passed
  const orderedBills = [...params.bills].sort((a, b) =>
    (a.created_at || a.due_date || '').localeCompare(b.created_at || b.due_date || ''),
  )
  const observedSkuBaseline = new Map<string, number>()

  for (const bill of orderedBills) {
    const vKey = normalizeVendorKey(bill.vendor_name)
    const billDate = (bill.created_at || bill.due_date || asOfDate).slice(0, 10)

    // 1. Unit Price Spike > 10% vs prior PO or prior bill baseline
    let maxSpikeVarianceCents = 0
    let spikeDetail = ''

    for (const item of bill.items_json ?? []) {
      const skuKey = item.sku.trim().toUpperCase()
      const baseline = getPriorSkuCost(skuKey) ?? observedSkuBaseline.get(skuKey) ?? null
      const billedUnit = Math.max(0, Math.trunc(item.unit_cost_cents))
      const qty = Math.max(1, Math.trunc(item.quantity || 1))
      if (baseline !== null && baseline > 0 && billedUnit > baseline) {
        const unitDelta = billedUnit - baseline
        if (unitDelta * 100 > baseline * 10) {
          const lineVariance = unitDelta * qty
          maxSpikeVarianceCents += lineVariance
          const pct = ((unitDelta * 100) / baseline).toFixed(1)
          spikeDetail =
            `${item.sku} billed ${formatCents(billedUnit)} vs baseline ${formatCents(baseline)} (+${pct}% on ${qty} unit(s))`
        }
      }
      if (baseline === null && billedUnit > 0) {
        observedSkuBaseline.set(skuKey, billedUnit)
      }
    }

    if (maxSpikeVarianceCents === 0 && bill.match_variance_cents > 0) {
      const totalCents = Math.max(0, Math.trunc(bill.total_cents))
      const varianceCents = Math.max(0, Math.trunc(bill.match_variance_cents))
      const impliedBaseline = Math.max(1, totalCents - varianceCents)
      if (varianceCents * 100 > impliedBaseline * 10) {
        maxSpikeVarianceCents = varianceCents
        const pct = ((varianceCents * 100) / impliedBaseline).toFixed(1)
        spikeDetail = `${bill.invoice_number} total ${formatCents(totalCents)} jumped +${pct}% above ${formatCents(impliedBaseline)} PO baseline`
      }
    }

    if (maxSpikeVarianceCents > 0) {
      const key = `${bill.id}::price_spike_over_10pct`
      alertedBillReasons.add(key)
      alerts.push({
        id: `vfa_spike_${bill.id}`,
        workspace_id: params.workspaceId,
        bill_id: bill.id,
        vendor_name: bill.vendor_name,
        alert_type: 'price_spike_over_10pct',
        variance_cents: maxSpikeVarianceCents,
        proof_summary:
          `Auto-frozen ${bill.invoice_number} (${bill.vendor_name}): ${spikeDetail}; ` +
          `price spike overcharge = ${formatCents(maxSpikeVarianceCents)} (${maxSpikeVarianceCents.toLocaleString('en-US')} cents).`,
        status: 'frozen',
      })
    }

    // 2. Remit / Bank Change detection
    const billRemit =
      typeof bill.remit_account_hint === 'string' && bill.remit_account_hint.trim()
        ? bill.remit_account_hint.trim()
        : null
    const expectedRemit = vKey ? getKnownRemit(vKey) : null
    if (billRemit && expectedRemit && billRemit.toLowerCase() !== expectedRemit.toLowerCase()) {
      const amt = Math.max(0, Math.trunc(bill.total_cents))
      alerts.push({
        id: `vfa_remit_${bill.id}`,
        workspace_id: params.workspaceId,
        bill_id: bill.id,
        vendor_name: bill.vendor_name,
        alert_type: 'remit_change',
        variance_cents: amt,
        proof_summary:
          `Auto-frozen ${bill.invoice_number} (${bill.vendor_name}): remit account changed from "${expectedRemit}" to "${billRemit}"; ` +
          `holding ${formatCents(amt)} (${amt.toLocaleString('en-US')} cents) pending out-of-band callback verification.`,
        status: 'frozen',
      })
    } else if (!billRemit && /remit|bank\s*(?:change|updated)|routing\s*changed/i.test(bill.discrepancy_summary ?? '')) {
      const amt = Math.max(0, Math.trunc(bill.total_cents))
      alerts.push({
        id: `vfa_remit_${bill.id}`,
        workspace_id: params.workspaceId,
        bill_id: bill.id,
        vendor_name: bill.vendor_name,
        alert_type: 'remit_change',
        variance_cents: amt,
        proof_summary:
          `Auto-frozen ${bill.invoice_number} (${bill.vendor_name}): remit/bank change flagged ("${bill.discrepancy_summary}"); ` +
          `holding ${formatCents(amt)} (${amt.toLocaleString('en-US')} cents).`,
        status: 'frozen',
      })
    }

    void billDate
  }

  // 3. Duplicate Exact Cent Amount within 7 days for the same vendor
  const billsByVendorAndCents = new Map<string, VendorBillFraudInput[]>()
  for (const bill of orderedBills) {
    const vKey = normalizeVendorKey(bill.vendor_name)
    const cents = Math.max(0, Math.trunc(bill.total_cents))
    if (!vKey || cents <= 0) continue
    const mapKey = `${vKey}::${cents}`
    const list = billsByVendorAndCents.get(mapKey)
    if (list) list.push(bill)
    else billsByVendorAndCents.set(mapKey, [bill])
  }

  for (const group of billsByVendorAndCents.values()) {
    if (group.length < 2) continue
    const anchor = group[0]
    const anchorDate = (anchor.created_at || anchor.due_date || asOfDate).slice(0, 10)
    for (let idx = 1; idx < group.length; idx += 1) {
      const dup = group[idx]
      const dupDate = (dup.created_at || dup.due_date || asOfDate).slice(0, 10)
      const daysApart = diffUtcDays(dupDate, anchorDate)
      if (daysApart > 7) continue

      const key = `${dup.id}::duplicate_cent_amount`
      if (alertedBillReasons.has(key)) continue
      alertedBillReasons.add(key)

      const cents = Math.max(0, Math.trunc(dup.total_cents))
      alerts.push({
        id: `vfa_dup_${dup.id}`,
        workspace_id: params.workspaceId,
        bill_id: dup.id,
        vendor_name: dup.vendor_name,
        alert_type: 'duplicate_cent_amount',
        variance_cents: cents,
        proof_summary:
          `Auto-frozen duplicate bill ${dup.invoice_number} (${dupDate}) matching ${anchor.invoice_number} (${anchorDate}) for ${dup.vendor_name} within ${daysApart}d: ` +
          `${formatCents(cents)} (${cents.toLocaleString('en-US')} cents).`,
        status: 'frozen',
      })
    }
  }

  const countsByType: Record<VendorFraudAlertType, number> = {
    price_spike_over_10pct: 0,
    duplicate_cent_amount: 0,
    remit_change: 0,
  }
  let totalFrozenCents = 0
  for (const alert of alerts) {
    countsByType[alert.alert_type] += 1
    if (alert.status === 'frozen') {
      totalFrozenCents += alert.variance_cents
    }
  }

  alerts.sort((a, b) => b.variance_cents - a.variance_cents)

  return {
    as_of_date: asOfDate,
    scanned_bill_count: params.bills.length,
    frozen_count: alerts.length,
    total_frozen_cents: totalFrozenCents,
    counts_by_type: countsByType,
    alerts,
  }
}

export function buildFraudOverridePlan(params: {
  workspaceId: string
  alert: VendorFraudAlertRecord
  nextStatus: 'approved_override' | 'dismissed'
  nowIso?: string
}): {
  updatedAlert: VendorFraudAlertRecord
  ledgerDraft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
} {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const updatedAlert: VendorFraudAlertRecord = {
    ...params.alert,
    status: params.nextStatus,
    updated_at: nowIso,
  }

  const label =
    params.nextStatus === 'approved_override' ? 'Approved override on' : 'Dismissed'

  return {
    updatedAlert,
    ledgerDraft: {
      workspace_id: params.workspaceId,
      agent_name: 'Vendor Fraud Shield',
      module: 'bookkeeping',
      action_type: 'override_vendor_fraud_alert',
      autonomy_mode: 'approve_1tap',
      summary: `${label} ${FRAUD_ALERT_TYPE_LABELS[params.alert.alert_type]} alert for ${params.alert.vendor_name} (${formatCents(params.alert.variance_cents)})`,
      impact_cents: params.alert.variance_cents,
      before_state: {
        alert_id: params.alert.id,
        bill_id: params.alert.bill_id,
        alert_status: params.alert.status,
      },
      after_state: {
        alert_id: params.alert.id,
        bill_id: params.alert.bill_id,
        alert_status: params.nextStatus,
      },
      status: 'executed',
      reversed_at: null,
    },
  }
}
