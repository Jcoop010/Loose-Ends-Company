// Pure 3-Way Inventory-to-Financial Reconciliation Engine
// Cross-checks Physical Count vs. Book Balance + PO / GRN / Vendor Bill ledgers
// and produces integer-cent variance reports and Fraud Shield alert payloads.

import type {
  DiscrepancySeverity,
  InventoryDiscrepancyFlag,
  InventoryFraudShieldPayload,
  ReconciliationReport,
  ThreeWayInventoryInput,
} from './types'

const DEFAULT_COST_DRIFT_TOLERANCE_BPS = 200 // 2.00%

export function computeVarianceBps(expected: number, actual: number): number {
  const delta = actual - expected
  if (delta === 0) return 0
  if (expected === 0) return delta > 0 ? 10000 : -10000
  return Math.round((delta * 10000) / Math.abs(expected))
}

function classifyExposureSeverity(absCents: number): DiscrepancySeverity {
  if (absCents >= 100000) return 'critical' // >= $1,000.00
  if (absCents >= 25000) return 'high' // >= $250.00
  if (absCents >= 5000) return 'medium' // >= $50.00
  return 'low'
}

export function runThreeWayInventoryReconciliation(
  input: ThreeWayInventoryInput,
): ReconciliationReport {
  const costDriftToleranceBps = Math.max(
    0,
    Math.trunc(input.costDriftToleranceBps ?? DEFAULT_COST_DRIFT_TOLERANCE_BPS),
  )

  const discrepancies: InventoryDiscrepancyFlag[] = []
  const fraudShieldAlerts: InventoryFraudShieldPayload[] = []

  let totalVarianceQty = 0
  let totalVarianceCents = 0
  let totalExposureCents = 0
  let phantomCount = 0
  let unbilledReceiptCount = 0
  let negativeStockCount = 0
  let costDriftCount = 0
  let shrinkageCount = 0

  const rowBySku = new Map(input.valuationRows.map(r => [r.sku.toUpperCase(), r]))

  // 1. Negative Stock & Over-Reserved Anomalies
  for (const row of input.valuationRows) {
    if (row.on_hand_qty < 0 || row.reserved_qty > row.on_hand_qty) {
      negativeStockCount += 1
      const shortfall = row.on_hand_qty < 0 ? Math.abs(row.on_hand_qty) : row.reserved_qty - row.on_hand_qty
      const exposureCents = shortfall * row.unit_cost_cents
      totalExposureCents += exposureCents
      const severity: DiscrepancySeverity =
        row.on_hand_qty < 0 ? 'high' : classifyExposureSeverity(exposureCents)

      discrepancies.push({
        id: `neg:${row.sku}`,
        code: 'negative_stock_anomaly',
        severity,
        sku: row.sku,
        item_name: row.name,
        reference_number: null,
        expected_qty: row.reserved_qty,
        actual_qty: row.on_hand_qty,
        variance_qty: row.on_hand_qty - row.reserved_qty,
        variance_bps: computeVarianceBps(row.reserved_qty || 1, row.on_hand_qty),
        variance_cents: -exposureCents,
        summary: `Negative/over-reserved stock on ${row.sku}: on-hand ${row.on_hand_qty}, reserved ${row.reserved_qty}.`,
        recommended_action: 'Run an immediate spot cycle count and post an approved audit adjustment.',
      })
    }
  }

  // 2. Physical Count vs. Book Balance (Shrinkage & Phantom Inventory)
  for (const count of input.physicalCounts ?? []) {
    const sku = count.sku.trim().toUpperCase()
    const varianceQty = Math.trunc(count.counted_qty) - Math.trunc(count.book_qty)
    if (varianceQty === 0) continue

    const unitCostCents = Math.max(0, Math.trunc(count.unit_cost_cents))
    const varianceCents = varianceQty * unitCostCents
    const absCents = Math.abs(varianceCents)
    const varianceBps = computeVarianceBps(count.book_qty, count.counted_qty)

    totalVarianceQty += varianceQty
    totalVarianceCents += varianceCents
    totalExposureCents += absCents

    const isPhantom =
      varianceQty < 0 &&
      (count.counted_qty === 0 || Math.abs(varianceBps) >= 1500) // >= 15% book-to-physical drop or zero on shelf

    const code = isPhantom ? 'phantom_inventory' : 'physical_shrinkage'
    if (isPhantom) {
      phantomCount += 1
    } else {
      shrinkageCount += 1
    }

    const severity = classifyExposureSeverity(absCents)

    discrepancies.push({
      id: `phys:${sku}`,
      code,
      severity,
      sku,
      item_name: count.item_name,
      reference_number: null,
      expected_qty: count.book_qty,
      actual_qty: count.counted_qty,
      variance_qty: varianceQty,
      variance_bps: varianceBps,
      variance_cents: varianceCents,
      summary: isPhantom
        ? `Phantom Inventory on ${sku}: book shows ${count.book_qty}, physical count found ${count.counted_qty} (${varianceQty} units).`
        : `Physical count variance on ${sku}: book ${count.book_qty} vs counted ${count.counted_qty} (${varianceQty > 0 ? '+' : ''}${varianceQty} units).`,
      recommended_action: 'Review variance lines and tap Approve & Reconcile Audit to post atomic adjustment.',
    })

    if (severity === 'high' || severity === 'critical' || isPhantom) {
      fraudShieldAlerts.push({
        alert_type: isPhantom ? 'phantom_inventory' : 'inventory_variance',
        severity,
        sku,
        exposure_cents: absCents,
        headline: isPhantom
          ? `Phantom Inventory Flagged: ${sku} (${varianceQty} units)`
          : `Material Inventory Variance: ${sku} (${varianceQty} units)`,
        detail: `Book balance ${count.book_qty} vs physical count ${count.counted_qty} at ${unitCostCents} cents/unit.`,
      })
    }
  }

  // 3. PO vs. GRN vs. Vendor Bill Cross-Checks (Unbilled Receipts & Unit Cost Drift)
  const poBySku = new Map<string, { po_number: string; vendor_name: string; ordered_qty: number; unit_cost_cents: number }>()
  for (const po of input.poLines ?? []) {
    poBySku.set(po.sku.trim().toUpperCase(), {
      po_number: po.po_number,
      vendor_name: po.vendor_name,
      ordered_qty: Math.trunc(po.ordered_qty),
      unit_cost_cents: Math.max(0, Math.trunc(po.unit_cost_cents)),
    })
  }

  const billedQtyBySku = new Map<string, number>()
  for (const bill of input.vendorBillLines ?? []) {
    const sku = bill.sku.trim().toUpperCase()
    billedQtyBySku.set(sku, (billedQtyBySku.get(sku) ?? 0) + Math.trunc(bill.billed_qty))

    const poRef = poBySku.get(sku)
    const catalogRow = rowBySku.get(sku)
    const baselineCostCents = poRef?.unit_cost_cents ?? catalogRow?.unit_cost_cents ?? 0

    if (baselineCostCents > 0) {
      const driftBps = computeVarianceBps(baselineCostCents, bill.unit_cost_cents)
      if (driftBps > costDriftToleranceBps) {
        costDriftCount += 1
        const overchargePerUnitCents = bill.unit_cost_cents - baselineCostCents
        const exposureCents = overchargePerUnitCents * Math.max(1, Math.trunc(bill.billed_qty))
        totalExposureCents += exposureCents
        const severity = classifyExposureSeverity(exposureCents)

        discrepancies.push({
          id: `drift:${bill.invoice_number}:${sku}`,
          code: 'unit_cost_drift',
          severity,
          sku,
          item_name: catalogRow?.name ?? sku,
          reference_number: bill.invoice_number,
          expected_qty: Math.trunc(bill.billed_qty),
          actual_qty: Math.trunc(bill.billed_qty),
          variance_qty: 0,
          variance_bps: driftBps,
          variance_cents: -exposureCents,
          summary: `Unit Cost Drift on ${sku} (${bill.invoice_number}): billed ${bill.unit_cost_cents}¢ vs baseline ${baselineCostCents}¢ (+${(driftBps / 100).toFixed(2)}%).`,
          recommended_action: 'Hold vendor bill in AP dispute queue and verify price sheet with vendor.',
        })

        fraudShieldAlerts.push({
          alert_type: 'unit_cost_drift',
          severity,
          sku,
          exposure_cents: exposureCents,
          headline: `Unit Cost Drift (+${(driftBps / 100).toFixed(2)}%) on ${sku}`,
          detail: `Vendor ${bill.vendor_name} bill ${bill.invoice_number} charged ${bill.unit_cost_cents}¢ vs expected ${baselineCostCents}¢ across ${bill.billed_qty} units.`,
        })
      }
    }
  }

  // Unbilled Receipts: GRN received stock into warehouse with no matching vendor bill quantity
  const receivedQtyBySku = new Map<string, { qty: number; unitCostCents: number; receiptNumber: string }>()
  for (const grn of input.grnLines ?? []) {
    const sku = grn.sku.trim().toUpperCase()
    const existing = receivedQtyBySku.get(sku)
    receivedQtyBySku.set(sku, {
      qty: (existing?.qty ?? 0) + Math.trunc(grn.received_qty),
      unitCostCents: Math.max(0, Math.trunc(grn.unit_cost_cents)),
      receiptNumber: grn.receipt_number,
    })
  }

  for (const [sku, grnInfo] of receivedQtyBySku.entries()) {
    const billedQty = billedQtyBySku.get(sku) ?? 0
    if (grnInfo.qty > billedQty) {
      unbilledReceiptCount += 1
      const unbilledQty = grnInfo.qty - billedQty
      const catalogRow = rowBySku.get(sku)
      const unitCostCents = grnInfo.unitCostCents || catalogRow?.unit_cost_cents || 0
      const accrualExposureCents = unbilledQty * unitCostCents
      totalExposureCents += accrualExposureCents
      const severity = classifyExposureSeverity(accrualExposureCents)

      discrepancies.push({
        id: `unbilled:${grnInfo.receiptNumber}:${sku}`,
        code: 'unbilled_receipt',
        severity,
        sku,
        item_name: catalogRow?.name ?? sku,
        reference_number: grnInfo.receiptNumber,
        expected_qty: grnInfo.qty,
        actual_qty: billedQty,
        variance_qty: -unbilledQty,
        variance_bps: computeVarianceBps(grnInfo.qty, billedQty),
        variance_cents: accrualExposureCents,
        summary: `Unbilled Receipt on ${sku} (${grnInfo.receiptNumber}): ${unbilledQty} received unit(s) awaiting vendor invoice.`,
        recommended_action: 'Record AP accrual and match incoming vendor bill when received.',
      })

      if (accrualExposureCents >= 25000) {
        fraudShieldAlerts.push({
          alert_type: 'unbilled_receipt',
          severity,
          sku,
          exposure_cents: accrualExposureCents,
          headline: `Unbilled Receipt Accrual: ${sku} (${unbilledQty} units)`,
          detail: `GRN ${grnInfo.receiptNumber} received ${grnInfo.qty} units, only ${billedQty} billed to date.`,
        })
      }
    }
  }

  return {
    discrepancies,
    fraud_shield_alerts: fraudShieldAlerts,
    total_variance_qty: totalVarianceQty,
    total_variance_cents: totalVarianceCents,
    total_exposure_cents: totalExposureCents,
    phantom_count: phantomCount,
    unbilled_receipt_count: unbilledReceiptCount,
    negative_stock_count: negativeStockCount,
    cost_drift_count: costDriftCount,
    shrinkage_count: shrinkageCount,
    is_clean: discrepancies.length === 0,
  }
}
