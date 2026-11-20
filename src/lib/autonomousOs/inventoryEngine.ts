import { evaluateAutonomyGate, formatCents } from './engine'
import {
  DEFAULT_AUTONOMY_CONFIG,
  type AutoPoDraftProposal,
  type AutoPoLineProposal,
  type GoodsReceiptLineItem,
  type PurchaseOrderItemRecord,
  type PurchaseOrderStatus,
  type Release2InventoryItem,
  type StockEvaluationItem,
  type StockEvaluationResult,
  type ThreeWayMatchException,
  type ThreeWayMatchLineComparison,
  type ThreeWayMatchResult,
  type VendorBillLineItem,
  type VendorDisputeDraft,
  type WorkspaceAutonomyConfig,
} from './types'

function assertSafeNonNegativeInt(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`)
  }
  return value
}

function assertSafePositiveInt(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive safe integer`)
  }
  return value
}

function normalizeSku(rawSku: string): string {
  return rawSku.trim().toUpperCase()
}

function addDaysIso(baseDateIso: string, days: number): string {
  const parsed = Date.parse(`${baseDateIso.slice(0, 10)}T00:00:00Z`)
  const originMs = Number.isFinite(parsed) ? parsed : Date.now()
  return new Date(originMs + Math.max(0, days) * 86_400_000).toISOString().slice(0, 10)
}

export function evaluateStockLevels(
  items: readonly Release2InventoryItem[],
  config: WorkspaceAutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
  options?: {
    workspaceId?: string
    todayIso?: string
    poPrefix?: string
  },
): StockEvaluationResult {
  const todayIso = (options?.todayIso ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
  const poPrefix = (options?.poPrefix ?? todayIso.replace(/-/g, '').slice(2, 8)).toUpperCase()

  const evaluatedItems: StockEvaluationItem[] = []
  const lowStockItems: StockEvaluationItem[] = []
  const byVendor = new Map<string, StockEvaluationItem[]>()

  for (const item of items) {
    if (item.archived) continue

    const onHand = assertSafeNonNegativeInt(item.on_hand_qty, `${item.sku}.on_hand_qty`)
    const reserved = assertSafeNonNegativeInt(item.reserved_qty, `${item.sku}.reserved_qty`)
    const reorderPoint = assertSafeNonNegativeInt(
      item.reorder_point_qty,
      `${item.sku}.reorder_point_qty`,
    )
    const reorderQty = assertSafePositiveInt(item.reorder_qty, `${item.sku}.reorder_qty`)
    const unitCostCents = assertSafeNonNegativeInt(
      item.unit_cost_cents,
      `${item.sku}.unit_cost_cents`,
    )
    const leadTimeDays = assertSafeNonNegativeInt(
      item.lead_time_days,
      `${item.sku}.lead_time_days`,
    )

    const availableQty = onHand - reserved
    const isLowStock = availableQty <= reorderPoint
    const shortfallQty = isLowStock ? Math.max(1, reorderPoint - availableQty + reorderQty) : 0
    const vendorName = item.preferred_vendor?.trim() || 'Unassigned Supplier'

    const evaluated: StockEvaluationItem = {
      item_id: item.id,
      sku: item.sku,
      name: item.name,
      location: item.location,
      bin_code: item.bin_code,
      preferred_vendor: vendorName,
      on_hand_qty: onHand,
      reserved_qty: reserved,
      available_qty: availableQty,
      reorder_point_qty: reorderPoint,
      reorder_qty: reorderQty,
      unit_cost_cents: unitCostCents,
      lead_time_days: leadTimeDays,
      is_low_stock: isLowStock,
      shortfall_qty: shortfallQty,
    }

    evaluatedItems.push(evaluated)
    if (isLowStock) {
      lowStockItems.push(evaluated)
      const list = byVendor.get(vendorName)
      if (list) {
        list.push(evaluated)
      } else {
        byVendor.set(vendorName, [evaluated])
      }
    }
  }

  const autoPoDrafts: AutoPoDraftProposal[] = []
  let vendorSeq = 1
  let totalReorderCostCents = 0
  const fallbackWorkspaceId = options?.workspaceId ?? items[0]?.workspace_id ?? ''

  const sortedVendors = Array.from(byVendor.entries()).sort(([a], [b]) => a.localeCompare(b))
  for (const [vendorName, vendorSkus] of sortedVendors) {
    let poTotalCents = 0
    let maxLeadTimeDays = 0
    const poItems: AutoPoLineProposal[] = []

    const sortedSkus = [...vendorSkus].sort((a, b) => a.sku.localeCompare(b.sku))
    for (const skuRow of sortedSkus) {
      const orderedQty = skuRow.reorder_qty
      const lineTotalCents = assertSafeNonNegativeInt(
        orderedQty * skuRow.unit_cost_cents,
        `${skuRow.sku}.line_total_cents`,
      )
      poTotalCents = assertSafeNonNegativeInt(poTotalCents + lineTotalCents, 'po_total_cents')
      if (skuRow.lead_time_days > maxLeadTimeDays) {
        maxLeadTimeDays = skuRow.lead_time_days
      }
      poItems.push({
        inventory_item_id: skuRow.item_id,
        sku: skuRow.sku,
        description: `${skuRow.name} (${skuRow.sku})`,
        ordered_qty: orderedQty,
        unit_cost_cents: skuRow.unit_cost_cents,
        line_total_cents: lineTotalCents,
      })
    }

    totalReorderCostCents = assertSafeNonNegativeInt(
      totalReorderCostCents + poTotalCents,
      'total_reorder_cost_cents',
    )

    const autonomyDecision = evaluateAutonomyGate('stage_auto_po', poTotalCents, config)
    const poStatus: PurchaseOrderStatus =
      autonomyDecision === 'execute_now'
        ? 'sent'
        : autonomyDecision === 'queue_for_approval'
          ? 'pending_approval'
          : 'draft'
    const poNumber = `PO-${poPrefix}-${String(vendorSeq).padStart(2, '0')}`
    const expectedDate = addDaysIso(todayIso, maxLeadTimeDays || 7)
    vendorSeq += 1

    const mode = config.autonomy_rules.stage_auto_po ?? 'approve_1tap'

    autoPoDrafts.push({
      po_number: poNumber,
      vendor_name: vendorName,
      expected_date: expectedDate,
      total_cents: poTotalCents,
      status: poStatus,
      autonomy_decision: autonomyDecision,
      items: poItems,
      ledger_draft: {
        workspace_id: fallbackWorkspaceId,
        agent_name: 'Procurement & Restock Agent',
        module: 'inventory',
        action_type: 'stage_auto_po',
        autonomy_mode: mode,
        summary: `Auto-PO ${poNumber} to ${vendorName} for ${poItems.length} low-stock SKU(s) (${formatCents(poTotalCents)})`,
        impact_cents: poTotalCents,
        before_state: {
          vendor_name: vendorName,
          low_stock_skus: poItems.map(line => line.sku),
          po_id: null,
        },
        after_state: {
          po_number: poNumber,
          po_status: poStatus,
          vendor_name: vendorName,
          total_cents: poTotalCents,
        },
        status: autonomyDecision === 'execute_now' ? 'executed' : 'pending_approval',
        reversed_at: null,
      },
    })
  }

  return {
    evaluated_items: evaluatedItems,
    low_stock_items: lowStockItems,
    auto_po_drafts: autoPoDrafts,
    total_low_stock_count: lowStockItems.length,
    total_reorder_cost_cents: totalReorderCostCents,
  }
}

export interface ThreeWayMatchPoInput {
  sku: string
  ordered_qty: number
  unit_cost_cents: number
}

export function runThreeWayMatch(
  poItems: readonly (
    | ThreeWayMatchPoInput
    | Pick<PurchaseOrderItemRecord, 'sku' | 'ordered_qty' | 'unit_cost_cents'>
  )[],
  receiptItems: readonly GoodsReceiptLineItem[],
  billItems: readonly VendorBillLineItem[],
  toleranceBps = 200,
  options?: {
    poNumber?: string
    vendorName?: string
    invoiceNumber?: string
    existingInvoiceNumbers?: readonly string[]
  },
): ThreeWayMatchResult {
  if (!Number.isSafeInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 5000) {
    throw new Error('toleranceBps must be a safe integer between 0 and 5000')
  }
  if (billItems.length === 0) {
    throw new Error('At least one vendor bill line item is required for 3-way match')
  }

  const poBySku = new Map<string, { ordered_qty: number; unit_cost_cents: number }>()
  for (const item of poItems) {
    const sku = normalizeSku(item.sku)
    if (!sku) continue
    const qty = assertSafePositiveInt(item.ordered_qty, `po.${sku}.ordered_qty`)
    const unitCost = assertSafeNonNegativeInt(item.unit_cost_cents, `po.${sku}.unit_cost_cents`)
    const existing = poBySku.get(sku)
    poBySku.set(sku, {
      ordered_qty: (existing?.ordered_qty ?? 0) + qty,
      unit_cost_cents: unitCost,
    })
  }

  const receiptBySku = new Map<string, { received_qty: number; damaged_qty: number }>()
  for (const item of receiptItems) {
    const sku = normalizeSku(item.sku)
    if (!sku) continue
    const rec = assertSafeNonNegativeInt(item.received_qty, `receipt.${sku}.received_qty`)
    const dmg = assertSafeNonNegativeInt(item.damaged_qty ?? 0, `receipt.${sku}.damaged_qty`)
    const existing = receiptBySku.get(sku)
    receiptBySku.set(sku, {
      received_qty: (existing?.received_qty ?? 0) + rec,
      damaged_qty: (existing?.damaged_qty ?? 0) + dmg,
    })
  }

  const billBySku = new Map<string, { quantity: number; unit_cost_cents: number }>()
  for (const item of billItems) {
    const sku = normalizeSku(item.sku)
    if (!sku) continue
    const qty = assertSafeNonNegativeInt(item.quantity, `bill.${sku}.quantity`)
    const unitCost = assertSafeNonNegativeInt(item.unit_cost_cents, `bill.${sku}.unit_cost_cents`)
    const existing = billBySku.get(sku)
    billBySku.set(sku, {
      quantity: (existing?.quantity ?? 0) + qty,
      unit_cost_cents: unitCost,
    })
  }

  const allSkus = Array.from(
    new Set([...poBySku.keys(), ...receiptBySku.keys(), ...billBySku.keys()]),
  ).sort()

  const exceptions: ThreeWayMatchException[] = []
  const lineComparisons: ThreeWayMatchLineComparison[] = []

  const normalizedInvoiceNo = (options?.invoiceNumber ?? '').trim().toLowerCase()
  const isDuplicateInvoice =
    normalizedInvoiceNo.length > 0 &&
    (options?.existingInvoiceNumbers ?? []).some(
      existing => existing.trim().toLowerCase() === normalizedInvoiceNo,
    )

  let poTotalCents = 0
  let receivedPayableCents = 0
  let billedTotalCents = 0

  for (const sku of allSkus) {
    const poLine = poBySku.get(sku)
    const recLine = receiptBySku.get(sku)
    const billLine = billBySku.get(sku)

    const orderedQty = poLine?.ordered_qty ?? 0
    const poUnitCost = poLine?.unit_cost_cents ?? 0
    const receivedQty = recLine?.received_qty ?? 0
    const damagedQty = recLine?.damaged_qty ?? 0
    const goodReceivedQty = Math.max(0, receivedQty - damagedQty)
    const billedQty = billLine?.quantity ?? 0
    const billedUnitCost = billLine?.unit_cost_cents ?? 0

    const poLineCents = orderedQty * poUnitCost
    const receivedLinePayableCents = goodReceivedQty * poUnitCost
    const billedLineCents = billedQty * billedUnitCost
    const lineVarianceCents = billedLineCents - receivedLinePayableCents

    poTotalCents += poLineCents
    receivedPayableCents += receivedLinePayableCents
    billedTotalCents += billedLineCents

    lineComparisons.push({
      sku,
      ordered_qty: orderedQty,
      received_qty: receivedQty,
      damaged_qty: damagedQty,
      good_received_qty: goodReceivedQty,
      billed_qty: billedQty,
      po_unit_cost_cents: poUnitCost,
      billed_unit_cost_cents: billedUnitCost,
      po_line_cents: poLineCents,
      received_payable_cents: receivedLinePayableCents,
      billed_line_cents: billedLineCents,
      line_variance_cents: lineVarianceCents,
    })

    if (!poLine && billedQty > 0) {
      exceptions.push({
        code: 'unexpected_sku',
        sku,
        ordered_qty: 0,
        received_good_qty: goodReceivedQty,
        damaged_qty: damagedQty,
        billed_qty: billedQty,
        po_unit_cost_cents: 0,
        billed_unit_cost_cents: billedUnitCost,
        variance_cents: billedLineCents,
        detail: `${sku}: billed ${billedQty} unit(s) (${formatCents(billedLineCents)}) not found on Purchase Order.`,
      })
      continue
    }

    if (damagedQty > 0) {
      exceptions.push({
        code: 'damaged_goods',
        sku,
        ordered_qty: orderedQty,
        received_good_qty: goodReceivedQty,
        damaged_qty: damagedQty,
        billed_qty: billedQty,
        po_unit_cost_cents: poUnitCost,
        billed_unit_cost_cents: billedUnitCost,
        variance_cents: damagedQty * poUnitCost,
        detail: `${sku}: ${damagedQty} unit(s) arrived damaged out of ${receivedQty} received.`,
      })
    }

    if (billedQty > goodReceivedQty) {
      const shortageUnits = billedQty - goodReceivedQty
      exceptions.push({
        code: billedQty > orderedQty ? 'over_shipment_billed' : 'short_shipment',
        sku,
        ordered_qty: orderedQty,
        received_good_qty: goodReceivedQty,
        damaged_qty: damagedQty,
        billed_qty: billedQty,
        po_unit_cost_cents: poUnitCost,
        billed_unit_cost_cents: billedUnitCost,
        variance_cents: shortageUnits * poUnitCost,
        detail: `${sku}: billed ${billedQty} units vs ${goodReceivedQty} good units received on GRN (shortage of ${shortageUnits} units = ${formatCents(shortageUnits * poUnitCost)}).`,
      })
    }

    if (poUnitCost > 0 && billedQty > 0) {
      const priceDiffCents = Math.abs(billedUnitCost - poUnitCost)
      const exceedsTolerance = priceDiffCents * 10000 > poUnitCost * toleranceBps
      if (exceedsTolerance) {
        const unitImpactCents = (billedUnitCost - poUnitCost) * billedQty
        exceptions.push({
          code: 'unit_price_hike',
          sku,
          ordered_qty: orderedQty,
          received_good_qty: goodReceivedQty,
          damaged_qty: damagedQty,
          billed_qty: billedQty,
          po_unit_cost_cents: poUnitCost,
          billed_unit_cost_cents: billedUnitCost,
          variance_cents: unitImpactCents,
          detail: `${sku}: unit price billed ${formatCents(billedUnitCost)} vs PO price ${formatCents(poUnitCost)} (price variance across ${billedQty} units = ${formatCents(unitImpactCents)}).`,
        })
      }
    }
  }

  const matchVarianceCents = billedTotalCents - receivedPayableCents

  if (isDuplicateInvoice) {
    exceptions.unshift({
      code: 'duplicate_invoice',
      sku: allSkus[0] ?? 'ALL',
      ordered_qty: 0,
      received_good_qty: 0,
      damaged_qty: 0,
      billed_qty: 0,
      po_unit_cost_cents: 0,
      billed_unit_cost_cents: 0,
      variance_cents: billedTotalCents,
      detail: `Invoice #${options?.invoiceNumber ?? ''} already exists in workspace AP records.`,
    })
  }

  const absVarianceBps =
    receivedPayableCents > 0
      ? Math.round((Math.abs(matchVarianceCents) * 10000) / receivedPayableCents)
      : Math.abs(matchVarianceCents) > 0
        ? 10000
        : 0

  const hasException = exceptions.length > 0 || absVarianceBps > toleranceBps
  const matchStatus = hasException ? 'exception_flagged' : 'matched_clean'

  const vendorName = options?.vendorName?.trim() || 'Supplier'
  const poNumber = options?.poNumber?.trim() || 'PO-PENDING'
  const invoiceNumber = options?.invoiceNumber?.trim() || 'INV-PENDING'

  const discrepancySummary = hasException
    ? [
        `Variance ${formatCents(matchVarianceCents)} (Billed ${formatCents(billedTotalCents)} vs GRN Payable ${formatCents(receivedPayableCents)})`,
        ...exceptions.map(ex => ex.detail),
      ].join(' | ')
    : null

  const vendorDisputeDraft: VendorDisputeDraft | null = hasException
    ? {
        requires_approval: true,
        vendor_name: vendorName,
        invoice_number: invoiceNumber,
        po_number: poNumber,
        subject: `HOLD / Credit Memo Request: ${invoiceNumber} vs ${poNumber} (${formatCents(Math.abs(matchVarianceCents))} variance)`,
        body_markdown: [
          `Hello ${vendorName} Billing Team,`,
          ``,
          `Our automated 3-Way Match held Invoice **${invoiceNumber}** against Purchase Order **${poNumber}** due to a **${formatCents(Math.abs(matchVarianceCents))}** discrepancy:`,
          ``,
          ...exceptions.map(ex => `- **${ex.code.toUpperCase()} (${ex.sku})**: ${ex.detail}`),
          ``,
          `- **PO Authorized Total**: ${formatCents(poTotalCents)}`,
          `- **Goods Receipt Payable**: ${formatCents(receivedPayableCents)}`,
          `- **Supplier Bill Total**: ${formatCents(billedTotalCents)}`,
          `- **Net Variance Held**: ${formatCents(matchVarianceCents)}`,
          ``,
          `Please issue a revised invoice or credit memo matching our Goods Receipt Note and contracted PO unit pricing so AP can release payment immediately.`,
        ].join('\n'),
        disputed_amount_cents: Math.abs(matchVarianceCents),
      }
    : null

  return {
    match_status: matchStatus,
    tolerance_bps: toleranceBps,
    po_total_cents: poTotalCents,
    received_payable_cents: receivedPayableCents,
    billed_total_cents: billedTotalCents,
    match_variance_cents: matchVarianceCents,
    line_comparisons: lineComparisons,
    exceptions,
    discrepancy_summary: discrepancySummary,
    vendor_dispute_draft: vendorDisputeDraft,
  }
}
