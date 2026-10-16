import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from '../router'
import { Zap, LayoutDashboard, Users, DollarSign, CalendarDays, FileText, Unlink, CheckSquare, Brain, Settings, Menu, Search, ChevronRight, X } from 'lucide-react'

const navItems = [
  { label: 'Command Center', path: '/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
  { label: 'Customers', path: '/dashboard/customers', icon: <Users className="w-5 h-5" /> },
  { label: 'Sales', path: '/dashboard/sales', icon: <DollarSign className="w-5 h-5" /> },
  { label: 'Calendar', path: '/dashboard/calendar', icon: <CalendarDays className="w-5 h-5" /> },
  { label: 'Documents', path: '/dashboard/documents', icon: <FileText className="w-5 h-5" /> },
  { label: 'Revenue Recovery', path: '/dashboard/revenue-recovery', icon: <Unlink className="w-5 h-5" /> },
  { label: 'Tasks', path: '/dashboard/tasks', icon: <CheckSquare className="w-5 h-5" /> },
  { label: 'Intelligence', path: '/dashboard/intelligence', icon: <Brain className="w-5 h-5" /> },
  { label: 'Settings', path: '/dashboard/settings', icon: <Settings className="w-5 h-5" /> },
]

function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  return <>
    <div className="px-5 py-5 border-b border-slate-800"><div className="flex items-center gap-2.5"><div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-900/30"><Zap className="w-5 h-5 text-white" /></div><div className="min-w-0"><p className="font-bold text-white text-sm tracking-tight leading-tight">Loose Ends Co.</p><p className="text-[10px] text-slate-400 leading-tight">Find. Fix. Recover.</p></div></div></div>
    <div className="px-3 py-3 border-b border-slate-800"><div className="px-2 py-2 rounded-lg bg-slate-800/50"><p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Workspace</p><p className="text-sm text-white font-semibold mt-0.5">Revenue Recovery CRM</p></div></div>
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">{navItems.map(item => { const active = currentPath === item.path || (item.path !== '/dashboard' && currentPath.startsWith(item.path)); return <button key={item.path} onClick={() => onNavigate(item.path)} aria-current={active ? "page" : undefined} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${active ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/20" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>{item.icon}<span className="truncate">{item.label}</span></button> })}</nav>
    <div className="px-3 py-3 border-t border-slate-800"><div className="px-2 py-2 rounded-lg bg-accent-500/10 border border-accent-500/20"><span className="badge bg-accent-500 text-white text-[10px]">CRM + REVENUE</span><p className="text-[11px] text-slate-400 mt-1.5 leading-snug">Customer activity feeds follow-ups and revenue recovery.</p></div></div>
  </>
}

export function DashboardLayout({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  const { navigate } = useRouter(); const [mobileOpen, setMobileOpen] = useState(false); const searchRef = useRef<HTMLInputElement>(null); const [globalSearch, setGlobalSearch] = useState('')
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])
  const handleNavigate = (path: string) => { navigate(path); setMobileOpen(false) }
  return <div className="min-h-screen bg-[#f5f7fb] flex">
    <aside aria-label="Primary navigation" className="hidden lg:flex w-64 flex-shrink-0 bg-[#0d1c2c] flex-col fixed inset-y-0 left-0 z-30 border-r border-white/10"><SidebarContent currentPath={currentPath} onNavigate={handleNavigate} /></aside>
    {mobileOpen && <><div className="fixed inset-0 z-40 bg-black/60 lg:hidden" aria-hidden="true" onClick={() => setMobileOpen(false)} /><aside aria-label="Mobile navigation" className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0d1c2c] flex flex-col lg:hidden animate-slideIn"><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute top-4 right-3 z-10 rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><X className="w-5 h-5" /></button><SidebarContent currentPath={currentPath} onNavigate={handleNavigate} /></aside></>}
    <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
      <header className="lg:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-20"><button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg hover:bg-slate-800" aria-label="Open navigation"><Menu className="w-6 h-6" /></button><div className="flex items-center gap-2"><Zap className="w-5 h-5 text-brand-400" /><span className="font-bold text-sm tracking-tight">Loose Ends Co.</span></div><button type="button" onClick={() => navigate("/dashboard/customers?focus=search")} aria-label="Search customers" className="p-1.5 rounded-lg hover:bg-slate-800"><Search className="w-5 h-5" /></button></header>
      <div className="hidden lg:flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8 sticky top-0 z-20"><div className="flex items-center gap-2 text-sm text-slate-500"><span>Workspace</span><ChevronRight className="w-4 h-4" /><span className="font-semibold text-slate-900">{navItems.find(item => item.path === currentPath || (item.path !== '/dashboard' && currentPath.startsWith(item.path)))?.label || 'Command Center'}</span></div><div className="flex items-center gap-3"><div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 focus-within:bg-white focus-within:border-brand-300"><Search className="w-3.5 h-3.5" /><input ref={searchRef} aria-label="Search CRM" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { navigate(`/dashboard/customers?search=${encodeURIComponent(globalSearch.trim())}`); searchRef.current?.blur() } }} className="bg-transparent outline-none w-32 placeholder:text-slate-400" placeholder="Search CRM" /><kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px]">/</kbd></div><span className="badge bg-brand-100 text-brand-700">CRM</span></div></div>
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto w-full">{children}</main>
    </div>
  </div>
}
