import React from 'react'
import {
  Boxes,
  Building2,
  CalendarClock,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
} from 'lucide-react'
import { useAppRouter, type DashboardSection } from '../../state/RouterContext'
import { useSession } from '../../state/SessionContext'
import { Badge } from '../ui/MetricCard'
import { useToast } from '../ui/Toast'
import { GlobalSearch } from './GlobalSearch'

interface NavItemConfig {
  section: DashboardSection
  label: string
  mobileLabel: string
  icon: React.ComponentType<{ className?: string }>
}

export const WORKSPACE_NAV_ITEMS: NavItemConfig[] = [
  {
    section: 'command',
    label: 'Command Center',
    mobileLabel: 'Command',
    icon: LayoutDashboard,
  },
  {
    section: 'pipeline',
    label: 'Pipeline & Quotes',
    mobileLabel: 'Pipeline',
    icon: FileSpreadsheet,
  },
  {
    section: 'dispatch',
    label: 'Dispatch & Jobs',
    mobileLabel: 'Dispatch',
    icon: CalendarClock,
  },
  {
    section: 'inventory',
    label: 'Inventory & POs',
    mobileLabel: 'Inventory',
    icon: Boxes,
  },
  {
    section: 'autopilot',
    label: 'Autopilot & Billing',
    mobileLabel: 'Autopilot',
    icon: ShieldCheck,
  },
]

export function AppShell({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const { section, navigate, navigateSection } = useAppRouter()
  const {
    user,
    workspace,
    availableWorkspaces,
    role,
    hasActiveSubscription,
    switchWorkspace,
    signOut,
  } = useSession()
  const toast = useToast()

  const activeNav =
    WORKSPACE_NAV_ITEMS.find(item => item.section === section) ?? WORKSPACE_NAV_ITEMS[0]

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/')
      toast.info('Signed out', 'Session and in-memory workspace state cleared.')
    } catch (err) {
      toast.error('Sign-out error', err instanceof Error ? err.message : 'Retry sign out.')
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--surface-canvas)] text-slate-900">
      <a href="#main-workspace-content" className="skip-link">
        Skip to main content
      </a>

      {/* Desktop Navigation Rail */}
      <aside
        aria-label="Primary workspace navigation"
        className="hidden md:flex md:w-64 lg:w-68 shrink-0 flex-col justify-between exec-rail border-r border-slate-800"
      >
        <div className="p-4 lg:p-5 space-y-5">
          {/* Brand */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 font-black text-sm">
                LE
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight text-white">
                  Loose Ends OS
                </p>
                <p className="truncate text-[11px] text-slate-400">Single-Ledger Operations</p>
              </div>
            </div>
            {role ? (
              <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
                {role}
              </span>
            ) : null}
          </div>

          {/* Workspace Switcher */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
            <label
              htmlFor="rail-workspace-switcher"
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
            >
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              Active Workspace
            </label>
            {availableWorkspaces.length > 1 ? (
              <select
                id="rail-workspace-switcher"
                value={workspace?.id ?? ''}
                onChange={e => void switchWorkspace(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-white"
              >
                {availableWorkspaces.map(entry => (
                  <option key={entry.workspace.id} value={entry.workspace.id}>
                    {entry.workspace.name} ({entry.role})
                  </option>
                ))}
              </select>
            ) : (
              <p
                id="rail-workspace-switcher"
                className="mt-1 truncate text-sm font-semibold text-white"
              >
                {workspace?.name ?? 'Workspace'}
              </p>
            )}
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span>{hasActiveSubscription ? 'Plan Active' : 'Billing Setup'}</span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  hasActiveSubscription ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* 5 Workspace Pillars */}
          <nav aria-label="Workspaces" className="space-y-1">
            {WORKSPACE_NAV_ITEMS.map(item => {
              const Icon = item.icon
              const isActive = item.section === section
              return (
                <button
                  key={item.section}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => navigateSection(item.section)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Account Footer & Synchronous Sign Out */}
        <div className="border-t border-slate-800 p-4 space-y-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-200">{user?.email}</p>
            <p className="text-[11px] text-slate-400">Zero browser storage cache</p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        {/* Sticky Executive Top Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base sm:text-lg font-bold text-slate-900">
                  {activeNav.label}
                </h1>
                {role ? (
                  <Badge tone="neutral" className="md:hidden uppercase">
                    {role}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-xs text-slate-500">
                {workspace?.name ?? 'Workspace'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <GlobalSearch workspaceId={workspace?.id} />
              <button
                type="button"
                onClick={() => void handleSignOut()}
                aria-label="Sign out"
                className="md:hidden touch-target inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white p-2.5 text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <main
          id="main-workspace-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6 outline-none"
        >
          {children}
        </main>
      </div>

      {/* Mobile 5-Tab Bottom Navigation Bar (44x44px minimum tap targets) */}
      <nav
        aria-label="Mobile workspace navigation"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/98 backdrop-blur-xs md:hidden"
      >
        <div className="grid grid-cols-5">
          {WORKSPACE_NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = item.section === section
            return (
              <button
                key={item.section}
                type="button"
                data-touch="true"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigateSection(item.section)}
                className={`touch-target flex flex-col items-center justify-center gap-1 py-2 px-1 text-[11px] font-semibold transition ${
                  isActive
                    ? 'text-slate-950 bg-slate-100/80'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}
                  aria-hidden="true"
                />
                <span className="truncate max-w-full">{item.mobileLabel}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
