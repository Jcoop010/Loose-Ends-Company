import { supabase } from '../supabase'
import { autoReconcileBankFeed, buildReconcileMatchedPlan, parseBankFeedPayload } from './bankReconciliationEngine'
import { buildPostCapturedBillPlan, processInboundBillCapture } from './inboxToLedgerEngine'
import { buildDraftChangeOrderPlan, evaluateJobMargin } from './jobMarginEngine'
import type {
  AgentActionLedgerEntry,
  AutonomousInvoice,
  BankFeedSource,
  BankFeedTransactionRecord,
  GoodsReceiptLineItem,
  InboundBillCaptureRecord,
  JobMarginRecord,
  LedgerEntryRecord,
  PurchaseOrderItemRecord,
  VendorBillRecord,
  WorkspaceEntityRecord,
  WorkspaceEntityType,
} from './types'

export async function fetchWorkspaceEntities(
  workspaceId: string,
): Promise<WorkspaceEntityRecord[]> {
  const { data, error } = await supabase
    .from('workspace_entities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) throw error
  return (data ?? []) as WorkspaceEntityRecord[]
}

export async function createWorkspaceEntity(params: {
  workspaceId: string
  legalName: string
  einLast4: string
  entityType: WorkspaceEntityType
  isPrimary?: boolean
}): Promise<WorkspaceEntityRecord> {
  const cleanEin = params.einLast4.replace(/\D/g, '').slice(-4).padStart(4, '0')
  const { data, error } = await supabase
    .from('workspace_entities')
    .insert({
      workspace_id: params.workspaceId,
      legal_name: params.legalName.trim(),
      ein_last4: cleanEin,
      entity_type: params.entityType,
      is_primary: Boolean(params.isPrimary),
    })
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Unable to create legal entity.')
  return data as WorkspaceEntityRecord
}

export async function fetchInboundBillCaptures(
  workspaceId: string,
): Promise<InboundBillCaptureRecord[]> {
  const { data, error } = await supabase
    .from('inbound_bill_captures')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as InboundBillCaptureRecord[]
}

export async function captureAndEvaluateInboundBillInDb(params: {
  workspaceId: string
  entityId?: string | null
  sourceAddress: string
  fileName: string
  rawText: string
  existingBills: readonly VendorBillRecord[]
  poItems?: readonly PurchaseOrderItemRecord[]
  receiptItems?: readonly GoodsReceiptLineItem[]
  priorUnitCostsBySku?: Readonly<Record<string, number>>
}): Promise<{
  capture: InboundBillCaptureRecord
  fraudAlertsCreated: number
}> {
  const evalRes = processInboundBillCapture({
    workspaceId: params.workspaceId,
    entityId: params.entityId ?? null,
    sourceAddress: params.sourceAddress,
    fileName: params.fileName,
    rawText: params.rawText,
    existingBills: params.existingBills,
    poItems: params.poItems,
    receiptItems: params.receiptItems,
    priorUnitCostsBySku: params.priorUnitCostsBySku,
  })

  const { data, error } = await supabase
    .from('inbound_bill_captures')
    .insert({
      workspace_id: params.workspaceId,
      entity_id: params.entityId ?? null,
      source_address: evalRes.capture_draft.source_address,
      file_name: evalRes.capture_draft.file_name,
      vendor_name: evalRes.capture_draft.vendor_name,
      extracted_total_cents: evalRes.capture_draft.extracted_total_cents,
      po_reference: evalRes.capture_draft.po_reference,
      match_status: evalRes.capture_draft.match_status,
      proof_summary: evalRes.capture_draft.proof_summary,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to save inbound bill capture.')
  }

  let fraudAlertsCreated = 0
  if (evalRes.fraud_alerts.length > 0) {
    const nowIso = new Date().toISOString()
    const alertPayloads = evalRes.fraud_alerts.map(a => ({
      workspace_id: params.workspaceId,
      bill_id: null,
      vendor_name: a.vendor_name,
      alert_type: a.alert_type,
      variance_cents: a.variance_cents,
      proof_summary: a.proof_summary,
      status: 'frozen' as const,
      updated_at: nowIso,
    }))
    const { data: insertedAlerts, error: alertErr } = await supabase
      .from('vendor_fraud_alerts')
      .insert(alertPayloads)
      .select('id')
    if (alertErr) throw alertErr
    fraudAlertsCreated = (insertedAlerts ?? []).length
  }

  return {
    capture: data as InboundBillCaptureRecord,
    fraudAlertsCreated,
  }
}

export async function postInboundBillCaptureInDb(
  workspaceId: string,
  capture: InboundBillCaptureRecord,
): Promise<{
  capture: InboundBillCaptureRecord
  ledgerEntry: LedgerEntryRecord
  agentLedgerEntry: AgentActionLedgerEntry
}> {
  const plan = buildPostCapturedBillPlan({ workspaceId, capture })

  const { data: updatedCap, error: capErr } = await supabase
    .from('inbound_bill_captures')
    .update({
      match_status: 'posted',
      updated_at: plan.updated_capture.updated_at,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', capture.id)
    .select('*')
    .single()

  if (capErr || !updatedCap) {
    throw capErr ?? new Error('Unable to update inbound capture status.')
  }

  const { data: leRow, error: leErr } = await supabase
    .from('ledger_entries')
    .insert(plan.ledger_entry_draft)
    .select('*')
    .single()

  if (leErr || !leRow) {
    throw leErr ?? new Error('Unable to insert ledger_entries row.')
  }

  const { data: agentRow, error: agentErr } = await supabase
    .from('agent_action_ledger')
    .insert(plan.agent_ledger_draft)
    .select('*')
    .single()

  if (agentErr || !agentRow) {
    throw agentErr ?? new Error('Unable to log agent_action_ledger entry.')
  }

  return {
    capture: updatedCap as InboundBillCaptureRecord,
    ledgerEntry: leRow as LedgerEntryRecord,
    agentLedgerEntry: agentRow as AgentActionLedgerEntry,
  }
}

export async function fetchBankFeedTransactions(
  workspaceId: string,
): Promise<BankFeedTransactionRecord[]> {
  const { data, error } = await supabase
    .from('bank_feed_transactions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('posted_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(150)

  if (error) throw error
  return (data ?? []) as BankFeedTransactionRecord[]
}

export async function importAndAutoMatchBankFeedInDb(params: {
  workspaceId: string
  entityId?: string | null
  source: BankFeedSource
  rawPayload: string
  invoices: readonly AutonomousInvoice[]
  vendorBills: readonly VendorBillRecord[]
}): Promise<BankFeedTransactionRecord[]> {
  const parsed = parseBankFeedPayload(params.rawPayload, params.source)
  if (parsed.length === 0) {
    return []
  }

  const recon = autoReconcileBankFeed({
    workspaceId: params.workspaceId,
    entityId: params.entityId ?? null,
    transactions: parsed,
    invoices: params.invoices,
    vendorBills: params.vendorBills,
  })

  const payload = recon.transactions.map(tx => ({
    workspace_id: params.workspaceId,
    entity_id: params.entityId ?? null,
    source: tx.source,
    posted_date: tx.posted_date,
    merchant_name: tx.merchant_name,
    amount_cents: tx.amount_cents,
    direction: tx.direction,
    matched_record_id: tx.matched_record_id,
    match_confidence_bps: tx.match_confidence_bps,
    status: tx.status,
    proof_summary: tx.proof_summary,
  }))

  const { data, error } = await supabase
    .from('bank_feed_transactions')
    .insert(payload)
    .select('*')

  if (error) throw error
  return (data ?? []) as BankFeedTransactionRecord[]
}

export async function reconcileMatchedBankFeedInDb(
  workspaceId: string,
  transactions: readonly BankFeedTransactionRecord[],
): Promise<{
  reconciledCount: number
  agentLedgerEntry: AgentActionLedgerEntry
} | null> {
  const plan = buildReconcileMatchedPlan({ workspaceId, transactions })
  if (plan.reconciled_ids.length === 0) return null

  const { error: updateErr } = await supabase
    .from('bank_feed_transactions')
    .update({
      status: 'reconciled',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .in('id', plan.reconciled_ids)

  if (updateErr) throw updateErr

  const { data: ledgerRow, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert(plan.ledger_draft)
    .select('*')
    .single()

  if (ledgerErr || !ledgerRow) {
    throw ledgerErr ?? new Error('Unable to record bank reconciliation in ledger.')
  }

  return {
    reconciledCount: plan.reconciled_ids.length,
    agentLedgerEntry: ledgerRow as AgentActionLedgerEntry,
  }
}

export async function fetchJobMarginRecords(
  workspaceId: string,
): Promise<JobMarginRecord[]> {
  const { data, error } = await supabase
    .from('job_margin_records')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(150)

  if (error) throw error
  return (data ?? []) as JobMarginRecord[]
}

export async function createJobMarginRecord(params: {
  workspaceId: string
  entityId?: string | null
  jobName: string
  clientName: string
  quotedRevenueCents: number
  materialPoCents: number
  vendorBillCents: number
  laborCents: number
  targetMarginBps?: number
}): Promise<JobMarginRecord> {
  const draft: JobMarginRecord = {
    id: 'temp',
    workspace_id: params.workspaceId,
    entity_id: params.entityId ?? null,
    job_name: params.jobName.trim(),
    client_name: params.clientName.trim(),
    quoted_revenue_cents: Math.max(0, Math.trunc(params.quotedRevenueCents)),
    material_po_cents: Math.max(0, Math.trunc(params.materialPoCents)),
    vendor_bill_cents: Math.max(0, Math.trunc(params.vendorBillCents)),
    labor_cents: Math.max(0, Math.trunc(params.laborCents)),
    target_margin_bps: Math.min(9999, Math.max(0, Math.trunc(params.targetMarginBps ?? 3000))),
    status: 'healthy',
  }
  const evaluated = evaluateJobMargin(draft)

  const { data, error } = await supabase
    .from('job_margin_records')
    .insert({
      workspace_id: draft.workspace_id,
      entity_id: draft.entity_id,
      job_name: draft.job_name,
      client_name: draft.client_name,
      quoted_revenue_cents: draft.quoted_revenue_cents,
      material_po_cents: draft.material_po_cents,
      vendor_bill_cents: draft.vendor_bill_cents,
      labor_cents: draft.labor_cents,
      target_margin_bps: draft.target_margin_bps,
      status: evaluated.computed_status,
    })
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Unable to save job margin record.')
  return data as JobMarginRecord
}

export async function applyJobChangeOrderInDb(
  workspaceId: string,
  job: JobMarginRecord,
): Promise<{
  updatedJob: JobMarginRecord
  agentLedgerEntry: AgentActionLedgerEntry
}> {
  const plan = buildDraftChangeOrderPlan({ workspaceId, job })

  const { data: jobRow, error: jobErr } = await supabase
    .from('job_margin_records')
    .update({
      quoted_revenue_cents: plan.updated_job.quoted_revenue_cents,
      status: plan.updated_job.status,
      updated_at: plan.updated_job.updated_at,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', job.id)
    .select('*')
    .single()

  if (jobErr || !jobRow) throw jobErr ?? new Error('Unable to apply change order.')

  const { data: ledgerRow, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert(plan.ledger_draft)
    .select('*')
    .single()

  if (ledgerErr || !ledgerRow) {
    throw ledgerErr ?? new Error('Unable to record change order in Agent Action Ledger.')
  }

  return {
    updatedJob: jobRow as JobMarginRecord,
    agentLedgerEntry: ledgerRow as AgentActionLedgerEntry,
  }
}
