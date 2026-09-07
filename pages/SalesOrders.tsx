import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { formatCurrency, formatDate } from '../utils'
import { PageHeader } from '../components/ui'
import type { OrderLineItem, PaymentStatus, SalesOrder, SalesOrderStatus } from '../types'
import { Plus, Search, Trash2, CalendarPlus } from 'lucide-react'

const STATUSES: SalesOrderStatus[] = ['Draft', 'Quoted', 'Confirmed', 'In Progress', 'Fulfilled', 'Invoiced', 'Paid', 'Cancelled']
const PAYMENTS: PaymentStatus[] = ['Unpaid', 'Partial', 'Paid']
const emptyItem = (): OrderLineItem => ({ id: crypto.randomUUID?.() || String(Date.now()), name: '', qty: 1, unitPrice: 0 })
function orderTotal(items: OrderLineItem[], taxRate: number) {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)
  return { subtotal, tax: subtotal * taxRate, total: subtotal * (1 + taxRate) }
}

export function SalesOrders() {
  const { data, addSalesOrder, updateSalesOrder, deleteSalesOrder, addCalendarEvent } = useStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | SalesOrderStatus>('All')
  const [editing, setEditing] = useState<SalesOrder | 'new' | null>(null)
  const q = search.trim().toLowerCase()
  const orders = useMemo(() => (data.salesOrders || []).filter(o => {
    const matches = !q || [o.number, o.customerName, o.title, o.status].some(v => v.toLowerCase().includes(q))
    return matches && (statusFilter === 'All' || o.status === statusFilter)
  }), [data.salesOrders, q, statusFilter])
  const openValue = (data.salesOrders || []).filter(o => !['Paid', 'Cancelled'].includes(o.status)).reduce((s, o) => s + orderTotal(o.items, o.taxRate).total, 0)

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Sales Orders" subtitle="Create, price, schedule, and collect every order from one pipeline." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4"><p className="text-xs text-slate-500 font-semibold uppercase">Open orders</p><p className="text-xl font-bold">{(data.salesOrders || []).filter(o => !['Paid', 'Cancelled'].includes(o.status)).length}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500 font-semibold uppercase">Pipeline</p><p className="text-xl font-bold">{formatCurrency(openValue)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500 font-semibold uppercase">Customers</p><p className="text-xl font-bold">{data.customers.length}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500 font-semibold uppercase">Events</p><p className="text-xl font-bold">{(data.calendarEvents || []).length}</p></div>
      </div>
      <div className="flex flex-col lg:flex-row gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" placeholder="Search orders..." /></div>
        <select className="input w-full lg:w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}><option value="All">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
        <button onClick={() => setEditing('new')} className="btn-primary"><Plus className="w-4 h-4" /> New order</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {STATUSES.filter(s => s !== 'Cancelled').map(status => {
          const items = orders.filter(o => o.status === status)
          return (
            <section key={status} className="rounded-xl bg-slate-50 p-3 min-h-48">
              <div className="flex justify-between mb-2"><span className="text-xs font-bold text-slate-600">{status}</span><span className="text-[10px] badge-neutral">{items.length}</span></div>
              <div className="space-y-2">{items.map(o => (
                <button key={o.id} onClick={() => setEditing(o)} className="w-full text-left bg-white border border-slate-200 rounded-lg p-3 hover:border-brand-300">
                  <p className="text-[11px] font-mono text-slate-400">{o.number}</p>
                  <p className="text-sm font-semibold truncate">{o.customerName}</p>
                  <p className="text-xs text-slate-500 truncate">{o.title}</p>
                  <p className="text-xs font-bold mt-1">{formatCurrency(orderTotal(o.items, o.taxRate).total)}{o.dueDate ? ` · ${formatDate(o.dueDate)}` : ''}</p>
                </button>
              ))}</div>
            </section>
          )
        })}
      </div>
      {editing && <OrderEditor customers={data.customers} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={payload => { if (editing === 'new') addSalesOrder(payload); else updateSalesOrder(editing.id, payload); setEditing(null) }} onDelete={editing === 'new' ? undefined : () => { deleteSalesOrder(editing.id); setEditing(null) }} onSchedule={editing === 'new' ? undefined : () => { const start = editing.scheduledAt || editing.dueDate || new Date().toISOString(); addCalendarEvent({ title: `${editing.customerName} — ${editing.title}`, type: 'Appointment', start, end: new Date(new Date(start).getTime() + 90 * 60000).toISOString(), customerId: editing.customerId, customerName: editing.customerName, orderId: editing.id }); setEditing(null) }} />}
    </div>
  )
}

function OrderEditor({ customers, initial, onClose, onSave, onDelete, onSchedule }: { customers: { id: string; name: string }[]; initial: SalesOrder | null; onClose: () => void; onSave: (payload: Omit<SalesOrder, 'id' | 'number' | 'createdAt'>) => void; onDelete?: () => void; onSchedule?: () => void }) {
  const [form, setForm] = useState({ customerId: initial?.customerId || customers[0]?.id || '', title: initial?.title || '', status: (initial?.status || 'Draft') as SalesOrderStatus, paymentStatus: (initial?.paymentStatus || 'Unpaid') as PaymentStatus, taxRate: initial?.taxRate ?? 0.07, notes: initial?.notes || '', assignedTo: initial?.assignedTo || '', dueDate: initial?.dueDate ? initial.dueDate.slice(0, 16) : '', scheduledAt: initial?.scheduledAt ? initial.scheduledAt.slice(0, 16) : '', items: initial?.items?.length ? initial.items : [emptyItem()] })
  const totals = orderTotal(form.items, Number(form.taxRate) || 0)
  const customerName = customers.find(c => c.id === form.customerId)?.name || initial?.customerName || 'Customer'
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form className="card p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4" onSubmit={e => { e.preventDefault(); if (!form.title.trim()) return; onSave({ customerId: form.customerId, customerName, title: form.title.trim(), status: form.status, paymentStatus: form.paymentStatus, items: form.items.filter(i => i.name.trim()), taxRate: Number(form.taxRate) || 0, notes: form.notes, assignedTo: form.assignedTo, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined, scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined }) }}>
        <h2 className="text-lg font-bold">{initial ? initial.number : 'New sales order'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select className="input" value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className="input" placeholder="Order title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as SalesOrderStatus })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
          <select className="input" value={form.paymentStatus} onChange={e => setForm({ ...form, paymentStatus: e.target.value as PaymentStatus })}>{PAYMENTS.map(s => <option key={s}>{s}</option>)}</select>
          <input className="input" type="datetime-local" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
          <input className="input" type="datetime-local" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} />
        </div>
        {form.items.map((item, idx) => (
          <div key={item.id} className="grid grid-cols-12 gap-2">
            <input className="input col-span-6" placeholder="Item" value={item.name} onChange={e => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it) })} />
            <input className="input col-span-2" type="number" value={item.qty} onChange={e => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, qty: Number(e.target.value) } : it) })} />
            <input className="input col-span-3" type="number" value={item.unitPrice} onChange={e => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, unitPrice: Number(e.target.value) } : it) })} />
            <button type="button" className="col-span-1 text-slate-400" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" className="btn-ghost text-sm" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })}>Add line</button>
        <p className="font-bold">Total {formatCurrency(totals.total)}</p>
        <div className="flex justify-end gap-2">
          {onDelete && <button type="button" onClick={onDelete} className="btn-secondary text-red-600">Delete</button>}
          {onSchedule && <button type="button" onClick={onSchedule} className="btn-secondary"><CalendarPlus className="w-4 h-4" /> Calendar</button>}
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button className="btn-primary">Save order</button>
        </div>
      </form>
    </div>
  )
}
