import { useState } from 'react'
import { useStore } from '../store'
import { QUICK_REQUESTS } from '../data'
import type { Request } from '../types'
import { PageHeader, PriorityBadge, RequestStatusBadge } from '../components/ui'
import { ClipboardList, Plus, Zap, X } from 'lucide-react'
import { formatDate } from '../utils'

export function BusinessRequests() {
  const { data, addRequest, updateRequest } = useStore()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<{ request: string; priority: Request['priority']; dueDate: string }>({ request: '', priority: 'Medium', dueDate: '' })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (form.request.trim()) {
      addRequest({ request: form.request, priority: form.priority, dueDate: form.dueDate || undefined, status: 'New' })
      setForm({ request: '', priority: 'Medium', dueDate: '' })
      setShowModal(false)
    }
  }

  const quickAdd = (text: string) => {
    addRequest({ request: text, priority: 'Medium', status: 'New' })
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Business Requests"
        subtitle="Submit requests and track their progress."
        action={
          <button onClick={() => setShowModal(true)} className="btn-primary text-sm">
            <Plus className="w-4 h-4" /> New Request
          </button>
        }
      />

      <div className="card p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Quick Requests</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_REQUESTS.map(q => (
            <button
              key={q}
              onClick={() => quickAdd(q)}
              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-brand-50 hover:text-brand-700 transition-all"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-slate-400" /> All Requests ({data.requests.length})
        </h3>
        <div className="space-y-3">
          {data.requests.map((req: Request) => (
            <div key={req.id} className="flex items-start justify-between p-4 bg-slate-50 rounded-lg gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{req.request}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <PriorityBadge priority={req.priority} />
                  <RequestStatusBadge status={req.status} />
                  {req.dueDate && <span className="text-xs text-slate-500">Due: {formatDate(req.dueDate)}</span>}
                  <span className="text-xs text-slate-400">Created: {formatDate(req.createdAt)}</span>
                </div>
                {req.notes && <p className="text-xs text-slate-500 mt-2">{req.notes}</p>}
              </div>
              <select
                value={req.status}
                onChange={e => updateRequest(req.id, { status: e.target.value as Request['status'] })}
                className="input w-auto text-xs py-1.5"
              >
                <option value="New">New</option>
                <option value="In Progress">In Progress</option>
                <option value="Waiting">Waiting</option>
                <option value="Complete">Complete</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fadeIn" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">New Request</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Request</label>
                <input
                  type="text"
                  value={form.request}
                  onChange={e => setForm({ ...form, request: e.target.value })}
                  placeholder="What do you need?"
                  className="input"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as Request['priority'] })} className="input">
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="label">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="input" />
                </div>
              </div>
              <button type="submit" className="btn-primary w-full">
                <Zap className="w-4 h-4" /> Submit Request
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
