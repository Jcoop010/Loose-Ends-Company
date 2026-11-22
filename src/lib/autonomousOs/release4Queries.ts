import { fetchAllWorkspaceRows } from '../queries'
import { assertSupabaseConfigured, supabase } from '../supabase'
import { evaluateAutonomousCollections } from './collectionsEngine'
import type {
  AgentActionLedgerEntry,
  AutonomousInvoice,
  CollectionTouchRecord,
  CollectionsRunPlan,
  WorkspaceAutonomyConfig,
} from './types'

export async function fetchCollectionTouches(
  workspaceId: string,
): Promise<CollectionTouchRecord[]> {
  const rows = await fetchAllWorkspaceRows<CollectionTouchRecord>({
    table: 'collection_touches',
    workspaceId,
    orderBy: 'created_at',
    ascending: false,
  })
  return rows ?? []
}

export async function fetchQuotePortalTokensByQuoteId(
  workspaceId: string,
): Promise<ReadonlyMap<string, string>> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('quotes')
    .select('id, portal_token')
    .eq('workspace_id', workspaceId)
    .limit(500)

  if (error) {
    throw error
  }

  const map = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ id?: string; portal_token?: string | null }>) {
    if (typeof row.id === 'string' && typeof row.portal_token === 'string' && row.portal_token) {
      map.set(row.id, row.portal_token)
    }
  }
  return map
}

export async function stageCollectionsRunInDb(params: {
  workspaceId: string
  invoices: readonly AutonomousInvoice[]
  existingTouches: readonly CollectionTouchRecord[]
  disputedInvoiceIds?: ReadonlySet<string> | readonly string[]
  portalTokenByQuoteId?: ReadonlyMap<string, string>
  config: WorkspaceAutonomyConfig
}): Promise<{
  touches: CollectionTouchRecord[]
  ledgerEntry: AgentActionLedgerEntry | null
  plan: CollectionsRunPlan
}> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()

  const plan = evaluateAutonomousCollections({
    workspaceId: params.workspaceId,
    invoices: params.invoices,
    existingTouches: params.existingTouches,
    disputedInvoiceIds: params.disputedInvoiceIds,
    portalTokenByQuoteId: params.portalTokenByQuoteId,
    config: params.config,
    asOfDate: nowIso.slice(0, 10),
  })

  if (plan.existing_touch_ids_to_pause_paid.length > 0) {
    const { error: pausePaidErr } = await supabase
      .from('collection_touches')
      .update({ status: 'paused_paid', updated_at: nowIso })
      .eq('workspace_id', params.workspaceId)
      .in('id', plan.existing_touch_ids_to_pause_paid)
    if (pausePaidErr) throw pausePaidErr
  }

  if (plan.existing_touch_ids_to_pause_disputed.length > 0) {
    const { error: pauseDispErr } = await supabase
      .from('collection_touches')
      .update({ status: 'paused_disputed', updated_at: nowIso })
      .eq('workspace_id', params.workspaceId)
      .in('id', plan.existing_touch_ids_to_pause_disputed)
    if (pauseDispErr) throw pauseDispErr
  }

  let insertedTouches: CollectionTouchRecord[] = []
  let ledgerEntry: AgentActionLedgerEntry | null = null

  if (plan.staged_candidates.length > 0) {
    const payloads = plan.staged_candidates.map(item => ({
      workspace_id: params.workspaceId,
      invoice_id: item.invoice_id,
      stage: item.stage,
      status: 'staged' as const,
      amount_due_cents: item.amount_due_cents,
      portal_url: item.portal_url,
      proof_summary: item.proof_summary,
      updated_at: nowIso,
    }))

    const { data: touchRows, error: insertErr } = await supabase
      .from('collection_touches')
      .insert(payloads)
      .select('*')

    if (insertErr) throw insertErr
    insertedTouches = (touchRows ?? []) as CollectionTouchRecord[]

    const touchIds = insertedTouches.map(t => t.id)
    const { data: ledgerData, error: ledgerErr } = await supabase
      .from('agent_action_ledger')
      .insert({
        workspace_id: plan.ledger_draft.workspace_id,
        agent_name: plan.ledger_draft.agent_name,
        module: plan.ledger_draft.module,
        action_type: plan.ledger_draft.action_type,
        autonomy_mode: plan.ledger_draft.autonomy_mode,
        summary: plan.ledger_draft.summary,
        impact_cents: plan.ledger_draft.impact_cents,
        before_state: plan.ledger_draft.before_state,
        after_state: {
          ...(plan.ledger_draft.after_state ?? {}),
          touch_ids: touchIds,
        },
        status: 'executed',
      })
      .select('*')
      .single()

    if (ledgerErr || !ledgerData) {
      throw ledgerErr ?? new Error('Collections staged, but agent ledger logging failed.')
    }
    ledgerEntry = ledgerData as AgentActionLedgerEntry
  }

  const allTouches = await fetchCollectionTouches(params.workspaceId)

  return {
    touches: allTouches.length > 0 ? allTouches : insertedTouches,
    ledgerEntry,
    plan,
  }
}

export async function toggleCollectionTouchPauseInDb(params: {
  workspaceId: string
  touch: CollectionTouchRecord
  paused: boolean
}): Promise<CollectionTouchRecord> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()
  const nextStatus = params.paused ? 'paused_disputed' : 'staged'

  const { data, error } = await supabase
    .from('collection_touches')
    .update({ status: nextStatus, updated_at: nowIso })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.touch.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to update collection touch status.')
  }
  return data as CollectionTouchRecord
}
