import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppData, Business, Opportunity, FollowUp, Request, Lead, MarketingTask, Customer, RevenueEvent, SalesOrder, CalendarEvent } from './types'
import { seedData, STORAGE_KEY } from './data'
import { seedSalesOrders, seedCalendarEvents } from './seedSales'
import { supabase } from './supabase'
import { getOrCreateWorkspace, loadCloudData, persistCustomer, persistOpportunity, persistFollowUp, persistRecovery } from './cloud'
import { scanRevenue } from './revenueEngine'

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function cloneSeed(): AppData {
  const data = JSON.parse(JSON.stringify(seedData)) as AppData
  data.salesOrders = JSON.parse(JSON.stringify(seedSalesOrders))
  data.calendarEvents = JSON.parse(JSON.stringify(seedCalendarEvents))
  return data
}

function loadLocalData(): AppData {
  try {
    if (typeof window === 'undefined') return cloneSeed()
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppData>
      const base = cloneSeed()
      return {
        ...base, ...parsed,
        business: { ...seedData.business, ...(parsed.business || {}) },
        customers: Array.isArray(parsed.customers) ? parsed.customers : base.customers,
        vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : base.vehicles,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : base.jobs,
        estimates: Array.isArray(parsed.estimates) ? parsed.estimates : base.estimates,
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : base.opportunities,
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps : base.followUps,
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : base.alerts,
        requests: Array.isArray(parsed.requests) ? parsed.requests : base.requests,
        marketingTasks: Array.isArray(parsed.marketingTasks) ? parsed.marketingTasks : base.marketingTasks,
        revenueEvents: Array.isArray(parsed.revenueEvents) ? parsed.revenueEvents : base.revenueEvents,
        timelineEvents: Array.isArray(parsed.timelineEvents) ? parsed.timelineEvents : base.timelineEvents,
        integrations: Array.isArray(parsed.integrations) ? parsed.integrations : base.integrations,
        leads: Array.isArray(parsed.leads) ? parsed.leads : base.leads,
        salesOrders: Array.isArray(parsed.salesOrders) ? parsed.salesOrders : base.salesOrders,
        calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : base.calendarEvents,
      }
    }
  } catch { /* fall back to seed */ }
  return cloneSeed()
}

interface StoreContextValue {
  data: AppData
  cloudReady: boolean
  updateBusiness: (updates: Partial<Business>) => void
  updateOpportunity: (id: string, updates: Partial<Opportunity>) => void
  updateFollowUp: (id: string, updates: Partial<FollowUp>) => void
  dismissAlert: (id: string) => void
  addRequest: (req: Omit<Request, 'id' | 'createdAt'>) => void
  updateRequest: (id: string, updates: Partial<Request>) => void
  updateMarketingTask: (id: string, updates: Partial<MarketingTask>) => void
  toggleIntegration: (id: string) => void
  addLead: (lead: Omit<Lead, 'id' | 'createdAt'>) => void
  addNoteToCustomer: (customerId: string, note: string) => void
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt'>) => string
  updateCustomer: (id: string, updates: Partial<Customer>) => void
  addOpportunity: (opp: Omit<Opportunity, 'id'>) => void
  addFollowUp: (fu: Omit<FollowUp, 'id'>) => void
  addRevenueEvent: (event: Omit<RevenueEvent, 'id'>) => void
  runRevenueScan: () => { created: number; potential: number }
  dismissFollowUp: (id: string) => void
  addSalesOrder: (order: Omit<SalesOrder, 'id' | 'number' | 'createdAt'>) => string
  updateSalesOrder: (id: string, updates: Partial<SalesOrder>) => void
  deleteSalesOrder: (id: string) => void
  addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => string
  updateCalendarEvent: (id: string, updates: Partial<CalendarEvent>) => void
  deleteCalendarEvent: (id: string) => void
  resetData: () => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadLocalData)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [cloudReady, setCloudReady] = useState(false)

  useEffect(() => {
    let active = true
    async function hydrate() {
      try {
        const workspace = await getOrCreateWorkspace()
        if (!active) return
        setWorkspaceId(workspace.id)
        const cloud = await loadCloudData(workspace.id, loadLocalData())
        if (active) setData(cloud)
        if (active) setCloudReady(true)
      } catch (error) {
        console.warn('Loose Ends cloud sync unavailable; using local data.', error)
        if (active) setCloudReady(false)
      }
    }
    hydrate()
    return () => { active = false }
  }, [])

  useEffect(() => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
  }, [data])

  const updateBusiness = useCallback((updates: Partial<Business>) => setData(prev => ({ ...prev, business: { ...prev.business, ...updates } })), [])
  const updateOpportunity = useCallback((id: string, updates: Partial<Opportunity>) => {
    setData(prev => {
      const next = prev.opportunities.map(o => o.id === id ? { ...o, ...updates } : o)
      const changed = next.find(o => o.id === id)
      if (workspaceId && changed) void persistOpportunity(changed, workspaceId).catch(console.error)
      return { ...prev, opportunities: next }
    })
  }, [workspaceId])
  const updateFollowUp = useCallback((id: string, updates: Partial<FollowUp>) => {
    setData(prev => {
      const next = prev.followUps.map(f => f.id === id ? { ...f, ...updates } : f)
      const changed = next.find(f => f.id === id)
      if (workspaceId && changed) void persistFollowUp(changed, workspaceId).catch(console.error)
      return { ...prev, followUps: next }
    })
  }, [workspaceId])
  const dismissAlert = useCallback((id: string) => setData(prev => ({ ...prev, alerts: prev.alerts.map(a => a.id === id ? { ...a, dismissed: true } : a) })), [])
  const addRequest = useCallback((req: Omit<Request, 'id' | 'createdAt'>) => setData(prev => ({ ...prev, requests: [{ ...req, id: genId(), createdAt: new Date().toISOString() }, ...prev.requests] })), [])
  const updateRequest = useCallback((id: string, updates: Partial<Request>) => setData(prev => ({ ...prev, requests: prev.requests.map(r => r.id === id ? { ...r, ...updates } : r) })), [])
  const updateMarketingTask = useCallback((id: string, updates: Partial<MarketingTask>) => setData(prev => ({ ...prev, marketingTasks: prev.marketingTasks.map(task => task.id === id ? { ...task, ...updates } : task) })), [])
  const toggleIntegration = useCallback((id: string) => setData(prev => ({ ...prev, integrations: prev.integrations.map(item => item.id === id ? { ...item, status: item.status === 'Connected' ? 'Not Connected' : 'Connected' } : item) })), [])
  const addLead = useCallback((lead: Omit<Lead, 'id' | 'createdAt'>) => setData(prev => ({ ...prev, leads: [{ ...lead, id: genId(), createdAt: new Date().toISOString() }, ...prev.leads] })), [])
  const addCustomer = useCallback((customer: Omit<Customer, 'id' | 'createdAt'>) => {
    const id = genId()
    const created = { ...customer, id, createdAt: new Date().toISOString() }
    setData(prev => ({ ...prev, customers: [created, ...prev.customers] }))
    if (workspaceId) void persistCustomer(created, workspaceId).catch(console.error)
    return id
  }, [workspaceId])
  const updateCustomer = useCallback((id: string, updates: Partial<Customer>) => {
    setData(prev => {
      const next = prev.customers.map(c => c.id === id ? { ...c, ...updates } : c)
      const changed = next.find(c => c.id === id)
      if (workspaceId && changed) void persistCustomer(changed, workspaceId).catch(console.error)
      return { ...prev, customers: next }
    })
  }, [workspaceId])
  const addNoteToCustomer = useCallback((customerId: string, note: string) => {
    setData(prev => {
      const next = prev.customers.map(c => c.id === customerId ? { ...c, notes: [...(c.notes || []), note] } : c)
      const changed = next.find(c => c.id === customerId)
      if (workspaceId && changed) void persistCustomer(changed, workspaceId).catch(console.error)
      return { ...prev, customers: next }
    })
  }, [workspaceId])
  const addOpportunity = useCallback((opp: Omit<Opportunity, 'id'>) => {
    const created = { ...opp, id: genId() }
    setData(prev => ({ ...prev, opportunities: [created, ...prev.opportunities] }))
    if (workspaceId) void persistOpportunity(created, workspaceId).catch(console.error)
  }, [workspaceId])
  const addFollowUp = useCallback((fu: Omit<FollowUp, 'id'>) => {
    const created = { ...fu, id: genId() }
    setData(prev => ({ ...prev, followUps: [created, ...prev.followUps] }))
    if (workspaceId) void persistFollowUp(created, workspaceId).catch(console.error)
  }, [workspaceId])
  const addRevenueEvent = useCallback((event: Omit<RevenueEvent, 'id'>) => {
    const created = { ...event, id: genId() }
    setData(prev => ({ ...prev, revenueEvents: [created, ...prev.revenueEvents] }))
    if (workspaceId) void persistRecovery(created, workspaceId).catch(console.error)
  }, [workspaceId])
  const runRevenueScan = useCallback(() => {
    const result = scanRevenue(data)
    result.opportunities.forEach(addOpportunity)
    return { created: result.opportunities.length, potential: result.totalPotential }
  }, [data, addOpportunity])
  const dismissFollowUp = useCallback((id: string) => updateFollowUp(id, { status: 'Dismissed' }), [updateFollowUp])
  const addSalesOrder = useCallback((order: Omit<SalesOrder, 'id' | 'number' | 'createdAt'>) => {
    const id = genId()
    setData(prev => {
      const seq = (prev.salesOrders || []).length + 1001
      const created: SalesOrder = { ...order, id, number: `SO-${seq}`, createdAt: new Date().toISOString() }
      return { ...prev, salesOrders: [created, ...(prev.salesOrders || [])] }
    })
    return id
  }, [])
  const updateSalesOrder = useCallback((id: string, updates: Partial<SalesOrder>) => {
    setData(prev => ({ ...prev, salesOrders: (prev.salesOrders || []).map(o => o.id === id ? { ...o, ...updates } : o) }))
  }, [])
  const deleteSalesOrder = useCallback((id: string) => {
    setData(prev => ({ ...prev, salesOrders: (prev.salesOrders || []).filter(o => o.id !== id) }))
  }, [])
  const addCalendarEvent = useCallback((event: Omit<CalendarEvent, 'id'>) => {
    const id = genId()
    setData(prev => ({ ...prev, calendarEvents: [{ ...event, id }, ...(prev.calendarEvents || [])] }))
    return id
  }, [])
  const updateCalendarEvent = useCallback((id: string, updates: Partial<CalendarEvent>) => {
    setData(prev => ({ ...prev, calendarEvents: (prev.calendarEvents || []).map(e => e.id === id ? { ...e, ...updates } : e) }))
  }, [])
  const deleteCalendarEvent = useCallback((id: string) => {
    setData(prev => ({ ...prev, calendarEvents: (prev.calendarEvents || []).filter(e => e.id !== id) }))
  }, [])
  const resetData = useCallback(() => {
    try { if (typeof window !== 'undefined') { window.localStorage.removeItem(STORAGE_KEY); window.localStorage.removeItem(`${STORAGE_KEY}_notifications`) } } catch { /* ignore */ }
    setData(cloneSeed())
  }, [])
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(() => {})
    return () => listener.subscription.unsubscribe()
  }, [])
  return <StoreContext.Provider value={{ data, cloudReady, updateBusiness, updateOpportunity, updateFollowUp, dismissAlert, addRequest, updateRequest, updateMarketingTask, toggleIntegration, addLead, addNoteToCustomer, addCustomer, updateCustomer, addOpportunity, addFollowUp, addRevenueEvent, runRevenueScan, dismissFollowUp, addSalesOrder, updateSalesOrder, deleteSalesOrder, addCalendarEvent, updateCalendarEvent, deleteCalendarEvent, resetData }}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
