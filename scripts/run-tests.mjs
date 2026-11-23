import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const testFiles = [
  'tests/src-sdk-contracts.test.mjs',
  'tests/account-recovery.test.mjs',
  'tests/password-security.test.mjs',
  'tests/operations-policy-status.test.mjs',
  'tests/dependency-audit.test.mjs',
  'tests/leak-scanner.test.mjs',
  'tests/background-workflow.test.mjs',
  'tests/workflow-security.test.mjs',
  'tests/stripe-webhook-handler.test.mjs',
  'tests/launch-readiness.test.mjs',
  'tests/launch-center-regression.test.mjs',
  'tests/autopilot-approval.test.mjs',
  'tests/recovery-delivery-preflight.test.mjs',
  'tests/verified-collections-ui.test.mjs',
  'tests/guided-sales-demo.test.mjs',
  'tests/workspace-pagination.test.mjs',
  'tests/customer-server-search.test.mjs',
  'tests/customer-import-guard.test.mjs',
  'tests/customer-csv-parser.test.mjs',
  'tests/sales-launch-journey.test.mjs',
  'tests/sales-onboarding-readiness.test.mjs',
  'tests/live-dashboard-regression.test.mjs',
  'tests/mobile-dashboard-focus.test.mjs',
  'tests/customer-bulk-import-contract.test.mjs',
  'tests/customer-bulk-import-server.test.mjs',
  'tests/customer-import-http.test.mjs',
  'tests/secure-checkout.test.mjs',
  'tests/mobile-accessibility.test.mjs',
  'tests/authenticated-shell.test.mjs',
  'tests/coordination-ui.test.mjs',
  'tests/operations-runtime.test.mjs',
  'tests/operations-form-encoding.test.mjs',
  'tests/operations-premium-ui.test.mjs',
  'tests/production-runtime.test.mjs',
  'tests/revenue-recovery.test.mjs',
  'tests/local-ollama-gemma.test.mjs',
  'tests/mcp-security-hardening.test.mjs',
  'tests/autonomous-os-engine.test.mjs',
  'tests/release2-inventory-bookkeeping.test.mjs',
  'tests/release3-enterprise-vault-sops.test.mjs',
  'tests/can-spam-guardrail.test.mjs',
  'tests/shadow-mode-engine.test.mjs',
  'tests/cpa-packet-and-collections.test.mjs',
  'tests/autonomous-elite-4b.test.mjs',
  'tests/outbound-scale-sequencer.test.mjs',
  'tests/release5-complete-moat.test.mjs',
  'tests/growth-acquisition-engine.test.mjs',
  'tests/mission09-financial-integrity.test.mjs',
  'tests/mission09-security-multitenant.test.mjs',
  'tests/mission09-stripe-and-workforce.test.mjs',
  'tests/mission10-aging-and-payments.test.mjs',
  'tests/mission10-dunning-and-stripe.test.mjs',
]

execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'precompile-test-src.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
})

for (const relTest of testFiles) {
  execFileSync(process.execPath, [path.join(repoRoot, relTest)], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

console.log(`PASS: All ${testFiles.length} test suites completed with 0 failures.`)
