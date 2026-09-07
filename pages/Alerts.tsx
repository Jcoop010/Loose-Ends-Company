import { useMemo } from 'react'
import { useStore } from '../store'
import { formatCurrency, formatDate } from '../utils'
import { PageHeader, AlertTypeBadge } from '../components/ui'
import { AlertTriangle, BellRing, DollarSign, Wrench, X } from 'lucide-react'

const alertIcons: Record<string, JSX.Element> = {
  URGENT: <AlertTriangle className="w-5 h-5" />,
  'FOLLOW-UP': <BellRing className="w-5 h-5" />,
  OPPORTUNITY: <DollarSign className="w-5 h-5" />,
  MAINTENANCE: <Wrench className="w-5 h-5" />,
}

const severityStyles: Record<string, string> = {
  urgent: 'bg-error-50 border-error-200',
  warning: 'bg-warning-50 border-warning-200',
  info: 'bg-brand-50 border-brand-200',
  success: 'bg-success-50 border-success-200',
}

export function Alerts() {
  const { data, dismissAlert } = useStore()

  const activeAlerts = useMemo(
    () => data.alerts.filter(a => !a.dismissed).sort((a, b) => {
      const order: Record<string, number> = { urgent: 0, warning: 1, info: 2, success: 3 }
      return order[a.severity] - order[b.severity]
    }),
    [data.alerts],
  )

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    activeAlerts.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1 })
    return counts
  }, [activeAlerts])

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Alerts" subtitle={`${activeAlerts.length} active alerts requiring your attention`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {['URGENT', 'FOLLOW-UP', 'OPPORTUNITY', 'MAINTENANCE'].map(type => (
          <div key={type} className="card p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-slate-100 text-slate-600">{alertIcons[type]}</div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{type}</p>
                <p className="text-xl font-bold text-slate-900">{typeCounts[type] || 0}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {activeAlerts.map(alert => (
          <div key={alert.id} className={`card p-4 border-l-4 ${severityStyles[alert.severity]}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={`p-2 rounded-lg flex-shrink-0 ${alert.severity === 'urgent' ? 'bg-error-100 text-error-600' : alert.severity === 'warning' ? 'bg-warning-100 text-warning-600' : alert.severity === 'success' ? 'bg-success-100 text-success-600' : 'bg-brand-100 text-brand-600'}`}>
                  {alertIcons[alert.type]}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTypeBadge type={alert.type} severity={alert.severity} />
                    {alert.customerName && <span className="text-sm font-semibold text-slate-900">{alert.customerName}</span>}
                  </div>
                  <p className="text-sm text-slate-700 mt-1">{alert.reason}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {alert.dollarValue && <span className="text-sm font-bold text-brand-600">{formatCurrency(alert.dollarValue)}</span>}
                    <span className="text-xs text-slate-500">Action: {alert.recommendedAction}</span>
                    <span className="text-xs text-slate-400">{formatDate(alert.date)}</span>
                  </div>
                </div>
              </div>
              <button onClick={() => dismissAlert(alert.id)} className="p-1.5 rounded-lg text-slate-400 hover:bg-error-50 hover:text-error-600 transition-colors flex-shrink-0" title="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {activeAlerts.length === 0 && (
          <div className="card p-8 text-center text-slate-500">No active alerts. You're all caught up!</div>
        )}
      </div>
    </div>
  )
}
