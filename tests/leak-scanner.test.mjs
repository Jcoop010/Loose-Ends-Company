import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const window = {}
class Clock extends Date { static now() { return Date.parse('2026-10-16T12:00:00Z') } }
runInNewContext(readFileSync(new URL('../v3.1/revenue-leak-scanner.js', import.meta.url), 'utf8'), {
  window, Date: Clock, document: { getElementById: () => null, readyState: 'complete' }
})
const scan = window.LERevenueLeakScanner.scan
const base = { customers: [], documents: [], opportunities: [], followUps: [], tasks: [], appointments: [] }
const invoice = { id: 'invoice-fixture', document_type: 'invoice', status: 'sent', total: 500, due_at: '2026-10-01T12:00:00Z' }
assert.equal(scan(base).signals.length, 0)
for (const status of ['paid', 'cancelled', 'draft', 'void']) {
  assert.equal(scan({ ...base, documents: [{ ...invoice, status }] }).signals.length, 0, status + ' invoice must not generate overdue debt')
}
assert.equal(scan({ ...base, documents: [invoice] }).exposure, 500)
assert.equal(scan({ ...base, documents: [invoice, invoice] }).signals.length, 1, 'duplicate source rows must not duplicate signals')
for (const total of [-10, Infinity, 'invalid']) {
  const result = scan({ ...base, documents: [{ ...invoice, total }] })
  assert.equal(result.exposure, 0, 'invalid source amount must not inflate exposure')
  assert.equal(result.signals[0].amount, 0)
}
const opportunity = { id: 'opportunity-fixture', amount: 700, created_at: '2026-10-01T12:00:00Z', status: 'open' }
for (const status of ['recovered', 'dismissed', 'cancelled', 'completed', 'closed']) {
  assert.equal(scan({ ...base, opportunities: [{ ...opportunity, status }] }).signals.length, 0, status + ' opportunity must not be treated as neglected open work')
}
assert.equal(scan({ ...base, opportunities: [opportunity] }).signals.length, 1)
const related = scan({ ...base, documents: [{ ...invoice, opportunity_id: opportunity.id }], opportunities: [opportunity] })
assert.equal(related.exposure, 700, 'linked invoice and opportunity count exposure once')
assert.equal(scan({ ...base, documents: [{ ...invoice, due_at: '2026-11-01' }] }).signals.length, 0)
assert.equal(scan({ ...base, documents: [{ ...invoice, due_at: 'invalid' }] }).signals.length, 0)
const quote = { ...invoice, id: 'quote-fixture', document_type: 'quote', created_at: '2026-10-01T12:00:00Z', opportunity_id: opportunity.id }
const quoteResult = scan({ ...base, documents: [quote] })
assert.equal(quoteResult.signals[0].kind, 'STALE QUOTE')
assert.equal(scan({ ...base, documents: [quote], followUps: [{ opportunity_id: opportunity.id, status: 'pending', scheduled_at: '2026-10-17T12:00:00Z' }] }).signals.length, 0)
assert.equal(scan({ ...base, documents: [quote], tasks: [{ title: quoteResult.signals[0].task.title, status: 'open', customer_id: null, opportunity_id: opportunity.id }] }).signals.length, 0, 'an existing task suppresses a duplicate action')
assert.equal(scan({ ...base, documents: [{ ...invoice, customer_id: 'missing-customer' }] }).signals.length, 1, 'an existing invoice remains actionable when the customer is missing')
assert.equal(scan({ ...base, tasks: [{ id: 'task-fixture', due_at: '2026-10-01', status: 'done' }] }).signals.length, 0)
assert.equal(scan({ ...base, appointments: [{ id: 'appointment-fixture', starts_at: '2026-10-01', status: 'scheduled' }] }).signals[0].kind, 'APPOINTMENT OUTCOME')
console.log('Production leak scanner regression tests passed')
