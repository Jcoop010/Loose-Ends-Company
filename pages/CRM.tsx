import { useMemo, useState } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { formatCurrency, formatDate } from '../utils'
import { PageHeader, CustomerStatusBadge, FollowUpStatusBadge } from '../components/ui'
import { Users, UserPlus, DollarSign, CheckSquare, Search, Plus, ArrowRight, Phone, Mail, Target } from 'lucide-react'

const stages = ['Potential', 'Contacted', 'Responded', 'Scheduled', 'Completed', 'Collected'] as const

export function CRM() {
  const { data, addCustomer, addLead, updateOpportunity, updateFollowUp } = useStore()
  const { navigate } = useRouter()
  const [search, setSearch] = useState('')
  const [showCustomer, setShowCustomer] = useState(false)
  const [showLead, setShowLead] = useState(false)
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '' })
  const [leadForm, setLeadForm] = useState({ name: '', business: '', phone: '', email: '', businessType: '', biggestProblem: '' })

  const q = search.trim().toLowerCase()
  const customers = useMemo(() => data.customers.filter(c => !q || [c.name, c.phone, c.email].some(v => v.toLowerCase().includes(q))), [data.customers, q])
  const opportunities = useMemo(() => data.opportunities.filter(o => !q || o.customerName.toLowerCase().includes(q) || o.type.toLowerCase().includes(q)), [data.opportunities, q])
  const dueFollowUps = data.followUps.filter(f => f.status !== 'Completed' && f.status !== 'Dismissed').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 8)
  const openPipeline = data.opportunities.filter(o => !['Collected', 'Completed'].includes(o.status))
  const pipelineValue = openPipeline.reduce((sum, o) => sum + o.potentialValue, 0)
  const activeCustomers = data.customers.filter(c => c.status === 'Active').length
  const recoverable = data.opportunities.filter(o => o.status !== 'Collected').reduce((sum, o) => sum + Math.max(0, o.potentialValue - (o.collectedAmount || 0)), 0)

  const submitCustomer = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerForm.name.trim() || !customerForm.phone.trim()) return
    addCustomer({ name: customerForm.name.trim(), phone: customerForm.phone.trim(), email: customerForm.email.trim(), status: 'Active', lastService: new Date().toISOString(), lastServiceDescription: 'New customer', lifetimeValue: 0, notes: [] })
    setCustomerForm({ name: '', phone: '', email: '' }); setShowCustomer(false)
  }

  const submitLead = (e: React.FormEvent) => {
    e.preventDefault()
    if (!leadForm.name.trim()) return
    addLead({ ...leadForm, name: leadForm.name.trim(), business: leadForm.business.trim(), phone: leadForm.phone.trim(), email: leadForm.email.trim(), businessType: leadForm.businessType.trim(), biggestProblem: leadForm.biggestProblem.trim() })
    setLeadForm({ name: '', business: '', phone: '', email: '', businessType: '', biggestProblem: '' }); setShowLead(false)
  }

  const advance = (stage: typeof stages[number]) => stage === 'Potential' ? 'Contacted' : stage === 'Contacted' ? 'Responded' : stage === 'Responded' ? 'Scheduled' : stage === 'Scheduled' ? 'Completed' : 'Collected'

  return <div className="space-y-6 animate-fadeIn">
    <PageHeader title="CRM" subtitle="One customer record for contacts, pipeline, follow-ups, and revenue." />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        ['Active Customers', activeCustomers, Users], ['Pipeline Value', formatCurrency(pipelineValue), DollarSign], ['Recoverable Revenue', formatCurrency(recoverable), Target], ['Open Follow-Ups', dueFollowUps.length, CheckSquare],
      ].map(([label, value, Icon]) => <div key={String(label)} className="card p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</p><p className="text-xl font-bold text-slate-900 mt-1">{value as any}</p></div><div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><Icon className="w-5 h-5" /></div></div></div>)}
    </div>
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="relative flex-1"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" placeholder="Search customers, opportunities, or types..." /></div>
      <button onClick={() => setShowCustomer(true)} className="btn-primary"><UserPlus className="w-4 h-4" /> New Customer</button>
      <button onClick={() => setShowLead(true)} className="btn-secondary"><Plus className="w-4 h-4" /> New Lead</button>
    </div>
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4"><div><h2 className="font-bold text-slate-900">Sales & Revenue Pipeline</h2><p className="text-sm text-slate-500">Move opportunities through the same CRM record that powers Revenue Recovery.</p></div><button onClick={() => navigate('/dashboard/revenue-recovery')} className="btn-ghost text-sm">Open Recovery <ArrowRight className="w-4 h-4" /></button></div>
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stages.map(stage => { const items = opportunities.filter(o => o.status === stage); const value = items.reduce((s, o) => s + o.potentialValue, 0); return <div key={stage} className="rounded-xl bg-slate-50 p-3 min-h-36"><div className="flex justify-between items-center mb-2"><span className="text-xs font-bold text-slate-600">{stage}</span><span className="text-[10px] badge-neutral">{items.length}</span></div><p className="text-sm font-bold text-slate-900 mb-3">{formatCurrency(value)}</p><div className="space-y-2">{items.slice(0, 3).map(o => <button key={o.id} onClick={() => updateOpportunity(o.id, { status: advance(stage) as any })} className="w-full text-left bg-white border border-slate-200 rounded-lg p-2 hover:border-brand-300"><p className="text-xs font-semibold text-slate-800 truncate">{o.customerName}</p><p className="text-[11px] text-slate-500 truncate">{o.type}</p><p className="text-xs font-bold text-slate-900 mt-1">{formatCurrency(o.potentialValue)}</p></button>)}</div></div> })}
      </div>
    </section>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="card p-5"><div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-900">Customers</h2><button onClick={() => navigate('/dashboard/customers')} className="text-sm text-brand-600 font-semibold">View all</button></div><div className="space-y-2">{customers.slice(0, 8).map(c => <button key={c.id} onClick={() => navigate('/dashboard/customers')} className="w-full text-left flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100"><div><p className="font-semibold text-sm text-slate-900">{c.name}</p><p className="text-xs text-slate-500">{c.phone} · {c.email || 'No email'}</p></div><div className="text-right"><CustomerStatusBadge status={c.status} /><p className="text-xs font-semibold mt-1">{formatCurrency(c.lifetimeValue)} LTV</p></div></button>)}{customers.length === 0 && <p className="text-sm text-slate-500">No customers match your search.</p>}</div></section>
      <section className="card p-5"><div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-900">Next Actions</h2><button onClick={() => navigate('/dashboard/follow-ups')} className="text-sm text-brand-600 font-semibold">Open center</button></div><div className="space-y-2">{dueFollowUps.map(f => <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50"><div className="min-w-0"><p className="font-semibold text-sm text-slate-900 truncate">{f.customerName}</p><p className="text-xs text-slate-500 truncate">{f.reason} · {formatDate(f.dueDate)}</p></div><div className="flex items-center gap-2"><FollowUpStatusBadge status={f.status} /><button onClick={() => updateFollowUp(f.id, { status: 'Completed' })} className="btn-secondary text-xs">Done</button></div></div>)}{dueFollowUps.length === 0 && <p className="text-sm text-slate-500">No open follow-ups.</p>}</div></section>
    </div>
    <section className="card p-5"><div className="flex items-center justify-between mb-4"><div><h2 className="font-bold text-slate-900">Lead Intake</h2><p className="text-sm text-slate-500">New leads stay in Loose Ends instead of a separate spreadsheet.</p></div><span className="badge-neutral">{data.leads.length} leads</span></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3">{data.leads.slice(0, 6).map(l => <div key={l.id} className="border border-slate-200 rounded-lg p-3"><p className="font-semibold text-sm">{l.name}</p><p className="text-xs text-slate-500">{l.business || l.businessType || 'New lead'}</p><div className="flex gap-3 mt-2 text-xs text-slate-500">{l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{l.phone}</span>}{l.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{l.email}</span>}</div></div>)}</div></section>
    {showCustomer && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><form onSubmit={submitCustomer} className="card p-5 w-full max-w-md space-y-3"><h2 className="text-lg font-bold">New Customer</h2><input className="input" placeholder="Full name *" value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} /><input className="input" placeholder="Phone *" value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} /><input className="input" placeholder="Email" type="email" value={customerForm.email} onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })} /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCustomer(false)} className="btn-secondary">Cancel</button><button className="btn-primary">Create Customer</button></div></form></div>}
    {showLead && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><form onSubmit={submitLead} className="card p-5 w-full max-w-md space-y-3"><h2 className="text-lg font-bold">New Lead</h2><input className="input" placeholder="Contact name *" value={leadForm.name} onChange={e => setLeadForm({ ...leadForm, name: e.target.value })} /><input className="input" placeholder="Business" value={leadForm.business} onChange={e => setLeadForm({ ...leadForm, business: e.target.value })} /><input className="input" placeholder="Phone" value={leadForm.phone} onChange={e => setLeadForm({ ...leadForm, phone: e.target.value })} /><input className="input" placeholder="Email" type="email" value={leadForm.email} onChange={e => setLeadForm({ ...leadForm, email: e.target.value })} /><input className="input" placeholder="Business type" value={leadForm.businessType} onChange={e => setLeadForm({ ...leadForm, businessType: e.target.value })} /><textarea className="input min-h-20" placeholder="Biggest problem / opportunity" value={leadForm.biggestProblem} onChange={e => setLeadForm({ ...leadForm, biggestProblem: e.target.value })} /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowLead(false)} className="btn-secondary">Cancel</button><button className="btn-primary">Create Lead</button></div></form></div>}
  </div>
}
