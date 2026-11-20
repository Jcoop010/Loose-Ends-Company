import React, { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { type CommandRouterSnapshot } from '../../lib/autonomousOs'
import { reverseLedgerEntryInDb } from '../../lib/autonomousOs/queries'
import { fetchCommandBarSnapshot } from '../../lib/autonomousOs/release3Queries'
import { searchCustomers, searchInventoryItems } from '../../lib/queries'
import { DASHBOARD_ROUTES, useAppRouter } from '../../state/RouterContext'
import type { Customer, InventoryItem } from '../../types/domain'
import { useToast } from '../ui/Toast'
import { CommandBarModal } from './CommandBarModal'

const EMPTY_SNAPSHOT: CommandRouterSnapshot = {
  invoices: [],
  inventoryItems: [],
  complianceItems: [],
  sops: [],
  ledgerEntries: [],
  baselineBalanceCents: 2500000,
  safetyBufferCents: 500000,
}

export function GlobalSearch({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}): React.ReactElement {
  const { navigate } = useAppRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [skus, setSkus] = useState<InventoryItem[]>([])
  const [snapshot, setSnapshot] = useState<CommandRouterSnapshot>(EMPTY_SNAPSHOT)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open || !workspaceId) return undefined
    let active = true
    void fetchCommandBarSnapshot(workspaceId)
      .then(snap => {
        if (active) setSnapshot(snap)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [open, workspaceId])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCustomers([])
      setSkus([])
      setSearchError(null)
      setSearching(false)
      return undefined
    }

    const trimmed = query.trim()
    if (!workspaceId || trimmed.length < 2) {
      setCustomers([])
      setSkus([])
      setSearchError(null)
      setSearching(false)
      return undefined
    }

    let cancelled = false
    setSearching(true)
    setSearchError(null)

    const timer = setTimeout(() => {
      void Promise.all([
        searchCustomers(workspaceId, trimmed, 6),
        searchInventoryItems(workspaceId, trimmed, 0, 6),
      ])
        .then(([custRes, skuRes]) => {
          if (cancelled) return
          setCustomers(custRes)
          setSkus(skuRes)
        })
        .catch(err => {
          if (cancelled) return
          setSearchError(err instanceof Error ? err.message : 'Search temporarily unavailable.')
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false)
          }
        })
    }, 220)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, workspaceId])

  const handleSelectCustomer = (customer: Customer) => {
    setOpen(false)
    navigate(`${DASHBOARD_ROUTES.pipeline}?customer=${encodeURIComponent(customer.id)}`)
  }

  const handleSelectSku = (item: InventoryItem) => {
    setOpen(false)
    navigate(`${DASHBOARD_ROUTES.inventory}?sku=${encodeURIComponent(item.sku)}`)
  }

  const handleUndoLedgerAction = async (ledgerEntryId: string) => {
    if (!workspaceId) return
    const target = snapshot.ledgerEntries.find(e => e.id === ledgerEntryId)
    if (!target) return
    try {
      await reverseLedgerEntryInDb({ workspaceId, entry: target })
      toast.success('Action reversed (1-Click Undo)', target.summary)
      const refreshed = await fetchCommandBarSnapshot(workspaceId)
      setSnapshot(refreshed)
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry.')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open global command bar (Command or Control + K)"
        className="touch-target inline-flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-600 shadow-2xs hover:border-slate-400 hover:text-slate-900 min-w-[44px] sm:min-w-[240px]"
      >
        <span className="inline-flex items-center gap-2 truncate">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="hidden sm:inline truncate">Command Bar · Search or What-If…</span>
        </span>
        <kbd className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
          ⌘K
        </kbd>
      </button>

      <CommandBarModal
        open={open}
        onClose={() => setOpen(false)}
        snapshot={snapshot}
        query={query}
        onQueryChange={setQuery}
        customers={customers}
        skus={skus}
        searching={searching}
        searchError={searchError}
        onSelectCustomer={handleSelectCustomer}
        onSelectSku={handleSelectSku}
        onNavigateRoute={route => navigate(route)}
        onUndoLedgerAction={handleUndoLedgerAction}
      />
    </>
  )
}
