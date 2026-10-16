import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/workflow-runner/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replace(/^import .*;?$/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const calls = []
let handler
const context = {
  Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://example.invalid' : 'test-key' }, serve: fn => { handler = fn } },
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
    from: table => {
      calls.push(table)
      return { select() { return this }, eq() { return this }, limit() { return this }, maybeSingle: async () => ({ data: table === 'workspace_members' ? null : null, error: null }) }
    } }),
  Response, Date, String, Number, console
}
runInNewContext(compiled, context)
assert.equal(typeof handler, 'function')
const unauthorized = await handler(new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'Bearer example' }, body: JSON.stringify({ workspace_id: 'other-workspace' }) }))
assert.equal(unauthorized.status, 403, 'nonmember must not run a different workspace automation')
assert.equal(calls.includes('workflow_events'), false, 'nonmember request must not access workflow event queue')
const noAuth = await handler(new Request('https://example.invalid', { method: 'POST', body: '{}' }))
assert.equal(noAuth.status, 401)
assert.match(source, /eq\("status", "waiting_approval"\)/, 'approval must atomically claim pending run')
assert.match(source, /Workflow has no actions to execute/, 'empty workflows must fail closed')
console.log('Workflow security regression assertions passed')
