import assert from 'node:assert/strict'
import { createHmac, webcrypto } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { readSrc } from './helpers/load-src-module.mjs'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const nodeRequire = createRequire(import.meta.url)

// 1. SQL Security & Multi-Tenant RLS Audit Assertions
const migrationSql = readSrc('supabase/migrations/20261125000000_mission09_integrity_security_workforce.sql')
assert.match(migrationSql, /set search_path = public, pg_temp/i)
assert.match(migrationSql, /revoke all on function public\.is_workspace_owner\(uuid\) from public, anon/i)
assert.match(migrationSql, /drop policy if exists "workspace owners delete agent ledger" on public\.agent_action_ledger/i)
assert.match(migrationSql, /workspace_id is null[\s\S]{0,160}status = 'DRAFT_READY'[\s\S]{0,120}call_outcome is null/i)
assert.match(migrationSql, /create policy "workspace owners manage bot manuals"/i)
assert.match(migrationSql, /create policy "workspace owners read mcp tokens"/i)
assert.match(migrationSql, /ops_drafts_lead_step_unique_idx/i)

// 2. MCP Edge Function Security Hardening Source Checks
const mcpSrc = readSrc('supabase/functions/loose-ends-mcp/index.ts')
assert.match(mcpSrc, /tokenRow\.owner_user_id/)
assert.match(mcpSrc, /assertBotNotObserveOnly/)
assert.match(mcpSrc, /function sanitizeAuditHtml/)
assert.match(mcpSrc, /Approved communication drafts cannot be dismissed via MCP/)
assert.match(mcpSrc, /Inline item overrides are forbidden when evaluating a persisted vendor_bill_id/)
assert.match(mcpSrc, /inventory_item_id not found in authenticated workspace/)
assert.match(mcpSrc, /const quoteStatus:\s*"draft" \| "sent"\s*=\s*args\.status === "sent"\s*\?\s*"sent"\s*:\s*"draft"/)
assert.match(mcpSrc, /const status:\s*LedgerStatus\s*=\s*"pending_approval"/)
assert.match(mcpSrc, /\.ilike\("email",\s*email\)/)
assert.match(mcpSrc, /preservedLeadStatuses/)

// 3. CLI Script Security & CAN-SPAM Hardening + Dynamic CAN-SPAM Append Test
const sendDraftsSrc = readSrc('scripts/sendApprovedDrafts.ts')
assert.match(sendDraftsSrc, /cross-workspace broadcast is blocked/i)
assert.match(sendDraftsSrc, /Refusing cleartext HTTP SMTP relay/i)
assert.match(sendDraftsSrc, /\.eq\('workspace_id',\s*workspaceId\)/)
assert.match(sendDraftsSrc, /\.ilike\('email',\s*normalizedEmail\)/)

// Load generateOutreachDrafts.ts dynamically to test ensureCanSpamOutreachFooter
function loadTsScript(relPath, cache = new Map()) {
  const fullPath = path.resolve(repoRoot, relPath)
  if (cache.has(fullPath)) return cache.get(fullPath).exports
  const raw = fs.readFileSync(fullPath, 'utf8')
  const out = ts.transpileModule(raw, {
    fileName: fullPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  cache.set(fullPath, mod)
  const dir = path.dirname(fullPath)
  const customReq = spec => {
    if (spec === '@supabase/supabase-js') {
      return {
        createClient() {
          throw new Error('Unexpected DB access inside air-gapped script test')
        },
      }
    }
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const target = path.resolve(dir, spec)
      return loadTsScript(path.relative(repoRoot, target).replace(/\\/g, '/'), cache)
    }
    return nodeRequire(spec)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(
    mod.exports,
    customReq,
    mod,
    fullPath,
    dir,
  )
  return mod.exports
}

const genOutreach = loadTsScript('scripts/generateOutreachDrafts.ts')
const appended = genOutreach.ensureCanSpamOutreachFooter('Hi Sam, check out our demo.')
assert.match(appended, /421 Hill Street, Parkersburg, WV 26104/i)
assert.match(appended, /unsubscribe/i)
assert.equal(genOutreach.ensureCanSpamOutreachFooter(appended), appended)

// 4. Runtime VM Test: inbound-bill-webhook/index.ts (Fail-Closed Secret, HMAC, Size Cap, Valid Columns)
{
  const webhookSrc = readSrc('supabase/functions/inbound-bill-webhook/index.ts')
  const compiled = ts.transpileModule(webhookSrc.replace(/^import .*;?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText

  const wsId = '11111111-1111-4111-8111-111111111111'
  const insertedCaptures = []
  const insertedLedger = []
  let secretConfigured = ''

  const fakeAdmin = {
    from(table) {
      return {
        _filters: {},
        select() {
          return this
        },
        eq(k, v) {
          this._filters[k] = v
          return this
        },
        async maybeSingle() {
          if (table === 'workspaces' && this._filters.slug === 'riverbend-hvac') {
            return { data: { id: wsId, slug: 'riverbend-hvac' }, error: null }
          }
          if (table === 'inbound_bill_captures') {
            return { data: null, error: null }
          }
          return { data: null, error: null }
        },
        insert(row) {
          if (table === 'inbound_bill_captures') {
            // Ensure no nonexistent columns like raw_text or extracted_items_json are written
            assert.equal('raw_text' in row, false)
            assert.equal('invoice_number' in row, false)
            assert.equal('extracted_items_json' in row, false)
            const saved = { id: 'cap-hook-1', ...row }
            insertedCaptures.push(saved)
            return {
              select() {
                return { async single() { return { data: saved, error: null } } }
              },
            }
          }
          if (table === 'agent_action_ledger') {
            insertedLedger.push(row)
            return Promise.resolve({ data: row, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }

  let handler
  runInNewContext(compiled, {
    Deno: {
      env: {
        get: key =>
          ({
            INBOUND_EMAIL_WEBHOOK_SECRET: secretConfigured,
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
          })[key],
      },
      serve: fn => {
        handler = fn
      },
    },
    createClient: () => fakeAdmin,
    Response,
    Request,
    TextEncoder,
    crypto: webcrypto,
  })

  const payloadStr = JSON.stringify({
    to: 'bills+riverbend-hvac@inbound.looseendsos.app',
    file_name: 'invoice_9040.txt',
    text: 'Vendor: Apex Industrial\nInvoice #9040\nPO-2026-1104\nTotal Due: $640.00',
  })

  // Missing secret fails closed (503)
  const res503 = await handler(
    new Request('https://example.invalid', { method: 'POST', body: payloadStr }),
  )
  assert.equal(res503.status, 503)

  // Invalid signature rejected (401)
  secretConfigured = 'test-inbound-secret'
  const res401 = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { 'x-inbound-signature': '0000' },
      body: payloadStr,
    }),
  )
  assert.equal(res401.status, 401)

  // Oversized Content-Length rejected (413)
  const sig = createHmac('sha256', secretConfigured).update(payloadStr).digest('hex')
  const res413 = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { 'content-length': String(6 * 1024 * 1024), 'x-inbound-signature': sig },
      body: payloadStr,
    }),
  )
  assert.equal(res413.status, 413)

  // Valid HMAC succeeds & captures safely in needs_review
  const res200 = await handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { 'x-inbound-signature': `sha256=${sig}` },
      body: payloadStr,
    }),
  )
  assert.equal(res200.status, 200)
  assert.equal(insertedCaptures.length, 1)
  assert.equal(insertedCaptures[0].match_status, 'needs_review')
  assert.equal(insertedCaptures[0].human_verified, false)
  assert.equal(insertedCaptures[0].extracted_total_cents, 64000)
  assert.equal(insertedLedger.length, 1)
  assert.equal(insertedLedger[0].status, 'pending_approval')
}

// 5. Runtime VM Test: grok-bot-router/index.ts (Owner/Admin gate, No $249 Fabrication, Observe Mode)
{
  const routerSrc = readSrc('supabase/functions/grok-bot-router/index.ts')
  const compiled = ts.transpileModule(routerSrc.replace(/^import .*;?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText

  let roleMock = 'member'
  let manualModeMock = 'observe'
  const stagedInserts = []
  const runInserts = []

  const userClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null }
      },
    },
    from(table) {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          if (table === 'workspace_members') return { data: { role: roleMock }, error: null }
          if (table === 'bot_manuals') return { data: { mode: manualModeMock, instructions_markdown: 'Strict' }, error: null }
          return { data: null, error: null }
        },
        insert(row) {
          if (table === 'staged_ledger_entries') stagedInserts.push(row)
          if (table === 'bot_runs') runInserts.push(row)
          return {
            select() {
              return { async single() { return { data: { id: 'row-1', ...row }, error: null } } }
            },
          }
        },
      }
    },
  }

  let routerHandler
  runInNewContext(compiled, {
    Deno: {
      env: {
        get: key =>
          ({
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_ANON_KEY: 'anon-fixture',
            XAI_API_KEY: '',
          })[key],
      },
      serve: fn => {
        routerHandler = fn
      },
    },
    createClient: () => userClient,
    Response,
    Request,
    AbortSignal,
  })

  // Plain member role is rejected (403)
  const memberRes = await routerHandler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-1', Origin: 'https://www.looseendsos.app' },
      body: JSON.stringify({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        action: 'parse_document',
        document_text: 'Invoice #1 Total $10.00',
      }),
    }),
  )
  assert.equal(memberRes.status, 403)
  assert.equal(memberRes.headers.get('Access-Control-Allow-Origin'), 'https://www.looseendsos.app')

  // Owner with image-only & no XAI_API_KEY gets 502 (never $249.00 fabrication)
  roleMock = 'owner'
  const noVisionRes = await routerHandler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-1' },
      body: JSON.stringify({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        action: 'parse_document',
        image_base64: 'AAAA',
      }),
    }),
  )
  assert.equal(noVisionRes.status, 502)

  // Observe mode does NOT insert staged_ledger_entries
  const observeRes = await routerHandler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-1' },
      body: JSON.stringify({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        action: 'parse_document',
        document_text: 'Vendor: Acme\nInvoice #1\nTotal Due: $125.00',
      }),
    }),
  )
  assert.equal(observeRes.status, 200)
  const observeBody = await observeRes.json()
  assert.equal(observeBody.mode, 'observe')
  assert.equal(observeBody.staged, false)
  assert.equal(stagedInserts.length, 0)
  assert.equal(runInserts.length, 1)
}

console.log('Mission 09 security & multi-tenant hardening tests passed')
