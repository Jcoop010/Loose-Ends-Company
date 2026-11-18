import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-src-module.mjs'

const policyForm = readSrc('src/features/workspaces/autopilot-billing/OperationsPolicyForm.tsx')
const autopilotPage = readSrc('src/features/workspaces/autopilot-billing/AutopilotBillingPage.tsx')
const html = readSrc('index.html')

for (const phrase of [
  'Enabled',
  'Paused (Kill Switch)',
  'Coordinating',
  'Manual Only',
  'policy_save',
  'coordination_policy',
  'isAdminOrOwner',
]) {
  assert.ok(policyForm.includes(phrase), `Expected OperationsPolicyForm to include: ${phrase}`)
}

assert.match(autopilotPage, /fetchOpsPolicy\(/)
assert.match(html, /src="\/src\/main\.tsx"/)
assert.doesNotMatch(html, /v3\.1\//)

console.log('Workspace automation state presentation regression passed')
