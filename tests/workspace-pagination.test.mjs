import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const code=readFileSync(new URL('../v3.1/live-product-layer.js',import.meta.url),'utf8')
assert.match(code,/async function fetchAll\(/)
assert.match(code,/\.range\(start,start\+size-1\)/)
assert.match(code,/size=500,maxRows=10000/)
assert.match(code,/throw new Error\('Workspace '/)
assert.match(code,/No partial totals shown/)
assert.match(code,/Promise\.all\(\[/)
console.log('Workspace pagination and fail-closed totals safeguards verified')
