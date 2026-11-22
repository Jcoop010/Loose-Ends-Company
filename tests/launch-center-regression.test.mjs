import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const wsId = '11111111-1111-4111-8111-111111111111'
let upsertedPayload = null

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    from(table) {
      assert.equal(table, 'workspace_settings')
      return {
        upsert(payload) {
          upsertedPayload = payload
          return {
            select() {
              return {
                async single() {
                  return { data: payload, error: null }
                },
              }
            },
          }
        },
      }
    },
  },
}

const queries = loadSrcModule('src/lib/queries.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
})

// 1. Saving workspace settings preserves onboarding_completed = true instead of resetting to false
await queries.upsertWorkspaceSettings({
  workspaceId: wsId,
  businessType: 'HVAC & Mechanical',
  timezone: 'America/New_York',
  onboardingCompleted: true,
})
assert.equal(upsertedPayload.onboarding_completed, true)

// 2. Checkout invokes create-subscription-checkout with plan_key: 'revenue_recovery' and blocks duplicate active checkout
const edgeFn = readSrc('src/lib/edgeFunctions.ts')
const billingCard = readSrc('src/features/workspaces/autopilot-billing/BillingSubscriptionCard.tsx')

assert.match(edgeFn, /supabase\.functions\.invoke\('create-subscription-checkout'/)
assert.match(edgeFn, /planKey:\s*BillingPlanKey\s*=\s*'revenue_recovery'/)
assert.match(
  billingCard,
  /const hasProviderSubscription = Boolean\(subscription\?\.provider_subscription_id\)/,
)
assert.match(
  billingCard,
  /const isAlreadyActive =\s*hasProviderSubscription && \(status === 'active' \|\| status === 'trialing'\)/,
)
assert.match(billingCard, /\{!isAlreadyActive \?/)
assert.match(billingCard, /\{hasCustomerRecord \?/)
assert.match(billingCard, /!isAdminOrOwner/)

console.log('Launch-center onboarding and billing regression checks passed')
