import React, { useMemo, useState } from 'react'
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardPlus, Radar } from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  scanRevenueLeaks,
  type LeakCategory,
  type RevenueLeakItem,
} from '../../../lib/leakScanner'
import { createFollowUpTask } from '../../../lib/queries'
import { useAppRouter, type DashboardSection } from '../../../state/RouterContext'
import type {
  Appointment,
  Customer,
  DocumentRecord,
  FollowUp,
  JobMaterial,
  Opportunity,
  OpsJob,
  Task,
} from '../../../types/domain'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface LeakScannerPanelProps {
  workspaceId: string
  customers: Customer[]
  documents: DocumentRecord[]
  opportunities: Opportunity[]
  jobs: OpsJob[]
  jobMaterials: JobMaterial[]
  appointments: Appointment[]
  followUps: FollowUp[]
  tasks: Task[]
  onTaskCreated: (task: Task) => void
}

const CATEGORY_LABELS: Record<LeakCategory | 'all', string> = {
  all: 'All Signals',
  overdue_invoice: 'Overdue Invoices',
  unbilled_completed_job: 'Unbilled Jobs',
  stale_quote: 'Stale Quotes',
  stale_opportunity: 'Stalled Opps',
  unclosed_past_appointment: 'Past Bookings',
}

function targetSectionForLeak(category: LeakCategory): DashboardSection {
  if (category === 'unbilled_completed_job' || category === 'unclosed_past_appointment') {
    return 'dispatch'
  }
  return 'pipeline'
}

export function LeakScannerPanel({
  workspaceId,
  customers,
  documents,
  opportunities,
  jobs,
  jobMaterials,
  appointments,
  followUps,
  tasks,
  onTaskCreated,
}: LeakScannerPanelProps): React.ReactElement {
  const { navigateSection } = useAppRouter()
  const toast = useToast()
  const [activeFilter, setActiveFilter] = useState<LeakCategory | 'all'>('all')
  const [creatingLeakIds, setCreatingLeakIds] = useState<Record<string, boolean>>({})

  const scan = useMemo(
    () =>
      scanRevenueLeaks({
        customers,
        documents,
        opportunities,
        jobs,
        jobMaterials,
        appointments,
        followUps,
        tasks,
      }),
    [customers, documents, opportunities, jobs, jobMaterials, appointments, followUps, tasks],
  )

  const filteredItems = useMemo(
    () =>
      activeFilter === 'all'
        ? scan.items
        : scan.items.filter(item => item.category === activeFilter),
    [activeFilter, scan.items],
  )

  const handleCreateTask = async (item: RevenueLeakItem) => {
    if (creatingLeakIds[item.id]) return
    setCreatingLeakIds(prev => ({ ...prev, [item.id]: true }))

    try {
      const priority = item.severity === 'critical' ? 3 : 2
      const result = await createFollowUpTask({
        workspaceId,
        title: `Follow up: ${item.title}`,
        customerId: item.customerId,
        opportunityId: item.opportunityId,
        priority,
        dueInHours: 24,
      })

      onTaskCreated(result.task)
      if (result.duplicate) {
        toast.info('Task already open', `"${result.task.title}" is already queued.`)
      } else {
        toast.success('Follow-up task created', result.task.title)
      }
    } catch (err) {
      toast.error(
        'Could not create task',
        err instanceof Error ? err.message : 'Check workspace permissions and retry.',
      )
    } finally {
      setCreatingLeakIds(prev => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    }
  }

  return (
    <section
      aria-label="Evidence-based revenue and billing leak scanner"
      className="exec-surface p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">
              Deterministic Revenue & Billing Leak Scanner
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600 max-w-2xl">
            Evaluates live workspace invoices, completed unbilled work orders, unapproved quotes,
            stalled opportunities, and unclosed appointments—zero speculative math.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-right shrink-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-900">
            Documented Exposure
          </span>
          <span className="text-lg font-extrabold text-amber-950 tabular-nums">
            {formatCurrency(scan.documentedExposureTotal)}
          </span>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'overdue_invoice', 'unbilled_completed_job', 'stale_quote', 'stale_opportunity', 'unclosed_past_appointment'] as const).map(
          cat => {
            const count = cat === 'all' ? scan.totalCount : scan.byCategory[cat].count
            const selected = activeFilter === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveFilter(cat)}
                className={`touch-target rounded-full px-3 py-1.5 text-xs font-semibold transition tabular-nums ${
                  selected
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {CATEGORY_LABELS[cat]} ({count})
              </button>
            )
          },
        )}
      </div>

      {/* Leak Signal Rows */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          title="No actionable leaks in this filter"
          description="All matching invoices, quotes, completed jobs, and scheduled bookings are either settled or covered by an active follow-up."
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {filteredItems.map(item => {
            const busy = Boolean(creatingLeakIds[item.id])
            const destSection = targetSectionForLeak(item.category)
            return (
              <li
                key={item.id}
                className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        item.severity === 'critical'
                          ? 'rose'
                          : item.severity === 'high'
                            ? 'amber'
                            : 'neutral'
                      }
                    >
                      <AlertCircle className="h-3 w-3" aria-hidden="true" />
                      {CATEGORY_LABELS[item.category]}
                    </Badge>
                    <span className="text-sm font-bold text-slate-900">{item.title}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <strong className="text-slate-800">{item.customerName}</strong> —{' '}
                    {item.evidence}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Recommended: {item.recommendedAction}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="mr-1 text-sm font-extrabold text-slate-950 tabular-nums">
                    {item.amount > 0 ? formatCurrency(item.amount) : 'Outcome Needed'}
                  </span>

                  <button
                    type="button"
                    disabled={busy || item.hasOpenTask}
                    onClick={() => void handleCreateTask(item)}
                    className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                  >
                    <ClipboardPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.hasOpenTask
                      ? 'Task Open'
                      : busy
                        ? 'Queueing…'
                        : 'Create Follow-Up Task'}
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateSection(destSection)}
                    className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                  >
                    Open {destSection === 'dispatch' ? 'Dispatch' : 'Pipeline'}
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Documented exposure counts linked quote/invoice amounts once per opportunity and never
        transmits automated messages without explicit recorded customer consent and owner approval.
      </p>
    </section>
  )
}
