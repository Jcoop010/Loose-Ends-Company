import type {
  Appointment,
  ConsentChannel,
  ConsentDecision,
  ConsentEvent,
  Customer,
  Customer360Snapshot,
  DocumentRecord,
  FollowUp,
  InventoryItem,
  Opportunity,
  OpsCommunicationDraft,
  OpsJob,
  PublicLeadInput,
  Task,
  VerifiedRecoveryPayment,
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
