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
