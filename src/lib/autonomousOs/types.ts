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

export type QuoteStatus = 'draft' | 'sent' | 'signed' | 'declined' | 'expired'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
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
  due_date: string
  stripe_checkout_url: string | null
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
  entry_type: LedgerEntryType
  category: string
  description: string
  amount_cents: number
  occurred_on: string
  source_ref: string | null
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
  | 'quick_jump'

export interface CommandRouteResult {
  intent: CommandIntent
  headline: string
  summary: string
  items: CommandResultItem[]
  primary_action: CommandActionPayload | null
  simulation: WhatIfCashflowResult | null
}
