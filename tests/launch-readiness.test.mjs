import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-src-module.mjs'

const setupHealth = readSrc('src/features/workspaces/autopilot-billing/WorkspaceSetupHealth.tsx')
const billingCard = readSrc('src/features/workspaces/autopilot-billing/BillingSubscriptionCard.tsx')

assert.doesNotMatch(
  setupHealth,
  /<span>READY<\/span>/,
  'onboarding must not assert hardcoded unverified integration readiness',
)
assert.match(setupHealth, /probeWorkspaceTableHealth\(/)
assert.match(setupHealth, /Enabled Workflows/)
assert.match(setupHealth, /Pending Approvals/)
assert.match(billingCard, /\$199/)
assert.match(billingCard, /Subscribe Workspace \(\$199\/mo\)/)

console.log('Launch readiness honesty checks passed')
