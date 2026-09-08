import { supabase } from './supabase'
import { seedData } from './data'
import type { AppData, Customer, Opportunity, FollowUp, RevenueEvent } from './types'

const uuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return { first_name: parts.shift() || '', last_name: parts.join(' ') }
}

/** Database lifecycle states intentionally mirror the UI pipeline. */
const DB_OPPORTUNITY_STATUS: Record<Opportunity['status'], string> = {
  Potential: 'open',
  Contacted: 'contacted',
  Responded: 'responded',
  Scheduled: 'scheduled',
  Completed: 'completed',
  Collected: 'recovered',
}

function uiOpportunityStatus(status: string): Opportunity['status'] | null {
  const map: Record<string, Opportunity['status']> = {
    open: 'Potential',
    contacted: 'Contacted',
    responded: 'Responded',
    scheduled: 'Scheduled',
    completed: 'Completed',
    recovered: 'Collected',
  }
  return map[status] || null
}

function dbFollowUpStatus(status: FollowUp['status']): string {
  if (status === 'Completed') return 'completed'
  if (status === 'Dismissed') return 'dismissed'
  return 'pending'
}

function uiFollowUpStatus(status: string, scheduledAt?: string | null): FollowUp['status'] {
  if (status === 'completed') return 'Completed'
  if (status === 'dismissed') return 'Dismissed'
  if (status === 'pending') {
    if (scheduledAt) {
      const due = new Date(scheduledAt)
      const now = new Date()
      if (due.toDateString() === now.toDateString()) return 'Due Today'
    }
    return 'Upcoming'
  }
  return 'Upcoming'
}

export async function getOrCreateWorkspace() {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw userError || new Error('Not authenticated')
  const user = userData.user

  // Never pick an arbitrary workspace. First resolve a workspace the current
  // user actually belongs to; this matters as soon as an account has >1 workspace.
  const membership = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces(id,name)')
    .eq('user_id', user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  if (membership.error) throw membership.error
  const memberWorkspace = Array.isArray(membership.data?.workspaces)
    ? membership.data?.workspaces[0]
    : membership.data?.workspaces
  if (memberWorkspace?.id) return { id: memberWorkspace.id, name: memberWorkspace.name }

  const name = user.user_metadata?.business_name || `${user.email?.split('@')[0] || 'My'} Workspace`
  const created = await supabase.from('workspaces').insert({ name, owner_user_id: user.id }).select('id,name').single()
  if (created.error) throw created.error
  const newMembership = await supabase.from('workspace_members').insert({ workspace_id: created.data.id, user_id: user.id, role: 'owner' })
  if (newMembership.error) throw newMembership.error
  return created.data
}

async function bootstrapDemoData(workspaceId: string) {
  const customers = seedData.customers.map(c => ({
    id: uuid(), workspace_id: workspaceId, external_id: c.id,
    first_name: splitName(c.name).first_name, last_name: splitName(c.name).last_name,
    email: c.email || null, phone: c.phone || null,
    notes: [`[LE_STATUS=${c.status}]`, `[LE_LTV=${c.lifetimeValue}]`, `[LE_LAST_SERVICE=${c.lastService}]`, ...(c.notes || [])].join('\n'),
  }))
  const customerIds = new Map(seedData.customers.map((c, i) => [c.id, customers[i].id]))

  const opportunities = seedData.opportunities.map(o => ({
    id: uuid(), workspace_id: workspaceId, customer_id: customerIds.get(o.customerId) || null,
    title: o.notes || o.nextAction, source: o.type.toLowerCase().replace(/\s+/g, '_'),
    status: DB_OPPORTUNITY_STATUS[o.status], amount: o.potentialValue,
    recovered_amount: o.collectedAmount || 0, priority: o.potentialValue >= 1000 ? 1 : o.potentialValue >= 500 ? 2 : 3,
    reason: o.nextAction, due_at: o.lastContact || null,
  }))
  const opportunityIds = new Map(seedData.opportunities.map((o, i) => [o.id, opportunities[i].id]))

  const followUps = seedData.followUps.map(f => ({
    id: uuid(), workspace_id: workspaceId, customer_id: customerIds.get(f.customerId) || null,
    opportunity_id: null, channel: 'task', message: f.nextAction || f.reason,
    scheduled_at: f.dueDate || null, status: dbFollowUpStatus(f.status),
  }))

  const recovery = seedData.revenueEvents.map(e => ({
    id: uuid(), workspace_id: workspaceId, opportunity_id: opportunityIds.get(e.opportunityId) || null,
    customer_id: customerIds.get(e.customerId) || null, amount: e.amount, created_at: e.date,
    note: e.description, source: e.type,
  }))

  const results = await Promise.all([
    supabase.from('customers').insert(customers),
    supabase.from('opportunities').insert(opportunities),
    supabase.from('follow_ups').insert(followUps),
    supabase.from('recovery_events').insert(recovery),
  ])
  const failed = results.find(r => r.error)
  if (failed?.error) throw failed.error
}

function dbCustomer(c: Customer, workspaceId: string) {
  const name = splitName(c.name)
  const notes = (c.notes || []).filter(n => !n.startsWith('[LE_')).join('\n')
  return { id: c.id, workspace_id: workspaceId, first_name: name.first_name, last_name: name.last_name, email: c.email || null, phone: c.phone || null, notes, external_id: null }
}

function uiCustomer(c: any): Customer {
  const rawNotes = c.notes ? c.notes.split('\n').filter(Boolean) : []
  const statusMatch = rawNotes.find((n: string) => n.startsWith('[LE_STATUS='))
  const ltvMatch = rawNotes.find((n: string) => n.startsWith('[LE_LTV='))
  const serviceMatch = rawNotes.find((n: string) => n.startsWith('[LE_LAST_SERVICE='))
  const validStatus: Customer['status'][] = ['Active', 'Follow-Up Due', 'Inactive', 'Maintenance Due']
  const parsedStatus = statusMatch?.slice(11, -1) as Customer['status']
  const status = validStatus.includes(parsedStatus) ? parsedStatus : 'Active'
  return {
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unnamed Customer',
    phone: c.phone || '', email: c.email || '', status,
    lastService: serviceMatch ? serviceMatch.slice(18, -1) : '',
    lastServiceDescription: '', lifetimeValue: ltvMatch ? Number(ltvMatch.slice(8, -1)) || 0 : 0,
    notes: rawNotes.filter((n: string) => !n.startsWith('[LE_')),
    createdAt: c.created_at,
  }
}

function uiOpportunity(o: any, customers: Customer[]): Opportunity | null {
  const status = uiOpportunityStatus(o.status)
  if (!status) return null
  const customer = customers.find(c => c.id === o.customer_id)
  const typeMap: Record<string, Opportunity['type']> = { missed_call: 'Missed Call', old_estimate: 'Old Estimate', declined_work: 'Declined Work', inactive_customer: 'Inactive Customer', maintenance_due: 'Maintenance Due' }
  return { id: o.id, customerId: o.customer_id || '', customerName: customer?.name || 'Unknown customer', type: typeMap[o.source] || 'Other', status, potentialValue: Number(o.amount || 0), collectedAmount: Number(o.recovered_amount || 0), dateIdentified: o.created_at, lastContact: undefined, nextAction: o.reason || 'Review opportunity', notes: o.reason || undefined }
}

function uiFollowUp(f: any, customers: Customer[]): FollowUp {
  const customer = customers.find(c => c.id === f.customer_id)
  return { id: f.id, customerId: f.customer_id || '', customerName: customer?.name || 'Unknown customer', reason: f.message || 'Follow up', potentialValue: 0, lastContact: undefined, nextAction: f.message || 'Follow up', dueDate: f.scheduled_at || f.created_at, status: uiFollowUpStatus(f.status, f.scheduled_at) }
}

export async function loadCloudData(workspaceId: string, fallback: AppData): Promise<AppData> {
  const [customersRes, oppsRes, followUpsRes, recoveryRes] = await Promise.all([
    supabase.from('customers').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    supabase.from('opportunities').select('*').eq('workspace_id', workspaceId).order('priority', { ascending: true }),
    supabase.from('follow_ups').select('*').eq('workspace_id', workspaceId).order('scheduled_at', { ascending: true }),
    supabase.from('recovery_events').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
  ])
  if (customersRes.error) throw customersRes.error
  if (oppsRes.error) throw oppsRes.error
  if (followUpsRes.error) throw followUpsRes.error
  if (recoveryRes.error) throw recoveryRes.error

  if (customersRes.data.length === 0 && oppsRes.data.length === 0 && followUpsRes.data.length === 0 && recoveryRes.data.length === 0) {
    await bootstrapDemoData(workspaceId)
    return loadCloudData(workspaceId, fallback)
  }

  const customers = customersRes.data.map(uiCustomer)
  const opportunities = oppsRes.data.map(o => uiOpportunity(o, customers)).filter((o): o is Opportunity => Boolean(o))
  const followUps = followUpsRes.data.map(f => uiFollowUp(f, customers))
  const revenueEvents: RevenueEvent[] = recoveryRes.data.map((r: any) => ({ id: r.id, opportunityId: r.opportunity_id || '', customerId: r.customer_id || '', customerName: customers.find(c => c.id === r.customer_id)?.name || 'Unknown customer', amount: Number(r.amount || 0), date: r.created_at, description: r.note || 'Recovery event', type: 'Recovered' }))

  return { ...fallback, customers, opportunities, followUps, revenueEvents }
}

export async function persistCustomer(c: Customer, workspaceId: string) {
  const { error } = await supabase.from('customers').upsert(dbCustomer(c, workspaceId))
  if (error) throw error
}

export async function persistOpportunity(o: Opportunity, workspaceId: string) {
  const recovered = o.status === 'Collected'
  const { error } = await supabase.from('opportunities').upsert({
    id: o.id,
    workspace_id: workspaceId,
    customer_id: o.customerId || null,
    title: o.notes || o.nextAction,
    source: o.type.toLowerCase().replace(/\s+/g, '_'),
    status: DB_OPPORTUNITY_STATUS[o.status],
    amount: o.potentialValue,
    recovered_amount: o.collectedAmount || 0,
    recovered_at: recovered ? new Date().toISOString() : null,
    priority: o.potentialValue >= 1000 ? 1 : o.potentialValue >= 500 ? 2 : 3,
    reason: o.nextAction,
    due_at: o.lastContact || null,
  })
  if (error) throw error
}

export async function persistFollowUp(f: FollowUp, workspaceId: string) {
  const { error } = await supabase.from('follow_ups').upsert({
    id: f.id,
    workspace_id: workspaceId,
    customer_id: f.customerId || null,
    channel: 'task',
    message: f.nextAction || f.reason,
    scheduled_at: f.dueDate || null,
    status: dbFollowUpStatus(f.status),
    completed_at: f.status === 'Completed' ? new Date().toISOString() : null,
  })
  if (error) throw error
}

export async function persistRecovery(e: RevenueEvent, workspaceId: string) {
  const { error } = await supabase.from('recovery_events').upsert({ id: e.id, workspace_id: workspaceId, opportunity_id: e.opportunityId || null, customer_id: e.customerId || null, amount: e.amount, created_at: e.date, note: e.description, source: e.type })
  if (error) throw error
}

export { splitName }
