// Pure domain types and defaults for Loose Ends Autonomous Business OS (zero runtime/SDK imports)

export type AutonomyMode = 'manual' | 'approve_1tap' | 'full_auto'

export type AutonomyActionKey =
  | 'send_quote_followup'
  | 'convert_signed_quote_to_invoice'
  | 'send_invoice_reminder'
  | 'flag_overdue_ar'

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
  vault: false,
}

export const DEFAULT_AUTONOMY_RULES: AutonomyRulesMap = {
  send_quote_followup: 'approve_1tap',
  convert_signed_quote_to_invoice: 'full_auto',
  send_invoice_reminder: 'approve_1tap',
  flag_overdue_ar: 'full_auto',
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
]

export const WORKSPACE_MODULE_META: ReadonlyArray<{
  key: WorkspaceModuleKey
  label: string
  description: string
  release: 'release_1' | 'release_2'
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
    description: 'SKU stock counts, reservations, low-stock alerts, and supplier purchase orders.',
    release: 'release_2',
  },
  {
    key: 'bookkeeping',
    label: 'Bookkeeping',
    description: 'Automated transaction categorization, vendor bill audit, and GL export.',
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
    label: 'Document Vault',
    description: 'Signed agreements, compliance files, and audit snapshots.',
    release: 'release_2',
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
