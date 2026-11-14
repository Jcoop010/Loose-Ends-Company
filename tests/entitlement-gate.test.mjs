// Entitlement gate — pure-logic acceptance tests (DRAFT; run in CI on this branch).
// No network, no DB, no real Stripe. The subscription row shape mirrors what the
// webhook writes into workspace_subscriptions.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

let gate
before(async () => {
  await import('../v3.1/entitlement-gate.js')
  gate = globalThis.LEEntitlement
  assert.ok(gate, 'entitlement-gate.js must set globalThis.LEEntitlement')
})

const now = Date.parse('2026-11-15T00:00:00Z')
const future = '2026-12-15T00:00:00Z'
const past = '2026-11-01T00:00:00Z'

describe('entitlement gate evaluate()', () => {
  it('no row -> no access, billing CTA shown', () => {
    const d = gate.evaluate(null, { now })
    assert.equal(d.entitled, false)
    assert.equal(d.reason, 'no_subscription')
    assert.equal(d.billingCta, true)
  })

  it('active with future period end -> allowed', () => {
    const d = gate.evaluate({ status: 'active', current_period_end: future }, { now })
    assert.equal(d.entitled, true)
    assert.equal(d.reason, 'ok')
  })

  it('trialing with future period end -> allowed', () => {
    const d = gate.evaluate({ status: 'trialing', current_period_end: future }, { now })
    assert.equal(d.entitled, true)
  })

  it('active with expired period end -> denied (stale row)', () => {
    const d = gate.evaluate({ status: 'active', current_period_end: past }, { now })
    assert.equal(d.entitled, false)
    assert.equal(d.reason, 'period_ended')
  })

  it('blocked statuses never entitled', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      const d = gate.evaluate({ status, current_period_end: future }, { now })
      assert.equal(d.entitled, false, status)
      assert.equal(d.billingCta, true)
    }
  })

  it('past_due denied by default; allowed only with explicit grace flag', () => {
    const denied = gate.evaluate({ status: 'past_due', current_period_end: future }, { now })
    assert.equal(denied.entitled, false)
    assert.equal(denied.reason, 'past_due')
    const grace = gate.evaluate({ status: 'past_due', current_period_end: future }, { now, allowPastDue: true })
    assert.equal(grace.entitled, true)
    assert.equal(grace.reason, 'past_due_grace')
  })

  it('unknown status -> denied (fail-closed)', () => {
    const d = gate.evaluate({ status: 'made_up_state', current_period_end: future }, { now })
    assert.equal(d.entitled, false)
    assert.equal(d.reason, 'unknown_status')
  })

  it('missing period end on active -> allowed; webhook reconciliation is authoritative', () => {
    const d = gate.evaluate({ status: 'active' }, { now })
    assert.equal(d.entitled, true)
  })
})
