import assert from 'node:assert/strict'
import { loadSrcModule } from './helpers/load-src-module.mjs'

const csv = loadSrcModule('src/lib/csv.ts')

// 1. Quoted commas
assert.deepEqual(
  JSON.parse(JSON.stringify(csv.parseCsvObjects('email,first_name,notes\na@example.com,Amy,"Phone, email"\n'))),
  [{ email: 'a@example.com', first_name: 'Amy', notes: 'Phone, email' }],
)

// 2. Multiline embedded newline inside quotes
assert.equal(
  csv.parseCsvObjects('email,notes\na@example.com,"line one\nline two"')[0].notes,
  'line one\nline two',
)

// 3. Escaped double quotes (`""`)
assert.equal(
  csv.parseCsvObjects('email,notes\na@example.com,"She said ""hello"""')[0].notes,
  'She said "hello"',
)

// 4. UTF-8 BOM + CRLF handling
assert.equal(
  csv.parseCustomerCsv('\uFEFFemail,phone\r\na@example.com,555-0101\r\n')[0].email,
  'a@example.com',
)

// 5. Unclosed quoted field throws descriptive error
assert.throws(
  () => csv.parseCustomerCsv('email,notes\na@example.com,"unfinished'),
  /unclosed double-quoted field/i,
)

// 6. Empty contact rows ignored; SHA-256 digest is deterministic 64-hex
assert.equal(csv.parseCustomerCsv('first_name,last_name\n,\n').length, 0)
const digest = await csv.sha256Hex('email\na@example.com\n')
assert.match(digest, /^[0-9a-f]{64}$/)

console.log('CSV parser quoted-field, multiline, CRLF and malformed-input tests passed')
