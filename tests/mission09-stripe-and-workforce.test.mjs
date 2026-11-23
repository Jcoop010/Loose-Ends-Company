import assert from 'node:assert/strict'
import { createHmac, webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  MAX_DELEGATION_HOPS,
  WORKFORCE_ROLE_POLICIES,
  enqueueWorkforceTask,
  delegateWorkforceTask,
  assertWorkforceToolPermission,
  claimWorkforceTask,
  recordWorkforceTaskUsage,
  recordWorkforceTaskFailure,
  completeWorkforceTask,
} = loadSrcModule('src/lib/workforce/workforceOrchestrator.ts')

// 1. Checkout Edge Function Idempotency & Env Price Override Checks
const checkoutSrc = readSrc('supabase/functions/create-subscription-checkout/index.ts')
assert.match(checkoutSrc, /STRIPE_PRICE_ID_REVENUE_RECOVERY/)
assert.match(checkoutSrc, /Idempotency-Key/)

// 2. Stripe Webhook Refund Recording VM Execution Test
{
  const webhookSrc = readSrc('supabase/functions/stripe-webhook/index.ts')
  const compiled = ts.transpileModule(webhookSrc.replace(/^import .*;?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText

  const secret = 'fixture-refund-secret'
  const wsId = '11111111-1111-4111-8111-111111111111'
  const refundUpserts = []
  const rpcCalls = []
  let handler

  const db = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (name === 'claim_stripe_webhook_event') return { data: 'claimed', error: null }
      return { data: true, error: null }
    },
    from(table) {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          if (table === 'workspace_subscriptions') {
            return { data: { workspace_id: wsId }, error: null }
          }
          return { data: null, error: null }
        },
        async upsert(row, opts) {
          if (table === 'stripe_refund_events') {
            refundUpserts.push({ row, opts })
            return { error: null }
          }
          return { error: null }
        },
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

  const refundEvent = {
    id: 'evt_refund_1',
    type: 'charge.refunded',
    created: 123456,
    livemode: false,
    data: {
      object: {
        id: 'ch_123',
        customer: 'cus_Fixture',
        amount_refunded: 19900,
        currency: 'usd',
        status: 'succeeded',
        refunds: { data: [{ id: 're_456' }] },
      },
    },
  }
  const bodyStr = JSON.stringify(refundEvent)
  const tsNow = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', secret).update(`${tsNow}.${bodyStr}`).digest('hex')

  const res = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { 'Stripe-Signature': `t=${tsNow},v1=${sig}` },
      body: bodyStr,
    }),
  )
  assert.equal(res.status, 200)
  assert.equal(refundUpserts.length, 1)
  assert.equal(refundUpserts[0].opts.onConflict, 'stripe_event_id')
  assert.equal(refundUpserts[0].row.workspace_id, wsId)
  assert.equal(refundUpserts[0].row.charge_id, 'ch_123')
  assert.equal(refundUpserts[0].row.refund_id, 're_456')
  assert.equal(refundUpserts[0].row.amount_refunded_cents, 19900)
  assert.equal(refundUpserts[0].row.refund_status, 'succeeded')
  assert.equal(rpcCalls.at(-1).name, 'finish_stripe_webhook_event')
}

// 3. 10-Role Workforce Orchestrator State Machine Tests
assert.equal(Object.keys(WORKFORCE_ROLE_POLICIES).length, 10)
assert.equal(MAX_DELEGATION_HOPS, 2)

const wsId = '11111111-1111-4111-8111-111111111111'
const nowIso = '2026-11-23T14:00:00Z'
const deadlineIso = '2026-11-23T18:00:00Z'

const { task: rootTask, duplicate: dup1 } = enqueueWorkforceTask({
  existingTasks: [],
  id: 'task-1',
  workspaceId: wsId,
  correlationId: 'corr-1',
  assignedRole: 'ceo_orchestrator',
  title: 'Run Daily AR & Procurement Check',
  expectedOutcome: 'Stage priority invoice reminders & clean POs for owner approval',
  completionTest: 'All subtasks completed with zero integer-cent discrepancies',
  idempotencyKey: 'daily-run-20261123',
  deadlineIso,
  nowIso,
  budgetCents: 200,
  tokenBudget: 10000,
})
assert.equal(dup1, false)
assert.equal(rootTask.requires_human_approval, true)
assert.equal(rootTask.approval_status, 'pending')

// Idempotent re-enqueue returns duplicate: true
const { duplicate: dup2 } = enqueueWorkforceTask({
  existingTasks: [rootTask],
  id: 'task-1b',
  workspaceId: wsId,
  correlationId: 'corr-1',
  assignedRole: 'ceo_orchestrator',
  title: 'Dup',
  expectedOutcome: 'Out',
  completionTest: 'Test',
  idempotencyKey: 'daily-run-20261123',
  deadlineIso,
  nowIso,
})
assert.equal(dup2, true)

// Hop 1 (ceo -> financial_operations) and Hop 2 (financial_operations -> document_processing) succeed; Hop 3 rejected
const hop1 = delegateWorkforceTask({
  parentTask: rootTask,
  childId: 'task-2',
  targetRole: 'financial_operations',
  title: 'Check open PO vs Bill',
  expectedOutcome: 'Verified PO variance <= 10%',
  completionTest: '3-way match output logged',
  idempotencyKey: 'hop-1',
  nowIso,
})
assert.equal(hop1.hop_count, 1)

// Cycle blocked (financial_operations -> ceo_orchestrator already in visited_roles)
assert.throws(
  () =>
    delegateWorkforceTask({
      parentTask: hop1,
      childId: 'task-cycle',
      targetRole: 'ceo_orchestrator',
      title: 'Cycle',
      expectedOutcome: 'x',
      completionTest: 'y',
      idempotencyKey: 'cycle-1',
      nowIso,
    }),
  /cycle/i,
)

const hop2 = delegateWorkforceTask({
  parentTask: hop1,
  childId: 'task-3',
  targetRole: 'document_processing',
  title: 'Extract PDF bill text',
  expectedOutcome: 'Extracted SKU lines',
  completionTest: 'Text confidence >= 75%',
  idempotencyKey: 'hop-2',
  nowIso,
})
assert.equal(hop2.hop_count, 2)

assert.throws(
  () =>
    delegateWorkforceTask({
      parentTask: hop2,
      childId: 'task-hop3',
      targetRole: 'compliance_quality',
      title: 'Overflow',
      expectedOutcome: 'x',
      completionTest: 'y',
      idempotencyKey: 'hop-3',
      nowIso,
    }),
  /max hop cap/i,
)

// Privilege escalation blocked: read-only market_research cannot delegate write work to sales_followup
const { task: mrTask } = enqueueWorkforceTask({
  existingTasks: [],
  id: 'task-mr',
  workspaceId: wsId,
  correlationId: 'corr-2',
  assignedRole: 'market_research',
  title: 'Scout leads',
  expectedOutcome: 'Lead list',
  completionTest: '5 regional leads',
  idempotencyKey: 'mr-1',
  deadlineIso,
  nowIso,
})
assert.throws(
  () =>
    delegateWorkforceTask({
      parentTask: mrTask,
      childId: 'task-esc',
      targetRole: 'sales_followup',
      title: 'Escalate write',
      expectedOutcome: 'x',
      completionTest: 'y',
      idempotencyKey: 'esc-1',
      nowIso,
    }),
  /Privilege escalation blocked/i,
)

// Tool allowlist enforcement
assertWorkforceToolPermission('business_intelligence', 'list_ar_summary')
assert.throws(
  () => assertWorkforceToolPermission('business_intelligence', 'queue_communication_draft'),
  /not permitted/i,
)

// Lease claiming, budget dead-letter, retries & human approval gate
const claimed = claimWorkforceTask(hop2, 'lease-abc', nowIso, 300)
assert.equal(claimed.status, 'leased')
assert.throws(() => claimWorkforceTask(claimed, 'lease-xyz', '2026-11-23T14:01:00Z'), /active lease/i)

const awaiting = completeWorkforceTask(claimed, 'lease-abc', '2026-11-23T14:01:00Z')
assert.equal(awaiting.status, 'awaiting_approval')

const overBudget = recordWorkforceTaskUsage({
  task: claimed,
  addCents: 250,
  addTokens: 500,
  nowIso: '2026-11-23T14:02:00Z',
})
assert.equal(overBudget.status, 'dead_letter')
assert.equal(overBudget.escalated_to, 'owner')

const retryExhausted = recordWorkforceTaskFailure({
  task: { ...claimed, attempts: 3, max_attempts: 3 },
  errorMessage: 'Downstream timeout',
  nowIso: '2026-11-23T14:03:00Z',
})
assert.equal(retryExhausted.status, 'dead_letter')

// 4. UI Honesty Invariants
const panelsSrc = readSrc('src/features/workspaces/bookkeeping-ap/Release5BookkeepingPanels.tsx')
assert.doesNotMatch(panelsSrc, /po-demo-clean|COIL-10|VALVE-42/)
assert.match(panelsSrc, /validateAndExtractBillDocument/)
assert.match(panelsSrc, /fetchWorkspacePoAndReceiptData/)
assert.match(panelsSrc, /No Live Plaid/)

const appShellSrc = readSrc('src/components/shell/AppShell.tsx')
assert.doesNotMatch(appShellSrc, /value="primary"/)
assert.doesNotMatch(appShellSrc, /4821/)
assert.match(appShellSrc, /EIN Unverified/)
assert.match(appShellSrc, /Add Legal Entity/)

const landingSrc = readSrc('src/features/landing/LandingPage.tsx')
assert.doesNotMatch(landingSrc, /QuickBooks Online Sync/)
assert.doesNotMatch(landingSrc, /'QuickBooks &amp; Zoho/)

console.log('Mission 09 Stripe, Workforce & UI honesty tests passed')
