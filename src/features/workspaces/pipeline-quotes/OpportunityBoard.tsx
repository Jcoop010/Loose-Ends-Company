import React, { useMemo, useState } from 'react'
import {
  CheckCircle2,
  DollarSign,
  FileText,
  Filter,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { customerDisplayName, formatCurrency, formatDate } from '../../../lib/format'
import { collectOpportunity } from '../../../lib/opsCommand'
import { updateLooseEndStage } from '../../../lib/queries'
import type {
  Customer,
  LooseEnd,
  LooseEndStatus,
  Opportunity,
  OpportunityStatus,
  RecoveryStage,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface OpportunityBoardProps {
  workspaceId: string
  opportunities: Opportunity[]
  looseEnds: LooseEnd[]
  customersById: ReadonlyMap<string, Customer>
  highlightedOpportunityId?: string | null
  timezone?: string | null
  onClearHighlight?: () => void
  onInspectCustomer: (customerId: string) => void
  onPrepareDraft: (params: {
    customerId: string
    opportunityId: string
    subject: string
  }) => void
  onDataChanged: () => Promise<void> | void
}

type FilterKey = 'all' | 'active' | 'contacted' | 'scheduled' | 'recovered' | 'dismissed'

const LOOSE_END_STAGE_OPTIONS: Array<{
  label: string
  status: LooseEndStatus
  stage: RecoveryStage
}> = [
  { label: 'Identified (Open)', status: 'open', stage: 'identified' },
  { label: 'Actioned (In Progress)', status: 'in_progress', stage: 'actioned' },
  { label: 'Customer Engaged', status: 'in_progress', stage: 'engaged' },
  { label: 'Converted', status: 'recovered', stage: 'converted' },
  { label: 'Dismiss', status: 'dismissed', stage: 'identified' },
]

function statusTone(status: OpportunityStatus): 'emerald' | 'amber' | 'sky' | 'neutral' {
  if (status === 'recovered' || status === 'completed') return 'emerald'
  if (status === 'scheduled' || status === 'responded') return 'sky'
  if (status === 'dismissed') return 'neutral'
  return 'amber'
}

export function OpportunityBoard({
  workspaceId,
  opportunities,
  looseEnds,
  customersById,
  highlightedOpportunityId,
  timezone,
  onClearHighlight,
  onInspectCustomer,
  onPrepareDraft,
  onDataChanged,
}: OpportunityBoardProps): React.ReactElement {
  const toast = useToast()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [collectTarget, setCollectTarget] = useState<Opportunity | null>(null)
  const [collectAmount, setCollectAmount] = useState<string>('')
  const [collecting, setCollecting] = useState(false)
  const [collectError, setCollectError] = useState<string | null>(null)
  const [updatingLooseEndId, setUpdatingLooseEndId] = useState<string | null>(null)

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter(opp => {
      if (highlightedOpportunityId && opp.id === highlightedOpportunityId) {
        return true
      }
      if (filter === 'all') return true
      if (filter === 'active') {
        return opp.status === 'open' || opp.status === 'contacted' || opp.status === 'responded'
      }
      if (filter === 'contacted') {
        return opp.status === 'contacted' || opp.status === 'responded'
      }
      if (filter === 'scheduled') return opp.status === 'scheduled'
      if (filter === 'recovered') {
        return opp.status === 'recovered' || opp.status === 'completed'
      }
      return opp.status === 'dismissed'
    })
  }, [opportunities, filter, highlightedOpportunityId])

  const openPipelineSum = useMemo(
    () =>
      opportunities
        .filter(o => o.status !== 'recovered' && o.status !== 'completed' && o.status !== 'dismissed')
        .reduce((sum, o) => sum + (Number.isFinite(o.amount) ? o.amount : 0), 0),
    [opportunities],
  )

  const recoveredSum = useMemo(
    () =>
      opportunities
        .filter(o => o.status === 'recovered')
        .reduce(
          (sum, o) => sum + (Number.isFinite(o.recovered_amount ?? o.amount) ? (o.recovered_amount ?? o.amount) : 0),
          0,
        ),
    [opportunities],
  )

  const openCollectModal = (opp: Opportunity) => {
    setCollectTarget(opp)
    setCollectAmount(String(opp.amount > 0 ? opp.amount : ''))
    setCollectError(null)
  }

  const handleConfirmCollect = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!collectTarget) return
    setCollectError(null)

    const numeric = Number(collectAmount)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setCollectError('Enter a valid collected dollar amount greater than $0.')
      return
    }

    setCollecting(true)
    try {
      const res = await collectOpportunity(collectTarget.id, numeric)
      setCollectTarget(null)
      if (res.alreadyCollected) {
        toast.info(
          'Already recorded',
          'This opportunity was already marked collected in the ledger.',
        )
      } else {
        toast.success(
          'Revenue collection recorded',
          `${formatCurrency(numeric)} atomically logged via collect_opportunity RPC.`,
        )
      }
      await onDataChanged()
    } catch (err) {
      setCollectError(
        err instanceof Error ? err.message : 'Unable to record opportunity collection.',
      )
    } finally {
      setCollecting(false)
    }
  }

  const handleLooseEndStageChange = async (looseEnd: LooseEnd, optionIndex: number) => {
    const selected = LOOSE_END_STAGE_OPTIONS[optionIndex]
    if (!selected || updatingLooseEndId) return
    setUpdatingLooseEndId(looseEnd.id)
    try {
      await updateLooseEndStage({
        workspaceId,
        looseEndId: looseEnd.id,
        status: selected.status,
        recoveryStage: selected.stage,
        lastAction: `Stage updated to ${selected.label}`,
      })
      toast.success('Loose end stage updated', selected.label)
      await onDataChanged()
    } catch (err) {
      toast.error(
        'Stage update failed',
        err instanceof Error ? err.message : 'Could not update loose end.',
      )
    } finally {
      setUpdatingLooseEndId(null)
    }
  }

  const resolveCustomerName = (opp: Opportunity): string => {
    if (opp.customers) return customerDisplayName(opp.customers)
    if (opp.customer_id) {
      const cust = customersById.get(opp.customer_id)
      if (cust) return customerDisplayName(cust)
    }
    return 'Unassigned Customer'
  }

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="exec-surface p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active Recovery Pipeline
          </span>
          <p className="mt-1.5 text-2xl font-bold text-slate-950 tabular-nums">
            {formatCurrency(openPipelineSum)}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Open, contacted, and scheduled opportunities
          </p>
        </div>

        <div className="exec-surface p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
            Owner-Confirmed Collected
          </span>
          <p className="mt-1.5 text-2xl font-bold text-emerald-800 tabular-nums">
            {formatCurrency(recoveredSum)}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Recorded atomically via <code>collect_opportunity</code>
          </p>
        </div>

        <div className="exec-surface p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Open Loose Ends Queue
          </span>
          <p className="mt-1.5 text-2xl font-bold text-slate-950 tabular-nums">
            {looseEnds.filter(le => le.status === 'open' || le.status === 'in_progress').length}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Operational follow-ups tracked by stage
          </p>
        </div>
      </div>

      {/* Highlight Banner when navigated with ?opportunity= */}
      {highlightedOpportunityId ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-xs font-medium text-sky-950">
          <span>
            Focused on linked opportunity <code>{highlightedOpportunityId.slice(0, 8)}</code>
          </span>
          {onClearHighlight ? (
            <button
              type="button"
              onClick={onClearHighlight}
              className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 touch-target"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Show All
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Opportunities Board */}
      <section aria-label="Recovery opportunities" className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Opportunities & Recovery Queue</h2>
            <p className="text-xs text-slate-600">
              Prepare consent-verified follow-up drafts or record collected payments atomically.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400 mr-1" aria-hidden="true" />
            {(
              [
                ['all', 'All'],
                ['active', 'Active'],
                ['contacted', 'Contacted'],
                ['scheduled', 'Scheduled'],
                ['recovered', 'Collected'],
                ['dismissed', 'Dismissed'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`touch-target rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  filter === key
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredOpportunities.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="No opportunities match this stage filter"
            description="Opportunities surface automatically from quotes, overdue invoices, and diagnostic visits."
          />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {filteredOpportunities.map(opp => {
              const isHighlighted = highlightedOpportunityId === opp.id
              const isCollected = opp.status === 'recovered'
              const customerName = resolveCustomerName(opp)
              return (
                <li
                  key={opp.id}
                  className={`flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between ${
                    isHighlighted ? 'bg-sky-50/70 ring-2 ring-inset ring-sky-400' : ''
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(opp.status)}>{opp.status}</Badge>
                      <span className="text-sm font-bold text-slate-900">{opp.title}</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      <strong className="text-slate-800">{customerName}</strong>
                      {opp.reason ? ` · ${opp.reason}` : ''}
                      {opp.due_at ? ` · Due ${formatDate(opp.due_at, timezone)}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="mr-1 text-sm font-extrabold text-slate-950 tabular-nums">
                      {formatCurrency(
                        isCollected ? (opp.recovered_amount ?? opp.amount) : opp.amount,
                      )}
                    </span>

                    {opp.customer_id ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (opp.customer_id) onInspectCustomer(opp.customer_id)
                        }}
                        className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                      >
                        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                        Customer 360
                      </button>
                    ) : null}

                    {!isCollected && opp.customer_id ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!opp.customer_id) return
                          onPrepareDraft({
                            customerId: opp.customer_id,
                            opportunityId: opp.id,
                            subject: `Follow-up: ${opp.title}`,
                          })
                        }}
                        className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        Draft Follow-Up
                      </button>
                    ) : null}

                    {!isCollected && opp.status !== 'dismissed' ? (
                      <button
                        type="button"
                        onClick={() => openCollectModal(opp)}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                        Collect Revenue
                      </button>
                    ) : isCollected ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Collected
                      </span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Loose Ends Stage Queue */}
      {looseEnds.length > 0 ? (
        <section aria-label="Loose ends stage tracker" className="exec-surface p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Loose Ends Stage Tracker</h3>
            <p className="text-xs text-slate-600">
              Advance operational loose ends from identified through engaged and converted.
            </p>
          </div>

          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {looseEnds.slice(0, 25).map(le => {
              const cust = le.customer_id ? customersById.get(le.customer_id) : undefined
              const label = le.customers
                ? customerDisplayName(le.customers)
                : cust
                  ? customerDisplayName(cust)
                  : 'Customer'
              return (
                <li
                  key={le.id}
                  className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          le.status === 'recovered'
                            ? 'emerald'
                            : le.status === 'dismissed'
                              ? 'neutral'
                              : 'amber'
                        }
                      >
                        {le.recovery_stage ?? le.status}
                      </Badge>
                      <span className="text-sm font-semibold text-slate-900">{le.reason}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {label}
                      {le.recommended_action ? ` · Next: ${le.recommended_action}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {le.amount > 0 ? (
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(le.amount)}
                      </span>
                    ) : null}
                    <select
                      aria-label={`Update stage for ${le.reason}`}
                      disabled={updatingLooseEndId === le.id}
                      value=""
                      onChange={e => {
                        const idx = Number(e.target.value)
                        if (Number.isInteger(idx) && idx >= 0) {
                          void handleLooseEndStageChange(le, idx)
                        }
                      }}
                      className="exec-input !w-auto !py-1.5 !text-xs"
                    >
                      <option value="" disabled>
                        Move stage…
                      </option>
                      {LOOSE_END_STAGE_OPTIONS.map((opt, idx) => (
                        <option key={opt.label} value={idx}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {/* Atomic Collect Revenue Modal */}
      <Dialog
        open={collectTarget !== null}
        onClose={() => setCollectTarget(null)}
        title="Record Collected Revenue"
        description="Executes atomic collect_opportunity RPC to mark this opportunity recovered and append an immutable recovery_events ledger entry."
      >
        {collectTarget ? (
          <form onSubmit={handleConfirmCollect} className="space-y-4">
            {collectError ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                {collectError}
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
              <p className="font-bold text-slate-900">{collectTarget.title}</p>
              <p className="text-slate-600 tabular-nums">
                Original opportunity amount: {formatCurrency(collectTarget.amount)}
              </p>
            </div>

            <div>
              <label htmlFor="collect-amount-input" className="exec-label">
                Confirmed Collected Amount ($)
              </label>
              <input
                id="collect-amount-input"
                type="number"
                required
                min="0.01"
                step="0.01"
                value={collectAmount}
                onChange={e => setCollectAmount(e.target.value)}
                className="exec-input tabular-nums"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Recorded as owner-confirmed collection (kept distinct from Stripe webhook
                settlements).
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCollectTarget(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={collecting}
                className="exec-btn-emerald touch-target"
              >
                {collecting ? 'Recording…' : 'Confirm Collection'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  )
}
