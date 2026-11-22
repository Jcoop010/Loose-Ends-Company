import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  compileCpaAuditPacket,
  DEFAULT_AUTONOMY_CONFIG,
  evaluateAutonomousCollections,
  serializeCpaPacketToCsv,
  serializeCpaPacketToJson,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

// 1. Air-gap verification on Release 4A engines & /demo UI
for (const relPath of [
  'src/lib/autonomousOs/cpaPacketEngine.ts',
  'src/lib/autonomousOs/collectionsEngine.ts',
  'src/state/DemoStoreContext.tsx',
  'src/features/demo/AutonomousSandboxPanel.tsx',
]) {
  const raw = readSrc(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.equal(
    /supabase|edgeFunctions|opsCommand|queries/.test(raw),
    false,
    `${relPath} must stay 100% air-gapped`,
  )
}

// 2. CPA Tax & Audit Packet: exact integer-cent double-entry reconciliation (0c variance)
const packet = compileCpaAuditPacket({
  workspaceName: 'Ridgeway HVAC & Mechanical',
  asOfDate: '2026-11-22',
  openingCashCents: 2500000,
  ledgerEntries: [
    {
      id: 'le-1',
      workspace_id: 'ws-r4a',
      entry_type: 'revenue',
      category: 'Verified Settlements',
      description: 'Paid INV-3009',
      amount_cents: 89000,
      occurred_on: '2026-11-10',
      source_ref: 'INV-3009',
    },
    {
      id: 'le-2',
      workspace_id: 'ws-r4a',
      entry_type: 'cogs',
      category: 'Supplier Parts',
      description: 'OEM blower stock',
      amount_cents: 112000,
      occurred_on: '2026-11-12',
      source_ref: 'VB-9010',
    },
    {
      id: 'le-3',
      workspace_id: 'ws-r4a',
      entry_type: 'expense',
      category: 'Fleet & SaaS',
      description: 'Dispatch software',
      amount_cents: 45000,
      occurred_on: '2026-11-15',
      source_ref: 'EXP-1',
    },
  ],
  invoices: [
    {
      id: 'inv-paid',
      workspace_id: 'ws-r4a',
      quote_id: null,
      lead_id: null,
      customer_id: null,
      invoice_number: 'INV-3009',
      title: 'Paid Sprint',
      customer_name: 'Redwood Coast Goods',
      customer_email: null,
      subtotal_cents: 89000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 89000,
      amount_paid_cents: 89000,
      due_date: '2026-11-12',
      stripe_checkout_url: null,
      status: 'paid',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'inv-open',
      workspace_id: 'ws-r4a',
      quote_id: null,
      lead_id: null,
      customer_id: null,
      invoice_number: 'INV-3011',
      title: 'Open AR Invoice',
      customer_name: 'Meridian Logistics',
      customer_email: null,
      subtotal_cents: 185000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 185000,
      amount_paid_cents: 0,
      due_date: '2026-11-10',
      stripe_checkout_url: null,
      status: 'overdue',
      created_at: '2026-11-02T00:00:00Z',
    },
  ],
  vendorBills: [
    {
      id: 'vb-1',
      workspace_id: 'ws-r4a',
      po_id: null,
      vendor_name: 'Apex Industrial',
      invoice_number: 'VB-9040',
      subtotal_cents: 64000,
      tax_cents: 0,
      total_cents: 64000,
      due_date: '2026-12-01',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      discrepancy_summary: null,
      created_at: '2026-11-14T00:00:00Z',
    },
  ],
})

assert.equal(packet.trial_balance.variance_cents, 0, 'Trial balance must have exact 0 cent variance')
assert.equal(packet.trial_balance.is_balanced, true)
assert.equal(
  packet.trial_balance.total_debits_cents,
  packet.trial_balance.total_credits_cents,
)
assert.equal(packet.balance_sheet.balance_sheet_variance_cents, 0)
assert.equal(packet.balance_sheet.is_balanced, true)
// No double count of INV-3009 (89000 revenue + 185000 open AR = 274000 revenue)
assert.equal(packet.profit_and_loss.revenue_cents, 274000)
// COGS = 112000 + 64000 = 176000; OpEx = 45000; Net Income = 274000 - 176000 - 45000 = 53000
assert.equal(packet.profit_and_loss.cogs_cents, 176000)
assert.equal(packet.profit_and_loss.operating_expenses_cents, 45000)
assert.equal(packet.profit_and_loss.net_income_cents, 53000)

const csvText = serializeCpaPacketToCsv(packet)
assert.ok(csvText.includes('Trial Balance Totals'))
assert.ok(csvText.includes('Variance = $0.00'))
const parsedJson = JSON.parse(serializeCpaPacketToJson(packet))
assert.equal(parsedJson.trial_balance.variance_cents, 0)

// 3. Autonomous Collections Engine: 3 stages, odd-cent split, paid/disputed auto-pause, Autonomy Dial
const portalTokens = new Map([['q-3', 'qpt_day3_demo']])
const testInvoices = [
  {
    id: 'inv-d3',
    workspace_id: 'ws-r4a',
    quote_id: 'q-3',
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-D3',
    title: 'Clinic Check',
    customer_name: 'Summit Dental',
    customer_email: 'office@summit.invalid',
    subtotal_cents: 65000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 65000,
    amount_paid_cents: 0,
    due_date: '2026-11-17', // 5d overdue
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'inv-d10',
    workspace_id: 'ws-r4a',
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-D10',
    title: 'Odd Split Test',
    customer_name: 'Meridian Logistics',
    customer_email: 'ap@meridian.invalid',
    subtotal_cents: 10001,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 10001,
    amount_paid_cents: 0,
    due_date: '2026-11-10', // 12d overdue
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-25T00:00:00Z',
  },
  {
    id: 'inv-d21',
    workspace_id: 'ws-r4a',
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-D21',
    title: 'Chiller Retrofit',
    customer_name: 'Cascade Precision',
    customer_email: 'ap@cascade.invalid',
    subtotal_cents: 240000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 240000,
    amount_paid_cents: 0,
    due_date: '2026-10-29', // 24d overdue
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-10T00:00:00Z',
  },
  {
    id: 'inv-paid-99',
    workspace_id: 'ws-r4a',
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-PAID',
    title: 'Already Settled',
    customer_name: 'Redwood Goods',
    customer_email: 'ap@redwood.invalid',
    subtotal_cents: 89000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 89000,
    amount_paid_cents: 89000,
    due_date: '2026-11-12',
    stripe_checkout_url: null,
    status: 'paid',
    created_at: '2026-10-20T00:00:00Z',
  },
  {
    id: 'inv-disputed-1',
    workspace_id: 'ws-r4a',
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-DISP',
    title: 'Disputed Scope',
    customer_name: 'Dispute Corp',
    customer_email: 'ap@dispute.invalid',
    subtotal_cents: 120000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 120000,
    amount_paid_cents: 0,
    due_date: '2026-10-20',
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-01T00:00:00Z',
  },
]

const colPlan = evaluateAutonomousCollections({
  workspaceId: 'ws-r4a',
  invoices: testInvoices,
  existingTouches: [
    {
      id: 'old-touch-paid',
      workspace_id: 'ws-r4a',
      invoice_id: 'inv-paid-99',
      stage: 'day_3_nudge',
      status: 'staged',
      amount_due_cents: 89000,
      portal_url: '/portal/p',
      proof_summary: 'old',
    },
    {
      id: 'old-touch-disp',
      workspace_id: 'ws-r4a',
      invoice_id: 'inv-disputed-1',
      stage: 'day_21_owner_escalation',
      status: 'staged',
      amount_due_cents: 120000,
      portal_url: '/portal/d',
      proof_summary: 'old',
    },
  ],
  disputedInvoiceIds: ['inv-disputed-1'],
  portalTokenByQuoteId: portalTokens,
  config: {
    ...DEFAULT_AUTONOMY_CONFIG,
    autonomy_rules: {
      ...DEFAULT_AUTONOMY_CONFIG.autonomy_rules,
      send_invoice_reminder: 'full_auto',
    },
    auto_limit_cents: 100000, // 65000 & 10001 <= cap -> execute_now; 240000 > cap -> queue_for_approval
  },
  asOfDate: '2026-11-22',
})

assert.equal(colPlan.staged_candidates.length, 3)
assert.equal(colPlan.paused_candidates.length, 2)
assert.deepEqual(colPlan.existing_touch_ids_to_pause_paid, ['old-touch-paid'])
assert.deepEqual(colPlan.existing_touch_ids_to_pause_disputed, ['old-touch-disp'])

const cDay3 = colPlan.staged_candidates.find(c => c.invoice_id === 'inv-d3')
assert.equal(cDay3.stage, 'day_3_nudge')
assert.equal(cDay3.portal_url, '/portal/qpt_day3_demo')
assert.equal(cDay3.autonomy_decision, 'execute_now')

const cDay10 = colPlan.staged_candidates.find(c => c.invoice_id === 'inv-d10')
assert.equal(cDay10.stage, 'day_10_split_offer')
assert.equal(cDay10.split_part_1_cents, 5001)
assert.equal(cDay10.split_part_2_cents, 5000)
assert.equal(cDay10.split_part_1_cents + cDay10.split_part_2_cents, 10001)

const cDay21 = colPlan.staged_candidates.find(c => c.invoice_id === 'inv-d21')
assert.equal(cDay21.stage, 'day_21_owner_escalation')
assert.equal(cDay21.autonomy_decision, 'queue_for_approval')

const cPaid = colPlan.paused_candidates.find(c => c.invoice_id === 'inv-paid-99')
assert.equal(cPaid.status, 'paused_paid')
assert.equal(cPaid.auto_paused_reason, 'paid')

const cDisp = colPlan.paused_candidates.find(c => c.invoice_id === 'inv-disputed-1')
assert.equal(cDisp.status, 'paused_disputed')
assert.equal(cDisp.auto_paused_reason, 'disputed')

// 4. Air-gapped /demo AutonomousSandboxPanel interactive smoke test (CPA Packet + Collections + Disputed Pause + Undo)
const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://www.looseendsos.app/demo',
})
const w = installDomGlobals(dom)
w.scrollTo = () => {}

const opts = {
  globals: { window: w, document: w.document, history: w.history },
  cache: new Map(),
}
const { ToastProvider } = loadSrcModule('src/components/ui/Toast.tsx', opts)
const { DemoStoreProvider, useDemoStore } = loadSrcModule('src/state/DemoStoreContext.tsx', opts)
const { AutonomousSandboxPanel } = loadSrcModule('src/features/demo/AutonomousSandboxPanel.tsx', opts)

let demoApi = null
function Release4AHarness() {
  demoApi = useDemoStore()
  return React.createElement(AutonomousSandboxPanel)
}

const root = createRoot(w.document.getElementById('root'))
try {
  await act(async () => {
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(DemoStoreProvider, null, React.createElement(Release4AHarness)),
      ),
    )
    await new Promise(r => setTimeout(r, 30))
  })

  const r4aBox = w.document.getElementById('release-4a-sandbox')
  assert.ok(r4aBox, 'Release 4A sandbox container must render')

  const cpaBtn = Array.from(r4aBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Generate 1-Click CPA Packet'),
  )
  assert.ok(cpaBtn)
  await act(async () => {
    cpaBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(r4aBox.textContent.includes('Variance: $0.00'))
  assert.equal(demoApi.state.osCpaPacket.trial_balance.variance_cents, 0)

  const colBtn = Array.from(r4aBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Run Autonomous Collections'),
  )
  assert.ok(colBtn)
  await act(async () => {
    colBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(r4aBox.textContent.includes('Day 3+ Nudge (Portal Link)'))
  assert.ok(r4aBox.textContent.includes('Day 10+ 2-Part Split Offer'))
  assert.ok(r4aBox.textContent.includes('Day 21+ Owner Escalation'))
  assert.ok(r4aBox.textContent.includes('Auto-Paused (Paid)'))

  // Toggle Dispute -> Auto-Pause immediately
  const disputeBtn = Array.from(r4aBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Mark Disputed (Auto-Pause)'),
  )
  assert.ok(disputeBtn)
  await act(async () => {
    disputeBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(r4aBox.textContent.includes('Paused (Disputed)'))

  // Execute 1-Click Undo Collections Run
  const undoColBtn = Array.from(r4aBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo Collections Run'),
  )
  assert.ok(undoColBtn)
  await act(async () => {
    undoColBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osCollectionsRunLedgerId, null)
  assert.ok(r4aBox.textContent.includes('Reversed (1-Click Undo)'))
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('CPA Tax & Audit Packet + Autonomous Collections Engine (with auto-pause & 1-Click Undo) tests passed')
