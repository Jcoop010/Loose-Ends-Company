import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const src=readFileSync(new URL('../v3.1/live-product-layer.js',import.meta.url),'utf8')
const start=src.indexOf('function parseCsv(text){')
const end=src.indexOf('async function importRun(){',start)
assert.ok(start>=0&&end>start)
const parse=runInNewContext('('+src.slice(start,end).trim()+')')
assert.deepEqual(JSON.parse(JSON.stringify(parse('email,first_name,notes\na@example.com,Amy,"Phone, email"\n'))),[{email:'a@example.com',first_name:'Amy',notes:'Phone, email'}])
assert.equal(parse('email,notes\na@example.com,"line one\nline two"')[0].notes,'line one\nline two')
assert.equal(parse('email,notes\na@example.com,"She said ""hello"""')[0].notes,'She said "hello"')
assert.equal(parse('\uFEFFemail,phone\r\na@example.com,555-0101\r\n')[0].email,'a@example.com')
assert.throws(()=>parse('email,notes\na@example.com,"unfinished'),/unclosed quoted field/)
assert.throws(()=>parse('first_name,last_name\nAmy,Test'),/email or phone/)
console.log('CSV parser quoted-field, multiline, CRLF and malformed-input tests passed')
