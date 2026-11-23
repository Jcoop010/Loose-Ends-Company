import type {
  AutoPauseReason,
  CallFollowUpOutcome,
  OpsCommunicationDraft,
  OutreachLane,
  PipelinePublicLead,
} from '../../types/domain'

export const FOLLOW_UP_CALL_THRESHOLD_MS = 48 * 3_600_000

export interface CallFollowUpQueueItem {
  queue_key: string
  lead_id: string | null
  draft_id: string
  business_name: string
  contact_name: string
  recipient_email: string
  phone: string | null
  lane: OutreachLane
  sent_at: string
  hours_since_sent: number
  call_outcome: CallFollowUpOutcome | null
  script_30s: string
}

export interface CallOutcomeDecision {
  outcome: CallFollowUpOutcome
  leadStatus: 'DEMO_SCHEDULED' | 'CONTACTED' | 'LOST'
  shouldPauseSequence: boolean
  pauseReason: AutoPauseReason | null
  toastTitle: string
}

export function resolveCallOutcomeAction(outcome: CallFollowUpOutcome): CallOutcomeDecision {
  switch (outcome) {
    case 'booked_shadow_audit':
      return {
        outcome,
        leadStatus: 'DEMO_SCHEDULED',
        shouldPauseSequence: true,
        pauseReason: 'replied',
        toastTitle: 'Shadow Audit Booked (Sequence Paused)',
      }
    case 'left_voicemail':
      return {
        outcome,
        leadStatus: 'CONTACTED',
        shouldPauseSequence: false,
        pauseReason: null,
        toastTitle: 'Voicemail Logged',
      }
    case 'not_interested':
      return {
        outcome,
        leadStatus: 'LOST',
        shouldPauseSequence: true,
        pauseReason: 'manual',
        toastTitle: 'Not Interested Logged (Sequence Auto-Paused)',
      }
  }
}

export function buildThirtySecondCallScript(params: {
  companyName: string
  contactName: string
  lane: OutreachLane
}): string {
  const company = params.companyName.trim() || 'your shop'
  const first =
    params.contactName.trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9'-]/g, '') || 'there'

  if (params.lane === 'bookkeepers_cpa') {
    return (
      `Hi ${first}, Justin Cooper calling locally from Loose Ends in Parkersburg. ` +
      `I sent ${company} a short note about our $199/mo unlimited-seat OS that compiles ` +
      `1-click $0.00-variance CPA Audit Packets and pays partners a 20% ($40/mo) cut. ` +
      `If I send you a 2-minute sandbox walkthrough link, would you take a quick look this week?`
    )
  }

  if (params.lane === 'inbound_calculator') {
    return (
      `Hi ${first}, Justin Cooper at Loose Ends following up on the leak estimate you just ` +
      `ran on our calculator. Want to spend 10 minutes dropping one QuickBooks or invoice CSV ` +
      `into Read-Only Shadow Mode so we can verify your exact unbilled quotes and overdue AR before migrating anything?`
    )
  }

  return (
    `Hi ${first}, Justin Cooper calling locally from Loose Ends. I sent ${company} a quick note ` +
    `about running a free 15-minute Read-Only Shadow Mode scan on a QuickBooks or invoice CSV ` +
    `to flag unbilled jobs, overdue AR, and >10% vendor spikes without changing your live books. ` +
    `Worth sending over the 2-minute test link?`
  )
}

function parseTimestampMs(raw: string | null | undefined): number | null {
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

const EXCLUDED_LEAD_STATUSES = new Set([
  'REPLIED',
  'BOUNCED',
  'UNSUBSCRIBED',
  'LOST',
  'DEMO_SCHEDULED',
  'PILOT_SOLD',
])

/**
 * Surfaces sent outreach drafts >= 48 hours old with no reply/pause into a phone/walk-in queue.
 */
export function buildCallFollowUpQueue(params: {
  drafts: readonly OpsCommunicationDraft[]
  leads: readonly PipelinePublicLead[]
  nowIso?: string
}): CallFollowUpQueueItem[] {
  const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now()
  const leadsById = new Map<string, PipelinePublicLead>()
  const leadsByEmail = new Map<string, PipelinePublicLead>()

  for (const lead of params.leads) {
    leadsById.set(lead.id, lead)
    const e1 = (lead.email ?? '').trim().toLowerCase()
    const e2 = (lead.contact_email ?? '').trim().toLowerCase()
    if (e1) leadsByEmail.set(e1, lead)
    if (e2) leadsByEmail.set(e2, lead)
  }

  const seenKeys = new Set<string>()
  const items: CallFollowUpQueueItem[] = []

  const sortedDrafts = [...params.drafts].sort((a, b) => {
    const tA = parseTimestampMs(a.sent_at ?? a.created_at) ?? 0
    const tB = parseTimestampMs(b.sent_at ?? b.created_at) ?? 0
    return tA - tB // oldest first
  })

  for (const draft of sortedDrafts) {
    if (draft.channel !== 'email') continue
    if (draft.delivery_status !== 'sent') continue
    if (draft.auto_paused_reason) continue

    const sentMs = parseTimestampMs(draft.sent_at ?? draft.created_at)
    if (sentMs === null) continue
    const elapsedMs = nowMs - sentMs
    if (elapsedMs < FOLLOW_UP_CALL_THRESHOLD_MS) continue

    const email = (draft.recipient_email ?? '').trim().toLowerCase()
    const linkedLead =
      (draft.lead_id ? leadsById.get(draft.lead_id) : undefined) ??
      (email ? leadsByEmail.get(email) : undefined)

    if (linkedLead) {
      if (linkedLead.auto_paused_reason) continue
      if (EXCLUDED_LEAD_STATUSES.has(linkedLead.status)) continue
      if (
        linkedLead.call_outcome === 'booked_shadow_audit' ||
        linkedLead.call_outcome === 'not_interested'
      ) {
        continue
      }
    }

    const queueKey = linkedLead?.id ?? (email || draft.id)
    if (seenKeys.has(queueKey)) continue
    seenKeys.add(queueKey)

    const businessName =
      linkedLead?.business ?? draft.company_name ?? draft.recipient_name ?? 'Regional Lead'
    const contactName =
      linkedLead?.contact_name ?? linkedLead?.name ?? draft.recipient_name ?? 'Owner / Operations'
    const lane: OutreachLane =
      linkedLead?.outreach_lane ?? draft.outreach_lane ?? 'trades_clinics'

    items.push({
      queue_key: queueKey,
      lead_id: linkedLead?.id ?? draft.lead_id ?? null,
      draft_id: draft.id,
      business_name: businessName,
      contact_name: contactName,
      recipient_email: email || linkedLead?.contact_email || linkedLead?.email || '',
      phone: linkedLead?.phone ?? null,
      lane,
      sent_at: draft.sent_at ?? draft.created_at,
      hours_since_sent: Math.floor(elapsedMs / 3_600_000),
      call_outcome: linkedLead?.call_outcome ?? null,
      script_30s: buildThirtySecondCallScript({
        companyName: businessName,
        contactName,
        lane,
      }),
    })
  }

  return items
}

export interface DomainWarmupStep {
  id: string
  title: string
  detail: string
}

export const MULTI_DOMAIN_WARMUP_CHECKLIST: readonly DomainWarmupStep[] = [
  {
    id: 'add_lookalike_domains',
    title: 'Register 2–3 lookalike sending domains & verify in Resend',
    detail: 'e.g. try-looseendsos.com, getlooseends.app, looseendshq.com (keep primary looseendsos.app capped <=15/day).',
  },
  {
    id: 'spf_records',
    title: 'Publish strict SPF TXT records (`v=spf1 include:amazonses.com ~all`)',
    detail: 'Verify green SPF check in Resend Domains dashboard for every secondary sending domain.',
  },
  {
    id: 'dkim_keys',
    title: 'Publish 2048-bit DKIM CNAME/TXT records in Cloudflare/DNS',
    detail: 'Confirm all 3 DKIM selectors propagate cleanly with zero proxy orange-clouding.',
  },
  {
    id: 'dmarc_policy',
    title: 'Add DMARC TXT record (`v=DMARC1; p=quarantine; rua=mailto:dmarc@...`)',
    detail: 'Enforce alignment across secondary domains so inbox placement stays >96% as volume scales.',
  },
  {
    id: 'reply_forwarding_warmup',
    title: 'Configure Reply-To (`jhcoop010@gmail.com`) + 14-day cap ramp (5 -> 15 -> 20/day)',
    detail: 'Add each inbox via "Add Sender Inbox" in warming mode; ramp across 3 inboxes to hit 60–100/day safely.',
  },
]
