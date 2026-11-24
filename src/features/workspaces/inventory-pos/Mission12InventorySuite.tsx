import React, { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Barcode,
  CheckCircle2,
  ClipboardCheck,
  Download,
  MapPin,
  PackageCheck,
  Plus,
  ShieldAlert,
  ShoppingCart,
  ToggleLeft,
  ToggleRight,
  Upload,
} from 'lucide-react'
import {
  evaluateInventoryValuation,
  exportReconciliationReportCsv,
  generateReorderDraftProposals,
  parseCycleCountCsv,
  runThreeWayInventoryReconciliation,
  type AuditReasonCode,
  type InventoryLocationType,
  type InventorySkuSnapshot,
} from '../../../lib/inventory'
import {
  approveAndReconcileAuditAtomic,
  createInventoryLocation,
  recordInventoryMovementAtomic,
  stageInventoryReorderDraft,
  submitCycleAuditForApproval,
  transferInventoryAtomic,
  updateReorderDraftStatus,
  updateWorkspaceInventoryEnabled,
  type Mission12InventoryBundle,
} from '../../../lib/inventory/inventoryQueries'
import type { Release2InventoryBundle } from '../../../lib/autonomousOs/release2Queries'
import { formatCents } from '../../../lib/format'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export type Mission12SubTab = 'locations' | 'cycle_audit' | 'reconciliation' | 'reorder_queue'

interface Mission12InventorySuiteProps {
  workspaceId: string
  isAdminOrOwner: boolean
  inventoryEnabled: boolean
  activeSubTab: Mission12SubTab
  skuSnapshots: InventorySkuSnapshot[]
  r2: Release2InventoryBundle
  m12: Mission12InventoryBundle
  onChanged: () => Promise<void>
}

interface StagedCountLine {
  itemId: string
  sku: string
  itemName: string
  expectedQty: number
  countedQty: number
  unitCostCents: number
  reasonCode: AuditReasonCode
  scannedBarcode: string | null
  notes: string
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
    }
  }
}

export function Mission12InventorySuite({
  workspaceId,
  isAdminOrOwner,
  inventoryEnabled,
  activeSubTab,
  skuSnapshots,
  r2,
  m12,
  onChanged,
}: Mission12InventorySuiteProps): React.ReactElement {
  const toast = useToast()
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  // Location creation state
  const [locName, setLocName] = useState('')
  const [locCode, setLocCode] = useState('')
  const [locType, setLocType] = useState<InventoryLocationType>('warehouse')
  const [locAddress, setLocAddress] = useState('')
  const [savingLoc, setSavingLoc] = useState(false)

  // Transfer state
  const [transferItemId, setTransferItemId] = useState('')
  const [transferFromId, setTransferFromId] = useState('')
  const [transferToId, setTransferToId] = useState('')
  const [transferQty, setTransferQty] = useState('1')
  const [transferNotes, setTransferNotes] = useState('')
  const [transferring, setTransferring] = useState(false)

  // Atomic stock adjustment state
  const [moveItemId, setMoveItemId] = useState('')
  const [moveLocId, setMoveLocId] = useState('')
  const [moveQtyDelta, setMoveQtyDelta] = useState('5')
  const [moveNotes, setMoveNotes] = useState('')
  const [recordingMove, setRecordingMove] = useState(false)

  // Cycle Audit & Barcode Scanner state
  const [auditTitle, setAuditTitle] = useState(`Cycle Count ${new Date().toISOString().slice(0, 10)}`)
  const [auditLocationId, setAuditLocationId] = useState<string>('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [stagedLines, setStagedLines] = useState<StagedCountLine[]>([])
  const [submittingAudit, setSubmittingAudit] = useState(false)
  const [reconcilingAuditId, setReconcilingAuditId] = useState<string | null>(null)
  const [updatingDraftId, setUpdatingDraftId] = useState<string | null>(null)
  const [togglingModule, setTogglingModule] = useState(false)

  const valuation = useMemo(
    () => evaluateInventoryValuation(skuSnapshots, m12.balances),
    [skuSnapshots, m12.balances],
  )

  const reorderProposals = useMemo(
    () => generateReorderDraftProposals(valuation),
    [valuation],
  )

  const skuById = useMemo(() => {
    const map = new Map<string, InventorySkuSnapshot>()
    for (const s of skuSnapshots) map.set(s.id, s)
    return map
  }, [skuSnapshots])

  const locationById = useMemo(() => {
    const map = new Map<string, string>()
    for (const loc of m12.locations) map.set(loc.id, `${loc.code} · ${loc.name}`)
    return map
  }, [m12.locations])

  const reconciliationReport = useMemo(() => {
    const pendingAudits = m12.audits.filter(a => a.status === 'pending_approval')
    const physicalCounts = pendingAudits.flatMap(audit =>
      (m12.auditLinesByAuditId[audit.id] ?? []).map(line => {
        const item = skuById.get(line.item_id)
        return {
          item_id: line.item_id,
          sku: item?.sku ?? line.sku ?? line.item_id.slice(0, 8),
          item_name: item?.name ?? line.item_name ?? 'Inventory Item',
          book_qty: line.expected_qty,
          counted_qty: line.counted_qty,
          unit_cost_cents: line.unit_cost_cents,
          reason_code: line.reason_code,
        }
      }),
    )

    const poLines = r2.purchaseOrders.flatMap(po =>
      (r2.poItemsByPo.get(po.id) ?? []).map(li => ({
        po_number: po.po_number,
        vendor_name: po.vendor_name,
        sku: li.sku,
        ordered_qty: li.ordered_qty,
        unit_cost_cents: li.unit_cost_cents,
      })),
    )

    const grnLines = r2.goodsReceipts.flatMap(grn =>
      (grn.items_json ?? []).map(entry => ({
        receipt_number: `GRN-${grn.id.slice(0, 8)}`,
        po_number: null,
        sku: entry.sku,
        received_qty: entry.received_qty,
        unit_cost_cents: 0,
      })),
    )

    const vendorBillLines = r2.vendorBills.flatMap(bill =>
      (bill.items_json ?? []).map(entry => ({
        invoice_number: bill.invoice_number,
        po_number: null,
        vendor_name: bill.vendor_name,
        sku: entry.sku,
        billed_qty: entry.quantity,
        unit_cost_cents: entry.unit_cost_cents,
      })),
    )

    return runThreeWayInventoryReconciliation({
      valuationRows: valuation.rows,
      physicalCounts,
      poLines,
      grnLines,
      vendorBillLines,
      costDriftToleranceBps: 200,
    })
  }, [m12.audits, m12.auditLinesByAuditId, r2, skuById, valuation.rows])

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locName.trim() || !locCode.trim() || savingLoc) return
    setSavingLoc(true)
    try {
      const created = await createInventoryLocation({
        workspaceId,
        name: locName,
        code: locCode,
        locationType: locType,
        address: locAddress,
        isDefault: m12.locations.length === 0,
      })
      toast.success('Location Added', `${created.code} · ${created.name}`)
      setLocName('')
      setLocCode('')
      setLocAddress('')
      await onChanged()
    } catch (err) {
      toast.error('Location save failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingLoc(false)
    }
  }

  const handleRecordReceive = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!moveItemId || recordingMove) return
    const qty = Math.trunc(Number(moveQtyDelta || 0))
    if (qty === 0) {
      toast.error('Quantity required', 'Enter a non-zero integer delta.')
      return
    }
    setRecordingMove(true)
    try {
      await recordInventoryMovementAtomic({
        workspaceId,
        itemId: moveItemId,
        locationId: moveLocId || null,
        movementType: qty > 0 ? 'receive' : 'damage_writeoff',
        qtyDelta: qty,
        notes: moveNotes || (qty > 0 ? 'Manual stock receipt' : 'Manual write-off'),
        idempotencyKey: `ui-move:${workspaceId}:${moveItemId}:${Date.now()}`,
      })
      toast.success('Movement Recorded', `Atomic ledger updated (${qty > 0 ? '+' : ''}${qty} units).`)
      setMoveNotes('')
      await onChanged()
    } catch (err) {
      toast.error('Movement failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setRecordingMove(false)
    }
  }

  const handleTransferStock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!transferItemId || !transferFromId || !transferToId || transferring) return
    const qty = Math.trunc(Number(transferQty || 0))
    if (qty <= 0) {
      toast.error('Invalid quantity', 'Transfer quantity must be positive.')
      return
    }
    setTransferring(true)
    try {
      await transferInventoryAtomic({
        workspaceId,
        itemId: transferItemId,
        fromLocationId: transferFromId,
        toLocationId: transferToId,
        qty,
        notes: transferNotes || 'Inter-location stock transfer',
        idempotencyKey: `ui-xfer:${workspaceId}:${transferItemId}:${Date.now()}`,
      })
      toast.success('Transfer Complete', `Moved ${qty} unit(s) atomically across locations.`)
      setTransferNotes('')
      await onChanged()
    } catch (err) {
      toast.error('Transfer failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setTransferring(false)
    }
  }

  const handleBarcodeScanSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const query = barcodeInput.trim().toUpperCase()
    if (!query) return

    const matched = skuSnapshots.find(
      item =>
        item.sku.toUpperCase() === query ||
        (item.barcode && item.barcode.toUpperCase() === query),
    )

    if (!matched) {
      toast.error('SKU / Barcode Not Found', `No active catalog item matches "${query}".`)
      return
    }

    setStagedLines(prev => {
      const existing = prev.find(l => l.itemId === matched.id)
      if (existing) {
        return prev.map(l =>
          l.itemId === matched.id
            ? {
                ...l,
                countedQty: l.countedQty + 1,
                reasonCode: l.countedQty + 1 === l.expectedQty ? 'matched' : l.reasonCode,
              }
            : l,
        )
      }
      return [
        ...prev,
        {
          itemId: matched.id,
          sku: matched.sku,
          itemName: matched.name,
          expectedQty: matched.on_hand_qty,
          countedQty: 1,
          unitCostCents: matched.unit_cost_cents,
          reasonCode: matched.on_hand_qty === 1 ? 'matched' : 'shrinkage',
          scannedBarcode: query,
          notes: '',
        },
      ]
    })

    setBarcodeInput('')
    toast.success('Scanned', `${matched.sku} (+1 counted)`)
  }

  const handleCycleCsvUpload = async (file: File) => {
    const text = await file.text()
    const parsed = parseCycleCountCsv(text)
    if (parsed.errors.length > 0) {
      toast.error('CSV Parse Warning', parsed.errors[0]?.message ?? 'Check CSV formatting.')
    }
    const nextLines: StagedCountLine[] = []
    for (const row of parsed.rows) {
      const matched = skuSnapshots.find(s => s.sku.toUpperCase() === row.sku.toUpperCase())
      if (!matched) continue
      nextLines.push({
        itemId: matched.id,
        sku: matched.sku,
        itemName: matched.name,
        expectedQty: matched.on_hand_qty,
        countedQty: row.counted_qty,
        unitCostCents: matched.unit_cost_cents,
        reasonCode: row.counted_qty === matched.on_hand_qty ? 'matched' : row.reason_code,
        scannedBarcode: row.barcode,
        notes: row.notes ?? '',
      })
    }
    if (nextLines.length > 0) {
      setStagedLines(nextLines)
      toast.success('Cycle Sheet Loaded', `Staged ${nextLines.length} SKU count line(s) for review.`)
    }
  }

  const handleSubmitAuditForApproval = async () => {
    if (stagedLines.length === 0 || submittingAudit) return
    setSubmittingAudit(true)
    try {
      const audit = await submitCycleAuditForApproval({
        workspaceId,
        locationId: auditLocationId || null,
        title: auditTitle,
        lines: stagedLines.map(l => ({
          itemId: l.itemId,
          expectedQty: l.expectedQty,
          countedQty: l.countedQty,
          unitCostCents: l.unitCostCents,
          reasonCode: l.reasonCode,
          scannedBarcode: l.scannedBarcode,
          notes: l.notes || null,
        })),
      })
      toast.success(
        `Submitted ${audit.audit_number}`,
        'Staged for Owner Approval. Stock balances remain untouched until reconciled.',
      )
      setStagedLines([])
      await onChanged()
    } catch (err) {
      toast.error('Audit submission failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSubmittingAudit(false)
    }
  }

  const handleApproveAndReconcile = async (auditId: string, auditNumber: string) => {
    if (reconcilingAuditId) return
    setReconcilingAuditId(auditId)
    try {
      await approveAndReconcileAuditAtomic(auditId)
      toast.success(
        `Reconciled ${auditNumber}`,
        'Atomic audit adjustments posted to immutable movement ledger & balances updated.',
      )
      await onChanged()
    } catch (err) {
      toast.error('Reconciliation failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setReconcilingAuditId(null)
    }
  }

  const handleExportReconciliationCsv = () => {
    const csv = exportReconciliationReportCsv(reconciliationReport)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `loose-ends-inventory-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleStageReorderProposal = async (proposal: (typeof reorderProposals)[number]) => {
    if (updatingDraftId) return
    setUpdatingDraftId(proposal.item_id)
    try {
      await stageInventoryReorderDraft({
        workspaceId,
        itemId: proposal.item_id,
        vendorName: proposal.vendor_name,
        suggestedQty: proposal.suggested_qty,
        unitCostCents: proposal.unit_cost_cents,
        source: 'low_stock_engine',
        notes: proposal.reason,
        idempotencyKey: `reorder:${workspaceId}:${proposal.item_id}:${new Date().toISOString().slice(0, 10)}`,
      })
      toast.success('Draft PO Staged', `${proposal.sku} (${proposal.suggested_qty} units) queued for owner approval.`)
      await onChanged()
    } catch (err) {
      toast.error('Stage draft failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setUpdatingDraftId(null)
    }
  }

  const handleDraftDecision = async (draftId: string, nextStatus: 'approved' | 'dismissed') => {
    if (updatingDraftId) return
    setUpdatingDraftId(draftId)
    try {
      await updateReorderDraftStatus(workspaceId, draftId, nextStatus)
      toast.success(
        nextStatus === 'approved' ? 'Draft PO Approved' : 'Draft PO Dismissed',
        nextStatus === 'approved'
          ? 'Owner approval recorded in audit log.'
          : 'Reorder draft dismissed cleanly.',
      )
      await onChanged()
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setUpdatingDraftId(null)
    }
  }

  const handleToggleInventoryModule = async () => {
    if (!isAdminOrOwner || togglingModule) return
    setTogglingModule(true)
    try {
      await updateWorkspaceInventoryEnabled(workspaceId, !inventoryEnabled)
      toast.success(
        !inventoryEnabled ? 'Inventory Module Enabled' : 'Inventory Module Hidden',
        'Workspace navigation preference updated.',
      )
      await onChanged()
    } catch (err) {
      toast.error('Preference update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setTogglingModule(false)
    }
  }

  const browserBarcodeSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  return (
    <div className="space-y-6">
      {/* Executive Header Strip with Modular Workspace Toggle */}
      <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-4 sm:p-5 text-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-[#EA580C]/20 border border-[#EA580C]/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#fdba74]">
              Audit-Grade Stock Ledger
            </span>
            <span className="text-xs text-slate-400">
              {valuation.total_skus} Active SKUs · {formatCents(valuation.total_valuation_cents)} Cost Valuation
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-300">
            Every stock adjustment flows through immutable PostgreSQL RPCs. Cycle counts &amp; low-stock POs require explicit owner approval before committing.
          </p>
        </div>

        {isAdminOrOwner ? (
          <button
            type="button"
            disabled={togglingModule}
            onClick={() => void handleToggleInventoryModule()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition shrink-0"
          >
            {inventoryEnabled ? (
              <ToggleRight className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-slate-400" aria-hidden="true" />
            )}
            Inventory Tab: {inventoryEnabled ? 'Enabled' : 'Hidden'}
          </button>
        ) : null}
      </div>

      {/* TAB 1: STOCK & LOCATIONS */}
      {activeSubTab === 'locations' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Locations Registry */}
            <section className="exec-surface p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Warehouses, Trucks &amp; Bins ({m12.locations.length})
                  </h3>
                </div>
              </div>

              {m12.locations.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No locations configured yet. Add your primary warehouse, storefront, or service truck below to track multi-location stock balances.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {m12.locations.map(loc => (
                    <div key={loc.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-slate-900">
                          <span className="font-mono text-[#EA580C]">{loc.code}</span> · {loc.name}
                        </p>
                        <p className="text-slate-500 capitalize">
                          {loc.location_type}
                          {loc.address ? ` · ${loc.address}` : ''}
                        </p>
                      </div>
                      {loc.is_default ? <Badge tone="emerald">Default</Badge> : null}
                    </div>
                  ))}
                </div>
              )}

              {isAdminOrOwner ? (
                <form onSubmit={e => void handleCreateLocation(e)} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-2 border-t border-slate-100">
                  <input
                    required
                    value={locCode}
                    onChange={e => setLocCode(e.target.value)}
                    placeholder="Code (e.g. MAIN)"
                    className="exec-input sm:col-span-3 text-xs font-mono uppercase"
                  />
                  <input
                    required
                    value={locName}
                    onChange={e => setLocName(e.target.value)}
                    placeholder="Location Name"
                    className="exec-input sm:col-span-4 text-xs"
                  />
                  <select
                    value={locType}
                    onChange={e => setLocType(e.target.value as InventoryLocationType)}
                    className="exec-input sm:col-span-3 text-xs"
                  >
                    <option value="warehouse">Warehouse</option>
                    <option value="storefront">Storefront</option>
                    <option value="truck">Service Truck</option>
                    <option value="bin">Bin / Shelf</option>
                    <option value="consignment">Consignment</option>
                  </select>
                  <button
                    type="submit"
                    disabled={savingLoc}
                    className="exec-btn-primary sm:col-span-2 !px-2.5 !py-2 !text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add
                  </button>
                </form>
              ) : null}
            </section>

            {/* Atomic Stock Movement & Inter-Location Transfer */}
            <section className="exec-surface p-5 space-y-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <PackageCheck className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-slate-900">Record Atomic Stock Movement</h3>
                </div>
                <form onSubmit={e => void handleRecordReceive(e)} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <select
                    required
                    value={moveItemId}
                    onChange={e => setMoveItemId(e.target.value)}
                    className="exec-input sm:col-span-5 text-xs"
                  >
                    <option value="">Select SKU…</option>
                    {skuSnapshots.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.sku} · {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={moveLocId}
                    onChange={e => setMoveLocId(e.target.value)}
                    className="exec-input sm:col-span-4 text-xs"
                  >
                    <option value="">Default Location</option>
                    {m12.locations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code} · {loc.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    required
                    value={moveQtyDelta}
                    onChange={e => setMoveQtyDelta(e.target.value)}
                    placeholder="+/- Qty"
                    className="exec-input sm:col-span-3 text-xs tabular-nums"
                  />
                  <input
                    value={moveNotes}
                    onChange={e => setMoveNotes(e.target.value)}
                    placeholder="Reason / PO reference"
                    className="exec-input sm:col-span-9 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={recordingMove || skuSnapshots.length === 0}
                    className="exec-btn-primary sm:col-span-3 !px-3 !py-2 !text-xs"
                  >
                    {recordingMove ? 'Posting…' : 'Post'}
                  </button>
                </form>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-slate-900">Atomic Location Transfer</h3>
                </div>
                <form onSubmit={e => void handleTransferStock(e)} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <select
                    required
                    value={transferItemId}
                    onChange={e => setTransferItemId(e.target.value)}
                    className="exec-input sm:col-span-4 text-xs"
                  >
                    <option value="">SKU…</option>
                    {skuSnapshots.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.sku}
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    value={transferFromId}
                    onChange={e => setTransferFromId(e.target.value)}
                    className="exec-input sm:col-span-3 text-xs"
                  >
                    <option value="">From…</option>
                    {m12.locations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code}
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    value={transferToId}
                    onChange={e => setTransferToId(e.target.value)}
                    className="exec-input sm:col-span-3 text-xs"
                  >
                    <option value="">To…</option>
                    {m12.locations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    required
                    value={transferQty}
                    onChange={e => setTransferQty(e.target.value)}
                    className="exec-input sm:col-span-2 text-xs tabular-nums"
                  />
                  <input
                    value={transferNotes}
                    onChange={e => setTransferNotes(e.target.value)}
                    placeholder="Transfer notes"
                    className="exec-input sm:col-span-9 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={transferring || m12.locations.length < 2}
                    className="exec-btn-secondary sm:col-span-3 !px-3 !py-2 !text-xs"
                  >
                    {transferring ? 'Moving…' : 'Transfer'}
                  </button>
                </form>
              </div>
            </section>
          </div>

          {/* Per-Location Balances Table */}
          <section className="exec-surface p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Live Per-Location Balances ({m12.balances.length})
            </h3>
            {m12.balances.length === 0 ? (
              <p className="text-xs text-slate-500">
                No per-location stock balances recorded yet. Post an atomic stock movement above to initialize location-level inventory tracking.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2 text-right">On-Hand</th>
                      <th className="px-3 py-2 text-right">Reserved</th>
                      <th className="px-3 py-2 text-right">Available</th>
                      <th className="px-3 py-2 text-right">Incoming</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {m12.balances.map(bal => {
                      const item = skuById.get(bal.item_id)
                      const available = bal.on_hand_qty - bal.reserved_qty
                      return (
                        <tr key={bal.id}>
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">
                            {item?.sku ?? bal.item_id.slice(0, 8)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {locationById.get(bal.location_id) ?? bal.location_id.slice(0, 8)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{bal.on_hand_qty}</td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{bal.reserved_qty}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">{available}</td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{bal.incoming_qty}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* TAB 2: CYCLE AUDIT & BARCODE SCANNER */}
      {activeSubTab === 'cycle_audit' ? (
        <section className="exec-surface p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Barcode className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">
                  Cycle Audit &amp; Barcode Scanner
                </h3>
              </div>
              <p className="text-xs text-slate-600">
                Scan via USB/Bluetooth keyboard-wedge scanner{browserBarcodeSupported ? ' or browser BarcodeDetector' : ''}, type a SKU/barcode manually, or upload a cycle-count CSV. Balances stay locked until owner approval.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleCycleCsvUpload(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => csvInputRef.current?.click()}
                className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Import Count CSV
              </button>
            </div>
          </div>

          {/* Audit Meta + Barcode Wedge Input */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <input
              value={auditTitle}
              onChange={e => setAuditTitle(e.target.value)}
              placeholder="Audit Title"
              className="exec-input sm:col-span-4 text-xs"
            />
            <select
              value={auditLocationId}
              onChange={e => setAuditLocationId(e.target.value)}
              className="exec-input sm:col-span-3 text-xs"
            >
              <option value="">All / Default Location</option>
              {m12.locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.code} · {loc.name}
                </option>
              ))}
            </select>
            <form onSubmit={handleBarcodeScanSubmit} className="sm:col-span-5 flex gap-2">
              <input
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                placeholder="Scan barcode or type SKU + Enter…"
                className="exec-input flex-1 text-xs font-mono uppercase"
              />
              <button type="submit" className="exec-btn-primary !px-3.5 !py-2 !text-xs">
                + Count
              </button>
            </form>
          </div>

          {/* Staged Cycle Count Lines */}
          {stagedLines.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
              No SKUs counted in this session yet. Scan a barcode or enter a SKU above to begin a cycle count.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">SKU &amp; Item</th>
                      <th className="px-3 py-2 text-right">Book Qty</th>
                      <th className="px-3 py-2 text-right">Physical Count</th>
                      <th className="px-3 py-2 text-right">Variance</th>
                      <th className="px-3 py-2 text-right">Variance Value</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {stagedLines.map(line => {
                      const varianceQty = line.countedQty - line.expectedQty
                      const varianceCents = varianceQty * line.unitCostCents
                      return (
                        <tr key={line.itemId}>
                          <td className="px-3 py-2">
                            <span className="font-mono font-bold text-slate-900">{line.sku}</span>
                            <span className="ml-2 text-slate-600">{line.itemName}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{line.expectedQty}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              value={line.countedQty}
                              onChange={e => {
                                const nextQty = Math.max(0, Math.trunc(Number(e.target.value || 0)))
                                setStagedLines(prev =>
                                  prev.map(l =>
                                    l.itemId === line.itemId
                                      ? {
                                          ...l,
                                          countedQty: nextQty,
                                          reasonCode: nextQty === l.expectedQty ? 'matched' : l.reasonCode,
                                        }
                                      : l,
                                  ),
                                )
                              }}
                              className="exec-input w-20 text-right text-xs tabular-nums"
                            />
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-bold tabular-nums ${
                              varianceQty < 0
                                ? 'text-rose-700'
                                : varianceQty > 0
                                  ? 'text-emerald-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {varianceQty > 0 ? `+${varianceQty}` : varianceQty}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatCents(varianceCents)}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={line.reasonCode}
                              onChange={e =>
                                setStagedLines(prev =>
                                  prev.map(l =>
                                    l.itemId === line.itemId
                                      ? { ...l, reasonCode: e.target.value as AuditReasonCode }
                                      : l,
                                  ),
                                )
                              }
                              className="exec-input text-xs"
                            >
                              <option value="matched">Matched</option>
                              <option value="shrinkage">Shrinkage</option>
                              <option value="damage">Damage</option>
                              <option value="receiving_error">Receiving Error</option>
                              <option value="misplaced">Misplaced</option>
                              <option value="vendor_shortage">Vendor Shortage</option>
                              <option value="unexplained">Unexplained</option>
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setStagedLines([])}
                  className="exec-btn-secondary !px-3.5 !py-2 !text-xs"
                >
                  Clear Count
                </button>
                <button
                  type="button"
                  disabled={submittingAudit}
                  onClick={() => void handleSubmitAuditForApproval()}
                  className="exec-btn-primary !px-4 !py-2 !text-xs"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {submittingAudit ? 'Submitting…' : 'Submit for Owner Approval'}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* TAB 3: RECONCILIATION & DISCREPANCIES */}
      {activeSubTab === 'reconciliation' ? (
        <div className="space-y-6">
          {/* Pending & Historical Cycle Audits */}
          <section className="exec-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Cycle Count Audits Awaiting Reconciliation ({m12.audits.length})
                </h3>
                <p className="text-xs text-slate-600">
                  1-tap Approve &amp; Reconcile posts atomic audit adjustments to the immutable ledger.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportReconciliationCsv}
                className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export Discrepancies CSV
              </button>
            </div>

            {m12.audits.length === 0 ? (
              <p className="text-xs text-slate-500">
                No cycle count audits submitted yet. Use the Cycle Audit &amp; Barcode Scanner tab to stage a count for owner approval.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {m12.audits.map(audit => (
                  <div
                    key={audit.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{audit.audit_number}</span>
                        <Badge
                          tone={
                            audit.status === 'reconciled'
                              ? 'emerald'
                              : audit.status === 'pending_approval'
                                ? 'amber'
                                : 'neutral'
                          }
                        >
                          {audit.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-slate-600 mt-0.5">
                        {audit.title} · Expected {audit.total_expected_qty} vs Counted {audit.total_counted_qty} (Variance:{' '}
                        <strong className={audit.total_variance_qty < 0 ? 'text-rose-700' : 'text-slate-900'}>
                          {audit.total_variance_qty > 0 ? `+${audit.total_variance_qty}` : audit.total_variance_qty} units /{' '}
                          {formatCents(audit.total_variance_cents)}
                        </strong>
                        )
                      </p>
                    </div>

                    {audit.status === 'pending_approval' && isAdminOrOwner ? (
                      <button
                        type="button"
                        disabled={reconcilingAuditId !== null}
                        onClick={() => void handleApproveAndReconcile(audit.id, audit.audit_number)}
                        className="exec-btn-primary !px-3.5 !py-2 !text-xs shrink-0"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {reconcilingAuditId === audit.id ? 'Reconciling…' : 'Approve & Reconcile Audit'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3-Way Discrepancies & Fraud Shield Flags */}
          <section className="exec-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900">
                  3-Way Stock-to-Ledger Discrepancies ({reconciliationReport.discrepancies.length})
                </h3>
              </div>
              <Badge tone={reconciliationReport.is_clean ? 'emerald' : 'rose'}>
                {reconciliationReport.is_clean
                  ? 'All Books Reconciled'
                  : `Exposure ${formatCents(reconciliationReport.total_exposure_cents)}`}
              </Badge>
            </div>

            {reconciliationReport.discrepancies.length === 0 ? (
              <p className="text-xs text-emerald-700 font-medium">
                Zero Phantom Inventory, Unbilled Receipts, Negative Stock Anomalies, or Unit Cost Drift detected.
              </p>
            ) : (
              <div className="space-y-2.5">
                {reconciliationReport.discrepancies.map(flag => (
                  <div
                    key={flag.id}
                    className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                        <span className="font-mono font-bold text-slate-900">{flag.sku}</span>
                        <Badge tone={flag.severity === 'critical' || flag.severity === 'high' ? 'rose' : 'amber'}>
                          {flag.code.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="mt-1 text-slate-700">{flag.summary}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{flag.recommended_action}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-rose-700 tabular-nums">{formatCents(flag.variance_cents)}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {(flag.variance_bps / 100).toFixed(2)}% variance
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* TAB 4: AUTONOMOUS REORDER QUEUE */}
      {activeSubTab === 'reorder_queue' ? (
        <div className="space-y-6">
          {/* Low-Stock Proposals Ready to Stage */}
          <section className="exec-surface p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900">
                  Low-Stock Reorder Triggers ({reorderProposals.length})
                </h3>
              </div>
              <Badge tone={reorderProposals.length > 0 ? 'amber' : 'emerald'}>
                {reorderProposals.length} Below Threshold
              </Badge>
            </div>

            {reorderProposals.length === 0 ? (
              <p className="text-xs text-slate-500">
                All active SKUs are above their reorder points (Available + Incoming &gt; Reorder Point).
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {reorderProposals.map(proposal => (
                  <div
                    key={proposal.item_id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono text-[#EA580C]">{proposal.sku}</span> · {proposal.name}
                      </p>
                      <p className="text-slate-600">
                        Vendor: {proposal.vendor_name} · {proposal.reason} · Est.{' '}
                        <strong>{formatCents(proposal.estimated_total_cents)}</strong>
                      </p>
                    </div>
                    {isAdminOrOwner ? (
                      <button
                        type="button"
                        disabled={updatingDraftId !== null}
                        onClick={() => void handleStageReorderProposal(proposal)}
                        className="exec-btn-primary !px-3.5 !py-2 !text-xs shrink-0"
                      >
                        Stage Draft PO ({proposal.suggested_qty})
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Staged Reorder Drafts Queue */}
          <section className="exec-surface p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2.5">
              Staged Reorder Drafts Queue ({m12.reorderDrafts.length})
            </h3>
            {m12.reorderDrafts.length === 0 ? (
              <p className="text-xs text-slate-500">
                No reorder drafts staged yet. Low-stock items or Grok Bot reorder recommendations appear here for 1-tap owner approval.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {m12.reorderDrafts.map(draft => {
                  const item = skuById.get(draft.item_id)
                  return (
                    <div
                      key={draft.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">
                            {item?.sku ?? draft.sku ?? draft.item_id.slice(0, 8)}
                          </span>
                          <Badge
                            tone={
                              draft.status === 'approved' || draft.status === 'converted_to_po'
                                ? 'emerald'
                                : draft.status === 'dismissed'
                                  ? 'neutral'
                                  : 'amber'
                            }
                          >
                            {draft.status}
                          </Badge>
                          <span className="text-[11px] text-slate-500">{draft.source}</span>
                        </div>
                        <p className="text-slate-600 mt-0.5">
                          {draft.vendor_name} · Qty {draft.suggested_qty} @ {formatCents(draft.unit_cost_cents)} ={' '}
                          <strong>{formatCents(draft.estimated_total_cents)}</strong>
                        </p>
                      </div>

                      {draft.status === 'draft' && isAdminOrOwner ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={updatingDraftId !== null}
                            onClick={() => void handleDraftDecision(draft.id, 'approved')}
                            className="exec-btn-primary !px-3 !py-1.5 !text-xs"
                          >
                            Approve Draft PO
                          </button>
                          <button
                            type="button"
                            disabled={updatingDraftId !== null}
                            onClick={() => void handleDraftDecision(draft.id, 'dismissed')}
                            className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
