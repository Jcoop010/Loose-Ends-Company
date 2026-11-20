import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  evaluateComplianceDeadlines,
  normalizeModulesEnabled,
  routeNaturalCommand,
  simulateWhatIfCashflow,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')

// 1. Air-gap verification on Release 3 engines, CommandBarModal & /demo surfaces
for (const relPath of [
  'src/lib/autonomousOs/enterpriseEngine.ts',
  'src/components/shell/CommandBarModal.tsx',
  'src/features/demo/DemoWorkspacePage.tsx',
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

// 2. vault module defaults ON cleanly
assert.equal(normalizeModulesEnabled(undefined).vault, true)

// 3. evaluateComplianceDeadlines: exact notice-window detection, annual spend & pre-staged drafts
const vaultEval = evaluateComplianceDeadlines(
  [
    {
      id: 'cv-1',
      workspace_id: 'ws-r3',
      doc_type: 'saas_renewal',
      title: 'CRM Auto-Renewal',
      counterparty: 'CloudRoute Inc.',
      expires_on: '2026-12-10',
      notice_window_days: 45,
      annual_value_cents: 600000,
      status: 'active',
      notes: null,
    },
    {
      id: 'cv-2',
      workspace_id: 'ws-r3',
      doc_type: 'license',
      title: 'State Operating License',
      counterparty: 'State Dept',
      expires_on: '2027-06-01',
      notice_window_days: 30,
      annual_value_cents: 120000,
      status: 'active',
      notes: null,
    },
  ],
  '2026-11-20',
)

assert.equal(vaultEval.active_docs_count, 2)
assert.equal(vaultEval.expiring_within_window_count, 1)
assert.equal(vaultEval.annual_spend_at_risk_cents, 600000)
assert.equal(vaultEval.annual_spend_protected_cents, 720000)
assert.equal(vaultEval.expiring_items[0].days_remaining, 20)
assert.equal(vaultEval.expiring_items[0].within_notice_window, true)
assert.equal(vaultEval.expiring_items[0].notice_draft.requires_approval, true)
assert.match(vaultEval.expiring_items[0].notice_draft.subject, /CRM Auto-Renewal/)

// 4. simulateWhatIfCashflow: exact integer-cent 30/60/90 projection + safety buffer breach
const simBreach = simulateWhatIfCashflow(2200000, -1000000, 0, 90, {
  safetyBufferCents: 500000,
})
assert.equal(simBreach.windows[0].simulated_balance_cents, 1200000)
assert.equal(simBreach.windows[1].simulated_balance_cents, 200000)
assert.equal(simBreach.windows[1].below_buffer, true)
assert.equal(simBreach.windows[1].buffer_shortfall_cents, 300000)
assert.equal(simBreach.windows[2].simulated_balance_cents, -800000)
assert.equal(simBreach.any_buffer_breach, true)
assert.equal(simBreach.first_breach_horizon_days, 60)
assert.equal(simBreach.net_variance_cents, -3000000)

// 5. routeNaturalCommand: deterministic plain-English resolution across all modules
const cmdSnapshot = {
  invoices: [
    {
      id: 'i-1',
      workspace_id: 'ws-r3',
      quote_id: null,
      lead_id: null,
      customer_id: null,
      invoice_number: 'INV-501',
      title: 'Retainer',
      customer_name: 'Meridian Logistics',
      customer_email: null,
      subtotal_cents: 185000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 185000,
      amount_paid_cents: 0,
      due_date: '2026-11-05',
      stripe_checkout_url: null,
      status: 'overdue',
      created_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'i-2',
      workspace_id: 'ws-r3',
      quote_id: null,
      lead_id: null,
      customer_id: null,
      invoice_number: 'INV-502',
      title: 'Small Add-on',
      customer_name: 'Small Co',
      customer_email: null,
      subtotal_cents: 45000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 45000,
      amount_paid_cents: 0,
      due_date: '2026-11-05',
      stripe_checkout_url: null,
      status: 'overdue',
      created_at: '2026-11-01T00:00:00Z',
    },
  ],
  inventoryItems: [
    {
      id: 's-1',
      workspace_id: 'ws-r3',
      sku: 'VALVE-42',
      name: 'Brass Control Valve',
      location: 'Bay 1',
      bin_code: 'A-1',
      on_hand_qty: 3,
      reserved_qty: 0,
      reorder_point_qty: 10,
      reorder_qty: 20,
      unit_cost_cents: 4200,
      unit_price_cents: 8400,
      preferred_vendor: 'Apex Industrial',
      lead_time_days: 4,
    },
  ],
  complianceItems: [
    {
      id: 'cv-1',
      workspace_id: 'ws-r3',
      doc_type: 'saas_renewal',
      title: 'CRM Auto-Renewal',
      counterparty: 'CloudRoute Inc.',
      expires_on: '2026-12-10',
      notice_window_days: 45,
      annual_value_cents: 600000,
      status: 'active',
      notes: null,
    },
  ],
  sops: [
    {
      id: 'sop-1',
      workspace_id: 'ws-r3',
      module_key: 'quotes',
      title: 'Portal Quote E-Sign',
      trigger_event: 'quote.signed',
      steps_json: ['Step 1', 'Step 2'],
      version: 2,
      auto_generated: true,
      last_observed_at: '2026-11-20T00:00:00Z',
    },
  ],
  ledgerEntries: [
    {
      id: 'led-last',
      workspace_id: 'ws-r3',
      agent_name: 'Revenue Agent',
      module: 'quotes',
      action_type: 'convert_signed_quote_to_invoice',
      autonomy_mode: 'full_auto',
      summary: 'Converted quote QTE-3011 to invoice',
      impact_cents: 45000,
      before_state: { quote_status: 'sent' },
      after_state: { invoice_id: 'inv-new' },
      status: 'executed',
      reversed_at: null,
      created_at: '2026-11-20T10:00:00Z',
    },
  ],
  baselineBalanceCents: 2200000,
  safetyBufferCents: 500000,
  referenceDate: '2026-11-20',
}

const rInv = routeNaturalCommand('overdue invoices over $1000', cmdSnapshot)
assert.equal(rInv.intent, 'overdue_invoices')
assert.equal(rInv.items.length, 1)
assert.equal(rInv.items[0].amount_cents, 185000)

const rSku = routeNaturalCommand('low stock skus', cmdSnapshot)
assert.equal(rSku.intent, 'low_stock_skus')
assert.equal(rSku.items.length, 1)
assert.ok(rSku.items[0].title.includes('VALVE-42'))

const rExp = routeNaturalCommand('expiring contracts', cmdSnapshot)
assert.equal(rExp.intent, 'expiring_compliance')
assert.equal(rExp.items.length, 1)

const rSim = routeNaturalCommand('simulate hiring 2 staff at $5000/mo', cmdSnapshot)
assert.equal(rSim.intent, 'what_if_simulation')
assert.equal(rSim.simulation.monthly_delta_cents, -1000000)
assert.equal(rSim.simulation.first_breach_horizon_days, 60)

const rUndo = routeNaturalCommand('undo last action', cmdSnapshot)
assert.equal(rUndo.intent, 'undo_last_action')
assert.equal(rUndo.primary_action.kind, 'undo_ledger')
assert.equal(rUndo.primary_action.targetId, 'led-last')

// 6. Routing + Air-Gapped /demo JSDOM verification (3 compliance docs, 3 Living SOPs, Cmd+K + 1-Click Undo)
assert.equal(parseAppLocation('/dashboard/vault').section, 'vault')
assert.equal(parseAppLocation('/dashboard/sops').section, 'sops')

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/demo',
})
const w = installDomGlobals(dom)
w.scrollTo = () => {}

const cache = new Map()
const opts = {
  globals: { window: w, document: w.document, history: w.history, KeyboardEvent: w.KeyboardEvent },
  cache,
}
const { ToastProvider } = loadSrcModule('src/components/ui/Toast.tsx', opts)
const { RouterProvider } = loadSrcModule('src/state/RouterContext.tsx', opts)
const { DemoStoreProvider, useDemoStore } = loadSrcModule('src/state/DemoStoreContext.tsx', opts)
const { DemoWorkspacePage } = loadSrcModule('src/features/demo/DemoWorkspacePage.tsx', opts)

let demoApi = null
function DemoHarness() {
  demoApi = useDemoStore()
  return React.createElement(DemoWorkspacePage)
}

const root = createRoot(w.document.getElementById('root'))
try {
  await act(async () => {
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          RouterProvider,
          { initialPath: '/demo/vault' },
          React.createElement(DemoStoreProvider, null, React.createElement(DemoHarness)),
        ),
      ),
    )
    await new Promise(r => setTimeout(r, 30))
  })

  assert.equal(demoApi.state.osComplianceItems.length, 3)
  assert.equal(demoApi.state.osLivingSops.length, 3)
  assert.ok(w.document.body.textContent.includes('Command Bar'))
  assert.ok(w.document.body.textContent.includes('General Liability COI'))

  // Open Command Bar via Cmd+K shortcut
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
  })
  assert.ok(w.document.body.textContent.includes('Global Command Bar & What-If Simulator'))

  // Stage compliance notice in demo & reverse via 1-Click Undo
  await act(async () => {
    demoApi.stageDemoComplianceNotice('cv-demo-saas')
    await new Promise(r => setTimeout(r, 20))
  })
  const stagedDoc = demoApi.state.osComplianceItems.find(d => d.id === 'cv-demo-saas')
  assert.equal(stagedDoc.status, 'notice_staged')
  const ledgerEntry = demoApi.state.osAgentLedger.find(
    e => e.action_type === 'stage_compliance_notice',
  )
  assert.ok(ledgerEntry)
  await act(async () => {
    demoApi.undoDemoLedgerAction(ledgerEntry.id)
    await new Promise(r => setTimeout(r, 20))
  })
  const restoredDoc = demoApi.state.osComplianceItems.find(d => d.id === 'cv-demo-saas')
  assert.equal(restoredDoc.status, 'expiring_soon')
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Release 3 compliance vault, living SOPs, command router, and what-if tests passed')
