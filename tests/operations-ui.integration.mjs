// Real Supabase-backed SDK integration check against a disposable QA workspace.
// Run only with LE_QA_CREDENTIALS_FILE.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const credsPath = process.env.LE_QA_CREDENTIALS_FILE
if (!credsPath) throw new Error('Disposable LE_QA_CREDENTIALS_FILE required')
const q = JSON.parse(readFileSync(credsPath, 'utf8'))

const client = createClient(
  'https://uehfvpnnoitgybsmdgef.supabase.co',
  'sb_publishable_Lxk1H5zRhlKkx8IVHV7Aiw_EXC4BC2g',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
)

const login = await client.auth.signInWithPassword({ email: q.email, password: q.password })
assert.ifError(login.error)

try {
  const cmd = async (action, payload, key = crypto.randomUUID()) => {
    const res = await client.rpc('ops_command', {
      p_workspace: q.workspace,
      p_action: action,
      p_payload: payload,
      p_key: key,
    })
    assert.ifError(res.error)
    return res.data
  }

  await cmd('coordination_policy', {
    enabled: true,
    coordinate_enabled: true,
    enforce_hours: false,
    timezone: 'UTC',
    business_start: '08:00',
    business_end: '18:00',
    business_days: [1, 2, 3, 4, 5],
    travel_buffer: 15,
    industry: 'hvac',
  })

  await cmd('employee_save', {
    user_id: q.user,
    display_name: 'QA Dispatch Technician',
    job_title: 'Service Technician',
    skills: ['HVAC', 'Diagnostics'],
    active: true,
  })

  const summary = await client.rpc('ops_summary', { p_workspace: q.workspace })
  assert.ifError(summary.error)
  assert.ok(typeof summary.data.open_jobs === 'number')

  console.log('PASS live Supabase SDK integration check.')
} finally {
  client.auth.stopAutoRefresh()
}
