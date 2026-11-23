import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Boxes,
  CalendarClock,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Lock,
  Radar,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UserRound,
} from 'lucide-react'
import {
  formatCents,
  routeNaturalCommand,
  simulateWhatIfCashflow,
  type CommandActionPayload,
  type CommandRouterSnapshot,
} from '../../lib/autonomousOs'
import { customerDisplayName, formatCurrency } from '../../lib/format'
import type { DashboardSection } from '../../state/RouterContext'
import type { Customer, InventoryItem } from '../../types/domain'
import { Dialog } from '../ui/Dialog'
import { Badge } from '../ui/MetricCard'

const WORKSPACE_QUICK_JUMPS: Array<{
  section: DashboardSection
  route: string
  title: string
  subtitle: string
  icon: React.ReactNode
}> = [
  {
    section: 'command',
    route: '/dashboard',
    title: 'Command Center',
    subtitle: 'Executive KPIs, verified collections & operational alerts',
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    section: 'quotes',
    route: '/dashboard/quotes',
    title: 'Quotes & E-Sign',
    subtitle: 'Itemized client quotes & /portal/[token] signature tracking',
    icon: <FileSpreadsheet className="h-4 w-4" />,
  },
  {
    section: 'invoices',
    route: '/dashboard/invoices',
    title: 'Invoices & AR',
    subtitle: 'Open receivables, overdue balances & collection nudges',
    icon: <TrendingUp className="h-4 w-4" />,
  },
  {
    section: 'inventory',
    route: '/dashboard/inventory',
    title: 'Inventory & Procurement',
    subtitle: 'SKU stock levels, Auto-POs, Barcode GRN & 3-way match',
    icon: <Boxes className="h-4 w-4" />,
  },
  {
    section: 'bookkeeping',
    route: '/dashboard/bookkeeping',
    title: 'Bookkeeping & AP',
    subtitle: 'Double-entry ledger, 90-day cashflow & vendor bills queue',
    icon: <BookOpenCheck className="h-4 w-4" />,
  },
  {
    section: 'vault',
    route: '/dashboard/vault',
    title: 'Compliance Vault',
    subtitle: 'Contracts, COIs, SaaS renewals & notice-window deadlines',
    icon: <Lock className="h-4 w-4" />,
  },
  {
    section: 'sops',
    route: '/dashboard/sops',
    title: 'Living SOPs',
    subtitle: 'Versioned auto-compiled operational playbooks across modules',
    icon: <FileText className="h-4 w-4" />,
  },
  {
    section: 'shadow',
    route: '/dashboard/shadow',
    title: 'Shadow Mode',
    subtitle: 'Zero-migration QuickBooks/Zoho/Stripe CSV leak audit without touching live books',
    icon: <Radar className="h-4 w-4" />,
  },
  {
    section: 'autonomy',
    route: '/dashboard/autonomy',
    title: 'Agent Ledger & Autonomy',
    subtitle: 'Autonomy Dial rules, module toggles & 1-Click Undo audit log',
    icon: <SlidersHorizontal className="h-4 w-4" />,
  },
  {
    section: 'dispatch',
    route: '/dashboard/dispatch',
    title: 'Fulfillment & Schedules',
    subtitle: 'Work orders, calendars & completion checklists',
    icon: <CalendarClock className="h-4 w-4" />,
  },
  {
    section: 'autopilot',
    route: '/dashboard/autopilot',
    title: 'Billing, Policies & MCP',
    subtitle: 'Workspace tokens, bot manuals & subscription status',
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    section: 'autopilot',
    route: '/dashboard/settings',
    title: 'Settings & BYO-Agent MCP Hub',
    subtitle: 'Connect Claude, ChatGPT, or Grok in 1 click (29 tools · v2.5.0)',
    icon: <Sparkles className="h-4 w-4" />,
  },
]

const SAMPLE_COMMANDS: ReadonlyArray<string> = [
  'overdue invoices over $1000',
  'low stock skus',
  'expiring contracts',
  'Automate: freeze vendor bills >5% price spike',
  'simulate hiring 2 staff at $5000/mo',
  'undo last action',
]

export function CommandBarModal({
  open,
  onClose,
  snapshot,
  isDemo = false,
  query,
  onQueryChange,
  customers = [],
  skus = [],
  searching = false,
  searchError = null,
  onSelectCustomer,
  onSelectSku,
  onNavigateRoute,
  onUndoLedgerAction,
}: {
  open: boolean
  onClose: () => void
  snapshot: CommandRouterSnapshot
  isDemo?: boolean
  query: string
  onQueryChange: (next: string) => void
  customers?: readonly Customer[]
  skus?: readonly InventoryItem[]
  searching?: boolean
  searchError?: string | null
  onSelectCustomer?: (customer: Customer) => void
  onSelectSku?: (item: InventoryItem) => void
  onNavigateRoute: (route: string) => void
  onUndoLedgerAction?: (ledgerEntryId: string) => Promise<void> | void
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [activeTab, setActiveTab] = useState<'command' | 'what_if'>('command')
  const [undoBusy, setUndoBusy] = useState(false)

  const defaultBaselineDollars = Math.round(snapshot.baselineBalanceCents / 100)
  const [baselineDollars, setBaselineDollars] = useState(defaultBaselineDollars || 25000)
  const [monthlyDeltaDollars, setMonthlyDeltaDollars] = useState(-5000)
  const [oneTimeDeltaDollars, setOneTimeDeltaDollars] = useState(0)
  const [safetyBufferDollars, setSafetyBufferDollars] = useState(
    Math.round((snapshot.safetyBufferCents ?? 500000) / 100),
  )

  useEffect(() => {
    if (open) {
      setBaselineDollars(Math.round(snapshot.baselineBalanceCents / 100) || 25000)
    } else {
      setActiveTab('command')
    }
  }, [open, snapshot.baselineBalanceCents])

  const routed = useMemo(
    () => routeNaturalCommand(query, snapshot),
    [query, snapshot],
  )

  const whatIfResult = useMemo(() => {
    const baselineCents = Math.round(Number(baselineDollars || 0) * 100)
    const monthlyCents = Math.round(Number(monthlyDeltaDollars || 0) * 100)
    const oneTimeCents = Math.round(Number(oneTimeDeltaDollars || 0) * 100)
    const bufferCents = Math.max(0, Math.round(Number(safetyBufferDollars || 0) * 100))
    return simulateWhatIfCashflow(
      Number.isSafeInteger(baselineCents) ? baselineCents : 0,
      Number.isSafeInteger(monthlyCents) ? monthlyCents : 0,
      Number.isSafeInteger(oneTimeCents) ? oneTimeCents : 0,
      90,
      { safetyBufferCents: Number.isSafeInteger(bufferCents) ? bufferCents : 500000 },
    )
  }, [baselineDollars, monthlyDeltaDollars, oneTimeDeltaDollars, safetyBufferDollars])

  const matchingWorkspaces = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return WORKSPACE_QUICK_JUMPS.slice(0, 6)
    return WORKSPACE_QUICK_JUMPS.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.section.toLowerCase().includes(q),
    )
  }, [query])

  const handleAction = async (action: CommandActionPayload | undefined) => {
    if (!action) return
    if (action.kind === 'run_command' && action.commandText) {
      onQueryChange(action.commandText)
      return
    }
    if (action.kind === 'open_what_if') {
      if (typeof action.monthlyDeltaCents === 'number') {
        setMonthlyDeltaDollars(Math.round(action.monthlyDeltaCents / 100))
      }
      if (typeof action.oneTimeDeltaCents === 'number') {
        setOneTimeDeltaDollars(Math.round(action.oneTimeDeltaCents / 100))
      }
      setActiveTab('what_if')
      return
    }
    if (action.kind === 'undo_ledger' && action.targetId && onUndoLedgerAction) {
      setUndoBusy(true)
      try {
        await onUndoLedgerAction(action.targetId)
      } finally {
        setUndoBusy(false)
      }
      return
    }
    if (action.kind === 'navigate' && action.route) {
      onClose()
      onNavigateRoute(action.route)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Global Command Bar & What-If Simulator"
      description={
        isDemo
          ? '100% air-gapped natural command router, quick navigation & integer-cent 90-day cashflow simulator.'
          : 'Plain-English workspace command router, instant search & 90-day integer-cent What-If simulator.'
      }
      maxWidthClass="max-w-2xl"
      initialFocusRef={inputRef}
    >
      <div className="space-y-4">
        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('command')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'command'
                ? 'bg-[#c2410c] text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Command Router &amp; Search
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('what_if')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'what_if'
                ? 'bg-[#c2410c] text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            What-If Cashflow Simulator
          </button>
        </div>

        {activeTab === 'command' ? (
          <div className="space-y-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={e => onQueryChange(e.target.value)}
                placeholder='Ask or execute: "overdue invoices over $1000", "simulate hiring 2 staff at $5000/mo", "undo last action"...'
                aria-label="Global command input"
                className="exec-input pl-10"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_COMMANDS.map(cmd => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => onQueryChange(cmd)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    query.trim().toLowerCase() === cmd
                      ? 'border-[#ea580c] bg-[#fff7ed] text-[#9a3412]'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {cmd}
                </button>
              ))}
            </div>

            {searchError ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
              >
                {searchError}
              </div>
            ) : null}

            {/* Routed Plain-English Result */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{routed.intent}</Badge>
                    <h4 className="text-sm font-bold text-slate-900">{routed.headline}</h4>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{routed.summary}</p>
                </div>

                {routed.primary_action ? (
                  <button
                    type="button"
                    disabled={undoBusy}
                    onClick={() => void handleAction(routed.primary_action ?? undefined)}
                    className="exec-btn-primary !px-3 !py-1.5 !text-xs shrink-0"
                  >
                    {routed.primary_action.kind === 'undo_ledger' ? (
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : null}
                    {undoBusy ? 'Reversing…' : routed.primary_action.label}
                  </button>
                ) : null}
              </div>

              {routed.items.length > 0 ? (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {routed.items.map(item => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900">{item.title}</p>
                        <p className="truncate text-slate-500">{item.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone="neutral">{item.badge}</Badge>
                        {item.action ? (
                          <button
                            type="button"
                            disabled={undoBusy}
                            onClick={() => void handleAction(item.action)}
                            className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                          >
                            {item.action.label}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* Optional Server Customer & SKU Search Results (Authenticated Mode) */}
            {!isDemo && query.trim().length >= 2 ? (
              <div className="space-y-3">
                {searching ? <p className="text-xs text-slate-400">Searching records…</p> : null}
                {customers.length > 0 && onSelectCustomer ? (
                  <div>
                    <span className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Matching Customers
                    </span>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {customers.map(customer => (
                        <li key={customer.id}>
                          <button
                            type="button"
                            onClick={() => onSelectCustomer(customer)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                          >
                            <span className="flex items-center gap-2 truncate">
                              <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                              <span className="font-semibold text-slate-900">
                                {customerDisplayName(customer)}
                              </span>
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {skus.length > 0 && onSelectSku ? (
                  <div>
                    <span className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Matching Inventory SKUs
                    </span>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {skus.map(item => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => onSelectSku(item)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                          >
                            <span className="truncate font-semibold text-slate-900">
                              <span className="font-mono text-slate-600 mr-2">{item.sku}</span>
                              {item.name}
                            </span>
                            <span className="tabular-nums text-slate-500">
                              {formatCurrency(item.selling_price)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Workspace Quick Jumps */}
            <div>
              <span className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Workspaces
              </span>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {matchingWorkspaces.map(item => (
                  <button
                    key={item.section}
                    type="button"
                    onClick={() => {
                      onClose()
                      onNavigateRoute(item.route)
                    }}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-[#fb923c] hover:bg-[#fff7ed]/40"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                        {item.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">
                          {item.title}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {item.subtitle}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Tab 2: Interactive Integer-Cent 90-Day What-If Cashflow Simulator */
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="whatif-baseline" className="font-semibold text-slate-700">
                    Starting Cash ($)
                  </label>
                  <span className="font-bold text-slate-950 tabular-nums">
                    {formatCents(whatIfResult.baseline_cents)}
                  </span>
                </div>
                <input
                  id="whatif-baseline"
                  type="number"
                  value={baselineDollars}
                  onChange={e => setBaselineDollars(Number(e.target.value || 0))}
                  className="exec-input w-full !py-1.5 text-xs tabular-nums bg-white"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="whatif-buffer" className="font-semibold text-slate-700">
                    Safety Buffer ($)
                  </label>
                  <span className="font-bold text-slate-950 tabular-nums">
                    {formatCents(whatIfResult.safety_buffer_cents)}
                  </span>
                </div>
                <input
                  id="whatif-buffer"
                  type="number"
                  min="0"
                  value={safetyBufferDollars}
                  onChange={e => setSafetyBufferDollars(Math.max(0, Number(e.target.value || 0)))}
                  className="exec-input w-full !py-1.5 text-xs tabular-nums bg-white"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="whatif-monthly" className="font-semibold text-slate-700">
                    Monthly Delta ($/mo)
                  </label>
                  <span className="font-bold text-[#9a3412] tabular-nums">
                    {formatCents(whatIfResult.monthly_delta_cents)}/mo
                  </span>
                </div>
                <input
                  id="whatif-monthly"
                  type="range"
                  min="-25000"
                  max="25000"
                  step="500"
                  value={monthlyDeltaDollars}
                  onChange={e => setMonthlyDeltaDollars(Number(e.target.value))}
                  className="w-full accent-[#ea580c]"
                />
                <input
                  type="number"
                  step="100"
                  aria-label="Monthly recurring delta in dollars"
                  value={monthlyDeltaDollars}
                  onChange={e => setMonthlyDeltaDollars(Number(e.target.value || 0))}
                  className="exec-input w-full !py-1 text-xs tabular-nums bg-white"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="whatif-onetime" className="font-semibold text-slate-700">
                    One-Time Spend / Cash ($)
                  </label>
                  <span className="font-bold text-slate-950 tabular-nums">
                    {formatCents(whatIfResult.one_time_delta_cents)}
                  </span>
                </div>
                <input
                  id="whatif-onetime"
                  type="range"
                  min="-50000"
                  max="50000"
                  step="500"
                  value={oneTimeDeltaDollars}
                  onChange={e => setOneTimeDeltaDollars(Number(e.target.value))}
                  className="w-full accent-[#ea580c]"
                />
                <input
                  type="number"
                  step="100"
                  aria-label="One-time dollar delta"
                  value={oneTimeDeltaDollars}
                  onChange={e => setOneTimeDeltaDollars(Number(e.target.value || 0))}
                  className="exec-input w-full !py-1 text-xs tabular-nums bg-white"
                />
              </div>
            </div>

            {whatIfResult.any_buffer_breach ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900 flex items-center gap-2"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                <span>
                  Simulated balance dips below your {formatCents(whatIfResult.safety_buffer_cents)} safety buffer at{' '}
                  <strong>Day {whatIfResult.first_breach_horizon_days}</strong> (low:{' '}
                  <strong>{formatCents(whatIfResult.lowest_simulated_balance_cents)}</strong>).
                </span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 tabular-nums">
              {whatIfResult.windows.map(win => (
                <div
                  key={win.horizon_days}
                  className={`rounded-xl border p-3.5 space-y-1.5 ${
                    win.below_buffer
                      ? 'border-rose-200 bg-rose-50/50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-600">{win.label}</span>
                    <Badge tone={win.below_buffer ? 'rose' : 'emerald'}>
                      {win.below_buffer ? 'Below Buffer' : 'Healthy'}
                    </Badge>
                  </div>
                  <p className="text-lg font-black text-slate-950">
                    {formatCents(win.simulated_balance_cents)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Baseline {formatCents(win.baseline_balance_cents)} · Net{' '}
                    <span
                      className={
                        win.scenario_delta_cents < 0 ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'
                      }
                    >
                      {formatCents(win.scenario_delta_cents)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
