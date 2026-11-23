import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const seq = loadSrcModule('src/lib/outbound/sequencerEngine.ts')
const guard = loadSrcModule('src/lib/canSpamGuard.ts')

const wsId = '11111111-1111-4111-8111-111111111111'
const todayIso = '2026-11-22'

// 1. Round-robin allocation across multiple inboxes, skipping paused/warming & resetting stale date
const inboxPool = [
  {
    id: 'inb-primary',
    workspace_id: wsId,
    from_name: 'Justin Cooper',
    from_email: 'justin@looseendsos.app',
    domain: 'looseendsos.app',
    daily_cap: 25, // Must clamp cleanly to 15 max on primary domain
    sent_today: 14,
    last_reset_date: todayIso,
    status: 'active',
    created_at: '2026-11-20T00:00:00Z',
  },
  {
    id: 'inb-warming',
    workspace_id: wsId,
    from_name: 'Justin Cooper',
    from_email: 'warmup@looseendsmail.app',
    domain: 'looseendsmail.app',
    daily_cap: 20,
    sent_today: 0,
    last_reset_date: todayIso,
    status: 'warming',
    created_at: '2026-11-20T01:00:00Z',
  },
  {
    id: 'inb-paused',
    workspace_id: wsId,
    from_name: 'Justin Cooper',
    from_email: 'paused@looseendsmail.app',
    domain: 'looseendsmail.app',
    daily_cap: 20,
    sent_today: 0,
    last_reset_date: todayIso,
    status: 'paused',
    created_at: '2026-11-20T02:00:00Z',
  },
  {
    id: 'inb-secondary',
    workspace_id: wsId,
    from_name: 'Justin Cooper',
    from_email: 'team@looseendshq.com',
    domain: 'looseendshq.com',
    daily_cap: 20,
    sent_today: 19,
    last_reset_date: '2026-11-21', // Stale date -> resets to 0 for todayIso
    status: 'active',
    created_at: '2026-11-20T03:00:00Z',
  },
]

assert.equal(seq.effectiveDailyCap(inboxPool[0]), 15, 'Primary domain cap must never exceed 15/day')
assert.equal(seq.effectiveDailyCap(inboxPool[3]), 20, 'Secondary domain respects daily_cap = 20')

const firstAlloc = seq.assignSenderInbox(inboxPool, { startCursor: 0, todayIso })
assert.ok(firstAlloc)
assert.equal(firstAlloc.inbox.id, 'inb-primary')
assert.equal(firstAlloc.next_sent_today, 15)
assert.equal(firstAlloc.effective_cap, 15)

// Next pick skips warming & paused and wraps to secondary (which reset from 19 -> 0 on new date)
const secondAlloc = seq.assignSenderInbox(firstAlloc.updated_inboxes, {
  startCursor: firstAlloc.next_cursor,
  todayIso,
})
assert.ok(secondAlloc)
assert.equal(secondAlloc.inbox.id, 'inb-secondary')
assert.equal(secondAlloc.next_sent_today, 1)

// Exhaust secondary remaining 19 slots -> primary stays at 15/15 -> all capped returns null
let rotatingPool = secondAlloc.updated_inboxes
let cursor = secondAlloc.next_cursor
for (let i = 0; i < 19; i += 1) {
  const stepAlloc = seq.assignSenderInbox(rotatingPool, { startCursor: cursor, todayIso })
  assert.ok(stepAlloc)
  assert.equal(stepAlloc.inbox.id, 'inb-secondary')
  rotatingPool = stepAlloc.updated_inboxes
  cursor = stepAlloc.next_cursor
}
assert.equal(
  seq.assignSenderInbox(rotatingPool, { startCursor: cursor, todayIso }),
  null,
  'Must return null when all active inboxes reached their daily cap',
)

// 2. Day 3 (<55 words) & Day 7 (<50 words) copy & lane tailoring + CAN-SPAM footer
for (const lane of ['trades_clinics', 'bookkeepers_cpa']) {
  const step2 = seq.buildFollowUpCopy({
    lane,
    step: 2,
    recipientName: 'jordan Taylor',
    companyName: 'Ridgeway Mechanical Services LLC',
    originalSubject: 'Quick margin leak audit',
  })
  assert.ok(step2.word_count < 55, `Day 3 ${lane} must be <55 words (got ${step2.word_count})`)
  assert.ok(guard.isCanSpamFooterCompliant(step2.message))
  assert.ok(step2.message.includes('421 Hill Street, Parkersburg, WV 26104'))
  assert.ok(step2.message.includes('https://www.looseendsos.app/demo'))
  if (lane === 'trades_clinics') {
    assert.ok(step2.message.includes('Shadow Mode'))
  } else {
    assert.ok(step2.message.includes('$0.00-variance'))
    assert.ok(step2.message.includes('20% recurring'))
  }

  const step3 = seq.buildFollowUpCopy({
    lane,
    step: 3,
    recipientName: 'Jordan',
    companyName: 'Ridgeway Mechanical Services LLC',
    originalSubject: step2.subject,
  })
  assert.ok(step3.word_count < 50, `Day 7 ${lane} must be <50 words (got ${step3.word_count})`)
  assert.ok(guard.isCanSpamFooterCompliant(step3.message))
  assert.equal(step3.subject, 'Re: Quick margin leak audit')
}

// 3. Automated Day 3 & Day 7 staging + elapsed day gates + suppression + auto-pause
const nowIso = '2026-11-22T18:00:00Z'
const baseDrafts = [
  // Due for Day 3 (Step 1 sent 4 days ago, trades_clinics)
  {
    id: 'd-step1-due',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-1',
    recipient_email: 'owner@kanawhahvac.com',
    recipient_name: 'Sam',
    company_name: 'Kanawha HVAC',
    outreach_lane: 'trades_clinics',
    sequence_step: 1,
    channel: 'email',
    subject: 'Kanawha HVAC revenue leak scan',
    message: 'Original body\n421 Hill Street, Parkersburg, WV 26104\nReply unsubscribe to opt out.',
    status: 'approved',
    delivery_status: 'sent',
    sent_at: '2026-11-18T12:00:00Z',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-11-18T11:00:00Z',
  },
  // NOT yet due for Day 3 (only 2 days old)
  {
    id: 'd-step1-too-soon',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-2',
    recipient_email: 'owner@toosoon.com',
    company_name: 'Too Soon Plumbing',
    outreach_lane: 'trades_clinics',
    sequence_step: 1,
    channel: 'email',
    subject: 'Follow up',
    message: 'Body\n421 Hill Street, Parkersburg, WV 26104\nunsubscribe',
    status: 'approved',
    delivery_status: 'sent',
    sent_at: '2026-11-20T18:00:00Z',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-11-20T17:00:00Z',
  },
  // Due for Day 7 (Step 2 sent 5 days ago, bookkeepers_cpa)
  {
    id: 'd-step2-due',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-3',
    recipient_email: 'partner@valleycpa.com',
    recipient_name: 'Alex',
    company_name: 'Valley CPA Advisors',
    outreach_lane: 'bookkeepers_cpa',
    sequence_step: 2,
    channel: 'email',
    subject: 'Re: Client close automation',
    message: 'Step 2\n421 Hill Street, Parkersburg, WV 26104\nunsubscribe',
    status: 'approved',
    delivery_status: 'sent',
    sent_at: '2026-11-17T10:00:00Z',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-11-17T09:00:00Z',
  },
  // Suppressed lead -> must NEVER stage follow-up
  {
    id: 'd-step1-suppressed',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-4',
    recipient_email: 'optout@stopped.com',
    company_name: 'Stopped Co',
    outreach_lane: 'trades_clinics',
    sequence_step: 1,
    channel: 'email',
    subject: 'Stopped Co',
    message: 'Body',
    status: 'approved',
    delivery_status: 'sent',
    sent_at: '2026-11-10T10:00:00Z',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-11-10T09:00:00Z',
  },
]

const staged = seq.stageFollowUpDrafts({
  workspaceId: wsId,
  drafts: baseDrafts,
  suppressedEmails: new Set(['optout@stopped.com']),
  asOfIso: nowIso,
})

assert.equal(staged.candidates.length, 2)
const cStep2 = staged.candidates.find(c => c.lead_id === 'lead-1')
const cStep3 = staged.candidates.find(c => c.lead_id === 'lead-3')
assert.equal(cStep2.sequence_step, 2)
assert.equal(cStep2.status, 'draft')
assert.equal(cStep2.delivery_status, 'not_sent')
assert.equal(cStep2.requires_approval, true)
assert.equal(cStep2.outreach_lane, 'trades_clinics')
assert.ok(cStep2.word_count < 55)

assert.equal(cStep3.sequence_step, 3)
assert.equal(cStep3.outreach_lane, 'bookkeepers_cpa')
assert.ok(cStep3.word_count < 50)
assert.ok(cStep3.message.includes('20% recurring'))

// 4. Auto-Pause Guard on reply / unsubscribe + Select All Compliant Batch partition
const simulatedQueue = [
  ...baseDrafts,
  {
    ...cStep2,
    id: 'd-pending-step2',
    workspace_id: wsId,
    channel: 'email',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: nowIso,
  },
  {
    id: 'd-pending-bad-footer',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-bad',
    recipient_email: 'valid@example.com',
    outreach_lane: 'trades_clinics',
    sequence_step: 1,
    channel: 'email',
    subject: 'Missing address',
    message: 'Hi there, reply unsubscribe.',
    status: 'draft',
    delivery_status: 'not_sent',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: nowIso,
  },
  {
    id: 'd-pending-bad-email',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-bademail',
    recipient_email: 'not-an-email',
    outreach_lane: 'trades_clinics',
    sequence_step: 1,
    channel: 'email',
    subject: 'Invalid email',
    message: 'Hi\n421 Hill Street, Parkersburg, WV 26104\nunsubscribe',
    status: 'draft',
    delivery_status: 'not_sent',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: nowIso,
  },
  {
    id: 'd-pending-compliant',
    workspace_id: wsId,
    customer_id: null,
    lead_id: 'lead-good',
    recipient_email: 'good@acmehvac.com',
    outreach_lane: 'trades_clinics',
    sequence_step: 1,
    channel: 'email',
    subject: 'Acme HVAC Shadow Mode',
    message: 'Quick check\n\nReply unsubscribe to opt out.\n421 Hill Street, Parkersburg, WV 26104',
    status: 'draft',
    delivery_status: 'not_sent',
    source_event_id: null,
    approved_by: null,
    approved_at: null,
    created_at: nowIso,
  },
]

const batchRes = seq.selectBatchApprovableDrafts(
  simulatedQueue,
  draft =>
    guard.evaluateDraftCompliance({
      channel: draft.channel,
      message: draft.message,
      emailSuppressed: false,
    }),
)
assert.deepEqual(
  batchRes.eligible.map(d => d.id),
  ['d-pending-step2', 'd-pending-compliant'],
)
assert.equal(batchRes.blocked.length, 2)

// Mark lead-1 replied -> auto-pauses d-pending-step2 immediately and blocks future staging
const pauseRes = seq.pauseLeadSequence({
  drafts: simulatedQueue,
  leadId: 'lead-1',
  reason: 'replied',
})
assert.equal(pauseRes.paused_count, 1)
assert.deepEqual(pauseRes.paused_draft_ids, ['d-pending-step2'])
const pausedPending = pauseRes.updated_drafts.find(d => d.id === 'd-pending-step2')
assert.equal(pausedPending.status, 'rejected')
assert.equal(pausedPending.auto_paused_reason, 'replied')

const postPauseStaged = seq.stageFollowUpDrafts({
  workspaceId: wsId,
  drafts: pauseRes.updated_drafts,
  asOfIso: nowIso,
})
assert.equal(postPauseStaged.candidates.some(c => c.lead_id === 'lead-1'), false)

// 5. SQL Migration, Dispatch Script, and Pipeline UI source contracts
const sqlSrc = readSrc('supabase/migrations/20261123220000_outbound_scale_sequencer.sql')
assert.ok(sqlSrc.includes('create table if not exists public.outbound_sender_inboxes'))
assert.ok(sqlSrc.includes('public.is_workspace_owner(workspace_id)'))
assert.ok(sqlSrc.includes('ops_drafts_lead_step_unique_idx'))
assert.ok(sqlSrc.includes("'draft_stage_followup'"))
assert.ok(sqlSrc.includes("'draft_pause_sequence'"))
assert.ok(sqlSrc.includes("'draft_batch_approve'"))

const scriptSrc = readSrc('scripts/sendApprovedDrafts.ts')
assert.ok(scriptSrc.includes("process.argv.includes('--live')"))
assert.ok(scriptSrc.includes('assignSenderInbox'))
assert.ok(scriptSrc.includes('outbound_sender_inboxes'))

const uiSrc = readSrc('src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx')
assert.ok(uiSrc.includes('Sender Pool'))
assert.ok(uiSrc.includes('Trades & Clinics'))
assert.ok(uiSrc.includes('Bookkeepers & CPAs'))
assert.ok(uiSrc.includes('Day 3 Bump'))
assert.ok(uiSrc.includes('Day 7 Final'))
assert.ok(uiSrc.includes('Select All Compliant'))
assert.ok(uiSrc.includes('Stage Due Follow-Ups (Day 3 / Day 7)'))

console.log('Outbound Scale Upgrade (Multi-Inbox Rotation, Day 3/7 Sequencer & Batch Approval) tests passed')
