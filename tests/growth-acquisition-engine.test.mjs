import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const calc = loadSrcModule('src/lib/growth/leakCalculatorEngine.ts')
const scout = loadSrcModule('src/lib/growth/regionalScoutEngine.ts')
const followUp = loadSrcModule('src/lib/growth/followUpQueueEngine.ts')
const seq = loadSrcModule('src/lib/outbound/sequencerEngine.ts')
const guard = loadSrcModule('src/lib/canSpamGuard.ts')

// 1. Air-gap checks on pure growth modules & DemoWorkspacePage
for (const relPath of [
  'src/lib/growth/leakCalculatorEngine.ts',
  'src/lib/growth/followUpQueueEngine.ts',
  'src/features/demo/DemoWorkspacePage.tsx',
]) {
  const clean = readSrc(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.equal(
    /supabase|edgeFunctions|opsCommand|queries/.test(clean),
    false,
    `${relPath} must remain 100% air-gapped`,
  )
}

// 2. Deterministic integer-cent Leak Calculator tests
const defaultEst = calc.calculateOpsLeakEstimate({
  monthlyRevenueCents: 12_000_000, // $120,000
  teamSeats: 12,
  monthlyOverdueAndBillsCents: 3_500_000, // $35,000
})
assert.equal(defaultEst.legacy_monthly_cents, 109_800) // $150 + 12*$79
assert.equal(defaultEst.monthly_seat_tax_savings_cents, 89_900) // $1,098 - $199
assert.equal(defaultEst.annual_seat_tax_savings_cents, 1_078_800) // $10,788/yr
assert.equal(defaultEst.monthly_unbilled_quotes_cents, 180_000) // 1.5% of $120k
assert.equal(defaultEst.monthly_overdue_ar_recovery_cents, 126_000) // 6% of (60% of $35k)
assert.equal(defaultEst.monthly_vendor_spike_savings_cents, 63_000) // 4.5% of (40% of $35k)
assert.equal(defaultEst.monthly_recoverable_cash_cents, 369_000)
assert.equal(defaultEst.annual_recoverable_cash_cents, 4_428_000)
assert.equal(defaultEst.payback_days, 2)

const maxEst = calc.calculateOpsLeakEstimate({
  monthlyRevenueCents: 99_000_000, // clamped to $500k
  teamSeats: 99, // clamped to 50
  monthlyOverdueAndBillsCents: 20_000_000, // clamped to $150k
})
assert.equal(maxEst.monthly_revenue_cents, 50_000_000)
assert.equal(maxEst.team_seats, 50)
assert.equal(maxEst.monthly_overdue_and_bills_cents, 15_000_000)
assert.ok(Number.isSafeInteger(maxEst.annual_total_impact_cents))

const badEmail = calc.validateCalculatorEmail('not-an-email')
assert.equal(badEmail.valid, false)
const goodEmail = calc.validateCalculatorEmail('  Owner@RidgewayHVAC.com ')
assert.equal(goodEmail.valid, true)
assert.equal(goodEmail.normalized, 'owner@ridgewayhvac.com')

const leadPayload = calc.buildInboundCalculatorLeadRow('owner@ridgewayhvac.com', defaultEst)
assert.equal(leadPayload.outreach_lane, 'inbound_calculator')
assert.equal(leadPayload.status, 'DRAFT_READY')
assert.equal(leadPayload.contact_email, 'owner@ridgewayhvac.com')
assert.ok(leadPayload.notes.includes('[INBOUND CALCULATOR]'))

// 3. Regional Scout engine: regions, hard cap <= 25, dedupe/suppression, <75-word CAN-SPAM drafts
for (const key of ['columbus_oh', 'pittsburgh_pa', 'charleston_wv', 'morgantown_wv', 'roanoke_va']) {
  assert.ok(scout.REGIONAL_MARKETS[key], `Missing regional market spec: ${key}`)
}
const defaultCli = scout.parseRegionalScoutArgs([])
assert.equal(defaultCli.mode, 'dry_run')
assert.equal(defaultCli.limit, 15)

const cappedCli = scout.parseRegionalScoutArgs([
  '--region',
  'pittsburgh_pa',
  '--lane',
  'trades_clinics',
  '--limit',
  '99',
  '--stage',
])
assert.equal(cappedCli.region, 'pittsburgh_pa')
assert.equal(cappedCli.lane, 'trades_clinics')
assert.equal(cappedCli.limit, 25)
assert.equal(cappedCli.mode, 'stage')
assert.throws(() => scout.parseRegionalScoutArgs(['--region', 'mars_colony']))

const tradesDraft = scout.buildRegionalDay1Draft({
  lane: 'trades_clinics',
  companyName: 'Buckeye Comfort HVAC',
  contactName: 'Dan Miller',
})
assert.ok(tradesDraft.word_count < 75, `Trades Day 1 draft too long: ${tradesDraft.word_count}`)
assert.equal(guard.isCanSpamFooterCompliant(tradesDraft.message), true)
assert.ok(tradesDraft.message.includes('421 Hill Street, Parkersburg, WV 26104 | Reply STOP to opt out.'))
assert.ok(tradesDraft.message.includes('https://www.looseendsos.app/calculator'))
assert.ok(tradesDraft.message.includes('https://www.looseendsos.app/demo'))
assert.ok(tradesDraft.message.toLowerCase().includes("reply 'send it'"))

const cpaDraft = scout.buildRegionalDay1Draft({
  lane: 'bookkeepers_cpa',
  companyName: 'Scioto Tax & Ledger CPA',
  contactName: 'Sarah Lee',
})
assert.ok(cpaDraft.word_count < 75, `CPA Day 1 draft too long: ${cpaDraft.word_count}`)
assert.equal(guard.isCanSpamFooterCompliant(cpaDraft.message), true)
assert.ok(cpaDraft.message.includes('$199/mo'))
assert.ok(cpaDraft.message.includes('$0.00-variance'))
assert.ok(cpaDraft.message.includes('20%'))
assert.ok(cpaDraft.message.includes('421 Hill Street, Parkersburg, WV 26104 | Reply STOP to opt out.'))

const deduped = scout.filterAndDedupeRegionalCandidates({
  candidates: [
    ...scout.getCuratedDryRunCandidates('columbus_oh', 'both'),
    {
      business: 'Opted Out Mechanical',
      contact_name: 'Owner',
      email: 'optout@stopped.com',
      website: 'https://stopped.com',
      location: 'Columbus, OH',
      industry: 'HVAC',
      lane: 'trades_clinics',
      score: 85,
    },
    {
      business: 'Duplicate Domain Co',
      contact_name: 'Owner',
      email: 'sales@existing-co.com',
      website: 'https://www.existing-co.com',
      location: 'Columbus, OH',
      industry: 'HVAC',
      lane: 'trades_clinics',
      score: 84,
    },
  ],
  existingBusinesses: new Set(),
  existingEmails: new Set(),
  existingDomains: new Set(['existing-co.com']),
  suppressedEmails: new Set(['optout@stopped.com']),
  limit: 25,
})
assert.equal(deduped.accepted.length, 5)
assert.equal(deduped.skipped_reasons.suppressed_opt_out, 1)
assert.equal(deduped.skipped_reasons.duplicate_domain, 1)

// 4. 48-hour Call Follow-Up Queue & Not Interested -> Sequence Auto-Pause
const nowIso = '2026-11-23T12:00:00Z'
const queue = followUp.buildCallFollowUpQueue({
  nowIso,
  leads: [
    {
      id: 'lead-due',
      workspace_id: 'ws-1',
      business: 'Columbus Mechanical',
      name: 'Mark Vance',
      contact_name: 'Mark Vance',
      email: 'mark@columbusmech.com',
      contact_email: 'mark@columbusmech.com',
      phone: '614-555-0100',
      outreach_lane: 'trades_clinics',
      status: 'CONTACTED',
      biggest_problem: null,
      notes: null,
      auto_paused_reason: null,
      call_outcome: null,
      call_followed_up_at: null,
      created_at: '2026-11-20T08:00:00Z',
    },
    {
      id: 'lead-replied',
      workspace_id: 'ws-1',
      business: 'Replied CPA',
      name: 'Kim',
      contact_name: 'Kim',
      email: 'kim@repliedcpa.com',
      contact_email: 'kim@repliedcpa.com',
      phone: null,
      outreach_lane: 'bookkeepers_cpa',
      status: 'REPLIED',
      biggest_problem: null,
      notes: null,
      auto_paused_reason: 'replied',
      call_outcome: null,
      call_followed_up_at: null,
      created_at: '2026-11-20T08:00:00Z',
    },
  ],
  drafts: [
    {
      id: 'dr-due',
      workspace_id: 'ws-1',
      customer_id: null,
      lead_id: 'lead-due',
      recipient_email: 'mark@columbusmech.com',
      recipient_name: 'Mark Vance',
      company_name: 'Columbus Mechanical',
      outreach_lane: 'trades_clinics',
      sequence_step: 1,
      source_event_id: null,
      channel: 'email',
      subject: 'Test',
      message: 'Body',
      status: 'approved',
      approved_by: 'u-1',
      approved_at: '2026-11-20T09:00:00Z',
      delivery_status: 'sent',
      sent_at: '2026-11-20T10:00:00Z', // 74h ago -> DUE
      created_at: '2026-11-20T09:00:00Z',
    },
    {
      id: 'dr-fresh',
      workspace_id: 'ws-1',
      customer_id: null,
      lead_id: 'lead-fresh',
      recipient_email: 'fresh@shop.com',
      recipient_name: 'Fresh Shop',
      company_name: 'Fresh Shop',
      outreach_lane: 'trades_clinics',
      sequence_step: 1,
      source_event_id: null,
      channel: 'email',
      subject: 'Fresh',
      message: 'Body',
      status: 'approved',
      approved_by: 'u-1',
      approved_at: '2026-11-22T20:00:00Z',
      delivery_status: 'sent',
      sent_at: '2026-11-22T20:00:00Z', // <48h -> NOT DUE
      created_at: '2026-11-22T20:00:00Z',
    },
    {
      id: 'dr-pending-bump',
      workspace_id: 'ws-1',
      customer_id: null,
      lead_id: 'lead-due',
      recipient_email: 'mark@columbusmech.com',
      recipient_name: 'Mark Vance',
      company_name: 'Columbus Mechanical',
      outreach_lane: 'trades_clinics',
      sequence_step: 2,
      source_event_id: null,
      channel: 'email',
      subject: 'Re: Test',
      message: 'Followup',
      status: 'draft',
      approved_by: null,
      approved_at: null,
      delivery_status: 'not_sent',
      sent_at: null,
      created_at: '2026-11-23T09:00:00Z',
    },
  ],
})
assert.equal(queue.length, 1)
assert.equal(queue[0].business_name, 'Columbus Mechanical')
assert.equal(queue[0].hours_since_sent, 74)
assert.ok(queue[0].script_30s.includes('Read-Only Shadow Mode'))

const notInt = followUp.resolveCallOutcomeAction('not_interested')
assert.equal(notInt.shouldPauseSequence, true)
assert.equal(notInt.pauseReason, 'manual')
const pausedAfterCall = seq.pauseLeadSequence({
  drafts: [
    {
      id: 'dr-pending-bump',
      workspace_id: 'ws-1',
      customer_id: null,
      lead_id: 'lead-due',
      recipient_email: 'mark@columbusmech.com',
      outreach_lane: 'trades_clinics',
      sequence_step: 2,
      source_event_id: null,
      channel: 'email',
      subject: 'Re: Test',
      message: 'Followup',
      status: 'draft',
      approved_by: null,
      approved_at: null,
      delivery_status: 'not_sent',
      created_at: '2026-11-23T09:00:00Z',
    },
  ],
  leadId: 'lead-due',
  reason: notInt.pauseReason,
})
assert.equal(pausedAfterCall.paused_count, 1)
assert.equal(pausedAfterCall.updated_drafts[0].auto_paused_reason, 'manual')
assert.ok(followUp.MULTI_DOMAIN_WARMUP_CHECKLIST.some(s => /SPF/i.test(s.title)))
assert.ok(followUp.MULTI_DOMAIN_WARMUP_CHECKLIST.some(s => /DKIM/i.test(s.title)))
assert.ok(followUp.MULTI_DOMAIN_WARMUP_CHECKLIST.some(s => /DMARC/i.test(s.title)))

// 5. Routing, Vercel rewrite, & JSDOM <CalculatorPage /> slider -> email capture -> /demo handoff
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://www.looseendsos.app/calculator',
})
const w = installDomGlobals(dom)
w.scrollTo = () => {}

const uiOpts = {
  globals: { window: w, document: w.document, history: w.history },
  moduleOverrides: {
    'src/lib/queries.ts': {
      submitCalculatorLead: async () => ({ duplicate: false, email: '' }),
    },
  },
  cache: new Map(),
}
const { parseAppLocation, RouterProvider } = loadSrcModule('src/state/RouterContext.tsx', uiOpts)
const { CalculatorPage } = loadSrcModule('src/features/calculator/CalculatorPage.tsx', uiOpts)

assert.equal(parseAppLocation('/calculator').topRoute, 'calculator')
const vercelRaw = readSrc('vercel.json')
assert.ok(vercelRaw.includes('"/calculator"'))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const capturedLeads = []
const handoffs = []
const container = w.document.getElementById('root')
const root = createRoot(container)
try {
  await act(async () => {
    root.render(
      React.createElement(
        RouterProvider,
        null,
        React.createElement(CalculatorPage, {
          onSubmitLead: async params => {
            capturedLeads.push(params)
            return { duplicate: false, email: params.email }
          },
          onHandoff: targetUrl => handoffs.push(targetUrl),
        }),
      ),
    )
    await new Promise(r => setTimeout(r, 25))
  })

  assert.equal(
    container.querySelector('[data-testid="calc-annual-seat-savings"]')?.textContent,
    '$10,788.00',
  )

  const seatsSlider = container.querySelector('#calc-team-seats')
  assert.ok(seatsSlider)
  await act(async () => {
    seatsSlider.value = '30'
    Simulate.change(seatsSlider, { target: { value: '30' } })
    await new Promise(r => setTimeout(r, 25))
  })
  // 150 + 30*79 = 2520 - 199 = 2321/mo -> 27,852/yr
  assert.equal(
    container.querySelector('[data-testid="calc-annual-seat-savings"]')?.textContent,
    '$27,852.00',
  )

  const emailInput = container.querySelector('#calculator-lead-email')
  const form = emailInput.closest('form')
  await act(async () => {
    emailInput.value = 'lead@columbus-hvac.com'
    Simulate.change(emailInput, { target: { value: 'lead@columbus-hvac.com' } })
    await new Promise(r => setTimeout(r, 15))
  })

  await act(async () => {
    Simulate.submit(form)
    await new Promise(r => setTimeout(r, 30))
  })

  assert.equal(capturedLeads.length, 1)
  assert.equal(capturedLeads[0].email, 'lead@columbus-hvac.com')
  assert.equal(capturedLeads[0].estimate.team_seats, 30)
  assert.deepEqual(handoffs, ['https://www.looseendsos.app/demo'])
} finally {
  await act(async () => {
    root.unmount()
  })
  dom.window.close()
}

// 6. UI, Migration, and CLI source contracts
const landingSrc = readSrc('src/features/landing/LandingPage.tsx')
assert.ok(landingSrc.includes("navigate('/calculator')"))
const demoPageSrc = readSrc('src/features/demo/DemoWorkspacePage.tsx')
assert.ok(demoPageSrc.includes("navigate('/calculator')"))
const panelSrc = readSrc('src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx')
assert.ok(panelSrc.includes('48-Hour Call &amp; Walk-In Follow-Up Queue'))
assert.ok(panelSrc.includes('Multi-Domain Warmup'))
assert.ok(panelSrc.includes('Inbound Calculator'))
const migrationSrc = readSrc('supabase/migrations/20261124120000_growth_engine_v1.sql')
assert.ok(migrationSrc.includes("'inbound_calculator'"))
assert.ok(migrationSrc.includes('call_outcome'))

console.log('Growth Engine v1 (/calculator, Regional Scout CLI & 48h Follow-Up Queue) tests passed')
