import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHmac } from 'node:crypto';
import ts from 'typescript';

function load(name, createClient = () => { throw new Error('Unexpected database access'); }) {
  const source = fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, Response, Request, URL, console,
    createClient, Deno: { env: { get: () => 'test-only' }, serve: (handler) => { context.handler = handler; } },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}

for (const name of ['bootstrap-workspace', 'create-subscription-checkout', 'create-billing-portal', 'workflow-runner', 'quickbooks-sync']) {
  test(`${name}: reject foreign origin before database access`, async () => {
    const context = load(name);
    const response = await context.handler(new Request('https://example.test', { method: 'POST', headers: { Origin: 'https://attacker.example' } }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });
  test(`${name}: canonical preflight succeeds without privileged work`, async () => {
    const context = load(name);
    const response = await context.handler(new Request('https://example.test', { method: 'OPTIONS', headers: { Origin: 'https://loose-ends-os.vercel.app' } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://loose-ends-os.vercel.app');
  });
}

test('workflow conditions fail closed for unsupported operators', () => {
  const context = load('workflow-runner');
  assert.equal(context.matches({ amount: 100 }, [{ field: 'amount', operator: 'typo', value: 0 }]), false);
  assert.equal(context.matches({ amount: 100 }, [{ field: 'amount', operator: 'gt', value: 50 }]), true);
});

function signedRequest(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'test-only').update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://example.test', { method: 'POST', body,
    headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` } });
}

for (const status of ['failed', 'blocked', 'completed']) {
  test(`workflow UI surfaces ${status} batch outcome`, async () => {
    let rendered = '';
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: [], error: null }) };
    const client = { auth: {
      getUser: async () => ({ data: { user: { id: 'user-test' } } }),
      getSession: async () => ({ data: { session: { access_token: 'test-only' } } }),
    }, from: () => chain };
    const window = { LESupabase: client, __LOOSE_ENDS_SUPABASE_URL__: 'https://example.test', LE: { getState: () => ({ workspaceId: 'workspace-test' }) } };
    const context = vm.createContext({ window, fetch: async () => ({ ok: true, json: async () => ({ results: [{ status }] }) }),
      document: { readyState: 'loading', addEventListener() {},
        querySelector: () => ({ appendChild: (box) => { rendered = box.innerHTML; } }),
        getElementById: (id) => id === 'workflowCenter' ? null : {},
        createElement: () => ({ querySelectorAll: () => [] }),
      } });
    vm.runInContext(fs.readFileSync('v3.1/workflow-engine.js', 'utf8'), context);
    await window.LEWorkflows.pump();
    assert.equal(rendered.includes('Automation runner needs attention'), status !== 'completed');
  });
}

test('Stripe workspace lookup failure returns retryable error without entitlement writes', async () => {
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return { insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) };
    assert.equal(table, 'workspace_subscriptions');
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'mapping unavailable' } }) }) }) };
  } }));
  const response = await context.handler(signedRequest({ id: 'evt_test', type: 'customer.subscription.updated', data: { object: { id: 'sub_test', customer: 'cus_test' } } }));
  assert.equal(response.status, 500);
});

test('Stripe malformed signed event is rejected before database access', async () => {
  const context = load('stripe-webhook');
  assert.equal((await context.handler(signedRequest(null))).status, 400);
});

for (const lookup of [{ data: null, error: { message: 'database unavailable' } }, { data: null, error: null }]) {
  test('Stripe duplicate requires a confirmed ledger row before reprocessing', async () => {
    const context = load('stripe-webhook', () => ({ from: () => ({
      insert: async () => ({ error: { code: '23505' } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => lookup }) }),
    }) }));
    assert.equal((await context.handler(signedRequest({ id: 'evt_test', type: 'unhandled.test', data: { object: {} } }))).status, 500);
  });
}

test('Stripe completed duplicate is acknowledged without entitlement writes', async () => {
  const context = load('stripe-webhook', () => ({ from: (table) => {
    assert.equal(table, 'stripe_webhook_events');
    return { insert: async () => ({ error: { code: '23505' } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { processed_at: '2026-10-14' }, error: null }) }) }) };
  } }));
  const response = await context.handler(signedRequest({ id: 'evt_test', type: 'checkout.session.completed', data: { object: { mode: 'subscription' } } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
});

test('Stripe one-time checkout cannot modify subscription entitlements', async () => {
  const context = load('stripe-webhook', () => ({ from: (table) => {
    assert.equal(table, 'stripe_webhook_events');
    return { insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) };
  } }));
  const response = await context.handler(signedRequest({ id: 'evt_test', type: 'checkout.session.completed', data: { object: { mode: 'payment', customer: 'cus_test', metadata: { workspace_id: 'workspace-test' } } } }));
  assert.equal(response.status, 200);
});

for (const runStatus of ['failed', 'running', 'pending', 'completed', 'waiting_approval']) {
  test(`workflow duplicate ${runStatus}: never repeat actions and retain unresolved event`, async () => {
    let clientCount = 0;
    let eventMarked = false;
    const query = (response) => {
      const chain = { select: () => chain, eq: () => chain, is: () => chain,
        order: () => chain, limit: () => chain, maybeSingle: async () => response,
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject) };
      return chain;
    };
    const context = load('workflow-runner', () => {
      clientCount++;
      if (clientCount === 1) return {
        auth: { getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }) },
        from: (table) => { assert.equal(table, 'workspace_members'); return query({ data: { workspace_id: 'workspace-test' }, error: null }); },
      };
      return { from: (table) => {
        if (table === 'workflow_events') {
          const chain = query({ data: [{ id: 'event-test', event_type: 'insert:customers', entity_type: 'customers', payload: { record: { id: 'customer-test' } } }], error: null });
          chain.update = () => { eventMarked = true; return query({ error: null }); };
          return chain;
        }
        if (table === 'workflows') return query({ data: [{ id: 'workflow-test', trigger_type: 'record_created', trigger_config: { entity_type: 'customers' }, conditions: [], mode: 'automatic' }], error: null });
        if (table === 'workflow_runs') return query({ data: { id: 'run-test', status: runStatus }, error: null });
        throw new Error(`Unexpected action write to ${table}`);
      } };
    });
    const response = await context.handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: JSON.stringify({ workspace_id: 'workspace-test' }) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    const settled = ['completed', 'waiting_approval'].includes(runStatus);
    assert.equal(eventMarked, settled);
    assert.equal(body.results[0].status, settled ? 'duplicate' : 'blocked');
  });
}

test('workflow rejects foreign workspace before creating privileged client', async () => {
  let clientCount = 0;
  const chain = { select: () => chain, eq: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
  const context = load('workflow-runner', () => {
    clientCount++;
    assert.equal(clientCount, 1);
    return { auth: { getUser: async () => ({ data: { user: { id: 'user-test' } }, error: null }) }, from: () => chain };
  });
  const response = await context.handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: JSON.stringify({ workspace_id: 'foreign-workspace' }) }));
  assert.equal(response.status, 403);
  assert.equal(clientCount, 1);
});

test('Stripe signatures reject tampered and expired payloads and accept rotated secrets', async () => {
  const context = load('stripe-webhook');
  const timestamp = Math.floor(Date.now() / 1000);
  const body = '{"id":"evt_test"}';
  const signature = createHmac('sha256', 'test-secret').update(`${timestamp}.${body}`).digest('hex');
  assert.equal(await context.verifyStripeSignature(body, `t=${timestamp},v1=invalid,v1=${signature}`, 'test-secret'), true);
  assert.equal(await context.verifyStripeSignature(body + ' ', `t=${timestamp},v1=${signature}`, 'test-secret'), false);
  const oldTime = timestamp - 600;
  const oldSignature = createHmac('sha256', 'test-secret').update(`${oldTime}.${body}`).digest('hex');
  assert.equal(await context.verifyStripeSignature(body, `t=${oldTime},v1=${oldSignature}`, 'test-secret'), false);
});

test('Stripe returns retryable failure if completion ledger write fails', async () => {
  const writes = [];
  const context = load('stripe-webhook', () => ({ from: (table) => {
    assert.equal(table, 'stripe_webhook_events');
    return {
      insert: async () => ({ error: null }),
      update: (patch) => ({ eq: async () => { writes.push(patch); return { error: patch.processed_at ? new Error('ledger unavailable') : null }; } }),
    };
  } }));
  const body = JSON.stringify({ id: 'evt_test', type: 'unhandled.test', data: { object: {} } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'test-only').update(`${timestamp}.${body}`).digest('hex');
  const response = await context.handler(new Request('https://example.test', { method: 'POST', body, headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` } }));
  assert.equal(response.status, 500);
  assert.equal(writes.length, 2);
});

test('workflow runner requires authorization before constructing a database client', async () => {
  const context = load('workflow-runner');
  const response = await context.handler(new Request('https://example.test', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: 'workspace-test' }),
  }));
  assert.equal(response.status, 401);
});

test('Stripe rejects missing signature before constructing a privileged client', async () => {
  const context = load('stripe-webhook');
  const response = await context.handler(new Request('https://example.test', {
    method: 'POST',
    body: JSON.stringify({ id: 'evt_test', type: 'invoice.paid', data: { object: {} } }),
  }));
  assert.equal(response.status, 400);
});

test('workflow approval rejects a non-admin before any run state change', async () => {
  let clients = 0;
  const query = (value) => {
    const chain = { select: () => chain, eq: () => chain,
      limit: () => chain, maybeSingle: async () => ({ data: value, error: null }) };
    return chain;
  };
  const context = load('workflow-runner', () => {
    clients++;
    if (clients === 1) return {
      auth: { getUser: async () => ({ data: { user: { id: 'member-user' } }, error: null }) },
      from: (table) => {
        assert.equal(table, 'workspace_members');
        return query({ workspace_id: 'workspace-test' });
      },
    };
    return { from: (table) => {
      assert.equal(table, 'workspace_members');
      return query({ role: 'member' });
    } };
  });
  const response = await context.handler(new Request('https://example.test', {
    method: 'POST', headers: { Authorization: 'Bearer test-only' },
    body: JSON.stringify({ workspace_id: 'workspace-test', approve_run_id: 'run-test' }),
  }));
  assert.equal(response.status, 403);
  assert.equal(clients, 2);
});

test('numeric workflow conditions reject missing, empty, and nonnumeric fields', () => {
  const { matches } = load('workflow-runner');
  for (const operator of ['gt', 'gte', 'lt', 'lte']) {
    for (const value of [undefined, null, '', 'not-a-number']) {
      assert.equal(matches({ amount: value }, [{ field: 'amount', operator, value: 0 }]), false, `${operator} should reject ${String(value)}`);
    }
    assert.equal(matches({ amount: 100 }, [{ field: 'amount', operator, value: 'not-a-number' }]), false);
    assert.equal(matches({ amount: 100 }, [{ field: 'amount', operator, value: null }]), false);
  }
  assert.equal(matches({ amount: 100 }, [{ field: 'amount', operator: 'gte', value: 100 }]), true);
  assert.equal(matches({ amount: 100 }, [{ field: 'amount', operator: 'lte', value: 100 }]), true);
  assert.equal(matches({ amount: 100 }, [{ field: 'amount', operator: 'gt', value: 50 }]), true);
});

test('malformed workflow condition sets fail closed without executing actions', () => {
  const { matches } = load('workflow-runner');
  const record = { amount: 100 };
  for (const conditions of [null, {}, 'bad', 42, [null], [{}], [[]], [{ field: '', operator: 'gt', value: 0 }], [{ field: 'amount' }]]) {
    assert.equal(matches(record, conditions), false, `Malformed condition should not match: ${JSON.stringify(conditions)}`);
  }
  assert.equal(matches(record, []), true, 'Empty valid condition list intentionally matches all');
  assert.equal(matches(record, [{ field: 'amount', operator: 'gt', value: 50 }]), true);
});

test('Stripe subscription checkout missing subscription ID never writes entitlement', async () => {
  let recordedError = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    assert.equal(table, 'stripe_webhook_events', 'Only the event ledger should be touched');
    return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => { recordedError = true; return { error: null }; } }),
    };
  } }));
  const response = await context.handler(signedRequest({
    id: 'evt_missing_subscription', type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', customer: 'cus_test', client_reference_id: 'workspace-test' } },
  }));
  assert.equal(response.status, 500);
  assert.equal(recordedError, true);
});

test('workflow scheduling delays reject unsafe values before actions run', () => {
  const { validatedDelayHours } = load('workflow-runner');
  for (const value of [-1, 'bad', Infinity, NaN, 8761]) {
    assert.throws(() => validatedDelayHours(value), /Workflow delay/);
  }
  for (const [value, expected] of [[undefined, 0], [null, 0], [0, 0], ['24', 24], [8760, 8760]]) {
    assert.equal(validatedDelayHours(value), expected);
  }
});

test('workflow preflight rejects invalid later action before any database writes', async () => {
  let writes = 0;
  const db = { from: () => { writes++; throw new Error('Unexpected write'); } };
  const context = load('workflow-runner');
  const run = { context: { event: { entity_type: 'customers' }, record: { id: 'customer-test' } } };
  for (const invalidAction of [null, {}, { type: 'unknown' }, { type: 'create_follow_up', delay_hours: -10 }]) {
    await assert.rejects(() => context.executeActions(db, 'workspace-test', {
      actions: [{ type: 'create_task', title: 'Valid task' }, invalidAction],
    }, run));
  }
  assert.equal(writes, 0);
});

test('workflow task priority preflight rejects invalid values before writes', async () => {
  let writes = 0;
  const db = { from: () => { writes++; throw new Error('Unexpected database write'); } };
  const { executeActions } = load('workflow-runner');
  const run = { context: { event: { entity_type: 'customers' }, record: { id: 'customer-test' } } };
  for (const priority of [-1, '', 'invalid', Infinity, NaN]) {
    await assert.rejects(() => executeActions(db, 'workspace-test', {
      actions: [{ type: 'create_follow_up' }, { type: 'create_task', priority }],
    }, run), /Workflow task priority/);
  }
  assert.equal(writes, 0);
});

test('Stripe rejects a provider customer mapped to another workspace', async () => {
  let entitlementsWritten = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { workspace_id: 'other-workspace' }, error: null,
      }) }) }),
      upsert: () => { entitlementsWritten = true; throw new Error('Forbidden write'); },
    };
  } }));
  const response = await context.handler(signedRequest({
    id: 'evt_conflicting_mapping', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test',
      metadata: { workspace_id: 'target-workspace' }, status: 'active' } },
  }));
  assert.equal(response.status, 500);
  assert.equal(entitlementsWritten, false);
});

test('invalid opportunity updates are rejected before earlier workflow writes', async () => {
  let writes = 0;
  const db = { from: () => { writes++; throw new Error('Unexpected database write'); } };
  const { executeActions } = load('workflow-runner');
  const run = { context: { event: { entity_type: 'opportunities' }, record: { id: 'opportunity-test' } } };
  for (const patch of [null, {}, [], { workspace_id: 'foreign-workspace' },
    { amount: -2 }, { amount: 'bad' }, { priority: -1 }, { priority: 'bad' }]) {
    await assert.rejects(() => executeActions(db, 'workspace-test', {
      actions: [{ type: 'create_task', title: 'Should not be saved' },
        { type: 'update_opportunity', patch }],
    }, run));
  }
  assert.equal(writes, 0);
});

test('out-of-order Stripe subscription event reconciles current provider state', async () => {
  let stored = null;
  let fetched = 0;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: (row) => { stored = row; return Promise.resolve({ error: null }); },
    };
  } }));
  context.fetch = async (url) => {
    fetched++;
    assert.match(String(url), /\/subscriptions\/sub_test$/);
    return { ok: true, json: async () => ({
      id: 'sub_test', customer: 'cus_test', status: 'canceled',
      metadata: { plan_key: 'revenue_recovery' },
    }) };
  };
  const response = await context.handler(signedRequest({
    id: 'evt_out_of_order', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test', status: 'active',
      metadata: { workspace_id: 'workspace-test' } } },
  }));
  assert.equal(response.status, 200);
  assert.equal(fetched, 1);
  assert.equal(stored?.status, 'canceled');
  assert.equal(stored?.workspace_id, 'workspace-test');
});

test('deleted Stripe subscription 404 can only persist canceled entitlement', async () => {
  let stored = null;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: (row) => { stored = row; return Promise.resolve({ error: null }); },
    };
  } }));
  context.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'Not found' } }) });
  const response = await context.handler(signedRequest({
    id: 'evt_deleted_404', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_test', customer: 'cus_test',
      status: 'active', metadata: { workspace_id: 'workspace-test' } } },
  }));
  assert.equal(response.status, 200);
  assert.equal(stored?.status, 'canceled');
  assert.equal(stored?.workspace_id, 'workspace-test');
});

test('Stripe rejects provider subscription ID mismatch before entitlement changes', async () => {
  let stored = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: () => { stored = true; throw new Error('Unexpected entitlement write'); },
    };
  } }));
  context.fetch = async () => ({ ok: true, json: async () => ({
    id: 'sub_different', customer: 'cus_test', status: 'active',
  }) });
  const response = await context.handler(signedRequest({
    id: 'evt_mismatched_subscription', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_expected', customer: 'cus_test',
      status: 'active', metadata: { workspace_id: 'workspace-test' } } },
  }));
  assert.equal(response.status, 500);
  assert.equal(stored, false);
});

test('Stripe rejects provider customer ID mismatch before entitlement changes', async () => {
  let stored = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: () => { stored = true; throw new Error('Unexpected entitlement write'); },
    };
  } }));
  context.fetch = async () => ({ ok: true, json: async () => ({
    id: 'sub_expected', customer: 'cus_different', status: 'active',
  }) });
  const response = await context.handler(signedRequest({
    id: 'evt_mismatched_customer', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_expected', customer: 'cus_expected',
      status: 'active', metadata: { workspace_id: 'workspace-test' } } },
  }));
  assert.equal(response.status, 500);
  assert.equal(stored, false);
});

test('Stripe duplicate still processing returns retryable 503 without entitlement writes', async () => {
  let touchedEntitlements = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table !== 'stripe_webhook_events') { touchedEntitlements = true; throw new Error('Unexpected entitlement access'); }
    return {
      insert: async () => ({ error: { code: '23505' } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { processed_at: null, processing_error: null }, error: null,
      }) }) }),
    };
  } }));
  const response = await context.handler(signedRequest({
    id: 'evt_concurrent', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test' } },
  }));
  assert.equal(response.status, 503);
  assert.equal(touchedEntitlements, false);
});

test('Stripe failed duplicate requires successful atomic claim before retry', async () => {
  let touchedEntitlements = false;
  let conditionalClaim = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table !== 'stripe_webhook_events') { touchedEntitlements = true; throw new Error('Unexpected entitlement access'); }
    return {
      insert: async () => ({ error: { code: '23505' } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { processed_at: null, processing_error: 'previous failure' }, error: null,
      }) }) }),
      update: () => {
        const chain = {
          eq: (key, value) => { if (key === 'processing_error' && value === 'previous failure') conditionalClaim = true; return chain; },
          is: () => chain, select: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return chain;
      },
    };
  } }));
  const response = await context.handler(signedRequest({
    id: 'evt_failed_race', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test' } },
  }));
  assert.equal(response.status, 503);
  assert.equal(conditionalClaim, true);
  assert.equal(touchedEntitlements, false);
});

test('stale Stripe deletion does not cancel a currently active subscription', async () => {
  let stored = null;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: (row) => { stored = row; return Promise.resolve({ error: null }); },
    };
  } }));
  context.fetch = async () => ({ ok: true, json: async () => ({
    id: 'sub_test', customer: 'cus_test', status: 'active',
    metadata: { plan_key: 'revenue_recovery' },
  }) });
  const response = await context.handler(signedRequest({
    id: 'evt_stale_deleted', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_test', customer: 'cus_test',
      status: 'canceled', metadata: { workspace_id: 'workspace-test' } } },
  }));
  assert.equal(response.status, 200);
  assert.equal(stored?.status, 'active');
  assert.equal(stored?.workspace_id, 'workspace-test');
});

test('stale Stripe invoice payment failure cannot downgrade recovered active subscription', async () => {
  let stored = null;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { workspace_id: 'workspace-test' }, error: null,
      }) }) }),
      upsert: (row) => { stored = row; return Promise.resolve({ error: null }); },
    };
  } }));
  context.fetch = async () => ({ ok: true, json: async () => ({
    id: 'sub_test', customer: 'cus_test', status: 'active',
    metadata: { plan_key: 'revenue_recovery' },
  }) });
  const response = await context.handler(signedRequest({
    id: 'evt_old_failure', type: 'invoice.payment_failed',
    data: { object: { customer: 'cus_test', subscription: 'sub_test' } },
  }));
  assert.equal(response.status, 200);
  assert.equal(stored?.status, 'active');
  assert.equal(stored?.workspace_id, 'workspace-test');
});

test('unknown Stripe subscription statuses fail closed without billing writes', async () => {
  for (const status of [undefined, null, 'unknown_future_status']) {
    let stored = false;
    const context = load('stripe-webhook', () => ({ from: (table) => {
      if (table === 'stripe_webhook_events') return {
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      assert.equal(table, 'workspace_subscriptions');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: () => { stored = true; throw new Error('Unexpected entitlement write'); },
      };
    } }));
    context.fetch = async () => ({ ok: true, json: async () => ({
      id: 'sub_test', customer: 'cus_test', status,
    }) });
    const response = await context.handler(signedRequest({
      id: 'evt_invalid_status', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test', customer: 'cus_test',
        metadata: { workspace_id: 'workspace-test' } } },
    }));
    assert.equal(response.status, 500);
    assert.equal(stored, false);
  }
});

test('Stripe subscription missing live customer identity cannot overwrite billing', async () => {
  for (const customer of [undefined, null, '', 'not-a-stripe-customer']) {
    let wrote = false;
    const context = load('stripe-webhook', () => ({ from: (table) => {
      if (table === 'stripe_webhook_events') return {
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      assert.equal(table, 'workspace_subscriptions');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: () => { wrote = true; throw new Error('Unexpected billing write'); },
      };
    } }));
    context.fetch = async () => ({ ok: true, json: async () => ({
      id: 'sub_test', status: 'active', customer,
    }) });
    const response = await context.handler(signedRequest({
      id: 'evt_no_live_customer', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test', customer: 'cus_original',
        metadata: { workspace_id: 'workspace-test' } } },
    }));
    assert.equal(response.status, 500);
    assert.equal(wrote, false);
  }
});

test('invalid Stripe subscription period timestamps cannot corrupt billing', async () => {
  for (const bad of [-1, 'yesterday', Infinity, 8640000001, 0.5]) {
    let wrote = false;
    const context = load('stripe-webhook', () => ({ from: (table) => {
      if (table === 'stripe_webhook_events') return {
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      assert.equal(table, 'workspace_subscriptions');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: () => { wrote = true; throw new Error('Unexpected billing write'); },
      };
    } }));
    context.fetch = async () => ({ ok: true, json: async () => ({
      id: 'sub_test', customer: 'cus_test', status: 'active',
      current_period_end: bad,
    }) });
    const response = await context.handler(signedRequest({
      id: 'evt_bad_period', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test', customer: 'cus_test',
        metadata: { workspace_id: 'workspace-test' } } },
    }));
    assert.equal(response.status, 500);
    assert.equal(wrote, false);
  }
});

test('live Stripe subscription cannot update another workspace entitlement', async () => {
  let wrote = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table === 'stripe_webhook_events') return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    assert.equal(table, 'workspace_subscriptions');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: () => { wrote = true; throw new Error('Unexpected entitlement write'); },
    };
  } }));
  context.fetch = async () => ({ ok: true, json: async () => ({
    id: 'sub_test', customer: 'cus_test', status: 'active',
    metadata: { workspace_id: 'workspace-foreign' },
  }) });
  const response = await context.handler(signedRequest({
    id: 'evt_live_workspace_conflict', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test',
      metadata: { workspace_id: 'workspace-target' } } },
  }));
  assert.equal(response.status, 500);
  assert.equal(wrote, false);
});

test('conflicting Stripe checkout workspace identifiers cannot change entitlements', async () => {
  let touchedEntitlements = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table !== 'stripe_webhook_events') { touchedEntitlements = true; throw new Error('Unexpected billing access'); }
    return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
  } }));
  const response = await context.handler(signedRequest({
    id: 'evt_conflicting_checkout_references', type: 'checkout.session.completed',
    data: { object: {
      mode: 'subscription', subscription: 'sub_test', customer: 'cus_test',
      metadata: { workspace_id: 'workspace-one' },
      client_reference_id: 'workspace-two',
    } },
  }));
  assert.equal(response.status, 500);
  assert.equal(touchedEntitlements, false);
});

test('unknown Stripe subscription events cannot modify paid entitlements', async () => {
  let entitlementAccess = false;
  const context = load('stripe-webhook', () => ({ from: (table) => {
    if (table !== 'stripe_webhook_events') {
      entitlementAccess = true;
      throw new Error('Unexpected billing access');
    }
    return {
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
  } }));
  const response = await context.handler(signedRequest({
    id: 'evt_unknown_subscription', type: 'customer.subscription.unsupported_event',
    data: { object: { id: 'sub_test', customer: 'cus_test', status: 'active',
      metadata: { workspace_id: 'workspace-test' } } },
  }));
  assert.equal(response.status, 200);
  assert.equal(entitlementAccess, false);
});

test('malformed Stripe subscription identifiers fail before billing lookups', async () => {
  for (const subscription of ['wrong_prefix', 'sub_test/../other', 'sub_!invalid']) {
    let touchedBilling = false;
    const context = load('stripe-webhook', () => ({ from: (table) => {
      if (table !== 'stripe_webhook_events') { touchedBilling = true; throw new Error('Unexpected billing access'); }
      return {
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    } }));
    const response = await context.handler(signedRequest({
      id: 'evt_invalid_subscription_id', type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription,
        customer: 'cus_test', metadata: { workspace_id: 'workspace-test' } } },
    }));
    assert.equal(response.status, 500);
    assert.equal(touchedBilling, false);
  }
});

test('Stripe subscription lifecycle event without ID cannot access billing', async () => {
  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    let touchedBilling = false;
    const context = load('stripe-webhook', () => ({ from: (table) => {
      if (table !== 'stripe_webhook_events') { touchedBilling = true; throw new Error('Unexpected billing access'); }
      return {
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    } }));
    const response = await context.handler(signedRequest({
      id: 'evt_missing_subscription_id', type,
      data: { object: { customer: 'cus_test', status: 'active',
        metadata: { workspace_id: 'workspace-test' } } },
    }));
    assert.equal(response.status, 500);
    assert.equal(touchedBilling, false);
  }
});
