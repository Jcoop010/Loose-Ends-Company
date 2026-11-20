import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  FileCheck2,
  History,
  Plus,
  QrCode,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Upload,
} from 'lucide-react'
import { formatCents, formatCurrency } from '../../../lib/format'
import {
  DEFAULT_AUTONOMY_CONFIG,
  evaluateStockLevels,
  type AutoPoDraftProposal,
  type WorkspaceAutonomyConfig,
} from '../../../lib/autonomousOs'
import { fetchWorkspaceAutonomySettings } from '../../../lib/autonomousOs/queries'
import * as release2Queries from '../../../lib/autonomousOs/release2Queries'
import type { Release2InventoryBundle } from '../../../lib/autonomousOs/release2Queries'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import { useWorkspaceRealtime } from '../../../lib/realtime'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import type {
  InventoryItem,
  OpsJob,
  OpsPurchaseOrder,
} from '../../../types/domain'
import { Badge, MetricCard, MetricCardSkeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'
import { BarcodeReceivingPanel } from './BarcodeReceivingPanel'
import { InventoryCsvImport } from './InventoryCsvImport'
import { PurchaseOrdersPanel } from './PurchaseOrdersPanel'
import { StockTable } from './StockTable'
import { ThreeWayMatchPanel } from './ThreeWayMatchPanel'

type InventoryTab = 'catalog' | 'receiving' | 'matching' | 'orders' | 'movements'

function parseInventoryTab(raw: string | null): InventoryTab {
  if (
    raw === 'receiving' ||
    raw === 'matching' ||
    raw === 'orders' ||
    raw === 'movements'
  ) {
    return raw
  }
  return 'catalog'
}

interface InventoryWorkspaceData {
  items: InventoryItem[]
  purchaseOrders: OpsPurchaseOrder[]
  draftJobs: OpsJob[]
  r2: Release2InventoryBundle
  autonomyConfig: WorkspaceAutonomyConfig
}

export function InventoryPosPage(): React.ReactElement {
  const { workspace, isAdminOrOwner, settings } = useSession()
  const { getParam, setParams } = useAppRouter()
  const toast = useToast()

  const activeTab = parseInventoryTab(getParam('tab'))
  const skuParam = getParam('sku')

  const [data, setData] = useState<InventoryWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [csvImportOpen, setCsvImportOpen] = useState(false)
  const [stockRefreshSignal, setStockRefreshSignal] = useState(0)
  const [stagingVendor, setStagingVendor] = useState<string | null>(null)

  const [showAddSku, setShowAddSku] = useState(false)
  const [skuInput, setSkuInput] = useState('')
  const [skuName, setSkuName] = useState('')
  const [skuLocation, setSkuLocation] = useState('Main Warehouse')
  const [skuBin, setSkuBin] = useState('A-01')
  const [skuOnHand, setSkuOnHand] = useState('12')
  const [skuReorderPt, setSkuReorderPt] = useState('15')
  const [skuReorderQty, setSkuReorderQty] = useState('25')
  const [skuCostDollars, setSkuCostDollars] = useState('42.00')
  const [skuVendor, setSkuVendor] = useState('Apex Supply Co')
  const [savingSku, setSavingSku] = useState(false)

  const reqSeqRef = useRef(0)
  const workspaceId = workspace?.id ?? null

  const loadInventoryWorkspace = useCallback(
    async (isBackground = false) => {
      if (!workspaceId) return
      const seq = ++reqSeqRef.current
      const shouldAbort = () => reqSeqRef.current !== seq

      if (isBackground) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const [items, purchaseOrders, jobs, r2, autonomyConfig] = await Promise.all([
          fetchAllWorkspaceRows<InventoryItem>({
            table: 'inventory_items',
            workspaceId,
            orderBy: 'sku',
            ascending: true,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<OpsPurchaseOrder>({
            table: 'ops_purchase_orders',
            workspaceId,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<OpsJob>({
            table: 'ops_jobs',
            workspaceId,
            shouldAbort,
          }),
          release2Queries.fetchRelease2InventoryData(workspaceId),
          fetchWorkspaceAutonomySettings(workspaceId).catch(() => DEFAULT_AUTONOMY_CONFIG),
        ])

        if (shouldAbort()) return
        if (!items || !purchaseOrders || !jobs) return

        setData({
          items,
          purchaseOrders,
          draftJobs: jobs.filter(j => j.status === 'draft'),
          r2,
          autonomyConfig,
        })
        setStockRefreshSignal(prev => prev + 1)
      } catch (err) {
        if (shouldAbort()) return
        setError(
          err instanceof Error ? err.message : 'Unable to load Inventory & POs workspace.',
        )
      } finally {
        if (!shouldAbort()) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    void loadInventoryWorkspace(false)
    return () => {
      reqSeqRef.current += 1
    }
  }, [loadInventoryWorkspace])

  useWorkspaceRealtime(workspaceId, () => {
    void loadInventoryWorkspace(true)
  })

  const inventoryById = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of data?.items ?? []) {
      map.set(item.id, item)
    }
    return map
  }, [data?.items])

  const stockEvaluation = useMemo(() => {
    if (!data || !workspaceId) {
      return evaluateStockLevels([], DEFAULT_AUTONOMY_CONFIG)
    }
    return evaluateStockLevels(data.r2.inventoryItems, data.autonomyConfig, {
      workspaceId,
    })
  }, [data, workspaceId])

  const proposalBySku = useMemo(() => {
    const map = new Map<string, AutoPoDraftProposal>()
    for (const proposal of stockEvaluation.auto_po_drafts) {
      for (const line of proposal.items) {
        map.set(line.sku, proposal)
      }
    }
    return map
  }, [stockEvaluation])

  const metrics = useMemo(() => {
    const activeItems = (data?.items ?? []).filter(i => !i.archived)
    const lowStockCount = stockEvaluation.total_low_stock_count
    const stockValue = activeItems.reduce(
      (sum, i) => sum + i.quantity * i.purchase_cost,
      0,
    )
    const openR2Pos = (data?.r2.purchaseOrders ?? []).filter(
      p => p.status !== 'received' && p.status !== 'closed',
    ).length
    const legacyApprovedPos = (data?.purchaseOrders ?? []).filter(
      p => p.status === 'approved',
    ).length
    const exceptionBills = (data?.r2.vendorBills ?? []).filter(
      b => b.match_status === 'exception_flagged' || b.match_status === 'disputed',
    ).length

    return {
      activeCount: activeItems.length,
      lowStockCount,
      stockValue: Math.round(stockValue * 100) / 100,
      autoPosReady: stockEvaluation.auto_po_drafts.length,
      openPos: openR2Pos + legacyApprovedPos,
      exceptionBills,
    }
  }, [data, stockEvaluation])

  const switchTab = (next: InventoryTab) => {
    setParams({
      tab: next === 'catalog' ? null : next,
    })
  }

  const handleStageAutoPo = async (proposal: AutoPoDraftProposal) => {
    if (!workspaceId || !data || stagingVendor) return
    setStagingVendor(proposal.vendor_name)
    try {
      const result = await release2Queries.stageAutoPoInDb({
        workspaceId,
        proposal,
        config: data.autonomyConfig,
      })
      toast.success(
        `Staged Auto-PO ${result.po.po_number}`,
        `${result.po.vendor_name} · ${formatCents(result.po.total_cents)} (${result.po.status})`,
      )
      await loadInventoryWorkspace(true)
    } catch (err) {
      toast.error('Auto-PO staging failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setStagingVendor(null)
    }
  }

  const handleSaveR2Sku = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || savingSku) return
    const costCents = Math.max(0, Math.round(Number(skuCostDollars || 0) * 100))
    const onHand = Math.max(0, Math.trunc(Number(skuOnHand || 0)))
    const reorderPt = Math.max(0, Math.trunc(Number(skuReorderPt || 0)))
    const reorderQ = Math.max(1, Math.trunc(Number(skuReorderQty || 1)))

    if (!skuInput.trim() || !skuName.trim()) {
      toast.error('SKU and Name are required', 'Fill in SKU code and product description.')
      return
    }

    setSavingSku(true)
    try {
      await release2Queries.upsertRelease2Sku({
        workspaceId,
        sku: skuInput,
        name: skuName,
        location: skuLocation,
        bin_code: skuBin,
        on_hand_qty: onHand,
        reserved_qty: 0,
        reorder_point_qty: reorderPt,
        reorder_qty: reorderQ,
        unit_cost_cents: costCents,
        unit_price_cents: costCents * 2,
        preferred_vendor: skuVendor,
        lead_time_days: 5,
      })
      toast.success('SKU saved', `${skuInput.trim().toUpperCase()} (${onHand} on hand)`)
      setSkuInput('')
      setSkuName('')
      setShowAddSku(false)
      await loadInventoryWorkspace(true)
    } catch (err) {
      toast.error('SKU save failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingSku(false)
    }
  }

  if (!workspaceId) {
    return <div />
  }

  const tabs: Array<{
    id: InventoryTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'catalog', label: 'SKU Catalog & Auto-PO', icon: Boxes },
    { id: 'receiving', label: 'Barcode / QR Receiving', icon: QrCode },
    { id: 'matching', label: '3-Way Match Queue', icon: FileCheck2 },
    { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart },
    { id: 'movements', label: 'Movement History', icon: History },
  ]

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Active SKUs"
            value={metrics.activeCount}
            subtitle={`On-hand value ${formatCurrency(metrics.stockValue)}`}
            accent="slate"
          />
          <MetricCard
            label="Low-Stock Alerts"
            value={metrics.lowStockCount}
            subtitle={`${metrics.autoPosReady} Auto-PO draft(s) ready`}
            accent={metrics.lowStockCount > 0 ? 'rose' : 'emerald'}
            onClick={() => switchTab('catalog')}
          />
          <MetricCard
            label="Open Inbound POs"
            value={metrics.openPos}
            subtitle="Ready for Barcode GRN"
            accent="brand"
            onClick={() => switchTab('receiving')}
          />
          <MetricCard
            label="3-Way Match Flags"
            value={metrics.exceptionBills}
            subtitle={`${data.r2.vendorBills.length} total vendor bill(s)`}
            accent={metrics.exceptionBills > 0 ? 'rose' : 'emerald'}
            onClick={() => switchTab('matching')}
          />
        </div>
      ) : null}

      {/* Tabs + Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Inventory and Purchase Orders views"
          className="flex flex-wrap items-center gap-1.5"
        >
          {tabs.map(tab => {
            const Icon = tab.icon
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => switchTab(tab.id)}
                className={`touch-target inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                  selected
                    ? 'bg-[#c2410c] text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdminOrOwner ? (
            <>
              <button
                type="button"
                onClick={() => setShowAddSku(v => !v)}
                className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add / Update SKU
              </button>
              <button
                type="button"
                onClick={() => setCsvImportOpen(true)}
                className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                CSV Batch Import
              </button>
            </>
          ) : null}

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadInventoryWorkspace(true)}
            className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {refreshing ? 'Syncing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-900"
        >
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          {activeTab === 'catalog' ? (
            <div className="space-y-6">
              {showAddSku ? (
                <form
                  onSubmit={e => void handleSaveR2Sku(e)}
                  className="exec-surface p-5 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Add / Update Procurement SKU
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowAddSku(false)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                    >
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">SKU</label>
                      <input
                        required
                        value={skuInput}
                        onChange={e => setSkuInput(e.target.value)}
                        placeholder="VALVE-42"
                        className="exec-input w-full text-xs font-mono uppercase"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Item Name</label>
                      <input
                        required
                        value={skuName}
                        onChange={e => setSkuName(e.target.value)}
                        placeholder="Brass Control Valve"
                        className="exec-input w-full text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Vendor</label>
                      <input
                        value={skuVendor}
                        onChange={e => setSkuVendor(e.target.value)}
                        className="exec-input w-full text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Location</label>
                      <input
                        value={skuLocation}
                        onChange={e => setSkuLocation(e.target.value)}
                        className="exec-input w-full text-xs"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Bin</label>
                      <input
                        value={skuBin}
                        onChange={e => setSkuBin(e.target.value)}
                        className="exec-input w-full text-xs font-mono"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">On Hand</label>
                      <input
                        type="number"
                        min="0"
                        value={skuOnHand}
                        onChange={e => setSkuOnHand(e.target.value)}
                        className="exec-input w-full text-xs tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Reorder Pt</label>
                      <input
                        type="number"
                        min="0"
                        value={skuReorderPt}
                        onChange={e => setSkuReorderPt(e.target.value)}
                        className="exec-input w-full text-xs tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Reorder Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={skuReorderQty}
                        onChange={e => setSkuReorderQty(e.target.value)}
                        className="exec-input w-full text-xs tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Unit $</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={skuCostDollars}
                        onChange={e => setSkuCostDollars(e.target.value)}
                        className="exec-input w-full text-xs tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        disabled={savingSku}
                        className="exec-btn-primary w-full !px-2.5 !py-2 !text-xs"
                      >
                        {savingSku ? '…' : 'Save SKU'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}

              {/* Release 2 Live SKU Table with On-Hand, Reserved, Available, Reorder Point, Bin & 1-Click Stage Auto-PO */}
              <section className="exec-surface p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
                      <h3 className="text-base font-bold text-slate-900">
                        Live Procurement Stock &amp; Auto-PO Matrix ({stockEvaluation.evaluated_items.length})
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600">
                      Available = On-Hand − Reserved. Click <strong>Stage Auto-PO</strong> on any low-stock SKU to batch its preferred supplier PO into the Agent Action Ledger.
                    </p>
                  </div>
                  <Badge tone={stockEvaluation.total_low_stock_count > 0 ? 'rose' : 'emerald'}>
                    {stockEvaluation.total_low_stock_count} Below Reorder Point
                  </Badge>
                </div>

                {stockEvaluation.evaluated_items.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No active SKUs yet. Use <strong>Add / Update SKU</strong> above or CSV Batch Import below to add stock items.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                        <tr>
                          <th className="px-3.5 py-2.5">SKU &amp; Item</th>
                          <th className="px-3.5 py-2.5">Bin / Location</th>
                          <th className="px-3.5 py-2.5 text-right">On-Hand</th>
                          <th className="px-3.5 py-2.5 text-right">Reserved</th>
                          <th className="px-3.5 py-2.5 text-right">Available</th>
                          <th className="px-3.5 py-2.5 text-right">Reorder Pt</th>
                          <th className="px-3.5 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {stockEvaluation.evaluated_items.map(row => {
                          const proposal = proposalBySku.get(row.sku)
                          return (
                            <tr key={row.item_id} className={row.is_low_stock ? 'bg-rose-50/40' : ''}>
                              <td className="px-3.5 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-slate-900">{row.sku}</span>
                                  {row.is_low_stock ? <Badge tone="rose">Low</Badge> : null}
                                </div>
                                <p className="text-slate-600">
                                  {row.name} · {row.preferred_vendor} ({formatCents(row.unit_cost_cents)})
                                </p>
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-600">
                                {row.bin_code ? `${row.bin_code} · ` : ''}
                                {row.location || 'Main'}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-semibold tabular-nums">
                                {row.on_hand_qty}
                              </td>
                              <td className="px-3.5 py-2.5 text-right text-slate-600 tabular-nums">
                                {row.reserved_qty}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-bold tabular-nums">
                                <span className={row.is_low_stock ? 'text-rose-700' : 'text-emerald-700'}>
                                  {row.available_qty}
                                </span>
                              </td>
                              <td className="px-3.5 py-2.5 text-right text-slate-600 tabular-nums">
                                {row.reorder_point_qty}
                              </td>
                              <td className="px-3.5 py-2.5 text-right">
                                {row.is_low_stock && proposal ? (
                                  <button
                                    type="button"
                                    disabled={stagingVendor !== null}
                                    onClick={() => void handleStageAutoPo(proposal)}
                                    className="exec-btn-primary !px-2.5 !py-1 !text-[11px]"
                                  >
                                    {stagingVendor === proposal.vendor_name
                                      ? 'Staging…'
                                      : `Stage Auto-PO (${row.reorder_qty})`}
                                  </button>
                                ) : (
                                  <span className="text-[11px] font-medium text-emerald-700">Stocked</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <StockTable
                workspaceId={workspaceId}
                isAdminOrOwner={isAdminOrOwner}
                initialSkuQuery={skuParam}
                draftJobs={data.draftJobs}
                refreshSignal={stockRefreshSignal}
                onOpenCsvImport={() => setCsvImportOpen(true)}
                onDraftPoCreated={async () => {
                  await loadInventoryWorkspace(true)
                  switchTab('orders')
                }}
                onStockChanged={() => loadInventoryWorkspace(true)}
              />
            </div>
          ) : null}

          {activeTab === 'receiving' ? (
            <BarcodeReceivingPanel
              workspaceId={workspaceId}
              purchaseOrders={data.r2.purchaseOrders}
              poItemsByPo={data.r2.poItemsByPo}
              goodsReceipts={data.r2.goodsReceipts}
              onReceiptLogged={() => loadInventoryWorkspace(true)}
            />
          ) : null}

          {activeTab === 'matching' ? (
            <ThreeWayMatchPanel
              workspaceId={workspaceId}
              purchaseOrders={data.r2.purchaseOrders}
              poItemsByPo={data.r2.poItemsByPo}
              receiptsByPo={data.r2.receiptsByPo}
              vendorBills={data.r2.vendorBills}
              autonomyConfig={data.autonomyConfig}
              onChanged={() => loadInventoryWorkspace(true)}
            />
          ) : null}

          {activeTab === 'orders' || activeTab === 'movements' ? (
            <PurchaseOrdersPanel
              mode={activeTab}
              workspaceId={workspaceId}
              isAdminOrOwner={isAdminOrOwner}
              purchaseOrders={data.purchaseOrders}
              inventoryItems={data.items}
              inventoryById={inventoryById}
              timezone={settings?.timezone}
              onChanged={() => loadInventoryWorkspace(true)}
            />
          ) : null}
        </>
      ) : null}

      {isAdminOrOwner ? (
        <InventoryCsvImport
          open={csvImportOpen}
          onClose={() => setCsvImportOpen(false)}
          workspaceId={workspaceId}
          onImported={() => loadInventoryWorkspace(true)}
        />
      ) : null}
    </div>
  )
}
