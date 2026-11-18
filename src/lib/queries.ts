import type {
  Appointment,
  ConsentChannel,
  ConsentDecision,
  ConsentEvent,
  Customer,
  Customer360Snapshot,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  FollowUp,
  InventoryItem,
  LooseEnd,
  LooseEndStatus,
  Opportunity,
  OpsCommunicationDraft,
  OpsJob,
  OpsPolicy,
  PublicLeadInput,
  RecoveryStage,
  Task,
  TaskStatus,
  VerifiedRecoveryPayment,
  Workflow,
  WorkflowAction,
  WorkflowCondition,
  WorkflowMode,
  WorkflowTriggerType,
  Workspace,
  WorkspaceSettings,
} from '../types/domain'
import { assertSupabaseConfigured, supabase } from './supabase'

export const WORKSPACE_ROW_SAFETY_LIMIT = 10_000
export const DEFAULT_FETCH_BATCH_SIZE = 500

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function sanitizePostgrestSearchTerm(raw: string, maxLength = 100): string {
  return String(raw ?? '')
    .replace(/[%_,().]/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * Fetches all rows for a workspace table in bounded slices up to `WORKSPACE_ROW_SAFETY_LIMIT` (10,000).
 * Fails closed rather than returning partial customer lists or inaccurate financial totals.
 */
export async function fetchAllWorkspaceRows<T>(params: {
  table: string
  workspaceId: string
  select?: string
  orderBy?: string
  ascending?: boolean
  shouldAbort?: () => boolean
}): Promise<T[] | null> {
  assertSupabaseConfigured()
  const {
    table,
    workspaceId,
    select = '*',
    orderBy = 'created_at',
    ascending = false,
    shouldAbort,
  } = params

  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const rows: T[] = []
  let offset = 0

  while (offset < WORKSPACE_ROW_SAFETY_LIMIT) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('workspace_id', workspaceId)
      .order(orderBy, { ascending })
      .range(offset, offset + DEFAULT_FETCH_BATCH_SIZE - 1)

    if (error) throw error
    if (shouldAbort?.()) return null

    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < DEFAULT_FETCH_BATCH_SIZE) {
      return rows
    }
    offset += batch.length
  }

  throw new Error(
    `Workspace ${table} exceeds the ${WORKSPACE_ROW_SAFETY_LIMIT.toLocaleString()}-row safety limit. Use paginated reporting.`,
  )
}

export async function fetchWorkspacePage<T>(params: {
  table: string
  workspaceId: string
  page?: number
  pageSize?: number
  select?: string
  orderBy?: string
  ascending?: boolean
}): Promise<T[]> {
  assertSupabaseConfigured()
  const {
    table,
    workspaceId,
    page = 0,
    pageSize = 50,
    select = '*',
    orderBy = 'created_at',
    ascending = false,
  } = params

  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const safePage = Math.max(0, Math.trunc(page))
  const safeSize = Math.min(200, Math.max(1, Math.trunc(pageSize)))
  const start = safePage * safeSize
  const end = start + safeSize - 1

  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('workspace_id', workspaceId)
    .order(orderBy, { ascending })
    .range(start, end)

  if (error) throw error
  return (data ?? []) as T[]
}

export async function searchCustomers(
  workspaceId: string,
  rawQuery: string,
  limit = 100,
): Promise<Customer[]> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
  const cleaned = sanitizePostgrestSearchTerm(rawQuery, 120)

  let query = supabase.from('customers').select('*').eq('workspace_id', workspaceId)
  if (cleaned) {
    const pattern = `%${cleaned}%`
    query = query.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
    )
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(safeLimit)
  if (error) throw error
  return (data ?? []) as Customer[]
}

export async function searchInventoryItems(
  workspaceId: string,
  rawQuery = '',
  page = 0,
  pageSize = 50,
): Promise<InventoryItem[]> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const safePage = Math.max(0, Math.trunc(page))
  const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize)))
  const cleaned = sanitizePostgrestSearchTerm(rawQuery, 100)

  let query = supabase
    .from('inventory_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('archived', false)
    .order('sku', { ascending: true })

  if (cleaned) {
    const pattern = `%${cleaned}%`
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`)
  }

  const { data, error } = await query.range(safePage * safeSize, safePage * safeSize + safeSize - 1)
  if (error) throw error
  return (data ?? []) as InventoryItem[]
}

export async function fetchCustomer360(
  workspaceId: string,
  customerId: string,
): Promise<Customer360Snapshot> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(customerId)) {
    throw new Error('Valid workspace and customer UUIDs are required.')
  }

  const [
    customerRes,
    jobsRes,
    docsRes,
    appointmentsRes,
    draftsRes,
    consentRes,
    tasksRes,
    followUpsRes,
    oppsRes,
    verifiedPaymentsRes,
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', customerId)
      .single(),
    supabase
      .from('ops_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('documents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('appointments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('ops_communication_drafts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('customer_contact_consent_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('follow_ups')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('opportunities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('verified_recovery_payments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  for (const res of [
    customerRes,
    jobsRes,
    docsRes,
    appointmentsRes,
    draftsRes,
    consentRes,
    tasksRes,
    followUpsRes,
    oppsRes,
    verifiedPaymentsRes,
  ]) {
    if (res.error) throw res.error
  }

  return {
    customer: customerRes.data as Customer,
    jobs: (jobsRes.data ?? []) as OpsJob[],
    documents: (docsRes.data ?? []) as DocumentRecord[],
    appointments: (appointmentsRes.data ?? []) as Appointment[],
    drafts: (draftsRes.data ?? []) as OpsCommunicationDraft[],
    consentEvents: (consentRes.data ?? []) as ConsentEvent[],
    tasks: (tasksRes.data ?? []) as Task[],
    followUps: (followUpsRes.data ?? []) as FollowUp[],
    opportunities: (oppsRes.data ?? []) as Opportunity[],
    verifiedPayments: (verifiedPaymentsRes.data ?? []) as VerifiedRecoveryPayment[],
  }
}

export async function fetchLatestChannelConsent(
  workspaceId: string,
  customerId: string,
  channel: ConsentChannel,
): Promise<ConsentEvent | null> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('customer_contact_consent_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('customer_id', customerId)
    .eq('channel', channel)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) throw error
  return ((data?.[0] as ConsentEvent | undefined) ?? null)
}

export async function recordCustomerConsentEvent(params: {
  workspaceId: string
  customerId: string
  channel: ConsentChannel
  decision: ConsentDecision
  evidenceReference: string
}): Promise<ConsentEvent> {
  assertSupabaseConfigured()
  const { workspaceId, customerId, channel, decision } = params
  const evidenceReference = params.evidenceReference.trim()

  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(customerId)) {
    throw new Error('Valid workspace and customer UUIDs are required.')
  }
  if (!['sms', 'email', 'call'].includes(channel)) {
    throw new Error('Select a valid communication channel.')
  }
  if (!['granted', 'revoked'].includes(decision)) {
    throw new Error('Consent decision must be granted or revoked.')
  }
  if (evidenceReference.length < 8) {
    throw new Error('Consent evidence reference must be at least 8 characters.')
  }

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    throw new Error('Sign in required to record customer consent.')
  }

  const { data, error } = await supabase
    .from('customer_contact_consent_events')
    .insert({
      workspace_id: workspaceId,
      customer_id: customerId,
      channel,
      decision,
      evidence_reference: evidenceReference,
      actor_user_id: authData.user.id,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as ConsentEvent
}

export interface TableHealthProbe {
  ok: boolean
  count: number
  error?: string
}

export interface WorkspaceHealthSnapshot {
  tables: Record<string, TableHealthProbe>
  enabledWorkflows: TableHealthProbe
  pendingWorkflowApprovals: TableHealthProbe
  failedWorkflowRuns: TableHealthProbe
  quickbooksConnections: TableHealthProbe
  checkedAt: string
}

const HEALTH_PROBE_TABLES = [
  'customers',
  'opportunities',
  'appointments',
  'tasks',
  'documents',
  'follow_ups',
  'recovery_events',
  'workflows',
  'workflow_runs',
  'workflow_events',
  'audit_events',
] as const

async function headCountProbe(
  table: string,
  workspaceId: string,
  filter?: { field: string; value: string | boolean },
): Promise<TableHealthProbe> {
  try {
    let query = supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    if (filter) {
      query = query.eq(filter.field, filter.value)
    }
    const { count, error } = await query
    if (error) {
      return { ok: false, count: 0, error: error.message }
    }
    return { ok: true, count: count ?? 0 }
  } catch (err) {
    return {
      ok: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Probe unavailable',
    }
  }
}

export async function probeWorkspaceTableHealth(
  workspaceId: string,
): Promise<WorkspaceHealthSnapshot> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }

  const [
    tablePairs,
    enabledWorkflows,
    pendingWorkflowApprovals,
    failedWorkflowRuns,
    quickbooksConnections,
  ] = await Promise.all([
    Promise.all(
      HEALTH_PROBE_TABLES.map(async table => [table, await headCountProbe(table, workspaceId)] as const),
    ),
    headCountProbe('workflows', workspaceId, { field: 'enabled', value: true }),
    headCountProbe('workflow_runs', workspaceId, { field: 'status', value: 'waiting_approval' }),
    headCountProbe('workflow_runs', workspaceId, { field: 'status', value: 'failed' }),
    headCountProbe('quickbooks_connections', workspaceId),
  ])

  const tables: Record<string, TableHealthProbe> = {}
  for (const [name, probe] of tablePairs) {
    tables[name] = probe
  }

  return {
    tables,
    enabledWorkflows,
    pendingWorkflowApprovals,
    failedWorkflowRuns,
    quickbooksConnections,
    checkedAt: new Date().toISOString(),
  }
}

export async function submitPublicLead(lead: PublicLeadInput): Promise<void> {
  assertSupabaseConfigured()
  const name = lead.name.trim()
  const business = lead.business.trim()
  const phone = lead.phone.trim()
  const email = lead.email.trim().toLowerCase()

  if (!name || !business || !phone || !email) {
    throw new Error('Name, business, phone, and email are required.')
  }

  const { error } = await supabase.from('public_leads').insert({
    name,
    business,
    phone,
    email,
    business_type: lead.business_type?.trim() || null,
    biggest_problem: lead.biggest_problem?.trim() || null,
  })
  if (error) throw error
}

/**
 * Creates an idempotent/deduplicated follow-up task in `public.tasks` for an actionable
 * revenue leak item. If an open or in-progress task with the same title and customer/opportunity
 * already exists in the workspace, returns `{ task: existing, duplicate: true }`.
 */
export async function createFollowUpTask(params: {
  workspaceId: string
  title: string
  customerId?: string | null
  opportunityId?: string | null
  priority?: number
  dueInHours?: number
}): Promise<{ task: Task; duplicate: boolean }> {
  assertSupabaseConfigured()
  const { workspaceId } = params
  const cleanTitle = params.title.trim().slice(0, 200)
  const customerId = params.customerId ?? null
  const opportunityId = params.opportunityId ?? null

  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (!cleanTitle) {
    throw new Error('Task title is required.')
  }

  let existingQuery = supabase
    .from('tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'in_progress'])
    .ilike('title', cleanTitle)
    .limit(5)

  if (opportunityId) {
    existingQuery = existingQuery.eq('opportunity_id', opportunityId)
  } else if (customerId) {
    existingQuery = existingQuery.eq('customer_id', customerId)
  }

  const { data: existingRows, error: checkError } = await existingQuery
  if (checkError) throw checkError

  const exactMatch = ((existingRows ?? []) as Task[]).find(
    row =>
      row.title.trim().toLowerCase() === cleanTitle.toLowerCase() &&
      (row.customer_id ?? null) === customerId &&
      (row.opportunity_id ?? null) === opportunityId,
  )
  if (exactMatch) {
    return { task: exactMatch, duplicate: true }
  }

  const dueHours = Number.isFinite(params.dueInHours) ? Math.max(1, Number(params.dueInHours)) : 24
  const safePriority = Number.isFinite(params.priority) ? Math.trunc(Number(params.priority)) : 3

  const { data: inserted, error: insertError } = await supabase
    .from('tasks')
    .insert({
      workspace_id: workspaceId,
      customer_id: customerId,
      opportunity_id: opportunityId,
      title: cleanTitle,
      status: 'open',
      priority: safePriority,
      due_at: new Date(Date.now() + dueHours * 3_600_000).toISOString(),
    })
    .select('*')
    .single()

  if (insertError) throw insertError
  return { task: inserted as Task, duplicate: false }
}

export async function updateTaskStatus(params: {
  workspaceId: string
  taskId: string
  status: TaskStatus
}): Promise<Task> {
  assertSupabaseConfigured()
  const { workspaceId, taskId, status } = params
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(taskId)) {
    throw new Error('Valid workspace and task UUIDs are required.')
  }
  const { data, error } = await supabase
    .from('tasks')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .select('*')
    .single()
  if (error) throw error
  return data as Task
}

export async function updateLooseEndStage(params: {
  workspaceId: string
  looseEndId: string
  status: LooseEndStatus
  recoveryStage?: RecoveryStage
  lastAction?: string
}): Promise<LooseEnd> {
  assertSupabaseConfigured()
  const { workspaceId, looseEndId, status, recoveryStage, lastAction } = params
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(looseEndId)) {
    throw new Error('Valid workspace and loose-end UUIDs are required.')
  }
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status,
    updated_at: nowIso,
  }
  if (recoveryStage) patch.recovery_stage = recoveryStage
  if (lastAction) {
    patch.last_action = lastAction
    patch.last_action_at = nowIso
  }

  const { data, error } = await supabase
    .from('loose_ends')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', looseEndId)
    .select('*')
    .single()
  if (error) throw error
  return data as LooseEnd
}

export async function createCustomerRecord(params: {
  workspaceId: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}): Promise<Customer> {
  assertSupabaseConfigured()
  const { workspaceId } = params
  const firstName = params.firstName.trim()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (!firstName) {
    throw new Error('Customer first name is required.')
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      workspace_id: workspaceId,
      first_name: firstName,
      last_name: params.lastName?.trim() || null,
      email: params.email?.trim().toLowerCase() || null,
      phone: params.phone?.trim() || null,
      notes: params.notes?.trim() || null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Customer
}

export async function createDocumentRecord(params: {
  workspaceId: string
  customerId?: string | null
  opportunityId?: string | null
  documentType: DocumentType
  documentNumber: string
  status: DocumentStatus
  total: number
  dueAt?: string | null
}): Promise<DocumentRecord> {
  assertSupabaseConfigured()
  const { workspaceId, documentType, status } = params
  const docNumber = params.documentNumber.trim()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (!docNumber) {
    throw new Error('Document number is required.')
  }
  if (!Number.isFinite(params.total) || params.total < 0) {
    throw new Error('Enter a valid non-negative document total.')
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      workspace_id: workspaceId,
      customer_id: params.customerId || null,
      opportunity_id: params.opportunityId || null,
      document_type: documentType,
      document_number: docNumber,
      status,
      total: Math.round(params.total * 100) / 100,
      due_at: params.dueAt || null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DocumentRecord
}

export async function updateDocumentStatus(params: {
  workspaceId: string
  documentId: string
  status: DocumentStatus
}): Promise<DocumentRecord> {
  assertSupabaseConfigured()
  const { workspaceId, documentId, status } = params
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(documentId)) {
    throw new Error('Valid workspace and document UUIDs are required.')
  }
  const { data, error } = await supabase
    .from('documents')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', documentId)
    .select('*')
    .single()
  if (error) throw error
  return data as DocumentRecord
}

export async function fetchOpsPolicy(workspaceId: string): Promise<OpsPolicy | null> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  const { data, error } = await supabase
    .from('ops_policies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw error
  return (data as OpsPolicy | null) ?? null
}

export async function createWorkflowRecipe(params: {
  workspaceId: string
  name: string
  description?: string | null
  mode: WorkflowMode
  triggerType: WorkflowTriggerType
  entityType: string
  conditions?: WorkflowCondition[]
  actions: WorkflowAction[]
  enabled?: boolean
}): Promise<Workflow> {
  assertSupabaseConfigured()
  const { workspaceId, mode, triggerType, actions } = params
  const cleanName = params.name.trim()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (!cleanName) {
    throw new Error('Workflow name is required.')
  }
  if (actions.length === 0) {
    throw new Error('At least one workflow action is required.')
  }

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      workspace_id: workspaceId,
      name: cleanName,
      description: params.description?.trim() || null,
      enabled: params.enabled ?? true,
      mode,
      trigger_type: triggerType,
      trigger_config: { entity_type: params.entityType },
      conditions: params.conditions ?? [],
      actions,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Workflow
}

export async function toggleWorkflowEnabled(params: {
  workspaceId: string
  workflowId: string
  enabled: boolean
}): Promise<Workflow> {
  assertSupabaseConfigured()
  const { workspaceId, workflowId, enabled } = params
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(workflowId)) {
    throw new Error('Valid workspace and workflow UUIDs are required.')
  }
  const { data, error } = await supabase
    .from('workflows')
    .update({
      enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', workflowId)
    .select('*')
    .single()
  if (error) throw error
  return data as Workflow
}

export async function upsertWorkspaceSettings(params: {
  workspaceId: string
  businessType: string
  timezone: string
  onboardingCompleted: boolean
}): Promise<WorkspaceSettings> {
  assertSupabaseConfigured()
  const { workspaceId, onboardingCompleted } = params
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('workspace_settings')
    .upsert(
      {
        workspace_id: workspaceId,
        business_type: params.businessType.trim() || 'Service Business',
        timezone: params.timezone.trim() || 'America/New_York',
        onboarding_completed: onboardingCompleted,
        onboarding_completed_at: onboardingCompleted ? nowIso : null,
        updated_at: nowIso,
      },
      { onConflict: 'workspace_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceSettings
}

export async function updateWorkspaceName(params: {
  workspaceId: string
  name: string
}): Promise<Workspace> {
  assertSupabaseConfigured()
  const { workspaceId } = params
  const cleanName = params.name.trim()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (cleanName.length < 2) {
    throw new Error('Workspace name must be at least 2 characters.')
  }
  const { data, error } = await supabase
    .from('workspaces')
    .update({
      name: cleanName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', workspaceId)
    .select('*')
    .single()
  if (error) throw error
  return data as Workspace
}
