import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  analyzeShadowCsv,
  buildShadowPromotionPlan,
  detectShadowSourceSystem,
  loadSampleQuickBooksExport,
  parseMoneyToCents,
  recomputeShadowLeakTotalCents,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')

// 1. Air-gap verification on Shadow Mode engine & UI surfaces
for (const relPath of [
  'src/lib/autonomousOs/shadowEngine.ts',
  'src/features/demo/AutonomousSandboxPanel.tsx',
  'src/state/DemoStoreContext.tsx',
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

// 2. Deterministic integer-cent money parsing (zero float drift)
assert.equal(parseMoneyToCents('$1,240.50'), 124050)
assert.equal(parseMoneyToCents('(425.00)'), -42500)
assert.equal(parseMoneyToCents('-89.99'), -8999)
assert.equal(parseMoneyToCents('1200'), 120000)
assert.equal(parseMoneyToCents('+45.10'), 4510)
assert.equal(parseMoneyToCents('$0.00'), 0)
assert.equal(parseMoneyToCents('-'), 0)
assert.equal(parseMoneyToCents('0.10') + parseMoneyToCents('0.20'), 30)

// 3. Built-in sample QuickBooks dataset surfaces exact $4,850.00 across all 4 categories
const sample = loadSampleQuickBooksExport()
const frozenOpts = Object.freeze({
  workspaceId: 'ws-shadow-test',
  sessionId: 'sess-sample-1',
  fileName: sample.file_name,
  asOfDate: sample.as_of_date,
})
const qboAnalysis = analyzeShadowCsv(sample.csv_text, frozenOpts)
assert.equal(qboAnalysis.source_system, 'quickbooks')
assert.equal(qboAnalysis.row_count, 11)
assert.equal(qboAnalysis.total_leak_cents, 485000, 'Sample QBO export must total exactly $4,850.00 (485000 cents)')
assert.equal(qboAnalysis.by_category_cents.unbilled_quote, 185000)
assert.equal(qboAnalysis.by_category_cents.overdue_ar, 162000)
assert.equal(qboAnalysis.by_category_cents.duplicate_vendor_charge, 84000)
assert.equal(qboAnalysis.by_category_cents.recurring_creep, 54000)
assert.equal(qboAnalysis.findings.length, 4)
for (const finding of qboAnalysis.findings) {
  assert.ok(finding.proof_summary.includes('cents'), `Expected integer-cent proof in: ${finding.proof_summary}`)
  assert.equal(finding.status, 'open')
}

// 4. Auto-column mapping for Zoho Books, Stripe & generic bank CSV exports + zero false positives on clean rows
const zohoCsv = [
  'Type,Reference#,Date,Due Date,Customer/Vendor,Status,Total,Balance Due',
  'Quote,Q-900,2026-11-01,2026-11-30,BlueRidge Roofing,Approved,"$2,150.00","$2,150.00"',
  'Invoice,INV-901,2026-10-01,2026-10-20,TriState Clinic,Overdue,"$950.00","$950.00"',
  'Bill,BILL-200,2026-10-01,2026-10-15,Clean Parts Co,Open,"$400.00","$400.00"',
  'Invoice,INV-902,2026-11-01,2026-12-01,Paid Client Co,Paid,"$500.00","$0.00"',
].join('\n')
assert.equal(detectShadowSourceSystem(['Type', 'Reference#', 'Customer/Vendor', 'Total', 'Balance Due']), 'zoho')
const zohoRes = analyzeShadowCsv(zohoCsv, { asOfDate: '2026-11-22' })
assert.equal(zohoRes.source_system, 'zoho')
assert.equal(zohoRes.total_leak_cents, 310000)
assert.equal(zohoRes.by_category_cents.unbilled_quote, 215000)
assert.equal(zohoRes.by_category_cents.overdue_ar, 95000)
assert.equal(zohoRes.findings.length, 2, 'Zoho Bill & Paid Invoice must NOT produce false positives')

const stripeCsv = [
  'Reporting Category,Charge ID,Created (UTC),Customer Email,Description,Status,Gross,Fee,Net',
  'invoice,in_101,2026-10-10 12:00:00,ap@northstar.example,Monthly Ops Plan,past_due,799.00,0.00,799.00',
  'charge,ch_paid,2026-11-05 14:00:00,paid@ok.example,Retainer,paid,500.00,14.80,485.20',
].join('\n')
const stripeRes = analyzeShadowCsv(stripeCsv, { asOfDate: '2026-11-22' })
assert.equal(stripeRes.source_system, 'stripe')
assert.equal(stripeRes.by_category_cents.overdue_ar, 79900)
assert.equal(stripeRes.findings.length, 1)

const genericBankCsv = [
  'posted_at,vendor,memo,amount,reference',
  '2026-11-02,Fastenal Industrial,Bolt lot duplicate,-125.50,TX-1',
  '2026-11-05,Fastenal Industrial,Bolt lot duplicate,-125.50,TX-2',
  '2026-09-01,FleetGPS SaaS,Monthly fleet tracker,-100.00,TX-3',
  '2026-10-01,FleetGPS SaaS,Monthly fleet tracker,-100.00,TX-4',
  '2026-11-01,FleetGPS SaaS,Monthly fleet tracker,-130.00,TX-5',
].join('\n')
const genericRes = analyzeShadowCsv(genericBankCsv, { asOfDate: '2026-11-22' })
assert.equal(genericRes.source_system, 'generic')
assert.equal(genericRes.by_category_cents.duplicate_vendor_charge, 12550)
assert.equal(genericRes.by_category_cents.recurring_creep, 36000) // +$30/mo * 12 = $360.00
assert.equal(genericRes.total_leak_cents, 48550)

// 5. Read-only safety & reversible promotion plan guarantee
const frozenSession = Object.freeze({
  id: 'sess-sample-1',
  workspace_id: 'ws-shadow-test',
  source_system: 'quickbooks',
  file_name: sample.file_name,
  row_count: qboAnalysis.row_count,
  total_leak_cents: qboAnalysis.total_leak_cents,
  status: 'ready',
})
const frozenFindings = Object.freeze(qboAnalysis.findings.map(f => Object.freeze({ ...f })))
const promoPlan = buildShadowPromotionPlan({
  workspaceId: 'ws-shadow-test',
  session: frozenSession,
  findings: frozenFindings,
  nowIso: '2026-11-22T12:00:00Z',
})
assert.equal(frozenSession.status, 'ready', 'Promotion planner must never mutate input session')
assert.equal(promoPlan.openFindingIds.length, 4)
assert.equal(promoPlan.promotedSession.status, 'promoted')
assert.equal(promoPlan.ledgerDraft.action_type, 'promote_shadow_session')
assert.equal(promoPlan.ledgerDraft.impact_cents, 485000)
assert.equal(promoPlan.ledgerDraft.before_state.session_status, 'ready')
assert.deepEqual(promoPlan.ledgerDraft.before_state.open_finding_ids, promoPlan.openFindingIds)
assert.equal(
  recomputeShadowLeakTotalCents(
    frozenFindings.map((f, idx) => (idx === 0 ? { ...f, status: 'dismissed' } : f)),
  ),
  485000 - frozenFindings[0].amount_cents,
)

// 6. Routing & LandingPage positioning copy assertions
assert.equal(parseAppLocation('/dashboard/shadow').section, 'shadow')
const landingSrc = readSrc('src/features/landing/LandingPage.tsx')
for (const phrase of [
  'The Autonomous Business OS That Pays for Itself Before You Migrate.',
  'Zero Migration Risk',
  'Start in Read-Only Shadow Mode',
  'Zero AI Credit Traps',
  '$199/mo flat, unlimited seats',
  'Zero Black-Box Mistakes',
  'Deterministic cent math + 1-Click Undo',
]) {
  assert.ok(landingSrc.includes(phrase), `LandingPage.tsx missing required positioning copy: ${phrase}`)
}

// 7. Air-gapped /demo AutonomousSandboxPanel interactive Shadow Mode smoke test (Try -> Dismiss -> Promote -> Undo)
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
function ShadowDemoHarness() {
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
        React.createElement(DemoStoreProvider, null, React.createElement(ShadowDemoHarness)),
      ),
    )
    await new Promise(r => setTimeout(r, 30))
  })

  const tryBtn = Array.from(w.document.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Try Shadow Mode (QuickBooks CSV)'),
  )
  assert.ok(tryBtn, 'Try Shadow Mode (QuickBooks CSV) button must render inside /demo sandbox')

  await act(async () => {
    tryBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })

  assert.ok(w.document.body.textContent.includes('$4,850.00'))
  assert.ok(w.document.body.textContent.includes('Shadow Mode Active — Live Books Untouched'))
  assert.ok(w.document.body.textContent.includes('Deterministic Cent Proof'))
  assert.equal(demoApi.state.osShadowFindings.length, 4)

  // Dismiss one finding inside the UI
  const shadowBox = w.document.getElementById('shadow-mode-sandbox')
  const dismissBtn = Array.from(shadowBox.querySelectorAll('button')).find(b =>
    b.textContent?.trim() === 'Dismiss',
  )
  assert.ok(dismissBtn)
  await act(async () => {
    dismissBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osShadowSession.total_leak_cents < 485000)

  // Promote remaining findings, then execute 1-Click Undo
  const promoteBtn = Array.from(shadowBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Promote Clean Records to Live OS'),
  )
  assert.ok(promoteBtn)
  await act(async () => {
    promoteBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osShadowSession.status, 'promoted')
  assert.ok(demoApi.state.osShadowPromotionLedgerId)

  const undoBtn = Array.from(shadowBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo Promotion'),
  )
  assert.ok(undoBtn)
  await act(async () => {
    undoBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osShadowSession.status, 'ready')
  assert.equal(demoApi.state.osShadowPromotionLedgerId, null)
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Shadow Mode engine, QuickBooks/Zoho/Stripe parsers, Landing positioning & /demo tests passed')
