import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { Zap, LayoutDashboard, Users, DollarSign, Bell, CalendarDays, Settings, Menu, X, Search, FileText, CheckSquare, Brain, ShoppingCart } from 'lucide-react'

const navItems = [
  { label: 'Command Center', path: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
  { label: 'Customers', path: '/dashboard/customers', icon: <Users className="w-5 h-5" /> },
  { label: 'Sales', path: '/dashboard/sales', icon: <ShoppingCart className="w-5 h-5" /> },
  { label: 'Calendar', path: '/dashboard/calendar', icon: <CalendarDays className="w-5 h-5" /> },
  { label: 'Documents', path: '/dashboard/documents', icon: <FileText className="w-5 h-5" /> },
  { label: 'Revenue', path: '/dashboard/revenue', icon: <DollarSign className="w-5 h-5" /> },
  { label: 'Loose Ends', path: '/dashboard/revenue-recovery', icon: <DollarSign className="w-5 h-5" /> },
  { label: 'Tasks', path: '/dashboard/tasks', icon: <CheckSquare className="w-5 h-5" /> },
  { label: 'Intelligence', path: '/dashboard/intelligence', icon: <Brain className="w-5 h-5" /> },
  { label: 'Settings', path: '/dashboard/settings', icon: <Settings className="w-5 h-5" /> },
]

function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  const { data } = useStore()
  const activeLooseEnds = data.opportunities.filter(o => o.status !== 'Collected').length
  return (
    <>
      <div className="px-6 py-6 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-accent-400 to-accent-600 rounded-full flex items-center justify-center shadow-lg">
            <Zap className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <p className="font-bold text-white tracking-[0.16em] text-sm">LOOSE ENDS</p>
            <p className="text-xs text-accent-300 mt-0.5">Revenue Recovery OS</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const active = item.label === 'Command Center'
            ? currentPath === '/dashboard'
            : currentPath === item.path || currentPath.startsWith(`${item.path}/`)
          return (
            <button
              key={item.label}
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? 'bg-[rgba(255,138,61,0.14)] text-white border-l-2 border-accent-400 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'}`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {item.label === 'Loose Ends' && <span className="ml-auto rounded-full bg-accent-500/20 px-2 py-0.5 text-[11px] text-accent-200">{activeLooseEnds}</span>}
            </button>
          )
        })}
      </nav>
      <div className="px-4 pb-5">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 px-5 py-5">
          <p className="text-sm font-semibold text-slate-200 leading-6">More customers.<br />More work.<br />Less money left behind.</p>
          <div className="mt-5 h-px w-36 bg-accent-400" />
        </div>
        <div className="px-1 pt-5 text-xs text-slate-500 leading-5">
          <p>Workspace</p>
          <p className="text-slate-300">{data.business.name}</p>
          <p>{data.business.address.split(',').slice(-2).join(',').trim()}</p>
        </div>
      </div>
    </>
  )
}

export function DashboardLayout({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  const { navigate } = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const { data } = useStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleNavigate = (path: string) => {
    navigate(path)
    setMobileOpen(false)
  }

  return (
    <div className="min-h-screen bg-[#07111f] flex text-slate-100">
      <aside className="hidden lg:flex w-[286px] flex-shrink-0 bg-[#07111f] border-r border-slate-800/80 flex-col fixed inset-y-0 left-0 z-30">
        <SidebarContent currentPath={currentPath} onNavigate={handleNavigate} />
      </aside>
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-[286px] bg-[#07111f] flex flex-col lg:hidden animate-slideIn">
            <div className="absolute right-3 top-3 text-slate-400"><button onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="w-5 h-5" /></button></div>
            <SidebarContent currentPath={currentPath} onNavigate={handleNavigate} />
          </aside>
        </>
      )}
      <div className="flex-1 lg:ml-[286px] flex flex-col min-w-0 bg-[#07111f]">
        <header className="hidden lg:flex h-[76px] items-center gap-6 border-b border-slate-800/80 bg-[#07111f] px-7 sticky top-0 z-20">
          <div className="flex-1 max-w-[700px]">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-[#0d1d31] px-4 py-3 shadow-inner focus-within:border-accent-500/60">
              <Search className="w-5 h-5 text-slate-500" />
              <input ref={searchRef} aria-label="Search customers" onKeyDown={e => { if (e.key === 'Enter') navigate('/dashboard/customers') }} className="bg-transparent outline-none w-full text-sm text-slate-200 placeholder:text-slate-500" placeholder="Search customers, vehicles, or loose ends..." />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-5">
            <button aria-label="Open alerts" onClick={() => navigate('/dashboard/alerts')} className="relative hover:text-white">
              <Bell className="w-5 h-5 text-slate-500" />
              {data.alerts.filter(a => !a.dismissed).length > 0 && <span className="absolute -right-2 -top-2 min-w-5 h-5 rounded-full bg-accent-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">{data.alerts.filter(a => !a.dismissed).length}</span>}
            </button>
            <div className="text-right leading-tight">
              <p className="text-sm font-semibold text-slate-200">{data.business.name}</p>
              <p className="text-xs text-slate-500">Shop Owner</p>
            </div>
            <div className="w-11 h-11 rounded-full bg-slate-800 flex items-center justify-center text-sm font-semibold text-slate-300">{data.business.owner.split(' ').map(p => p[0]).join('').slice(0,2)}</div>
          </div>
        </header>
        <header className="lg:hidden bg-[#07111f] border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="p-1.5 rounded-lg hover:bg-slate-800"><Menu className="w-6 h-6" /></button>
          <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-accent-400" /><span className="font-bold text-sm tracking-[0.14em]">LOOSE ENDS</span></div>
          <span className="text-[10px] text-accent-300">V4</span>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-7 w-full">{children}</main>
      </div>
    </div>
  )
}
