// Server-only Vercel Function. Never expose Stripe or Supabase service secrets to the browser.
// Production is deliberately fail-closed until all required environment variables are configured.
import { createClient } from '@supabase/supabase-js'

const PRICE = 'price_1URCPvIS04s94hSMFJ9azsC8'
const ORIGIN = 'https://loose-ends-os.vercel.app'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const respond = (res, code, message) => res.status(code).json({ error: message })

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Vary', 'Origin')
  const origin = req.headers.origin
  if (origin && origin !== ORIGIN) return respond(res, 403, 'Origin not allowed')
  if (origin === ORIGIN) res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(204).end()
  }
  if (req.method !== 'POST') return respond(res, 405, 'POST required')
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env
  if (![SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY].every(Boolean))
    return respond(res, 503, 'Billing is not configured')
  const auth = req.headers.authorization || ''
  if (!/^Bearer\\s+\\S+$/.test(auth)) return respond(res, 401, 'Sign in required')
  const workspaceId = req.body?.workspace_id
  if (typeof workspaceId !== 'string' || !uuid.test(workspaceId)) return respond(res, 400, 'Valid workspace required')
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: identity, error: authError } = await client.auth.getUser()
    if (authError || !identity.user) return respond(res, 401, 'Invalid session')
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: member, error: memberError } = await admin.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', identity.user.id).maybeSingle()
    if (memberError) return respond(res, 503, 'Unable to verify membership')
    if (!member || !['owner', 'admin'].includes(member.role)) return respond(res, 403, 'Billing access denied')
    const { data: existing, error: subError } = await admin.from('workspace_subscriptions').select('provider_customer_id,provider_subscription_id,status').eq('workspace_id', workspaceId).maybeSingle()
    if (subError) return respond(res, 503, 'Unable to verify subscription')
    if (existing?.provider_subscription_id && ['active','trialing','past_due','unpaid','incomplete','paused'].includes(existing.status))
      return respond(res, 409, 'Existing subscription must be managed through billing portal')
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': PRICE,
      'line_items[0][quantity]': '1',
      success_url: ORIGIN + '/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: ORIGIN + '/dashboard?billing=cancelled',
      client_reference_id: workspaceId,
      'metadata[workspace_id]': workspaceId,
      'metadata[user_id]': identity.user.id,
      'metadata[plan_key]': 'revenue_recovery',
      'subscription_data[metadata][workspace_id]': workspaceId,
      'subscription_data[metadata][user_id]': identity.user.id,
      'subscription_data[metadata][plan_key]': 'revenue_recovery',
      billing_address_collection: 'required'
    })
    if (existing?.provider_customer_id) params.set('customer', existing.provider_customer_id)
    else if (identity.user.email) params.set('customer_email', identity.user.email)
    const stripe = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
    })
    const result = await stripe.json()
    if (!stripe.ok || typeof result.url !== 'string' || !result.url.startsWith('https://checkout.stripe.com/')) {
      console.error('Stripe checkout creation failed', stripe.status)
      return respond(res, 502, 'Unable to start checkout')
    }
    return res.status(200).json({ url: result.url })
  } catch (error) {
    console.error('Checkout error', error instanceof Error ? error.message : 'unknown')
    return respond(res, 500, 'Unable to start checkout')
  }
}
