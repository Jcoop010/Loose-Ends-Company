import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Inbox,
  Landmark,
  Pencil,
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
  validateAndExtractBillDocument,
  validateDocumentFileMeta,
  type AgentActionLedgerEntry,
  type AutonomousInvoice,
  type BankFeedSource,
  type BankFeedTransactionRecord,
  type GoodsReceiptLineItem,
  type InboundBillCaptureRecord,
  type PurchaseOrderItemRecord,
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
  const [workspacePoItems, setWorkspacePoItems] = useState<PurchaseOrderItemRecord[]>([])
  const [workspaceReceiptItems, setWorkspaceReceiptItems] = useState<GoodsReceiptLineItem[]>([])
  const [workspacePriorCosts, setWorkspacePriorCosts] = useState<Record<string, number>>({})
  const [billFileName, setBillFileName] = useState('titan_valve_invoice_9048.pdf')
  const [billRawText, setBillRawText] = useState(SAMPLE_INBOUND_BILL_SPIKE_TEXT)
  const [billExtractionMeta, setBillExtractionMeta] = useState<{
    contentHash?: string
    extractionMethod?: string
    extractionConfidenceBps?: number
    warning?: string | null
  } | null>(null)
  const [capturingBill, setCapturingBill] = useState(false)
  const [postingCaptureId, setPostingCaptureId] = useState<string | null>(null)
  const [latestCaptureLedger, setLatestCaptureLedger] = useState<AgentActionLedgerEntry | null>(null)

  const [editingCaptureId, setEditingCaptureId] = useState<string | null>(null)
  const [editVendor, setEditVendor] = useState('')
  const [editTotalDollars, setEditTotalDollars] = useState('')
  const [editPoRef, setEditPoRef] = useState('')
  const [editVerified, setEditVerified] = useState(false)
  const [savingReview, setSavingReview] = useState(false)

  const [bankTxs, setBankTxs] = useState<BankFeedTransactionRecord[]>([])
  const [feedSource, setFeedSource] = useState<BankFeedSource>('bank_csv')
  const [feedPayload, setFeedPayload] = useState(SAMPLE_BANK_FEED_CSV)
  const [importingFeed, setImportingFeed] = useState(false)
  const [reconcilingBank, setReconcilingBank] = useState(false)
  const [latestBankLedger, setLatestBankLedger] = useState<AgentActionLedgerEntry | null>(null)

  const loadRelease5 = useCallback(async () => {
    try {
      const [capRows, bankRows, poAndGrn] = await Promise.all([
        release5Queries.fetchInboundBillCaptures(workspaceId).catch(() => []),
        release5Queries.fetchBankFeedTransactions(workspaceId).catch(() => []),
        release5Queries.fetchWorkspacePoAndReceiptData(workspaceId).catch(() => ({
          poItems: [] as PurchaseOrderItemRecord[],
          receiptItems: [] as GoodsReceiptLineItem[],
          priorUnitCostsBySku: {} as Record<string, number>,
        })),
      ])
      setCaptures(capRows)
      setBankTxs(bankRows)
      setWorkspacePoItems(poAndGrn.poItems)
      setWorkspaceReceiptItems(poAndGrn.receiptItems)
      setWorkspacePriorCosts(poAndGrn.priorUnitCostsBySku)
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
    if (!payloadText) {
      toast.info(
        'Bill Text Required',
        billExtractionMeta?.extractionMethod === 'pdf_scanned_needs_ocr'
          ? 'Scanned image PDFs have 0% text extraction confidence without OCR. Paste invoice text or line items first.'
          : 'Paste invoice text or upload a selectable PDF/text statement before capturing.',
      )
      return
    }
    setCapturingBill(true)
    try {
      const res = await release5Queries.captureAndEvaluateInboundBillInDb({
        workspaceId,
        entityId: entityIdOrNull,
        sourceAddress: captureAddress,
        fileName: nameOverride ?? (billFileName.trim() || 'vendor_bill.pdf'),
        rawText: payloadText,
        existingBills: vendorBills,
        poItems: workspacePoItems,
        receiptItems: workspaceReceiptItems,
        priorUnitCostsBySku: workspacePriorCosts,
        contentHash: billExtractionMeta?.contentHash,
        extractionMethod: billExtractionMeta?.extractionMethod,
        extractionConfidenceBps: billExtractionMeta?.extractionConfidenceBps,
      })
      if (res.duplicate) {
        toast.info(
          'Duplicate Capture Skipped',
          `${res.capture.vendor_name} (${res.capture.file_name}) already exists in this workspace.`,
        )
        return
      }
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

  const startCaptureReview = (cap: InboundBillCaptureRecord) => {
    setEditingCaptureId(cap.id)
    setEditVendor(cap.vendor_name)
    setEditTotalDollars((cap.extracted_total_cents / 100).toFixed(2))
    setEditPoRef(cap.po_reference ?? '')
    setEditVerified(Boolean(cap.human_verified))
  }

  const handleSaveCaptureReview = async (cap: InboundBillCaptureRecord) => {
    if (savingReview) return
    const parsedDollars = Number.parseFloat(editTotalDollars)
    if (!Number.isFinite(parsedDollars) || parsedDollars < 0) {
      toast.error('Invalid total amount', 'Enter a non-negative dollar amount (e.g. 640.00).')
      return
    }
    setSavingReview(true)
    try {
      const updated = await release5Queries.updateInboundBillCaptureReviewInDb({
        workspaceId,
        captureId: cap.id,
        vendorName: editVendor,
        extractedTotalCents: Math.round(parsedDollars * 100),
        poReference: editPoRef.trim() || null,
        humanVerified: editVerified,
      })
      setCaptures(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      setEditingCaptureId(null)
      toast.success(
        'Capture Review Saved',
        updated.human_verified ? 'Human verification recorded.' : 'Review fields updated.',
      )
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingReview(false)
    }
  }

  const handlePostCapture = async (capture: InboundBillCaptureRecord) => {
    if (postingCaptureId) return
    const isNeedsReviewUnverified = capture.match_status === 'needs_review' && !capture.human_verified
    if (isNeedsReviewUnverified) {
      toast.info(
        'Verification Required Before Posting',
        'Low-confidence / unmatched captures require Verify / Edit confirmation before GL posting.',
      )
      startCaptureReview(capture)
      return
    }
    setPostingCaptureId(capture.id)
    try {
      const res = await release5Queries.postInboundBillCaptureInDb(workspaceId, capture, {
        humanVerified: capture.match_status === '3way_matched' || Boolean(capture.human_verified),
      })
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
                Upload PDF/text supplier invoices below to extract cents, match against workspace POs/receipts, and auto-freeze hikes &gt;10%. Forwarding to{' '}
                <code className="font-mono text-[#fdba74]">{captureAddress}</code> requires inbound email webhook MX routing + signing secret.
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
                    const inputEl = e.target
                    const file = inputEl.files?.[0]
                    if (!file) return
                    void (async () => {
                      try {
                        const ab = await file.arrayBuffer()
                        const extracted = await validateAndExtractBillDocument({
                          fileName: file.name,
                          bytes: new Uint8Array(ab),
                        })
                        setBillFileName(file.name)
                        setBillExtractionMeta({
                          contentHash: extracted.content_hash,
                          extractionMethod: extracted.extraction_method,
                          extractionConfidenceBps: extracted.extraction_confidence_bps,
                          warning: extracted.warning,
                        })
                        if (extracted.extraction_method === 'pdf_scanned_needs_ocr') {
                          setBillRawText('')
                          toast.info(
                            'Scanned PDF Detected (0% Confidence)',
                            extracted.warning ?? 'Enter bill line items or paste text manually.',
                          )
                        } else if (extracted.extraction_method === 'unsupported') {
                          setBillRawText('')
                          toast.error(
                            'Unsupported / Binary File',
                            extracted.warning ?? 'Could not extract readable text.',
                          )
                        } else {
                          setBillRawText(extracted.extracted_text)
                          toast.success(
                            'Document Parsed',
                            `${file.name} (${(extracted.extraction_confidence_bps / 100).toFixed(0)}% extraction confidence)`,
                          )
                        }
                      } catch (err) {
                        toast.error('Read failed', err instanceof Error ? err.message : 'Unable to parse uploaded file.')
                      } finally {
                        inputEl.value = ''
                      }
                    })()
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

              {billExtractionMeta?.warning ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                  {billExtractionMeta.warning}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBillFileName('apex_coil_bill_9040.pdf')
                    setBillExtractionMeta(null)
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
                    setBillExtractionMeta(null)
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
                onChange={e => {
                  setBillExtractionMeta(null)
                  setBillRawText(e.target.value)
                }}
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
                  No inbound captures queued for this entity yet. Load a sample vendor invoice or drop a PDF/text file to verify 3-Way Match and Fraud Shield gating.
                </div>
              ) : (
                scopedCaptures.map(cap => {
                  const isEditing = editingCaptureId === cap.id
                  const needsHumanVerification = cap.match_status === 'needs_review' && !cap.human_verified
                  return (
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
                          {typeof cap.extraction_confidence_bps === 'number' ? (
                            <Badge tone={cap.extraction_confidence_bps >= 7500 ? 'emerald' : 'amber'}>
                              {(cap.extraction_confidence_bps / 100).toFixed(0)}% conf
                            </Badge>
                          ) : null}
                          {cap.human_verified ? <Badge tone="emerald">Human Verified</Badge> : null}
                        </div>
                        <span className="text-sm font-bold text-white tabular-nums">
                          {formatExactCents(cap.extracted_total_cents)}
                        </span>
                      </div>

                      <p className="text-xs font-bold text-white">
                        {cap.vendor_name} · <span className="font-mono text-slate-300">{cap.file_name}</span>
                      </p>
                      <p className="text-[11px] text-slate-300 leading-snug">{cap.proof_summary}</p>

                      {isEditing ? (
                        <div className="rounded-xl border border-slate-700 bg-[#0b1320] p-3 space-y-2.5">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                Vendor Name
                              </label>
                              <input
                                type="text"
                                value={editVendor}
                                onChange={e => setEditVendor(e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-[#111c2d] px-2.5 py-1.5 text-xs text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                Total ($)
                              </label>
                              <input
                                type="text"
                                value={editTotalDollars}
                                onChange={e => setEditTotalDollars(e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-[#111c2d] px-2.5 py-1.5 font-mono text-xs text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                PO Reference
                              </label>
                              <input
                                type="text"
                                value={editPoRef}
                                onChange={e => setEditPoRef(e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-[#111c2d] px-2.5 py-1.5 font-mono text-xs text-white"
                              />
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-slate-200">
                            <input
                              type="checkbox"
                              checked={editVerified}
                              onChange={e => setEditVerified(e.target.checked)}
                              className="h-3.5 w-3.5 accent-[#fb923c]"
                            />
                            Human verified against source document before GL posting
                          </label>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingCaptureId(null)}
                              className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={savingReview}
                              onClick={() => void handleSaveCaptureReview(cap)}
                              className="exec-btn-primary !px-3 !py-1 !text-[11px]"
                            >
                              {savingReview ? 'Saving…' : 'Save Verification'}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap justify-end gap-2">
                        {cap.match_status === '3way_matched' || cap.match_status === 'needs_review' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => startCaptureReview(cap)}
                              className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              Verify / Edit
                            </button>
                            <button
                              type="button"
                              disabled={postingCaptureId === cap.id || needsHumanVerification}
                              onClick={() => void handlePostCapture(cap)}
                              className="exec-btn-emerald !px-3 !py-1.5 !text-xs disabled:opacity-45"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              {needsHumanVerification ? 'Verify Required to Post' : 'Post Matched to Ledger'}
                            </button>
                          </>
                        ) : cap.match_status === 'fraud_frozen' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300">
                            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                            Posting locked until Fraud Shield clears alert
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })
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
                <Badge tone="emerald">CSV / OFX-QBO / Manual JSON (No Live Plaid)</Badge>
              </div>
              <p className="text-xs text-slate-300">
                Import CSV bank exports, OFX/QBO statements, or manual JSON payloads to auto-match exact-cent inflows/outflows against open AR invoices &amp; AP bills. Live Plaid bank sync is not connected.
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
                    <option value="plaid_webhook">Manual JSON Statement (Plaid Format)</option>
                  </select>
                  <input
                    ref={bankFileRef}
                    type="file"
                    accept=".csv,.ofx,.qbo,.json,.txt"
                    className="hidden"
                    onChange={e => {
                      const inputEl = e.target
                      const file = inputEl.files?.[0]
                      if (!file) return
                      const metaErr = validateDocumentFileMeta(file.name, file.size)
                      if (metaErr) {
                        toast.error('Upload rejected', metaErr)
                        inputEl.value = ''
                        return
                      }
                      void file.text().then(txt => {
                        if (txt.trim()) setFeedPayload(txt)
                        inputEl.value = ''
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
                  No bank feed rows imported for this entity yet. Click <strong>Auto-Match Bank Feed</strong> to reconcile CSV/OFX/JSON inflows &amp; outflows against open AR/AP records.
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
