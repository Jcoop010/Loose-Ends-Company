import { useMemo } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { formatCurrency, timeAgo } from '../utils'
import { PageHeader, StatCard, MiniStat } from '../components/ui'
import { DollarSign, TrendingUp, CalendarCheck, AlertTriangle, Zap, ChevronRight, Bell } from 'lucide-react'

export function Dashboard() {
  const { data } = useStore()
  const { navigate } = useRouter()

  const metrics = useMemo(() => {
    const potential = data.opportunities
      .filter(o => o.status !== 'Collected')
      .reduce((sum, o) => sum + o.potentialValue, 0)
    const recovered = data.opportunities
      .filter(o => o.status === 'Collected')
      .reduce((sum, o) => sum + (o.collectedAmount || 0), 0)
    const recoveryRate = potential + recovered > 0 ? Math.round((recovered / (potential + recovered)) * 1000) / 10 : 0
    const followUpsDue = data.followUps.filter(f => f.status === 'Due Today').length
    const customersAtRisk = data.customers.filter(c => c.status === 'Inactive' || c.status === 'Follow-Up Due' || c.status === 'Maintenance Due').length
    const missedCalls = data.opportunities.filter(o => o.type === 'Missed Call' && o.status === 'Potential').length
    return { potential, recovered, recoveryRate, followUpsDue, customersAtRisk, missedCalls }
  }, [data])

  const topOpportunities = useMemo(
    () => data.opportunities.filter(o => o.status === 'Potential').sort((a, b) => b.potentialValue - a.potentialValue).slice(0, 5),
    [data.opportunities],
  )

  const recommendations = useMemo(() => {
    const recs: { text: string; value?: number }[] = []
    const declined = data.opportunities.find(o => o.type === 'Declined Work' && o.status === 'Potential')
    if (declined) recs.push({ text: `Follow up with ${declined.customerName}`, value: declined.potentialValue })
    recs.push({ text: `Contact ${metrics.missedCalls} missed calls` })
    const aging = data.opportunities.filter(o => o.type === 'Old Estimate' && o.status === 'Potential').length
    recs.push({ text: `Follow up with ${aging} aging estimates` })
    recs.push({ text: `Contact ${data.customers.filter(c => c.status === 'Maintenance Due').length} maintenance-due customers` })
    return recs
  }, [data, metrics.missedCalls])

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title={`GOOD MORNING, ${data.business.owner.toUpperCase().split(' ')[0]}`}
        subtitle="Here's where your business stands today."
        action={
          <span className="badge bg-accent-100 text-accent-700 text-sm px-3 py-1">
            <Zap className="w-3.5 h-3.5" /> DEMO MODE
          </span>
        }
      />

      {/* Prominent dashboard metrics - calculated from underlying data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Potential Revenue Found" value={formatCurrency(metrics.potential)} icon={<DollarSign className="w-5 h-5" />} accent="brand" />
        <StatCard label="Recovered Revenue" value={formatCurrency(metrics.recovered)} icon={<TrendingUp className="w-5 h-5" />} accent="success" />
        <StatCard label="Follow-Ups Due" value={metrics.followUpsDue} icon={<CalendarCheck className="w-5 h-5" />} accent="warning" />
        <StatCard label="Customers At Risk" value={metrics.customersAtRisk} icon={<AlertTriangle className="w-5 h-5" />} accent="error" />
      </div>

      {/* FIND ME MONEY - Revenue Recovery as primary feature */}
      <div className="card p-5 sm:p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-700">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 bg-accent-500 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-2xl font-bold">FIND ME MONEY</h2>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Potential Revenue</p>
                <p className="text-xl font-bold mt-0.5">{formatCurrency(metrics.potential)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Recovered Revenue</p>
                <p className="text-xl font-bold text-success-400 mt-0.5">{formatCurrency(metrics.recovered)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Recovery Rate</p>
                <p className="text-xl font-bold text-accent-400 mt-0.5">{metrics.recoveryRate}%</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3">Recovered revenue represents confirmed revenue reported by the business.</p>
          </div>
          <button
            onClick={() => navigate('/dashboard/revenue-recovery')}
            className="btn-accent text-base px-6 py-3 self-start lg:self-center"
          >
            <Zap className="w-5 h-5" /> FIND ME MONEY
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-700">
          <p className="text-sm text-slate-400 mb-3">Top opportunities by potential value:</p>
          <div className="space-y-3">
            {topOpportunities.map(opp => (
              <div
                key={opp.id}
                className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3 hover:bg-slate-800 transition-colors cursor-pointer"
                onClick={() => navigate('/dashboard/revenue-recovery')}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-4 h-4 text-accent-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{opp.customerName}</p>
                    <p className="text-xs text-slate-400 truncate">{opp.nextAction}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="font-bold text-accent-400">{formatCurrency(opp.potentialValue)}</p>
                  <p className="text-[10px] text-slate-500">{timeAgo(opp.dateIdentified)}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/dashboard/revenue-recovery')}
            className="mt-4 text-sm text-brand-400 hover:text-brand-300 font-medium flex items-center gap-1"
          >
            View all opportunities <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Today's recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-brand-600" /> Today's Priorities
          </h3>
          <div className="space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-700">{rec.text}</span>
                {rec.value && <span className="text-sm font-bold text-brand-600">{formatCurrency(rec.value)}</span>}
              </div>
            ))}
          </div>
          <button onClick={() => navigate('/dashboard/follow-ups')} className="mt-4 btn-secondary text-sm w-full">
            Go to Follow-Up Center
          </button>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-accent-600" /> Recent Alerts
          </h3>
          <div className="space-y-3">
            {data.alerts.filter(a => !a.dismissed).slice(0, 4).map(alert => (
              <div key={alert.id} className="flex items-start justify-between p-3 bg-slate-50 rounded-lg">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{alert.customerName || 'Multiple customers'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{alert.reason}</p>
                </div>
                {alert.dollarValue && <span className="text-sm font-bold text-brand-600 flex-shrink-0 ml-2">{formatCurrency(alert.dollarValue)}</span>}
              </div>
            ))}
          </div>
          <button onClick={() => navigate('/dashboard/alerts')} className="mt-4 btn-secondary text-sm w-full">
            View All Alerts
          </button>
        </div>
      </div>

      {/* Quick stats footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Total Customers" value={String(data.customers.length)} />
        <MiniStat label="Active Opportunities" value={String(data.opportunities.filter(o => o.status !== 'Collected').length)} />
        <MiniStat label="Follow-Ups Total" value={String(data.followUps.length)} />
        <MiniStat label="Revenue Events" value={String(data.revenueEvents.length)} />
      </div>
    </div>
  )
}


