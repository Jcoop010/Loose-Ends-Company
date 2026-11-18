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

// 7. Phase 3A modules, zero `any` escapes, air-gapped /demo UI, and Command Center contracts
const phase3AModules = [
  'src/index.css',
  'src/AppRoot.tsx',
  'src/components/ui/ErrorBoundary.tsx',
  'src/components/ui/Toast.tsx',
  'src/components/ui/Dialog.tsx',
  'src/components/ui/MetricCard.tsx',
  'src/components/shell/AuthGate.tsx',
  'src/components/shell/GlobalSearch.tsx',
  'src/components/shell/AppShell.tsx',
  'src/features/landing/LandingPage.tsx',
  'src/features/landing/PublicAuditLeadForm.tsx',
  'src/features/demo/WalkthroughBanner.tsx',
  'src/features/demo/RoiAuditCalculatorModal.tsx',
  'src/features/demo/DemoWorkspacePage.tsx',
  'src/features/workspaces/command-center/CommandCenterPage.tsx',
  'src/features/workspaces/command-center/VerifiedRevenueCard.tsx',
  'src/features/workspaces/command-center/LeakScannerPanel.tsx',
  'src/features/workspaces/command-center/FinanceAgingPanel.tsx',
]

for (const mod of phase3AModules) {
  readRepoFile(mod)
}

for (const filePath of srcFiles) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/')
  const codeOnly = stripComments(fs.readFileSync(filePath, 'utf8'))
  assert.equal(
    /(:\s*any\b|\bas\s+any\b|<any>)/.test(codeOnly),
    false,
    `${rel} must not contain TypeScript any escapes`,
  )
}

for (const demoFile of [
  'src/features/demo/WalkthroughBanner.tsx',
  'src/features/demo/RoiAuditCalculatorModal.tsx',
  'src/features/demo/DemoWorkspacePage.tsx',
]) {
  const codeOnly = stripComments(readRepoFile(demoFile))
  assert.equal(
    /supabase|edgeFunctions|opsCommand|queries/.test(codeOnly),
    false,
    `${demoFile} must remain 100% air-gapped with zero Supabase or live SDK imports`,
  )
}

const cssSource = readRepoFile('src/index.css')
assert.match(cssSource, /font-variant-numeric:\s*tabular-nums/)
assert.match(cssSource, /min-height:\s*44px/)
assert.match(cssSource, /:focus-visible/)

const toastSource = readRepoFile('src/components/ui/Toast.tsx')
assert.match(toastSource, /aria-live="polite"/)

const dialogSource = readRepoFile('src/components/ui/Dialog.tsx')
assert.match(dialogSource, /aria-modal="true"/)
assert.match(dialogSource, /event\.key\s*===\s*'Escape'/)

const authGateSource = readRepoFile('src/components/shell/AuthGate.tsx')
assert.match(authGateSource, /screenPasswordSafety/)
assert.match(authGateSource, /updateRecoveredPassword/)
assert.match(authGateSource, /bootstrapWorkspace/)

const verifiedCardSource = readRepoFile(
  'src/features/workspaces/command-center/VerifiedRevenueCard.tsx',
)
assert.match(verifiedCardSource, /verified_recovery_payments/)
assert.match(verifiedCardSource, /owner_reported_paid/)

const financePanelSource = readRepoFile(
  'src/features/workspaces/command-center/FinanceAgingPanel.tsx',
)
assert.match(financePanelSource, /'expense_save'/)
assert.match(financePanelSource, /'expense_update'/)

// 8. Phase 3B Workspaces 2 & 3 (Pipeline & Quotes + Dispatch & Jobs) contracts
const phase3BModules = [
  'src/features/workspaces/pipeline-quotes/OpportunityBoard.tsx',
  'src/features/workspaces/pipeline-quotes/Customer360Drawer.tsx',
  'src/features/workspaces/pipeline-quotes/CustomerBulkImportModal.tsx',
  'src/features/workspaces/pipeline-quotes/QuotesDocumentsPanel.tsx',
  'src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx',
  'src/features/workspaces/pipeline-quotes/PipelineQuotesPage.tsx',
  'src/features/workspaces/dispatch-jobs/JobsPipelinePanel.tsx',
  'src/features/workspaces/dispatch-jobs/DispatchCalendar.tsx',
  'src/features/workspaces/dispatch-jobs/TasksQueuePanel.tsx',
  'src/features/workspaces/dispatch-jobs/ServicePlansPanel.tsx',
  'src/features/workspaces/dispatch-jobs/TeamAvailabilityPanel.tsx',
  'src/features/workspaces/dispatch-jobs/DispatchJobsPage.tsx',
]

for (const mod of phase3BModules) {
  readRepoFile(mod)
}

const appRootSource = readRepoFile('src/AppRoot.tsx')
assert.match(appRootSource, /PipelineQuotesPage/)
assert.match(appRootSource, /DispatchJobsPage/)

const oppBoardSource = readRepoFile(
  'src/features/workspaces/pipeline-quotes/OpportunityBoard.tsx',
)
assert.match(oppBoardSource, /collectOpportunity\(/)

const cust360Source = readRepoFile(
  'src/features/workspaces/pipeline-quotes/Customer360Drawer.tsx',
)
assert.match(cust360Source, /fetchCustomer360\(/)
assert.match(cust360Source, /'customer_update'/)
assert.match(cust360Source, /searchCustomers\(/)

const bulkImportModalSource = readRepoFile(
  'src/features/workspaces/pipeline-quotes/CustomerBulkImportModal.tsx',
)
assert.match(bulkImportModalSource, /parseCustomerCsv\(/)
assert.match(bulkImportModalSource, /sha256Hex\(/)
assert.match(bulkImportModalSource, /runCustomerBulkImport\(/)

const quotesDocsSource = readRepoFile(
  'src/features/workspaces/pipeline-quotes/QuotesDocumentsPanel.tsx',
)
assert.match(quotesDocsSource, /'estimate_revise'/)
assert.match(quotesDocsSource, /'job_transition'/)

const consentDraftsSource = readRepoFile(
  'src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx',
)
assert.match(consentDraftsSource, /'draft_save'/)
assert.match(consentDraftsSource, /'draft_review'/)
assert.match(consentDraftsSource, /recordCustomerConsentEvent\(/)
assert.match(consentDraftsSource, /approveAndEnqueueRecoveryDraft\(/)

const jobsPanelSource = readRepoFile(
  'src/features/workspaces/dispatch-jobs/JobsPipelinePanel.tsx',
)
for (const cmd of [
  'job_save',
  'job_transition',
  'job_update',
  'job_details',
  'attachment_add',
  'reserve_material',
  'release_material',
]) {
  assert.match(jobsPanelSource, new RegExp(`'${cmd}'`), `JobsPipelinePanel must wire '${cmd}'`)
}
assert.match(jobsPanelSource, /startsWith\('https:\/\/'\)/)

const dispatchCalendarSource = readRepoFile(
  'src/features/workspaces/dispatch-jobs/DispatchCalendar.tsx',
)
assert.match(dispatchCalendarSource, /'schedule_job'/)
assert.match(dispatchCalendarSource, /'booking_update'/)

const servicePlansSource = readRepoFile(
  'src/features/workspaces/dispatch-jobs/ServicePlansPanel.tsx',
)
assert.match(servicePlansSource, /'service_plan_save'/)
assert.match(servicePlansSource, /'service_plan_toggle'/)

const teamPanelSource = readRepoFile(
  'src/features/workspaces/dispatch-jobs/TeamAvailabilityPanel.tsx',
)
assert.match(teamPanelSource, /'employee_save'/)
assert.match(teamPanelSource, /'availability_save'/)
assert.match(teamPanelSource, /'availability_remove'/)

// 9. Phase 3C Workspaces 4 & 5 (Inventory & POs + Autopilot & Billing) & src/main.tsx contracts
const phase3CModules = [
  'src/main.tsx',
  'src/features/workspaces/inventory-pos/StockTable.tsx',
  'src/features/workspaces/inventory-pos/InventoryCsvImport.tsx',
  'src/features/workspaces/inventory-pos/PurchaseOrdersPanel.tsx',
  'src/features/workspaces/inventory-pos/InventoryPosPage.tsx',
  'src/features/workspaces/autopilot-billing/OperationsPolicyForm.tsx',
  'src/features/workspaces/autopilot-billing/EventQueuesAuditPanel.tsx',
  'src/features/workspaces/autopilot-billing/WorkflowBuilderPanel.tsx',
  'src/features/workspaces/autopilot-billing/WorkspaceSetupHealth.tsx',
  'src/features/workspaces/autopilot-billing/BillingSubscriptionCard.tsx',
  'src/features/workspaces/autopilot-billing/AutopilotBillingPage.tsx',
]

for (const mod of phase3CModules) {
  readRepoFile(mod)
}

assert.match(appRootSource, /InventoryPosPage/)
assert.match(appRootSource, /AutopilotBillingPage/)

const mainEntrySource = readRepoFile('src/main.tsx')
assert.match(mainEntrySource, /import\s+'\.\/index\.css'/)
assert.match(mainEntrySource, /React\.StrictMode/)
assert.match(mainEntrySource, /<AppRoot\s*\/>/)

const stockTableSource = readRepoFile('src/features/workspaces/inventory-pos/StockTable.tsx')
for (const cmd of ['inventory_save', 'stock_move', 'reserve_material', 'inventory_archive', 'purchase_draft']) {
  assert.match(stockTableSource, new RegExp(`'${cmd}'`), `StockTable must wire '${cmd}'`)
}

const skuCsvImportSource = readRepoFile(
  'src/features/workspaces/inventory-pos/InventoryCsvImport.tsx',
)
assert.match(skuCsvImportSource, /parseInventoryCsv\(/)
assert.match(skuCsvImportSource, /sha256Hex\(/)
assert.match(
  skuCsvImportSource,
  /'inventory-csv:'\s*\+\s*fileHash\s*\+\s*':'\s*\+\s*rowIndex/,
  'InventoryCsvImport must construct deterministic inventory-csv:<hash>:<rowIndex> idempotency keys',
)

const poPanelSource = readRepoFile('src/features/workspaces/inventory-pos/PurchaseOrdersPanel.tsx')
assert.match(poPanelSource, /'purchase_draft'/)
assert.match(poPanelSource, /'purchase_transition'/)

const policyFormSource = readRepoFile(
  'src/features/workspaces/autopilot-billing/OperationsPolicyForm.tsx',
)
assert.match(policyFormSource, /isAdminOrOwner/)
assert.match(policyFormSource, /'policy_save'/)
assert.match(policyFormSource, /'coordination_policy'/)

const eventQueuesSource = readRepoFile(
  'src/features/workspaces/autopilot-billing/EventQueuesAuditPanel.tsx',
)
assert.match(eventQueuesSource, /'queue_retry'/)
assert.match(eventQueuesSource, /'business_retry'/)

const workflowPanelSource = readRepoFile(
  'src/features/workspaces/autopilot-billing/WorkflowBuilderPanel.tsx',
)
assert.match(workflowPanelSource, /isAdminOrOwner/)
assert.match(workflowPanelSource, /invokeWorkflowRunner\(/)

const setupHealthSource = readRepoFile(
  'src/features/workspaces/autopilot-billing/WorkspaceSetupHealth.tsx',
)
assert.match(setupHealthSource, /probeWorkspaceTableHealth\(/)
assert.match(setupHealthSource, /syncQuickBooks\(/)

const billingCardSource = readRepoFile(
  'src/features/workspaces/autopilot-billing/BillingSubscriptionCard.tsx',
)
assert.match(billingCardSource, /isAdminOrOwner/)
assert.match(billingCardSource, /createSubscriptionCheckout\(/)
assert.match(billingCardSource, /createBillingPortalSession\(/)
assert.match(billingCardSource, /'revenue_recovery'/)
assert.match(billingCardSource, /!isAlreadyActive/)

console.log(
  `PASS: src/ SDK, state & all 5 workspaces (Phases 2–3C) verified across ${srcFiles.length} TypeScript modules.`,
)
