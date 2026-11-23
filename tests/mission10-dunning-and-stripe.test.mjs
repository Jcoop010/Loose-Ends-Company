import assert from 'node:assert/strict'
import { createHmac, webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  computeLateFeeCents,
  DUNNING_STAGE_LABELS,
  evaluateInvoiceDunning,
  selectDunningStageForDaysPastDue,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const wsId = '11111111-1111-4111-8111-111111111111'
const asOfDate = '2026-11-25'

// 1. Deterministic Dunning Stage Classification & Late Fee Integer Math
assert.equal(selectDunningStageForDaysPastDue(-4), null)
assert.equal(selectDunningStageForDaysPastDue(-3), 'pre_due_3d')
assert.equal(selectDunningStageForDaysPastDue(-1), 'pre_due_3d')
assert.equal(selectDunningStageForDaysPastDue(0), null)
assert.equal(selectDunningStageForDaysPastDue(2), null)
assert.equal(selectDunningStageForDaysPastDue(3), 'due_plus_3d')
assert.equal(selectDunningStageForDaysPastDue(13), 'due_plus_3d')
assert.equal(selectDunningStageForDaysPastDue(14), 'overdue_14d')
assert.equal(selectDunningStageForDaysPastDue(29), 'overdue_14d')
assert.equal(selectDunningStageForDaysPastDue(30), 'overdue_30d')
assert.equal(Object.keys(DUNNING_STAGE_LABELS).length, 4)

assert.equal(
  computeLateFeeCents({ balanceDueCents: 100_000, stage: 'pre_due_3d', lateFeeBps: 150 }),
  0,
)
assert.equal(
  computeLateFeeCents({ balanceDueCents: 100_000, stage: 'due_plus_3d', lateFeeBps: 150 }),
  0,
)
assert.equal(
  computeLateFeeCents({ balanceDueCents: 100_000, stage: 'overdue_14d', lateFeeBps: 150 }),
  1500,
)
assert.equal(
  computeLateFeeCents({
    balanceDueCents: 200_000,
    stage: 'overdue_30d',
    lateFeeBps: 250,
    flatLateFeeCents: 2500,
  }),
  7500,
)

const testInvoices = [
  {
    id: 'inv-pre-due',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-501',
    title: 'Upcoming Balance',
    customer_name: 'Oak Street Bakery',
    customer_email: 'ap@oakstreet.invalid',
    subtotal_cents: 80_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 80_000,
    amount_paid_cents: 20_000,
    balance_due_cents: 60_000,
    due_date: '2026-11-27', // -2 days
    stripe_checkout_url: null,
    status: 'partially_paid',
    created_at: '2026-11-15T00:00:00Z',
  },
  {
    id: 'inv-3d',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-502',
    title: 'Past Due +5d',
    customer_name: 'Summit Dental',
    customer_email: 'office@summit.invalid',
    subtotal_cents: 50_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 50_000,
    amount_paid_cents: 0,
    balance_due_cents: 50_000,
    due_date: '2026-11-20', // +5 days
    stripe_checkout_url: 'https://checkout.stripe.com/c/pay/inv502',
    status: 'overdue',
    created_at: '2026-11-05T00:00:00Z',
  },
  {
    id: 'inv-14d',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-503',
    title: 'Overdue +18d',
    customer_name: 'Meridian Logistics',
    customer_email: 'ap@meridian.invalid',
    subtotal_cents: 100_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 100_000,
    amount_paid_cents: 0,
    balance_due_cents: 100_000,
    due_date: '2026-11-07', // +18 days
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-20T00:00:00Z',
  },
  {
    id: 'inv-30d',
    workspace_id: wsId,
    quote_id: null,
    lead_id: null,
    customer_id: null,
    invoice_number: 'INV-504',
    title: 'Overdue +35d',
    customer_name: 'Harbor Logistics',
    customer_email: 'billing@harbor.invalid',
    subtotal_cents: 200_000,
    tax_bps: 0,
    tax_cents: 0,
    total_cents: 200_000,
    amount_paid_cents: 0,
    balance_due_cents: 200_000,
    due_date: '2026-10-21', // +35 days
    stripe_checkout_url: null,
    status: 'overdue',
    created_at: '2026-10-01T00:00:00Z',
  },
]

// Observe mode strictly blocks all staging
const obsRes = evaluateInvoiceDunning({
  workspaceId: wsId,
  invoices: testInvoices,
  botMode: 'observe',
  asOfDate,
  lateFeeBps: 150,
})
assert.equal(obsRes.observe_mode_blocked, true)
assert.equal(obsRes.eligible_count, 4)
assert.equal(obsRes.skipped_observe_mode_count, 4)
assert.equal(obsRes.drafts.length, 0)

// draft_and_approve stages human-approved drafts & deduplicates existing stage events
const draftRes = evaluateInvoiceDunning({
  workspaceId: wsId,
  invoices: testInvoices,
  existingEvents: [
    {
      id: 'dun-existing-1',
      workspace_id: wsId,
      invoice_id: 'inv-3d',
      stage: 'due_plus_3d',
      staged_action_id: 'act-1',
      late_fee_cents: 0,
      status: 'drafted',
      idempotency_key: 'dunning:inv-3d:due_plus_3d',
      drafted_at: '2026-11-24T00:00:00Z',
      sent_at: null,
    },
  ],
  botMode: 'draft_and_approve',
  asOfDate,
  lateFeeBps: 150,
})
assert.equal(draftRes.observe_mode_blocked, false)
assert.equal(draftRes.skipped_already_drafted_count, 1)
assert.equal(draftRes.drafts.length, 3)
assert.ok(draftRes.drafts.every(d => d.autoSendAllowed === false && d.status === 'pending_approval'))
assert.equal(draftRes.drafts[0].stage, 'overdue_30d')
assert.equal(draftRes.drafts[0].late_fee_cents, 3000) // 1.5% of $2,000.00 = $30.00

// 2. Mocked VM Test: create-invoice-payment-link Edge Function
{
  const linkSrc = readSrc('supabase/functions/create-invoice-payment-link/index.ts')
  const compiled = ts.transpileModule(linkSrc.replace(/^import .*;?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText

  const invId = '22222222-2222-4222-8222-222222222222'
  const userId = '33333333-3333-4333-8333-333333333333'
  const stripeCalls = []
  const invoiceUpdates = []
  let mockAuthUser = { id: userId, email: 'owner@example.invalid' }
  let mockMember = { workspace_id: wsId, role: 'owner' }
  let mockInvoice = {
    id: invId,
    workspace_id: wsId,
    invoice_number: 'INV-8801',
    title: 'HVAC System Installation',
    customer_name: 'Summit Dental',
    customer_email: 'office@summitdental.invalid',
    total_cents: 160_000,
    amount_paid_cents: 0,
    balance_due_cents: 160_000,
    deposit_cents: 40_000,
    status: 'sent',
  }

  let handler
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: mockAuthUser },
        error: mockAuthUser ? null : new Error('invalid token'),
      }),
    },
    from(table) {
      let updatePayload = null
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => {
          if (table === 'workspace_members') return { data: mockMember, error: null }
          if (table === 'invoices') return { data: mockInvoice, error: null }
          return { data: null, error: null }
        },
        update(payload) {
          updatePayload = payload
          invoiceUpdates.push({ table, payload: updatePayload })
          return {
            eq() { return this },
          }
        },
      }
    },
  }

  runInNewContext(compiled, {
    Deno: {
      env: {
        get: k =>
          ({
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_ANON_KEY: 'anon-fixture',
            SUPABASE_SERVICE_ROLE_KEY: 'service-fixture',
            STRIPE_SECRET_KEY: 'sk_test_fixture',
          })[k],
      },
      serve: fn => {
        handler = fn
      },
    },
    createClient: () => db,
    Response,
    Request,
    URL,
    URLSearchParams,
    AbortSignal,
    console: { error() {} },
    fetch: async (url, init) => {
      stripeCalls.push({ url: String(url), headers: init.headers, body: init.body.toString() })
      return new Response(
        JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
        { status: 200 },
      )
    },
  })

  // Unauthenticated request -> 401
  const unauthRes = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Origin: 'https://www.looseendsos.app', 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: wsId, invoice_id: invId }),
    }),
  )
  assert.equal(unauthRes.status, 401)

  // Bad origin -> 403
  const badOriginRes = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Authorization: 'Bearer token' },
      body: '{}',
    }),
  )
  assert.equal(badOriginRes.status, 403)

  // Valid deposit link creation -> 200 with card + us_bank_account and Idempotency-Key
  const depRes = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: {
        Origin: 'https://www.looseendsos.app',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-link-deposit-1',
      },
      body: JSON.stringify({ workspace_id: wsId, invoice_id: invId, payment_mode: 'deposit' }),
    }),
  )
  assert.equal(depRes.status, 200)
  const depJson = await depRes.json()
  assert.equal(depJson.amount_cents, 40_000)
  assert.equal(depJson.payment_type, 'deposit')
  assert.deepEqual(depJson.payment_methods, ['card', 'us_bank_account'])
  assert.equal(stripeCalls[0].headers['Idempotency-Key'], 'idem-link-deposit-1')
  const decodedBody = decodeURIComponent(stripeCalls[0].body)
  assert.match(decodedBody, /us_bank_account/)
  assert.match(decodedBody, /unit_amount\]=40000/)
  assert.equal(invoiceUpdates.length, 1)

  // Already paid invoice -> 409 conflict
  mockInvoice = { ...mockInvoice, status: 'paid', balance_due_cents: 0 }
  const paidRes = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: {
        Origin: 'https://www.looseendsos.app',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace_id: wsId, invoice_id: invId }),
    }),
  )
  assert.equal(paidRes.status, 409)
}

// 3. Mocked VM Test: stripe-webhook invoice checkout.session.completed + payment_intent.succeeded
{
  const webhookSrc = readSrc('supabase/functions/stripe-webhook/index.ts')
  const compiled = ts.transpileModule(webhookSrc.replace(/^import .*;?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText

  const secret = 'fixture-invoice-webhook-secret'
  const invId = '22222222-2222-4222-8222-222222222222'
  const rpcCalls = []
  let handler

  const db = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (name === 'claim_stripe_webhook_event') return { data: 'claimed', error: null }
      return { data: true, error: null }
    },
    from() {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: null, error: null } },
      }
    },
  }

  runInNewContext(compiled, {
    Deno: {
      env: {
        get: k =>
          ({
            STRIPE_WEBHOOK_SECRET: secret,
            STRIPE_SECRET_KEY: 'sk_test_fixture',
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
          })[k],
      },
      serve: fn => {
        handler = fn
      },
    },
    createClient: () => db,
    Response,
    Request,
    TextEncoder,
    AbortSignal,
    crypto: webcrypto,
    console: { error() {} },
    fetch: async () => new Response('{}', { status: 200 }),
  })

  const sendSigned = async evt => {
    const body = JSON.stringify(evt)
    const tsNow = Math.floor(Date.now() / 1000)
    const sig = createHmac('sha256', secret).update(`${tsNow}.${body}`).digest('hex')
    return handler(
      new Request('https://example.invalid', {
        method: 'POST',
        headers: { 'Stripe-Signature': `t=${tsNow},v1=${sig}` },
        body,
      }),
    )
  }

  const csRes = await sendSigned({
    id: 'evt_inv_cs_1',
    type: 'checkout.session.completed',
    created: 123456,
    livemode: false,
    data: {
      object: {
        id: 'cs_test_inv_1',
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: 'pi_test_inv_1',
        amount_total: 40_000,
        payment_method_types: ['us_bank_account'],
        metadata: {
          workspace_id: wsId,
          invoice_id: invId,
          payment_type: 'deposit',
        },
      },
    },
  })
  assert.equal(csRes.status, 200)
  const payRpc1 = rpcCalls.find(c => c.name === 'record_invoice_payment_atomic')
  assert.ok(payRpc1, 'checkout.session.completed (payment) must invoke record_invoice_payment_atomic')
  assert.equal(payRpc1.args.p_workspace_id, wsId)
  assert.equal(payRpc1.args.p_invoice_id, invId)
  assert.equal(payRpc1.args.p_amount_cents, 40_000)
  assert.equal(payRpc1.args.p_payment_type, 'deposit')
  assert.equal(payRpc1.args.p_payment_method, 'stripe_ach')
  assert.equal(payRpc1.args.p_stripe_payment_intent_id, 'pi_test_inv_1')
  assert.equal(payRpc1.args.p_idempotency_key, 'stripe:pi_test_inv_1')
  assert.equal(rpcCalls.at(-1).name, 'finish_stripe_webhook_event')

  rpcCalls.length = 0
  const piRes = await sendSigned({
    id: 'evt_inv_pi_2',
    type: 'payment_intent.succeeded',
    created: 123460,
    livemode: false,
    data: {
      object: {
        id: 'pi_test_inv_2',
        amount_received: 120_000,
        payment_method_types: ['card'],
        metadata: {
          workspace_id: wsId,
          invoice_id: invId,
          payment_type: 'final',
        },
      },
    },
  })
  assert.equal(piRes.status, 200)
  const payRpc2 = rpcCalls.find(c => c.name === 'record_invoice_payment_atomic')
  assert.ok(payRpc2, 'payment_intent.succeeded must invoke record_invoice_payment_atomic')
  assert.equal(payRpc2.args.p_amount_cents, 120_000)
  assert.equal(payRpc2.args.p_payment_method, 'stripe_card')
  assert.equal(payRpc2.args.p_payment_type, 'final')
  assert.equal(payRpc2.args.p_idempotency_key, 'stripe:pi_test_inv_2')
}

console.log('PASS: Mission 10 dunning scheduler, payment link edge function, and Stripe invoice webhook sync verified.')
