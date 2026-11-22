import { fetchAllWorkspaceRows } from '../queries'
import { assertSupabaseConfigured, supabase } from '../supabase'
import { buildShadowPromotionPlan, recomputeShadowLeakTotalCents } from './shadowEngine'
import type {
  AgentActionLedgerEntry,
  ShadowAnalysisResult,
  ShadowFinding,
  ShadowSession,
  ShadowSessionStatus,
} from './types'

export async function fetchShadowSessionsWithFindings(workspaceId: string): Promise<{
  sessions: ShadowSession[]
  findingsBySession: ReadonlyMap<string, ShadowFinding[]>
}> {
  const [sessions, findings] = await Promise.all([
    fetchAllWorkspaceRows<ShadowSession>({
      table: 'shadow_sessions',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<ShadowFinding>({
      table: 'shadow_findings',
      workspaceId,
      orderBy: 'amount_cents',
      ascending: false,
    }),
  ])

  const findingsBySession = new Map<string, ShadowFinding[]>()
  for (const item of findings ?? []) {
    const existing = findingsBySession.get(item.session_id)
    if (existing) {
      existing.push(item)
    } else {
      findingsBySession.set(item.session_id, [item])
    }
  }

  return {
    sessions: sessions ?? [],
    findingsBySession,
  }
}

export async function saveShadowAnalysisToDb(
  workspaceId: string,
  analysis: ShadowAnalysisResult,
): Promise<{ session: ShadowSession; findings: ShadowFinding[] }> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()

  const { data: sessionData, error: sessionErr } = await supabase
    .from('shadow_sessions')
    .insert({
      workspace_id: workspaceId,
      source_system: analysis.source_system,
      file_name: analysis.file_name,
      row_count: analysis.row_count,
      total_leak_cents: analysis.total_leak_cents,
      status: 'ready' satisfies ShadowSessionStatus,
      updated_at: nowIso,
    })
    .select('*')
    .single()

  if (sessionErr || !sessionData) {
    throw sessionErr ?? new Error('Unable to create shadow onboarding session.')
  }
  const session = sessionData as ShadowSession

  if (analysis.findings.length === 0) {
    return { session, findings: [] }
  }

  const findingPayloads = analysis.findings.map(item => ({
    workspace_id: workspaceId,
    session_id: session.id,
    category: item.category,
    counterparty: item.counterparty,
    amount_cents: Math.max(0, Math.trunc(item.amount_cents)),
    proof_summary: item.proof_summary,
    evidence_json: item.evidence_json,
    status: 'open',
    updated_at: nowIso,
  }))

  const { data: findingsData, error: findingsErr } = await supabase
    .from('shadow_findings')
    .insert(findingPayloads)
    .select('*')

  if (findingsErr) {
    throw findingsErr
  }

  return {
    session,
    findings: (findingsData ?? []) as ShadowFinding[],
  }
}

export async function dismissShadowFindingInDb(params: {
  workspaceId: string
  sessionId: string
  findingId: string
  allSessionFindings: readonly ShadowFinding[]
}): Promise<{ finding: ShadowFinding; totalLeakCents: number }> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()

  const { data: updatedFinding, error: findingErr } = await supabase
    .from('shadow_findings')
    .update({ status: 'dismissed', updated_at: nowIso })
    .eq('workspace_id', params.workspaceId)
    .eq('session_id', params.sessionId)
    .eq('id', params.findingId)
    .select('*')
    .single()

  if (findingErr || !updatedFinding) {
    throw findingErr ?? new Error('Unable to dismiss shadow finding.')
  }

  const nextFindings = params.allSessionFindings.map(item =>
    item.id === params.findingId ? (updatedFinding as ShadowFinding) : item,
  )
  const totalLeakCents = recomputeShadowLeakTotalCents(nextFindings)

  const { error: sessionErr } = await supabase
    .from('shadow_sessions')
    .update({
      total_leak_cents: totalLeakCents,
      updated_at: nowIso,
    })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.sessionId)

  if (sessionErr) {
    throw sessionErr
  }

  return {
    finding: updatedFinding as ShadowFinding,
    totalLeakCents,
  }
}

export async function promoteShadowSessionInDb(params: {
  workspaceId: string
  session: ShadowSession
  findings: readonly ShadowFinding[]
}): Promise<{
  session: ShadowSession
  findings: ShadowFinding[]
  ledgerEntry: AgentActionLedgerEntry
}> {
  assertSupabaseConfigured()
  const nowIso = new Date().toISOString()
  const plan = buildShadowPromotionPlan({
    workspaceId: params.workspaceId,
    session: params.session,
    findings: params.findings,
    nowIso,
  })

  if (plan.openFindingIds.length > 0) {
    const { error: findingsErr } = await supabase
      .from('shadow_findings')
      .update({ status: 'promoted', updated_at: nowIso })
      .eq('workspace_id', params.workspaceId)
      .eq('session_id', params.session.id)
      .in('id', plan.openFindingIds)

    if (findingsErr) {
      throw findingsErr
    }
  }

  const { data: updatedSession, error: sessionErr } = await supabase
    .from('shadow_sessions')
    .update({
      status: 'promoted',
      total_leak_cents: plan.promotedSession.total_leak_cents,
      updated_at: nowIso,
    })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.session.id)
    .select('*')
    .single()

  if (sessionErr || !updatedSession) {
    throw sessionErr ?? new Error('Unable to update shadow session status.')
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
    throw ledgerErr ?? new Error('Shadow session promoted, but ledger logging failed.')
  }

  return {
    session: updatedSession as ShadowSession,
    findings: plan.promotedFindings,
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
  }
}
