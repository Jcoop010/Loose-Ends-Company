import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

let authCallback = null
let resetRequests = 0
let passwordUpdates = 0
let signOuts = 0
let hibpCalls = 0
let failReset = false
let failUpdate = false

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    auth: {
      onAuthStateChange(fn) {
        authCallback = fn
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async resetPasswordForEmail(email, options) {
        resetRequests += 1
        assert.equal(email, 'qa@example.invalid')
        assert.equal(options.redirectTo, 'https://loose-ends-os.vercel.app/dashboard')
        return { error: failReset ? new Error('Unable to request reset link.') : null }
      },
      async updateUser(input) {
        passwordUpdates += 1
        assert.equal(input.password, 'Synthetic-Password-2026!')
        return { error: failUpdate ? new Error('internal db detail') : null }
      },
      async signOut() {
        signOuts += 1
        return { error: null }
      },
    },
  },
}

const authMod = loadSrcModule('src/lib/auth.ts', {
  moduleOverrides: {
    'src/lib/supabase.ts': mockSupabase,
  },
  globals: {
    crypto: webcrypto,
    window: { location: { origin: 'https://loose-ends-os.vercel.app' } },
    fetch: async url => {
      hibpCalls += 1
      assert.match(String(url), /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/)
      return { ok: true, text: async () => '' }
    },
  },
})

// 1. Password reset request trims email and targets /dashboard redirect
await authMod.requestPasswordReset('  qa@example.invalid  ')
assert.equal(resetRequests, 1)

await assert.rejects(() => authMod.requestPasswordReset('   '), /Enter your account email/)

failReset = true
await assert.rejects(() => authMod.requestPasswordReset('qa@example.invalid'), /Unable to request/)
failReset = false

// 2. PASSWORD_RECOVERY and SIGNED_OUT listener transitions
const recoveryStates = []
const unsubscribe = authMod.subscribePasswordRecovery(inRecovery => {
  recoveryStates.push(inRecovery)
})
authCallback('PASSWORD_RECOVERY')
authCallback('SIGNED_OUT')
assert.deepEqual(recoveryStates, [true, false])
unsubscribe()

// 3. Mismatched confirmation password rejected before HIBP or updateUser
await assert.rejects(
  () => authMod.updateRecoveredPassword('Synthetic-Password-2026!', 'Wrong-Password-2026!'),
  /Passwords do not match/,
)
assert.equal(passwordUpdates, 0)
assert.equal(hibpCalls, 0)

// 4. Safe error masking when updateUser fails (never leaks raw backend error text)
failUpdate = true
await assert.rejects(
  () => authMod.updateRecoveredPassword('Synthetic-Password-2026!', 'Synthetic-Password-2026!'),
  err => {
    assert.match(err.message, /Password could not be updated/)
    assert.ok(!err.message.includes('internal db detail'))
    return true
  },
)
assert.equal(hibpCalls, 1)
assert.equal(passwordUpdates, 1)
assert.equal(signOuts, 0)
failUpdate = false

// 5. Valid recovery password screens via HIBP, updates user, and signs out recovery session
await authMod.updateRecoveredPassword('Synthetic-Password-2026!', 'Synthetic-Password-2026!')
assert.equal(hibpCalls, 2)
assert.equal(passwordUpdates, 2)
assert.equal(signOuts, 1)

// 6. Verify AuthGate renders dedicated PASSWORD_RECOVERY UI and neutral reset confirmation
const authGateSrc = readSrc('src/components/shell/AuthGate.tsx')
assert.match(authGateSrc, /inPasswordRecovery/)
assert.match(authGateSrc, /If an account exists for/)

console.log('Account recovery flow passed: request, safe error masking, mismatch guard, breach screening, update, and logout.')
