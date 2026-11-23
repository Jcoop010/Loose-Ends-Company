import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  SOP_COMPILER_PRESETS,
  compilePlainEnglishSop,
  simulateCompiledSop,
  executeCompiledSop,
  scanVendorBillsForFraud,
  buildFraudOverridePlan,
  compileOwnerMorningBrief,
  compileFullBusinessPortabilityBundle,
  serializePortabilityBundleToCsv,
  serializePortabilityBundleToJson,
  routeNaturalCommand,
  reverseLedgerAction,
  DEFAULT_AUTONOMY_CONFIG,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

// 1. Air-gap enforcement on pure Release 4B engines, Command Bar, and /demo sandbox files
for (const relPath of [
  'src/lib/autonomousOs/sopCompiler.ts',
  'src/lib/autonomousOs/vendorFraudEngine.ts',
  'src/lib/autonomousOs/morningBriefEngine.ts',
  'src/lib/autonomousOs/enterpriseEngine.ts',
  'src/state/DemoStoreContext.tsx',
  'src/features/demo/AutonomousSandboxPanel.tsx',
  'src/components/shell/CommandBarModal.tsx',
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

// 2. Operations Compiler: all 4 triggers, all 3 presets, safety_cap_cents, Proof Cards & 1-Click Undo
assert.equal(SOP_COMPILER_PRESETS.length, 3)

const todayIso = '2026-11-22'
const sampleBills = [
  {
    id: 'vb-1',
    workspace_id: 'ws-4b',
    po_id: null,
    vendor_name: 'Titan Mechanical Supply',
    invoice_number: 'VB-9048',
    subtotal_cents: 280000,
    tax_cents: 0,
    total_cents: 280000,
    due_date: '2026-12-01',
    items_json: [{ sku: 'VALVE-42', description: 'Brass Control Valve', quantity: 50, unit_cost_cents: 5600 }],
    match_status: 'exception_flagged',
    match_variance_cents: 70000,
    discrepancy_summary: '+33.3% spike',
    created_at: '2026-11-20T10:00:00Z',
  },
  {
    id: 'vb-big',
    workspace_id: 'ws-4b',
    po_id: null,
    vendor_name: 'Mega Steel Co',
    invoice_number: 'VB-9999',
    subtotal_cents: 800000,
    tax_cents: 0,
    total_cents: 800000,
    due_date: '2026-12-03',
    items_json: [],
    match_status: 'disputed',
    match_variance_cents: 350000, // $3,500 variance exceeds $2,500 cap
    discrepancy_summary: 'Above safety cap test',
    created_at: '2026-11-21T10:00:00Z',
  },
]

const sampleInvoices = [
  {
    id: 'inv-past-1',
    workspace_id: 'ws-4b',
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-401',
    title: 'Compressor Retro',
    customer_name: 'Harbor Logistics',
    customer_email: null,
    subtotal_cents: 120000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 120000,
    amount_paid_cents: 0,
    due_date: '2026-11-10',
    status: 'overdue',
    created_at: '2026-11-01T00:00:00Z',
  },
]

const sampleCompliance = [
  {
    id: 'cv-coi-1',
    workspace_id: 'ws-4b',
    doc_type: 'coi',
    title: 'General Liability COI',
    counterparty: 'Vanguard Underwriters',
    expires_on: '2026-12-05',
    notice_window_days: 45,
    annual_value_cents: 1440000,
    status: 'expiring_soon',
    notes: null,
    created_at: '2026-09-01T00:00:00Z',
  },
]

// 2a. vendor_bill_received
const cVendor = compilePlainEnglishSop(SOP_COMPILER_PRESETS[0].prompt)
assert.equal(cVendor.rule.trigger, 'vendor_bill_received')
assert.equal(cVendor.rule.safety_cap_cents, 250000)
const simVendor = simulateCompiledSop(cVendor.rule, {
  sopName: cVendor.name,
  plainEnglishPrompt: cVendor.plain_english_prompt,
  vendorBills: sampleBills,
  asOfDate: todayIso,
})
assert.equal(simVendor.matched_count, 2)
assert.equal(simVendor.within_cap_count, 1)
assert.equal(simVendor.cap_exceeded_count, 1)
assert.equal(simVendor.total_impact_cents, 420000)
assert.equal(simVendor.executable_impact_cents, 70000)
assert.ok(simVendor.proof_cards.every(card => typeof card.proof_summary === 'string' && card.proof_summary.length > 0))

// 2b. cashflow_threshold
const cCash = compilePlainEnglishSop(SOP_COMPILER_PRESETS[1].prompt)
assert.equal(cCash.rule.trigger, 'cashflow_threshold')
assert.equal(cCash.rule.threshold_cents, 1500000)
assert.equal(cCash.rule.safety_cap_cents, 1000000)
const simCash = simulateCompiledSop(cCash.rule, {
  vendorBills: [sampleBills[0]],
  invoices: [],
  startingCashCents: 1000000, // $10k starting -> below $15k floor
  asOfDate: todayIso,
})
assert.ok(simCash.matched_count >= 1)
assert.ok(simCash.proof_cards[0].impact_cents > 0)

// 2c. contract_expiring
const cCoi = compilePlainEnglishSop(SOP_COMPILER_PRESETS[2].prompt)
assert.equal(cCoi.rule.trigger, 'contract_expiring')
assert.equal(cCoi.rule.threshold_days, 30)
assert.equal(cCoi.rule.safety_cap_cents, 2000000)
const simCoi = simulateCompiledSop(cCoi.rule, {
  complianceItems: sampleCompliance,
  asOfDate: todayIso,
})
assert.equal(simCoi.matched_count, 1)
assert.equal(simCoi.within_cap_count, 1)
assert.equal(simCoi.total_impact_cents, 1440000)

// 2d. invoice_overdue + executeCompiledSop + 1-Click Undo
const cAr = compilePlainEnglishSop('Automate: Chase overdue balances over 5 days for invoices >= $500 up to $3,000 cap')
assert.equal(cAr.rule.trigger, 'invoice_overdue')
assert.equal(cAr.rule.threshold_days, 5)
assert.equal(cAr.rule.threshold_cents, 50000)
assert.equal(cAr.rule.safety_cap_cents, 300000)
const simAr = simulateCompiledSop(cAr.rule, {
  invoices: sampleInvoices,
  asOfDate: todayIso,
})
assert.equal(simAr.matched_count, 1)
assert.equal(simAr.total_impact_cents, 120000)

const execRes = executeCompiledSop({
  workspaceId: 'ws-4b',
  sop: {
    id: 'exec-sop-1',
    workspace_id: 'ws-4b',
    name: cAr.name,
    plain_english_prompt: cAr.plain_english_prompt,
    compiled_rule_json: cAr.rule,
    status: 'draft',
    safety_cap_cents: cAr.rule.safety_cap_cents,
    last_simulated_impact_cents: 0,
    run_count: 0,
    created_at: '2026-11-22T10:00:00Z',
  },
  simulation: simAr,
  config: DEFAULT_AUTONOMY_CONFIG,
  nowIso: '2026-11-22T11:00:00Z',
})
assert.equal(execRes.executable_sop.status, 'active')
assert.equal(execRes.executable_sop.run_count, 1)
assert.equal(execRes.ledger_draft.action_type, 'execute_compiled_sop')
const sopUndo = reverseLedgerAction(
  { ...execRes.ledger_draft, id: 'led-sop-1', created_at: '2026-11-22T11:00:00Z' },
  '2026-11-22T11:05:00Z',
)
assert.equal(sopUndo.updatedEntry.status, 'reversed')
assert.equal(sopUndo.restoredState.sop_status, 'draft')

// 3. Vendor Fraud Shield: all 3 freeze rules + 1-Click Undo Override
const fraudScan = scanVendorBillsForFraud({
  workspaceId: 'ws-4b',
  bills: [
    {
      id: 'b-spike',
      workspace_id: 'ws-4b',
      po_id: null,
      vendor_name: 'Titan Mechanical Supply',
      invoice_number: 'VB-9048',
      total_cents: 280000,
      due_date: '2026-12-01',
      items_json: [{ sku: 'VALVE-42', description: 'Valve', quantity: 50, unit_cost_cents: 5600 }],
      match_status: 'exception_flagged',
      match_variance_cents: 70000,
      discrepancy_summary: null,
      remit_account_hint: 'ACH-9988',
      created_at: '2026-11-20T09:00:00Z',
    },
    {
      id: 'b-dup-1',
      workspace_id: 'ws-4b',
      po_id: null,
      vendor_name: 'Metro Courier LLC',
      invoice_number: 'MC-100',
      total_cents: 84500,
      due_date: '2026-12-02',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      discrepancy_summary: null,
      created_at: '2026-11-18T09:00:00Z',
    },
    {
      id: 'b-dup-2',
      workspace_id: 'ws-4b',
      po_id: null,
      vendor_name: 'Metro Courier LLC',
      invoice_number: 'MC-100-B',
      total_cents: 84500,
      due_date: '2026-12-04',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      discrepancy_summary: null,
      created_at: '2026-11-21T09:00:00Z', // 3 days later <= 7d
    },
  ],
  priorUnitCostsBySku: { 'VALVE-42': 4200 },
  knownRemitByVendor: { 'titan mechanical supply': 'ACH-4401' },
  asOfDate: todayIso,
})

assert.equal(fraudScan.counts_by_type.price_spike_over_10pct, 1)
assert.equal(fraudScan.counts_by_type.remit_change, 1)
assert.equal(fraudScan.counts_by_type.duplicate_cent_amount, 1)
assert.equal(fraudScan.frozen_count, 3)
assert.equal(fraudScan.total_frozen_cents, 70000 + 280000 + 84500)

const spikeAlert = fraudScan.alerts.find(a => a.alert_type === 'price_spike_over_10pct')
assert.equal(spikeAlert.variance_cents, 70000)
const overridePlan = buildFraudOverridePlan({
  workspaceId: 'ws-4b',
  alert: spikeAlert,
  nextStatus: 'approved_override',
  nowIso: '2026-11-22T12:00:00Z',
})
assert.equal(overridePlan.updatedAlert.status, 'approved_override')
const fraudUndo = reverseLedgerAction(
  { ...overridePlan.ledgerDraft, id: 'led-fraud-1', created_at: '2026-11-22T12:00:00Z' },
  '2026-11-22T12:05:00Z',
)
assert.equal(fraudUndo.updatedEntry.status, 'reversed')
assert.equal(fraudUndo.restoredState.alert_status, 'frozen')

// 4. Morning Brief + Business Portability JSON/CSV
const brief = compileOwnerMorningBrief({
  workspaceName: 'Ridgeway HVAC',
  ledgerEntries: [
    {
      id: 'le-rev',
      workspace_id: 'ws-4b',
      entry_type: 'revenue',
      category: 'Paid',
      description: 'Settlement',
      amount_cents: 125000,
      occurred_on: '2026-11-21',
      source_ref: 'INV-900',
    },
  ],
  invoices: sampleInvoices,
  vendorBills: [sampleBills[0]],
  fraudAlerts: fraudScan.alerts,
  collectionTouches: [],
  startingCashCents: 2500000,
  safetyBufferCents: 500000,
  asOfDate: '2026-11-22',
})
assert.equal(brief.cash_position_cents, 2625000)
assert.equal(brief.collected_yesterday_cents, 125000)
assert.equal(brief.frozen_fraud_count, 3)
assert.equal(brief.runway_status, 'healthy')

const bundle = compileFullBusinessPortabilityBundle({
  workspaceName: 'Ridgeway HVAC',
  ledgerEntries: [],
  invoices: sampleInvoices,
  vendorBills: sampleBills,
  executableSops: [execRes.executable_sop],
  vendorFraudAlerts: fraudScan.alerts,
  exportedAtIso: '2026-11-22T12:00:00Z',
})
const csv = serializePortabilityBundleToCsv(bundle)
const jsonText = serializePortabilityBundleToJson(bundle)
assert.ok(csv.includes('executable_sops'))
assert.ok(csv.includes('vendor_fraud_alerts'))
assert.equal(JSON.parse(jsonText).record_counts.vendor_fraud_alerts, 3)

// 5. Cmd+K Natural Command Router ("Automate: ...") -> /dashboard/sops?prompt=...
const cmdRoute = routeNaturalCommand('Automate: freeze vendor bills >5% price jump', {
  invoices: sampleInvoices,
  vendorBills: sampleBills,
  ledgerEntries: [],
  complianceItems: sampleCompliance,
  sops: [],
  cashBalanceCents: 2500000,
  safetyBufferCents: 500000,
  referenceDate: todayIso,
})
assert.equal(cmdRoute.intent, 'compile_sop')
assert.ok(cmdRoute.primary_action.route.startsWith('/dashboard/sops?prompt='))

// 6. Static & runtime contracts: /dashboard/settings alias, Portal badge, BYO-Agent MCP Hub (0 secrets), SQL RLS
const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')
assert.equal(
  parseAppLocation('/dashboard/settings').section,
  'autopilot',
  '/dashboard/settings must resolve cleanly to autopilot/settings MCP Hub',
)

const portalSrc = readSrc('src/features/portal/ClientPortalPage.tsx')
assert.ok(portalSrc.includes('Powered by Loose Ends OS'))
assert.ok(portalSrc.includes('https://www.looseendsos.app/demo'))

const mcpHubSrc = readSrc('src/features/workspaces/autopilot-billing/AutopilotBillingPage.tsx')
assert.ok(mcpHubSrc.includes('BYO-Agent MCP Hub'))
assert.ok(mcpHubSrc.includes('v2.5.0 · 29 Tools'))
assert.ok(mcpHubSrc.includes('<YOUR_WORKSPACE_MCP_TOKEN>'))
assert.equal(/\bsb_secret_|\bmcp_live_|\bsk_live_/i.test(mcpHubSrc), false)

const migrationSql = readSrc('supabase/migrations/20261123200000_autonomous_elite_4b.sql')
assert.ok(migrationSql.includes('create table if not exists public.executable_sops'))
assert.ok(migrationSql.includes('create table if not exists public.vendor_fraud_alerts'))
assert.ok(migrationSql.includes("array['executable_sops', 'vendor_fraud_alerts']"))
assert.ok(migrationSql.includes('enable row level security'))
assert.ok(migrationSql.includes('public.is_workspace_owner(workspace_id)'))

// 7. JSDOM interactive smoke test on /demo AutonomousSandboxPanel (#release-4b-sandbox + 4A CPA intact)
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
function Release4BHarness() {
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
        React.createElement(DemoStoreProvider, null, React.createElement(Release4BHarness)),
      ),
    )
    await new Promise(r => setTimeout(r, 30))
  })

  const r4bBox = w.document.getElementById('release-4b-sandbox')
  assert.ok(r4bBox, '#release-4b-sandbox container must render')
  assert.ok(r4bBox.textContent.includes('60-Second Owner Morning Brief'))

  // Operations Compiler: Compile & Dry-Run -> Proof Cards -> Activate & Execute -> 1-Click Undo
  const compileBtn = Array.from(r4bBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Compile & Dry-Run'),
  )
  assert.ok(compileBtn)
  await act(async () => {
    compileBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osSopSimulation.matched_count >= 1)
  assert.ok(r4bBox.textContent.includes('VB-9048'))

  const execBtn = Array.from(r4bBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Activate & Execute'),
  )
  assert.ok(execBtn && !execBtn.disabled)
  await act(async () => {
    execBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osExecutableSops.length, 1)
  assert.ok(demoApi.state.osSopExecutionLedgerId)

  const undoSopBtn = Array.from(r4bBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo SOP Run'),
  )
  assert.ok(undoSopBtn)
  await act(async () => {
    undoSopBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osSopExecutionLedgerId, null)
  assert.equal(demoApi.state.osExecutableSops[0].status, 'draft')

  // Vendor Fraud Shield: Scan -> Approve Override -> 1-Click Undo Override
  const scanBtn = Array.from(r4bBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Run Vendor Fraud Shield'),
  )
  assert.ok(scanBtn)
  await act(async () => {
    scanBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osVendorFraudAlerts.length >= 1)
  assert.ok(r4bBox.textContent.includes('Titan Mechanical Supply'))

  const overrideBtn = Array.from(r4bBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Approve Override'),
  )
  assert.ok(overrideBtn)
  await act(async () => {
    overrideBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(demoApi.state.osFraudOverrideLedgerId)

  const undoFraudBtn = Array.from(r4bBox.querySelectorAll('button')).find(b =>
    b.textContent?.includes('1-Click Undo Override'),
  )
  assert.ok(undoFraudBtn)
  await act(async () => {
    undoFraudBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osFraudOverrideLedgerId, null)
  assert.ok(demoApi.state.osVendorFraudAlerts.every(a => a.status === 'frozen'))

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

console.log('Release 4B Operations Compiler, Vendor Fraud Shield, Morning Brief & BYO-Agent Hub tests passed')
