import React, { useRef, useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  EyeOff,
  FileCheck2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Lock,
  Radar,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import {
  AUTONOMY_ACTION_META,
  evaluateComplianceDeadlines,
  formatCents as formatExactCents,
  SHADOW_CATEGORY_LABELS,
  SHADOW_SOURCE_LABELS,
  WORKSPACE_MODULE_META,
  type AutonomyMode,
  type ShadowFindingCategory,
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
  const shadowFileInputRef = useRef<HTMLInputElement | null>(null)
  const [signerName, setSignerName] = useState('Jordan Taylor (Managing Partner)')
  const [shadowCategoryFilter, setShadowCategoryFilter] = useState<'all' | ShadowFindingCategory>(
    'all',
  )

  const quotes = demo.state.osQuotes
  const invoices = demo.state.osInvoices
  const ledger = demo.state.osAgentLedger
  const config = demo.state.osAutonomyConfig
  const threeWaySim = demo.state.osThreeWaySimulation
  const complianceEval = evaluateComplianceDeadlines(demo.state.osComplianceItems)
  const livingSops = demo.state.osLivingSops
  const shadowSession = demo.state.osShadowSession
  const shadowFindings = demo.state.osShadowFindings
  const shadowPromotionLedgerId = demo.state.osShadowPromotionLedgerId
  const visibleShadowFindings = shadowFindings.filter(item =>
    shadowCategoryFilter === 'all' ? true : item.category === shadowCategoryFilter,
  )

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

      {/* Release 2: Air-Gapped Short-Shipment 3-Way Match Sandbox */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
              <h4 className="text-sm font-bold text-slate-900">
                Procurement 3-Way Match Sandbox (PO vs. Goods Receipt vs. Vendor Bill)
              </h4>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              Test PO 100 units @ $42.00 ($4,200.00), GRN 80 received ($3,360.00 payable), and Bill 100 @ $46.00 ($4,600.00) to catch the exact <strong>$1,240.00</strong> variance.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const sim = demo.simulateShortShipmentThreeWayMatch()
              toast.error(
                `Caught ${formatCents(sim.match_result.match_variance_cents)} 3-Way Variance`,
                `Held ${sim.invoice_number} (${sim.po_number}) and staged citation-backed dispute.`,
              )
            }}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target shrink-0"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Simulate Short-Shipment 3-Way Match
          </button>
        </div>

        {threeWaySim ? (
          <div className="rounded-xl border border-rose-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-900">
                  {threeWaySim.po_number} -&gt; {threeWaySim.invoice_number}
                </span>
                <Badge tone="rose">{threeWaySim.match_result.match_status}</Badge>
                <Badge tone="amber">{threeWaySim.bill_status}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-rose-700 tabular-nums">
                  Variance Held: {formatCents(threeWaySim.match_result.match_variance_cents)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    demo.undoDemoLedgerAction(threeWaySim.ledger_entry_id)
                    toast.info('1-Click Undo executed', '3-Way Match simulation reversed.')
                  }}
                  className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                >
                  <RotateCcw className="h-3 w-3 text-[#ea580c]" aria-hidden="true" />
                  1-Click Undo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs tabular-nums">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold uppercase text-slate-500">1. Purchase Order</span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {threeWaySim.ordered_qty} x {formatCents(threeWaySim.po_unit_cost_cents)} ={' '}
                  {formatCents(threeWaySim.match_result.po_total_cents)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold uppercase text-slate-500">2. Goods Receipt (GRN)</span>
                <p className="font-bold text-emerald-700 mt-0.5">
                  {threeWaySim.received_qty} usable ={' '}
                  {formatCents(threeWaySim.match_result.received_payable_cents)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold uppercase text-slate-500">3. Supplier Bill</span>
                <p className="font-bold text-rose-700 mt-0.5">
                  {threeWaySim.billed_qty} x {formatCents(threeWaySim.billed_unit_cost_cents)} ={' '}
                  {formatCents(threeWaySim.match_result.billed_total_cents)}
                </p>
              </div>
            </div>

            {threeWaySim.match_result.vendor_dispute_draft ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-xs space-y-1">
                <p className="font-bold text-rose-950">
                  Pre-Staged Vendor Dispute Draft (requires_approval: true):{' '}
                  {threeWaySim.match_result.vendor_dispute_draft.subject}
                </p>
                <p className="text-rose-900 whitespace-pre-line">
                  {threeWaySim.match_result.discrepancy_summary}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Release 3: Air-Gapped Compliance Vault & Living SOPs Preview */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
              <Lock className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
              Compliance &amp; COI Vault ({complianceEval.total_docs_count})
            </span>
            <Badge tone="rose">
              {complianceEval.expiring_within_window_count} Entering Notice Window
            </Badge>
          </div>

          <ul className="space-y-2.5">
            {complianceEval.evaluated_items.map(entry => (
              <li
                key={entry.item.id}
                className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{entry.item.doc_type}</Badge>
                    <Badge
                      tone={
                        entry.item.status === 'notice_staged'
                          ? 'emerald'
                          : entry.within_notice_window
                            ? 'rose'
                            : 'neutral'
                      }
                    >
                      {entry.item.status}
                    </Badge>
                  </div>
                  <span className="text-xs font-bold text-slate-900 tabular-nums">
                    {formatCents(entry.item.annual_value_cents)}/yr
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-900">
                  {entry.item.title} · {entry.item.counterparty}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 tabular-nums">
                  <span>
                    Expires {entry.item.expires_on} ({entry.days_remaining}d left ·{' '}
                    {entry.item.notice_window_days}d notice)
                  </span>
                  {entry.item.status === 'notice_staged' ? (
                    <span className="font-semibold text-emerald-700">Notice Staged</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const res = demo.stageDemoComplianceNotice(entry.item.id)
                        if (res) {
                          toast.success(
                            'Compliance Notice staged in sandbox',
                            res.subject,
                          )
                        }
                      }}
                      className="exec-btn-primary !px-2.5 !py-1 !text-[11px]"
                    >
                      <BellRing className="h-3 w-3" aria-hidden="true" />
                      Stage Notice
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
              <FileText className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
              Living Operational SOPs ({livingSops.length})
            </span>
            <Badge tone="brand">Auto-Compiled</Badge>
          </div>

          <ul className="space-y-2.5">
            {livingSops.map(sop => (
              <li
                key={sop.id}
                className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{sop.module_key.toUpperCase()}</Badge>
                    <span className="text-xs font-bold text-slate-900">{sop.title}</span>
                  </div>
                  <Badge tone="emerald">v{sop.version}</Badge>
                </div>
                <p className="text-[11px] font-mono text-slate-500">Trigger: {sop.trigger_event}</p>
                <ol className="list-decimal pl-4 space-y-0.5 text-[11px] text-slate-700">
                  {sop.steps_json.map((step, idx) => (
                    <li key={`${sop.id}-${idx}`}>{step}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Release 4: Shadow Mode Zero-Migration Onboarding Preview */}
      <div
        id="shadow-mode-sandbox"
        className="rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                <Radar className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                Zero-Migration Shadow Mode (Read-Only CSV Leak Engine)
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Shadow Mode Active — Live Books Untouched
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              Audit QuickBooks, Zoho, Stripe, or bank CSV exports before migrating a single live ledger row.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={shadowFileInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="Upload CSV to Shadow Mode Sandbox"
              onChange={async e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                try {
                  const text = await f.text()
                  const res = demo.runDemoShadowCsv(text, f.name)
                  toast.success(
                    'Shadow scan complete',
                    `${formatExactCents(res.session.total_leak_cents)} detected across ${res.findings.length} finding(s).`,
                  )
                } catch (err) {
                  toast.error(
                    'CSV parse failed',
                    err instanceof Error ? err.message : 'Check CSV header columns.',
                  )
                }
              }}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => shadowFileInputRef.current?.click()}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => {
                const res = demo.runDemoShadowSample()
                setShadowCategoryFilter('all')
                toast.success(
                  'Sample QuickBooks Export Analyzed',
                  `${formatExactCents(res.session.total_leak_cents)} recoverable across ${res.findings.length} findings — live books untouched.`,
                )
              }}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs"
            >
              <Radar className="h-3.5 w-3.5" aria-hidden="true" />
              Try Shadow Mode (QuickBooks CSV)
            </button>
          </div>
        </div>

        {shadowSession ? (
          <div className="space-y-3 border-t border-slate-800 pt-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-800 bg-[#0e1726] p-3.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Total Recoverable Dollars ({SHADOW_SOURCE_LABELS[shadowSession.source_system]})
                </p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-2.5">
                  <span className="text-2xl font-extrabold text-white tabular-nums">
                    {formatExactCents(shadowSession.total_leak_cents)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {shadowFindings.filter(f => f.status !== 'dismissed').length} active finding(s) ·{' '}
                    {shadowSession.row_count} rows · {shadowSession.file_name}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {shadowPromotionLedgerId ? (
                  <button
                    type="button"
                    onClick={() => {
                      demo.undoDemoLedgerAction(shadowPromotionLedgerId)
                      toast.info(
                        '1-Click Undo completed',
                        'Shadow Mode session restored cleanly to pre-promotion state.',
                      )
                    }}
                    className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    1-Click Undo Promotion
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={
                    shadowSession.status === 'promoted' ||
                    shadowFindings.every(f => f.status !== 'open')
                  }
                  onClick={() => {
                    const res = demo.promoteDemoShadowSession()
                    if (res) {
                      toast.success(
                        'Promoted Clean Records to Live OS',
                        `${res.promotedCount} verified record(s) logged to Agent Ledger with 1-Click Undo.`,
                      )
                    }
                  }}
                  className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {shadowSession.status === 'promoted'
                    ? 'Promoted to Live OS'
                    : 'Promote Clean Records to Live OS'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'unbilled_quote', label: 'Unbilled Quotes' },
                  { key: 'overdue_ar', label: 'Overdue AR' },
                  { key: 'duplicate_vendor_charge', label: 'Duplicate Charges' },
                  { key: 'recurring_creep', label: 'Recurring Creep' },
                ] as const
              ).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setShadowCategoryFilter(tab.key)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                    shadowCategoryFilter === tab.key
                      ? 'border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] text-[#fdba74]'
                      : 'border-slate-700 bg-[#0e1726] text-slate-300 hover:bg-[#131f33]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {visibleShadowFindings.map(item => (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3 space-y-2 ${
                    item.status === 'dismissed'
                      ? 'border-slate-800/80 bg-[#0e1726]/50 opacity-60'
                      : 'border-slate-800 bg-[#131f33]/85'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={
                            item.category === 'unbilled_quote'
                              ? 'brand'
                              : item.category === 'overdue_ar'
                                ? 'rose'
                                : item.category === 'duplicate_vendor_charge'
                                  ? 'amber'
                                  : 'neutral'
                          }
                        >
                          {SHADOW_CATEGORY_LABELS[item.category]}
                        </Badge>
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
                      <p className="text-xs font-bold text-slate-50">{item.counterparty}</p>
                    </div>

                    <span className="text-sm font-bold text-slate-50 tabular-nums shrink-0">
                      {formatExactCents(item.amount_cents)}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-700/80 bg-[#0b1320] px-2.5 py-2 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <span>Deterministic Cent Proof</span>
                      <span className="font-mono text-[#fdba74] tabular-nums">
                        {item.amount_cents.toLocaleString('en-US')} cents
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-200 leading-snug">{item.proof_summary}</p>
                  </div>

                  {item.status === 'open' ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          demo.dismissDemoShadowFinding(item.id)
                          toast.info('Finding dismissed in Shadow Mode', item.counterparty)
                        }}
                        className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                      >
                        <EyeOff className="h-3 w-3" aria-hidden="true" />
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
