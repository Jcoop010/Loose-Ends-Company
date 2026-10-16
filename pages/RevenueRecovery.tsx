import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { PIPELINE_STAGES } from '../data'
import type { Opportunity, OpportunityType } from '../types'
import { formatCurrency, formatDate, timeAgo } from '../utils'
import { PageHeader, MiniStat, OpportunityStatusBadge, OpportunityTypeBadge } from '../components/ui'
import { DollarSign, ChevronRight, CalendarClock, Filter, X, Check, BellOff, ScanSearch } from 'lucide-react'

const OPPORTUNITY_FILTERS: Array<'All' | OpportunityType> = [
  'All', 'Missed Call', 'Old Estimate', 'Declined Work', 'Inactive Customer', 'Maintenance Due',
  'Unpaid Invoice', 'Unbilled Work', 'Stalled Lead', 'Expansion Opportunity', 'Renewal Risk', 'Churn Risk', 'Payment Failure', 'Other',
]

export function RevenueRecovery() {
  const { data, updateOpportunity, collectOpportunity, runRevenueScan } = useStore()
  const [typeFilter, setTypeFilter] = useState<string>('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [collectModal, setCollectModal] = useState<Opportunity | null>(null)
  const [collectAmount, setCollectAmount] = useState('')
  const [collecting, setCollecting] = useState(false)
  const [collectError, setCollectError] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('opportunity'))

  useEffect(() => {
    if (!highlightId) return
    const target = document.getElementById(`recovery-opportunity-${highlightId}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, data.opportunities])

  const filtered = useMemo(
    () => data.opportunities
      .filter(o => o.id === highlightId || (!(typeFilter !== 'All' && o.type !== typeFilter) && !(statusFilter !== 'All' && o.status !== statusFilter)))
      .filter(o => o.id === highlightId || !searchQuery.trim() || [o.customerName, o.type, o.status, o.notes || ''].some(value => value.toLowerCase().includes(searchQuery.trim().toLowerCase())))
      .sort((a, b) => {
        if (a.status === 'Collected' && b.status !== 'Collected') return 1
        if (b.status === 'Collected' && a.status !== 'Collected') return -1
        const aScore = a.potentialValue * (a.confidence ?? 0.5)
        const bScore = b.potentialValue * (b.confidence ?? 0.5)
        return bScore - aScore
      }),
    [data.opportunities, typeFilter, statusFilter, searchQuery, highlightId],
  )

  const pipelineValues = useMemo(() => {
    const vals: Record<string, number> = {}
    PIPELINE_STAGES.forEach(s => { vals[s] = 0 })
    data.opportunities.forEach(o => {
      if (o.status === 'Collected') vals.Collected += o.collectedAmount || 0
      else vals[o.status] += o.potentialValue
    })
    return vals
  }, [data.opportunities])

  const totalValue = data.opportunities.reduce((sum, o) => sum + (o.status === 'Collected' ? o.collectedAmount || 0 : o.potentialValue), 0)
  const collectedTotal = data.opportunities.filter(o => o.status === 'Collected').reduce((sum, o) => sum + (o.collectedAmount || 0), 0)

  const advanceStage = (opp: Opportunity) => {
    const idx = PIPELINE_STAGES.indexOf(opp.status)
    if (idx < PIPELINE_STAGES.length - 1) {
      const next = PIPELINE_STAGES[idx + 1]
      if (next === 'Collected') {
        setCollectModal(opp)
        setCollectAmount(String(opp.potentialValue))
      } else {
        updateOpportunity(opp.id, { status: next })
      }
    }
  }

  const confirmCollect = async () => {
    if (!collectModal || collecting) return
    const amount = Number(collectAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    setCollecting(true)
    setCollectError('')
    try {
      await collectOpportunity(collectModal.id, amount)
      setCollectModal(null)
      setCollectAmount('')
    } catch (error) {
      setCollectError(error instanceof Error ? error.message : 'Collection could not be saved')
    } finally {
      setCollecting(false)
    }
  }

    const snooze = (opp: Opportunity) => updateOpportunity(opp.id, { nextAction: 'Snoozed — review later' })

  const runScan = () => {
    const result = runRevenueScan()
    setScanMessage(result.created ? `Found ${result.created} new revenue signal${result.created === 1 ? '' : 's'} worth ${formatCurrency(result.potential)}.` : 'No new revenue signals found.')
    window.setTimeout(() => setScanMessage(''), 5000)
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Revenue Recovery" subtitle="Find the money your business is already leaving behind." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">Every opportunity is evidence-backed when a source signal is available. Opportunities are ranked by evidence-weighted recovery value.</div>
        <button onClick={runScan} className="btn-secondary"><ScanSearch className="w-4 h-4" /> Scan for revenue leaks</button>
      </div>
      {scanMessage && <div className="card px-4 py-3 text-sm text-slate-700 border-brand-200 bg-brand-50">{scanMessage}</div>}

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage} className="flex items-center flex-shrink-0">
              <div className="text-center">
                <div className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${pipelineValues[stage] > 0 ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'}`}>{stage}</div>
                <p className="mt-1 text-sm font-bold text-slate-900">{formatCurrency(pipelineValues[stage])}</p>
              </div>
              {i < PIPELINE_STAGES.length - 1 && <ChevronRight className="w-4 h-4 text-slate-300 mx-1" />}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-slate-100">
          <MiniStat label="Potential Opportunity" value={formatCurrency(totalValue - collectedTotal)} />
          <MiniStat label="Contacted" value={formatCurrency(pipelineValues.Contacted)} />
          <MiniStat label="Responded" value={formatCurrency(pipelineValues.Responded)} />
          <MiniStat label="Scheduled" value={formatCurrency(pipelineValues.Scheduled)} />
          <MiniStat label="Completed" value={formatCurrency(pipelineValues.Completed)} />
          <MiniStat label="Collected" value={formatCurrency(pipelineValues.Collected)} highlight />
        </div>
        <div className="mt-4 p-3 bg-warning-50 border border-warning-200 rounded-lg">
          <p className="text-xs text-warning-800 leading-relaxed"><strong>Disclaimer:</strong> Potential opportunity is an estimate, not guaranteed revenue. Recovered revenue represents confirmed revenue reported by the business.</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-slate-400" /><span className="text-sm font-semibold text-slate-700">Filters</span></div>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Search opportunities" type="search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search customers or opportunities" className="input w-full sm:w-72" />
          <select aria-label="Filter opportunity type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input w-full sm:w-auto">{OPPORTUNITY_FILTERS.map(t => <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>)}</select>
          <select aria-label="Filter pipeline status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto"><option value="All">All Statuses</option>{PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <span className="text-sm text-slate-500 self-center ml-1">{filtered.length} opportunit{filtered.length === 1 ? 'y' : 'ies'} · highest evidence-weighted value first</span>
        </div>
      </div>

      {highlightId && <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span>Showing the opportunity selected from your dashboard.</span><button className="font-semibold underline" onClick={() => { setHighlightId(null); window.history.replaceState({}, "", window.location.pathname) }}>Show full queue</button></div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(opp => (
          <div id={`recovery-opportunity-${opp.id}`} key={opp.id} className={`card p-4 hover:shadow-md transition-shadow ${highlightId === opp.id ? "ring-2 ring-emerald-500 border-emerald-400" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold text-slate-900">{opp.customerName}</h3><OpportunityTypeBadge type={opp.type} /></div>
                <p className="text-xs text-slate-500 mt-1">Identified {formatDate(opp.dateIdentified)}{opp.lastContact && ` · Last contact ${timeAgo(opp.lastContact)}`}</p>
              </div>
              <div className="text-left sm:text-right flex-shrink-0">
                {opp.status === 'Collected' && opp.collectedAmount ? <><p className="text-lg font-bold text-success-600">{formatCurrency(opp.collectedAmount)}</p><p className="text-[10px] text-slate-400 line-through">{formatCurrency(opp.potentialValue)} est.</p></> : <p className="text-lg font-bold text-brand-600">{formatCurrency(opp.potentialValue)}</p>}
                <OpportunityStatusBadge status={opp.status} />
              </div>
            </div>
            {opp.notes && <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-2.5 mb-3">{opp.notes}</p>}
            {opp.confidence != null && <p className="text-[11px] text-slate-400 mb-2">Evidence confidence: {Math.round(opp.confidence * 100)}% · Recovery value: {formatCurrency(opp.potentialValue * opp.confidence)}</p>}
            <div className="flex items-center gap-2 text-sm text-slate-700 mb-3"><CalendarClock className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>{opp.nextAction}</span></div>
            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
              <button onClick={() => updateOpportunity(opp.id, { status: 'Contacted', lastContact: new Date().toISOString(), nextAction: 'Wait for response or schedule the next step' })} className="btn-ghost text-xs px-2.5 py-1.5" disabled={opp.status !== 'Potential'}><Check className="w-3.5 h-3.5" /> Mark contacted</button>
              <button onClick={() => updateOpportunity(opp.id, { status: 'Scheduled', nextAction: 'Complete the scheduled recovery step' })} className="btn-ghost text-xs px-2.5 py-1.5" disabled={opp.status === 'Collected' || opp.status === 'Completed'}><CalendarClock className="w-3.5 h-3.5" /> Schedule</button>
              {opp.status !== 'Collected' && <button onClick={() => advanceStage(opp)} className="btn-secondary text-xs px-2.5 py-1.5"><ChevronRight className="w-3.5 h-3.5" />{opp.status === 'Completed' ? 'Mark Collected' : 'Advance'}</button>}
              <button onClick={() => snooze(opp)} disabled={opp.status === 'Collected'} className="btn-ghost text-xs px-2.5 py-1.5 ml-auto"><BellOff className="w-3.5 h-3.5" /> Snooze</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="col-span-full card p-8 text-center text-slate-500">No opportunities match your search or filters. Try clearing them to see the full recovery queue.</div>}
      </div>

      {collectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fadeIn" onClick={() => { if (!collecting) { setCollectModal(null); setCollectAmount('') } }}>
          <div role="dialog" aria-modal="true" aria-labelledby="collect-revenue-title" className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 id="collect-revenue-title" className="text-lg font-bold text-slate-900">Confirm Collected Revenue</h3><button aria-label="Close revenue confirmation" disabled={collecting} onClick={() => { setCollectModal(null); setCollectAmount('') }} className="p-1 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button></div>
            <p className="text-sm text-slate-600 mb-1"><span className="font-semibold">{collectModal.customerName}</span> — {collectModal.type}</p>
            <p className="text-xs text-slate-500 mb-4">Estimated potential: {formatCurrency(collectModal.potentialValue)}</p>
            <div className="mb-4"><label htmlFor="collected-revenue-amount" className="label">Confirmed Revenue Amount</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span><input id="collected-revenue-amount" type="number" min="0.01" step="0.01" value={collectAmount} onChange={e => setCollectAmount(e.target.value)} className="input pl-7" placeholder="0" autoFocus onKeyDown={e => e.key === 'Enter' && confirmCollect()} /><p className="text-xs text-slate-500 mt-1.5">Enter the actual amount collected. Only this confirmed amount counts toward Recovered Revenue.</p></div></div>
            {collectError && <p role="alert" className="text-sm text-red-600 mb-2">{collectError}</p>}<div className="flex gap-2"><button disabled={collecting} onClick={() => { setCollectModal(null); setCollectAmount('') }} className="btn-secondary flex-1">Cancel</button><button onClick={confirmCollect} className="btn-success flex-1" disabled={collecting || !collectAmount || parseFloat(collectAmount) <= 0}><DollarSign className="w-4 h-4" /> Confirm Collected</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
