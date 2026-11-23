import React, { useRef, useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  Building2,
  CheckCircle2,
  Cpu,
  CreditCard,
  Download,
  EyeOff,
  FileCheck2,
  FilePlus2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Inbox,
  Landmark,
  Link2,
  Lock,
  PauseCircle,
  PlayCircle,
  Radar,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TrendingUp,
} from 'lucide-react'
import {
  AUTONOMY_ACTION_META,
  BANK_FEED_STATUS_LABELS,
  COLLECTION_STAGE_LABELS,
  COLLECTION_STATUS_LABELS,
  computeArApAgingAndCashflow,
  computeInvoiceBalanceDueCents,
  DUNNING_STAGE_LABELS,
  evaluateComplianceDeadlines,
  evaluateJobMarginPortfolio,
  formatCents as formatExactCents,
  FRAUD_ALERT_STATUS_LABELS,
  FRAUD_ALERT_TYPE_LABELS,
  INBOUND_BILL_STATUS_LABELS,
  JOB_MARGIN_STATUS_LABELS,
  serializeCpaPacketToCsv,
  serializeCpaPacketToJson,
  SHADOW_CATEGORY_LABELS,
  SHADOW_SOURCE_LABELS,
  SOP_ACTION_LABELS,
  SOP_COMPILER_PRESETS,
  SOP_TRIGGER_LABELS,
  WORKSPACE_MODULE_META,
  type AgingBucketKey,
  type AutonomyMode,
  type DunningStage,
  type InvoicePaymentMethod,
  type InvoicePaymentType,
  type ShadowFindingCategory,
} from '../../lib/autonomousOs'
import type { BotAutonomyMode } from '../../types/domain'
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
  const [sopPrompt, setSopPrompt] = useState(SOP_COMPILER_PRESETS[0]?.prompt ?? '')
  const [sopCapDollars, setSopCapDollars] = useState('2500')
  const [demoBucketFilter, setDemoBucketFilter] = useState<'all' | AgingBucketKey>('all')
  const [demoDepositBps, setDemoDepositBps] = useState<number>(2500)
  const [demoPayInvoiceId, setDemoPayInvoiceId] = useState<string>('00000000-0000-4000-8000-00000000i313')
  const [demoPayDollars, setDemoPayDollars] = useState<string>('300.00')
  const [demoPayType, setDemoPayType] = useState<InvoicePaymentType>('partial')
  const [demoPayMethod, setDemoPayMethod] = useState<InvoicePaymentMethod>('ach_manual')
  const [editingDunningId, setEditingDunningId] = useState<string | null>(null)
  const [editDunningSummary, setEditDunningSummary] = useState('')

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
  const cpaPacket = demo.state.osCpaPacket
  const collectionTouches = demo.state.osCollectionTouches
  const collectionsRunLedgerId = demo.state.osCollectionsRunLedgerId
  const disputedInvoiceIds = demo.state.osDisputedInvoiceIds
  const morningBrief = demo.ownerMorningBrief
  const sopSimulation = demo.state.osSopSimulation
  const sopExecutionLedgerId = demo.state.osSopExecutionLedgerId
  const executableSops = demo.state.osExecutableSops
  const fraudAlerts = demo.state.osVendorFraudAlerts
  const fraudOverrideLedgerId = demo.state.osFraudOverrideLedgerId
  const entities = demo.state.osEntities
  const activeEntityId = demo.state.osActiveEntityId
  const inboundCaptures = demo.state.osInboundBillCaptures
  const inboundBillLedgerId = demo.state.osInboundBillLedgerId
  const bankTransactions = demo.state.osBankTransactions
  const bankReconcileLedgerId = demo.state.osBankReconcileLedgerId
  const jobMargins = demo.state.osJobMargins
  const jobMarginLedgerId = demo.state.osJobMarginLedgerId
  const jobMarginPortfolio = evaluateJobMarginPortfolio(jobMargins, activeEntityId)
  const m10Snapshot = computeArApAgingAndCashflow({
    invoices,
    vendorBills: demo.state.osVendorBills,
    asOfDate: new Date().toISOString().slice(0, 10),
    startingCashCents: 2500000,
  })
  const m10OpenInvoices = invoices.filter(
    inv => inv.status !== 'paid' && inv.status !== 'void',
  )
  const m10ApprovedQuote = quotes.find(q => q.status === 'approved' || q.status === 'signed') ?? null
  const m10SelectedPayInvoice =
    m10OpenInvoices.find(inv => inv.id === demoPayInvoiceId) ?? m10OpenInvoices[0] ?? null
  const m10DunningQueue = demo.state.osDunningQueue
  const m10BotMode = demo.state.osCollectionsBotMode
  const visibleShadowFindings = shadowFindings.filter(item =>
    shadowCategoryFilter === 'all' ? true : item.category === shadowCategoryFilter,
  )

  const downloadDemoCpaFile = (content: string, mimeType: string, ext: 'csv' | 'json') => {
    if (!cpaPacket || typeof document === 'undefined') return
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ridgeway_cpa_packet_${cpaPacket.as_of_date}.${ext}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success(`Downloaded CPA ${ext.toUpperCase()} Packet`, cpaPacket.proof_summary)
  }

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

      {/* Release 4A: 1-Click CPA Tax & Audit Packet + Autonomous Collections Engine */}
      <div
        id="release-4a-sandbox"
        className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start"
      >
        {/* Card 1: 1-Click CPA Tax & Audit Packet */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <FileCheck2 className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                  1-Click CPA Tax &amp; Audit Packet
                </span>
                <Badge tone="emerald">Double-Entry Proof</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Compiles Trial Balance, P&amp;L, Balance Sheet &amp; General Ledger in exact integer cents.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                const pkt = demo.generateDemoCpaPacket()
                toast.success(
                  'CPA Audit Packet Compiled',
                  `Variance ${formatExactCents(pkt.trial_balance.variance_cents)} across ${pkt.general_ledger.length} GL lines.`,
                )
              }}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs"
            >
              <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
              Generate 1-Click CPA Packet
            </button>
          </div>

          {cpaPacket ? (
            <div className="space-y-3 border-t border-slate-800 pt-3">
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                    Debits === Credits Verified
                  </span>
                  <Badge tone="emerald">
                    Variance: {formatExactCents(cpaPacket.trial_balance.variance_cents)}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-200 leading-snug">{cpaPacket.proof_summary}</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">
                    Trial Balance Totals
                  </p>
                  <p className="mt-1 font-bold text-white">
                    {formatExactCents(cpaPacket.trial_balance.total_debits_cents)} Dr / Cr
                  </p>
                  <p className="text-[11px] text-emerald-300">
                    Variance {formatExactCents(cpaPacket.trial_balance.variance_cents)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">
                    P&amp;L · Net Income
                  </p>
                  <p className="mt-1 font-bold text-white">
                    {formatExactCents(cpaPacket.profit_and_loss.net_income_cents)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Rev {formatExactCents(cpaPacket.profit_and_loss.revenue_cents)} · Assets{' '}
                    {formatExactCents(cpaPacket.balance_sheet.total_assets_cents)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadDemoCpaFile(
                      serializeCpaPacketToJson(cpaPacket),
                      'application/json;charset=utf-8',
                      'json',
                    )
                  }
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
                >
                  <Download className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
                  Download JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadDemoCpaFile(
                      serializeCpaPacketToCsv(cpaPacket),
                      'text/csv;charset=utf-8',
                      'csv',
                    )
                  }
                  className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download CSV
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Card 2: Autonomous Collections Engine */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <ShieldCheck className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                  Autonomous Collections Engine
                </span>
                <Badge tone="brand">
                  Dial: {config.autonomy_rules.send_invoice_reminder}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Day 3 portal nudge, Day 10 2-part split, Day 21 owner escalation — auto-pauses on paid/disputed.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {collectionsRunLedgerId ? (
                <button
                  type="button"
                  onClick={() => {
                    demo.undoDemoLedgerAction(collectionsRunLedgerId)
                    toast.info('1-Click Undo Collections Run', 'Collections touches reversed cleanly.')
                  }}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  1-Click Undo Collections Run
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  const res = demo.runDemoAutonomousCollections()
                  toast.success(
                    'Autonomous Collections Run Staged',
                    `${res.plan.staged_candidates.length} staged (${formatExactCents(res.plan.total_staged_cents)}) · ${res.plan.paused_candidates.length} auto-paused.`,
                  )
                }}
                className="exec-btn-primary !px-3.5 !py-2 !text-xs"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Run Autonomous Collections
              </button>
            </div>
          </div>

          {collectionTouches.length > 0 ? (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              {collectionTouches.map(touch => {
                const inv = invoices.find(i => i.id === touch.invoice_id)
                const isDisputed = disputedInvoiceIds.includes(touch.invoice_id)
                const canToggleDispute =
                  touch.status === 'staged' || touch.status === 'paused_disputed'
                return (
                  <div
                    key={touch.id}
                    className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3 space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold text-slate-200">
                          {inv?.invoice_number ?? touch.invoice_id}
                        </span>
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
                      </div>
                      <span className="text-xs font-bold text-white tabular-nums">
                        {formatExactCents(touch.amount_due_cents)}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-snug">{touch.proof_summary}</p>

                    {canToggleDispute ? (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            demo.toggleDemoInvoiceDisputed(touch.invoice_id)
                            toast.info(
                              isDisputed ? 'Dispute cleared' : 'Auto-Paused (Disputed)',
                              inv?.invoice_number ?? touch.invoice_id,
                            )
                          }}
                          className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                        >
                          {isDisputed ? (
                            <>
                              <PlayCircle className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                              Resume Collections
                            </>
                          ) : (
                            <>
                              <PauseCircle className="h-3 w-3 text-amber-300" aria-hidden="true" />
                              Mark Disputed (Auto-Pause)
                            </>
                          )}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Release 4B: 60-Second Morning Brief, Operations Compiler & Vendor Fraud Shield */}
      <div id="release-4b-sandbox" className="space-y-5">
        {/* 60-Second Owner Morning Brief Live Strip */}
        <div className="rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <Sun className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                  60-Second Owner Morning Brief
                </span>
                <Badge tone={morningBrief.runway_status === 'healthy' ? 'emerald' : 'amber'}>
                  {morningBrief.runway_status === 'healthy'
                    ? '90d Runway Healthy'
                    : 'Buffer Alert'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-300">{morningBrief.executive_summary}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Cash Position
              </p>
              <p className="mt-1 text-base font-bold text-white tabular-nums">
                {formatExactCents(morningBrief.cash_position_cents)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Collected Yesterday
              </p>
              <p className="mt-1 text-base font-bold text-emerald-300 tabular-nums">
                {formatExactCents(morningBrief.collected_yesterday_cents)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                1-Click Approvals
              </p>
              <p className="mt-1 text-base font-bold text-[#fdba74] tabular-nums">
                {morningBrief.pending_approval_count} ({formatExactCents(morningBrief.pending_approval_total_cents)})
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                90-Day Low Balance
              </p>
              <p className="mt-1 text-base font-bold text-white tabular-nums">
                {formatExactCents(morningBrief.runway_90d_lowest_cents)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* Operations Compiler */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                    <Cpu className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                    Operations Compiler (Plain-English AST)
                  </span>
                  <Badge tone="brand">
                    {executableSops.filter(s => s.status === 'active').length} Active
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Compile natural language into a bounded rule, dry-run Proof Cards, execute, or 1-Click Undo.
                </p>
              </div>
              {sopExecutionLedgerId ? (
                <button
                  type="button"
                  onClick={() => {
                    demo.undoDemoLedgerAction(sopExecutionLedgerId)
                    toast.info('1-Click Undo SOP Run', 'Executable SOP activation reversed.')
                  }}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  1-Click Undo SOP Run
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {SOP_COMPILER_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setSopPrompt(preset.prompt)
                    setSopCapDollars(String(Math.round(preset.safety_cap_cents / 100)))
                  }}
                  className="rounded-lg border border-slate-700 bg-[#0e1726] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-[#fb923c]/50 hover:bg-[#131f33] transition"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="space-y-2.5">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Plain-English Rule Prompt
                </span>
                <textarea
                  value={sopPrompt}
                  onChange={e => setSopPrompt(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-700 bg-[#0e1726] px-3 py-2 text-xs text-slate-100 focus:border-[#fb923c] focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-end justify-between gap-2">
                <label className="space-y-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Safety Cap ($)
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={sopCapDollars}
                    onChange={e => setSopCapDollars(e.target.value)}
                    className="w-28 rounded-xl border border-slate-700 bg-[#0e1726] px-2.5 py-1.5 text-xs text-slate-100 tabular-nums"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const capDollars = Number(sopCapDollars)
                      const capCents = Number.isFinite(capDollars)
                        ? Math.max(0, Math.round(capDollars * 100))
                        : 250000
                      const sim = demo.compileAndSimulateDemoSop(sopPrompt, capCents)
                      toast.info(
                        'Compiled & Dry-Run Complete',
                        `${sim.matched_count} match(es) · ${formatExactCents(sim.total_impact_cents)}`,
                      )
                    }}
                    className="exec-btn-secondary !px-3 !py-2 !text-xs"
                  >
                    Compile &amp; Dry-Run
                  </button>
                  <button
                    type="button"
                    disabled={!sopSimulation}
                    onClick={() => {
                      const res = demo.executeDemoCompiledSop()
                      if (res) {
                        toast.success(
                          'Executable SOP Activated',
                          `${res.sop.name} recorded in Agent Action Ledger.`,
                        )
                      }
                    }}
                    className="exec-btn-primary !px-3.5 !py-2 !text-xs disabled:opacity-45"
                  >
                    <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                    Activate &amp; Execute
                  </button>
                </div>
              </div>
            </div>

            {sopSimulation ? (
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="brand">{SOP_TRIGGER_LABELS[sopSimulation.rule.trigger]}</Badge>
                      <Badge tone="neutral">{SOP_ACTION_LABELS[sopSimulation.rule.action]}</Badge>
                    </div>
                    <span className="text-xs font-bold text-[#fdba74] tabular-nums">
                      Cap: {formatExactCents(sopSimulation.rule.safety_cap_cents)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300">{sopSimulation.summary}</p>
                </div>

                {sopSimulation.proof_cards.length > 0 ? (
                  <div className="space-y-2">
                    {sopSimulation.proof_cards.map(card => (
                      <div
                        key={card.record_id}
                        className="rounded-xl border border-slate-800 bg-[#0e1726] p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white">
                            {card.record_ref} · {card.counterparty}
                          </span>
                          <Badge tone={card.within_safety_cap ? 'emerald' : 'amber'}>
                            {formatExactCents(card.impact_cents)}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug">{card.proof_summary}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Vendor Fraud Shield */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                    <ShieldAlert className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                    Vendor Fraud Shield
                  </span>
                  <Badge tone={fraudAlerts.some(a => a.status === 'frozen') ? 'rose' : 'emerald'}>
                    {fraudAlerts.filter(a => a.status === 'frozen').length} Frozen
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Auto-freezes &gt;10% price spikes, exact-cent duplicates (&lt;=7d), and unverified remit changes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {fraudOverrideLedgerId ? (
                  <button
                    type="button"
                    onClick={() => {
                      demo.undoDemoLedgerAction(fraudOverrideLedgerId)
                      toast.info('1-Click Undo Override', 'Vendor bill alert re-frozen in AP guard.')
                    }}
                    className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    1-Click Undo Override
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    const alerts = demo.runDemoVendorFraudScan()
                    toast.info(
                      'Vendor Fraud Shield Scan',
                      `${alerts.length} exception alert(s) auto-frozen before AP payout.`,
                    )
                  }}
                  className="exec-btn-primary !px-3.5 !py-2 !text-xs"
                >
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Run Vendor Fraud Shield
                </button>
              </div>
            </div>

            {fraudAlerts.length > 0 ? (
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                {fraudAlerts.map(alert => (
                  <div
                    key={alert.id}
                    className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="amber">{FRAUD_ALERT_TYPE_LABELS[alert.alert_type]}</Badge>
                        <Badge
                          tone={
                            alert.status === 'frozen'
                              ? 'rose'
                              : alert.status === 'approved_override'
                                ? 'emerald'
                                : 'neutral'
                          }
                        >
                          {FRAUD_ALERT_STATUS_LABELS[alert.status]}
                        </Badge>
                      </div>
                      <span className="text-xs font-bold text-white tabular-nums">
                        {formatExactCents(alert.variance_cents)}
                      </span>
                    </div>

                    <p className="text-[11px] font-semibold text-slate-200">{alert.vendor_name}</p>
                    <p className="text-[11px] text-slate-300 leading-snug">{alert.proof_summary}</p>

                    {alert.status === 'frozen' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            demo.overrideDemoVendorFraudAlert(alert.id, 'dismissed')
                            toast.info('Alert Dismissed', alert.vendor_name)
                          }}
                          className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                        >
                          Dismiss (Safe)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            demo.overrideDemoVendorFraudAlert(alert.id, 'approved_override')
                            toast.success('Override Approved', `${alert.vendor_name} released from freeze`)
                          }}
                          className="exec-btn-emerald !px-2.5 !py-1 !text-[11px]"
                        >
                          Approve Override
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Click <strong className="text-slate-200">Run Vendor Fraud Shield</strong> to scan pending vendor bills against PO unit costs and remit history.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Release 5: Multi-Entity Switcher, Inbox-to-Ledger, Bank Feed Auto-Reconcile & Live Job Margin Tracker */}
      <div id="release-5-sandbox" className="space-y-5">
        {/* Multi-Entity Switcher Bar */}
        <div className="rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-3 text-slate-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Multi-Entity Books Switcher
                </span>
                <Badge tone="brand">
                  {activeEntityId === 'consolidated'
                    ? 'Consolidated View'
                    : entities.find(e => e.id === activeEntityId)?.legal_name ?? 'Entity'}
                </Badge>
              </div>
              <p className="text-xs text-slate-300">
                Isolate entities in 1 click or view consolidated job margin &amp; ledger telemetry across LLCs.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => demo.switchDemoEntity('consolidated')}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  activeEntityId === 'consolidated'
                    ? 'border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] text-[#fdba74]'
                    : 'border-slate-700 bg-[#0e1726] text-slate-300 hover:bg-[#131f33]'
                }`}
              >
                Consolidated View
              </button>
              {entities.map(ent => (
                <button
                  key={ent.id}
                  type="button"
                  onClick={() => demo.switchDemoEntity(ent.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    activeEntityId === ent.id
                      ? 'border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] text-[#fdba74]'
                      : 'border-slate-700 bg-[#0e1726] text-slate-300 hover:bg-[#131f33]'
                  }`}
                >
                  {ent.legal_name} (···{ent.ein_last4})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* Card 1: Inbox-to-Ledger PDF Capture */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                    <Inbox className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                    Inbox-to-Ledger PDF Capture
                  </span>
                  <Badge tone="brand">bills@ridgeway-hvac-demo.looseendsos.app</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Parses supplier PDFs into integer cents, runs PO = GRN = Bill match, and auto-freezes spikes &gt;10%.
                </p>
              </div>
              {inboundBillLedgerId ? (
                <button
                  type="button"
                  onClick={() => {
                    demo.undoDemoLedgerAction(inboundBillLedgerId)
                    toast.info('1-Click Undo Bill Post', 'Inbound bill capture reverted from GL.')
                  }}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  1-Click Undo Bill Post
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const cap = demo.runDemoInboundBillCapture('clean')
                  toast.success(
                    'Clean 3-Way Match Verified',
                    `${cap.vendor_name} · ${formatExactCents(cap.extracted_total_cents)}`,
                  )
                }}
                className="exec-btn-primary !px-3 !py-2 !text-xs"
              >
                <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                Capture Clean PDF ($640)
              </button>
              <button
                type="button"
                onClick={() => {
                  const cap = demo.runDemoInboundBillCapture('fraud_spike')
                  toast.info(
                    'Fraud Freeze Triggered',
                    `${cap.vendor_name} (+33.3% spike frozen before AP payout)`,
                  )
                }}
                className="exec-btn-secondary !px-3 !py-2 !text-xs border-rose-500/40 text-rose-300"
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Capture +33% Spike PDF
              </button>
            </div>

            {inboundCaptures.length > 0 ? (
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                {inboundCaptures.map(cap => (
                  <div
                    key={cap.id}
                    className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        tone={
                          cap.match_status === '3way_matched' || cap.match_status === 'posted'
                            ? 'emerald'
                            : cap.match_status === 'fraud_frozen'
                              ? 'rose'
                              : 'amber'
                        }
                      >
                        {INBOUND_BILL_STATUS_LABELS[cap.match_status]}
                      </Badge>
                      <span className="text-xs font-bold text-white tabular-nums">
                        {formatExactCents(cap.extracted_total_cents)}
                      </span>
                    </div>
                    <p className="text-[11px] font-semibold text-slate-200">
                      {cap.vendor_name} · {cap.file_name}
                    </p>
                    <p className="text-[11px] text-slate-300 leading-snug">{cap.proof_summary}</p>
                    {cap.match_status === '3way_matched' ? (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const res = demo.postDemoInboundBillCapture(cap.id)
                            if (res) {
                              toast.success('Posted to AP Ledger', cap.file_name)
                            }
                          }}
                          className="exec-btn-emerald !px-2.5 !py-1 !text-[11px]"
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Post Matched to Ledger
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Card 2: Bank Feed Auto-Reconciliation */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                    <Landmark className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                    Bank Feed Auto-Reconcile
                  </span>
                  <Badge tone="emerald">Bank CSV / OFX / JSON (Sandbox)</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Matches inflows to invoices and outflows to AP bills with exact cent Proof Cards.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {bankReconcileLedgerId ? (
                  <button
                    type="button"
                    onClick={() => {
                      demo.undoDemoLedgerAction(bankReconcileLedgerId)
                      toast.info('1-Click Undo Reconcile', 'Bank feed rows restored to auto_matched.')
                    }}
                    className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    1-Click Undo Bank Recon
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    const matched = demo.runDemoBankFeedReconcile()
                    const hits = matched.filter(t => t.status === 'auto_matched').length
                    toast.success(
                      'Bank Feed Matched',
                      `${hits}/${matched.length} exact-cent matches scored at 100.0%.`,
                    )
                  }}
                  className="exec-btn-primary !px-3 !py-2 !text-xs"
                >
                  <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                  Run Bank Feed Auto-Reconcile
                </button>
              </div>
            </div>

            {bankTransactions.length > 0 ? (
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                {bankTransactions.some(tx => tx.status === 'auto_matched') ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const res = demo.reconcileDemoMatchedBankFeed()
                        if (res) {
                          toast.success(
                            'Reconciled Matched Bank Feed',
                            `${res.reconciledCount} transaction(s) locked in ledger.`,
                          )
                        }
                      }}
                      className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Reconcile Matched
                    </button>
                  </div>
                ) : null}

                {bankTransactions.map(tx => (
                  <div
                    key={tx.id}
                    className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3 space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={tx.status === 'reconciled' ? 'emerald' : 'brand'}>
                          {BANK_FEED_STATUS_LABELS[tx.status]}
                        </Badge>
                        <span className="font-mono text-[11px] text-emerald-300 tabular-nums">
                          {(tx.match_confidence_bps / 100).toFixed(1)}%
                        </span>
                      </div>
                      <span
                        className={`text-xs font-bold tabular-nums ${
                          tx.direction === 'inflow' ? 'text-emerald-300' : 'text-white'
                        }`}
                      >
                        {tx.direction === 'inflow' ? '+' : '-'}
                        {formatExactCents(tx.amount_cents)}
                      </span>
                    </div>
                    <p className="text-[11px] font-semibold text-slate-200">{tx.merchant_name}</p>
                    <p className="text-[11px] text-slate-300 leading-snug">{tx.proof_summary}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Click <strong className="text-slate-200">Run Bank Feed Auto-Reconcile</strong> to match CSV/OFX/manual JSON inflows &amp; outflows.
              </p>
            )}
          </div>
        </div>

        {/* Full Width Live Job Margin Tracker Card */}
        <div className="rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-4 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <TrendingUp className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                  Live Job Margin Tracker &amp; Change-Order Guard
                </span>
                <Badge tone={jobMarginPortfolio.warning_count > 0 ? 'amber' : 'emerald'}>
                  Weighted {(jobMarginPortfolio.weighted_margin_bps / 100).toFixed(1)}% Gross Margin
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Flags live margin drops below target in exact integer cents and drafts 1-click change orders.
              </p>
            </div>
            {jobMarginLedgerId ? (
              <button
                type="button"
                onClick={() => {
                  demo.undoDemoLedgerAction(jobMarginLedgerId)
                  toast.info('1-Click Undo Change Order', 'Quoted revenue & margin alert restored.')
                }}
                className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                1-Click Undo Change Order
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {jobMarginPortfolio.evaluated_jobs.map(item => {
              const ratioPct =
                item.job.quoted_revenue_cents > 0
                  ? Math.min(100, Math.round((item.total_cost_cents * 100) / item.job.quoted_revenue_cents))
                  : 100
              return (
                <div
                  key={item.job.id}
                  className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-white">{item.job.job_name}</p>
                      <p className="text-[11px] text-slate-400">{item.job.client_name}</p>
                    </div>
                    <Badge tone={item.computed_status === 'healthy' ? 'emerald' : 'amber'}>
                      {JOB_MARGIN_STATUS_LABELS[item.computed_status]}
                    </Badge>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${
                        item.computed_status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${ratioPct}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 tabular-nums">
                    <span>
                      Quote {formatExactCents(item.job.quoted_revenue_cents)} · Cost{' '}
                      {formatExactCents(item.total_cost_cents)} · Net{' '}
                      {formatExactCents(item.net_margin_cents)}
                    </span>
                    <span className="font-bold text-[#fdba74]">
                      {(item.actual_margin_bps / 100).toFixed(1)}% /{' '}
                      {(item.target_margin_bps / 100).toFixed(1)}% target
                    </span>
                  </div>

                  {item.suggested_change_order_cents > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800">
                      <span className="text-[11px] text-amber-200">
                        Recommended Change Order: +{formatExactCents(item.suggested_change_order_cents)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const res = demo.draftDemoJobChangeOrder(item.job.id)
                          if (res) {
                            toast.success(
                              'Change Order Applied',
                              `+${formatExactCents(item.suggested_change_order_cents)} restored margin target.`,
                            )
                          }
                        }}
                        className="exec-btn-primary !px-2.5 !py-1 !text-[11px]"
                      >
                        <FilePlus2 className="h-3 w-3" aria-hidden="true" />
                        Draft Change Order
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Mission 10: Elite AR/AP Aging, Partial Payments, Stripe Pay Links & Dunning Sandbox */}
      <div
        id="mission-10-cashflow-sandbox"
        className="rounded-xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 space-y-5 text-slate-100"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
              <h4 className="text-sm font-bold text-white">
                Elite AR/AP Cashflow Suite (Aging, Deposits, Pay Links &amp; Dunning Sandbox)
              </h4>
              <Badge tone="brand">Integer Cents · Air-Gapped</Badge>
            </div>
            <p className="text-xs text-slate-400">
              Test 5-bucket AR/AP aging, 2/10 Net 30 early-pay vendor discounts, quote-to-invoice deposits, partial payments, and Observe vs Draft &amp; Approve dunning.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            <Badge tone="emerald">
              Open AR {formatExactCents(m10Snapshot.total_open_ar_cents)}
            </Badge>
            <Badge tone="amber">
              Open AP {formatExactCents(m10Snapshot.total_open_ap_cents)}
            </Badge>
            <Badge tone="brand">
              AP Discount Savings {formatExactCents(m10Snapshot.total_early_pay_savings_cents)}
            </Badge>
          </div>
        </div>

        {/* 7 / 15 / 30-Day Projections + 5-Bucket Drilldown */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 tabular-nums">
          {m10Snapshot.projections.map(win => (
            <div
              key={win.horizon_days}
              className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-3 space-y-1 text-xs"
            >
              <div className="flex items-center justify-between font-bold text-slate-100">
                <span>{win.label}</span>
                <span className="text-[11px] font-mono text-slate-400">{win.window_end_date}</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>Inflows +{formatExactCents(win.expected_inflow_cents)}</span>
                <span>Outflows -{formatExactCents(win.scheduled_outflow_cents)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-800 pt-1 font-bold">
                <span>Projected Cash</span>
                <span className="text-emerald-300">
                  {formatExactCents(win.projected_ending_cash_cents)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
          <button
            type="button"
            onClick={() => setDemoBucketFilter('all')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
              demoBucketFilter === 'all'
                ? 'bg-[#c2410c] text-white'
                : 'border border-slate-700 bg-[#131f33] text-slate-300'
            }`}
          >
            All ({m10Snapshot.rows.length})
          </button>
          {m10Snapshot.buckets.map(b => (
            <button
              key={b.bucket}
              type="button"
              onClick={() => setDemoBucketFilter(b.bucket)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                demoBucketFilter === b.bucket
                  ? 'bg-[#c2410c] text-white'
                  : 'border border-slate-700 bg-[#131f33] text-slate-300'
              }`}
            >
              {b.label}: AR {formatExactCents(b.ar_cents)} / AP {formatExactCents(b.ap_cents)}
            </button>
          ))}
        </div>

        {m10Snapshot.early_pay_opportunities.length > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-amber-200 font-semibold">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              2/10 Net 30 Early-Pay Opportunity: Save{' '}
              {formatExactCents(m10Snapshot.total_early_pay_savings_cents)} across{' '}
              {m10Snapshot.early_pay_opportunities.filter(o => !o.expired).length} vendor bill(s)
            </span>
            <span className="text-[11px] text-amber-100 tabular-nums">
              Implied APR:{' '}
              {((m10Snapshot.early_pay_opportunities[0]?.annualized_apr_bps ?? 0) / 100).toFixed(1)}%
            </span>
          </div>
        ) : null}

        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {m10Snapshot.rows
            .filter(r => (demoBucketFilter === 'all' ? true : r.bucket === demoBucketFilter))
            .map(row => (
              <div
                key={`m10_${row.kind}_${row.id}`}
                className="rounded-lg border border-slate-800 bg-[#131f33]/70 px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums"
              >
                <span>
                  <strong className="text-slate-100">{row.document_number}</strong> ·{' '}
                  <span className="text-slate-300">{row.counterparty}</span> (Due {row.due_date})
                </span>
                <span className="font-bold text-white">{formatExactCents(row.balance_cents)}</span>
              </div>
            ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Quote-to-Invoice with Deposit + Partial Payment + Pay Link */}
          <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-4 space-y-4">
            {m10ApprovedQuote ? (
              <div className="rounded-lg border border-slate-700 bg-[#0b1320] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">
                    1-Click Quote -&gt; Invoice ({m10ApprovedQuote.quote_number} ·{' '}
                    {formatExactCents(m10ApprovedQuote.total_cents)})
                  </span>
                  <Badge tone="emerald">{m10ApprovedQuote.status}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Sandbox quote deposit requirement"
                    value={demoDepositBps}
                    onChange={e => setDemoDepositBps(Number(e.target.value) || 0)}
                    className="exec-input !w-auto !py-1 !text-xs"
                  >
                    <option value={0}>0% Deposit</option>
                    <option value={2500}>25% Deposit</option>
                    <option value={5000}>50% Deposit</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const inv = demo.convertDemoQuoteWithDeposit(
                        m10ApprovedQuote.id,
                        demoDepositBps,
                      )
                      if (inv) {
                        setDemoPayInvoiceId(inv.id)
                        toast.success(
                          `Converted ${m10ApprovedQuote.quote_number} -> ${inv.invoice_number}`,
                          `Deposit Req: ${formatExactCents(inv.deposit_cents ?? 0)}`,
                        )
                      }
                    }}
                    className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                  >
                    <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
                    Convert to Invoice
                  </button>
                </div>
              </div>
            ) : null}

            {/* Partial Payment Recorder */}
            {m10SelectedPayInvoice ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                    Partial Payment &amp; Pay Link Sandbox
                  </span>
                  <span className="text-xs font-bold text-[#fb923c] tabular-nums">
                    Balance Due:{' '}
                    {formatExactCents(computeInvoiceBalanceDueCents(m10SelectedPayInvoice))}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    aria-label="Sandbox invoice for partial payment"
                    value={m10SelectedPayInvoice.id}
                    onChange={e => setDemoPayInvoiceId(e.target.value)}
                    className="exec-input !py-1.5 !text-xs"
                  >
                    {m10OpenInvoices.map(inv => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} · {inv.customer_name} (
                        {formatExactCents(computeInvoiceBalanceDueCents(inv))} due)
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Sandbox payment amount in USD"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={demoPayDollars}
                    onChange={e => setDemoPayDollars(e.target.value)}
                    className="exec-input !py-1.5 !text-xs tabular-nums"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Sandbox payment type"
                    value={demoPayType}
                    onChange={e => setDemoPayType(e.target.value as InvoicePaymentType)}
                    className="exec-input !py-1.5 !text-xs"
                  >
                    <option value="deposit">Deposit</option>
                    <option value="partial">Partial Payment</option>
                    <option value="final">Final Payment</option>
                    <option value="credit_memo">Credit Memo</option>
                  </select>
                  <select
                    aria-label="Sandbox payment method"
                    value={demoPayMethod}
                    onChange={e => setDemoPayMethod(e.target.value as InvoicePaymentMethod)}
                    className="exec-input !py-1.5 !text-xs"
                  >
                    <option value="ach_manual">ACH Transfer</option>
                    <option value="check">Check</option>
                    <option value="cash">Cash</option>
                    <option value="credit_memo">Credit Memo</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const amountCents = Math.round((Number(demoPayDollars) || 0) * 100)
                      try {
                        const pay = demo.recordDemoPartialPayment({
                          invoiceId: m10SelectedPayInvoice.id,
                          amountCents,
                          paymentType: demoPayType,
                          paymentMethod: demoPayMethod,
                          notes: 'Sandbox partial payment entry',
                        })
                        if (pay) {
                          toast.success(
                            `Applied ${formatExactCents(pay.amount_cents)} to ${m10SelectedPayInvoice.invoice_number}`,
                            'Balance Due updated atomically.',
                          )
                        }
                      } catch (err) {
                        toast.error(
                          'Payment rejected',
                          err instanceof Error ? err.message : 'Overpayment blocked.',
                        )
                      }
                    }}
                    className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                  >
                    Record Partial Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = demo.generateDemoPayLink(m10SelectedPayInvoice.id)
                      if (url) {
                        toast.success(
                          `Sandbox Stripe Card+ACH Link Ready (${m10SelectedPayInvoice.invoice_number})`,
                          url,
                        )
                      }
                    }}
                    className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
                  >
                    <Link2 className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
                    Copy / Generate Pay Link
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Sandbox Dunning Queue */}
          <div className="rounded-xl border border-slate-800 bg-[#131f33]/85 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">
                  Human-in-the-Loop Dunning Queue
                </span>
                <select
                  aria-label="Sandbox collections bot autonomy mode"
                  value={m10BotMode}
                  onChange={e =>
                    demo.setDemoCollectionsBotMode(e.target.value as BotAutonomyMode)
                  }
                  className="exec-input !w-auto !py-1 !text-[11px]"
                >
                  <option value="observe">observe</option>
                  <option value="propose">propose</option>
                  <option value="draft_and_approve">draft_and_approve</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  const res = demo.stageDemoDunningReminders()
                  if (res.observeBlocked) {
                    toast.info(
                      'Blocked in Observe Mode',
                      'Collections bot is in observe mode — zero drafts staged.',
                    )
                  } else {
                    toast.success(
                      `Staged ${res.stagedCount} Dunning Draft(s)`,
                      'Requires owner Approve / Edit / Dismiss (zero auto-send).',
                    )
                  }
                }}
                className="exec-btn-primary !px-2.5 !py-1.5 !text-xs"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Evaluate Dunning
              </button>
            </div>

            {m10DunningQueue.length === 0 ? (
              <p className="text-xs text-slate-400">
                Click <strong>Evaluate Dunning</strong> to test Pre-Due / +3d / +14d / +30d reminder drafting (blocked when bot mode = <code>observe</code>).
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {m10DunningQueue.map(item => {
                  const stageKey =
                    typeof item.payload?.stage === 'string'
                      ? (item.payload.stage as DunningStage)
                      : 'due_plus_3d'
                  const isEditing = editingDunningId === item.id
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-slate-800 bg-[#0b1320] p-2.5 space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="brand">
                            {DUNNING_STAGE_LABELS[stageKey] ?? stageKey}
                          </Badge>
                          <Badge
                            tone={
                              item.status === 'approved'
                                ? 'emerald'
                                : item.status === 'rejected'
                                  ? 'rose'
                                  : 'amber'
                            }
                          >
                            {item.status}
                          </Badge>
                        </div>
                        <span className="font-bold text-white tabular-nums">
                          {formatExactCents(item.amount_cents)}
                        </span>
                      </div>
                      <p className="font-semibold text-slate-200">{item.title}</p>
                      {isEditing ? (
                        <input
                          aria-label="Edit sandbox dunning summary"
                          value={editDunningSummary}
                          onChange={e => setEditDunningSummary(e.target.value)}
                          className="exec-input !py-1 !text-xs"
                        />
                      ) : (
                        <p className="text-[11px] text-slate-400">{item.summary}</p>
                      )}
                      {item.status === 'pending_approval' ? (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingDunningId(null)
                              } else {
                                setEditingDunningId(item.id)
                                setEditDunningSummary(item.summary)
                              }
                            }}
                            className="exec-btn-secondary !px-2 !py-1 !text-[11px]"
                          >
                            {isEditing ? 'Cancel' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              demo.reviewDemoDunningReminder({
                                actionId: item.id,
                                decision: 'rejected',
                              })
                            }
                            className="exec-btn-secondary !px-2 !py-1 !text-[11px] text-rose-300"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              demo.reviewDemoDunningReminder({
                                actionId: item.id,
                                decision: 'approved',
                                editedSummary: isEditing ? editDunningSummary : undefined,
                              })
                              setEditingDunningId(null)
                            }}
                            className="exec-btn-emerald !px-2 !py-1 !text-[11px]"
                          >
                            Approve
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
