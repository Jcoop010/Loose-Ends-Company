import React, { useEffect, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Link2,
  RefreshCw,
  Settings,
  XCircle,
} from 'lucide-react'
import { syncQuickBooks } from '../../../lib/edgeFunctions'
import { formatDateTime } from '../../../lib/format'
import {
  probeWorkspaceTableHealth,
  updateWorkspaceName,
  upsertWorkspaceSettings,
  type WorkspaceHealthSnapshot,
} from '../../../lib/queries'
import type { Workspace, WorkspaceSettings } from '../../../types/domain'
import { Badge, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
]

export interface WorkspaceSetupHealthProps {
  workspace: Workspace
  settings: WorkspaceSettings | null
  isAdminOrOwner: boolean
  onContextUpdated: () => Promise<void> | void
}

export function WorkspaceSetupHealth({
  workspace,
  settings,
  isAdminOrOwner,
  onContextUpdated,
}: WorkspaceSetupHealthProps): React.ReactElement {
  const toast = useToast()

  const [wsName, setWsName] = useState(workspace.name)
  const [businessType, setBusinessType] = useState(
    settings?.business_type ?? 'HVAC & Mechanical',
  )
  const [timezone, setTimezone] = useState(settings?.timezone ?? 'America/New_York')
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    settings?.onboarding_completed ?? true,
  )
  const [savingSettings, setSavingSettings] = useState(false)

  const [health, setHealth] = useState<WorkspaceHealthSnapshot | null>(null)
  const [probing, setProbing] = useState(true)
  const [syncingQb, setSyncingQb] = useState(false)

  useEffect(() => {
    setWsName(workspace.name)
  }, [workspace.name])

  useEffect(() => {
    if (!settings) return
    setBusinessType(settings.business_type)
    setTimezone(settings.timezone)
    setOnboardingCompleted(settings.onboarding_completed)
  }, [settings])

  const runHealthProbe = async () => {
    setProbing(true)
    try {
      const snap = await probeWorkspaceTableHealth(workspace.id)
      setHealth(snap)
    } catch (err) {
      toast.error(
        'Health probe error',
        err instanceof Error ? err.message : 'Unable to probe schema health.',
      )
    } finally {
      setProbing(false)
    }
  }

  useEffect(() => {
    let active = true
    setProbing(true)
    void probeWorkspaceTableHealth(workspace.id)
      .then(snap => {
        if (active) setHealth(snap)
      })
      .finally(() => {
        if (active) setProbing(false)
      })
    return () => {
      active = false
    }
  }, [workspace.id])

  const handleSaveWorkspaceSetup = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isAdminOrOwner) return
    setSavingSettings(true)
    try {
      if (wsName.trim() && wsName.trim() !== workspace.name) {
        await updateWorkspaceName({
          workspaceId: workspace.id,
          name: wsName.trim(),
        })
      }
      await upsertWorkspaceSettings({
        workspaceId: workspace.id,
        businessType,
        timezone,
        onboardingCompleted,
      })
      toast.success('Workspace setup saved', `${wsName.trim()} (${timezone})`)
      await onContextUpdated()
    } catch (err) {
      toast.error('Setup update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleSyncQuickBooks = async () => {
    if (!isAdminOrOwner || syncingQb) return
    setSyncingQb(true)
    try {
      const res = await syncQuickBooks(workspace.id)
      toast.success(
        'QuickBooks sync completed',
        typeof res.message === 'string'
          ? res.message
          : 'Synced latest customer & invoice records.',
      )
      await runHealthProbe()
    } catch (err) {
      toast.error(
        'QuickBooks sync unavailable',
        err instanceof Error
          ? err.message
          : 'Connect QuickBooks credentials in your workspace environment first.',
      )
    } finally {
      setSyncingQb(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Workspace Settings & QuickBooks Integration */}
      <div className="space-y-6 lg:col-span-5">
        <form onSubmit={handleSaveWorkspaceSetup} className="exec-surface p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-slate-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">Workspace Identity & Settings</h2>
          </div>

          <div>
            <label htmlFor="setup-ws-name" className="exec-label">
              Workspace Name
            </label>
            <input
              id="setup-ws-name"
              type="text"
              required
              disabled={!isAdminOrOwner || savingSettings}
              value={wsName}
              onChange={e => setWsName(e.target.value)}
              className="exec-input"
            />
          </div>

          <div>
            <label htmlFor="setup-biz-type" className="exec-label">
              Business Type
            </label>
            <input
              id="setup-biz-type"
              type="text"
              required
              disabled={!isAdminOrOwner || savingSettings}
              value={businessType}
              onChange={e => setBusinessType(e.target.value)}
              className="exec-input"
            />
          </div>

          <div>
            <label htmlFor="setup-tz" className="exec-label">
              Default Reporting Timezone
            </label>
            <select
              id="setup-tz"
              disabled={!isAdminOrOwner || savingSettings}
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="exec-input"
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2.5 text-xs sm:text-sm font-medium text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              disabled={!isAdminOrOwner || savingSettings}
              checked={onboardingCompleted}
              onChange={e => setOnboardingCompleted(e.target.checked)}
              className="h-4 w-4 accent-[#ea580c]"
            />
            Workspace onboarding checklist complete
          </label>

          {isAdminOrOwner ? (
            <button
              type="submit"
              disabled={savingSettings}
              className="exec-btn-primary w-full touch-target"
            >
              {savingSettings ? 'Saving Settings…' : 'Save Workspace Settings'}
            </button>
          ) : (
            <Badge tone="neutral">Owner/Admin Required to Edit</Badge>
          )}
        </form>

        {/* QuickBooks Integration Card */}
        <section aria-label="QuickBooks integration" className="exec-surface p-5 sm:p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-900">QuickBooks Online Sync</h3>
            </div>
            <Badge
              tone={
                (health?.quickbooksConnections.count ?? 0) > 0 ? 'emerald' : 'neutral'
              }
            >
              {(health?.quickbooksConnections.count ?? 0) > 0
                ? `${health?.quickbooksConnections.count} Connected`
                : 'Not Connected'}
            </Badge>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Reconciles customers and open receivables via the <code>quickbooks-sync</code> Edge
            Function when an active QuickBooks OAuth connection is registered for this workspace.
          </p>

          {isAdminOrOwner ? (
            <button
              type="button"
              disabled={syncingQb}
              onClick={() => void handleSyncQuickBooks()}
              className="exec-btn-secondary w-full touch-target !text-xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncingQb ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {syncingQb ? 'Syncing QuickBooks…' : 'Run QuickBooks Sync'}
            </button>
          ) : null}
        </section>
      </div>

      {/* Right: Live Schema & Operational Health Probes */}
      <section
        aria-label="Live workspace table health diagnostics"
        className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Workspace Ledger Health Diagnostics
              </h2>
              <p className="text-xs text-slate-600">
                Head-count RLS probes across core CRM, document, workflow, and audit tables.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={probing}
            onClick={() => void runHealthProbe()}
            className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Re-run Probes
          </button>
        </div>

        {probing && !health ? (
          <div className="space-y-2.5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : health ? (
          <>
            <div className="grid grid-cols-3 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="block text-slate-500">Enabled Workflows</span>
                <strong className="text-base text-slate-900">
                  {health.enabledWorkflows.count}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="block text-slate-500">Pending Approvals</span>
                <strong className="text-base text-amber-800">
                  {health.pendingWorkflowApprovals.count}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="block text-slate-500">Failed Runs</span>
                <strong className="text-base text-rose-700">
                  {health.failedWorkflowRuns.count}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
              {Object.entries(health.tables).map(([tableName, probe]) => (
                <div
                  key={tableName}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {probe.ok ? (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                    )}
                    <span className="truncate font-mono font-semibold text-slate-800">
                      {tableName}
                    </span>
                  </div>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {probe.ok ? `${probe.count.toLocaleString()} rows` : 'Unavailable'}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-slate-400 tabular-nums">
              Last checked {formatDateTime(health.checkedAt, timezone)}
            </p>
          </>
        ) : null}
      </section>
    </div>
  )
}
