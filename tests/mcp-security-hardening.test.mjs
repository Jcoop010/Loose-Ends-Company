import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const mcpSource = readFileSync(
  new URL('../supabase/functions/loose-ends-mcp/index.ts', import.meta.url),
  'utf8',
)
const migrationSource = readFileSync(
  new URL('../supabase/migrations/20261119120000_create_grok_bot_mcp_layer.sql', import.meta.url),
  'utf8',
)
const scoutSource = readFileSync(
  new URL('../scripts/scoutProspects.ts', import.meta.url),
  'utf8',
)

// 1. Static zero-any & SQL hardening invariants
const mcpCodeOnly = mcpSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
assert.equal(
  /(:\s*any\b|\bas\s+any\b|<any>|Array<\s*any\s*>)/.test(mcpCodeOnly),
  false,
  'loose-ends-mcp/index.ts must contain zero TypeScript any escapes',
)

assert.match(migrationSource, /create or replace function public\.is_workspace_owner/i)
assert.match(migrationSource, /add column if not exists role text/i)
assert.match(migrationSource, /add column if not exists owner_user_id uuid/i)
assert.match(migrationSource, /drop policy if exists "workspace members can create mcp tokens"/i)
assert.match(migrationSource, /drop policy if exists "workspace members can revoke mcp tokens"/i)
assert.match(
  migrationSource,
  /create policy "workspace owners can create mcp tokens"[\s\S]*public\.is_workspace_owner\(workspace_id\)/i,
)
assert.match(
  migrationSource,
  /create policy "workspace owners can update mcp tokens"[\s\S]*public\.is_workspace_owner\(workspace_id\)/i,
)
assert.match(
  migrationSource,
  /create policy "workspace owners can delete mcp tokens"[\s\S]*public\.is_workspace_owner\(workspace_id\)/i,
)
assert.match(migrationSource, /partition by workspace_id, business/i)
assert.match(migrationSource, /drop constraint if exists public_leads_business_key/i)
assert.match(
  migrationSource,
  /create unique index if not exists public_leads_workspace_business_idx\s+on public\.public_leads \(workspace_id, business\)/i,
)
assert.match(
  scoutSource,
  /onConflict:\s*'workspace_id,business'/,
  'scoutProspects.ts must upsert public_leads using composite (workspace_id,business)',
)

// 2. Transpile and mount Edge Function in isolated VM context with mock Supabase
const compiled = ts.transpileModule(mcpSource.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, ''), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText

const wsA = '11111111-1111-4111-8111-111111111111'
const wsB = '22222222-2222-4222-8222-222222222222'
const rawTokenA = 'le_mcp_test_workspace_a_secret_token'
const rawTokenAReadOnly = 'le_mcp_test_workspace_a_readonly'

function sha256(val) {
  return createHash('sha256').update(val).digest('hex')
}

const queryLog = []
let simulateConsentDbError = false
const state = {
  workspace_mcp_tokens: [
    {
      id: 'tok-a',
      workspace_id: wsA,
      label: 'Owner Full Token',
      token_hash: sha256(rawTokenA),
      scopes: ['read_all', 'stage_actions'],
      revoked_at: null,
    },
    {
      id: 'tok-a-ro',
      workspace_id: wsA,
      label: 'Read Only Token',
      token_hash: sha256(rawTokenAReadOnly),
      scopes: ['read_all'],
      revoked_at: null,
    },
  ],
  public_leads: [
    {
      id: 'lead-a1',
      workspace_id: wsA,
      business: 'Kanawha HVAC',
      industry: 'HVAC',
      location: 'Charleston, WV',
      website: 'https://kanawha.invalid',
      score: 91,
      status: 'DRAFT_READY',
      created_at: '2026-11-18T10:00:00Z',
    },
    {
      id: 'lead-b1',
      workspace_id: wsB,
      business: 'Other Workspace Plumbing',
      industry: 'Plumbing',
      location: 'Charlotte, NC',
      website: 'https://other.invalid',
      score: 99,
      status: 'DRAFT_READY',
      created_at: '2026-11-18T11:00:00Z',
    },
  ],
  ops_communication_drafts: [],
  opportunities: [
    { id: 'opp-a1', workspace_id: wsA, title: 'Quote A', status: 'open', amount: 1200, created_at: '2026-11-18T09:00:00Z' },
    { id: 'opp-b1', workspace_id: wsB, title: 'Quote B', status: 'open', amount: 9999, created_at: '2026-11-18T09:00:00Z' },
  ],
  documents: [],
  ops_jobs: [],
  inventory_items: [],
  ops_purchase_orders: [],
  staged_ops_actions: [],
  staged_ledger_entries: [],
  ops_readiness_audits: [
    {
      id: 'audit-b1',
      workspace_id: wsB,
      lead_id: 'lead-b1',
      business_name: 'Other Workspace Plumbing',
      website_url: 'https://other.invalid',
      score_0_100: 50,
      grade: 'D',
      findings: ['Other tenant secret'],
      report_html: '<div>B</div>',
      created_at: '2026-11-18T08:00:00Z',
    },
  ],
  customer_contact_consent_events: [
    {
      id: 'c-b1',
      workspace_id: wsB,
      email: 'owner@kanawha.invalid',
      status: 'opted_out',
      decision: 'revoked',
      created_at: '2026-11-18T08:00:00Z',
    },
  ],
  customers: [],
  bot_manuals: [
    {
      id: 'bm-a1',
      workspace_id: wsA,
      bot_role: 'scout',
      mode: 'propose',
      instructions_markdown: '# Workspace A Scout SOP',
      updated_at: '2026-11-18T07:00:00Z',
    },
    {
      id: 'bm-b1',
      workspace_id: wsB,
      bot_role: 'scout',
      mode: 'propose',
      instructions_markdown: '# Workspace B SECRET SOP',
      updated_at: '2026-11-18T07:00:00Z',
    },
  ],
  bot_runs: [],
}

function createMockSupabase() {
  return {
    from(table) {
      const filters = []
      const inFilters = []
      const ilikeFilters = []
      const isFilters = []
      const gteFilters = []
      let op = 'select'
      let selectOpts = null
      let writePayload = null
      let upsertOpts = null
      let orderCol = null
      let orderAsc = true
      let limitVal = null

      const recordQuery = () => {
        queryLog.push({
          table,
          op,
          filters: [...filters],
          inFilters: [...inFilters],
          upsertOpts,
        })
      }

      const execute = async () => {
        recordQuery()
        if (simulateConsentDbError && table === 'customer_contact_consent_events') {
          return {
            data: null,
            error: { message: 'FATAL internal postgres connection string leak' },
            count: null,
          }
        }

        const rows = state[table] ?? []

        if (op === 'insert') {
          const toInsert = Array.isArray(writePayload) ? writePayload : [writePayload]
          if (table === 'ops_communication_drafts') {
            for (const item of toInsert) {
              if (item.lead_id && rows.some(r => r.lead_id === item.lead_id)) {
                return {
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "ops_drafts_lead_id_unique_idx"',
                  },
                  count: null,
                }
              }
            }
          }
          const created = toInsert.map((item, idx) => ({
            id: item.id ?? `${table}-new-${rows.length + idx + 1}`,
            created_at: item.created_at ?? `2026-11-18T12:00:0${rows.length + idx}Z`,
            ...item,
          }))
          rows.push(...created)
          return { data: created, error: null, count: created.length }
        }

        if (op === 'upsert') {
          const item = { ...writePayload }
          const existingIdx = rows.findIndex(
            r => r.workspace_id === item.workspace_id && r.business === item.business,
          )
          let saved
          if (existingIdx >= 0) {
            saved = { ...rows[existingIdx], ...item }
            rows[existingIdx] = saved
          } else {
            saved = {
              id: `${table}-new-${rows.length + 1}`,
              created_at: '2026-11-18T12:10:00Z',
              ...item,
            }
            rows.push(saved)
          }
          return { data: [saved], error: null, count: 1 }
        }

        if (op === 'update') {
          const matched = rows.filter(r =>
            filters.every(([k, v]) => r[k] === v),
          )
          for (const row of matched) {
            Object.assign(row, writePayload)
          }
          return { data: matched, error: null, count: matched.length }
        }

        let result = rows.filter(r => {
          if (!filters.every(([k, v]) => r[k] === v)) return false
          if (!inFilters.every(([k, arr]) => arr.includes(r[k]))) return false
          if (!ilikeFilters.every(([k, v]) => String(r[k] ?? '').toLowerCase() === String(v).toLowerCase())) return false
          if (!isFilters.every(([k, v]) => (v === null ? r[k] === null : r[k] === v))) return false
          if (!gteFilters.every(([k, v]) => Number(r[k] ?? 0) >= Number(v))) return false
          return true
        })

        if (orderCol) {
          result = [...result].sort((a, b) => {
            const av = a[orderCol]
            const bv = b[orderCol]
            if (av === bv) return 0
            if (av === undefined || av === null) return 1
            if (bv === undefined || bv === null) return -1
            return orderAsc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1
          })
        }

        const totalCount = result.length
        if (typeof limitVal === 'number') {
          result = result.slice(0, limitVal)
        }

        if (selectOpts?.head) {
          return { data: null, error: null, count: totalCount }
        }
        return { data: result, error: null, count: totalCount }
      }

      const builder = {
        select(_cols, opts) {
          selectOpts = opts ?? null
          return builder
        },
        insert(payload) {
          op = 'insert'
          writePayload = payload
          return builder
        },
        upsert(payload, opts) {
          op = 'upsert'
          writePayload = payload
          upsertOpts = opts ?? null
          return builder
        },
        update(payload) {
          op = 'update'
          writePayload = payload
          return builder
        },
        eq(col, val) {
          filters.push([col, val])
          return builder
        },
        in(col, vals) {
          inFilters.push([col, vals])
          return builder
        },
        ilike(col, val) {
          ilikeFilters.push([col, val])
          return builder
        },
        is(col, val) {
          isFilters.push([col, val])
          return builder
        },
        gte(col, val) {
          gteFilters.push([col, val])
          return builder
        },
        order(col, opts) {
          orderCol = col
          orderAsc = opts?.ascending !== false
          return builder
        },
        limit(n) {
          limitVal = n
          return builder
        },
        async maybeSingle() {
          const res = await execute()
          return { data: res.data?.[0] ?? null, error: res.error, count: res.count }
        },
        async single() {
          const res = await execute()
          if (res.error) return res
          return { data: res.data?.[0] ?? null, error: null, count: res.count }
        },
        then(onFulfilled, onRejected) {
          return execute().then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }
}

let handler
const vmContext = {
  Deno: {
    env: {
      get: key =>
        key === 'SUPABASE_URL'
          ? 'https://example.invalid'
          : key === 'SUPABASE_SERVICE_ROLE_KEY'
            ? 'mock-service-role'
            : undefined,
    },
    serve: fn => {
      handler = fn
    },
  },
  createClient: () => createMockSupabase(),
  Request,
  Response,
  Headers,
  TextEncoder,
  crypto: globalThis.crypto,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Date,
  Math,
  Promise,
  Error,
  console,
}

runInNewContext(compiled, vmContext)
assert.equal(typeof handler, 'function')

async function callMcp(token, method, params = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await handler(
    new Request('https://example.invalid/functions/v1/loose-ends-mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const json = await res.json()
  return { status: res.status, json }
}

// A. Missing & invalid tokens rejected with 401
assert.equal((await callMcp(null, 'tools/list')).status, 401)
assert.equal((await callMcp('bad_token', 'tools/list')).status, 401)

// B. tools/list returns all 12 tools including all 3 ops_readiness_audits tools
const listRes = await callMcp(rawTokenA, 'tools/list')
assert.equal(listRes.status, 200)
const toolNames = listRes.json.result.tools.map(t => t.name)
assert.equal(toolNames.length, 12)
for (const reqTool of [
  'ops_readiness_audits',
  'save_ops_readiness_audit',
  'list_ops_readiness_audits',
]) {
  assert.ok(toolNames.includes(reqTool), `Missing required tool: ${reqTool}`)
}
const botManualTool = listRes.json.result.tools.find(t => t.name === 'get_bot_manual')
assert.ok(botManualTool)
assert.ok(!botManualTool.inputSchema.required || botManualTool.inputSchema.required.length === 0)
assert.ok(botManualTool.inputSchema.properties.role)
assert.ok(botManualTool.inputSchema.properties.bot_role)

// C. Scope enforcement: read-only token blocked from staging/write tools with 403
const roWriteAttempt = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'save_ops_readiness_audit',
  arguments: {
    business_name: 'Test',
    score_0_100: 88,
    grade: 'A',
    findings: ['Clean'],
  },
})
assert.equal(roWriteAttempt.status, 403)
assert.match(roWriteAttempt.json.error.message, /stage_actions/)

// D. Workspace isolation across reads + upsert_public_lead composite conflict target
queryLog.length = 0
const leadsRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'list_public_leads',
  arguments: {},
})
assert.equal(leadsRes.status, 200)
assert.equal(leadsRes.json.result.structuredContent.leads.length, 1)
assert.equal(leadsRes.json.result.structuredContent.leads[0].workspace_id, wsA)

const upsertRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'upsert_public_lead',
  arguments: {
    business: 'Other Workspace Plumbing', // Same name as wsB lead; must NOT overwrite wsB!
    industry: 'Plumbing',
    location: 'Parkersburg, WV',
    website: 'https://wv-plumbing.invalid',
    contact_email: 'owner@wv-plumbing.invalid',
  },
})
assert.equal(upsertRes.status, 200)
assert.equal(upsertRes.json.result.structuredContent.lead.workspace_id, wsA)
assert.equal(state.public_leads.find(l => l.id === 'lead-b1').location, 'Charlotte, NC')
const upsertQuery = queryLog.find(q => q.table === 'public_leads' && q.op === 'upsert')
assert.equal(upsertQuery.upsertOpts?.onConflict, 'workspace_id,business')

// E. Fail-closed consent enforcement (hides raw DB error, blocks draft queuing)
simulateConsentDbError = true
const failedConsentRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'get_customer_consent_status',
  arguments: { email: 'owner@kanawha.invalid' },
})
assert.equal(failedConsentRes.status, 200)
assert.deepEqual(failedConsentRes.json.result.structuredContent, {
  suppressed: true,
  reason: 'consent_verification_unavailable',
  consent_events: [],
})
assert.equal(JSON.stringify(failedConsentRes.json).includes('postgres connection string'), false)

const blockedDraftRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'queue_communication_draft',
  arguments: {
    company_name: 'Kanawha HVAC',
    recipient_email: 'owner@kanawha.invalid',
    subject: 'Hi',
    message: 'Test',
  },
})
assert.equal(blockedDraftRes.status, 400)
assert.match(blockedDraftRes.json.error.message, /consent_verification_unavailable/)
assert.equal(state.ops_communication_drafts.length, 0)
simulateConsentDbError = false

// F. Audit tools + grade breakdown + strict integer validation
const badAudit = await callMcp(rawTokenA, 'tools/call', {
  name: 'save_ops_readiness_audit',
  arguments: {
    business_name: 'Kanawha HVAC',
    score_0_100: 84.5,
    grade: 'B',
    findings: ['Missing checklist'],
  },
})
assert.equal(badAudit.status, 400)

const savedAudit = await callMcp(rawTokenA, 'tools/call', {
  name: 'save_ops_readiness_audit',
  arguments: {
    lead_id: 'lead-a1',
    business_name: 'Kanawha HVAC',
    website_url: 'https://kanawha.invalid',
    score_0_100: 86,
    grade: 'A',
    findings: ['Owner email verified', 'Online booking active'],
  },
})
assert.equal(savedAudit.status, 200)
assert.equal(savedAudit.json.result.structuredContent.audit.workspace_id, wsA)

const summaryAudits = await callMcp(rawTokenA, 'tools/call', {
  name: 'ops_readiness_audits',
  arguments: {},
})
assert.equal(summaryAudits.status, 200)
assert.equal(summaryAudits.json.result.structuredContent.total_audits, 1)
assert.equal(summaryAudits.json.result.structuredContent.average_score, 86)
assert.deepEqual(summaryAudits.json.result.structuredContent.grade_breakdown, {
  A: 1,
  B: 0,
  C: 0,
  D: 0,
})

const badAmountStage = await callMcp(rawTokenA, 'tools/call', {
  name: 'stage_ops_action',
  arguments: {
    bot_role: 'billing',
    workspace_domain: 'billing',
    action_type: 'vendor_bill_audit',
    title: 'Bad float',
    summary: 'Should reject floats',
    amount_cents: 12.34,
  },
})
assert.equal(badAmountStage.status, 400)

// F2. queue_communication_draft lead_id upsert/isolation + get_bot_manual optional role & rubric
const firstLeadDraft = await callMcp(rawTokenA, 'tools/call', {
  name: 'queue_communication_draft',
  arguments: {
    lead_id: 'lead-a1',
    company_name: 'Kanawha HVAC',
    recipient_name: 'Sam',
    recipient_email: 'owner@kanawha.invalid',
    subject: 'Initial ops check for Kanawha HVAC',
    message: 'Hi Sam, check out https://loose-ends-os.vercel.app/demo',
  },
})
assert.equal(firstLeadDraft.status, 200)
const firstDraftSc = firstLeadDraft.json.result.structuredContent
assert.equal(firstDraftSc.action, 'created_draft')
assert.equal(firstDraftSc.lead_id, 'lead-a1')
assert.equal(firstDraftSc.draft.lead_id, 'lead-a1')
assert.equal(firstDraftSc.status, 'draft')
assert.equal(firstDraftSc.delivery_status, 'not_sent')
assert.equal(state.public_leads.find(l => l.id === 'lead-a1').status, 'DRAFT_GENERATED')

// Re-queuing a draft for the same lead_id updates the unsent draft in place cleanly
const secondLeadDraft = await callMcp(rawTokenA, 'tools/call', {
  name: 'queue_communication_draft',
  arguments: {
    lead_id: 'lead-a1',
    company_name: 'Kanawha HVAC',
    recipient_name: 'Sam',
    recipient_email: 'owner@kanawha.invalid',
    subject: 'Updated scorecard note for Kanawha HVAC',
    message: 'Hi Sam, updated scorecard summary with https://loose-ends-os.vercel.app/demo',
  },
})
assert.equal(secondLeadDraft.status, 200)
const secondDraftSc = secondLeadDraft.json.result.structuredContent
assert.equal(secondDraftSc.action, 'updated_existing_draft')
assert.equal(secondDraftSc.lead_id, 'lead-a1')
assert.equal(secondDraftSc.draft.id, firstDraftSc.draft.id)
assert.equal(secondDraftSc.draft.lead_id, 'lead-a1')
assert.equal(secondDraftSc.draft.subject, 'Updated scorecard note for Kanawha HVAC')
assert.equal(secondDraftSc.draft.status, 'draft')
assert.equal(secondDraftSc.draft.delivery_status, 'not_sent')
assert.equal(state.ops_communication_drafts.filter(d => d.lead_id === 'lead-a1').length, 1)

// Cross-workspace lead_id must be rejected
const crossWsLeadDraft = await callMcp(rawTokenA, 'tools/call', {
  name: 'queue_communication_draft',
  arguments: {
    lead_id: 'lead-b1',
    company_name: 'Other Workspace Plumbing',
    recipient_email: 'owner@other.invalid',
    subject: 'Cross tenant attempt',
    message: 'Should fail cleanly',
  },
})
assert.equal(crossWsLeadDraft.status, 400)
assert.match(crossWsLeadDraft.json.error.message, /lead_id not found in authenticated workspace/)

// Already approved/sent draft linked to lead_id must NOT be overwritten
const leadDraftRef = state.ops_communication_drafts.find(d => d.lead_id === 'lead-a1')
leadDraftRef.status = 'approved'
const lockedDraftAttempt = await callMcp(rawTokenA, 'tools/call', {
  name: 'queue_communication_draft',
  arguments: {
    lead_id: 'lead-a1',
    company_name: 'Kanawha HVAC',
    recipient_email: 'owner@kanawha.invalid',
    subject: 'Overwrite approved attempt',
    message: 'Should fail cleanly',
  },
})
assert.equal(lockedDraftAttempt.status, 400)
assert.match(lockedDraftAttempt.json.error.message, /cannot be overwritten/)
leadDraftRef.status = 'draft'

// get_bot_manual with omitted role returns concise workspace role index without leaking wsB
const manualIndexRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'get_bot_manual',
  arguments: {},
})
assert.equal(manualIndexRes.status, 200)
const manualIndexSc = manualIndexRes.json.result.structuredContent
assert.equal(manualIndexSc.read_only, true)
assert.equal(manualIndexSc.available_roles.length, 9)
assert.equal(JSON.stringify(manualIndexSc).includes('Workspace B SECRET SOP'), false)

// get_bot_manual with role='scout' and legacy bot_role='scout' both embed the 100-pt A-D rubric
for (const args of [{ role: 'scout' }, { bot_role: 'scout' }]) {
  const scoutManualRes = await callMcp(rawTokenA, 'tools/call', {
    name: 'get_bot_manual',
    arguments: args,
  })
  assert.equal(scoutManualRes.status, 200)
  const scoutSc = scoutManualRes.json.result.structuredContent
  assert.match(scoutSc.manual.instructions_markdown, /Operations Readiness Grading Rubric/)
  const totalPoints = scoutSc.grading_rubric.categories.reduce(
    (sum, category) => sum + category.max_points,
    0,
  )
  assert.equal(totalPoints, 100)
  assert.deepEqual(scoutSc.grading_rubric.grade_bands, {
    A: '85-100',
    B: '70-84',
    C: '50-69',
    D: '0-49',
  })
}

const badRoleManual = await callMcp(rawTokenA, 'tools/call', {
  name: 'get_bot_manual',
  arguments: { role: 'invalid_role' },
})
assert.equal(badRoleManual.status, 400)

// G. Verify EVERY non-token DB query since test start filtered by workspace_id = wsA
const workspaceTables = new Set([
  'public_leads',
  'ops_communication_drafts',
  'opportunities',
  'documents',
  'ops_jobs',
  'inventory_items',
  'ops_purchase_orders',
  'ops_readiness_audits',
  'staged_ops_actions',
  'staged_ledger_entries',
  'customer_contact_consent_events',
  'customers',
  'bot_manuals',
  'bot_runs',
])
for (const entry of queryLog) {
  if (workspaceTables.has(entry.table) && entry.op !== 'insert' && entry.op !== 'upsert') {
    const wsFilter = entry.filters.find(([col]) => col === 'workspace_id')
    assert.ok(wsFilter, `Expected workspace_id filter on ${entry.table} (${entry.op})`)
    assert.equal(wsFilter[1], wsA, `Cross-workspace leak on ${entry.table}`)
  }
}

// H. Deterministic 64-char state_hash + SILENT_OK on repeated unchanged overview call
const overview1 = await callMcp(rawTokenA, 'tools/call', {
  name: 'get_workspace_overview',
  arguments: {},
})
assert.equal(overview1.status, 200)
const ov1 = overview1.json.result.structuredContent
assert.equal(ov1.status, 'OK')
assert.equal(ov1.unchanged, false)
assert.match(ov1.state_hash, /^[a-f0-9]{64}$/)
assert.equal(ov1.counts.public_leads, 2) // 2 in wsA (excludes wsB)

const overview2 = await callMcp(rawTokenA, 'tools/call', {
  name: 'get_workspace_overview',
  arguments: {},
})
assert.equal(overview2.status, 200)
assert.deepEqual(overview2.json.result.structuredContent, {
  status: 'SILENT_OK',
  unchanged: true,
  workspace_id: wsA,
  state_hash: ov1.state_hash,
})

const overviewForced = await callMcp(rawTokenA, 'tools/call', {
  name: 'get_workspace_overview',
  arguments: { force_full: true },
})
assert.equal(overviewForced.json.result.structuredContent.status, 'OK')
assert.equal(overviewForced.json.result.structuredContent.state_hash, ov1.state_hash)

// Ensure raw bearer token NEVER appears in bot_runs audit trail
const botRunsSerialized = JSON.stringify(state.bot_runs)
assert.equal(botRunsSerialized.includes(rawTokenA), false)
assert.equal(botRunsSerialized.includes(rawTokenAReadOnly), false)

console.log('MCP security hardening, consent fail-closed, audit tools, and SILENT_OK tests passed')
