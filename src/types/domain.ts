// Comprehensive domain model for Loose Ends OS (Auth, CRM/Recovery, Operations OS, Workflows)

import type { AutonomyRulesMap, WorkspaceModulesEnabled } from '../lib/autonomousOs/types'

export type MemberRole = 'owner' | 'admin' | 'member' | 'staff' | 'viewer'

export interface Workspace {
  id: string
  name: string
  slug?: string | null
  owner_user_id?: string | null
  created_at?: string
  updated_at?: string
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  role: MemberRole
  created_at?: string
  workspaces?: Workspace | Workspace[] | null
}

export interface WorkspaceSettings {
  workspace_id: string
  business_type: string
  timezone: string
  onboarding_completed: boolean
  onboarding_completed_at?: string | null
  modules_enabled?: Partial<WorkspaceModulesEnabled> | null
  autonomy_rules?: Partial<AutonomyRulesMap> | null
  auto_limit_cents?: number | null
  created_at?: string
  updated_at?: string
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'
  | 'unpaid'

export type BillingPlanKey = 'revenue_recovery' | 'starter' | 'growth' | 'scale'

export interface WorkspaceSubscription {
  workspace_id: string
  provider?: string
  provider_customer_id: string | null
  provider_subscription_id: string | null
  plan_key?: BillingPlanKey | string
  status: SubscriptionStatus
  current_period_start?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  billing_livemode?: boolean | null
  updated_at?: string
}

export interface PublicLeadInput {
  name: string
  business: string
  phone: string
  email: string
  business_type?: string | null
  biggest_problem?: string | null
}

// ============================================================================
// CRM, Scheduling, Documents & Revenue Recovery
// ============================================================================

export interface Customer {
  id: string
  workspace_id: string
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  notes: string | null
  external_id?: string | null
  created_at: string
  updated_at?: string
}

export interface CustomerSummaryRef {
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  email?: string | null
}

export type LooseEndStatus = 'open' | 'in_progress' | 'recovered' | 'dismissed'
export type RecoveryStage = 'identified' | 'actioned' | 'engaged' | 'converted' | 'collected'

export interface LooseEnd {
  id: string
  workspace_id: string
  customer_id: string | null
  opportunity_id: string | null
  source_id?: string | null
  source_entity: string
  reason: string
  recommended_action?: string | null
  amount: number
  recovered_amount?: number | null
  score?: number | null
  priority: number | string
  status: LooseEndStatus
  recovery_stage?: RecoveryStage | null
  last_action?: string | null
  last_action_at?: string | null
  next_action_at?: string | null
  due_at?: string | null
  created_at: string
  updated_at?: string
  customers?: CustomerSummaryRef | null
}

export type OpportunityStatus =
  | 'open'
  | 'contacted'
  | 'responded'
  | 'scheduled'
  | 'completed'
  | 'recovered'
  | 'dismissed'

export interface Opportunity {
  id: string
  workspace_id: string
  customer_id: string | null
  title: string
  source: string
  reason: string | null
  status: OpportunityStatus
  amount: number
  recovered_amount: number | null
  recovered_at?: string | null
  priority: number
  confidence_score?: number | null
  due_at?: string | null
  created_at: string
  updated_at?: string
  customers?: CustomerSummaryRef | null
}

export interface RecoveryEvent {
  id: string
  workspace_id: string
  opportunity_id: string | null
  customer_id: string | null
  amount: number
  source: string
  note: string | null
  created_at: string
}

export type FollowUpStatus = 'pending' | 'scheduled' | 'open' | 'completed' | 'dismissed'

export interface FollowUp {
  id: string
  workspace_id: string
  customer_id: string | null
  opportunity_id: string | null
  channel: string
  message: string
  status: FollowUpStatus
  scheduled_at: string | null
  completed_at?: string | null
  created_at: string
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'canceled' | 'no_show'

export interface Appointment {
  id: string
  workspace_id: string
  customer_id: string | null
  ops_job_id?: string | null
  assigned_worker?: string | null
  title: string
  starts_at: string
  ends_at: string | null
  status: AppointmentStatus
  notes: string | null
  created_at?: string
  updated_at?: string
}

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'completed' | 'cancelled'

export interface Task {
  id: string
  workspace_id: string
  customer_id: string | null
  opportunity_id?: string | null
  title: string
  status: TaskStatus
  priority: number
  due_at: string | null
  created_at: string
  updated_at?: string
}

export type DocumentType =
  | 'invoice'
  | 'quote'
  | 'estimate'
  | 'order'
  | 'receipt'
  | 'payment'
  | 'purchase_order'
  | 'other'

export type DocumentStatus = 'draft' | 'sent' | 'overdue' | 'paid' | 'cancelled'

export interface DocumentRecord {
  id: string
  workspace_id: string
  customer_id: string | null
  opportunity_id?: string | null
  document_type: DocumentType
  document_number: string | null
  status: DocumentStatus
  total: number
  due_at: string | null
  created_at: string
  updated_at?: string
}

export interface VerifiedRecoveryPayment {
  id: string
  workspace_id: string
  customer_id: string | null
  opportunity_id?: string | null
  amount_cents: number
  currency: string
  payment_provider: string
  provider_payment_id?: string | null
  provider_verified_at: string
  created_at: string
}

export type ConsentChannel = 'sms' | 'email' | 'call'
export type ConsentDecision = 'granted' | 'revoked'

export interface ConsentEvent {
  id: string
  workspace_id: string
  customer_id: string | null
  channel: ConsentChannel
  decision: ConsentDecision
  evidence_reference: string
  email?: string | null
  status?: string | null
  actor_user_id: string | null
  created_at: string
}

// ============================================================================
// Operations OS Read Tables & RPC Payloads (le_ops / public)
// ============================================================================

export interface InventoryItem {
  id: string
  workspace_id: string
  name: string
  sku: string
  barcode: string | null
  category: string | null
  description: string | null
  supplier: string | null
  location: string | null
  purchase_cost: number
  selling_price: number
  quantity: number
  reserved: number
  reorder_threshold: number
  reorder_quantity: number
  archived: boolean
  created_at: string
  updated_at: string
}

export type InventoryMovementKind =
  | 'receipt'
  | 'adjustment'
  | 'return'
  | 'reserve'
  | 'release'
  | 'consume'

export interface InventoryMovement {
  id: string
  workspace_id: string
  item_id: string
  job_id: string | null
  kind: InventoryMovementKind
  quantity: number
  balance: number
  reason: string
  actor_id: string | null
  created_at: string
}

export type JobStatus =
  | 'draft'
  | 'quoted'
  | 'approved'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export type JobPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface JobChecklistItem {
  title: string
  done: boolean
}

export interface OpsJob {
  id: string
  workspace_id: string
  customer_id: string | null
  title: string
  status: JobStatus
  priority: JobPriority
  assigned_to: string | null
  notes: string | null
  checklist: JobChecklistItem[]
  labor_total: number
  revision: number
  service_details: Record<string, string>
  recurring_plan_id: string | null
  recurring_due: string | null
  approved_at: string | null
  approval_evidence: string | null
  completed_at: string | null
  invoice_id: string | null
  created_at: string
  updated_at: string
}

export type JobMaterialState = 'reserved' | 'consumed' | 'released'

export interface JobMaterial {
  workspace_id: string
  job_id: string
  item_id: string
  quantity: number
  unit_cost: number
  unit_price: number
  state: JobMaterialState
}

export interface OpsQuoteSnapshot {
  job: Partial<OpsJob>
  materials: JobMaterial[]
  revision: number
}

export interface OpsQuoteRevision {
  id: string
  workspace_id: string
  job_id: string
  revision: number
  document_id: string
  snapshot: OpsQuoteSnapshot
  total: number
  actor_id: string | null
  created_at: string
}

export interface OpsQuoteApproval {
  id: string
  workspace_id: string
  job_id: string
  revision: number
  evidence: string
  actor_id: string | null
  approved_at: string
  source: string
  created_at: string
}

export interface OpsJobAttachment {
  id: string
  workspace_id: string
  job_id: string
  name: string
  url: string
  created_at: string
}

export interface ServicePlanTemplate {
  checklist?: JobChecklistItem[]
  labor_total?: number
  service_details?: Record<string, string>
}

export interface OpsServicePlan {
  id: string
  workspace_id: string
  customer_id: string | null
  title: string
  interval_days: number
  next_due: string
  assigned_to: string | null
  enabled: boolean
  template: ServicePlanTemplate
  created_at: string
  updated_at: string
}

export interface OpsAvailability {
  id: string
  workspace_id: string
  user_id: string
  starts_at: string
  ends_at: string
  available: boolean
  reason: string | null
  created_at: string
}

export interface OpsEmployeeProfile {
  workspace_id: string
  user_id: string
  display_name: string
  job_title: string | null
  phone: string | null
  skills: string[]
  active: boolean
  created_at: string
  updated_at: string
}

export type PurchaseOrderStatus = 'draft' | 'approved' | 'denied' | 'received'

export interface OpsPurchaseOrder {
  id: string
  workspace_id: string
  item_id: string
  supplier: string | null
  quantity: number
  unit_cost: number
  status: PurchaseOrderStatus
  approved_by: string | null
  receipt_reference: string | null
  created_at: string
}

export interface OpsExpense {
  id: string
  workspace_id: string
  job_id: string | null
  vendor: string
  description: string | null
  amount: number
  due_at: string | null
  paid: boolean
  created_at: string
}

export type CommunicationDraftChannel = 'email' | 'sms'
export type CommunicationDraftStatus = 'draft' | 'approved' | 'rejected'

export interface OpsCommunicationDraft {
  id: string
  workspace_id: string
  customer_id: string | null
  lead_id?: string | null
  recipient_email?: string | null
  recipient_name?: string | null
  company_name?: string | null
  requires_approval?: boolean
  source_event_id: string | null
  channel: CommunicationDraftChannel
  subject: string
  message: string
  status: CommunicationDraftStatus
  approved_by: string | null
  approved_at: string | null
  delivery_status: 'not_sent' | 'sent' | 'failed'
  sent_at?: string | null
  created_at: string
}

export type OpsIndustry =
  | 'general'
  | 'auto_repair'
  | 'hvac'
  | 'plumbing'
  | 'electrical'
  | 'general_contracting'
  | 'landscaping'
  | 'home_services'

export interface OpsPolicy {
  workspace_id: string
  enabled: boolean
  draft_limit: number
  industry: OpsIndustry
  coordinate_enabled: boolean
  timezone: string
  business_start: string
  business_end: string
  business_days: number[]
  enforce_hours: boolean
  travel_buffer: number
  updated_by?: string | null
  updated_at?: string
}

export type OpsQueueStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'deferred'
  | 'dead_letter'
  | 'cancelled'

export interface OpsQueueItem {
  id: string
  workspace_id: string
  item_id: string
  event_key: string
  status: OpsQueueStatus
  attempts: number
  available_at: string
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
}

export type OpsBusinessEventStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'dead_letter'
  | 'cancelled'

export interface OpsBusinessEvent {
  id: string
  workspace_id: string
  event_key: string
  event_type: string
  entity_type: string
  entity_id: string | null
  customer_id: string | null
  payload: Record<string, unknown>
  status: OpsBusinessEventStatus
  attempts: number
  available_at: string
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
}

export interface OpsAuditEntry {
  id: number
  workspace_id: string
  actor_id: string | null
  action: string
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface OpsSummary {
  open_jobs: number
  open_estimates: number
  today_jobs: number
  low_stock: number
  inventory_value: number
  urgent_tasks: number
  invoice_total: number
  unpaid_invoices: number
  owner_reported_paid: number
  verified_collections: number
  expenses: number
  bills_due: number
  awaiting_approval: number
  failed_operations: number
}

export interface OpsCoordinationSummary {
  events_pending: number
  events_completed: number
  events_failed: number
  verified_tasks: number
  completed_tasks: number
  drafts_waiting: number
  recurring_services: number
}

export interface OpsTeamMemberStatus {
  user_id: string
  role: MemberRole
  display_name: string | null
  job_title: string | null
  phone: string | null
  skills: string[] | null
  active: boolean
  open_jobs: number
}

export type OpsInvoiceAgingKey = 'not_due' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'over_90'

export type OpsInvoiceAgingMap = Record<OpsInvoiceAgingKey, number>

export interface OpsInvoiceAgingBucket {
  key: OpsInvoiceAgingKey
  label: string
  amount: number
}

// ============================================================================
// Workflows & Audit Events
// ============================================================================

export type WorkflowMode = 'manual' | 'automatic' | 'approval'
export type WorkflowTriggerType =
  | 'record_created'
  | 'record_updated'
  | 'record_due'
  | 'manual'
  | 'schedule'

export type WorkflowConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export interface WorkflowCondition {
  field: string
  operator: WorkflowConditionOperator
  value?: string | number | boolean
}

export type WorkflowAction =
  | {
      type: 'create_task'
      title: string
      priority?: number
      delay_hours?: number
    }
  | {
      type: 'create_follow_up'
      channel?: string
      message: string
      delay_hours?: number
    }
  | {
      type: 'update_opportunity'
      delay_hours?: number
      patch: {
        title?: string
        reason?: string
        status?: OpportunityStatus
        priority?: number
        amount?: number
        due_at?: string | null
      }
    }

export interface Workflow {
  id: string
  workspace_id: string
  name: string
  description: string | null
  enabled: boolean
  mode: WorkflowMode
  trigger_type: WorkflowTriggerType
  trigger_config: { entity_type?: string; [key: string]: unknown }
  conditions: WorkflowCondition[]
  actions: WorkflowAction[]
  created_at: string
  updated_at: string
}

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface WorkflowRun {
  id: string
  workspace_id: string
  workflow_id: string
  trigger_event_id: string | null
  status: WorkflowRunStatus
  idempotency_key: string
  context: {
    event?: Record<string, unknown>
    record?: Record<string, unknown>
  }
  result: Record<string, unknown>
  error: string | null
  approved_by?: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface AuditEvent {
  id: string
  workspace_id: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface Customer360Snapshot {
  customer: Customer
  jobs: OpsJob[]
  documents: DocumentRecord[]
  appointments: Appointment[]
  drafts: OpsCommunicationDraft[]
  consentEvents: ConsentEvent[]
  tasks: Task[]
  followUps: FollowUp[]
  opportunities: Opportunity[]
  verifiedPayments: VerifiedRecoveryPayment[]
}

// ============================================================================
// Grok Accounting & Outreach Bots + Cursor MCP Layer
// ============================================================================

export type BotRole =
  | 'chief_of_staff'
  | 'scout'
  | 'dispatcher'
  | 'buyer'
  | 'billing'
  | 'collections'
  | 'qa'
  | 'cash_applications'
  | 'outreach'

export type BotAutonomyMode = 'observe' | 'propose' | 'auto_with_escalation'

export interface WorkspaceMcpToken {
  id: string
  workspace_id: string
  label: string
  token_hash: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface BotManual {
  id: string
  workspace_id: string
  bot_role: BotRole
  mode: BotAutonomyMode
  instructions_markdown: string
  updated_by: string | null
  updated_at: string
}

export type StagedOpsDomain =
  | 'pipeline'
  | 'jobs'
  | 'inventory'
  | 'comms'
  | 'billing'

export type StagedOpsActionType =
  | 'quote_draft'
  | 'job_checklist_flag'
  | 'sms_voicemail_command'
  | 'open_loop_recovery'
  | 'vendor_bill_audit'
  | 'photo_inventory_import'
  | 'purchase_order_draft'
  | 'collection_call_request'
  | 'ops_readiness_scorecard'
  | 'expense_receipt'
  | 'invoice_draft'
  | 'payment_match'
  | 'discrepancy_flag'

export type OpsReadinessGrade = 'A' | 'B' | 'C' | 'D'

export interface OpsReadinessAudit {
  id: string
  workspace_id: string
  lead_id: string | null
  business_name: string
  website_url: string | null
  score_0_100: number
  grade: OpsReadinessGrade
  findings: string[]
  report_html: string
  created_at: string
}

export interface StagedOpsAction {
  id: string
  workspace_id: string
  bot_role: BotRole
  workspace_domain: StagedOpsDomain
  action_type: StagedOpsActionType
  customer_id: string | null
  title: string
  summary: string
  amount_cents: number
  payload: Record<string, unknown>
  confidence_score: number
  status: StagedLedgerEntryStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export type StagedLedgerEntryType =
  | 'invoice_draft'
  | 'expense_receipt'
  | 'payment_match'
  | 'credit_adjustment'
  | 'discrepancy_flag'

export type StagedLedgerEntryStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'applied'

export interface StagedLedgerLineItem {
  description: string
  quantity: number
  unit_price_cents: number
}

export interface StagedLedgerEntry {
  id: string
  workspace_id: string
  bot_role: BotRole
  entry_type: StagedLedgerEntryType
  customer_id: string | null
  vendor_name: string | null
  amount_cents: number
  currency: string
  line_items: StagedLedgerLineItem[]
  reasoning_summary: string
  confidence_score: number
  status: StagedLedgerEntryStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export type BotRunStatus =
  | 'running'
  | 'completed'
  | 'fallback_deterministic'
  | 'failed'

export interface BotRun {
  id: string
  workspace_id: string
  bot_role: BotRole
  model: string
  mode: BotAutonomyMode
  surface?: string
  tool_name?: string
  state_hash?: string | null
  status: BotRunStatus
  input_summary: string
  output_json: Record<string, unknown>
  created_at: string
}
