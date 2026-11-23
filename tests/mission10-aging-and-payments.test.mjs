import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  AGING_BUCKET_ORDER,
  classifyAgingBucket,
  computeArApAgingAndCashflow,
  computeDepositCents,
  computeInvoiceBalanceDueCents,
  diffDaysIsoUtc,
  evaluateEarlyPayVendorDiscounts,
  parseEarlyPayTerms,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const wsId = '11111111-1111-4111-8111-111111111111'
const asOfDate = '2026-11-25'

// 1. Exact aging bucket classification & UTC day boundary checks
assert.deepEqual(AGING_BUCKET_ORDER, [
  'current',
  'days_1_30',
  'days_31_60',
  'days_61_90',
  'days_90_plus',
])
assert.equal(classifyAgingBucket(-5), 'current')
assert.equal(classifyAgingBucket(0), 'current')
assert.equal(classifyAgingBucket(1), 'days_1_30')
assert.equal(classifyAgingBucket(30), 'days_1_30')
assert.equal(classifyAgingBucket(31), 'days_31_60')
assert.equal(classifyAgingBucket(60), 'days_31_60')
assert.equal(classifyAgingBucket(61), 'days_61_90')
assert.equal(classifyAgingBucket(90), 'days_61_90')
assert.equal(classifyAgingBucket(91), 'days_90_plus')
assert.equal(diffDaysIsoUtc('2026-11-20', '2026-11-25'), 5)
assert.equal(diffDaysIsoUtc('2026-11-30', '2026-11-25'), -5)

// 2. Integer-cent deposit and balance_due math (zero floats)
assert.equal(computeDepositCents(160_000, 2500), 40_000)
assert.equal(computeDepositCents(100_001, 5000), 50_001)
assert.equal(
  computeInvoiceBalanceDueCents({
    total_cents: 120_000,
    amount_paid_cents: 30_000,
    balance_due_cents: 90_000,
    status: 'partially_paid',
  }),
  90_000,
)
assert.equal(
  computeInvoiceBalanceDueCents({
    total_cents: 120_000,
    amount_paid_cents: 120_000,
    balance_due_cents: 99_999,
    status: 'paid',
  }),
  0,
)

// 3. Full 5-bucket AR/AP aging, 7/15/30-day cashflow windows, and 2/10 Net 30 discount calculation
const invoices = [
  {
    id: 'inv-current',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-100',
    title: 'Current Filter Contract',
    customer_name: 'Clinic A',
    customer_email: null,
    subtotal_cents: 100_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 100_000,
    amount_paid_cents: 25_000,
    balance_due_cents: 75_000,
    due_date: '2026-12-01', // +6 days from 2026-11-25 (within 7d)
    stripe_checkout_url: null,
    status: 'partially_paid',
    created_at: '2026-11-10T00:00:00Z',
  },
  {
    id: 'inv-1-30',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-101',
    title: '15d Overdue Service',
    customer_name: 'Client B',
    customer_email: null,
    subtotal_cents: 50_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 50_000,
    amount_paid_cents: 0,
    balance_due_cents: 50_000,
    due_date: '2026-11-10', // 15 days past due
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-25T00:00:00Z',
  },
  {
    id: 'inv-31-60',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-102',
    title: '40d Overdue',
    customer_name: 'Client C',
    customer_email: null,
    subtotal_cents: 80_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 80_000,
    amount_paid_cents: 0,
    due_date: '2026-10-16', // 40 days past due
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'inv-61-90',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-103',
    title: '70d Overdue',
    customer_name: 'Client D',
    customer_email: null,
    subtotal_cents: 90_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 90_000,
    amount_paid_cents: 0,
    due_date: '2026-09-16', // 70 days past due
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'inv-90-plus',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-104',
    title: '95d Overdue',
    customer_name: 'Client E',
    customer_email: null,
    subtotal_cents: 110_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 110_000,
    amount_paid_cents: 0,
    due_date: '2026-08-22', // 95 days past due
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'inv-paid-ignored',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-105',
    title: 'Already Settled',
    customer_name: 'Client F',
    customer_email: null,
    subtotal_cents: 99_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 99_000,
    amount_paid_cents: 99_000,
    due_date: '2026-11-01',
    stripe_checkout_url: null,
    status: 'paid',
    created_at: '2026-10-15T00:00:00Z',
  },
]

const vendorBills = [
  {
    id: 'vb-early-pay',
    workspace_id: wsId,
    po_id: null,
    vendor_name: 'Apex Supply',
    invoice_number: 'VB-200',
    subtotal_cents: 100_000,
    tax_cents: 0,
    total_cents: 100_000,
    bill_date: '2026-11-22',
    due_date: '2026-12-22', // +27d (outside 7d & 15d, inside 30d)
    payment_terms_label: '2/10 Net 30',
    items_json: [],
    match_status: 'matched_clean',
    match_variance_cents: 0,
    discrepancy_summary: null,
    created_at: '2026-11-22T00:00:00Z',
  },
  {
    id: 'vb-due-soon',
    workspace_id: wsId,
    po_id: null,
    vendor_name: 'Metro Logistics',
    invoice_number: 'VB-201',
    subtotal_cents: 40_000,
    tax_cents: 0,
    total_cents: 40_000,
    due_date: '2026-11-29', // +4d (inside 7d, 15d, 30d)
    items_json: [],
    match_status: 'unmatched',
    match_variance_cents: 0,
    discrepancy_summary: null,
    created_at: '2026-11-15T00:00:00Z',
  },
  {
    id: 'vb-disputed-held',
    workspace_id: wsId,
    po_id: null,
    vendor_name: 'Frozen Vendor',
    invoice_number: 'VB-202',
    subtotal_cents: 250_000,
    tax_cents: 0,
    total_cents: 250_000,
    due_date: '2026-11-26', // disputed -> counts in AP bucket ledger, held from scheduled AP outflow & early-pay
    items_json: [],
    match_status: 'exception_flagged',
    match_variance_cents: 50_000,
    discrepancy_summary: 'Held by Fraud Shield',
    created_at: '2026-11-20T00:00:00Z',
  },
]

const parsed210 = parseEarlyPayTerms('2/10 Net 30')
assert.deepEqual(parsed210, {
  discountBps: 200,
  discountDays: 10,
  netDays: 30,
  normalizedLabel: '2/10 Net 30',
})

const discounts = evaluateEarlyPayVendorDiscounts(vendorBills, asOfDate)
assert.equal(discounts.length, 1)
assert.equal(discounts[0].discount_cents, 2_000)
assert.equal(discounts[0].net_pay_cents, 98_000)
assert.equal(discounts[0].discount_deadline, '2026-12-02')
assert.equal(discounts[0].days_remaining, 7)
assert.equal(discounts[0].expired, false)
assert.equal(discounts[0].annualized_apr_bps, 3650)

const snap = computeArApAgingAndCashflow({
  invoices,
  vendorBills,
  asOfDate,
  startingCashCents: 1_000_000,
})

assert.equal(snap.total_open_ar_cents, 405_000) // 75k + 50k + 80k + 90k + 110k
assert.equal(snap.total_open_ap_cents, 390_000) // 100k + 40k + 250k
assert.equal(snap.net_working_capital_cents, 15_000)
assert.equal(snap.total_early_pay_savings_cents, 2_000)

assert.equal(snap.buckets[0].ar_cents, 75_000)
assert.equal(snap.buckets[1].ar_cents, 50_000)
assert.equal(snap.buckets[2].ar_cents, 80_000)
assert.equal(snap.buckets[3].ar_cents, 90_000)
assert.equal(snap.buckets[4].ar_cents, 110_000)

// 7d window: expected AR inflow = 330k overdue + 75k due +6d = 405k; outflow = 40k (held bill excluded)
assert.equal(snap.projections[0].horizon_days, 7)
assert.equal(snap.projections[0].expected_inflow_cents, 405_000)
assert.equal(snap.projections[0].scheduled_outflow_cents, 40_000)
assert.equal(snap.projections[0].net_cashflow_cents, 365_000)
assert.equal(snap.projections[0].projected_ending_cash_cents, 1_365_000)

// 30d window: includes Apex VB-200 (+27d) -> outflow = 140k
assert.equal(snap.projections[2].horizon_days, 30)
assert.equal(snap.projections[2].scheduled_outflow_cents, 140_000)
assert.equal(snap.projections[2].net_cashflow_cents, 265_000)
assert.equal(snap.projections[2].projected_ending_cash_cents, 1_265_000)

// 4. Static SQL Migration Verification (20261126000000_mission10_ar_ap_cashflow.sql)
const sql = readSrc('supabase/migrations/20261126000000_mission10_ar_ap_cashflow.sql')
for (const token of [
  'invoice_payments',
  'invoice_dunning_events',
  'balance_due_cents',
  'source_quote_id',
  'deposit_required_bps',
  'deposit_cents',
  'stripe_payment_link_url',
  "'partially_paid'",
  "'dunning_reminder'",
  "'draft_and_approve'",
  'convert_quote_to_invoice_atomic',
  'record_invoice_payment_atomic',
  'stage_invoice_dunning_atomic',
  'set search_path = public, pg_temp',
  'is_workspace_owner(workspace_id)',
  'p_amount_cents > v_balance_before',
  'unique (workspace_id, invoice_id, stage)',
  'unique (workspace_id, idempotency_key)',
  'for update',
]) {
  assert.ok(sql.includes(token), `Mission 10 migration missing expected SQL contract: ${token}`)
}

// 5. Live Workspace Zero-Mock Hygiene & /demo Air-Gap Check
for (const liveUi of [
  'src/features/workspaces/invoices-ar/Mission10CashflowPanels.tsx',
  'src/features/workspaces/invoices-ar/InvoicesArPage.tsx',
  'src/features/workspaces/quotes-esign/QuotesESignPage.tsx',
]) {
  const src = readSrc(liveUi)
  for (const mockLeak of ['Meridian Logistics', 'Summit Dental', 'Oak Street Bakery', 'Ridgeway']) {
    assert.equal(
      src.includes(mockLeak),
      false,
      `${liveUi} must NEVER hardcode sandbox mock record "${mockLeak}"`,
    )
  }
}

const demoPanelSrc = readSrc('src/features/demo/AutonomousSandboxPanel.tsx')
assert.ok(
  demoPanelSrc.includes('id="mission-10-cashflow-sandbox"'),
  'AutonomousSandboxPanel must expose #mission-10-cashflow-sandbox',
)

console.log('PASS: Mission 10 aging engine, cashflow forecast, SQL RPCs, and live UI hygiene verified.')
