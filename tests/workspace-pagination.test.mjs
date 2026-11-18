import assert from 'node:assert/strict'
import { loadSrcModule } from './helpers/load-src-module.mjs'

const wsId = '11111111-1111-4111-8111-111111111111'
let totalRowsInMockTable = 1200
const rangeCalls = []

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    from() {
      const chain = {
        select() { return chain },
        eq() { return chain },
        order() { return chain },
        async range(start, end) {
          rangeCalls.push([start, end])
          const available = Math.max(0, Math.min(end - start + 1, totalRowsInMockTable - start))
          const rows = Array.from({ length: available }, (_, idx) => ({ id: `row-${start + idx}` }))
          return { data: rows, error: null }
        },
      }
      return chain
    },
  },
}

const queries = loadSrcModule('src/lib/queries.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
})

assert.equal(queries.DEFAULT_FETCH_BATCH_SIZE, 500)
assert.equal(queries.WORKSPACE_ROW_SAFETY_LIMIT, 10_000)

// 1. Multi-batch pagination slices cleanly in 500-row increments
const all1200 = await queries.fetchAllWorkspaceRows({
  table: 'customers',
  workspaceId: wsId,
})
assert.equal(all1200.length, 1200)
assert.deepEqual(rangeCalls, [
  [0, 499],
  [500, 999],
  [1000, 1499],
])

// 2. Abort callback discards stale response cleanly
const aborted = await queries.fetchAllWorkspaceRows({
  table: 'customers',
  workspaceId: wsId,
  shouldAbort: () => true,
})
assert.equal(aborted, null)

// 3. Fail-closed safety limit throws instead of returning partial financial/customer totals
totalRowsInMockTable = 10_500
await assert.rejects(
  () => queries.fetchAllWorkspaceRows({ table: 'invoices', workspaceId: wsId }),
  /exceeds the 10,000-row safety limit/,
)

console.log('Workspace pagination and fail-closed totals safeguards verified')
