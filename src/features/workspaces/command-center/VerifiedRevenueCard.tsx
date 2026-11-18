import React, { useEffect, useState } from 'react'
import { CheckCircle2, FileCheck2, ShieldCheck } from 'lucide-react'
import { customerDisplayName, formatCents, formatCurrency, formatDateTime } from '../../../lib/format'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import type {
  Customer,
  OpsSummary,
  VerifiedRecoveryPayment,
} from '../../../types/domain'
import { Badge, Skeleton } from '../../../components/ui/MetricCard'

export interface VerifiedRevenueCardProps {
  workspaceId: string
  summary: OpsSummary
  customersById: ReadonlyMap<string, Customer>
  timezone?: string | null
  refreshToken?: number
}

/**
 * Queries `verified_recovery_payments` alongside `ops_summary` metrics and enforces
 * strict visual and numerical separation between provider-verified Stripe/webhook
 * collections and owner-reported invoice payments.
 */
export function VerifiedRevenueCard({
  workspaceId,
  summary,
  customersById,
  timezone,
  refreshToken = 0,
}: VerifiedRevenueCardProps): React.ReactElement {
  const [payments, setPayments] = useState<VerifiedRecoveryPayment[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    void fetchAllWorkspaceRows<VerifiedRecoveryPayment>({
      table: 'verified_recovery_payments',
      workspaceId,
      orderBy: 'provider_verified_at',
      ascending: false,
      shouldAbort: () => cancelled,
    })
      .then(rows => {
        if (cancelled || rows === null) return
        setPayments(rows)
      })
      .catch(err => {
        if (cancelled) return
        setLoadError(
          err instanceof Error ? err.message : 'Unable to query verified_recovery_payments.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, refreshToken])

  const ledgerVerifiedSum =
    payments.reduce((sum, item) => sum + (Number.isFinite(item.amount_cents) ? item.amount_cents : 0), 0) /
    100
  const displayedVerifiedTotal = Math.max(summary.verified_collections, ledgerVerifiedSum)

  return (
    <section
      aria-label="Provider-verified and owner-reported revenue separation"
      className="exec-surface p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">Collections & Ledger Integrity</h2>
            <Badge tone="emerald">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Non-Commingled
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            Webhook-verified payment settlements are tracked separately from self-reported paid
            invoices.
          </p>
        </div>
      </div>

      {/* Dual Separated Ledger Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/55 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-900">
              Provider-Verified (Webhook)
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-emerald-950 tabular-nums">
            {formatCurrency(displayedVerifiedTotal)}
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            Confirmed via Stripe / payment provider settlement receipt
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Owner-Reported Paid
            </span>
            <FileCheck2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
            {formatCurrency(summary.owner_reported_paid)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Invoices marked paid manually (check, cash, or external ACH)
          </p>
        </div>
      </div>

      {/* Recent Provider-Verified Payment Receipts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-slate-500">
            Recent Verified Settlement Receipts
          </span>
          <span className="text-slate-500 tabular-nums">{payments.length} total</span>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
          >
            {loadError}
          </div>
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4 text-xs text-slate-600">
            No provider-verified webhook payments recorded yet. Settlements from Stripe invoice
            links appear here automatically once verified.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {payments.slice(0, 5).map(payment => {
              const customer = payment.customer_id
                ? customersById.get(payment.customer_id)
                : undefined
              return (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {customer ? customerDisplayName(customer) : 'Workspace Customer'} ·{' '}
                      <span className="uppercase text-slate-600">{payment.payment_provider}</span>
                    </p>
                    <p className="truncate text-[11px] text-slate-500 tabular-nums">
                      Verified {formatDateTime(payment.provider_verified_at, timezone)}
                      {payment.provider_payment_id ? ` · ${payment.provider_payment_id}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-bold text-emerald-700 tabular-nums">
                    {formatCents(payment.amount_cents, payment.currency)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
