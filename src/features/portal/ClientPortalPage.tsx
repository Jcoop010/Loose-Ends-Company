import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  CreditCard,
  FileSignature,
  Lock,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react'
import { formatCents, type PublicQuotePortalData } from '../../lib/autonomousOs'
import * as autonomousQueries from '../../lib/autonomousOs/queries'
import { formatDateTime } from '../../lib/format'
import { Badge } from '../../components/ui/MetricCard'

export interface ClientPortalPageProps {
  token: string
}

export function ClientPortalPage({ token }: ClientPortalPageProps): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [portal, setPortal] = useState<PublicQuotePortalData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [signing, setSigning] = useState(false)
  const [payNotice, setPayNotice] = useState<string | null>(null)

  const loadPortal = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await autonomousQueries.fetchPublicQuotePortal(token)
      if (!data) {
        setError('This quote portal link was not found or is no longer active.')
      }
      setPortal(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client portal.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadPortal()
  }, [loadPortal])

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (signerName.trim().length < 2) {
      setError('Enter your full legal name (at least 2 characters) to e-sign.')
      return
    }
    setSigning(true)
    setError(null)
    try {
      const updated = await autonomousQueries.signPublicQuotePortal(token, signerName.trim())
      setPortal(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete e-signature.')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] text-slate-900">
      <header className="border-b border-slate-200 bg-[#0b1320] text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c2410c] border border-[#fb923c]/40 font-black text-sm">
              LE
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">
                {portal?.workspace_name ?? 'Loose Ends OS'}
              </p>
              <p className="text-[11px] text-slate-400">Client Quote &amp; Invoice Portal</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-3 py-1 text-xs font-semibold text-[#fdba74]">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Verified Portal
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 space-y-6">
        {loading ? (
          <div className="exec-surface p-6 text-sm text-slate-600">Loading quote details...</div>
        ) : error && !portal ? (
          <div className="exec-surface p-6 sm:p-8 space-y-2 border-rose-200">
            <h1 className="text-lg font-bold text-slate-950">Portal Link Unavailable</h1>
            <p className="text-sm text-slate-600">{error}</p>
          </div>
        ) : portal ? (
          <>
            {error ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800"
              >
                {error}
              </div>
            ) : null}

            {/* Quote Summary Card */}
            <section className="exec-surface p-6 sm:p-8 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-600">
                      {portal.quote.quote_number}
                    </span>
                    <Badge
                      tone={
                        portal.quote.status === 'signed'
                          ? 'emerald'
                          : portal.quote.status === 'sent'
                            ? 'brand'
                            : 'amber'
                      }
                    >
                      {portal.quote.status}
                    </Badge>
                  </div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950">
                    {portal.quote.title}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Prepared for <strong>{portal.quote.customer_name}</strong>
                    {portal.quote.valid_until ? ` · Valid until ${portal.quote.valid_until}` : ''}
                  </p>
                </div>

                <div className="text-left sm:text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Quote Total
                  </p>
                  <p className="text-3xl font-extrabold text-slate-950 tabular-nums">
                    {formatCents(portal.quote.total_cents)}
                  </p>
                </div>
              </div>

              {/* Itemized Breakdown */}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="py-2.5 px-3.5 font-semibold">Deliverable / Item</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Qty</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Unit Price</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {portal.items.map(item => (
                      <tr key={item.id}>
                        <td className="py-3 px-3.5 font-medium text-slate-900">
                          {item.description}
                        </td>
                        <td className="py-3 px-3.5 text-right text-slate-600 tabular-nums">
                          {item.quantity}
                        </td>
                        <td className="py-3 px-3.5 text-right text-slate-600 tabular-nums">
                          {formatCents(item.unit_price_cents)}
                        </td>
                        <td className="py-3 px-3.5 text-right font-semibold text-slate-900 tabular-nums">
                          {formatCents(item.line_total_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:items-end gap-1 text-xs sm:text-sm tabular-nums text-slate-700">
                <p>Subtotal: {formatCents(portal.quote.subtotal_cents)}</p>
                <p>
                  Tax ({(portal.quote.tax_bps / 100).toFixed(2)}%):{' '}
                  {formatCents(portal.quote.tax_cents)}
                </p>
                <p className="text-base font-bold text-slate-950">
                  Total: {formatCents(portal.quote.total_cents)}
                </p>
              </div>

              {portal.quote.notes ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <strong>Notes:</strong> {portal.quote.notes}
                </div>
              ) : null}

              {/* Signature Area */}
              {portal.quote.status === 'signed' ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 mt-0.5" aria-hidden="true" />
                  <div className="text-xs sm:text-sm text-emerald-950">
                    <p className="font-bold">
                      Quote approved &amp; electronically signed by {portal.quote.signed_by_name}
                    </p>
                    {portal.quote.signed_at ? (
                      <p className="text-xs text-emerald-800 mt-0.5">
                        Recorded at {formatDateTime(portal.quote.signed_at)}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : portal.quote.status === 'declined' || portal.quote.status === 'expired' ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
                  This quote is {portal.quote.status} and can no longer be signed.
                </div>
              ) : (
                <form
                  onSubmit={handleSign}
                  className="rounded-2xl border-2 border-[#ea580c] bg-[#fff7ed] p-5 space-y-3"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-[#9a3412]">
                    <FileSignature className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
                    Approve &amp; Electronically Sign Quote
                  </div>
                  <p className="text-xs text-slate-700">
                    Type your full name below to accept scope and authorize invoicing.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      aria-label="Full legal name to sign"
                      required
                      minLength={2}
                      value={signerName}
                      onChange={e => setSignerName(e.target.value)}
                      placeholder="Jordan Taylor (Managing Partner)"
                      className="exec-input flex-1 text-sm bg-white"
                    />
                    <button
                      type="submit"
                      disabled={signing}
                      className="exec-btn-primary whitespace-nowrap touch-target"
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {signing ? 'Signing...' : 'Sign & Approve Quote'}
                    </button>
                  </div>
                </form>
              )}
            </section>

            {/* Resulting Invoice & Payment Section */}
            {portal.invoice ? (
              <section className="exec-surface p-6 sm:p-8 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ReceiptText className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
                      <span className="font-mono text-xs font-bold text-slate-600">
                        {portal.invoice.invoice_number}
                      </span>
                      <Badge tone={portal.invoice.status === 'paid' ? 'emerald' : 'brand'}>
                        {portal.invoice.status}
                      </Badge>
                    </div>
                    <h2 className="mt-1 text-lg font-bold text-slate-950">
                      Issued Invoice · Due {portal.invoice.due_date}
                    </h2>
                  </div>

                  <div className="text-right tabular-nums">
                    <p className="text-xs text-slate-500">Balance Due</p>
                    <p className="text-2xl font-extrabold text-slate-950">
                      {formatCents(
                        Math.max(
                          0,
                          portal.invoice.total_cents - portal.invoice.amount_paid_cents,
                        ),
                      )}
                    </p>
                  </div>
                </div>

                {portal.invoice.status === 'paid' ? (
                  <p className="text-xs font-semibold text-emerald-700">
                    Paid in full. Thank you for your business.
                  </p>
                ) : portal.invoice.stripe_checkout_url ? (
                  <a
                    href={portal.invoice.stripe_checkout_url}
                    target="_blank"
                    rel="noreferrer"
                    className="exec-btn-primary touch-target"
                  >
                    <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Pay Invoice Securely ({formatCents(portal.invoice.total_cents - portal.invoice.amount_paid_cents)})
                  </a>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPayNotice(
                          `Invoice ${portal.invoice?.invoice_number} is issued for ${formatCents(
                            portal.invoice
                              ? portal.invoice.total_cents - portal.invoice.amount_paid_cents
                              : 0,
                          )}. Contact ${portal.workspace_name} if a Stripe payment link has not been attached yet.`,
                        )
                      }
                      className="exec-btn-primary touch-target"
                    >
                      <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Pay Invoice ({formatCents(portal.invoice.total_cents - portal.invoice.amount_paid_cents)})
                    </button>
                    {payNotice ? (
                      <p className="text-xs text-slate-600">{payNotice}</p>
                    ) : null}
                  </div>
                )}
              </section>
            ) : portal.quote.status === 'signed' ? (
              <section className="exec-surface p-5 text-xs text-slate-600">
                Signature recorded. Your invoice is queued for owner confirmation under workspace autonomy rules.
              </section>
            ) : null}
          </>
        ) : null}
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-8 pt-2 sm:px-6 flex justify-center">
        <a
          href="https://www.looseendsos.app/demo"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-[#0b1320] px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#fb923c] hover:text-white transition"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-[#fb923c]" aria-hidden="true" />
          Powered by Loose Ends OS
        </a>
      </footer>
    </div>
  )
}
