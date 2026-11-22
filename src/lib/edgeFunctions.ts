import type {
  BillingPlanKey,
  BotRole,
  BotRun,
  ConsentChannel,
  StagedLedgerEntry,
  StagedLedgerLineItem,
  Workspace,
} from '../types/domain'
import {
  CAN_SPAM_B2B_EVIDENCE_REF,
  CAN_SPAM_PHYSICAL_ADDRESS,
  isCanSpamFooterCompliant,
  isConsentEventSuppressed,
} from './canSpamGuard'
import { assertSupabaseConfigured, supabase } from './supabase'

export const CUSTOMER_IMPORT_BATCH_SIZE = 100
export const CUSTOMER_IMPORT_MAX_ROWS = 5000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// In-memory checkpoint map keyed by `${workspaceId}:${sha256}` so interrupted imports
// within the current browser session can resume without touching localStorage.
const activeImportJobCheckpoints = new Map<string, string>()

export interface CustomerImportRowInput {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

export interface CustomerImportJobSummary {
  id: string
  status: 'active' | 'completed' | 'failed' | string
  processed: number
  created: number
  matched: number
  rejected: number
}

export async function bootstrapWorkspace(params?: {
  name?: string
  slug?: string
}): Promise<{ workspace: Workspace | null }> {
  assertSupabaseConfigured()
  const name = params?.name?.trim() || 'My Business'
  const slug =
    params?.slug?.trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') ||
    'my-business'

  const { data, error } = await supabase.functions.invoke('bootstrap-workspace', {
    body: { name, slug },
  })
  if (error) throw error
  return { workspace: (data?.workspace as Workspace | undefined) ?? null }
}

async function extractFunctionErrorMessage(
  data: unknown,
  error: unknown,
  fallback: string,
): Promise<string> {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as { error?: unknown }).error === 'string' &&
    (data as { error: string }).error.trim()
  ) {
    return (data as { error: string }).error
  }

  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (
      typeof context === 'object' &&
      context !== null &&
      'clone' in context &&
      typeof (context as { clone?: unknown }).clone === 'function'
    ) {
      try {
        const cloned = (context as { clone: () => { json: () => Promise<unknown> } }).clone()
        const body = await cloned.json().catch(() => null)
        if (
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof (body as { error?: unknown }).error === 'string' &&
          (body as { error: string }).error.trim()
        ) {
          return (body as { error: string }).error
        }
      } catch {
        // Fall through to error.message
      }
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export async function createSubscriptionCheckout(
  workspaceId: string,
  planKey: BillingPlanKey = 'revenue_recovery',
): Promise<{ url: string }> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('A valid workspace is required before starting checkout.')
  }

  const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
    body: {
      workspace_id: workspaceId,
      plan_key: planKey,
    },
  })
  if (error) {
    throw new Error(await extractFunctionErrorMessage(data, error, 'Checkout unavailable.'))
  }
  const url = (data as { url?: string } | null)?.url
  if (!url) throw new Error('Stripe did not return a checkout URL.')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') {
    throw new Error('Unexpected checkout destination.')
  }
  return { url: parsed.toString() }
}

export async function createBillingPortalSession(workspaceId: string): Promise<{ url: string }> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('A valid workspace is required before opening the billing portal.')
  }

  const { data, error } = await supabase.functions.invoke('create-billing-portal', {
    body: { workspace_id: workspaceId },
  })
  if (error) {
    throw new Error(await extractFunctionErrorMessage(data, error, 'Billing portal unavailable.'))
  }
  const url = (data as { url?: string } | null)?.url
  if (!url) throw new Error('Stripe did not return a billing portal URL.')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'billing.stripe.com') {
    throw new Error('Unexpected billing portal destination.')
  }
  return { url: parsed.toString() }
}

export async function customerBulkImportStep(
  body:
    | { action: 'start'; workspace_id: string }
    | { action: 'status'; workspace_id: string; job_id: string }
    | {
        action: 'batch'
        workspace_id: string
        job_id: string
        batch_number: number
        rows: CustomerImportRowInput[]
      }
    | {
        action: 'finish'
        workspace_id: string
        job_id: string
        expected_batches: number
        expected_rows: number
      },
): Promise<Record<string, unknown>> {
  assertSupabaseConfigured()
  const { data, error } = await supabase.functions.invoke('customer-bulk-import', { body })
  if (error) {
    throw new Error(
      (data as { error?: string } | null)?.error || error.message || 'Customer import request failed.',
    )
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function runCustomerBulkImport(params: {
  workspaceId: string
  rows: CustomerImportRowInput[]
  fingerprint: string
  resumeJobId?: string | null
  onProgress?: (processed: number, total: number, jobId: string) => void
}): Promise<CustomerImportJobSummary> {
  const { workspaceId, rows, fingerprint, resumeJobId, onProgress } = params
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (rows.length < 1 || rows.length > CUSTOMER_IMPORT_MAX_ROWS) {
    throw new Error(`Provide between 1 and ${CUSTOMER_IMPORT_MAX_ROWS.toLocaleString()} customer rows.`)
  }

  const checkpointKey = `${workspaceId}:${fingerprint}`
  let jobId = resumeJobId ?? activeImportJobCheckpoints.get(checkpointKey) ?? null

  if (jobId) {
    try {
      const prior = await customerBulkImportStep({
        action: 'status',
        workspace_id: workspaceId,
        job_id: jobId,
      })
      const priorJob = prior.job as CustomerImportJobSummary | undefined
      if (!priorJob || priorJob.status !== 'active') {
        jobId = null
      }
    } catch {
      jobId = null
    }
  }

  if (!jobId) {
    const started = await customerBulkImportStep({
      action: 'start',
      workspace_id: workspaceId,
    })
    const createdJob = started.job as CustomerImportJobSummary | undefined
    if (!createdJob?.id) {
      throw new Error('Customer import service could not initialize a job.')
    }
    jobId = createdJob.id
    activeImportJobCheckpoints.set(checkpointKey, jobId)
  }

  const totalBatches = Math.ceil(rows.length / CUSTOMER_IMPORT_BATCH_SIZE)
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const offset = batchIndex * CUSTOMER_IMPORT_BATCH_SIZE
    const slice = rows.slice(offset, offset + CUSTOMER_IMPORT_BATCH_SIZE).map(r => ({
      first_name: r.first_name ?? '',
      last_name: r.last_name ?? '',
      email: r.email ?? '',
      phone: r.phone ?? '',
    }))
    const batchResult = await customerBulkImportStep({
      action: 'batch',
      workspace_id: workspaceId,
      job_id: jobId,
      batch_number: batchIndex,
      rows: slice,
    })
    if (!batchResult.receipt) {
      throw new Error(`Batch ${batchIndex + 1} was not acknowledged. Import ID: ${jobId}`)
    }
    onProgress?.(Math.min(rows.length, offset + slice.length), rows.length, jobId)
  }

  const completed = await customerBulkImportStep({
    action: 'finish',
    workspace_id: workspaceId,
    job_id: jobId,
    expected_batches: totalBatches,
    expected_rows: rows.length,
  })
  const finalJob = completed.job as CustomerImportJobSummary | undefined
  if (!finalJob) {
    throw new Error(`Import batches finished, but final verification failed. Import ID: ${jobId}`)
  }

  activeImportJobCheckpoints.delete(checkpointKey)
  return finalJob
}

export interface RecoveryPreflightResult {
  approvalId: string
  queued: boolean
  duplicate: boolean
  deliveryEnabled: boolean
  jobId?: string
  status?: string
}

/**
 * Verifies active channel consent in `customer_contact_consent_events`, writes an
 * `audit_events` approval record (`action: 'recovery_draft_approved'`, `delivery_status: 'not_sent'`),
 * and invokes `recovery-delivery-preflight` (`action: 'enqueue_draft'`).
 * Never transmits external SMS, email, or call messages.
 */
export async function approveAndEnqueueRecoveryDraft(params: {
  workspaceId: string
  opportunityId: string
  customerId: string
  channel: ConsentChannel
  consentEvidenceReference: string
  recipientEmail?: string | null
  message: string
}): Promise<RecoveryPreflightResult> {
  assertSupabaseConfigured()
  const { workspaceId, opportunityId, customerId, channel, recipientEmail, message } = params
  const evidenceReference = params.consentEvidenceReference.trim()

  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(opportunityId) || !UUID_PATTERN.test(customerId)) {
    throw new Error('Valid workspace, opportunity, and customer identifiers are required.')
  }
  if (!['sms', 'email', 'call'].includes(channel)) {
    throw new Error('Select a valid communication channel (sms, email, or call).')
  }
  const canTryCanSpamB2b =
    channel === 'email' &&
    isCanSpamFooterCompliant(message) &&
    (evidenceReference === '' || evidenceReference === CAN_SPAM_B2B_EVIDENCE_REF)
  if (!canTryCanSpamB2b && evidenceReference.length < 8) {
    throw new Error('Provide a consent evidence reference of at least 8 characters.')
  }
  if (!message.trim()) {
    throw new Error('Draft message cannot be empty.')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('Sign in is required before approving a draft.')
  }

  const { data: consentRows, error: consentError } = await supabase
    .from('customer_contact_consent_events')
    .select('id,decision,status,evidence_reference')
    .eq('workspace_id', workspaceId)
    .eq('customer_id', customerId)
    .eq('channel', channel)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)

  if (consentError) throw consentError
  const latestConsent = consentRows?.[0] as
    | { id: string; decision: string; status?: string | null; evidence_reference: string }
    | undefined

  let emailSuppressed = false
  const normalizedRecipientEmail = recipientEmail?.trim().toLowerCase() ?? ''
  if (channel === 'email' && normalizedRecipientEmail) {
    const { data: emailRows, error: emailError } = await supabase
      .from('customer_contact_consent_events')
      .select('id,decision,status')
      .eq('workspace_id', workspaceId)
      .eq('email', normalizedRecipientEmail)
      .limit(25)
    if (emailError) throw emailError
    emailSuppressed = (emailRows ?? []).some(row =>
      isConsentEventSuppressed(row as { decision?: string | null; status?: string | null }),
    )
  }

  const suppressed = emailSuppressed || isConsentEventSuppressed(latestConsent)
  const isCanSpamB2b =
    channel === 'email' &&
    !suppressed &&
    !latestConsent &&
    isCanSpamFooterCompliant(message)

  if (
    suppressed ||
    (!isCanSpamB2b &&
      (!latestConsent ||
        latestConsent.decision !== 'granted' ||
        latestConsent.evidence_reference !== evidenceReference))
  ) {
    throw new Error(
      suppressed
        ? 'Current recorded channel consent is missing, mismatched, or revoked (recipient opted out). Approval blocked.'
        : channel === 'email' && !latestConsent
          ? `B2B email requires physical address (${CAN_SPAM_PHYSICAL_ADDRESS}) and unsubscribe/opt-out instruction, or recorded EMAIL opt-in.`
          : 'Current recorded channel consent is missing, mismatched, or revoked. Approval blocked.',
    )
  }

  const { data: auditRow, error: auditError } = await supabase
    .from('audit_events')
    .insert({
      workspace_id: workspaceId,
      actor_user_id: userData.user.id,
      entity_type: 'opportunity',
      entity_id: opportunityId,
      action: 'recovery_draft_approved',
      metadata: {
        channel,
        consent_reference: isCanSpamB2b ? CAN_SPAM_B2B_EVIDENCE_REF : evidenceReference,
        consent_event_id: isCanSpamB2b ? null : latestConsent!.id,
        consent_basis: isCanSpamB2b ? 'can_spam_b2b' : 'recorded_consent',
        customer_id: customerId,
        recipient_email: normalizedRecipientEmail || null,
        message: message.trim(),
        delivery_status: 'not_sent',
      },
    })
    .select('id')
    .single()

  if (auditError || !auditRow?.id) {
    throw new Error('Draft approval audit record could not be saved.')
  }

  const { data: preflightData, error: preflightError } = await supabase.functions.invoke(
    'recovery-delivery-preflight',
    {
      body: {
        workspace_id: workspaceId,
        approval_id: auditRow.id,
        action: 'enqueue_draft',
      },
    },
  )

  if (preflightError) {
    throw new Error(
      (preflightData as { error?: string } | null)?.error ||
        preflightError.message ||
        'Delivery preflight verification failed.',
    )
  }

  const response = (preflightData ?? {}) as {
    queued?: boolean
    duplicate?: boolean
    delivery_enabled?: boolean
    job_id?: string
    status?: string
  }

  return {
    approvalId: auditRow.id as string,
    queued: Boolean(response.queued),
    duplicate: Boolean(response.duplicate),
    deliveryEnabled: Boolean(response.delivery_enabled),
    jobId: response.job_id,
    status: response.status,
  }
}

export interface WorkflowRunnerResponse {
  ok?: boolean
  status?: string
  processed_events?: number
  results?: Array<Record<string, unknown>>
  outputs?: Array<Record<string, unknown>>
}

export async function invokeWorkflowRunner(
  workspaceId: string,
  options?: { approveRunId?: string },
): Promise<WorkflowRunnerResponse> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const body: Record<string, string> = { workspace_id: workspaceId }
  if (options?.approveRunId) {
    body.approve_run_id = options.approveRunId
  }

  const { data, error } = await supabase.functions.invoke('workflow-runner', { body })
  if (error) {
    throw new Error(
      (data as { error?: string } | null)?.error || error.message || 'Workflow runner failed.',
    )
  }
  return (data ?? {}) as WorkflowRunnerResponse
}

export async function syncQuickBooks(workspaceId: string): Promise<Record<string, unknown>> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  const { data, error } = await supabase.functions.invoke('quickbooks-sync', {
    body: { workspace_id: workspaceId },
  })
  if (error) {
    throw new Error(
      (data as { error?: string } | null)?.error || error.message || 'QuickBooks sync unavailable.',
    )
  }
  return (data ?? {}) as Record<string, unknown>
}

export interface GrokParseDocumentResponse {
  staged_entry: StagedLedgerEntry
  bot_run: BotRun | null
  computed_subtotal_cents: number
  computed_total_cents: number
  has_discrepancy: boolean
}

export async function invokeGrokBotParseDocument(params: {
  workspaceId: string
  botRole?: BotRole
  documentText: string
  imageBase64?: string
}): Promise<GrokParseDocumentResponse> {
  assertSupabaseConfigured()
  const { workspaceId, botRole = 'billing' } = params
  const documentText = params.documentText.trim()
  const imageBase64 = params.imageBase64?.trim() ?? ''

  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (!documentText && !imageBase64) {
    throw new Error('Paste a receipt/invoice or attach an image to parse.')
  }

  const { data, error } = await supabase.functions.invoke('grok-bot-router', {
    body: {
      workspace_id: workspaceId,
      action: 'parse_document',
      bot_role: botRole,
      document_text: documentText,
      image_base64: imageBase64 || undefined,
    },
  })

  if (!error && data && (data as { staged_entry?: StagedLedgerEntry }).staged_entry) {
    return data as GrokParseDocumentResponse
  }

  // Resilient direct-table fallback if Edge Function is warming or offline
  const lines = documentText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
  const vendorMatch = /(?:vendor|supplier|from|merchant)[:\s]+([^\n\r]+)/i.exec(documentText)
  const vendorName = (vendorMatch?.[1] ?? lines[0] ?? 'Submitted Vendor Bill')
    .slice(0, 120)
    .trim()
  const invMatch = /(?:invoice|receipt|bill|po)\s*(?:#|no\.?|number)?[:\s]*([A-Z0-9-]{3,40})/i.exec(
    documentText,
  )
  const invoiceNumber = invMatch?.[1] ?? `DOC-${Date.now().toString().slice(-6)}`
  const taxMatch = /tax[:\s]*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(documentText)
  const taxCents = taxMatch ? Math.round(Number(taxMatch[1]) * 100) : 0
  const totalMatch = /total[:\s]*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(documentText)

  const lineItems: StagedLedgerLineItem[] = []
  const lineRegex = /^(.+?)\s+(?:(\d+(?:\.\d+)?)\s*[x@]\s*)?\$\s*(\d+(?:\.\d{1,2})?)$/i
  for (const line of lines) {
    if (/^(subtotal|tax|total|amount due|balance)/i.test(line)) continue
    const m = lineRegex.exec(line)
    if (m) {
      lineItems.push({
        description: m[1].trim(),
        quantity: m[2] ? Number(m[2]) : 1,
        unit_price_cents: Math.round(Number(m[3]) * 100),
      })
    }
  }

  const computedSubtotalCents = lineItems.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
    0,
  )
  const totalCents = totalMatch
    ? Math.round(Number(totalMatch[1]) * 100)
    : computedSubtotalCents + taxCents

  if (lineItems.length === 0 && totalCents > 0) {
    lineItems.push({
      description: `${vendorName} (${invoiceNumber})`,
      quantity: 1,
      unit_price_cents: Math.max(0, totalCents - taxCents),
    })
  }

  const recomputedSub = lineItems.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
    0,
  )
  const computedTotalCents = recomputedSub + taxCents
  const hasDiscrepancy = Math.abs(totalCents - computedTotalCents) > 1

  const { data: stagedRow, error: stageErr } = await supabase
    .from('staged_ledger_entries')
    .insert({
      workspace_id: workspaceId,
      bot_role: botRole,
      entry_type: hasDiscrepancy ? 'discrepancy_flag' : 'expense_receipt',
      vendor_name: vendorName,
      amount_cents: totalCents,
      currency: 'USD',
      line_items: lineItems,
      reasoning_summary: `Invoice ${invoiceNumber} · Recomputed $${(recomputedSub / 100).toFixed(2)} + tax $${(taxCents / 100).toFixed(2)} = $${(computedTotalCents / 100).toFixed(2)}${hasDiscrepancy ? ` · ARITHMETIC MISMATCH FLAGGED (stated $${(totalCents / 100).toFixed(2)})` : ''}`,
      confidence_score: 0.9,
      status: 'pending_approval',
    })
    .select('*')
    .single()

  if (stageErr) throw stageErr

  const { data: runRow } = await supabase
    .from('bot_runs')
    .insert({
      workspace_id: workspaceId,
      bot_role: botRole,
      model: 'grok-4.7',
      mode: 'propose',
      status: 'fallback_deterministic',
      input_summary: `parse_document: ${vendorName} (${invoiceNumber})`,
      output_json: {
        computed_subtotal_cents: recomputedSub,
        computed_total_cents: computedTotalCents,
        has_discrepancy: hasDiscrepancy,
      },
    })
    .select('*')
    .single()

  return {
    staged_entry: stagedRow as StagedLedgerEntry,
    bot_run: (runRow as BotRun | null) ?? null,
    computed_subtotal_cents: recomputedSub,
    computed_total_cents: computedTotalCents,
    has_discrepancy: hasDiscrepancy,
  }
}

export interface GrokAuditLeaksResponse {
  executive_summary: string
  staged_entries: StagedLedgerEntry[]
  bot_run: BotRun | null
}

export async function invokeGrokBotAuditLeaks(params: {
  workspaceId: string
  leakSummary?: string
}): Promise<GrokAuditLeaksResponse> {
  assertSupabaseConfigured()
  const { workspaceId, leakSummary = '' } = params
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const { data, error } = await supabase.functions.invoke('grok-bot-router', {
    body: {
      workspace_id: workspaceId,
      action: 'audit_billing_leaks',
      bot_role: 'collections',
      leak_summary: leakSummary,
    },
  })

  if (!error && data && typeof (data as { executive_summary?: string }).executive_summary === 'string') {
    return data as GrokAuditLeaksResponse
  }

  throw new Error(
    (data as { error?: string } | null)?.error ||
      error?.message ||
      'Grok leak audit service unavailable.',
  )
}
