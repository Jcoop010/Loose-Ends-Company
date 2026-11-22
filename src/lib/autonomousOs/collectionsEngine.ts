import { DEFAULT_AUTONOMY_CONFIG } from './types'
import { evaluateAutonomyGate, formatCents } from './engine'
import type {
  AutonomousInvoice,
  CollectionTouchRecord,
  CollectionTouchStage,
  CollectionTouchStatus,
  CollectionsRunPlan,
  EvaluatedCollectionCandidate,
  WorkspaceAutonomyConfig,
} from './types'

export const COLLECTION_STAGE_LABELS: Readonly<Record<CollectionTouchStage, string>> = {
  day_3_nudge: 'Day 3+ Nudge (Portal Link)',
  day_10_split_offer: 'Day 10+ 2-Part Split Offer',
  day_21_owner_escalation: 'Day 21+ Owner Escalation',
}

export const COLLECTION_STATUS_LABELS: Readonly<Record<CollectionTouchStatus, string>> = {
  staged: 'Staged (Approval Safe)',
  paused_paid: 'Auto-Paused (Paid)',
  paused_disputed: 'Paused (Disputed)',
  sent: 'Sent',
  reversed: 'Reversed (1-Click Undo)',
}

function diffUtcDays(laterIso: string, earlierIso: string): number {
  const a = Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((a - b) / 86_400_000)
}

export function stageForDaysOverdue(daysOverdue: number): CollectionTouchStage | null {
  if (daysOverdue >= 21) return 'day_21_owner_escalation'
  if (daysOverdue >= 10) return 'day_10_split_offer'
  if (daysOverdue >= 3) return 'day_3_nudge'
  return null
}

function computeTwoPartSplit(totalCents: number): { part1: number; part2: number } {
  const safe = Math.max(0, Math.trunc(totalCents))
  const part1 = Math.ceil(safe / 2)
  const part2 = safe - part1
  return { part1, part2 }
}

/**
 * Pure, deterministic 3-stage Autonomous Collections evaluator in exact integer cents.
 * Hard-enforces immediate auto-pause on paid or disputed invoices and obeys Global Autonomy Dial.
 */
export function evaluateAutonomousCollections(params: {
  workspaceId: string
  invoices: readonly AutonomousInvoice[]
  existingTouches?: readonly CollectionTouchRecord[]
  disputedInvoiceIds?: ReadonlySet<string> | readonly string[]
  portalTokenByQuoteId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  config?: WorkspaceAutonomyConfig
  asOfDate?: string
  portalBaseUrl?: string
}): CollectionsRunPlan {
  const asOfDate =
    params.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)
      ? params.asOfDate
      : new Date().toISOString().slice(0, 10)
  const config = params.config ?? DEFAULT_AUTONOMY_CONFIG
  const portalBaseUrl = (params.portalBaseUrl ?? '/portal').replace(/\/+$/, '')

  const disputedSet = new Set<string>(
    params.disputedInvoiceIds instanceof Set
      ? Array.from(params.disputedInvoiceIds)
      : (params.disputedInvoiceIds ?? []),
  )

  const existingTouches = params.existingTouches ?? []
  const latestTouchByInvoice = new Map<string, CollectionTouchRecord>()
  for (const touch of existingTouches) {
    if (touch.status === 'paused_disputed') {
      disputedSet.add(touch.invoice_id)
    }
    if (!latestTouchByInvoice.has(touch.invoice_id)) {
      latestTouchByInvoice.set(touch.invoice_id, touch)
    }
  }

  const getPortalToken = (quoteId: string | null): string | null => {
    if (!quoteId || !params.portalTokenByQuoteId) return null
    if (params.portalTokenByQuoteId instanceof Map) {
      return params.portalTokenByQuoteId.get(quoteId) ?? null
    }
    const rec = params.portalTokenByQuoteId as Record<string, string>
    return typeof rec[quoteId] === 'string' ? rec[quoteId] : null
  }

  const existingTouchIdsToPausePaid: string[] = []
  const existingTouchIdsToPauseDisputed: string[] = []
  const candidates: EvaluatedCollectionCandidate[] = []

  const stageCounts: Record<CollectionTouchStage, number> = {
    day_3_nudge: 0,
    day_10_split_offer: 0,
    day_21_owner_escalation: 0,
  }

  for (const inv of params.invoices) {
    if (inv.status === 'void' || inv.status === 'draft') continue

    const totalCents = Number.isSafeInteger(inv.total_cents) ? Math.max(0, inv.total_cents) : 0
    const paidCents = Number.isSafeInteger(inv.amount_paid_cents)
      ? Math.min(totalCents, Math.max(0, inv.amount_paid_cents))
      : 0
    const amountDueCents = inv.status === 'paid' ? 0 : Math.max(0, totalCents - paidCents)
    const daysOverdue = inv.due_date ? Math.max(0, diffUtcDays(asOfDate, inv.due_date)) : 0
    const priorTouch = latestTouchByInvoice.get(inv.id)

    const token = getPortalToken(inv.quote_id)
    const portalUrl = token
      ? `${portalBaseUrl}/${encodeURIComponent(token)}`
      : `${portalBaseUrl}/invoice-${encodeURIComponent(inv.invoice_number)}`

    // Hard safety auto-pause #1: invoice is already paid or $0.00 balance remains
    if (inv.status === 'paid' || amountDueCents === 0) {
      if (priorTouch && priorTouch.status === 'staged') {
        existingTouchIdsToPausePaid.push(priorTouch.id)
      }
      if (priorTouch || daysOverdue >= 3) {
        const refStage = priorTouch?.stage ?? stageForDaysOverdue(daysOverdue) ?? 'day_3_nudge'
        candidates.push({
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          customer_name: inv.customer_name,
          customer_email: inv.customer_email,
          due_date: inv.due_date,
          days_overdue: daysOverdue,
          stage: refStage,
          status: 'paused_paid',
          amount_due_cents: 0,
          split_part_1_cents: null,
          split_part_2_cents: null,
          portal_url: portalUrl,
          autonomy_decision: 'manual_only',
          should_stage: false,
          auto_paused_reason: 'paid',
          message_subject: `[Auto-Paused Paid] ${inv.invoice_number} settled`,
          message_preview: `Collection cadence automatically halted because ${inv.invoice_number} (${inv.customer_name}) is paid in full ($0.00 open).`,
          proof_summary: `Auto-paused: ${inv.invoice_number} status="${inv.status}", open balance $0.00 (0 cents). No outreach staged.`,
        })
      }
      continue
    }

    const stage = stageForDaysOverdue(daysOverdue)
    if (!stage) continue

    // Hard safety auto-pause #2: invoice is marked disputed
    if (disputedSet.has(inv.id)) {
      if (priorTouch && priorTouch.status === 'staged') {
        existingTouchIdsToPauseDisputed.push(priorTouch.id)
      }
      candidates.push({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        customer_name: inv.customer_name,
        customer_email: inv.customer_email,
        due_date: inv.due_date,
        days_overdue: daysOverdue,
        stage,
        status: 'paused_disputed',
        amount_due_cents: amountDueCents,
        split_part_1_cents: null,
        split_part_2_cents: null,
        portal_url: portalUrl,
        autonomy_decision: 'manual_only',
        should_stage: false,
        auto_paused_reason: 'disputed',
        message_subject: `[Paused Disputed] ${inv.invoice_number} held`,
        message_preview: `Collections automatically paused while ${inv.invoice_number} (${inv.customer_name}) is marked disputed.`,
        proof_summary: `Auto-paused (disputed): ${inv.invoice_number} (${daysOverdue}d overdue, ${formatCents(amountDueCents)} / ${amountDueCents.toLocaleString('en-US')} cents) held until owner resolves dispute.`,
      })
      continue
    }

    const gateDecision = evaluateAutonomyGate('send_invoice_reminder', amountDueCents, config)
    const { part1, part2 } =
      stage === 'day_10_split_offer'
        ? computeTwoPartSplit(amountDueCents)
        : { part1: null, part2: null }

    let subject = `Friendly reminder: Invoice ${inv.invoice_number} (${formatCents(amountDueCents)})`
    let preview = `Hi ${inv.customer_name}, quick reminder that ${inv.invoice_number} (${formatCents(amountDueCents)}) is ${daysOverdue} days past due. Pay anytime via your portal link: ${portalUrl}`
    let proof = `Day 3+ Nudge: ${inv.invoice_number} is ${daysOverdue}d past due (due ${inv.due_date}) with ${formatCents(amountDueCents)} (${amountDueCents.toLocaleString('en-US')} cents) open; direct portal link ${portalUrl}.`

    if (stage === 'day_10_split_offer' && part1 !== null && part2 !== null) {
      subject = `2-Part Payment Option for Invoice ${inv.invoice_number} (${formatCents(amountDueCents)})`
      preview = `Hi ${inv.customer_name}, ${inv.invoice_number} is now ${daysOverdue} days past due. Split the balance into 2 installments (${formatCents(part1)} today + ${formatCents(part2)} in 14 days) via ${portalUrl}`
      proof = `Day 10+ 2-Part Split Offer: ${inv.invoice_number} is ${daysOverdue}d overdue; ${formatCents(amountDueCents)} (${amountDueCents.toLocaleString('en-US')}c) split cleanly into ${formatCents(part1)} (${part1.toLocaleString('en-US')}c) + ${formatCents(part2)} (${part2.toLocaleString('en-US')}c) = ${amountDueCents.toLocaleString('en-US')}c.`
    } else if (stage === 'day_21_owner_escalation') {
      subject = `OWNER ESCALATION: Invoice ${inv.invoice_number} ${daysOverdue}d Overdue (${formatCents(amountDueCents)})`
      preview = `Owner alert: ${inv.customer_name} owes ${formatCents(amountDueCents)} on ${inv.invoice_number} (${daysOverdue} days past due since ${inv.due_date}). Direct owner call or collections hold recommended before live send.`
      proof = `Day 21+ Owner Escalation: ${inv.invoice_number} reached ${daysOverdue}d overdue (${inv.due_date} -> ${asOfDate}) for ${formatCents(amountDueCents)} (${amountDueCents.toLocaleString('en-US')} cents); escalated to workspace owner queue.`
    }

    stageCounts[stage] += 1
    candidates.push({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      customer_name: inv.customer_name,
      customer_email: inv.customer_email,
      due_date: inv.due_date,
      days_overdue: daysOverdue,
      stage,
      status: 'staged',
      amount_due_cents: amountDueCents,
      split_part_1_cents: part1,
      split_part_2_cents: part2,
      portal_url: portalUrl,
      autonomy_decision: gateDecision,
      should_stage: true,
      auto_paused_reason: null,
      message_subject: subject,
      message_preview: preview,
      proof_summary: proof,
    })
  }

  candidates.sort((a, b) => {
    if (a.should_stage !== b.should_stage) return a.should_stage ? -1 : 1
    if (b.days_overdue !== a.days_overdue) return b.days_overdue - a.days_overdue
    return b.amount_due_cents - a.amount_due_cents
  })

  const stagedCandidates = candidates.filter(c => c.should_stage)
  const pausedCandidates = candidates.filter(c => !c.should_stage)
  const totalStagedCents = stagedCandidates.reduce((s, c) => s + c.amount_due_cents, 0)
  const totalPausedCents = pausedCandidates.reduce((s, c) => s + c.amount_due_cents, 0)

  const ledgerStatus =
    config.autonomy_rules.send_invoice_reminder === 'full_auto' &&
    totalStagedCents <= config.auto_limit_cents
      ? 'executed'
      : 'executed'

  return {
    as_of_date: asOfDate,
    candidates,
    staged_candidates: stagedCandidates,
    paused_candidates: pausedCandidates,
    total_staged_cents: totalStagedCents,
    total_paused_cents: totalPausedCents,
    stage_counts: stageCounts,
    existing_touch_ids_to_pause_paid: existingTouchIdsToPausePaid,
    existing_touch_ids_to_pause_disputed: existingTouchIdsToPauseDisputed,
    ledger_draft: {
      workspace_id: params.workspaceId,
      agent_name: 'Autonomous Collections Engine',
      module: 'billing',
      action_type: 'stage_collections_run',
      autonomy_mode: config.autonomy_rules.send_invoice_reminder,
      summary: `Staged ${stagedCandidates.length} overdue collection touch(es) (${formatCents(totalStagedCents)}) · auto-paused ${pausedCandidates.length} settled/disputed invoice(s)`,
      impact_cents: totalStagedCents,
      before_state: {
        invoice_ids: stagedCandidates.map(c => c.invoice_id),
        prior_staged_count: existingTouches.filter(t => t.status === 'staged').length,
      },
      after_state: {
        invoice_ids: stagedCandidates.map(c => c.invoice_id),
        staged_count: stagedCandidates.length,
        paused_count: pausedCandidates.length,
        stage_counts: stageCounts,
      },
      status: ledgerStatus,
      reversed_at: null,
    },
  }
}
