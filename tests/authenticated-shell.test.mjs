import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'
import { JSDOM } from 'jsdom'

// 1. Restricted explicit column projection on workspace_members join
const sessionSrc = readSrc('src/state/SessionContext.tsx')
assert.match(
  sessionSrc,
  /\.from\('workspace_members'\)\s*\.select\('workspace_id,user_id,role,created_at,workspaces\(id,name,slug,owner_user_id,created_at\)'\)/,
)

// 2. Strict workspace screen isolation in AppRoot: switching sections mounts ONLY the active workspace
const appRootSrc = readSrc('src/AppRoot.tsx')
assert.match(appRootSrc, /case 'pipeline':\s*return <PipelineQuotesPage \/>/)
assert.match(appRootSrc, /case 'dispatch':\s*return <DispatchJobsPage \/>/)
assert.match(appRootSrc, /case 'inventory':\s*return <InventoryPosPage \/>/)
assert.match(appRootSrc, /case 'autopilot':\s*return <AutopilotBillingPage \/>/)

// 3. Render RouterProvider + ToastProvider + SessionProvider + AppShell in JSDOM to verify single-screen & zero auto-modal startup
const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/dashboard',
})
const w = installDomGlobals(dom)
w.scrollTo = () => {}

const wsUuid = '11111111-1111-4111-8111-111111111111'
const queriesExecuted = []

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              user: { id: 'user-fixture', email: 'owner@fixture.example' },
            },
          },
          error: null,
        }
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async signOut() {
        return { error: null }
      },
    },
    from(table) {
      const chain = {
        select(cols) {
          queriesExecuted.push({ table, cols })
          return chain
        },
        eq() { return chain },
        order() {
          if (table === 'workspace_members') {
            return Promise.resolve({
              data: [
                {
                  workspace_id: wsUuid,
                  user_id: 'user-fixture',
                  role: 'owner',
                  workspaces: { id: wsUuid, name: 'Fixture Business', slug: 'fixture' },
                },
              ],
              error: null,
            })
          }
          return chain
        },
        limit() { return Promise.resolve({ data: [], error: null }) },
        range() { return Promise.resolve({ data: [], error: null }) },
        maybeSingle() {
          if (table === 'workspace_settings') {
            return Promise.resolve({
              data: {
                workspace_id: wsUuid,
                business_type: 'HVAC',
                timezone: 'America/New_York',
                onboarding_completed: true,
              },
              error: null,
            })
          }
          if (table === 'workspace_subscriptions') {
            return Promise.resolve({
              data: { workspace_id: wsUuid, status: 'active', plan_key: 'revenue_recovery' },
              error: null,
            })
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
      return chain
    },
  },
}

const cache = new Map()
const opts = {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
  globals: { window: w, document: w.document, history: w.history },
  cache,
}

const { ToastProvider } = loadSrcModule('src/components/ui/Toast.tsx', opts)
const { RouterProvider } = loadSrcModule('src/state/RouterContext.tsx', opts)
const { SessionProvider } = loadSrcModule('src/state/SessionContext.tsx', opts)
const { AuthGate } = loadSrcModule('src/components/shell/AuthGate.tsx', opts)
const { AppShell } = loadSrcModule('src/components/shell/AppShell.tsx', opts)

const root = createRoot(w.document.getElementById('root'))
try {
  await act(async () => {
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          RouterProvider,
          { initialPath: '/dashboard' },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              AuthGate,
              null,
              React.createElement(
                AppShell,
                null,
                React.createElement('div', { id: 'workspace-marker' }, 'Active Workspace Body'),
              ),
            ),
          ),
        ),
      ),
    )
    await new Promise(r => setTimeout(r, 40))
  })

  assert.ok(w.document.body.textContent.includes('Fixture Business'))
  assert.ok(w.document.getElementById('workspace-marker'))
  assert.equal(w.document.querySelectorAll('[role="dialog"]').length, 0, 'Startup must never auto-open blocking modals')
  assert.ok(queriesExecuted.some(q => q.table === 'workspace_members' && !q.cols.startsWith('*')))
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Authenticated shell regressions passed: restricted workspace columns and screen isolation.')
