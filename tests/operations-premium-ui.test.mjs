import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../public/operations-premium.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(html,/operations-premium\.css\?v=20261022-desktop-command-center-4/);
for(const required of ['body.ops-active .ops-page .page-head','body.ops-active .ops-metric','@media(max-width:750px)','prefers-reduced-motion','focus-visible'])assert.ok(css.includes(required),required);
assert.doesNotMatch(css,/display:\s*none\s*!important/);
for(const feature of ['.ops-table-wrap','max-height:calc(100dvh - 18px)','env(safe-area-inset-bottom)','font-size:16px'])assert.ok(css.includes(feature),feature);
assert.match(css,/body #content button:not\(\[hidden\]\):not\(\.sr-only\)/);
assert.match(css,/min-height:44px!important/);
console.log('Premium operations UI and touch-target regression checks passed');

for(const feature of ['Desktop Command Center 2026-10-22','max-width:1760px','repeat(6,minmax(0,1fr))','min-height:64px'])assert.ok(css.includes(feature),feature);
