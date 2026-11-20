import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  calculateLineTotals,
  computeArSummary,
  convertSignedQuoteToInvoice,
  evaluateAutonomyGate,
  formatCents,
  normalizeAutonomyConfig,
  reverseLedgerAction,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')
const { createInitialDemoState } = loadSrcModule('src/state/DemoStoreContext.tsx')

// 1. Air-gap enforcement on pure autonomous OS core + demo panel
for (const relPath of [
  'src/lib/autonomousOs/types.ts',
  'src/lib/autonomousOs/engine.ts',
  'src/lib/autonomousOs/index.ts',
  'src/features/demo/AutonomousSandboxPanel.tsx',
]) {
  const raw = readSrc(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.equal(
    /supabase|edgeFunctions|opsCommand|queries/.test(raw),
    false,
    `${relPath} must stay air-gapped with zero network SDK references`,
  )
}

// 2. calculateLineTotals: exact integer-cent math + half-up bps rounding + guards
const exactTotals = calculateLineTotals(
  [
    { description: 'Agency Retainer', quantity: 2, unit_price_cents: 12500 },
    { description: 'Portal Onboarding', quantity: 1, unit_price_cents: 9999 },
  ],
  825, // 8.25%
)
assert.equal(exactTotals.subtotal_cents, 34999)
// Math.floor((34999 * 825 + 5000) / 10000) = Math.floor(28879175 / 10000) = 2887
assert.equal(exactTotals.tax_cents, 2887)
assert.equal(exactTotals.total_cents, 37886)
assert.equal(exactTotals.items[0].line_total_cents, 25000)
assert.equal(exactTotals.items[1].line_total_cents, 9999)

assert.throws(() => calculateLineTotals([], 0), /At least one line item/)
assert.throws(
  () => calculateLineTotals([{ description: 'Bad', quantity: 1.5, unit_price_cents: 100 }], 0),
  /positive safe integer/,
)
assert.throws(
  () => calculateLineTotals([{ description: 'Bad', quantity: 1, unit_price_cents: 12.34 }], 0),
  /non-negative safe integer/,
)
assert.throws(
  () => calculateLineTotals([{ description: 'Ok', quantity: 1, unit_price_cents: 100 }], 5001),
  /taxBps/,
)

// 3. evaluateAutonomyGate across manual, approve_1tap, full_auto & auto_limit_cents
const config = normalizeAutonomyConfig({
  autonomy_rules: {
    convert_signed_quote_to_invoice: 'full_auto',
    send_quote_followup: 'approve_1tap',
    send_invoice_reminder: 'manual',
    flag_overdue_ar: 'full_auto',
  },
  auto_limit_cents: 50000,
})
assert.equal(evaluateAutonomyGate('convert_signed_quote_to_invoice', 50000, config), 'execute_now')
assert.equal(evaluateAutonomyGate('convert_signed_quote_to_invoice', 50001, config), 'queue_for_approval')
assert.equal(evaluateAutonomyGate('send_quote_followup', 10000, config), 'queue_for_approval')
assert.equal(evaluateAutonomyGate('send_invoice_reminder', 10000, config), 'manual_only')
assert.throws(
  () => evaluateAutonomyGate('convert_signed_quote_to_invoice', 99.5, config),
  /non-negative safe integer/,
)

// 4. convertSignedQuoteToInvoice + reverseLedgerAction deterministic lifecycle
const sampleQuote = {
  id: 'quote-1',
  workspace_id: 'ws-1',
  lead_id: null,
  customer_id: null,
  quote_number: 'QTE-8801',
  title: 'Wholesale Portal Automation',
  customer_name: 'Harborline Goods',
  customer_email: 'ap@harborline.invalid',
  subtotal_cents: 34999,
  tax_bps: 825,
  tax_cents: 2887,
  total_cents: 37886,
  status: 'sent',
  portal_token: 'qpt_testtoken123',
  signed_by_name: null,
  signed_at: null,
  valid_until: '2026-12-01',
  notes: null,
  created_at: '2026-11-20T09:00:00Z',
}

assert.throws(
  () =>
    convertSignedQuoteToInvoice(sampleQuote, [
      { position: 0, description: 'Agency Retainer', quantity: 2, unit_price_cents: 12500, line_total_cents: 25000 },
    ]),
  /expected "signed"/,
)

const converted = convertSignedQuoteToInvoice(
  {
    ...sampleQuote,
    status: 'signed',
    signed_by_name: 'Jordan Taylor',
    signed_at: '2026-11-20T10:00:00Z',
  },
  [
    { position: 0, description: 'Agency Retainer', quantity: 2, unit_price_cents: 12500, line_total_cents: 25000 },
    { position: 1, description: 'Portal Onboarding', quantity: 1, unit_price_cents: 9999, line_total_cents: 9999 },
  ],
  { nowIso: '2026-11-20T10:00:00Z' },
)

assert.equal(converted.invoice.invoice_number, 'INV-8801')
assert.equal(converted.invoice.total_cents, 37886)
assert.equal(converted.invoice.tax_cents, 2887)
assert.equal(converted.invoiceItems.length, 2)
assert.equal(converted.ledgerEntry.status, 'executed')
assert.equal(converted.ledgerEntry.impact_cents, 37886)

const reversed = reverseLedgerAction(converted.ledgerEntry, '2026-11-20T10:05:00Z')
assert.equal(reversed.updatedEntry.status, 'reversed')
assert.equal(reversed.updatedEntry.reversed_at, '2026-11-20T10:05:00Z')
assert.equal(reversed.restoredState.quote_id, 'quote-1')
assert.equal(reversed.restoredState.invoice_id, null)
assert.throws(() => reverseLedgerAction(reversed.updatedEntry), /Only executed ledger actions/)

// 5. computeArSummary & formatCents
const arSummary = computeArSummary(
  [
    { ...converted.invoice, id: 'i1', status: 'paid', amount_paid_cents: 37886, due_date: '2026-11-01' },
    { ...converted.invoice, id: 'i2', status: 'overdue', total_cents: 65000, amount_paid_cents: 0, due_date: '2026-11-05' },
    { ...converted.invoice, id: 'i3', status: 'sent', total_cents: 20000, amount_paid_cents: 5000, due_date: '2026-12-15' },
    { ...converted.invoice, id: 'i4', status: 'void', total_cents: 99900, amount_paid_cents: 0, due_date: '2026-11-01' },
  ],
  '2026-11-20',
)
assert.equal(arSummary.totalBilledCents, 37886 + 65000 + 20000)
assert.equal(arSummary.totalCollectedCents, 37886 + 5000)
assert.equal(arSummary.openArCents, 65000 + 15000)
assert.equal(arSummary.overdueArCents, 65000)
assert.equal(formatCents(37886), '$378.86')

// 6. Routing & air-gapped Demo seed verification
const portalRoute = parseAppLocation('/portal/qpt_test_123')
assert.equal(portalRoute.topRoute, 'portal')
assert.equal(portalRoute.portalToken, 'qpt_test_123')
assert.equal(parseAppLocation('/dashboard/quotes').section, 'quotes')
assert.equal(parseAppLocation('/dashboard/invoices').section, 'invoices')
assert.equal(parseAppLocation('/dashboard/autonomy').section, 'autonomy')

const demoInit = createInitialDemoState(Date.parse('2026-11-20T10:00:00Z'))
assert.ok(demoInit.osQuotes.length >= 3)
assert.ok(demoInit.osInvoices.length >= 2)
assert.ok(demoInit.osAgentLedger.length >= 1)
assert.equal(demoInit.osAutonomyConfig.auto_limit_cents, 50000)

console.log('Autonomous OS deterministic engine, portal routing, and demo tests passed')
