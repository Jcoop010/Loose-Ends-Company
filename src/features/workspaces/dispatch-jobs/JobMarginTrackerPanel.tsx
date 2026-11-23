import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  FilePlus2,
  Plus,
  RotateCcw,
  TrendingUp,
} from 'lucide-react'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as release5Queries from '../../../lib/autonomousOs/release5Queries'
import {
  evaluateJobMarginPortfolio,
  formatCents as formatExactCents,
  JOB_MARGIN_STATUS_LABELS,
  type AgentActionLedgerEntry,
  type JobMarginRecord,
} from '../../../lib/autonomousOs'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface JobMarginTrackerPanelProps {
  workspaceId: string
  activeEntityId: string
}

export function JobMarginTrackerPanel({
  workspaceId,
  activeEntityId,
}: JobMarginTrackerPanelProps): React.ReactElement {
  const toast = useToast()

  const [records, setRecords] = useState<JobMarginRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [latestLedger, setLatestLedger] = useState<AgentActionLedgerEntry | null>(null)

  const [jobName, setJobName] = useState('')
  const [clientName, setClientName] = useState('')
  const [quotedDollars, setQuotedDollars] = useState('12000')
  const [materialDollars, setMaterialDollars] = useState('4600')
  const [billDollars, setBillDollars] = useState('2800')
  const [laborDollars, setLaborDollars] = useState('2200')
  const [targetPct, setTargetPct] = useState('30')
  const [saving, setSaving] = useState(false)

  const loadMargins = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await release5Queries.fetchJobMarginRecords(workspaceId)
      setRecords(rows)
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadMargins()
  }, [loadMargins])

  const portfolio = useMemo(
    () => evaluateJobMarginPortfolio(records, activeEntityId),
    [records, activeEntityId],
  )

  const entityIdOrNull =
    activeEntityId && activeEntityId !== 'consolidated' && activeEntityId !== 'primary'
      ? activeEntityId
      : null

  const handleAddJobMargin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobName.trim() || !clientName.trim() || saving) return
    setSaving(true)
    try {
      const toCents = (val: string) => Math.max(0, Math.round(Number(val || 0) * 100))
      const created = await release5Queries.createJobMarginRecord({
        workspaceId,
        entityId: entityIdOrNull,
        jobName,
        clientName,
        quotedRevenueCents: toCents(quotedDollars),
        materialPoCents: toCents(materialDollars),
        vendorBillCents: toCents(billDollars),
        laborCents: toCents(laborDollars),
        targetMarginBps: Math.min(9000, Math.max(500, Math.round(Number(targetPct || 30) * 100))),
      })
      setRecords(prev => [created, ...prev])
      setJobName('')
      setClientName('')
      toast.success('Job Margin Tracked', `${created.job_name} added with live cost guardrails.`)
    } catch (err) {
      toast.error('Failed to add job', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSaving(false)
    }
  }

  const handleDraftChangeOrder = async (job: JobMarginRecord) => {
    if (busyJobId) return
    setBusyJobId(job.id)
    try {
      const res = await release5Queries.applyJobChangeOrderInDb(workspaceId, job)
      setRecords(prev => prev.map(row => (row.id === res.updatedJob.id ? res.updatedJob : row)))
      setLatestLedger(res.agentLedgerEntry)
      toast.success(
        'Change Order Drafted & Applied',
        `${res.updatedJob.job_name} updated (${res.agentLedgerEntry.summary})`,
      )
    } catch (err) {
      toast.error('Change order failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyJobId(null)
    }
  }

  const handleUndoChangeOrder = async () => {
    if (!latestLedger || latestLedger.status !== 'executed') return
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestLedger,
      })
      setLatestLedger(reversed)
      await loadMargins()
      toast.info('1-Click Undo completed', 'Job quote & margin status restored to pre-change-order values.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry.')
    }
  }

  return (
    <section
      aria-label="Live Job Margin Tracker"
      className="exec-surface border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-5 text-slate-100"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
            <h2 className="text-base font-bold text-white">Live Job Margin Tracker</h2>
            <Badge tone={portfolio.warning_count + portfolio.over_budget_count > 0 ? 'amber' : 'emerald'}>
              {portfolio.warning_count + portfolio.over_budget_count} Below Target
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-300">
            Tracks quoted revenue vs. material POs, vendor bills &amp; labor in integer cents; flags slip below target margin and drafts exact change orders.
          </p>
        </div>

        {latestLedger?.status === 'executed' ? (
          <button
            type="button"
            onClick={() => void handleUndoChangeOrder()}
            className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300 shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            1-Click Undo Change Order
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Quoted Revenue</p>
          <p className="mt-1 text-base font-bold text-white tabular-nums">
            {formatExactCents(portfolio.total_quoted_cents)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Actual Costs</p>
          <p className="mt-1 text-base font-bold text-slate-100 tabular-nums">
            {formatExactCents(portfolio.total_cost_cents)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Net Margin</p>
          <p
            className={`mt-1 text-base font-bold tabular-nums ${
              portfolio.total_net_margin_cents >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {formatExactCents(portfolio.total_net_margin_cents)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Weighted Margin %</p>
          <p className="mt-1 text-base font-bold text-[#fdba74] tabular-nums">
            {(portfolio.weighted_margin_bps / 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Add Tracked Job Form */}
      <form
        onSubmit={e => void handleAddJobMargin(e)}
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-12 items-end rounded-xl border border-slate-800 bg-[#0e1726] p-3.5"
      >
        <div className="sm:col-span-3">
          <label htmlFor="jm-name" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Job Name
          </label>
          <input
            id="jm-name"
            required
            value={jobName}
            onChange={e => setJobName(e.target.value)}
            placeholder="RTU Compressor Swap"
            className="w-full rounded-lg border border-slate-700 bg-[#0b1320] px-2.5 py-1.5 text-xs text-slate-100"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="jm-client" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Client
          </label>
          <input
            id="jm-client"
            required
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            placeholder="Harbor Logistics"
            className="w-full rounded-lg border border-slate-700 bg-[#0b1320] px-2.5 py-1.5 text-xs text-slate-100"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="jm-quote" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Quoted ($)
          </label>
          <input
            id="jm-quote"
            type="number"
            min="0"
            value={quotedDollars}
            onChange={e => setQuotedDollars(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#0b1320] px-2.5 py-1.5 text-xs text-slate-100 tabular-nums"
          />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="jm-mat" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            PO ($)
          </label>
          <input
            id="jm-mat"
            type="number"
            min="0"
            value={materialDollars}
            onChange={e => setMaterialDollars(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#0b1320] px-2 py-1.5 text-xs text-slate-100 tabular-nums"
          />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="jm-bill" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Bills ($)
          </label>
          <input
            id="jm-bill"
            type="number"
            min="0"
            value={billDollars}
            onChange={e => setBillDollars(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#0b1320] px-2 py-1.5 text-xs text-slate-100 tabular-nums"
          />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="jm-labor" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Labor ($)
          </label>
          <input
            id="jm-labor"
            type="number"
            min="0"
            value={laborDollars}
            onChange={e => setLaborDollars(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#0b1320] px-2 py-1.5 text-xs text-slate-100 tabular-nums"
          />
        </div>
        <div className="sm:col-span-2 flex items-center gap-1.5">
          <input
            type="number"
            min="5"
            max="90"
            aria-label="Target margin percent"
            value={targetPct}
            onChange={e => setTargetPct(e.target.value)}
            className="w-14 rounded-lg border border-slate-700 bg-[#0b1320] px-2 py-1.5 text-xs text-slate-100 tabular-nums"
          />
          <button
            type="submit"
            disabled={saving}
            className="exec-btn-primary !px-3 !py-1.5 !text-xs flex-1"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Track Job
          </button>
        </div>
      </form>

      {/* Live Job Margin Bars */}
      {loading ? (
        <p className="text-xs text-slate-400">Loading live job margin telemetry…</p>
      ) : portfolio.evaluated_jobs.length === 0 ? (
        <p className="text-xs text-slate-400">
          No jobs tracked for this entity yet. Add a job above to monitor live quoted vs. PO + AP + labor costs.
        </p>
      ) : (
        <div className="space-y-3">
          {portfolio.evaluated_jobs.map(item => {
            const costPct =
              item.job.quoted_revenue_cents > 0
                ? Math.min(100, Math.round((item.total_cost_cents * 100) / item.job.quoted_revenue_cents))
                : 100
            return (
              <div
                key={item.job.id}
                className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">{item.job.job_name}</span>
                      <Badge
                        tone={
                          item.computed_status === 'healthy'
                            ? 'emerald'
                            : item.computed_status === 'over_budget'
                              ? 'rose'
                              : 'amber'
                        }
                      >
                        {JOB_MARGIN_STATUS_LABELS[item.computed_status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400">{item.job.client_name}</p>
                  </div>

                  <div className="text-right tabular-nums">
                    <p className="text-sm font-bold text-white">
                      {(item.actual_margin_bps / 100).toFixed(1)}% actual{' '}
                      <span className="text-xs font-normal text-slate-400">
                        (target {(item.target_margin_bps / 100).toFixed(1)}%)
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-300">
                      Quote {formatExactCents(item.job.quoted_revenue_cents)} vs Cost{' '}
                      {formatExactCents(item.total_cost_cents)} · Net{' '}
                      {formatExactCents(item.net_margin_cents)}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        item.computed_status === 'over_budget'
                          ? 'bg-rose-500'
                          : item.computed_status === 'margin_warning'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                      style={{ width: `${costPct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between text-[11px] text-slate-400 tabular-nums">
                    <span>
                      Material PO {formatExactCents(item.job.material_po_cents)} · Vendor Bills{' '}
                      {formatExactCents(item.job.vendor_bill_cents)} · Labor{' '}
                      {formatExactCents(item.job.labor_cents)}
                    </span>
                    <span>Cost ratio {costPct}% of quote</span>
                  </div>
                </div>

                {item.suggested_change_order_cents > 0 ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                    <div className="flex items-start gap-2 text-[11px] text-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-300" aria-hidden="true" />
                      <span>{item.change_order_draft}</span>
                    </div>
                    <button
                      type="button"
                      disabled={busyJobId === item.job.id}
                      onClick={() => void handleDraftChangeOrder(item.job)}
                      className="exec-btn-primary !px-3 !py-1.5 !text-xs shrink-0"
                    >
                      <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Draft Change Order (+{formatExactCents(item.suggested_change_order_cents)})
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
