// Pure Stock Valuation & Availability Engine (Integer Cents Only — Zero Floating-Point Currency)

import type {
  InventoryBalance,
  InventorySkuSnapshot,
  InventoryValuationRow,
  InventoryValuationSummary,
  ReorderDraftProposal,
} from './types'

function toSafeInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.trunc(value)
}

function toSafeNonNegInt(value: number | null | undefined): number {
  return Math.max(0, toSafeInt(value))
}

/**
 * Evaluates exact stock availability, integer-cent valuation, negative stock anomalies,
 * and low-stock reorder triggers across all active SKUs (aggregating per-location balances when provided).
 */
export function evaluateInventoryValuation(
  items: ReadonlyArray<InventorySkuSnapshot>,
  balances?: ReadonlyArray<InventoryBalance>,
): InventoryValuationSummary {
  const balanceAggByItem = new Map<
    string,
    { on_hand_qty: number; reserved_qty: number; incoming_qty: number; count: number }
  >()

  if (balances && balances.length > 0) {
    for (const bal of balances) {
      const current = balanceAggByItem.get(bal.item_id) ?? {
        on_hand_qty: 0,
        reserved_qty: 0,
        incoming_qty: 0,
        count: 0,
      }
      current.on_hand_qty += toSafeInt(bal.on_hand_qty)
      current.reserved_qty += toSafeNonNegInt(bal.reserved_qty)
      current.incoming_qty += toSafeNonNegInt(bal.incoming_qty)
      current.count += 1
      balanceAggByItem.set(bal.item_id, current)
    }
  }

  const rows: InventoryValuationRow[] = []
  let totalOnHand = 0
  let totalAvailable = 0
  let totalValuationCents = 0
  let totalRetailValueCents = 0
  let lowStockCount = 0
  let negativeAnomalyCount = 0

  for (const item of items) {
    if (!item.is_active) continue

    const agg = balanceAggByItem.get(item.id)
    const onHandQty = agg && agg.count > 0 ? agg.on_hand_qty : toSafeInt(item.on_hand_qty)
    const reservedQty = agg && agg.count > 0 ? agg.reserved_qty : toSafeNonNegInt(item.reserved_qty)
    const incomingQty = agg && agg.count > 0 ? agg.incoming_qty : toSafeNonNegInt(item.incoming_qty)
    const availableQty = onHandQty - reservedQty
    const reorderPointQty = toSafeNonNegInt(item.reorder_point_qty)
    const reorderQty = Math.max(1, toSafeNonNegInt(item.reorder_qty))
    const unitCostCents = toSafeNonNegInt(item.unit_cost_cents)
    const unitPriceCents = toSafeNonNegInt(item.unit_price_cents)

    const valuationCents = onHandQty * unitCostCents
    const retailValueCents = onHandQty * unitPriceCents

    const isNegativeAnomaly = onHandQty < 0 || reservedQty > onHandQty
    const isLowStock = availableQty + incomingQty <= reorderPointQty

    const deficit = Math.max(0, reorderPointQty - (availableQty + incomingQty))
    const suggestedReorderQty = isLowStock ? Math.max(reorderQty, deficit + reorderQty) : 0

    if (isLowStock) lowStockCount += 1
    if (isNegativeAnomaly) negativeAnomalyCount += 1

    totalOnHand += onHandQty
    totalAvailable += availableQty
    totalValuationCents += valuationCents
    totalRetailValueCents += retailValueCents

    rows.push({
      item_id: item.id,
      sku: item.sku.trim().toUpperCase(),
      name: item.name.trim(),
      barcode: item.barcode ?? null,
      category: item.category ?? null,
      preferred_vendor_name: item.preferred_vendor_name?.trim() || 'Preferred Vendor',
      on_hand_qty: onHandQty,
      reserved_qty: reservedQty,
      incoming_qty: incomingQty,
      available_qty: availableQty,
      reorder_point_qty: reorderPointQty,
      reorder_qty: reorderQty,
      unit_cost_cents: unitCostCents,
      unit_price_cents: unitPriceCents,
      valuation_cents: valuationCents,
      retail_value_cents: retailValueCents,
      is_low_stock: isLowStock,
      is_negative_anomaly: isNegativeAnomaly,
      suggested_reorder_qty: suggestedReorderQty,
    })
  }

  return {
    rows,
    total_skus: rows.length,
    total_on_hand_units: totalOnHand,
    total_available_units: totalAvailable,
    total_valuation_cents: totalValuationCents,
    total_retail_value_cents: totalRetailValueCents,
    low_stock_count: lowStockCount,
    negative_anomaly_count: negativeAnomalyCount,
  }
}

/**
 * Generates human-in-the-loop draft PO proposals for every SKU where
 * available_qty + incoming_qty <= reorder_point_qty.
 */
export function generateReorderDraftProposals(
  summary: InventoryValuationSummary,
): ReorderDraftProposal[] {
  const proposals: ReorderDraftProposal[] = []

  for (const row of summary.rows) {
    if (!row.is_low_stock || row.suggested_reorder_qty <= 0) continue

    const estimatedTotalCents = row.suggested_reorder_qty * row.unit_cost_cents
    proposals.push({
      item_id: row.item_id,
      sku: row.sku,
      name: row.name,
      vendor_name: row.preferred_vendor_name,
      available_qty: row.available_qty,
      incoming_qty: row.incoming_qty,
      reorder_point_qty: row.reorder_point_qty,
      suggested_qty: row.suggested_reorder_qty,
      unit_cost_cents: row.unit_cost_cents,
      estimated_total_cents: estimatedTotalCents,
      reason: `Available (${row.available_qty}) + Incoming (${row.incoming_qty}) <= Reorder Point (${row.reorder_point_qty})`,
    })
  }

  return proposals
}
