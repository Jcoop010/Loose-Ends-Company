import React, { useMemo, useState } from 'react'
import { formatCurrency } from '../../lib/format'
import { Dialog } from '../../components/ui/Dialog'
import { Badge } from '../../components/ui/MetricCard'

const WORKSPACE_MONTHLY_COST = 199

export function RoiAuditCalculatorModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.ReactElement {
  const [stalledQuotesCount, setStalledQuotesCount] = useState(8)
  const [avgQuoteValue, setAvgQuoteValue] = useState(2800)
  const [quoteCloseLiftPct, setQuoteCloseLiftPct] = useState(10)

  const [overdueInvoiceBalance, setOverdueInvoiceBalance] = useState(4200)
  const [invoiceRecoveryPct, setInvoiceRecoveryPct] = useState(20)

  const [unbilledJobsCount, setUnbilledJobsCount] = useState(2)
  const [avgJobTicket, setAvgJobTicket] = useState(490)

  const math = useMemo(() => {
    const safeQuotes = Math.max(0, Math.min(500, stalledQuotesCount))
    const safeQuoteVal = Math.max(0, Math.min(250_000, avgQuoteValue))
    const safeQuoteLift = Math.max(0, Math.min(25, quoteCloseLiftPct)) / 100

    const safeOverdue = Math.max(0, Math.min(1_000_000, overdueInvoiceBalance))
    const safeInvPct = Math.max(0, Math.min(40, invoiceRecoveryPct)) / 100

    const safeUnbilledJobs = Math.max(0, Math.min(200, unbilledJobsCount))
    const safeTicket = Math.max(0, Math.min(100_000, avgJobTicket))

    const quoteRecovery = Math.round(safeQuotes * safeQuoteVal * safeQuoteLift)
    const invoiceRecovery = Math.round(safeOverdue * safeInvPct)
    const unbilledRecovery = Math.round(safeUnbilledJobs * safeTicket)
    const totalMonthly = quoteRecovery + invoiceRecovery + unbilledRecovery
    const netAfterSubscription = totalMonthly - WORKSPACE_MONTHLY_COST

    return {
      quoteRecovery,
      invoiceRecovery,
      unbilledRecovery,
      totalMonthly,
      netAfterSubscription,
    }
  }, [
    stalledQuotesCount,
    avgQuoteValue,
    quoteCloseLiftPct,
    overdueInvoiceBalance,
    invoiceRecoveryPct,
    unbilledJobsCount,
    avgJobTicket,
  ])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Conservative Monthly Leak Sizing Calculator"
      description="Transparent arithmetic using your own shop inputs—zero hidden multipliers."
      maxWidthClass="max-w-2xl"
      footer={
        <button type="button" onClick={onClose} className="exec-btn-primary touch-target">
          Close Calculator
        </button>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* 1. Stalled Quotes */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <Badge tone="sky">1. Stalled Quotes</Badge>
            <div>
              <label htmlFor="roi-quotes-count" className="exec-label">
                Unapproved quotes / mo
              </label>
              <input
                id="roi-quotes-count"
                type="number"
                min={0}
                max={500}
                value={stalledQuotesCount}
                onChange={e => setStalledQuotesCount(Number(e.target.value) || 0)}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="roi-quote-val" className="exec-label">
                Avg quote value ($)
              </label>
              <input
                id="roi-quote-val"
                type="number"
                min={0}
                step={100}
                value={avgQuoteValue}
                onChange={e => setAvgQuoteValue(Number(e.target.value) || 0)}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="roi-quote-lift" className="exec-label">
                Follow-up win lift (max 25%): {quoteCloseLiftPct}%
              </label>
              <input
                id="roi-quote-lift"
                type="range"
                min={5}
                max={25}
                step={1}
                value={quoteCloseLiftPct}
                onChange={e => setQuoteCloseLiftPct(Number(e.target.value))}
                className="w-full accent-slate-900"
              />
            </div>
          </div>

          {/* 2. Overdue Invoices */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <Badge tone="amber">2. Past-Due Invoices</Badge>
            <div>
              <label htmlFor="roi-overdue-bal" className="exec-label">
                30+ day unpaid balance ($)
              </label>
              <input
                id="roi-overdue-bal"
                type="number"
                min={0}
                step={250}
                value={overdueInvoiceBalance}
                onChange={e => setOverdueInvoiceBalance(Number(e.target.value) || 0)}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="roi-inv-pct" className="exec-label">
                Collected via reminders (max 40%): {invoiceRecoveryPct}%
              </label>
              <input
                id="roi-inv-pct"
                type="range"
                min={5}
                max={40}
                step={5}
                value={invoiceRecoveryPct}
                onChange={e => setInvoiceRecoveryPct(Number(e.target.value))}
                className="w-full accent-slate-900"
              />
            </div>
          </div>

          {/* 3. Unbilled Completed Jobs */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <Badge tone="emerald">3. Unbilled Jobs</Badge>
            <div>
              <label htmlFor="roi-unbilled-count" className="exec-label">
                Missed invoices / mo
              </label>
              <input
                id="roi-unbilled-count"
                type="number"
                min={0}
                max={200}
                value={unbilledJobsCount}
                onChange={e => setUnbilledJobsCount(Number(e.target.value) || 0)}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="roi-job-ticket" className="exec-label">
                Avg service ticket ($)
              </label>
              <input
                id="roi-job-ticket"
                type="number"
                min={0}
                step={50}
                value={avgJobTicket}
                onChange={e => setAvgJobTicket(Number(e.target.value) || 0)}
                className="exec-input tabular-nums"
              />
            </div>
          </div>
        </div>

        {/* Transparent Formula Breakdown */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-2.5 text-xs sm:text-sm">
          <p className="font-semibold text-slate-900">Exact Formula Breakdown</p>
          <div className="flex items-center justify-between text-slate-600 tabular-nums">
            <span>
              Stalled Quotes ({stalledQuotesCount} × {formatCurrency(avgQuoteValue)} ×{' '}
              {quoteCloseLiftPct}%)
            </span>
            <span className="font-semibold text-slate-900">{formatCurrency(math.quoteRecovery)}</span>
          </div>
          <div className="flex items-center justify-between text-slate-600 tabular-nums">
            <span>
              Overdue Invoices ({formatCurrency(overdueInvoiceBalance)} × {invoiceRecoveryPct}%)
            </span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(math.invoiceRecovery)}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-600 tabular-nums">
            <span>
              Unbilled Completed Jobs ({unbilledJobsCount} × {formatCurrency(avgJobTicket)})
            </span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(math.unbilledRecovery)}
            </span>
          </div>
          <div className="border-t border-slate-200 pt-2.5 flex items-center justify-between tabular-nums">
            <span className="font-semibold text-slate-900">Estimated Monthly Recovered Cashflow</span>
            <span className="text-lg font-bold text-slate-950">
              {formatCurrency(math.totalMonthly)}/mo
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-600 tabular-nums">
            <span>Less Flat Loose Ends Workspace Plan</span>
            <span>-{formatCurrency(WORKSPACE_MONTHLY_COST)}/mo</span>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 flex items-center justify-between tabular-nums">
            <span className="font-semibold text-emerald-950">Net Monthly Impact</span>
            <span className="text-base font-extrabold text-emerald-800">
              {formatCurrency(math.netAfterSubscription)}/mo
            </span>
          </div>
          <p className="pt-1 text-[11px] text-slate-500 leading-relaxed">
            Sizing figures reflect your selected inputs and are not a guarantee of future collections.
          </p>
        </div>
      </div>
    </Dialog>
  )
}
