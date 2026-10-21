import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const src=readFileSync(new URL('../supabase/functions/customer-bulk-import/index.ts',import.meta.url),'utf8')
assert.match(src,/auth\.getUser\(\)/)
assert.match(src,/\["owner","admin"\]/)
assert.match(src,/\.eq\("workspace_id",workspaceId\)/)
assert.match(src,/rows\.length>100/)
assert.match(src,/process_customer_import_batch/)
assert.match(src,/admin\.rpc\(/)
assert.match(src,/batch_number/)
assert.match(src,/created_by/)
console.log('Bulk import server authorization and bounded batching source checks passed')
