import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const wsId = '11111111-1111-4111-8111-111111111111'
const calls = []
let failSecondBatchOnce = true

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    functions: {
      async invoke(name, { body }) {
        assert.equal(name, 'customer-bulk-import')
        calls.push(body)
        if (body.action === 'start') {
          return {
            data: { job: { id: 'job-resumable-1', status: 'active', processed: 0, created: 0, matched: 0, rejected: 0 } },
            error: null,
          }
        }
        if (body.action === 'status') {
          return {
            data: { job: { id: body.job_id, status: 'active', processed: 100, created: 100, matched: 0, rejected: 0 } },
            error: null,
          }
        }
        if (body.action === 'batch') {
          if (body.batch_number === 1 && failSecondBatchOnce) {
            failSecondBatchOnce = false
            return { data: { error: 'Temporary network blip' }, error: new Error('Temporary network blip') }
          }
          return { data: { receipt: `rcpt-${body.batch_number}` }, error: null }
        }
        if (body.action === 'finish') {
          return {
            data: {
              job: {
                id: body.job_id,
                status: 'completed',
                processed: body.expected_rows,
                created: body.expected_rows,
                matched: 0,
                rejected: 0,
              },
            },
            error: null,
          }
        }
        throw new Error(`Unexpected action ${body.action}`)
      },
    },
  },
}

const edgeMod = loadSrcModule('src/lib/edgeFunctions.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
})

// 1. Rejects > 5,000 rows
const oversized = Array.from({ length: 5001 }, (_, i) => ({ first_name: `C${i}` }))
await assert.rejects(
  () => edgeMod.runCustomerBulkImport({ workspaceId: wsId, rows: oversized, fingerprint: 'hash-over' }),
  /5,000/,
)

// 2. 150 rows split into 2 batches (100 + 50); interrupted run resumes via in-memory checkpoint (`status` check)
const rows150 = Array.from({ length: 150 }, (_, i) => ({
  first_name: `Cust${i}`,
  email: `c${i}@example.com`,
}))

await assert.rejects(
  () => edgeMod.runCustomerBulkImport({ workspaceId: wsId, rows: rows150, fingerprint: 'sha256-150' }),
  /Temporary network blip/,
)

const summary = await edgeMod.runCustomerBulkImport({
  workspaceId: wsId,
  rows: rows150,
  fingerprint: 'sha256-150',
})

assert.equal(summary.status, 'completed')
assert.equal(summary.processed, 150)
assert.ok(calls.some(c => c.action === 'status' && c.job_id === 'job-resumable-1'))
const finishCall = calls.find(c => c.action === 'finish')
assert.equal(finishCall.expected_batches, 2)
assert.equal(finishCall.expected_rows, 150)

// 3. Verify modal uses SHA-256 and zero localStorage writes
const modalSrc = readSrc('src/features/workspaces/pipeline-quotes/CustomerBulkImportModal.tsx')
assert.match(modalSrc, /sha256Hex/)
assert.doesNotMatch(modalSrc, /localStorage/)

console.log('Server-batched imports and restart checkpoints verified')
