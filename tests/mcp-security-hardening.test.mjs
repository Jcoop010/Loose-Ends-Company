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
  inventory_items: [
    ...Array.from({ length: 11 }, (_, idx) => ({
      id: `sku-a-${idx + 1}`,
      workspace_id: wsA,
      sku: `PART-${String(idx + 1).padStart(2, '0')}`,
      name: `Part ${idx + 1}`,
      location: 'Bay A',
      bin_code: `A-${idx + 1}`,
      preferred_vendor: 'Apex Industrial',
      lead_time_days: 5,
      on_hand_qty: 2,
      reserved_qty: 0,
      reorder_point_qty: 5,
      reorder_qty: 10,
      unit_cost_cents: 1500,
      quantity: 2,
      reserved: 0,
      reorder_threshold: 5,
      reorder_quantity: 10,
      purchase_cost: 15,
      archived: false,
      created_at: '2026-11-18T08:00:00Z',
    })),
    {
      id: 'sku-b-1',
      workspace_id: wsB,
      sku: 'SECRET-B',
      name: 'Other Workspace Secret Part',
      on_hand_qty: 0,
      reserved_qty: 0,
      reorder_point_qty: 10,
      reorder_qty: 50,
      unit_cost_cents: 99900,
      quantity: 0,
      reserved: 0,
      reorder_threshold: 10,
      reorder_quantity: 50,
      purchase_cost: 999,
      archived: false,
      created_at: '2026-11-18T08:00:00Z',
    },
  ],
  ops_purchase_orders: [],
  purchase_orders: [],
  purchase_order_items: [],
  goods_receipts: [],
  vendor_bills: [
    {
      id: 'vb-a-clean',
      workspace_id: wsA,
      po_id: null,
      vendor_name: 'Apex Industrial',
      invoice_number: 'VB-A-100',
      total_cents: 150000,
      due_date: '2026-12-01',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      created_at: '2026-11-18T09:00:00Z',
    },
    {
      id: 'vb-a-disputed',
      workspace_id: wsA,
      po_id: null,
      vendor_name: 'Apex Industrial',
      invoice_number: 'VB-A-DISPUTED',
      total_cents: 460000,
      due_date: '2026-12-01',
      items_json: [],
      match_status: 'disputed',
      match_variance_cents: 124000,
      created_at: '2026-11-18T09:30:00Z',
    },
    {
      id: 'vb-b-secret',
      workspace_id: wsB,
      po_id: null,
      vendor_name: 'Secret Supplier',
      invoice_number: 'VB-B-999',
      total_cents: 88888800,
      due_date: '2026-12-01',
      items_json: [],
      match_status: 'matched_clean',
      match_variance_cents: 0,
      created_at: '2026-11-18T09:30:00Z',
    },
  ],
  ledger_entries: [
    {
      id: 'le-a-1',
      workspace_id: wsA,
      entry_type: 'revenue',
      category: 'Sales',
      description: 'Retainer batch',
      amount_cents: 800000,
      occurred_on: '2026-11-10',
      created_at: '2026-11-10T09:00:00Z',
    },
    {
      id: 'le-a-2',
      workspace_id: wsA,
      entry_type: 'cogs',
      category: 'Materials',
      description: 'Parts order',
      amount_cents: 200000,
      occurred_on: '2026-11-12',
      created_at: '2026-11-12T09:00:00Z',
    },
    {
      id: 'le-b-secret',
      workspace_id: wsB,
      entry_type: 'revenue',
      category: 'Other Tenant',
      description: 'Secret B',
      amount_cents: 99999900,
      occurred_on: '2026-11-12',
      created_at: '2026-11-12T09:00:00Z',
    },
  ],
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
  workspace_settings: [
    {
      workspace_id: wsA,
      modules_enabled: { crm: true, quotes: true, billing: true, inventory: false, bookkeeping: false, projects: false, vault: true },
      autonomy_rules: {
        send_quote_followup: 'approve_1tap',
        convert_signed_quote_to_invoice: 'full_auto',
        send_invoice_reminder: 'approve_1tap',
        flag_overdue_ar: 'full_auto',
      },
      auto_limit_cents: 75000,
    },
    {
      workspace_id: wsB,
      modules_enabled: { crm: true },
      autonomy_rules: { convert_signed_quote_to_invoice: 'manual' },
      auto_limit_cents: 10000,
    },
  ],
  quotes: [],
  quote_items: [],
  compliance_vault_items: [
    ...Array.from({ length: 11 }, (_, idx) => ({
      id: `cv-a-${idx + 1}`,
      workspace_id: wsA,
      doc_type: 'saas_renewal',
      title: `Vendor Contract ${idx + 1}`,
      counterparty: 'CloudRoute Inc.',
      expires_on: '2026-12-10',
      notice_window_days: 45,
      annual_value_cents: 120000,
      status: 'active',
      notes: null,
      created_at: '2026-11-18T08:00:00Z',
    })),
    {
      id: 'cv-b-1',
      workspace_id: wsB,
      doc_type: 'coi',
      title: 'Other Workspace Secret COI',
      counterparty: 'Secret Insurer',
      expires_on: '2026-11-25',
      notice_window_days: 45,
      annual_value_cents: 9999900,
      status: 'active',
      notes: null,
      created_at: '2026-11-18T08:00:00Z',
    },
  ],
  living_sops: [
    {
      id: 'sop-b-1',
      workspace_id: wsB,
      module_key: 'vault',
      title: 'Secret B SOP',
      trigger_event: 'secret.event',
      steps_json: ['Secret Step'],
      version: 1,
      auto_generated: true,
      last_observed_at: '2026-11-18T08:00:00Z',
    },
  ],
  shadow_sessions: [
    {
      id: 'sh-a-1',
      workspace_id: wsA,
      source_system: 'quickbooks',
      file_name: 'qbo_nov2026.csv',
      row_count: 11,
      total_leak_cents: 485000,
      status: 'ready',
      created_at: '2026-11-22T10:00:00Z',
    },
    {
      id: 'sh-b-secret',
      workspace_id: wsB,
      source_system: 'stripe',
      file_name: 'secret_b.csv',
      row_count: 25,
      total_leak_cents: 9999900,
      status: 'ready',
      created_at: '2026-11-22T11:00:00Z',
    },
  ],
  shadow_findings: [
    ...Array.from({ length: 11 }, (_, idx) => ({
      id: `sf-a-${idx + 1}`,
      workspace_id: wsA,
      session_id: 'sh-a-1',
      category: idx % 2 === 0 ? 'overdue_ar' : 'unbilled_quote',
      counterparty: `Shadow Client ${idx + 1}`,
      amount_cents: idx === 0 ? 185000 : 30000,
      proof_summary: `Proof summary row ${idx + 1}`,
      status: 'open',
      created_at: '2026-11-22T10:00:00Z',
    })),
    {
      id: 'sf-b-secret',
      workspace_id: wsB,
      session_id: 'sh-b-secret',
      category: 'duplicate_vendor_charge',
      counterparty: 'Other Tenant Secret Vendor',
      amount_cents: 9999900,
      proof_summary: 'Secret tenant finding',
      status: 'open',
      created_at: '2026-11-22T11:00:00Z',
    },
  ],
  collection_touches: [
    ...Array.from({ length: 11 }, (_, idx) => ({
      id: `col-a-${idx + 1}`,
      workspace_id: wsA,
      invoice_id: `inv-a-${idx + 1}`,
      stage: idx === 0 ? 'day_21_owner_escalation' : idx < 4 ? 'day_10_split_offer' : 'day_3_nudge',
      status: idx === 10 ? 'paused_paid' : 'staged',
      amount_due_cents: 25000,
      portal_url: `/portal/qpt_demo_${idx + 1}`,
      proof_summary: `Overdue touch proof ${idx + 1}`,
      created_at: '2026-11-22T09:00:00Z',
    })),
    {
      id: 'col-b-secret',
      workspace_id: wsB,
      invoice_id: 'inv-b-secret',
      stage: 'day_21_owner_escalation',
      status: 'staged',
      amount_due_cents: 9999900,
      portal_url: '/portal/secret_b',
      proof_summary: 'Secret tenant touch',
      created_at: '2026-11-22T10:00:00Z',
    },
  ],
  invoices: [
    ...Array.from({ length: 11 }, (_, idx) => ({
      id: `inv-a-${idx + 1}`,
      workspace_id: wsA,
      invoice_number: `INV-A${idx + 1}`,
      title: `Invoice ${idx + 1}`,
      customer_name: 'Northstar Agency',
      total_cents: 25000,
      amount_paid_cents: 0,
      due_date: '2026-11-01',
      status: 'overdue',
      created_at: `2026-11-18T0${idx % 9}:00:00Z`,
    })),
    {
      id: 'inv-a-paid',
      workspace_id: wsA,
      invoice_number: 'INV-A-PAID',
      title: 'Paid Sprint',
      customer_name: 'Summit Dental',
      total_cents: 50000,
      amount_paid_cents: 50000,
      due_date: '2026-11-01',
      status: 'paid',
      created_at: '2026-11-18T11:00:00Z',
    },
    {
      id: 'inv-b-1',
      workspace_id: wsB,
      invoice_number: 'INV-B1',
      title: 'Other Tenant Invoice',
      customer_name: 'Secret Co',
      total_cents: 999900,
      amount_paid_cents: 0,
      due_date: '2026-11-01',
      status: 'overdue',
      created_at: '2026-11-19T11:00:00Z',
    },
  ],
  invoice_items: [],
  agent_action_ledger: [],
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
          const conflictCols = String(upsertOpts?.onConflict ?? 'workspace_id,business')
            .split(',')
            .map(c => c.trim())
            .filter(Boolean)
          const existingIdx = rows.findIndex(r =>
            conflictCols.every(col => r[col] === item[col]),
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

// B. initialize returns v2.4.0 and tools/list returns all 27 tools including Release 4A CPA & Collections tools
const initRes = await callMcp(rawTokenA, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'qa-client', version: '1.0.0' },
})
assert.equal(initRes.status, 200)
assert.equal(initRes.json.result.serverInfo.version, '2.4.0')

const listRes = await callMcp(rawTokenA, 'tools/list')
assert.equal(listRes.status, 200)
const toolNames = listRes.json.result.tools.map(t => t.name)
assert.equal(toolNames.length, 27)
for (const reqTool of [
  'ops_readiness_audits',
  'save_ops_readiness_audit',
  'list_ops_readiness_audits',
  'dismiss_communication_draft',
  'create_quote_draft',
  'list_ar_summary',
  'get_autonomy_rules',
  'log_agent_action',
  'check_low_stock_skus',
  'stage_purchase_order',
  'run_three_way_match',
  'get_cashflow_summary',
  'list_expiring_compliance',
  'stage_compliance_notice',
  'upsert_living_sop',
  'get_shadow_leak_summary',
  'get_cpa_audit_summary',
  'get_collections_queue',
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

// F3. dismiss_communication_draft scope, idempotency & sent protection
const roDismissAttempt = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'dismiss_communication_draft',
  arguments: { draft_id: leadDraftRef.id },
})
assert.equal(roDismissAttempt.status, 403)
assert.match(roDismissAttempt.json.error.message, /stage_actions/)

const dismiss1 = await callMcp(rawTokenA, 'tools/call', {
  name: 'dismiss_communication_draft',
  arguments: { draft_id: leadDraftRef.id, reason: 'Older outreach template' },
})
assert.equal(dismiss1.status, 200)
const dismiss1Sc = dismiss1.json.result.structuredContent
assert.equal(dismiss1Sc.dismissed, true)
assert.equal(dismiss1Sc.already_dismissed, false)
assert.equal(dismiss1Sc.status, 'rejected')
assert.equal(leadDraftRef.status, 'rejected')

const dismiss2 = await callMcp(rawTokenA, 'tools/call', {
  name: 'dismiss_communication_draft',
  arguments: { draft_id: leadDraftRef.id },
})
assert.equal(dismiss2.status, 200)
assert.equal(dismiss2.json.result.structuredContent.already_dismissed, true)

const missingDismiss = await callMcp(rawTokenA, 'tools/call', {
  name: 'dismiss_communication_draft',
  arguments: { draft_id: '00000000-0000-4000-8000-000000000000' },
})
assert.equal(missingDismiss.status, 400)
assert.match(missingDismiss.json.error.message, /draft_id not found in authenticated workspace/)

leadDraftRef.delivery_status = 'sent'
const sentDismissAttempt = await callMcp(rawTokenA, 'tools/call', {
  name: 'dismiss_communication_draft',
  arguments: { draft_id: leadDraftRef.id },
})
assert.equal(sentDismissAttempt.status, 400)
assert.match(sentDismissAttempt.json.error.message, /Sent communication drafts cannot be dismissed/)
leadDraftRef.delivery_status = 'not_sent'
leadDraftRef.status = 'draft'

// F4. Release 1 MCP v2.0.0 tools: create_quote_draft, list_ar_summary (limit<=10), get_autonomy_rules, log_agent_action
const createdQuote = await callMcp(rawTokenA, 'tools/call', {
  name: 'create_quote_draft',
  arguments: {
    title: 'Northstar Automation Retainer',
    customer_name: 'Northstar Agency',
    customer_email: 'ops@northstar.invalid',
    lead_id: 'lead-a1',
    tax_bps: 750,
    items: [
      { description: 'Portal Onboarding', quantity: 2, unit_price_cents: 15000 },
      { description: 'AR Automation', quantity: 1, unit_price_cents: 10000 },
    ],
  },
})
assert.equal(createdQuote.status, 200)
const quoteSc = createdQuote.json.result.structuredContent
assert.equal(quoteSc.quote.subtotal_cents, 40000)
assert.equal(quoteSc.quote.tax_cents, 3000)
assert.equal(quoteSc.quote.total_cents, 43000)
assert.equal(quoteSc.items.length, 2)
assert.match(quoteSc.portal_path, /^\/portal\/qpt_/)

const crossWsQuote = await callMcp(rawTokenA, 'tools/call', {
  name: 'create_quote_draft',
  arguments: {
    title: 'Cross-tenant quote attempt',
    customer_name: 'Hacker Co',
    lead_id: 'lead-b1',
    items: [{ description: 'Item', quantity: 1, unit_price_cents: 100 }],
  },
})
assert.equal(crossWsQuote.status, 400)
assert.match(crossWsQuote.json.error.message, /lead_id not found in authenticated workspace/)

const arSummaryRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'list_ar_summary',
  arguments: { limit: 99 }, // must clamp strictly to 10
})
assert.equal(arSummaryRes.status, 200)
const arSc = arSummaryRes.json.result.structuredContent
assert.equal(arSc.invoices.length, 10, 'list_ar_summary must cap invoices list at <= 10')
assert.equal(arSc.total_billed_cents, 11 * 25000 + 50000)
assert.equal(arSc.total_collected_cents, 50000)
assert.equal(arSc.overdue_ar_cents, 11 * 25000)
assert.equal(arSc.overdue_count, 11)
assert.equal(
  arSc.invoices.some(i => i.id === 'inv-b-1'),
  false,
  'Cross-workspace invoices must never appear in list_ar_summary',
)

const autonomyRulesRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'get_autonomy_rules',
  arguments: {},
})
assert.equal(autonomyRulesRes.status, 200)
assert.equal(autonomyRulesRes.json.result.structuredContent.auto_limit_cents, 75000)
assert.equal(
  autonomyRulesRes.json.result.structuredContent.autonomy_rules.convert_signed_quote_to_invoice,
  'full_auto',
)

const roLogAttempt = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'log_agent_action',
  arguments: {
    agent_name: 'QA Bot',
    module: 'billing',
    action_type: 'test',
    autonomy_mode: 'full_auto',
    summary: 'Should fail scope check',
    impact_cents: 100,
  },
})
assert.equal(roLogAttempt.status, 403)

const loggedActionRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'log_agent_action',
  arguments: {
    agent_name: 'Quote Agent',
    module: 'quotes',
    action_type: 'create_quote_draft',
    autonomy_mode: 'approve_1tap',
    summary: 'Created Northstar Automation Retainer quote',
    impact_cents: 43000,
    before_state: { quote_id: null },
    after_state: { quote_id: quoteSc.quote.id },
  },
})
assert.equal(loggedActionRes.status, 200)
assert.equal(loggedActionRes.json.result.structuredContent.ledger_entry.impact_cents, 43000)

// F5. Release 2 MCP v2.1.0 tools: check_low_stock_skus (<=10), stage_purchase_order, run_three_way_match, get_cashflow_summary
const lowStockRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'check_low_stock_skus',
  arguments: { limit: 50 },
})
assert.equal(lowStockRes.status, 200)
const lowStockSc = lowStockRes.json.result.structuredContent
assert.equal(lowStockSc.low_stock_count, 11)
assert.equal(lowStockSc.items.length, 10, 'check_low_stock_skus must clamp strictly <= 10')
assert.equal(lowStockSc.items.some(i => i.sku === 'SECRET-B'), false)

const roStagePoAttempt = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'stage_purchase_order',
  arguments: {
    vendor_name: 'Apex Industrial',
    items: [{ sku: 'PART-01', ordered_qty: 10, unit_cost_cents: 1500 }],
  },
})
assert.equal(roStagePoAttempt.status, 403)

const stagePoRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'stage_purchase_order',
  arguments: {
    vendor_name: 'Apex Industrial',
    po_number: 'PO-MCP-01',
    items: [{ sku: 'PART-01', ordered_qty: 10, unit_cost_cents: 1500 }],
  },
})
assert.equal(stagePoRes.status, 200)
assert.equal(stagePoRes.json.result.structuredContent.purchase_order.total_cents, 15000)

const threeWayRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'run_three_way_match',
  arguments: {
    po_number: 'PO-4088',
    vendor_name: 'Apex Industrial Supply',
    invoice_number: 'VB-9042',
    tolerance_bps: 200,
    po_items: [{ sku: 'VALVE-42', ordered_qty: 100, unit_cost_cents: 4200 }],
    receipt_items: [{ sku: 'VALVE-42', received_qty: 80, damaged_qty: 0 }],
    bill_items: [{ sku: 'VALVE-42', quantity: 100, unit_cost_cents: 4600 }],
  },
})
assert.equal(threeWayRes.status, 200)
const threeWaySc = threeWayRes.json.result.structuredContent
assert.equal(threeWaySc.match_status, 'exception_flagged')
assert.equal(threeWaySc.match_variance_cents, 124000)
assert.equal(threeWaySc.vendor_dispute_draft.requires_approval, true)

const cashflowRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'get_cashflow_summary',
  arguments: {
    as_of_date: '2026-11-20',
    safety_buffer_cents: 500000,
  },
})
assert.equal(cashflowRes.status, 200)
const cashflowSc = cashflowRes.json.result.structuredContent
assert.equal(cashflowSc.net_ledger_cashflow_cents, 600000)
assert.equal(cashflowSc.held_disputed_ap_cents, 460000)
assert.equal(cashflowSc.total_scheduled_ap_cents, 150000)
assert.equal(cashflowSc.windows.length, 3)

// F6. Release 3 MCP v2.2.0 tools: list_expiring_compliance (<=10), stage_compliance_notice, upsert_living_sop
const complianceRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'list_expiring_compliance',
  arguments: { reference_date: '2026-11-20', limit: 99 },
})
assert.equal(complianceRes.status, 200)
const compSc = complianceRes.json.result.structuredContent
assert.equal(compSc.expiring_count, 11)
assert.equal(compSc.items.length, 10, 'list_expiring_compliance must clamp strictly <= 10')
assert.equal(compSc.items.some(i => i.id === 'cv-b-1'), false)

const roNoticeAttempt = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'stage_compliance_notice',
  arguments: { vault_item_id: 'cv-a-1' },
})
assert.equal(roNoticeAttempt.status, 403)

const crossWsNoticeAttempt = await callMcp(rawTokenA, 'tools/call', {
  name: 'stage_compliance_notice',
  arguments: { vault_item_id: 'cv-b-1' },
})
assert.equal(crossWsNoticeAttempt.status, 400)
assert.match(crossWsNoticeAttempt.json.error.message, /vault_item_id not found/)

const noticeRes = await callMcp(rawTokenA, 'tools/call', {
  name: 'stage_compliance_notice',
  arguments: {
    vault_item_id: 'cv-a-1',
    notice_kind: 'cancellation',
    recipient_email: 'renewals@cloudroute.invalid',
  },
})
assert.equal(noticeRes.status, 200)
const noticeSc = noticeRes.json.result.structuredContent
assert.equal(noticeSc.vault_item.status, 'notice_staged')
assert.equal(noticeSc.communication_draft.requires_approval, true)
assert.equal(noticeSc.communication_draft.status, 'draft')
assert.match(noticeSc.communication_draft.message, /421 Hill Street, Parkersburg, WV 26104/)

const sop1Res = await callMcp(rawTokenA, 'tools/call', {
  name: 'upsert_living_sop',
  arguments: {
    module_key: 'quotes',
    title: 'Portal Auto Conversion SOP',
    trigger_event: 'quote.portal_signed',
    steps: ['Validate token', 'Convert to invoice'],
  },
})
assert.equal(sop1Res.status, 200)
assert.equal(sop1Res.json.result.structuredContent.version, 1)
assert.equal(sop1Res.json.result.structuredContent.created, true)

const sop2Res = await callMcp(rawTokenA, 'tools/call', {
  name: 'upsert_living_sop',
  arguments: {
    module_key: 'quotes',
    title: 'Portal Auto Conversion SOP',
    trigger_event: 'quote.portal_signed',
    steps: ['Validate token', 'Check Autonomy Cap', 'Convert to invoice'],
  },
})
assert.equal(sop2Res.status, 200)
assert.equal(sop2Res.json.result.structuredContent.version, 2)
assert.equal(sop2Res.json.result.structuredContent.created, false)

const shadowSummaryRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'get_shadow_leak_summary',
  arguments: { limit: 10 },
})
assert.equal(shadowSummaryRes.status, 200)
const shadowSc = shadowSummaryRes.json.result.structuredContent
assert.equal(shadowSc.workspace_id, wsA)
assert.equal(shadowSc.total_leak_cents, 485000)
assert.equal(shadowSc.open_finding_count, 11)
assert.equal(shadowSc.findings.length, 10, 'get_shadow_leak_summary must strictly cap findings at <= 10')
assert.ok(shadowSc.findings.every(f => f.workspace_id === wsA && typeof f.proof_summary === 'string'))

const cpaAuditRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'get_cpa_audit_summary',
  arguments: { opening_cash_cents: 1000000 },
})
assert.equal(cpaAuditRes.status, 200)
const cpaSc = cpaAuditRes.json.result.structuredContent
assert.equal(cpaSc.workspace_id, wsA)
assert.equal(cpaSc.trial_balance.variance_cents, 0, 'CPA trial balance must reconcile with 0c variance')
assert.equal(cpaSc.trial_balance.is_balanced, true)
assert.equal(cpaSc.balance_sheet.is_balanced, true)

const collectionsRes = await callMcp(rawTokenAReadOnly, 'tools/call', {
  name: 'get_collections_queue',
  arguments: { limit: 10 },
})
assert.equal(collectionsRes.status, 200)
const colSc = collectionsRes.json.result.structuredContent
assert.equal(colSc.workspace_id, wsA)
assert.equal(colSc.total_touch_count, 11)
assert.equal(colSc.total_staged_cents, 250000)
assert.equal(colSc.touches.length, 10, 'get_collections_queue must strictly cap touches at <= 10')
assert.ok(colSc.touches.every(t => t.workspace_id === wsA))

// G. Verify EVERY non-token DB query since test start filtered by workspace_id = wsA
const workspaceTables = new Set([
  'public_leads',
  'ops_communication_drafts',
  'opportunities',
  'documents',
  'ops_jobs',
  'inventory_items',
  'ops_purchase_orders',
  'purchase_orders',
  'purchase_order_items',
  'goods_receipts',
  'vendor_bills',
  'ledger_entries',
  'compliance_vault_items',
  'living_sops',
  'shadow_sessions',
  'shadow_findings',
  'collection_touches',
  'ops_readiness_audits',
  'staged_ops_actions',
  'staged_ledger_entries',
  'customer_contact_consent_events',
  'customers',
  'bot_manuals',
  'bot_runs',
  'workspace_settings',
  'quotes',
  'quote_items',
  'invoices',
  'invoice_items',
  'agent_action_ledger',
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
