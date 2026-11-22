import React, { useState } from 'react'
import {
  Check,
  CreditCard,
  ExternalLink,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import {
  createBillingPortalSession,
  createSubscriptionCheckout,
} from '../../../lib/edgeFunctions'
import { formatDate } from '../../../lib/format'
import type { WorkspaceSubscription } from '../../../types/domain'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface BillingSubscriptionCardProps {
  workspaceId: string
  workspaceName: string
  isAdminOrOwner: boolean
  subscription: WorkspaceSubscription | null
  timezone?: string | null
}

const INCLUDED_FEATURES = [
  'All 5 Autonomous Business OS Workspaces (Command, CRM, Quotes & E-Sign, Invoices & AR, Autonomy)',
  'Unlimited workspace seats across your entire team ($0 per-seat tax)',
  'Deterministic Revenue & Unbilled-Job Leak Scanner',
  'Advisory-locked le_ops PostgreSQL mutations with UUID idempotency receipts',
  'Consent-gated recovery preflight & Stripe webhook-verified collections separation',
  'Resumable CSV bulk imports & QuickBooks Online synchronization',
]

export function BillingSubscriptionCard({
  workspaceId,
  workspaceName,
  isAdminOrOwner,
  subscription,
  timezone,
}: BillingSubscriptionCardProps): React.ReactElement {
  const toast = useToast()
  const [launchingCheckout, setLaunchingCheckout] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)

  const status = subscription?.status ?? null
  const hasProviderSubscription = Boolean(subscription?.provider_subscription_id)
  const isAlreadyActive =
    hasProviderSubscription && (status === 'active' || status === 'trialing')
  const hasCustomerRecord = Boolean(subscription?.provider_customer_id)

  const handleStartSubscription = async () => {
    if (!isAdminOrOwner || isAlreadyActive || launchingCheckout) return
    setLaunchingCheckout(true)
    try {
      const { url } = await createSubscriptionCheckout(workspaceId, 'revenue_recovery')
      window.location.assign(url)
    } catch (err) {
      toast.error(
        'Checkout unavailable',
        err instanceof Error ? err.message : 'Unable to start Stripe Checkout.',
      )
      setLaunchingCheckout(false)
    }
  }

  const handleOpenBillingPortal = async () => {
    if (!isAdminOrOwner || openingPortal) return
    setOpeningPortal(true)
    try {
      const { url } = await createBillingPortalSession(workspaceId)
      window.location.assign(url)
    } catch (err) {
      toast.error(
        'Billing Portal unavailable',
        err instanceof Error ? err.message : 'Unable to open Stripe Customer Portal.',
      )
      setOpeningPortal(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Plan & Checkout / Portal Card */}
      <section
        aria-label="Workspace subscription and Stripe billing"
        className="exec-surface p-6 sm:p-8 lg:col-span-7 space-y-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-slate-800" aria-hidden="true" />
              <h2 className="text-lg font-bold text-slate-950">
                Loose Ends Single-Ledger Workspace Plan
              </h2>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">
              Billed per workspace for <strong>{workspaceName}</strong> — month-to-month, $0 setup.
            </p>
          </div>

          <Badge
            tone={
              isAlreadyActive
                ? 'emerald'
                : status === 'past_due' || status === 'unpaid'
                  ? 'rose'
                  : 'amber'
            }
          >
            {status === 'trialing' && !hasProviderSubscription
              ? 'Trial — Subscribe to Activate'
              : status
                ? `Status: ${status}`
                : 'No Active Subscription'}
          </Badge>
        </div>

        <div className="flex items-baseline gap-2 border-y border-slate-200 py-5">
          <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-950 tabular-nums">
            $199
          </span>
          <span className="text-sm font-medium text-slate-600">/ month flat per workspace</span>
        </div>

        <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700">
          {INCLUDED_FEATURES.map(feature => (
            <li key={feature} className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {!isAdminOrOwner ? (
          <div
            role="note"
            className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950"
          >
            <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              Only a workspace <strong>owner</strong> or <strong>admin</strong> can start checkout
              or manage Stripe billing settings.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {/* Block duplicate checkouts whenever an active or trialing subscription exists */}
            {!isAlreadyActive ? (
              <button
                type="button"
                disabled={launchingCheckout}
                onClick={() => void handleStartSubscription()}
                className="exec-btn-primary !px-5 !py-3 touch-target"
              >
                {launchingCheckout
                  ? 'Redirecting to Stripe Checkout…'
                  : 'Subscribe Workspace ($199/mo)'}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}

            {hasCustomerRecord ? (
              <button
                type="button"
                disabled={openingPortal}
                onClick={() => void handleOpenBillingPortal()}
                className="exec-btn-secondary !px-5 !py-3 touch-target"
              >
                {openingPortal ? 'Opening Stripe Portal…' : 'Manage Billing in Stripe Portal'}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* Subscription Metadata & Billing Safeguards */}
      <section
        aria-label="Subscription details and billing safeguards"
        className="exec-surface p-6 lg:col-span-5 space-y-4 h-fit"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-900">Billing & Webhook Safeguards</h3>
        </div>

        <dl className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <dt className="text-slate-500">Plan Key</dt>
            <dd className="font-mono font-semibold text-slate-900">
              {subscription?.plan_key ?? 'revenue_recovery'}
            </dd>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <dt className="text-slate-500">Subscription Status</dt>
            <dd className="font-semibold text-slate-900">{status ?? 'unsubscribed'}</dd>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <dt className="text-slate-500">Current Period End</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {subscription?.current_period_end
                ? formatDate(subscription.current_period_end, timezone)
                : '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <dt className="text-slate-500">Auto-Renew</dt>
            <dd className="font-semibold text-slate-900">
              {subscription?.cancel_at_period_end ? 'Cancels at period end' : 'Enabled'}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-slate-600 leading-relaxed">
          Checkout sessions verify workspace owner/admin membership on the server, prevent duplicate
          subscriptions, and redirect exclusively to verified <code>checkout.stripe.com</code> and{' '}
          <code>billing.stripe.com</code> hosts.
        </p>
      </section>
    </div>
  )
}
