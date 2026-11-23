import type { BotAutonomyMode, StagedOpsAction } from '../../types/domain'
import { createIdempotencyKey } from '../opsCommand'
import { assertSupabaseConfigured, supabase } from '../supabase'
import type {
  AutonomousInvoice,
  DunningDraftProposal,
  InvoiceDunningEventRecord,
  InvoicePaymentMethod,
  InvoicePaymentRecord,
  InvoicePaymentType,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function fetchInvoicePayments(
  workspaceId: string,
): Promise<InvoicePaymentRecord[]> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('invoice_payments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('recorded_at', { ascending: false })
    .limit(200)

  if (error) throw error
  return (data ?? []) as InvoicePaymentRecord[]
}

export async function fetchInvoiceDunningEvents(
  workspaceId: string,
): Promise<InvoiceDunningEventRecord[]> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('invoice_dunning_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('drafted_at', { ascending: false })
    .limit(200)

  if (error) throw error
  return (data ?? []) as InvoiceDunningEventRecord[]
}

export async function fetchDunningApprovalQueue(
  workspaceId: string,
): Promise<StagedOpsAction[]> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('staged_ops_actions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('action_type', 'dunning_reminder')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as StagedOpsAction[]
}

export async function fetchCollectionsBotMode(
  workspaceId: string,
): Promise<BotAutonomyMode> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('bot_manuals')
    .select('mode')
    .eq('workspace_id', workspaceId)
    .eq('bot_role', 'collections')
    .maybeSingle()

  if (error) throw error
  const rawMode = (data as { mode?: string } | null)?.mode
  if (
    rawMode === 'observe' ||
    rawMode === 'propose' ||
    rawMode === 'draft_and_approve' ||
    rawMode === 'auto_with_escalation'
  ) {
    return rawMode
  }
  return 'propose'
}

export async function convertQuoteToInvoiceAtomic(params: {
  workspaceId: string
  quoteId: string
  depositRequiredBps?: number
  dueDays?: number
  idempotencyKey?: string
}): Promise<{ invoice: AutonomousInvoice; duplicate: boolean }> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(params.workspaceId) || !UUID_PATTERN.test(params.quoteId)) {
    throw new Error('Valid workspace and quote UUIDs are required.')
  }

  const { data: userRes } = await supabase.auth.getUser()
  const idempotencyKey = params.idempotencyKey ?? `quote_conv:${params.quoteId}`
  const depositBps = Math.max(0, Math.min(10_000, Math.trunc(params.depositRequiredBps ?? 0)))
  const dueDays = Math.max(1, Math.min(365, Math.trunc(params.dueDays ?? 30)))

  const { data, error } = await supabase.rpc('convert_quote_to_invoice_atomic', {
    p_workspace_id: params.workspaceId,
    p_quote_id: params.quoteId,
    p_deposit_required_bps: depositBps,
    p_due_days: dueDays,
    p_idempotency_key: idempotencyKey,
    p_actor_user_id: userRes.user?.id ?? null,
  })

  if (error || !data || typeof data !== 'object') {
    throw error ?? new Error('Unable to convert quote to invoice.')
  }

  const parsed = data as { invoice?: AutonomousInvoice; duplicate?: boolean }
  if (!parsed.invoice) {
    throw new Error('Quote conversion RPC did not return an invoice record.')
  }
  return {
    invoice: parsed.invoice,
    duplicate: Boolean(parsed.duplicate),
  }
}

export async function recordInvoicePaymentAtomic(params: {
  workspaceId: string
  invoiceId: string
  amountCents: number
  paymentType: InvoicePaymentType
  paymentMethod: InvoicePaymentMethod
  stripePaymentIntentId?: string | null
  notes?: string | null
  idempotencyKey?: string
}): Promise<{
  invoice: AutonomousInvoice
  payment: InvoicePaymentRecord
  duplicate: boolean
}> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(params.workspaceId) || !UUID_PATTERN.test(params.invoiceId)) {
    throw new Error('Valid workspace and invoice UUIDs are required.')
  }
  if (!Number.isSafeInteger(params.amountCents) || params.amountCents <= 0) {
    throw new Error('Payment amount must be a positive integer cent value.')
  }

  const { data: userRes } = await supabase.auth.getUser()
  const idempotencyKey = params.idempotencyKey ?? createIdempotencyKey()

  const { data, error } = await supabase.rpc('record_invoice_payment_atomic', {
    p_workspace_id: params.workspaceId,
    p_invoice_id: params.invoiceId,
    p_amount_cents: params.amountCents,
    p_payment_type: params.paymentType,
    p_payment_method: params.paymentMethod,
    p_stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
    p_notes: params.notes?.trim() || null,
    p_idempotency_key: idempotencyKey,
    p_actor_user_id: userRes.user?.id ?? null,
  })

  if (error || !data || typeof data !== 'object') {
    throw error ?? new Error('Unable to record invoice payment.')
  }

  const parsed = data as {
    invoice?: AutonomousInvoice
    payment?: InvoicePaymentRecord
    duplicate?: boolean
  }
  if (!parsed.invoice || !parsed.payment) {
    throw new Error('Invoice payment RPC did not return payment details.')
  }
  return {
    invoice: parsed.invoice,
    payment: parsed.payment,
    duplicate: Boolean(parsed.duplicate),
  }
}

export async function stageInvoiceDunningAtomic(params: {
  workspaceId: string
  proposal: DunningDraftProposal
}): Promise<{
  status: string
  duplicate: boolean
  stagedAction?: StagedOpsAction
  dunningEvent?: InvoiceDunningEventRecord
}> {
  assertSupabaseConfigured()
  const { workspaceId, proposal } = params
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(proposal.invoice_id)) {
    throw new Error('Valid workspace and invoice UUIDs are required.')
  }

  const { data, error } = await supabase.rpc('stage_invoice_dunning_atomic', {
    p_workspace_id: workspaceId,
    p_invoice_id: proposal.invoice_id,
    p_stage: proposal.stage,
    p_late_fee_cents: proposal.late_fee_cents,
    p_title: proposal.title,
    p_summary: proposal.summary,
    p_payload: {
      subject: proposal.subject,
      draft_body: proposal.draft_body,
      customer_email: proposal.customer_email,
      due_date: proposal.due_date,
      days_past_due: proposal.days_past_due,
      balance_due_cents: proposal.balance_due_cents,
      late_fee_cents: proposal.late_fee_cents,
    },
    p_idempotency_key: proposal.idempotency_key,
  })

  if (error || !data || typeof data !== 'object') {
    throw error ?? new Error('Unable to stage dunning reminder draft.')
  }

  const parsed = data as {
    status?: string
    duplicate?: boolean
    staged_action?: StagedOpsAction
    dunning_event?: InvoiceDunningEventRecord
  }
  return {
    status: parsed.status ?? 'unknown',
    duplicate: Boolean(parsed.duplicate),
    stagedAction: parsed.staged_action,
    dunningEvent: parsed.dunning_event,
  }
}

export async function reviewDunningAction(params: {
  workspaceId: string
  action: StagedOpsAction
  decision: 'approved' | 'rejected'
  editedSummary?: string
  editedDraftBody?: string
}): Promise<StagedOpsAction> {
  assertSupabaseConfigured()
  const { workspaceId, action, decision, editedSummary, editedDraftBody } = params
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(action.id)) {
    throw new Error('Valid workspace and staged action UUIDs are required.')
  }

  const { data: userRes } = await supabase.auth.getUser()
  const nowIso = new Date().toISOString()

  const nextPayload: Record<string, unknown> = {
    ...(action.payload ?? {}),
  }
  if (typeof editedDraftBody === 'string' && editedDraftBody.trim()) {
    nextPayload.draft_body = editedDraftBody.trim()
  }

  const { data, error } = await supabase
    .from('staged_ops_actions')
    .update({
      status: decision,
      summary: editedSummary?.trim() || action.summary,
      payload: nextPayload,
      reviewed_by: userRes.user?.id ?? null,
      reviewed_at: nowIso,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', action.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to update staged dunning action.')
  }

  await supabase
    .from('invoice_dunning_events')
    .update({
      status: decision === 'approved' ? 'approved' : 'dismissed',
    })
    .eq('workspace_id', workspaceId)
    .eq('staged_action_id', action.id)

  return data as StagedOpsAction
}
