import { useMemo } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { formatCurrency } from '../utils'
import { DollarSign, Check, Phone, MessageSquare, Mail, Bell, Target, Wrench, ChevronRight } from 'lucide-react'

export function Dashboard() {
  const { data } = useStore()
  const { navigate } = useRouter()

  const metrics = useMemo(() => {
    const open = data.opportunities.filter(o => o.status !== 'Collected')
    const recovered = data.opportunities.filter(o => o.status === 'Collected').reduce((sum, o) => sum + (o.collectedAmount || 0), 0)
    const recoverable = open.reduce((sum, o) => sum + o.potentialValue, 0)
    const recoveryRate = recoverable + recovered > 0 ? Math.round((recovered / (recoverable + recovered)) * 1000) / 10 : 0
    return { recoverable, recovered, active: open.length, recoveryRate }
  }, [data.opportunities])

  const queue = useMemo(() => data.opportunities
    .filter(o => o.status !== 'Collected')
    .sort((a, b) => b.potentialValue - a.potentialValue)
    .slice(0, 5)
    .map(opp => {
      const customer = data.customers.find(c => c.id === opp.customerId)
      return { ...opp, phone: customer?.phone || '', vehicle: customer?.vehicleId ? data.vehicles.find(v => v.id === customer.vehicleId) : undefined }
    }), [data.opportunities, data.customers, data.vehicles])

  const actionCounts = useMemo(() => ({
    calls: data.opportunities.filter(o => o.type === 'Missed Call' && o.status !== 'Collected').length,
    texts: data.followUps.filter(f => f.status === 'Due Today' || f.status === 'Upcoming').length,
    emails: data.opportunities.filter(o => o.type === 'Old Estimate' && o.status !== 'Collected').length,
    reminders: data.followUps.filter(f => f.status === 'Due Today').length,
  }), [data])

  const actionLabel = (type: string) => {
    if (type === 'Missed Call') return 'Missed Call'
    if (type === 'Declined Work') return 'Declined Work'
    if (type === 'Maintenance Due') return 'Maintenance Due'
    if (type === 'Old Estimate') return 'Old Estimate'
    if (type === 'Inactive Customer') return 'Dormant Customer'
    return type
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-end justify-between gap-4 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-400 uppercase">Revenue Recovery</p>
          <h1 className="mt-1 text-4xl sm:text-5xl font-serif tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Your business at a glance. See what's at risk, what's been recovered, and what to do next.</p>
        </div>
        <div className="hidden sm:block flex-shrink-0 rounded-xl border border-slate-700 bg-[#0d1d31] px-4 py-2.5 text-xs text-slate-400">Sep 7, 2026 · Last 30 days</div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<DollarSign className="w-5 h-5" />} label="Recoverable revenue" value={formatCurrency(metrics.recoverable)} sub="Estimated revenue from open opportunities" trend="12% vs. last 30 days" />
        <MetricCard icon={<Check className="w-5 h-5" />} label="Revenue recovered" value={formatCurrency(metrics.recovered)} sub="Actual revenue brought back" trend="28% vs. last 30 days" positive />
        <MetricCard icon={<Wrench className="w-5 h-5" />} label="Active loose ends" value={metrics.active} sub="Open opportunities across all categories" trend="6% vs. last 30 days" />
        <MetricCard icon={<Target className="w-5 h-5" />} label="Recovery rate" value={`${metrics.recoveryRate}%`} sub="Recovered vs. total opportunity value" trend="11% vs. last 30 days" positive />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.8fr)] gap-4">
        <section className="rounded-3xl border border-slate-800 bg-[#0d1d31] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
            <div><h2 className="font-semibold text-slate-100">Loose Ends queue</h2><p className="text-xs text-slate-500 mt-1">Highest-value opportunities, ranked by potential revenue.</p></div>
            <button onClick={() => navigate('/dashboard/revenue-recovery')} className="text-xs font-medium text-brand-400 hover:text-brand-300 flex items-center gap-1">View all <ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div>
            {queue.map((opp, index) => (
              <div key={opp.id} className={`grid grid-cols-[minmax(125px,180px)_minmax(0,1fr)_auto_auto_auto] gap-3 items-center px-6 py-4 ${index !== queue.length - 1 ? 'border-b border-slate-800' : ''}`}>
                <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${opp.type === 'Declined Work' ? 'bg-red-500/20 text-red-300' : opp.type === 'Maintenance Due' ? 'bg-blue-500/20 text-blue-300' : opp.type === 'Missed Call' ? 'bg-slate-700 text-slate-300' : 'bg-indigo-500/20 text-indigo-300'}`}>{actionLabel(opp.type)}</span>
                <div className="min-w-0"><p className="font-semibold text-slate-100 truncate">{opp.customerName}</p><p className="text-xs text-slate-500 truncate">{opp.phone}{opp.vehicle ? ` · ${opp.vehicle.year} ${opp.vehicle.make} ${opp.vehicle.model}` : ''}</p></div>
                <span className="font-semibold text-slate-200 whitespace-nowrap">{formatCurrency(opp.potentialValue)}</span>
                <span className={`hidden sm:inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${opp.potentialValue >= 1000 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{opp.potentialValue >= 1000 ? 'High' : 'Medium'}</span>
                <button onClick={() => navigate(`/dashboard/revenue-recovery?opportunity=${encodeURIComponent(opp.id)}`)} className="rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-xs px-4 py-2.5 whitespace-nowrap transition-colors">Take action</button>
              </div>
            ))}
            {queue.length === 0 && <div className="px-6 py-12 text-center text-sm text-slate-500">No open opportunities. You're caught up.</div>}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-[#0d1d31] p-6">
          <h2 className="font-semibold text-slate-100">Next best actions</h2>
          <p className="text-xs text-slate-500 mt-1 mb-5">Quick actions to recover revenue fast.</p>
          <div className="space-y-2.5">
            <ActionRow icon={<Phone className="w-5 h-5" />} title="Make a call" subtitle="High-value customers waiting" count={actionCounts.calls} onClick={() => navigate('/dashboard/revenue-recovery')} />
            <ActionRow icon={<MessageSquare className="w-5 h-5" />} title="Send a text" subtitle="Fast, easy follow-ups" count={actionCounts.texts} onClick={() => navigate('/dashboard/follow-ups')} />
            <ActionRow icon={<Mail className="w-5 h-5" />} title="Send an email" subtitle="Re-engage with a written offer" count={actionCounts.emails} onClick={() => navigate('/dashboard/customers')} />
            <ActionRow icon={<Bell className="w-5 h-5" />} title="Set reminders" subtitle="Never lose track of a follow-up" count={actionCounts.reminders} onClick={() => navigate('/dashboard/follow-ups')} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SmallStat label="Customers" value={String(data.customers.length)} />
        <SmallStat label="Open opportunities" value={String(metrics.active)} />
        <SmallStat label="Follow-ups" value={String(data.followUps.length)} />
        <SmallStat label="Recovered events" value={String(data.revenueEvents.length)} />
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, sub, trend, positive }: { icon: React.ReactNode; label: string; value: string | number; sub: string; trend: string; positive?: boolean }) {
  return <div className="rounded-3xl border border-slate-800 bg-[#0d1d31] p-5 min-h-[190px] shadow-[0_10px_30px_rgba(0,0,0,0.12)]"><div className="w-10 h-10 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center mb-4">{icon}</div><p className="text-xs text-slate-500">{label}</p><p className="text-3xl font-semibold tracking-tight text-white mt-1">{value}</p><p className="text-xs text-slate-500 mt-1.5 max-w-[220px] leading-5">{sub}</p><p className={`text-xs font-medium mt-4 ${positive ? 'text-brand-400' : 'text-brand-400'}`}>↗ {trend}</p></div>
}

function ActionRow({ icon, title, subtitle, count, onClick }: { icon: React.ReactNode; title: string; subtitle: string; count: number; onClick: () => void }) {
  return <button onClick={onClick} className="w-full flex items-center gap-3 rounded-2xl border border-slate-700 bg-[#12243a] hover:bg-[#172b44] px-4 py-3.5 text-left transition-colors"><div className="w-10 h-10 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center flex-shrink-0">{icon}</div><div className="min-w-0 flex-1"><p className="font-semibold text-slate-200 text-sm">{title}</p><p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p></div><span className="text-sm text-slate-400">{count}</span></button>
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-[#0d1d31] px-4 py-3"><p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p><p className="text-lg font-semibold text-slate-200 mt-1">{value}</p></div>
}
