import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  ClipboardCheck,
  RefreshCw,
  Repeat,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import { fetchOpsTeamStatus } from '../../../lib/opsCommand'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import { useWorkspaceRealtime } from '../../../lib/realtime'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import type {
  Appointment,
  Customer,
  InventoryItem,
  JobMaterial,
  OpsAvailability,
  OpsJob,
  OpsJobAttachment,
  OpsServicePlan,
  OpsTeamMemberStatus,
  Task,
} from '../../../types/domain'
import { MetricCardSkeleton } from '../../../components/ui/MetricCard'
import { DispatchCalendar } from './DispatchCalendar'
import { JobMarginTrackerPanel } from './JobMarginTrackerPanel'
import { JobsPipelinePanel } from './JobsPipelinePanel'
import { ServicePlansPanel } from './ServicePlansPanel'
import { TasksQueuePanel } from './TasksQueuePanel'
import { TeamAvailabilityPanel } from './TeamAvailabilityPanel'

type DispatchTab = 'jobs' | 'margins' | 'calendar' | 'tasks' | 'plans' | 'team'

function parseDispatchTab(raw: string | null): DispatchTab {
  if (
    raw === 'margins' ||
    raw === 'calendar' ||
    raw === 'tasks' ||
    raw === 'plans' ||
    raw === 'team'
  ) {
    return raw
  }
  return 'jobs'
}

interface DispatchWorkspaceData {
  jobs: OpsJob[]
  jobMaterials: JobMaterial[]
  attachments: OpsJobAttachment[]
  appointments: Appointment[]
  tasks: Task[]
  servicePlans: OpsServicePlan[]
  availability: OpsAvailability[]
  teamMembers: OpsTeamMemberStatus[]
  inventoryItems: InventoryItem[]
  customers: Customer[]
}

export function DispatchJobsPage(): React.ReactElement {
  const { workspace, settings, activeEntityId } = useSession()
  const { getParam, setParams } = useAppRouter()

  const activeTab = parseDispatchTab(getParam('tab'))

  const [data, setData] = useState<DispatchWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preselectedScheduleJobId, setPreselectedScheduleJobId] = useState<string | null>(null)

  const reqSeqRef = useRef(0)
  const workspaceId = workspace?.id ?? null

  const loadDispatchWorkspace = useCallback(
    async (isBackground = false) => {
      if (!workspaceId) return
      const seq = ++reqSeqRef.current
      const shouldAbort = () => reqSeqRef.current !== seq

      if (isBackground) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const [
          jobs,
          jobMaterials,
          attachments,
          appointments,
          tasks,
          servicePlans,
          availability,
          teamMembers,
          inventoryItems,
          customers,
        ] = await Promise.all([
          fetchAllWorkspaceRows<OpsJob>({ table: 'ops_jobs', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<JobMaterial>({
            table: 'job_materials',
            workspaceId,
            orderBy: 'job_id',
            shouldAbort,
          }),
          fetchAllWorkspaceRows<OpsJobAttachment>({
            table: 'ops_job_attachments',
            workspaceId,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<Appointment>({
            table: 'appointments',
            workspaceId,
            orderBy: 'starts_at',
            ascending: true,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<Task>({ table: 'tasks', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<OpsServicePlan>({
            table: 'ops_service_plans',
            workspaceId,
            orderBy: 'next_due',
            ascending: true,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<OpsAvailability>({
            table: 'ops_availability',
            workspaceId,
            orderBy: 'starts_at',
            ascending: true,
            shouldAbort,
          }),
          fetchOpsTeamStatus(workspaceId),
          fetchAllWorkspaceRows<InventoryItem>({
            table: 'inventory_items',
            workspaceId,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<Customer>({ table: 'customers', workspaceId, shouldAbort }),
        ])

        if (shouldAbort()) return
        if (
          !jobs ||
          !jobMaterials ||
          !attachments ||
          !appointments ||
          !tasks ||
          !servicePlans ||
          !availability ||
          !inventoryItems ||
          !customers
        ) {
          return
        }

        setData({
          jobs,
          jobMaterials,
          attachments,
          appointments,
          tasks,
          servicePlans,
          availability,
          teamMembers,
          inventoryItems,
          customers,
        })
      } catch (err) {
        if (shouldAbort()) return
        setError(
          err instanceof Error ? err.message : 'Unable to load Dispatch & Jobs workspace.',
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
    void loadDispatchWorkspace(false)
    return () => {
      reqSeqRef.current += 1
    }
  }, [loadDispatchWorkspace])

  useWorkspaceRealtime(workspaceId, () => {
    void loadDispatchWorkspace(true)
  })

  const customersById = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const c of data?.customers ?? []) {
      map.set(c.id, c)
    }
    return map
  }, [data?.customers])

  const switchTab = (next: DispatchTab) => {
    setParams({ tab: next === 'jobs' ? null : next })
  }

  if (!workspaceId) {
    return <div />
  }

  const tabs: Array<{
    id: DispatchTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'jobs', label: 'Work Pipeline', icon: Wrench },
    { id: 'margins', label: 'Job Margins', icon: TrendingUp },
    { id: 'calendar', label: 'Dispatch Calendar', icon: CalendarClock },
    { id: 'tasks', label: 'Tasks', icon: ClipboardCheck },
    { id: 'plans', label: 'Recurring Plans', icon: Repeat },
    { id: 'team', label: 'Team & Shifts', icon: Users },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Dispatch and Jobs views"
          className="flex flex-wrap items-center gap-1.5"
        >
          {tabs.map(tab => {
            const Icon = tab.icon
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => switchTab(tab.id)}
                className={`touch-target inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                  selected
                    ? 'bg-[#c2410c] text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadDispatchWorkspace(true)}
          className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target self-start sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-900"
        >
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : data ? (
        <>
          {activeTab === 'jobs' ? (
            <JobsPipelinePanel
              workspaceId={workspaceId}
              jobs={data.jobs}
              jobMaterials={data.jobMaterials}
              attachments={data.attachments}
              inventoryItems={data.inventoryItems}
              customers={data.customers}
              customersById={customersById}
              teamMembers={data.teamMembers}
              onOpenScheduleForJob={jobId => {
                setPreselectedScheduleJobId(jobId)
                setParams({ tab: 'calendar' })
              }}
              onJobsChanged={() => loadDispatchWorkspace(true)}
            />
          ) : null}

          {activeTab === 'margins' ? (
            <JobMarginTrackerPanel
              workspaceId={workspaceId}
              activeEntityId={activeEntityId}
            />
          ) : null}

          {activeTab === 'calendar' ? (
            <DispatchCalendar
              workspaceId={workspaceId}
              appointments={data.appointments}
              jobs={data.jobs}
              customersById={customersById}
              teamMembers={data.teamMembers}
              preselectedJobId={preselectedScheduleJobId}
              onClearPreselectedJob={() => setPreselectedScheduleJobId(null)}
              timezone={settings?.timezone}
              onCalendarChanged={() => loadDispatchWorkspace(true)}
            />
          ) : null}

          {activeTab === 'tasks' ? (
            <TasksQueuePanel
              workspaceId={workspaceId}
              tasks={data.tasks}
              customers={data.customers}
              customersById={customersById}
              onTasksChanged={() => loadDispatchWorkspace(true)}
            />
          ) : null}

          {activeTab === 'plans' ? (
            <ServicePlansPanel
              workspaceId={workspaceId}
              plans={data.servicePlans}
              customers={data.customers}
              customersById={customersById}
              teamMembers={data.teamMembers}
              timezone={settings?.timezone}
              onPlansChanged={() => loadDispatchWorkspace(true)}
            />
          ) : null}

          {activeTab === 'team' ? (
            <TeamAvailabilityPanel
              workspaceId={workspaceId}
              teamMembers={data.teamMembers}
              availabilityBlocks={data.availability}
              timezone={settings?.timezone}
              onTeamChanged={() => loadDispatchWorkspace(true)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
