import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../v3.1/operations-os.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.match(source,/id="'\+esc\(id\)\+'/);
assert.match(source,/type="submit">'\+esc\(submit\)\+'/);
const page = new JSDOM(html);
const scripts = [...page.window.document.scripts].filter(s => /^v3\.1\/operations-os\.js\?v=[\w-]+$/.test(s.getAttribute('src') || ''));
assert.equal(scripts.length, 1, 'load one versioned operations module');
// Exercise the actual private render helpers, including attribute and text injection.
const helpers = ['esc', 'form'].map(name => {
  const line = source.split('\n').find(line => line.trimStart().startsWith('function '+name+'('));
  assert.ok(line, name+' render helper exists');
  return line;
}).join('\n');
const render = runInNewContext(helpers+'\nform');
const payload = '\" autofocus onfocus=\"alert(1)\"><img src=x onerror=alert(1)>&\'';
const fragment = JSDOM.fragment(render(payload, '<input name="fixture">', payload));
const form = fragment.querySelector('form');
assert.equal(form.id, payload);
assert.equal(form.attributes.length, 2);
assert.equal(form.querySelector('button').textContent, payload);
assert.equal(form.querySelector('button').type, 'submit');
assert.equal(form.querySelectorAll('img,script,[onfocus],[onerror],[autofocus]').length, 0);
assert.equal(fragment.children.length, 1);
page.window.close();
console.log('Operations module loading and form attribute/text injection regression passed');
