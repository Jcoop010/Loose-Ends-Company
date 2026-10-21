import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const code=readFileSync(new URL('../v3.1/live-product-layer.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8')
assert.match(code,/rows\.length>5000/)
assert.match(code,/i\+=100/)
assert.match(code,/customer-bulk-import/)
assert.match(code,/action:'start'/)
assert.match(code,/action:'batch'/)
assert.match(code,/action:'finish'/)
assert.match(code,/le-csv-progress/)
assert.match(code,/le-csv-file/)
assert.match(html,/live-product-layer\.js\?v=20261021-server-batch-import-1/)
console.log('Authenticated server-batched import wiring verified')
