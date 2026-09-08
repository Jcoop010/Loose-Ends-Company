export interface Business {
  id: string
  name: string
  owner: string
  industry: string
  phone: string
  email: string
  address: string
}

export interface Vehicle {
  id: string
  customerId: string
  year: number
  make: string
  model: string
  mileage: number
  vin?: string
}

export interface Job {
  id: string
  customerId: string
  vehicleId?: string
  title: string
  description?: string
  status: string
  amount?: number
  date?: string
  createdAt: string
}

export interface Estimate {
  id: string
  customerId: string
  vehicleId?: string
  title: string
  description?: string
  amount: number
  status: string
  date?: string
  createdAt: string
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

export interface Opportunity {
  id: string
  customerId: string
  customerName: string
  type: 'Missed Call' | 'Old Estimate' | 'Declined Work' | 'Inactive Customer' | 'Maintenance Due' | 'Unpaid Invoice' | 'Unbilled Work' | 'Stalled Lead' | 'Expansion Opportunity' | 'Renewal Risk' | 'Churn Risk' | 'Payment Failure' | 'Other'
  status: 'Potential' | 'Contacted' | 'Responded' | 'Scheduled' | 'Completed' | 'Collected'
  potentialValue: number
  collectedAmount?: number
  dateIdentified: string
  lastContact?: string
  nextAction: string
  notes?: string
  source?: string
  confidence?: number
}

export type OpportunityType = Opportunity['type']

export interface FollowUp {
  id: string
  customerId: string
  customerName: string
  reason: string
  potentialValue: number
  lastContact?: string
  nextAction: string
  dueDate: string
  status: 'Due Today' | 'Upcoming' | 'Completed' | 'Snoozed' | 'Dismissed'
}

export interface Alert {
  id: string
  type: string
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
  priority: 'Low' | 'Medium' | 'High'
  dueDate?: string
  status: 'New' | 'In Progress' | 'Waiting' | 'Completed'
  createdAt: string
  notes?: string
}

export interface MarketingTask {
  id: string
  type: string
  title: string
  description: string
  status: 'Pending' | 'In Progress' | 'Completed' | 'Complete'
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
  type: 'Recovered' | 'Projected'
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

export type SalesOrderStatus = 'Draft' | 'Quoted' | 'Confirmed' | 'In Progress' | 'Fulfilled' | 'Invoiced' | 'Paid' | 'Cancelled'
export type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid'
export type CalendarEventType = 'Appointment' | 'Follow-up' | 'Delivery' | 'Call' | 'Internal' | 'Install'

export interface OrderLineItem {
  id: string
  name: string
  qty: number
  unitPrice: number
}

export interface SalesOrder {
  id: string
  number: string
  customerId: string
  customerName: string
  title: string
  status: SalesOrderStatus
  paymentStatus: PaymentStatus
  items: OrderLineItem[]
  taxRate: number
  notes?: string
  assignedTo?: string
  createdAt: string
  dueDate?: string
  scheduledAt?: string
}

export interface CalendarEvent {
  id: string
  title: string
  type: CalendarEventType
  start: string
  end: string
  customerId?: string
  customerName?: string
  orderId?: string
  location?: string
  notes?: string
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
  salesOrders?: SalesOrder[]
  calendarEvents?: CalendarEvent[]
}
