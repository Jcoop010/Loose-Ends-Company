import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing,
  CheckCircle2,
  Lock,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { formatCents } from '../../../lib/format'
import {
  evaluateComplianceDeadlines,
  type ComplianceDocType,
  type ComplianceVaultItem,
} from '../../../lib/autonomousOs'
import * as release3Queries from '../../../lib/autonomousOs/release3Queries'
import { useSession } from '../../../state/SessionContext'
import {
  Badge,
  EmptyState,
  MetricCard,
  MetricCardSkeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const DOC_TYPE_OPTIONS: ReadonlyArray<{ value: ComplianceDocType; label: string }> = [
  { value: 'contract', label: 'Contract' },
  { value: 'coi', label: 'Certificate of Insurance (COI)' },
  { value: 'license', label: 'Business License' },
  { value: 'saas_renewal', label: 'SaaS Subscription' },
  { value: 'lease', label: 'Facility / Equipment Lease' },
]

export function ComplianceVaultPage(): React.ReactElement {
  const { workspace } = useSession()
  const toast = useToast()
  const workspaceId = workspace?.id ?? null

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [items, setItems] = useState<ComplianceVaultItem[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [previewSubject, setPreviewSubject] = useState<string | null>(null)
  const [previewBody, setPreviewBody] = useState<string | null>(null)

  const [docType, setDocType] = useState<ComplianceDocType>('contract')
  const [title, setTitle] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [expiresOn, setExpiresOn] = useState(() =>
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  )
  const [noticeWindowDays, setNoticeWindowDays] = useState('45')
  const [annualValueDollars, setAnnualValueDollars] = useState('4800')
  const [notes, setNotes] = useState('')
  const [savingDoc, setSavingDoc] = useState(false)

  const loadVault = useCallback(
    async (background = false) => {
      if (!workspaceId) return
      if (background) setRefreshing(true)
      else setLoading(true)
      try {
        const docs = await release3Queries.fetchComplianceVaultItems(workspaceId)
        setItems(docs)
      } catch (err) {
        toast.error(
          'Unable to load Compliance Vault',
          err instanceof Error ? err.message : 'Retry.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [workspaceId, toast],
  )

  useEffect(() => {
    void loadVault(false)
  }, [loadVault])

  const evaluation = useMemo(() => evaluateComplianceDeadlines(items), [items])

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || savingDoc) return
    const cleanTitle = title.trim()
    const cleanCp = counterparty.trim()
    const annualCents = Math.max(0, Math.round(Number(annualValueDollars || 0) * 100))
    const noticeDays = Math.max(0, Math.trunc(Number(noticeWindowDays || 45)))

    if (!cleanTitle || !cleanCp || !expiresOn) {
      toast.error('Required fields missing', 'Title, Counterparty, and Expiry date are required.')
      return
    }

    setSavingDoc(true)
    try {
      await release3Queries.createComplianceVaultItemInDb({
        workspaceId,
        doc_type: docType,
        title: cleanTitle,
        counterparty: cleanCp,
        expires_on: expiresOn,
        notice_window_days: noticeDays,
        annual_value_cents: annualCents,
        notes,
      })
      toast.success('Document added to Compliance Vault', cleanTitle)
      setTitle('')
      setCounterparty('')
      setNotes('')
      await loadVault(true)
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingDoc(false)
    }
  }

  const handleStageNotice = async (
    item: ComplianceVaultItem,
    subject: string,
    bodyMarkdown: string,
  ) => {
    if (!workspaceId || busyId) return
    setBusyId(item.id)
    try {
      await release3Queries.stageComplianceNoticeInDb({ workspaceId, item })
      setPreviewSubject(subject)
      setPreviewBody(bodyMarkdown)
      toast.success(
        'Renewal / Cancellation Notice staged',
        `${item.title} logged to Agent Action Ledger with 1-Click Undo.`,
      )
      await loadVault(true)
    } catch (err) {
      toast.error('Notice staging failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyId(null)
    }
  }

  if (!workspaceId) return <div />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Compliance, Contract &amp; COI Vault
          </h2>
          <p className="text-xs text-slate-600">
            Track contract notice windows, Certificates of Insurance, licenses, and SaaS renewals before auto-renewal locks you in.
          </p>
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadVault(true)}
          className="exec-btn-secondary self-start !px-3.5 !py-2 !text-xs touch-target"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {/* Top 3 KPI Bar */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Active Docs"
            value={evaluation.active_docs_count}
            subtitle={`${evaluation.notice_staged_count} notice(s) staged`}
            accent="emerald"
          />
          <MetricCard
            label="Expiring Within Notice Window"
            value={evaluation.expiring_within_window_count}
            subtitle={`${formatCents(evaluation.annual_spend_at_risk_cents)} annual spend entering notice window`}
            accent={evaluation.expiring_within_window_count > 0 ? 'rose' : 'slate'}
          />
          <MetricCard
            label="Annual Spend Protected"
            value={formatCents(evaluation.annual_spend_protected_cents)}
            subtitle="Total annual commitment monitored"
            accent="brand"
          />
        </div>
      )}

      {/* Add Document Form */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">Add Contract, COI, License or Renewal</h3>
        </div>
        <form
          onSubmit={e => void handleAddDoc(e)}
          className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end"
        >
          <div className="sm:col-span-2">
            <label htmlFor="cv-type" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Document Type
            </label>
            <select
              id="cv-type"
              value={docType}
              onChange={e => setDocType(e.target.value as ComplianceDocType)}
              className="exec-input w-full text-xs"
            >
              {DOC_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="cv-title" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Title
            </label>
            <input
              id="cv-title"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Master SaaS Agreement / General Liability COI"
              className="exec-input w-full text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cv-counterparty" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Counterparty
            </label>
            <input
              id="cv-counterparty"
              required
              value={counterparty}
              onChange={e => setCounterparty(e.target.value)}
              placeholder="Vendor or Insurer"
              className="exec-input w-full text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cv-expires" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Expires On
            </label>
            <input
              id="cv-expires"
              type="date"
              required
              value={expiresOn}
              onChange={e => setExpiresOn(e.target.value)}
              className="exec-input w-full text-xs"
            />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="cv-notice" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Notice (d)
            </label>
            <input
              id="cv-notice"
              type="number"
              min="0"
              value={noticeWindowDays}
              onChange={e => setNoticeWindowDays(e.target.value)}
              className="exec-input w-full text-xs tabular-nums"
            />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="cv-value" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Annual $
            </label>
            <input
              id="cv-value"
              type="number"
              step="0.01"
              min="0"
              value={annualValueDollars}
              onChange={e => setAnnualValueDollars(e.target.value)}
              className="exec-input w-full text-xs tabular-nums"
            />
          </div>
          <div className="sm:col-span-1">
            <button
              type="submit"
              disabled={savingDoc}
              className="exec-btn-primary w-full !px-2.5 !py-2 !text-xs touch-target"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {savingDoc ? '…' : 'Add'}
            </button>
          </div>
        </form>
      </section>

      {previewSubject && previewBody ? (
        <section className="rounded-2xl border border-[#fb923c] bg-[#fff7ed] p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold text-[#9a3412]">
              Staged Counterparty Notice Draft (requires_approval: true): {previewSubject}
            </p>
            <button
              type="button"
              onClick={() => {
                setPreviewSubject(null)
                setPreviewBody(null)
              }}
              className="font-semibold text-[#9a3412] underline"
            >
              Dismiss
            </button>
          </div>
          <p className="whitespace-pre-line text-slate-800">{previewBody}</p>
        </section>
      ) : null}

      {/* Countdown Table */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            Deadline &amp; Notice-Window Countdown ({evaluation.total_docs_count})
          </h3>
          <Badge tone="brand">Integer-Cent Risk Tracking</Badge>
        </div>

        {evaluation.evaluated_items.length === 0 ? (
          <EmptyState
            icon={<Lock className="h-5 w-5" aria-hidden="true" />}
            title="Compliance Vault is empty"
            description="Add contracts, vendor COIs, business licenses, leases, or SaaS auto-renewals above so Loose Ends can guard every notice window."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3.5 py-2.5">Document &amp; Counterparty</th>
                  <th className="px-3.5 py-2.5">Expiry &amp; Notice Window</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5 text-right">Annual Value</th>
                  <th className="px-3.5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {evaluation.evaluated_items.map(entry => {
                  const { item, days_remaining, within_notice_window, notice_deadline_on, notice_draft } = entry
                  return (
                    <tr
                      key={item.id}
                      className={entry.action_needed ? 'bg-rose-50/40' : ''}
                    >
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral">{item.doc_type}</Badge>
                          <span className="font-bold text-slate-900">{item.title}</span>
                        </div>
                        <p className="text-slate-600 mt-0.5">{item.counterparty}</p>
                      </td>
                      <td className="px-3.5 py-3 tabular-nums">
                        <p className="font-semibold text-slate-900">
                          {item.expires_on} ({days_remaining < 0 ? `${Math.abs(days_remaining)}d overdue` : `${days_remaining}d left`})
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Notice deadline: {notice_deadline_on} ({item.notice_window_days}d window)
                        </p>
                      </td>
                      <td className="px-3.5 py-3">
                        <Badge
                          tone={
                            item.status === 'notice_staged'
                              ? 'emerald'
                              : entry.action_needed || within_notice_window
                                ? 'rose'
                                : 'neutral'
                          }
                        >
                          {item.status === 'notice_staged'
                            ? 'notice_staged'
                            : entry.is_expired
                              ? 'expired'
                              : within_notice_window
                                ? 'expiring_soon'
                                : item.status}
                        </Badge>
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-slate-950 tabular-nums">
                        {formatCents(item.annual_value_cents)}
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        {item.status === 'notice_staged' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Notice Staged
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() =>
                              void handleStageNotice(
                                item,
                                notice_draft.subject,
                                notice_draft.body_markdown,
                              )
                            }
                            className="exec-btn-primary !px-3 !py-1.5 !text-[11px] touch-target"
                          >
                            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                            {busyId === item.id ? 'Staging…' : 'Stage Renewal / Cancel Notice'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
