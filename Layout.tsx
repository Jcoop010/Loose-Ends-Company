import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from '../router'
import {
  Zap, LayoutDashboard, Users, DollarSign, Bell,
  CalendarCheck, Megaphone, ClipboardList, MessageSquare,
  Settings, Menu, X, Search, ChevronRight,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
  { label: 'Customers', path: '/dashboard/customers', icon: <Users className="w-5 h-5" /> },
  { label: 'Revenue Recovery', path: '/dashboard/revenue-recovery', icon: <DollarSign className="w-5 h-5" /> },
  { label: 'Alerts', path: '/dashboard/alerts', icon: <Bell className="w-5 h-5" /> },
  { label: 'Follow-Up Center', path: '/dashboard/follow-ups', icon: <CalendarCheck className="w-5 h-5" /> },
  { label: 'Marketing', path: '/dashboard/marketing', icon: <Megaphone className="w-5 h-5" /> },
  { label: 'Business Requests', path: '/dashboard/requests', icon: <ClipboardList className="w-5 h-5" /> },
  { label: 'Ask Loose Ends Co.', path: '/dashboard/ask', icon: <MessageSquare className="w-5 h-5" /> },
  { label: 'Settings', path: '/dashboard/settings', icon: <Settings className="w-5 h-5" /> },
]

function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  return (
    <>
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm tracking-tight leading-tight">Loose Ends Co.</p>
            <p className="text-[10px] text-slate-400 leading-tight">Find. Fix. Recover.</p>
          </div>
        </div>
      </div>
      <div className="px-3 py-3 border-b border-slate-800">
        <div className="px-2 py-2 rounded-lg bg-slate-800/50">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Demo Business</p>
          <p className="text-sm text-white font-semibold mt-0.5">Mike's Auto & Service</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {navItems.map(item => {
          const active = currentPath === item.path || (item.path !== '/dashboard' && currentPath.startsWith(item.path))
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="px-3 py-3 border-t border-slate-800">
        <div className="px-2 py-2 rounded-lg bg-accent-500/10 border border-accent-500/20">
          <div className="flex items-center gap-2">
            <span className="badge bg-accent-500 text-white text-[10px]">DEMO MODE</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">Using sample data. Changes are saved locally.</p>
        </div>
      </div>
    </>
  )
}

export function DashboardLayout({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  const { navigate } = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])
  const handleNavigate = (path: string) => {
    navigate(path)
    setMobileOpen(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="hidden lg:flex w-64 flex-shrink-0 bg-slate-900 flex-col fixed inset-y-0 left-0 z-30">
        <SidebarContent currentPath={currentPath} onNavigate={handleNavigate} />
      </aside>
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 flex flex-col lg:hidden animate-slideIn">
            <SidebarContent currentPath={currentPath} onNavigate={handleNavigate} />
          </aside>
        </>
      )}
      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        <header className="lg:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg hover:bg-slate-800">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-brand-400" />
            <span className="font-bold text-sm tracking-tight">Loose Ends Co.</span>
          </div>
          <span className="badge bg-accent-500 text-white text-[10px]">DEMO</span>
        </header>
        <div className="hidden lg:flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8 sticky top-0 z-20">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>Workspace</span><ChevronRight className="w-4 h-4" />
            <span className="font-semibold text-slate-900">{navItems.find(item => item.path === currentPath || (item.path !== '/dashboard' && currentPath.startsWith(item.path)))?.label || 'Dashboard'}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 focus-within:bg-white focus-within:border-brand-300">
              <Search className="w-3.5 h-3.5" />
              <input ref={searchRef} aria-label="Search customers" onKeyDown={e => { if (e.key === 'Enter') navigate('/dashboard/customers') }} className="bg-transparent outline-none w-32 placeholder:text-slate-400" placeholder="Search customers" />
              <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px]">/</kbd>
            </div>
            <span className="badge bg-accent-100 text-accent-700">DEMO MODE</span>
          </div>
        </div>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">{children}</main>
      </div>
    </div>
  )
}
