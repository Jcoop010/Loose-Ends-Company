// Pure deterministic human-in-the-loop AR dunning scheduler (integer cents, zero auto-send)

import { computeInvoiceBalanceDueCents, diffDaysIsoUtc } from './agingEngine'
import type {
  AutonomousInvoice,
  DunningDraftProposal,
  DunningEvaluationResult,
  DunningStage,
  InvoiceDunningEventRecord,
} from './types'

export const DUNNING_STAGE_LABELS: Record<DunningStage, string> = {
  pre_due_3d: 'Pre-Due Reminder (-3d)',
  due_plus_3d: 'Past Due (+3d)',
  overdue_14d: 'Overdue Notice (+14d)',
  overdue_30d: 'Escalation Notice (+30d)',
}

function formatCentsUsd(cents: number): string {
  const safe = Math.trunc(cents)
  const dollars = (Math.abs(safe) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${safe < 0 ? '-' : ''}$${dollars}`
}

export function selectDunningStageForDaysPastDue(daysPastDue: number): DunningStage | null {
  const d = Math.trunc(daysPastDue)
  if (d >= -3 && d <= -1) return 'pre_due_3d'
  if (d >= 3 && d <= 13) return 'due_plus_3d'
  if (d >= 14 && d <= 29) return 'overdue_14d'
  if (d >= 30) return 'overdue_30d'
  return null
}

/**
 * Pure integer-cent late fee calculation in basis points + optional flat cent fee.
 * Only applies on overdue_14d or overdue_30d stages.
 */
export function computeLateFeeCents(params: {
  balanceDueCents: number
  stage: DunningStage
  lateFeeBps?: number
  flatLateFeeCents?: number
}): number {
  const balance = Math.max(0, Math.trunc(params.balanceDueCents))
  if (balance <= 0) return 0
  if (params.stage !== 'overdue_14d' && params.stage !== 'overdue_30d') {
    return 0
  }

  const bps = Math.max(0, Math.min(2500, Math.trunc(params.lateFeeBps ?? 0)))
  const flat = Math.max(0, Math.trunc(params.flatLateFeeCents ?? 0))
  const pctFee = Math.floor((balance * bps + 5000) / 10_000)
  return pctFee + flat
}

function buildDunningCopy(params: {
  invoice: AutonomousInvoice
  stage: DunningStage
  balanceDueCents: number
  lateFeeCents: number
}): { subject: string; body: string } {
  const { invoice, stage, balanceDueCents, lateFeeCents } = params
  const totalDue = balanceDueCents + lateFeeCents
  const payLink =
    invoice.stripe_payment_link_url ||
    invoice.stripe_checkout_url ||
    '(Generate Stripe payment link before sending)'

  if (stage === 'pre_due_3d') {
    return {
      subject: `Upcoming invoice ${invoice.invoice_number} due ${invoice.due_date} (${formatCentsUsd(balanceDueCents)})`,
      body: `Hi ${invoice.customer_name},\n\nFriendly heads-up that invoice ${invoice.invoice_number} for "${invoice.title}" (${formatCentsUsd(balanceDueCents)} remaining) is due on ${invoice.due_date}.\n\nPay online anytime by card or ACH: ${payLink}`,
    }
  }

  if (stage === 'due_plus_3d') {
    return {
      subject: `Reminder: Invoice ${invoice.invoice_number} is 3+ days past due (${formatCentsUsd(balanceDueCents)})`,
      body: `Hi ${invoice.customer_name},\n\nInvoice ${invoice.invoice_number} (${formatCentsUsd(balanceDueCents)} remaining, due ${invoice.due_date}) is now past due.\n\nYou can settle the remaining balance directly by card or ACH here: ${payLink}`,
    }
  }

  if (stage === 'overdue_14d') {
    const feeLine =
      lateFeeCents > 0
        ? ` Total with ${formatCentsUsd(lateFeeCents)} late fee: ${formatCentsUsd(totalDue)}.`
        : ''
    return {
      subject: `Action needed: Invoice ${invoice.invoice_number} is 14+ days overdue (${formatCentsUsd(totalDue)})`,
      body: `Hi ${invoice.customer_name},\n\nOur records show ${formatCentsUsd(balanceDueCents)} still open on invoice ${invoice.invoice_number} (due ${invoice.due_date}).${feeLine}\n\nPlease remit payment via Card/ACH at ${payLink} or reply with your payment schedule.`,
    }
  }

  const feeLine =
    lateFeeCents > 0
      ? ` Includes accrued late fee of ${formatCentsUsd(lateFeeCents)} for a total due of ${formatCentsUsd(totalDue)}.`
      : ''
  return {
    subject: `URGENT (30+ days overdue): Invoice ${invoice.invoice_number} — ${formatCentsUsd(totalDue)}`,
    body: `Hi ${invoice.customer_name},\n\nInvoice ${invoice.invoice_number} (due ${invoice.due_date}) is now more than 30 days overdue with an unpaid balance of ${formatCentsUsd(balanceDueCents)}.${feeLine}\n\nPlease complete payment immediately at ${payLink} or contact our billing desk today to avoid a service hold.`,
  }
}

export function evaluateInvoiceDunning(params: {
  workspaceId: string
  invoices: readonly AutonomousInvoice[]
  existingEvents?: readonly InvoiceDunningEventRecord[]
  botMode: string
  asOfDate?: string
  lateFeeBps?: number
  flatLateFeeCents?: number
}): DunningEvaluationResult {
  const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10)
  const existingSet = new Set(
    (params.existingEvents ?? []).map(ev => `${ev.invoice_id}:${ev.stage}`),
  )

  const normalizedMode = params.botMode.trim().toLowerCase()
  const observeModeBlocked = normalizedMode === 'observe'

  const drafts: DunningDraftProposal[] = []
  let eligibleCount = 0
  let skippedAlreadyDraftedCount = 0

  for (const inv of params.invoices) {
    if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'draft') {
      continue
    }
    const balanceDueCents = computeInvoiceBalanceDueCents(inv)
    if (balanceDueCents <= 0) continue

    const daysPastDue = diffDaysIsoUtc(inv.due_date, asOfDate)
    const stage = selectDunningStageForDaysPastDue(daysPastDue)
    if (!stage) continue

    if (existingSet.has(`${inv.id}:${stage}`)) {
      skippedAlreadyDraftedCount += 1
      continue
    }

    eligibleCount += 1
    if (observeModeBlocked) {
      continue
    }

    const lateFeeCents = computeLateFeeCents({
      balanceDueCents,
      stage,
      lateFeeBps: params.lateFeeBps,
      flatLateFeeCents: params.flatLateFeeCents,
    })

    const copy = buildDunningCopy({
      invoice: inv,
      stage,
      balanceDueCents,
      lateFeeCents,
    })

    const totalWithLateFeeCents = balanceDueCents + lateFeeCents
    const idempotencyKey = `dunning:${inv.id}:${stage}`

    drafts.push({
      workspace_id: params.workspaceId,
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      customer_name: inv.customer_name,
      customer_email: inv.customer_email,
      due_date: inv.due_date,
      days_past_due: daysPastDue,
      stage,
      stage_label: DUNNING_STAGE_LABELS[stage],
      balance_due_cents: balanceDueCents,
      late_fee_cents: lateFeeCents,
      total_with_late_fee_cents: totalWithLateFeeCents,
      action_type: 'dunning_reminder',
      status: 'pending_approval',
      autoSendAllowed: false,
      idempotency_key: idempotencyKey,
      title: `${DUNNING_STAGE_LABELS[stage]} · ${inv.invoice_number} (${inv.customer_name})`,
      summary: `${copy.subject}${lateFeeCents > 0 ? ` · Late fee ${formatCentsUsd(lateFeeCents)}` : ''} · Human approval required (no auto-send).`,
      subject: copy.subject,
      draft_body: copy.body,
    })
  }

  drafts.sort(
    (a, b) =>
      b.days_past_due - a.days_past_due || b.balance_due_cents - a.balance_due_cents,
  )

  return {
    as_of_date: asOfDate,
    bot_mode: normalizedMode,
    observe_mode_blocked: observeModeBlocked,
    eligible_count: eligibleCount,
    skipped_observe_mode_count: observeModeBlocked ? eligibleCount : 0,
    skipped_already_drafted_count: skippedAlreadyDraftedCount,
    drafts,
  }
}
