import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const launch = readFileSync(new URL('../v3.1/launch-center.js', import.meta.url), 'utf8')
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
assert.match(launch, /if\(!existing\)payload\.onboarding_completed=false/, 'Profile edits must preserve completed onboarding')
assert.doesNotMatch(launch, /business_type:type,timezone:tz,onboarding_completed:false/, 'Do not reset onboarding during profile save')
assert.match(launch, /S\.functions\.invoke\('create-subscription-checkout'/, 'Checkout must invoke protected backend')
assert.match(launch, /plan_key:'revenue_recovery'/, 'Checkout must request the standard billing plan')
assert.match(launch, /billingAvailable&&!subscribed&&\(w\.__billing_role='owner'\|\|w\.__billing_role==='admin'\)/, 'Subscribed workspaces must not see a new checkout prompt')
assert.match(page, /launch-center\.js\?v=20261016-onboarding-state-2/, 'Production HTML must reference current launch-center asset')
assert.match(launch, /var billingAvailable=!billing\.error/, 'Do not offer checkout when subscription lookup fails')
console.log('Launch-center onboarding and billing regression checks passed')
