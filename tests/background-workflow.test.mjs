import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const runner = read('supabase/functions/workflow-runner/index.ts')
const migration = read('supabase/migrations/20261016150000_fail_empty_background_workflow_actions.sql')
assert.match(runner, /Workflow has no actions to execute/)
assert.match(migration, /jsonb_array_length\(wf\.actions\) = 0/)
assert.match(migration, /raise exception ''Workflow has no actions to execute''/)
assert.match(migration, /manual review required/, 'migration must fail if function definition drifted')
assert.doesNotMatch(migration, /select\s+public\.run_background_workflows\s*\(/i, 'migration must not execute background jobs')
console.log('Background workflow fail-closed checks passed')
