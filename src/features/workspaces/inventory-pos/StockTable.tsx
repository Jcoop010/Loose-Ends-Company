import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  Boxes,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Upload,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import { searchInventoryItems } from '../../../lib/queries'
import type {
  InventoryItem,
  InventoryMovementKind,
  OpsJob,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import {
  Badge,
  EmptyState,
  PaginationBar,
  Skeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const PAGE_SIZE = 25

interface SkuFormState {
  id?: string
  name: string
  sku: string
  barcode: string
  category: string
  supplier: string
  location: string
  description: string
  purchaseCost: string
  sellingPrice: string
  reorderThreshold: string
  reorderQuantity: string
}

const EMPTY_SKU_FORM: SkuFormState = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  supplier: '',
  location: '',
  description: '',
  purchaseCost: '0',
  sellingPrice: '0',
  reorderThreshold: '2',
  reorderQuantity: '5',
}

export interface StockTableProps {
  workspaceId: string
  isAdminOrOwner: boolean
  initialSkuQuery?: string | null
  draftJobs: OpsJob[]
  refreshSignal: number
  onOpenCsvImport: () => void
  onDraftPoCreated: () => Promise<void> | void
  onStockChanged: () => Promise<void> | void
}

export function StockTable({
  workspaceId,
  isAdminOrOwner,
  initialSkuQuery,
  draftJobs,
  refreshSignal,
  onOpenCsvImport,
  onDraftPoCreated,
  onStockChanged,
}: StockTableProps): React.ReactElement {
  const toast = useToast()

  const [query, setQuery] = useState(initialSkuQuery ?? '')
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // SKU Create / Edit Modal (`inventory_save`)
  const [skuDialogOpen, setSkuDialogOpen] = useState(false)
  const [skuForm, setSkuForm] = useState<SkuFormState>(EMPTY_SKU_FORM)
  const [savingSku, setSavingSku] = useState(false)
  const skuKeyRef = useRef<string>(createIdempotencyKey())

  // Stock Move Modal (`stock_move`)
  const [moveItem, setMoveItem] = useState<InventoryItem | null>(null)
  const [moveKind, setMoveKind] = useState<
    Extract<InventoryMovementKind, 'receipt' | 'adjustment' | 'return'>
  >('receipt')
  const [moveQty, setMoveQty] = useState('5')
  const [moveReason, setMoveReason] = useState('')
  const [movingStock, setMovingStock] = useState(false)
  const moveKeyRef = useRef<string>(createIdempotencyKey())

  // Reserve on Draft Job Modal (`reserve_material`)
  const [reserveSku, setReserveSku] = useState<InventoryItem | null>(null)
  const [reserveJobId, setReserveJobId] = useState('')
  const [reserveQty, setReserveQty] = useState('1')
  const [reserving, setReserving] = useState(false)
  const reserveKeyRef = useRef<string>(createIdempotencyKey())

  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const reqSeqRef = useRef(0)

  useEffect(() => {
    if (initialSkuQuery) {
      setQuery(initialSkuQuery)
      setPage(0)
    }
  }, [initialSkuQuery])

  const loadStockPage = useCallback(async () => {
    const seq = ++reqSeqRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await searchInventoryItems(workspaceId, query, page, PAGE_SIZE)
      if (reqSeqRef.current !== seq) return
      setItems(rows)
    } catch (err) {
      if (reqSeqRef.current !== seq) return
      setLoadError(err instanceof Error ? err.message : 'Unable to query inventory catalog.')
    } finally {
      if (reqSeqRef.current === seq) {
        setLoading(false)
      }
    }
  }, [workspaceId, query, page, refreshSignal])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadStockPage()
    }, query.trim() ? 220 : 0)
    return () => clearTimeout(timer)
  }, [loadStockPage, query])

  const visibleItems = useMemo(() => {
    if (!onlyLowStock) return items
    return items.filter(item => item.quantity - item.reserved <= item.reorder_threshold)
  }, [items, onlyLowStock])

  const openCreateSku = () => {
    skuKeyRef.current = createIdempotencyKey()
    setSkuForm(EMPTY_SKU_FORM)
    setSkuDialogOpen(true)
  }

  const openEditSku = (item: InventoryItem) => {
    skuKeyRef.current = createIdempotencyKey()
    setSkuForm({
      id: item.id,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode ?? '',
      category: item.category ?? '',
      supplier: item.supplier ?? '',
      location: item.location ?? '',
      description: item.description ?? '',
      purchaseCost: String(item.purchase_cost),
      sellingPrice: String(item.selling_price),
      reorderThreshold: String(item.reorder_threshold),
      reorderQuantity: String(item.reorder_quantity),
    })
    setSkuDialogOpen(true)
  }

  const handleSaveSku = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!skuForm.name.trim() || !skuForm.sku.trim()) return

    const purchaseCost = Number(skuForm.purchaseCost)
    const sellingPrice = Number(skuForm.sellingPrice)
    const reorderThreshold = Math.max(0, Math.trunc(Number(skuForm.reorderThreshold) || 0))
    const reorderQuantity = Math.max(1, Math.trunc(Number(skuForm.reorderQuantity) || 1))

    if (!Number.isFinite(purchaseCost) || purchaseCost < 0 || !Number.isFinite(sellingPrice) || sellingPrice < 0) {
      toast.error('Invalid pricing', 'Purchase cost and selling price must be non-negative numbers.')
      return
    }

    setSavingSku(true)
    try {
      await opsCommand(
        workspaceId,
        'inventory_save',
        {
          id: skuForm.id,
          name: skuForm.name.trim(),
          sku: skuForm.sku.trim().toUpperCase(),
          barcode: skuForm.barcode.trim() || null,
          category: skuForm.category.trim() || null,
          supplier: skuForm.supplier.trim() || null,
          location: skuForm.location.trim() || null,
          description: skuForm.description.trim() || null,
          purchase_cost: Math.round(purchaseCost * 100) / 100,
          selling_price: Math.round(sellingPrice * 100) / 100,
          reorder_threshold: reorderThreshold,
          reorder_quantity: reorderQuantity,
        },
        skuKeyRef.current,
      )
      setSkuDialogOpen(false)
      toast.success(
        skuForm.id ? 'SKU updated' : 'SKU created',
        `${skuForm.sku.trim().toUpperCase()} — ${skuForm.name.trim()}`,
      )
      await loadStockPage()
      await onStockChanged()
    } catch (err) {
      toast.error('Could not save SKU', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingSku(false)
    }
  }

  const handleSubmitStockMove = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!moveItem) return
    const qty = Number(moveQty)
    if (!Number.isFinite(qty) || qty === 0) {
      toast.error('Invalid quantity', 'Enter a non-zero movement quantity.')
      return
    }
    if ((moveKind === 'receipt' || moveKind === 'return') && qty <= 0) {
      toast.error('Positive quantity required', 'Receipts and returns must be greater than 0.')
      return
    }
    if (!moveReason.trim()) {
      toast.error('Reason required', 'Enter a brief reason for the stock ledger entry.')
      return
    }

    setMovingStock(true)
    try {
      await opsCommand(
        workspaceId,
        'stock_move',
        {
          id: moveItem.id,
          kind: moveKind,
          quantity: qty,
          reason: moveReason.trim(),
        },
        moveKeyRef.current,
      )
      setMoveItem(null)
      setMoveReason('')
      toast.success('Stock balance updated', `${moveItem.sku} (${moveKind})`)
      await loadStockPage()
      await onStockChanged()
    } catch (err) {
      toast.error('Movement blocked', err instanceof Error ? err.message : 'Check reserved stock.')
      moveKeyRef.current = createIdempotencyKey()
    } finally {
      setMovingStock(false)
    }
  }

  const handleSubmitReserve = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reserveSku || !reserveJobId) return
    const qty = Number(reserveQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Invalid quantity', 'Enter a positive reservation quantity.')
      return
    }

    setReserving(true)
    try {
      await opsCommand(
        workspaceId,
        'reserve_material',
        {
          id: reserveJobId,
          item_id: reserveSku.id,
          quantity: qty,
        },
        reserveKeyRef.current,
      )
      setReserveSku(null)
      toast.success('Material reserved on job', `${qty} × ${reserveSku.sku}`)
      await loadStockPage()
      await onStockChanged()
    } catch (err) {
      toast.error('Reservation blocked', err instanceof Error ? err.message : 'Check job draft state.')
      reserveKeyRef.current = createIdempotencyKey()
    } finally {
      setReserving(false)
    }
  }

  const handleDraftReorderPo = async (item: InventoryItem) => {
    if (busyItemId) return
    setBusyItemId(item.id)
    try {
      await opsCommand(
        workspaceId,
        'purchase_draft',
        { id: item.id },
        createIdempotencyKey(),
      )
      toast.success(
        'Draft Purchase Order queued',
        `${item.reorder_quantity} × ${item.sku} ready in Purchase Orders.`,
      )
      await onDraftPoCreated()
    } catch (err) {
      toast.error(
        'PO draft blocked',
        err instanceof Error ? err.message : 'An open PO may already exist for this SKU.',
      )
    } finally {
      setBusyItemId(null)
    }
  }

  const handleArchiveSku = async (item: InventoryItem) => {
    if (busyItemId) return
    if (item.reserved > 0) {
      toast.error(
        'Active job reservations',
        `Release ${item.reserved} reserved unit(s) before archiving ${item.sku}.`,
      )
      return
    }
    setBusyItemId(item.id)
    try {
      await opsCommand(
        workspaceId,
        'inventory_archive',
        { id: item.id },
        createIdempotencyKey(),
      )
      toast.info('SKU archived', `${item.sku} removed from active catalog.`)
      await loadStockPage()
      await onStockChanged()
    } catch (err) {
      toast.error('Archive failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <section aria-label="Inventory stock catalog" className="exec-surface overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search
              className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setPage(0)
              }}
              placeholder="Search SKU or part name on server…"
              aria-label="Search inventory items by name or SKU"
              className="exec-input pl-10"
            />
          </div>

          <button
            type="button"
            onClick={() => setOnlyLowStock(prev => !prev)}
            className={`touch-target rounded-xl px-3 py-2 text-xs font-semibold transition ${
              onlyLowStock
                ? 'bg-amber-500 text-slate-950'
                : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Low Stock Only
          </button>
        </div>

        {isAdminOrOwner ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenCsvImport}
              className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Import SKU CSV
            </button>
            <button
              type="button"
              onClick={openCreateSku}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New SKU
            </button>
          </div>
        ) : (
          <Badge tone="neutral">Read-Only Member View</Badge>
        )}
      </div>

      {loadError ? (
        <div
          role="alert"
          className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
        >
          {loadError}
        </div>
      ) : loading ? (
        <div className="p-5 space-y-2.5">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={<Boxes className="h-5 w-5" />}
            title={onlyLowStock ? 'No low-stock SKUs on this page' : 'No matching inventory SKUs'}
            description="Add parts manually or batch-import your pricebook via CSV."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">SKU & Part</th>
                <th className="py-3 px-3">Location / Supplier</th>
                <th className="py-3 px-3 text-right">On Hand</th>
                <th className="py-3 px-3 text-right">Reserved</th>
                <th className="py-3 px-3 text-right">Available</th>
                <th className="py-3 px-3 text-right">Cost / Sell</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleItems.map(item => {
                const available = item.quantity - item.reserved
                const isLow = available <= item.reorder_threshold
                const busy = busyItemId === item.id

                return (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">{item.sku}</span>
                        {isLow ? (
                          <Badge tone="rose">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Low ≤ {item.reorder_threshold}
                          </Badge>
                        ) : (
                          <Badge tone="emerald">Healthy</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">{item.name}</p>
                    </td>

                    <td className="py-3.5 px-3 text-slate-600">
                      <p className="font-medium text-slate-800">{item.location || 'Main Stock'}</p>
                      <p className="text-[11px] text-slate-500">{item.supplier || 'No supplier'}</p>
                    </td>

                    <td className="py-3.5 px-3 text-right font-semibold text-slate-900 tabular-nums">
                      {item.quantity}
                    </td>

                    <td className="py-3.5 px-3 text-right text-slate-600 tabular-nums">
                      {item.reserved}
                    </td>

                    <td
                      className={`py-3.5 px-3 text-right font-extrabold tabular-nums ${
                        isLow ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {available}
                    </td>

                    <td className="py-3.5 px-3 text-right tabular-nums">
                      <span className="text-slate-600">{formatCurrency(item.purchase_cost)}</span>
                      <span className="mx-1 text-slate-300">/</span>
                      <strong className="text-slate-900">{formatCurrency(item.selling_price)}</strong>
                    </td>

                    <td className="py-3.5 px-4">
                      {isAdminOrOwner ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              moveKeyRef.current = createIdempotencyKey()
                              setMoveItem(item)
                              setMoveKind('receipt')
                              setMoveQty(String(Math.max(1, item.reorder_quantity || 5)))
                              setMoveReason('')
                            }}
                            title="Stock receipt, return, or count adjustment"
                            className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                          >
                            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                            Stock
                          </button>

                          {available > 0 && draftJobs.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                reserveKeyRef.current = createIdempotencyKey()
                                setReserveSku(item)
                                setReserveJobId(draftJobs[0]?.id ?? '')
                                setReserveQty('1')
                              }}
                              title="Reserve material onto a draft job"
                              className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                            >
                              <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                              Allocate
                            </button>
                          ) : null}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDraftReorderPo(item)}
                            title="Create draft restock purchase order"
                            className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                          >
                            <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
                            PO
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditSku(item)}
                            aria-label={`Edit SKU ${item.sku}`}
                            className="exec-btn-secondary !px-2 !py-1.5 !text-xs touch-target"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleArchiveSku(item)}
                            aria-label={`Archive SKU ${item.sku}`}
                            className="exec-btn-secondary !px-2 !py-1.5 !text-xs text-slate-500 hover:text-rose-700 touch-target"
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span className="block text-right text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar
        page={page}
        pageSize={PAGE_SIZE}
        currentCount={items.length}
        hasMore={items.length === PAGE_SIZE}
        onPageChange={setPage}
        label="SKUs"
      />

      {/* SKU Create / Edit Modal */}
      <Dialog
        open={skuDialogOpen}
        onClose={() => setSkuDialogOpen(false)}
        title={skuForm.id ? `Edit SKU ${skuForm.sku}` : 'Create Inventory SKU'}
        description="Saved via ops_command('inventory_save') with advisory workspace lock."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSaveSku} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sku-code" className="exec-label">
                SKU Code
              </label>
              <input
                id="sku-code"
                type="text"
                required
                placeholder="CAP-45-5-440"
                value={skuForm.sku}
                onChange={e => setSkuForm(p => ({ ...p, sku: e.target.value }))}
                className="exec-input font-mono"
              />
            </div>
            <div>
              <label htmlFor="sku-name" className="exec-label">
                Part Name
              </label>
              <input
                id="sku-name"
                type="text"
                required
                placeholder="Dual Run Capacitor 45/5 MFD"
                value={skuForm.name}
                onChange={e => setSkuForm(p => ({ ...p, name: e.target.value }))}
                className="exec-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="sku-supplier" className="exec-label">
                Supplier
              </label>
              <input
                id="sku-supplier"
                type="text"
                placeholder="Johnstone Supply"
                value={skuForm.supplier}
                onChange={e => setSkuForm(p => ({ ...p, supplier: e.target.value }))}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="sku-location" className="exec-label">
                Bin / Truck Location
              </label>
              <input
                id="sku-location"
                type="text"
                placeholder="Truck Bin B-4"
                value={skuForm.location}
                onChange={e => setSkuForm(p => ({ ...p, location: e.target.value }))}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="sku-category" className="exec-label">
                Category
              </label>
              <input
                id="sku-category"
                type="text"
                placeholder="Electrical"
                value={skuForm.category}
                onChange={e => setSkuForm(p => ({ ...p, category: e.target.value }))}
                className="exec-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="sku-cost" className="exec-label">
                Unit Cost ($)
              </label>
              <input
                id="sku-cost"
                type="number"
                required
                min={0}
                step="0.01"
                value={skuForm.purchaseCost}
                onChange={e => setSkuForm(p => ({ ...p, purchaseCost: e.target.value }))}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="sku-price" className="exec-label">
                Sell Price ($)
              </label>
              <input
                id="sku-price"
                type="number"
                required
                min={0}
                step="0.01"
                value={skuForm.sellingPrice}
                onChange={e => setSkuForm(p => ({ ...p, sellingPrice: e.target.value }))}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="sku-thresh" className="exec-label">
                Min Threshold
              </label>
              <input
                id="sku-thresh"
                type="number"
                required
                min={0}
                step={1}
                value={skuForm.reorderThreshold}
                onChange={e => setSkuForm(p => ({ ...p, reorderThreshold: e.target.value }))}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="sku-reorder-qty" className="exec-label">
                Reorder Qty
              </label>
              <input
                id="sku-reorder-qty"
                type="number"
                required
                min={1}
                step={1}
                value={skuForm.reorderQuantity}
                onChange={e => setSkuForm(p => ({ ...p, reorderQuantity: e.target.value }))}
                className="exec-input tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setSkuDialogOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingSku}
              className="exec-btn-primary touch-target"
            >
              {savingSku ? 'Saving…' : skuForm.id ? 'Update SKU' : 'Create SKU'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Stock Movement Modal (`stock_move`) */}
      <Dialog
        open={moveItem !== null}
        onClose={() => setMoveItem(null)}
        title={moveItem ? `Stock Movement — ${moveItem.sku}` : 'Stock Movement'}
        description="Posts an audited movement in inventory_movements via ops_command('stock_move')."
      >
        {moveItem ? (
          <form onSubmit={handleSubmitStockMove} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="move-kind" className="exec-label">
                  Movement Type
                </label>
                <select
                  id="move-kind"
                  value={moveKind}
                  onChange={e =>
                    setMoveKind(
                      e.target.value as Extract<
                        InventoryMovementKind,
                        'receipt' | 'adjustment' | 'return'
                      >,
                    )
                  }
                  className="exec-input"
                >
                  <option value="receipt">Stock Receipt (+)</option>
                  <option value="return">Customer/Job Return (+)</option>
                  <option value="adjustment">Cycle Count Adjustment (+/-)</option>
                </select>
              </div>
              <div>
                <label htmlFor="move-qty" className="exec-label">
                  Quantity {moveKind === 'adjustment' ? '(+/-)' : '(+)'}
                </label>
                <input
                  id="move-qty"
                  type="number"
                  required
                  step={1}
                  value={moveQty}
                  onChange={e => setMoveQty(e.target.value)}
                  className="exec-input tabular-nums"
                />
              </div>
            </div>

            <div>
              <label htmlFor="move-reason" className="exec-label">
                Audit Reason
              </label>
              <input
                id="move-reason"
                type="text"
                required
                placeholder="e.g., Counter pickup invoice #8812 or Friday truck count"
                value={moveReason}
                onChange={e => setMoveReason(e.target.value)}
                className="exec-input"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setMoveItem(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={movingStock}
                className="exec-btn-primary touch-target"
              >
                {movingStock ? 'Posting…' : 'Post Stock Movement'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* Allocate SKU to Draft Job Modal (`reserve_material`) */}
      <Dialog
        open={reserveSku !== null}
        onClose={() => setReserveSku(null)}
        title={reserveSku ? `Allocate ${reserveSku.sku} to Draft Job` : 'Allocate Material'}
        description="Reserves on-hand units onto a draft work order via ops_command('reserve_material')."
      >
        {reserveSku ? (
          <form onSubmit={handleSubmitReserve} className="space-y-4">
            <div>
              <label htmlFor="alloc-job" className="exec-label">
                Draft Work Order
              </label>
              <select
                id="alloc-job"
                required
                value={reserveJobId}
                onChange={e => setReserveJobId(e.target.value)}
                className="exec-input"
              >
                {draftJobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="alloc-qty" className="exec-label">
                Quantity (Available: {reserveSku.quantity - reserveSku.reserved})
              </label>
              <input
                id="alloc-qty"
                type="number"
                required
                min={1}
                max={Math.max(1, reserveSku.quantity - reserveSku.reserved)}
                step={1}
                value={reserveQty}
                onChange={e => setReserveQty(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReserveSku(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reserving}
                className="exec-btn-primary touch-target"
              >
                {reserving ? 'Allocating…' : 'Reserve Material'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </section>
  )
}
