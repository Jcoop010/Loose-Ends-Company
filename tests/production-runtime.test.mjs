import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'
import { JSDOM } from 'jsdom'

const wsA = '11111111-1111-4111-8111-111111111111'
const wsB = '22222222-2222-4222-8222-222222222222'
const oppId = '33333333-3333-4333-8333-333333333333'
const looseId = '44444444-4444-4444-8444-444444444444'

const rpcCalls = []
const tableUpdates = []

// 1. Verify atomic collectOpportunity & loose_ends stage update constraints
const mockOpsSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return { data: true, error: null }
    },
    from(table) {
      const chain = {
        update(patch) {
          tableUpdates.push({ table, patch })
          return chain
        },
        eq() { return chain },
        select() { return chain },
        async single() {
          return { data: { id: looseId, status: 'in_progress', recovery_stage: 'converted' }, error: null }
        },
      }
      return chain
    },
  },
}

const opsMod = loadSrcModule('src/lib/opsCommand.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockOpsSupabase },
})
const queriesMod = loadSrcModule('src/lib/queries.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockOpsSupabase },
})

await queriesMod.updateLooseEndStage({
  workspaceId: wsA,
  looseEndId: looseId,
  status: 'in_progress',
  recoveryStage: 'converted',
})
assert.equal(tableUpdates[0].table, 'loose_ends')
assert.equal(tableUpdates[0].patch.status, 'in_progress')
assert.equal(tableUpdates[0].patch.recovery_stage, 'converted')

await opsMod.collectOpportunity(oppId, 125.5)
assert.equal(rpcCalls.length, 1)
assert.equal(rpcCalls[0].name, 'collect_opportunity')
assert.equal(rpcCalls[0].args.p_amount, 125.5, 'records exact partial collection amount')
assert.equal(
  tableUpdates.filter(u => u.table === 'opportunities').length,
  0,
  'collection uses atomic RPC, never direct opportunities.update()',
)

await assert.rejects(() => opsMod.collectOpportunity(oppId, Number.POSITIVE_INFINITY))
await assert.rejects(() => opsMod.collectOpportunity(oppId, -10))
assert.equal(rpcCalls.length, 1, 'invalid amounts never reach database')

// 2. SessionContext synchronous wipe on SIGNED_OUT & monotonic generation guard against stale responses
const authListeners = []
const delayedResolvers = []
let delayMembershipQuery = false
let currentSessionUser = { id: 'account-a', email: 'a@example.invalid' }

const mockSessionSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    auth: {
      async getSession() {
        return {
          data: { session: currentSessionUser ? { user: currentSessionUser } : null },
          error: null,
        }
      },
      onAuthStateChange(fn) {
        authListeners.push(fn)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async signOut() {
        return { error: null }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        order() {
          if (table === 'workspace_members') {
            const wid = currentSessionUser?.id === 'account-b' ? wsB : wsA
            const result = {
              data: [
                {
                  workspace_id: wid,
                  user_id: currentSessionUser?.id ?? 'none',
                  role: 'owner',
                  workspaces: { id: wid, name: `Workspace ${wid.slice(0, 4)}` },
                },
              ],
              error: null,
            }
            if (delayMembershipQuery) {
              return new Promise(resolve => {
                delayedResolvers.push(() => resolve(result))
              })
            }
            return Promise.resolve(result)
          }
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null })
        },
      }
      return chain
    },
    functions: {
      async invoke() {
        return { data: {}, error: null }
      },
    },
  },
}

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/dashboard',
})
const w = installDomGlobals(dom)

const cache = new Map()
const { SessionProvider, useSession } = loadSrcModule('src/state/SessionContext.tsx', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSessionSupabase },
  globals: { window: w, document: w.document },
  cache,
})

let latestSessionSnapshot = null
function SessionProbe() {
  latestSessionSnapshot = useSession()
  return React.createElement('div', null, latestSessionSnapshot.workspace?.id ?? 'signed-out')
}

const root = createRoot(w.document.getElementById('root'))
try {
  await act(async () => {
    root.render(React.createElement(SessionProvider, null, React.createElement(SessionProbe)))
    await new Promise(r => setTimeout(r, 30))
  })
  assert.equal(latestSessionSnapshot.workspace?.id, wsA)

  // Trigger delayed hydration for account-a, then fire SIGNED_OUT before it resolves
  delayMembershipQuery = true
  let refreshPromise
  await act(async () => {
    refreshPromise = latestSessionSnapshot.refreshWorkspaceContext()
    await new Promise(r => setTimeout(r, 10))
  })
  assert.equal(delayedResolvers.length, 1)

  await act(async () => {
    currentSessionUser = null
    authListeners.forEach(fn => fn('SIGNED_OUT', null))
  })
  assert.equal(latestSessionSnapshot.workspace, null, 'SIGNED_OUT synchronously wipes workspace')
  assert.equal(latestSessionSnapshot.user, null)

  // Now resolve the stale in-flight account-a query: monotonic generation guard MUST discard it!
  await act(async () => {
    delayedResolvers.splice(0).forEach(fn => fn())
    await refreshPromise
    await new Promise(r => setTimeout(r, 20))
  })
  assert.equal(
    latestSessionSnapshot.workspace,
    null,
    'Stale delayed account-A response must never repopulate signed-out state',
  )

  // Sign in as account-b cleanly
  delayMembershipQuery = false
  await act(async () => {
    currentSessionUser = { id: 'account-b', email: 'b@example.invalid' }
    authListeners.forEach(fn => fn('SIGNED_IN', { user: currentSessionUser }))
    await new Promise(r => setTimeout(r, 30))
  })
  assert.equal(latestSessionSnapshot.workspace?.id, wsB)
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

// 3. Confirm zero localStorage.setItem anywhere in auth.ts or SessionContext.tsx
assert.doesNotMatch(readSrc('src/lib/auth.ts'), /localStorage\.setItem/)
assert.doesNotMatch(readSrc('src/state/SessionContext.tsx'), /localStorage\.setItem/)

console.log('Production runtime session, stale-response, cache, and atomic collection tests passed')
