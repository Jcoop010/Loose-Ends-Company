import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function readRepoFile(relPath) {
  const fullPath = path.join(repoRoot, relPath)
  assert.ok(fs.existsSync(fullPath), `Expected file to exist: ${relPath}`)
  return fs.readFileSync(fullPath, 'utf8')
}

function listFilesRecursively(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(full))
    } else {
      results.push(full)
    }
  }
  return results
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// 1. Required Phase 2 modules exist and src/.keep is removed
const requiredModules = [
  'src/types/domain.ts',
  'src/lib/supabase.ts',
  'src/lib/auth.ts',
  'src/lib/opsCommand.ts',
  'src/lib/edgeFunctions.ts',
  'src/lib/queries.ts',
  'src/lib/realtime.ts',
  'src/lib/csv.ts',
  'src/lib/leakScanner.ts',
  'src/lib/format.ts',
  'src/state/RouterContext.tsx',
  'src/state/SessionContext.tsx',
  'src/state/DemoStoreContext.tsx',
]

for (const mod of requiredModules) {
  readRepoFile(mod)
}
assert.equal(
  fs.existsSync(path.join(repoRoot, 'src/.keep')),
  false,
  'src/.keep must be removed once Phase 2 modules exist',
)

// 2. Zero localStorage / sessionStorage reads or writes across src/lib/* and src/state/*
const srcFiles = listFilesRecursively(path.join(repoRoot, 'src')).filter(f =>
  /\.(ts|tsx)$/.test(f),
)
assert.ok(srcFiles.length >= requiredModules.length, 'Expected all Phase 2 TS/TSX files in src/')

for (const filePath of srcFiles) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/')
  const codeOnly = stripComments(fs.readFileSync(filePath, 'utf8'))
  assert.equal(
    /\blocalStorage\b/.test(codeOnly),
    false,
    `${rel} must never read or write localStorage`,
  )
  assert.equal(
    /\bsessionStorage\b/.test(codeOnly),
    false,
    `${rel} must never read or write sessionStorage`,
  )
}

// 3. opsCommand.ts enforces crypto.randomUUID() idempotency keys, all 29 actions, and atomic collect_opportunity RPC
const opsCommandSource = readRepoFile('src/lib/opsCommand.ts')
assert.match(
  opsCommandSource,
  /idempotencyKey:\s*string\s*=\s*crypto\.randomUUID\(\)/,
  'opsCommand must default idempotencyKey to crypto.randomUUID()',
)
assert.match(
  opsCommandSource,
  /supabase\.rpc\('ops_command',\s*\{[\s\S]*?p_workspace:\s*workspaceId[\s\S]*?p_action:\s*action[\s\S]*?p_payload:\s*payload[\s\S]*?p_key:\s*idempotencyKey/,
  'opsCommand must pass p_workspace, p_action, p_payload, and p_key to supabase.rpc("ops_command")',
)

const expected29Actions = [
  'inventory_save',
  'stock_move',
  'inventory_archive',
  'job_save',
  'reserve_material',
  'job_transition',
  'job_update',
  'release_material',
  'schedule_job',
  'expense_save',
  'policy_save',
  'purchase_draft',
  'purchase_transition',
  'queue_retry',
  'coordination_policy',
  'employee_save',
  'availability_save',
  'availability_remove',
  'estimate_revise',
  'job_details',
  'attachment_add',
  'service_plan_save',
  'service_plan_toggle',
  'booking_update',
  'customer_update',
  'expense_update',
  'draft_save',
  'draft_review',
  'business_retry',
]
for (const actionName of expected29Actions) {
  assert.match(
    opsCommandSource,
    new RegExp(`'${actionName}'`),
    `OPS_COMMAND_ACTIONS must include '${actionName}'`,
  )
}

for (const rpcName of [
  'ops_summary',
  'ops_coordination_summary',
  'ops_team_status',
  'ops_invoice_aging',
  'collect_opportunity',
]) {
  assert.match(
    opsCommandSource,
    new RegExp(`supabase\\.rpc\\('${rpcName}'`),
    `opsCommand.ts must wrap RPC '${rpcName}'`,
  )
}

for (const filePath of srcFiles) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/')
  const codeOnly = stripComments(fs.readFileSync(filePath, 'utf8'))
  assert.equal(
    /\.from\(['"]opportunities['"]\)\s*\.\s*update\(/.test(codeOnly),
    false,
    `${rel} must use atomic collect_opportunity RPC instead of direct opportunities.update()`,
  )
  assert.equal(
    /\.from\(['"]recovery_events['"]\)\s*\.\s*insert\(/.test(codeOnly),
    false,
    `${rel} must use atomic collect_opportunity RPC instead of direct recovery_events.insert()`,
  )
}

// 4. auth.ts enforces k-anonymity 5-char SHA-1 prefix via Web Crypto before signUp and updateUser
const authSource = readRepoFile('src/lib/auth.ts')
assert.match(
  authSource,
  /crypto\.subtle\.digest\('SHA-1'/,
  'auth.ts must compute SHA-1 digest in-browser via Web Crypto',
)
assert.match(
  authSource,
  /const\s+prefix\s*=\s*fullHex\.slice\(0,\s*5\)/,
  'auth.ts must extract only the 5-character SHA-1 prefix',
)
assert.match(
  authSource,
  /const\s+suffix\s*=\s*fullHex\.slice\(5\)/,
  'auth.ts must compare the remaining 35-character SHA-1 suffix locally',
)
assert.match(
  authSource,
  /https:\/\/api\.pwnedpasswords\.com\/range\//,
  'auth.ts must query the HIBP k-anonymity range endpoint',
)
assert.match(
  authSource,
  /'Add-Padding':\s*'true'/,
  'auth.ts must request HIBP response padding',
)

const signUpFnBlock = authSource.slice(
  authSource.indexOf('export async function signUpWithPassword'),
  authSource.indexOf('export async function requestPasswordReset'),
)
assert.ok(
  signUpFnBlock.indexOf('await screenPasswordSafety(password)') > 0 &&
    signUpFnBlock.indexOf('await screenPasswordSafety(password)') <
      signUpFnBlock.indexOf('supabase.auth.signUp'),
  'signUpWithPassword must await screenPasswordSafety(password) before supabase.auth.signUp()',
)

const recoveryUpdateBlock = authSource.slice(
  authSource.indexOf('export async function updateRecoveredPassword'),
  authSource.indexOf('export async function signOutUser'),
)
assert.ok(
  recoveryUpdateBlock.indexOf('await screenPasswordSafety(newPassword)') > 0 &&
    recoveryUpdateBlock.indexOf('await screenPasswordSafety(newPassword)') <
      recoveryUpdateBlock.indexOf('supabase.auth.updateUser'),
  'updateRecoveredPassword must await screenPasswordSafety(newPassword) before supabase.auth.updateUser()',
)

// 5. edgeFunctions.ts verifies granted customer_contact_consent_events + writes audit_events before recovery-delivery-preflight
const edgeFnSource = readRepoFile('src/lib/edgeFunctions.ts')
const preflightBlock = edgeFnSource.slice(
  edgeFnSource.indexOf('export async function approveAndEnqueueRecoveryDraft'),
  edgeFnSource.indexOf('export interface WorkflowRunnerResponse'),
)

const consentQueryIdx = preflightBlock.indexOf(".from('customer_contact_consent_events')")
const consentDecisionIdx = preflightBlock.indexOf("latestConsent.decision !== 'granted'")
const auditInsertIdx = preflightBlock.indexOf(".from('audit_events')")
const preflightInvokeIdx = preflightBlock.indexOf("'recovery-delivery-preflight'")

assert.ok(consentQueryIdx > 0, 'approveAndEnqueueRecoveryDraft must query customer_contact_consent_events')
assert.ok(
  consentDecisionIdx > consentQueryIdx,
  'approveAndEnqueueRecoveryDraft must verify latestConsent.decision === "granted"',
)
assert.ok(
  auditInsertIdx > consentDecisionIdx,
  'approveAndEnqueueRecoveryDraft must write audit_events only after verifying consent',
)
assert.ok(
  preflightInvokeIdx > auditInsertIdx,
  'approveAndEnqueueRecoveryDraft must invoke recovery-delivery-preflight only after writing audit_events',
)
assert.match(preflightBlock, /action:\s*'recovery_draft_approved'/)
assert.match(preflightBlock, /delivery_status:\s*'not_sent'/)
assert.match(preflightBlock, /action:\s*'enqueue_draft'/)

assert.match(edgeFnSource, /planKey:\s*BillingPlanKey\s*=\s*'revenue_recovery'/)
assert.match(edgeFnSource, /parsed\.hostname\s*!==\s*'checkout\.stripe\.com'/)
assert.match(edgeFnSource, /parsed\.hostname\s*!==\s*'billing\.stripe\.com'/)
assert.match(edgeFnSource, /CUSTOMER_IMPORT_BATCH_SIZE\s*=\s*100/)
assert.match(edgeFnSource, /CUSTOMER_IMPORT_MAX_ROWS\s*=\s*5000/)

// 6. Pagination guard, Realtime debounce, Session monotonic guard, and air-gapped DemoStore
const queriesSource = readRepoFile('src/lib/queries.ts')
assert.match(queriesSource, /WORKSPACE_ROW_SAFETY_LIMIT\s*=\s*10_000/)
assert.match(queriesSource, /\.or\(/)

const realtimeSource = readRepoFile('src/lib/realtime.ts')
assert.match(realtimeSource, /`loose-ends-live-\$\{workspaceId\}`/)
assert.match(realtimeSource, /DEFAULT_REALTIME_DEBOUNCE_MS\s*=\s*500/)
assert.match(realtimeSource, /supabase\.removeChannel\(channel\)/)

const csvSource = readRepoFile('src/lib/csv.ts')
assert.match(csvSource, /crypto\.subtle\.digest\('SHA-256'/)

const leakScannerSource = readRepoFile('src/lib/leakScanner.ts')
for (const cat of [
  'overdue_invoice',
  'unbilled_completed_job',
  'stale_quote',
  'stale_opportunity',
  'unclosed_past_appointment',
]) {
  assert.match(leakScannerSource, new RegExp(`'${cat}'`), `leakScanner.ts must cover ${cat}`)
}

const sessionSource = readRepoFile('src/state/SessionContext.tsx')
assert.match(sessionSource, /generationRef\.current/)
assert.match(sessionSource, /wipeAllSessionState\(\)/)

const demoStoreSource = stripComments(readRepoFile('src/state/DemoStoreContext.tsx'))
assert.equal(
  /supabase|edgeFunctions|opsCommand|queries/.test(demoStoreSource),
  false,
  'DemoStoreContext.tsx must be completely air-gapped from Supabase and network SDK modules',
)
assert.match(demoStoreSource, /resetDemo/)

console.log('PASS: src/ SDK & state security contracts verified across all 13 Phase 2 modules.')
