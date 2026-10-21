import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync(new URL('../v3.1/app.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8')
assert.match(app,/customerServerSearch/)
assert.match(app,/\.eq\('workspace_id',state\.workspaceId\)/)
assert.match(app,/\.or\('first_name\.ilike\.'/)
assert.match(app,/\.limit\(100\)/)
assert.match(app,/state\.customerSearchResults=result\.error\?\[\]:result\.data\|\|\[\]/)
assert.match(html,/app\.js\?v=20261021-customer-profile-2/)
console.log('Workspace-scoped customer search source checks passed')
