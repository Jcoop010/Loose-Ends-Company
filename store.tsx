import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppData, Business, Opportunity, FollowUp, Request, Lead, MarketingTask, Customer } from './types'
import { seedData, STORAGE_KEY } from './data'

function genId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 10)}`
}

function cloneSeed(): AppData {
  return JSON.parse(JSON.stringify(seedData)) as AppData
}

function loadData(): AppData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppData>
      return {
        ...cloneSeed(),
        ...parsed,
        business: { ...seedData.business, ...(parsed.business || {}) },
        customers: Array.isArray(parsed.customers) ? parsed.customers : cloneSeed().customers,
        vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : cloneSeed().vehicles,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : cloneSeed().jobs,
        estimates: Array.isArray(parsed.estimates) ? parsed.estimates : cloneSeed().estimates,
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : cloneSeed().opportunities,
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps : cloneSeed().followUps,
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : cloneSeed().alerts,
        requests: Array.isArray(parsed.requests) ? parsed.requests : cloneSeed().requests,
        marketingTasks: Array.isArray(parsed.marketingTasks) ? parsed.marketingTasks : cloneSeed().marketingTasks,
        revenueEvents: Array.isArray(parsed.revenueEvents) ? parsed.revenueEvents : cloneSeed().revenueEvents,
        timelineEvents: Array.isArray(parsed.timelineEvents) ? parsed.timelineEvents : cloneSeed().timelineEvents,
        integrations: Array.isArray(parsed.integrations) ? parsed.integrations : cloneSeed().integrations,
        leads: Array.isArray(parsed.leads) ? parsed.leads : cloneSeed().leads,
      }
    }
  } catch {
    // Corrupt or unavailable browser storage should never prevent the app from loading.
  }
  return cloneSeed()
}

interface StoreContextValue {
  data: AppData
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
  dismissFollowUp: (id: string) => void
  resetData: () => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // ignore
    }
  }, [data])

  const updateBusiness = useCallback((updates: Partial<Business>) => {
    setData(prev => ({ ...prev, business: { ...prev.business, ...updates } }))
  }, [])

  const updateOpportunity = useCallback((id: string, updates: Partial<Opportunity>) => {
    setData(prev => ({
      ...prev,
      opportunities: prev.opportunities.map(o => (o.id === id ? { ...o, ...updates } : o)),
    }))
  }, [])

  const updateFollowUp = useCallback((id: string, updates: Partial<FollowUp>) => {
    setData(prev => ({
      ...prev,
      followUps: prev.followUps.map(f => (f.id === id ? { ...f, ...updates } : f)),
    }))
  }, [])

  const dismissAlert = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      alerts: prev.alerts.map(a => (a.id === id ? { ...a, dismissed: true } : a)),
    }))
  }, [])

  const addRequest = useCallback((req: Omit<Request, 'id' | 'createdAt'>) => {
    setData(prev => ({
      ...prev,
      requests: [{ ...req, id: genId('r'), createdAt: new Date().toISOString() }, ...prev.requests],
    }))
  }, [])

  const updateRequest = useCallback((id: string, updates: Partial<Request>) => {
    setData(prev => ({
      ...prev,
      requests: prev.requests.map(r => (r.id === id ? { ...r, ...updates } : r)),
    }))
  }, [])

  const updateMarketingTask = useCallback((id: string, updates: Partial<MarketingTask>) => {
    setData(prev => ({ ...prev, marketingTasks: prev.marketingTasks.map(task => task.id === id ? { ...task, ...updates } : task) }))
  }, [])

  const toggleIntegration = useCallback((id: string) => {
    setData(prev => ({ ...prev, integrations: prev.integrations.map(item => item.id === id ? { ...item, status: item.status === 'Connected' ? 'Not Connected' : 'Connected' } : item) }))
  }, [])

  const addLead = useCallback((lead: Omit<Lead, 'id' | 'createdAt'>) => {
    setData(prev => ({
      ...prev,
      leads: [{ ...lead, id: genId('lead'), createdAt: new Date().toISOString() }, ...prev.leads],
    }))
  }, [])

  const addCustomer = useCallback((customer: Omit<Customer, 'id' | 'createdAt'>) => {
    const id = genId('c')
    setData(prev => ({
      ...prev,
      customers: [{ ...customer, id, createdAt: new Date().toISOString() }, ...prev.customers],
    }))
    return id
  }, [])

  const updateCustomer = useCallback((id: string, updates: Partial<Customer>) => {
    setData(prev => ({
      ...prev,
      customers: prev.customers.map(c => c.id === id ? { ...c, ...updates } : c),
    }))
  }, [])

  const addNoteToCustomer = useCallback((customerId: string, note: string) => {
    setData(prev => ({
      ...prev,
      customers: prev.customers.map(c =>
        c.id === customerId ? { ...c, notes: [...(c.notes || []), note] } : c,
      ),
    }))
  }, [])

  const addOpportunity = useCallback((opp: Omit<Opportunity, 'id'>) => {
    setData(prev => ({
      ...prev,
      opportunities: [{ ...opp, id: genId('o') }, ...prev.opportunities],
    }))
  }, [])

  const addFollowUp = useCallback((fu: Omit<FollowUp, 'id'>) => {
    setData(prev => ({
      ...prev,
      followUps: [{ ...fu, id: genId('f') }, ...prev.followUps],
    }))
  }, [])

  const dismissFollowUp = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      followUps: prev.followUps.map(f => (f.id === id ? { ...f, status: 'Dismissed' as const } : f)),
    }))
  }, [])

  const resetData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(`${STORAGE_KEY}_notifications`)
    setData(cloneSeed())
  }, [])

  return (
    <StoreContext.Provider
      value={{
        data,
        updateBusiness,
        updateOpportunity,
        updateFollowUp,
        dismissAlert,
        addRequest,
        updateRequest,
        updateMarketingTask,
        toggleIntegration,
        addLead,
        addNoteToCustomer,
        addCustomer,
        updateCustomer,
        addOpportunity,
        addFollowUp,
        dismissFollowUp,
        resetData,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
