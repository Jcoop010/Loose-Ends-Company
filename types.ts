export interface Business {
  id: string
  name: string
  owner: string
  industry: string
  phone: string
  email: string
  address: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  status: 'Active' | 'Follow-Up Due' | 'Inactive' | 'Maintenance Due'
  vehicleId?: string
  lastService: string
  lastServiceDescription: string
  lifetimeValue: number
  nextFollowUp?: string
  notes?: string[]
  createdAt: string
}

export interface Vehicle {
  id: string
  customerId: string
  year: number
  make: string
  model: string
  mileage: number
}

export interface Job {
  id: string
  customerId: string
  vehicleId: string
  description: string
  date: string
  amount: number
  status: 'Completed' | 'In Progress' | 'Scheduled'
}

export interface Estimate {
  id: string
  customerId: string
  vehicleId: string
  description: string
  date: string
  amount: number
  status: 'Pending' | 'Approved' | 'Declined' | 'Expired'
}

export type OpportunityStatus = 'Potential' | 'Contacted' | 'Responded' | 'Scheduled' | 'Completed' | 'Collected'
export type OpportunityType = 'Missed Call' | 'Old Estimate' | 'Declined Work' | 'Inactive Customer' | 'Maintenance Due' | 'Other'

export interface Opportunity {
  id: string
  customerId: string
  customerName: string
  type: OpportunityType
  status: OpportunityStatus
  potentialValue: number
  collectedAmount?: number
  dateIdentified: string
  lastContact?: string
  nextAction: string
  notes?: string
}

export type FollowUpStatus = 'Due Today' | 'Upcoming' | 'Completed' | 'Snoozed' | 'Dismissed'

export interface FollowUp {
  id: string
  customerId: string
  customerName: string
  reason: string
  potentialValue: number
  lastContact?: string
  nextAction: string
  dueDate: string
  status: FollowUpStatus
}

export interface Alert {
  id: string
  type: 'URGENT' | 'FOLLOW-UP' | 'OPPORTUNITY' | 'MAINTENANCE'
  severity: 'urgent' | 'warning' | 'info' | 'success'
  customerId?: string
  customerName?: string
  reason: string
  dollarValue?: number
  date: string
  recommendedAction: string
  dismissed?: boolean
}

export interface Request {
  id: string
  request: string
  priority: 'High' | 'Medium' | 'Low'
  dueDate?: string
  status: 'New' | 'In Progress' | 'Waiting' | 'Complete'
  createdAt: string
  notes?: string
}

export interface MarketingTask {
  id: string
  type: string
  title: string
  description: string
  status: 'Pending' | 'In Progress' | 'Complete'
  dueDate?: string
}

export interface RevenueEvent {
  id: string
  opportunityId: string
  customerId: string
  customerName: string
  amount: number
  date: string
  description: string
  type: 'Recovered' | 'New' | 'Retained'
}

export interface TimelineEvent {
  id: string
  customerId: string
  type: 'Repair' | 'Estimate' | 'Communication' | 'Follow-up' | 'Review' | 'Appointment' | 'Diagnosis' | 'Payment'
  title: string
  description: string
  date: string
  amount?: number
}

export interface Integration {
  id: string
  name: string
  category: string
  status: 'Connected' | 'Not Connected'
  description: string
}

export interface Lead {
  id: string
  name: string
  business: string
  phone: string
  email: string
  businessType: string
  biggestProblem: string
  createdAt: string
}

export interface AppData {
  business: Business
  customers: Customer[]
  vehicles: Vehicle[]
  jobs: Job[]
  estimates: Estimate[]
  opportunities: Opportunity[]
  followUps: FollowUp[]
  alerts: Alert[]
  requests: Request[]
  marketingTasks: MarketingTask[]
  revenueEvents: RevenueEvent[]
  timelineEvents: TimelineEvent[]
  integrations: Integration[]
  leads: Lead[]
}
