import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileCheck2, ShieldAlert } from 'lucide-react'
import { formatCents } from '../../../lib/format'
import * as release2Queries from '../../../lib/autonomousOs/release2Queries'
import {
  DEFAULT_AUTONOMY_CONFIG,
  runThreeWayMatch,
  type GoodsReceiptLineItem,
  type GoodsReceiptRecord,
  type PurchaseOrderItemRecord,
  type PurchaseOrderRecord,
  type VendorBillLineItem,
  type VendorBillRecord,
  type WorkspaceAutonomyConfig,
} from '../../../lib/autonomousOs'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export function ThreeWayMatchPanel({
  workspaceId,
  purchaseOrders,
  poItemsByPo,
  receiptsByPo,
  vendorBills,
  autonomyConfig = DEFAULT_AUTONOMY_CONFIG,
  onChanged,
}: {
  workspaceId: string
  purchaseOrders: readonly PurchaseOrderRecord[]
  poItemsByPo: ReadonlyMap<string, PurchaseOrderItemRecord[]>
  receiptsByPo: ReadonlyMap<string, GoodsReceiptRecord[]>
  vendorBills: readonly VendorBillRecord[]
  autonomyConfig?: WorkspaceAutonomyConfig
  onChanged: () => Promise<void> | void
}): React.ReactElement {
  const toast = useToast()

  const [selectedPoId, setSelectedPoId] = useState('')
  const [vendorName, setVendorName] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  )
  const [billSku, setBillSku] = useState('')
  const [billQty, setBillQty] = useState('10')
  const [billUnitDollars, setBillUnitDollars] = useState('25.00')
  const [taxDollars, setTaxDollars] = useState('0')
  const [submitting, setSubmitting] = useState(false)
  const [busyBillId, setBusyBillId] = useState<string | null>(null)

  useEffect(() => {
    if (purchaseOrders.length > 0 && !selectedPoId) {
      const po = purchaseOrders[0]
      setSelectedPoId(po.id)
      setVendorName(po.vendor_name)
      const firstLine = (poItemsByPo.get(po.id) ?? [])[0]
      if (firstLine) {
        setBillSku(firstLine.sku)
        setBillQty(String(firstLine.ordered_qty))
        setBillUnitDollars((firstLine.unit_cost_cents / 100).toFixed(2))
      }
    }
  }, [purchaseOrders, poItemsByPo, selectedPoId])

  const handleSelectPo = (poId: string) => {
    setSelectedPoId(poId)
    const po = purchaseOrders.find(p => p.id === poId)
    if (po) {
      setVendorName(po.vendor_name)
      const firstLine = (poItemsByPo.get(po.id) ?? [])[0]
      if (firstLine) {
        setBillSku(firstLine.sku)
        setBillQty(String(firstLine.ordered_qty))
        setBillUnitDollars((firstLine.unit_cost_cents / 100).toFixed(2))
      }
    }
  }

  const poMap = useMemo(() => {
    const map = new Map<string, PurchaseOrderRecord>()
    for (const po of purchaseOrders) {
      map.set(po.id, po)
    }
    return map
  }, [purchaseOrders])

  const handleCreateAndMatchBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const cleanInv = invoiceNumber.trim()
    const cleanVendor = vendorName.trim()
    const cleanSku = billSku.trim().toUpperCase()
    const qty = Math.trunc(Number(billQty))
    const unitCostCents = Math.round(Number(billUnitDollars) * 100)
    const taxCents = Math.max(0, Math.round(Number(taxDollars || 0) * 100))

    if (!cleanInv || !cleanVendor || !cleanSku || !Number.isSafeInteger(qty) || qty < 1) {
      toast.error('Invalid bill inputs', 'Vendor, Invoice #, SKU, and integer Qty >= 1 are required.')
      return
    }
    if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0) {
      toast.error('Invalid unit cost', 'Enter a valid non-negative unit cost.')
      return
    }

    const po = selectedPoId ? poMap.get(selectedPoId) : undefined
    const poItems = selectedPoId ? (poItemsByPo.get(selectedPoId) ?? []) : []
    const receipts = selectedPoId ? (receiptsByPo.get(selectedPoId) ?? []) : []
    const existingInvoiceNumbers = vendorBills.map(b => b.invoice_number)

    const lineItems: VendorBillLineItem[] = [
      {
        sku: cleanSku,
        description: cleanSku,
        quantity: qty,
        unit_cost_cents: unitCostCents,
      },
    ]

    setSubmitting(true)
    try {
      const { bill, matchResult } = await release2Queries.createVendorBillAndMatchInDb({
        workspaceId,
        poId: po?.id ?? null,
        poNumber: po?.po_number,
        vendorName: cleanVendor,
        invoiceNumber: cleanInv,
        dueDate,
        taxCents,
        billItems: lineItems,
        poItems,
        receipts,
        existingInvoiceNumbers,
        config: autonomyConfig,
      })
      if (matchResult.match_status === 'matched_clean') {
        toast.success(
          `3-Way Match CLEAN (${bill.invoice_number})`,
          `Matched within tolerance (${formatCents(bill.total_cents)}).`,
        )
      } else {
        toast.error(
          `3-Way Match Exception Flagged (${bill.invoice_number})`,
          `Variance ${formatCents(bill.match_variance_cents)} held with pre-staged dispute draft.`,
        )
      }
      setInvoiceNumber('')
      await onChanged()
    } catch (err) {
      toast.error('3-Way Match failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleApproveBill = async (bill: VendorBillRecord) => {
    if (busyBillId) return
    setBusyBillId(bill.id)
    try {
      await release2Queries.approveVendorBillInDb({ workspaceId, bill })
      toast.success('Vendor bill approved', bill.invoice_number)
      await onChanged()
    } catch (err) {
      toast.error('Approval failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyBillId(null)
    }
  }

  const handleDisputeBill = async (bill: VendorBillRecord) => {
    if (busyBillId) return
    setBusyBillId(bill.id)
    try {
      await release2Queries.disputeVendorBillInDb({ workspaceId, bill })
      toast.info('Vendor dispute staged & AP held', bill.invoice_number)
      await onChanged()
    } catch (err) {
      toast.error('Dispute staging failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyBillId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Record & Verify Vendor Bill against PO + GRN */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
            <h3 className="text-base font-bold text-slate-900">
              Run 3-Way Match (PO === Goods Receipt === Supplier Bill)
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            Ingest a vendor bill line item to compare quantities and unit pricing against your Purchase Order and Goods Receipt Note in integer cents.
          </p>
        </div>

        <form onSubmit={e => void handleCreateAndMatchBill(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
          <div className="sm:col-span-4">
            <label htmlFor="match-po-select" className="block text-xs font-semibold text-slate-700 mb-1">
              Linked Purchase Order
            </label>
            <select
              id="match-po-select"
              value={selectedPoId}
              onChange={e => handleSelectPo(e.target.value)}
              className="exec-input w-full text-xs font-semibold"
            >
              <option value="">Unlinked / Direct Bill</option>
              {purchaseOrders.map(po => (
                <option key={po.id} value={po.id}>
                  {po.po_number} · {po.vendor_name} ({po.status})
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="match-vendor-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Supplier Name
            </label>
            <input
              id="match-vendor-name"
              required
              value={vendorName}
              onChange={e => setVendorName(e.target.value)}
              placeholder="Acme Supply Co"
              className="exec-input w-full text-xs"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="match-invoice-no" className="block text-xs font-semibold text-slate-700 mb-1">
              Vendor Invoice #
            </label>
            <input
              id="match-invoice-no"
              required
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              placeholder="VB-1042"
              className="exec-input w-full text-xs font-mono"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="match-due-date" className="block text-xs font-semibold text-slate-700 mb-1">
              Due Date
            </label>
            <input
              id="match-due-date"
              type="date"
              required
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="exec-input w-full text-xs"
            />
          </div>

          <div className="sm:col-span-4">
            <label htmlFor="match-sku" className="block text-xs font-semibold text-slate-700 mb-1">
              Billed SKU
            </label>
            <input
              id="match-sku"
              required
              value={billSku}
              onChange={e => setBillSku(e.target.value)}
              placeholder="SKU-1001"
              className="exec-input w-full text-xs font-mono uppercase"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="match-qty" className="block text-xs font-semibold text-slate-700 mb-1">
              Billed Qty
            </label>
            <input
              id="match-qty"
              type="number"
              min="1"
              required
              value={billQty}
              onChange={e => setBillQty(e.target.value)}
              className="exec-input w-full text-xs tabular-nums"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="match-unit-cost" className="block text-xs font-semibold text-slate-700 mb-1">
              Unit Cost ($)
            </label>
            <input
              id="match-unit-cost"
              type="number"
              step="0.01"
              min="0"
              required
              value={billUnitDollars}
              onChange={e => setBillUnitDollars(e.target.value)}
              className="exec-input w-full text-xs tabular-nums"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="match-tax" className="block text-xs font-semibold text-slate-700 mb-1">
              Tax ($)
            </label>
            <input
              id="match-tax"
              type="number"
              step="0.01"
              min="0"
              value={taxDollars}
              onChange={e => setTaxDollars(e.target.value)}
              className="exec-input w-full text-xs tabular-nums"
            />
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="exec-btn-primary w-full !px-3 !py-2 !text-xs touch-target"
            >
              {submitting ? 'Matching…' : 'Verify Bill'}
            </button>
          </div>
        </form>
      </section>

      {/* Side-by-Side 3-Way Match Queue */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <h4 className="text-base font-bold text-slate-900">
            3-Way Match Queue ({vendorBills.length})
          </h4>
          <Badge tone="brand">±2.00% Tolerance (200 bps)</Badge>
        </div>

        {vendorBills.length === 0 ? (
          <EmptyState
            icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />}
            title="No vendor bills queued for 3-way match"
            description="Submit a vendor bill above or let an MCP controller ingest one to verify PO vs. Goods Receipt vs. Supplier Bill automatically."
          />
        ) : (
          <ul className="space-y-4">
            {vendorBills.map(bill => {
              const linkedPo = bill.po_id ? poMap.get(bill.po_id) : undefined
              const poItems = bill.po_id ? (poItemsByPo.get(bill.po_id) ?? []) : []
              const receipts = bill.po_id ? (receiptsByPo.get(bill.po_id) ?? []) : []
              const flattenedReceipts: GoodsReceiptLineItem[] = []
              for (const rec of receipts) {
                if (Array.isArray(rec.items_json)) {
                  flattenedReceipts.push(...rec.items_json)
                }
              }

              const billLines = Array.isArray(bill.items_json) ? bill.items_json : []
              const recomputed =
                billLines.length > 0
                  ? runThreeWayMatch(poItems, flattenedReceipts, billLines, 200, {
                      poNumber: linkedPo?.po_number ?? 'UNLINKED',
                      vendorName: bill.vendor_name,
                      invoiceNumber: bill.invoice_number,
                    })
                  : null

              return (
                <li
                  key={bill.id}
                  className={`rounded-2xl border p-4 space-y-3 ${
                    bill.match_status === 'exception_flagged' || bill.match_status === 'disputed'
                      ? 'border-rose-200 bg-rose-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          {bill.invoice_number}
                        </span>
                        <Badge
                          tone={
                            bill.match_status === 'matched_clean' || bill.match_status === 'paid'
                              ? 'emerald'
                              : bill.match_status === 'exception_flagged' ||
                                  bill.match_status === 'disputed'
                                ? 'rose'
                                : 'amber'
                          }
                        >
                          {bill.match_status}
                        </Badge>
                        {linkedPo ? (
                          <span className="text-xs font-semibold text-slate-600">
                            vs {linkedPo.po_number}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm font-bold text-slate-900">
                        {bill.vendor_name} · Due {bill.due_date}
                      </p>
                    </div>

                    <div className="text-right tabular-nums">
                      <p className="text-base font-black text-slate-950">
                        {formatCents(bill.total_cents)}
                      </p>
                      <p
                        className={`text-xs font-bold ${
                          bill.match_variance_cents !== 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        Variance: {formatCents(bill.match_variance_cents)}
                      </p>
                    </div>
                  </div>

                  {recomputed ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs tabular-nums">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                          1. Purchase Order
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-900">
                          {formatCents(recomputed.po_total_cents)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                          2. Goods Receipt (Payable)
                        </p>
                        <p className="mt-1 text-sm font-bold text-emerald-700">
                          {formatCents(recomputed.received_payable_cents)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                          3. Supplier Invoice
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-950">
                          {formatCents(recomputed.billed_total_cents)}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {bill.discrepancy_summary ? (
                    <div className="rounded-xl border border-rose-200 bg-white p-3 text-xs text-rose-900 space-y-1">
                      <p className="font-bold inline-flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                        Discrepancy Detected
                      </p>
                      <p>{bill.discrepancy_summary}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {bill.match_status !== 'matched_clean' && bill.match_status !== 'paid' ? (
                      <button
                        type="button"
                        disabled={busyBillId === bill.id}
                        onClick={() => void handleApproveBill(bill)}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve Clean Match
                      </button>
                    ) : null}
                    {bill.match_status !== 'disputed' && bill.match_status !== 'paid' ? (
                      <button
                        type="button"
                        disabled={busyBillId === bill.id}
                        onClick={() => void handleDisputeBill(bill)}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                        Stage Vendor Dispute
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
