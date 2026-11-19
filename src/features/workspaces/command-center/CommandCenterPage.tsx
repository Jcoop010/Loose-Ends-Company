import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertOctagon,
  ArrowRight,
  Boxes,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  fetchOpsCoordinationSummary,
  fetchOpsInvoiceAging,
  fetchOpsSummary,
} from '../../../lib/opsCommand'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import { useWorkspaceRealtime } from '../../../lib/realtime'
import { useAppRouter, type DashboardSection } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import type {
  Appointment,
  Customer,
  DocumentRecord,
  FollowUp,
  JobMaterial,
  Opportunity,
  OpsCoordinationSummary,
  OpsExpense,
  OpsInvoiceAgingBucket,
  OpsJob,
  OpsSummary,
  Task,
} from '../../../types/domain'
import {
  Badge,
  MetricCard,
  MetricCardSkeleton,
} from '../../../components/ui/MetricCard'
import { FinanceAgingPanel } from './FinanceAgingPanel'
import { LeakScannerPanel } from './LeakScannerPanel'
import { VerifiedRevenueCard } from './VerifiedRevenueCard'

interface CommandCenterSnapshot {
  summary: OpsSummary
  coordination: OpsCoordinationSummary
  agingBuckets: OpsInvoiceAgingBucket[]
  customers: Customer[]
  documents: DocumentRecord[]
  opportunities: Opportunity[]
  jobs: OpsJob[]
  jobMaterials: JobMaterial[]
  appointments: Appointment[]
  followUps: FollowUp[]
  tasks: Task[]
  expenses: OpsExpense[]
}

export function CommandCenterPage(): React.ReactElement {
  const { workspace, settings } = useSession()
  const { navigateSection } = useAppRouter()

  const [snapshot, setSnapshot] = useState<CommandCenterSnapshot | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<number>(0)

  const reqSeqRef = useRef<number>(0)
  const workspaceId = workspace?.id ?? null

  const loadCommandCenter = useCallback(
    async (isBackgroundRefresh = false) => {
      if (!workspaceId) return
      const seq = ++reqSeqRef.current
      const shouldAbort = () => reqSeqRef.current !== seq

      if (isBackgroundRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const [
          summary,
          coordination,
          aging,
          customers,
          documents,
          opportunities,
          jobs,
          jobMaterials,
          appointments,
          followUps,
          tasks,
          expenses,
        ] = await Promise.all([
          fetchOpsSummary(workspaceId),
          fetchOpsCoordinationSummary(workspaceId),
          fetchOpsInvoiceAging(workspaceId),
          fetchAllWorkspaceRows<Customer>({ table: 'customers', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<DocumentRecord>({ table: 'documents', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<Opportunity>({ table: 'opportunities', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<OpsJob>({ table: 'ops_jobs', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<JobMaterial>({
            table: 'job_materials',
            workspaceId,
            orderBy: 'job_id',
            shouldAbort,
          }),
          fetchAllWorkspaceRows<Appointment>({
            table: 'appointments',
            workspaceId,
            orderBy: 'starts_at',
            shouldAbort,
          }),
          fetchAllWorkspaceRows<FollowUp>({ table: 'follow_ups', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<Task>({ table: 'tasks', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<OpsExpense>({ table: 'ops_expenses', workspaceId, shouldAbort }),
        ])

        if (shouldAbort()) return
        if (
          !customers ||
          !documents ||
          !opportunities ||
          !jobs ||
          !jobMaterials ||
          !appointments ||
          !followUps ||
          !tasks ||
          !expenses
        ) {
          return
        }

        setSnapshot({
          summary,
          coordination,
          agingBuckets: aging.buckets,
          customers,
          documents,
          opportunities,
          jobs,
          jobMaterials,
          appointments,
          followUps,
          tasks,
          expenses,
        })
        setRefreshToken(prev => prev + 1)
      } catch (err) {
        if (shouldAbort()) return
        setError(
          err instanceof Error ? err.message : 'Unable to load Command Center operational ledger.',
        )
      } finally {
        if (!shouldAbort()) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    void loadCommandCenter(false)
    return () => {
      reqSeqRef.current += 1
    }
  }, [loadCommandCenter])

  // Live 500ms-debounced Realtime invalidation on `opportunities` and `recovery_events`
  useWorkspaceRealtime(workspaceId, () => {
    void loadCommandCenter(true)
  })

  const customersById = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const c of snapshot?.customers ?? []) {
      map.set(c.id, c)
    }
    return map
  }, [snapshot?.customers])

  const nextBestActions = useMemo(() => {
    if (!snapshot) return []
    const items: Array<{
      id: string
      title: string
      detail: string
      section: DashboardSection
      cta: string
      tone: 'rose' | 'amber' | 'brand' | 'emerald'
    }> = []

    const { summary, coordination } = snapshot

    if (summary.failed_operations > 0 || coordination.events_failed > 0) {
      items.push({
        id: 'failed-ops',
        title: `${summary.failed_operations + coordination.events_failed} dead-letter queue operation(s)`,
        detail: 'Inspect failed automation or business coordination events and retry safely.',
        section: 'autopilot',
        cta: 'Open Autopilot Queue',
        tone: 'rose',
      })
    }

    if (summary.unpaid_invoices > 0) {
      items.push({
        id: 'unpaid-invoices',
        title: `${formatCurrency(summary.unpaid_invoices)} in unpaid customer invoices`,
        detail: 'Verify customer consent and queue an owner-approved reminder or record payment.',
        section: 'pipeline',
        cta: 'Review Pipeline & Quotes',
        tone: 'amber',
      })
    }

    if (summary.low_stock > 0 || summary.awaiting_approval > 0) {
      items.push({
        id: 'low-stock-pos',
        title: `${summary.low_stock} low-stock SKU(s) · ${summary.awaiting_approval} draft PO(s)`,
        detail: 'Approve restock purchase orders before upcoming technician dispatches.',
        section: 'inventory',
        cta: 'Open Inventory & POs',
        tone: 'amber',
      })
    }

    if (coordination.drafts_waiting > 0) {
      items.push({
        id: 'drafts-waiting',
        title: `${coordination.drafts_waiting} communication draft(s) awaiting review`,
        detail: 'Verify recorded channel opt-in and approve or reject queued customer drafts.',
        section: 'pipeline',
        cta: 'Review Drafts',
        tone: 'brand',
      })
    }

    if (summary.open_estimates > 0) {
      items.push({
        id: 'open-estimates',
        title: `${summary.open_estimates} open estimate(s) awaiting approval`,
        detail: 'Follow up on sent quotes and record approval evidence to convert into jobs.',
        section: 'pipeline',
        cta: 'Open Quotes',
        tone: 'brand',
      })
    }

    if (items.length === 0) {
      items.push({
        id: 'dispatch-board',
        title: `${summary.today_jobs} appointment(s) scheduled today`,
        detail: 'Review technician assignments, checklists, and recurring service plans.',
        section: 'dispatch',
        cta: 'Open Dispatch & Jobs',
        tone: 'emerald',
      })
    }

    return items.slice(0, 4)
  }, [snapshot])

  const handleTaskCreated = useCallback((task: Task) => {
    setSnapshot(prev => {
      if (!prev) return prev
      const exists = prev.tasks.some(t => t.id === task.id)
      return {
        ...prev,
        tasks: exists ? prev.tasks : [task, ...prev.tasks],
      }
    })
  }, [])

  if (!workspaceId) {
    return <div />
  }

  if (loading && !snapshot) {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <MetricCardSkeleton key={idx} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Executive Operational Ledger
          </p>
          <p className="text-xs sm:text-sm text-slate-600">
            Live workspace metrics across jobs, quotes, stock, receivables, and coordination queues.
          </p>
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadCommandCenter(true)}
          className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing Ledger…' : 'Refresh Ledger'}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-900 flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadCommandCenter(false)}
            className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
          >
            Retry
          </button>
        </div>
      ) : null}

      {snapshot ? (
        <>
          {/* 6 Executive KPI Cards (`ops_summary`) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label="Open Jobs"
              value={snapshot.summary.open_jobs}
              subtitle={`${snapshot.summary.urgent_tasks} overdue open task(s)`}
              icon={<Wrench className="h-4 w-4" />}
              accent="brand"
              onClick={() => navigateSection('dispatch')}
            />
            <MetricCard
              label="Open Estimates"
              value={snapshot.summary.open_estimates}
              subtitle={`${snapshot.coordination.drafts_waiting} draft(s) waiting`}
              icon={<FileSpreadsheet className="h-4 w-4" />}
              accent="slate"
              onClick={() => navigateSection('pipeline')}
            />
            <MetricCard
              label="Today's Jobs"
              value={snapshot.summary.today_jobs}
              subtitle={`${snapshot.coordination.recurring_services} recurring plan(s)`}
              icon={<CalendarClock className="h-4 w-4" />}
              accent="emerald"
              onClick={() => navigateSection('dispatch')}
            />
            <MetricCard
              label="Low-Stock SKUs"
              value={snapshot.summary.low_stock}
              subtitle={`Value ${formatCurrency(snapshot.summary.inventory_value)}`}
              icon={<Boxes className="h-4 w-4" />}
              accent={snapshot.summary.low_stock > 0 ? 'amber' : 'emerald'}
              onClick={() => navigateSection('inventory')}
            />
            <MetricCard
              label="Awaiting Approval"
              value={snapshot.summary.awaiting_approval}
              subtitle="Draft supplier POs"
              icon={<ClipboardList className="h-4 w-4" />}
              accent={snapshot.summary.awaiting_approval > 0 ? 'amber' : 'slate'}
              onClick={() => navigateSection('inventory')}
            />
            <MetricCard
              label="Failed Ops"
              value={snapshot.summary.failed_operations}
              subtitle={`${snapshot.coordination.events_pending} event(s) pending`}
              icon={
                snapshot.summary.failed_operations > 0 ? (
                  <AlertOctagon className="h-4 w-4 text-rose-600" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )
              }
              accent={snapshot.summary.failed_operations > 0 ? 'rose' : 'emerald'}
              onClick={() => navigateSection('autopilot')}
            />
          </div>

          {/* Prioritized Next Best Actions + Verified Revenue Separation */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section
              aria-label="Prioritized next best operational actions"
              className="exec-surface p-5 sm:p-6 lg:col-span-6 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Prioritized Next Actions</h2>
                  <p className="text-xs text-slate-600">
                    Direct operational handoffs derived from your live queue and ledger balances.
                  </p>
                </div>
                <Badge tone="neutral">{nextBestActions.length} active</Badge>
              </div>

              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {nextBestActions.map(action => (
                  <li
                    key={action.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone={action.tone}>{action.section}</Badge>
                        <span className="truncate text-sm font-bold text-slate-900">
                          {action.title}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{action.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateSection(action.section)}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs shrink-0 touch-target"
                    >
                      {action.cta}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <div className="lg:col-span-6">
              <VerifiedRevenueCard
                workspaceId={workspaceId}
                summary={snapshot.summary}
                customersById={customersById}
                timezone={settings?.timezone}
                refreshToken={refreshToken}
              />
            </div>
          </div>

          {/* Deterministic Leak Scanner */}
          <LeakScannerPanel
            workspaceId={workspaceId}
            customers={snapshot.customers}
            documents={snapshot.documents}
            opportunities={snapshot.opportunities}
            jobs={snapshot.jobs}
            jobMaterials={snapshot.jobMaterials}
            appointments={snapshot.appointments}
            followUps={snapshot.followUps}
            tasks={snapshot.tasks}
            onTaskCreated={handleTaskCreated}
          />

          {/* Invoice Aging + Vendor Bills & Expenses */}
          <FinanceAgingPanel
            workspaceId={workspaceId}
            agingBuckets={snapshot.agingBuckets}
            expenses={snapshot.expenses}
            timezone={settings?.timezone}
            onExpensesChanged={() => loadCommandCenter(true)}
          />
        </>
      ) : null}
    </div>
  )
}
