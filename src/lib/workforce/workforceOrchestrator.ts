export type WorkforceRole =
  | 'ceo_orchestrator'
  | 'market_research'
  | 'prospect_qualification'
  | 'business_intelligence'
  | 'sales_followup'
  | 'financial_operations'
  | 'document_processing'
  | 'customer_operations'
  | 'compliance_quality'
  | 'engineering_monitoring'

export type WorkforceProvider =
  | 'gemini'
  | 'grok'
  | 'ollama_local'
  | 'opencode'
  | 'deterministic_engine'

export type WorkforceTaskStatus =
  | 'queued'
  | 'leased'
  | 'awaiting_approval'
  | 'completed'
  | 'dead_letter'
  | 'cancelled'

export type WorkforceApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'

export interface WorkforceRolePolicy {
  role: WorkforceRole
  label: string
  default_provider: WorkforceProvider
  can_write: boolean
  requires_human_approval: boolean
  allowed_tools: readonly string[]
}

export const MAX_DELEGATION_HOPS = 2
export const DEFAULT_MAX_ATTEMPTS = 3

export const WORKFORCE_ROLE_POLICIES: Readonly<Record<WorkforceRole, WorkforceRolePolicy>> = {
  ceo_orchestrator: {
    role: 'ceo_orchestrator',
    label: 'CEO / Orchestrator',
    default_provider: 'gemini',
    can_write: false,
    requires_human_approval: true,
    allowed_tools: ['get_workspace_overview', 'stage_task', 'escalate_to_owner'],
  },
  market_research: {
    role: 'market_research',
    label: 'Market Research Agent',
    default_provider: 'deterministic_engine',
    can_write: false,
    requires_human_approval: true,
    allowed_tools: ['list_public_leads', 'search_regional_markets'],
  },
  prospect_qualification: {
    role: 'prospect_qualification',
    label: 'Prospect Qualification Agent',
    default_provider: 'grok',
    can_write: true,
    requires_human_approval: true,
    allowed_tools: ['upsert_public_lead', 'save_ops_readiness_audit'],
  },
  business_intelligence: {
    role: 'business_intelligence',
    label: 'Business Intelligence Agent',
    default_provider: 'deterministic_engine',
    can_write: false,
    requires_human_approval: false,
    allowed_tools: ['list_revenue_leaks', 'list_ar_summary', 'get_cashflow_summary', 'get_job_margin_alerts'],
  },
  sales_followup: {
    role: 'sales_followup',
    label: 'Sales & Follow-Up Agent',
    default_provider: 'ollama_local',
    can_write: true,
    requires_human_approval: true,
    allowed_tools: ['queue_communication_draft', 'create_quote_draft'],
  },
  financial_operations: {
    role: 'financial_operations',
    label: 'Financial Operations Agent',
    default_provider: 'deterministic_engine',
    can_write: true,
    requires_human_approval: true,
    allowed_tools: ['stage_purchase_order', 'get_bank_reconciliation_status', 'run_three_way_match'],
  },
  document_processing: {
    role: 'document_processing',
    label: 'Document Processing Agent',
    default_provider: 'ollama_local',
    can_write: true,
    requires_human_approval: true,
    allowed_tools: ['simulate_inbound_bill_capture', 'parse_document'],
  },
  customer_operations: {
    role: 'customer_operations',
    label: 'Customer Operations Agent',
    default_provider: 'grok',
    can_write: true,
    requires_human_approval: true,
    allowed_tools: ['list_jobs_schedule', 'stage_customer_followup'],
  },
  compliance_quality: {
    role: 'compliance_quality',
    label: 'Compliance & Quality Agent',
    default_provider: 'gemini',
    can_write: false,
    requires_human_approval: false,
    allowed_tools: ['check_customer_consent', 'list_compliance_expirations', 'get_audit_logs'],
  },
  engineering_monitoring: {
    role: 'engineering_monitoring',
    label: 'Engineering & Monitoring Agent',
    default_provider: 'opencode',
    can_write: false,
    requires_human_approval: true,
    allowed_tools: ['get_workspace_overview', 'check_health_metrics'],
  },
}

export interface WorkforceTask {
  id: string
  workspace_id: string
  correlation_id: string
  parent_task_id: string | null
  assigned_role: WorkforceRole
  provider: WorkforceProvider
  title: string
  expected_outcome: string
  completion_test: string
  payload: Record<string, unknown>
  hop_count: number
  max_hops: number
  visited_roles: WorkforceRole[]
  lease_token: string | null
  lease_expires_at: string | null
  attempts: number
  max_attempts: number
  next_retry_at: string | null
  budget_cents: number
  spent_cents: number
  token_budget: number
  tokens_used: number
  requires_human_approval: boolean
  approval_status: WorkforceApprovalStatus
  status: WorkforceTaskStatus
  dead_letter_reason: string | null
  escalated_to: string | null
  idempotency_key: string
  deadline_at: string
  created_at: string
  updated_at: string
}

function assertPositiveBudgetInt(val: number, label: string): number {
  if (!Number.isSafeInteger(val) || val < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`)
  }
  return val
}

/**
 * Enqueues a task in the shared ledger with duplicate idempotency detection,
 * explicit outcome/budget/deadline/completion_test, and fail-closed approval policy.
 */
export function enqueueWorkforceTask(params: {
  existingTasks: readonly WorkforceTask[]
  id: string
  workspaceId: string
  correlationId: string
  assignedRole: WorkforceRole
  title: string
  expectedOutcome: string
  completionTest: string
  idempotencyKey: string
  deadlineIso: string
  nowIso: string
  budgetCents?: number
  tokenBudget?: number
  payload?: Record<string, unknown>
}): { task: WorkforceTask; duplicate: boolean } {
  const cleanKey = params.idempotencyKey.trim()
  if (!cleanKey) {
    throw new Error('idempotencyKey is required for workforce task creation.')
  }
  if (!params.expectedOutcome.trim() || !params.completionTest.trim()) {
    throw new Error('Every workforce task must define expectedOutcome and completionTest.')
  }
  const existing = params.existingTasks.find(
    t => t.workspace_id === params.workspaceId && t.idempotency_key === cleanKey,
  )
  if (existing) {
    return { task: existing, duplicate: true }
  }

  const policy = WORKFORCE_ROLE_POLICIES[params.assignedRole]
  const task: WorkforceTask = {
    id: params.id,
    workspace_id: params.workspaceId,
    correlation_id: params.correlationId,
    parent_task_id: null,
    assigned_role: params.assignedRole,
    provider: policy.default_provider,
    title: params.title.trim(),
    expected_outcome: params.expectedOutcome.trim(),
    completion_test: params.completionTest.trim(),
    payload: params.payload ?? {},
    hop_count: 0,
    max_hops: MAX_DELEGATION_HOPS,
    visited_roles: [params.assignedRole],
    lease_token: null,
    lease_expires_at: null,
    attempts: 0,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    next_retry_at: null,
    budget_cents: assertPositiveBudgetInt(params.budgetCents ?? 500, 'budgetCents'),
    spent_cents: 0,
    token_budget: assertPositiveBudgetInt(params.tokenBudget ?? 20_000, 'tokenBudget'),
    tokens_used: 0,
    requires_human_approval: policy.requires_human_approval,
    approval_status: policy.requires_human_approval ? 'pending' : 'not_required',
    status: 'queued',
    dead_letter_reason: null,
    escalated_to: null,
    idempotency_key: cleanKey,
    deadline_at: params.deadlineIso,
    created_at: params.nowIso,
    updated_at: params.nowIso,
  }

  return { task, duplicate: false }
}

/**
 * Prevents endless agent delegation loops AND blocks privilege escalation from
 * read-only roles trying to delegate write tasks indirectly.
 */
export function delegateWorkforceTask(params: {
  parentTask: WorkforceTask
  childId: string
  targetRole: WorkforceRole
  title: string
  expectedOutcome: string
  completionTest: string
  idempotencyKey: string
  nowIso: string
}): WorkforceTask {
  const fromPolicy = WORKFORCE_ROLE_POLICIES[params.parentTask.assigned_role]
  const toPolicy = WORKFORCE_ROLE_POLICIES[params.targetRole]

  if (params.parentTask.hop_count >= params.parentTask.max_hops) {
    throw new Error(
      `Delegation rejected: max hop cap (${params.parentTask.max_hops}) reached for correlation ${params.parentTask.correlation_id}.`,
    )
  }
  if (params.parentTask.visited_roles.includes(params.targetRole)) {
    throw new Error(
      `Delegation cycle rejected: role "${params.targetRole}" already visited in chain [${params.parentTask.visited_roles.join(' -> ')}].`,
    )
  }
  if (!fromPolicy.can_write && params.parentTask.assigned_role !== 'ceo_orchestrator' && toPolicy.can_write) {
    throw new Error(
      `Privilege escalation blocked: read-only role "${params.parentTask.assigned_role}" cannot delegate write work to "${params.targetRole}".`,
    )
  }

  const remainingCents = Math.max(0, params.parentTask.budget_cents - params.parentTask.spent_cents)
  const remainingTokens = Math.max(0, params.parentTask.token_budget - params.parentTask.tokens_used)

  return {
    id: params.childId,
    workspace_id: params.parentTask.workspace_id,
    correlation_id: params.parentTask.correlation_id,
    parent_task_id: params.parentTask.id,
    assigned_role: params.targetRole,
    provider: toPolicy.default_provider,
    title: params.title.trim(),
    expected_outcome: params.expectedOutcome.trim(),
    completion_test: params.completionTest.trim(),
    payload: {},
    hop_count: params.parentTask.hop_count + 1,
    max_hops: params.parentTask.max_hops,
    visited_roles: [...params.parentTask.visited_roles, params.targetRole],
    lease_token: null,
    lease_expires_at: null,
    attempts: 0,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    next_retry_at: null,
    budget_cents: remainingCents,
    spent_cents: 0,
    token_budget: remainingTokens,
    tokens_used: 0,
    requires_human_approval: toPolicy.requires_human_approval,
    approval_status: toPolicy.requires_human_approval ? 'pending' : 'not_required',
    status: 'queued',
    dead_letter_reason: null,
    escalated_to: null,
    idempotency_key: params.idempotencyKey.trim(),
    deadline_at: params.parentTask.deadline_at,
    created_at: params.nowIso,
    updated_at: params.nowIso,
  }
}

export function assertWorkforceToolPermission(role: WorkforceRole, toolName: string): void {
  const policy = WORKFORCE_ROLE_POLICIES[role]
  if (!policy.allowed_tools.includes(toolName)) {
    throw new Error(`Role "${role}" is not permitted to invoke tool "${toolName}".`)
  }
}

export function claimWorkforceTask(
  task: WorkforceTask,
  leaseToken: string,
  nowIso: string,
  leaseSeconds = 300,
): WorkforceTask {
  const nowMs = Date.parse(nowIso)
  if (Date.parse(task.deadline_at) <= nowMs) {
    throw new Error(`Task ${task.id} passed deadline ${task.deadline_at}.`)
  }
  if (task.status === 'leased' && task.lease_expires_at && Date.parse(task.lease_expires_at) > nowMs) {
    throw new Error(`Task ${task.id} already holds an active lease until ${task.lease_expires_at}.`)
  }
  if (task.status === 'dead_letter' || task.status === 'completed' || task.status === 'cancelled') {
    throw new Error(`Task ${task.id} is in terminal status ${task.status}.`)
  }
  if (task.attempts >= task.max_attempts) {
    throw new Error(`Task ${task.id} exceeded max attempts (${task.max_attempts}).`)
  }
  const expiresIso = new Date(nowMs + Math.max(30, leaseSeconds) * 1000).toISOString()
  return {
    ...task,
    status: 'leased',
    lease_token: leaseToken,
    lease_expires_at: expiresIso,
    attempts: task.attempts + 1,
    updated_at: nowIso,
  }
}

export function recordWorkforceTaskUsage(params: {
  task: WorkforceTask
  addCents: number
  addTokens: number
  nowIso: string
}): WorkforceTask {
  const nextCents = params.task.spent_cents + assertPositiveBudgetInt(params.addCents, 'addCents')
  const nextTokens = params.task.tokens_used + assertPositiveBudgetInt(params.addTokens, 'addTokens')

  if (nextCents > params.task.budget_cents || nextTokens > params.task.token_budget) {
    return {
      ...params.task,
      spent_cents: nextCents,
      tokens_used: nextTokens,
      status: 'dead_letter',
      dead_letter_reason: `Budget exhausted (${nextCents}c/${params.task.budget_cents}c, ${nextTokens}/${params.task.token_budget} tokens)`,
      escalated_to: 'owner',
      lease_token: null,
      lease_expires_at: null,
      updated_at: params.nowIso,
    }
  }

  return {
    ...params.task,
    spent_cents: nextCents,
    tokens_used: nextTokens,
    updated_at: params.nowIso,
  }
}

export function recordWorkforceTaskFailure(params: {
  task: WorkforceTask
  errorMessage: string
  nowIso: string
}): WorkforceTask {
  const exhausted = params.task.attempts >= params.task.max_attempts
  if (exhausted) {
    return {
      ...params.task,
      status: 'dead_letter',
      dead_letter_reason: params.errorMessage,
      escalated_to: 'ceo_orchestrator:owner',
      lease_token: null,
      lease_expires_at: null,
      updated_at: params.nowIso,
    }
  }
  const backoffSeconds = Math.pow(2, params.task.attempts) * 60
  const retryAt = new Date(Date.parse(params.nowIso) + backoffSeconds * 1000).toISOString()
  return {
    ...params.task,
    status: 'queued',
    next_retry_at: retryAt,
    lease_token: null,
    lease_expires_at: null,
    updated_at: params.nowIso,
  }
}

export function completeWorkforceTask(
  task: WorkforceTask,
  leaseToken: string,
  nowIso: string,
): WorkforceTask {
  if (task.lease_token !== leaseToken) {
    throw new Error('Stale lease token cannot complete task.')
  }
  if (task.requires_human_approval && task.approval_status !== 'approved') {
    return {
      ...task,
      status: 'awaiting_approval',
      lease_token: null,
      lease_expires_at: null,
      updated_at: nowIso,
    }
  }
  return {
    ...task,
    status: 'completed',
    lease_token: null,
    lease_expires_at: null,
    updated_at: nowIso,
  }
}
