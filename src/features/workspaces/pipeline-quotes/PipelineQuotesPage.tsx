import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileSpreadsheet,
  MailCheck,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'
import { fetchAllWorkspaceRows } from '../../../lib/queries'
import { useWorkspaceRealtime } from '../../../lib/realtime'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import type {
  ConsentEvent,
  Customer,
  DocumentRecord,
  InventoryItem,
  LooseEnd,
  Opportunity,
  OpsJob,
  OpsQuoteApproval,
  OpsQuoteRevision,
} from '../../../types/domain'
import { MetricCardSkeleton } from '../../../components/ui/MetricCard'
import { ConsentDraftsPanel, type DraftPrefillRequest } from './ConsentDraftsPanel'
import { Customer360Drawer } from './Customer360Drawer'
import { OpportunityBoard } from './OpportunityBoard'
import { QuotesDocumentsPanel } from './QuotesDocumentsPanel'

type PipelineTab = 'queue' | 'customers' | 'quotes' | 'drafts'

function parsePipelineTab(raw: string | null): PipelineTab {
  if (raw === 'customers' || raw === 'quotes' || raw === 'drafts') return raw
  return 'queue'
}

interface PipelineWorkspaceData {
  customers: Customer[]
  opportunities: Opportunity[]
  looseEnds: LooseEnd[]
  documents: DocumentRecord[]
  jobs: OpsJob[]
  quoteRevisions: OpsQuoteRevision[]
  quoteApprovals: OpsQuoteApproval[]
  inventoryItems: InventoryItem[]
  consentEvents: ConsentEvent[]
}

export function PipelineQuotesPage(): React.ReactElement {
  const { workspace, settings } = useSession()
  const { getParam, setParams } = useAppRouter()

  const urlTab = getParam('tab')
  const urlCustomer = getParam('customer')
  const urlOpportunity = getParam('opportunity')

  const activeTab: PipelineTab = urlCustomer && !urlTab ? 'customers' : parsePipelineTab(urlTab)

  const [data, setData] = useState<PipelineWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftPrefill, setDraftPrefill] = useState<DraftPrefillRequest | null>(null)

  const reqSeqRef = useRef(0)
  const workspaceId = workspace?.id ?? null

  const loadWorkspaceData = useCallback(
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
        const [
          customers,
          opportunities,
          looseEnds,
          documents,
          jobs,
          quoteRevisions,
          quoteApprovals,
          inventoryItems,
          consentEvents,
        ] = await Promise.all([
          fetchAllWorkspaceRows<Customer>({ table: 'customers', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<Opportunity>({ table: 'opportunities', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<LooseEnd>({ table: 'loose_ends', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<DocumentRecord>({ table: 'documents', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<OpsJob>({ table: 'ops_jobs', workspaceId, shouldAbort }),
          fetchAllWorkspaceRows<OpsQuoteRevision>({
            table: 'ops_quote_revisions',
            workspaceId,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<OpsQuoteApproval>({
            table: 'ops_quote_approvals',
            workspaceId,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<InventoryItem>({
            table: 'inventory_items',
            workspaceId,
            shouldAbort,
          }),
          fetchAllWorkspaceRows<ConsentEvent>({
            table: 'customer_contact_consent_events',
            workspaceId,
            shouldAbort,
          }),
        ])

        if (shouldAbort()) return
        if (
          !customers ||
          !opportunities ||
          !looseEnds ||
          !documents ||
          !jobs ||
          !quoteRevisions ||
          !quoteApprovals ||
          !inventoryItems ||
          !consentEvents
        ) {
          return
        }

        setData({
          customers,
          opportunities,
          looseEnds,
          documents,
          jobs,
          quoteRevisions,
          quoteApprovals,
          inventoryItems,
          consentEvents,
        })
      } catch (err) {
        if (shouldAbort()) return
        setError(
          err instanceof Error ? err.message : 'Unable to load Pipeline & Quotes workspace.',
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
    void loadWorkspaceData(false)
    return () => {
      reqSeqRef.current += 1
    }
  }, [loadWorkspaceData])

  useWorkspaceRealtime(workspaceId, () => {
    void loadWorkspaceData(true)
  })

  const customersById = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const c of data?.customers ?? []) {
      map.set(c.id, c)
    }
    return map
  }, [data?.customers])

  const inventoryById = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of data?.inventoryItems ?? []) {
      map.set(item.id, item)
    }
    return map
  }, [data?.inventoryItems])

  const switchTab = (next: PipelineTab) => {
    setParams({
      tab: next === 'queue' ? null : next,
      customer: next === 'customers' ? urlCustomer : null,
    })
  }

  if (!workspaceId) {
    return <div />
  }

  const tabs: Array<{
    id: PipelineTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'queue', label: 'Recovery Queue', icon: TrendingUp },
    { id: 'customers', label: 'Customers 360', icon: Users },
    { id: 'quotes', label: 'Quotes & Invoices', icon: FileSpreadsheet },
    { id: 'drafts', label: 'Comm Drafts', icon: MailCheck },
  ]

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Sync Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Pipeline and Quotes views"
          className="flex flex-wrap items-center gap-1.5"
        >
          {tabs.map(t => {
            const Icon = t.icon
            const isSelected = activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => switchTab(t.id)}
                className={`touch-target inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t.label}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadWorkspaceData(true)}
          className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target self-start sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-900"
        >
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : data ? (
        <>
          {activeTab === 'queue' ? (
            <OpportunityBoard
              workspaceId={workspaceId}
              opportunities={data.opportunities}
              looseEnds={data.looseEnds}
              customersById={customersById}
              highlightedOpportunityId={urlOpportunity}
              timezone={settings?.timezone}
              onClearHighlight={() => setParams({ opportunity: null })}
              onInspectCustomer={customerId => {
                setParams({ tab: 'customers', customer: customerId })
              }}
              onPrepareDraft={req => {
                setDraftPrefill(req)
                setParams({ tab: 'drafts' })
              }}
              onDataChanged={() => loadWorkspaceData(true)}
            />
          ) : null}

          {activeTab === 'customers' ? (
            <Customer360Drawer
              workspaceId={workspaceId}
              selectedCustomerId={urlCustomer}
              onSelectCustomer={customerId => {
                setParams({ tab: 'customers', customer: customerId })
              }}
              timezone={settings?.timezone}
              onCustomersChanged={() => loadWorkspaceData(true)}
            />
          ) : null}

          {activeTab === 'quotes' ? (
            <QuotesDocumentsPanel
              workspaceId={workspaceId}
              workspaceName={workspace?.name ?? 'Workspace'}
              documents={data.documents}
              jobs={data.jobs}
              quoteRevisions={data.quoteRevisions}
              quoteApprovals={data.quoteApprovals}
              inventoryById={inventoryById}
              customers={data.customers}
              customersById={customersById}
              timezone={settings?.timezone}
              onChanged={() => loadWorkspaceData(true)}
            />
          ) : null}

          {activeTab === 'drafts' ? (
            <ConsentDraftsPanel
              workspaceId={workspaceId}
              customers={data.customers}
              customersById={customersById}
              opportunities={data.opportunities}
              consentEvents={data.consentEvents}
              prefill={draftPrefill}
              onClearPrefill={() => setDraftPrefill(null)}
              timezone={settings?.timezone}
              onConsentOrDraftsChanged={() => loadWorkspaceData(true)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
