import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const wsId = '11111111-1111-4111-8111-111111111111'
let capturedWorkspaceFilter = null
let capturedOrClause = null
let capturedLimit = null

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    from(table) {
      assert.equal(table, 'customers')
      const chain = {
        select() { return chain },
        eq(col, val) {
          if (col === 'workspace_id') capturedWorkspaceFilter = val
          return chain
        },
        or(expr) {
          capturedOrClause = expr
          return chain
        },
        order() { return chain },
        async limit(n) {
          capturedLimit = n
          return { data: [{ id: 'c1', first_name: 'Hannah', last_name: 'Mercer' }], error: null }
        },
      }
      return chain
    },
  },
}

const queries = loadSrcModule('src/lib/queries.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
})

const results = await queries.searchCustomers(wsId, 'Mercer%(admin),test', 100)
assert.equal(results.length, 1)
assert.equal(capturedWorkspaceFilter, wsId)
assert.equal(capturedLimit, 100)
assert.match(capturedOrClause, /first_name\.ilike\.%Mercer\s+admin\s+test%/)
assert.ok(!capturedOrClause.includes('(') && !capturedOrClause.includes(')'), 'PostgREST operators sanitized')

const drawerSrc = readSrc('src/features/workspaces/pipeline-quotes/Customer360Drawer.tsx')
assert.match(drawerSrc, /searchCustomers\(workspaceId,/)

console.log('Workspace-scoped customer search source checks passed')
