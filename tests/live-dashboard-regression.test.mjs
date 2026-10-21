import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const launch=readFileSync(new URL('../v3.1/launch-center.js',import.meta.url),'utf8')
const sales=readFileSync(new URL('../v3.1/sales-upgrade.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8')
assert.match(launch,/leLaunchPending/)
assert.match(launch,/page\.isConnected/)
assert.match(launch,/document\.getElementById\('le-launch-panel'\)/)
assert.match(sales,/location\.pathname!=='\/demo'/)
assert.match(html,/sales-upgrade\.js\?v=20261021-demo-route-only-2/)
assert.match(html,/launch-center\.js\?v=20261021-no-duplicate-2/)
console.log('Live workspace launch panel and demo isolation guards passed')
