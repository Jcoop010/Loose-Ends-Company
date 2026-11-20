import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react'
import {
  AUTONOMY_ACTION_META,
  DEFAULT_AUTONOMY_CONFIG,
  formatCents,
  WORKSPACE_MODULE_META,
  type AgentActionLedgerEntry,
  type AutonomyActionKey,
  type AutonomyMode,
  type WorkspaceAutonomyConfig,
  type WorkspaceModuleKey,
} from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import { formatDateTime } from '../../../lib/format'
import { useSession } from '../../../state/SessionContext'
import { Badge, EmptyState, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const MODE_LABELS: ReadonlyArray<{ mode: AutonomyMode; label: string }> = [
  { mode: 'manual', label: 'Manual' },
  { mode: 'approve_1tap', label: '1-Tap Approve' },
  { mode: 'full_auto', label: 'Full Auto' },
]

export function AutonomyLedgerPage(): React.ReactElement {
  const { workspace, settings, refreshWorkspaceContext } = useSession()
  const toast = useToast()

  const workspaceId = workspace?.id ?? null
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [config, setConfig] = useState<WorkspaceAutonomyConfig>(DEFAULT_AUTONOMY_CONFIG)
  const [autoLimitDollars, setAutoLimitDollars] = useState('500')
  const [ledger, setLedger] = useState<AgentActionLedgerEntry[]>([])
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'executed' | 'pending_approval' | 'reversed'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const [cfg, entries] = await Promise.all([
        autonomousQueries.fetchWorkspaceAutonomySettings(workspaceId),
        autonomousQueries.fetchAgentActionLedger(workspaceId),
      ])
      setConfig(cfg)
      setAutoLimitDollars(String(Math.round(cfg.auto_limit_cents / 100)))
      setLedger(entries)
    } catch (err) {
      toast.error(
        'Could not load autonomy settings',
        err instanceof Error ? err.message : 'Retry.',
      )
    } finally {
      setLoading(false)
    }
  }, [workspaceId, toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const setRuleMode = (actionKey: AutonomyActionKey, mode: AutonomyMode) => {
    setConfig(prev => ({
      ...prev,
      autonomy_rules: {
        ...prev.autonomy_rules,
        [actionKey]: mode,
      },
    }))
  }

  const toggleModule = (key: WorkspaceModuleKey) => {
    setConfig(prev => ({
      ...prev,
      modules_enabled: {
        ...prev.modules_enabled,
        [key]: !prev.modules_enabled[key],
      },
    }))
  }

  const handleSaveConfig = async () => {
    if (!workspaceId || savingConfig) return
    const parsedDollars = Number(autoLimitDollars)
    const safeLimitCents =
      Number.isFinite(parsedDollars) && parsedDollars >= 0
        ? Math.round(parsedDollars * 100)
        : config.auto_limit_cents

    setSavingConfig(true)
    try {
      const saved = await autonomousQueries.saveWorkspaceAutonomySettings(workspaceId, {
        ...config,
        auto_limit_cents: safeLimitCents,
      })
      setConfig(saved)
      setAutoLimitDollars(String(Math.round(saved.auto_limit_cents / 100)))
      await refreshWorkspaceContext()
      toast.success(
        'Autonomy Dial & Modules saved',
        `Auto-execute threshold: ${formatCents(saved.auto_limit_cents)}. Navigation updated.`,
      )
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleApprovePending = async (entry: AgentActionLedgerEntry) => {
    if (!workspaceId || busyId) return
    setBusyId(entry.id)
    try {
      await autonomousQueries.approvePendingLedgerEntryInDb({
        workspaceId,
        entry,
        config,
      })
      toast.success('Agent action approved & executed', entry.summary)
      await loadData()
    } catch (err) {
      toast.error('Approval failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  const handleUndo = async (entry: AgentActionLedgerEntry) => {
    if (!workspaceId || busyId) return
    setBusyId(entry.id)
    try {
      await autonomousQueries.reverseLedgerEntryInDb({ workspaceId, entry })
      toast.success('Action reversed (1-Click Undo)', 'State restored and reversal logged.')
      await loadData()
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  if (!workspaceId) return <div />

  const visibleLedger =
    ledgerFilter === 'all' ? ledger : ledger.filter(entry => entry.status === ledgerFilter)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Agent Action Ledger &amp; Autonomy Dial</h2>
          <p className="text-xs text-slate-600">
            Configure Manual, 1-Tap Approve, or Full Auto thresholds, toggle workspace modules, and reverse any executed action in 1 click.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveConfig()}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {savingConfig ? 'Saving...' : 'Save Dial & Modules'}
          </button>
        </div>
      </div>

      {/* Top Row: Autonomy Dial + Module Toggles */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        <section className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-900">Autonomy Dial</h3>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="auto-limit-input" className="text-xs font-semibold text-slate-600">
                Full Auto Cap ($)
              </label>
              <input
                id="auto-limit-input"
                type="number"
                min="0"
                step="50"
                value={autoLimitDollars}
                onChange={e => setAutoLimitDollars(e.target.value)}
                className="exec-input w-28 !py-1.5 text-xs tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-3">
            {AUTONOMY_ACTION_META.map(meta => {
              const currentMode = config.autonomy_rules[meta.key]
              return (
                <div
                  key={meta.key}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{meta.label}</p>
                      <p className="text-xs text-slate-600">{meta.description}</p>
                    </div>
                  </div>

                  <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 gap-1">
                    {MODE_LABELS.map(item => {
                      const active = currentMode === item.mode
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => setRuleMode(meta.key, item.mode)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            active
                              ? 'bg-[#c2410c] text-white shadow-xs'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Workspace Module Toggles */}
        <section id="modules" className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-base font-bold text-slate-900">Workspace Module Toggles</h3>
            <p className="text-xs text-slate-600">
              Enable only what your team uses. Inventory &amp; Procurement and Bookkeeping expand cleanly for Release 2.
            </p>
          </div>

          <ul className="space-y-2.5">
            {WORKSPACE_MODULE_META.map(mod => {
              const enabled = config.modules_enabled[mod.key]
              return (
                <li
                  key={mod.key}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-slate-900">
                        {mod.label}
                      </span>
                      {mod.release === 'release_2' ? (
                        <Badge tone="neutral">Release 2</Badge>
                      ) : (
                        <Badge tone="brand">Core</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{mod.description}</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${mod.label}`}
                    onClick={() => toggleModule(mod.key)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      enabled
                        ? 'bg-[#ea580c] text-white'
                        : 'border border-slate-300 bg-white text-slate-600'
                    }`}
                  >
                    {enabled ? 'ON' : 'OFF'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {/* Live Agent Action Ledger */}
      <section className="exec-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">Agent Action Ledger</h3>
            <p className="text-xs text-slate-600">
              Full before/after audit log with 1-Click Undo / Reverse on executed actions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'executed', label: 'Executed' },
                { id: 'pending_approval', label: 'Pending Approval' },
                { id: 'reversed', label: 'Reversed' },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLedgerFilter(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  ledgerFilter === tab.id
                    ? 'bg-[#c2410c] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : visibleLedger.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<SlidersHorizontal className="h-5 w-5" />}
              title="No agent ledger entries yet"
              description="E-signed quotes, collection nudges, and MCP bot runs appear here with 1-Click Undo."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {visibleLedger.map(entry => (
              <li key={entry.id} className="p-4 sm:p-5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{entry.module}</Badge>
                    <Badge
                      tone={
                        entry.status === 'executed'
                          ? 'emerald'
                          : entry.status === 'reversed'
                            ? 'neutral'
                            : 'amber'
                      }
                    >
                      {entry.status}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-700">
                      {entry.agent_name} · {entry.autonomy_mode}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      {formatCents(entry.impact_cents)}
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {formatDateTime(entry.created_at, settings?.timezone)}
                    </span>
                  </div>
                </div>

                <p className="text-sm font-semibold text-slate-900">{entry.summary}</p>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-slate-500">
                    {entry.action_type}
                    {entry.reversed_at
                      ? ` · Reversed ${formatDateTime(entry.reversed_at, settings?.timezone)}`
                      : ''}
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    {entry.status === 'pending_approval' ? (
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => void handleApprovePending(entry)}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        1-Tap Approve &amp; Execute
                      </button>
                    ) : null}

                    {entry.status === 'executed' ? (
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => void handleUndo(entry)}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                        1-Click Undo / Reverse
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
