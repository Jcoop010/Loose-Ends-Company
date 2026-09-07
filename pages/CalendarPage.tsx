import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { PageHeader } from '../components/ui'
import type { CalendarEvent, CalendarEventType } from '../types'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'

const TYPES: CalendarEventType[] = ['Appointment', 'Follow-up', 'Delivery', 'Call', 'Internal', 'Install']
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function dayKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function CalendarPage() {
  const { data, addCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = useStore()
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => new Date())
  const [editing, setEditing] = useState<Partial<CalendarEvent> | null>(null)
  const monthStart = startOfMonth(cursor)
  const gridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const combined = useMemo(() => {
    const events: CalendarEvent[] = [...(data.calendarEvents || [])]
    ;(data.followUps || []).filter(f => f.status !== 'Dismissed').forEach(f => events.push({ id: `fu-${f.id}`, title: `${f.customerName} — ${f.reason}`, type: 'Follow-up', start: f.dueDate, end: f.dueDate, customerId: f.customerId, customerName: f.customerName }))
    ;(data.salesOrders || []).filter(o => o.scheduledAt || o.dueDate).forEach(o => { const start = o.scheduledAt || o.dueDate!; events.push({ id: `so-${o.id}`, title: `${o.number} ${o.title}`, type: 'Appointment', start, end: start, customerId: o.customerId, customerName: o.customerName, orderId: o.id }) })
    return events
  }, [data.calendarEvents, data.followUps, data.salesOrders])
  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    combined.forEach(ev => { const key = dayKey(new Date(ev.start)); map[key] = [...(map[key] || []), ev] })
    return map
  }, [combined])
  const selectedEvents = eventsByDay[dayKey(selected)] || []

  const saveEvent = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing?.title || !editing.start) return
    const start = new Date(editing.start).toISOString()
    const end = editing.end ? new Date(editing.end).toISOString() : new Date(new Date(start).getTime() + 30 * 60000).toISOString()
    const customer = data.customers.find(c => c.id === editing.customerId)
    const payload = { title: editing.title, type: (editing.type || 'Appointment') as CalendarEventType, start, end, customerId: editing.customerId, customerName: customer?.name || editing.customerName, orderId: editing.orderId, location: editing.location, notes: editing.notes }
    if (editing.id && !String(editing.id).startsWith('fu-') && !String(editing.id).startsWith('so-')) updateCalendarEvent(editing.id, payload)
    else addCalendarEvent(payload)
    setEditing(null)
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Calendar" subtitle="Appointments, sales-order dates, calls, and follow-ups in one schedule." />
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></button>
          <h2 className="text-lg font-bold min-w-44 text-center">{cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h2>
          <button className="btn-secondary" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="w-4 h-4" /></button>
        </div>
        <button className="btn-primary sm:ml-auto" onClick={() => setEditing({ title: '', type: 'Appointment', start: `${dayKey(selected)}T09:00`, end: `${dayKey(selected)}T10:00` })}><Plus className="w-4 h-4" /> New event</button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 card p-3 overflow-hidden">
          <div className="grid grid-cols-7 text-[11px] font-semibold text-slate-500 uppercase">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="px-2 py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7 border-t border-slate-100">
            {days.map(day => {
              const key = dayKey(day)
              const inMonth = day.getMonth() === cursor.getMonth()
              const events = eventsByDay[key] || []
              return (
                <button key={key} onClick={() => setSelected(day)} className={`min-h-24 p-1.5 text-left border-b border-r border-slate-100 ${inMonth ? 'bg-white' : 'bg-slate-50'} ${sameDay(day, selected) ? 'ring-2 ring-brand-400 ring-inset' : ''}`}>
                  <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs ${sameDay(day, new Date()) ? 'bg-brand-600 text-white' : inMonth ? 'text-slate-800' : 'text-slate-400'}`}>{day.getDate()}</span>
                  <div className="mt-1 space-y-1">{events.slice(0, 3).map(ev => <div key={ev.id} className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-800">{ev.title}</div>)}</div>
                </button>
              )
            })}
          </div>
        </section>
        <section className="card p-5">
          <h3 className="font-bold">{selected.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <p className="text-sm text-slate-500 mb-4">{selectedEvents.length} scheduled</p>
          <div className="space-y-2">
            {selectedEvents.map(ev => (
              <div key={ev.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex justify-between gap-2">
                  <div><p className="text-sm font-semibold">{ev.title}</p><p className="text-xs text-slate-500">{ev.type}{ev.customerName ? ` · ${ev.customerName}` : ''}</p></div>
                  {!ev.id.startsWith('fu-') && !ev.id.startsWith('so-') && <button className="text-slate-400" onClick={() => deleteCalendarEvent(ev.id)}><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            ))}
            {selectedEvents.length === 0 && <p className="text-sm text-slate-500">Nothing scheduled.</p>}
          </div>
        </section>
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={saveEvent} className="card p-5 w-full max-w-md space-y-3">
            <h2 className="text-lg font-bold">{editing.id ? 'Edit event' : 'New event'}</h2>
            <input className="input" placeholder="Title *" value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} />
            <select className="input" value={editing.type || 'Appointment'} onChange={e => setEditing({ ...editing, type: e.target.value as CalendarEventType })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
            <select className="input" value={editing.customerId || ''} onChange={e => setEditing({ ...editing, customerId: e.target.value })}><option value="">No customer</option>{data.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input className="input" type="datetime-local" value={editing.start || ''} onChange={e => setEditing({ ...editing, start: e.target.value })} />
            <input className="input" type="datetime-local" value={editing.end || ''} onChange={e => setEditing({ ...editing, end: e.target.value })} />
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary">Save event</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
