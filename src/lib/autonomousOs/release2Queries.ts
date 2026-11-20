import { fetchAllWorkspaceRows } from '../queries'
import { assertSupabaseConfigured, supabase } from '../supabase'
import { evaluateAutonomyGate, formatCents } from './engine'
import { runThreeWayMatch } from './inventoryEngine'
import type {
  AgentActionLedgerEntry,
  AutoPoDraftProposal,
  AutonomousInvoice,
  GoodsReceiptLineItem,
  GoodsReceiptRecord,
  LedgerEntryRecord,
  LedgerEntryType,
  PurchaseOrderItemRecord,
  PurchaseOrderRecord,
  PurchaseOrderStatus,
  Release2InventoryItem,
  ThreeWayMatchResult,
  VendorBillLineItem,
  VendorBillMatchStatus,
  VendorBillRecord,
  WorkspaceAutonomyConfig,
} from './types'

export interface Release2InventoryBundle {
  inventoryItems: Release2InventoryItem[]
  purchaseOrders: PurchaseOrderRecord[]
  poItemsByPo: ReadonlyMap<string, PurchaseOrderItemRecord[]>
  goodsReceipts: GoodsReceiptRecord[]
  receiptsByPo: ReadonlyMap<string, GoodsReceiptRecord[]>
  vendorBills: VendorBillRecord[]
}

export async function fetchRelease2InventoryData(
  workspaceId: string,
): Promise<Release2InventoryBundle> {
  const [inventoryItems, purchaseOrders, poItems, goodsReceipts, vendorBills] = await Promise.all([
    fetchAllWorkspaceRows<Release2InventoryItem>({
      table: 'inventory_items',
      workspaceId,
      orderBy: 'sku',
      ascending: true,
    }),
    fetchAllWorkspaceRows<PurchaseOrderRecord>({
      table: 'purchase_orders',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<PurchaseOrderItemRecord>({
      table: 'purchase_order_items',
      workspaceId,
      orderBy: 'created_at',
      ascending: true,
    }),
    fetchAllWorkspaceRows<GoodsReceiptRecord>({
      table: 'goods_receipts',
      workspaceId,
      orderBy: 'received_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<VendorBillRecord>({
      table: 'vendor_bills',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
  ])

  const poItemsByPo = new Map<string, PurchaseOrderItemRecord[]>()
  for (const row of poItems ?? []) {
    const existing = poItemsByPo.get(row.po_id)
    if (existing) {
      existing.push(row)
    } else {
      poItemsByPo.set(row.po_id, [row])
    }
  }

  const receiptsByPo = new Map<string, GoodsReceiptRecord[]>()
  for (const rec of goodsReceipts ?? []) {
    const existing = receiptsByPo.get(rec.po_id)
    if (existing) {
      existing.push(rec)
    } else {
      receiptsByPo.set(rec.po_id, [rec])
    }
  }

  return {
    inventoryItems: (inventoryItems ?? []).filter(i => !i.archived),
    purchaseOrders: purchaseOrders ?? [],
    poItemsByPo,
    goodsReceipts: goodsReceipts ?? [],
    receiptsByPo,
    vendorBills: vendorBills ?? [],
  }
}

export async function upsertRelease2Sku(params: {
  workspaceId: string
  sku: string
  name: string
  location?: string | null
  bin_code?: string | null
  on_hand_qty: number
  reserved_qty: number
  reorder_point_qty: number
  reorder_qty: number
  unit_cost_cents: number
  unit_price_cents: number
  preferred_vendor?: string | null
  lead_time_days: number
}): Promise<Release2InventoryItem> {
  assertSupabaseConfigured()
  const { data, error } = await supabase.rpc('upsert_inventory_item_r2', {
    p_workspace_id: params.workspaceId,
    p_sku: params.sku.trim().toUpperCase(),
    p_name: params.name.trim(),
    p_location: params.location?.trim() || null,
    p_bin_code: params.bin_code?.trim() || null,
    p_on_hand_qty: params.on_hand_qty,
    p_reserved_qty: params.reserved_qty,
    p_reorder_point_qty: params.reorder_point_qty,
    p_reorder_qty: Math.max(1, params.reorder_qty),
    p_unit_cost_cents: params.unit_cost_cents,
    p_unit_price_cents: params.unit_price_cents,
    p_preferred_vendor: params.preferred_vendor?.trim() || null,
    p_lead_time_days: params.lead_time_days,
  })
  if (error || !data) {
    throw error ?? new Error('Unable to save SKU via upsert_inventory_item_r2')
  }
  return data as Release2InventoryItem
}

export async function stageAutoPoInDb(params: {
  workspaceId: string
  proposal: AutoPoDraftProposal
  config: WorkspaceAutonomyConfig
}): Promise<{
  po: PurchaseOrderRecord
  items: PurchaseOrderItemRecord[]
  ledgerEntry: AgentActionLedgerEntry
}> {
  assertSupabaseConfigured()
  const { workspaceId, proposal, config } = params
  const decision = evaluateAutonomyGate('stage_auto_po', proposal.total_cents, config)
  const poStatus: PurchaseOrderStatus =
    decision === 'execute_now'
      ? 'sent'
      : decision === 'queue_for_approval'
        ? 'pending_approval'
        : 'draft'

  const uniqueSuffix = Date.now().toString(36).toUpperCase().slice(-4)
  const poNumber = `${proposal.po_number}-${uniqueSuffix}`

  const { data: poData, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({
      workspace_id: workspaceId,
      po_number: poNumber,
      vendor_name: proposal.vendor_name,
      status: poStatus,
      total_cents: proposal.total_cents,
      expected_date: proposal.expected_date,
      notes: `Auto-PO staged from reorder threshold evaluation (${proposal.items.length} SKU line(s))`,
    })
    .select('*')
    .single()

  if (poErr || !poData) {
    throw poErr ?? new Error('Unable to stage purchase order.')
  }
  const po = poData as PurchaseOrderRecord

  const { data: itemData, error: itemErr } = await supabase
    .from('purchase_order_items')
    .insert(
      proposal.items.map(line => ({
        workspace_id: workspaceId,
        po_id: po.id,
        inventory_item_id: line.inventory_item_id || null,
        sku: line.sku,
        description: line.description,
        ordered_qty: line.ordered_qty,
        received_qty: 0,
        unit_cost_cents: line.unit_cost_cents,
        line_total_cents: line.line_total_cents,
      })),
    )
    .select('*')

  if (itemErr) {
    throw itemErr
  }

  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      workspace_id: workspaceId,
      agent_name: proposal.ledger_draft.agent_name,
      module: 'inventory',
      action_type: 'stage_auto_po',
      autonomy_mode: config.autonomy_rules.stage_auto_po,
      summary: `Staged Auto-PO ${po.po_number} to ${po.vendor_name} (${formatCents(po.total_cents)})`,
      impact_cents: po.total_cents,
      before_state: {
        po_id: null,
        po_status: null,
        vendor_name: po.vendor_name,
      },
      after_state: {
        po_id: po.id,
        po_number: po.po_number,
        po_status: po.status,
        total_cents: po.total_cents,
      },
      status: decision === 'execute_now' ? 'executed' : 'pending_approval',
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerData) {
    throw ledgerErr ?? new Error('PO staged, but logging to agent_action_ledger failed.')
  }

  return {
    po,
    items: (itemData ?? []) as PurchaseOrderItemRecord[],
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
  }
}

export async function recordGoodsReceiptInDb(params: {
  workspaceId: string
  poId: string
  receivedBy: string
  items: readonly GoodsReceiptLineItem[]
}): Promise<{
  goods_receipt: GoodsReceiptRecord
  po_status: PurchaseOrderStatus
  updated_skus: string[]
}> {
  assertSupabaseConfigured()
  const { data, error } = await supabase.rpc('record_goods_receipt_r2', {
    p_workspace_id: params.workspaceId,
    p_po_id: params.poId,
    p_received_by: params.receivedBy.trim() || 'Warehouse Receiver',
    p_items_json: params.items,
  })
  if (error || !data) {
    throw error ?? new Error('Unable to record goods receipt.')
  }
  return data as {
    goods_receipt: GoodsReceiptRecord
    po_status: PurchaseOrderStatus
    updated_skus: string[]
  }
}

export async function createVendorBillAndMatchInDb(params: {
  workspaceId: string
  poId: string | null
  poNumber?: string
  vendorName: string
  invoiceNumber: string
  dueDate: string
  taxCents: number
  billItems: readonly VendorBillLineItem[]
  poItems: readonly Pick<PurchaseOrderItemRecord, 'sku' | 'ordered_qty' | 'unit_cost_cents'>[]
  receipts: readonly GoodsReceiptRecord[]
  existingInvoiceNumbers: readonly string[]
  config: WorkspaceAutonomyConfig
  toleranceBps?: number
}): Promise<{ bill: VendorBillRecord; matchResult: ThreeWayMatchResult }> {
  assertSupabaseConfigured()
  const {
    workspaceId,
    poId,
    poNumber,
    vendorName,
    invoiceNumber,
    dueDate,
    taxCents,
    billItems,
    poItems,
    receipts,
    existingInvoiceNumbers,
    config,
    toleranceBps = 200,
  } = params

  const flattenedReceiptItems: GoodsReceiptLineItem[] = []
  for (const rec of receipts) {
    if (Array.isArray(rec.items_json)) {
      flattenedReceiptItems.push(...rec.items_json)
    }
  }

  const matchResult = runThreeWayMatch(
    poItems,
    flattenedReceiptItems,
    billItems,
    toleranceBps,
    {
      poNumber: poNumber ?? 'UNLINKED',
      vendorName,
      invoiceNumber,
      existingInvoiceNumbers,
    },
  )

  const subtotalCents = matchResult.billed_total_cents
  const safeTaxCents = Number.isSafeInteger(taxCents) && taxCents >= 0 ? taxCents : 0
  const totalCents = subtotalCents + safeTaxCents

  const autoApproveDecision =
    matchResult.match_status === 'matched_clean'
      ? evaluateAutonomyGate('approve_clean_vendor_bill', totalCents, config)
      : 'manual_only'

  const billStatus: VendorBillMatchStatus =
    matchResult.match_status === 'matched_clean'
      ? 'matched_clean'
      : 'exception_flagged'

  const { data: billData, error: billErr } = await supabase
    .from('vendor_bills')
    .insert({
      workspace_id: workspaceId,
      po_id: poId,
      vendor_name: vendorName.trim(),
      invoice_number: invoiceNumber.trim(),
      subtotal_cents: subtotalCents,
      tax_cents: safeTaxCents,
      total_cents: totalCents,
      due_date: dueDate,
      items_json: billItems,
      match_status: billStatus,
      match_variance_cents: matchResult.match_variance_cents,
      discrepancy_summary: matchResult.discrepancy_summary,
    })
    .select('*')
    .single()

  if (billErr || !billData) {
    throw billErr ?? new Error('Unable to record vendor bill.')
  }
  const bill = billData as VendorBillRecord

  await supabase.from('agent_action_ledger').insert({
    workspace_id: workspaceId,
    agent_name: '3-Way Match Controller',
    module: 'bookkeeping',
    action_type:
      billStatus === 'matched_clean'
        ? 'approve_clean_vendor_bill'
        : 'flag_three_way_match_exception',
    autonomy_mode: config.autonomy_rules.approve_clean_vendor_bill,
    summary:
      billStatus === 'matched_clean'
        ? `3-Way Match CLEAN on bill ${bill.invoice_number} (${bill.vendor_name} · ${formatCents(bill.total_cents)})`
        : `3-Way Match EXCEPTION on bill ${bill.invoice_number} (${formatCents(bill.match_variance_cents)} variance)`,
    impact_cents:
      billStatus === 'matched_clean' ? bill.total_cents : Math.abs(bill.match_variance_cents),
    before_state: { bill_id: bill.id, match_status: 'unmatched' },
    after_state: {
      bill_id: bill.id,
      match_status: billStatus,
      match_variance_cents: bill.match_variance_cents,
      dispute_draft: matchResult.vendor_dispute_draft,
    },
    status:
      billStatus === 'matched_clean' && autoApproveDecision === 'execute_now'
        ? 'executed'
        : 'pending_approval',
  })

  return { bill, matchResult }
}

export async function approveVendorBillInDb(params: {
  workspaceId: string
  bill: VendorBillRecord
}): Promise<VendorBillRecord> {
  assertSupabaseConfigured()
  const { workspaceId, bill } = params
  const { data, error } = await supabase
    .from('vendor_bills')
    .update({
      match_status: 'matched_clean',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', bill.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to approve vendor bill.')
  }

  await supabase.from('agent_action_ledger').insert({
    workspace_id: workspaceId,
    agent_name: 'AP Approval Agent',
    module: 'bookkeeping',
    action_type: 'approve_vendor_bill',
    autonomy_mode: 'approve_1tap',
    summary: `Approved vendor bill ${bill.invoice_number} (${bill.vendor_name} · ${formatCents(bill.total_cents)})`,
    impact_cents: bill.total_cents,
    before_state: { bill_id: bill.id, bill_match_status: bill.match_status },
    after_state: { bill_id: bill.id, bill_match_status: 'matched_clean' },
    status: 'executed',
  })

  return data as VendorBillRecord
}

export async function disputeVendorBillInDb(params: {
  workspaceId: string
  bill: VendorBillRecord
  reasonSummary?: string
}): Promise<VendorBillRecord> {
  assertSupabaseConfigured()
  const { workspaceId, bill, reasonSummary } = params
  const { data, error } = await supabase
    .from('vendor_bills')
    .update({
      match_status: 'disputed',
      discrepancy_summary: reasonSummary?.trim() || bill.discrepancy_summary,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', bill.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to dispute vendor bill.')
  }

  await supabase.from('agent_action_ledger').insert({
    workspace_id: workspaceId,
    agent_name: 'AP Dispute Controller',
    module: 'bookkeeping',
    action_type: 'dispute_vendor_bill',
    autonomy_mode: 'approve_1tap',
    summary: `Held vendor bill ${bill.invoice_number} (${bill.vendor_name}) — saved ${formatCents(Math.abs(bill.match_variance_cents || bill.total_cents))}`,
    impact_cents: Math.abs(bill.match_variance_cents || bill.total_cents),
    before_state: { bill_id: bill.id, bill_match_status: bill.match_status },
    after_state: { bill_id: bill.id, bill_match_status: 'disputed' },
    status: 'executed',
  })

  return data as VendorBillRecord
}

export async function markVendorBillPaidInDb(params: {
  workspaceId: string
  bill: VendorBillRecord
}): Promise<VendorBillRecord> {
  assertSupabaseConfigured()
  const { workspaceId, bill } = params
  const { data, error } = await supabase
    .from('vendor_bills')
    .update({
      match_status: 'paid',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', bill.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to mark vendor bill paid.')
  }

  await supabase.from('ledger_entries').insert({
    workspace_id: workspaceId,
    entry_type: 'cogs',
    category: 'Supplier AP Payment',
    description: `Paid bill ${bill.invoice_number} (${bill.vendor_name})`,
    amount_cents: bill.total_cents,
    occurred_on: new Date().toISOString().slice(0, 10),
    source_ref: bill.invoice_number,
  })

  await supabase.from('agent_action_ledger').insert({
    workspace_id: workspaceId,
    agent_name: 'Bookkeeping Agent',
    module: 'bookkeeping',
    action_type: 'mark_vendor_bill_paid',
    autonomy_mode: 'manual',
    summary: `Paid & posted COGS for vendor bill ${bill.invoice_number} (${formatCents(bill.total_cents)})`,
    impact_cents: bill.total_cents,
    before_state: { bill_id: bill.id, bill_match_status: bill.match_status },
    after_state: { bill_id: bill.id, bill_match_status: 'paid' },
    status: 'executed',
  })

  return data as VendorBillRecord
}

export async function fetchBookkeepingData(workspaceId: string): Promise<{
  vendorBills: VendorBillRecord[]
  ledgerEntries: LedgerEntryRecord[]
  openInvoices: AutonomousInvoice[]
}> {
  const [vendorBills, ledgerEntries, invoices] = await Promise.all([
    fetchAllWorkspaceRows<VendorBillRecord>({
      table: 'vendor_bills',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<LedgerEntryRecord>({
      table: 'ledger_entries',
      workspaceId,
      orderBy: 'occurred_on',
      ascending: false,
    }),
    fetchAllWorkspaceRows<AutonomousInvoice>({
      table: 'invoices',
      workspaceId,
      orderBy: 'due_date',
      ascending: true,
    }),
  ])

  return {
    vendorBills: vendorBills ?? [],
    ledgerEntries: ledgerEntries ?? [],
    openInvoices: (invoices ?? []).filter(inv => inv.status !== 'paid' && inv.status !== 'void'),
  }
}

export async function createLedgerEntryInDb(params: {
  workspaceId: string
  entry_type: LedgerEntryType
  category: string
  description: string
  amount_cents: number
  occurred_on: string
  source_ref?: string | null
}): Promise<LedgerEntryRecord> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('ledger_entries')
    .insert({
      workspace_id: params.workspaceId,
      entry_type: params.entry_type,
      category: params.category.trim() || 'General',
      description: params.description.trim(),
      amount_cents: params.amount_cents,
      occurred_on: params.occurred_on,
      source_ref: params.source_ref?.trim() || null,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to record ledger entry.')
  }
  return data as LedgerEntryRecord
}
