import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  computeBookkeepingKpis,
  evaluateStockLevels,
  normalizeAutonomyConfig,
  runThreeWayMatch,
  simulateCashflow90Day,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')

// 1. Air-gap verification on Release 2 engines and demo surfaces
for (const relPath of [
  'src/lib/autonomousOs/inventoryEngine.ts',
  'src/lib/autonomousOs/bookkeepingEngine.ts',
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

// 2. evaluateStockLevels: available_qty, reorder threshold, vendor grouping, Autonomy Dial
const cfgFullAuto = normalizeAutonomyConfig({
  autonomy_rules: { stage_auto_po: 'full_auto' },
  auto_limit_cents: 100000,
})
const stockEval = evaluateStockLevels(
  [
    {
      id: 'sku-1',
      workspace_id: 'ws-r2',
      sku: 'VALVE-42',
      name: 'Brass Control Valve',
      location: 'Bay 1',
      bin_code: 'A-12',
      on_hand_qty: 12,
      reserved_qty: 4,
      reorder_point_qty: 10,
      reorder_qty: 20,
      unit_cost_cents: 4200,
      unit_price_cents: 8400,
      preferred_vendor: 'Apex Industrial',
      lead_time_days: 5,
    },
    {
      id: 'sku-2',
      workspace_id: 'ws-r2',
      sku: 'GASKET-9',
      name: 'High-Temp Gasket',
      location: 'Bay 1',
      bin_code: 'B-04',
      on_hand_qty: 40,
      reserved_qty: 5,
      reorder_point_qty: 15,
      reorder_qty: 50,
      unit_cost_cents: 350,
      unit_price_cents: 900,
      preferred_vendor: 'Apex Industrial',
      lead_time_days: 3,
    },
  ],
  cfgFullAuto,
  { workspaceId: 'ws-r2', todayIso: '2026-11-20' },
)

assert.equal(stockEval.evaluated_items[0].available_qty, 8)
assert.equal(stockEval.evaluated_items[0].is_low_stock, true)
assert.equal(stockEval.evaluated_items[1].available_qty, 35)
assert.equal(stockEval.evaluated_items[1].is_low_stock, false)
assert.equal(stockEval.total_low_stock_count, 1)
assert.equal(stockEval.auto_po_drafts.length, 1)
assert.equal(stockEval.auto_po_drafts[0].vendor_name, 'Apex Industrial')
assert.equal(stockEval.auto_po_drafts[0].total_cents, 20 * 4200)
assert.equal(stockEval.auto_po_drafts[0].status, 'sent')
assert.equal(stockEval.auto_po_drafts[0].ledger_draft.impact_cents, 84000)

// 3. runThreeWayMatch: clean match, tolerance, demo short-shipment + price hike ($1,240.00), damaged, duplicate
const cleanMatch = runThreeWayMatch(
  [{ sku: 'VALVE-42', ordered_qty: 50, unit_cost_cents: 4200 }],
  [{ sku: 'VALVE-42', ordered_qty: 50, received_qty: 50, damaged_qty: 0 }],
  [{ sku: 'VALVE-42', quantity: 50, unit_cost_cents: 4200 }],
  200,
)
assert.equal(cleanMatch.match_status, 'matched_clean')
assert.equal(cleanMatch.match_variance_cents, 0)
assert.equal(cleanMatch.vendor_dispute_draft, null)

const demoVarianceMatch = runThreeWayMatch(
  [{ sku: 'VALVE-42', ordered_qty: 100, unit_cost_cents: 4200 }],
  [{ sku: 'VALVE-42', ordered_qty: 100, received_qty: 80, damaged_qty: 0 }],
  [{ sku: 'VALVE-42', quantity: 100, unit_cost_cents: 4600 }],
  200,
  {
    poNumber: 'PO-4088',
    vendorName: 'Apex Industrial Supply',
    invoiceNumber: 'VB-9042',
  },
)
assert.equal(demoVarianceMatch.match_status, 'exception_flagged')
assert.equal(demoVarianceMatch.po_total_cents, 420000)
assert.equal(demoVarianceMatch.received_payable_cents, 336000)
assert.equal(demoVarianceMatch.billed_total_cents, 460000)
assert.equal(demoVarianceMatch.match_variance_cents, 124000)
assert.ok(demoVarianceMatch.exceptions.some(e => e.code === 'short_shipment'))
assert.ok(demoVarianceMatch.exceptions.some(e => e.code === 'unit_price_hike'))
assert.equal(demoVarianceMatch.vendor_dispute_draft.requires_approval, true)
assert.equal(demoVarianceMatch.vendor_dispute_draft.disputed_amount_cents, 124000)
assert.match(demoVarianceMatch.vendor_dispute_draft.subject, /VB-9042/)
assert.match(demoVarianceMatch.vendor_dispute_draft.body_markdown, /PO-4088/)

const dupAndDamageMatch = runThreeWayMatch(
  [{ sku: 'PIPE-8', ordered_qty: 10, unit_cost_cents: 1000 }],
  [{ sku: 'PIPE-8', ordered_qty: 10, received_qty: 10, damaged_qty: 2 }],
  [{ sku: 'PIPE-8', quantity: 10, unit_cost_cents: 1000 }],
  200,
  {
    invoiceNumber: 'DUP-100',
    existingInvoiceNumbers: ['dup-100'],
  },
)
assert.equal(dupAndDamageMatch.match_status, 'exception_flagged')
assert.ok(dupAndDamageMatch.exceptions.some(e => e.code === 'duplicate_invoice'))
assert.ok(dupAndDamageMatch.exceptions.some(e => e.code === 'damaged_goods'))

// 4. simulateCashflow90Day & computeBookkeepingKpis
const cashflow = simulateCashflow90Day(
  400000,
  [
    {
      id: 'inv-1',
      workspace_id: 'ws-r2',
      quote_id: null,
      lead_id: null,
      customer_id: null,
      invoice_number: 'INV-1',
      title: 'Retainer',
      customer_name: 'Client A',
      customer_email: null,
      subtotal_cents: 200000,
      tax_bps: 0,
      tax_cents: 0,
      total_cents: 200000,
      amount_paid_cents: 0,
      due_date: '2026-12-05',
      stripe_checkout_url: null,
      status: 'sent',
      created_at: '2026-11-20T00:00:00Z',
    },
  ],
  [
    {
      id: 'vb-clean',
      workspace_id: 'ws-r2',
      po_id: null,
      vendor_name: 'Vendor Clean',
      invoice_number: 'VB-1',
      subtotal_cents: 350000,
      tax_cents: 0,
      total_cents: 350000,
      due_date: '2026-12-28',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      discrepancy_summary: null,
      created_at: '2026-11-20T00:00:00Z',
    },
    {
      id: 'vb-disputed',
      workspace_id: 'ws-r2',
      po_id: null,
      vendor_name: 'Vendor Disputed',
      invoice_number: 'VB-2',
      subtotal_cents: 460000,
      tax_cents: 0,
      total_cents: 460000,
      due_date: '2026-12-10',
      items_json: [],
      match_status: 'disputed',
      match_variance_cents: 124000,
      discrepancy_summary: 'Variance held',
      created_at: '2026-11-20T00:00:00Z',
    },
  ],
  { asOfDate: '2026-11-20', safetyBufferCents: 300000 },
)

assert.equal(cashflow.windows[0].ending_balance_cents, 600000)
assert.equal(cashflow.windows[1].ending_balance_cents, 250000)
assert.equal(cashflow.windows[1].below_buffer, true)
assert.equal(cashflow.windows[1].buffer_shortfall_cents, 50000)
assert.equal(cashflow.held_disputed_ap_cents, 460000)
assert.equal(cashflow.any_buffer_breach, true)
assert.equal(cashflow.first_breach_horizon_days, 60)

const bkKpis = computeBookkeepingKpis(
  [
    {
      id: 'l1',
      workspace_id: 'ws-r2',
      entry_type: 'revenue',
      category: 'Sales',
      description: 'Retainer',
      amount_cents: 900000,
      occurred_on: '2026-11-20',
      source_ref: null,
    },
    {
      id: 'l2',
      workspace_id: 'ws-r2',
      entry_type: 'cogs',
      category: 'Inventory',
      description: 'Stock',
      amount_cents: 250000,
      occurred_on: '2026-11-20',
      source_ref: null,
    },
  ],
  [
    {
      id: 'vb-1',
      workspace_id: 'ws-r2',
      po_id: null,
      vendor_name: 'Vendor Clean',
      invoice_number: 'VB-1',
      subtotal_cents: 350000,
      tax_cents: 0,
      total_cents: 350000,
      due_date: '2026-12-28',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      discrepancy_summary: null,
      created_at: '2026-11-20T00:00:00Z',
    },
    {
      id: 'vb-2',
      workspace_id: 'ws-r2',
      po_id: null,
      vendor_name: 'Vendor Disputed',
      invoice_number: 'VB-2',
      subtotal_cents: 460000,
      tax_cents: 0,
      total_cents: 460000,
      due_date: '2026-12-10',
      items_json: [],
      match_status: 'disputed',
      match_variance_cents: 124000,
      discrepancy_summary: 'Variance held',
      created_at: '2026-11-20T00:00:00Z',
    },
  ],
)
assert.equal(bkKpis.net_cashflow_cents, 650000)
assert.equal(bkKpis.auto_matched_bills_count, 1)
assert.equal(bkKpis.disputed_saved_cents, 124000)

// 5. Routing + Left-Rail Module Gating + Air-Gapped Demo 3-Way Match Simulation & Undo
assert.equal(parseAppLocation('/dashboard/inventory').section, 'inventory')
assert.equal(parseAppLocation('/dashboard/bookkeeping').section, 'bookkeeping')

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/demo',
})
const w = installDomGlobals(dom)
w.scrollTo = () => {}

const cache = new Map()
const opts = {
  globals: { window: w, document: w.document, history: w.history },
  cache,
}
const { ToastProvider } = loadSrcModule('src/components/ui/Toast.tsx', opts)
const { RouterProvider } = loadSrcModule('src/state/RouterContext.tsx', opts)
const { DemoStoreProvider, useDemoStore } = loadSrcModule('src/state/DemoStoreContext.tsx', opts)
const { AutonomousSandboxPanel } = loadSrcModule('src/features/demo/AutonomousSandboxPanel.tsx', opts)

let demoApi = null
function Probe() {
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
        React.createElement(
          RouterProvider,
          { initialPath: '/demo' },
          React.createElement(DemoStoreProvider, null, React.createElement(Probe)),
        ),
      ),
    )
    await new Promise(r => setTimeout(r, 20))
  })

  assert.ok(w.document.body.textContent.includes('Simulate Short-Shipment 3-Way Match'))
  let simOut = null
  await act(async () => {
    simOut = demoApi.simulateShortShipmentThreeWayMatch()
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(simOut.match_result.match_variance_cents, 124000)
  assert.ok(w.document.body.textContent.includes('$1,240.00'))

  await act(async () => {
    demoApi.undoDemoLedgerAction(simOut.ledger_entry_id)
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(demoApi.state.osThreeWaySimulation, null)
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Release 2 inventory, 3-way match, bookkeeping cashflow, and demo tests passed')
