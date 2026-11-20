import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Mail, ReceiptText, RefreshCw } from 'lucide-react'
import {
  computeArSummary,
  DEFAULT_AUTONOMY_CONFIG,
  formatCents,
  type AutonomousInvoice,
  type InvoiceStatus,
  type WorkspaceAutonomyConfig,
} from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import { useSession } from '../../../state/SessionContext'
import { Badge, EmptyState, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

type ArFilter = 'all' | 'open' | InvoiceStatus

export function InvoicesArPage(): React.ReactElement {
  const { workspace } = useSession()
  const toast = useToast()

  const workspaceId = workspace?.id ?? null
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<AutonomousInvoice[]>([])
  const [autonomyConfig, setAutonomyConfig] =
    useState<WorkspaceAutonomyConfig>(DEFAULT_AUTONOMY_CONFIG)
  const [filter, setFilter] = useState<ArFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const [invRes, configRes] = await Promise.all([
        autonomousQueries.fetchInvoicesAndItems(workspaceId),
        autonomousQueries.fetchWorkspaceAutonomySettings(workspaceId),
      ])
      setInvoices(invRes.invoices)
      setAutonomyConfig(configRes)
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

  const filteredInvoices = useMemo(() => {
    if (filter === 'all') return invoices
    if (filter === 'open') {
      return invoices.filter(inv => inv.status === 'draft' || inv.status === 'sent' || inv.status === 'overdue')
    }
    if (filter === 'overdue') {
      return invoices.filter(
        inv => inv.status === 'overdue' || (inv.status === 'sent' && inv.due_date < todayIso),
      )
    }
    return invoices.filter(inv => inv.status === filter)
  }, [invoices, filter, todayIso])

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
            {(['all', 'open', 'overdue', 'paid', 'void'] as const).map(tab => (
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
                {tab}
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
              const balanceCents = Math.max(0, inv.total_cents - inv.amount_paid_cents)
              const isOverdue =
                inv.status === 'overdue' || (inv.status === 'sent' && inv.due_date < todayIso)
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
                              : inv.status === 'void'
                                ? 'neutral'
                                : 'brand'
                        }
                      >
                        {isOverdue && inv.status !== 'overdue' ? 'overdue' : inv.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{inv.title}</p>
                    <p className="text-xs text-slate-600">
                      {inv.customer_name} · Due {inv.due_date}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-left sm:text-right tabular-nums mr-2">
                      <p className="text-base font-extrabold text-slate-950">
                        {formatCents(inv.total_cents)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Balance: {formatCents(inv.status === 'paid' ? 0 : balanceCents)}
                      </p>
                    </div>

                    {canCollect ? (
                      <>
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
    </div>
  )
}
