import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  analyzeShadowCsv,
  buildFraudOverridePlan,
  buildShadowPromotionPlan,
  calculateLineTotals,
  compileCpaAuditPacket,
  compileOwnerMorningBrief,
  compilePlainEnglishSop,
  computeArSummary,
  convertSignedQuoteToInvoice,
  DEFAULT_AUTONOMY_CONFIG,
  evaluateAutonomyGate,
  evaluateAutonomousCollections,
  evaluateComplianceDeadlines,
  executeCompiledSop,
  formatCents as formatOsCents,
  loadSampleQuickBooksExport,
  recomputeShadowLeakTotalCents,
  reverseLedgerAction,
  runThreeWayMatch,
  scanVendorBillsForFraud,
  simulateCompiledSop,
  type AgentActionLedgerEntry,
  type ArSummaryMetrics,
  type AutonomyActionKey,
  type AutonomyMode,
  type AutonomousInvoice,
  type AutonomousInvoiceItem,
  type AutonomousQuote,
  type AutonomousQuoteItem,
  type CollectionTouchRecord,
  type CollectionsRunPlan,
  type CommandRouterSnapshot,
  type ComplianceVaultItem,
  type CpaAuditPacket,
  type ExecutableSopRecord,
  type LedgerEntryRecord,
  type LivingSopRecord,
  type OwnerMorningBrief,
  type Release2InventoryItem,
  type ShadowFinding,
  type ShadowSession,
  type SopSimulationResult,
  type ThreeWayMatchResult,
  type VendorBillFraudInput,
  type VendorBillRecord,
  type VendorFraudAlertRecord,
  type WorkspaceAutonomyConfig,
  type WorkspaceModuleKey,
} from '../lib/autonomousOs'
import {agingBucketForDays, parseIsoMs} from '../lib/format'
import {
  calculateJobBillableTotal,
  scanRevenueLeaks,
  type RevenueLeakScanSummary,
} from '../lib/leakScanner'
import type {
  Appointment,
  AuditEvent,
  BotAutonomyMode,
  BotManual,
  BotRole,
  BotRun,
  CommunicationDraftChannel,
  ConsentChannel,
  ConsentDecision,
  ConsentEvent,
  Customer,
  Customer360Snapshot,
  DocumentRecord,
  FollowUp,
  InventoryItem,
  InventoryMovement,
  InventoryMovementKind,
  JobMaterial,
  JobStatus,
  Opportunity,
  OpsBusinessEvent,
  OpsCommunicationDraft,
  OpsCoordinationSummary,
  OpsEmployeeProfile,
  OpsExpense,
  OpsInvoiceAgingBucket,
  OpsInvoiceAgingKey,
  OpsJob,
  OpsPolicy,
  OpsPurchaseOrder,
  OpsQueueItem,
  OpsQuoteApproval,
  OpsQuoteRevision,
  OpsServicePlan,
  OpsSummary,
  OpsTeamMemberStatus,
  PurchaseOrderStatus,
  RecoveryEvent,
  StagedLedgerEntry,
  StagedLedgerLineItem,
  StagedOpsAction,
  Task,
  VerifiedRecoveryPayment,
  Workflow,
  WorkflowRun,
  Workspace,
  WorkspaceSettings,
  WorkspaceSubscription,
} from '../types/domain'

const DEMO_WORKSPACE_ID = '00000000-0000-4000-8000-00000000d3a0'
const DEMO_OWNER_ID = '00000000-0000-4000-8000-000000000101'
const DEMO_TECH_LEAD_ID = '00000000-0000-4000-8000-000000000102'
const DEMO_TECH_TWO_ID = '00000000-0000-4000-8000-000000000103'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

function isoOffsetFrom(anchorMs: number, deltaMs: number): string {
  return new Date(anchorMs + deltaMs).toISOString()
}

export interface DemoThreeWaySimulation {
  po_number: string
  vendor_name: string
  invoice_number: string
  sku: string
  ordered_qty: number
  po_unit_cost_cents: number
  received_qty: number
  billed_qty: number
  billed_unit_cost_cents: number
  bill_status: 'exception_flagged' | 'disputed' | 'reversed'
  ledger_entry_id: string
  match_result: ThreeWayMatchResult
}

export interface DemoSandboxState {
  workspace: Workspace
  settings: WorkspaceSettings
  subscription: WorkspaceSubscription
  policy: OpsPolicy
  employees: OpsEmployeeProfile[]
  customers: Customer[]
  opportunities: Opportunity[]
  recoveryEvents: RecoveryEvent[]
  verifiedPayments: VerifiedRecoveryPayment[]
  documents: DocumentRecord[]
  followUps: FollowUp[]
  tasks: Task[]
  jobs: OpsJob[]
  jobMaterials: JobMaterial[]
  quoteRevisions: OpsQuoteRevision[]
  quoteApprovals: OpsQuoteApproval[]
  appointments: Appointment[]
  servicePlans: OpsServicePlan[]
  inventoryItems: InventoryItem[]
  inventoryMovements: InventoryMovement[]
  purchaseOrders: OpsPurchaseOrder[]
  expenses: OpsExpense[]
  consentEvents: ConsentEvent[]
  drafts: OpsCommunicationDraft[]
  queueItems: OpsQueueItem[]
  businessEvents: OpsBusinessEvent[]
  workflows: Workflow[]
  workflowRuns: WorkflowRun[]
  auditEvents: AuditEvent[]
  botManuals: BotManual[]
  stagedOpsActions: StagedOpsAction[]
  stagedLedgerEntries: StagedLedgerEntry[]
  botRuns: BotRun[]
  osAutonomyConfig: WorkspaceAutonomyConfig
  osQuotes: AutonomousQuote[]
  osQuoteItemsByQuote: Record<string, AutonomousQuoteItem[]>
  osInvoices: AutonomousInvoice[]
  osInvoiceItemsByInvoice: Record<string, AutonomousInvoiceItem[]>
  osAgentLedger: AgentActionLedgerEntry[]
  osThreeWaySimulation: DemoThreeWaySimulation | null
  osComplianceItems: ComplianceVaultItem[]
  osLivingSops: LivingSopRecord[]
  osShadowSession: ShadowSession | null
  osShadowFindings: ShadowFinding[]
  osShadowPromotionLedgerId: string | null
  osLedgerEntries: LedgerEntryRecord[]
  osVendorBills: VendorBillRecord[]
  osCpaPacket: CpaAuditPacket | null
  osCollectionTouches: CollectionTouchRecord[]
  osDisputedInvoiceIds: string[]
  osCollectionsRunLedgerId: string | null
  osExecutableSops: ExecutableSopRecord[]
  osSopSimulation: SopSimulationResult | null
  osSopExecutionLedgerId: string | null
  osVendorFraudAlerts: VendorFraudAlertRecord[]
  osFraudOverrideLedgerId: string | null
}

export function createInitialDemoState(anchorMs: number = Date.now()): DemoSandboxState {
  const workspace: Workspace = {
    id: DEMO_WORKSPACE_ID,
    name: 'Ridgeway HVAC & Mechanical (Sandbox)',
    slug: 'ridgeway-hvac-demo',
    owner_user_id: DEMO_OWNER_ID,
    created_at: isoOffsetFrom(anchorMs, -120 * DAY_MS),
  }

  const settings: WorkspaceSettings = {
    workspace_id: DEMO_WORKSPACE_ID,
    business_type: 'HVAC & Mechanical',
    timezone: 'America/New_York',
    onboarding_completed: true,
    onboarding_completed_at: isoOffsetFrom(anchorMs, -119 * DAY_MS),
  }

  const subscription: WorkspaceSubscription = {
    workspace_id: DEMO_WORKSPACE_ID,
    provider: 'stripe',
    provider_customer_id: 'cus_demo_ridgeway',
    provider_subscription_id: 'sub_demo_revenue_recovery',
    plan_key: 'revenue_recovery',
    status: 'active',
    current_period_start: isoOffsetFrom(anchorMs, -12 * DAY_MS),
    current_period_end: isoOffsetFrom(anchorMs, 18 * DAY_MS),
    cancel_at_period_end: false,
    billing_livemode: false,
  }

  const policy: OpsPolicy = {
    workspace_id: DEMO_WORKSPACE_ID,
    enabled: true,
    draft_limit: 25,
    industry: 'hvac',
    coordinate_enabled: true,
    timezone: 'America/New_York',
    business_start: '07:30',
    business_end: '18:00',
    business_days: [1, 2, 3, 4, 5, 6],
    enforce_hours: true,
    travel_buffer: 30,
    updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
  }

  const employees: OpsEmployeeProfile[] = [
    {
      workspace_id: DEMO_WORKSPACE_ID,
      user_id: DEMO_OWNER_ID,
      display_name: 'Elena Vance',
      job_title: 'Operations Owner',
      phone: '(555) 214-8801',
      skills: ['Commercial Bidding', 'Diagnostics', 'Dispatch'],
      active: true,
      created_at: isoOffsetFrom(anchorMs, -120 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
    },
    {
      workspace_id: DEMO_WORKSPACE_ID,
      user_id: DEMO_TECH_LEAD_ID,
      display_name: 'Marcus Cole',
      job_title: 'Lead EPA-608 Technician',
      phone: '(555) 214-8802',
      skills: ['Heat Pumps', 'Rooftop Units', 'Refrigerant Recovery'],
      active: true,
      created_at: isoOffsetFrom(anchorMs, -110 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -3 * DAY_MS),
    },
    {
      workspace_id: DEMO_WORKSPACE_ID,
      user_id: DEMO_TECH_TWO_ID,
      display_name: 'Devon Brooks',
      job_title: 'Service & Install Tech',
      phone: '(555) 214-8803',
      skills: ['Mini-Splits', 'Airflow Balancing', 'Preventive Maintenance'],
      active: true,
      created_at: isoOffsetFrom(anchorMs, -95 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
    },
  ]

  const c1 = '00000000-0000-4000-8000-00000000c001'
  const c2 = '00000000-0000-4000-8000-00000000c002'
  const c3 = '00000000-0000-4000-8000-00000000c003'
  const c4 = '00000000-0000-4000-8000-00000000c004'
  const c5 = '00000000-0000-4000-8000-00000000c005'

  const customers: Customer[] = [
    {
      id: c1,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: 'Hannah',
      last_name: 'Mercer',
      email: 'hannah@mercerdental.example',
      phone: '(555) 390-1120',
      notes: 'Mercer Family Dental — 2 rooftop Carrier package units; prefers email/SMS before 4pm.',
      created_at: isoOffsetFrom(anchorMs, -90 * DAY_MS),
    },
    {
      id: c2,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: 'grant',
      last_name: 'Calloway',
      email: 'gcalloway@oakstreetbakery.example',
      phone: '(555) 390-4418',
      notes: 'Oak Street Bakery — walk-in condenser & makeup air unit.',
      created_at: isoOffsetFrom(anchorMs, -74 * DAY_MS),
    },
    {
      id: c3,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: 'Priya',
      last_name: 'Natarajan',
      email: 'priya.n@westsideortho.example',
      phone: '(555) 390-7721',
      notes: 'Westside Orthodontics — server closet mini-split + quarterly filter contract.',
      created_at: isoOffsetFrom(anchorMs, -62 * DAY_MS),
    },
    {
      id: c4,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: 'Trevor',
      last_name: 'Kowalski',
      email: 'tkowalski@harborfreightwarehousing.example',
      phone: '(555) 390-9084',
      notes: 'Harbor Logistics Bay 4 — opted out of SMS reminders; email only.',
      created_at: isoOffsetFrom(anchorMs, -48 * DAY_MS),
    },
    {
      id: c5,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: 'Claire',
      last_name: 'Whitaker',
      email: 'claire@whitakerresidence.example',
      phone: '(555) 390-6532',
      notes: '3.5-ton variable-speed heat pump replacement quote sent last week.',
      created_at: isoOffsetFrom(anchorMs, -15 * DAY_MS),
    },
  ]
  // Normalize capital first letter on Grant
  customers[1].first_name = 'Grant'

  const opp1 = '00000000-0000-4000-8000-00000000a001'
  const opp2 = '00000000-0000-4000-8000-00000000a002'
  const opp3 = '00000000-0000-4000-8000-00000000a003'
  const opp4 = '00000000-0000-4000-8000-00000000a004'

  const opportunities: Opportunity[] = [
    {
      id: opp1,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      title: 'Overdue Invoice INV-1892 — Rooftop Economizer & Compressor Contactor',
      source: 'invoice_aging',
      reason: 'Invoice 24 days past due with signed work order on file.',
      status: 'open',
      amount: 2840,
      recovered_amount: null,
      priority: 95,
      confidence_score: 92,
      due_at: isoOffsetFrom(anchorMs, -24 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -38 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -10 * DAY_MS),
      customers: customers[0],
    },
    {
      id: opp2,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c5,
      title: 'Quote QTE-2041 — 3.5-Ton Bosch Heat Pump & Air Handler',
      source: 'quote_followup',
      reason: 'Quote sent 9 days ago; homeowner asked about utility rebate.',
      status: 'contacted',
      amount: 6450,
      recovered_amount: null,
      priority: 88,
      confidence_score: 78,
      due_at: isoOffsetFrom(anchorMs, 2 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -9 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -9 * DAY_MS),
      customers: customers[4],
    },
    {
      id: opp3,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c4,
      title: 'Warehouse Unit Heater Flue & Gas Valve Replacement',
      source: 'diagnostic_visit',
      reason: 'Diagnostic completed 11 days ago; awaiting PO sign-off.',
      status: 'open',
      amount: 1920,
      recovered_amount: null,
      priority: 82,
      confidence_score: 74,
      due_at: isoOffsetFrom(anchorMs, -3 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -11 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -11 * DAY_MS),
      customers: customers[3],
    },
    {
      id: opp4,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c3,
      title: 'Server Room Mini-Split Condensate Pump & Coil Clean',
      source: 'invoice_collection',
      reason: 'Collected via Stripe invoice link.',
      status: 'recovered',
      amount: 1180,
      recovered_amount: 1180,
      recovered_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
      priority: 70,
      confidence_score: 100,
      due_at: isoOffsetFrom(anchorMs, -6 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -18 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
      customers: customers[2],
    },
  ]

  const recoveryEvents: RecoveryEvent[] = [
    {
      id: '00000000-0000-4000-8000-00000000e001',
      workspace_id: DEMO_WORKSPACE_ID,
      opportunity_id: opp4,
      customer_id: c3,
      amount: 1180,
      source: 'owner_confirmed_collection',
      note: 'Collected on INV-1884',
      created_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
    },
  ]

  const verifiedPayments: VerifiedRecoveryPayment[] = [
    {
      id: '00000000-0000-4000-8000-00000000f001',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c3,
      opportunity_id: opp4,
      amount_cents: 118000,
      currency: 'USD',
      payment_provider: 'stripe',
      provider_payment_id: 'pi_demo_verified_1884',
      provider_verified_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
    },
  ]

  const doc1 = '00000000-0000-4000-8000-00000000d001'
  const doc2 = '00000000-0000-4000-8000-00000000d002'
  const doc3 = '00000000-0000-4000-8000-00000000d003'
  const doc4 = '00000000-0000-4000-8000-00000000d004'

  const documents: DocumentRecord[] = [
    {
      id: doc1,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      opportunity_id: opp1,
      document_type: 'invoice',
      document_number: 'INV-1892',
      status: 'overdue',
      total: 2840,
      due_at: isoOffsetFrom(anchorMs, -24 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -38 * DAY_MS),
    },
    {
      id: doc2,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c2,
      opportunity_id: null,
      document_type: 'invoice',
      document_number: 'INV-1904',
      status: 'sent',
      total: 965,
      due_at: isoOffsetFrom(anchorMs, -8 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -22 * DAY_MS),
    },
    {
      id: doc3,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c5,
      opportunity_id: opp2,
      document_type: 'quote',
      document_number: 'QTE-2041',
      status: 'sent',
      total: 6450,
      due_at: isoOffsetFrom(anchorMs, 5 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -9 * DAY_MS),
    },
    {
      id: doc4,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c3,
      opportunity_id: opp4,
      document_type: 'invoice',
      document_number: 'INV-1884',
      status: 'paid',
      total: 1180,
      due_at: isoOffsetFrom(anchorMs, -6 * DAY_MS),
      created_at: isoOffsetFrom(anchorMs, -18 * DAY_MS),
    },
  ]

  const sku1 = '00000000-0000-4000-8000-00000000b001'
  const sku2 = '00000000-0000-4000-8000-00000000b002'
  const sku3 = '00000000-0000-4000-8000-00000000b003'
  const sku4 = '00000000-0000-4000-8000-00000000b004'

  const inventoryItems: InventoryItem[] = [
    {
      id: sku1,
      workspace_id: DEMO_WORKSPACE_ID,
      name: 'R-410A Refrigerant Cylinder (25 lb)',
      sku: 'REF-410A-25',
      barcode: '810042190012',
      category: 'Refrigerants',
      description: 'EPA-608 tracked 25 lb cylinder',
      supplier: 'United Refrigeration',
      location: 'Cage A-1',
      purchase_cost: 168,
      selling_price: 295,
      quantity: 3,
      reserved: 2,
      reorder_threshold: 4,
      reorder_quantity: 8,
      archived: false,
      created_at: isoOffsetFrom(anchorMs, -90 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
    },
    {
      id: sku2,
      workspace_id: DEMO_WORKSPACE_ID,
      name: 'Dual Run Capacitor 45/5 MFD 440V',
      sku: 'CAP-45-5-440',
      barcode: '810042190029',
      category: 'Electrical',
      description: 'AmRad USA turbo-grade dual capacitor',
      supplier: 'Johnstone Supply',
      location: 'Truck Bin B-4',
      purchase_cost: 19,
      selling_price: 68,
      quantity: 2,
      reserved: 1,
      reorder_threshold: 6,
      reorder_quantity: 15,
      archived: false,
      created_at: isoOffsetFrom(anchorMs, -90 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: sku3,
      workspace_id: DEMO_WORKSPACE_ID,
      name: 'Honeywell T6 Pro Programmable Thermostat',
      sku: 'STAT-T6PRO-2H2C',
      barcode: '810042190036',
      category: 'Controls',
      description: '2H/2C heat pump & conventional pro thermostat',
      supplier: 'Johnstone Supply',
      location: 'Shelf C-2',
      purchase_cost: 74,
      selling_price: 165,
      quantity: 9,
      reserved: 1,
      reorder_threshold: 4,
      reorder_quantity: 10,
      archived: false,
      created_at: isoOffsetFrom(anchorMs, -80 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
    },
    {
      id: sku4,
      workspace_id: DEMO_WORKSPACE_ID,
      name: 'Little Giant Condensate Pump VCMA-20ULS',
      sku: 'PUMP-VCMA-20',
      barcode: '810042190043',
      category: 'Condensate',
      description: '115V condensate removal pump w/ safety switch',
      supplier: 'Ferguson HVAC',
      location: 'Shelf D-1',
      purchase_cost: 58,
      selling_price: 138,
      quantity: 5,
      reserved: 0,
      reorder_threshold: 3,
      reorder_quantity: 6,
      archived: false,
      created_at: isoOffsetFrom(anchorMs, -75 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
    },
  ]

  const job1 = '00000000-0000-4000-8000-000000009001'
  const job2 = '00000000-0000-4000-8000-000000009002'
  const job3 = '00000000-0000-4000-8000-000000009003'
  const job4 = '00000000-0000-4000-8000-000000009004'

  const jobs: OpsJob[] = [
    {
      id: job1,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c2,
      title: 'Walk-In Cooler Condenser Fan Motor & Subcooling Recharge',
      status: 'completed',
      priority: 'urgent',
      assigned_to: DEMO_TECH_LEAD_ID,
      notes: 'Completed emergency repair at 6:15pm; invoice still needs to be issued.',
      checklist: [
        { title: 'Isolate disconnect & verify 208V supply', done: true },
        { title: 'Replace condenser fan capacitor & weigh in R-410A', done: true },
        { title: 'Verify 36°F box pull-down & superheat', done: true },
      ],
      labor_total: 680,
      revision: 1,
      service_details: { equipment: 'Heatcraft 3HP Condensing Unit', serial: 'HC-229841' },
      recurring_plan_id: null,
      recurring_due: null,
      approved_at: isoOffsetFrom(anchorMs, -3 * DAY_MS),
      approval_evidence: 'Signed kitchen manager work authorization #WO-412',
      completed_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
      invoice_id: null, // Intentionally unbilled completed job so leak scanner surfaces it!
      created_at: isoOffsetFrom(anchorMs, -3 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: job2,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      title: 'RTU #2 Supply Belt, Economizer Damper Check & T6 Upgrade',
      status: 'scheduled',
      priority: 'high',
      assigned_to: DEMO_TECH_TWO_ID,
      notes: 'Roof hatch key at front reception.',
      checklist: [
        { title: 'Inspect heat exchanger & belt tension', done: false },
        { title: 'Install Honeywell T6 Pro in Suite B', done: false },
      ],
      labor_total: 420,
      revision: 1,
      service_details: { equipment: 'Carrier 48TC-06 Rooftop', roof_access: 'Interior ladder' },
      recurring_plan_id: null,
      recurring_due: null,
      approved_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
      approval_evidence: 'Email confirmation from hannah@mercerdental.example',
      completed_at: null,
      invoice_id: null,
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -6 * HOUR_MS),
    },
    {
      id: job3,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c5,
      title: '3.5-Ton Variable-Speed Heat Pump System Installation',
      status: 'quoted',
      priority: 'normal',
      assigned_to: DEMO_TECH_LEAD_ID,
      notes: 'Includes crane/pad set, line-set flush, and 10-year parts registration.',
      checklist: [
        { title: 'Recover existing refrigerant per EPA-608', done: false },
        { title: 'Nitrogen braze & 500-micron evacuation test', done: false },
        { title: 'Commission static pressure & airflow', done: false },
      ],
      labor_total: 5860,
      revision: 2,
      service_details: { equipment: 'Bosch IDS 2.0 3.5-Ton', warranty: '10yr parts / 2yr labor' },
      recurring_plan_id: null,
      recurring_due: null,
      approved_at: null,
      approval_evidence: null,
      completed_at: null,
      invoice_id: null,
      created_at: isoOffsetFrom(anchorMs, -9 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -9 * DAY_MS),
    },
    {
      id: job4,
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c3,
      title: 'Quarterly Orthodontic Clinic HEPA & Mini-Split Tune-Up',
      status: 'in_progress',
      priority: 'normal',
      assigned_to: DEMO_TECH_TWO_ID,
      notes: 'Technician currently on site checking condensate safety switch.',
      checklist: [
        { title: 'Wash Mitsubishi indoor blower wheel & filters', done: true },
        { title: 'Test condensate overflow float switch', done: false },
      ],
      labor_total: 295,
      revision: 1,
      service_details: { equipment: 'Mitsubishi MSZ-GL18NA', location: 'Imaging & Server Closet' },
      recurring_plan_id: '00000000-0000-4000-8000-000000007001',
      recurring_due: isoOffsetFrom(anchorMs, 90 * DAY_MS),
      approved_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
      approval_evidence: 'Active Preventive Maintenance Agreement #PMA-108',
      completed_at: null,
      invoice_id: null,
      created_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -1 * HOUR_MS),
    },
  ]

  const jobMaterials: JobMaterial[] = [
    {
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job1,
      item_id: sku1,
      quantity: 1,
      unit_cost: 168,
      unit_price: 295,
      state: 'consumed',
    },
    {
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job1,
      item_id: sku2,
      quantity: 1,
      unit_cost: 19,
      unit_price: 68,
      state: 'consumed',
    },
    {
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job2,
      item_id: sku3,
      quantity: 1,
      unit_cost: 74,
      unit_price: 165,
      state: 'reserved',
    },
    {
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job3,
      item_id: sku1,
      quantity: 2,
      unit_cost: 168,
      unit_price: 295,
      state: 'reserved',
    },
  ]

  const quoteRevisions: OpsQuoteRevision[] = [
    {
      id: '00000000-0000-4000-8000-000000006001',
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job3,
      revision: 2,
      document_id: doc3,
      snapshot: {
        job: jobs[2],
        materials: [jobMaterials[3]],
        revision: 2,
      },
      total: 6450,
      actor_id: DEMO_OWNER_ID,
      created_at: isoOffsetFrom(anchorMs, -9 * DAY_MS),
    },
  ]

  const quoteApprovals: OpsQuoteApproval[] = [
    {
      id: '00000000-0000-4000-8000-000000006101',
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job1,
      revision: 1,
      evidence: 'Signed kitchen manager work authorization #WO-412',
      actor_id: DEMO_OWNER_ID,
      approved_at: isoOffsetFrom(anchorMs, -3 * DAY_MS),
      source: 'ops_command',
      created_at: isoOffsetFrom(anchorMs, -3 * DAY_MS),
    },
  ]

  const appointments: Appointment[] = [
    {
      id: '00000000-0000-4000-8000-000000005001',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c4,
      ops_job_id: null,
      assigned_worker: DEMO_TECH_LEAD_ID,
      title: 'Bay 4 Unit Heater Safety Re-Inspection',
      starts_at: isoOffsetFrom(anchorMs, -28 * HOUR_MS),
      ends_at: isoOffsetFrom(anchorMs, -26 * HOUR_MS),
      status: 'scheduled', // Past unclosed booking surfaced by leak scanner
      notes: 'Verify if customer PO arrived or reschedule.',
      created_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000005002',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c3,
      ops_job_id: job4,
      assigned_worker: DEMO_TECH_TWO_ID,
      title: 'Quarterly Orthodontic Clinic HEPA & Mini-Split Tune-Up',
      starts_at: isoOffsetFrom(anchorMs, 1 * HOUR_MS),
      ends_at: isoOffsetFrom(anchorMs, 3 * HOUR_MS),
      status: 'scheduled',
      notes: 'Suite 200 back entrance.',
      created_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000005003',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      ops_job_id: job2,
      assigned_worker: DEMO_TECH_TWO_ID,
      title: 'RTU #2 Supply Belt, Economizer Damper Check & T6 Upgrade',
      starts_at: isoOffsetFrom(anchorMs, 22 * HOUR_MS),
      ends_at: isoOffsetFrom(anchorMs, 25 * HOUR_MS),
      status: 'scheduled',
      notes: 'Bring 48-inch cogged belt & T6 Pro.',
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const servicePlans: OpsServicePlan[] = [
    {
      id: '00000000-0000-4000-8000-000000007001',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c3,
      title: 'Quarterly Medical & Server Closet HVAC Maintenance',
      interval_days: 90,
      next_due: isoOffsetFrom(anchorMs, 85 * DAY_MS).slice(0, 10),
      assigned_to: DEMO_TECH_TWO_ID,
      enabled: true,
      template: {
        labor_total: 295,
        checklist: [
          { title: 'Sanitize evaporator coil & blower wheel', done: false },
          { title: 'Test condensate float switch & amp draw', done: false },
        ],
      },
      created_at: isoOffsetFrom(anchorMs, -90 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
    },
  ]

  const inventoryMovements: InventoryMovement[] = [
    {
      id: '00000000-0000-4000-8000-000000004001',
      workspace_id: DEMO_WORKSPACE_ID,
      item_id: sku1,
      job_id: job1,
      kind: 'consume',
      quantity: -1,
      balance: 3,
      reason: 'Consumed on Oak Street Bakery walk-in repair',
      actor_id: DEMO_TECH_LEAD_ID,
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000004002',
      workspace_id: DEMO_WORKSPACE_ID,
      item_id: sku2,
      job_id: job1,
      kind: 'consume',
      quantity: -1,
      balance: 2,
      reason: 'Consumed on Oak Street Bakery walk-in repair',
      actor_id: DEMO_TECH_LEAD_ID,
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const purchaseOrders: OpsPurchaseOrder[] = [
    {
      id: '00000000-0000-4000-8000-000000003001',
      workspace_id: DEMO_WORKSPACE_ID,
      item_id: sku1,
      supplier: 'United Refrigeration',
      quantity: 8,
      unit_cost: 168,
      status: 'draft',
      approved_by: null,
      receipt_reference: null,
      created_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000003002',
      workspace_id: DEMO_WORKSPACE_ID,
      item_id: sku2,
      supplier: 'Johnstone Supply',
      quantity: 15,
      unit_cost: 19,
      status: 'approved',
      approved_by: DEMO_OWNER_ID,
      receipt_reference: null,
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const expenses: OpsExpense[] = [
    {
      id: '00000000-0000-4000-8000-000000003501',
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: job1,
      vendor: 'United Refrigeration',
      description: 'After-hours counter call fee & nitrogen purge refill',
      amount: 145,
      due_at: isoOffsetFrom(anchorMs, 10 * DAY_MS).slice(0, 10),
      paid: false,
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const consentEvents: ConsentEvent[] = [
    {
      id: '00000000-0000-4000-8000-000000002001',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      channel: 'email',
      decision: 'granted',
      evidence_reference: 'MSA-MERCER-2026-EMAIL-OPTIN',
      actor_user_id: DEMO_OWNER_ID,
      created_at: isoOffsetFrom(anchorMs, -60 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000002002',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c5,
      channel: 'sms',
      decision: 'granted',
      evidence_reference: 'WEBFORM-WHITAKER-SMS-9941',
      actor_user_id: DEMO_OWNER_ID,
      created_at: isoOffsetFrom(anchorMs, -14 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000002003',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c4,
      channel: 'sms',
      decision: 'revoked',
      evidence_reference: 'SMS-STOP-REPLY-2026-10',
      actor_user_id: DEMO_OWNER_ID,
      created_at: isoOffsetFrom(anchorMs, -20 * DAY_MS),
    },
  ]

  const drafts: OpsCommunicationDraft[] = [
    {
      id: '00000000-0000-4000-8000-000000002501',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      source_event_id: null,
      channel: 'email',
      subject: 'Friendly check-in on Invoice INV-1892 — Mercer Family Dental',
      message:
        'Hi Hannah, wanted to share a quick copy of Invoice INV-1892 ($2,840) for the RTU #1 contactor & economizer repair before our tech arrives for RTU #2 tomorrow. Let us know if accounting needs the signed work order resent.',
      status: 'draft',
      approved_by: null,
      approved_at: null,
      delivery_status: 'not_sent',
      created_at: isoOffsetFrom(anchorMs, -12 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000002502',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c5,
      source_event_id: null,
      channel: 'sms',
      subject: 'Bosch Heat Pump Quote QTE-2041 & Rebate Sheet',
      message:
        'Hi Claire, this is Elena at Ridgeway HVAC. Checking in on Quote QTE-2041 ($6,450) — we confirmed your system qualifies for the $850 utility heat-pump rebate. Would Thursday or Friday work to lock in your install date?',
      status: 'draft',
      approved_by: null,
      approved_at: null,
      delivery_status: 'not_sent',
      created_at: isoOffsetFrom(anchorMs, -8 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000002503',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c4,
      source_event_id: null,
      channel: 'sms',
      subject: 'SMS blocked by revoked consent',
      message: 'Checking on Bay 4 unit heater quote.',
      status: 'rejected',
      approved_by: null,
      approved_at: null,
      delivery_status: 'not_sent',
      created_at: isoOffsetFrom(anchorMs, -19 * DAY_MS),
    },
  ]

  const tasks: Task[] = [
    {
      id: '00000000-0000-4000-8000-000000001501',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c2,
      opportunity_id: null,
      title: 'Review & send invoice for Oak Street Bakery emergency cooler repair',
      status: 'open',
      priority: 95,
      due_at: isoOffsetFrom(anchorMs, 4 * HOUR_MS),
      created_at: isoOffsetFrom(anchorMs, -20 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-000000001502',
      workspace_id: DEMO_WORKSPACE_ID,
      customer_id: c1,
      opportunity_id: opp1,
      title: 'Approve email reminder draft for INV-1892 ($2,840)',
      status: 'open',
      priority: 90,
      due_at: isoOffsetFrom(anchorMs, 6 * HOUR_MS),
      created_at: isoOffsetFrom(anchorMs, -12 * HOUR_MS),
    },
  ]

  const followUps: FollowUp[] = []

  const queueItems: OpsQueueItem[] = [
    {
      id: '00000000-0000-4000-8000-000000001801',
      workspace_id: DEMO_WORKSPACE_ID,
      item_id: sku1,
      event_key: `low-stock:${sku1}`,
      status: 'completed',
      attempts: 1,
      available_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
      started_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
      completed_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
      result: { purchase_order_drafted: true },
      error: null,
      created_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
    },
  ]

  const businessEvents: OpsBusinessEvent[] = [
    {
      id: '00000000-0000-4000-8000-000000001901',
      workspace_id: DEMO_WORKSPACE_ID,
      event_key: `job-completed:${job1}`,
      event_type: 'job_completed',
      entity_type: 'ops_job',
      entity_id: job1,
      customer_id: c2,
      payload: { labor_total: 680 },
      status: 'completed',
      attempts: 1,
      available_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
      started_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
      completed_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
      result: { task_created: true },
      error: null,
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const wf1 = '00000000-0000-4000-8000-000000008001'
  const workflows: Workflow[] = [
    {
      id: wf1,
      workspace_id: DEMO_WORKSPACE_ID,
      name: 'High-Value Stalled Quote Owner Approval Rule',
      description: 'Queues an owner-approved follow-up task when a quote above $3,000 ages past 7 days.',
      enabled: true,
      mode: 'approval',
      trigger_type: 'record_due',
      trigger_config: { entity_type: 'opportunity' },
      conditions: [{ field: 'amount', operator: 'gte', value: 3000 }],
      actions: [
        {
          type: 'create_task',
          title: 'Call homeowner with rebate sheet on high-value HVAC quote',
          priority: 90,
        },
      ],
      created_at: isoOffsetFrom(anchorMs, -60 * DAY_MS),
      updated_at: isoOffsetFrom(anchorMs, -10 * DAY_MS),
    },
  ]

  const workflowRuns: WorkflowRun[] = [
    {
      id: '00000000-0000-4000-8000-000000008501',
      workspace_id: DEMO_WORKSPACE_ID,
      workflow_id: wf1,
      trigger_event_id: null,
      status: 'waiting_approval',
      idempotency_key: `demo-wf-run:${opp2}`,
      context: { record: { id: opp2, title: opportunities[1].title, amount: 6450 } },
      result: {},
      error: null,
      started_at: isoOffsetFrom(anchorMs, -6 * HOUR_MS),
      completed_at: null,
      created_at: isoOffsetFrom(anchorMs, -6 * HOUR_MS),
    },
  ]

  const auditEvents: AuditEvent[] = [
    {
      id: '00000000-0000-4000-8000-000000009901',
      workspace_id: DEMO_WORKSPACE_ID,
      actor_user_id: DEMO_OWNER_ID,
      entity_type: 'opportunity',
      entity_id: opp4,
      action: 'opportunity_collected',
      metadata: { amount: 1180, invoice_number: 'INV-1884' },
      created_at: isoOffsetFrom(anchorMs, -4 * DAY_MS),
    },
  ]

  const botManuals: BotManual[] = [
    {
      id: '00000000-0000-4000-8000-00000000b101',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'billing',
      mode: 'propose',
      instructions_markdown:
        '# Billing & Document Parser SOP\n- Verify every completed job checklist item and reserved material before staging an invoice draft.\n- Recompute line-item subtotals and tax in integer cents; flag any vendor receipt or estimate where line items + tax do not equal total.',
      updated_by: DEMO_OWNER_ID,
      updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b102',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'cash_applications',
      mode: 'propose',
      instructions_markdown:
        '# Cash Applications & Receipt Match SOP\n- Match incoming vendor bills, supplier POs, and remittance advice against open documents by exact dollar amount and reference number.\n- Flag partial payments or unapproved price increases (>3% over PO cost) as `discrepancy_flag` entries.',
      updated_by: DEMO_OWNER_ID,
      updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b103',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'collections',
      mode: 'propose',
      instructions_markdown:
        '# Collections & Revenue Leak Recovery SOP\n- Prioritize overdue invoices (>7 days past due), completed unbilled jobs, and stale quotes (>5 days old).\n- Verify active channel opt-in in `customer_contact_consent_events` before proposing any customer follow-up.',
      updated_by: DEMO_OWNER_ID,
      updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b104',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'outreach',
      mode: 'propose',
      instructions_markdown:
        '# Founder-to-Founder SMB Outreach SOP\n- Tailor outreach to the prospect\'s specific industry bottleneck.\n- Queue all outreach in `ops_communication_drafts` with `requires_approval = true` and `delivery_status = not_sent`.',
      updated_by: DEMO_OWNER_ID,
      updated_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const stagedOpsActions: StagedOpsAction[] = [
    {
      id: '00000000-0000-4000-8000-00000000b151',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'dispatcher',
      workspace_domain: 'jobs',
      action_type: 'sms_voicemail_command',
      customer_id: customers[0]?.id ?? null,
      title: 'Truck-Cab Voicemail Note → Job #201 Add-On & Checklist Sign-Off',
      summary:
        'Parsed tech Marcus Cole voicemail (42s): "Replaced 40/5 uF dual run capacitor + 2 lbs R-410A on Oakwood Dental RTU-2, static pressure tested OK." Staged checklist completion & $323.00 parts add-on.',
      amount_cents: 32300,
      payload: { source: 'sms_voicemail', tech: 'Marcus Cole', duration_sec: 42 },
      confidence_score: 0.96,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -1 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b152',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'billing',
      workspace_domain: 'billing',
      action_type: 'vendor_bill_audit',
      customer_id: null,
      title: 'Vendor Bill Duplicate-Fee Audit Flag — Tri-State HVAC Supply #BILL-99204',
      summary:
        'Vendor Bill Auditor detected a $35.00 unapproved "Hazmat & Emergency Dispatch Surcharge" not present on approved PO #PO-1042 ($313.00 PO vs. $348.00 billed).',
      amount_cents: 3500,
      payload: { invoice_number: 'BILL-99204', expected_cents: 31300, billed_cents: 34800 },
      confidence_score: 0.95,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -2 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b153',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'buyer',
      workspace_domain: 'inventory',
      action_type: 'photo_inventory_import',
      customer_id: null,
      title: 'Shop Shelf Photo-to-Inventory Batch (4 HVAC SKUs Counted)',
      summary:
        'Extracted shelf bin tags from uploaded bay photo: R-410A 25lb Cylinders (4 on hand, below threshold 5), 24V Contactors (11 on hand), Hard-Start Kits (3 on hand). Staged stock sync + reorder PO draft.',
      amount_cents: 87000,
      payload: { skus_counted: 4, low_stock_triggered: 1 },
      confidence_score: 0.93,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -3 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b154',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'collections',
      workspace_domain: 'comms',
      action_type: 'open_loop_recovery',
      customer_id: customers[1]?.id ?? null,
      title: 'Open-Loop Gmail Follow-Up — Stalled $6,450 Rooftop Heat Pump Quote (8d Silent)',
      summary:
        'Detected unanswered estimate thread with Summit Logistics Warehouse (sent 8 days ago, verified email opt-in on file). Staged rebates & scheduling check-in draft.',
      amount_cents: 645000,
      payload: { thread_age_days: 8, channel: 'email', consent_verified: true },
      confidence_score: 0.94,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -4 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b155',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'scout',
      workspace_domain: 'pipeline',
      action_type: 'ops_readiness_scorecard',
      customer_id: null,
      title: 'Ops Readiness Scorecard: Charleston Dental Associates (Grade A · 95/100)',
      summary:
        'Regional WV/OH/PA Scout audited website & booking flow: high patient volume, manual recall/treatment quote follow-up bottleneck detected. Ready for $249 Document Operations Pilot.',
      amount_cents: 24900,
      payload: { grade: 'A', score_0_100: 95, location: 'Charleston, WV' },
      confidence_score: 0.95,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -5 * HOUR_MS),
    },
  ]

  const stagedLedgerEntries: StagedLedgerEntry[] = [
    {
      id: '00000000-0000-4000-8000-00000000b201',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'billing',
      entry_type: 'invoice_draft',
      customer_id: customers[0]?.id ?? null,
      vendor_name: 'Oakwood Dental Group — Completed Condenser Coil & TXV Replacement',
      amount_cents: 130300,
      currency: 'USD',
      line_items: [
        { description: 'Completed Field Labor (Job #201)', quantity: 1, unit_price_cents: 98000 },
        { description: 'R-410A 25lb Cylinder + 40/5 uF Dual Run Capacitor', quantity: 1, unit_price_cents: 32300 },
      ],
      reasoning_summary:
        'Job completed 3 days ago with 3/3 checklist steps verified, but invoice_id is null. Staged draft invoice for owner approval.',
      confidence_score: 0.96,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -3 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b202',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'cash_applications',
      entry_type: 'discrepancy_flag',
      customer_id: null,
      vendor_name: 'Tri-State HVAC Supply (Invoice #BILL-99204)',
      amount_cents: 34800,
      currency: 'USD',
      line_items: [
        { description: 'High-Pressure Hose Assembly', quantity: 2, unit_price_cents: 11500 },
        { description: 'Hydraulic Coupler Kit', quantity: 1, unit_price_cents: 6500 },
      ],
      reasoning_summary:
        'ARITHMETIC MISMATCH FLAGGED: Recomputed subtotal $295.00 + tax $18.00 = $313.00, but vendor invoice stated $348.00 (+$35.00 overcharge).',
      confidence_score: 0.94,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: isoOffsetFrom(anchorMs, -2 * HOUR_MS),
    },
  ]

  const botRuns: BotRun[] = [
    {
      id: '00000000-0000-4000-8000-00000000b301',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'billing',
      model: 'grok-4.7',
      mode: 'propose',
      status: 'completed',
      input_summary: 'audit_billing_leaks: scanned 4 jobs & 5 documents',
      output_json: { staged_count: 1, unbilled_cents: 130300 },
      created_at: isoOffsetFrom(anchorMs, -3 * HOUR_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000b302',
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'cash_applications',
      model: 'grok-4.7',
      mode: 'propose',
      status: 'completed',
      input_summary: 'parse_document: Tri-State HVAC Supply (BILL-99204)',
      output_json: { computed_total_cents: 31300, stated_total_cents: 34800, has_discrepancy: true },
      created_at: isoOffsetFrom(anchorMs, -2 * HOUR_MS),
    },
  ]

  const osAutonomyConfig: WorkspaceAutonomyConfig = {
    modules_enabled: { ...DEFAULT_AUTONOMY_CONFIG.modules_enabled },
    autonomy_rules: { ...DEFAULT_AUTONOMY_CONFIG.autonomy_rules },
    auto_limit_cents: DEFAULT_AUTONOMY_CONFIG.auto_limit_cents,
  }

  const q3011Totals = calculateLineTotals(
    [
      { description: 'CRM & Branded Client Portal Setup', quantity: 1, unit_price_cents: 28000 },
      { description: 'Monthly Ops & Retainer Billing Automation', quantity: 1, unit_price_cents: 20000 },
    ],
    0,
  )
  const q3012Totals = calculateLineTotals(
    [
      { description: 'Wholesale Account & Portal Migration', quantity: 1, unit_price_cents: 75000 },
      { description: 'Automated AR Aging & Collection Cadence', quantity: 1, unit_price_cents: 50000 },
    ],
    0,
  )
  const q3010Totals = calculateLineTotals(
    [
      { description: 'Patient Recall & Quote Follow-Up Pack', quantity: 1, unit_price_cents: 65000 },
    ],
    0,
  )

  const quote3011Id = '00000000-0000-4000-8000-00000000q301'
  const quote3012Id = '00000000-0000-4000-8000-00000000q302'
  const quote3010Id = '00000000-0000-4000-8000-00000000q300'

  const osQuotes: AutonomousQuote[] = [
    {
      id: quote3011Id,
      workspace_id: DEMO_WORKSPACE_ID,
      lead_id: null,
      customer_id: null,
      quote_number: 'QTE-3011',
      title: 'Agency Retainer & Client Portal Rollout',
      customer_name: 'Northstar Creative Agency',
      customer_email: 'ops@northstaragency.invalid',
      subtotal_cents: q3011Totals.subtotal_cents,
      tax_bps: q3011Totals.tax_bps,
      tax_cents: q3011Totals.tax_cents,
      total_cents: q3011Totals.total_cents,
      status: 'sent',
      portal_token: 'qpt_demo_northstar_3011',
      signed_by_name: null,
      signed_at: null,
      valid_until: isoOffsetFrom(anchorMs, 14 * DAY_MS).slice(0, 10),
      notes: 'Under $500 Full Auto threshold: auto-converts immediately on signature.',
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
    {
      id: quote3012Id,
      workspace_id: DEMO_WORKSPACE_ID,
      lead_id: null,
      customer_id: null,
      quote_number: 'QTE-3012',
      title: 'Wholesale Order & AR Automation',
      customer_name: 'Harborline Goods Wholesale',
      customer_email: 'finance@harborline.invalid',
      subtotal_cents: q3012Totals.subtotal_cents,
      tax_bps: q3012Totals.tax_bps,
      tax_cents: q3012Totals.tax_cents,
      total_cents: q3012Totals.total_cents,
      status: 'sent',
      portal_token: 'qpt_demo_harborline_3012',
      signed_by_name: null,
      signed_at: null,
      valid_until: isoOffsetFrom(anchorMs, 21 * DAY_MS).slice(0, 10),
      notes: 'Over $500 Full Auto cap by default: queues for 1-Tap Approval unless cap is raised.',
      created_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
    },
    {
      id: quote3010Id,
      workspace_id: DEMO_WORKSPACE_ID,
      lead_id: null,
      customer_id: customers[0]?.id ?? null,
      quote_number: 'QTE-3010',
      title: 'Clinic Recall & AR Automation Suite',
      customer_name: 'Summit Dental Group',
      customer_email: 'office@summitdental.invalid',
      subtotal_cents: q3010Totals.subtotal_cents,
      tax_bps: q3010Totals.tax_bps,
      tax_cents: q3010Totals.tax_cents,
      total_cents: q3010Totals.total_cents,
      status: 'signed',
      portal_token: 'qpt_demo_summit_3010',
      signed_by_name: 'Dr. Elena Rostova',
      signed_at: isoOffsetFrom(anchorMs, -18 * DAY_MS),
      valid_until: isoOffsetFrom(anchorMs, -4 * DAY_MS).slice(0, 10),
      notes: 'Signed client portal agreement.',
      created_at: isoOffsetFrom(anchorMs, -20 * DAY_MS),
    },
  ]

  const osQuoteItemsByQuote: Record<string, AutonomousQuoteItem[]> = {
    [quote3011Id]: q3011Totals.items.map((item, idx) => ({
      id: `qi_3011_${idx + 1}`,
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: quote3011Id,
      position: item.position,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.line_total_cents,
    })),
    [quote3012Id]: q3012Totals.items.map((item, idx) => ({
      id: `qi_3012_${idx + 1}`,
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: quote3012Id,
      position: item.position,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.line_total_cents,
    })),
    [quote3010Id]: q3010Totals.items.map((item, idx) => ({
      id: `qi_3010_${idx + 1}`,
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: quote3010Id,
      position: item.position,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.line_total_cents,
    })),
  }

  const osInvoices: AutonomousInvoice[] = [
    {
      id: '00000000-0000-4000-8000-00000000i310',
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: quote3010Id,
      lead_id: null,
      customer_id: customers[0]?.id ?? null,
      invoice_number: 'INV-3010',
      title: 'Clinic Recall & AR Automation Suite',
      customer_name: 'Summit Dental Group',
      customer_email: 'office@summitdental.invalid',
      subtotal_cents: 65000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 65000,
      amount_paid_cents: 0,
      due_date: isoOffsetFrom(anchorMs, -5 * DAY_MS).slice(0, 10),
      stripe_checkout_url: null,
      status: 'overdue',
      created_at: isoOffsetFrom(anchorMs, -18 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000i311',
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: null,
      lead_id: null,
      customer_id: customers[0]?.id ?? null,
      invoice_number: 'INV-3011',
      title: 'Annual Maintenance & Compliance Retainer',
      customer_name: 'Meridian Logistics Group',
      customer_email: 'ap@meridian.invalid',
      subtotal_cents: 185000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 185000,
      amount_paid_cents: 0,
      due_date: isoOffsetFrom(anchorMs, -12 * DAY_MS).slice(0, 10),
      stripe_checkout_url: null,
      status: 'overdue',
      created_at: isoOffsetFrom(anchorMs, -26 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000i312',
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: null,
      lead_id: null,
      customer_id: customers[2]?.id ?? null,
      invoice_number: 'INV-3012',
      title: 'Commercial Chiller Condenser Retrofit',
      customer_name: 'Cascade Precision Parts',
      customer_email: 'ap@cascadeprecision.invalid',
      subtotal_cents: 240000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 240000,
      amount_paid_cents: 0,
      due_date: isoOffsetFrom(anchorMs, -24 * DAY_MS).slice(0, 10),
      stripe_checkout_url: null,
      status: 'overdue',
      created_at: isoOffsetFrom(anchorMs, -40 * DAY_MS),
    },
    {
      id: '00000000-0000-4000-8000-00000000i309',
      workspace_id: DEMO_WORKSPACE_ID,
      quote_id: null,
      lead_id: null,
      customer_id: customers[1]?.id ?? null,
      invoice_number: 'INV-3009',
      title: 'E-Commerce Inventory & AR Sync Sprint',
      customer_name: 'Redwood Coast Goods',
      customer_email: 'ap@redwoodgoods.invalid',
      subtotal_cents: 89000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 89000,
      amount_paid_cents: 89000,
      due_date: isoOffsetFrom(anchorMs, -10 * DAY_MS).slice(0, 10),
      stripe_checkout_url: null,
      status: 'paid',
      created_at: isoOffsetFrom(anchorMs, -24 * DAY_MS),
    },
  ]

  const osInvoiceItemsByInvoice: Record<string, AutonomousInvoiceItem[]> = {
    '00000000-0000-4000-8000-00000000i310': [
      {
        id: 'ii_3010_1',
        workspace_id: DEMO_WORKSPACE_ID,
        invoice_id: '00000000-0000-4000-8000-00000000i310',
        position: 0,
        description: 'Patient Recall & Quote Follow-Up Pack',
        quantity: 1,
        unit_price_cents: 65000,
        line_total_cents: 65000,
      },
    ],
    '00000000-0000-4000-8000-00000000i309': [
      {
        id: 'ii_3009_1',
        workspace_id: DEMO_WORKSPACE_ID,
        invoice_id: '00000000-0000-4000-8000-00000000i309',
        position: 0,
        description: 'E-Commerce Inventory & AR Sync Sprint',
        quantity: 1,
        unit_price_cents: 89000,
        line_total_cents: 89000,
      },
    ],
  }

  const osAgentLedger: AgentActionLedgerEntry[] = [
    {
      id: '00000000-0000-4000-8000-00000000l301',
      workspace_id: DEMO_WORKSPACE_ID,
      agent_name: 'AR Watchdog Agent',
      module: 'billing',
      action_type: 'flag_overdue_ar',
      autonomy_mode: 'full_auto',
      summary: 'Flagged INV-3010 (Summit Dental Group · $650.00) 5 days past due in AR ledger',
      impact_cents: 65000,
      before_state: {
        invoice_id: '00000000-0000-4000-8000-00000000i310',
        invoice_status: 'sent',
      },
      after_state: {
        invoice_id: '00000000-0000-4000-8000-00000000i310',
        invoice_status: 'overdue',
      },
      status: 'executed',
      reversed_at: null,
      created_at: isoOffsetFrom(anchorMs, -1 * HOUR_MS),
    },
  ]

  const osComplianceItems: ComplianceVaultItem[] = [
    {
      id: 'cv-demo-coi',
      workspace_id: DEMO_WORKSPACE_ID,
      doc_type: 'coi',
      title: 'General Liability COI — Vanguard Subcontractors',
      counterparty: 'Vanguard Insurance Underwriters',
      expires_on: isoOffsetFrom(anchorMs, 18 * DAY_MS).slice(0, 10),
      notice_window_days: 45,
      annual_value_cents: 1440000,
      status: 'expiring_soon',
      notes: 'Requires updated endorsement before dispatching field subcontractors.',
      created_at: isoOffsetFrom(anchorMs, -90 * DAY_MS),
    },
    {
      id: 'cv-demo-saas',
      workspace_id: DEMO_WORKSPACE_ID,
      doc_type: 'saas_renewal',
      title: 'Legacy Field Routing Suite Auto-Renewal',
      counterparty: 'CloudRoute Software Inc.',
      expires_on: isoOffsetFrom(anchorMs, 29 * DAY_MS).slice(0, 10),
      notice_window_days: 45,
      annual_value_cents: 780000,
      status: 'expiring_soon',
      notes: 'Auto-renews at +12% uplift unless non-renewal notice is sent prior to window deadline.',
      created_at: isoOffsetFrom(anchorMs, -180 * DAY_MS),
    },
    {
      id: 'cv-demo-license',
      workspace_id: DEMO_WORKSPACE_ID,
      doc_type: 'license',
      title: 'State Commercial Contractor & HVAC License',
      counterparty: 'Dept. of Licensing & Compliance',
      expires_on: isoOffsetFrom(anchorMs, 165 * DAY_MS).slice(0, 10),
      notice_window_days: 60,
      annual_value_cents: 95000,
      status: 'active',
      notes: 'Good standing verified.',
      created_at: isoOffsetFrom(anchorMs, -120 * DAY_MS),
    },
  ]

  const osLivingSops: LivingSopRecord[] = [
    {
      id: 'sop-demo-1',
      workspace_id: DEMO_WORKSPACE_ID,
      module_key: 'quotes',
      title: 'Signed Portal Quote to Invoice & Ledger Sync',
      trigger_event: 'quote.portal_signed',
      steps_json: [
        'Validate client e-signature timestamp and quote portal token.',
        'Recompute exact integer-cent tax_cents and total_cents from line items.',
        'Evaluate Autonomy Dial (Full Auto vs 1-Tap Approve) against auto_limit_cents.',
        'Issue invoice and record reversible before/after snapshot in Agent Action Ledger.',
      ],
      version: 3,
      auto_generated: true,
      last_observed_at: isoOffsetFrom(anchorMs, -2 * HOUR_MS),
    },
    {
      id: 'sop-demo-2',
      workspace_id: DEMO_WORKSPACE_ID,
      module_key: 'inventory',
      title: '3-Way Match Variance & Vendor Dispute Protocol',
      trigger_event: 'vendor_bill.variance_exceeds_200bps',
      steps_json: [
        'Compare PO authorized unit pricing vs usable Goods Receipt units (received minus damaged).',
        'Calculate exact integer-cent match_variance_cents.',
        'Hold bill out of scheduled AP cash outflow until credit memo is issued.',
        'Stage citation-backed vendor dispute draft with requires_approval = true.',
      ],
      version: 2,
      auto_generated: true,
      last_observed_at: isoOffsetFrom(anchorMs, -5 * HOUR_MS),
    },
    {
      id: 'sop-demo-3',
      workspace_id: DEMO_WORKSPACE_ID,
      module_key: 'vault',
      title: '45-Day Contract Auto-Renewal Prevention Playbook',
      trigger_event: 'compliance_vault.entered_notice_window',
      steps_json: [
        'Calculate days remaining and subtract notice_window_days for cutoff date.',
        'Highlight annual_value_cents at risk in Command Bar and Compliance Vault KPIs.',
        'Stage non-renewal or renegotiation draft into approval queue prior to cutoff.',
      ],
      version: 1,
      auto_generated: true,
      last_observed_at: isoOffsetFrom(anchorMs, -1 * DAY_MS),
    },
  ]

  const osLedgerEntries: LedgerEntryRecord[] = [
    {
      id: 'le-demo-1',
      workspace_id: DEMO_WORKSPACE_ID,
      entry_type: 'revenue',
      category: 'Verified Settlements',
      description: 'Redwood Coast Goods paid sprint (INV-3009)',
      amount_cents: 89000,
      occurred_on: isoOffsetFrom(anchorMs, -8 * DAY_MS).slice(0, 10),
      source_ref: 'INV-3009',
    },
    {
      id: 'le-demo-2',
      workspace_id: DEMO_WORKSPACE_ID,
      entry_type: 'cogs',
      category: 'Supplier Parts',
      description: 'Carrier OEM blower & refrigerant kit stock batch',
      amount_cents: 112000,
      occurred_on: isoOffsetFrom(anchorMs, -6 * DAY_MS).slice(0, 10),
      source_ref: 'VB-9010',
    },
    {
      id: 'le-demo-3',
      workspace_id: DEMO_WORKSPACE_ID,
      entry_type: 'expense',
      category: 'Field Fleet Fuel & SaaS',
      description: 'Monthly dispatch software & fleet card settlement',
      amount_cents: 45000,
      occurred_on: isoOffsetFrom(anchorMs, -3 * DAY_MS).slice(0, 10),
      source_ref: 'EXP-1102',
    },
  ]

  const osVendorBills: VendorBillRecord[] = [
    {
      id: 'vb-demo-1',
      workspace_id: DEMO_WORKSPACE_ID,
      po_id: null,
      vendor_name: 'Apex Industrial Supply',
      invoice_number: 'VB-9040',
      subtotal_cents: 64000,
      tax_cents: 0,
      total_cents: 64000,
      due_date: isoOffsetFrom(anchorMs, 12 * DAY_MS).slice(0, 10),
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      discrepancy_summary: null,
      created_at: isoOffsetFrom(anchorMs, -5 * DAY_MS),
    },
    {
      id: 'vb-demo-2',
      workspace_id: DEMO_WORKSPACE_ID,
      po_id: null,
      vendor_name: 'Titan Mechanical Supply',
      invoice_number: 'VB-9048',
      subtotal_cents: 280000,
      tax_cents: 0,
      total_cents: 280000,
      due_date: isoOffsetFrom(anchorMs, 10 * DAY_MS).slice(0, 10),
      items_json: [
        {
          sku: 'VALVE-42',
          description: 'Brass Control Valve Batch',
          quantity: 50,
          unit_cost_cents: 5600,
        },
      ],
      match_status: 'exception_flagged',
      match_variance_cents: 70000,
      discrepancy_summary: 'Unit cost jumped +33.3% ($56.00 vs $42.00 PO baseline)',
      created_at: isoOffsetFrom(anchorMs, -2 * DAY_MS),
    },
  ]

  const osExecutableSops: ExecutableSopRecord[] = []
  const osVendorFraudAlerts: VendorFraudAlertRecord[] = []

  return {
    workspace,
    settings,
    subscription,
    policy,
    employees,
    customers,
    opportunities,
    recoveryEvents,
    verifiedPayments,
    documents,
    followUps,
    tasks,
    jobs,
    jobMaterials,
    quoteRevisions,
    quoteApprovals,
    appointments,
    servicePlans,
    inventoryItems,
    inventoryMovements,
    purchaseOrders,
    expenses,
    consentEvents,
    drafts,
    queueItems,
    businessEvents,
    workflows,
    workflowRuns,
    auditEvents,
    botManuals,
    stagedOpsActions,
    stagedLedgerEntries,
    botRuns,
    osAutonomyConfig,
    osQuotes,
    osQuoteItemsByQuote,
    osInvoices,
    osInvoiceItemsByInvoice,
    osAgentLedger,
    osThreeWaySimulation: null,
    osComplianceItems,
    osLivingSops,
    osShadowSession: null,
    osShadowFindings: [],
    osShadowPromotionLedgerId: null,
    osLedgerEntries,
    osVendorBills,
    osCpaPacket: null,
    osCollectionTouches: [],
    osDisputedInvoiceIds: [],
    osCollectionsRunLedgerId: null,
    osExecutableSops,
    osSopSimulation: null,
    osSopExecutionLedgerId: null,
    osVendorFraudAlerts,
    osFraudOverrideLedgerId: null,
  }
}

const AGING_LABELS: Record<OpsInvoiceAgingKey, string> = {
  not_due: 'Current (not yet due)',
  days_1_30: '1–30 days past due',
  days_31_60: '31–60 days past due',
  days_61_90: '61–90 days past due',
  over_90: 'Over 90 days past due',
}

export interface DemoStoreContextValue {
  state: DemoSandboxState
  opsSummary: OpsSummary
  coordinationSummary: OpsCoordinationSummary
  teamStatus: OpsTeamMemberStatus[]
  invoiceAging: OpsInvoiceAgingBucket[]
  leakScan: RevenueLeakScanSummary
  getCustomer360: (customerId: string) => Customer360Snapshot | null
  transitionJob: (jobId: string, nextStatus: Exclude<JobStatus, 'draft'>, evidence?: string) => void
  issueInvoiceForJob: (jobId: string) => DocumentRecord
  collectDemoOpportunity: (opportunityId: string, amount: number) => void
  recordDemoConsent: (params: {
    customerId: string
    channel: ConsentChannel
    decision: ConsentDecision
    evidenceReference: string
  }) => ConsentEvent
  saveDemoDraft: (params: {
    customerId: string
    channel: CommunicationDraftChannel
    subject: string
    message: string
  }) => OpsCommunicationDraft
  reviewDemoDraft: (draftId: string, decision: 'approved' | 'rejected') => void
  createDraftPurchaseOrder: (itemId: string) => OpsPurchaseOrder
  transitionPurchaseOrder: (
    poId: string,
    status: Exclude<PurchaseOrderStatus, 'draft'>,
    receiptReference?: string,
  ) => void
  adjustInventoryStock: (
    itemId: string,
    kind: Extract<InventoryMovementKind, 'receipt' | 'adjustment' | 'return'>,
    quantity: number,
    reason: string,
  ) => void
  completeTask: (taskId: string) => void
  createDemoFollowUpTask: (params: {
    title: string
    customerId?: string | null
    opportunityId?: string | null
    priority?: number
  }) => { task: Task; duplicate: boolean }
  scheduleDemoJob: (params: {
    jobId: string
    startsAt: string
    endsAt: string
    assignedWorker?: string | null
  }) => Appointment
  saveDemoExpense: (params: {
    vendor: string
    description?: string
    amount: number
    dueAt?: string | null
  }) => OpsExpense
  toggleDemoExpensePaid: (expenseId: string, paid: boolean) => void
  approveWorkflowRun: (runId: string) => void
  updateDemoPolicy: (patch: Partial<OpsPolicy>) => void
  updateDemoBotManual: (params: {
    botRole: BotRole
    mode: BotAutonomyMode
    instructionsMarkdown: string
  }) => void
  reviewDemoStagedOpsAction: (actionId: string, decision: 'approved' | 'rejected') => void
  reviewDemoStagedEntry: (entryId: string, decision: 'approved' | 'rejected') => void
  parseDemoReceiptWithGrokBot: (documentText: string) => StagedLedgerEntry
  arSummary: ArSummaryMetrics
  simulateClientESign: (quoteId: string, signerName: string) => {
    decision: 'execute_now' | 'queue_for_approval' | 'manual_only'
    invoiceNumber: string | null
  }
  approveDemoLedgerAction: (entryId: string) => void
  undoDemoLedgerAction: (entryId: string) => void
  setDemoAutonomyRule: (actionKey: AutonomyActionKey, mode: AutonomyMode) => void
  setDemoAutoLimitCents: (cents: number) => void
  toggleDemoModule: (key: WorkspaceModuleKey) => void
  stageDemoCollectionNudge: (invoiceId: string) => void
  markDemoInvoicePaid: (invoiceId: string) => void
  simulateShortShipmentThreeWayMatch: () => DemoThreeWaySimulation
  stageDemoComplianceNotice: (itemId: string) => { subject: string } | null
  runDemoShadowSample: () => { session: ShadowSession; findings: ShadowFinding[] }
  runDemoShadowCsv: (csvText: string, fileName?: string) => { session: ShadowSession; findings: ShadowFinding[] }
  dismissDemoShadowFinding: (findingId: string) => void
  promoteDemoShadowSession: () => { ledgerId: string; promotedCount: number } | null
  generateDemoCpaPacket: () => CpaAuditPacket
  runDemoAutonomousCollections: () => {
    plan: CollectionsRunPlan
    touches: CollectionTouchRecord[]
    ledgerId: string | null
  }
  toggleDemoInvoiceDisputed: (invoiceId: string) => void
  ownerMorningBrief: OwnerMorningBrief
  compileAndSimulateDemoSop: (prompt: string, safetyCapCents?: number) => SopSimulationResult
  executeDemoCompiledSop: () => { sop: ExecutableSopRecord; ledgerId: string } | null
  runDemoVendorFraudScan: () => VendorFraudAlertRecord[]
  overrideDemoVendorFraudAlert: (
    alertId: string,
    nextStatus: 'approved_override' | 'dismissed',
  ) => void
  commandSnapshot: CommandRouterSnapshot
  resetDemo: () => void
}

const DemoStoreContext = createContext<DemoStoreContextValue | null>(null)

export function DemoStoreProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [state, setState] = useState<DemoSandboxState>(() => createInitialDemoState())

  const leakScan = useMemo<RevenueLeakScanSummary>(
    () =>
      scanRevenueLeaks({
        customers: state.customers,
        documents: state.documents,
        opportunities: state.opportunities,
        jobs: state.jobs,
        jobMaterials: state.jobMaterials,
        appointments: state.appointments,
        followUps: state.followUps,
        tasks: state.tasks,
      }),
    [
      state.customers,
      state.documents,
      state.opportunities,
      state.jobs,
      state.jobMaterials,
      state.appointments,
      state.followUps,
      state.tasks,
    ],
  )

  const opsSummary = useMemo<OpsSummary>(() => {
    const nowMs = Date.now()
    const openJobs = state.jobs.filter(
      j => j.status !== 'completed' && j.status !== 'cancelled',
    ).length
    const openEstimates = state.jobs.filter(
      j => j.status === 'draft' || j.status === 'quoted',
    ).length
    const todayJobs = state.appointments.filter(a => {
      if (a.status !== 'scheduled') return false
      const ms = parseIsoMs(a.starts_at)
      return ms !== null && Math.abs(ms - nowMs) <= DAY_MS
    }).length
    const lowStock = state.inventoryItems.filter(
      item => !item.archived && item.quantity - item.reserved <= item.reorder_threshold,
    ).length
    const inventoryValue = state.inventoryItems
      .filter(i => !i.archived)
      .reduce((sum, i) => sum + i.quantity * i.purchase_cost, 0)
    const urgentTasks = state.tasks.filter(
      t => (t.status === 'open' || t.status === 'in_progress') && t.priority >= 85,
    ).length
    const invoices = state.documents.filter(d => d.document_type === 'invoice')
    const invoiceTotal = invoices.reduce((sum, d) => sum + d.total, 0)
    const unpaidInvoices = invoices
      .filter(d => d.status === 'sent' || d.status === 'overdue')
      .reduce((sum, d) => sum + d.total, 0)
    const ownerReportedPaid = invoices
      .filter(d => d.status === 'paid')
      .reduce((sum, d) => sum + d.total, 0)
    const verifiedCollections = state.verifiedPayments.reduce(
      (sum, p) => sum + p.amount_cents / 100,
      0,
    )
    const expensesTotal = state.expenses.reduce((sum, e) => sum + e.amount, 0)
    const billsDue = state.expenses.filter(e => !e.paid).reduce((sum, e) => sum + e.amount, 0)
    const awaitingApproval =
      state.purchaseOrders.filter(po => po.status === 'draft').length +
      state.drafts.filter(dr => dr.status === 'draft').length +
      state.workflowRuns.filter(r => r.status === 'waiting_approval').length
    const failedOperations =
      state.queueItems.filter(q => q.status === 'dead_letter').length +
      state.businessEvents.filter(e => e.status === 'dead_letter').length

    return {
      open_jobs: openJobs,
      open_estimates: openEstimates,
      today_jobs: todayJobs,
      low_stock: lowStock,
      inventory_value: Math.round(inventoryValue * 100) / 100,
      urgent_tasks: urgentTasks,
      invoice_total: Math.round(invoiceTotal * 100) / 100,
      unpaid_invoices: Math.round(unpaidInvoices * 100) / 100,
      owner_reported_paid: Math.round(ownerReportedPaid * 100) / 100,
      verified_collections: Math.round(verifiedCollections * 100) / 100,
      expenses: Math.round(expensesTotal * 100) / 100,
      bills_due: Math.round(billsDue * 100) / 100,
      awaiting_approval: awaitingApproval,
      failed_operations: failedOperations,
    }
  }, [state])

  const coordinationSummary = useMemo<OpsCoordinationSummary>(
    () => ({
      events_pending: state.businessEvents.filter(e => e.status === 'pending').length,
      events_completed: state.businessEvents.filter(e => e.status === 'completed').length,
      events_failed: state.businessEvents.filter(e => e.status === 'dead_letter').length,
      verified_tasks: state.tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
        .length,
      completed_tasks: state.tasks.filter(t => t.status === 'done' || t.status === 'completed')
        .length,
      drafts_waiting: state.drafts.filter(d => d.status === 'draft').length,
      recurring_services: state.servicePlans.filter(s => s.enabled).length,
    }),
    [state.businessEvents, state.tasks, state.drafts, state.servicePlans],
  )

  const teamStatus = useMemo<OpsTeamMemberStatus[]>(
    () =>
      state.employees.map((emp, idx) => ({
        user_id: emp.user_id,
        role: idx === 0 ? 'owner' : 'staff',
        display_name: emp.display_name,
        job_title: emp.job_title,
        phone: emp.phone,
        skills: emp.skills,
        active: emp.active,
        open_jobs: state.jobs.filter(
          j =>
            j.assigned_to === emp.user_id &&
            j.status !== 'completed' &&
            j.status !== 'cancelled',
        ).length,
      })),
    [state.employees, state.jobs],
  )

  const invoiceAging = useMemo<OpsInvoiceAgingBucket[]>(() => {
    const totals: Record<OpsInvoiceAgingKey, number> = {
      not_due: 0,
      days_1_30: 0,
      days_31_60: 0,
      days_61_90: 0,
      over_90: 0,
    }
    const nowMs = Date.now()
    for (const doc of state.documents) {
      if (doc.document_type !== 'invoice') continue
      if (doc.status !== 'sent' && doc.status !== 'overdue') continue
      const dueMs = parseIsoMs(doc.due_at)
      const overdueDays = dueMs !== null && nowMs > dueMs ? Math.floor((nowMs - dueMs) / DAY_MS) : 0
      const key = agingBucketForDays(overdueDays)
      totals[key] = Math.round((totals[key] + doc.total) * 100) / 100
    }
    const order: OpsInvoiceAgingKey[] = ['not_due', 'days_1_30', 'days_31_60', 'days_61_90', 'over_90']
    return order.map(key => ({
      key,
      label: AGING_LABELS[key],
      amount: totals[key],
    }))
  }, [state.documents])

  const getCustomer360 = useCallback(
    (customerId: string): Customer360Snapshot | null => {
      const customer = state.customers.find(c => c.id === customerId)
      if (!customer) return null
      return {
        customer,
        jobs: state.jobs.filter(j => j.customer_id === customerId),
        documents: state.documents.filter(d => d.customer_id === customerId),
        appointments: state.appointments.filter(a => a.customer_id === customerId),
        drafts: state.drafts.filter(d => d.customer_id === customerId),
        consentEvents: state.consentEvents.filter(e => e.customer_id === customerId),
        tasks: state.tasks.filter(t => t.customer_id === customerId),
        followUps: state.followUps.filter(f => f.customer_id === customerId),
        opportunities: state.opportunities.filter(o => o.customer_id === customerId),
        verifiedPayments: state.verifiedPayments.filter(p => p.customer_id === customerId),
      }
    },
    [state],
  )

  const transitionJob = useCallback(
    (jobId: string, nextStatus: Exclude<JobStatus, 'draft'>, evidence?: string) => {
      setState(prev => {
        const target = prev.jobs.find(j => j.id === jobId)
        if (!target) return prev
        if (nextStatus === 'approved' && (!evidence || evidence.trim().length < 4)) {
          throw new Error('Customer approval evidence is required before marking a quote approved.')
        }
        const nowIso = new Date().toISOString()
        const updatedJobs = prev.jobs.map(j => {
          if (j.id !== jobId) return j
          return {
            ...j,
            status: nextStatus,
            approved_at: nextStatus === 'approved' ? nowIso : j.approved_at,
            approval_evidence:
              nextStatus === 'approved' ? evidence?.trim() ?? j.approval_evidence : j.approval_evidence,
            completed_at: nextStatus === 'completed' ? nowIso : j.completed_at,
            updated_at: nowIso,
          }
        })
        return { ...prev, jobs: updatedJobs }
      })
    },
    [],
  )

  const issueInvoiceForJob = useCallback(
    (jobId: string): DocumentRecord => {
      const targetJob = state.jobs.find(j => j.id === jobId)
      if (!targetJob) {
        throw new Error('Job not found in sandbox.')
      }
      const total = calculateJobBillableTotal(targetJob, state.jobMaterials)
      const nowIso = new Date().toISOString()
      const newDoc: DocumentRecord = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        customer_id: targetJob.customer_id,
        opportunity_id: null,
        document_type: 'invoice',
        document_number: `INV-${1910 + state.documents.length}`,
        status: 'sent',
        total,
        due_at: new Date(Date.now() + 14 * DAY_MS).toISOString(),
        created_at: nowIso,
      }

      setState(prev => ({
        ...prev,
        documents: [newDoc, ...prev.documents],
        jobs: prev.jobs.map(j =>
          j.id === jobId ? { ...j, invoice_id: newDoc.id, updated_at: nowIso } : j,
        ),
      }))

      return newDoc
    },
    [state.documents.length, state.jobMaterials, state.jobs],
  )

  const collectDemoOpportunity = useCallback((opportunityId: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Enter a valid collected dollar amount greater than $0.')
    }
    const cleanAmount = Math.round(amount * 100) / 100
    const nowIso = new Date().toISOString()

    setState(prev => {
      const target = prev.opportunities.find(o => o.id === opportunityId)
      if (!target || target.status === 'recovered') return prev

      const nextOpps = prev.opportunities.map(o =>
        o.id === opportunityId
          ? {
              ...o,
              status: 'recovered' as const,
              recovered_amount: cleanAmount,
              recovered_at: nowIso,
              updated_at: nowIso,
            }
          : o,
      )
      const nextDocs = prev.documents.map(d =>
        d.opportunity_id === opportunityId && d.document_type === 'invoice'
          ? { ...d, status: 'paid' as const, updated_at: nowIso }
          : d,
      )
      const newEvent: RecoveryEvent = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        opportunity_id: opportunityId,
        customer_id: target.customer_id,
        amount: cleanAmount,
        source: 'owner_confirmed_collection',
        note: `Collected on ${target.title}`,
        created_at: nowIso,
      }
      const newAudit: AuditEvent = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        actor_user_id: DEMO_OWNER_ID,
        entity_type: 'opportunity',
        entity_id: opportunityId,
        action: 'opportunity_collected',
        metadata: { amount: cleanAmount },
        created_at: nowIso,
      }

      return {
        ...prev,
        opportunities: nextOpps,
        documents: nextDocs,
        recoveryEvents: [newEvent, ...prev.recoveryEvents],
        auditEvents: [newAudit, ...prev.auditEvents],
      }
    })
  }, [])

  const recordDemoConsent = useCallback(
    (params: {
      customerId: string
      channel: ConsentChannel
      decision: ConsentDecision
      evidenceReference: string
    }): ConsentEvent => {
      const ref = params.evidenceReference.trim()
      if (ref.length < 8) {
        throw new Error('Consent evidence reference must be at least 8 characters.')
      }
      const event: ConsentEvent = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        customer_id: params.customerId,
        channel: params.channel,
        decision: params.decision,
        evidence_reference: ref,
        actor_user_id: DEMO_OWNER_ID,
        created_at: new Date().toISOString(),
      }

      setState(prev => ({
        ...prev,
        consentEvents: [event, ...prev.consentEvents],
        // Mirror database trigger `ops_consent_revocation`: automatically reject drafts on revoke
        drafts:
          params.decision === 'revoked'
            ? prev.drafts.map(d =>
                d.customer_id === params.customerId &&
                d.channel === params.channel &&
                d.status === 'draft'
                  ? { ...d, status: 'rejected' }
                  : d,
              )
            : prev.drafts,
      }))

      return event
    },
    [],
  )

  const saveDemoDraft = useCallback(
    (params: {
      customerId: string
      channel: CommunicationDraftChannel
      subject: string
      message: string
    }): OpsCommunicationDraft => {
      if (!params.message.trim()) {
        throw new Error('Draft message cannot be empty.')
      }
      const draft: OpsCommunicationDraft = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        customer_id: params.customerId,
        source_event_id: null,
        channel: params.channel,
        subject: params.subject.trim() || 'Customer Follow-Up',
        message: params.message.trim(),
        status: 'draft',
        approved_by: null,
        approved_at: null,
        delivery_status: 'not_sent',
        created_at: new Date().toISOString(),
      }
      setState(prev => ({ ...prev, drafts: [draft, ...prev.drafts] }))
      return draft
    },
    [],
  )

  const reviewDemoDraft = useCallback((draftId: string, decision: 'approved' | 'rejected') => {
    setState(prev => {
      const draft = prev.drafts.find(d => d.id === draftId)
      if (!draft) return prev

      if (decision === 'approved') {
        const latestConsent = prev.consentEvents.find(
          e => e.customer_id === draft.customer_id && e.channel === draft.channel,
        )
        if (!latestConsent || latestConsent.decision !== 'granted') {
          throw new Error(
            `Cannot approve ${draft.channel.toUpperCase()} draft: active granted customer consent is required.`,
          )
        }
      }

      const nowIso = new Date().toISOString()
      const nextDrafts = prev.drafts.map(d =>
        d.id === draftId
          ? {
              ...d,
              status: decision,
              approved_by: decision === 'approved' ? DEMO_OWNER_ID : null,
              approved_at: decision === 'approved' ? nowIso : null,
            }
          : d,
      )
      const audit: AuditEvent = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        actor_user_id: DEMO_OWNER_ID,
        entity_type: 'ops_communication_draft',
        entity_id: draftId,
        action: decision === 'approved' ? 'recovery_draft_approved' : 'recovery_draft_rejected',
        metadata: { channel: draft.channel, delivery_status: 'not_sent' },
        created_at: nowIso,
      }
      return {
        ...prev,
        drafts: nextDrafts,
        auditEvents: [audit, ...prev.auditEvents],
      }
    })
  }, [])

  const createDraftPurchaseOrder = useCallback(
    (itemId: string): OpsPurchaseOrder => {
      const item = state.inventoryItems.find(i => i.id === itemId)
      if (!item) {
        throw new Error('Inventory SKU not found.')
      }
      const po: OpsPurchaseOrder = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        item_id: item.id,
        supplier: item.supplier,
        quantity: Math.max(1, item.reorder_quantity || 5),
        unit_cost: item.purchase_cost,
        status: 'draft',
        approved_by: null,
        receipt_reference: null,
        created_at: new Date().toISOString(),
      }
      setState(prev => ({ ...prev, purchaseOrders: [po, ...prev.purchaseOrders] }))
      return po
    },
    [state.inventoryItems],
  )

  const transitionPurchaseOrder = useCallback(
    (
      poId: string,
      status: Exclude<PurchaseOrderStatus, 'draft'>,
      receiptReference?: string,
    ) => {
      setState(prev => {
        const target = prev.purchaseOrders.find(p => p.id === poId)
        if (!target) return prev

        const nowIso = new Date().toISOString()
        const nextPos = prev.purchaseOrders.map(p =>
          p.id === poId
            ? {
                ...p,
                status,
                approved_by: status === 'approved' ? DEMO_OWNER_ID : p.approved_by,
                receipt_reference: receiptReference?.trim() || p.receipt_reference,
              }
            : p,
        )

        if (status !== 'received') {
          return { ...prev, purchaseOrders: nextPos }
        }

        const nextItems = prev.inventoryItems.map(item =>
          item.id === target.item_id
            ? { ...item, quantity: item.quantity + target.quantity, updated_at: nowIso }
            : item,
        )
        const updatedItem = nextItems.find(i => i.id === target.item_id)
        const movement: InventoryMovement = {
          id: crypto.randomUUID(),
          workspace_id: DEMO_WORKSPACE_ID,
          item_id: target.item_id,
          job_id: null,
          kind: 'receipt',
          quantity: target.quantity,
          balance: updatedItem?.quantity ?? target.quantity,
          reason: `PO received (${receiptReference?.trim() || poId.slice(0, 8)})`,
          actor_id: DEMO_OWNER_ID,
          created_at: nowIso,
        }

        return {
          ...prev,
          purchaseOrders: nextPos,
          inventoryItems: nextItems,
          inventoryMovements: [movement, ...prev.inventoryMovements],
        }
      })
    },
    [],
  )

  const adjustInventoryStock = useCallback(
    (
      itemId: string,
      kind: Extract<InventoryMovementKind, 'receipt' | 'adjustment' | 'return'>,
      quantity: number,
      reason: string,
    ) => {
      if (!Number.isFinite(quantity) || quantity === 0) {
        throw new Error('Stock movement quantity must be non-zero.')
      }
      if (!reason.trim()) {
        throw new Error('Provide a reason for the inventory stock adjustment.')
      }
      setState(prev => {
        const target = prev.inventoryItems.find(i => i.id === itemId)
        if (!target) return prev
        const delta = kind === 'receipt' || kind === 'return' ? Math.abs(Math.trunc(quantity)) : Math.trunc(quantity)
        const nextQty = target.quantity + delta
        if (nextQty < target.reserved) {
          throw new Error('Stock cannot drop below currently reserved job materials.')
        }
        const nowIso = new Date().toISOString()
        const nextItems = prev.inventoryItems.map(i =>
          i.id === itemId ? { ...i, quantity: nextQty, updated_at: nowIso } : i,
        )
        const movement: InventoryMovement = {
          id: crypto.randomUUID(),
          workspace_id: DEMO_WORKSPACE_ID,
          item_id: itemId,
          job_id: null,
          kind,
          quantity: delta,
          balance: nextQty,
          reason: reason.trim(),
          actor_id: DEMO_OWNER_ID,
          created_at: nowIso,
        }
        return {
          ...prev,
          inventoryItems: nextItems,
          inventoryMovements: [movement, ...prev.inventoryMovements],
        }
      })
    },
    [],
  )

  const completeTask = useCallback((taskId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => ({
      ...prev,
      tasks: prev.tasks.map(t =>
        t.id === taskId ? { ...t, status: 'completed', updated_at: nowIso } : t,
      ),
    }))
  }, [])

  const createDemoFollowUpTask = useCallback(
    (params: {
      title: string
      customerId?: string | null
      opportunityId?: string | null
      priority?: number
    }): { task: Task; duplicate: boolean } => {
      const cleanTitle = params.title.trim()
      if (!cleanTitle) {
        throw new Error('Task title is required.')
      }
      const existing = state.tasks.find(
        t =>
          (t.status === 'open' || t.status === 'in_progress') &&
          t.title.trim().toLowerCase() === cleanTitle.toLowerCase() &&
          (t.customer_id ?? null) === (params.customerId ?? null) &&
          (t.opportunity_id ?? null) === (params.opportunityId ?? null),
      )
      if (existing) {
        return { task: existing, duplicate: true }
      }
      const created: Task = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        customer_id: params.customerId ?? null,
        opportunity_id: params.opportunityId ?? null,
        title: cleanTitle,
        status: 'open',
        priority: params.priority ?? 90,
        due_at: new Date(Date.now() + DAY_MS).toISOString(),
        created_at: new Date().toISOString(),
      }
      setState(prev => ({ ...prev, tasks: [created, ...prev.tasks] }))
      return { task: created, duplicate: false }
    },
    [state.tasks],
  )

  const scheduleDemoJob = useCallback(
    (params: {
      jobId: string
      startsAt: string
      endsAt: string
      assignedWorker?: string | null
    }): Appointment => {
      const targetJob = state.jobs.find(j => j.id === params.jobId)
      if (!targetJob) {
        throw new Error('Job not found in sandbox.')
      }
      const startMs = parseIsoMs(params.startsAt)
      const endMs = parseIsoMs(params.endsAt)
      if (startMs === null || endMs === null || endMs <= startMs) {
        throw new Error('Appointment end time must be after the start time.')
      }
      const workerId = params.assignedWorker ?? targetJob.assigned_to ?? DEMO_TECH_TWO_ID
      const conflict = state.appointments.find(a => {
        if (a.status === 'cancelled' || a.status === 'canceled') return false
        if (a.ops_job_id === params.jobId) return false
        if (a.assigned_worker && workerId && a.assigned_worker !== workerId) return false
        const aStart = parseIsoMs(a.starts_at) ?? 0
        const aEnd = parseIsoMs(a.ends_at) ?? aStart + HOUR_MS
        return aStart < endMs && aEnd > startMs
      })
      if (conflict) {
        throw new Error(`Dispatch conflict: technician already booked on "${conflict.title}".`)
      }

      const nowIso = new Date().toISOString()
      const booking: Appointment = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        customer_id: targetJob.customer_id,
        ops_job_id: targetJob.id,
        assigned_worker: workerId,
        title: targetJob.title,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(endMs).toISOString(),
        status: 'scheduled',
        notes: targetJob.notes,
        created_at: nowIso,
      }

      setState(prev => ({
        ...prev,
        appointments: [
          booking,
          ...prev.appointments.filter(a => a.ops_job_id !== targetJob.id),
        ],
        jobs: prev.jobs.map(j =>
          j.id === targetJob.id
            ? {
                ...j,
                assigned_to: workerId,
                status: j.status === 'draft' || j.status === 'quoted' || j.status === 'approved' ? 'scheduled' : j.status,
                approved_at: j.approved_at ?? nowIso,
                approval_evidence: j.approval_evidence ?? 'Scheduled by owner in sandbox',
                updated_at: nowIso,
              }
            : j,
        ),
      }))
      return booking
    },
    [state.appointments, state.jobs],
  )

  const saveDemoExpense = useCallback(
    (params: {
      vendor: string
      description?: string
      amount: number
      dueAt?: string | null
    }): OpsExpense => {
      const vendor = params.vendor.trim()
      if (!vendor) throw new Error('Vendor name is required.')
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        throw new Error('Bill amount must be greater than $0.')
      }
      const expense: OpsExpense = {
        id: crypto.randomUUID(),
        workspace_id: DEMO_WORKSPACE_ID,
        job_id: null,
        vendor,
        description: params.description?.trim() || null,
        amount: Math.round(params.amount * 100) / 100,
        due_at: params.dueAt || null,
        paid: false,
        created_at: new Date().toISOString(),
      }
      setState(prev => ({ ...prev, expenses: [expense, ...prev.expenses] }))
      return expense
    },
    [],
  )

  const toggleDemoExpensePaid = useCallback((expenseId: string, paid: boolean) => {
    setState(prev => ({
      ...prev,
      expenses: prev.expenses.map(e => (e.id === expenseId ? { ...e, paid } : e)),
    }))
  }, [])

  const approveWorkflowRun = useCallback((runId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => {
      const targetRun = prev.workflowRuns.find(r => r.id === runId)
      if (!targetRun || targetRun.status !== 'waiting_approval') return prev
      const wf = prev.workflows.find(w => w.id === targetRun.workflow_id)
      const createdTasks: Task[] = []
      for (const action of wf?.actions ?? []) {
        if (action.type === 'create_task') {
          createdTasks.push({
            id: crypto.randomUUID(),
            workspace_id: DEMO_WORKSPACE_ID,
            customer_id: null,
            opportunity_id: (targetRun.context.record?.id as string | undefined) ?? null,
            title: action.title,
            status: 'open',
            priority: action.priority ?? 80,
            due_at: new Date(Date.now() + DAY_MS).toISOString(),
            created_at: nowIso,
          })
        }
      }
      return {
        ...prev,
        tasks: [...createdTasks, ...prev.tasks],
        workflowRuns: prev.workflowRuns.map(r =>
          r.id === runId
            ? {
                ...r,
                status: 'completed',
                approved_by: DEMO_OWNER_ID,
                completed_at: nowIso,
                result: { tasks_created: createdTasks.length },
              }
            : r,
        ),
      }
    })
  }, [])

  const updateDemoPolicy = useCallback((patch: Partial<OpsPolicy>) => {
    setState(prev => ({
      ...prev,
      policy: {
        ...prev.policy,
        ...patch,
        updated_at: new Date().toISOString(),
      },
    }))
  }, [])

  const updateDemoBotManual = useCallback(
    (params: {
      botRole: BotRole
      mode: BotAutonomyMode
      instructionsMarkdown: string
    }) => {
      const nowIso = new Date().toISOString()
      setState(prev => ({
        ...prev,
        botManuals: prev.botManuals.map(m =>
          m.bot_role === params.botRole
            ? {
                ...m,
                mode: params.mode,
                instructions_markdown: params.instructionsMarkdown,
                updated_at: nowIso,
              }
            : m,
        ),
      }))
    },
    [],
  )

  const reviewDemoStagedOpsAction = useCallback(
    (actionId: string, decision: 'approved' | 'rejected') => {
      const nowIso = new Date().toISOString()
      setState(prev => ({
        ...prev,
        stagedOpsActions: prev.stagedOpsActions.map(a =>
          a.id === actionId
            ? {
                ...a,
                status: decision,
                reviewed_by: DEMO_OWNER_ID,
                reviewed_at: nowIso,
              }
            : a,
        ),
      }))
    },
    [],
  )

  const reviewDemoStagedEntry = useCallback(
    (entryId: string, decision: 'approved' | 'rejected') => {
      const nowIso = new Date().toISOString()
      setState(prev => ({
        ...prev,
        stagedLedgerEntries: prev.stagedLedgerEntries.map(e =>
          e.id === entryId
            ? {
                ...e,
                status: decision,
                reviewed_by: DEMO_OWNER_ID,
                reviewed_at: nowIso,
              }
            : e,
        ),
      }))
    },
    [],
  )

  const parseDemoReceiptWithGrokBot = useCallback((documentText: string): StagedLedgerEntry => {
    const raw = documentText.trim()
    if (!raw) throw new Error('Paste a receipt or invoice to parse.')
    const nowIso = new Date().toISOString()
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
    const vendorMatch = /(?:vendor|supplier|from|merchant)[:\s]+([^\n\r]+)/i.exec(raw)
    const vendorName = (vendorMatch?.[1] ?? lines[0] ?? 'Submitted Vendor Bill')
      .slice(0, 120)
      .trim()
    const invMatch = /(?:invoice|receipt|bill|po)\s*(?:#|no\.?|number)?[:\s]*([A-Z0-9-]{3,40})/i.exec(
      raw,
    )
    const invoiceNumber = invMatch?.[1] ?? `DOC-${Date.now().toString().slice(-5)}`
    const taxMatch = /tax[:\s]*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(raw)
    const taxCents = taxMatch ? Math.round(Number(taxMatch[1]) * 100) : 0
    const totalMatch = /total[:\s]*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(raw)

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

    const computedSub = lineItems.reduce(
      (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
      0,
    )
    const totalCents = totalMatch
      ? Math.round(Number(totalMatch[1]) * 100)
      : computedSub + taxCents

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

    const entry: StagedLedgerEntry = {
      id: crypto.randomUUID(),
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'billing',
      entry_type: hasDiscrepancy ? 'discrepancy_flag' : 'expense_receipt',
      customer_id: null,
      vendor_name: `${vendorName} (${invoiceNumber})`,
      amount_cents: totalCents,
      currency: 'USD',
      line_items: lineItems,
      reasoning_summary: `Invoice ${invoiceNumber} · Recomputed subtotal $${(recomputedSub / 100).toFixed(2)} + tax $${(taxCents / 100).toFixed(2)} = $${(computedTotalCents / 100).toFixed(2)}${hasDiscrepancy ? ` · ARITHMETIC MISMATCH FLAGGED (stated $${(totalCents / 100).toFixed(2)})` : ''}`,
      confidence_score: 0.94,
      status: 'pending_approval',
      reviewed_by: null,
      reviewed_at: null,
      created_at: nowIso,
    }

    const run: BotRun = {
      id: crypto.randomUUID(),
      workspace_id: DEMO_WORKSPACE_ID,
      bot_role: 'billing',
      model: 'grok-4.7',
      mode: 'propose',
      status: 'completed',
      input_summary: `parse_document: ${vendorName} (${invoiceNumber})`,
      output_json: {
        computed_subtotal_cents: recomputedSub,
        computed_total_cents: computedTotalCents,
        has_discrepancy: hasDiscrepancy,
      },
      created_at: nowIso,
    }

    setState(prev => ({
      ...prev,
      stagedLedgerEntries: [entry, ...prev.stagedLedgerEntries],
      botRuns: [run, ...prev.botRuns],
    }))

    return entry
  }, [])

  const arSummary = useMemo<ArSummaryMetrics>(
    () => computeArSummary(state.osInvoices),
    [state.osInvoices],
  )

  const commandSnapshot = useMemo<CommandRouterSnapshot>(() => {
    const r2Items: Release2InventoryItem[] = state.inventoryItems.map(item => ({
      id: item.id,
      workspace_id: item.workspace_id,
      sku: item.sku,
      name: item.name,
      location: item.location,
      bin_code: null,
      on_hand_qty: Math.max(0, Math.round(item.quantity)),
      reserved_qty: Math.max(0, Math.round(item.reserved)),
      reorder_point_qty: Math.max(0, Math.round(item.reorder_threshold)),
      reorder_qty: Math.max(1, Math.round(item.reorder_quantity)),
      unit_cost_cents: Math.max(0, Math.round(item.purchase_cost * 100)),
      unit_price_cents: Math.max(0, Math.round(item.selling_price * 100)),
      preferred_vendor: item.supplier,
      lead_time_days: 5,
      archived: item.archived,
    }))
    return {
      invoices: state.osInvoices,
      inventoryItems: r2Items,
      complianceItems: state.osComplianceItems,
      sops: state.osLivingSops,
      ledgerEntries: state.osAgentLedger,
      baselineBalanceCents: 2850000,
      safetyBufferCents: 500000,
    }
  }, [
    state.osInvoices,
    state.inventoryItems,
    state.osComplianceItems,
    state.osLivingSops,
    state.osAgentLedger,
  ])

  const simulateClientESign = useCallback(
    (quoteId: string, rawSignerName: string) => {
      const targetQuote = state.osQuotes.find(q => q.id === quoteId)
      if (!targetQuote) {
        throw new Error('Selected demo quote was not found.')
      }
      const signer = rawSignerName.trim() || 'Alex Morgan (Client)'
      const nowIso = new Date().toISOString()
      const signedQuote: AutonomousQuote = {
        ...targetQuote,
        status: 'signed',
        signed_by_name: signer,
        signed_at: nowIso,
        updated_at: nowIso,
      }
      const items = state.osQuoteItemsByQuote[quoteId] ?? []
      const decision = evaluateAutonomyGate(
        'convert_signed_quote_to_invoice',
        signedQuote.total_cents,
        state.osAutonomyConfig,
      )
      const mode = state.osAutonomyConfig.autonomy_rules.convert_signed_quote_to_invoice
      const alreadyInvoiced = state.osInvoices.some(
        inv => inv.quote_id === quoteId && inv.status !== 'void',
      )

      if (decision === 'execute_now' && !alreadyInvoiced) {
        const converted = convertSignedQuoteToInvoice(signedQuote, items, {
          autonomyMode: mode,
          statusOverride: 'executed',
          nowIso,
          invoiceId: `inv_${quoteId}_${Date.now()}`,
          ledgerId: `led_${quoteId}_${Date.now()}`,
        })
        converted.ledgerEntry.before_state = {
          quote_id: quoteId,
          quote_status: targetQuote.status,
          invoice_id: null,
        }

        setState(prev => ({
          ...prev,
          osQuotes: prev.osQuotes.map(q => (q.id === quoteId ? signedQuote : q)),
          osInvoices: [converted.invoice, ...prev.osInvoices],
          osInvoiceItemsByInvoice: {
            ...prev.osInvoiceItemsByInvoice,
            [converted.invoice.id]: converted.invoiceItems,
          },
          osAgentLedger: [converted.ledgerEntry, ...prev.osAgentLedger],
        }))

        return {
          decision: 'execute_now' as const,
          invoiceNumber: converted.invoice.invoice_number,
        }
      }

      if (decision === 'queue_for_approval' && !alreadyInvoiced) {
        const queuedLedger: AgentActionLedgerEntry = {
          id: `led_q_${quoteId}_${Date.now()}`,
          workspace_id: DEMO_WORKSPACE_ID,
          agent_name: 'Revenue-to-Cash Agent',
          module: 'quotes',
          action_type: 'convert_signed_quote_to_invoice',
          autonomy_mode: mode,
          summary: `Signed quote ${signedQuote.quote_number} (${formatOsCents(signedQuote.total_cents)}) queued for 1-Tap invoice approval`,
          impact_cents: signedQuote.total_cents,
          before_state: {
            quote_id: quoteId,
            quote_status: targetQuote.status,
            invoice_id: null,
          },
          after_state: {
            quote_id: quoteId,
            pending_action: 'create_invoice',
            signed_by: signer,
          },
          status: 'pending_approval',
          reversed_at: null,
          created_at: nowIso,
        }
        setState(prev => ({
          ...prev,
          osQuotes: prev.osQuotes.map(q => (q.id === quoteId ? signedQuote : q)),
          osAgentLedger: [queuedLedger, ...prev.osAgentLedger],
        }))
        return {
          decision: 'queue_for_approval' as const,
          invoiceNumber: null,
        }
      }

      setState(prev => ({
        ...prev,
        osQuotes: prev.osQuotes.map(q => (q.id === quoteId ? signedQuote : q)),
      }))
      return {
        decision: 'manual_only' as const,
        invoiceNumber: null,
      }
    },
    [state.osQuotes, state.osQuoteItemsByQuote, state.osAutonomyConfig, state.osInvoices],
  )

  const approveDemoLedgerAction = useCallback((entryId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => {
      const target = prev.osAgentLedger.find(e => e.id === entryId)
      if (!target || target.status !== 'pending_approval') return prev

      const after = target.after_state ?? {}
      if (
        target.action_type === 'convert_signed_quote_to_invoice' &&
        typeof after.quote_id === 'string' &&
        !after.invoice_id
      ) {
        const quote = prev.osQuotes.find(q => q.id === after.quote_id)
        if (!quote) return prev
        const items = prev.osQuoteItemsByQuote[quote.id] ?? []
        const converted = convertSignedQuoteToInvoice(
          { ...quote, status: 'signed' },
          items,
          {
            autonomyMode: target.autonomy_mode,
            statusOverride: 'executed',
            nowIso,
            invoiceId: `inv_${quote.id}_${Date.now()}`,
            ledgerId: target.id,
          },
        )
        return {
          ...prev,
          osInvoices: [converted.invoice, ...prev.osInvoices],
          osInvoiceItemsByInvoice: {
            ...prev.osInvoiceItemsByInvoice,
            [converted.invoice.id]: converted.invoiceItems,
          },
          osAgentLedger: prev.osAgentLedger.map(e =>
            e.id === entryId
              ? {
                  ...e,
                  status: 'executed',
                  after_state: {
                    ...after,
                    invoice_id: converted.invoice.id,
                    invoice_number: converted.invoice.invoice_number,
                  },
                }
              : e,
          ),
        }
      }

      return {
        ...prev,
        osAgentLedger: prev.osAgentLedger.map(e =>
          e.id === entryId ? { ...e, status: 'executed' } : e,
        ),
      }
    })
  }, [])

  const undoDemoLedgerAction = useCallback((entryId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => {
      const target = prev.osAgentLedger.find(e => e.id === entryId)
      if (!target || target.status !== 'executed') return prev

      const { updatedEntry, restoredState } = reverseLedgerAction(target, nowIso)
      const after = target.after_state ?? {}
      const targetInvoiceId = typeof after.invoice_id === 'string' ? after.invoice_id : null
      const targetQuoteId =
        restoredState && typeof restoredState.quote_id === 'string'
          ? restoredState.quote_id
          : null

      let nextInvoices = prev.osInvoices
      if (targetInvoiceId && target.action_type === 'convert_signed_quote_to_invoice') {
        nextInvoices = prev.osInvoices.map(inv =>
          inv.id === targetInvoiceId ? { ...inv, status: 'void', updated_at: nowIso } : inv,
        )
      } else if (
        targetInvoiceId &&
        restoredState &&
        typeof restoredState.invoice_status === 'string'
      ) {
        const restoredStatus = restoredState.invoice_status as AutonomousInvoice['status']
        const restoredPaid =
          typeof restoredState.amount_paid_cents === 'number'
            ? restoredState.amount_paid_cents
            : undefined
        nextInvoices = prev.osInvoices.map(inv =>
          inv.id === targetInvoiceId
            ? {
                ...inv,
                status: restoredStatus,
                amount_paid_cents: restoredPaid ?? inv.amount_paid_cents,
                updated_at: nowIso,
              }
            : inv,
        )
      }

      let nextQuotes = prev.osQuotes
      if (
        targetQuoteId &&
        restoredState &&
        typeof restoredState.quote_status === 'string'
      ) {
        const prevQuoteStatus = restoredState.quote_status as AutonomousQuote['status']
        nextQuotes = prev.osQuotes.map(q =>
          q.id === targetQuoteId
            ? {
                ...q,
                status: prevQuoteStatus,
                signed_by_name: prevQuoteStatus === 'signed' ? q.signed_by_name : null,
                signed_at: prevQuoteStatus === 'signed' ? q.signed_at : null,
                updated_at: nowIso,
              }
            : q,
        )
      }

      const nextThreeWaySim =
        target.action_type === 'three_way_match_dispute' &&
        prev.osThreeWaySimulation?.ledger_entry_id === entryId
          ? null
          : prev.osThreeWaySimulation

      let nextComplianceItems = prev.osComplianceItems
      if (
        target.action_type === 'stage_compliance_notice' &&
        restoredState &&
        typeof restoredState.vault_item_id === 'string' &&
        typeof restoredState.vault_status === 'string'
      ) {
        const prevVaultStatus = restoredState.vault_status as ComplianceVaultItem['status']
        nextComplianceItems = prev.osComplianceItems.map(doc =>
          doc.id === restoredState.vault_item_id
            ? { ...doc, status: prevVaultStatus, updated_at: nowIso }
            : doc,
        )
      }

      let nextShadowSession = prev.osShadowSession
      let nextShadowFindings = prev.osShadowFindings
      let nextShadowPromotionLedgerId = prev.osShadowPromotionLedgerId

      if (
        target.action_type === 'promote_shadow_session' &&
        prev.osShadowSession &&
        restoredState &&
        restoredState.shadow_session_id === prev.osShadowSession.id
      ) {
        const prevSessionStatus =
          typeof restoredState.session_status === 'string'
            ? (restoredState.session_status as ShadowSession['status'])
            : 'ready'
        const openIds = new Set(
          Array.isArray(restoredState.open_finding_ids)
            ? restoredState.open_finding_ids.filter((id): id is string => typeof id === 'string')
            : [],
        )
        nextShadowSession = {
          ...prev.osShadowSession,
          status: prevSessionStatus,
          updated_at: nowIso,
        }
        nextShadowFindings = prev.osShadowFindings.map(item =>
          openIds.has(item.id) ? { ...item, status: 'open', updated_at: nowIso } : item,
        )
        if (prev.osShadowPromotionLedgerId === entryId) {
          nextShadowPromotionLedgerId = null
        }
      }

      let nextCollectionTouches = prev.osCollectionTouches
      let nextCollectionsRunLedgerId = prev.osCollectionsRunLedgerId

      if (target.action_type === 'stage_collections_run') {
        const touchIds = new Set(
          Array.isArray(target.after_state?.touch_ids)
            ? (target.after_state?.touch_ids as unknown[]).filter(
                (id): id is string => typeof id === 'string',
              )
            : [],
        )
        nextCollectionTouches = prev.osCollectionTouches.map(t =>
          touchIds.has(t.id) ? { ...t, status: 'reversed', updated_at: nowIso } : t,
        )
        if (prev.osCollectionsRunLedgerId === entryId) {
          nextCollectionsRunLedgerId = null
        }
      }

      let nextExecutableSops = prev.osExecutableSops
      let nextSopExecutionLedgerId = prev.osSopExecutionLedgerId

      if (
        target.action_type === 'execute_compiled_sop' &&
        restoredState &&
        typeof restoredState.executable_sop_id === 'string'
      ) {
        const prevSopStatus =
          typeof restoredState.sop_status === 'string'
            ? (restoredState.sop_status as ExecutableSopRecord['status'])
            : 'paused'
        const prevRuns = typeof restoredState.run_count === 'number' ? restoredState.run_count : 0
        nextExecutableSops = prev.osExecutableSops.map(s =>
          s.id === restoredState.executable_sop_id
            ? { ...s, status: prevSopStatus, run_count: prevRuns, updated_at: nowIso }
            : s,
        )
        if (prev.osSopExecutionLedgerId === entryId) {
          nextSopExecutionLedgerId = null
        }
      }

      let nextVendorFraudAlerts = prev.osVendorFraudAlerts
      let nextFraudOverrideLedgerId = prev.osFraudOverrideLedgerId

      if (
        target.action_type === 'override_vendor_fraud_alert' &&
        restoredState &&
        typeof restoredState.alert_id === 'string'
      ) {
        const prevAlertStatus =
          typeof restoredState.alert_status === 'string'
            ? (restoredState.alert_status as VendorFraudAlertRecord['status'])
            : 'frozen'
        nextVendorFraudAlerts = prev.osVendorFraudAlerts.map(a =>
          a.id === restoredState.alert_id
            ? { ...a, status: prevAlertStatus, updated_at: nowIso }
            : a,
        )
        if (prev.osFraudOverrideLedgerId === entryId) {
          nextFraudOverrideLedgerId = null
        }
      }

      return {
        ...prev,
        osQuotes: nextQuotes,
        osInvoices: nextInvoices,
        osAgentLedger: prev.osAgentLedger.map(e => (e.id === entryId ? updatedEntry : e)),
        osThreeWaySimulation: nextThreeWaySim,
        osComplianceItems: nextComplianceItems,
        osShadowSession: nextShadowSession,
        osShadowFindings: nextShadowFindings,
        osShadowPromotionLedgerId: nextShadowPromotionLedgerId,
        osCollectionTouches: nextCollectionTouches,
        osCollectionsRunLedgerId: nextCollectionsRunLedgerId,
        osExecutableSops: nextExecutableSops,
        osSopExecutionLedgerId: nextSopExecutionLedgerId,
        osVendorFraudAlerts: nextVendorFraudAlerts,
        osFraudOverrideLedgerId: nextFraudOverrideLedgerId,
      }
    })
  }, [])

  const setDemoAutonomyRule = useCallback(
    (actionKey: AutonomyActionKey, mode: AutonomyMode) => {
      setState(prev => ({
        ...prev,
        osAutonomyConfig: {
          ...prev.osAutonomyConfig,
          autonomy_rules: {
            ...prev.osAutonomyConfig.autonomy_rules,
            [actionKey]: mode,
          },
        },
      }))
    },
    [],
  )

  const setDemoAutoLimitCents = useCallback((cents: number) => {
    const safe = Number.isSafeInteger(cents) && cents >= 0 ? cents : 50000
    setState(prev => ({
      ...prev,
      osAutonomyConfig: {
        ...prev.osAutonomyConfig,
        auto_limit_cents: safe,
      },
    }))
  }, [])

  const toggleDemoModule = useCallback((key: WorkspaceModuleKey) => {
    setState(prev => ({
      ...prev,
      osAutonomyConfig: {
        ...prev.osAutonomyConfig,
        modules_enabled: {
          ...prev.osAutonomyConfig.modules_enabled,
          [key]: !prev.osAutonomyConfig.modules_enabled[key],
        },
      },
    }))
  }, [])

  const stageDemoCollectionNudge = useCallback(
    (invoiceId: string) => {
      const target = state.osInvoices.find(i => i.id === invoiceId)
      if (!target) return
      const balance = Math.max(0, target.total_cents - target.amount_paid_cents)
      const gate = evaluateAutonomyGate(
        'send_invoice_reminder',
        balance,
        state.osAutonomyConfig,
      )
      const mode = state.osAutonomyConfig.autonomy_rules.send_invoice_reminder
      const nowIso = new Date().toISOString()
      const ledger: AgentActionLedgerEntry = {
        id: `led_ar_${invoiceId}_${Date.now()}`,
        workspace_id: DEMO_WORKSPACE_ID,
        agent_name: 'AR Collections Agent',
        module: 'billing',
        action_type: 'send_invoice_reminder',
        autonomy_mode: mode,
        summary: `Staged collection nudge for ${target.invoice_number} (${target.customer_name} · ${formatOsCents(balance)})`,
        impact_cents: balance,
        before_state: { invoice_id: invoiceId, nudge_staged: false },
        after_state: { invoice_id: invoiceId, nudge_staged: true },
        status: gate === 'execute_now' ? 'executed' : 'pending_approval',
        reversed_at: null,
        created_at: nowIso,
      }
      setState(prev => ({
        ...prev,
        osAgentLedger: [ledger, ...prev.osAgentLedger],
      }))
    },
    [state.osInvoices, state.osAutonomyConfig],
  )

  const markDemoInvoicePaid = useCallback((invoiceId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => {
      const target = prev.osInvoices.find(i => i.id === invoiceId)
      if (!target || target.status === 'paid') return prev
      const ledger: AgentActionLedgerEntry = {
        id: `led_paid_${invoiceId}_${Date.now()}`,
        workspace_id: DEMO_WORKSPACE_ID,
        agent_name: 'AR Collections Agent',
        module: 'billing',
        action_type: 'mark_invoice_paid',
        autonomy_mode: 'manual',
        summary: `Recorded payment for ${target.invoice_number} (${formatOsCents(target.total_cents)})`,
        impact_cents: target.total_cents,
        before_state: {
          invoice_id: invoiceId,
          invoice_status: target.status,
          amount_paid_cents: target.amount_paid_cents,
        },
        after_state: {
          invoice_id: invoiceId,
          invoice_status: 'paid',
          amount_paid_cents: target.total_cents,
        },
        status: 'executed',
        reversed_at: null,
        created_at: nowIso,
      }
      return {
        ...prev,
        osInvoices: prev.osInvoices.map(i =>
          i.id === invoiceId
            ? { ...i, status: 'paid', amount_paid_cents: i.total_cents, updated_at: nowIso }
            : i,
        ),
        osCollectionTouches: prev.osCollectionTouches.map(t =>
          t.invoice_id === invoiceId && t.status === 'staged'
            ? {
                ...t,
                status: 'paused_paid',
                amount_due_cents: 0,
                proof_summary: `Auto-paused (Paid): ${target.invoice_number} settled in full ($0.00 remaining).`,
                updated_at: nowIso,
              }
            : t,
        ),
        osAgentLedger: [ledger, ...prev.osAgentLedger],
      }
    })
  }, [])

  const simulateShortShipmentThreeWayMatch = useCallback((): DemoThreeWaySimulation => {
    const nowIso = new Date().toISOString()
    const poItems = [{ sku: 'VALVE-42', ordered_qty: 100, unit_cost_cents: 4200 }]
    const receiptItems = [{ sku: 'VALVE-42', ordered_qty: 100, received_qty: 80, damaged_qty: 0 }]
    const billItems = [
      {
        sku: 'VALVE-42',
        description: 'Brass Control Valve',
        quantity: 100,
        unit_cost_cents: 4600,
      },
    ]

    const matchResult = runThreeWayMatch(poItems, receiptItems, billItems, 200, {
      poNumber: 'PO-4088',
      vendorName: 'Apex Industrial Supply',
      invoiceNumber: 'VB-9042',
    })

    const ledgerId = `led_3way_${Date.now()}`
    const ledgerEntry: AgentActionLedgerEntry = {
      id: ledgerId,
      workspace_id: DEMO_WORKSPACE_ID,
      agent_name: '3-Way Match Controller',
      module: 'bookkeeping',
      action_type: 'three_way_match_dispute',
      autonomy_mode: 'approve_1tap',
      summary: `Caught ${formatOsCents(matchResult.match_variance_cents)} short-shipment & price hike on VB-9042 (PO-4088) — staged vendor dispute`,
      impact_cents: matchResult.match_variance_cents,
      before_state: { invoice_number: 'VB-9042', bill_status: 'unmatched' },
      after_state: {
        invoice_number: 'VB-9042',
        bill_status: 'disputed',
        match_variance_cents: matchResult.match_variance_cents,
      },
      status: 'executed',
      reversed_at: null,
      created_at: nowIso,
    }

    const simulation: DemoThreeWaySimulation = {
      po_number: 'PO-4088',
      vendor_name: 'Apex Industrial Supply',
      invoice_number: 'VB-9042',
      sku: 'VALVE-42',
      ordered_qty: 100,
      po_unit_cost_cents: 4200,
      received_qty: 80,
      billed_qty: 100,
      billed_unit_cost_cents: 4600,
      bill_status: 'disputed',
      ledger_entry_id: ledgerId,
      match_result: matchResult,
    }

    setState(prev => ({
      ...prev,
      osThreeWaySimulation: simulation,
      osAgentLedger: [
        ledgerEntry,
        ...prev.osAgentLedger.filter(e => e.action_type !== 'three_way_match_dispute'),
      ],
    }))

    return simulation
  }, [])

  const stageDemoComplianceNotice = useCallback(
    (itemId: string): { subject: string } | null => {
      const target = state.osComplianceItems.find(doc => doc.id === itemId)
      if (!target || target.status === 'notice_staged') return null
      const nowIso = new Date().toISOString()
      const evalRes = evaluateComplianceDeadlines([target], nowIso.slice(0, 10))
      const evaluated = evalRes.evaluated_items[0]
      if (!evaluated) return null

      const ledgerEntry: AgentActionLedgerEntry = {
        ...evaluated.ledger_draft,
        id: `led_vault_${itemId}_${Date.now()}`,
        created_at: nowIso,
      }

      setState(prev => ({
        ...prev,
        osComplianceItems: prev.osComplianceItems.map(doc =>
          doc.id === itemId ? { ...doc, status: 'notice_staged', updated_at: nowIso } : doc,
        ),
        osAgentLedger: [ledgerEntry, ...prev.osAgentLedger],
      }))

      return { subject: evaluated.notice_draft.subject }
    },
    [state.osComplianceItems],
  )

  const runDemoShadowCsv = useCallback(
    (csvText: string, fileName = 'custom_shadow_export.csv', asOfDate?: string) => {
      const nowIso = new Date().toISOString()
      const sessionId = `sh_demo_${Date.now()}`
      const analysis = analyzeShadowCsv(csvText, {
        workspaceId: DEMO_WORKSPACE_ID,
        sessionId,
        fileName,
        asOfDate,
      })

      const session: ShadowSession = {
        id: sessionId,
        workspace_id: DEMO_WORKSPACE_ID,
        source_system: analysis.source_system,
        file_name: analysis.file_name,
        row_count: analysis.row_count,
        total_leak_cents: analysis.total_leak_cents,
        status: 'ready',
        created_at: nowIso,
        updated_at: nowIso,
      }

      setState(prev => ({
        ...prev,
        osShadowSession: session,
        osShadowFindings: analysis.findings,
        osShadowPromotionLedgerId: null,
      }))

      return { session, findings: analysis.findings }
    },
    [],
  )

  const runDemoShadowSample = useCallback(() => {
    const sample = loadSampleQuickBooksExport()
    return runDemoShadowCsv(sample.csv_text, sample.file_name, sample.as_of_date)
  }, [runDemoShadowCsv])

  const dismissDemoShadowFinding = useCallback((findingId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => {
      if (!prev.osShadowSession) return prev
      const nextFindings = prev.osShadowFindings.map(item =>
        item.id === findingId && item.status === 'open'
          ? { ...item, status: 'dismissed' as const, updated_at: nowIso }
          : item,
      )
      const nextTotal = recomputeShadowLeakTotalCents(nextFindings)
      return {
        ...prev,
        osShadowFindings: nextFindings,
        osShadowSession: {
          ...prev.osShadowSession,
          total_leak_cents: nextTotal,
          updated_at: nowIso,
        },
      }
    })
  }, [])

  const promoteDemoShadowSession = useCallback((): {
    ledgerId: string
    promotedCount: number
  } | null => {
    if (!state.osShadowSession) return null
    const nowIso = new Date().toISOString()
    const plan = buildShadowPromotionPlan({
      workspaceId: DEMO_WORKSPACE_ID,
      session: state.osShadowSession,
      findings: state.osShadowFindings,
      nowIso,
    })
    if (plan.openFindingIds.length === 0) return null

    const ledgerId = `led_shadow_${Date.now()}`
    const ledgerEntry: AgentActionLedgerEntry = {
      ...plan.ledgerDraft,
      id: ledgerId,
      created_at: nowIso,
    }

    setState(prev => ({
      ...prev,
      osShadowSession: plan.promotedSession,
      osShadowFindings: plan.promotedFindings,
      osShadowPromotionLedgerId: ledgerId,
      osAgentLedger: [ledgerEntry, ...prev.osAgentLedger],
    }))

    return { ledgerId, promotedCount: plan.openFindingIds.length }
  }, [state.osShadowSession, state.osShadowFindings])

  const generateDemoCpaPacket = useCallback((): CpaAuditPacket => {
    const packet = compileCpaAuditPacket({
      workspaceName: state.workspace.name,
      ledgerEntries: state.osLedgerEntries,
      invoices: state.osInvoices,
      vendorBills: state.osVendorBills,
      openingCashCents: 2500000,
    })
    setState(prev => ({
      ...prev,
      osCpaPacket: packet,
    }))
    return packet
  }, [state.workspace.name, state.osLedgerEntries, state.osInvoices, state.osVendorBills])

  const runDemoAutonomousCollections = useCallback(() => {
    const nowIso = new Date().toISOString()
    const portalMap = new Map<string, string>()
    for (const q of state.osQuotes) {
      if (q.portal_token) {
        portalMap.set(q.id, q.portal_token)
      }
    }

    const plan = evaluateAutonomousCollections({
      workspaceId: DEMO_WORKSPACE_ID,
      invoices: state.osInvoices,
      existingTouches: state.osCollectionTouches,
      disputedInvoiceIds: state.osDisputedInvoiceIds,
      portalTokenByQuoteId: portalMap,
      config: state.osAutonomyConfig,
      asOfDate: nowIso.slice(0, 10),
    })

    const touches: CollectionTouchRecord[] = plan.candidates.map((cand, idx) => ({
      id: `col_demo_${cand.invoice_id.slice(-4)}_${idx + 1}_${Date.now()}`,
      workspace_id: DEMO_WORKSPACE_ID,
      invoice_id: cand.invoice_id,
      stage: cand.stage,
      status: cand.status,
      amount_due_cents: cand.amount_due_cents,
      portal_url: cand.portal_url,
      proof_summary: cand.proof_summary,
      created_at: nowIso,
      updated_at: nowIso,
    }))

    const stagedTouchIds = touches.filter(t => t.status === 'staged').map(t => t.id)
    let ledgerId: string | null = null
    let ledgerEntry: AgentActionLedgerEntry | null = null

    if (stagedTouchIds.length > 0) {
      ledgerId = `led_col_${Date.now()}`
      ledgerEntry = {
        ...plan.ledger_draft,
        id: ledgerId,
        after_state: {
          ...(plan.ledger_draft.after_state ?? {}),
          touch_ids: stagedTouchIds,
        },
        created_at: nowIso,
      }
    }

    setState(prev => ({
      ...prev,
      osCollectionTouches: touches,
      osCollectionsRunLedgerId: ledgerId,
      osAgentLedger: ledgerEntry ? [ledgerEntry, ...prev.osAgentLedger] : prev.osAgentLedger,
    }))

    return { plan, touches, ledgerId }
  }, [
    state.osQuotes,
    state.osInvoices,
    state.osCollectionTouches,
    state.osDisputedInvoiceIds,
    state.osAutonomyConfig,
  ])

  const toggleDemoInvoiceDisputed = useCallback((invoiceId: string) => {
    const nowIso = new Date().toISOString()
    setState(prev => {
      const currentlyDisputed = prev.osDisputedInvoiceIds.includes(invoiceId)
      const nextDisputed = currentlyDisputed
        ? prev.osDisputedInvoiceIds.filter(id => id !== invoiceId)
        : [...prev.osDisputedInvoiceIds, invoiceId]
      const inv = prev.osInvoices.find(i => i.id === invoiceId)

      return {
        ...prev,
        osDisputedInvoiceIds: nextDisputed,
        osCollectionTouches: prev.osCollectionTouches.map(t => {
          if (t.invoice_id !== invoiceId) return t
          if (!currentlyDisputed && t.status === 'staged') {
            return {
              ...t,
              status: 'paused_disputed',
              proof_summary: `Auto-paused (disputed): ${inv?.invoice_number ?? invoiceId} held until owner resolves dispute.`,
              updated_at: nowIso,
            }
          }
          if (currentlyDisputed && t.status === 'paused_disputed') {
            return {
              ...t,
              status: 'staged',
              updated_at: nowIso,
            }
          }
          return t
        }),
      }
    })
  }, [])

  const ownerMorningBrief = useMemo<OwnerMorningBrief>(
    () =>
      compileOwnerMorningBrief({
        workspaceName: state.workspace.name,
        ledgerEntries: state.osLedgerEntries,
        invoices: state.osInvoices,
        vendorBills: state.osVendorBills,
        fraudAlerts: state.osVendorFraudAlerts,
        collectionTouches: state.osCollectionTouches,
        startingCashCents: 2500000,
        safetyBufferCents: 500000,
      }),
    [
      state.workspace.name,
      state.osLedgerEntries,
      state.osInvoices,
      state.osVendorBills,
      state.osVendorFraudAlerts,
      state.osCollectionTouches,
    ],
  )

  const compileAndSimulateDemoSop = useCallback(
    (prompt: string, safetyCapCents?: number): SopSimulationResult => {
      const compiled = compilePlainEnglishSop(prompt, { safetyCapCents })
      const simulation = simulateCompiledSop(compiled.rule, {
        sopName: compiled.name,
        plainEnglishPrompt: compiled.plain_english_prompt,
        vendorBills: state.osVendorBills,
        invoices: state.osInvoices,
        complianceItems: state.osComplianceItems,
        startingCashCents: ownerMorningBrief.cash_position_cents,
      })
      setState(prev => ({
        ...prev,
        osSopSimulation: simulation,
      }))
      return simulation
    },
    [
      state.osVendorBills,
      state.osInvoices,
      state.osComplianceItems,
      ownerMorningBrief.cash_position_cents,
    ],
  )

  const executeDemoCompiledSop = useCallback((): {
    sop: ExecutableSopRecord
    ledgerId: string
  } | null => {
    const sim = state.osSopSimulation
    if (!sim) return null
    const nowIso = new Date().toISOString()
    const draftSop: ExecutableSopRecord = {
      id: `exec_sop_demo_${Date.now()}`,
      workspace_id: DEMO_WORKSPACE_ID,
      name: sim.sop_name,
      plain_english_prompt: sim.plain_english_prompt,
      compiled_rule_json: sim.rule,
      status: 'draft',
      safety_cap_cents: sim.rule.safety_cap_cents,
      last_simulated_impact_cents: sim.total_impact_cents,
      run_count: 0,
      created_at: nowIso,
      updated_at: nowIso,
    }
    const res = executeCompiledSop({
      workspaceId: DEMO_WORKSPACE_ID,
      sop: draftSop,
      simulation: sim,
      config: state.osAutonomyConfig,
      nowIso,
    })
    const ledgerId = `led_sop_${Date.now()}`
    const ledgerEntry: AgentActionLedgerEntry = {
      ...res.ledger_draft,
      id: ledgerId,
      created_at: nowIso,
    }
    setState(prev => ({
      ...prev,
      osExecutableSops: [res.executable_sop, ...prev.osExecutableSops],
      osSopExecutionLedgerId: ledgerId,
      osAgentLedger: [ledgerEntry, ...prev.osAgentLedger],
    }))
    return { sop: res.executable_sop, ledgerId }
  }, [state.osSopSimulation, state.osAutonomyConfig])

  const runDemoVendorFraudScan = useCallback((): VendorFraudAlertRecord[] => {
    const nowIso = new Date().toISOString()
    const billInputs: VendorBillFraudInput[] = state.osVendorBills.map(bill =>
      bill.id === 'vb-demo-2'
        ? { ...bill, remit_account_hint: 'ACH-9988 (Unverified Remit)' }
        : bill,
    )
    const scan = scanVendorBillsForFraud({
      workspaceId: DEMO_WORKSPACE_ID,
      bills: billInputs,
      priorUnitCostsBySku: { 'VALVE-42': 4200 },
      knownRemitByVendor: { 'titan mechanical supply': 'ACH-4401' },
      asOfDate: nowIso.slice(0, 10),
    })
    const alertsWithTimestamps = scan.alerts.map(alert => ({
      ...alert,
      created_at: nowIso,
      updated_at: nowIso,
    }))
    setState(prev => ({
      ...prev,
      osVendorFraudAlerts: alertsWithTimestamps,
      osFraudOverrideLedgerId: null,
    }))
    return alertsWithTimestamps
  }, [state.osVendorBills])

  const overrideDemoVendorFraudAlert = useCallback(
    (alertId: string, nextStatus: 'approved_override' | 'dismissed') => {
      const target = state.osVendorFraudAlerts.find(a => a.id === alertId)
      if (!target || target.status !== 'frozen') return
      const nowIso = new Date().toISOString()
      const plan = buildFraudOverridePlan({
        workspaceId: DEMO_WORKSPACE_ID,
        alert: target,
        nextStatus,
        nowIso,
      })
      const ledgerId = `led_fraud_${Date.now()}`
      const ledgerEntry: AgentActionLedgerEntry = {
        ...plan.ledgerDraft,
        id: ledgerId,
        created_at: nowIso,
      }
      setState(prev => ({
        ...prev,
        osVendorFraudAlerts: prev.osVendorFraudAlerts.map(a =>
          a.id === alertId ? plan.updatedAlert : a,
        ),
        osFraudOverrideLedgerId: ledgerId,
        osAgentLedger: [ledgerEntry, ...prev.osAgentLedger],
      }))
    },
    [state.osVendorFraudAlerts],
  )

  const resetDemo = useCallback(() => {
    setState(createInitialDemoState())
  }, [])

  const value = useMemo<DemoStoreContextValue>(
    () => ({
      state,
      opsSummary,
      coordinationSummary,
      teamStatus,
      invoiceAging,
      leakScan,
      getCustomer360,
      transitionJob,
      issueInvoiceForJob,
      collectDemoOpportunity,
      recordDemoConsent,
      saveDemoDraft,
      reviewDemoDraft,
      createDraftPurchaseOrder,
      transitionPurchaseOrder,
      adjustInventoryStock,
      completeTask,
      createDemoFollowUpTask,
      scheduleDemoJob,
      saveDemoExpense,
      toggleDemoExpensePaid,
      approveWorkflowRun,
      updateDemoPolicy,
      updateDemoBotManual,
      reviewDemoStagedOpsAction,
      reviewDemoStagedEntry,
      parseDemoReceiptWithGrokBot,
      arSummary,
      simulateClientESign,
      approveDemoLedgerAction,
      undoDemoLedgerAction,
      setDemoAutonomyRule,
      setDemoAutoLimitCents,
      toggleDemoModule,
      stageDemoCollectionNudge,
      markDemoInvoicePaid,
      simulateShortShipmentThreeWayMatch,
      stageDemoComplianceNotice,
      runDemoShadowSample,
      runDemoShadowCsv,
      dismissDemoShadowFinding,
      promoteDemoShadowSession,
      generateDemoCpaPacket,
      runDemoAutonomousCollections,
      toggleDemoInvoiceDisputed,
      ownerMorningBrief,
      compileAndSimulateDemoSop,
      executeDemoCompiledSop,
      runDemoVendorFraudScan,
      overrideDemoVendorFraudAlert,
      commandSnapshot,
      resetDemo,
    }),
    [
      state,
      opsSummary,
      coordinationSummary,
      teamStatus,
      invoiceAging,
      leakScan,
      getCustomer360,
      transitionJob,
      issueInvoiceForJob,
      collectDemoOpportunity,
      recordDemoConsent,
      saveDemoDraft,
      reviewDemoDraft,
      createDraftPurchaseOrder,
      transitionPurchaseOrder,
      adjustInventoryStock,
      completeTask,
      createDemoFollowUpTask,
      scheduleDemoJob,
      saveDemoExpense,
      toggleDemoExpensePaid,
      approveWorkflowRun,
      updateDemoPolicy,
      updateDemoBotManual,
      reviewDemoStagedOpsAction,
      reviewDemoStagedEntry,
      parseDemoReceiptWithGrokBot,
      arSummary,
      simulateClientESign,
      approveDemoLedgerAction,
      undoDemoLedgerAction,
      setDemoAutonomyRule,
      setDemoAutoLimitCents,
      toggleDemoModule,
      stageDemoCollectionNudge,
      markDemoInvoicePaid,
      simulateShortShipmentThreeWayMatch,
      stageDemoComplianceNotice,
      runDemoShadowSample,
      runDemoShadowCsv,
      dismissDemoShadowFinding,
      promoteDemoShadowSession,
      generateDemoCpaPacket,
      runDemoAutonomousCollections,
      toggleDemoInvoiceDisputed,
      ownerMorningBrief,
      compileAndSimulateDemoSop,
      executeDemoCompiledSop,
      runDemoVendorFraudScan,
      overrideDemoVendorFraudAlert,
      commandSnapshot,
      resetDemo,
    ],
  )

  return <DemoStoreContext.Provider value={value}>{children}</DemoStoreContext.Provider>
}

export function useDemoStore(): DemoStoreContextValue {
  const ctx = useContext(DemoStoreContext)
  if (!ctx) {
    throw new Error('useDemoStore must be used inside <DemoStoreProvider>.')
  }
  return ctx
}
