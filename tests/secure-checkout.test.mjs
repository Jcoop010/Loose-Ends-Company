import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const src = readFileSync(new URL('../api/create-subscription-checkout.js', import.meta.url), 'utf8')
assert.match(src, /price_1URCPvIS04s94hSMFJ9azsC8/)
assert.match(src, /client_reference_id: workspaceId/)
assert.match(src, /subscription_data\\]\[metadata\\]\[workspace_id/)
assert.match(src, /getUser\\(\\)/)
assert.match(src, /\\['owner', 'admin'\\]/)
assert.match(src, /Billing is not configured/)
assert.doesNotMatch(src, /price_1UPkrQ|price_1UPkrX|price_1UPkZj/)
console.log('Secure checkout source invariants passed')
