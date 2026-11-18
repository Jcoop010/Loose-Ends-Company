import assert from 'node:assert/strict'
import { loadSrcModule } from './helpers/load-src-module.mjs'

const { scanRevenueLeaks } = loadSrcModule('src/lib/leakScanner.ts')

const fixedNow = Date.parse('2026-11-15T12:00:00Z')
const customer = id => ({
  id,
  workspace_id: 'ws-1',
  first_name: id,
  last_name: null,
  email: null,
  phone: null,
  notes: null,
  created_at: '2026-09-01T00:00:00Z',
})

// 1. Customer record alone must never invent speculative opportunity estimates
const empty = scanRevenueLeaks({
  customers: [customer('cust-one')],
  now: fixedNow,
})
assert.equal(empty.totalCount, 0, 'customer without evidence must not invent an estimate')
assert.equal(empty.documentedExposureTotal, 0)

// 2. Paid invoice must not be flagged
const paid = scanRevenueLeaks({
  customers: [customer('cust-one')],
  documents: [
    {
      id: 'doc-paid',
      workspace_id: 'ws-1',
      customer_id: 'cust-one',
      document_type: 'invoice',
      document_number: 'INV-1',
      status: 'paid',
      total: 500,
      due_at: '2026-10-01T00:00:00Z',
      created_at: '2026-09-15T00:00:00Z',
    },
  ],
  now: fixedNow,
})
assert.equal(paid.totalCount, 0, 'paid invoice must not be flagged')

// 3. Unpaid overdue invoices for distinct customers retain independent recovery signals
const multiCustomer = scanRevenueLeaks({
  customers: [customer('cust-one'), customer('cust-two')],
  documents: [
    {
      id: 'doc-unpaid-1',
      workspace_id: 'ws-1',
      customer_id: 'cust-one',
      document_type: 'invoice',
      document_number: 'INV-2',
      status: 'overdue',
      total: 500,
      due_at: '2026-10-20T00:00:00Z',
      created_at: '2026-10-01T00:00:00Z',
    },
    {
      id: 'doc-unpaid-2',
      workspace_id: 'ws-1',
      customer_id: 'cust-two',
      document_type: 'invoice',
      document_number: 'INV-3',
      status: 'sent',
      total: 325,
      due_at: '2026-10-25T00:00:00Z',
      created_at: '2026-10-05T00:00:00Z',
    },
  ],
  now: fixedNow,
})
assert.equal(multiCustomer.totalCount, 2)
assert.equal(multiCustomer.documentedExposureTotal, 825)

// 4. Atomic collectOpportunity RPC validation
const rpcCalls = []
const opsMod = loadSrcModule('src/lib/opsCommand.ts', {
  moduleOverrides: {
    'src/lib/supabase.ts': {
      isSupabaseConfigured: true,
      assertSupabaseConfigured() {},
      supabase: {
        async rpc(name, args) {
          rpcCalls.push({ name, args })
          return { data: true, error: null }
        },
      },
    },
  },
})

const oppUuid = '11111111-1111-4111-8111-111111111111'
await assert.rejects(() => opsMod.collectOpportunity(oppUuid, 0), /greater than \$0/)
await assert.rejects(() => opsMod.collectOpportunity(oppUuid, Number.POSITIVE_INFINITY), /greater than \$0/)
assert.equal(rpcCalls.length, 0)

const collected = await opsMod.collectOpportunity(oppUuid, 500)
assert.equal(collected.collected, true)
assert.equal(rpcCalls.length, 1)
assert.equal(rpcCalls[0].name, 'collect_opportunity')
assert.equal(rpcCalls[0].args.p_amount, 500)

console.log('Revenue recovery assertions passed')
