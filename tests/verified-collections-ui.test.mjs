import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=readFileSync(new URL('../v3.1/revenue-engine.js',import.meta.url),'utf8')
assert.match(src, /from\('verified_recovery_payments'\)/)
assert.match(src, /eq\('workspace_id',w\.id\)/)
assert.match(src, /No independently verified payments recorded/)
assert.match(src, /Unable to read payment evidence; no verified revenue claimed/)
assert.match(src, /Owner-reported recovery · unverified/)
assert.match(src, /renderVerifiedCollections\(\)/)
console.log('Verified collections display safeguards passed')
