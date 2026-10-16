import { useMemo, useState } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { formatCurrency } from '../utils'
import { DollarSign, Check, Phone, MessageSquare, Mail, Bell, Target, Wrench, ChevronRight, ScanSearch } from 'lucide-react'

export function Dashboard() {
  const { data, runRevenueScan, cloudReady } = useStore()
  const { navigate } = useRouter()
  const [scanMessage, setScanMessage] = useState('')

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

  function runScan() {
    const result = runRevenueScan()
    setScanMessage(result.created ? `Found ${result.created} new revenue opportunities worth ${formatCurrency(result.potential)}.` : 'Scan complete — no new revenue opportunities found.')
    window.setTimeout(() => setScanMessage(''), 6000)
  }

  return (
    <div className="premium-dashboard space-y-6 animate-fadeIn">
      <div className="premium-hero flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.14em] text-[#78e4c5] uppercase">REVENUE INTELLIGENCE</p>
          <h1 className="mt-1 text-3xl sm:text-5xl font-semibold tracking-tight text-white">Your command center</h1>
          <p className="mt-2 text-sm text-slate-300 max-w-xl">Your business at a glance. See what's at risk, what's been recovered, and what to do next.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={runScan} className="premium-hero-action inline-flex items-center justify-center gap-2 rounded-xl font-semibold text-sm px-5 py-3 transition-colors"><ScanSearch className="w-4 h-4" /> Find revenue</button>
          <div className="hidden sm:block rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-xs text-slate-200">Live workspace totals</div>
        </div>
      </div>

      {scanMessage && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">{scanMessage} {cloudReady ? 'Saved to your workspace.' : 'Saved on this device.'}</div>}

      <div className="premium-metrics grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<DollarSign className="w-5 h-5" />} label="Recoverable revenue" value={formatCurrency(metrics.recoverable)} sub="Estimated revenue from open opportunities" />
        <MetricCard icon={<Check className="w-5 h-5" />} label="Revenue recovered" value={formatCurrency(metrics.recovered)} sub="Actual revenue brought back" />
        <MetricCard icon={<Wrench className="w-5 h-5" />} label="Active loose ends" value={metrics.active} sub="Open opportunities across all categories" />
        <MetricCard icon={<Target className="w-5 h-5" />} label="Recovery rate" value={`${metrics.recoveryRate}%`} sub="Recovered vs. total opportunity value" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.8fr)] gap-4">
        <section className="premium-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-5 border-b border-slate-100">
            <div><h2 className="font-semibold text-slate-900">Priority recovery queue</h2><p className="text-xs text-slate-500 mt-1">Highest-value opportunities, ranked by potential revenue.</p></div>
            <button onClick={() => navigate('/dashboard/revenue-recovery')} className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 whitespace-nowrap">View all <ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div>
            {queue.map((opp, index) => (
              <div key={opp.id} className={`flex flex-wrap sm:grid sm:grid-cols-[minmax(110px,150px)_minmax(0,1fr)_auto_auto] xl:grid-cols-[minmax(125px,180px)_minmax(0,1fr)_auto_auto_auto] gap-3 items-center px-6 py-4 ${index !== queue.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${opp.type === 'Declined Work' ? 'bg-rose-50 text-rose-700' : opp.type === 'Maintenance Due' ? 'bg-sky-50 text-sky-700' : opp.type === 'Missed Call' ? 'bg-slate-100 text-slate-700' : 'bg-indigo-50 text-indigo-700'}`}>{actionLabel(opp.type)}</span>
                <div className="min-w-0"><p className="font-semibold text-slate-900 truncate">{opp.customerName}</p><p className="text-xs text-slate-500 truncate">{opp.phone}{opp.vehicle ? ` · ${opp.vehicle.year} ${opp.vehicle.make} ${opp.vehicle.model}` : ''}</p></div>
                <span className="font-semibold text-slate-900 whitespace-nowrap">{formatCurrency(opp.potentialValue)}</span>
                <span className={`hidden sm:inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${opp.potentialValue >= 1000 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{opp.potentialValue >= 1000 ? 'High' : 'Medium'}</span>
                <button onClick={() => navigate(`/dashboard/revenue-recovery?opportunity=${encodeURIComponent(opp.id)}`)} className="premium-row-action rounded-lg font-semibold text-xs px-4 py-2.5 whitespace-nowrap transition-colors ml-auto sm:ml-0">Take action</button>
              </div>
            ))}
            {queue.length === 0 && <div className="px-6 py-12 text-center text-sm text-slate-500">No open opportunities. You're caught up.</div>}
          </div>
        </section>

        <section className="premium-panel p-5 sm:p-6">
          <h2 className="font-semibold text-slate-900">Next best actions</h2>
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

function MetricCard({ icon, label, value, sub, }: { icon: React.ReactNode; label: string; value: string | number; sub: string }) {
  return <div className="premium-metric p-5 min-h-[178px]"><div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">{icon}</div><p className="text-xs text-slate-500">{label}</p><p className="text-3xl font-semibold tracking-tight text-slate-950 mt-1">{value}</p><p className="text-xs text-slate-500 mt-1.5 max-w-[220px] leading-5">{sub}</p></div>
}

function ActionRow({ icon, title, subtitle, count, onClick }: { icon: React.ReactNode; title: string; subtitle: string; count: number; onClick: () => void }) {
  return <button onClick={onClick} className="w-full flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-emerald-50 hover:border-emerald-200 px-4 py-3.5 text-left transition-colors"><div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">{icon}</div><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900 text-sm">{title}</p><p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p></div><span className="text-sm text-slate-400">{count}</span></button>
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return <div className="premium-panel px-4 py-4"><p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p><p className="text-lg font-semibold text-slate-900 mt-1">{value}</p></div>
}
