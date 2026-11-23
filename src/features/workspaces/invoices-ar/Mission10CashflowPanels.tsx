import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Edit3,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import {
  AGING_BUCKET_LABELS,
  computeArApAgingAndCashflow,
  computeInvoiceBalanceDueCents,
  DUNNING_STAGE_LABELS,
  evaluateInvoiceDunning,
  formatCents,
  type AgingBucketKey,
  type AutonomousInvoice,
  type DunningStage,
  type InvoiceDunningEventRecord,
  type InvoicePaymentMethod,
  type InvoicePaymentRecord,
  type InvoicePaymentType,
  type VendorBillRecord,
} from '../../../lib/autonomousOs'
import * as mission10Queries from '../../../lib/autonomousOs/mission10Queries'
import type { BotAutonomyMode, StagedOpsAction } from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface Mission10CashflowPanelsProps {
  workspaceId: string
  invoices: readonly AutonomousInvoice[]
  vendorBills: readonly VendorBillRecord[]
  invoicePayments: readonly InvoicePaymentRecord[]
  dunningEvents: readonly InvoiceDunningEventRecord[]
  dunningQueue: readonly StagedOpsAction[]
  collectionsBotMode: BotAutonomyMode
  startingCashCents?: number
  paymentDrawerInvoice: AutonomousInvoice | null
  onClosePaymentDrawer: () => void
  onRefresh: () => Promise<void> | void
}

const PAYMENT_TYPE_LABELS: Record<InvoicePaymentType, string> = {
  deposit: 'Deposit',
  partial: 'Partial Payment',
  final: 'Final Settlement',
  credit_memo: 'Credit Memo',
}

const PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  stripe_card: 'Stripe Card',
  stripe_ach: 'Stripe ACH',
  check: 'Check',
  cash: 'Cash',
  ach_manual: 'ACH Transfer',
  credit_memo: 'Credit Memo',
  manual: 'Manual',
}

function readStringProp(obj: Record<string, unknown> | undefined, key: string): string {
  if (!obj) return ''
  const val = obj[key]
  return typeof val === 'string' ? val : ''
}

function readNumberProp(obj: Record<string, unknown> | undefined, key: string): number {
  if (!obj) return 0
  const val = obj[key]
  return typeof val === 'number' && Number.isSafeInteger(val) ? val : 0
}

export function Mission10CashflowPanels({
  workspaceId,
  invoices,
  vendorBills,
  invoicePayments,
  dunningEvents,
  dunningQueue,
  collectionsBotMode,
  startingCashCents = 0,
  paymentDrawerInvoice,
  onClosePaymentDrawer,
  onRefresh,
}: Mission10CashflowPanelsProps): React.ReactElement {
  const toast = useToast()
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // Aging drill-down filters
  const [bucketFilter, setBucketFilter] = useState<'all' | AgingBucketKey>('all')
  const [kindFilter, setKindFilter] = useState<'all' | 'ar_invoice' | 'ap_bill'>('all')

  // Dunning evaluation & inline edit state
  const [stagingDunning, setStagingDunning] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [editingActionId, setEditingActionId] = useState<string | null>(null)
  const [editSummary, setEditSummary] = useState('')
  const [editDraftBody, setEditDraftBody] = useState('')

  // Partial payment drawer state
  const [paymentAmountDollars, setPaymentAmountDollars] = useState('')
  const [paymentType, setPaymentType] = useState<InvoicePaymentType>('partial')
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('check')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [submittingPayment, setSubmittingPayment] = useState(false)

  const snapshot = useMemo(
    () =>
      computeArApAgingAndCashflow({
        invoices,
        vendorBills,
        asOfDate: todayIso,
        startingCashCents,
      }),
    [invoices, vendorBills, todayIso, startingCashCents],
  )

  const dunningEval = useMemo(
    () =>
      evaluateInvoiceDunning({
        workspaceId,
        invoices,
        existingEvents: dunningEvents,
        botMode: collectionsBotMode,
        asOfDate: todayIso,
        lateFeeBps: 150,
      }),
    [workspaceId, invoices, dunningEvents, collectionsBotMode, todayIso],
  )

  const filteredAgingRows = useMemo(() => {
    return snapshot.rows.filter(row => {
      if (bucketFilter !== 'all' && row.bucket !== bucketFilter) return false
      if (kindFilter !== 'all' && row.kind !== kindFilter) return false
      return true
    })
  }, [snapshot.rows, bucketFilter, kindFilter])

  const pendingDunningCount = useMemo(
    () => dunningQueue.filter(item => item.status === 'pending_approval').length,
    [dunningQueue],
  )

  const drawerBalanceCents = paymentDrawerInvoice
    ? computeInvoiceBalanceDueCents(paymentDrawerInvoice)
    : 0

  const drawerPayments = useMemo(() => {
    if (!paymentDrawerInvoice) return []
    return invoicePayments.filter(p => p.invoice_id === paymentDrawerInvoice.id)
  }, [invoicePayments, paymentDrawerInvoice])

  const projection30d = snapshot.projections[2]

  const handleStageDunningDrafts = async () => {
    if (stagingDunning) return
    if (collectionsBotMode === 'observe') {
      toast.info(
        'Collections bot is in Observe mode',
        'Switch the Collections bot manual to propose or draft_and_approve to queue dunning drafts.',
      )
      return
    }
    if (dunningEval.drafts.length === 0) {
      toast.info(
        'No new dunning drafts ready',
        dunningEval.skipped_already_drafted_count > 0
          ? `${dunningEval.skipped_already_drafted_count} invoice stage(s) already drafted.`
          : 'All eligible invoices are current or already settled.',
      )
      return
    }

    setStagingDunning(true)
    try {
      let stagedCount = 0
      for (const proposal of dunningEval.drafts) {
        const res = await mission10Queries.stageInvoiceDunningAtomic({
          workspaceId,
          proposal,
        })
        if (res.status === 'drafted') {
          stagedCount += 1
        }
      }
      toast.success(
        `Staged ${stagedCount} dunning reminder draft(s)`,
        'Queued in human approval queue (no emails or SMS auto-sent).',
      )
      await onRefresh()
    } catch (err) {
      toast.error(
        'Could not stage dunning drafts',
        err instanceof Error ? err.message : 'Verify Mission 10 migration is applied.',
      )
    } finally {
      setStagingDunning(false)
    }
  }

  const handleReviewDunning = async (
    action: StagedOpsAction,
    decision: 'approved' | 'rejected',
  ) => {
    if (reviewingId) return
    setReviewingId(action.id)
    try {
      const isEditingThis = editingActionId === action.id
      await mission10Queries.reviewDunningAction({
        workspaceId,
        action,
        decision,
        editedSummary: isEditingThis ? editSummary : undefined,
        editedDraftBody: isEditingThis ? editDraftBody : undefined,
      })
      setEditingActionId(null)
      toast.success(
        decision === 'approved' ? 'Dunning Draft Approved' : 'Dunning Draft Dismissed',
        decision === 'approved'
          ? 'Marked approved for controlled outbound review.'
          : 'Reminder dismissed and recorded in invoice_dunning_events.',
      )
      await onRefresh()
    } catch (err) {
      toast.error(
        'Review update failed',
        err instanceof Error ? err.message : 'Retry updating staged reminder.',
      )
    } finally {
      setReviewingId(null)
    }
  }

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!paymentDrawerInvoice || submittingPayment) return

    const parsedDollars = Number(paymentAmountDollars)
    const amountCents = Number.isFinite(parsedDollars) ? Math.round(parsedDollars * 100) : 0
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      toast.error('Invalid payment amount', 'Enter a positive payment amount.')
      return
    }
    if (amountCents > drawerBalanceCents) {
      toast.error(
        'Overpayment blocked',
        `Payment ${formatCents(amountCents)} exceeds remaining balance due ${formatCents(drawerBalanceCents)}.`,
      )
      return
    }

    setSubmittingPayment(true)
    try {
      const resolvedType: InvoicePaymentType =
        amountCents === drawerBalanceCents && paymentType === 'partial'
          ? 'final'
          : paymentType
      await mission10Queries.recordInvoicePaymentAtomic({
        workspaceId,
        invoiceId: paymentDrawerInvoice.id,
        amountCents,
        paymentType: resolvedType,
        paymentMethod,
        notes: paymentNotes.trim() || null,
      })
      toast.success(
        `Recorded ${formatCents(amountCents)} payment`,
        amountCents === drawerBalanceCents
          ? `${paymentDrawerInvoice.invoice_number} is now paid in full.`
          : `Remaining balance updated cleanly for ${paymentDrawerInvoice.invoice_number}.`,
      )
      setPaymentAmountDollars('')
      setPaymentNotes('')
      onClosePaymentDrawer()
      await onRefresh()
    } catch (err) {
      toast.error(
        'Payment could not be recorded',
        err instanceof Error ? err.message : 'Verify Mission 10 RPC is available.',
      )
    } finally {
      setSubmittingPayment(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* AR/AP Aging & Cashflow Dashboard */}
      <section className="exec-surface p-5 sm:p-6 space-y-5 text-slate-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-50">
                AR / AP Aging &amp; Net Cashflow Forecast (Integer Cents)
              </h3>
              <Badge tone="brand">As of {snapshot.as_of_date}</Badge>
            </div>
            <p className="text-xs text-slate-400">
              Deterministic bucket aging across receivables and payables with 7 / 15 / 30-day working-capital projections.
            </p>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Open Receivables (AR)
            </p>
            <p className="mt-1 text-2xl font-extrabold text-white">
              {formatCents(snapshot.total_open_ar_cents)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Open Payables (AP)
            </p>
            <p className="mt-1 text-2xl font-extrabold text-amber-300">
              {formatCents(snapshot.total_open_ap_cents)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              30-Day Net Cashflow
            </p>
            <p
              className={`mt-1 text-2xl font-extrabold ${
                projection30d.net_cashflow_cents >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {formatCents(projection30d.net_cashflow_cents)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0b1320] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Early-Pay AP Discounts
            </p>
            <p className="mt-1 text-2xl font-extrabold text-[#fb923c]">
              {formatCents(snapshot.total_early_pay_savings_cents)}
            </p>
          </div>
        </div>

        {/* 7 / 15 / 30-Day Forecast Strip */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 tabular-nums">
          {snapshot.projections.map(win => (
            <div
              key={win.horizon_days}
              className="rounded-xl border border-slate-800 bg-[#0b1320]/90 p-3.5 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-100">{win.label}</span>
                <span className="font-mono text-[11px] text-slate-400">thru {win.window_end_date}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Expected AR Inflows</span>
                <span className="font-semibold text-emerald-300">
                  +{formatCents(win.expected_inflow_cents)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Scheduled AP Outflows</span>
                <span className="font-semibold text-rose-300">
                  -{formatCents(win.scheduled_outflow_cents)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-800 pt-1.5 text-xs font-bold">
                <span className="text-slate-200">Net Period Delta</span>
                <span className={win.net_cashflow_cents >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {formatCents(win.net_cashflow_cents)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Early-Pay Vendor Discount Alerts */}
        {snapshot.early_pay_opportunities.length > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-200">
                Early-Payment Vendor Discounts Detected
              </h4>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {snapshot.early_pay_opportunities.map(opp => (
                <div
                  key={opp.bill_id}
                  className="rounded-lg border border-slate-800 bg-[#0b1320] p-3 flex items-center justify-between gap-3 text-xs tabular-nums"
                >
                  <div>
                    <p className="font-bold text-slate-100">
                      {opp.vendor_name} · {opp.invoice_number}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Terms {opp.terms_label} · Discount deadline {opp.discount_deadline} (
                      {(opp.annualized_apr_bps / 100).toFixed(1)}% implied APR)
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge tone={opp.expired ? 'neutral' : 'emerald'}>
                      Save {formatCents(opp.discount_cents)}
                    </Badge>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Pay {formatCents(opp.net_pay_cents)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Bucket Summary & Drill-Down Filter Bar */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Aging bucket filter">
              <button
                type="button"
                role="tab"
                aria-selected={bucketFilter === 'all'}
                onClick={() => setBucketFilter('all')}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                  bucketFilter === 'all'
                    ? 'bg-[#c2410c] text-white'
                    : 'border border-slate-700 bg-[#0b1320] text-slate-300 hover:bg-slate-800'
                }`}
              >
                All Buckets
              </button>
              {snapshot.buckets.map(bucket => (
                <button
                  key={bucket.bucket}
                  type="button"
                  role="tab"
                  aria-selected={bucketFilter === bucket.bucket}
                  onClick={() => setBucketFilter(bucket.bucket)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold tabular-nums transition ${
                    bucketFilter === bucket.bucket
                      ? 'bg-[#c2410c] text-white'
                      : 'border border-slate-700 bg-[#0b1320] text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {bucket.label} ({bucket.ar_count + bucket.ap_count})
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              {(['all', 'ar_invoice', 'ap_bill'] as const).map(kind => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kind)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    kindFilter === kind
                      ? 'bg-slate-200 text-slate-950'
                      : 'border border-slate-700 bg-[#0b1320] text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {kind === 'all' ? 'AR + AP' : kind === 'ar_invoice' ? 'Receivables' : 'Payables'}
                </button>
              ))}
            </div>
          </div>

          {/* 5-Bucket Summary Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-[#0b1320] text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3.5 py-2.5">Aging Bucket</th>
                  <th className="px-3.5 py-2.5">AR Invoices</th>
                  <th className="px-3.5 py-2.5">Receivables Total</th>
                  <th className="px-3.5 py-2.5">AP Bills</th>
                  <th className="px-3.5 py-2.5">Payables Total</th>
                  <th className="px-3.5 py-2.5 text-right">Net Bucket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {snapshot.buckets.map(b => (
                  <tr
                    key={b.bucket}
                    onClick={() => setBucketFilter(b.bucket)}
                    className={`cursor-pointer transition hover:bg-slate-900/60 ${
                      bucketFilter === b.bucket ? 'bg-slate-900/90' : ''
                    }`}
                  >
                    <td className="px-3.5 py-2.5 font-semibold text-slate-100">{b.label}</td>
                    <td className="px-3.5 py-2.5 text-slate-300">{b.ar_count}</td>
                    <td className="px-3.5 py-2.5 font-semibold text-emerald-300">
                      {formatCents(b.ar_cents)}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-300">{b.ap_count}</td>
                    <td className="px-3.5 py-2.5 font-semibold text-amber-300">
                      {formatCents(b.ap_cents)}
                    </td>
                    <td
                      className={`px-3.5 py-2.5 text-right font-bold ${
                        b.net_cents >= 0 ? 'text-slate-100' : 'text-rose-300'
                      }`}
                    >
                      {formatCents(b.net_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Drill-down rows */}
          {filteredAgingRows.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {filteredAgingRows.map(row => (
                <div
                  key={`${row.kind}:${row.id}`}
                  className="rounded-lg border border-slate-800 bg-[#0b1320]/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <Badge tone={row.kind === 'ar_invoice' ? 'emerald' : 'amber'}>
                      {row.kind === 'ar_invoice' ? 'AR' : 'AP'}
                    </Badge>
                    <span className="font-mono font-bold text-slate-200">
                      {row.document_number}
                    </span>
                    <span className="font-semibold text-slate-100 truncate">
                      {row.counterparty}
                    </span>
                    <span className="text-slate-400">· Due {row.due_date}</span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <Badge tone={row.days_past_due > 30 ? 'rose' : 'neutral'}>
                      {AGING_BUCKET_LABELS[row.bucket]}
                    </Badge>
                    <span className="font-bold text-white">{formatCents(row.balance_cents)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              No open receivables or payables in this aging filter.
            </p>
          )}
        </div>
      </section>

      {/* Human-in-the-Loop Dunning Approval Queue */}
      <section className="exec-surface p-5 sm:p-6 space-y-4 text-slate-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-50">
                AR Dunning Approval Queue (Pre-Due / +3d / +14d / +30d)
              </h3>
              <Badge tone={collectionsBotMode === 'observe' ? 'neutral' : 'brand'}>
                Bot Mode: {collectionsBotMode}
              </Badge>
              {pendingDunningCount > 0 ? (
                <Badge tone="amber">{pendingDunningCount} Pending Approval</Badge>
              ) : null}
            </div>
            <p className="text-xs text-slate-400">
              Evaluates unpaid and partially paid invoices deterministically, deduplicates once per stage, and requires explicit owner approval before any send.
            </p>
          </div>

          <button
            type="button"
            disabled={stagingDunning}
            onClick={() => void handleStageDunningDrafts()}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target self-start sm:self-auto"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {stagingDunning
              ? 'Staging Drafts…'
              : `Evaluate & Stage Dunning (${dunningEval.drafts.length})`}
          </button>
        </div>

        {collectionsBotMode === 'observe' ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Observe mode active:</strong> {dunningEval.eligible_count} eligible invoice(s) detected, staging blocked until bot mode is changed from <code>observe</code>.
            </span>
          </div>
        ) : null}

        {dunningQueue.length === 0 ? (
          <EmptyState
            icon={<MailIcon />}
            title="No staged dunning drafts in queue"
            description="Click Evaluate & Stage Dunning above to generate human-reviewable payment reminders for upcoming or overdue invoices."
          />
        ) : (
          <div className="space-y-3">
            {dunningQueue.map(action => {
              const stageRaw = readStringProp(action.payload, 'stage') as DunningStage
              const stageLabel =
                DUNNING_STAGE_LABELS[stageRaw] ?? stageRaw ?? 'Dunning Reminder'
              const lateFeeCents = readNumberProp(action.payload, 'late_fee_cents')
              const draftBody = readStringProp(action.payload, 'draft_body')
              const isEditing = editingActionId === action.id
              const isPending = action.status === 'pending_approval'

              return (
                <div
                  key={action.id}
                  className="rounded-xl border border-slate-800 bg-[#0b1320]/90 p-4 space-y-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">{stageLabel}</Badge>
                        <Badge
                          tone={
                            action.status === 'approved'
                              ? 'emerald'
                              : action.status === 'rejected'
                                ? 'rose'
                                : 'amber'
                          }
                        >
                          {action.status}
                        </Badge>
                        {lateFeeCents > 0 ? (
                          <Badge tone="rose">
                            Late Fee +{formatCents(lateFeeCents)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm font-bold text-slate-100">{action.title}</p>
                      <p className="text-xs text-slate-300">{action.summary}</p>
                    </div>

                    <div className="text-right tabular-nums shrink-0">
                      <p className="text-sm font-extrabold text-white">
                        {formatCents(action.amount_cents)}
                      </p>
                      <p className="text-[11px] text-slate-400">No auto-send</p>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      <input
                        aria-label="Edit dunning summary"
                        value={editSummary}
                        onChange={e => setEditSummary(e.target.value)}
                        className="exec-input text-xs"
                      />
                      <textarea
                        aria-label="Edit dunning message body"
                        rows={4}
                        value={editDraftBody}
                        onChange={e => setEditDraftBody(e.target.value)}
                        className="exec-input text-xs font-mono"
                      />
                    </div>
                  ) : draftBody ? (
                    <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#070d17] p-3 text-[11px] text-slate-300 font-sans">
                      {draftBody}
                    </pre>
                  ) : null}

                  {isPending ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingActionId(null)
                          } else {
                            setEditingActionId(action.id)
                            setEditSummary(action.summary)
                            setEditDraftBody(draftBody)
                          }
                        }}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        {isEditing ? 'Cancel Edit' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        disabled={reviewingId === action.id}
                        onClick={() => void handleReviewDunning(action, 'rejected')}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-rose-500/40 text-rose-300"
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={reviewingId === action.id}
                        onClick={() => void handleReviewDunning(action, 'approved')}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve Draft
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Partial Payment & Deposit Drawer */}
      <Dialog
        open={Boolean(paymentDrawerInvoice)}
        onClose={onClosePaymentDrawer}
        variant="drawer"
        title={
          paymentDrawerInvoice
            ? `Payments & Deposit · ${paymentDrawerInvoice.invoice_number}`
            : 'Invoice Payments'
        }
        description={
          paymentDrawerInvoice
            ? `${paymentDrawerInvoice.customer_name} · ${paymentDrawerInvoice.title}`
            : undefined
        }
      >
        {paymentDrawerInvoice ? (
          <div className="space-y-5 text-slate-100">
            <div className="grid grid-cols-3 gap-2.5 tabular-nums text-center">
              <div className="rounded-lg border border-slate-800 bg-[#0b1320] p-2.5">
                <p className="text-[10px] uppercase text-slate-400">Total</p>
                <p className="text-sm font-bold text-white">
                  {formatCents(paymentDrawerInvoice.total_cents)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0b1320] p-2.5">
                <p className="text-[10px] uppercase text-slate-400">Paid</p>
                <p className="text-sm font-bold text-emerald-300">
                  {formatCents(paymentDrawerInvoice.amount_paid_cents)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0b1320] p-2.5">
                <p className="text-[10px] uppercase text-slate-400">Balance Due</p>
                <p className="text-sm font-bold text-[#fb923c]">
                  {formatCents(drawerBalanceCents)}
                </p>
              </div>
            </div>

            {drawerBalanceCents > 0 ? (
              <form onSubmit={handleRecordPayment} className="space-y-3 rounded-xl border border-slate-800 bg-[#0b1320] p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
                  Record Partial Payment / Deposit
                </h4>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="m10-pay-amount" className="exec-label">
                      Amount (USD)
                    </label>
                    <input
                      id="m10-pay-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={paymentAmountDollars}
                      onChange={e => setPaymentAmountDollars(e.target.value)}
                      placeholder={(drawerBalanceCents / 100).toFixed(2)}
                      className="exec-input text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="m10-pay-type" className="exec-label">
                      Payment Type
                    </label>
                    <select
                      id="m10-pay-type"
                      value={paymentType}
                      onChange={e => setPaymentType(e.target.value as InvoicePaymentType)}
                      className="exec-input text-xs"
                    >
                      <option value="deposit">Deposit</option>
                      <option value="partial">Partial Payment</option>
                      <option value="final">Final Payment</option>
                      <option value="credit_memo">Credit Memo</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="m10-pay-method" className="exec-label">
                      Method
                    </label>
                    <select
                      id="m10-pay-method"
                      value={paymentMethod}
                      onChange={e => setPaymentMethod(e.target.value as InvoicePaymentMethod)}
                      className="exec-input text-xs"
                    >
                      <option value="check">Check</option>
                      <option value="cash">Cash</option>
                      <option value="ach_manual">ACH Transfer (Manual)</option>
                      <option value="credit_memo">Credit Memo</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="m10-pay-notes" className="exec-label">
                      Reference / Notes
                    </label>
                    <input
                      id="m10-pay-notes"
                      value={paymentNotes}
                      onChange={e => setPaymentNotes(e.target.value)}
                      placeholder="Check #1042 or ACH ref"
                      className="exec-input text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  {paymentDrawerInvoice.deposit_cents && paymentDrawerInvoice.deposit_cents > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentAmountDollars((paymentDrawerInvoice.deposit_cents! / 100).toFixed(2))
                        setPaymentType('deposit')
                      }}
                      className="text-[11px] font-semibold text-[#fb923c] hover:underline"
                    >
                      Fill Required Deposit ({formatCents(paymentDrawerInvoice.deposit_cents)})
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentAmountDollars((drawerBalanceCents / 100).toFixed(2))
                        setPaymentType('final')
                      }}
                      className="text-[11px] font-semibold text-[#fb923c] hover:underline"
                    >
                      Fill Full Balance ({formatCents(drawerBalanceCents)})
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={submittingPayment}
                    className="exec-btn-emerald !px-3.5 !py-1.5 !text-xs"
                  >
                    <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                    {submittingPayment ? 'Recording…' : 'Record Payment'}
                  </button>
                </div>
              </form>
            ) : null}

            {/* Payment Ledger */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Payment History ({drawerPayments.length})
              </h4>
              {drawerPayments.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No payments recorded on {paymentDrawerInvoice.invoice_number} yet.
                </p>
              ) : (
                <ul className="space-y-2 tabular-nums">
                  {drawerPayments.map(p => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-slate-800 bg-[#0b1320] px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={p.stripe_payment_intent_id ? 'emerald' : 'brand'}>
                            {PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}
                          </Badge>
                          <span className="font-semibold text-slate-200">
                            {PAYMENT_TYPE_LABELS[p.payment_type] ?? p.payment_type}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {p.recorded_at.slice(0, 10)}
                          {p.stripe_payment_intent_id ? ` · ${p.stripe_payment_intent_id}` : ''}
                          {p.notes ? ` · ${p.notes}` : ''}
                        </p>
                      </div>
                      <span className="font-bold text-emerald-300">
                        +{formatCents(p.amount_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

function MailIcon(): React.ReactElement {
  return <CalendarClock className="h-5 w-5" aria-hidden="true" />
}
