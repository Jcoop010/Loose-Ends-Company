import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const css=readFileSync(new URL('../v3.1/overview-focus.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8')
assert.match(css,/@media\(max-width:700px\)/)
for(const selector of ['#le-launch-panel .le-launch-steps{display:none!important}', '#le-launch-panel .le-launch-actions button:nth-child(n+3){display:none!important}', '#le-verified-collections{display:none!important}'])assert.ok(css.includes(selector),selector)
assert.match(html,/overview-focus\.js\?v=20261021-mobile-focus-2/)
assert.match(css,/if\(!overview\)return/)
console.log('Mobile dashboard focus regression checks passed')
