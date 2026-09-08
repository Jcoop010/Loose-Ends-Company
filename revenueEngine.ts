import type { AppData, Opportunity, OpportunityType } from './types'

export interface RevenueScanResult {
  opportunities: Array<Omit<Opportunity, 'id'>>
  totalPotential: number
  scannedAt: string
}

const TYPE_SOURCE: Record<OpportunityType, string> = {
  'Missed Call': 'missed_call',
  'Old Estimate': 'old_estimate',
  'Declined Work': 'declined_work',
  'Inactive Customer': 'inactive_customer',
  'Maintenance Due': 'maintenance_due',
  'Unpaid Invoice': 'unpaid_invoice',
  'Unbilled Work': 'unbilled_work',
  'Stalled Lead': 'stalled_lead',
  'Expansion Opportunity': 'expansion',
  'Renewal Risk': 'renewal_risk',
  'Churn Risk': 'churn_risk',
  'Payment Failure': 'payment_failure',
  Other: 'other',
}

function estimateFromText(text: string, fallback: number): number {
  const match = text.replace(/,/g, '').match(/\$?(\d{2,7}(?:\.\d{1,2})?)/)
  const parsed = match ? Number(match[1]) : 0
  return parsed > 0 ? parsed : fallback
}

function orderTotal(order: AppData['salesOrders'][number]): number {
  return Math.max(0, (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0))
}

function opportunityForCustomer(c: AppData['customers'][number], type: OpportunityType, amount: number, reason: string, now: string): Omit<Opportunity, 'id'> {
  const priority = amount >= 1500 ? 'High' : amount >= 750 ? 'Medium' : 'Low'
  const actions: Record<OpportunityType, string> = {
    'Missed Call': 'Call customer back today',
    'Old Estimate': 'Revisit the estimate and make a follow-up offer',
    'Declined Work': 'Revisit the declined work and address the original objection',
    'Inactive Customer': 'Reach out with a reactivation offer',
    'Maintenance Due': 'Invite customer to schedule the recommended service',
    'Unpaid Invoice': 'Send the payment request and follow up on the outstanding balance',
    'Unbilled Work': 'Create or send the invoice before the revenue ages further',
    'Stalled Lead': 'Contact the lead and complete the next sales step',
    'Expansion Opportunity': 'Review recent buying behavior and offer the next relevant service',
    'Renewal Risk': 'Contact the customer before renewal and resolve the risk',
    'Churn Risk': 'Contact the customer and resolve the retention risk',
    'Payment Failure': 'Request an updated payment method and retry collection',
    Other: 'Review the revenue signal and take the next best action',
  }
  return {
    customerId: c.id,
    customerName: c.name,
    type,
    status: 'Potential',
    potentialValue: Math.round(amount),
    collectedAmount: 0,
    dateIdentified: now,
    nextAction: actions[type],
    notes: `${reason} · ${priority} priority · source=${TYPE_SOURCE[type]}`,
    source: TYPE_SOURCE[type],
    confidence: amount >= 1000 ? 0.9 : amount >= 500 ? 0.8 : 0.7,
  }
}

function opportunityForLead(lead: AppData['leads'][number], amount: number, reason: string, now: string): Omit<Opportunity, 'id'> {
  return {
    customerId: '',
    customerName: lead.name || lead.business || 'Unnamed lead',
    type: 'Stalled Lead',
    status: 'Potential',
    potentialValue: Math.round(amount),
    collectedAmount: 0,
    dateIdentified: now,
    nextAction: 'Contact the lead and complete the next sales step',
    notes: `${reason} · source=${TYPE_SOURCE['Stalled Lead']}`,
    source: TYPE_SOURCE['Stalled Lead'],
    confidence: 0.65,
  }
}

/**
 * Conservative deterministic revenue intelligence. Only creates an opportunity
 * when the connected data contains an explicit revenue signal; it never invents
 * invoices, renewals, churn, or payment failures that the source data cannot prove.
 */
export function scanRevenue(data: AppData, existing: Opportunity[] = data.opportunities): RevenueScanResult {
  const now = new Date()
  const nowIso = now.toISOString()
  const opportunities: Array<Omit<Opportunity, 'id'>> = []
  const activeOpen = (customerId: string, type: OpportunityType) => existing.some(o => o.customerId === customerId && o.type === type && o.status !== 'Collected') || opportunities.some(o => o.customerId === customerId && o.type === type)

  for (const customer of data.customers) {
    const notes = (customer.notes || []).join(' ')
    const lower = notes.toLowerCase()

    if (lower.includes('missed call') && !activeOpen(customer.id, 'Missed Call')) {
      opportunities.push(opportunityForCustomer(customer, 'Missed Call', Math.max(150, customer.lifetimeValue * 0.05), 'Missed call is explicitly recorded in customer notes', nowIso))
    }

    if (lower.includes('declined') && !activeOpen(customer.id, 'Declined Work')) {
      opportunities.push(opportunityForCustomer(customer, 'Declined Work', estimateFromText(notes, Math.max(400, customer.lifetimeValue * 0.15)), 'Customer notes explicitly record declined work', nowIso))
    } else if (lower.includes('estimate') && !activeOpen(customer.id, 'Old Estimate')) {
      opportunities.push(opportunityForCustomer(customer, 'Old Estimate', estimateFromText(notes, Math.max(400, customer.lifetimeValue * 0.15)), 'Customer notes contain an estimate signal', nowIso))
    }

    if (customer.status === 'Maintenance Due' && !activeOpen(customer.id, 'Maintenance Due')) {
      opportunities.push(opportunityForCustomer(customer, 'Maintenance Due', Math.max(350, customer.lifetimeValue * 0.12), 'Customer is explicitly marked Maintenance Due', nowIso))
    }

    if (customer.status === 'Inactive' && !activeOpen(customer.id, 'Inactive Customer')) {
      opportunities.push(opportunityForCustomer(customer, 'Inactive Customer', Math.max(250, customer.lifetimeValue * 0.12), 'Customer is explicitly inactive and has prior lifetime value', nowIso))
    }

    if (customer.status === 'Follow-Up Due' && !activeOpen(customer.id, 'Old Estimate') && !activeOpen(customer.id, 'Declined Work') && !activeOpen(customer.id, 'Missed Call')) {
      opportunities.push(opportunityForCustomer(customer, 'Old Estimate', Math.max(200, customer.lifetimeValue * 0.08), 'Customer is explicitly flagged for follow-up', nowIso))
    }
  }

  // Sales orders provide explicit billing/payment state, so these are high-confidence leaks.
  for (const order of data.salesOrders || []) {
    const amount = orderTotal(order)
    if (!amount || order.paymentStatus === 'Paid' || order.status === 'Cancelled') continue
    const customer = data.customers.find(c => c.id === order.customerId)
    if (!customer) continue
    const type: OpportunityType = order.status === 'Invoiced' ? 'Unpaid Invoice' : order.status === 'Fulfilled' ? 'Unbilled Work' : 'Other'
    if (type !== 'Other' && !activeOpen(customer.id, type)) {
      opportunities.push(opportunityForCustomer(customer, type, amount, `${order.number} is ${order.status} with payment status ${order.paymentStatus}`, nowIso))
    }
  }

  // Leads have no explicit status field yet, so only flag genuinely aging leads.
  for (const lead of data.leads || []) {
    const ageDays = (now.getTime() - new Date(lead.createdAt).getTime()) / 86400000
    const alreadyOpen = opportunities.some(o => o.type === 'Stalled Lead' && o.customerName === (lead.name || lead.business)) || existing.some(o => o.type === 'Stalled Lead' && o.customerName === (lead.name || lead.business) && o.status !== 'Collected')
    if (ageDays >= 2 && !alreadyOpen) {
      opportunities.push(opportunityForLead(lead, 750, `Lead has been open for ${Math.floor(ageDays)} days without a dedicated conversion status`, nowIso))
    }
  }

  opportunities.sort((a, b) => {
    const confidenceA = a.confidence ?? 0.5
    const confidenceB = b.confidence ?? 0.5
    return (b.potentialValue * confidenceB) - (a.potentialValue * confidenceA)
  })

  return { opportunities, totalPotential: opportunities.reduce((sum, o) => sum + o.potentialValue, 0), scannedAt: nowIso }
}
