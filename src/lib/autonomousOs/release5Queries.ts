import { createIdempotencyKey } from '../opsCommand'
import { assertSupabaseConfigured, supabase } from '../supabase'
import { autoReconcileBankFeed, buildReconcileMatchedPlan, parseBankFeedPayload } from './bankReconciliationEngine'
import { buildTextContentHashSync } from './documentParser'
import { buildPostCapturedBillPlan, processInboundBillCapture } from './inboxToLedgerEngine'
import { buildDraftChangeOrderPlan, evaluateJobMargin } from './jobMarginEngine'
import type {
  AgentActionLedgerEntry,
  AutonomousInvoice,
  BankFeedSource,
  BankFeedTransactionRecord,
  GoodsReceiptLineItem,
  GoodsReceiptRecord,
  InboundBillCaptureRecord,
  JobMarginRecord,
  LedgerEntryRecord,
  PurchaseOrderItemRecord,
  VendorBillRecord,
  WorkspaceEntityRecord,
  WorkspaceEntityType,
} from './types'

function isMissingRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|does not exist/i.test(error.message ?? '')
  )
}

export async function fetchWorkspaceEntities(
  workspaceId: string,
): Promise<WorkspaceEntityRecord[]> {
  assertSupabaseConfigured()
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
  einLast4?: string | null
  entityType: WorkspaceEntityType
  isPrimary?: boolean
}): Promise<WorkspaceEntityRecord> {
  assertSupabaseConfigured()
  const cleanName = params.legalName.trim()
  if (cleanName.length < 2) {
    throw new Error('Legal business entity name (at least 2 characters) is required.')
  }

  const rawEin = (params.einLast4 ?? '').trim()
  let cleanEin: string | null = null
  if (rawEin.length > 0) {
    if (!/^\d{4}$/.test(rawEin)) {
      throw new Error('EIN last 4 digits must be exact 4 numeric digits (or leave blank until verified).')
    }
    cleanEin = rawEin
  }

  const { data, error } = await supabase
    .from('workspace_entities')
    .insert({
      workspace_id: params.workspaceId,
      legal_name: cleanName,
      ein_last4: cleanEin,
      ein_verified: false,
      identity_status: cleanEin ? 'owner_supplied' : 'unverified',
      entity_type: params.entityType,
      is_primary: Boolean(params.isPrimary),
    })
    .select('*')
    .single()

  if (error || !data) throw error ?? new Error('Unable to create legal entity.')
  return data as WorkspaceEntityRecord
}

export async function fetchWorkspacePoAndReceiptData(
  workspaceId: string,
): Promise<{
  poItems: PurchaseOrderItemRecord[]
  receiptItems: GoodsReceiptLineItem[]
  priorUnitCostsBySku: Record<string, number>
}> {
  assertSupabaseConfigured()
  const [{ data: poRows, error: poErr }, { data: grnRows, error: grnErr }] = await Promise.all([
    supabase
      .from('purchase_order_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('goods_receipts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('received_at', { ascending: false })
      .limit(150),
  ])

  if (poErr) throw poErr
  if (grnErr) throw grnErr

  const poItems = (poRows ?? []) as PurchaseOrderItemRecord[]
  const priorUnitCostsBySku: Record<string, number> = {}
  for (const item of poItems) {
    const key = item.sku.trim().toUpperCase()
    if (key && !priorUnitCostsBySku[key] && item.unit_cost_cents > 0) {
      priorUnitCostsBySku[key] = item.unit_cost_cents
    }
  }

  const receiptItems: GoodsReceiptLineItem[] = []
  for (const rec of (grnRows ?? []) as GoodsReceiptRecord[]) {
    for (const line of rec.items_json ?? []) {
      receiptItems.push(line)
    }
  }

  return { poItems, receiptItems, priorUnitCostsBySku }
}

export async function fetchInboundBillCaptures(
  workspaceId: string,
): Promise<InboundBillCaptureRecord[]> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('inbound_bill_captures')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as InboundBillCaptureRecord[]
}

export async function updateInboundBillCaptureReviewInDb(params: {
  workspaceId: string
  captureId: string
  vendorName: string
  extractedTotalCents: number
  poReference: string | null
  humanVerified: boolean
}): Promise<InboundBillCaptureRecord> {
  assertSupabaseConfigured()
  const cleanVendor = params.vendorName.trim()
  if (cleanVendor.length < 2) {
    throw new Error('Vendor name must be at least 2 characters.')
  }
  const safeCents = Math.max(0, Math.trunc(params.extractedTotalCents))
  if (!Number.isSafeInteger(safeCents)) {
    throw new Error('Extracted total cents must be a valid integer.')
  }

  const { data, error } = await supabase
    .from('inbound_bill_captures')
    .update({
      vendor_name: cleanVendor,
      extracted_total_cents: safeCents,
      po_reference: params.poReference?.trim() || null,
      human_verified: params.humanVerified,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.captureId)
    .neq('match_status', 'posted')
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to update inbound capture review fields.')
  }
  return data as InboundBillCaptureRecord
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
  contentHash?: string
  extractionMethod?: string
  extractionConfidenceBps?: number
}): Promise<{
  capture: InboundBillCaptureRecord
  fraudAlertsCreated: number
  duplicate: boolean
}> {
  assertSupabaseConfigured()
  const contentHash =
    params.contentHash ?? buildTextContentHashSync(`${params.fileName}|${params.rawText}`)

  const { data: existingDup } = await supabase
    .from('inbound_bill_captures')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('content_hash', contentHash)
    .limit(1)
    .maybeSingle()

  if (existingDup) {
    return {
      capture: existingDup as InboundBillCaptureRecord,
      fraudAlertsCreated: 0,
      duplicate: true,
    }
  }

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

  const confidenceBps =
    params.extractionConfidenceBps ?? evalRes.capture_draft.extraction_confidence_bps ?? 0
  const extractionMethod = params.extractionMethod ?? evalRes.capture_draft.extraction_method ?? 'plain_text'

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
      content_hash: contentHash,
      extraction_method: extractionMethod,
      extraction_confidence_bps: confidenceBps,
      human_verified: false,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to save inbound bill capture.')
  }

  const savedCapture = data as InboundBillCaptureRecord
  let fraudAlertsCreated = 0
  if (evalRes.fraud_alerts.length > 0) {
    const nowIso = new Date().toISOString()
    const alertPayloads = evalRes.fraud_alerts.map(a => ({
      workspace_id: params.workspaceId,
      bill_id: null,
      capture_id: savedCapture.id,
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
    if (alertErr) {
      // Compensating cleanup if alert logging fails so capture is never stranded in frozen limbo
      await supabase
        .from('inbound_bill_captures')
        .delete()
        .eq('workspace_id', params.workspaceId)
        .eq('id', savedCapture.id)
      throw alertErr
    }
    fraudAlertsCreated = (insertedAlerts ?? []).length
  }

  return {
    capture: savedCapture,
    fraudAlertsCreated,
    duplicate: false,
  }
}

export async function postInboundBillCaptureInDb(
  workspaceId: string,
  capture: InboundBillCaptureRecord,
  options?: { idempotencyKey?: string; humanVerified?: boolean },
): Promise<{
  capture: InboundBillCaptureRecord
  ledgerEntry: LedgerEntryRecord
  agentLedgerEntry: AgentActionLedgerEntry
}> {
  assertSupabaseConfigured()
  const idempotencyKey = options?.idempotencyKey ?? createIdempotencyKey()
  const humanVerified = Boolean(options?.humanVerified ?? capture.human_verified ?? true)

  const plan = buildPostCapturedBillPlan({
    workspaceId,
    capture,
    requireHumanVerified: true,
    humanVerified,
  })

  if (typeof supabase.rpc === 'function') {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('post_inbound_bill_capture_atomic', {
      p_workspace_id: workspaceId,
      p_capture_id: capture.id,
      p_idempotency_key: idempotencyKey,
      p_human_verified: humanVerified,
    })
    if (!rpcErr && rpcData && typeof rpcData === 'object') {
      const parsed = rpcData as {
        capture: InboundBillCaptureRecord
        ledger_entry: LedgerEntryRecord
        agent_ledger_entry: AgentActionLedgerEntry
      }
      return {
        capture: parsed.capture,
        ledgerEntry: parsed.ledger_entry,
        agentLedgerEntry: parsed.agent_ledger_entry,
      }
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw rpcErr
    }
  }

  // Hardened fallback when atomic RPC migration is pending: compare-and-set status guard FIRST
  const { data: updatedCap, error: capErr } = await supabase
    .from('inbound_bill_captures')
    .update({
      match_status: 'posted',
      human_verified: true,
      idempotency_key: idempotencyKey,
      updated_at: plan.updated_capture.updated_at,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', capture.id)
    .in('match_status', ['3way_matched', 'needs_review'])
    .select('*')
    .single()

  if (capErr || !updatedCap) {
    throw capErr ?? new Error('Capture is already posted, fraud-frozen, or unavailable.')
  }

  const { data: leRow, error: leErr } = await supabase
    .from('ledger_entries')
    .insert({ ...plan.ledger_entry_draft, idempotency_key: idempotencyKey })
    .select('*')
    .single()

  if (leErr || !leRow) {
    await supabase
      .from('inbound_bill_captures')
      .update({ match_status: capture.match_status, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', capture.id)
    throw leErr ?? new Error('Unable to insert ledger_entries row.')
  }

  const { data: agentRow, error: agentErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      ...plan.agent_ledger_draft,
      after_state: {
        ...(plan.agent_ledger_draft.after_state ?? {}),
        ledger_entry_id: (leRow as LedgerEntryRecord).id,
        idempotency_key: idempotencyKey,
      },
    })
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
  assertSupabaseConfigured()
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
  assertSupabaseConfigured()
  const parsed = parseBankFeedPayload(params.rawPayload, params.source)
  if (parsed.length === 0) {
    return []
  }

  const existingRows = await fetchBankFeedTransactions(params.workspaceId)
  const existingExtIds = new Set(
    existingRows
      .map(r => (r.external_tx_id ? `${r.source}:${r.external_tx_id}` : ''))
      .filter(Boolean),
  )
  const existingFingerprints = new Set(
    existingRows.map(r => r.source_fingerprint ?? '').filter(Boolean),
  )
  const existingMatchedIds = new Set(
    existingRows
      .filter(r => r.matched_record_id && (r.status === 'auto_matched' || r.status === 'reconciled'))
      .map(r => r.matched_record_id as string),
  )

  const uniqueParsed = parsed.filter(tx => {
    const extKey = tx.external_tx_id ? `${tx.source}:${tx.external_tx_id}` : ''
    if (extKey && existingExtIds.has(extKey)) return false
    if (tx.source_fingerprint && existingFingerprints.has(tx.source_fingerprint)) return false
    if (extKey) existingExtIds.add(extKey)
    if (tx.source_fingerprint) existingFingerprints.add(tx.source_fingerprint)
    return true
  })

  if (uniqueParsed.length === 0) {
    return []
  }

  const recon = autoReconcileBankFeed({
    workspaceId: params.workspaceId,
    entityId: params.entityId ?? null,
    transactions: uniqueParsed,
    invoices: params.invoices,
    vendorBills: params.vendorBills,
    existingMatchedRecordIds: existingMatchedIds,
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
    external_tx_id: tx.external_tx_id ?? null,
    source_fingerprint: tx.source_fingerprint ?? null,
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
  idempotencyKey = createIdempotencyKey(),
): Promise<{
  reconciledCount: number
  agentLedgerEntry: AgentActionLedgerEntry
} | null> {
  assertSupabaseConfigured()
  const plan = buildReconcileMatchedPlan({ workspaceId, transactions })
  if (plan.reconciled_ids.length === 0) return null

  if (typeof supabase.rpc === 'function') {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('reconcile_bank_feed_atomic', {
      p_workspace_id: workspaceId,
      p_tx_ids: plan.reconciled_ids,
      p_idempotency_key: idempotencyKey,
    })
    if (!rpcErr && rpcData && typeof rpcData === 'object') {
      const parsed = rpcData as {
        reconciled_count: number
        agent_ledger_entry: AgentActionLedgerEntry
      }
      return {
        reconciledCount: parsed.reconciled_count,
        agentLedgerEntry: parsed.agent_ledger_entry,
      }
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw rpcErr
    }
  }

  const { data: updatedRows, error: updateErr } = await supabase
    .from('bank_feed_transactions')
    .update({
      status: 'reconciled',
      idempotency_key: idempotencyKey,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('status', 'auto_matched')
    .in('id', plan.reconciled_ids)
    .select('id')

  if (updateErr) throw updateErr
  const updatedCount = (updatedRows ?? []).length
  if (updatedCount === 0) {
    throw new Error('No auto_matched transactions remained eligible for reconciliation.')
  }

  const { data: ledgerRow, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      ...plan.ledger_draft,
      after_state: {
        ...(plan.ledger_draft.after_state ?? {}),
        idempotency_key: idempotencyKey,
      },
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerRow) {
    throw ledgerErr ?? new Error('Unable to record bank reconciliation in ledger.')
  }

  return {
    reconciledCount: updatedCount,
    agentLedgerEntry: ledgerRow as AgentActionLedgerEntry,
  }
}

export async function fetchJobMarginRecords(
  workspaceId: string,
): Promise<JobMarginRecord[]> {
  assertSupabaseConfigured()
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
  assertSupabaseConfigured()
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
  idempotencyKey = createIdempotencyKey(),
): Promise<{
  updatedJob: JobMarginRecord
  agentLedgerEntry: AgentActionLedgerEntry
}> {
  assertSupabaseConfigured()
  const plan = buildDraftChangeOrderPlan({ workspaceId, job })
  if (plan.change_order_cents <= 0) {
    throw new Error('Job already meets target gross margin; no change order increase needed.')
  }

  if (typeof supabase.rpc === 'function') {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('apply_job_change_order_atomic', {
      p_workspace_id: workspaceId,
      p_job_id: job.id,
      p_expected_quoted_cents: job.quoted_revenue_cents,
      p_new_quoted_cents: plan.updated_job.quoted_revenue_cents,
      p_new_status: plan.updated_job.status,
      p_idempotency_key: idempotencyKey,
    })
    if (!rpcErr && rpcData && typeof rpcData === 'object') {
      const parsed = rpcData as {
        updated_job: JobMarginRecord
        agent_ledger_entry: AgentActionLedgerEntry
      }
      return {
        updatedJob: parsed.updated_job,
        agentLedgerEntry: parsed.agent_ledger_entry,
      }
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw rpcErr
    }
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from('job_margin_records')
    .update({
      quoted_revenue_cents: plan.updated_job.quoted_revenue_cents,
      status: plan.updated_job.status,
      updated_at: plan.updated_job.updated_at,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', job.id)
    .eq('quoted_revenue_cents', job.quoted_revenue_cents)
    .select('*')
    .single()

  if (jobErr || !jobRow) {
    throw jobErr ?? new Error('Concurrent modification detected or job record unavailable.')
  }

  const { data: ledgerRow, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      ...plan.ledger_draft,
      after_state: {
        ...(plan.ledger_draft.after_state ?? {}),
        idempotency_key: idempotencyKey,
      },
    })
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
