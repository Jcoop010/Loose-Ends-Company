import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CreditCard,
  Link2,
  Mail,
  PauseCircle,
  PlayCircle,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import {
  COLLECTION_STAGE_LABELS,
  COLLECTION_STATUS_LABELS,
  computeArSummary,
  computeInvoiceBalanceDueCents,
  DEFAULT_AUTONOMY_CONFIG,
  evaluateAutonomousCollections,
  formatCents,
  formatCents as formatExactCents,
  type AgentActionLedgerEntry,
  type AutonomousInvoice,
  type CollectionTouchRecord,
  type InvoiceDunningEventRecord,
  type InvoicePaymentRecord,
  type InvoiceStatus,
  type VendorBillRecord,
  type WorkspaceAutonomyConfig,
} from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as mission10Queries from '../../../lib/autonomousOs/mission10Queries'
import * as release4Queries from '../../../lib/autonomousOs/release4Queries'
import { createInvoicePaymentLink } from '../../../lib/edgeFunctions'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import type { BotAutonomyMode, StagedOpsAction } from '../../../types/domain'
import { useSession } from '../../../state/SessionContext'
import { Badge, EmptyState, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'
import { Mission10CashflowPanels } from './Mission10CashflowPanels'

type ArFilter = 'all' | 'open' | InvoiceStatus

export function InvoicesArPage(): React.ReactElement {
  const { workspace } = useSession()
  const toast = useToast()

  const workspaceId = workspace?.id ?? null
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<AutonomousInvoice[]>([])
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([])
  const [invoicePayments, setInvoicePayments] = useState<InvoicePaymentRecord[]>([])
  const [dunningEvents, setDunningEvents] = useState<InvoiceDunningEventRecord[]>([])
  const [dunningQueue, setDunningQueue] = useState<StagedOpsAction[]>([])
  const [collectionsBotMode, setCollectionsBotMode] = useState<BotAutonomyMode>('propose')
  const [collectionTouches, setCollectionTouches] = useState<CollectionTouchRecord[]>([])
  const [portalTokenByQuoteId, setPortalTokenByQuoteId] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  )
  const [disputedInvoiceIds, setDisputedInvoiceIds] = useState<string[]>([])
  const [latestRunLedger, setLatestRunLedger] = useState<AgentActionLedgerEntry | null>(null)
  const [autonomyConfig, setAutonomyConfig] =
    useState<WorkspaceAutonomyConfig>(DEFAULT_AUTONOMY_CONFIG)
  const [filter, setFilter] = useState<ArFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [paymentDrawerInvoiceId, setPaymentDrawerInvoiceId] = useState<string | null>(null)
  const [stagingCollections, setStagingCollections] = useState(false)
  const [undoingCollections, setUndoingCollections] = useState(false)

  const loadData = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const [
        invRes,
        configRes,
        touchesRes,
        portalMapRes,
        billsRes,
        paymentsRes,
        dunningEventsRes,
        dunningQueueRes,
        botModeRes,
      ] = await Promise.all([
        autonomousQueries.fetchInvoicesAndItems(workspaceId),
        autonomousQueries.fetchWorkspaceAutonomySettings(workspaceId),
        release4Queries.fetchCollectionTouches(workspaceId),
        release4Queries.fetchQuotePortalTokensByQuoteId(workspaceId),
        fetchAllWorkspaceRows<VendorBillRecord>({
          table: 'vendor_bills',
          workspaceId,
          orderBy: 'created_at',
          ascending: false,
        }).catch(() => [] as VendorBillRecord[]),
        mission10Queries.fetchInvoicePayments(workspaceId).catch(() => [] as InvoicePaymentRecord[]),
        mission10Queries
          .fetchInvoiceDunningEvents(workspaceId)
          .catch(() => [] as InvoiceDunningEventRecord[]),
        mission10Queries.fetchDunningApprovalQueue(workspaceId).catch(() => [] as StagedOpsAction[]),
        mission10Queries.fetchCollectionsBotMode(workspaceId).catch(() => 'propose' as BotAutonomyMode),
      ])
      setInvoices(invRes.invoices)
      setAutonomyConfig(configRes)
      setCollectionTouches(touchesRes)
      setPortalTokenByQuoteId(portalMapRes)
      setVendorBills(billsRes ?? [])
      setInvoicePayments(paymentsRes)
      setDunningEvents(dunningEventsRes)
      setDunningQueue(dunningQueueRes)
      setCollectionsBotMode(botModeRes)
    } catch (err) {
      toast.error(
        'Could not load invoices',
        err instanceof Error ? err.message : 'Retry loading AR ledger.',
      )
    } finally {
      setLoading(false)
    }
  }, [workspaceId, toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const summary = useMemo(() => computeArSummary(invoices), [invoices])
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const collectionsPlan = useMemo(
    () =>
      workspaceId
        ? evaluateAutonomousCollections({
            workspaceId,
            invoices,
            existingTouches: collectionTouches,
            disputedInvoiceIds,
            portalTokenByQuoteId,
            config: autonomyConfig,
            asOfDate: todayIso,
          })
        : null,
    [
      workspaceId,
      invoices,
      collectionTouches,
      disputedInvoiceIds,
      portalTokenByQuoteId,
      autonomyConfig,
      todayIso,
    ],
  )

  const handleStageCollectionsRun = async () => {
    if (!workspaceId || stagingCollections) return
    setStagingCollections(true)
    try {
      const res = await release4Queries.stageCollectionsRunInDb({
        workspaceId,
        invoices,
        existingTouches: collectionTouches,
        disputedInvoiceIds,
        portalTokenByQuoteId,
        config: autonomyConfig,
      })
      setCollectionTouches(res.touches)
      setLatestRunLedger(res.ledgerEntry)
      toast.success(
        'Autonomous Collections Run Staged',
        `${res.plan.staged_candidates.length} overdue cadence touch(es) staged safely (${formatExactCents(res.plan.total_staged_cents)}).`,
      )
    } catch (err) {
      toast.error(
        'Collections run failed',
        err instanceof Error ? err.message : 'Retry staging collections.',
      )
    } finally {
      setStagingCollections(false)
    }
  }

  const handleUndoCollectionsRun = async () => {
    if (!workspaceId || !latestRunLedger || undoingCollections) return
    setUndoingCollections(true)
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestRunLedger,
      })
      setLatestRunLedger(reversed)
      await loadData()
      toast.info('1-Click Undo completed', 'Collections touches reverted cleanly.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry 1-Click Undo.')
    } finally {
      setUndoingCollections(false)
    }
  }

  const handleToggleTouchPause = async (touch: CollectionTouchRecord) => {
    if (!workspaceId || busyId) return
    setBusyId(touch.id)
    try {
      const pause = touch.status === 'staged'
      const updated = await release4Queries.toggleCollectionTouchPauseInDb({
        workspaceId,
        touch,
        paused: pause,
      })
      setCollectionTouches(prev => prev.map(t => (t.id === touch.id ? updated : t)))
      if (pause) {
        setDisputedInvoiceIds(prev => (prev.includes(touch.invoice_id) ? prev : [...prev, touch.invoice_id]))
      } else {
        setDisputedInvoiceIds(prev => prev.filter(id => id !== touch.invoice_id))
      }
      toast.info(
        pause ? 'Collections paused (Disputed)' : 'Collections resumed (Staged)',
        updated.proof_summary,
      )
    } catch (err) {
      toast.error('Pause toggle failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  const filteredInvoices = useMemo(() => {
    if (filter === 'all') return invoices
    if (filter === 'open') {
      return invoices.filter(
        inv =>
          inv.status === 'draft' ||
          inv.status === 'sent' ||
          inv.status === 'partially_paid' ||
          inv.status === 'overdue',
      )
    }
    if (filter === 'overdue') {
      return invoices.filter(
        inv =>
          inv.status === 'overdue' ||
          ((inv.status === 'sent' || inv.status === 'partially_paid') && inv.due_date < todayIso),
      )
    }
    return invoices.filter(inv => inv.status === filter)
  }, [invoices, filter, todayIso])

  const paymentDrawerInvoice = useMemo(
    () => invoices.find(inv => inv.id === paymentDrawerInvoiceId) ?? null,
    [invoices, paymentDrawerInvoiceId],
  )

  const handleCopyPayLink = async (invoice: AutonomousInvoice) => {
    if (!workspaceId || busyId) return
    setBusyId(invoice.id)
    try {
      const existingUrl = invoice.stripe_payment_link_url || invoice.stripe_checkout_url
      let url = existingUrl
      let labelDetail = 'Card + ACH payment link ready.'

      if (!url) {
        const res = await createInvoicePaymentLink({
          workspaceId,
          invoiceId: invoice.id,
          paymentMode:
            invoice.amount_paid_cents === 0 && invoice.deposit_cents && invoice.deposit_cents > 0
              ? 'deposit'
              : 'balance',
        })
        url = res.url
        labelDetail = `Card + ACH link created for ${formatCents(res.amountCents)}.`
        await loadData()
      }

      try {
        await navigator.clipboard?.writeText(url)
        toast.success(`Copied Stripe Pay Link (${invoice.invoice_number})`, labelDetail)
      } catch {
        toast.info(`Stripe Pay Link (${invoice.invoice_number})`, url)
      }
    } catch (err) {
      toast.error(
        'Could not prepare Stripe Pay Link',
        err instanceof Error ? err.message : 'Ensure create-invoice-payment-link Edge Function is deployed.',
      )
    } finally {
      setBusyId(null)
    }
  }

  const handleStageNudge = async (invoice: AutonomousInvoice) => {
    if (!workspaceId || busyId) return
    setBusyId(invoice.id)
    try {
      const res = await autonomousQueries.stageCollectionNudgeInDb({
        workspaceId,
        invoice,
        config: autonomyConfig,
      })
      toast.success(
        res.ledgerEntry.status === 'executed'
          ? `Collection nudge staged for ${invoice.invoice_number}`
          : `Nudge queued in Agent Ledger for 1-Tap approval`,
        res.queuedDraft
          ? 'Consent-gated draft queued in CRM -> Comm Drafts.'
          : 'Logged cleanly in Agent Action Ledger.',
      )
      await loadData()
    } catch (err) {
      toast.error('Collection nudge failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  const handleMarkPaid = async (invoice: AutonomousInvoice) => {
    if (!workspaceId || busyId) return
    setBusyId(invoice.id)
    try {
      await autonomousQueries.markInvoicePaidInDb({ workspaceId, invoice })
      toast.success(`Invoice ${invoice.invoice_number} marked paid`, formatCents(invoice.total_cents))
      await loadData()
    } catch (err) {
      toast.error('Payment update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  if (!workspaceId) return <div />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Invoices &amp; Accounts Receivable</h2>
          <p className="text-xs text-slate-600">
            Track issued invoices, collected balances, overdue AR, and 1-click collection nudges in integer cents.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh AR
        </button>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="exec-surface p-4">
          <p className="text-xs font-medium text-slate-500">Total Billed</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-950 tabular-nums">
            {formatCents(summary.totalBilledCents)}
          </p>
        </div>
        <div className="exec-surface p-4">
          <p className="text-xs font-medium text-slate-500">Collected ({summary.paidCount})</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-700 tabular-nums">
            {formatCents(summary.totalCollectedCents)}
          </p>
        </div>
        <div className="exec-surface p-4">
          <p className="text-xs font-medium text-slate-500">Overdue AR ({summary.overdueCount})</p>
          <p className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">
            {formatCents(summary.overdueArCents)}
          </p>
        </div>
      </div>

      {/* Filter & Invoice Ledger */}
      <div className="exec-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Invoice status filter">
            {(['all', 'open', 'partially_paid', 'overdue', 'paid', 'void'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={filter === tab}
                onClick={() => setFilter(tab)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  filter === tab
                    ? 'bg-[#c2410c] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.replace('_', ' ')}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-500 tabular-nums">
            Open AR Balance: <strong className="text-slate-900">{formatCents(summary.openArCents)}</strong>
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ReceiptText className="h-5 w-5" />}
              title="No invoices match this filter"
              description="Signed quotes convert into invoices automatically under your Autonomy Dial rules."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {filteredInvoices.map(inv => {
              const balanceCents = computeInvoiceBalanceDueCents(inv)
              const isOverdue =
                inv.status === 'overdue' ||
                ((inv.status === 'sent' || inv.status === 'partially_paid') && inv.due_date < todayIso)
              const canCollect = inv.status !== 'paid' && inv.status !== 'void'

              return (
                <li key={inv.id} className="p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-600">
                        {inv.invoice_number}
                      </span>
                      <Badge
                        tone={
                          inv.status === 'paid'
                            ? 'emerald'
                            : isOverdue
                              ? 'rose'
                              : inv.status === 'partially_paid'
                                ? 'amber'
                                : inv.status === 'void'
                                  ? 'neutral'
                                  : 'brand'
                        }
                      >
                        {inv.status === 'partially_paid'
                          ? 'partially paid'
                          : isOverdue && inv.status !== 'overdue'
                            ? 'overdue'
                            : inv.status}
                      </Badge>
                      {inv.deposit_cents && inv.deposit_cents > 0 ? (
                        <Badge tone="neutral">
                          Deposit Req: {formatCents(inv.deposit_cents)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm font-bold text-slate-900">{inv.title}</p>
                    <p className="text-xs text-slate-600">
                      {inv.customer_name} · Due {inv.due_date}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="text-left sm:text-right tabular-nums mr-2">
                      <p className="text-base font-extrabold text-slate-950">
                        {formatCents(inv.total_cents)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Balance Due: {formatCents(balanceCents)}
                      </p>
                    </div>

                    {canCollect ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === inv.id}
                          onClick={() => void handleCopyPayLink(inv)}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <Link2 className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                          {inv.stripe_payment_link_url || inv.stripe_checkout_url
                            ? 'Copy Pay Link'
                            : 'Copy / Send Pay Link'}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === inv.id}
                          onClick={() => setPaymentDrawerInvoiceId(inv.id)}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <CreditCard className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                          Record Payment
                        </button>
                        <button
                          type="button"
                          disabled={busyId === inv.id}
                          onClick={() => void handleStageNudge(inv)}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <Mail className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                          Stage Collection Nudge
                        </button>
                        <button
                          type="button"
                          disabled={busyId === inv.id}
                          onClick={() => void handleMarkPaid(inv)}
                          className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Mark Paid
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Autonomous Collections Engine Panel */}
      <section className="exec-surface p-5 sm:p-6 space-y-4 text-slate-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-slate-50">
                Autonomous Collections Engine (Day 3 / Day 10 Split / Day 21 Escalation)
              </h3>
              <Badge tone="brand">
                Autonomy: {autonomyConfig.autonomy_rules.send_invoice_reminder}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              Auto-pauses immediately on paid or disputed invoices and logs reversible runs to Agent Action Ledger (no live customer emails sent).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {latestRunLedger && latestRunLedger.status === 'executed' ? (
              <button
                type="button"
                disabled={undoingCollections}
                onClick={() => void handleUndoCollectionsRun()}
                className="exec-btn-secondary !px-3 !py-2 !text-xs border-amber-500/40 text-amber-300 touch-target"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {undoingCollections ? 'Reversing…' : '1-Click Undo Run'}
              </button>
            ) : null}

            <button
              type="button"
              disabled={loading || stagingCollections}
              onClick={() => void handleStageCollectionsRun()}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {stagingCollections ? 'Staging Run…' : 'Stage Collections Run'}
            </button>
          </div>
        </div>

        {collectionsPlan ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs tabular-nums">
            <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-3">
              <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                Day 3+ Friendly Nudge
              </p>
              <p className="mt-1 text-lg font-bold text-white">
                {collectionsPlan.stage_counts.day_3_nudge} invoice(s)
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-3">
              <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                Day 10+ 2-Part Split Offer
              </p>
              <p className="mt-1 text-lg font-bold text-[#fb923c]">
                {collectionsPlan.stage_counts.day_10_split_offer} invoice(s)
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-3">
              <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                Day 21+ Owner Escalation
              </p>
              <p className="mt-1 text-lg font-bold text-rose-300">
                {collectionsPlan.stage_counts.day_21_owner_escalation} invoice(s)
              </p>
            </div>
          </div>
        ) : null}

        {collectionTouches.length > 0 ? (
          <div className="space-y-2.5">
            {collectionTouches.map(touch => {
              const canPauseResume =
                touch.status === 'staged' || touch.status === 'paused_disputed'
              return (
                <div
                  key={touch.id}
                  className="rounded-xl border border-slate-800 bg-[#0b1320]/90 p-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          touch.stage === 'day_21_owner_escalation'
                            ? 'rose'
                            : touch.stage === 'day_10_split_offer'
                              ? 'amber'
                              : 'brand'
                        }
                      >
                        {COLLECTION_STAGE_LABELS[touch.stage]}
                      </Badge>
                      <Badge
                        tone={
                          touch.status === 'paused_paid'
                            ? 'emerald'
                            : touch.status === 'paused_disputed' || touch.status === 'reversed'
                              ? 'neutral'
                              : 'amber'
                        }
                      >
                        {COLLECTION_STATUS_LABELS[touch.status]}
                      </Badge>
                      {touch.portal_url ? (
                        <span className="font-mono text-[11px] text-slate-300">
                          {touch.portal_url}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-200">{touch.proof_summary}</p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-sm font-bold text-white tabular-nums">
                      {formatExactCents(touch.amount_due_cents)}
                    </span>
                    {canPauseResume ? (
                      <button
                        type="button"
                        disabled={busyId === touch.id}
                        onClick={() => void handleToggleTouchPause(touch)}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
                      >
                        {touch.status === 'staged' ? (
                          <>
                            <PauseCircle className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                            Pause
                          </>
                        ) : (
                          <>
                            <PlayCircle className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                            Resume
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : collectionsPlan && collectionsPlan.candidates.length > 0 ? (
          <p className="text-xs text-slate-400">
            {collectionsPlan.staged_candidates.length} overdue invoice(s) ready to stage (
            {formatExactCents(collectionsPlan.total_staged_cents)}) and{' '}
            {collectionsPlan.paused_candidates.length} auto-paused. Click{' '}
            <strong className="text-slate-200">Stage Collections Run</strong> above.
          </p>
        ) : (
          <p className="text-xs text-slate-400">
            No overdue receivables past Day 3 threshold or all open AR is current.
          </p>
        )}
      </section>

      <Mission10CashflowPanels
        workspaceId={workspaceId}
        invoices={invoices}
        vendorBills={vendorBills}
        invoicePayments={invoicePayments}
        dunningEvents={dunningEvents}
        dunningQueue={dunningQueue}
        collectionsBotMode={collectionsBotMode}
        paymentDrawerInvoice={paymentDrawerInvoice}
        onClosePaymentDrawer={() => setPaymentDrawerInvoiceId(null)}
        onRefresh={loadData}
      />
    </div>
  )
}
