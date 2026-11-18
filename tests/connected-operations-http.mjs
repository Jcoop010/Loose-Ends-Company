// Live integration test. Run only with a disposable QA workspace/account.
// LE_QA_SESSION_FILE contains {token,workspace,otherWorkspace}; never committed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadSrcModule } from './helpers/load-src-module.mjs'

const sessionPath = process.env.LE_QA_SESSION_FILE
if (!sessionPath) throw new Error('LE_QA_SESSION_FILE must identify a disposable QA session')
const q = JSON.parse(readFileSync(sessionPath, 'utf8'))

const base = 'https://uehfvpnnoitgybsmdgef.supabase.co'
const apikey = 'sb_publishable_Lxk1H5zRhlKkx8IVHV7Aiw_EXC4BC2g'

async function request(route, body, expected = 200, method = 'POST') {
  const r = await fetch(base + route, {
    method,
    headers: {
      apikey,
      Authorization: 'Bearer ' + q.token,
      'content-type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { message: text.slice(0, 200) }
  }
  assert.equal(r.status, expected, route + ' ' + JSON.stringify(data))
  return data
}

const rpc = (action, payload, key = crypto.randomUUID(), expected = 200, ws = q.workspace) =>
  request(
    '/rest/v1/rpc/ops_command',
    { p_workspace: ws, p_action: action, p_payload: payload, p_key: key },
    expected,
  )
const get = p => request('/rest/v1/' + p, undefined, 200, 'GET')

const { parseCustomerCsv } = loadSrcModule('src/lib/csv.ts')
const rows = parseCustomerCsv(
  'first_name,last_name,email,phone\n"Quoted, Customer","Line\nBreak",ops-contact@example.invalid,5550000100\nDuplicate,Contact,ops-contact@example.invalid,5550000100',
)

const invoke = body =>
  request('/functions/v1/customer-bulk-import', { workspace_id: q.workspace, ...body })

const start = await invoke({ action: 'start' })
assert.ok(start.job.id)
const job = start.job.id

await request(
  '/functions/v1/customer-bulk-import',
  { workspace_id: q.otherWorkspace, action: 'status', job_id: job },
  403,
)
await request(
  '/functions/v1/customer-bulk-import',
  { workspace_id: q.workspace, action: 'finish', job_id: job, expected_batches: 2, expected_rows: 3 },
  409,
)

const batch = { action: 'batch', job_id: job, batch_number: 0, rows }
await invoke(batch)
const replay = await invoke(batch)
assert.equal(replay.replayed, true)

const status = await invoke({ action: 'status', job_id: job })
assert.equal(status.job.processed, 2)
await invoke({
  action: 'batch',
  job_id: job,
  batch_number: 1,
  rows: [{ first_name: 'Resumed', email: 'ops-resume@example.invalid' }],
})
const done = await invoke({ action: 'finish', job_id: job, expected_batches: 2, expected_rows: 3 })
assert.equal(done.job.status, 'completed')
assert.equal(done.job.processed, 3)

const contacts = await get(
  'customers?workspace_id=eq.' + q.workspace + '&select=id,first_name,last_name,email',
)
assert.ok(contacts.some(c => c.first_name === 'Quoted, Customer' && c.last_name === 'Line\nBreak'))

const item = await rpc('inventory_save', {
  name: 'HTTP QA item',
  sku: 'HTTP-QA',
  purchase_cost: 12,
  selling_price: 24,
  reorder_threshold: 2,
  reorder_quantity: 5,
})
const key = crypto.randomUUID()
await rpc('stock_move', { id: item.id, kind: 'receipt', quantity: 5, reason: 'QA receipt' }, key)
await rpc('stock_move', { id: item.id, kind: 'receipt', quantity: 5, reason: 'QA receipt' }, key)
await rpc('stock_move', { id: item.id, kind: 'adjustment', quantity: -6, reason: 'QA negative' }, crypto.randomUUID(), 400)
await rpc('stock_move', { id: item.id, kind: 'receipt', quantity: 5, reason: 'QA cross workspace' }, crypto.randomUUID(), 403, q.otherWorkspace)

const work = await rpc('job_save', { title: 'HTTP QA job', customer_id: contacts[0].id, labor_total: 40 })
await rpc('reserve_material', { id: work.id, item_id: item.id, quantity: 3 })
for (const st of ['quoted', 'approved', 'in_progress', 'completed']) {
  await rpc('job_transition', {
    id: work.id,
    status: st,
    ...(st === 'approved' ? { approval_evidence: 'QA approval reference' } : {}),
    ...(st === 'completed' ? { checklist_confirmed: true } : {}),
  })
}

await request('/rest/v1/inventory_items?workspace_id=eq.' + q.workspace, { quantity: 999 }, 403, 'PATCH')
await request('/rest/v1/ops_queue?workspace_id=eq.' + q.workspace, { status: 'completed' }, 403, 'PATCH')

console.log('PASS live customer import and connected operations RPC verification.')
