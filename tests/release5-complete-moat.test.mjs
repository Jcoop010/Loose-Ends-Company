import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  buildWorkspaceBillCaptureAddress,
  parseInboundBillText,
  processInboundBillCapture,
  buildPostCapturedBillPlan,
  SAMPLE_INBOUND_BILL_CLEAN_TEXT,
  SAMPLE_INBOUND_BILL_SPIKE_TEXT,
  parseBankFeedPayload,
  autoReconcileBankFeed,
  buildReconcileMatchedPlan,
  SAMPLE_BANK_FEED_CSV,
  SAMPLE_PLAID_WEBHOOK_JSON,
  evaluateJobMargin,
  evaluateJobMarginPortfolio,
  buildDraftChangeOrderPlan,
  filterByEntityId,
  reverseLedgerAction,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const wsId = 'ws-release5-moat'

// 1. Air-gap verification on all Release 5 pure engines and /demo sandbox modules
for (const relPath of [
  'src/lib/autonomousOs/inboxToLedgerEngine.ts',
  'src/lib/autonomousOs/bankReconciliationEngine.ts',
  'src/lib/autonomousOs/jobMarginEngine.ts',
  'src/state/DemoStoreContext.tsx',
  'src/features/demo/AutonomousSandboxPanel.tsx',
]) {
  const raw = readSrc(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.equal(
    /supabase|edgeFunctions|opsCommand|queries/.test(raw),
    false,
    `${relPath} must remain 100% air-gapped`,
  )
}

// 2. Inbox-to-Ledger Engine: capture address, integer-cent parse, 3-Way Match clean vs >10% Fraud Freeze + Undo
const captureAddr = buildWorkspaceBillCaptureAddress('Ridgeway HVAC & Mechanical')
assert.equal(captureAddr, 'bills@ridgeway-hvac-mechanical.looseendsos.app')

const parsedClean = parseInboundBillText(SAMPLE_INBOUND_BILL_CLEAN_TEXT)
assert.equal(parsedClean.vendor_name, 'Apex Industrial Supply')
assert.equal(parsedClean.po_reference, 'PO-2026-1104')
assert.equal(parsedClean.extracted_total_cents, 64000)

const evalClean = processInboundBillCapture({
  workspaceId: wsId,
  entityId: 'ent-1',
  sourceAddress: captureAddr,
  fileName: 'clean_bill.pdf',
  rawText: SAMPLE_INBOUND_BILL_CLEAN_TEXT,
  poItems: [
    { id: 'po-1', po_id: 'PO-2026-1104', sku: 'COIL-10', description: 'Coil', ordered_qty: 4, unit_cost_cents: 16000 },
  ],
  receiptItems: [{ sku: 'COIL-10', received_qty: 4, damaged_qty: 0 }],
})
assert.equal(evalClean.capture_draft.match_status, '3way_matched')
assert.equal(evalClean.fraud_alerts.length, 0)

const postPlan = buildPostCapturedBillPlan({
  workspaceId: wsId,
  capture: { ...evalClean.capture_draft, id: 'cap-clean-1' },
  nowIso: '2026-11-22T15:00:00Z',
})
assert.equal(postPlan.updated_capture.match_status, 'posted')
assert.equal(postPlan.ledger_entry_draft.amount_cents, 64000)
const capUndo = reverseLedgerAction(
  { ...postPlan.agent_ledger_draft, id: 'led-cap-1', created_at: '2026-11-22T15:00:00Z' },
  '2026-11-22T15:05:00Z',
)
assert.equal(capUndo.updatedEntry.status, 'reversed')
assert.equal(capUndo.restoredState.previous_match_status, '3way_matched')

const evalSpike = processInboundBillCapture({
  workspaceId: wsId,
  entityId: 'ent-1',
  sourceAddress: captureAddr,
  fileName: 'spike_bill.pdf',
  rawText: SAMPLE_INBOUND_BILL_SPIKE_TEXT,
  priorUnitCostsBySku: { 'VALVE-42': 4200 },
  knownRemitByVendor: { 'titan mechanical supply': 'ACH-4401' },
})
assert.equal(evalSpike.capture_draft.match_status, 'fraud_frozen')
assert.equal(evalSpike.capture_draft.extracted_total_cents, 280000)
assert.ok(evalSpike.fraud_alerts.some(a => a.alert_type === 'price_spike_over_10pct' && a.variance_cents === 70000))
assert.throws(() =>
  buildPostCapturedBillPlan({
    workspaceId: wsId,
    capture: { ...evalSpike.capture_draft, id: 'cap-spike-1' },
  }),
)

// 3. Bank Feed Auto-Reconciliation Engine: CSV + OFX/QBO + Plaid webhook + exact cent Proof Cards + Undo
const csvParsed = parseBankFeedPayload(SAMPLE_BANK_FEED_CSV, 'bank_csv')
assert.equal(csvParsed.length, 3)
assert.equal(csvParsed[0].amount_cents, 185000)
assert.equal(csvParsed[0].direction, 'inflow')

const plaidParsed = parseBankFeedPayload(SAMPLE_PLAID_WEBHOOK_JSON, 'plaid_webhook')
assert.equal(plaidParsed.length, 2)
assert.equal(plaidParsed[0].amount_cents, 185000)
assert.equal(plaidParsed[0].direction, 'inflow')
assert.equal(plaidParsed[1].amount_cents, 64000)
assert.equal(plaidParsed[1].direction, 'outflow')

const ofxSample = `
<OFX><BANKMSGSRSV1><STMTTRN>
<DTPOSTED>20261118120000
<TRNAMT>1850.00
<NAME>Cedar Point Urgent Care ACH
</STMTTRN><STMTTRN>
<DTPOSTED>20261118120000
<TRNAMT>-640.00
<NAME>Apex Industrial Supply
</STMTTRN></STMTTRN></BANKMSGSRSV1></OFX>
`
const ofxParsed = parseBankFeedPayload(ofxSample, 'ofx_qbo')
assert.equal(ofxParsed.length, 2)
assert.equal(ofxParsed[0].amount_cents, 185000)
assert.equal(ofxParsed[1].amount_cents, 64000)

const recon = autoReconcileBankFeed({
  workspaceId: wsId,
  entityId: 'ent-1',
  transactions: csvParsed,
  asOfDate: '2026-11-22',
  invoices: [
    {
      id: 'inv-cp-1',
      workspace_id: wsId,
      quote_id: null,
      lead_id: null,
      customer_id: null,
      invoice_number: 'INV-881',
      title: 'Clinic Retrofit',
      customer_name: 'Cedar Point Urgent Care',
      customer_email: null,
      subtotal_cents: 185000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 185000,
      amount_paid_cents: 0,
      due_date: '2026-11-18',
      status: 'overdue',
      created_at: '2026-11-01T00:00:00Z',
    },
  ],
  vendorBills: [
    {
      id: 'vb-apex-1',
      workspace_id: wsId,
      po_id: null,
      vendor_name: 'Apex Industrial Supply',
      invoice_number: 'VB-9040',
      subtotal_cents: 64000,
      tax_cents: 0,
      total_cents: 64000,
      due_date: '2026-11-18',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      created_at: '2026-11-15T00:00:00Z',
    },
  ],
})
assert.equal(recon.auto_matched_count, 2)
assert.equal(recon.unmatched_count, 1)
assert.equal(recon.matched_inflow_cents, 185000)
assert.equal(recon.matched_outflow_cents, 64000)
assert.equal(recon.transactions[0].match_confidence_bps, 10000)

const reconCommit = buildReconcileMatchedPlan({
  workspaceId: wsId,
  transactions: recon.transactions,
  nowIso: '2026-11-22T16:00:00Z',
})
assert.equal(reconCommit.reconciled_ids.length, 2)
assert.equal(reconCommit.total_reconciled_cents, 249000)
const bankUndo = reverseLedgerAction(
  { ...reconCommit.ledger_draft, id: 'led-bank-1', created_at: '2026-11-22T16:00:00Z' },
  '2026-11-22T16:05:00Z',
)
assert.equal(bankUndo.updatedEntry.status, 'reversed')
assert.equal(bankUndo.restoredState.previous_status, 'auto_matched')

// 4. Live Job Margin Engine + Multi-Entity Filtering + 1-Click Change Order Undo
const jobWarn = {
  id: 'jm-1',
  workspace_id: wsId,
  entity_id: 'ent-primary',
  job_name: 'Chiller Retrofit',
  client_name: 'Cascade Precision',
  quoted_revenue_cents: 1200000,
  material_po_cents: 460000,
  vendor_bill_cents: 280000,
  labor_cents: 220000, // total cost = 960000 ($9,600), net = 240000 ($2,400), margin = 2000 bps (20.0% < 30.0%)
  target_margin_bps: 3000,
  status: 'margin_warning',
}
const jobHealthy = {
  id: 'jm-2',
  workspace_id: wsId,
  entity_id: 'ent-holdings',
  job_name: 'Bay 4 PM',
  client_name: 'Meridian Logistics',
  quoted_revenue_cents: 850000,
  material_po_cents: 220000,
  vendor_bill_cents: 95000,
  labor_cents: 140000, // total cost = 455000, net = 395000
  target_margin_bps: 3000,
  status: 'healthy',
}

const evalWarn = evaluateJobMargin(jobWarn)
assert.equal(evalWarn.total_cost_cents, 960000)
assert.equal(evalWarn.net_margin_cents, 240000)
assert.equal(evalWarn.actual_margin_bps, 2000)
assert.equal(evalWarn.computed_status, 'margin_warning')
// Restoring >=30% margin on $9,600 cost requires ceil(960000 * 10000 / 7000) = 1371429 -> delta 171429
assert.equal(evalWarn.suggested_change_order_cents, 171429)

const coPlan = buildDraftChangeOrderPlan({
  workspaceId: wsId,
  job: jobWarn,
  nowIso: '2026-11-22T17:00:00Z',
})
assert.equal(coPlan.updated_job.quoted_revenue_cents, 1371429)
assert.equal(coPlan.updated_job.status, 'healthy')
const coUndo = reverseLedgerAction(
  { ...coPlan.ledger_draft, id: 'led-co-1', created_at: '2026-11-22T17:00:00Z' },
  '2026-11-22T17:05:00Z',
)
assert.equal(coUndo.updatedEntry.status, 'reversed')
assert.equal(coUndo.restoredState.quoted_revenue_cents, 1200000)

assert.equal(filterByEntityId([jobWarn, jobHealthy], 'consolidated').length, 2)
assert.equal(filterByEntityId([jobWarn, jobHealthy], 'ent-holdings').length, 1)
assert.equal(evaluateJobMarginPortfolio([jobWarn, jobHealthy], 'ent-primary').warning_count, 1)

// 5. SQL Migration, Route Alias & UI Contracts
const sqlSrc = readSrc('supabase/migrations/20261124000000_release5_complete_moat.sql')
for (const tbl of ['workspace_entities', 'bank_feed_transactions', 'inbound_bill_captures', 'job_margin_records']) {
  assert.ok(sqlSrc.includes(`create table if not exists public.${tbl}`))
}
assert.ok(sqlSrc.includes('public.is_workspace_owner(workspace_id)'))

const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')
assert.equal(parseAppLocation('/dashboard/jobs').section, 'dispatch')

const appShellSrc = readSrc('src/components/shell/AppShell.tsx')
assert.ok(appShellSrc.includes('header-entity-switcher'))
assert.ok(appShellSrc.includes('Consolidated View'))

// 6. JSDOM /demo interactive smoke test on #release-5-sandbox (plus Release 4A CPA $0.00 invariant)
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
function Release5Harness() {
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
        React.createElement(DemoStoreProvider, null, React.createElement(Release5Harness)),
      ),
    )
    await new Promise(r => setTimeout(r, 30))
  })

  const r5Box = w.document.getElementById('release-5-sandbox')
  assert.ok(r5Box, '#release-5-sandbox must render')

  // Entity Switcher
  const holdingsBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Ridgeway Holdings LLC'),
  )
  assert.ok(holdingsBtn)
  await act(async () => {
    holdingsBtn.click()
    await new Promise(r => setTimeout(r, 15))
  })
  assert.equal(demoApi.state.osActiveEntityId, 'ent-demo-holdings')
  const consolidatedBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Consolidated View'),
  )
  await act(async () => {
    consolidatedBtn.click()
    await new Promise(r => setTimeout(r, 15))
  })
  assert.equal(demoApi.state.osActiveEntityId, 'consolidated')

  // Inbox-to-Ledger Capture (Clean & Fraud Spike) -> Post -> 1-Click Undo
  const cleanBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Capture Clean PDF'),
  )
  const spikeBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Capture +33% Spike PDF'),
  )
  assert.ok(cleanBtn && spikeBtn)
  await act(async () => {
    cleanBtn.click()
    spikeBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osInboundBillCaptures.length, 2)

  const postBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Post Matched to Ledger'),
  )
  assert.ok(postBtn)
  await act(async () => {
    postBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osInboundBillLedgerId)

  const undoBillBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo Bill Post'),
  )
  assert.ok(undoBillBtn)
  await act(async () => {
    undoBillBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osInboundBillLedgerId, null)

  // Bank Feed Auto-Reconcile -> Reconcile Matched -> 1-Click Undo
  const bankScanBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Run Bank Feed Auto-Reconcile'),
  )
  assert.ok(bankScanBtn)
  await act(async () => {
    bankScanBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osBankTransactions.length, 3)

  const recBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Reconcile Matched'),
  )
  assert.ok(recBtn)
  await act(async () => {
    recBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osBankReconcileLedgerId)

  const undoBankBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo Bank Recon'),
  )
  assert.ok(undoBankBtn)
  await act(async () => {
    undoBankBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osBankReconcileLedgerId, null)

  // Live Job Margin Tracker -> Draft Change Order -> 1-Click Undo
  const coBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Draft Change Order'),
  )
  assert.ok(coBtn)
  await act(async () => {
    coBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osJobMarginLedgerId)

  const undoJmBtn = Array.from(r5Box.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo Change Order'),
  )
  assert.ok(undoJmBtn)
  await act(async () => {
    undoJmBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osJobMarginLedgerId, null)

  // Release 4A CPA Packet invariant check ($0.00 variance)
  const r4aBox = w.document.getElementById('release-4a-sandbox')
  const cpaBtn = Array.from(r4aBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Generate 1-Click CPA Packet'),
  )
  await act(async () => {
    cpaBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(r4aBox.textContent.includes('Variance: $0.00'))
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Release 5 Complete Technical Moat tests passed')
