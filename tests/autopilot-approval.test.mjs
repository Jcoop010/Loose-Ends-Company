import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const wsId = '11111111-1111-4111-8111-111111111111'
const oppId = '22222222-2222-4222-8222-222222222222'
const custId = '33333333-3333-4333-8333-333333333333'

let latestConsentRows = [
  { id: 'consent-1', decision: 'revoked', evidence_reference: 'OPTIN-REF-2026' },
]
const insertedAudits = []
const invokedFunctions = []

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    auth: {
      async getUser() {
        return { data: { user: { id: 'actor-uuid' } }, error: null }
      },
    },
    from(table) {
      if (table === 'customer_contact_consent_events') {
        const chain = {
          select() { return chain },
          eq() { return chain },
          order() { return chain },
          async limit() { return { data: latestConsentRows, error: null } },
        }
        return chain
      }
      if (table === 'audit_events') {
        return {
          insert(record) {
            insertedAudits.push(record)
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: 'audit-row-1' }, error: null }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
    functions: {
      async invoke(fnName, opts) {
        invokedFunctions.push({ fnName, body: opts.body })
        return {
          data: { queued: true, duplicate: false, delivery_enabled: false, status: 'not_sent' },
          error: null,
        }
      },
    },
  },
}

const edgeMod = loadSrcModule('src/lib/edgeFunctions.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
})

// 1. Revoked consent strictly blocks approval before writing audit_events or invoking preflight
await assert.rejects(
  () =>
    edgeMod.approveAndEnqueueRecoveryDraft({
      workspaceId: wsId,
      opportunityId: oppId,
      customerId: custId,
      channel: 'sms',
      consentEvidenceReference: 'OPTIN-REF-2026',
      message: 'Checking in on your estimate.',
    }),
  /missing, mismatched, or revoked/,
)
assert.equal(insertedAudits.length, 0)
assert.equal(invokedFunctions.length, 0)

// 2. Granted consent with matching evidence writes audit_events (`not_sent`) and invokes preflight
latestConsentRows = [
  { id: 'consent-2', decision: 'granted', evidence_reference: 'OPTIN-REF-2026' },
]

const res = await edgeMod.approveAndEnqueueRecoveryDraft({
  workspaceId: wsId,
  opportunityId: oppId,
  customerId: custId,
  channel: 'sms',
  consentEvidenceReference: 'OPTIN-REF-2026',
  message: 'Checking in on your estimate.',
})

assert.equal(res.queued, true)
assert.equal(res.deliveryEnabled, false)
assert.equal(insertedAudits.length, 1)
assert.equal(insertedAudits[0].action, 'recovery_draft_approved')
assert.equal(insertedAudits[0].metadata.consent_basis, 'recorded_consent')
assert.equal(insertedAudits[0].metadata.delivery_status, 'not_sent')
assert.equal(invokedFunctions.length, 1)
assert.equal(invokedFunctions[0].fnName, 'recovery-delivery-preflight')
assert.equal(invokedFunctions[0].body.action, 'enqueue_draft')

const uiCode = readSrc('src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx')
assert.doesNotMatch(
  uiCode,
  /fetch\(['"]https?:\/\/[^'"]+\/messages/,
  'Draft approval must never trigger direct external message delivery',
)

console.log('Autopilot consent and approval safeguards verified')
