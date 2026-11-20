import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  MailPlus,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { approveAndEnqueueRecoveryDraft } from '../../../lib/edgeFunctions'
import { customerDisplayName, formatDateTime } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import {
  fetchWorkspacePage,
  recordCustomerConsentEvent,
} from '../../../lib/queries'
import type {
  CommunicationDraftChannel,
  ConsentChannel,
  ConsentDecision,
  ConsentEvent,
  Customer,
  Opportunity,
  OpsCommunicationDraft,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import {
  Badge,
  EmptyState,
  PaginationBar,
  Skeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const PAGE_SIZE = 20

type DraftQueueFilter = 'pending' | 'approved' | 'dismissed'

const DRAFT_STATUS_BY_FILTER: Readonly<Record<DraftQueueFilter, OpsCommunicationDraft['status']>> = {
  pending: 'draft',
  approved: 'approved',
  dismissed: 'rejected',
}

export interface DraftPrefillRequest {
  customerId: string
  opportunityId: string
  subject: string
}

export interface ConsentDraftsPanelProps {
  workspaceId: string
  customers: Customer[]
  customersById: ReadonlyMap<string, Customer>
  opportunities: Opportunity[]
  consentEvents: ConsentEvent[]
  prefill?: DraftPrefillRequest | null
  onClearPrefill?: () => void
  timezone?: string | null
  onConsentOrDraftsChanged: () => Promise<void> | void
}

export function ConsentDraftsPanel({
  workspaceId,
  customers,
  customersById,
  opportunities,
  consentEvents,
  prefill,
  onClearPrefill,
  timezone,
  onConsentOrDraftsChanged,
}: ConsentDraftsPanelProps): React.ReactElement {
  const toast = useToast()

  const [page, setPage] = useState(0)
  const [draftFilter, setDraftFilter] = useState<DraftQueueFilter>('pending')
  const [drafts, setDrafts] = useState<OpsCommunicationDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // New Draft Modal (`opsCommand(..., 'draft_save', ...)`)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeCustomerId, setComposeCustomerId] = useState('')
  const [composeChannel, setComposeChannel] = useState<CommunicationDraftChannel>('email')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeMessage, setComposeMessage] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const composeKeyRef = useRef<string>(createIdempotencyKey())

  // Consent Grant/Revoke Form (`recordCustomerConsentEvent`)
  const [consentCustomerId, setConsentCustomerId] = useState(customers[0]?.id ?? '')
  const [consentChannel, setConsentChannel] = useState<ConsentChannel>('email')
  const [consentDecision, setConsentDecision] = useState<ConsentDecision>('granted')
  const [consentEvidence, setConsentEvidence] = useState('')
  const [savingConsent, setSavingConsent] = useState(false)

  // Preflight Enqueue Modal (`approveAndEnqueueRecoveryDraft`)
  const [preflightDraft, setPreflightDraft] = useState<OpsCommunicationDraft | null>(null)
  const [preflightOpportunityId, setPreflightOpportunityId] = useState('')
  const [enqueueing, setEnqueueing] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const reqSeqRef = useRef(0)

  const loadDraftsPage = useCallback(async () => {
    const seq = ++reqSeqRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await fetchWorkspacePage<OpsCommunicationDraft>({
        table: 'ops_communication_drafts',
        workspaceId,
        page,
        pageSize: PAGE_SIZE,
        orderBy: 'created_at',
        ascending: false,
        filters: {
          status: DRAFT_STATUS_BY_FILTER[draftFilter],
        },
      })
      if (reqSeqRef.current !== seq) return
      setDrafts(rows)
    } catch (err) {
      if (reqSeqRef.current !== seq) return
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load communication drafts.',
      )
    } finally {
      if (reqSeqRef.current === seq) {
        setLoading(false)
      }
    }
  }, [workspaceId, page, draftFilter])

  useEffect(() => {
    void loadDraftsPage()
  }, [loadDraftsPage])

  // Open compose modal automatically when navigated from OpportunityBoard with prefill
  useEffect(() => {
    if (!prefill) return
    composeKeyRef.current = createIdempotencyKey()
    setComposeCustomerId(prefill.customerId)
    setComposeChannel('email')
    setComposeSubject(prefill.subject)
    setComposeMessage(
      'Hi there — following up regarding your open service quote / balance. Please let us know if you have any questions or would like to schedule.',
    )
    setComposeOpen(true)
    onClearPrefill?.()
  }, [prefill, onClearPrefill])

  // Map latest consent per `${customer_id}:${channel}` (consentEvents are ordered newest-first)
  const latestConsentMap = useMemo(() => {
    const map = new Map<string, ConsentEvent>()
    for (const ev of consentEvents) {
      const key = `${ev.customer_id}:${ev.channel}`
      if (!map.has(key)) {
        map.set(key, ev)
      }
    }
    return map
  }, [consentEvents])

  const getLatestConsent = (
    customerId: string,
    channel: ConsentChannel,
  ): ConsentEvent | undefined => latestConsentMap.get(`${customerId}:${channel}`)

  const handleSaveDraft = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!composeCustomerId || !composeMessage.trim()) return
    setSavingDraft(true)
    try {
      await opsCommand(
        workspaceId,
        'draft_save',
        {
          customer_id: composeCustomerId,
          channel: composeChannel,
          subject: composeSubject.trim() || 'Customer Follow-Up',
          message: composeMessage.trim(),
        },
        composeKeyRef.current,
      )
      setComposeOpen(false)
      setComposeSubject('')
      setComposeMessage('')
      toast.success(
        'Communication draft saved',
        'Internal draft stored with delivery_status: not_sent.',
      )
      await loadDraftsPage()
      await onConsentOrDraftsChanged()
    } catch (err) {
      toast.error('Could not save draft', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingDraft(false)
    }
  }

  const handleReviewDraft = async (
    draft: OpsCommunicationDraft,
    decision: 'approved' | 'rejected',
  ) => {
    if (reviewingId) return
    const latest = getLatestConsent(draft.customer_id, draft.channel)
    if (decision === 'approved' && (!latest || latest.decision !== 'granted')) {
      toast.error(
        'Approval blocked by Consent Guard',
        `Record granted ${draft.channel.toUpperCase()} consent for this customer before approving.`,
      )
      return
    }

    setReviewingId(draft.id)
    try {
      await opsCommand(
        workspaceId,
        'draft_review',
        { id: draft.id, status: decision },
        createIdempotencyKey(),
      )
      if (decision === 'rejected') {
        setDrafts(prev => prev.filter(item => item.id !== draft.id))
        toast.success(
          'Draft dismissed & archived',
          'Removed from active queue; audit history preserved.',
        )
      } else {
        toast.success('Draft marked approved', draft.subject)
      }
      await loadDraftsPage()
      await onConsentOrDraftsChanged()
    } catch (err) {
      toast.error('Review failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setReviewingId(null)
    }
  }

  const handleRecordConsent = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!consentCustomerId) {
      toast.error('Select a customer', 'Choose a customer before logging channel consent.')
      return
    }
    setSavingConsent(true)
    try {
      const saved = await recordCustomerConsentEvent({
        workspaceId,
        customerId: consentCustomerId,
        channel: consentChannel,
        decision: consentDecision,
        evidenceReference: consentEvidence,
      })
      setConsentEvidence('')
      toast.success(
        `Consent ${saved.decision} recorded`,
        saved.decision === 'revoked'
          ? 'Database trigger automatically rejected any pending drafts on this channel.'
          : `Ref: ${saved.evidence_reference}`,
      )
      await onConsentOrDraftsChanged()
      await loadDraftsPage()
    } catch (err) {
      toast.error('Consent error', err instanceof Error ? err.message : 'Verify evidence length (8+ chars).')
    } finally {
      setSavingConsent(false)
    }
  }

  const openPreflightModal = (draft: OpsCommunicationDraft) => {
    const customerOpps = opportunities.filter(
      o => o.customer_id === draft.customer_id && o.status !== 'dismissed',
    )
    setPreflightDraft(draft)
    setPreflightOpportunityId(customerOpps[0]?.id ?? opportunities[0]?.id ?? '')
  }

  const handleRunPreflight = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!preflightDraft) return
    const latest = getLatestConsent(preflightDraft.customer_id, preflightDraft.channel)
    if (!latest || latest.decision !== 'granted') {
      toast.error(
        'Preflight blocked',
        'Latest channel consent must be granted before recovery-delivery-preflight.',
      )
      return
    }
    if (!preflightOpportunityId) {
      toast.error('Select an opportunity', 'Link this recovery draft to an active opportunity.')
      return
    }

    setEnqueueing(true)
    try {
      if (preflightDraft.status === 'draft') {
        await opsCommand(
          workspaceId,
          'draft_review',
          { id: preflightDraft.id, status: 'approved' },
          createIdempotencyKey(),
        )
      }

      const res = await approveAndEnqueueRecoveryDraft({
        workspaceId,
        opportunityId: preflightOpportunityId,
        customerId: preflightDraft.customer_id,
        channel: preflightDraft.channel,
        consentEvidenceReference: latest.evidence_reference,
        message: preflightDraft.message,
      })

      setPreflightDraft(null)
      toast.success(
        res.duplicate ? 'Draft already queued in preflight' : 'Enqueued via recovery-delivery-preflight',
        `Audit ID ${res.approvalId.slice(0, 8)} · External send remains gated (${res.deliveryEnabled ? 'provider enabled' : 'not_sent'}).`,
      )
      await loadDraftsPage()
      await onConsentOrDraftsChanged()
    } catch (err) {
      toast.error(
        'Preflight verification failed',
        err instanceof Error ? err.message : 'Could not enqueue draft.',
      )
    } finally {
      setEnqueueing(false)
    }
  }

  const preflightConsent = preflightDraft
    ? getLatestConsent(preflightDraft.customer_id, preflightDraft.channel)
    : undefined

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Paginated Communication Drafts Queue */}
      <section
        aria-label="Consent-gated communication drafts"
        className="exec-surface overflow-hidden lg:col-span-8 flex flex-col justify-between"
      >
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Consent-Gated Communication Drafts
              </h2>
              <p className="text-xs text-slate-600">
                Every draft stays internal (<code>delivery_status = &apos;not_sent&apos;</code>) and
                requires active channel opt-in before approval or preflight enqueue.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Draft status filter"
                className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold"
              >
                {(
                  [
                    { id: 'pending', label: 'Pending' },
                    { id: 'approved', label: 'Approved' },
                    { id: 'dismissed', label: 'Dismissed' },
                  ] as const
                ).map(item => {
                  const selected = draftFilter === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => {
                        setDraftFilter(item.id)
                        setPage(0)
                      }}
                      className={`rounded-lg px-2.5 py-1.5 transition ${
                        selected
                          ? 'bg-[#c2410c] text-white shadow-xs'
                          : 'text-slate-700 hover:bg-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  composeKeyRef.current = createIdempotencyKey()
                  setComposeCustomerId(customers[0]?.id ?? '')
                  setComposeSubject('')
                  setComposeMessage('')
                  setComposeOpen(true)
                }}
                className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
              >
                <MailPlus className="h-3.5 w-3.5" aria-hidden="true" />
                New Draft
              </button>
            </div>
          </div>

          {loadError ? (
            <div
              role="alert"
              className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
            >
              {loadError}
            </div>
          ) : loading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<MailPlus className="h-5 w-5" />}
                title={
                  draftFilter === 'pending'
                    ? 'No pending drafts awaiting review'
                    : draftFilter === 'approved'
                      ? 'No approved drafts'
                      : 'No dismissed drafts'
                }
                description="Prepare an internal customer follow-up draft or let coordination events generate drafts for your review."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {drafts.map(draft => {
                const cust = customersById.get(draft.customer_id)
                const latest = getLatestConsent(draft.customer_id, draft.channel)
                const consentGranted = latest?.decision === 'granted'
                const canDismiss =
                  draft.status === 'draft' ||
                  (draft.status === 'approved' && draft.delivery_status === 'not_sent')
                const blockReason = !latest
                  ? `Blocked: No recorded ${draft.channel.toUpperCase()} opt-in on file`
                  : latest.decision !== 'granted'
                    ? `Blocked: Customer ${draft.channel.toUpperCase()} consent was revoked (${latest.evidence_reference})`
                    : null

                return (
                  <li key={draft.id} className="p-4 sm:p-5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          {cust
                            ? customerDisplayName(cust)
                            : draft.company_name ?? draft.recipient_name ?? 'Customer'}{' '}
                          · {draft.channel.toUpperCase()}
                        </span>
                        <Badge
                          tone={
                            draft.status === 'approved'
                              ? 'emerald'
                              : draft.status === 'rejected'
                                ? 'neutral'
                                : 'amber'
                          }
                        >
                          {draft.status === 'rejected' ? 'dismissed' : draft.status}
                        </Badge>
                        <Badge tone={consentGranted ? 'emerald' : 'rose'}>
                          {consentGranted ? (
                            <>
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                              Consent Granted
                            </>
                          ) : (
                            <>
                              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                              {latest ? 'Consent Revoked' : 'Consent Missing'}
                            </>
                          )}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {formatDateTime(draft.created_at, timezone)}
                      </span>
                    </div>

                    <p className="text-sm font-bold text-slate-900">{draft.subject}</p>
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                      {draft.message}
                    </p>

                    {blockReason ? (
                      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs text-rose-900">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                        <span>{blockReason}</span>
                      </div>
                    ) : latest ? (
                      <p className="text-[11px] text-emerald-800 font-mono">
                        Verified consent ref: {latest.evidence_reference}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={!consentGranted || draft.status === 'rejected'}
                        onClick={() => openPreflightModal(draft)}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve & Preflight Enqueue
                      </button>

                      {draft.status === 'draft' ? (
                        <button
                          type="button"
                          disabled={!consentGranted || reviewingId === draft.id}
                          onClick={() => void handleReviewDraft(draft, 'approved')}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Approve Draft Only
                        </button>
                      ) : null}

                      {canDismiss ? (
                        <button
                          type="button"
                          disabled={reviewingId === draft.id}
                          onClick={() => void handleReviewDraft(draft, 'rejected')}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          Dismiss
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          currentCount={drafts.length}
          hasMore={drafts.length === PAGE_SIZE}
          onPageChange={setPage}
          label="Drafts"
        />
      </section>

      {/* Right: Customer Channel Consent Ledger */}
      <section
        aria-label="Customer channel consent ledger"
        className="exec-surface p-5 sm:p-6 lg:col-span-4 space-y-4 h-fit"
      >
        <div>
          <h3 className="text-base font-bold text-slate-900">Channel Consent Ledger</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Log documented opt-ins or revocations in <code>customer_contact_consent_events</code>.
            Revoking consent automatically rejects open drafts on that channel.
          </p>
        </div>

        <form onSubmit={handleRecordConsent} className="space-y-3">
          <div>
            <label htmlFor="consent-cust" className="exec-label">
              Customer
            </label>
            <select
              id="consent-cust"
              required
              value={consentCustomerId}
              onChange={e => setConsentCustomerId(e.target.value)}
              className="exec-input !text-xs"
            >
              <option value="">Select customer…</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {customerDisplayName(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="consent-chan" className="exec-label">
                Channel
              </label>
              <select
                id="consent-chan"
                value={consentChannel}
                onChange={e => setConsentChannel(e.target.value as ConsentChannel)}
                className="exec-input !text-xs"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="call">Phone Call</option>
              </select>
            </div>
            <div>
              <label htmlFor="consent-dec" className="exec-label">
                Decision
              </label>
              <select
                id="consent-dec"
                value={consentDecision}
                onChange={e => setConsentDecision(e.target.value as ConsentDecision)}
                className="exec-input !text-xs"
              >
                <option value="granted">Granted</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="consent-ref" className="exec-label">
              Evidence Reference (8+ characters)
            </label>
            <input
              id="consent-ref"
              type="text"
              required
              minLength={8}
              placeholder="e.g., WORKORDER-2026-OPTIN-884"
              value={consentEvidence}
              onChange={e => setConsentEvidence(e.target.value)}
              className="exec-input !text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={savingConsent}
            className="exec-btn-primary w-full !text-xs touch-target"
          >
            {savingConsent ? 'Logging Consent…' : 'Record Consent Event'}
          </button>
        </form>

        <div className="border-t border-slate-200 pt-3 space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent Consent Events
          </span>
          {consentEvents.length === 0 ? (
            <p className="text-xs text-slate-500">No consent events logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {consentEvents.slice(0, 6).map(ev => {
                const cust = customersById.get(ev.customer_id)
                return (
                  <li key={ev.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {cust ? customerDisplayName(cust) : 'Customer'} ({ev.channel.toUpperCase()})
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-500">
                        {ev.evidence_reference}
                      </p>
                    </div>
                    <Badge tone={ev.decision === 'granted' ? 'emerald' : 'rose'}>
                      {ev.decision}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Compose Draft Modal */}
      <Dialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="Prepare Internal Communication Draft"
        description="Saved via ops_command('draft_save') with delivery_status = 'not_sent'."
      >
        <form onSubmit={handleSaveDraft} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="draft-cust" className="exec-label">
                Customer
              </label>
              <select
                id="draft-cust"
                required
                value={composeCustomerId}
                onChange={e => setComposeCustomerId(e.target.value)}
                className="exec-input"
              >
                <option value="">Select customer…</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {customerDisplayName(c)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="draft-chan" className="exec-label">
                Channel
              </label>
              <select
                id="draft-chan"
                value={composeChannel}
                onChange={e => setComposeChannel(e.target.value as CommunicationDraftChannel)}
                className="exec-input"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="draft-subj" className="exec-label">
              Subject / Headline
            </label>
            <input
              id="draft-subj"
              type="text"
              required
              placeholder="Quote QTE-2041 Follow-Up"
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
              className="exec-input"
            />
          </div>

          <div>
            <label htmlFor="draft-msg" className="exec-label">
              Message Body
            </label>
            <textarea
              id="draft-msg"
              rows={4}
              required
              value={composeMessage}
              onChange={e => setComposeMessage(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setComposeOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDraft}
              className="exec-btn-primary touch-target"
            >
              {savingDraft ? 'Saving Draft…' : 'Save Internal Draft'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Preflight Enqueue Confirmation Modal */}
      <Dialog
        open={preflightDraft !== null}
        onClose={() => setPreflightDraft(null)}
        title="Verify Consent & Enqueue Recovery Preflight"
        description="Re-verifies customer_contact_consent_events on the server, logs audit_events, and invokes recovery-delivery-preflight."
      >
        {preflightDraft ? (
          <form onSubmit={handleRunPreflight} className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
              <p className="font-bold text-slate-900">{preflightDraft.subject}</p>
              <p className="text-slate-600">
                Channel: <strong>{preflightDraft.channel.toUpperCase()}</strong> · Evidence:{' '}
                <code>{preflightConsent?.evidence_reference ?? 'MISSING'}</code>
              </p>
            </div>

            <div>
              <label htmlFor="preflight-opp" className="exec-label">
                Linked Opportunity
              </label>
              <select
                id="preflight-opp"
                required
                value={preflightOpportunityId}
                onChange={e => setPreflightOpportunityId(e.target.value)}
                className="exec-input"
              >
                <option value="">Select opportunity…</option>
                {opportunities.map(opp => (
                  <option key={opp.id} value={opp.id}>
                    {opp.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPreflightDraft(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={enqueueing || preflightConsent?.decision !== 'granted'}
                className="exec-btn-emerald touch-target"
              >
                {enqueueing ? 'Verifying & Enqueueing…' : 'Confirm Preflight Enqueue'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  )
}
