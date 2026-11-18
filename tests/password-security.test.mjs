import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

let hibpCalls = 0
let signUpCalls = 0
let currentFetch = async (url, opts) => {
  hibpCalls += 1
  assert.match(String(url), /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/)
  assert.equal(opts.headers['Add-Padding'], 'true')
  return { ok: true, text: async () => '' }
}

const mockSupabase = {
  isSupabaseConfigured: true,
  assertSupabaseConfigured() {},
  supabase: {
    auth: {
      async signUp(payload) {
        signUpCalls += 1
        return {
          data: { user: { id: 'u1', email: payload.email }, session: null },
          error: null,
        }
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
  },
}

const authMod = loadSrcModule('src/lib/auth.ts', {
  moduleOverrides: { 'src/lib/supabase.ts': mockSupabase },
  globals: {
    crypto: webcrypto,
    fetch: (url, opts) => currentFetch(url, opts),
  },
})

// 1. Short passwords rejected locally before any HIBP call
await assert.rejects(() => authMod.screenPasswordSafety('short'), /at least 12/)
assert.equal(hibpCalls, 0)

// 2. Clean 12+ char password passes k-anonymity 5-char range check
assert.equal(await authMod.screenPasswordSafety('SufficientlyUniquePassword-2026!'), true)
assert.equal(hibpCalls, 1)

// 3. Breached suffix (>0 count) rejected
currentFetch = async () => {
  const candidate = 'SufficientlyUniquePassword-2026!'
  const digest = new Uint8Array(
    await webcrypto.subtle.digest('SHA-1', new TextEncoder().encode(candidate)),
  )
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
  return { ok: true, text: async () => `${hex.slice(5)}:99` }
}
await assert.rejects(
  () => authMod.screenPasswordSafety('SufficientlyUniquePassword-2026!'),
  /known breaches/,
)
await assert.rejects(
  () => authMod.signUpWithPassword('owner@example.com', 'SufficientlyUniquePassword-2026!'),
  /known breaches/,
)
assert.equal(signUpCalls, 0, 'signUp must never execute when breach check rejects')

// 4. Zero-count HIBP padding entries are not treated as breaches
currentFetch = async () => {
  const candidate = 'SufficientlyUniquePassword-2026!'
  const digest = new Uint8Array(
    await webcrypto.subtle.digest('SHA-1', new TextEncoder().encode(candidate)),
  )
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
  return { ok: true, text: async () => `${hex.slice(5)}:0` }
}
assert.equal(
  await authMod.screenPasswordSafety('SufficientlyUniquePassword-2026!'),
  true,
  'padding row with count 0 is safe',
)

// 5. Fails closed when HIBP is unreachable or returns 5xx
currentFetch = async () => {
  throw new Error('network unavailable')
}
await assert.rejects(
  () => authMod.screenPasswordSafety('SufficientlyUniquePassword-2026!'),
  /check is unavailable/,
)

currentFetch = async () => ({ ok: false, status: 503, text: async () => '' })
await assert.rejects(
  () => authMod.screenPasswordSafety('SufficientlyUniquePassword-2026!'),
  /check is unavailable/,
)

// 6. AuthGate preserves sign-in compatibility while enforcing minLength=12 + new-password on sign-up
const authGate = readSrc('src/components/shell/AuthGate.tsx')
assert.match(authGate, /minLength=\{tab === 'signup' \? 12 : 1\}/)
assert.match(authGate, /autoComplete=\{tab === 'signup' \? 'new-password' : 'current-password'\}/)

console.log('Free password breach-check regression passed')
