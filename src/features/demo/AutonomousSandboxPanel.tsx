import React, { useState } from 'react'
import {
  CheckCircle2,
  FileSignature,
  ReceiptText,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react'
import {
  AUTONOMY_ACTION_META,
  WORKSPACE_MODULE_META,
  type AutonomyMode,
} from '../../lib/autonomousOs'
import { formatCents, formatDateTime } from '../../lib/format'
import { useDemoStore } from '../../state/DemoStoreContext'
import { Badge } from '../../components/ui/MetricCard'
import { useToast } from '../../components/ui/Toast'

const DEMO_MODES: ReadonlyArray<{ mode: AutonomyMode; label: string }> = [
  { mode: 'manual', label: 'Manual' },
  { mode: 'approve_1tap', label: '1-Tap' },
  { mode: 'full_auto', label: 'Full Auto' },
]

export function AutonomousSandboxPanel(): React.ReactElement {
  const demo = useDemoStore()
  const toast = useToast()
  const [signerName, setSignerName] = useState('Jordan Taylor (Managing Partner)')

  const quotes = demo.state.osQuotes
  const invoices = demo.state.osInvoices
  const ledger = demo.state.osAgentLedger
  const config = demo.state.osAutonomyConfig

  return (
    <section
      aria-label="Autonomous Revenue-to-Cash Sandbox"
      className="exec-surface p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Autonomous Revenue-to-Cash Sandbox (Quotes -&gt; Invoices -&gt; 1-Click Undo)
            </h3>
            <Badge tone="brand">Air-Gapped Live Preview</Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            Click <strong>Simulate Client E-Sign</strong> on a quote, watch the invoice generate under your Autonomy Dial, then test <strong>1-Click Undo / Reverse</strong> in the Agent Ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
          <span>
            Billed: <strong className="text-slate-900">{formatCents(demo.arSummary.totalBilledCents)}</strong>
          </span>
          <span>
            Collected: <strong className="text-emerald-700">{formatCents(demo.arSummary.totalCollectedCents)}</strong>
          </span>
          <span>
            Overdue AR: <strong className="text-rose-700">{formatCents(demo.arSummary.overdueArCents)}</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* Left: Quotes + Invoices AR */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
                <FileSignature className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                Client Quotes &amp; E-Sign Simulation
              </span>
              <input
                aria-label="Simulated client signer name"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
                className="exec-input !w-56 !py-1 !text-xs bg-white"
              />
            </div>

            <ul className="space-y-2.5">
              {quotes.map(quote => (
                <li
                  key={quote.id}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-600">
                        {quote.quote_number}
                      </span>
                      <Badge
                        tone={
                          quote.status === 'signed'
                            ? 'emerald'
                            : quote.status === 'sent'
                              ? 'brand'
                              : 'amber'
                        }
                      >
                        {quote.status}
                      </Badge>
                    </div>
                    <span className="text-sm font-bold text-slate-950 tabular-nums">
                      {formatCents(quote.total_cents)}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm font-bold text-slate-900">
                    {quote.customer_name} — {quote.title}
                  </p>

                  {quote.status === 'signed' ? (
                    <p className="text-xs text-emerald-700 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Signed by {quote.signed_by_name} (portal /{quote.portal_token})
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const res = demo.simulateClientESign(quote.id, signerName)
                        if (res.decision === 'execute_now') {
                          toast.success(
                            `Quote signed & auto-converted to ${res.invoiceNumber}`,
                            'Logged to Agent Action Ledger with 1-Click Undo ready.',
                          )
                        } else if (res.decision === 'queue_for_approval') {
                          toast.info(
                            'Quote signed · Invoice queued for 1-Tap Approval',
                            'Approve in Agent Action Ledger or raise Full Auto Cap.',
                          )
                        } else {
                          toast.info('Quote signed', 'Manual conversion mode active.')
                        }
                      }}
                      className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                    >
                      <FileSignature className="h-3.5 w-3.5" aria-hidden="true" />
                      Simulate Client E-Sign
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
              <ReceiptText className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
              Live Sandbox Invoices &amp; AR ({invoices.length})
            </span>

            <ul className="space-y-2">
              {invoices.map(inv => (
                <li
                  key={inv.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-700">
                        {inv.invoice_number}
                      </span>
                      <Badge
                        tone={
                          inv.status === 'paid'
                            ? 'emerald'
                            : inv.status === 'overdue'
                              ? 'rose'
                              : inv.status === 'void'
                                ? 'neutral'
                                : 'brand'
                        }
                      >
                        {inv.status}
                      </Badge>
                    </div>
                    <p className="text-xs font-semibold text-slate-900 mt-0.5">
                      {inv.customer_name} · Due {inv.due_date}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-950 tabular-nums">
                      {formatCents(inv.total_cents)}
                    </span>
                    {inv.status !== 'paid' && inv.status !== 'void' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            demo.stageDemoCollectionNudge(inv.id)
                            toast.success('Collection nudge logged', inv.invoice_number)
                          }}
                          className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                        >
                          Stage Nudge
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            demo.markDemoInvoicePaid(inv.id)
                            toast.success('Invoice marked paid', inv.invoice_number)
                          }}
                          className="exec-btn-emerald !px-2.5 !py-1 !text-[11px]"
                        >
                          Paid
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right: Autonomy Dial + Module Toggles + Agent Action Ledger */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                Live Autonomy Dial
              </span>

              <div className="flex items-center gap-2">
                <label htmlFor="demo-auto-cap" className="text-[11px] font-semibold text-slate-600">
                  Auto Cap ($):
                </label>
                <input
                  id="demo-auto-cap"
                  type="number"
                  min="0"
                  step="100"
                  value={Math.round(config.auto_limit_cents / 100)}
                  onChange={e =>
                    demo.setDemoAutoLimitCents(Math.max(0, Math.round(Number(e.target.value || 0) * 100)))
                  }
                  className="exec-input w-24 !py-1 !text-xs tabular-nums bg-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              {AUTONOMY_ACTION_META.slice(0, 3).map(meta => (
                <div
                  key={meta.key}
                  className="rounded-lg border border-slate-200 bg-white p-2.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-xs font-semibold text-slate-800">{meta.label}</span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 gap-0.5">
                    {DEMO_MODES.map(m => {
                      const active = config.autonomy_rules[meta.key] === m.mode
                      return (
                        <button
                          key={m.mode}
                          type="button"
                          onClick={() => demo.setDemoAutonomyRule(meta.key, m.mode)}
                          className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                            active
                              ? 'bg-[#c2410c] text-white'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {WORKSPACE_MODULE_META.map(mod => {
                const on = config.modules_enabled[mod.key]
                return (
                  <button
                    key={mod.key}
                    type="button"
                    onClick={() => demo.toggleDemoModule(mod.key)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition ${
                      on
                        ? 'border-[#fb923c] bg-[#fff7ed] text-[#9a3412]'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    {mod.label}: {on ? 'ON' : 'OFF'}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Agent Action Ledger ({ledger.length})
              </span>
              <span className="text-[11px] text-slate-500">Every action supports 1-Click Undo</span>
            </div>

            <ul className="space-y-2">
              {ledger.map(entry => (
                <li
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        tone={
                          entry.status === 'executed'
                            ? 'emerald'
                            : entry.status === 'reversed'
                              ? 'neutral'
                              : 'amber'
                        }
                      >
                        {entry.status}
                      </Badge>
                      <span className="text-[11px] font-semibold text-slate-600">
                        {entry.autonomy_mode}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-slate-900 tabular-nums">
                      {formatCents(entry.impact_cents)}
                    </span>
                  </div>

                  <p className="text-xs font-semibold text-slate-900">{entry.summary}</p>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {formatDateTime(entry.created_at)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {entry.status === 'pending_approval' ? (
                        <button
                          type="button"
                          onClick={() => {
                            demo.approveDemoLedgerAction(entry.id)
                            toast.success('Approved & executed in sandbox', entry.summary)
                          }}
                          className="exec-btn-emerald !px-2.5 !py-1 !text-[11px]"
                        >
                          1-Tap Approve
                        </button>
                      ) : null}
                      {entry.status === 'executed' ? (
                        <button
                          type="button"
                          onClick={() => {
                            demo.undoDemoLedgerAction(entry.id)
                            toast.info('1-Click Undo executed', 'Previous quote/invoice state restored.')
                          }}
                          className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                        >
                          <RotateCcw className="h-3 w-3 text-[#ea580c]" aria-hidden="true" />
                          1-Click Undo
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
