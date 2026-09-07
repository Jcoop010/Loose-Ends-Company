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
  Other: 'other',
}

function estimateFromText(text: string, fallback: number): number {
  const match = text.replace(/,/g, '').match(/\$?(\d{2,6}(?:\.\d{1,2})?)/)
  const parsed = match ? Number(match[1]) : 0
  return parsed > 0 ? parsed : fallback
}

function opportunityForCustomer(c: AppData['customers'][number], type: OpportunityType, amount: number, reason: string, now: string): Omit<Opportunity, 'id'> {
  const priority = amount >= 1500 ? 'High' : amount >= 750 ? 'Medium' : 'Low'
  return {
    customerId: c.id,
    customerName: c.name,
    type,
    status: 'Potential',
    potentialValue: Math.round(amount),
    collectedAmount: 0,
    dateIdentified: now,
    nextAction: type === 'Missed Call' ? 'Call customer back today' : type === 'Old Estimate' || type === 'Declined Work' ? 'Revisit the estimate and make a follow-up offer' : type === 'Maintenance Due' ? 'Invite customer to schedule the recommended service' : 'Reach out with a reactivation offer',
    notes: `${reason} · ${priority} priority · source=${TYPE_SOURCE[type]}`,
  }
}

/**
 * Deterministic first-pass revenue intelligence. It turns existing CRM signals
 * into ranked, actionable opportunities without requiring an AI API key.
 */
export function scanRevenue(data: AppData, existing: Opportunity[] = data.opportunities): RevenueScanResult {
  const now = new Date().toISOString()
  const opportunities: Array<Omit<Opportunity, 'id'>> = []

  for (const customer of data.customers) {
    const notes = (customer.notes || []).join(' ')
    const lower = notes.toLowerCase()
    const activeOpen = (type: OpportunityType) => existing.some(o => o.customerId === customer.id && o.type === type && o.status !== 'Collected') || opportunities.some(o => o.customerId === customer.id && o.type === type)

    if (lower.includes('missed call') && !activeOpen('Missed Call')) {
      opportunities.push(opportunityForCustomer(customer, 'Missed Call', Math.max(150, customer.lifetimeValue * 0.05), 'Missed call is explicitly recorded in customer notes', now))
    }

    if ((lower.includes('declined') || lower.includes('estimate')) && !activeOpen(lower.includes('declined') ? 'Declined Work' : 'Old Estimate')) {
      const type: OpportunityType = lower.includes('declined') ? 'Declined Work' : 'Old Estimate'
      const fallback = Math.max(400, customer.lifetimeValue * 0.15)
      opportunities.push(opportunityForCustomer(customer, type, estimateFromText(notes, fallback), 'Customer notes contain an estimate or declined-work signal', now))
    }

    if (customer.status === 'Maintenance Due' && !activeOpen('Maintenance Due')) {
      const amount = Math.max(350, customer.lifetimeValue * 0.12)
      opportunities.push(opportunityForCustomer(customer, 'Maintenance Due', amount, 'Customer is marked Maintenance Due', now))
    }

    if (customer.status === 'Inactive' && !activeOpen('Inactive Customer')) {
      const amount = Math.max(250, customer.lifetimeValue * 0.12)
      opportunities.push(opportunityForCustomer(customer, 'Inactive Customer', amount, 'Customer is inactive and has a prior service relationship', now))
    }

    if (customer.status === 'Follow-Up Due' && !activeOpen('Old Estimate') && !activeOpen('Declined Work') && !activeOpen('Missed Call')) {
      const amount = Math.max(200, customer.lifetimeValue * 0.08)
      opportunities.push(opportunityForCustomer(customer, 'Old Estimate', amount, 'Customer is flagged for follow-up and has recoverable relationship value', now))
    }
  }

  opportunities.sort((a, b) => b.potentialValue - a.potentialValue)
  return { opportunities, totalPotential: opportunities.reduce((sum, o) => sum + o.potentialValue, 0), scannedAt: now }
}
