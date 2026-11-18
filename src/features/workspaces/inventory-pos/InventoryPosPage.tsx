import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, History, RefreshCw, ShoppingCart, Upload } from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import { useWorkspaceRealtime } from '../../../lib/realtime'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import type {
  InventoryItem,
  OpsJob,
  OpsPurchaseOrder,
} from '../../../types/domain'
import { MetricCard, MetricCardSkeleton } from '../../../components/ui/MetricCard'
import { InventoryCsvImport } from './InventoryCsvImport'
import { PurchaseOrdersPanel } from './PurchaseOrdersPanel'
import { StockTable } from './StockTable'

type InventoryTab = 'catalog' | 'orders' | 'movements'

function parseInventoryTab(raw: string | null): InventoryTab {
  if (raw === 'orders' || raw === 'movements') return raw
  return 'catalog'
}

interface InventoryWorkspaceData {
  items: InventoryItem[]
  purchaseOrders: OpsPurchaseOrder[]
  draftJobs: OpsJob[]
}

export function InventoryPosPage(): React.ReactElement {
  const { workspace, isAdminOrOwner, settings } = useSession()
  const { getParam, setParams } = useAppRouter()

  const activeTab = parseInventoryTab(getParam('tab'))
  const skuParam = getParam('sku')

  const [data, setData] = useState<InventoryWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [csvImportOpen, setCsvImportOpen] = useState(false)
  const [stockRefreshSignal, setStockRefreshSignal] = useState(0)

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
        const [items, purchaseOrders, jobs] = await Promise.all([
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
        ])

        if (shouldAbort()) return
        if (!items || !purchaseOrders || !jobs) return

        setData({
          items,
          purchaseOrders,
          draftJobs: jobs.filter(j => j.status === 'draft'),
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

  const metrics = useMemo(() => {
    const activeItems = (data?.items ?? []).filter(i => !i.archived)
    const lowStockCount = activeItems.filter(
      i => i.quantity - i.reserved <= i.reorder_threshold,
    ).length
    const stockValue = activeItems.reduce(
      (sum, i) => sum + i.quantity * i.purchase_cost,
      0,
    )
    const draftPos = (data?.purchaseOrders ?? []).filter(p => p.status === 'draft').length
    const approvedPos = (data?.purchaseOrders ?? []).filter(
      p => p.status === 'approved',
    ).length

    return {
      activeCount: activeItems.length,
      lowStockCount,
      stockValue: Math.round(stockValue * 100) / 100,
      draftPos,
      approvedPos,
    }
  }, [data])

  const switchTab = (next: InventoryTab) => {
    setParams({
      tab: next === 'catalog' ? null : next,
    })
  }

  if (!workspaceId) {
    return <div />
  }

  const tabs: Array<{
    id: InventoryTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'catalog', label: 'Stock Catalog', icon: Boxes },
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
            subtitle="Available ≤ reorder threshold"
            accent={metrics.lowStockCount > 0 ? 'rose' : 'emerald'}
            onClick={() => switchTab('catalog')}
          />
          <MetricCard
            label="Draft POs"
            value={metrics.draftPos}
            subtitle="Awaiting owner sign-off"
            accent={metrics.draftPos > 0 ? 'amber' : 'slate'}
            onClick={() => switchTab('orders')}
          />
          <MetricCard
            label="Open Inbound POs"
            value={metrics.approvedPos}
            subtitle="Approved & awaiting receipt"
            accent="sky"
            onClick={() => switchTab('orders')}
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
                    ? 'bg-slate-900 text-white shadow-xs'
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
            <button
              type="button"
              onClick={() => setCsvImportOpen(true)}
              className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              CSV Batch Import
            </button>
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
