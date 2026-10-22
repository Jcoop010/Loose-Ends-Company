import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../v3.1/operations-os.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const phrase of ['Operations not configured','Operations paused by workspace policy','Operations enabled','Background infrastructure may still be running'])assert.ok(source.includes(phrase),phrase);
assert.match(html,/operations-os\.js\?v=20261022-policy-status-2/);
console.log('Workspace automation state presentation regression passed');
