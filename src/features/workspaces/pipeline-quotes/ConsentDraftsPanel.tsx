import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CheckSquare,
  Inbox,
  Layers,
  MailPlus,
  PauseCircle,
  PlayCircle,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  CAN_SPAM_B2B_EVIDENCE_REF,
  evaluateDraftCompliance,
  isConsentEventSuppressed,
} from '../../../lib/canSpamGuard'
import { approveAndEnqueueRecoveryDraft } from '../../../lib/edgeFunctions'
import { customerDisplayName, formatDateTime } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import {
  approveDraftsBatch,
  createSenderInbox,
  fetchSenderInboxes,
  fetchWorkspaceEmailDraftsForSequencer,
  fetchWorkspaceLeadPausedIds,
  pauseLeadSequenceInDb,
  persistStagedFollowUps,
  updateSenderInboxStatus,
} from '../../../lib/outbound/outboundQueries'
import {
  AUTO_PAUSE_REASON_LABELS,
  OUTREACH_LANE_LABELS,
  SEQUENCE_STEP_LABELS,
  effectiveDailyCap,
  normalizeInboxForDate,
  selectBatchApprovableDrafts,
  stageFollowUpDrafts,
} from '../../../lib/outbound/sequencerEngine'
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
  OutboundSenderInbox,
  OutreachLane,
  SequenceStep,
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
type LaneFilter = 'all' | OutreachLane
type StepFilter = 'all' | SequenceStep

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
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all')
  const [stepFilter, setStepFilter] = useState<StepFilter>('all')
  const [drafts, setDrafts] = useState<OpsCommunicationDraft[]>([])
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Sender Pool State (`outbound_sender_inboxes`)
  const [senderInboxes, setSenderInboxes] = useState<OutboundSenderInbox[]>([])
  const [loadingInboxes, setLoadingInboxes] = useState(true)
  const [togglingInboxId, setTogglingInboxId] = useState<string | null>(null)
  const [addInboxOpen, setAddInboxOpen] = useState(false)
  const [newInboxFromName, setNewInboxFromName] = useState('Justin Cooper')
  const [newInboxFromEmail, setNewInboxFromEmail] = useState('')
  const [newInboxDailyCap, setNewInboxDailyCap] = useState('20')
  const [savingInbox, setSavingInbox] = useState(false)

  // Batch & Follow-Up Sequencer Actions
  const [batchApproving, setBatchApproving] = useState(false)
  const [stagingFollowUps, setStagingFollowUps] = useState(false)
  const [pausingLeadKey, setPausingLeadKey] = useState<string | null>(null)

  // New Draft Modal (`opsCommand(..., 'draft_save', ...)`)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeCustomerId, setComposeCustomerId] = useState('')
  const [composeChannel, setComposeChannel] = useState<CommunicationDraftChannel>('email')
  const [composeLane, setComposeLane] = useState<OutreachLane>('trades_clinics')
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

  const loadSenderInboxes = useCallback(async () => {
    setLoadingInboxes(true)
    try {
      const rows = await fetchSenderInboxes(workspaceId)
      const todayIso = new Date().toISOString().slice(0, 10)
      setSenderInboxes(rows.map(item => normalizeInboxForDate(item, todayIso)))
    } catch {
      setSenderInboxes([])
    } finally {
      setLoadingInboxes(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadSenderInboxes()
  }, [loadSenderInboxes])

  const loadDraftsPage = useCallback(async () => {
    const seq = ++reqSeqRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const pageFilters: Record<string, string | number | boolean> = {
        status: DRAFT_STATUS_BY_FILTER[draftFilter],
      }
      if (laneFilter !== 'all') {
        pageFilters.outreach_lane = laneFilter
      }
      if (stepFilter !== 'all') {
        pageFilters.sequence_step = stepFilter
      }
      const rows = await fetchWorkspacePage<OpsCommunicationDraft>({
        table: 'ops_communication_drafts',
        workspaceId,
        page,
        pageSize: PAGE_SIZE,
        orderBy: 'created_at',
        ascending: false,
        filters: pageFilters,
      })
      if (reqSeqRef.current !== seq) return
      setDrafts(rows)
      setSelectedDraftIds([])
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
  }, [workspaceId, page, draftFilter, laneFilter, stepFilter])

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
      if (!ev.customer_id) continue
      const key = `${ev.customer_id}:${ev.channel}`
      if (!map.has(key)) {
        map.set(key, ev)
      }
    }
    return map
  }, [consentEvents])

  const suppressedEmailsSet = useMemo(() => {
    const set = new Set<string>()
    for (const ev of consentEvents) {
      if (!isConsentEventSuppressed(ev)) continue
      if (ev.email?.trim()) {
        set.add(ev.email.trim().toLowerCase())
      }
      if (ev.customer_id) {
        const custEmail = customersById.get(ev.customer_id)?.email?.trim().toLowerCase()
        if (custEmail) set.add(custEmail)
      }
    }
    for (const [key, ev] of latestConsentMap.entries()) {
      if (!key.endsWith(':email') || !isConsentEventSuppressed(ev) || !ev.customer_id) continue
      const custEmail = customersById.get(ev.customer_id)?.email?.trim().toLowerCase()
      if (custEmail) set.add(custEmail)
    }
    return set
  }, [consentEvents, customersById, latestConsentMap])

  const getLatestConsent = (
    customerId: string | null | undefined,
    channel: ConsentChannel,
  ): ConsentEvent | undefined =>
    customerId ? latestConsentMap.get(`${customerId}:${channel}`) : undefined

  const isDraftEmailSuppressed = (draft: OpsCommunicationDraft): boolean => {
    if (draft.channel !== 'email') return false
    const custEmail = draft.customer_id
      ? customersById.get(draft.customer_id)?.email
      : undefined
    const resolved = (draft.recipient_email ?? custEmail ?? '').trim().toLowerCase()
    return Boolean(resolved && suppressedEmailsSet.has(resolved))
  }

  const resolveDraftEmail = useCallback(
    (draft: OpsCommunicationDraft): string => {
      const custEmail = draft.customer_id
        ? customersById.get(draft.customer_id)?.email
        : undefined
      return (draft.recipient_email ?? custEmail ?? '').trim().toLowerCase()
    },
    [customersById],
  )

  const getDraftCompliance = useCallback(
    (draft: OpsCommunicationDraft) =>
      evaluateDraftCompliance({
        channel: draft.channel,
        message: draft.message,
        latestConsent: getLatestConsent(draft.customer_id, draft.channel),
        emailSuppressed: isDraftEmailSuppressed(draft),
      }),
    [latestConsentMap, suppressedEmailsSet, customersById],
  )

  const batchApprovable = useMemo(
    () => selectBatchApprovableDrafts(drafts, getDraftCompliance, resolveDraftEmail),
    [drafts, getDraftCompliance, resolveDraftEmail],
  )

  const approvableIdSet = useMemo(
    () => new Set(batchApprovable.eligible.map(d => d.id)),
    [batchApprovable.eligible],
  )

  const senderPoolSummary = useMemo(() => {
    let activeCap = 0
    let activeSent = 0
    let activeCount = 0
    for (const inbox of senderInboxes) {
      if (inbox.status !== 'active') continue
      activeCount += 1
      activeCap += effectiveDailyCap(inbox)
      activeSent += Math.max(0, inbox.sent_today)
    }
    return { activeCap, activeSent, activeCount }
  }, [senderInboxes])

  const handleToggleInboxStatus = async (inbox: OutboundSenderInbox) => {
    if (togglingInboxId) return
    const nextStatus = inbox.status === 'active' ? 'paused' : 'active'
    setTogglingInboxId(inbox.id)
    try {
      const updated = await updateSenderInboxStatus(workspaceId, inbox.id, nextStatus)
      setSenderInboxes(prev => prev.map(row => (row.id === updated.id ? updated : row)))
      toast.info(
        nextStatus === 'paused' ? 'Sender Inbox Paused' : 'Sender Inbox Resumed',
        `${updated.from_email} (${updated.status})`,
      )
    } catch (err) {
      toast.error('Inbox update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setTogglingInboxId(null)
    }
  }

  const handleAddSenderInbox = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newInboxFromEmail.trim() || savingInbox) return
    setSavingInbox(true)
    try {
      const parsedCap = Number(newInboxDailyCap)
      const created = await createSenderInbox({
        workspaceId,
        fromName: newInboxFromName,
        fromEmail: newInboxFromEmail,
        dailyCap: Number.isFinite(parsedCap) ? parsedCap : undefined,
        status: 'active',
      })
      setSenderInboxes(prev => [...prev, created])
      setNewInboxFromEmail('')
      setAddInboxOpen(false)
      toast.success(
        'Sender inbox added to rotation pool',
        `${created.from_email} · Daily cap ${effectiveDailyCap(created)}`,
      )
    } catch (err) {
      toast.error('Could not add sender inbox', err instanceof Error ? err.message : 'Check email.')
    } finally {
      setSavingInbox(false)
    }
  }

  const handleSelectAndApproveCompliantBatch = async () => {
    if (batchApproving || draftFilter !== 'pending') return
    const eligibleIds = batchApprovable.eligible.map(d => d.id)
    const targetIds =
      selectedDraftIds.length > 0
        ? selectedDraftIds.filter(id => approvableIdSet.has(id))
        : eligibleIds
    if (targetIds.length === 0) {
      toast.info(
        'No compliant drafts eligible',
        'Verify recipients have valid emails and CAN-SPAM footers or active channel opt-in.',
      )
      return
    }
    setSelectedDraftIds(targetIds)
    setBatchApproving(true)
    try {
      const res = await approveDraftsBatch(workspaceId, targetIds)
      toast.success(
        `Batch approved ${res.approvedCount} compliant draft(s)`,
        res.skippedCount > 0
          ? `${res.skippedCount} skipped by compliance guard. Delivery stays gated until dispatch.`
          : 'All selected drafts passed CAN-SPAM/consent checks (delivery_status: not_sent).',
      )
      setSelectedDraftIds([])
      await loadDraftsPage()
      await onConsentOrDraftsChanged()
    } catch (err) {
      toast.error('Batch approval failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBatchApproving(false)
    }
  }

  const handleStageFollowUps = async () => {
    if (stagingFollowUps) return
    setStagingFollowUps(true)
    try {
      const [allEmailDrafts, pausedLeadIds] = await Promise.all([
        fetchWorkspaceEmailDraftsForSequencer(workspaceId),
        fetchWorkspaceLeadPausedIds(workspaceId),
      ])
      const result = stageFollowUpDrafts({
        workspaceId,
        drafts: allEmailDrafts,
        suppressedEmails: suppressedEmailsSet,
        pausedLeadIds,
      })
      if (result.candidates.length === 0) {
        toast.info(
          'No Day 3 / Day 7 bumps due yet',
          'Step 2 stages 3 days after Step 1 delivery; Step 3 stages 4 days after Step 2 delivery.',
        )
        return
      }
      const saved = await persistStagedFollowUps(workspaceId, result.candidates)
      toast.success(
        `Staged ${saved.stagedCount} Day 3 / Day 7 follow-up draft(s)`,
        'Pending owner approval in queue (requires_approval = true).',
      )
      setDraftFilter('pending')
      setPage(0)
      await loadDraftsPage()
      await onConsentOrDraftsChanged()
    } catch (err) {
      toast.error('Follow-up staging failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setStagingFollowUps(false)
    }
  }

  const handlePauseDraftSequence = async (draft: OpsCommunicationDraft) => {
    if (pausingLeadKey) return
    setPausingLeadKey(draft.id)
    try {
      const res = await pauseLeadSequenceInDb(workspaceId, {
        leadId: draft.lead_id ?? null,
        recipientEmail: resolveDraftEmail(draft) || null,
        reason: 'replied',
      })
      toast.info(
        'Sequence auto-paused (Replied)',
        `Cancelled ${res.pausedCount} unsent draft(s); future Step 2/3 follow-ups blocked.`,
      )
      await loadDraftsPage()
      await onConsentOrDraftsChanged()
    } catch (err) {
      toast.error('Pause sequence failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setPausingLeadKey(null)
    }
  }

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
          outreach_lane: composeLane,
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
    const compliance = getDraftCompliance(draft)
    if (decision === 'approved' && !compliance.allowed) {
      toast.error(
        'Approval blocked by Compliance Guard',
        compliance.blockReason ??
          `Verify consent or CAN-SPAM footer requirements before approving.`,
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

  const openPreflightModal = async (draft: OpsCommunicationDraft) => {
    const compliance = getDraftCompliance(draft)
    if (!compliance.allowed) {
      toast.error(
        'Preflight blocked',
        compliance.blockReason ?? 'Draft does not meet channel compliance requirements.',
      )
      return
    }

    // Lead-backed B2B email drafts (customer_id = null) do not link to a CRM customer/opportunity row,
    // so Approve & Preflight verifies CAN-SPAM compliance server-side via ops_command('draft_review').
    if (!draft.customer_id) {
      if (reviewingId) return
      setReviewingId(draft.id)
      try {
        await opsCommand(
          workspaceId,
          'draft_review',
          { id: draft.id, status: 'approved' },
          createIdempotencyKey(),
        )
        toast.success(
          'Approved & CAN-SPAM B2B preflight verified',
          `${draft.subject} queued at delivery_status: not_sent.`,
        )
        await loadDraftsPage()
        await onConsentOrDraftsChanged()
      } catch (err) {
        toast.error(
          'Preflight approval failed',
          err instanceof Error ? err.message : 'Retry.',
        )
      } finally {
        setReviewingId(null)
      }
      return
    }

    const customerOpps = opportunities.filter(
      o => o.customer_id === draft.customer_id && o.status !== 'dismissed',
    )
    setPreflightDraft(draft)
    setPreflightOpportunityId(customerOpps[0]?.id ?? opportunities[0]?.id ?? '')
  }

  const handleRunPreflight = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!preflightDraft || !preflightDraft.customer_id) return
    const compliance = getDraftCompliance(preflightDraft)
    if (!compliance.allowed) {
      toast.error(
        'Preflight blocked',
        compliance.blockReason ??
          'Draft must pass channel opt-in or CAN-SPAM B2B verification before preflight.',
      )
      return
    }
    const latest = getLatestConsent(preflightDraft.customer_id, preflightDraft.channel)
    if (!preflightOpportunityId) {
      if (compliance.basis === 'can_spam_b2b') {
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
          setPreflightDraft(null)
          toast.success(
            'Approved & CAN-SPAM B2B preflight verified',
            `${preflightDraft.subject} queued at delivery_status: not_sent.`,
          )
          await loadDraftsPage()
          await onConsentOrDraftsChanged()
        } catch (err) {
          toast.error(
            'Preflight verification failed',
            err instanceof Error ? err.message : 'Could not approve draft.',
          )
        } finally {
          setEnqueueing(false)
        }
        return
      }
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

      const custEmail = customersById.get(preflightDraft.customer_id)?.email
      const res = await approveAndEnqueueRecoveryDraft({
        workspaceId,
        opportunityId: preflightOpportunityId,
        customerId: preflightDraft.customer_id,
        channel: preflightDraft.channel,
        consentEvidenceReference:
          latest?.decision === 'granted'
            ? latest.evidence_reference
            : CAN_SPAM_B2B_EVIDENCE_REF,
        recipientEmail: preflightDraft.recipient_email ?? custEmail ?? null,
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
  const preflightCompliance = preflightDraft ? getDraftCompliance(preflightDraft) : null

  return (
    <div className="space-y-6">
      {/* Top Bar: Sender Pool & Daily Capacity + Automated Sequencer Triggers */}
      <section
        aria-label="Sender pool and daily capacity"
        className="rounded-2xl border border-slate-800 bg-[#0b1320] p-4 sm:p-5 text-slate-100 space-y-4"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Inbox className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Sender Pool &amp; Daily Capacity
              </h2>
              <Badge tone="brand">
                {senderPoolSummary.activeCount} Active Inbox{senderPoolSummary.activeCount === 1 ? '' : 'es'}
              </Badge>
              <Badge tone="emerald">
                <span className="tabular-nums">
                  {senderPoolSummary.activeSent} / {senderPoolSummary.activeCap} Sent Today
                </span>
              </Badge>
            </div>
            <p className="text-xs text-slate-300">
              Round-robin rotation caps the primary domain at 15/day and secondary domains at 20/day.
              Pending drafts require explicit owner approval before dispatch.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={stagingFollowUps}
              onClick={() => void handleStageFollowUps()}
              className="exec-btn-secondary !px-3 !py-2 !text-xs border-slate-700 bg-[#131f33] text-slate-100 touch-target"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
              {stagingFollowUps
                ? 'Scanning Sequences…'
                : 'Stage Due Follow-Ups (Day 3 / Day 7)'}
            </button>
            <button
              type="button"
              onClick={() => setAddInboxOpen(true)}
              className="exec-btn-primary !px-3 !py-2 !text-xs touch-target"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Sender Inbox
            </button>
          </div>
        </div>

        {loadingInboxes ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : senderInboxes.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] px-4 py-3 text-xs text-slate-300">
            No sender inboxes registered yet for this workspace. Add your primary or secondary outreach inbox above.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {senderInboxes.map(inbox => {
              const cap = effectiveDailyCap(inbox)
              const pct = cap > 0 ? Math.min(100, Math.round((inbox.sent_today / cap) * 100)) : 100
              const isPaused = inbox.status === 'paused'
              return (
                <div
                  key={inbox.id}
                  className="rounded-xl border border-slate-800 bg-[#0e1726] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-white">{inbox.from_name}</p>
                      <p className="truncate font-mono text-[11px] text-slate-300">{inbox.from_email}</p>
                    </div>
                    <Badge
                      tone={
                        inbox.status === 'active'
                          ? 'emerald'
                          : inbox.status === 'warming'
                            ? 'amber'
                            : 'neutral'
                      }
                    >
                      {inbox.status}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="truncate">{inbox.domain}</span>
                      <span className="font-mono font-semibold text-slate-200 tabular-nums">
                        {inbox.sent_today} / {cap}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 100 ? 'bg-rose-500' : 'bg-[#ea580c]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      disabled={togglingInboxId === inbox.id}
                      onClick={() => void handleToggleInboxStatus(inbox)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#131f33] px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:border-[#fb923c]/50 transition"
                    >
                      {isPaused ? (
                        <>
                          <PlayCircle className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                          Resume Inbox
                        </>
                      ) : (
                        <>
                          <PauseCircle className="h-3 w-3 text-amber-400" aria-hidden="true" />
                          Pause Inbox
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Paginated Communication Drafts Queue */}
        <section
          aria-label="Consent-gated communication drafts"
          className="exec-surface overflow-hidden lg:col-span-8 flex flex-col justify-between"
        >
          <div>
            <div className="space-y-3 border-b border-slate-200 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Consent-Gated Communication Drafts
                  </h2>
                  <p className="text-xs text-slate-600">
                    Every draft stays internal (<code>delivery_status = &apos;not_sent&apos;</code>).
                    SMS strictly requires active channel opt-in before approval; B2B email allows
                    CAN-SPAM compliance (physical address + opt-out footer) when the recipient is not
                    opted out.
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

                  {draftFilter === 'pending' ? (
                    <button
                      type="button"
                      disabled={batchApproving || batchApprovable.eligible.length === 0}
                      onClick={() => void handleSelectAndApproveCompliantBatch()}
                      className="exec-btn-emerald !px-3.5 !py-2 !text-xs touch-target"
                    >
                      <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      {batchApproving
                        ? 'Approving Compliant Batch…'
                        : `Select All Compliant → Approve Batch (${batchApprovable.eligible.length})`}
                    </button>
                  ) : null}

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

              {/* Lane & Sequence Step Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Outreach lane filter">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
                    <Layers className="h-3 w-3 text-[#fb923c]" aria-hidden="true" />
                    Lane:
                  </span>
                  {(
                    [
                      { id: 'all', label: 'All Lanes' },
                      { id: 'trades_clinics', label: 'Trades & Clinics' },
                      { id: 'bookkeepers_cpa', label: 'Bookkeepers & CPAs' },
                    ] as const
                  ).map(pill => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => {
                        setLaneFilter(pill.id)
                        setPage(0)
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        laneFilter === pill.id
                          ? 'border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] text-[#fdba74]'
                          : 'border-slate-700 bg-[#0e1726] text-slate-300 hover:bg-[#131f33]'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sequence step filter">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
                    Step:
                  </span>
                  {(
                    [
                      { id: 'all', label: 'All Steps' },
                      { id: 1, label: 'Day 1' },
                      { id: 2, label: 'Day 3 Bump' },
                      { id: 3, label: 'Day 7 Final' },
                    ] as const
                  ).map(pill => (
                    <button
                      key={String(pill.id)}
                      type="button"
                      onClick={() => {
                        setStepFilter(pill.id)
                        setPage(0)
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        stepFilter === pill.id
                          ? 'border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] text-[#fdba74]'
                          : 'border-slate-700 bg-[#0e1726] text-slate-300 hover:bg-[#131f33]'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
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
                const cust = draft.customer_id ? customersById.get(draft.customer_id) : undefined
                const latest = getLatestConsent(draft.customer_id, draft.channel)
                const compliance = getDraftCompliance(draft)
                const canDismiss =
                  draft.status === 'draft' ||
                  (draft.status === 'approved' && draft.delivery_status === 'not_sent')
                const stepNum: SequenceStep = draft.sequence_step ?? 1
                const laneKey: OutreachLane = draft.outreach_lane ?? 'trades_clinics'
                const isEligibleBatch = approvableIdSet.has(draft.id)
                const isChecked = selectedDraftIds.includes(draft.id)

                return (
                  <li key={draft.id} className="p-4 sm:p-5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {draft.status === 'draft' ? (
                          <input
                            type="checkbox"
                            aria-label={`Select draft ${draft.subject}`}
                            disabled={!isEligibleBatch}
                            checked={isChecked}
                            onChange={e => {
                              const checked = e.target.checked
                              setSelectedDraftIds(prev =>
                                checked
                                  ? [...new Set([...prev, draft.id])]
                                  : prev.filter(id => id !== draft.id),
                              )
                            }}
                            className="h-4 w-4 rounded border-slate-600 accent-[#ea580c] disabled:opacity-35"
                          />
                        ) : null}
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          {cust
                            ? customerDisplayName(cust)
                            : draft.company_name ?? draft.recipient_name ?? 'Customer'}{' '}
                          · {draft.channel.toUpperCase()}
                        </span>
                        <Badge tone="brand">{OUTREACH_LANE_LABELS[laneKey]}</Badge>
                        <Badge tone={stepNum === 1 ? 'neutral' : 'amber'}>
                          {SEQUENCE_STEP_LABELS[stepNum]}
                        </Badge>
                        {draft.auto_paused_reason ? (
                          <Badge tone="rose">
                            {AUTO_PAUSE_REASON_LABELS[draft.auto_paused_reason]}
                          </Badge>
                        ) : null}
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
                        <Badge tone={compliance.badgeTone}>
                          {compliance.allowed ? (
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                          )}
                          {compliance.badgeLabel}
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

                    {compliance.blockReason ? (
                      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs text-rose-900">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                        <span>{compliance.blockReason}</span>
                      </div>
                    ) : compliance.basis === 'can_spam_b2b' ? (
                      <p className="text-[11px] text-emerald-800 font-mono">
                        CAN-SPAM B2B ready · Physical address + opt-out footer verified · Not opted out
                      </p>
                    ) : latest ? (
                      <p className="text-[11px] text-emerald-800 font-mono">
                        Verified consent ref: {latest.evidence_reference}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={!compliance.allowed || draft.status === 'rejected' || reviewingId === draft.id}
                        onClick={() => void openPreflightModal(draft)}
                        className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve & Preflight Enqueue
                      </button>

                      {draft.status === 'draft' ? (
                        <button
                          type="button"
                          disabled={!compliance.allowed || reviewingId === draft.id}
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

                      {draft.channel === 'email' &&
                      draft.delivery_status === 'not_sent' &&
                      draft.status !== 'rejected' &&
                      !draft.auto_paused_reason ? (
                        <button
                          type="button"
                          disabled={pausingLeadKey === draft.id}
                          onClick={() => void handlePauseDraftSequence(draft)}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <PauseCircle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                          Mark Replied (Pause Seq)
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
                const cust = ev.customer_id ? customersById.get(ev.customer_id) : undefined
                return (
                  <li key={ev.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {cust ? customerDisplayName(cust) : ev.email ?? 'Recipient'} ({ev.channel.toUpperCase()})
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
      </div>

      {/* Compose Draft Modal */}
      <Dialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="Prepare Internal Communication Draft"
        description="Saved via ops_command('draft_save') with delivery_status = 'not_sent'."
      >
        <form onSubmit={handleSaveDraft} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

            <div>
              <label htmlFor="draft-lane" className="exec-label">
                Outreach Lane
              </label>
              <select
                id="draft-lane"
                value={composeLane}
                onChange={e => setComposeLane(e.target.value as OutreachLane)}
                className="exec-input"
              >
                <option value="trades_clinics">Trades &amp; Clinics</option>
                <option value="bookkeepers_cpa">Bookkeepers &amp; CPAs</option>
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
                Channel: <strong>{preflightDraft.channel.toUpperCase()}</strong> · Basis:{' '}
                <code>
                  {preflightConsent?.decision === 'granted'
                    ? preflightConsent.evidence_reference
                    : preflightCompliance?.basis === 'can_spam_b2b'
                      ? CAN_SPAM_B2B_EVIDENCE_REF
                      : 'MISSING'}
                </code>
              </p>
            </div>

            <div>
              <label htmlFor="preflight-opp" className="exec-label">
                Linked Opportunity
              </label>
              <select
                id="preflight-opp"
                required={preflightCompliance?.basis !== 'can_spam_b2b'}
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
                disabled={enqueueing || !preflightCompliance?.allowed}
                className="exec-btn-emerald touch-target"
              >
                {enqueueing ? 'Verifying & Enqueueing…' : 'Confirm Preflight Enqueue'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* Add Sender Inbox Modal */}
      <Dialog
        open={addInboxOpen}
        onClose={() => setAddInboxOpen(false)}
        title="Add Outbound Sender Inbox"
        description="Adds a warming or active domain inbox to the multi-inbox round-robin rotation pool."
      >
        <form onSubmit={handleAddSenderInbox} className="space-y-4">
          <div>
            <label htmlFor="inbox-from-name" className="exec-label">
              From Display Name
            </label>
            <input
              id="inbox-from-name"
              type="text"
              required
              value={newInboxFromName}
              onChange={e => setNewInboxFromName(e.target.value)}
              className="exec-input"
            />
          </div>

          <div>
            <label htmlFor="inbox-from-email" className="exec-label">
              From Email Address
            </label>
            <input
              id="inbox-from-email"
              type="email"
              required
              placeholder="justin@looseendshq.com"
              value={newInboxFromEmail}
              onChange={e => setNewInboxFromEmail(e.target.value)}
              className="exec-input"
            />
          </div>

          <div>
            <label htmlFor="inbox-daily-cap" className="exec-label">
              Daily Send Cap (Primary domain auto-capped at 15)
            </label>
            <input
              id="inbox-daily-cap"
              type="number"
              min={1}
              max={200}
              required
              value={newInboxDailyCap}
              onChange={e => setNewInboxDailyCap(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setAddInboxOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingInbox}
              className="exec-btn-primary touch-target"
            >
              {savingInbox ? 'Saving Inbox…' : 'Add to Sender Pool'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
