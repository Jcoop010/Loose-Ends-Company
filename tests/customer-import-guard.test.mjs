import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const s=readFileSync(new URL('../v3.1/live-product-layer.js',import.meta.url),'utf8')
assert.match(s,/rows\.length>5000/)
assert.match(s,/seen\.has\(key\)/)
assert.match(s,/\.eq\('workspace_id',workspace\.id\)/)
assert.match(s,/found\.error/)
assert.match(s,/status:'open'/)
assert.match(s,/Customers added:/)
console.log('Guarded CSV importer source checks passed')
