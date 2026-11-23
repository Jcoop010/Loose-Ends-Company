import { fetchAllWorkspaceRows } from '../queries'
import { assertSupabaseConfigured, supabase } from '../supabase'
import {
  compilePlainEnglishSop,
  executeCompiledSop,
  simulateCompiledSop,
} from './sopCompiler'
import { buildFraudOverridePlan, scanVendorBillsForFraud } from './vendorFraudEngine'
import type {
  AgentActionLedgerEntry,
  AutonomousInvoice,
  AutonomousQuote,
  CollectionTouchRecord,
  ComplianceVaultItem,
  ExecutableSopRecord,
  ExecutableSopStatus,
  LedgerEntryRecord,
  LivingSopRecord,
  PurchaseOrderItemRecord,
  SopExecutionResult,
  VendorBillRecord,
  VendorFraudAlertRecord,
  WorkspaceAutonomyConfig,
} from './types'

export async function fetchExecutableSops(
  workspaceId: string,
): Promise<ExecutableSopRecord[]> {
  const rows = await fetchAllWorkspaceRows<ExecutableSopRecord>({
    table: 'executable_sops',
    workspaceId,
    orderBy: 'created_at',
    ascending: false,
  })
  return rows ?? []
}

export async function fetchSopSimulationInputs(workspaceId: string): Promise<{
  vendorBills: VendorBillRecord[]
  invoices: AutonomousInvoice[]
  complianceItems: ComplianceVaultItem[]
}> {
  const [vendorBills, invoices, complianceItems] = await Promise.all([
    fetchAllWorkspaceRows<VendorBillRecord>({
      table: 'vendor_bills',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<AutonomousInvoice>({
      table: 'invoices',
      workspaceId,
      orderBy: 'due_date',
      ascending: true,
    }),
    fetchAllWorkspaceRows<ComplianceVaultItem>({
      table: 'compliance_vault_items',
      workspaceId,
      orderBy: 'expires_on',
      ascending: true,
    }),
  ])

  return {
    vendorBills: vendorBills ?? [],
    invoices: invoices ?? [],
    complianceItems: complianceItems ?? [],
  }
}

export async function saveAndExecuteCompiledSopInDb(params: {
  workspaceId: string
  plainEnglishPrompt: string
  name?: string
  safetyCapCents?: number
  config: WorkspaceAutonomyConfig
}): Promise<{
  execution: SopExecutionResult
  ledgerEntry: AgentActionLedgerEntry
}> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()
  const compiled = compilePlainEnglishSop(params.plainEnglishPrompt, {
    name: params.name,
    safetyCapCents: params.safetyCapCents,
  })
  const simInputs = await fetchSopSimulationInputs(params.workspaceId)
  const simulation = simulateCompiledSop(compiled.rule, {
    sopName: compiled.name,
    plainEnglishPrompt: compiled.plain_english_prompt,
    vendorBills: simInputs.vendorBills,
    invoices: simInputs.invoices,
    complianceItems: simInputs.complianceItems,
  })

  const { data: insertedSop, error: sopErr } = await supabase
    .from('executable_sops')
    .insert({
      workspace_id: params.workspaceId,
      name: compiled.name,
      plain_english_prompt: compiled.plain_english_prompt,
      compiled_rule_json: compiled.rule,
      status: 'active',
      safety_cap_cents: compiled.rule.safety_cap_cents,
      last_simulated_impact_cents: simulation.total_impact_cents,
      run_count: 1,
      updated_at: nowIso,
    })
    .select('*')
    .single()

  if (sopErr || !insertedSop) {
    throw sopErr ?? new Error('Unable to save executable SOP.')
  }

  const baseSop = {
    ...(insertedSop as ExecutableSopRecord),
    status: 'draft' as const,
    run_count: 0,
  }
  const execution = executeCompiledSop({
    workspaceId: params.workspaceId,
    sop: baseSop,
    simulation,
    config: params.config,
    nowIso,
  })

  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      workspace_id: execution.ledger_draft.workspace_id,
      agent_name: execution.ledger_draft.agent_name,
      module: execution.ledger_draft.module,
      action_type: execution.ledger_draft.action_type,
      autonomy_mode: execution.ledger_draft.autonomy_mode,
      summary: execution.ledger_draft.summary,
      impact_cents: execution.ledger_draft.impact_cents,
      before_state: execution.ledger_draft.before_state,
      after_state: execution.ledger_draft.after_state,
      status: 'executed',
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerData) {
    throw ledgerErr ?? new Error('Executable SOP saved, but agent ledger logging failed.')
  }

  return {
    execution: {
      ...execution,
      executable_sop: insertedSop as ExecutableSopRecord,
    },
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
  }
}

export async function toggleExecutableSopStatusInDb(params: {
  workspaceId: string
  sop: ExecutableSopRecord
  nextStatus: ExecutableSopStatus
}): Promise<ExecutableSopRecord> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('executable_sops')
    .update({ status: params.nextStatus, updated_at: new Date().toISOString() })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.sop.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to update executable SOP status.')
  }
  return data as ExecutableSopRecord
}

export async function fetchVendorFraudAlerts(
  workspaceId: string,
): Promise<VendorFraudAlertRecord[]> {
  const rows = await fetchAllWorkspaceRows<VendorFraudAlertRecord>({
    table: 'vendor_fraud_alerts',
    workspaceId,
    orderBy: 'created_at',
    ascending: false,
  })
  return rows ?? []
}

export async function persistVendorFraudScanInDb(params: {
  workspaceId: string
  vendorBills: readonly VendorBillRecord[]
}): Promise<VendorFraudAlertRecord[]> {
  assertSupabaseConfigured()
  const [poItems, existingAlerts] = await Promise.all([
    fetchAllWorkspaceRows<PurchaseOrderItemRecord>({
      table: 'purchase_order_items',
      workspaceId: params.workspaceId,
      orderBy: 'created_at',
      ascending: true,
    }),
    fetchVendorFraudAlerts(params.workspaceId),
  ])

  const priorUnitCosts = new Map<string, number>()
  for (const item of poItems ?? []) {
    if (item.sku && item.unit_cost_cents > 0) {
      priorUnitCosts.set(item.sku.trim().toUpperCase(), item.unit_cost_cents)
    }
  }

  const scan = scanVendorBillsForFraud({
    workspaceId: params.workspaceId,
    bills: params.vendorBills,
    priorUnitCostsBySku: priorUnitCosts,
  })

  const existingKeys = new Set(
    existingAlerts.map(a => `${a.bill_id ?? ''}::${a.alert_type}`),
  )
  const freshPayloads = scan.alerts
    .filter(a => !existingKeys.has(`${a.bill_id ?? ''}::${a.alert_type}`))
    .map(a => ({
      workspace_id: params.workspaceId,
      bill_id: a.bill_id,
      vendor_name: a.vendor_name,
      alert_type: a.alert_type,
      variance_cents: a.variance_cents,
      proof_summary: a.proof_summary,
      status: 'frozen' as const,
      updated_at: new Date().toISOString(),
    }))

  if (freshPayloads.length > 0) {
    const { error } = await supabase.from('vendor_fraud_alerts').insert(freshPayloads)
    if (error) throw error
  }

  return fetchVendorFraudAlerts(params.workspaceId)
}

export async function resolveVendorFraudAlertInDb(params: {
  workspaceId: string
  alert: VendorFraudAlertRecord
  nextStatus: 'approved_override' | 'dismissed'
}): Promise<{
  alert: VendorFraudAlertRecord
  ledgerEntry: AgentActionLedgerEntry
}> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()
  const plan = buildFraudOverridePlan({
    workspaceId: params.workspaceId,
    alert: params.alert,
    nextStatus: params.nextStatus,
    nowIso,
  })

  const { data: updatedAlert, error: alertErr } = await supabase
    .from('vendor_fraud_alerts')
    .update({ status: params.nextStatus, updated_at: nowIso })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.alert.id)
    .select('*')
    .single()

  if (alertErr || !updatedAlert) {
    throw alertErr ?? new Error('Unable to update vendor fraud alert.')
  }

  const typedUpdatedAlert = updatedAlert as VendorFraudAlertRecord
  if (params.nextStatus === 'approved_override' && typedUpdatedAlert.capture_id) {
    const { error: unfreezeErr } = await supabase
      .from('inbound_bill_captures')
      .update({ match_status: 'needs_review', updated_at: nowIso })
      .eq('workspace_id', params.workspaceId)
      .eq('id', typedUpdatedAlert.capture_id)
      .eq('match_status', 'fraud_frozen')
    if (unfreezeErr) throw unfreezeErr
  }

  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      workspace_id: plan.ledgerDraft.workspace_id,
      agent_name: plan.ledgerDraft.agent_name,
      module: plan.ledgerDraft.module,
      action_type: plan.ledgerDraft.action_type,
      autonomy_mode: plan.ledgerDraft.autonomy_mode,
      summary: plan.ledgerDraft.summary,
      impact_cents: plan.ledgerDraft.impact_cents,
      before_state: plan.ledgerDraft.before_state,
      after_state: plan.ledgerDraft.after_state,
      status: 'executed',
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerData) {
    throw ledgerErr ?? new Error('Alert resolved, but agent ledger logging failed.')
  }

  return {
    alert: updatedAlert as VendorFraudAlertRecord,
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
  }
}

export async function fetchMorningBriefInputs(workspaceId: string): Promise<{
  ledgerEntries: LedgerEntryRecord[]
  invoices: AutonomousInvoice[]
  vendorBills: VendorBillRecord[]
  fraudAlerts: VendorFraudAlertRecord[]
  collectionTouches: CollectionTouchRecord[]
}> {
  const [ledgerEntries, invoices, vendorBills, fraudAlerts, collectionTouches] = await Promise.all([
    fetchAllWorkspaceRows<LedgerEntryRecord>({
      table: 'ledger_entries',
      workspaceId,
      orderBy: 'occurred_on',
      ascending: false,
    }),
    fetchAllWorkspaceRows<AutonomousInvoice>({
      table: 'invoices',
      workspaceId,
      orderBy: 'due_date',
      ascending: true,
    }),
    fetchAllWorkspaceRows<VendorBillRecord>({
      table: 'vendor_bills',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<VendorFraudAlertRecord>({
      table: 'vendor_fraud_alerts',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<CollectionTouchRecord>({
      table: 'collection_touches',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
  ])

  return {
    ledgerEntries: ledgerEntries ?? [],
    invoices: (invoices ?? []).filter(i => i.status !== 'void'),
    vendorBills: vendorBills ?? [],
    fraudAlerts: fraudAlerts ?? [],
    collectionTouches: collectionTouches ?? [],
  }
}

export async function fetchFullPortabilityExportInputs(workspaceId: string): Promise<{
  quotes: AutonomousQuote[]
  complianceItems: ComplianceVaultItem[]
  livingSops: LivingSopRecord[]
  executableSops: ExecutableSopRecord[]
  fraudAlerts: VendorFraudAlertRecord[]
  collectionTouches: CollectionTouchRecord[]
}> {
  const [quotes, complianceItems, livingSops, executableSops, fraudAlerts, collectionTouches] =
    await Promise.all([
      fetchAllWorkspaceRows<AutonomousQuote>({ table: 'quotes', workspaceId }),
      fetchAllWorkspaceRows<ComplianceVaultItem>({ table: 'compliance_vault_items', workspaceId }),
      fetchAllWorkspaceRows<LivingSopRecord>({ table: 'living_sops', workspaceId }),
      fetchAllWorkspaceRows<ExecutableSopRecord>({ table: 'executable_sops', workspaceId }),
      fetchAllWorkspaceRows<VendorFraudAlertRecord>({ table: 'vendor_fraud_alerts', workspaceId }),
      fetchAllWorkspaceRows<CollectionTouchRecord>({ table: 'collection_touches', workspaceId }),
    ])

  return {
    quotes: quotes ?? [],
    complianceItems: complianceItems ?? [],
    livingSops: livingSops ?? [],
    executableSops: executableSops ?? [],
    fraudAlerts: fraudAlerts ?? [],
    collectionTouches: collectionTouches ?? [],
  }
}
