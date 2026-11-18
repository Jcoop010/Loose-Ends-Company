import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const { parseCsvMatrix } = loadSrcModule('src/lib/csv.ts')

assert.equal(
  parseCsvMatrix('name,sku,description\r\n"Part, A",A1,"line 1\nline 2"')[1][2],
  'line 1\nline 2',
)
assert.equal(
  parseCsvMatrix('\uFEFFname,sku\n"A ""quoted"" part",A1')[1][0],
  'A "quoted" part',
)
assert.throws(() => parseCsvMatrix('name,sku\n"broken,A1'), /unclosed/i)

// Verify /demo sandbox is completely isolated from production ops_command RPCs
const demoStore = readSrc('src/state/DemoStoreContext.tsx')
const demoPage = readSrc('src/features/demo/DemoWorkspacePage.tsx')

assert.doesNotMatch(demoStore, /opsCommand|supabase\.rpc/)
assert.doesNotMatch(demoPage, /opsCommand|supabase\.rpc/)

console.log('Operations CSV and demo-isolation runtime cases passed')
