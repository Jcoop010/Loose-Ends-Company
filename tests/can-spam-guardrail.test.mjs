import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const guard = loadSrcModule('src/lib/canSpamGuard.ts')

const VALID_B2B_FOOTER =
  'Hi Jordan,\n\nQuick question on estimate leakage.\n\nReply unsubscribe to opt out · 421 Hill Street, Parkersburg, WV 26104'

// (a) SMS strictly blocked without opt-in even if CAN-SPAM footer is present
const smsMissing = guard.evaluateDraftCompliance({
  channel: 'sms',
  message: VALID_B2B_FOOTER,
  latestConsent: undefined,
})
assert.equal(smsMissing.allowed, false)
assert.equal(smsMissing.basis, 'blocked_missing_opt_in')
assert.equal(smsMissing.badgeTone, 'rose')
assert.match(smsMissing.blockReason, /No recorded SMS opt-in on file/)

const smsGranted = guard.evaluateDraftCompliance({
  channel: 'sms',
  message: 'Following up on your quote.',
  latestConsent: { decision: 'granted', evidence_reference: 'SIGNED-OPTIN-1' },
})
assert.equal(smsGranted.allowed, true)
assert.equal(smsGranted.basis, 'recorded_consent')

// (b) B2B email blocked when missing CAN-SPAM address, unsubscribe/opt-out, or opted-out
const emailNoAddress = guard.evaluateDraftCompliance({
  channel: 'email',
  message: 'Hi there, reply unsubscribe if not interested.',
  latestConsent: undefined,
})
assert.equal(emailNoAddress.allowed, false)
assert.equal(emailNoAddress.basis, 'blocked_missing_footer')
assert.match(emailNoAddress.blockReason, /421 Hill Street, Parkersburg, WV 26104/)

const emailNoUnsub = guard.evaluateDraftCompliance({
  channel: 'email',
  message: 'Hi there, 421 Hill Street, Parkersburg, WV 26104',
  latestConsent: undefined,
})
assert.equal(emailNoUnsub.allowed, false)
assert.equal(emailNoUnsub.basis, 'blocked_missing_footer')
assert.match(emailNoUnsub.blockReason, /unsubscribe/)

const emailOptedOutByEmail = guard.evaluateDraftCompliance({
  channel: 'email',
  message: VALID_B2B_FOOTER,
  latestConsent: undefined,
  emailSuppressed: true,
})
assert.equal(emailOptedOutByEmail.allowed, false)
assert.equal(emailOptedOutByEmail.basis, 'blocked_opt_out')

const emailRevokedCustomer = guard.evaluateDraftCompliance({
  channel: 'email',
  message: VALID_B2B_FOOTER,
  latestConsent: { decision: 'revoked', evidence_reference: 'OPTOUT-2026' },
})
assert.equal(emailRevokedCustomer.allowed, false)
assert.equal(emailRevokedCustomer.basis, 'blocked_opt_out')

// (c) B2B email allowed without prior opt-in when CAN-SPAM footer is present and not opted out
const emailReady = guard.evaluateDraftCompliance({
  channel: 'email',
  message: VALID_B2B_FOOTER,
  latestConsent: undefined,
  emailSuppressed: false,
})
assert.equal(emailReady.allowed, true)
assert.equal(emailReady.basis, 'can_spam_b2b')
assert.equal(emailReady.badgeLabel, 'CAN-SPAM Ready (B2B)')
assert.equal(emailReady.badgeTone, 'emerald')
assert.equal(emailReady.blockReason, null)

// Case-insensitive + opt out variant works cleanly too
const emailOptOutVariant = guard.evaluateDraftCompliance({
  channel: 'email',
  message: 'Hello — 421 hill street, parkersburg, wv 26104 | Reply STOP to OPT OUT',
})
assert.equal(emailOptOutVariant.allowed, true)
assert.equal(emailOptOutVariant.basis, 'can_spam_b2b')

// Edge Function runtime HTTP check for recovery-delivery-preflight CAN-SPAM B2B path & suppression
const wsId = '11111111-1111-4111-8111-111111111111'
const oppId = '22222222-2222-4222-8222-222222222222'
const custId = '33333333-3333-4333-8333-333333333333'
const approvalId = '44444444-4444-4444-8444-444444444444'

let approvalRecord = {
  id: approvalId,
  entity_id: oppId,
  action: 'recovery_draft_approved',
  actor_user_id: 'owner-1',
  metadata: {
    channel: 'email',
    consent_basis: 'can_spam_b2b',
    consent_reference: 'CAN-SPAM-B2B-FOOTER-VERIFIED',
    consent_event_id: null,
    customer_id: custId,
    recipient_email: 'prospect@example.invalid',
    message: VALID_B2B_FOOTER,
    delivery_status: 'not_sent',
  },
}
let edgeConsentRows = []
let insertedJobId = 0
let handler

const edgeSource = readFileSync(
  new URL('../supabase/functions/recovery-delivery-preflight/index.ts', import.meta.url),
  'utf8',
).replace(/^import .*?;\s*/m, '')

const makeClient = () => ({
  auth: {
    async getUser() {
      return { data: { user: { id: 'owner-1' } }, error: null }
    },
  },
  from(table) {
    const chain = {
      select() { return chain },
      eq() { return chain },
      order() { return chain },
      limit() {
        return Promise.resolve({ data: edgeConsentRows, error: null })
      },
      maybeSingle: async () => {
        if (table === 'workspace_members') return { data: { role: 'owner' }, error: null }
        if (table === 'audit_events') return { data: approvalRecord, error: null }
        if (table === 'opportunities') return { data: { id: oppId, customer_id: custId }, error: null }
        if (table === 'recovery_outbound_jobs') return { data: null, error: null }
        return { data: null, error: null }
      },
      insert(job) {
        insertedJobId += 1
        return {
          select() {
            return {
              single: async () => ({
                data: { id: `job-${insertedJobId}`, status: job.status },
                error: null,
              }),
            }
          },
        }
      },
    }
    return chain
  },
})

vm.runInNewContext(ts.transpile(edgeSource, { target: ts.ScriptTarget.ES2022 }), {
  createClient: makeClient,
  Response,
  JSON,
  String,
  RegExp,
  Deno: { env: { get: () => 'fake' }, serve: fn => { handler = fn } },
})

const invokeEdge = async () =>
  handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', Origin: 'https://www.looseendsos.app' },
      body: JSON.stringify({
        workspace_id: wsId,
        approval_id: approvalId,
        action: 'enqueue_draft',
      }),
    }),
  )

// Valid CAN-SPAM B2B email without prior opt-in succeeds (201, delivery_enabled: false)
const okRes = await invokeEdge()
assert.equal(okRes.status, 201)
const okBody = await okRes.json()
assert.equal(okBody.queued, true)
assert.equal(okBody.delivery_enabled, false)

// Opted-out recipient blocks even with CAN-SPAM footer (409)
edgeConsentRows = [{ id: 'ev-1', decision: 'revoked', status: 'opted_out', evidence_reference: 'STOP' }]
const blockedOptOutRes = await invokeEdge()
assert.equal(blockedOptOutRes.status, 409)

// Missing CAN-SPAM footer blocks (409)
edgeConsentRows = []
approvalRecord = {
  ...approvalRecord,
  metadata: { ...approvalRecord.metadata, message: 'No address or opt out footer.' },
}
const blockedFooterRes = await invokeEdge()
assert.equal(blockedFooterRes.status, 409)

// Source assertions across UI, dispatcher script, and SQL migration
const panelSrc = readSrc('src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx')
assert.match(panelSrc, /evaluateDraftCompliance/)
assert.match(panelSrc, /compliance\.badgeLabel/)

const dispatcherSrc = readSrc('scripts/sendApprovedDrafts.ts')
assert.match(dispatcherSrc, /isCanSpamFooterCompliant/)
assert.match(dispatcherSrc, /hasGrantedEmailConsent/)

const migrationSrc = readSrc('supabase/migrations/20261122120000_can_spam_b2b_email_guardrail.sql')
assert.match(migrationSrc, /421 hill street, parkersburg, wv 26104/)
assert.match(migrationSrc, /Current channel consent required before draft approval/)

console.log('CAN-SPAM B2B email vs strict SMS guardrail tests passed')
