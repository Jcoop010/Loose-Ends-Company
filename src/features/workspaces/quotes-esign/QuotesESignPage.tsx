import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSignature,
  Plus,
  ReceiptText,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import {
  calculateLineTotals,
  computeDepositCents,
  DEFAULT_AUTONOMY_CONFIG,
  evaluateAutonomyGate,
  formatCents,
  type AutonomousQuote,
  type AutonomousQuoteItem,
  type LineItemInput,
  type QuoteStatus,
  type WorkspaceAutonomyConfig,
} from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as mission10Queries from '../../../lib/autonomousOs/mission10Queries'
import type { PublicLeadOption } from '../../../lib/autonomousOs/queries'
import { formatDateTime } from '../../../lib/format'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import { Badge, EmptyState, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

interface DraftLineFormRow {
  key: string
  description: string
  quantity: string
  unitPriceDollars: string
}

export function QuotesESignPage(): React.ReactElement {
  const { workspace, settings } = useSession()
  const { navigate } = useAppRouter()
  const toast = useToast()

  const workspaceId = workspace?.id ?? null
  const [loading, setLoading] = useState(true)
  const [quotes, setQuotes] = useState<AutonomousQuote[]>([])
  const [itemsByQuote, setItemsByQuote] = useState<ReadonlyMap<string, AutonomousQuoteItem[]>>(
    new Map(),
  )
  const [leads, setLeads] = useState<PublicLeadOption[]>([])
  const [autonomyConfig, setAutonomyConfig] =
    useState<WorkspaceAutonomyConfig>(DEFAULT_AUTONOMY_CONFIG)
  const [statusFilter, setStatusFilter] = useState<'all' | QuoteStatus>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [depositBpsByQuoteId, setDepositBpsByQuoteId] = useState<Record<string, number>>({})

  // Builder form state
  const [showBuilder, setShowBuilder] = useState(false)
  const [title, setTitle] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [taxPercent, setTaxPercent] = useState('0')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [markSent, setMarkSent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [lines, setLines] = useState<DraftLineFormRow[]>([
    { key: 'row_1', description: 'Monthly Operations Retainer & Setup', quantity: '1', unitPriceDollars: '450.00' },
  ])

  const loadData = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const [quotesRes, configRes, leadsRes] = await Promise.all([
        autonomousQueries.fetchQuotesAndItems(workspaceId),
        autonomousQueries.fetchWorkspaceAutonomySettings(workspaceId),
        autonomousQueries.fetchWorkspacePublicLeads(workspaceId),
      ])
      setQuotes(quotesRes.quotes)
      setItemsByQuote(quotesRes.itemsByQuote)
      setAutonomyConfig(configRes)
      setLeads(leadsRes)
    } catch (err) {
      toast.error(
        'Could not load quotes',
        err instanceof Error ? err.message : 'Verify Release 1 migration was applied.',
      )
    } finally {
      setLoading(false)
    }
  }, [workspaceId, toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const parsedTaxBps = useMemo(() => {
    const raw = Number(taxPercent)
    if (!Number.isFinite(raw) || raw < 0) return 0
    return Math.min(5000, Math.round(raw * 100))
  }, [taxPercent])

  const builderPreview = useMemo(() => {
    try {
      const inputs: LineItemInput[] = lines.map(row => ({
        description: row.description || 'Line item',
        quantity: Math.max(1, Math.trunc(Number(row.quantity) || 1)),
        unit_price_cents: Math.max(0, Math.round((Number(row.unitPriceDollars) || 0) * 100)),
      }))
      return calculateLineTotals(inputs, parsedTaxBps)
    } catch {
      return null
    }
  }, [lines, parsedTaxBps])

  const filteredQuotes = useMemo(
    () => (statusFilter === 'all' ? quotes : quotes.filter(q => q.status === statusFilter)),
    [quotes, statusFilter],
  )

  const kpis = useMemo(() => {
    let openSentCents = 0
    let signedCents = 0
    let signedCount = 0
    for (const q of quotes) {
      if (q.status === 'sent') openSentCents += q.total_cents
      if (q.status === 'signed') {
        signedCents += q.total_cents
        signedCount += 1
      }
    }
    return {
      total: quotes.length,
      openSentCents,
      signedCents,
      signedCount,
    }
  }, [quotes])

  const handleLeadSelect = (leadId: string) => {
    setSelectedLeadId(leadId)
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return
    const label = lead.company_name ?? lead.business ?? ''
    if (label && !customerName) {
      setCustomerName(label)
    }
    if (lead.contact_email && !customerEmail) {
      setCustomerEmail(lead.contact_email)
    }
  }

  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || !title.trim() || !customerName.trim()) {
      toast.error('Missing quote details', 'Enter both a quote title and client name.')
      return
    }
    setSubmitting(true)
    try {
      const preparedItems: LineItemInput[] = lines.map(row => ({
        description: row.description.trim(),
        quantity: Math.trunc(Number(row.quantity) || 0),
        unit_price_cents: Math.round((Number(row.unitPriceDollars) || 0) * 100),
      }))
      const { quote } = await autonomousQueries.createQuoteWithItems({
        workspaceId,
        title: title.trim(),
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || undefined,
        leadId: selectedLeadId || null,
        taxBps: parsedTaxBps,
        validUntil: validUntil || null,
        notes: notes.trim() || null,
        items: preparedItems,
        markSent,
      })
      toast.success(
        `Created quote ${quote.quote_number}`,
        `Portal link ready at /portal/${quote.portal_token}`,
      )
      setShowBuilder(false)
      setTitle('')
      setCustomerName('')
      setCustomerEmail('')
      setSelectedLeadId('')
      setNotes('')
      setLines([
        {
          key: `row_${Date.now()}`,
          description: '',
          quantity: '1',
          unitPriceDollars: '0.00',
        },
      ])
      await loadData()
    } catch (err) {
      toast.error('Quote creation failed', err instanceof Error ? err.message : 'Check line items.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyPortalLink = async (token: string) => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/portal/${token}`
        : `/portal/${token}`
    try {
      await navigator.clipboard?.writeText(url)
      toast.success('Copied client portal link', url)
    } catch {
      toast.info('Shareable portal link', url)
    }
  }

  const handleMarkSent = async (quote: AutonomousQuote) => {
    if (!workspaceId || busyId) return
    setBusyId(quote.id)
    try {
      await autonomousQueries.markQuoteSentInDb(workspaceId, quote.id)
      toast.success(`Quote ${quote.quote_number} marked sent`, 'Share the portal link for e-signing.')
      await loadData()
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  const handleConvert = async (quote: AutonomousQuote) => {
    if (!workspaceId || busyId) return
    setBusyId(quote.id)
    try {
      const gateDecision = evaluateAutonomyGate(
        'convert_signed_quote_to_invoice',
        quote.total_cents,
        autonomyConfig,
      )
      if (gateDecision !== 'execute_now') {
        const items = itemsByQuote.get(quote.id) ?? []
        const res = await autonomousQueries.convertSignedQuoteToInvoiceInDb({
          workspaceId,
          quote,
          items,
          config: autonomyConfig,
        })
        toast.info(
          'Queued in Agent Ledger for 1-Tap Approval',
          `Autonomy Dial paused conversion for ${quote.quote_number}. Mode: ${res.ledgerEntry.autonomy_mode}.`,
        )
        await loadData()
        return
      }

      const depositRequiredBps = depositBpsByQuoteId[quote.id] ?? 0
      const res = await mission10Queries.convertQuoteToInvoiceAtomic({
        workspaceId,
        quoteId: quote.id,
        depositRequiredBps,
        dueDays: 30,
      })
      const depositSummary =
        depositRequiredBps > 0
          ? ` (${(depositRequiredBps / 100).toFixed(0)}% deposit = ${formatCents(
              computeDepositCents(quote.total_cents, depositRequiredBps),
            )})`
          : ''
      toast.success(
        res.duplicate
          ? `Invoice ${res.invoice.invoice_number} already linked`
          : `Invoice ${res.invoice.invoice_number} created${depositSummary}`,
        'Atomic quote-to-invoice conversion recorded in Agent Action Ledger.',
      )
      await loadData()
    } catch (err) {
      toast.error('Conversion failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  if (!workspaceId) return <div />

  const conversionMode = autonomyConfig.autonomy_rules.convert_signed_quote_to_invoice

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Quotes &amp; Branded Client E-Sign</h2>
          <p className="text-xs text-slate-600">
            Itemized integer-cent quotes with instant <code>/portal/[token]</code> signatures. Auto-convert mode:{' '}
            <strong>{conversionMode}</strong> (up to {formatCents(autonomyConfig.auto_limit_cents)}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="exec-btn-secondary !px-3 !py-2 !text-xs touch-target"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowBuilder(v => !v)}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {showBuilder ? 'Close Builder' : 'New Itemized Quote'}
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="exec-surface p-4">
          <p className="text-xs font-medium text-slate-500">Total Quotes</p>
          <p className="mt-1 text-2xl font-bold text-slate-950 tabular-nums">{kpis.total}</p>
        </div>
        <div className="exec-surface p-4">
          <p className="text-xs font-medium text-slate-500">Open Sent Pipeline</p>
          <p className="mt-1 text-2xl font-bold text-[#c2410c] tabular-nums">
            {formatCents(kpis.openSentCents)}
          </p>
        </div>
        <div className="exec-surface p-4">
          <p className="text-xs font-medium text-slate-500">Signed ({kpis.signedCount})</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
            {formatCents(kpis.signedCents)}
          </p>
        </div>
      </div>

      {/* Itemized Quote Builder */}
      {showBuilder ? (
        <form onSubmit={handleCreateQuote} className="exec-surface p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="text-base font-bold text-slate-900">Create Itemized Quote</h3>
            {builderPreview ? (
              <Badge tone="brand" className="tabular-nums">
                Total: {formatCents(builderPreview.total_cents)}
              </Badge>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="quote-title" className="exec-label">
                Quote Title
              </label>
              <input
                id="quote-title"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Q4 Lifecycle & Ops Automation Retainer"
                className="exec-input text-sm"
              />
            </div>

            <div>
              <label htmlFor="quote-lead" className="exec-label">
                Link Lead (Optional)
              </label>
              <select
                id="quote-lead"
                value={selectedLeadId}
                onChange={e => handleLeadSelect(e.target.value)}
                className="exec-input text-sm"
              >
                <option value="">None (Direct client)</option>
                {leads.map(lead => (
                  <option key={lead.id} value={lead.id}>
                    {lead.company_name ?? lead.business ?? 'Lead'} ({lead.industry ?? 'SMB'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="quote-tax" className="exec-label">
                Tax %
              </label>
              <input
                id="quote-tax"
                type="number"
                step="0.01"
                min="0"
                max="50"
                value={taxPercent}
                onChange={e => setTaxPercent(e.target.value)}
                className="exec-input text-sm tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="quote-cust-name" className="exec-label">
                Client Name
              </label>
              <input
                id="quote-cust-name"
                required
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Northstar Creative Agency"
                className="exec-input text-sm"
              />
            </div>

            <div>
              <label htmlFor="quote-cust-email" className="exec-label">
                Client Email
              </label>
              <input
                id="quote-cust-email"
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                placeholder="ops@client-domain.com"
                className="exec-input text-sm"
              />
            </div>

            <div>
              <label htmlFor="quote-valid-until" className="exec-label">
                Valid Until
              </label>
              <input
                id="quote-valid-until"
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="exec-input text-sm"
              />
            </div>

            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markSent}
                  onChange={e => setMarkSent(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#ea580c] focus:ring-[#fb923c]"
                />
                Mark sent immediately (enable portal signing)
              </label>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Line Items
              </span>
              <button
                type="button"
                onClick={() =>
                  setLines(prev => [
                    ...prev,
                    {
                      key: `row_${Date.now()}_${prev.length}`,
                      description: '',
                      quantity: '1',
                      unitPriceDollars: '0.00',
                    },
                  ])
                }
                className="exec-btn-secondary !px-2.5 !py-1 !text-xs"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Line
              </button>
            </div>

            {lines.map((row, idx) => (
              <div key={row.key} className="grid grid-cols-1 gap-2 sm:grid-cols-12 items-center">
                <input
                  aria-label={`Line item ${idx + 1} description`}
                  required
                  value={row.description}
                  onChange={e =>
                    setLines(prev =>
                      prev.map(item =>
                        item.key === row.key ? { ...item, description: e.target.value } : item,
                      ),
                    )
                  }
                  placeholder="Scope item or deliverable"
                  className="exec-input text-xs sm:col-span-6"
                />
                <input
                  aria-label={`Line item ${idx + 1} quantity`}
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={row.quantity}
                  onChange={e =>
                    setLines(prev =>
                      prev.map(item =>
                        item.key === row.key ? { ...item, quantity: e.target.value } : item,
                      ),
                    )
                  }
                  className="exec-input text-xs tabular-nums sm:col-span-2"
                />
                <input
                  aria-label={`Line item ${idx + 1} unit price`}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={row.unitPriceDollars}
                  onChange={e =>
                    setLines(prev =>
                      prev.map(item =>
                        item.key === row.key
                          ? { ...item, unitPriceDollars: e.target.value }
                          : item,
                      ),
                    )
                  }
                  className="exec-input text-xs tabular-nums sm:col-span-3"
                />
                <div className="sm:col-span-1 flex justify-end">
                  <button
                    type="button"
                    disabled={lines.length <= 1}
                    aria-label="Remove line item"
                    onClick={() => setLines(prev => prev.filter(item => item.key !== row.key))}
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-rose-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="quote-notes" className="exec-label">
              Client Notes / Terms
            </label>
            <textarea
              id="quote-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Net 14 terms upon electronic signature."
              className="exec-input text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
            {builderPreview ? (
              <div className="text-xs text-slate-600 tabular-nums space-x-4">
                <span>Subtotal: {formatCents(builderPreview.subtotal_cents)}</span>
                <span>Tax: {formatCents(builderPreview.tax_cents)}</span>
                <strong className="text-slate-950">Total: {formatCents(builderPreview.total_cents)}</strong>
              </div>
            ) : (
              <span className="text-xs text-rose-600">Enter valid non-negative integers.</span>
            )}

            <button
              type="submit"
              disabled={submitting || !builderPreview}
              className="exec-btn-primary !px-4 !py-2 !text-xs touch-target"
            >
              {submitting ? 'Saving Quote...' : 'Save Quote & Generate Portal Link'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Filter Bar & Quote List */}
      <div className="exec-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Quote status filter">
            {(['all', 'draft', 'sent', 'signed', 'approved', 'converted', 'declined'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab}
                onClick={() => setStatusFilter(tab)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  statusFilter === tab
                    ? 'bg-[#c2410c] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FileSignature className="h-5 w-5" />}
              title="No quotes in this view"
              description="Create an itemized quote above and share the /portal/[token] link for 1-click e-signature."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {filteredQuotes.map(quote => {
              const items = itemsByQuote.get(quote.id) ?? []
              const gateDecision = evaluateAutonomyGate(
                'convert_signed_quote_to_invoice',
                quote.total_cents,
                autonomyConfig,
              )

              return (
                <li key={quote.id} className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-600">
                          {quote.quote_number}
                        </span>
                        <Badge
                          tone={
                            quote.status === 'signed' || quote.status === 'approved' || quote.status === 'converted'
                              ? 'emerald'
                              : quote.status === 'sent'
                                ? 'brand'
                                : quote.status === 'declined'
                                  ? 'rose'
                                  : 'amber'
                          }
                        >
                          {quote.status}
                        </Badge>
                        {quote.status === 'signed' && quote.signed_by_name ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Signed by {quote.signed_by_name}
                            {quote.signed_at ? ` · ${formatDateTime(quote.signed_at, settings?.timezone)}` : ''}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900">
                        {quote.title}
                      </h3>
                      <p className="text-xs text-slate-600">
                        {quote.customer_name}
                        {quote.customer_email ? ` · ${quote.customer_email}` : ''} · {items.length}{' '}
                        line item{items.length === 1 ? '' : 's'}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-lg font-extrabold text-slate-950 tabular-nums">
                        {formatCents(quote.total_cents)}
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Subtotal {formatCents(quote.subtotal_cents)} · Tax {formatCents(quote.tax_cents)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyPortalLink(quote.portal_token)}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                    >
                      <Copy className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                      Copy /portal Link
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate(`/portal/${quote.portal_token}`)}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Open Client Portal
                    </button>

                    {quote.status === 'draft' ? (
                      <button
                        type="button"
                        disabled={busyId === quote.id}
                        onClick={() => void handleMarkSent(quote)}
                        className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Mark Sent
                      </button>
                    ) : null}

                    {quote.status === 'signed' || quote.status === 'approved' ? (
                      <div className="inline-flex flex-wrap items-center gap-2">
                        <label htmlFor={`quote-dep-${quote.id}`} className="sr-only">
                          Deposit requirement for {quote.quote_number}
                        </label>
                        <select
                          id={`quote-dep-${quote.id}`}
                          value={depositBpsByQuoteId[quote.id] ?? 0}
                          onChange={e =>
                            setDepositBpsByQuoteId(prev => ({
                              ...prev,
                              [quote.id]: Number(e.target.value) || 0,
                            }))
                          }
                          className="exec-input !w-auto !py-1.5 !text-xs"
                        >
                          <option value={0}>0% Deposit (Full Inv)</option>
                          <option value={2500}>25% Deposit</option>
                          <option value={5000}>50% Deposit</option>
                        </select>
                        <button
                          type="button"
                          disabled={busyId === quote.id}
                          onClick={() => void handleConvert(quote)}
                          className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
                          {gateDecision === 'execute_now'
                            ? 'Convert to Invoice'
                            : 'Queue Invoice Conversion'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
