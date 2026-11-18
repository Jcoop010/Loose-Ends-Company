import type {
  CommunicationDraftChannel,
  InventoryMovementKind,
  JobChecklistItem,
  JobPriority,
  JobStatus,
  OpsCoordinationSummary,
  OpsIndustry,
  OpsInvoiceAgingBucket,
  OpsInvoiceAgingKey,
  OpsInvoiceAgingMap,
  OpsSummary,
  OpsTeamMemberStatus,
  PurchaseOrderStatus,
  ServicePlanTemplate,
} from '../types/domain'
import { assertSupabaseConfigured, supabase } from './supabase'

export const OPS_COMMAND_ACTIONS = [
  // Core stock, job, purchasing & policy commands (le_ops.command_core)
  'inventory_save',
  'stock_move',
  'inventory_archive',
  'job_save',
  'reserve_material',
  'job_transition',
  'job_update',
  'release_material',
  'schedule_job',
  'expense_save',
  'policy_save',
  'purchase_draft',
  'purchase_transition',
  'queue_retry',
  // Extended coordination, quotes, dispatch, team & customer commands (le_ops.command)
  'coordination_policy',
  'employee_save',
  'availability_save',
  'availability_remove',
  'estimate_revise',
  'job_details',
  'attachment_add',
  'service_plan_save',
  'service_plan_toggle',
  'booking_update',
  'customer_update',
  'expense_update',
  'draft_save',
  'draft_review',
  'business_retry',
] as const

export type OpsCommandAction = (typeof OPS_COMMAND_ACTIONS)[number]

export interface OpsCommandPayloadMap {
  inventory_save: {
    id?: string
    name: string
    sku: string
    barcode?: string | null
    category?: string | null
    description?: string | null
    supplier?: string | null
    location?: string | null
    purchase_cost: number
    selling_price: number
    reorder_threshold: number
    reorder_quantity: number
  }
  stock_move: {
    id: string
    kind: Extract<InventoryMovementKind, 'receipt' | 'adjustment' | 'return'>
    quantity: number
    reason: string
  }
  inventory_archive: {
    id: string
  }
  job_save: {
    id?: string
    customer_id?: string | null
    assigned_to?: string | null
    title: string
    priority?: JobPriority
    notes?: string | null
    labor_total: number
    checklist?: JobChecklistItem[]
  }
  reserve_material: {
    id: string
    item_id: string
    quantity: number
  }
  job_transition: {
    id: string
    status: Exclude<JobStatus, 'draft'>
    approval_evidence?: string
    checklist_confirmed?: boolean
  }
  job_update: {
    id: string
    assigned_to?: string | null
    notes?: string | null
    checklist?: JobChecklistItem[]
  }
  release_material: {
    id: string
    item_id: string
  }
  schedule_job: {
    id: string
    starts_at: string
    ends_at: string
  }
  expense_save: {
    id?: string
    job_id?: string | null
    vendor: string
    description?: string | null
    amount: number
    due_at?: string | null
    paid?: boolean
  }
  policy_save: {
    enabled: boolean
    draft_limit: number
    industry: OpsIndustry
  }
  purchase_draft: {
    id: string
  }
  purchase_transition: {
    id: string
    status: Exclude<PurchaseOrderStatus, 'draft'>
    receipt_reference?: string
  }
  queue_retry: {
    id: string
  }
  coordination_policy: {
    enabled: boolean
    coordinate_enabled: boolean
    timezone: string
    business_start: string
    business_end: string
    business_days: number[]
    enforce_hours: boolean
    travel_buffer: number
    industry: OpsIndustry
  }
  employee_save: {
    user_id: string
    display_name: string
    job_title?: string | null
    phone?: string | null
    skills?: string[]
    active: boolean
  }
  availability_save: {
    id?: string
    user_id: string
    starts_at: string
    ends_at: string
    available: boolean
    reason?: string | null
  }
  availability_remove: {
    id: string
  }
  estimate_revise: {
    id: string
    title?: string
    labor_total?: number
    reason: string
  }
  job_details: {
    id: string
    service_details: Record<string, string>
  }
  attachment_add: {
    id?: string
    job_id: string
    name: string
    url: string
  }
  service_plan_save: {
    id?: string
    customer_id?: string | null
    assigned_to?: string | null
    title: string
    interval_days: number
    next_due: string
    enabled?: boolean
    template?: ServicePlanTemplate
  }
  service_plan_toggle: {
    id: string
    enabled: boolean
  }
  booking_update:
    | {
        id: string
        status: 'cancelled'
      }
    | {
        id: string
        starts_at: string
        ends_at: string
        assigned_worker?: string | null
        status?: 'scheduled'
      }
  customer_update: {
    id: string
    first_name: string
    last_name?: string | null
    phone?: string | null
    email?: string | null
    notes?: string | null
  }
  expense_update: {
    id: string
    paid: boolean
  }
  draft_save: {
    id?: string
    customer_id: string
    channel: CommunicationDraftChannel
    subject: string
    message: string
  }
  draft_review: {
    id: string
    status: 'approved' | 'rejected'
  }
  business_retry: {
    id: string
  }
}

export interface OpsCommandResponse {
  id: string
  verified?: boolean
  confirmed?: boolean
  status?: string
  invoice_id?: string | null
  quote_id?: string | null
  revision?: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertFinitePayload(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Numeric command values must be finite numbers.')
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFinitePayload(item)
    return
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertFinitePayload(entry)
  }
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID()
}

/**
 * Executes an authorized, advisory-locked operational mutation via `public.ops_command`.
 * Defaults to a fresh `crypto.randomUUID()` receipt; callers retrying an unchanged request
 * should pass the same `idempotencyKey` to guarantee exactly-once reconciliation.
 */
export async function opsCommand<A extends OpsCommandAction>(
  workspaceId: string,
  action: A,
  payload: OpsCommandPayloadMap[A],
  idempotencyKey: string = crypto.randomUUID(),
): Promise<OpsCommandResponse> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Valid workspace UUID is required.')
  }
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 150) {
    throw new Error('Idempotency key must be between 8 and 150 characters.')
  }
  assertFinitePayload(payload)

  const { data, error } = await supabase.rpc('ops_command', {
    p_workspace: workspaceId,
    p_action: action,
    p_payload: payload,
    p_key: idempotencyKey,
  })
  if (error) throw error
  return (data ?? { id: '', confirmed: true }) as OpsCommandResponse
}

const EMPTY_OPS_SUMMARY: OpsSummary = {
  open_jobs: 0,
  open_estimates: 0,
  today_jobs: 0,
  low_stock: 0,
  inventory_value: 0,
  urgent_tasks: 0,
  invoice_total: 0,
  unpaid_invoices: 0,
  owner_reported_paid: 0,
  verified_collections: 0,
  expenses: 0,
  bills_due: 0,
  awaiting_approval: 0,
  failed_operations: 0,
}

const EMPTY_COORDINATION_SUMMARY: OpsCoordinationSummary = {
  events_pending: 0,
  events_completed: 0,
  events_failed: 0,
  verified_tasks: 0,
  completed_tasks: 0,
  drafts_waiting: 0,
  recurring_services: 0,
}

export async function fetchOpsSummary(workspaceId: string): Promise<OpsSummary> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) throw new Error('Valid workspace UUID is required.')
  const { data, error } = await supabase.rpc('ops_summary', { p_workspace: workspaceId })
  if (error) throw error
  return { ...EMPTY_OPS_SUMMARY, ...((data as Partial<OpsSummary> | null) ?? {}) }
}

export async function fetchOpsCoordinationSummary(
  workspaceId: string,
): Promise<OpsCoordinationSummary> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) throw new Error('Valid workspace UUID is required.')
  const { data, error } = await supabase.rpc('ops_coordination_summary', {
    p_workspace: workspaceId,
  })
  if (error) throw error
  return {
    ...EMPTY_COORDINATION_SUMMARY,
    ...((data as Partial<OpsCoordinationSummary> | null) ?? {}),
  }
}

export async function fetchOpsTeamStatus(workspaceId: string): Promise<OpsTeamMemberStatus[]> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) throw new Error('Valid workspace UUID is required.')
  const { data, error } = await supabase.rpc('ops_team_status', { p_workspace: workspaceId })
  if (error) throw error
  return Array.isArray(data) ? (data as OpsTeamMemberStatus[]) : []
}

const AGING_LABELS: Record<OpsInvoiceAgingKey, string> = {
  not_due: 'Current (not yet due)',
  days_1_30: '1–30 days past due',
  days_31_60: '31–60 days past due',
  days_61_90: '61–90 days past due',
  over_90: 'Over 90 days past due',
}

export async function fetchOpsInvoiceAging(
  workspaceId: string,
): Promise<{ buckets: OpsInvoiceAgingBucket[]; raw: OpsInvoiceAgingMap }> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(workspaceId)) throw new Error('Valid workspace UUID is required.')
  const { data, error } = await supabase.rpc('ops_invoice_aging', { p_workspace: workspaceId })
  if (error) throw error

  const payload = (data as Partial<OpsInvoiceAgingMap> | null) ?? {}
  const keys: OpsInvoiceAgingKey[] = ['not_due', 'days_1_30', 'days_31_60', 'days_61_90', 'over_90']
  const raw = keys.reduce((acc, key) => {
    acc[key] = Number(payload[key] ?? 0)
    return acc
  }, {} as OpsInvoiceAgingMap)

  const buckets: OpsInvoiceAgingBucket[] = keys.map(key => ({
    key,
    label: AGING_LABELS[key],
    amount: raw[key],
  }))

  return { buckets, raw }
}

/**
 * Atomically records an owner-confirmed collected opportunity amount and writes
 * the corresponding recovery ledger entry via `public.collect_opportunity`.
 */
export async function collectOpportunity(
  opportunityId: string,
  amount: number,
): Promise<{ collected: boolean; alreadyCollected: boolean }> {
  assertSupabaseConfigured()
  if (!UUID_PATTERN.test(opportunityId)) {
    throw new Error('Valid opportunity UUID is required.')
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    throw new Error('Enter a valid collected dollar amount greater than $0.')
  }

  const { data, error } = await supabase.rpc('collect_opportunity', {
    p_opportunity_id: opportunityId,
    p_amount: Math.round(amount * 100) / 100,
  })
  if (error) throw error

  const alreadyCollected = data === false
  return {
    collected: !alreadyCollected,
    alreadyCollected,
  }
}
