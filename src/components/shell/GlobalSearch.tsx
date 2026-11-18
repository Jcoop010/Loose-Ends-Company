import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  FileSpreadsheet,
  LayoutDashboard,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { customerDisplayName, formatCurrency } from '../../lib/format'
import { searchCustomers, searchInventoryItems } from '../../lib/queries'
import {
  DASHBOARD_ROUTES,
  useAppRouter,
  type DashboardSection,
} from '../../state/RouterContext'
import type { Customer, InventoryItem } from '../../types/domain'
import { Dialog } from '../ui/Dialog'
import { Badge } from '../ui/MetricCard'

const WORKSPACE_QUICK_JUMPS: Array<{
  section: DashboardSection
  title: string
  subtitle: string
  icon: React.ReactNode
}> = [
  {
    section: 'command',
    title: 'Command Center',
    subtitle: 'Executive KPIs, verified collections, leak scanner & invoice aging',
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    section: 'pipeline',
    title: 'Pipeline & Quotes',
    subtitle: 'Customers, estimates, quote approvals & consent-gated follow-up',
    icon: <FileSpreadsheet className="h-4 w-4" />,
  },
  {
    section: 'dispatch',
    title: 'Dispatch & Jobs',
    subtitle: 'Work orders, technician calendar, checklists & recurring plans',
    icon: <CalendarClock className="h-4 w-4" />,
  },
  {
    section: 'inventory',
    title: 'Inventory & POs',
    subtitle: 'SKU stock ledger, job reservations & restock purchase orders',
    icon: <Boxes className="h-4 w-4" />,
  },
  {
    section: 'autopilot',
    title: 'Autopilot & Billing',
    subtitle: 'Coordination policy, approval queues, integrations & subscription',
    icon: <ShieldCheck className="h-4 w-4" />,
  },
]

export function GlobalSearch({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}): React.ReactElement {
  const { navigate, navigateSection } = useAppRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [skus, setSkus] = useState<InventoryItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const reqSeqRef = useRef(0)

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

    const seq = ++reqSeqRef.current
    setSearching(true)
    setSearchError(null)

    const timer = setTimeout(() => {
      void Promise.all([
        searchCustomers(workspaceId, trimmed, 6),
        searchInventoryItems(workspaceId, trimmed, 0, 6),
      ])
        .then(([custRes, skuRes]) => {
          if (reqSeqRef.current !== seq) return
          setCustomers(custRes)
          setSkus(skuRes)
        })
        .catch(err => {
          if (reqSeqRef.current !== seq) return
          setSearchError(err instanceof Error ? err.message : 'Search temporarily unavailable.')
        })
        .finally(() => {
          if (reqSeqRef.current === seq) {
            setSearching(false)
          }
        })
    }, 220)

    return () => clearTimeout(timer)
  }, [open, query, workspaceId])

  const matchingWorkspaces = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return WORKSPACE_QUICK_JUMPS
    return WORKSPACE_QUICK_JUMPS.filter(
      item =>
        item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
    )
  }, [query])

  const handleSelectWorkspace = (section: DashboardSection) => {
    setOpen(false)
    navigateSection(section)
  }

  const handleSelectCustomer = (customer: Customer) => {
    setOpen(false)
    navigate(`${DASHBOARD_ROUTES.pipeline}?customer=${encodeURIComponent(customer.id)}`)
  }

  const handleSelectSku = (item: InventoryItem) => {
    setOpen(false)
    navigate(`${DASHBOARD_ROUTES.inventory}?sku=${encodeURIComponent(item.sku)}`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open global workspace search (Command or Control + K)"
        className="touch-target inline-flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-600 shadow-2xs hover:border-slate-400 hover:text-slate-900 min-w-[44px] sm:min-w-[240px]"
      >
        <span className="inline-flex items-center gap-2 truncate">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="hidden sm:inline truncate">Search customers, SKUs, views…</span>
        </span>
        <kbd className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
          ⌘K
        </kbd>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Quick Jump & Ledger Search"
        description="Search customers and inventory SKUs on the server or jump straight to a workspace."
        maxWidthClass="max-w-xl"
        initialFocusRef={inputRef}
      >
        <div className="space-y-5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a customer name, phone, email, SKU, or workspace…"
              aria-label="Search customers, SKUs, or workspaces"
              className="exec-input pl-10"
            />
          </div>

          {searchError ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
            >
              {searchError}
            </div>
          ) : null}

          {query.trim().length >= 2 ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Customers
                  </span>
                  {searching ? (
                    <span className="text-xs text-slate-400">Searching…</span>
                  ) : null}
                </div>
                {customers.length === 0 && !searching ? (
                  <p className="text-xs text-slate-500 py-1">No matching customers found.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {customers.map(customer => (
                      <li key={customer.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectCustomer(customer)}
                          className="touch-target flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-slate-900">
                                {customerDisplayName(customer)}
                              </span>
                              <span className="block truncate text-xs text-slate-500">
                                {[customer.email, customer.phone].filter(Boolean).join(' · ') ||
                                  'Customer record'}
                              </span>
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <span className="block mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Inventory SKUs
                </span>
                {skus.length === 0 && !searching ? (
                  <p className="text-xs text-slate-500 py-1">No matching inventory SKUs found.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {skus.map(item => {
                      const available = item.quantity - item.reserved
                      const isLow = available <= item.reorder_threshold
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectSku(item)}
                            className="touch-target flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50"
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-slate-700">
                                  {item.sku}
                                </span>
                                <span className="truncate text-sm font-semibold text-slate-900">
                                  {item.name}
                                </span>
                              </span>
                              <span className="block text-xs text-slate-500 tabular-nums">
                                Available: {available} · Sell {formatCurrency(item.selling_price)}
                              </span>
                            </span>
                            <Badge tone={isLow ? 'amber' : 'emerald'}>
                              {isLow ? 'Low Stock' : `${available} avail`}
                            </Badge>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <div>
            <span className="block mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Workspaces
            </span>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {matchingWorkspaces.map(item => (
                <li key={item.section}>
                  <button
                    type="button"
                    onClick={() => handleSelectWorkspace(item.section)}
                    className="touch-target flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                        {item.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {item.subtitle}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Dialog>
    </>
  )
}
