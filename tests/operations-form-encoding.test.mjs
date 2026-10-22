import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../v3.1/operations-os.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(source,/id="'\+esc\(id\)\+'/);
assert.match(source,/type="submit">'\+esc\(submit\)\+'/);
assert.match(html,/operations-os\.js\?v=20261022-acceptance-1/);
console.log('Operational form output encoding guards present');
