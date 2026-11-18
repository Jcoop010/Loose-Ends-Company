import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { installDomGlobals, loadSrcModule } from './helpers/load-src-module.mjs'
import { JSDOM } from 'jsdom'

const wsId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const rpcCalls = []
const authListeners = []

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return { data: { id: jobId, confirmed: true }, error: null }
    },
    auth: {
      async getSession() {
        return {
          data: { session: { user: { id: 'u-1', email: 'tech@fixture.example' } } },
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
            return Promise.resolve({
              data: [
                {
                  workspace_id: wsId,
                  user_id: 'u-1',
                  role: 'owner',
                  workspaces: { id: wsId, name: 'HVAC Ops', slug: 'hvac' },
                },
              ],
              error: null,
            })
          }
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null })
        },
      }
      return chain
    },
  },
}

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/dashboard/dispatch',
  pretendToBeVisual: true,
})
const w = installDomGlobals(dom)
Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
  get() {
    return w.document.body
  },
})

const cache = new Map()
const opts = {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
  globals: {
    window: w,
    document: w.document,
    HTMLElement: w.HTMLElement,
    KeyboardEvent: w.KeyboardEvent,
    crypto: webcrypto,
  },
  cache,
}

const { ToastProvider } = loadSrcModule('src/components/ui/Toast.tsx', opts)
const { JobsPipelinePanel } = loadSrcModule(
  'src/features/workspaces/dispatch-jobs/JobsPipelinePanel.tsx',
  opts,
)

const fixtureJob = {
  id: jobId,
  workspace_id: wsId,
  customer_id: null,
  title: 'Checklist Fixture Job',
  status: 'in_progress',
  priority: 'normal',
  assigned_to: null,
  notes: null,
  checklist: [
    { title: 'Incomplete step one', done: false },
    { title: 'Incomplete step two', done: false },
    { title: 'Completed step three', done: true },
  ],
  labor_total: 120,
  revision: 1,
  service_details: {},
  recurring_plan_id: null,
  recurring_due: null,
  approved_at: null,
  approval_evidence: null,
  completed_at: null,
  invoice_id: null,
  created_at: '2026-11-15T10:00:00Z',
  updated_at: '2026-11-15T10:00:00Z',
}

const root = createRoot(w.document.getElementById('root'))
try {
  await act(async () => {
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(JobsPipelinePanel, {
          workspaceId: wsId,
          jobs: [fixtureJob],
          jobMaterials: [],
          attachments: [],
          inventoryItems: [],
          customers: [],
          customersById: new Map(),
          teamMembers: [],
          onOpenScheduleForJob: () => {},
          onJobsChanged: () => {},
        }),
      ),
    )
  })

  // Open Manage Job drawer
  const manageBtn = [...w.document.querySelectorAll('button')].find(b =>
    b.textContent.includes('Manage Job'),
  )
  assert.ok(manageBtn)
  await act(async () => {
    manageBtn.click()
    await new Promise(r => setTimeout(r, 20))
  })

  // Attempting to complete while checklist steps are incomplete must NOT invoke ops_command('job_transition')
  const completeBtn = [...w.document.querySelectorAll('button')].find(b =>
    b.textContent.includes('Complete Job & Draft Invoice'),
  )
  assert.ok(completeBtn)
  await act(async () => {
    completeBtn.click()
  })
  assert.equal(rpcCalls.length, 0, 'Incomplete checklist must block job completion')

  // Toggling ONLY the first checklist item preserves the remaining incomplete step (`Incomplete step two` stays done: false)
  const stepOneBtn = [...w.document.querySelectorAll('button')].find(b =>
    b.textContent.includes('Incomplete step one'),
  )
  assert.ok(stepOneBtn)
  await act(async () => {
    stepOneBtn.click()
  })

  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].args.p_action, 'job_update')
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0].args.p_payload.checklist)), [
    { title: 'Incomplete step one', done: true },
    { title: 'Incomplete step two', done: false },
    { title: 'Completed step three', done: true },
  ])
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Coordination DOM regressions passed: incomplete checklists preserved and completion guarded.')
