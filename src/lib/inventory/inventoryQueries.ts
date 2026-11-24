// Live Supabase queries & atomic PostgreSQL RPC wrappers for Mission 12
// Zero hardcoded mock data, zero localStorage, zero `any`.

import { supabase } from '../supabase'
import type {
  AuditReasonCode,
  InventoryAudit,
  InventoryAuditLine,
  InventoryAuditType,
  InventoryBalance,
  InventoryLocation,
  InventoryLocationType,
  InventoryMovementRecord,
  InventoryMovementType,
  InventoryReorderDraft,
  ReorderDraftSource,
  ReorderDraftStatus,
} from './types'

export interface Mission12InventoryBundle {
  locations: InventoryLocation[]
  balances: InventoryBalance[]
  audits: InventoryAudit[]
  auditLinesByAuditId: Record<string, InventoryAuditLine[]>
  reorderDrafts: InventoryReorderDraft[]
  movements: InventoryMovementRecord[]
}

export async function fetchMission12InventoryBundle(
  workspaceId: string,
): Promise<Mission12InventoryBundle> {
  const [locRes, balRes, audRes, lineRes, reorderRes, moveRes] = await Promise.all([
    supabase
      .from('inventory_locations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('inventory_balances')
      .select('*')
      .eq('workspace_id', workspaceId),
    supabase
      .from('inventory_audits')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('inventory_audit_lines')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('inventory_reorder_drafts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('inventory_movements')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const auditLinesByAuditId: Record<string, InventoryAuditLine[]> = {}
  const rawLines = (lineRes.data ?? []) as InventoryAuditLine[]
  for (const line of rawLines) {
    const existing = auditLinesByAuditId[line.audit_id] ?? []
    existing.push(line)
    auditLinesByAuditId[line.audit_id] = existing
  }

  const movements: InventoryMovementRecord[] = (
    (moveRes.data ?? []) as Array<Record<string, unknown>>
  ).map(row => ({
    id: String(row.id ?? ''),
    workspace_id: String(row.workspace_id ?? workspaceId),
    item_id: String(row.item_id ?? ''),
    location_id: typeof row.location_id === 'string' ? row.location_id : null,
    movement_type: String(row.movement_type ?? row.kind ?? 'adjustment'),
    qty_delta: Number(row.qty_delta ?? row.quantity ?? 0),
    balance_after: Number(row.balance ?? 0),
    unit_cost_cents: Number(row.unit_cost_cents ?? 0),
    reference_type: typeof row.reference_type === 'string' ? row.reference_type : null,
    reference_id: typeof row.reference_id === 'string' ? row.reference_id : null,
    lot_or_serial: typeof row.lot_or_serial === 'string' ? row.lot_or_serial : null,
    notes: typeof row.notes === 'string' ? row.notes : typeof row.reason === 'string' ? row.reason : null,
    idempotency_key: typeof row.idempotency_key === 'string' ? row.idempotency_key : null,
    created_at: String(row.created_at ?? ''),
  }))

  return {
    locations: (locRes.data ?? []) as InventoryLocation[],
    balances: (balRes.data ?? []) as InventoryBalance[],
    audits: (audRes.data ?? []) as InventoryAudit[],
    auditLinesByAuditId,
    reorderDrafts: (reorderRes.data ?? []) as InventoryReorderDraft[],
    movements,
  }
}

export async function createInventoryLocation(input: {
  workspaceId: string
  name: string
  code: string
  locationType: InventoryLocationType
  address?: string | null
  isDefault?: boolean
}): Promise<InventoryLocation> {
  const { data, error } = await supabase
    .from('inventory_locations')
    .insert({
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      location_type: input.locationType,
      address: input.address?.trim() || null,
      is_default: Boolean(input.isDefault),
      is_active: true,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to create inventory location.')
  }
  return data as InventoryLocation
}

export async function recordInventoryMovementAtomic(input: {
  workspaceId: string
  itemId: string
  locationId: string | null
  movementType: InventoryMovementType
  qtyDelta: number
  unitCostCents?: number | null
  referenceType?: string | null
  referenceId?: string | null
  lotOrSerial?: string | null
  notes?: string | null
  idempotencyKey?: string | null
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('record_inventory_movement_atomic', {
    p_workspace_id: input.workspaceId,
    p_item_id: input.itemId,
    p_location_id: input.locationId,
    p_movement_type: input.movementType,
    p_qty_delta: Math.trunc(input.qtyDelta),
    p_unit_cost_cents: input.unitCostCents ?? null,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_lot_or_serial: input.lotOrSerial ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function transferInventoryAtomic(input: {
  workspaceId: string
  itemId: string
  fromLocationId: string
  toLocationId: string
  qty: number
  notes?: string | null
  idempotencyKey?: string | null
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('transfer_inventory_atomic', {
    p_workspace_id: input.workspaceId,
    p_item_id: input.itemId,
    p_from_location_id: input.fromLocationId,
    p_to_location_id: input.toLocationId,
    p_qty: Math.trunc(input.qty),
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function submitCycleAuditForApproval(input: {
  workspaceId: string
  locationId: string | null
  title: string
  auditType?: InventoryAuditType
  notes?: string | null
  lines: Array<{
    itemId: string
    expectedQty: number
    countedQty: number
    unitCostCents: number
    reasonCode: AuditReasonCode
    scannedBarcode?: string | null
    notes?: string | null
  }>
}): Promise<InventoryAudit> {
  if (input.lines.length === 0) {
    throw new Error('At least one counted SKU line is required to submit a cycle audit.')
  }

  const auditNumber = `AUD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(
    1000 + Math.random() * 9000,
  )}`

  const totalExpectedQty = input.lines.reduce((sum, l) => sum + Math.trunc(l.expectedQty), 0)
  const totalCountedQty = input.lines.reduce((sum, l) => sum + Math.trunc(l.countedQty), 0)
  const totalVarianceQty = totalCountedQty - totalExpectedQty
  const totalVarianceCents = input.lines.reduce(
    (sum, l) => sum + (Math.trunc(l.countedQty) - Math.trunc(l.expectedQty)) * Math.max(0, Math.trunc(l.unitCostCents)),
    0,
  )

  const { data: auditData, error: auditErr } = await supabase
    .from('inventory_audits')
    .insert({
      workspace_id: input.workspaceId,
      location_id: input.locationId,
      audit_number: auditNumber,
      title: input.title.trim() || `Cycle Count ${auditNumber}`,
      audit_type: input.auditType ?? 'cycle_count',
      status: 'pending_approval',
      total_expected_qty: totalExpectedQty,
      total_counted_qty: totalCountedQty,
      total_variance_qty: totalVarianceQty,
      total_variance_cents: totalVarianceCents,
      notes: input.notes?.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (auditErr || !auditData) {
    throw new Error(auditErr?.message ?? 'Unable to create cycle count audit.')
  }

  const audit = auditData as InventoryAudit
  const linePayload = input.lines.map(l => ({
    workspace_id: input.workspaceId,
    audit_id: audit.id,
    item_id: l.itemId,
    location_id: input.locationId,
    expected_qty: Math.trunc(l.expectedQty),
    counted_qty: Math.trunc(l.countedQty),
    unit_cost_cents: Math.max(0, Math.trunc(l.unitCostCents)),
    reason_code: l.reasonCode,
    scanned_barcode: l.scannedBarcode ?? null,
    notes: l.notes ?? null,
  }))

  const { error: linesErr } = await supabase.from('inventory_audit_lines').insert(linePayload)
  if (linesErr) {
    throw new Error(linesErr.message)
  }

  return audit
}

export async function approveAndReconcileAuditAtomic(
  auditId: string,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('approve_and_reconcile_audit_atomic', {
    p_audit_id: auditId,
    p_idempotency_key: idempotencyKey ?? `reconcile:${auditId}`,
  })
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function reconcileGrnToInventoryAtomic(input: {
  workspaceId: string
  goodsReceiptId: string
  locationId?: string | null
  idempotencyKey?: string | null
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('reconcile_grn_to_inventory_atomic', {
    p_workspace_id: input.workspaceId,
    p_goods_receipt_id: input.goodsReceiptId,
    p_location_id: input.locationId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function stageInventoryReorderDraft(input: {
  workspaceId: string
  itemId: string
  locationId?: string | null
  vendorName: string
  suggestedQty: number
  unitCostCents: number
  source?: ReorderDraftSource
  notes?: string | null
  idempotencyKey?: string | null
}): Promise<InventoryReorderDraft> {
  const { data, error } = await supabase
    .from('inventory_reorder_drafts')
    .insert({
      workspace_id: input.workspaceId,
      item_id: input.itemId,
      location_id: input.locationId ?? null,
      vendor_name: input.vendorName.trim(),
      suggested_qty: Math.max(1, Math.trunc(input.suggestedQty)),
      unit_cost_cents: Math.max(0, Math.trunc(input.unitCostCents)),
      status: 'draft',
      source: input.source ?? 'low_stock_engine',
      notes: input.notes?.trim() || null,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to stage reorder draft.')
  }
  return data as InventoryReorderDraft
}

export async function updateReorderDraftStatus(
  workspaceId: string,
  draftId: string,
  status: ReorderDraftStatus,
): Promise<InventoryReorderDraft> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'approved') {
    updates.approved_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('inventory_reorder_drafts')
    .update(updates)
    .eq('workspace_id', workspaceId)
    .eq('id', draftId)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to update reorder draft.')
  }
  return data as InventoryReorderDraft
}

export async function updateWorkspaceInventoryEnabled(
  workspaceId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('workspace_settings')
    .update({ inventory_enabled: enabled })
    .eq('workspace_id', workspaceId)

  if (error) {
    throw new Error(error.message)
  }
}
