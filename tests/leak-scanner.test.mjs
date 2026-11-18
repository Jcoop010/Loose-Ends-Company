import assert from 'node:assert/strict'
import { loadSrcModule } from './helpers/load-src-module.mjs'

const { scanRevenueLeaks } = loadSrcModule('src/lib/leakScanner.ts')
const fixedNow = Date.parse('2026-10-16T12:00:00Z')

const base = {
  customers: [],
  documents: [],
  opportunities: [],
  jobs: [],
  jobMaterials: [],
  followUps: [],
  tasks: [],
  appointments: [],
  now: fixedNow,
}

const invoice = {
  id: 'invoice-fixture',
  workspace_id: 'ws-1',
  customer_id: null,
  document_type: 'invoice',
  document_number: 'INV-100',
  status: 'sent',
  total: 500,
  due_at: '2026-10-01T12:00:00Z',
  created_at: '2026-09-15T12:00:00Z',
}

assert.equal(scanRevenueLeaks(base).totalCount, 0)

for (const status of ['paid', 'cancelled', 'draft']) {
  assert.equal(
    scanRevenueLeaks({ ...base, documents: [{ ...invoice, status }] }).totalCount,
    0,
    `${status} invoice must not generate overdue debt`,
  )
}

assert.equal(
  scanRevenueLeaks({ ...base, documents: [invoice] }).documentedExposureTotal,
  500,
)

for (const total of [-10, Infinity, Number.NaN, 0]) {
  const result = scanRevenueLeaks({ ...base, documents: [{ ...invoice, total }] })
  assert.equal(result.documentedExposureTotal, 0, 'invalid source amount must not inflate exposure')
  assert.equal(result.totalCount, 0)
}

const opportunity = {
  id: 'opportunity-fixture',
  workspace_id: 'ws-1',
  customer_id: null,
  title: 'Stalled Heat Pump',
  source: 'quote',
  reason: null,
  amount: 700,
  recovered_amount: null,
  priority: 80,
  created_at: '2026-10-01T12:00:00Z',
  status: 'open',
}

for (const status of ['recovered', 'dismissed', 'completed']) {
  assert.equal(
    scanRevenueLeaks({ ...base, opportunities: [{ ...opportunity, status }] }).totalCount,
    0,
    `${status} opportunity must not be treated as neglected open work`,
  )
}

assert.equal(scanRevenueLeaks({ ...base, opportunities: [opportunity] }).totalCount, 1)

// Linked invoice and parent opportunity must never double-count exposure
const related = scanRevenueLeaks({
  ...base,
  documents: [{ ...invoice, opportunity_id: opportunity.id }],
  opportunities: [opportunity],
})
assert.equal(related.documentedExposureTotal, 500, 'linked invoice suppresses duplicate opportunity exposure')
assert.equal(related.totalCount, 1)

// Future or invalid due dates on sent invoices are not overdue
assert.equal(
  scanRevenueLeaks({ ...base, documents: [{ ...invoice, due_at: '2026-11-01T12:00:00Z' }] }).totalCount,
  0,
)
assert.equal(
  scanRevenueLeaks({ ...base, documents: [{ ...invoice, due_at: 'invalid' }] }).totalCount,
  0,
)

// Stale quote (>= 5 days) detected unless covered by upcoming pending follow-up
const quote = {
  ...invoice,
  id: 'quote-fixture',
  document_type: 'quote',
  document_number: 'QTE-200',
  created_at: '2026-10-01T12:00:00Z',
  opportunity_id: opportunity.id,
}
const quoteResult = scanRevenueLeaks({ ...base, documents: [quote] })
assert.equal(quoteResult.items[0].category, 'stale_quote')

assert.equal(
  scanRevenueLeaks({
    ...base,
    documents: [quote],
    followUps: [
      {
        id: 'fu-1',
        workspace_id: 'ws-1',
        customer_id: null,
        opportunity_id: opportunity.id,
        channel: 'email',
        message: 'Check in',
        status: 'pending',
        scheduled_at: '2026-10-17T12:00:00Z',
        created_at: '2026-10-15T12:00:00Z',
      },
    ],
  }).totalCount,
  0,
)

// Matching open task marks `hasOpenTask = true` so duplicate follow-up tasks are blocked
const withOpenTask = scanRevenueLeaks({
  ...base,
  documents: [quote],
  tasks: [
    {
      id: 't-1',
      workspace_id: 'ws-1',
      customer_id: null,
      opportunity_id: opportunity.id,
      title: 'Follow up: Unapproved quote QTE-200',
      status: 'open',
      priority: 3,
      due_at: '2026-10-17T12:00:00Z',
      created_at: '2026-10-16T08:00:00Z',
    },
  ],
})
assert.equal(withOpenTask.items[0].hasOpenTask, true)

// Unbilled completed ops_job computes exact labor + non-released materials
const unbilledJobScan = scanRevenueLeaks({
  ...base,
  jobs: [
    {
      id: 'job-1',
      workspace_id: 'ws-1',
      customer_id: null,
      title: 'Emergency Cooler Repair',
      status: 'completed',
      priority: 'urgent',
      assigned_to: null,
      notes: null,
      checklist: [],
      labor_total: 400,
      revision: 1,
      service_details: {},
      recurring_plan_id: null,
      recurring_due: null,
      approved_at: null,
      approval_evidence: null,
      completed_at: '2026-10-14T12:00:00Z',
      invoice_id: null,
      created_at: '2026-10-13T12:00:00Z',
      updated_at: '2026-10-14T12:00:00Z',
    },
  ],
  jobMaterials: [
    {
      workspace_id: 'ws-1',
      job_id: 'job-1',
      item_id: 'sku-1',
      quantity: 2,
      unit_cost: 50,
      unit_price: 125,
      state: 'consumed',
    },
  ],
})
assert.equal(unbilledJobScan.items[0].category, 'unbilled_completed_job')
assert.equal(unbilledJobScan.documentedExposureTotal, 650)

// Past unclosed scheduled appointment surfaces with $0 fabricated exposure
const pastApptScan = scanRevenueLeaks({
  ...base,
  appointments: [
    {
      id: 'appt-1',
      workspace_id: 'ws-1',
      customer_id: null,
      title: 'Diagnostic Check',
      starts_at: '2026-10-10T09:00:00Z',
      ends_at: '2026-10-10T10:00:00Z',
      status: 'scheduled',
      notes: null,
    },
  ],
})
assert.equal(pastApptScan.items[0].category, 'unclosed_past_appointment')
assert.equal(pastApptScan.items[0].amount, 0)

console.log('Production leak scanner regression tests passed')
