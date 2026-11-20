import { opsCommand, createIdempotencyKey } from '../opsCommand'
import { fetchAllWorkspaceRows } from '../queries'
import { assertSupabaseConfigured, supabase } from '../supabase'
import { formatCents } from './engine'
import { evaluateComplianceDeadlines } from './enterpriseEngine'
import type {
  AgentActionLedgerEntry,
  AutonomousInvoice,
  CommandRouterSnapshot,
  ComplianceDocType,
  ComplianceVaultItem,
  LivingSopRecord,
  Release2InventoryItem,
} from './types'

export async function fetchComplianceVaultItems(
  workspaceId: string,
): Promise<ComplianceVaultItem[]> {
  const rows = await fetchAllWorkspaceRows<ComplianceVaultItem>({
    table: 'compliance_vault_items',
    workspaceId,
    orderBy: 'expires_on',
    ascending: true,
  })
  return rows ?? []
}

export async function createComplianceVaultItemInDb(params: {
  workspaceId: string
  doc_type: ComplianceDocType
  title: string
  counterparty: string
  expires_on: string
  notice_window_days: number
  annual_value_cents: number
  notes?: string | null
}): Promise<ComplianceVaultItem> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('compliance_vault_items')
    .insert({
      workspace_id: params.workspaceId,
      doc_type: params.doc_type,
      title: params.title.trim(),
      counterparty: params.counterparty.trim(),
      expires_on: params.expires_on,
      notice_window_days: Math.max(0, Math.trunc(params.notice_window_days)),
      annual_value_cents: Math.max(0, Math.trunc(params.annual_value_cents)),
      status: 'active',
      notes: params.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to save compliance vault document.')
  }
  return data as ComplianceVaultItem
}

export async function stageComplianceNoticeInDb(params: {
  workspaceId: string
  item: ComplianceVaultItem
  customerId?: string | null
}): Promise<{ item: ComplianceVaultItem; ledgerEntry: AgentActionLedgerEntry }> {
  assertSupabaseConfigured()
  const { workspaceId, item, customerId } = params

  const evalResult = evaluateComplianceDeadlines([item])
  const evaluated = evalResult.evaluated_items[0]

  const { data: updatedItem, error: itemErr } = await supabase
    .from('compliance_vault_items')
    .update({
      status: 'notice_staged',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', item.id)
    .select('*')
    .single()

  if (itemErr || !updatedItem) {
    throw itemErr ?? new Error('Unable to stage compliance notice.')
  }

  if (customerId) {
    await opsCommand(
      workspaceId,
      'draft_save',
      {
        customer_id: customerId,
        channel: 'email',
        subject: evaluated.notice_draft.subject,
        message: evaluated.notice_draft.body_markdown,
      },
      createIdempotencyKey(),
    )
  }

  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      workspace_id: workspaceId,
      agent_name: 'Compliance Vault Guardian',
      module: 'vault',
      action_type: 'stage_compliance_notice',
      autonomy_mode: 'approve_1tap',
      summary: `Staged renewal/cancellation notice for ${item.title} (${item.counterparty} · ${formatCents(item.annual_value_cents)}/yr)`,
      impact_cents: item.annual_value_cents,
      before_state: {
        vault_item_id: item.id,
        vault_status: item.status,
      },
      after_state: {
        vault_item_id: item.id,
        vault_status: 'notice_staged',
        subject: evaluated.notice_draft.subject,
      },
      status: 'executed',
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerData) {
    throw ledgerErr ?? new Error('Notice staged, but Agent Action Ledger logging failed.')
  }

  return {
    item: updatedItem as ComplianceVaultItem,
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
  }
}

export async function fetchLivingSops(workspaceId: string): Promise<LivingSopRecord[]> {
  const rows = await fetchAllWorkspaceRows<LivingSopRecord>({
    table: 'living_sops',
    workspaceId,
    orderBy: 'updated_at',
    ascending: false,
  })
  return rows ?? []
}

export async function upsertLivingSopInDb(params: {
  workspaceId: string
  module_key: string
  title: string
  trigger_event: string
  steps: readonly string[]
  auto_generated?: boolean
}): Promise<LivingSopRecord> {
  assertSupabaseConfigured()
  const moduleKey = params.module_key.trim().toLowerCase()
  const cleanTitle = params.title.trim()
  const cleanSteps = params.steps.map(s => s.trim()).filter(Boolean)

  if (!moduleKey || !cleanTitle || cleanSteps.length === 0) {
    throw new Error('module_key, title, and at least one SOP step are required.')
  }

  const { data: existing } = await supabase
    .from('living_sops')
    .select('id, version')
    .eq('workspace_id', params.workspaceId)
    .eq('module_key', moduleKey)
    .eq('title', cleanTitle)
    .maybeSingle()

  const nextVersion = existing && typeof existing.version === 'number' ? existing.version + 1 : 1
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('living_sops')
    .upsert(
      {
        workspace_id: params.workspaceId,
        module_key: moduleKey,
        title: cleanTitle,
        trigger_event: params.trigger_event.trim() || 'Manual / Automated Workflow Trigger',
        steps_json: cleanSteps,
        version: nextVersion,
        auto_generated: params.auto_generated ?? false,
        last_observed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'workspace_id,module_key,title' },
    )
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to save Living SOP.')
  }
  return data as LivingSopRecord
}

export async function fetchCommandBarSnapshot(
  workspaceId: string,
): Promise<CommandRouterSnapshot> {
  assertSupabaseConfigured()
  const [invRes, skuRes, vaultRes, sopRes, ledgerRes] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'id, workspace_id, quote_id, lead_id, customer_id, invoice_number, title, customer_name, customer_email, subtotal_cents, tax_bps, tax_cents, total_cents, amount_paid_cents, due_date, stripe_checkout_url, status, created_at',
      )
      .eq('workspace_id', workspaceId)
      .limit(100),
    supabase
      .from('inventory_items')
      .select(
        'id, workspace_id, sku, name, location, bin_code, on_hand_qty, reserved_qty, reorder_point_qty, reorder_qty, unit_cost_cents, unit_price_cents, preferred_vendor, lead_time_days, archived',
      )
      .eq('workspace_id', workspaceId)
      .eq('archived', false)
      .limit(100),
    supabase
      .from('compliance_vault_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .limit(100),
    supabase
      .from('living_sops')
      .select('*')
      .eq('workspace_id', workspaceId)
      .limit(100),
    supabase
      .from('agent_action_ledger')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const { data: ledgerMoneyRows } = await supabase
    .from('ledger_entries')
    .select('entry_type, amount_cents')
    .eq('workspace_id', workspaceId)
    .limit(500)

  let baselineCents = 0
  for (const row of (ledgerMoneyRows ?? []) as Array<{ entry_type?: string; amount_cents?: number }>) {
    const amt = typeof row.amount_cents === 'number' ? Math.abs(Math.trunc(row.amount_cents)) : 0
    if (row.entry_type === 'revenue') baselineCents += amt
    else if (row.entry_type === 'cogs' || row.entry_type === 'expense') baselineCents -= amt
  }

  return {
    invoices: (invRes.data ?? []) as AutonomousInvoice[],
    inventoryItems: (skuRes.data ?? []) as Release2InventoryItem[],
    complianceItems: (vaultRes.data ?? []) as ComplianceVaultItem[],
    sops: (sopRes.data ?? []) as LivingSopRecord[],
    ledgerEntries: (ledgerRes.data ?? []) as AgentActionLedgerEntry[],
    baselineBalanceCents: baselineCents,
    safetyBufferCents: 500000,
  }
}
