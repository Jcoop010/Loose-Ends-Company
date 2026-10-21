import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync(new URL('../v3.1/launch-center.js',import.meta.url),'utf8')
const page=readFileSync(new URL('../public/revenue-checkup.html',import.meta.url),'utf8')
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8')
assert.match(app,/Review and approve follow-up drafts/)
assert.match(app,/owner-reported outcomes separately from verified payments/)
assert.match(app,/create-subscription-checkout/)
assert.match(app,/checkout\.stripe\.com/)
assert.match(html,/launch-center\.js\?v=20261021-sales-accurate-1/)
assert.match(page,/Get up and running in three steps/)
console.log('Sellable onboarding guidance and checkout path validated')
