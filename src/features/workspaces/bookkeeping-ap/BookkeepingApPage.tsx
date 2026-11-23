import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Download,
  FileCheck2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { formatCents } from '../../../lib/format'
import * as release2Queries from '../../../lib/autonomousOs/release2Queries'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as release4bQueries from '../../../lib/autonomousOs/release4bQueries'
import {
  compileCpaAuditPacket,
  compileFullBusinessPortabilityBundle,
  computeBookkeepingKpis,
  formatCents as formatExactCents,
  FRAUD_ALERT_STATUS_LABELS,
  FRAUD_ALERT_TYPE_LABELS,
  serializeCpaPacketToCsv,
  serializeCpaPacketToJson,
  serializePortabilityBundleToCsv,
  serializePortabilityBundleToJson,
  simulateCashflow90Day,
  type AgentActionLedgerEntry,
  type AutonomousInvoice,
  type CpaAuditPacket,
  type LedgerEntryRecord,
  type LedgerEntryType,
  type VendorBillRecord,
  type VendorFraudAlertRecord,
} from '../../../lib/autonomousOs'
import { useSession } from '../../../state/SessionContext'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState, MetricCard, MetricCardSkeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export function BookkeepingApPage(): React.ReactElement {
  const { workspace } = useSession()
  const toast = useToast()
  const workspaceId = workspace?.id ?? null

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([])
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntryRecord[]>([])
  const [openInvoices, setOpenInvoices] = useState<AutonomousInvoice[]>([])
  const [allInvoices, setAllInvoices] = useState<AutonomousInvoice[]>([])
  const [fraudAlerts, setFraudAlerts] = useState<VendorFraudAlertRecord[]>([])
  const [scanningFraud, setScanningFraud] = useState(false)
  const [busyFraudId, setBusyFraudId] = useState<string | null>(null)
  const [latestFraudLedger, setLatestFraudLedger] = useState<AgentActionLedgerEntry | null>(null)
  const [undoingFraud, setUndoingFraud] = useState(false)
  const [exportingPortability, setExportingPortability] = useState(false)
  const [cpaPacketOpen, setCpaPacketOpen] = useState(false)
  const [cpaPacket, setCpaPacket] = useState<CpaAuditPacket | null>(null)
  const [startingBalanceDollars, setStartingBalanceDollars] = useState('25000')
  const [safetyBufferDollars, setSafetyBufferDollars] = useState('5000')
  const [busyBillId, setBusyBillId] = useState<string | null>(null)

  const [entryType, setEntryType] = useState<LedgerEntryType>('expense')
  const [entryCategory, setEntryCategory] = useState('Operating Expense')
  const [entryDescription, setEntryDescription] = useState('')
  const [entryAmountDollars, setEntryAmountDollars] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [savingEntry, setSavingEntry] = useState(false)

  const loadData = useCallback(
    async (background = false) => {
      if (!workspaceId) return
      if (background) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      try {
        const [res, alerts] = await Promise.all([
          release2Queries.fetchBookkeepingData(workspaceId),
          release4bQueries.fetchVendorFraudAlerts(workspaceId).catch(() => []),
        ])
        setVendorBills(res.vendorBills)
        setLedgerEntries(res.ledgerEntries)
        setOpenInvoices(res.openInvoices)
        setAllInvoices(res.allInvoices)
        setFraudAlerts(alerts)
      } catch (err) {
        toast.error(
          'Unable to load Bookkeeping & AP',
          err instanceof Error ? err.message : 'Retry.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [workspaceId, toast],
  )

  useEffect(() => {
    void loadData(false)
  }, [loadData])

  const kpis = useMemo(
    () => computeBookkeepingKpis(ledgerEntries, vendorBills),
    [ledgerEntries, vendorBills],
  )

  const projection = useMemo(() => {
    const startCents = Math.round(Number(startingBalanceDollars || 0) * 100)
    const bufferCents = Math.max(0, Math.round(Number(safetyBufferDollars || 0) * 100))
    const safeStart = Number.isSafeInteger(startCents) ? startCents : 0
    const safeBuffer = Number.isSafeInteger(bufferCents) ? bufferCents : 500000
    return simulateCashflow90Day(safeStart, openInvoices, vendorBills, {
      safetyBufferCents: safeBuffer,
    })
  }, [startingBalanceDollars, safetyBufferDollars, openInvoices, vendorBills])

  const maxChartCents = useMemo(() => {
    let maxVal = Math.max(100, Math.abs(projection.starting_balance_cents))
    for (const w of projection.windows) {
      maxVal = Math.max(
        maxVal,
        Math.abs(w.ending_balance_cents),
        w.period_inflows_cents,
        w.period_outflows_cents,
      )
    }
    return maxVal
  }, [projection])

  const handleBillAction = async (
    bill: VendorBillRecord,
    action: 'approve' | 'dispute' | 'paid',
  ) => {
    if (!workspaceId || busyBillId) return
    setBusyBillId(bill.id)
    try {
      if (action === 'approve') {
        await release2Queries.approveVendorBillInDb({ workspaceId, bill })
        toast.success('Vendor bill approved', bill.invoice_number)
      } else if (action === 'dispute') {
        await release2Queries.disputeVendorBillInDb({ workspaceId, bill })
        toast.info('Vendor dispute staged', `${bill.invoice_number} held in AP`)
      } else {
        await release2Queries.markVendorBillPaidInDb({ workspaceId, bill })
        toast.success('Vendor bill marked paid', 'COGS entry posted to ledger.')
      }
      await loadData(true)
    } catch (err) {
      toast.error('Bill update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyBillId(null)
    }
  }

  const handleAddLedgerEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || savingEntry) return
    const desc = entryDescription.trim()
    const cents = Math.round(Number(entryAmountDollars) * 100)
    if (!desc || !Number.isSafeInteger(cents) || cents <= 0) {
      toast.error('Invalid ledger entry', 'Description and positive dollar amount required.')
      return
    }
    setSavingEntry(true)
    try {
      await release2Queries.createLedgerEntryInDb({
        workspaceId,
        entry_type: entryType,
        category: entryCategory,
        description: desc,
        amount_cents: cents,
        occurred_on: entryDate,
      })
      toast.success('Ledger entry recorded', `${desc} (${formatCents(cents)})`)
      setEntryDescription('')
      setEntryAmountDollars('')
      await loadData(true)
    } catch (err) {
      toast.error('Failed to record entry', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingEntry(false)
    }
  }

  const handleGenerateCpaPacket = () => {
    const startCents = Math.max(0, Math.round(Number(startingBalanceDollars || 0) * 100))
    const packet = compileCpaAuditPacket({
      workspaceName: workspace?.name ?? 'Workspace',
      ledgerEntries,
      invoices: allInvoices,
      vendorBills,
      openingCashCents: Number.isSafeInteger(startCents) ? startCents : 0,
    })
    setCpaPacket(packet)
    setCpaPacketOpen(true)
  }

  const triggerDownload = (content: string, mimeType: string, extension: 'csv' | 'json', prefix = 'cpa_audit_packet') => {
    if (typeof document === 'undefined') return
    const dateTag = cpaPacket?.as_of_date ?? new Date().toISOString().slice(0, 10)
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${prefix}_${dateTag}.${extension}`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  const handleFullPortabilityExport = async (format: 'json' | 'csv') => {
    if (!workspaceId || exportingPortability) return
    setExportingPortability(true)
    try {
      const extra = await release4bQueries.fetchFullPortabilityExportInputs(workspaceId)
      const bundle = compileFullBusinessPortabilityBundle({
        workspaceName: workspace?.name ?? 'Workspace',
        ledgerEntries,
        invoices: allInvoices,
        vendorBills,
        quotes: extra.quotes,
        complianceItems: extra.complianceItems,
        livingSops: extra.livingSops,
        executableSops: extra.executableSops,
        vendorFraudAlerts: fraudAlerts,
        collectionTouches: extra.collectionTouches,
      })
      const payload =
        format === 'json'
          ? serializePortabilityBundleToJson(bundle)
          : serializePortabilityBundleToCsv(bundle)
      triggerDownload(
        payload,
        format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
        format,
        'loose_ends_full_portability',
      )
      toast.success(
        `Full Business Portability Export (${format.toUpperCase()})`,
        `${bundle.record_counts.invoices} invoices · ${bundle.record_counts.ledger_entries} ledger rows · zero lock-in.`,
      )
    } catch (err) {
      toast.error('Portability export failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setExportingPortability(false)
    }
  }

  const handleScanFraud = async () => {
    if (!workspaceId || scanningFraud) return
    setScanningFraud(true)
    try {
      const alerts = await release4bQueries.persistVendorFraudScanInDb({
        workspaceId,
        vendorBills,
      })
      setFraudAlerts(alerts)
      const frozen = alerts.filter(a => a.status === 'frozen')
      toast.success(
        'Vendor Fraud Shield Scan Complete',
        `${frozen.length} bill(s) currently frozen pending owner verification.`,
      )
    } catch (err) {
      toast.error('Fraud scan failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setScanningFraud(false)
    }
  }

  const handleResolveFraudAlert = async (
    alert: VendorFraudAlertRecord,
    nextStatus: 'approved_override' | 'dismissed',
  ) => {
    if (!workspaceId || busyFraudId) return
    setBusyFraudId(alert.id)
    try {
      const res = await release4bQueries.resolveVendorFraudAlertInDb({
        workspaceId,
        alert,
        nextStatus,
      })
      setFraudAlerts(prev => prev.map(a => (a.id === alert.id ? res.alert : a)))
      setLatestFraudLedger(res.ledgerEntry)
      toast.info(
        nextStatus === 'approved_override' ? 'Override approved' : 'Fraud alert dismissed',
        `${alert.vendor_name} · Undo available in 1 click.`,
      )
    } catch (err) {
      toast.error('Fraud update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyFraudId(null)
    }
  }

  const handleUndoFraudOverride = async () => {
    if (!workspaceId || !latestFraudLedger || undoingFraud) return
    setUndoingFraud(true)
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestFraudLedger,
      })
      setLatestFraudLedger(reversed)
      await loadData(true)
      toast.info('1-Click Undo completed', 'Vendor fraud alert restored to frozen state.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry 1-Click Undo.')
    } finally {
      setUndoingFraud(false)
    }
  }

  if (!workspaceId) return <div />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Bookkeeping, 90-Day Cashflow &amp; AP</h2>
          <p className="text-xs text-slate-600">
            Deterministic integer-cent ledger, 30/60/90-day cash runway projection, and 3-way matched vendor bills logged to your Agent Action Ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            disabled={loading}
            onClick={handleGenerateCpaPacket}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
          >
            <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
            1-Click CPA Packet
          </button>
          <button
            type="button"
            disabled={loading || exportingPortability}
            onClick={() => void handleFullPortabilityExport('json')}
            className="exec-btn-secondary !px-3 !py-2 !text-xs touch-target"
          >
            <Download className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
            Full Portability (JSON)
          </button>
          <button
            type="button"
            disabled={loading || exportingPortability}
            onClick={() => void handleFullPortabilityExport('csv')}
            className="exec-btn-secondary !px-3 !py-2 !text-xs touch-target"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            Full Portability (CSV)
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadData(true)}
            className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Syncing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Vendor Fraud Shield Queue */}
      <section className="exec-surface border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-4 text-slate-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
              <h3 className="text-base font-bold text-white">
                Vendor Fraud Shield (Auto-Freeze &gt;10% Price Spikes / Duplicates / Remit Changes)
              </h3>
              <Badge tone={fraudAlerts.some(a => a.status === 'frozen') ? 'rose' : 'emerald'}>
                {fraudAlerts.filter(a => a.status === 'frozen').length} Frozen
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Automatically holds suspicious vendor bills in AP until you verify Proof Cards or approve a reversible override.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {latestFraudLedger && latestFraudLedger.status === 'executed' ? (
              <button
                type="button"
                disabled={undoingFraud}
                onClick={() => void handleUndoFraudOverride()}
                className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {undoingFraud ? 'Reversing…' : '1-Click Undo Override'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={scanningFraud || loading}
              onClick={() => void handleScanFraud()}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {scanningFraud ? 'Scanning Bills…' : 'Scan Bills for Fraud'}
            </button>
          </div>
        </div>

        {fraudAlerts.length === 0 ? (
          <p className="text-xs text-slate-400">
            No frozen vendor fraud alerts on file. Click <strong className="text-slate-200">Scan Bills for Fraud</strong> to run deterministic checks across POs and remit hints.
          </p>
        ) : (
          <div className="space-y-2.5">
            {fraudAlerts.map(alert => (
              <div
                key={alert.id}
                className="rounded-xl border border-slate-800 bg-[#0e1726] p-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="rose">{FRAUD_ALERT_TYPE_LABELS[alert.alert_type]}</Badge>
                    <Badge
                      tone={
                        alert.status === 'frozen'
                          ? 'amber'
                          : alert.status === 'approved_override'
                            ? 'emerald'
                            : 'neutral'
                      }
                    >
                      {FRAUD_ALERT_STATUS_LABELS[alert.status]}
                    </Badge>
                  </div>
                  <p className="text-sm font-bold text-white">{alert.vendor_name}</p>
                  <p className="text-xs text-slate-300">{alert.proof_summary}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-white tabular-nums mr-1">
                    {formatExactCents(alert.variance_cents)}
                  </span>
                  {alert.status === 'frozen' ? (
                    <>
                      <button
                        type="button"
                        disabled={busyFraudId === alert.id}
                        onClick={() => void handleResolveFraudAlert(alert, 'approved_override')}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                      >
                        Approve Override
                      </button>
                      <button
                        type="button"
                        disabled={busyFraudId === alert.id}
                        onClick={() => void handleResolveFraudAlert(alert, 'dismissed')}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
                      >
                        Dismiss
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Top KPI Bar */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Net Cashflow"
            value={formatCents(kpis.net_cashflow_cents)}
            subtitle={`Rev ${formatCents(kpis.revenue_cents)} vs Cost ${formatCents(kpis.cogs_cents + kpis.expense_cents)}`}
            accent={kpis.net_cashflow_cents >= 0 ? 'emerald' : 'rose'}
          />
          <MetricCard
            label="Total AP Due"
            value={formatCents(kpis.total_ap_due_cents)}
            subtitle={`${kpis.open_bills_count} open vendor bill(s)`}
            accent={kpis.total_ap_due_cents > 0 ? 'amber' : 'slate'}
          />
          <MetricCard
            label="Auto-Matched Bills"
            value={kpis.auto_matched_bills_count}
            subtitle={formatCents(kpis.auto_matched_bills_cents)}
            accent="emerald"
          />
          <MetricCard
            label="Disputed / Saved Dollars"
            value={formatCents(kpis.disputed_saved_cents)}
            subtitle={`${kpis.disputed_bills_count} exception/held bill(s)`}
            accent={kpis.disputed_saved_cents > 0 ? 'brand' : 'slate'}
          />
        </div>
      )}

      {/* 90-Day Cashflow Projection */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-900">90-Day Cashflow Projection</h3>
            </div>
            <p className="text-xs text-slate-600">
              Combines open AR invoices ({formatCents(projection.total_open_ar_cents)}) and scheduled AP bills ({formatCents(projection.total_scheduled_ap_cents)}), holding disputed bills ({formatCents(projection.held_disputed_ap_cents)}) out of cash outflow.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label htmlFor="cf-starting-cash" className="block text-[11px] font-semibold text-slate-600">
                Starting Cash ($)
              </label>
              <input
                id="cf-starting-cash"
                type="number"
                value={startingBalanceDollars}
                onChange={e => setStartingBalanceDollars(e.target.value)}
                className="exec-input w-28 !py-1 !text-xs tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="cf-safety-buffer" className="block text-[11px] font-semibold text-slate-600">
                Safety Buffer ($)
              </label>
              <input
                id="cf-safety-buffer"
                type="number"
                min="0"
                value={safetyBufferDollars}
                onChange={e => setSafetyBufferDollars(e.target.value)}
                className="exec-input w-28 !py-1 !text-xs tabular-nums"
              />
            </div>
          </div>
        </div>

        {projection.any_buffer_breach ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900 flex items-center gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>
              Projected cash dips below safety buffer ({formatCents(projection.safety_buffer_cents)}) in the{' '}
              <strong>{projection.first_breach_horizon_days}-day</strong> window (lowest projected balance:{' '}
              <strong>{formatCents(projection.lowest_projected_balance_cents)}</strong>).
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {projection.windows.map(bucket => {
            const fillPct = Math.max(
              6,
              Math.min(100, Math.round((Math.max(0, bucket.ending_balance_cents) / maxChartCents) * 100)),
            )
            return (
              <div
                key={bucket.horizon_days}
                className={`rounded-2xl border p-4 space-y-3 tabular-nums ${
                  bucket.below_buffer
                    ? 'border-rose-200 bg-rose-50/40'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    {bucket.label} (by {bucket.window_end_date})
                  </span>
                  <Badge tone={bucket.below_buffer ? 'rose' : 'emerald'}>
                    {bucket.below_buffer
                      ? `Short ${formatCents(bucket.buffer_shortfall_cents)}`
                      : 'Above Buffer'}
                  </Badge>
                </div>

                <p className="text-xl font-black text-slate-950">
                  {formatCents(bucket.ending_balance_cents)}
                </p>

                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      bucket.below_buffer ? 'bg-rose-600' : 'bg-[#ea580c]'
                    }`}
                    style={{ width: `${fillPct}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Period AR In</span>
                    <p className="font-bold text-emerald-700">
                      +{formatCents(bucket.period_inflows_cents)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Period AP Out</span>
                    <p className="font-bold text-slate-900">
                      -{formatCents(bucket.period_outflows_cents)}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Vendor Bills AP Approval / Dispute Queue */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            Vendor Bills Queue ({vendorBills.length})
          </h3>
          <span className="text-xs text-slate-500">Logged to Agent Action Ledger</span>
        </div>

        {vendorBills.length === 0 ? (
          <EmptyState
            icon={<BookOpenCheck className="h-5 w-5" aria-hidden="true" />}
            title="No vendor bills in AP queue"
            description="Record and verify vendor bills inside Inventory & Procurement -> 3-Way Match Queue."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3.5 py-2.5">Bill # / Supplier</th>
                  <th className="px-3.5 py-2.5">Match Status</th>
                  <th className="px-3.5 py-2.5 text-right">Variance</th>
                  <th className="px-3.5 py-2.5 text-right">Total</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {vendorBills.map(bill => (
                  <tr key={bill.id}>
                    <td className="px-3.5 py-3">
                      <p className="font-mono font-bold text-slate-900">{bill.invoice_number}</p>
                      <p className="text-slate-600">
                        {bill.vendor_name} · Due {bill.due_date}
                      </p>
                      {bill.discrepancy_summary ? (
                        <p className="mt-0.5 text-[11px] text-rose-700">
                          {bill.discrepancy_summary}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3.5 py-3">
                      <Badge
                        tone={
                          bill.match_status === 'matched_clean' || bill.match_status === 'paid'
                            ? 'emerald'
                            : bill.match_status === 'exception_flagged' ||
                                bill.match_status === 'disputed'
                              ? 'rose'
                              : 'amber'
                        }
                      >
                        {bill.match_status}
                      </Badge>
                    </td>
                    <td className="px-3.5 py-3 text-right font-bold tabular-nums">
                      <span
                        className={
                          bill.match_variance_cents !== 0 ? 'text-rose-700' : 'text-emerald-700'
                        }
                      >
                        {formatCents(bill.match_variance_cents)}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-right font-bold text-slate-950 tabular-nums">
                      {formatCents(bill.total_cents)}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {bill.match_status !== 'matched_clean' && bill.match_status !== 'paid' ? (
                          <button
                            type="button"
                            disabled={busyBillId === bill.id}
                            onClick={() => void handleBillAction(bill, 'approve')}
                            className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                            Approve
                          </button>
                        ) : null}
                        {bill.match_status !== 'disputed' && bill.match_status !== 'paid' ? (
                          <button
                            type="button"
                            disabled={busyBillId === bill.id}
                            onClick={() => void handleBillAction(bill, 'dispute')}
                            className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                          >
                            <ShieldAlert className="h-3 w-3 text-[#ea580c]" aria-hidden="true" />
                            Dispute
                          </button>
                        ) : null}
                        {bill.match_status === 'matched_clean' ? (
                          <button
                            type="button"
                            disabled={busyBillId === bill.id}
                            onClick={() => void handleBillAction(bill, 'paid')}
                            className="exec-btn-emerald !px-2.5 !py-1 !text-[11px]"
                          >
                            Mark Paid
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Ledger Entries + Quick Entry Form */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            Double-Entry &amp; Cashflow Ledger ({ledgerEntries.length})
          </h3>
        </div>

        <form
          onSubmit={e => void handleAddLedgerEntry(e)}
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-12 items-end rounded-xl border border-slate-200 bg-slate-50 p-3.5"
        >
          <div className="sm:col-span-2">
            <label htmlFor="le-type" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Type
            </label>
            <select
              id="le-type"
              value={entryType}
              onChange={e => setEntryType(e.target.value as LedgerEntryType)}
              className="exec-input w-full !py-1.5 text-xs bg-white"
            >
              <option value="revenue">Revenue</option>
              <option value="cogs">COGS</option>
              <option value="expense">Expense</option>
              <option value="ap_scheduled">AP Scheduled</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="le-cat" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Category
            </label>
            <input
              id="le-cat"
              value={entryCategory}
              onChange={e => setEntryCategory(e.target.value)}
              className="exec-input w-full !py-1.5 text-xs bg-white"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="le-desc" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Description
            </label>
            <input
              id="le-desc"
              required
              value={entryDescription}
              onChange={e => setEntryDescription(e.target.value)}
              placeholder="Client retainer deposit / Software / Freight"
              className="exec-input w-full !py-1.5 text-xs bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="le-amt" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Amount ($)
            </label>
            <input
              id="le-amt"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={entryAmountDollars}
              onChange={e => setEntryAmountDollars(e.target.value)}
              placeholder="450.00"
              className="exec-input w-full !py-1.5 text-xs tabular-nums bg-white"
            />
          </div>
          <div className="sm:col-span-2 flex gap-1.5">
            <input
              type="date"
              aria-label="Occurred on date"
              value={entryDate}
              onChange={e => setEntryDate(e.target.value)}
              className="exec-input w-full !py-1.5 text-xs bg-white"
            />
            <button
              type="submit"
              disabled={savingEntry}
              className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Post
            </button>
          </div>
        </form>

        {ledgerEntries.length === 0 ? (
          <p className="text-xs text-slate-500">No ledger entries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3.5 py-2.5">Date</th>
                  <th className="px-3.5 py-2.5">Type</th>
                  <th className="px-3.5 py-2.5">Category &amp; Description</th>
                  <th className="px-3.5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {ledgerEntries.map(entry => (
                  <tr key={entry.id}>
                    <td className="px-3.5 py-2.5 tabular-nums text-slate-600">{entry.occurred_on}</td>
                    <td className="px-3.5 py-2.5">
                      <Badge
                        tone={
                          entry.entry_type === 'revenue'
                            ? 'emerald'
                            : entry.entry_type === 'ap_scheduled'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {entry.entry_type}
                      </Badge>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <p className="font-bold text-slate-900">{entry.category}</p>
                      <p className="text-slate-600">{entry.description}</p>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-slate-950">
                      {entry.entry_type === 'revenue' ? '+' : '-'}
                      {formatCents(Math.abs(entry.amount_cents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 1-Click CPA Tax & Audit Packet Modal */}
      <Dialog
        open={cpaPacketOpen && cpaPacket !== null}
        onClose={() => setCpaPacketOpen(false)}
        title="1-Click CPA Tax & Audit Packet"
        description={
          cpaPacket
            ? `${cpaPacket.workspace_name} · ${cpaPacket.period_label} · As of ${cpaPacket.as_of_date}`
            : ''
        }
        maxWidthClass="max-w-4xl"
        footer={
          cpaPacket ? (
            <div className="flex flex-wrap items-center justify-between gap-2 w-full">
              <span className="text-xs font-semibold text-emerald-300">
                Variance: {formatExactCents(cpaPacket.trial_balance.variance_cents)} (Verified Balanced)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(
                      serializeCpaPacketToJson(cpaPacket),
                      'application/json;charset=utf-8',
                      'json',
                    )
                  }
                  className="exec-btn-secondary !px-3.5 !py-2 !text-xs"
                >
                  <Download className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
                  Download JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(
                      serializeCpaPacketToCsv(cpaPacket),
                      'text/csv;charset=utf-8',
                      'csv',
                    )
                  }
                  className="exec-btn-primary !px-3.5 !py-2 !text-xs"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download CSV Packet
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {cpaPacket ? (
          <div className="space-y-5 text-slate-100">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  Deterministic Integer-Cent Trial Balance Verification
                </span>
                <Badge tone="emerald">
                  Variance {formatExactCents(cpaPacket.trial_balance.variance_cents)}
                </Badge>
              </div>
              <p className="text-xs text-slate-200">{cpaPacket.proof_summary}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#fb923c]">
                  Profit &amp; Loss Statement (P&amp;L)
                </h4>
                <dl className="space-y-1.5 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Operating Revenue</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatExactCents(cpaPacket.profit_and_loss.revenue_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Cost of Goods Sold</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatExactCents(cpaPacket.profit_and_loss.cogs_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1">
                    <dt className="text-slate-300 font-semibold">Gross Profit</dt>
                    <dd className="font-bold text-emerald-300">
                      {formatExactCents(cpaPacket.profit_and_loss.gross_profit_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Operating Expenses</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatExactCents(cpaPacket.profit_and_loss.operating_expenses_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1">
                    <dt className="font-bold text-white">Net Income</dt>
                    <dd className="font-bold text-white">
                      {formatExactCents(cpaPacket.profit_and_loss.net_income_cents)}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#fb923c]">
                  Balance Sheet Snapshot
                </h4>
                <dl className="space-y-1.5 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Operating Cash (1000)</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatExactCents(cpaPacket.balance_sheet.cash_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Accounts Receivable (1200)</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatExactCents(cpaPacket.balance_sheet.accounts_receivable_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1">
                    <dt className="font-semibold text-slate-200">Total Assets</dt>
                    <dd className="font-bold text-emerald-300">
                      {formatExactCents(cpaPacket.balance_sheet.total_assets_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Accounts Payable (2000)</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatExactCents(cpaPacket.balance_sheet.accounts_payable_cents)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1">
                    <dt className="font-bold text-white">Liabilities + Equity</dt>
                    <dd className="font-bold text-white">
                      {formatExactCents(cpaPacket.balance_sheet.liabilities_plus_equity_cents)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1320]">
              <table className="min-w-full divide-y divide-slate-800 text-xs tabular-nums">
                <thead className="bg-[#131f33] text-left text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Trial Balance Account</th>
                    <th className="px-3 py-2 text-right">Debits</th>
                    <th className="px-3 py-2 text-right">Credits</th>
                    <th className="px-3 py-2 text-right">Net Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {cpaPacket.trial_balance.rows.map(row => (
                    <tr key={row.account_code}>
                      <td className="px-3 py-2 font-mono text-slate-400">{row.account_code}</td>
                      <td className="px-3 py-2 font-semibold text-slate-100">{row.account_name}</td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        {formatExactCents(row.debit_cents)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        {formatExactCents(row.credit_cents)}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-white">
                        {formatExactCents(row.net_balance_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#131f33]/80 font-bold text-emerald-300">
                    <td className="px-3 py-2 font-mono">SUM</td>
                    <td className="px-3 py-2">
                      Reconciled Totals ({cpaPacket.general_ledger.length} GL lines)
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatExactCents(cpaPacket.trial_balance.total_debits_cents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatExactCents(cpaPacket.trial_balance.total_credits_cents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      Var {formatExactCents(cpaPacket.trial_balance.variance_cents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
