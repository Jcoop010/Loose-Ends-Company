import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  EyeOff,
  FileSpreadsheet,
  Radar,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import {
  analyzeShadowCsv,
  formatCents,
  loadSampleQuickBooksExport,
  recomputeShadowLeakTotalCents,
  SHADOW_CATEGORY_LABELS,
  SHADOW_SOURCE_LABELS,
  type AgentActionLedgerEntry,
  type ShadowAnalysisResult,
  type ShadowFinding,
  type ShadowFindingCategory,
  type ShadowSession,
} from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as shadowQueries from '../../../lib/autonomousOs/shadowQueries'
import { formatDateTime } from '../../../lib/format'
import { useSession } from '../../../state/SessionContext'
import {
  Badge,
  EmptyState,
  MetricCard,
  MetricCardSkeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const CATEGORY_FILTER_OPTIONS: ReadonlyArray<{
  value: 'all' | ShadowFindingCategory
  label: string
}> = [
  { value: 'all', label: 'All Leaks' },
  { value: 'unbilled_quote', label: 'Unbilled Quotes' },
  { value: 'overdue_ar', label: 'Overdue AR' },
  { value: 'duplicate_vendor_charge', label: 'Duplicate Charges' },
  { value: 'recurring_creep', label: 'Recurring Creep' },
]

function categoryBadgeTone(category: ShadowFindingCategory): 'brand' | 'rose' | 'amber' | 'neutral' {
  if (category === 'unbilled_quote') return 'brand'
  if (category === 'overdue_ar') return 'rose'
  if (category === 'duplicate_vendor_charge') return 'amber'
  return 'neutral'
}

export function ShadowModePage(): React.ReactElement {
  const { workspace } = useSession()
  const toast = useToast()
  const workspaceId = workspace?.id ?? null
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null)
  const [promoting, setPromoting] = useState(false)
  const [undoing, setUndoing] = useState(false)

  const [sessions, setSessions] = useState<ShadowSession[]>([])
  const [findingsBySession, setFindingsBySession] = useState<Map<string, ShadowFinding[]>>(
    () => new Map(),
  )
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [lastAnalysisMeta, setLastAnalysisMeta] = useState<ShadowAnalysisResult | null>(null)
  const [latestPromotionLedger, setLatestPromotionLedger] =
    useState<AgentActionLedgerEntry | null>(null)

  const [categoryFilter, setCategoryFilter] = useState<'all' | ShadowFindingCategory>('all')
  const [showDismissed, setShowDismissed] = useState(false)

  const loadShadowState = useCallback(
    async (background = false) => {
      if (!workspaceId) return
      if (background) setRefreshing(true)
      else setLoading(true)
      try {
        const res = await shadowQueries.fetchShadowSessionsWithFindings(workspaceId)
        setSessions(res.sessions)
        setFindingsBySession(new Map(res.findingsBySession))
        setActiveSessionId(prev =>
          prev && res.sessions.some(s => s.id === prev) ? prev : (res.sessions[0]?.id ?? null),
        )
      } catch (err) {
        toast.error(
          'Unable to load Shadow Mode sessions',
          err instanceof Error ? err.message : 'Retry loading Shadow Mode.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [workspaceId, toast],
  )

  useEffect(() => {
    void loadShadowState(false)
  }, [loadShadowState])

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId],
  )

  const activeFindings = useMemo(
    () => (activeSession ? findingsBySession.get(activeSession.id) ?? [] : []),
    [activeSession, findingsBySession],
  )

  const openFindings = useMemo(
    () => activeFindings.filter(f => f.status !== 'dismissed'),
    [activeFindings],
  )

  const totalRecoverableCents = useMemo(
    () => recomputeShadowLeakTotalCents(activeFindings),
    [activeFindings],
  )

  const categoryTotals = useMemo(() => {
    const totals: Record<ShadowFindingCategory, number> = {
      unbilled_quote: 0,
      overdue_ar: 0,
      duplicate_vendor_charge: 0,
      recurring_creep: 0,
    }
    for (const item of openFindings) {
      totals[item.category] += item.amount_cents
    }
    return totals
  }, [openFindings])

  const filteredFindings = useMemo(() => {
    return activeFindings.filter(item => {
      if (!showDismissed && item.status === 'dismissed') return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      return true
    })
  }, [activeFindings, categoryFilter, showDismissed])

  const runCsvAnalysis = async (csvText: string, fileName: string, asOfDate?: string) => {
    if (!workspaceId || analyzing) return
    setAnalyzing(true)
    try {
      const analysis = analyzeShadowCsv(csvText, {
        workspaceId,
        fileName,
        asOfDate,
      })
      const saved = await shadowQueries.saveShadowAnalysisToDb(workspaceId, analysis)
      setSessions(prev => [saved.session, ...prev])
      setFindingsBySession(prev => {
        const next = new Map(prev)
        next.set(saved.session.id, saved.findings)
        return next
      })
      setActiveSessionId(saved.session.id)
      setLastAnalysisMeta(analysis)
      setLatestPromotionLedger(null)
      toast.success(
        'Shadow scan complete',
        `Detected ${formatCents(saved.session.total_leak_cents)} across ${saved.findings.length} finding(s) without touching live books.`,
      )
    } catch (err) {
      toast.error(
        'Shadow CSV scan failed',
        err instanceof Error ? err.message : 'Check CSV columns and try again.',
      )
    } finally {
      setAnalyzing(false)
    }
  }

  const handleLoadSample = async () => {
    const sample = loadSampleQuickBooksExport()
    await runCsvAnalysis(sample.csv_text, sample.file_name, sample.as_of_date)
  }

  const handleFileSelected = async (file: File | null | undefined) => {
    if (!file) return
    const text = await file.text()
    await runCsvAnalysis(text, file.name)
  }

  const handleDismissFinding = async (findingId: string) => {
    if (!workspaceId || !activeSession || busyFindingId) return
    setBusyFindingId(findingId)
    try {
      const res = await shadowQueries.dismissShadowFindingInDb({
        workspaceId,
        sessionId: activeSession.id,
        findingId,
        allSessionFindings: activeFindings,
      })
      setFindingsBySession(prev => {
        const next = new Map(prev)
        const current = next.get(activeSession.id) ?? []
        next.set(
          activeSession.id,
          current.map(f => (f.id === findingId ? res.finding : f)),
        )
        return next
      })
      setSessions(prev =>
        prev.map(s =>
          s.id === activeSession.id ? { ...s, total_leak_cents: res.totalLeakCents } : s,
        ),
      )
      toast.info('Finding dismissed', `Recoverable total updated to ${formatCents(res.totalLeakCents)}.`)
    } catch (err) {
      toast.error('Dismiss failed', err instanceof Error ? err.message : 'Retry dismissing finding.')
    } finally {
      setBusyFindingId(null)
    }
  }

  const handlePromoteToLiveOs = async () => {
    if (!workspaceId || !activeSession || promoting) return
    const promotableCount = activeFindings.filter(f => f.status === 'open').length
    if (promotableCount === 0) {
      toast.info('Nothing to promote', 'All open findings in this session are already promoted or dismissed.')
      return
    }
    setPromoting(true)
    try {
      const res = await shadowQueries.promoteShadowSessionInDb({
        workspaceId,
        session: activeSession,
        findings: activeFindings,
      })
      setSessions(prev => prev.map(s => (s.id === res.session.id ? res.session : s)))
      setFindingsBySession(prev => {
        const next = new Map(prev)
        next.set(res.session.id, res.findings)
        return next
      })
      setLatestPromotionLedger(res.ledgerEntry)
      toast.success(
        'Promoted to Live OS + Agent Ledger',
        `${promotableCount} verified record(s) logged with 1-Click Undo protection.`,
      )
    } catch (err) {
      toast.error(
        'Promotion failed',
        err instanceof Error ? err.message : 'Retry promoting Shadow Mode records.',
      )
    } finally {
      setPromoting(false)
    }
  }

  const handleUndoPromotion = async () => {
    if (!workspaceId || !latestPromotionLedger || !activeSession || undoing) return
    setUndoing(true)
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestPromotionLedger,
      })
      setLatestPromotionLedger(reversed)
      await loadShadowState(true)
      toast.info('1-Click Undo completed', 'Shadow session restored to ready status cleanly.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry 1-Click Undo.')
    } finally {
      setUndoing(false)
    }
  }

  if (!workspaceId) return <div />

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-50">
              Shadow Mode · Zero-Migration Leak Scanner
            </h2>
            <Badge tone="brand">Read-Only Sandbox</Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Drop QuickBooks, Zoho, Stripe, or bank CSV exports to uncover leaked revenue &amp; duplicate vendor spend before migrating a single live ledger row.
          </p>
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadShadowState(true)}
          className="exec-btn-secondary self-start !px-3.5 !py-2 !text-xs touch-target"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {/* Read-Only Safety Banner */}
      <div
        role="status"
        className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-xs font-bold text-emerald-300">
              Shadow Mode Active — Live Books Untouched
            </p>
            <p className="text-[11px] text-slate-300">
              CSV analysis runs deterministically in integer cents inside an isolated shadow ledger. Live invoices, customer balances, and books stay untouched until you explicitly click Promote.
            </p>
          </div>
        </div>
        {activeSession ? (
          <Badge tone={activeSession.status === 'promoted' ? 'emerald' : 'neutral'}>
            Session: {activeSession.status}
          </Badge>
        ) : null}
      </div>

      {/* Upload + Sample Export Controls */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div
          onDragOver={e => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={e => {
            e.preventDefault()
            setDragActive(false)
            const droppedFile = e.dataTransfer.files?.[0]
            void handleFileSelected(droppedFile)
          }}
          className={`rounded-2xl border-2 border-dashed p-6 transition ${
            dragActive
              ? 'border-[#fb923c] bg-[rgba(234,88,12,0.12)]'
              : 'border-slate-700 bg-[#0b1320]/80 hover:border-slate-600'
          }`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#fb923c]/35 bg-[rgba(234,88,12,0.16)] text-[#fb923c]">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-50">
                  Drag &amp; Drop QuickBooks, Zoho, Stripe, or Bank CSV Export
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Auto-maps Estimate/Quote, Invoice/AR, Vendor Bill, Credit Card, and Subscription columns using exact integer-cent math.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="Upload CSV export for Shadow Mode analysis"
                onChange={e => {
                  const chosen = e.target.files?.[0]
                  void handleFileSelected(chosen)
                  e.target.value = ''
                }}
                className="sr-only"
              />
              <button
                type="button"
                disabled={analyzing}
                onClick={() => fileInputRef.current?.click()}
                className="exec-btn-secondary !text-xs touch-target"
              >
                <FileSpreadsheet className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                {analyzing ? 'Scanning CSV…' : 'Choose CSV File'}
              </button>
              <button
                type="button"
                disabled={analyzing}
                onClick={() => void handleLoadSample()}
                className="exec-btn-primary !text-xs touch-target"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Load Sample QuickBooks Export
              </button>
            </div>
          </div>
        </div>

        {sessions.length > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label
              htmlFor="shadow-session-select"
              className="text-xs font-semibold text-slate-300"
            >
              Shadow Scan History ({sessions.length})
            </label>
            <select
              id="shadow-session-select"
              value={activeSession?.id ?? ''}
              onChange={e => {
                setActiveSessionId(e.target.value)
                setLatestPromotionLedger(null)
              }}
              className="exec-input !py-1.5 text-xs max-w-md"
            >
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.file_name} · {SHADOW_SOURCE_LABELS[s.source_system]} ·{' '}
                  {formatCents(s.total_leak_cents)} ({s.status})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      {/* Hero Metric & Category KPIs */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : activeSession ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Total Recoverable Dollars"
              value={formatCents(totalRecoverableCents)}
              subtitle={`${openFindings.length} active leak(s) · ${activeSession.row_count} rows scanned`}
              badge={{
                text: SHADOW_SOURCE_LABELS[activeSession.source_system],
                tone: 'brand',
              }}
              accent="brand"
            />
            <MetricCard
              label="Unbilled Quotes"
              value={formatCents(categoryTotals.unbilled_quote)}
              subtitle="Accepted quotes not yet invoiced"
              accent={categoryTotals.unbilled_quote > 0 ? 'brand' : 'slate'}
            />
            <MetricCard
              label="Overdue AR"
              value={formatCents(categoryTotals.overdue_ar)}
              subtitle="Past-due open customer invoices"
              accent={categoryTotals.overdue_ar > 0 ? 'rose' : 'slate'}
            />
            <MetricCard
              label="Duplicate Vendor"
              value={formatCents(categoryTotals.duplicate_vendor_charge)}
              subtitle="Exact repeat charges <= 14 days"
              accent={categoryTotals.duplicate_vendor_charge > 0 ? 'amber' : 'slate'}
            />
            <MetricCard
              label="Recurring Creep"
              value={formatCents(categoryTotals.recurring_creep)}
              subtitle="Annualized SaaS/vendor hikes"
              accent={categoryTotals.recurring_creep > 0 ? 'emerald' : 'slate'}
            />
          </div>

          {/* Promotion + 1-Click Undo Bar */}
          <section className="exec-surface p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-slate-50">{activeSession.file_name}</p>
                {activeSession.created_at ? (
                  <span className="text-[11px] text-slate-400">
                    Scanned {formatDateTime(activeSession.created_at)}
                  </span>
                ) : null}
                {lastAnalysisMeta ? (
                  <Badge tone="neutral">{lastAnalysisMeta.clean_row_count} clean row(s) untouched</Badge>
                ) : null}
              </div>
              <p className="text-xs text-slate-400">
                Dismiss any false positive below, then promote verified records into the Agent Action Ledger with full 1-Click Undo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {latestPromotionLedger && latestPromotionLedger.status === 'executed' ? (
                <button
                  type="button"
                  disabled={undoing}
                  onClick={() => void handleUndoPromotion()}
                  className="exec-btn-secondary !text-xs border-amber-500/40 text-amber-300 touch-target"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {undoing ? 'Reversing…' : '1-Click Undo Promotion'}
                </button>
              ) : null}

              <button
                type="button"
                disabled={
                  promoting ||
                  activeSession.status === 'promoted' ||
                  activeFindings.every(f => f.status !== 'open')
                }
                onClick={() => void handlePromoteToLiveOs()}
                className="exec-btn-emerald !text-xs touch-target"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {activeSession.status === 'promoted'
                  ? 'Promoted to Live OS'
                  : promoting
                    ? 'Promoting…'
                    : 'Promote Clean Records to Live OS'}
              </button>
            </div>
          </section>

          {/* Filterable Findings Table */}
          <section className="exec-surface p-5 sm:p-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {CATEGORY_FILTER_OPTIONS.map(opt => {
                  const selected = categoryFilter === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCategoryFilter(opt.value)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                        selected
                          ? 'border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] text-[#fdba74]'
                          : 'border-slate-700 bg-[#0b1320] text-slate-300 hover:bg-[#131f33]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDismissed}
                  onChange={e => setShowDismissed(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-[#ea580c]"
                />
                Show Dismissed
              </label>
            </div>

            {filteredFindings.length === 0 ? (
              <EmptyState
                title="No matching leak findings"
                description="Adjust category filters or load another CSV export to scan for unbilled quotes, overdue AR, duplicate charges, or recurring creep."
                icon={<Radar className="h-5 w-5 text-[#fb923c]" aria-hidden="true" />}
              />
            ) : (
              <div className="space-y-2.5">
                {filteredFindings.map(item => {
                  const reason =
                    item.proof_summary ||
                    (typeof item.evidence_json.reason === 'string'
                      ? item.evidence_json.reason
                      : 'Deterministic CSV anomaly detected')
                  const recommended =
                    typeof item.evidence_json.recommended_action === 'string'
                      ? item.evidence_json.recommended_action
                      : 'Verify record before promotion'
                  const refLabel =
                    typeof item.evidence_json.reference === 'string'
                      ? item.evidence_json.reference
                      : typeof item.evidence_json.duplicate_reference === 'string'
                        ? item.evidence_json.duplicate_reference
                        : typeof item.evidence_json.latest_reference === 'string'
                          ? item.evidence_json.latest_reference
                          : null

                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border p-4 transition ${
                        item.status === 'dismissed'
                          ? 'border-slate-800/80 bg-[#0b1320]/60 opacity-65'
                          : 'border-slate-800 bg-[#131f33]/75'
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={categoryBadgeTone(item.category)}>
                              {SHADOW_CATEGORY_LABELS[item.category]}
                            </Badge>
                            {refLabel ? (
                              <span className="font-mono text-[11px] text-slate-300 bg-[#0b1320] border border-slate-700 px-2 py-0.5 rounded">
                                {refLabel}
                              </span>
                            ) : null}
                            <Badge
                              tone={
                                item.status === 'promoted'
                                  ? 'emerald'
                                  : item.status === 'dismissed'
                                    ? 'neutral'
                                    : 'amber'
                              }
                            >
                              {item.status}
                            </Badge>
                          </div>

                          <p className="text-sm font-bold text-slate-50">{item.counterparty}</p>

                          {/* Plain-English Proof Card */}
                          <div className="rounded-lg border border-slate-700/80 bg-[#0b1320]/90 px-3 py-2 space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              <span>Deterministic Cent Proof</span>
                              <span className="font-mono tabular-nums text-[#fdba74]">
                                {item.amount_cents.toLocaleString('en-US')} cents
                              </span>
                            </div>
                            <p className="text-xs text-slate-200 leading-relaxed">{reason}</p>
                          </div>

                          <p className="text-[11px] text-slate-400">
                            Next step: {recommended}
                          </p>
                        </div>

                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                          <span className="text-base font-bold text-slate-50 tabular-nums">
                            {formatCents(item.amount_cents)}
                          </span>
                          {item.status === 'open' ? (
                            <button
                              type="button"
                              disabled={busyFindingId === item.id}
                              onClick={() => void handleDismissFinding(item.id)}
                              className="exec-btn-secondary !px-3 !py-1.5 !text-[11px]"
                            >
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                              {busyFindingId === item.id ? 'Dismissing…' : 'Dismiss'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <EmptyState
          title="No Shadow Mode scans yet"
          description="Click Load Sample QuickBooks Export or drop a QuickBooks, Zoho, Stripe, or bank CSV file above to uncover hidden leaks safely in read-only Shadow Mode."
          icon={<Radar className="h-6 w-6 text-[#fb923c]" aria-hidden="true" />}
        />
      )}
    </div>
  )
}
