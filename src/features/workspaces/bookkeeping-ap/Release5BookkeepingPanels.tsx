import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Inbox,
  Landmark,
  RotateCcw,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as release5Queries from '../../../lib/autonomousOs/release5Queries'
import {
  BANK_FEED_SOURCE_LABELS,
  BANK_FEED_STATUS_LABELS,
  buildWorkspaceBillCaptureAddress,
  filterByEntityId,
  formatCents as formatExactCents,
  INBOUND_BILL_STATUS_LABELS,
  SAMPLE_BANK_FEED_CSV,
  SAMPLE_INBOUND_BILL_CLEAN_TEXT,
  SAMPLE_INBOUND_BILL_SPIKE_TEXT,
  SAMPLE_PLAID_WEBHOOK_JSON,
  type AgentActionLedgerEntry,
  type AutonomousInvoice,
  type BankFeedSource,
  type BankFeedTransactionRecord,
  type InboundBillCaptureRecord,
  type VendorBillRecord,
} from '../../../lib/autonomousOs'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface Release5BookkeepingPanelsProps {
  workspaceId: string
  workspaceSlugOrName: string
  activeEntityId: string
  vendorBills: readonly VendorBillRecord[]
  allInvoices: readonly AutonomousInvoice[]
  onLedgerMutated: () => Promise<void> | void
  viewMode: 'both' | 'inbox' | 'bank'
}

export function Release5BookkeepingPanels({
  workspaceId,
  workspaceSlugOrName,
  activeEntityId,
  vendorBills,
  allInvoices,
  onLedgerMutated,
  viewMode,
}: Release5BookkeepingPanelsProps): React.ReactElement {
  const toast = useToast()
  const billFileRef = useRef<HTMLInputElement | null>(null)
  const bankFileRef = useRef<HTMLInputElement | null>(null)

  const captureAddress = useMemo(
    () => buildWorkspaceBillCaptureAddress(workspaceSlugOrName),
    [workspaceSlugOrName],
  )
  const [copiedAddr, setCopiedAddr] = useState(false)

  const [captures, setCaptures] = useState<InboundBillCaptureRecord[]>([])
  const [billFileName, setBillFileName] = useState('titan_valve_invoice_9048.pdf')
  const [billRawText, setBillRawText] = useState(SAMPLE_INBOUND_BILL_SPIKE_TEXT)
  const [capturingBill, setCapturingBill] = useState(false)
  const [postingCaptureId, setPostingCaptureId] = useState<string | null>(null)
  const [latestCaptureLedger, setLatestCaptureLedger] = useState<AgentActionLedgerEntry | null>(null)

  const [bankTxs, setBankTxs] = useState<BankFeedTransactionRecord[]>([])
  const [feedSource, setFeedSource] = useState<BankFeedSource>('bank_csv')
  const [feedPayload, setFeedPayload] = useState(SAMPLE_BANK_FEED_CSV)
  const [importingFeed, setImportingFeed] = useState(false)
  const [reconcilingBank, setReconcilingBank] = useState(false)
  const [latestBankLedger, setLatestBankLedger] = useState<AgentActionLedgerEntry | null>(null)

  const loadRelease5 = useCallback(async () => {
    try {
      const [capRows, bankRows] = await Promise.all([
        release5Queries.fetchInboundBillCaptures(workspaceId).catch(() => []),
        release5Queries.fetchBankFeedTransactions(workspaceId).catch(() => []),
      ])
      setCaptures(capRows)
      setBankTxs(bankRows)
    } catch {
      // Non-blocking fallback while migration settles
    }
  }, [workspaceId])

  useEffect(() => {
    void loadRelease5()
  }, [loadRelease5])

  const scopedCaptures = useMemo(
    () => filterByEntityId(captures, activeEntityId),
    [captures, activeEntityId],
  )
  const scopedBankTxs = useMemo(
    () => filterByEntityId(bankTxs, activeEntityId),
    [bankTxs, activeEntityId],
  )

  const entityIdOrNull =
    activeEntityId && activeEntityId !== 'consolidated' && activeEntityId !== 'primary'
      ? activeEntityId
      : null

  const copyCaptureAddress = () => {
    void navigator.clipboard?.writeText(captureAddress)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 2000)
    toast.success('Bill Capture Address Copied', captureAddress)
  }

  const handleCaptureSubmit = async (rawOverride?: string, nameOverride?: string) => {
    if (capturingBill) return
    const payloadText = (rawOverride ?? billRawText).trim()
    if (!payloadText) return
    setCapturingBill(true)
    try {
      const res = await release5Queries.captureAndEvaluateInboundBillInDb({
        workspaceId,
        entityId: entityIdOrNull,
        sourceAddress: captureAddress,
        fileName: nameOverride ?? (billFileName.trim() || 'vendor_bill.pdf'),
        rawText: payloadText,
        existingBills: vendorBills,
        poItems: [
          {
            id: 'po-demo-clean',
            workspace_id: workspaceId,
            po_id: 'PO-2026-1104',
            inventory_item_id: null,
            sku: 'COIL-10',
            description: 'Evaporator Replacement Coil',
            ordered_qty: 4,
            received_qty: 4,
            unit_cost_cents: 16000,
            line_total_cents: 64000,
          },
          {
            id: 'po-demo-valve',
            workspace_id: workspaceId,
            po_id: 'PO-2026-1109',
            inventory_item_id: null,
            sku: 'VALVE-42',
            description: 'Brass Control Valve Batch',
            ordered_qty: 50,
            received_qty: 50,
            unit_cost_cents: 4200,
            line_total_cents: 210000,
          },
        ],
        receiptItems: [
          { sku: 'COIL-10', ordered_qty: 4, received_qty: 4, damaged_qty: 0 },
          { sku: 'VALVE-42', ordered_qty: 50, received_qty: 50, damaged_qty: 0 },
        ],
        priorUnitCostsBySku: { 'COIL-10': 16000, 'VALVE-42': 4200 },
      })
      setCaptures(prev => [res.capture, ...prev])
      if (res.capture.match_status === 'fraud_frozen') {
        toast.info(
          'Auto-Frozen by Vendor Fraud Shield',
          `${res.capture.vendor_name}: ${INBOUND_BILL_STATUS_LABELS[res.capture.match_status]}`,
        )
      } else {
        toast.success(
          'Inbound Bill Captured',
          `${res.capture.vendor_name} · ${formatExactCents(res.capture.extracted_total_cents)}`,
        )
      }
      await onLedgerMutated()
    } catch (err) {
      toast.error('Capture failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setCapturingBill(false)
    }
  }

  const handlePostCapture = async (capture: InboundBillCaptureRecord) => {
    if (postingCaptureId) return
    setPostingCaptureId(capture.id)
    try {
      const res = await release5Queries.postInboundBillCaptureInDb(workspaceId, capture)
      setCaptures(prev => prev.map(c => (c.id === res.capture.id ? res.capture : c)))
      setLatestCaptureLedger(res.agentLedgerEntry)
      toast.success(
        'Posted to AP Ledger',
        `${res.capture.file_name} (${formatExactCents(res.capture.extracted_total_cents)})`,
      )
      await onLedgerMutated()
    } catch (err) {
      toast.error('Post blocked', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setPostingCaptureId(null)
    }
  }

  const handleUndoCapturePost = async () => {
    if (!latestCaptureLedger || latestCaptureLedger.status !== 'executed') return
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestCaptureLedger,
      })
      setLatestCaptureLedger(reversed)
      await loadRelease5()
      await onLedgerMutated()
      toast.info('1-Click Undo completed', 'Inbound bill capture reverted from posted status.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry.')
    }
  }

  const handleImportBankFeed = async () => {
    if (importingFeed || !feedPayload.trim()) return
    setImportingFeed(true)
    try {
      const inserted = await release5Queries.importAndAutoMatchBankFeedInDb({
        workspaceId,
        entityId: entityIdOrNull,
        source: feedSource,
        rawPayload: feedPayload,
        invoices: allInvoices,
        vendorBills,
      })
      setBankTxs(prev => [...inserted, ...prev])
      const autoMatched = inserted.filter(t => t.status === 'auto_matched').length
      toast.success(
        `Imported ${inserted.length} Bank Feed Row(s)`,
        `${autoMatched} exact-cent auto-match(es) staged for 1-click reconcile.`,
      )
    } catch (err) {
      toast.error('Bank feed parse failed', err instanceof Error ? err.message : 'Check format.')
    } finally {
      setImportingFeed(false)
    }
  }

  const handleReconcileMatched = async () => {
    const ready = scopedBankTxs.filter(t => t.status === 'auto_matched')
    if (ready.length === 0 || reconcilingBank) return
    setReconcilingBank(true)
    try {
      const res = await release5Queries.reconcileMatchedBankFeedInDb(workspaceId, ready)
      if (res) {
        setLatestBankLedger(res.agentLedgerEntry)
        await loadRelease5()
        await onLedgerMutated()
        toast.success(
          `Reconciled ${res.reconciledCount} Bank Match(es)`,
          'Logged cleanly to Agent Action Ledger with 1-Click Undo.',
        )
      }
    } catch (err) {
      toast.error('Reconcile failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setReconcilingBank(false)
    }
  }

  const handleUndoBankReconcile = async () => {
    if (!latestBankLedger || latestBankLedger.status !== 'executed') return
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestBankLedger,
      })
      setLatestBankLedger(reversed)
      await loadRelease5()
      await onLedgerMutated()
      toast.info('1-Click Undo completed', 'Reconciled bank feed rows restored to auto_matched.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry.')
    }
  }

  const autoMatchedCount = scopedBankTxs.filter(t => t.status === 'auto_matched').length

  return (
    <div className="space-y-6">
      {viewMode === 'both' || viewMode === 'inbox' ? (
        <section
          aria-label="Inbox-to-Ledger bill capture"
          className="exec-surface border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-4 text-slate-100"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-800 pb-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Inbox className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                <h3 className="text-base font-bold text-white">
                  Inbox-to-Ledger Bill Capture
                </h3>
                <Badge tone="brand">3-Way Match + Fraud Shield</Badge>
              </div>
              <p className="text-xs text-slate-300">
                Forward supplier PDFs to{' '}
                <code className="font-mono text-[#fdba74]">{captureAddress}</code> or drop bill text below to parse cents, verify PO = GRN = Bill, and auto-freeze hikes &gt;10%.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {latestCaptureLedger?.status === 'executed' ? (
                <button
                  type="button"
                  onClick={() => void handleUndoCapturePost()}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  1-Click Undo Post
                </button>
              ) : null}
              <button
                type="button"
                onClick={copyCaptureAddress}
                className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
              >
                {copiedAddr ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
                )}
                Copy Capture Email
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Simulate PDF / Email Forward
                </span>
                <input
                  ref={billFileRef}
                  type="file"
                  accept=".txt,.csv,.pdf"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setBillFileName(file.name)
                    void file.text().then(txt => {
                      if (txt.trim()) setBillRawText(txt)
                    })
                  }}
                />
                <button
                  type="button"
                  onClick={() => billFileRef.current?.click()}
                  className="rounded-lg border border-slate-700 bg-[#131f33] px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:border-[#fb923c]/50"
                >
                  <Upload className="inline h-3 w-3 mr-1" aria-hidden="true" />
                  Drop / Upload File
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBillFileName('apex_coil_bill_9040.pdf')
                    setBillRawText(SAMPLE_INBOUND_BILL_CLEAN_TEXT)
                  }}
                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
                >
                  Load Clean 3-Way PO
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBillFileName('titan_valve_invoice_9048.pdf')
                    setBillRawText(SAMPLE_INBOUND_BILL_SPIKE_TEXT)
                  }}
                  className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300"
                >
                  Load +33% Fraud Spike
                </button>
              </div>

              <textarea
                rows={6}
                aria-label="Inbound bill capture text"
                value={billRawText}
                onChange={e => setBillRawText(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-[#0b1320] px-3 py-2 font-mono text-[11px] text-slate-100"
              />

              <button
                type="button"
                disabled={capturingBill}
                onClick={() => void handleCaptureSubmit()}
                className="exec-btn-primary w-full !py-2 !text-xs"
              >
                <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                {capturingBill ? 'Parsing & Running 3-Way Match…' : 'Parse & Run 3-Way Match'}
              </button>
            </div>

            <div className="lg:col-span-7 space-y-2.5">
              {scopedCaptures.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 text-xs text-slate-400">
                  No inbound captures queued for this entity yet. Load a sample vendor invoice or drop a file to verify 3-Way Match and Fraud Shield gating.
                </div>
              ) : (
                scopedCaptures.map(cap => (
                  <div
                    key={cap.id}
                    className="rounded-xl border border-slate-800 bg-[#0e1726] p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
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
                        {cap.po_reference ? <Badge tone="neutral">{cap.po_reference}</Badge> : null}
                      </div>
                      <span className="text-sm font-bold text-white tabular-nums">
                        {formatExactCents(cap.extracted_total_cents)}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-white">
                      {cap.vendor_name} · <span className="font-mono text-slate-300">{cap.file_name}</span>
                    </p>
                    <p className="text-[11px] text-slate-300 leading-snug">{cap.proof_summary}</p>

                    <div className="flex justify-end gap-2">
                      {cap.match_status === '3way_matched' || cap.match_status === 'needs_review' ? (
                        <button
                          type="button"
                          disabled={postingCaptureId === cap.id}
                          onClick={() => void handlePostCapture(cap)}
                          className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Post Matched to Ledger
                        </button>
                      ) : cap.match_status === 'fraud_frozen' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300">
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          Posting locked until Fraud Shield clears alert
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      {viewMode === 'both' || viewMode === 'bank' ? (
        <section
          aria-label="Bank Feed and Auto-Reconciliation"
          className="exec-surface border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-4 text-slate-100"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-800 pb-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Landmark className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                <h3 className="text-base font-bold text-white">
                  Bank Feed &amp; Auto-Reconciliation
                </h3>
                <Badge tone="emerald">Plaid-Ready + OFX/QBO/CSV</Badge>
              </div>
              <p className="text-xs text-slate-300">
                Ingest Plaid webhook JSON, OFX/QBO statements, or CSV bank exports to auto-match exact-cent inflows/outflows against AR invoices &amp; AP bills.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {latestBankLedger?.status === 'executed' ? (
                <button
                  type="button"
                  onClick={() => void handleUndoBankReconcile()}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  1-Click Undo Reconcile
                </button>
              ) : null}
              <button
                type="button"
                disabled={reconcilingBank || autoMatchedCount === 0}
                onClick={() => void handleReconcileMatched()}
                className="exec-btn-emerald !px-3.5 !py-2 !text-xs disabled:opacity-45"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Reconcile Matched ({autoMatchedCount})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Import Bank Statement
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Bank feed format"
                    value={feedSource}
                    onChange={e => {
                      const next = e.target.value as BankFeedSource
                      setFeedSource(next)
                      if (next === 'plaid_webhook') setFeedPayload(SAMPLE_PLAID_WEBHOOK_JSON)
                      else if (next === 'bank_csv') setFeedPayload(SAMPLE_BANK_FEED_CSV)
                    }}
                    className="rounded-lg border border-slate-700 bg-[#0b1320] px-2 py-1 text-[11px] font-semibold text-slate-200"
                  >
                    <option value="bank_csv">Bank CSV</option>
                    <option value="ofx_qbo">OFX / QBO</option>
                    <option value="plaid_webhook">Plaid Webhook JSON</option>
                  </select>
                  <input
                    ref={bankFileRef}
                    type="file"
                    accept=".csv,.ofx,.qbo,.json,.txt"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      void file.text().then(txt => {
                        if (txt.trim()) setFeedPayload(txt)
                      })
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => bankFileRef.current?.click()}
                    className="rounded-lg border border-slate-700 bg-[#131f33] px-2 py-1 text-[11px] font-semibold text-slate-200"
                  >
                    <FileSpreadsheet className="inline h-3 w-3 mr-1" aria-hidden="true" />
                    Upload File
                  </button>
                </div>
              </div>

              <textarea
                rows={6}
                aria-label="Bank feed statement payload"
                value={feedPayload}
                onChange={e => setFeedPayload(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-[#0b1320] px-3 py-2 font-mono text-[11px] text-slate-100"
              />

              <button
                type="button"
                disabled={importingFeed}
                onClick={() => void handleImportBankFeed()}
                className="exec-btn-primary w-full !py-2 !text-xs"
              >
                <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                {importingFeed ? 'Matching Exact Cents…' : 'Auto-Match Bank Feed'}
              </button>
            </div>

            <div className="lg:col-span-7 space-y-2.5">
              {scopedBankTxs.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 text-xs text-slate-400">
                  No bank feed rows imported for this entity yet. Click <strong>Auto-Match Bank Feed</strong> to reconcile Plaid/OFX/CSV inflows &amp; outflows against open AR/AP records.
                </div>
              ) : (
                scopedBankTxs.map(tx => (
                  <div
                    key={tx.id}
                    className="rounded-xl border border-slate-800 bg-[#0e1726] p-3.5 space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{BANK_FEED_SOURCE_LABELS[tx.source]}</Badge>
                        <Badge
                          tone={
                            tx.status === 'reconciled'
                              ? 'emerald'
                              : tx.status === 'auto_matched'
                                ? 'brand'
                                : 'amber'
                          }
                        >
                          {BANK_FEED_STATUS_LABELS[tx.status]}
                        </Badge>
                        {tx.match_confidence_bps > 0 ? (
                          <span className="font-mono text-[11px] text-emerald-300 tabular-nums">
                            {(tx.match_confidence_bps / 100).toFixed(1)}% match
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          tx.direction === 'inflow' ? 'text-emerald-300' : 'text-slate-100'
                        }`}
                      >
                        {tx.direction === 'inflow' ? '+' : '-'}
                        {formatExactCents(tx.amount_cents)}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-white">
                      {tx.merchant_name} · <span className="text-slate-400 font-normal">{tx.posted_date}</span>
                    </p>
                    <p className="text-[11px] text-slate-300 leading-snug">{tx.proof_summary}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
