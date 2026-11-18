import type {
  Appointment,
  Customer,
  DocumentRecord,
  FollowUp,
  JobMaterial,
  Opportunity,
  OpsJob,
  Task,
} from '../types/domain'
import { customerDisplayName, parseIsoMs } from './format'

const DAY_MS = 86_400_000

export const STALE_QUOTE_THRESHOLD_DAYS = 5
export const STALE_OPPORTUNITY_THRESHOLD_DAYS = 7

export type LeakCategory =
  | 'overdue_invoice'
  | 'unbilled_completed_job'
  | 'stale_quote'
  | 'stale_opportunity'
  | 'unclosed_past_appointment'

export type LeakSeverity = 'critical' | 'high' | 'medium'

export interface RevenueLeakItem {
  id: string
  category: LeakCategory
  severity: LeakSeverity
  sourceEntity: 'document' | 'ops_job' | 'opportunity' | 'appointment'
  sourceId: string
  customerId: string | null
  customerName: string
  opportunityId: string | null
  title: string
  evidence: string
  recommendedAction: string
  /**
   * Exact documented dollar amount tied to the underlying invoice, quote, job, or opportunity.
   * Unclosed appointments without an unbilled job report `0` rather than invented estimates.
   */
  amount: number
  ageDays: number
  hasOpenTask: boolean
}

export interface RevenueLeakScanSummary {
  scannedAt: string
  totalCount: number
  /**
   * Sum of documented, de-duplicated leak amounts (avoids double-counting a quote/invoice
   * and its parent opportunity when linked by `opportunity_id`). Zero fabricated multipliers.
   */
  documentedExposureTotal: number
  byCategory: Record<LeakCategory, { count: number; amount: number }>
  items: RevenueLeakItem[]
}

export interface RevenueLeakScanInput {
  customers?: Customer[]
  documents?: DocumentRecord[]
  opportunities?: Opportunity[]
  jobs?: OpsJob[]
  jobMaterials?: JobMaterial[]
  appointments?: Appointment[]
  followUps?: FollowUp[]
  tasks?: Task[]
  now?: Date | number
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * 100) / 100
}

export function calculateJobBillableTotal(job: OpsJob, materials: JobMaterial[]): number {
  const labor = Number.isFinite(job.labor_total) ? Math.max(0, job.labor_total) : 0
  const materialSum = materials
    .filter(m => m.job_id === job.id && m.state !== 'released')
    .reduce((sum, m) => {
      const qty = Number.isFinite(m.quantity) ? Math.max(0, m.quantity) : 0
      const unitPrice = Number.isFinite(m.unit_price) ? Math.max(0, m.unit_price) : 0
      return sum + qty * unitPrice
    }, 0)
  return roundMoney(labor + materialSum)
}

/**
 * Deterministic, evidence-backed revenue leak scanner.
 * Evaluates actual workspace records across invoices, quotes/estimates, opportunities,
 * completed unbilled `ops_jobs`, and past unclosed `appointments` with zero speculative math.
 */
export function scanRevenueLeaks(input: RevenueLeakScanInput): RevenueLeakScanSummary {
  const nowMs =
    typeof input.now === 'number'
      ? input.now
      : input.now instanceof Date
        ? input.now.getTime()
        : Date.now()

  const customersById = new Map<string, Customer>()
  for (const c of input.customers ?? []) {
    customersById.set(c.id, c)
  }

  const materials = input.jobMaterials ?? []
  const jobsById = new Map<string, OpsJob>()
  for (const job of input.jobs ?? []) {
    jobsById.set(job.id, job)
  }

  const openTasks = (input.tasks ?? []).filter(
    t => t.status === 'open' || t.status === 'in_progress',
  )
  const openTaskOpportunityIds = new Set<string>()
  const openTaskTitlesLower = new Set<string>()
  for (const t of openTasks) {
    if (t.opportunity_id) openTaskOpportunityIds.add(t.opportunity_id)
    if (t.title) openTaskTitlesLower.add(t.title.trim().toLowerCase())
  }

  // Track opportunities and customers that already have an upcoming or active pending follow-up
  const upcomingFollowUpOpportunityIds = new Set<string>()
  const upcomingFollowUpCustomerIds = new Set<string>()
  for (const f of input.followUps ?? []) {
    if (f.status !== 'pending' && f.status !== 'scheduled' && f.status !== 'open') {
      continue
    }
    const schedMs = parseIsoMs(f.scheduled_at)
    // Treat unscheduled pending follow-ups or scheduled within the future / last 24h as active coverage
    if (schedMs === null || schedMs >= nowMs - DAY_MS) {
      if (f.opportunity_id) upcomingFollowUpOpportunityIds.add(f.opportunity_id)
      if (f.customer_id) upcomingFollowUpCustomerIds.add(f.customer_id)
    }
  }

  const resolveCustomerLabel = (customerId: string | null | undefined): string => {
    if (!customerId) return 'Unassigned Customer'
    const customer = customersById.get(customerId)
    return customer ? customerDisplayName(customer) : 'Customer'
  }

  const hasMatchingOpenTask = (opportunityId: string | null | undefined, token: string): boolean => {
    if (opportunityId && openTaskOpportunityIds.has(opportunityId)) return true
    const needle = token.trim().toLowerCase()
    if (!needle) return false
    for (const title of openTaskTitlesLower) {
      if (title.includes(needle)) return true
    }
    return false
  }

  const items: RevenueLeakItem[] = []
  const coveredOpportunityIds = new Set<string>()

  // 1. Overdue unpaid invoices
  for (const doc of input.documents ?? []) {
    if (doc.document_type !== 'invoice') continue
    if (doc.status !== 'sent' && doc.status !== 'overdue') continue
    const amount = roundMoney(Number(doc.total ?? 0))
    if (amount <= 0) continue

    const dueMs = parseIsoMs(doc.due_at)
    const isMarkedOverdue = doc.status === 'overdue'
    if (!isMarkedOverdue && (dueMs === null || dueMs >= nowMs)) {
      continue
    }

    const ageDays =
      dueMs !== null && nowMs > dueMs
        ? Math.max(1, Math.floor((nowMs - dueMs) / DAY_MS))
        : Math.max(1, Math.floor((nowMs - (parseIsoMs(doc.created_at) ?? nowMs)) / DAY_MS))

    const docLabel = doc.document_number || `INV-${doc.id.slice(0, 6).toUpperCase()}`
    if (doc.opportunity_id) {
      coveredOpportunityIds.add(doc.opportunity_id)
    }

    items.push({
      id: `leak:overdue_invoice:${doc.id}`,
      category: 'overdue_invoice',
      severity: ageDays > 30 || amount >= 2500 ? 'critical' : 'high',
      sourceEntity: 'document',
      sourceId: doc.id,
      customerId: doc.customer_id,
      customerName: resolveCustomerLabel(doc.customer_id),
      opportunityId: doc.opportunity_id ?? null,
      title: `Overdue invoice ${docLabel}`,
      evidence: `Invoice ${docLabel} (${doc.status}) is ${ageDays}d past due with unpaid balance.`,
      recommendedAction: 'Verify customer channel consent and queue a payment reminder draft or log payment.',
      amount,
      ageDays,
      hasOpenTask: hasMatchingOpenTask(doc.opportunity_id, docLabel),
    })
  }

  // 2. Completed ops_jobs without an issued invoice (`status === 'completed' && !invoice_id`)
  for (const job of input.jobs ?? []) {
    if (job.status !== 'completed' || job.invoice_id) continue
    const amount = calculateJobBillableTotal(job, materials)
    const completedMs = parseIsoMs(job.completed_at) ?? parseIsoMs(job.updated_at) ?? parseIsoMs(job.created_at) ?? nowMs
    const ageDays = Math.max(0, Math.floor((nowMs - completedMs) / DAY_MS))

    items.push({
      id: `leak:unbilled_completed_job:${job.id}`,
      category: 'unbilled_completed_job',
      severity: amount >= 1000 || ageDays >= 3 ? 'critical' : 'high',
      sourceEntity: 'ops_job',
      sourceId: job.id,
      customerId: job.customer_id,
      customerName: resolveCustomerLabel(job.customer_id),
      opportunityId: null,
      title: `Completed job unbilled: ${job.title}`,
      evidence:
        amount > 0
          ? `Job "${job.title}" was marked completed ${ageDays}d ago with no linked invoice.`
          : `Job "${job.title}" was marked completed ${ageDays}d ago with $0 labor/materials and no invoice.`,
      recommendedAction: 'Verify labor and consumed materials on the job and generate the customer invoice.',
      amount,
      ageDays,
      hasOpenTask: hasMatchingOpenTask(null, job.title),
    })
  }

  // 3. Stale sent quotes / estimates (>= 5 days old without active pending follow-up)
  for (const doc of input.documents ?? []) {
    if (doc.document_type !== 'quote' && doc.document_type !== 'estimate') continue
    if (doc.status !== 'sent') continue
    const amount = roundMoney(Number(doc.total ?? 0))
    if (amount <= 0) continue

    const createdMs = parseIsoMs(doc.created_at)
    if (createdMs === null) continue
    const ageDays = Math.floor((nowMs - createdMs) / DAY_MS)
    if (ageDays < STALE_QUOTE_THRESHOLD_DAYS) continue

    if (
      (doc.opportunity_id && upcomingFollowUpOpportunityIds.has(doc.opportunity_id)) ||
      (!doc.opportunity_id && doc.customer_id && upcomingFollowUpCustomerIds.has(doc.customer_id))
    ) {
      continue
    }

    const docLabel = doc.document_number || `QTE-${doc.id.slice(0, 6).toUpperCase()}`
    if (doc.opportunity_id) {
      coveredOpportunityIds.add(doc.opportunity_id)
    }

    items.push({
      id: `leak:stale_quote:${doc.id}`,
      category: 'stale_quote',
      severity: ageDays >= 14 || amount >= 3000 ? 'high' : 'medium',
      sourceEntity: 'document',
      sourceId: doc.id,
      customerId: doc.customer_id,
      customerName: resolveCustomerLabel(doc.customer_id),
      opportunityId: doc.opportunity_id ?? null,
      title: `Unapproved quote ${docLabel}`,
      evidence: `Quote ${docLabel} was sent ${ageDays}d ago with no approval or scheduled follow-up.`,
      recommendedAction: 'Review quote scope with customer and record approval evidence or revise estimate.',
      amount,
      ageDays,
      hasOpenTask: hasMatchingOpenTask(doc.opportunity_id, docLabel),
    })
  }

  // 4. Stale open opportunities (>= 7 days old without upcoming follow-up and not already covered by quote/invoice)
  for (const opp of input.opportunities ?? []) {
    if (
      opp.status === 'completed' ||
      opp.status === 'recovered' ||
      opp.status === 'dismissed'
    ) {
      continue
    }
    if (coveredOpportunityIds.has(opp.id)) {
      continue
    }
    if (upcomingFollowUpOpportunityIds.has(opp.id)) {
      continue
    }

    const amount = roundMoney(Number(opp.amount ?? 0))
    if (amount <= 0) continue

    const refMs = parseIsoMs(opp.updated_at) ?? parseIsoMs(opp.created_at)
    if (refMs === null) continue
    const ageDays = Math.floor((nowMs - refMs) / DAY_MS)
    if (ageDays < STALE_OPPORTUNITY_THRESHOLD_DAYS) continue

    const customerName = opp.customers
      ? customerDisplayName(opp.customers)
      : resolveCustomerLabel(opp.customer_id)

    items.push({
      id: `leak:stale_opportunity:${opp.id}`,
      category: 'stale_opportunity',
      severity: ageDays >= 14 || amount >= 2500 ? 'high' : 'medium',
      sourceEntity: 'opportunity',
      sourceId: opp.id,
      customerId: opp.customer_id,
      customerName,
      opportunityId: opp.id,
      title: `Stalled opportunity: ${opp.title}`,
      evidence: `Opportunity "${opp.title}" (${opp.status}) has had no scheduled follow-up for ${ageDays}d.`,
      recommendedAction: 'Schedule next customer touchpoint or prepare a consent-verified follow-up draft.',
      amount,
      ageDays,
      hasOpenTask: hasMatchingOpenTask(opp.id, opp.title),
    })
  }

  // 5. Past unclosed appointments (`starts_at` / `ends_at` in the past while still `status === 'scheduled'`)
  for (const appt of input.appointments ?? []) {
    if (appt.status !== 'scheduled') continue
    const endOrStartMs = parseIsoMs(appt.ends_at) ?? parseIsoMs(appt.starts_at)
    if (endOrStartMs === null || endOrStartMs >= nowMs) continue

    const ageDays = Math.max(0, Math.floor((nowMs - endOrStartMs) / DAY_MS))
    const linkedJob = appt.ops_job_id ? jobsById.get(appt.ops_job_id) : undefined
    // Avoid duplicating exposure if the linked job is already counted in `unbilled_completed_job`,
    // and never invent dollar amounts when no job estimate exists.
    const linkedAmount =
      linkedJob && linkedJob.status !== 'completed' && !linkedJob.invoice_id
        ? calculateJobBillableTotal(linkedJob, materials)
        : 0

    items.push({
      id: `leak:unclosed_past_appointment:${appt.id}`,
      category: 'unclosed_past_appointment',
      severity: linkedAmount >= 1000 || ageDays >= 3 ? 'high' : 'medium',
      sourceEntity: 'appointment',
      sourceId: appt.id,
      customerId: appt.customer_id,
      customerName: resolveCustomerLabel(appt.customer_id),
      opportunityId: null,
      title: `Unclosed past booking: ${appt.title}`,
      evidence: `Scheduled appointment "${appt.title}" passed ${ageDays === 0 ? 'earlier today' : `${ageDays}d ago`} without completion or reschedule.`,
      recommendedAction: 'Confirm technician outcome: mark completed, reschedule dispatch window, or log no-show.',
      amount: linkedAmount,
      ageDays,
      hasOpenTask: hasMatchingOpenTask(null, appt.title),
    })
  }

  const severityRank: Record<LeakSeverity, number> = {
    critical: 3,
    high: 2,
    medium: 1,
  }

  items.sort((a, b) => {
    if (a.hasOpenTask !== b.hasOpenTask) return a.hasOpenTask ? 1 : -1
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity]
    }
    if (b.amount !== a.amount) return b.amount - a.amount
    return b.ageDays - a.ageDays
  })

  const byCategory: Record<LeakCategory, { count: number; amount: number }> = {
    overdue_invoice: { count: 0, amount: 0 },
    unbilled_completed_job: { count: 0, amount: 0 },
    stale_quote: { count: 0, amount: 0 },
    stale_opportunity: { count: 0, amount: 0 },
    unclosed_past_appointment: { count: 0, amount: 0 },
  }

  let documentedExposureTotal = 0
  for (const item of items) {
    byCategory[item.category].count += 1
    byCategory[item.category].amount = roundMoney(byCategory[item.category].amount + item.amount)
    documentedExposureTotal = roundMoney(documentedExposureTotal + item.amount)
  }

  return {
    scannedAt: new Date(nowMs).toISOString(),
    totalCount: items.length,
    documentedExposureTotal,
    byCategory,
    items,
  }
}
