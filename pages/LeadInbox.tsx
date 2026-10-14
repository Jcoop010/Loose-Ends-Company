import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

type PublicLead = { id: string; name: string; business: string; phone: string; email: string; business_type: string | null; biggest_problem: string | null; created_at: string }

export function LeadInbox() {
  const [leads, setLeads] = useState<PublicLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    setLoading(true)
    setError('')
    const { data, error: failure } = await supabase.from('public_leads').select('id,name,business,phone,email,business_type,biggest_problem,created_at').order('created_at', { ascending: false }).limit(100)
    if (failure) setError(failure.message)
    else setLeads(data ?? [])
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])
  return <main className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Founding Shop Inquiries</h1><p className="text-sm text-slate-500">Private requests from the public revenue checkup form.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="btn-primary">Refresh inquiries</button>
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load inquiries: {error}</p>}
    {loading ? <p>Loading inquiries…</p> : leads.length === 0 && !error ? <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">No inquiries visible to this account yet. Only the company workspace owner can access this inbox.</p> : <div className="space-y-3">{leads.map(lead => <article key={lead.id} className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold text-slate-900">{lead.business}</h2><time className="text-xs text-slate-500">{new Date(lead.created_at).toLocaleString()}</time></div>
      <p className="mt-1 text-sm text-slate-600">{lead.name}{lead.business_type ? ' · ' + lead.business_type : ''}</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm"><a className="text-blue-700 underline" href={`mailto:${lead.email}`}>{lead.email}</a><a className="text-blue-700 underline" href={`tel:${lead.phone}`}>{lead.phone}</a></div>
      {lead.biggest_problem && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{lead.biggest_problem}</p>}
    </article>)}</div>}
  </main>
}
