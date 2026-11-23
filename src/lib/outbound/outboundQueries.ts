import { createIdempotencyKey, opsCommand } from '../opsCommand'
import { supabase } from '../supabase'
import type {
  AutoPauseReason,
  OpsCommunicationDraft,
  OutboundSenderInbox,
  OutreachLane,
  SenderInboxStatus,
} from '../../types/domain'
import {
  DEFAULT_INBOX_DAILY_CAP,
  PRIMARY_DOMAIN_DAILY_CAP,
  PRIMARY_OUTBOUND_DOMAIN,
  type StagedFollowUpCandidate,
} from './sequencerEngine'

export async function fetchSenderInboxes(
  workspaceId: string,
): Promise<OutboundSenderInbox[]> {
  const { data, error } = await supabase
    .from('outbound_sender_inboxes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as OutboundSenderInbox[]
}

export async function createSenderInbox(params: {
  workspaceId: string
  fromName: string
  fromEmail: string
  dailyCap?: number
  status?: SenderInboxStatus
}): Promise<OutboundSenderInbox> {
  const cleanEmail = params.fromEmail.trim().toLowerCase()
  const atIndex = cleanEmail.indexOf('@')
  if (atIndex <= 0 || atIndex === cleanEmail.length - 1) {
    throw new Error('Enter a valid sender email address.')
  }
  const domain = cleanEmail.slice(atIndex + 1)
  const defaultCap =
    domain === PRIMARY_OUTBOUND_DOMAIN ? PRIMARY_DOMAIN_DAILY_CAP : DEFAULT_INBOX_DAILY_CAP
  const cap =
    typeof params.dailyCap === 'number' && Number.isFinite(params.dailyCap)
      ? Math.max(1, Math.min(200, Math.trunc(params.dailyCap)))
      : defaultCap
  const capped = domain === PRIMARY_OUTBOUND_DOMAIN ? Math.min(cap, PRIMARY_DOMAIN_DAILY_CAP) : cap

  const { data, error } = await supabase
    .from('outbound_sender_inboxes')
    .insert({
      workspace_id: params.workspaceId,
      from_name: params.fromName.trim() || 'Justin Cooper',
      from_email: cleanEmail,
      domain,
      daily_cap: capped,
      sent_today: 0,
      last_reset_date: new Date().toISOString().slice(0, 10),
      status: params.status ?? 'active',
    })
    .select('*')
    .single()

  if (error) throw error
  return data as OutboundSenderInbox
}

export async function updateSenderInboxStatus(
  workspaceId: string,
  inboxId: string,
  status: SenderInboxStatus,
): Promise<OutboundSenderInbox> {
  const { data, error } = await supabase
    .from('outbound_sender_inboxes')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', inboxId)
    .select('*')
    .single()

  if (error) throw error
  return data as OutboundSenderInbox
}

export async function fetchWorkspaceEmailDraftsForSequencer(
  workspaceId: string,
): Promise<OpsCommunicationDraft[]> {
  const { data, error } = await supabase
    .from('ops_communication_drafts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'email')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw error
  return (data ?? []) as OpsCommunicationDraft[]
}

export async function fetchWorkspaceLeadPausedIds(
  workspaceId: string,
): Promise<ReadonlySet<string>> {
  const { data, error } = await supabase
    .from('public_leads')
    .select('id, status, auto_paused_reason')
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .limit(500)

  if (error) throw error
  const paused = new Set<string>()
  for (const row of (data ?? []) as Array<{
    id: string
    status?: string | null
    auto_paused_reason?: string | null
  }>) {
    if (
      row.auto_paused_reason ||
      row.status === 'REPLIED' ||
      row.status === 'BOUNCED' ||
      row.status === 'UNSUBSCRIBED'
    ) {
      paused.add(row.id)
    }
  }
  return paused
}

export async function persistStagedFollowUps(
  workspaceId: string,
  candidates: readonly StagedFollowUpCandidate[],
): Promise<{ stagedCount: number; skippedCount: number }> {
  let stagedCount = 0
  let skippedCount = 0

  for (const cand of candidates) {
    const res = await opsCommand(
      workspaceId,
      'draft_stage_followup',
      {
        customer_id: cand.customer_id,
        lead_id: cand.lead_id,
        parent_draft_id: cand.parent_draft_id,
        recipient_email: cand.recipient_email,
        recipient_name: cand.recipient_name,
        company_name: cand.company_name,
        outreach_lane: cand.outreach_lane,
        sequence_step: cand.sequence_step,
        subject: cand.subject,
        message: cand.message,
        scheduled_after: cand.scheduled_after,
      },
      createIdempotencyKey(),
    )
    if (res.skipped) {
      skippedCount += 1
    } else {
      stagedCount += 1
    }
  }

  return { stagedCount, skippedCount }
}

export async function approveDraftsBatch(
  workspaceId: string,
  draftIds: readonly string[],
): Promise<{ approvedCount: number; skippedCount: number }> {
  if (draftIds.length === 0) {
    return { approvedCount: 0, skippedCount: 0 }
  }

  let approvedCount = 0
  let skippedCount = 0

  for (let i = 0; i < draftIds.length; i += 50) {
    const chunk = draftIds.slice(i, i + 50)
    const res = await opsCommand(
      workspaceId,
      'draft_batch_approve',
      { draft_ids: chunk },
      createIdempotencyKey(),
    )
    approvedCount += res.approved_count ?? 0
    skippedCount += res.skipped_count ?? 0
  }

  return { approvedCount, skippedCount }
}

export async function pauseLeadSequenceInDb(
  workspaceId: string,
  params: {
    leadId?: string | null
    recipientEmail?: string | null
    reason: AutoPauseReason
  },
): Promise<{ pausedCount: number }> {
  const res = await opsCommand(
    workspaceId,
    'draft_pause_sequence',
    {
      lead_id: params.leadId ?? null,
      recipient_email: params.recipientEmail ?? null,
      reason: params.reason,
    },
    createIdempotencyKey(),
  )
  return { pausedCount: res.paused_count ?? 0 }
}

export type { OutreachLane }
