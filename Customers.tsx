import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { CUSTOMER_STATUSES } from '../data'
import type { Customer } from '../types'
import { formatCurrency, formatDate, monthsSince, timeAgo } from '../utils'
import { PageHeader, CustomerStatusBadge, InfoRow, OpportunityStatusBadge, FollowUpStatusBadge } from '../components/ui'
import {
  Search, ChevronRight, ArrowLeft, Phone, Mail,
  Wrench, DollarSign, Plus, CalendarClock,
  MessageSquare, CheckCircle, Star, X,
} from 'lucide-react'

const timelineIcons: Record<string, JSX.Element> = {
  Appointment: <CalendarClock className="w-4 h-4" />,
  Diagnosis: <Search className="w-4 h-4" />,
  Estimate: <DollarSign className="w-4 h-4" />,
  Repair: <Wrench className="w-4 h-4" />,
  Payment: <DollarSign className="w-4 h-4" />,
  Communication: <MessageSquare className="w-4 h-4" />,
  Review: <Star className="w-4 h-4" />,
  'Follow-up': <CalendarClock className="w-4 h-4" />,
}

function TimelineEvent({ event, isLast }: { event: any; isLast: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
          {timelineIcons[event.type] || <MessageSquare className="w-4 h-4" />}
        </div>
        {!isLast && <div className="w-px h-full bg-slate-200 mt-1" />}
      </div>
      <div className="pb-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">{event.title}</p>
          <span className="badge-neutral text-[10px]">{event.type}</span>
        </div>
        <p className="text-sm text-slate-600 mt-0.5">{event.description}</p>
        <p className="text-xs text-slate-400 mt-0.5">{formatDate(event.date)}</p>
        {event.amount && <p className="text-sm font-semibold text-slate-900 mt-1">{formatCurrency(event.amount)}</p>}
      </div>
    </div>
  )
}

function CustomerDetail({ customer, onBack }: { customer: Customer; onBack: () => void }) {
  const { data, addNoteToCustomer } = useStore()
  const [noteText, setNoteText] = useState('')

  const vehicle = data.vehicles.find(v => v.id === customer.vehicleId)
  const timeline = data.timelineEvents.filter(t => t.customerId === customer.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const jobs = data.jobs.filter(j => j.customerId === customer.id)
  const estimates = data.estimates.filter(e => e.customerId === customer.id)
  const opportunities = data.opportunities.filter(o => o.customerId === customer.id)
  const followUps = data.followUps.filter(f => f.customerId === customer.id)
  const communications = timeline.filter(t => t.type === 'Communication' || t.type === 'Follow-up' || t.type === 'Review')

  const addNote = () => {
    if (noteText.trim()) {
      addNoteToCustomer(customer.id, noteText.trim())
      setNoteText('')
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <button onClick={onBack} className="btn-ghost text-sm -ml-2">
        <ArrowLeft className="w-4 h-4" /> Back to Customers
      </button>

      {/* Contact information */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-brand-100 rounded-full flex items-center justify-center">
                <span className="text-lg font-bold text-brand-700">{customer.name.split(' ').map(n => n[0]).join('')}</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{customer.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <CustomerStatusBadge status={customer.status} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Phone className="w-4 h-4 text-slate-400" /> {customer.phone}
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Mail className="w-4 h-4 text-slate-400" /> {customer.email}
              </div>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Lifetime Value</p>
            <p className="text-2xl font-bold text-brand-600">{formatCurrency(customer.lifetimeValue)}</p>
          </div>
        </div>
      </div>

      {/* Vehicle info */}
      {vehicle && (
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-slate-400" /> Vehicle Information
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <InfoRow label="Year" value={String(vehicle.year)} />
            <InfoRow label="Make" value={vehicle.make} />
            <InfoRow label="Model" value={vehicle.model} />
            <InfoRow label="Mileage" value={`${vehicle.mileage.toLocaleString()} mi`} />
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Last Service</p>
            <p className="text-sm text-slate-700 mt-0.5">
              {customer.lastServiceDescription} — {formatDate(customer.lastService)} ({monthsSince(customer.lastService)} months ago)
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary text-sm"><Phone className="w-4 h-4" /> Contact</button>
        <button className="btn-secondary text-sm"><CalendarClock className="w-4 h-4" /> Schedule Follow-Up</button>
        <button className="btn-secondary text-sm"><Plus className="w-4 h-4" /> Add Opportunity</button>
      </div>

      {/* Service history (timeline) */}
      <div className="card p-5">
        <h3 className="font-bold text-slate-900 mb-4">Customer Timeline</h3>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500">No timeline events yet.</p>
        ) : (
          <div className="space-y-4">
            {timeline.map((event, i) => (
              <TimelineEvent key={event.id} event={event} isLast={i === timeline.length - 1} />
            ))}
          </div>
        )}
      </div>

      {/* Two-column layout for jobs/estimates and communications/opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service History (Jobs) */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Service History ({jobs.length})</h3>
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-500">No jobs recorded.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => (
                <div key={job.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{job.description}</p>
                    <p className="text-xs text-slate-500">{formatDate(job.date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{formatCurrency(job.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Estimates */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Estimates ({estimates.length})</h3>
          {estimates.length === 0 ? (
            <p className="text-sm text-slate-500">No estimates recorded.</p>
          ) : (
            <div className="space-y-2">
              {estimates.map(est => (
                <div key={est.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{est.description}</p>
                    <p className="text-xs text-slate-500">{formatDate(est.date)} · {est.status}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{formatCurrency(est.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Communications */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Communications ({communications.length})</h3>
          {communications.length === 0 ? (
            <p className="text-sm text-slate-500">No communications recorded.</p>
          ) : (
            <div className="space-y-2">
              {communications.map(comm => (
                <div key={comm.id} className="flex items-start gap-3 p-2.5 bg-slate-50 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
                    {timelineIcons[comm.type] || <MessageSquare className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{comm.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{comm.description}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(comm.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Opportunities */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Opportunities ({opportunities.length})</h3>
          {opportunities.length === 0 ? (
            <p className="text-sm text-slate-500">No opportunities yet.</p>
          ) : (
            <div className="space-y-2">
              {opportunities.map(opp => (
                <div key={opp.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{opp.type}</p>
                    <p className="text-xs text-slate-500">{opp.nextAction}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">
                      {opp.status === 'Collected' && opp.collectedAmount ? formatCurrency(opp.collectedAmount) : formatCurrency(opp.potentialValue)}
                    </p>
                    <OpportunityStatusBadge status={opp.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Follow-ups */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Follow-Ups ({followUps.length})</h3>
          {followUps.length === 0 ? (
            <p className="text-sm text-slate-500">No follow-ups scheduled.</p>
          ) : (
            <div className="space-y-2">
              {followUps.map(fu => (
                <div key={fu.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{fu.reason}</p>
                    <p className="text-xs text-slate-500">Due: {formatDate(fu.dueDate)} · {fu.nextAction}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(fu.potentialValue)}</p>
                    <FollowUpStatusBadge status={fu.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Notes</h3>
          <div className="flex gap-2 mb-3">
            <input
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder="Add a note..."
              className="input"
            />
            <button onClick={addNote} className="btn-primary text-sm flex-shrink-0">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {!customer.notes || customer.notes.length === 0 ? (
            <p className="text-sm text-slate-500">No notes yet.</p>
          ) : (
            <div className="space-y-2">
              {(customer.notes || []).map((note, i) => (
                <div key={i} className="p-2.5 bg-slate-50 rounded-lg text-sm text-slate-700">{note}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Customers() {
  const { data, addCustomer } = useStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', status: 'Active' as Customer['status'], lastService: '', lastServiceDescription: '', lifetimeValue: '0', notes: '' })

  const filtered = useMemo(
    () => data.customers.filter(c => {
      if (statusFilter !== 'All' && c.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q)
      }
      return true
    }),
    [data.customers, statusFilter, search],
  )

  const selected = selectedId ? data.customers.find(c => c.id === selectedId) : null

  const submitCustomer = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) return
    const now = new Date().toISOString()
    const id = addCustomer({
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), status: form.status,
      lastService: form.lastService ? new Date(form.lastService).toISOString() : now,
      lastServiceDescription: form.lastServiceDescription.trim() || 'New customer',
      lifetimeValue: Math.max(0, Number(form.lifetimeValue) || 0),
      notes: form.notes.trim() ? [form.notes.trim()] : [],
    })
    setForm({ name: '', phone: '', email: '', status: 'Active', lastService: '', lastServiceDescription: '', lifetimeValue: '0', notes: '' })
    setShowAdd(false)
    setSelectedId(id)
  }

  if (selected) return <CustomerDetail customer={selected} onBack={() => setSelectedId(null)} />

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Customers" subtitle={`${data.customers.length} customers in your database`} action={<button onClick={() => setShowAdd(true)} className="btn-primary text-sm"><Plus className="w-4 h-4" /> Add Customer</button>} />

      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, phone, or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {CUSTOMER_STATUSES.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${statusFilter === status ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>


      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fadeIn" onClick={() => setShowAdd(false)}>
          <form onSubmit={submitCustomer} className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div><h3 className="text-lg font-bold text-slate-900">Add Customer</h3><p className="text-sm text-slate-500 mt-1">Create a customer record you can use across the workspace.</p></div>
              <button type="button" onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="label">Name *</label><input required value={form.name} onChange={e => setForm({...form,name:e.target.value})} className="input" placeholder="Alex Morgan" /></div>
              <div><label className="label">Phone *</label><input required value={form.phone} onChange={e => setForm({...form,phone:e.target.value})} className="input" placeholder="(555) 123-4567" /></div>
              <div><label className="label">Email</label><input type="email" value={form.email} onChange={e => setForm({...form,email:e.target.value})} className="input" placeholder="alex@example.com" /></div>
              <div><label className="label">Status</label><select value={form.status} onChange={e => setForm({...form,status:e.target.value as Customer['status']})} className="input">{CUSTOMER_STATUSES.filter(x => x !== 'All').map(x => <option key={x}>{x}</option>)}</select></div>
              <div><label className="label">Last Service Date</label><input type="date" value={form.lastService} onChange={e => setForm({...form,lastService:e.target.value})} className="input" /></div>
              <div><label className="label">Lifetime Value</label><input type="number" min="0" step="0.01" value={form.lifetimeValue} onChange={e => setForm({...form,lifetimeValue:e.target.value})} className="input" /></div>
              <div className="sm:col-span-2"><label className="label">Last Service</label><input value={form.lastServiceDescription} onChange={e => setForm({...form,lastServiceDescription:e.target.value})} className="input" placeholder="Oil change and inspection" /></div>
              <div className="sm:col-span-2"><label className="label">Notes</label><textarea rows={3} value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} className="input" placeholder="Preferences, context, follow-up details..." /></div>
            </div>
            <div className="flex gap-2 mt-6"><button type="button" onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Cancel</button><button type="submit" className="btn-primary flex-1"><Plus className="w-4 h-4" /> Create Customer</button></div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden sm:table-cell">Phone</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden md:table-cell">Vehicle</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden lg:table-cell">Last Service</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-700">LTV</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(customer => {
                const vehicle = data.vehicles.find(v => v.id === customer.vehicleId)
                return (
                  <tr
                    key={customer.id}
                    onClick={() => setSelectedId(customer.id)}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{customer.name}</div>
                      <div className="text-xs text-slate-500 sm:hidden">{customer.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{customer.phone}</td>
                    <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '—'}</td>
                    <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">{timeAgo(customer.lastService)}</td>
                    <td className="px-4 py-3"><CustomerStatusBadge status={customer.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(customer.lifetimeValue)}</td>
                    <td className="px-4 py-3"><ChevronRight className="w-4 h-4 text-slate-400" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-slate-500">No customers found.</div>}
        </div>
      </div>
    </div>
  )
}
