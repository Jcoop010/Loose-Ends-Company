import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../public/operations-premium.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(html,/operations-premium\.css\?v=20261021-executive-1/);
for(const required of ['body.ops-active .ops-page .page-head','body.ops-active .ops-metric','@media(max-width:750px)','prefers-reduced-motion','focus-visible'])assert.ok(css.includes(required),required);
assert.doesNotMatch(css,/display:\s*none\s*!important/);
console.log('Premium operations UI stylesheet regression checks passed');
