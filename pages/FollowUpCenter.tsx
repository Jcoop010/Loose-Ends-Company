import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { FOLLOWUP_STATUSES } from '../data'
import type { FollowUp } from '../types'
import { formatCurrency, formatDate } from '../utils'
import { PageHeader, FollowUpStatusBadge, SortButton } from '../components/ui'
import {
  Check, CalendarClock, DollarSign, BellOff, X,
  Phone, Clock, MessageSquare,
} from 'lucide-react'

export function FollowUpCenter() {
  const { data, updateFollowUp, dismissFollowUp } = useStore()
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortBy, setSortBy] = useState('dueDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [scheduleModal, setScheduleModal] = useState<FollowUp | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')

  const filtered = useMemo(() => {
    let result = data.followUps.filter(f => !(statusFilter === 'All' && f.status === 'Dismissed') && !(statusFilter !== 'All' && f.status !== statusFilter))
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'dueDate') cmp = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      else if (sortBy === 'potentialValue') cmp = a.potentialValue - b.potentialValue
      else cmp = a.customerName.localeCompare(b.customerName)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [data.followUps, statusFilter, sortBy, sortDir])

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const markContacted = (fu: FollowUp) => {
    updateFollowUp(fu.id, { status: 'Completed', lastContact: new Date().toISOString() })
  }
  const snooze = (fu: FollowUp) => {
    updateFollowUp(fu.id, { status: 'Snoozed' })
  }
  const markRecovered = (fu: FollowUp) => {
    updateFollowUp(fu.id, { status: 'Completed' })
  }
  const openSchedule = (fu: FollowUp) => {
    setScheduleModal(fu)
    setScheduleDate(fu.dueDate.split('T')[0])
  }
  const confirmSchedule = () => {
    if (scheduleModal && scheduleDate) {
      updateFollowUp(scheduleModal.id, { dueDate: new Date(scheduleDate + 'T09:00:00Z').toISOString(), status: 'Upcoming' })
    }
    setScheduleModal(null)
    setScheduleDate('')
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    data.followUps.forEach(f => { counts[f.status] = (counts[f.status] || 0) + 1 })
    return counts
  }, [data.followUps])

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Follow-Up Center" subtitle="Make sure every opportunity gets the follow-up it deserves." />

      {/* Status filter tabs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {['Due Today', 'Upcoming', 'Completed', 'Snoozed', 'Dismissed'].map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? 'All' : status)}
            className={`card p-4 text-left transition-all ${statusFilter === status ? 'ring-2 ring-brand-500' : ''}`}
          >
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{status}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{statusCounts[status] || 0}</p>
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
            {FOLLOWUP_STATUSES.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>)}
          </select>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-slate-500 mr-1">Sort:</span>
            <SortButton active={sortBy === 'dueDate'} dir={sortDir} onClick={() => toggleSort('dueDate')} label="Due Date" />
            <SortButton active={sortBy === 'potentialValue'} dir={sortDir} onClick={() => toggleSort('potentialValue')} label="Value" />
            <SortButton active={sortBy === 'customerName'} dir={sortDir} onClick={() => toggleSort('customerName')} label="Name" />
          </div>
        </div>
      </div>

      {/* Follow-up table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Customer</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden md:table-cell">Reason</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700">Value</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden lg:table-cell">Next Action</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Due Date</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(fu => (
                <tr key={fu.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-900">{fu.customerName}</td>
                  <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{fu.reason}</td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-600">{formatCurrency(fu.potentialValue)}</td>
                  <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">{fu.nextAction}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(fu.dueDate)}</td>
                  <td className="px-4 py-3"><FollowUpStatusBadge status={fu.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {fu.status !== 'Completed' && fu.status !== 'Dismissed' && (
                        <>
                          <button onClick={() => markContacted(fu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-success-50 hover:text-success-600 transition-colors" title="Mark Contacted">
                            <Phone className="w-4 h-4" />
                          </button>
                          <button onClick={() => openSchedule(fu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-brand-50 hover:text-brand-600 transition-colors" title="Schedule Follow-Up">
                            <CalendarClock className="w-4 h-4" />
                          </button>
                          <button onClick={() => markRecovered(fu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-success-50 hover:text-success-600 transition-colors" title="Mark Recovered">
                            <DollarSign className="w-4 h-4" />
                          </button>
                          <button onClick={() => snooze(fu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" title="Snooze">
                            <BellOff className="w-4 h-4" />
                          </button>
                          <button onClick={() => dismissFollowUp(fu.id)} className="p-1.5 rounded-lg text-slate-500 hover:bg-error-50 hover:text-error-600 transition-colors" title="Dismiss">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-slate-500">No follow-ups match the current filter.</div>}
        </div>
      </div>

      {/* Schedule modal */}
      {scheduleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fadeIn"
          onClick={() => { setScheduleModal(null); setScheduleDate('') }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">Schedule Follow-Up</h3>
              <button onClick={() => { setScheduleModal(null); setScheduleDate('') }} className="p-1 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              <span className="font-semibold">{scheduleModal.customerName}</span> — {scheduleModal.reason}
            </p>
            <div className="mb-4">
              <label className="label">Follow-Up Date</label>
              <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="input" autoFocus />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setScheduleModal(null); setScheduleDate('') }} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmSchedule} className="btn-primary flex-1">
                <CalendarClock className="w-4 h-4" /> Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
