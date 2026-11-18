import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  History,
  PackageCheck,
  Plus,
  ShoppingCart,
  XCircle,
} from 'lucide-react'
import { formatCurrency, formatDateTime } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import { fetchWorkspacePage } from '../../../lib/queries'
import type {
  InventoryItem,
  InventoryMovement,
  OpsPurchaseOrder,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import {
  Badge,
  EmptyState,
  PaginationBar,
  Skeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const MOVEMENTS_PAGE_SIZE = 25

export interface PurchaseOrdersPanelProps {
  mode: 'orders' | 'movements'
  workspaceId: string
  isAdminOrOwner: boolean
  purchaseOrders: OpsPurchaseOrder[]
  inventoryItems: InventoryItem[]
  inventoryById: ReadonlyMap<string, InventoryItem>
  timezone?: string | null
  onChanged: () => Promise<void> | void
}

export function PurchaseOrdersPanel({
  mode,
  workspaceId,
  isAdminOrOwner,
  purchaseOrders,
  inventoryItems,
  inventoryById,
  timezone,
  onChanged,
}: PurchaseOrdersPanelProps): React.ReactElement {
  const toast = useToast()

  // Manual PO Draft Modal (`purchase_draft`)
  const [draftModalOpen, setDraftModalOpen] = useState(false)
  const [draftItemId, setDraftItemId] = useState(inventoryItems[0]?.id ?? '')
  const [creatingDraft, setCreatingDraft] = useState(false)
  const draftKeyRef = useRef<string>(createIdempotencyKey())

  // Mark Received Modal (`purchase_transition` -> `received`)
  const [receivePo, setReceivePo] = useState<OpsPurchaseOrder | null>(null)
  const [receiptRef, setReceiptRef] = useState('')
  const [receiving, setReceiving] = useState(false)
  const receiveKeyRef = useRef<string>(createIdempotencyKey())

  const [busyPoId, setBusyPoId] = useState<string | null>(null)

  // Paginated Movements Ledger
  const [movPage, setMovPage] = useState(0)
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [movLoading, setMovLoading] = useState(false)
  const movSeqRef = useRef(0)

  const loadMovements = useCallback(async () => {
    if (mode !== 'movements') return
    const seq = ++movSeqRef.current
    setMovLoading(true)
    try {
      const rows = await fetchWorkspacePage<InventoryMovement>({
        table: 'inventory_movements',
        workspaceId,
        page: movPage,
        pageSize: MOVEMENTS_PAGE_SIZE,
        orderBy: 'created_at',
        ascending: false,
      })
      if (movSeqRef.current !== seq) return
      setMovements(rows)
    } catch (err) {
      if (movSeqRef.current !== seq) return
      toast.error(
        'Unable to load stock movements',
        err instanceof Error ? err.message : 'Retry.',
      )
    } finally {
      if (movSeqRef.current === seq) {
        setMovLoading(false)
      }
    }
  }, [mode, workspaceId, movPage, toast])

  useEffect(() => {
    void loadMovements()
  }, [loadMovements])

  const handleCreatePoDraft = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draftItemId) return
    setCreatingDraft(true)
    try {
      await opsCommand(
        workspaceId,
        'purchase_draft',
        { id: draftItemId },
        draftKeyRef.current,
      )
      setDraftModalOpen(false)
      toast.success('Draft Purchase Order created', 'Awaiting owner approval before ordering.')
      await onChanged()
    } catch (err) {
      toast.error(
        'Could not create PO draft',
        err instanceof Error ? err.message : 'An open PO already exists for this SKU.',
      )
      draftKeyRef.current = createIdempotencyKey()
    } finally {
      setCreatingDraft(false)
    }
  }

  const handleTransitionPo = async (
    po: OpsPurchaseOrder,
    status: 'approved' | 'denied',
  ) => {
    if (busyPoId) return
    setBusyPoId(po.id)
    try {
      await opsCommand(
        workspaceId,
        'purchase_transition',
        { id: po.id, status },
        createIdempotencyKey(),
      )
      toast.success(
        status === 'approved' ? 'Purchase Order approved' : 'Purchase Order denied',
      )
      await onChanged()
    } catch (err) {
      toast.error('PO transition failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyPoId(null)
    }
  }

  const handleConfirmReceive = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!receivePo) return
    if (receiptRef.trim().length < 3) {
      toast.error(
        'Packing slip reference required',
        'Enter a supplier packing slip or invoice reference (3+ characters).',
      )
      return
    }
    setReceiving(true)
    try {
      await opsCommand(
        workspaceId,
        'purchase_transition',
        {
          id: receivePo.id,
          status: 'received',
          receipt_reference: receiptRef.trim(),
        },
        receiveKeyRef.current,
      )
      setReceivePo(null)
      setReceiptRef('')
      toast.success(
        'PO received & stock incremented',
        `+${receivePo.quantity} units posted to inventory_movements.`,
      )
      await onChanged()
    } catch (err) {
      toast.error('Receive failed', err instanceof Error ? err.message : 'Retry.')
      receiveKeyRef.current = createIdempotencyKey()
    } finally {
      setReceiving(false)
    }
  }

  if (mode === 'movements') {
    return (
      <section aria-label="Inventory stock movement ledger" className="exec-surface overflow-hidden">
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <h2 className="text-base font-bold text-slate-900">Immutable Stock Movement Ledger</h2>
          <p className="text-xs text-slate-600">
            Every receipt, job reservation, material consumption, return, and adjustment with
            running balance.
          </p>
        </div>

        {movLoading ? (
          <div className="p-5 space-y-2.5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : movements.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<History className="h-5 w-5" />}
              title="No stock movements recorded yet"
              description="Receipts, job reservations, and PO arrivals appear here chronologically."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 text-xs">
            {movements.map(mov => {
              const sku = inventoryById.get(mov.item_id)
              return (
                <li
                  key={mov.id}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          mov.kind === 'receipt' || mov.kind === 'return'
                            ? 'emerald'
                            : mov.kind === 'consume'
                              ? 'amber'
                              : 'sky'
                        }
                      >
                        {mov.kind}
                      </Badge>
                      <span className="font-mono font-bold text-slate-800">
                        {sku ? sku.sku : mov.item_id.slice(0, 8)}
                      </span>
                      <span className="truncate font-semibold text-slate-900">
                        {sku?.name ?? 'Inventory Item'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-slate-600">
                      {mov.reason} · {formatDateTime(mov.created_at, timezone)}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 tabular-nums">
                    <span className="font-bold text-slate-900">Qty: {mov.quantity}</span>
                    <span className="text-slate-500">Bal: {mov.balance}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <PaginationBar
          page={movPage}
          pageSize={MOVEMENTS_PAGE_SIZE}
          currentCount={movements.length}
          hasMore={movements.length === MOVEMENTS_PAGE_SIZE}
          onPageChange={setMovPage}
          label="Movements"
        />
      </section>
    )
  }

  return (
    <section aria-label="Supplier purchase orders" className="exec-surface p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Supplier Purchase Orders</h2>
          <p className="text-xs text-slate-600">
            Autopilot and manual restock drafts stay in <code>draft</code> until an owner approves
            them; marking <code>received</code> posts stock automatically.
          </p>
        </div>

        {isAdminOrOwner ? (
          <button
            type="button"
            onClick={() => {
              draftKeyRef.current = createIdempotencyKey()
              setDraftItemId(inventoryItems.find(i => !i.archived)?.id ?? '')
              setDraftModalOpen(true)
            }}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Draft Reorder PO
          </button>
        ) : null}
      </div>

      {purchaseOrders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-5 w-5" />}
          title="No purchase orders in workspace"
          description="Draft a restock PO from any SKU or enable Autopilot low-stock PO drafting."
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {purchaseOrders.map(po => {
            const sku = inventoryById.get(po.item_id)
            const totalCost = Math.round(po.quantity * po.unit_cost * 100) / 100
            const busy = busyPoId === po.id

            return (
              <li
                key={po.id}
                className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        po.status === 'received'
                          ? 'emerald'
                          : po.status === 'approved'
                            ? 'sky'
                            : po.status === 'denied'
                              ? 'rose'
                              : 'amber'
                      }
                    >
                      {po.status}
                    </Badge>
                    <span className="text-sm font-bold text-slate-900">
                      {sku ? `${sku.sku} — ${sku.name}` : `SKU ${po.item_id.slice(0, 8)}`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 tabular-nums">
                    Supplier: <strong>{po.supplier || sku?.supplier || 'Unspecified'}</strong> · Qty{' '}
                    <strong>{po.quantity}</strong> × {formatCurrency(po.unit_cost)}
                    {po.receipt_reference ? ` · Ref: ${po.receipt_reference}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="mr-1 text-sm font-extrabold text-slate-950 tabular-nums">
                    {formatCurrency(totalCost)}
                  </span>

                  {isAdminOrOwner && po.status === 'draft' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleTransitionPo(po, 'approved')}
                        className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve PO
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleTransitionPo(po, 'denied')}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs text-rose-700 touch-target"
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Deny
                      </button>
                    </>
                  ) : null}

                  {isAdminOrOwner && po.status === 'approved' ? (
                    <button
                      type="button"
                      onClick={() => {
                        receiveKeyRef.current = createIdempotencyKey()
                        setReceivePo(po)
                        setReceiptRef('')
                      }}
                      className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                    >
                      <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Mark Received
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Manual Reorder Draft Modal */}
      <Dialog
        open={draftModalOpen}
        onClose={() => setDraftModalOpen(false)}
        title="Draft Restock Purchase Order"
        description="Creates a draft PO using the SKU's configured supplier, reorder quantity, and unit cost."
      >
        <form onSubmit={handleCreatePoDraft} className="space-y-4">
          <div>
            <label htmlFor="po-draft-sku" className="exec-label">
              Inventory SKU
            </label>
            <select
              id="po-draft-sku"
              required
              value={draftItemId}
              onChange={e => setDraftItemId(e.target.value)}
              className="exec-input"
            >
              <option value="">Select SKU…</option>
              {inventoryItems
                .filter(i => !i.archived)
                .map(i => (
                  <option key={i.id} value={i.id}>
                    {i.sku} — {i.name} (Reorder {i.reorder_quantity} @{' '}
                    {formatCurrency(i.purchase_cost)})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDraftModalOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingDraft || !draftItemId}
              className="exec-btn-primary touch-target"
            >
              {creatingDraft ? 'Drafting…' : 'Create Draft PO'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Mark PO Received Modal */}
      <Dialog
        open={receivePo !== null}
        onClose={() => setReceivePo(null)}
        title="Receive Purchase Order Shipment"
        description="Increments on-hand stock and logs a receipt entry in inventory_movements."
      >
        {receivePo ? (
          <form onSubmit={handleConfirmReceive} className="space-y-4">
            <p className="text-xs text-slate-600 tabular-nums">
              Receiving <strong>{receivePo.quantity}</strong> unit(s) into warehouse inventory.
            </p>
            <div>
              <label htmlFor="po-receipt-ref" className="exec-label">
                Packing Slip / Vendor Invoice Reference (3+ characters)
              </label>
              <input
                id="po-receipt-ref"
                type="text"
                required
                minLength={3}
                placeholder="e.g., SLIP-90412"
                value={receiptRef}
                onChange={e => setReceiptRef(e.target.value)}
                className="exec-input"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReceivePo(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={receiving}
                className="exec-btn-emerald touch-target"
              >
                {receiving ? 'Posting Receipt…' : 'Confirm Shipment Received'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </section>
  )
}
