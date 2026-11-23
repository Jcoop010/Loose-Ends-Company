// Pure domain types and defaults for Loose Ends Autonomous Business OS (zero runtime/SDK imports)

export type AutonomyMode = 'manual' | 'approve_1tap' | 'full_auto'

export type AutonomyActionKey =
  | 'send_quote_followup'
  | 'convert_signed_quote_to_invoice'
  | 'send_invoice_reminder'
  | 'flag_overdue_ar'
  | 'stage_auto_po'
  | 'approve_clean_vendor_bill'
  | 'stage_compliance_notice'

export type WorkspaceModuleKey =
  | 'crm'
  | 'quotes'
  | 'billing'
  | 'inventory'
  | 'bookkeeping'
  | 'projects'
  | 'vault'

export type WorkspaceModulesEnabled = Record<WorkspaceModuleKey, boolean>
export type AutonomyRulesMap = Record<AutonomyActionKey, AutonomyMode>

export interface WorkspaceAutonomyConfig {
  modules_enabled: WorkspaceModulesEnabled
  autonomy_rules: AutonomyRulesMap
  auto_limit_cents: number
}

export const DEFAULT_MODULES_ENABLED: WorkspaceModulesEnabled = {
  crm: true,
  quotes: true,
  billing: true,
  inventory: false,
  bookkeeping: false,
  projects: false,
  vault: true,
}

export const DEFAULT_AUTONOMY_RULES: AutonomyRulesMap = {
  send_quote_followup: 'approve_1tap',
  convert_signed_quote_to_invoice: 'full_auto',
  send_invoice_reminder: 'approve_1tap',
  flag_overdue_ar: 'full_auto',
  stage_auto_po: 'approve_1tap',
  approve_clean_vendor_bill: 'full_auto',
  stage_compliance_notice: 'approve_1tap',
}

export const DEFAULT_AUTO_LIMIT_CENTS = 50000

export const DEFAULT_AUTONOMY_CONFIG: WorkspaceAutonomyConfig = {
  modules_enabled: { ...DEFAULT_MODULES_ENABLED },
  autonomy_rules: { ...DEFAULT_AUTONOMY_RULES },
  auto_limit_cents: DEFAULT_AUTO_LIMIT_CENTS,
}

export const AUTONOMY_ACTION_META: ReadonlyArray<{
  key: AutonomyActionKey
  label: string
  description: string
}> = [
  {
    key: 'convert_signed_quote_to_invoice',
    label: 'Convert Signed Quote to Invoice',
    description: 'Automatically create and issue a matching invoice as soon as a client e-signs in /portal.',
  },
  {
    key: 'send_quote_followup',
    label: 'Stage Quote Follow-Up',
    description: 'Prepare consent-gated follow-up outreach when sent quotes stay open past 72 hours.',
  },
  {
    key: 'send_invoice_reminder',
    label: 'Stage Invoice AR Reminder',
    description: 'Queue friendly overdue payment reminders with portal/payment links after due date.',
  },
  {
    key: 'flag_overdue_ar',
    label: 'Flag Overdue AR & Margin Risks',
    description: 'Scan open receivables and stage prioritized AR recovery items in your ledger.',
  },
  {
    key: 'stage_auto_po',
    label: 'Stage Auto-PO on Low Stock',
    description: 'Generate draft or pre-approved supplier purchase orders when available stock hits reorder point.',
  },
  {
    key: 'approve_clean_vendor_bill',
    label: 'Auto-Match Clean Vendor Bills',
    description: 'Auto-approve PO === GRN === Bill matches within basis-point tolerance and auto-cap.',
  },
  {
    key: 'stage_compliance_notice',
    label: 'Stage Compliance & Renewal Notices',
    description: 'Prepare counterparty renewal or cancellation notice drafts when contracts enter their notice window.',
  },
]

export const WORKSPACE_MODULE_META: ReadonlyArray<{
  key: WorkspaceModuleKey
  label: string
  description: string
  release: 'release_1' | 'release_2' | 'release_3'
}> = [
  {
    key: 'crm',
    label: 'CRM & Pipeline',
    description: 'Customers 360, lead funnel, consent ledger, and outreach drafts.',
    release: 'release_1',
  },
  {
    key: 'quotes',
    label: 'Quotes & E-Sign',
    description: 'Itemized quotes, shareable client /portal/[token] e-sign links, and auto-conversion.',
    release: 'release_1',
  },
  {
    key: 'billing',
    label: 'Invoices & AR',
    description: 'Invoice ledger, collected vs. overdue KPIs, and 1-click collection nudges.',
    release: 'release_1',
  },
  {
    key: 'inventory',
    label: 'Inventory & Procurement',
    description: 'SKU stock counts, reservations, barcode GRN receiving, Auto-POs, and 3-way matching.',
    release: 'release_2',
  },
  {
    key: 'bookkeeping',
    label: 'Bookkeeping & AP',
    description: 'Double-entry cashflow ledger, 90-day forecast, and 3-way matched AP approvals.',
    release: 'release_2',
  },
  {
    key: 'projects',
    label: 'Dispatch & Fulfillment',
    description: 'Task execution checklists, team schedules, and delivery milestones.',
    release: 'release_2',
  },
  {
    key: 'vault',
    label: 'Compliance Vault & Living SOPs',
    description: 'Contract expiry countdowns, auto-renewal notice staging, and auto-compiled operational SOPs.',
    release: 'release_3',
  },
]

export interface LineItemInput {
  id?: string
  description: string
  quantity: number
  unit_price_cents: number
}

export interface CalculatedLineItem {
  id?: string
  position: number
  description: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
}

export interface LineTotalsResult {
  items: CalculatedLineItem[]
  subtotal_cents: number
  tax_bps: number
  tax_cents: number
  total_cents: number
}

export type AutonomyGateDecision = 'execute_now' | 'queue_for_approval' | 'manual_only'

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'signed'
  | 'approved'
  | 'converted'
  | 'declined'
  | 'expired'
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'void'
export type AgentLedgerStatus = 'executed' | 'pending_approval' | 'reversed'

export interface AutonomousQuote {
  id: string
  workspace_id: string
  lead_id: string | null
  customer_id: string | null
  quote_number: string
  title: string
  customer_name: string
  customer_email: string | null
  subtotal_cents: number
  tax_bps: number
  tax_cents: number
  total_cents: number
  status: QuoteStatus
  portal_token: string
  signed_by_name: string | null
  signed_at: string | null
  valid_until: string | null
  notes: string | null
  created_at: string
  updated_at?: string
}

export interface AutonomousQuoteItem {
  id: string
  workspace_id: string
  quote_id: string
  position: number
  description: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  created_at?: string
}

export interface AutonomousInvoice {
  id: string
  workspace_id: string
  quote_id: string | null
  source_quote_id?: string | null
  lead_id: string | null
  customer_id: string | null
  invoice_number: string
  title: string
  customer_name: string
  customer_email: string | null
  subtotal_cents: number
  tax_bps: number
  tax_cents: number
  total_cents: number
  amount_paid_cents: number
  balance_due_cents?: number
  deposit_required_bps?: number
  deposit_cents?: number
  idempotency_key?: string | null
  due_date: string
  stripe_checkout_url: string | null
  stripe_payment_link_url?: string | null
  status: InvoiceStatus
  created_at: string
  updated_at?: string
}

export interface AutonomousInvoiceItem {
  id: string
  workspace_id: string
  invoice_id: string
  position: number
  description: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  created_at?: string
}

export interface AgentActionLedgerEntry {
  id: string
  workspace_id: string
  agent_name: string
  module: string
  action_type: string
  autonomy_mode: AutonomyMode
  summary: string
  impact_cents: number
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  status: AgentLedgerStatus
  reversed_at: string | null
  created_at: string
}

export interface PublicQuotePortalData {
  workspace_name: string
  quote: {
    id: string
    quote_number: string
    title: string
    customer_name: string
    customer_email: string | null
    subtotal_cents: number
    tax_bps: number
    tax_cents: number
    total_cents: number
    status: QuoteStatus
    portal_token: string
    signed_by_name: string | null
    signed_at: string | null
    valid_until: string | null
    notes: string | null
    created_at: string
  }
  items: Array<{
    id: string
    position: number
    description: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
  }>
  invoice: {
    id: string
    invoice_number: string
    title: string
    customer_name: string
    subtotal_cents: number
    tax_cents: number
    total_cents: number
    amount_paid_cents: number
    due_date: string
    stripe_checkout_url: string | null
    status: InvoiceStatus
    created_at: string
  } | null
  invoice_items: Array<{
    id: string
    position: number
    description: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
  }>
  autonomy_decision?: string
}

export interface ArSummaryMetrics {
  totalBilledCents: number
  totalCollectedCents: number
  openArCents: number
  overdueArCents: number
  openCount: number
  overdueCount: number
  paidCount: number
}

// ============================================================================
// Release 2 Types: Inventory, Procurement, 3-Way Match & Native Bookkeeping
// ============================================================================

export interface Release2InventoryItem {
  id: string
  workspace_id: string
  sku: string
  name: string
  location: string | null
  bin_code: string | null
  on_hand_qty: number
  reserved_qty: number
  reorder_point_qty: number
  reorder_qty: number
  unit_cost_cents: number
  unit_price_cents: number
  preferred_vendor: string | null
  lead_time_days: number
  archived?: boolean
  updated_at?: string
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'closed'

export interface PurchaseOrderRecord {
  id: string
  workspace_id: string
  po_number: string
  vendor_name: string
  status: PurchaseOrderStatus
  total_cents: number
  expected_date: string | null
  notes: string | null
  created_at: string
  updated_at?: string
}

export interface PurchaseOrderItemRecord {
  id: string
  workspace_id: string
  po_id: string
  inventory_item_id: string | null
  sku: string
  description: string
  ordered_qty: number
  received_qty: number
  unit_cost_cents: number
  line_total_cents: number
  created_at?: string
}

export interface GoodsReceiptLineItem {
  sku: string
  ordered_qty: number
  received_qty: number
  damaged_qty: number
}

export interface GoodsReceiptRecord {
  id: string
  workspace_id: string
  po_id: string
  received_by: string
  items_json: GoodsReceiptLineItem[]
  received_at: string
  created_at?: string
}

export type VendorBillMatchStatus =
  | 'unmatched'
  | 'matched_clean'
  | 'exception_flagged'
  | 'disputed'
  | 'paid'

export interface VendorBillLineItem {
  sku: string
  description?: string
  quantity: number
  unit_cost_cents: number
}

export interface VendorBillRecord {
  id: string
  workspace_id: string
  po_id: string | null
  vendor_name: string
  invoice_number: string
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  due_date: string
  bill_date?: string | null
  payment_terms_label?: string | null
  early_pay_discount_bps?: number
  early_pay_discount_days?: number
  items_json: VendorBillLineItem[]
  match_status: VendorBillMatchStatus
  match_variance_cents: number
  discrepancy_summary: string | null
  created_at: string
  updated_at?: string
}

export type LedgerEntryType = 'revenue' | 'cogs' | 'expense' | 'ap_scheduled'

export interface LedgerEntryRecord {
  id: string
  workspace_id: string
  entity_id?: string | null
  entry_type: LedgerEntryType
  category: string
  description: string
  amount_cents: number
  occurred_on: string
  source_ref: string | null
  idempotency_key?: string | null
  reversal_of_entry_id?: string | null
  created_at?: string
}

export interface StockEvaluationItem {
  item_id: string
  sku: string
  name: string
  location: string | null
  bin_code: string | null
  preferred_vendor: string
  on_hand_qty: number
  reserved_qty: number
  available_qty: number
  reorder_point_qty: number
  reorder_qty: number
  unit_cost_cents: number
  lead_time_days: number
  is_low_stock: boolean
  shortfall_qty: number
}

export interface AutoPoLineProposal {
  inventory_item_id: string
  sku: string
  description: string
  ordered_qty: number
  unit_cost_cents: number
  line_total_cents: number
}

export interface AutoPoDraftProposal {
  po_number: string
  vendor_name: string
  expected_date: string
  total_cents: number
  status: PurchaseOrderStatus
  autonomy_decision: AutonomyGateDecision
  items: AutoPoLineProposal[]
  ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}

export interface StockEvaluationResult {
  evaluated_items: StockEvaluationItem[]
  low_stock_items: StockEvaluationItem[]
  auto_po_drafts: AutoPoDraftProposal[]
  total_low_stock_count: number
  total_reorder_cost_cents: number
}

export type ThreeWayMatchExceptionCode =
  | 'short_shipment'
  | 'over_shipment_billed'
  | 'unit_price_hike'
  | 'damaged_goods'
  | 'duplicate_invoice'
  | 'unexpected_sku'

export interface ThreeWayMatchException {
  code: ThreeWayMatchExceptionCode
  sku: string
  ordered_qty: number
  received_good_qty: number
  damaged_qty: number
  billed_qty: number
  po_unit_cost_cents: number
  billed_unit_cost_cents: number
  variance_cents: number
  detail: string
}

export interface VendorDisputeDraft {
  requires_approval: true
  vendor_name: string
  invoice_number: string
  po_number: string
  subject: string
  body_markdown: string
  disputed_amount_cents: number
}

export interface ThreeWayMatchLineComparison {
  sku: string
  ordered_qty: number
  received_qty: number
  damaged_qty: number
  good_received_qty: number
  billed_qty: number
  po_unit_cost_cents: number
  billed_unit_cost_cents: number
  po_line_cents: number
  received_payable_cents: number
  billed_line_cents: number
  line_variance_cents: number
}

export interface ThreeWayMatchResult {
  match_status: 'matched_clean' | 'exception_flagged'
  tolerance_bps: number
  po_total_cents: number
  received_payable_cents: number
  billed_total_cents: number
  match_variance_cents: number
  line_comparisons: ThreeWayMatchLineComparison[]
  exceptions: ThreeWayMatchException[]
  discrepancy_summary: string | null
  vendor_dispute_draft: VendorDisputeDraft | null
}

export interface CashflowWindowBucket {
  horizon_days: 30 | 60 | 90
  label: string
  window_end_date: string
  period_inflows_cents: number
  period_outflows_cents: number
  cumulative_inflows_cents: number
  cumulative_outflows_cents: number
  ending_balance_cents: number
  below_buffer: boolean
  buffer_shortfall_cents: number
}

export interface Cashflow90DayProjection {
  as_of_date: string
  starting_balance_cents: number
  safety_buffer_cents: number
  total_open_ar_cents: number
  total_scheduled_ap_cents: number
  held_disputed_ap_cents: number
  lowest_projected_balance_cents: number
  any_buffer_breach: boolean
  first_breach_horizon_days: 30 | 60 | 90 | null
  windows: [CashflowWindowBucket, CashflowWindowBucket, CashflowWindowBucket]
}

export interface BookkeepingKpiSummary {
  net_cashflow_cents: number
  revenue_cents: number
  cogs_cents: number
  expense_cents: number
  total_ap_due_cents: number
  open_bills_count: number
  auto_matched_bills_count: number
  auto_matched_bills_cents: number
  disputed_saved_cents: number
  disputed_bills_count: number
}

// ============================================================================
// Release 3 Types: Compliance Vault, Living SOPs, Command Router & What-If
// ============================================================================

export type ComplianceDocType =
  | 'contract'
  | 'coi'
  | 'license'
  | 'saas_renewal'
  | 'lease'

export type ComplianceVaultStatus =
  | 'active'
  | 'expiring_soon'
  | 'notice_staged'
  | 'expired'
  | 'cancelled'

export interface ComplianceVaultItem {
  id: string
  workspace_id: string
  doc_type: ComplianceDocType
  title: string
  counterparty: string
  expires_on: string
  notice_window_days: number
  annual_value_cents: number
  status: ComplianceVaultStatus
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface ComplianceNoticeDraft {
  requires_approval: true
  vault_item_id: string
  doc_type: ComplianceDocType
  counterparty: string
  subject: string
  body_markdown: string
  annual_value_cents: number
}

export interface ComplianceDeadlineItem {
  item: ComplianceVaultItem
  days_remaining: number
  notice_deadline_on: string
  within_notice_window: boolean
  is_expired: boolean
  action_needed: boolean
  notice_draft: ComplianceNoticeDraft
  ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}

export interface ComplianceEvaluationResult {
  reference_date: string
  total_docs_count: number
  active_docs_count: number
  expiring_within_window_count: number
  notice_staged_count: number
  annual_spend_protected_cents: number
  annual_spend_at_risk_cents: number
  evaluated_items: ComplianceDeadlineItem[]
  expiring_items: ComplianceDeadlineItem[]
}

export interface LivingSopRecord {
  id: string
  workspace_id: string
  module_key: string
  title: string
  trigger_event: string
  steps_json: string[]
  version: number
  auto_generated: boolean
  last_observed_at: string
  updated_at?: string
}

export interface WhatIfCashflowWindow {
  horizon_days: 30 | 60 | 90
  label: string
  baseline_balance_cents: number
  scenario_delta_cents: number
  simulated_balance_cents: number
  below_buffer: boolean
  buffer_shortfall_cents: number
}

export interface WhatIfCashflowResult {
  horizon_days: number
  baseline_cents: number
  monthly_delta_cents: number
  one_time_delta_cents: number
  safety_buffer_cents: number
  end_of_horizon_baseline_cents: number
  end_of_horizon_simulated_cents: number
  net_variance_cents: number
  lowest_simulated_balance_cents: number
  any_buffer_breach: boolean
  first_breach_horizon_days: 30 | 60 | 90 | null
  windows: [WhatIfCashflowWindow, WhatIfCashflowWindow, WhatIfCashflowWindow]
}

export interface CommandRouterSnapshot {
  invoices: readonly AutonomousInvoice[]
  inventoryItems: readonly Release2InventoryItem[]
  complianceItems: readonly ComplianceVaultItem[]
  sops: readonly LivingSopRecord[]
  ledgerEntries: readonly AgentActionLedgerEntry[]
  baselineBalanceCents: number
  safetyBufferCents?: number
  referenceDate?: string
}

export type CommandActionKind =
  | 'navigate'
  | 'open_what_if'
  | 'undo_ledger'
  | 'run_command'

export interface CommandActionPayload {
  label: string
  kind: CommandActionKind
  route?: string
  targetId?: string
  commandText?: string
  monthlyDeltaCents?: number
  oneTimeDeltaCents?: number
}

export interface CommandResultItem {
  id: string
  title: string
  subtitle: string
  badge: string
  amount_cents?: number
  action?: CommandActionPayload
}

export type CommandIntent =
  | 'overdue_invoices'
  | 'low_stock_skus'
  | 'expiring_compliance'
  | 'what_if_simulation'
  | 'undo_last_action'
  | 'living_sops'
  | 'compile_sop'
  | 'quick_jump'

export interface CommandRouteResult {
  intent: CommandIntent
  headline: string
  summary: string
  items: CommandResultItem[]
  primary_action: CommandActionPayload | null
  simulation: WhatIfCashflowResult | null
}

// Release 4: Shadow Mode (Zero-Migration Onboarding & Deterministic Leak Engine)

export type ShadowSourceSystem = 'quickbooks' | 'zoho' | 'stripe' | 'generic'

export type ShadowSessionStatus = 'analyzing' | 'ready' | 'promoted' | 'archived'

export type ShadowFindingCategory =
  | 'unbilled_quote'
  | 'overdue_ar'
  | 'duplicate_vendor_charge'
  | 'recurring_creep'

export type ShadowFindingStatus = 'open' | 'dismissed' | 'promoted'

export interface ShadowSession {
  id: string
  workspace_id: string
  source_system: ShadowSourceSystem
  file_name: string
  row_count: number
  total_leak_cents: number
  status: ShadowSessionStatus
  created_at?: string
  updated_at?: string
}

export type ShadowEvidenceValue = string | number | boolean | null

export interface ShadowFinding {
  id: string
  workspace_id: string
  session_id: string
  category: ShadowFindingCategory
  counterparty: string
  amount_cents: number
  proof_summary: string
  evidence_json: Record<string, ShadowEvidenceValue>
  status: ShadowFindingStatus
  created_at?: string
  updated_at?: string
}

export type ShadowCategoryBreakdown = Record<ShadowFindingCategory, number>

export interface ShadowActionItem {
  finding_id: string
  category: ShadowFindingCategory
  priority: 'high' | 'medium'
  counterparty: string
  amount_cents: number
  title: string
  recommended_action: string
}

export interface ShadowAnalysisResult {
  file_name: string
  source_system: ShadowSourceSystem
  as_of_date: string
  row_count: number
  clean_row_count: number
  total_leak_cents: number
  by_category_cents: ShadowCategoryBreakdown
  finding_counts_by_category: ShadowCategoryBreakdown
  findings: ShadowFinding[]
  action_items: ShadowActionItem[]
  detected_columns: Record<string, string | null>
}

export interface SampleQuickBooksExport {
  file_name: string
  as_of_date: string
  csv_text: string
  description: string
}

// Release 4A: 1-Click CPA Tax & Audit Packet + Autonomous Collections Engine

export type CpaAccountCode = '1000' | '1200' | '2000' | '3000' | '4000' | '5000' | '6000'

export type CpaAccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense'

export interface CpaJournalLine {
  line_id: string
  occurred_on: string
  source_type: 'opening' | 'ledger_entry' | 'invoice' | 'vendor_bill'
  source_ref: string
  description: string
  account_code: CpaAccountCode
  account_name: string
  category: CpaAccountCategory
  debit_cents: number
  credit_cents: number
}

export interface CpaTrialBalanceRow {
  account_code: CpaAccountCode
  account_name: string
  category: CpaAccountCategory
  debit_cents: number
  credit_cents: number
  net_balance_cents: number
  normal_side: 'debit' | 'credit'
}

export interface CpaTrialBalanceReport {
  rows: CpaTrialBalanceRow[]
  total_debits_cents: number
  total_credits_cents: number
  variance_cents: number
  is_balanced: boolean
}

export interface CpaProfitAndLossReport {
  revenue_cents: number
  cogs_cents: number
  gross_profit_cents: number
  operating_expenses_cents: number
  net_income_cents: number
  gross_margin_bps: number
}

export interface CpaBalanceSheetReport {
  cash_cents: number
  accounts_receivable_cents: number
  total_assets_cents: number
  accounts_payable_cents: number
  total_liabilities_cents: number
  opening_equity_cents: number
  current_period_net_income_cents: number
  total_equity_cents: number
  liabilities_plus_equity_cents: number
  balance_sheet_variance_cents: number
  is_balanced: boolean
}

export interface CpaAuditPacket {
  workspace_name: string
  as_of_date: string
  period_label: string
  generated_at: string
  entry_count: number
  invoice_count: number
  vendor_bill_count: number
  trial_balance: CpaTrialBalanceReport
  profit_and_loss: CpaProfitAndLossReport
  balance_sheet: CpaBalanceSheetReport
  general_ledger: CpaJournalLine[]
  proof_summary: string
}

export type CollectionTouchStage =
  | 'day_3_nudge'
  | 'day_10_split_offer'
  | 'day_21_owner_escalation'

export type CollectionTouchStatus =
  | 'staged'
  | 'paused_paid'
  | 'paused_disputed'
  | 'sent'
  | 'reversed'

export interface CollectionTouchRecord {
  id: string
  workspace_id: string
  invoice_id: string
  stage: CollectionTouchStage
  status: CollectionTouchStatus
  amount_due_cents: number
  portal_url: string | null
  proof_summary: string
  created_at?: string
  updated_at?: string
}

export interface EvaluatedCollectionCandidate {
  invoice_id: string
  invoice_number: string
  customer_name: string
  customer_email: string | null
  due_date: string
  days_overdue: number
  stage: CollectionTouchStage
  status: CollectionTouchStatus
  amount_due_cents: number
  split_part_1_cents: number | null
  split_part_2_cents: number | null
  portal_url: string | null
  autonomy_decision: AutonomyGateDecision
  should_stage: boolean
  auto_paused_reason: 'paid' | 'disputed' | null
  message_subject: string
  message_preview: string
  proof_summary: string
}

export interface CollectionsRunPlan {
  as_of_date: string
  candidates: EvaluatedCollectionCandidate[]
  staged_candidates: EvaluatedCollectionCandidate[]
  paused_candidates: EvaluatedCollectionCandidate[]
  total_staged_cents: number
  total_paused_cents: number
  stage_counts: Record<CollectionTouchStage, number>
  existing_touch_ids_to_pause_paid: string[]
  existing_touch_ids_to_pause_disputed: string[]
  ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}

// Release 4B: Operations Compiler, Vendor Fraud Shield, Morning Brief & Portability

export type SopTriggerType =
  | 'vendor_bill_received'
  | 'invoice_overdue'
  | 'cashflow_threshold'
  | 'contract_expiring'

export type SopActionKind =
  | 'freeze_bill_for_approval'
  | 'stage_collection_chase'
  | 'trigger_runway_protection'
  | 'stage_compliance_renewal_notice'

export type ExecutableSopStatus = 'draft' | 'active' | 'paused'

export interface CompiledSopRule {
  trigger: SopTriggerType
  action: SopActionKind
  autonomy_action_key: AutonomyActionKey
  threshold_bps: number | null
  threshold_cents: number | null
  threshold_days: number | null
  safety_cap_cents: number
  condition_summary: string
}

export interface ExecutableSopRecord {
  id: string
  workspace_id: string
  name: string
  plain_english_prompt: string
  compiled_rule_json: CompiledSopRule
  status: ExecutableSopStatus
  safety_cap_cents: number
  last_simulated_impact_cents: number
  run_count: number
  created_at?: string
  updated_at?: string
}

export interface SopSimulationProofCard {
  record_id: string
  record_ref: string
  counterparty: string
  impact_cents: number
  within_safety_cap: boolean
  proof_summary: string
}

export interface SopSimulationResult {
  rule: CompiledSopRule
  sop_name: string
  plain_english_prompt: string
  as_of_date: string
  matched_count: number
  within_cap_count: number
  cap_exceeded_count: number
  total_impact_cents: number
  executable_impact_cents: number
  proof_cards: SopSimulationProofCard[]
  summary: string
}

export interface SopExecutionResult {
  executable_sop: ExecutableSopRecord
  simulation: SopSimulationResult
  autonomy_decision: AutonomyGateDecision
  ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}

export interface SopCompilerPreset {
  id: string
  label: string
  name: string
  prompt: string
  safety_cap_cents: number
}

export type VendorFraudAlertType =
  | 'price_spike_over_10pct'
  | 'duplicate_cent_amount'
  | 'remit_change'

export type VendorFraudAlertStatus = 'frozen' | 'approved_override' | 'dismissed'

export interface VendorBillFraudInput extends VendorBillRecord {
  remit_account_hint?: string | null
}

export interface VendorFraudAlertRecord {
  id: string
  workspace_id: string
  bill_id: string | null
  capture_id?: string | null
  vendor_name: string
  alert_type: VendorFraudAlertType
  variance_cents: number
  proof_summary: string
  status: VendorFraudAlertStatus
  created_at?: string
  updated_at?: string
}

export interface VendorFraudScanResult {
  as_of_date: string
  scanned_bill_count: number
  frozen_count: number
  total_frozen_cents: number
  counts_by_type: Record<VendorFraudAlertType, number>
  alerts: VendorFraudAlertRecord[]
}

export interface MorningBriefApprovalItem {
  id: string
  kind: 'vendor_fraud_freeze' | 'staged_collection'
  title: string
  subtitle: string
  amount_cents: number
  route: string
  cta_label: string
}

export interface OwnerMorningBrief {
  workspace_name: string
  as_of_date: string
  cash_position_cents: number
  collected_yesterday_cents: number
  open_ar_cents: number
  pending_approval_count: number
  pending_approval_total_cents: number
  frozen_fraud_count: number
  staged_collection_count: number
  runway_90d_lowest_cents: number
  safety_buffer_cents: number
  runway_status: 'healthy' | 'buffer_breach'
  approval_items: MorningBriefApprovalItem[]
  executive_summary: string
}

export interface BusinessPortabilityBundle {
  exported_at: string
  workspace_name: string
  record_counts: {
    ledger_entries: number
    invoices: number
    vendor_bills: number
    quotes: number
    compliance_vault_items: number
    living_sops: number
    executable_sops: number
    vendor_fraud_alerts: number
    collection_touches: number
  }
  ledger_entries: readonly LedgerEntryRecord[]
  invoices: readonly AutonomousInvoice[]
  vendor_bills: readonly VendorBillRecord[]
  quotes: readonly AutonomousQuote[]
  compliance_vault_items: readonly ComplianceVaultItem[]
  living_sops: readonly LivingSopRecord[]
  executable_sops: readonly ExecutableSopRecord[]
  vendor_fraud_alerts: readonly VendorFraudAlertRecord[]
  collection_touches: readonly CollectionTouchRecord[]
}

// Release 5: Complete Technical Moat (Multi-Entity, Inbox-to-Ledger, Bank Feed Auto-Reconcile, Job Margins)

export type WorkspaceEntityType = 'llc' | 'scorp' | 'ccorp' | 'sole_prop'

export type EntityIdentityStatus = 'unverified' | 'owner_supplied' | 'verified'

export interface WorkspaceEntityRecord {
  id: string
  workspace_id: string
  legal_name: string
  ein_last4: string | null
  ein_verified?: boolean
  identity_status?: EntityIdentityStatus
  entity_type: WorkspaceEntityType
  is_primary: boolean
  created_at?: string
  updated_at?: string
}

export type BankFeedSource = 'plaid_webhook' | 'ofx_qbo' | 'bank_csv'
export type BankFeedDirection = 'inflow' | 'outflow'
export type BankFeedStatus = 'unmatched' | 'auto_matched' | 'reconciled' | 'excluded'

export interface BankFeedTransactionRecord {
  id: string
  workspace_id: string
  entity_id: string | null
  source: BankFeedSource
  posted_date: string
  merchant_name: string
  amount_cents: number
  direction: BankFeedDirection
  matched_record_id: string | null
  match_confidence_bps: number
  status: BankFeedStatus
  proof_summary: string
  external_tx_id?: string | null
  source_fingerprint?: string | null
  manual_override_reason?: string | null
  idempotency_key?: string | null
  created_at?: string
  updated_at?: string
}

export interface ParsedBankTransactionInput {
  posted_date: string
  merchant_name: string
  amount_cents: number
  direction: BankFeedDirection
  source: BankFeedSource
  external_tx_id?: string | null
  source_fingerprint?: string | null
}

export interface BankReconciliationResult {
  as_of_date: string
  scanned_count: number
  auto_matched_count: number
  unmatched_count: number
  matched_inflow_cents: number
  matched_outflow_cents: number
  transactions: BankFeedTransactionRecord[]
}

export interface BankReconcileCommitPlan {
  reconciled_ids: string[]
  updated_transactions: BankFeedTransactionRecord[]
  total_reconciled_cents: number
  ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}

export type InboundBillMatchStatus = '3way_matched' | 'fraud_frozen' | 'needs_review' | 'posted'

export interface InboundBillCaptureRecord {
  id: string
  workspace_id: string
  entity_id: string | null
  source_address: string
  file_name: string
  vendor_name: string
  extracted_total_cents: number
  po_reference: string | null
  match_status: InboundBillMatchStatus
  proof_summary: string
  content_hash?: string | null
  extraction_method?: string
  extraction_confidence_bps?: number
  human_verified?: boolean
  posted_ledger_entry_id?: string | null
  created_at?: string
  updated_at?: string
}

export interface ParsedInboundBillPayload {
  vendor_name: string
  invoice_number: string
  po_reference: string | null
  due_date: string
  remit_account_hint: string | null
  line_items: VendorBillLineItem[]
  extracted_total_cents: number
  extraction_confidence_bps?: number
}

export interface InboundBillCaptureEvaluation {
  parsed: ParsedInboundBillPayload
  capture_draft: Omit<InboundBillCaptureRecord, 'id' | 'created_at' | 'updated_at'>
  fraud_alerts: VendorFraudAlertRecord[]
  three_way_match: ThreeWayMatchResult | null
}

export interface InboundBillPostPlan {
  updated_capture: InboundBillCaptureRecord
  ledger_entry_draft: Omit<LedgerEntryRecord, 'id' | 'created_at'>
  agent_ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}

export type JobMarginStatus = 'healthy' | 'margin_warning' | 'over_budget'

export interface JobMarginRecord {
  id: string
  workspace_id: string
  entity_id: string | null
  job_name: string
  client_name: string
  quoted_revenue_cents: number
  material_po_cents: number
  vendor_bill_cents: number
  labor_cents: number
  target_margin_bps: number
  status: JobMarginStatus
  created_at?: string
  updated_at?: string
}

export interface EvaluatedJobMargin {
  job: JobMarginRecord
  total_cost_cents: number
  net_margin_cents: number
  actual_margin_bps: number
  target_margin_bps: number
  margin_delta_bps: number
  computed_status: JobMarginStatus
  suggested_change_order_cents: number
  change_order_draft: string
}

export interface JobMarginPortfolioSummary {
  job_count: number
  healthy_count: number
  warning_count: number
  over_budget_count: number
  total_quoted_cents: number
  total_cost_cents: number
  total_net_margin_cents: number
  weighted_margin_bps: number
  evaluated_jobs: EvaluatedJobMargin[]
}

export interface JobChangeOrderPlan {
  updated_job: JobMarginRecord
  change_order_cents: number
  ledger_draft: Omit<AgentActionLedgerEntry, 'id' | 'created_at'>
}




// ============================================================================
// Mission 10 Types: AR/AP Aging, Cashflow Forecast, Invoice Payments & Dunning
// ============================================================================

export type InvoicePaymentType = 'deposit' | 'partial' | 'final' | 'credit_memo'

export type InvoicePaymentMethod =
  | 'stripe_card'
  | 'stripe_ach'
  | 'check'
  | 'cash'
  | 'ach_manual'
  | 'credit_memo'
  | 'manual'

export interface InvoicePaymentRecord {
  id: string
  workspace_id: string
  invoice_id: string
  amount_cents: number
  payment_type: InvoicePaymentType
  payment_method: InvoicePaymentMethod
  stripe_payment_intent_id: string | null
  notes: string | null
  idempotency_key: string
  recorded_at: string
  created_by?: string | null
}

export type DunningStage = 'pre_due_3d' | 'due_plus_3d' | 'overdue_14d' | 'overdue_30d'

export type DunningEventStatus = 'drafted' | 'approved' | 'dismissed' | 'sent'

export interface InvoiceDunningEventRecord {
  id: string
  workspace_id: string
  invoice_id: string
  stage: DunningStage
  staged_action_id: string | null
  late_fee_cents: number
  status: DunningEventStatus
  idempotency_key: string
  drafted_at: string
  sent_at: string | null
}

export type AgingBucketKey =
  | 'current'
  | 'days_1_30'
  | 'days_31_60'
  | 'days_61_90'
  | 'days_90_plus'

export interface AgingBucketSummary {
  bucket: AgingBucketKey
  label: string
  ar_count: number
  ar_cents: number
  ap_count: number
  ap_cents: number
  net_cents: number
}

export interface AgingLedgerRow {
  kind: 'ar_invoice' | 'ap_bill'
  id: string
  document_number: string
  counterparty: string
  title: string
  due_date: string
  days_past_due: number
  bucket: AgingBucketKey
  total_cents: number
  paid_cents: number
  balance_cents: number
  status: string
}

export interface CashflowProjectionWindow {
  horizon_days: 7 | 15 | 30
  label: string
  window_end_date: string
  overdue_ar_included_cents: number
  upcoming_ar_due_cents: number
  expected_inflow_cents: number
  scheduled_outflow_cents: number
  net_cashflow_cents: number
  projected_ending_cash_cents: number
}

export interface EarlyPayDiscountOpportunity {
  bill_id: string
  vendor_name: string
  invoice_number: string
  terms_label: string
  bill_total_cents: number
  discount_bps: number
  discount_cents: number
  net_pay_cents: number
  discount_deadline: string
  due_date: string
  days_remaining: number
  expired: boolean
  annualized_apr_bps: number
}

export interface ArApAgingSnapshot {
  as_of_date: string
  starting_cash_cents: number
  total_open_ar_cents: number
  total_open_ap_cents: number
  net_working_capital_cents: number
  buckets: AgingBucketSummary[]
  rows: AgingLedgerRow[]
  projections: [
    CashflowProjectionWindow,
    CashflowProjectionWindow,
    CashflowProjectionWindow,
  ]
  early_pay_opportunities: EarlyPayDiscountOpportunity[]
  total_early_pay_savings_cents: number
}

export interface DunningDraftProposal {
  workspace_id: string
  invoice_id: string
  invoice_number: string
  customer_name: string
  customer_email: string | null
  due_date: string
  days_past_due: number
  stage: DunningStage
  stage_label: string
  balance_due_cents: number
  late_fee_cents: number
  total_with_late_fee_cents: number
  action_type: 'dunning_reminder'
  status: 'pending_approval'
  autoSendAllowed: false
  idempotency_key: string
  title: string
  summary: string
  subject: string
  draft_body: string
}

export interface DunningEvaluationResult {
  as_of_date: string
  bot_mode: string
  observe_mode_blocked: boolean
  eligible_count: number
  skipped_observe_mode_count: number
  skipped_already_drafted_count: number
  drafts: DunningDraftProposal[]
}
