import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from '../router'
import { ArrowDownRight, ArrowLeft, ArrowRight, Bell, Check, ChevronDown, CircleDollarSign, Clock3, Filter, Gauge, RotateCcw, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react'

type Status = 'Needs review' | 'Follow-up sent' | 'Booked' | 'Recovered'
type Opportunity = { id: number; customer: string; detail: string; type: string; amount: number; age: string; status: Status; next: string }

const starterData: Opportunity[] = [
  { id: 1, customer: 'Jordan Miller', detail: 'Brake service estimate', type: 'Declined estimate', amount: 860, age: '12 days ago', status: 'Needs review', next: 'Send a helpful check-in' },
  { id: 2, customer: 'Taylor Brooks', detail: 'Oil change + inspection', type: 'Maintenance reminder', amount: 145, age: 'Due this week', status: 'Follow-up sent', next: 'Check for a response' },
  { id: 3, customer: 'Morgan Reed', detail: 'Front suspension repair', type: 'Open estimate', amount: 1240, age: '8 days ago', status: 'Booked', next: 'Confirm appointment' },
  { id: 4, customer: 'Casey Bennett', detail: 'Fleet service invoice', type: 'Outstanding invoice', amount: 575, age: '21 days ago', status: 'Needs review', next: 'Confirm invoice status' },
]

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function PublicDemo() {
  const { navigate } = useRouter()
  const [items, setItems] = useState(starterData)
  const [filter, setFilter] = useState('All opportunities')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(1)
  const [notice, setNotice] = useState('')

  const visible = useMemo(() => items.filter(item => {
    const matchesFilter = filter === 'All opportunities' || (filter === 'Needs attention' ? item.status === 'Needs review' : item.status === filter)
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || [item.customer, item.detail, item.type].some(value => value.toLowerCase().includes(q))
    return matchesFilter && matchesQuery
  }), [items, filter, query])

  const active = items.find(item => item.id === selected) || visible[0]
  const updateStatus = (id: number, status: Status) => {
    setItems(current => current.map(item => item.id === id ? { ...item, status } : item))
    setNotice('Demo updated. This sample change is not saved to a real business account.')
  }
  const startAudit = () => {
    navigate('/')
    window.setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 120)
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="bg-slate-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <button onClick={() => navigate('/')} className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"><ArrowLeft className="w-4 h-4" /> Back to Loose Ends</button>
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200"><span className="w-1.5 h-1.5 rounded-full bg-amber-300" /> Interactive sample · fictional data</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 lg:py-10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700 mb-3"><Wrench className="w-4 h-4" /> LOOSE ENDS CO. <span className="text-slate-300">/</span> REVENUE RECOVERY</div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Your next best action, made obvious.</h1>
            <p className="mt-3 max-w-2xl text-slate-600">A sample workspace for an independent auto repair shop. Spot follow-up gaps, prioritize opportunities, and track outcomes from one place.</p>
          </div>
          <button onClick={startAudit} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700">Request a free audit <ArrowRight className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <Metric icon={<CircleDollarSign className="w-5 h-5" />} label="Potential opportunity value" value={money(items.filter(x => x.status !== 'Recovered').reduce((sum, x) => sum + x.amount, 0))} note="Open sample opportunities" color="indigo" />
          <Metric icon={<Bell className="w-5 h-5" />} label="Needs attention" value={String(items.filter(x => x.status === 'Needs review').length)} note="Prioritize these first" color="amber" />
          <Metric icon={<Clock3 className="w-5 h-5" />} label="Follow-up in motion" value={String(items.filter(x => x.status === 'Follow-up sent' || x.status === 'Booked').length)} note="Contact or appointment underway" color="blue" />
          <Metric icon={<Check className="w-5 h-5" />} label="Confirmed recovered" value={money(items.filter(x => x.status === 'Recovered').reduce((sum, x) => sum + x.amount, 0))} note="Only marked recovered in this demo" color="emerald" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.8fr)] gap-6 items-start">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div><h2 className="text-lg font-bold">Revenue opportunities</h2><p className="text-sm text-slate-500 mt-1">A short, prioritized list of items that may need follow-up.</p></div>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"><ShieldCheck className="w-3.5 h-3.5" /> Sample data only</span>
              </div>
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <label className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customers or opportunities" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
                <label className="relative"><Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" /><select value={filter} onChange={e => setFilter(e.target.value)} className="w-full sm:w-auto appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm outline-none focus:border-indigo-400"><option>All opportunities</option><option>Needs attention</option><option>Follow-up sent</option><option>Booked</option><option>Recovered</option></select><ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" /></label>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {visible.map(item => (
                <button key={item.id} onClick={() => setSelected(item.id)} className={'w-full text-left p-5 hover:bg-slate-50 transition flex items-start gap-3 ' + (active?.id === item.id ? 'bg-indigo-50/60' : '')}>
                  <span className={'mt-1 w-2.5 h-2.5 rounded-full shrink-0 ' + (item.status === 'Needs review' ? 'bg-amber-500' : item.status === 'Recovered' ? 'bg-emerald-500' : 'bg-indigo-500')} />
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"><span className="font-semibold text-sm">{item.detail}</span><span className="font-bold tabular-nums">{money(item.amount)}</span></span>
                    <span className="block text-sm text-slate-500 mt-1">{item.customer} · {item.type} · {item.age}</span>
                    <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{item.status}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                </button>
              ))}
              {visible.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No sample opportunities match that search.</div>}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">Amounts represent fictional potential opportunity values—not guaranteed revenue or verified recovery.</div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Next best action</h2><Sparkles className="w-5 h-5 text-indigo-600" /></div>
              {active ? <>
                <p className="text-sm text-slate-500 mt-1">Selected opportunity</p>
                <h3 className="text-xl font-bold mt-3">{active.customer}</h3>
                <p className="text-sm text-slate-600 mt-1">{active.detail}</p>
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 mt-4"><p className="text-xs uppercase tracking-wide font-bold text-indigo-700">Recommended next step</p><p className="text-sm text-slate-800 mt-2">{active.next}</p></div>
                <p className="text-sm text-slate-500 mt-4">Potential value <span className="font-bold text-slate-900">{money(active.amount)}</span></p>
                <div className="mt-4 grid grid-cols-1 gap-2">
                  <button disabled={active.status === 'Follow-up sent'} onClick={() => updateStatus(active.id, 'Follow-up sent')} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">Mark follow-up sent</button>
                  <button disabled={active.status === 'Booked'} onClick={() => updateStatus(active.id, 'Booked')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40">Mark appointment booked</button>
                  <button disabled={active.status === 'Recovered'} onClick={() => updateStatus(active.id, 'Recovered')} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40">Mark recovered in demo</button>
                </div>
                {notice && <p aria-live="polite" className="text-xs text-slate-500 mt-3">{notice}</p>}
              </> : <p className="text-sm text-slate-500 mt-4">Choose an opportunity to see the recommended next step.</p>}
            </section>

            <section className="rounded-2xl bg-slate-950 text-white p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-2 text-indigo-300"><Gauge className="w-5 h-5" /><span className="text-sm font-semibold">The Loose Ends loop</span></div>
              <div className="mt-4 space-y-3">
                {['Find overlooked opportunities', 'Prioritize by value and urgency', 'Assign the next action', 'Track the real outcome'].map((step, index) => <div key={step} className="flex gap-3 items-center"><span className="flex w-7 h-7 rounded-lg items-center justify-center bg-white/10 text-xs font-bold">{String(index + 1).padStart(2, '0')}</span><span className="text-sm text-slate-200">{step}</span></div>)}
              </div>
              <div className="mt-5 border-t border-white/10 pt-4 text-xs text-slate-400">Built to work alongside the systems your business already uses—not force an expensive rip-and-replace.</div>
            </section>

            <button onClick={() => { setItems(starterData); setFilter('All opportunities'); setQuery(''); setSelected(1); setNotice('Demo reset to the original sample data.') }} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"><RotateCcw className="w-4 h-4" /> Reset sample demo</button>
          </aside>
        </div>

        <div className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div><h2 className="font-bold text-lg">Find out where your business may be losing follow-up opportunities.</h2><p className="text-sm text-slate-600 mt-1">Start with a conversation. No software migration and no obligation.</p></div>
          <button onClick={startAudit} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">Request a free audit <ArrowDownRight className="w-4 h-4" /></button>
        </div>
        <p className="text-center text-xs text-slate-400 mt-6">Public demonstration · fictional customer names and amounts · changes reset when this page is refreshed.</p>
      </div>
    </main>
  )
}

function Metric({ icon, label, value, note, color }: { icon: ReactNode; label: string; value: string; note: string; color: 'indigo' | 'amber' | 'blue' | 'emerald' }) {
  const styles = { indigo: 'bg-indigo-50 text-indigo-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700' }
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-500">{label}</span><span className={'w-10 h-10 rounded-xl flex items-center justify-center ' + styles[color]}>{icon}</span></div><div className="text-2xl font-bold tracking-tight mt-3 tabular-nums">{value}</div><p className="text-xs text-slate-500 mt-1">{note}</p></div>
}
