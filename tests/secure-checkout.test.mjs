import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(
  new URL('../supabase/functions/create-subscription-checkout/index.ts', import.meta.url),
  'utf8',
)

// Pricing & origin invariants
assert.match(src, /price_1URCPvIS04s94hSMFJ9azsC8/)
assert.doesNotMatch(src, /price_1UPkrQ|price_1UPkrX|price_1UPkZj/)
assert.match(src, /Billing is not configured/)
assert.ok(src.includes('https://loose-ends-os.vercel.app'))
assert.ok(src.includes('checkout.stripe.com'))

// Auth & session verification
assert.ok(src.includes('authHeader.startsWith("Bearer ")'))
assert.ok(src.includes('userClient.auth.getUser()'))

// Workspace membership owner/admin gate
assert.ok(src.includes('from("workspace_members")'))
assert.ok(src.includes('["owner", "admin"].includes(member.role)'))

// Duplicate active subscription guard (409 conflict)
assert.ok(src.includes('from("workspace_subscriptions")'))
for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
  assert.ok(src.includes(`"${status}"`), `missing duplicate subscription guard for status: ${status}`)
}
assert.match(src, /,\s*409,\s*origin\)/)

// Stripe session & subscription workspace attribution
assert.match(src, /client_reference_id:\s*workspaceId/)
assert.ok(src.includes('metadata[workspace_id]'))
assert.ok(src.includes('subscription_data[metadata][workspace_id]'))

console.log('Secure checkout source invariants passed')
