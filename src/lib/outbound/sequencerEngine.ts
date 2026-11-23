import {
  CAN_SPAM_PHYSICAL_ADDRESS,
  isCanSpamFooterCompliant,
  type DraftComplianceEvaluation,
} from '../canSpamGuard.ts'
import type {
  AutoPauseReason,
  OpsCommunicationDraft,
  OutboundSenderInbox,
  OutreachLane,
  SequenceStep,
} from '../../types/domain.ts'

export const PRIMARY_OUTBOUND_DOMAIN = 'looseendsos.app'
export const PRIMARY_DOMAIN_DAILY_CAP = 15
export const DEFAULT_INBOX_DAILY_CAP = 20
export const DAY_3_DELAY_MS = 3 * 86_400_000
export const DAY_7_DELAY_MS = 4 * 86_400_000

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const OUTREACH_LANE_LABELS: Readonly<Record<OutreachLane, string>> = {
  trades_clinics: 'Trades & Clinics',
  bookkeepers_cpa: 'Bookkeepers & CPAs',
}

export const SEQUENCE_STEP_LABELS: Readonly<Record<SequenceStep, string>> = {
  1: 'Day 1',
  2: 'Day 3 Bump',
  3: 'Day 7 Final',
}

export const AUTO_PAUSE_REASON_LABELS: Readonly<Record<AutoPauseReason, string>> = {
  replied: 'Auto-Paused (Replied)',
  bounced: 'Auto-Paused (Bounced)',
  unsubscribed: 'Auto-Paused (Unsubscribed)',
  manual: 'Paused (Manual)',
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

export function isValidOutboundEmail(raw: string | null | undefined): boolean {
  const email = normalizeEmail(raw)
  return Boolean(email && EMAIL_FORMAT_REGEX.test(email))
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0).length
}

export function inferOutreachLane(rawText: string | null | undefined): OutreachLane {
  const hay = (rawText ?? '').toLowerCase()
  if (/(bookkeep|cpa|accounting|accountant|tax\s*prep|ledger|reconcil|audit\s*packet)/i.test(hay)) {
    return 'bookkeepers_cpa'
  }
  return 'trades_clinics'
}

export function normalizeInboxForDate(
  inbox: OutboundSenderInbox,
  todayIso: string,
): OutboundSenderInbox {
  const resetDate = (inbox.last_reset_date ?? '').slice(0, 10)
  if (resetDate === todayIso) {
    return inbox
  }
  return {
    ...inbox,
    sent_today: 0,
    last_reset_date: todayIso,
  }
}

/**
 * Computes effective daily sending cap for a sender inbox:
 * - Primary domain (`looseendsos.app`) is strictly capped at <= 15/day.
 * - Secondary / dedicated sending domains respect configured `daily_cap` (default 20/day).
 */
export function effectiveDailyCap(
  inbox: Pick<OutboundSenderInbox, 'domain' | 'daily_cap'>,
  primaryDomain = PRIMARY_OUTBOUND_DOMAIN,
): number {
  const rawCap =
    typeof inbox.daily_cap === 'number' && Number.isFinite(inbox.daily_cap)
      ? Math.max(0, Math.trunc(inbox.daily_cap))
      : DEFAULT_INBOX_DAILY_CAP
  const cleanDomain = inbox.domain.trim().toLowerCase()
  if (cleanDomain === primaryDomain.toLowerCase()) {
    return Math.min(rawCap, PRIMARY_DOMAIN_DAILY_CAP)
  }
  return rawCap
}

export interface SenderAllocationResult {
  inbox: OutboundSenderInbox
  effective_cap: number
  next_sent_today: number
  updated_inboxes: OutboundSenderInbox[]
  next_cursor: number
}

/**
 * Round-robin allocator across `active` inboxes without exceeding `effectiveDailyCap`.
 * Automatically skips `paused`, `warming`, or already-capped inboxes.
 */
export function assignSenderInbox(
  inboxes: readonly OutboundSenderInbox[],
  options?: {
    startCursor?: number
    todayIso?: string
    primaryDomain?: string
  },
): SenderAllocationResult | null {
  if (inboxes.length === 0) return null

  const todayIso =
    options?.todayIso && /^\d{4}-\d{2}-\d{2}$/.test(options.todayIso)
      ? options.todayIso
      : new Date().toISOString().slice(0, 10)
  const primaryDomain = options?.primaryDomain ?? PRIMARY_OUTBOUND_DOMAIN
  const normalized = inboxes.map(inbox => normalizeInboxForDate(inbox, todayIso))
  const len = normalized.length
  const cursor = ((Math.trunc(options?.startCursor ?? 0) % len) + len) % len

  for (let offset = 0; offset < len; offset += 1) {
    const idx = (cursor + offset) % len
    const candidate = normalized[idx]
    if (candidate.status !== 'active') continue
    const cap = effectiveDailyCap(candidate, primaryDomain)
    if (candidate.sent_today >= cap) continue

    const nextSent = candidate.sent_today + 1
    const updatedCandidate: OutboundSenderInbox = {
      ...candidate,
      sent_today: nextSent,
      last_reset_date: todayIso,
    }
    const updatedInboxes = normalized.map((item, pos) => (pos === idx ? updatedCandidate : item))
    return {
      inbox: updatedCandidate,
      effective_cap: cap,
      next_sent_today: nextSent,
      updated_inboxes: updatedInboxes,
      next_cursor: (idx + 1) % len,
    }
  }

  return null
}

function cleanGreetingName(raw: string | null | undefined): string {
  const first = (raw ?? '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^A-Za-z0-9'-]/g, '')
    .slice(0, 20)
  return first || 'there'
}

function cleanCompanyShort(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'your team'
  const words = trimmed.split(' ').slice(0, 4).join(' ')
  return words.length > 36 ? words.slice(0, 36).trim() : words
}

export interface StagedFollowUpCopy {
  subject: string
  message: string
  word_count: number
}

/**
 * Generates plain-text CAN-SPAM-compliant Day 3 (<55 words) and Day 7 (<50 words)
 * follow-up drafts tailored by outreach lane.
 */
export function buildFollowUpCopy(params: {
  lane: OutreachLane
  step: Exclude<SequenceStep, 1>
  recipientName?: string | null
  companyName?: string | null
  originalSubject?: string | null
}): StagedFollowUpCopy {
  const firstName = cleanGreetingName(params.recipientName)
  const company = cleanCompanyShort(params.companyName)
  const baseSubject = (params.originalSubject ?? '').trim().replace(/^Re:\s*/i, '') || `${company} follow-up`
  const subject = `Re: ${baseSubject}`

  const footer = `Reply "unsubscribe" to opt out.\n${CAN_SPAM_PHYSICAL_ADDRESS}`
  let body = ''

  if (params.step === 2) {
    body =
      params.lane === 'bookkeepers_cpa'
        ? `Hi ${firstName}, quick follow-up for ${company}.\n\nPreview our $0.00-variance 1-Click CPA Packet at https://www.looseendsos.app/demo — approved partners earn a 20% recurring cut per workspace.`
        : `Hi ${firstName}, quick bump on ${company}.\n\nDrop a QuickBooks CSV into Shadow Mode at https://www.looseendsos.app/demo for a read-only leak check in 60 seconds — zero migration.`
  } else {
    body =
      params.lane === 'bookkeepers_cpa'
        ? `Hi ${firstName}, final note for ${company}.\n\nWant the $0.00-variance 1-Click CPA Packet + 20% recurring partner split link (https://www.looseendsos.app/demo) before I close this thread?`
        : `Hi ${firstName}, final check-in for ${company}.\n\nWant the 60-second Shadow Mode QuickBooks leak link (https://www.looseendsos.app/demo) before I close your file?`
  }

  const message = `${body}\n\n${footer}`
  if (!isCanSpamFooterCompliant(message)) {
    throw new Error('Generated follow-up copy failed mandatory CAN-SPAM footer compliance check.')
  }

  return {
    subject,
    message,
    word_count: countWords(message),
  }
}

export interface StagedFollowUpCandidate {
  customer_id: string | null
  lead_id: string | null
  parent_draft_id: string
  recipient_email: string
  recipient_name: string | null
  company_name: string | null
  outreach_lane: OutreachLane
  sequence_step: Exclude<SequenceStep, 1>
  subject: string
  message: string
  word_count: number
  scheduled_after: string
  status: 'draft'
  delivery_status: 'not_sent'
  requires_approval: true
}

export interface FollowUpStagingResult {
  candidates: StagedFollowUpCandidate[]
  skipped_reasons: Record<string, number>
}

function recordSkip(reasons: Record<string, number>, key: string): void {
  reasons[key] = (reasons[key] ?? 0) + 1
}

function resolveSentTimestampMs(draft: OpsCommunicationDraft): number | null {
  const iso = draft.sent_at || draft.approved_at || draft.created_at
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Pure scanner over workspace email drafts staging:
 * - Step 2 (Day 3 Bump, <55 words) for sent Step 1 drafts >= 3 days old
 * - Step 3 (Day 7 Final, <50 words) for sent Step 2 drafts >= 4 days old
 * Every candidate remains strictly `status: 'draft'`, `delivery_status: 'not_sent'`, `requires_approval: true`.
 */
export function stageFollowUpDrafts(params: {
  workspaceId: string
  drafts: readonly OpsCommunicationDraft[]
  suppressedEmails?: ReadonlySet<string>
  pausedLeadIds?: ReadonlySet<string>
  pausedEmails?: ReadonlySet<string>
  asOfIso?: string
}): FollowUpStagingResult {
  const asOfIso = params.asOfIso ?? new Date().toISOString()
  const nowMs = Date.parse(asOfIso)
  const skippedReasons: Record<string, number> = {}

  if (!Number.isFinite(nowMs)) {
    return { candidates: [], skipped_reasons: { invalid_clock: 1 } }
  }

  const suppressed = new Set<string>()
  for (const e of params.suppressedEmails ?? []) {
    const clean = normalizeEmail(e)
    if (clean) suppressed.add(clean)
  }

  const pausedLeads = new Set<string>(params.pausedLeadIds ?? [])
  const pausedEmails = new Set<string>()
  for (const e of params.pausedEmails ?? []) {
    const clean = normalizeEmail(e)
    if (clean) pausedEmails.add(clean)
  }

  const existingLeadSteps = new Set<string>()
  const existingEmailSteps = new Set<string>()
  const existingParentSteps = new Set<string>()

  for (const d of params.drafts) {
    const step = (d.sequence_step ?? 1) as SequenceStep
    const email = normalizeEmail(d.recipient_email)
    if (d.auto_paused_reason) {
      if (d.lead_id) pausedLeads.add(d.lead_id)
      if (email) pausedEmails.add(email)
    }
    if (d.lead_id) {
      existingLeadSteps.add(`${d.lead_id}:${step}`)
    }
    if (email) {
      existingEmailSteps.add(`${email}:${step}`)
    }
    if (d.parent_draft_id) {
      existingParentSteps.add(`${d.parent_draft_id}:${step}`)
    }
  }

  const candidates: StagedFollowUpCandidate[] = []
  const stagedInThisRun = new Set<string>()

  for (const draft of params.drafts) {
    if (draft.workspace_id !== params.workspaceId) continue
    if (draft.channel !== 'email') continue
    if (draft.delivery_status !== 'sent') continue

    const currentStep = (draft.sequence_step ?? 1) as SequenceStep
    if (currentStep !== 1 && currentStep !== 2) continue

    const nextStep: Exclude<SequenceStep, 1> = currentStep === 1 ? 2 : 3
    const requiredDelayMs = currentStep === 1 ? DAY_3_DELAY_MS : DAY_7_DELAY_MS
    const email = normalizeEmail(draft.recipient_email)

    if (!isValidOutboundEmail(email)) {
      recordSkip(skippedReasons, 'missing_or_invalid_email')
      continue
    }
    if (suppressed.has(email)) {
      recordSkip(skippedReasons, 'suppressed_opt_out')
      continue
    }
    if ((draft.lead_id && pausedLeads.has(draft.lead_id)) || pausedEmails.has(email) || draft.auto_paused_reason) {
      recordSkip(skippedReasons, 'sequence_auto_paused')
      continue
    }

    const sentMs = resolveSentTimestampMs(draft)
    if (sentMs === null || nowMs - sentMs < requiredDelayMs) {
      recordSkip(skippedReasons, 'not_yet_due')
      continue
    }

    const leadKey = draft.lead_id ? `${draft.lead_id}:${nextStep}` : null
    const emailKey = `${email}:${nextStep}`
    const parentKey = `${draft.id}:${nextStep}`

    if (
      (leadKey && (existingLeadSteps.has(leadKey) || stagedInThisRun.has(leadKey))) ||
      existingEmailSteps.has(emailKey) ||
      stagedInThisRun.has(emailKey) ||
      existingParentSteps.has(parentKey)
    ) {
      recordSkip(skippedReasons, 'already_staged')
      continue
    }

    const lane: OutreachLane =
      draft.outreach_lane === 'bookkeepers_cpa' || draft.outreach_lane === 'trades_clinics'
        ? draft.outreach_lane
        : inferOutreachLane(`${draft.subject} ${draft.company_name ?? ''} ${draft.message}`)

    const copy = buildFollowUpCopy({
      lane,
      step: nextStep,
      recipientName: draft.recipient_name,
      companyName: draft.company_name,
      originalSubject: draft.subject,
    })

    if (leadKey) stagedInThisRun.add(leadKey)
    stagedInThisRun.add(emailKey)

    candidates.push({
      customer_id: draft.customer_id ?? null,
      lead_id: draft.lead_id ?? null,
      parent_draft_id: draft.id,
      recipient_email: email,
      recipient_name: draft.recipient_name ?? null,
      company_name: draft.company_name ?? null,
      outreach_lane: lane,
      sequence_step: nextStep,
      subject: copy.subject,
      message: copy.message,
      word_count: copy.word_count,
      scheduled_after: asOfIso,
      status: 'draft',
      delivery_status: 'not_sent',
      requires_approval: true,
    })
  }

  return { candidates, skipped_reasons: skippedReasons }
}

export interface SequencePauseResult {
  paused_draft_ids: string[]
  updated_drafts: OpsCommunicationDraft[]
  paused_count: number
}

/**
 * Auto-Pause Guard: immediately cancels any unsent Step 1/2/3 pending or approved drafts
 * when a lead replies, bounces, unsubscribes, or is manually paused.
 */
export function pauseLeadSequence(params: {
  drafts: readonly OpsCommunicationDraft[]
  leadId?: string | null
  recipientEmail?: string | null
  reason: AutoPauseReason
}): SequencePauseResult {
  const cleanLeadId = (params.leadId ?? '').trim() || null
  const cleanEmail = normalizeEmail(params.recipientEmail)
  const pausedIds: string[] = []

  const updated = params.drafts.map(draft => {
    const matchesLead = Boolean(cleanLeadId && draft.lead_id === cleanLeadId)
    const matchesEmail = Boolean(cleanEmail && normalizeEmail(draft.recipient_email) === cleanEmail)
    if (!matchesLead && !matchesEmail) return draft

    if (draft.delivery_status === 'not_sent' && (draft.status === 'draft' || draft.status === 'approved')) {
      pausedIds.push(draft.id)
      return {
        ...draft,
        status: 'rejected' as const,
        auto_paused_reason: params.reason,
      }
    }

    return {
      ...draft,
      auto_paused_reason: draft.auto_paused_reason ?? params.reason,
    }
  })

  return {
    paused_draft_ids: pausedIds,
    updated_drafts: updated,
    paused_count: pausedIds.length,
  }
}

export interface BatchApprovalPartition {
  eligible: OpsCommunicationDraft[]
  blocked: Array<{ draft: OpsCommunicationDraft; reason: string }>
}

/**
 * Filters a draft list down to only unsent `status: 'draft'` rows that pass
 * channel compliance (CAN-SPAM B2B email footer or granted opt-in, not suppressed),
 * verified email address check (for email drafts), and zero auto-pause locks.
 */
export function selectBatchApprovableDrafts(
  drafts: readonly OpsCommunicationDraft[],
  evaluateFn: (draft: OpsCommunicationDraft) => DraftComplianceEvaluation,
  resolveEmailFn?: (draft: OpsCommunicationDraft) => string | null | undefined,
): BatchApprovalPartition {
  const eligible: OpsCommunicationDraft[] = []
  const blocked: Array<{ draft: OpsCommunicationDraft; reason: string }> = []

  for (const draft of drafts) {
    if (draft.status !== 'draft' || draft.delivery_status !== 'not_sent') continue
    if (draft.auto_paused_reason) {
      blocked.push({
        draft,
        reason: AUTO_PAUSE_REASON_LABELS[draft.auto_paused_reason],
      })
      continue
    }

    if (draft.channel === 'email') {
      const resolvedEmail = resolveEmailFn ? resolveEmailFn(draft) : draft.recipient_email
      if (!isValidOutboundEmail(resolvedEmail)) {
        blocked.push({ draft, reason: 'Missing or invalid recipient email' })
        continue
      }
    }

    const compliance = evaluateFn(draft)
    if (!compliance.allowed) {
      blocked.push({
        draft,
        reason: compliance.blockReason ?? compliance.badgeLabel,
      })
      continue
    }

    eligible.push(draft)
  }

  return { eligible, blocked }
}
