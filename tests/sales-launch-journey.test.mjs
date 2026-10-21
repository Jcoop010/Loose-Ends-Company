import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const page=readFileSync(new URL('../public/revenue-checkup.html',import.meta.url),'utf8')
const app=readFileSync(new URL('../v3.1/launch-center.js',import.meta.url),'utf8')
for(const phrase of ['Create your business workspace','Choose the $199/month plan','Import and review opportunities','No automated customer messages'])assert.ok(page.includes(phrase),phrase)
assert.match(page,/href="\/demo"/)
assert.match(page,/href="\/dashboard"/)
assert.match(app,/create-subscription-checkout/)
assert.match(app,/checkout\.stripe\.com/)
console.log('Sales journey copy and secure checkout link guards passed')
