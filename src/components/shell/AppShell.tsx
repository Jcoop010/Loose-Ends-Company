import React, { useState } from 'react'
import {
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarClock,
  FileSignature,
  FileText,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  Radar,
  ReceiptText,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import { normalizeModulesEnabled, type WorkspaceEntityType } from '../../lib/autonomousOs'
import { useAppRouter, type DashboardSection } from '../../state/RouterContext'
import { useSession } from '../../state/SessionContext'
import { Dialog } from '../ui/Dialog'
import { Badge } from '../ui/MetricCard'
import { useToast } from '../ui/Toast'
import { GlobalSearch } from './GlobalSearch'

interface NavItemConfig {
  section: DashboardSection
  label: string
  mobileLabel: string
  icon: React.ComponentType<{ className?: string }>
  moduleKey?: 'crm' | 'quotes' | 'billing' | 'inventory' | 'bookkeeping' | 'vault' | 'projects'
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
    label: 'CRM & Pipeline',
    mobileLabel: 'CRM',
    icon: Users,
    moduleKey: 'crm',
  },
  {
    section: 'quotes',
    label: 'Quotes & E-Sign',
    mobileLabel: 'Quotes',
    icon: FileSignature,
    moduleKey: 'quotes',
  },
  {
    section: 'invoices',
    label: 'Invoices & AR',
    mobileLabel: 'Invoices',
    icon: ReceiptText,
    moduleKey: 'billing',
  },
  {
    section: 'autonomy',
    label: 'Agent Ledger & Autonomy',
    mobileLabel: 'Autonomy',
    icon: SlidersHorizontal,
  },
]

const ALL_SECTION_TITLES: Readonly<Record<DashboardSection, string>> = {
  command: 'Command Center',
  pipeline: 'CRM & Pipeline',
  quotes: 'Quotes & E-Sign',
  invoices: 'Invoices & AR',
  autonomy: 'Agent Ledger & Autonomy',
  dispatch: 'Fulfillment & Schedules',
  inventory: 'Inventory & Procurement',
  bookkeeping: 'Bookkeeping & AP',
  vault: 'Compliance Vault',
  sops: 'Living SOPs',
  shadow: 'Shadow Mode',
  autopilot: 'Billing, Policies & MCP',
}

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
    entities,
    activeEntityId,
    activeEntity,
    role,
    isAdminOrOwner,
    settings,
    hasActiveSubscription,
    switchWorkspace,
    switchEntity,
    createEntity,
    signOut,
  } = useSession()
  const toast = useToast()

  const [entityModalOpen, setEntityModalOpen] = useState(false)
  const [newEntityName, setNewEntityName] = useState('')
  const [newEntityType, setNewEntityType] = useState<WorkspaceEntityType>('llc')
  const [newEntityEin, setNewEntityEin] = useState('')
  const [creatingEntity, setCreatingEntity] = useState(false)
  const [entityFormError, setEntityFormError] = useState<string | null>(null)

  const handleCreateEntity = async (e: React.FormEvent) => {
    e.preventDefault()
    if (creatingEntity) return
    setEntityFormError(null)
    const trimmedEin = newEntityEin.trim()
    if (trimmedEin.length > 0 && !/^\d{4}$/.test(trimmedEin)) {
      setEntityFormError('EIN last 4 digits must be exact 4 numeric digits, or leave blank until verified.')
      return
    }
    setCreatingEntity(true)
    try {
      const created = await createEntity({
        legalName: newEntityName,
        entityType: newEntityType,
        einLast4: trimmedEin || null,
        isPrimary: entities.length === 0,
      })
      toast.success('Legal Entity Added', `${created.legal_name} is now active in the Entity Switcher.`)
      setNewEntityName('')
      setNewEntityEin('')
      setNewEntityType('llc')
      setEntityModalOpen(false)
    } catch (err) {
      setEntityFormError(err instanceof Error ? err.message : 'Unable to create legal entity.')
    } finally {
      setCreatingEntity(false)
    }
  }

  const modules = normalizeModulesEnabled(settings?.modules_enabled)
  const inventoryModuleVisible =
    settings?.inventory_enabled !== undefined && settings?.inventory_enabled !== null
      ? settings.inventory_enabled
      : true
  const activeNavTitle = ALL_SECTION_TITLES[section] ?? 'Command Center'

  const visibleRailItems = WORKSPACE_NAV_ITEMS.filter(item => {
    if (item.moduleKey === 'inventory') return inventoryModuleVisible
    return item.moduleKey ? modules[item.moduleKey] : true
  })

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
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--surface-canvas)] text-slate-100">
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#c2410c] text-white border border-[#fb923c]/40 font-black text-sm">
                LE
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight text-white">
                  Loose Ends OS
                </p>
                <p className="truncate text-[11px] text-slate-400">Autonomous Business OS</p>
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

          {/* Release 1 Active Modules */}
          <nav aria-label="Workspaces" className="space-y-1">
            {visibleRailItems.map(item => {
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
                      ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#fb923c]' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}

            {/* Release 2 Gated Modules: shown when workspace_settings.modules_enabled.* is ON */}
            {modules.inventory ? (
              <button
                type="button"
                aria-current={section === 'inventory' ? 'page' : undefined}
                onClick={() => navigateSection('inventory')}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  section === 'inventory'
                    ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                }`}
              >
                <Boxes
                  className={`h-4 w-4 shrink-0 ${section === 'inventory' ? 'text-[#fb923c]' : ''}`}
                  aria-hidden="true"
                />
                <span className="truncate">Inventory &amp; Procurement</span>
              </button>
            ) : null}

            {modules.bookkeeping ? (
              <button
                type="button"
                aria-current={section === 'bookkeeping' ? 'page' : undefined}
                onClick={() => navigateSection('bookkeeping')}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  section === 'bookkeeping'
                    ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                }`}
              >
                <BookOpenCheck
                  className={`h-4 w-4 shrink-0 ${section === 'bookkeeping' ? 'text-[#fb923c]' : ''}`}
                  aria-hidden="true"
                />
                <span className="truncate">Bookkeeping &amp; AP</span>
              </button>
            ) : null}

            {/* Release 3 Enterprise Modules: gated cleanly by modules.vault (default true) */}
            {modules.vault ? (
              <>
                <button
                  type="button"
                  aria-current={section === 'vault' ? 'page' : undefined}
                  onClick={() => navigateSection('vault')}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                    section === 'vault'
                      ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <Lock
                    className={`h-4 w-4 shrink-0 ${section === 'vault' ? 'text-[#fb923c]' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">Compliance Vault</span>
                </button>

                <button
                  type="button"
                  aria-current={section === 'sops' ? 'page' : undefined}
                  onClick={() => navigateSection('sops')}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                    section === 'sops'
                      ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <FileText
                    className={`h-4 w-4 shrink-0 ${section === 'sops' ? 'text-[#fb923c]' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">Living SOPs</span>
                </button>
              </>
            ) : null}

            {/* Zero-Migration Onboarding: Shadow Mode */}
            <button
              type="button"
              aria-current={section === 'shadow' ? 'page' : undefined}
              onClick={() => navigateSection('shadow')}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                section === 'shadow'
                  ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
              }`}
            >
              <Radar
                className={`h-4 w-4 shrink-0 ${section === 'shadow' ? 'text-[#fb923c]' : ''}`}
                aria-hidden="true"
              />
              <span className="truncate">Shadow Mode</span>
            </button>

            <div className="pt-2 mt-2 border-t border-slate-800/80 space-y-1">
              {modules.projects ? (
                <button
                  type="button"
                  aria-current={section === 'dispatch' ? 'page' : undefined}
                  onClick={() => navigateSection('dispatch')}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                    section === 'dispatch'
                      ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Fulfillment &amp; Schedules</span>
                </button>
              ) : null}

              <button
                type="button"
                aria-current={section === 'autopilot' ? 'page' : undefined}
                onClick={() => navigateSection('autopilot')}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                  section === 'autopilot'
                    ? 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[#fb923c]/40 font-semibold'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-white border border-transparent'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Workspace Billing &amp; MCP</span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/dashboard/autonomy')}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3.5 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800/70 hover:text-slate-200 transition"
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Module Toggles</span>
              </button>
            </div>
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
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0b1320]/95 backdrop-blur-xs">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base sm:text-lg font-bold text-slate-50">
                  {activeNavTitle}
                </h1>
                {role ? (
                  <Badge tone="neutral" className="md:hidden uppercase">
                    {role}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-xs text-slate-400">
                {workspace?.name ?? 'Workspace'}
                {activeEntity ? ` · ${activeEntity.legal_name}` : entities.length > 0 ? ' · Consolidated View' : ''}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-slate-700 bg-[#0e1726] px-2.5 py-1.5">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-[#fb923c]" aria-hidden="true" />
                <select
                  id="header-entity-switcher"
                  aria-label="Multi-Entity Switcher"
                  value={activeEntityId}
                  onChange={e => switchEntity(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-100 focus:outline-none"
                >
                  <option value="consolidated" className="bg-[#0e1726] text-slate-100">
                    Consolidated View
                  </option>
                  {entities.map(ent => (
                    <option key={ent.id} value={ent.id} className="bg-[#0e1726] text-slate-100">
                      {ent.legal_name}
                      {ent.ein_last4 ? ` (···${ent.ein_last4})` : ' (EIN Unverified)'}
                    </option>
                  ))}
                </select>
                {isAdminOrOwner ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEntityFormError(null)
                      setEntityModalOpen(true)
                    }}
                    aria-label="Add legal entity"
                    className="ml-1 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#131f33] px-2 py-0.5 text-[11px] font-semibold text-[#fdba74] hover:border-[#fb923c]/50"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    Entity
                  </button>
                ) : null}
              </div>
              <GlobalSearch workspaceId={workspace?.id} />
              <button
                type="button"
                onClick={() => void handleSignOut()}
                aria-label="Sign out"
                className="md:hidden touch-target inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-200 hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {modules.inventory || modules.bookkeeping || modules.vault ? (
          <div className="md:hidden border-b border-slate-800 bg-[#0e1726] px-4 py-2 flex flex-wrap gap-2">
            {modules.inventory ? (
              <button
                type="button"
                onClick={() => navigateSection('inventory')}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border transition ${
                  section === 'inventory'
                    ? 'border-[#fb923c]/40 bg-[rgba(234,88,12,0.16)] text-[#fdba74]'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
                Inventory
              </button>
            ) : null}
            {modules.bookkeeping ? (
              <button
                type="button"
                onClick={() => navigateSection('bookkeeping')}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border transition ${
                  section === 'bookkeeping'
                    ? 'border-[#fb923c]/40 bg-[rgba(234,88,12,0.16)] text-[#fdba74]'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Bookkeeping &amp; AP
              </button>
            ) : null}
            {modules.vault ? (
              <>
                <button
                  type="button"
                  onClick={() => navigateSection('vault')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border transition ${
                    section === 'vault'
                      ? 'border-[#fb923c]/40 bg-[rgba(234,88,12,0.16)] text-[#fdba74]'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Vault
                </button>
                <button
                  type="button"
                  onClick={() => navigateSection('sops')}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border transition ${
                    section === 'sops'
                      ? 'border-[#fb923c]/40 bg-[rgba(234,88,12,0.16)] text-[#fdba74]'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Living SOPs
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => navigateSection('shadow')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border transition ${
                section === 'shadow'
                  ? 'border-[#fb923c]/40 bg-[rgba(234,88,12,0.16)] text-[#fdba74]'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              <Radar className="h-3.5 w-3.5" aria-hidden="true" />
              Shadow Mode
            </button>
          </div>
        ) : null}

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
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-[#0b1320]/98 backdrop-blur-xs md:hidden"
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
                    ? 'text-[#fdba74] bg-[rgba(234,88,12,0.16)] border-t-2 border-[#fb923c]'
                    : 'text-slate-400 hover:text-slate-100 border-t-2 border-transparent'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${isActive ? 'text-[#fb923c]' : 'text-slate-400'}`}
                  aria-hidden="true"
                />
                <span className="truncate max-w-full">{item.mobileLabel}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <Dialog
        open={entityModalOpen}
        onClose={() => setEntityModalOpen(false)}
        title="Add Legal Entity"
        description="Register a verified workspace legal entity for isolated AP/bank feeds and consolidated reporting. Leave EIN last 4 blank until verified."
      >
        <form onSubmit={e => void handleCreateEntity(e)} className="space-y-4">
          {entityFormError ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {entityFormError}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="new-entity-legal-name" className="block text-xs font-semibold text-slate-200">
              Legal Entity Name
            </label>
            <input
              id="new-entity-legal-name"
              type="text"
              required
              minLength={2}
              value={newEntityName}
              onChange={e => setNewEntityName(e.target.value)}
              placeholder="e.g., Mid-Ohio Mechanical LLC"
              className="w-full rounded-xl border border-slate-700 bg-[#0b1320] px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="new-entity-type" className="block text-xs font-semibold text-slate-200">
                Entity Structure
              </label>
              <select
                id="new-entity-type"
                value={newEntityType}
                onChange={e => setNewEntityType(e.target.value as WorkspaceEntityType)}
                className="w-full rounded-xl border border-slate-700 bg-[#0b1320] px-3 py-2 text-sm text-white"
              >
                <option value="llc">LLC</option>
                <option value="scorp">S-Corp</option>
                <option value="ccorp">C-Corp</option>
                <option value="sole_prop">Sole Proprietorship</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="new-entity-ein-last4" className="block text-xs font-semibold text-slate-200">
                EIN Last 4 Digits (Optional)
              </label>
              <input
                id="new-entity-ein-last4"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={newEntityEin}
                onChange={e => setNewEntityEin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Blank until verified"
                className="w-full rounded-xl border border-slate-700 bg-[#0b1320] px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEntityModalOpen(false)}
              className="exec-btn-secondary !px-3.5 !py-2 !text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingEntity || newEntityName.trim().length < 2}
              className="exec-btn-primary !px-4 !py-2 !text-xs disabled:opacity-50"
            >
              {creatingEntity ? 'Saving Entity…' : 'Save Legal Entity'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
