import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-src-module.mjs'

const cardSrc = readSrc('src/features/workspaces/command-center/VerifiedRevenueCard.tsx')
const queriesSrc = readSrc('src/lib/queries.ts')

assert.match(cardSrc, /table:\s*'verified_recovery_payments'/)
assert.match(cardSrc, /workspaceId/)
assert.match(cardSrc, /Provider-Verified \(Webhook\)/)
assert.match(cardSrc, /Owner-Reported Paid/)
assert.match(cardSrc, /summary\.owner_reported_paid/)
assert.match(cardSrc, /No provider-verified webhook payments recorded yet/)
assert.match(queriesSrc, /\.eq\('workspace_id',\s*workspaceId\)/)

console.log('Verified collections display safeguards passed')
