import { evaluateAutonomyGate, formatCents } from './engine'
import { simulateCashflow90Day } from './bookkeepingEngine'
import type {
  AutonomousInvoice,
  CompiledSopRule,
  ComplianceVaultItem,
  ExecutableSopRecord,
  SopActionKind,
  SopCompilerPreset,
  SopExecutionResult,
  SopSimulationProofCard,
  SopSimulationResult,
  SopTriggerType,
  VendorBillRecord,
  WorkspaceAutonomyConfig,
} from './types'
import { DEFAULT_AUTONOMY_CONFIG } from './types'

export const SOP_TRIGGER_LABELS: Readonly<Record<SopTriggerType, string>> = {
  vendor_bill_received: 'Vendor Bill Received',
  invoice_overdue: 'Invoice Overdue',
  cashflow_threshold: 'Cashflow Below Floor',
  contract_expiring: 'Contract / COI Notice Window',
}

export const SOP_ACTION_LABELS: Readonly<Record<SopActionKind, string>> = {
  freeze_bill_for_approval: 'Freeze Bill & Stage Owner Approval',
  stage_collection_chase: 'Stage Consent-Gated AR Chaser',
  trigger_runway_protection: 'Hold Non-Essential AP & Raise Cash Alert',
  stage_compliance_renewal_notice: 'Stage Counterparty Renewal / Cancellation Draft',
}

export const SOP_COMPILER_PRESETS: ReadonlyArray<SopCompilerPreset> = [
  {
    id: 'preset-vendor-5pct',
    label: 'Vendor >5% Price-Jump Freeze',
    name: 'Vendor >5% Price-Jump Freeze Guard',
    prompt:
      'Automate: When vendor bill unit price increases >5% vs prior baseline, freeze bill for approval up to $2,500 safety cap.',
    safety_cap_cents: 250000,
  },
  {
    id: 'preset-cashflow-15k',
    label: 'Cashflow <$15k Protection',
    name: 'Cashflow <$15,000 Runway Shield',
    prompt:
      'Automate: If 90-day projected cashflow drops below $15,000 safety floor, hold AP outflows up to $10,000 cap and alert owner.',
    safety_cap_cents: 1000000,
  },
  {
    id: 'preset-coi-30d',
    label: '30-Day COI Auto-Chaser',
    name: '30-Day Contract & COI Renewal Guard',
    prompt:
      'Automate: When any COI, contract, or SaaS renewal enters 30 days of expiration, stage cancellation/renewal notice up to $20,000 cap.',
    safety_cap_cents: 2000000,
  },
]

function parsePositiveDollarCents(text: string): number | null {
  const match = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*([kKmM])?/i.exec(text)
  if (!match) return null
  const base = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base) || base < 0) return null
  const suffix = (match[2] ?? '').toLowerCase()
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const cents = Math.round(base * multiplier * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

function parsePercentBps(text: string): number | null {
  const match = /(\d+(?:\.\d{1,2})?)\s*%/i.exec(text)
  if (!match) return null
  const pct = Number(match[1])
  if (!Number.isFinite(pct) || pct < 0) return null
  return Math.round(pct * 100)
}

function parseDaysInt(text: string): number | null {
  const match = /\b(\d{1,3})\s*(?:-|\s)?(?:day|days|d)\b/i.exec(text)
  if (!match) return null
  const days = Math.trunc(Number(match[1]))
  return days >= 0 ? days : null
}

function deriveSopName(prompt: string, trigger: SopTriggerType): string {
  const clean = prompt.replace(/^automate\s*:\s*/i, '').trim()
  if (!clean) return SOP_TRIGGER_LABELS[trigger]
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean
}

/**
 * Deterministically compiles a plain-English operational SOP rule into a typed AST
 * with an enforced integer-cent safety cap (zero LLM calls or external network IO).
 */
export function compilePlainEnglishSop(
  rawPrompt: string,
  options?: { name?: string; safetyCapCents?: number },
): { name: string; plain_english_prompt: string; rule: CompiledSopRule } {
  const prompt = rawPrompt.trim()
  if (!prompt) {
    throw new Error('Plain-English SOP prompt cannot be empty.')
  }

  const normalized = prompt.toLowerCase()
  const defaultCap =
    typeof options?.safetyCapCents === 'number' &&
    Number.isSafeInteger(options.safetyCapCents) &&
    options.safetyCapCents >= 0
      ? options.safetyCapCents
      : 500000

  const parsedDollarsCents = parsePositiveDollarCents(prompt)
  const capMatch = /(?:cap|up to|limit|max)\s*(?:of\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*([kKmM])?/i.exec(
    prompt,
  )
  const capFromTextCents = capMatch ? parsePositiveDollarCents(capMatch[0]) : null
  const safetyCapCents = capFromTextCents ?? options?.safetyCapCents ?? defaultCap

  let trigger: SopTriggerType = 'invoice_overdue'
  let action: SopActionKind = 'stage_collection_chase'
  let autonomyKey: CompiledSopRule['autonomy_action_key'] = 'send_invoice_reminder'
  let thresholdBps: number | null = null
  let thresholdCents: number | null = null
  let thresholdDays: number | null = null
  let conditionSummary = ''

  if (
    /(cashflow|cash\s*flow|runway|safety\s*floor|liquidity|cash\s+balance|projected\s+cash|working\s+capital)/i.test(
      normalized,
    ) ||
    (/\bcash\b/i.test(normalized) && !/\b(invoice|vendor|bill)\b/i.test(normalized))
  ) {
    trigger = 'cashflow_threshold'
    action = 'trigger_runway_protection'
    autonomyKey = 'flag_overdue_ar'
    const floorMatch = /(?:below|under|<|<=|floor|threshold)\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*([kKmM])?/i.exec(
      prompt,
    )
    thresholdCents =
      (floorMatch ? parsePositiveDollarCents(floorMatch[0]) : null) ??
      parsedDollarsCents ??
      1500000
    conditionSummary = `Trigger runway defense whenever 90-day projected cash falls below ${formatCents(thresholdCents)} (cap ${formatCents(safetyCapCents)})`
  } else if (/(vendor|bill|price|hike|spike|supplier|\bap\b|\bpo\b|overcharge|remit)/i.test(normalized)) {
    trigger = 'vendor_bill_received'
    action = 'freeze_bill_for_approval'
    autonomyKey = 'approve_clean_vendor_bill'
    thresholdBps = parsePercentBps(prompt) ?? 500
    conditionSummary = `Freeze vendor bills showing >= ${(thresholdBps / 100).toFixed(1)}% variance or price spike (cap ${formatCents(safetyCapCents)})`
  } else if (/(coi|contract|license|saas|renewal|expir|insurance|notice)/i.test(normalized)) {
    trigger = 'contract_expiring'
    action = 'stage_compliance_renewal_notice'
    autonomyKey = 'stage_compliance_notice'
    thresholdDays = parseDaysInt(prompt) ?? 30
    conditionSummary = `Stage counterparty renewal/cancellation notice within ${thresholdDays} day(s) of expiry (cap ${formatCents(safetyCapCents)})`
  } else {
    trigger = 'invoice_overdue'
    action = 'stage_collection_chase'
    autonomyKey = 'send_invoice_reminder'
    thresholdDays = parseDaysInt(prompt) ?? 3
    thresholdCents = parsedDollarsCents ?? 0
    conditionSummary = `Stage AR collection touch for invoices >= ${thresholdDays} day(s) past due >= ${formatCents(thresholdCents)} (cap ${formatCents(safetyCapCents)})`
  }

  return {
    name: options?.name?.trim() || deriveSopName(prompt, trigger),
    plain_english_prompt: prompt,
    rule: {
      trigger,
      action,
      autonomy_action_key: autonomyKey,
      threshold_bps: thresholdBps,
      threshold_cents: thresholdCents,
      threshold_days: thresholdDays,
      safety_cap_cents: Math.max(0, Math.trunc(safetyCapCents)),
      condition_summary: conditionSummary,
    },
  }
}

function diffUtcDays(laterIso: string, earlierIso: string): number {
  const a = Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((a - b) / 86_400_000)
}

/**
 * Pure read-only historical dry-run evaluating how many workspace records match
 * the compiled SOP AST and computing exact integer-cent Proof Cards.
 */
export function simulateCompiledSop(
  rule: CompiledSopRule,
  context: {
    sopName?: string
    plainEnglishPrompt?: string
    vendorBills?: readonly VendorBillRecord[]
    invoices?: readonly AutonomousInvoice[]
    complianceItems?: readonly ComplianceVaultItem[]
    startingCashCents?: number
    asOfDate?: string
  },
): SopSimulationResult {
  const asOfDate =
    context.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(context.asOfDate)
      ? context.asOfDate
      : new Date().toISOString().slice(0, 10)
  const sopName = context.sopName?.trim() || SOP_TRIGGER_LABELS[rule.trigger]
  const prompt = context.plainEnglishPrompt?.trim() || rule.condition_summary
  const cards: SopSimulationProofCard[] = []

  if (rule.trigger === 'vendor_bill_received') {
    const minBps = rule.threshold_bps ?? 500
    for (const bill of context.vendorBills ?? []) {
      if (bill.match_status === 'paid') continue
      const totalCents = Math.max(0, Math.trunc(bill.total_cents))
      const varianceCents = Math.max(0, Math.trunc(bill.match_variance_cents))
      const baselineCents = Math.max(1, totalCents - varianceCents)
      const billVarianceBps =
        varianceCents > 0 ? Math.round((varianceCents * 10000) / baselineCents) : 0
      const triggered =
        bill.match_status === 'exception_flagged' ||
        bill.match_status === 'disputed' ||
        billVarianceBps >= minBps
      if (!triggered) continue

      const impact = varianceCents > 0 ? varianceCents : totalCents
      const withinCap = impact <= rule.safety_cap_cents
      cards.push({
        record_id: bill.id,
        record_ref: bill.invoice_number,
        counterparty: bill.vendor_name,
        impact_cents: impact,
        within_safety_cap: withinCap,
        proof_summary:
          `Bill ${bill.invoice_number} (${bill.vendor_name}) variance ${formatCents(impact)} (${impact.toLocaleString('en-US')}c · ` +
          `${(billVarianceBps / 100).toFixed(1)}% vs ${(minBps / 100).toFixed(1)}% rule) -> ` +
          `${withinCap ? `Within safety cap (${formatCents(rule.safety_cap_cents)})` : `Exceeds ${formatCents(rule.safety_cap_cents)} cap — requires owner sign-off`}.`,
      })
    }
  } else if (rule.trigger === 'cashflow_threshold') {
    const floorCents = rule.threshold_cents ?? 1500000
    const startCash = context.startingCashCents ?? 2500000
    const projection = simulateCashflow90Day(
      startCash,
      context.invoices ?? [],
      context.vendorBills ?? [],
      { asOfDate, safetyBufferCents: floorCents },
    )
    for (const win of projection.windows) {
      if (!win.below_buffer) continue
      const shortfall = win.buffer_shortfall_cents
      const withinCap = shortfall <= rule.safety_cap_cents
      cards.push({
        record_id: `cash-win-${win.horizon_days}`,
        record_ref: `${win.horizon_days}D Runway`,
        counterparty: `Operating Cash (${win.window_end_date})`,
        impact_cents: shortfall,
        within_safety_cap: withinCap,
        proof_summary:
          `${win.label} projected ending cash ${formatCents(win.ending_balance_cents)} falls ${formatCents(shortfall)} (${shortfall.toLocaleString('en-US')}c) ` +
          `below ${formatCents(floorCents)} threshold.`,
      })
    }
  } else if (rule.trigger === 'contract_expiring') {
    const windowDays = rule.threshold_days ?? 30
    for (const item of context.complianceItems ?? []) {
      if (item.status === 'cancelled') continue
      const daysRemaining = diffUtcDays(item.expires_on, asOfDate)
      if (daysRemaining > windowDays) continue
      const impact = Math.max(0, item.annual_value_cents)
      const withinCap = impact <= rule.safety_cap_cents
      cards.push({
        record_id: item.id,
        record_ref: item.doc_type.toUpperCase(),
        counterparty: `${item.title} (${item.counterparty})`,
        impact_cents: impact,
        within_safety_cap: withinCap,
        proof_summary:
          `${item.title} expires ${item.expires_on} (${daysRemaining}d left <= ${windowDays}d trigger); ` +
          `annual value ${formatCents(impact)} (${impact.toLocaleString('en-US')}c).`,
      })
    }
  } else {
    const minDays = rule.threshold_days ?? 3
    const minCents = rule.threshold_cents ?? 0
    for (const inv of context.invoices ?? []) {
      if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'draft') continue
      const balance = Math.max(0, inv.total_cents - inv.amount_paid_cents)
      if (balance === 0 || balance < minCents) continue
      const daysPast = inv.due_date ? diffUtcDays(asOfDate, inv.due_date) : 0
      if (daysPast < minDays) continue
      const withinCap = balance <= rule.safety_cap_cents
      cards.push({
        record_id: inv.id,
        record_ref: inv.invoice_number,
        counterparty: inv.customer_name,
        impact_cents: balance,
        within_safety_cap: withinCap,
        proof_summary:
          `Invoice ${inv.invoice_number} (${inv.customer_name}) is ${daysPast}d past due (>= ${minDays}d) with ${formatCents(balance)} ` +
          `(${balance.toLocaleString('en-US')}c) open.`,
      })
    }
  }

  cards.sort((a, b) => b.impact_cents - a.impact_cents)

  const totalImpactCents = cards.reduce((sum, c) => sum + c.impact_cents, 0)
  const withinCapCards = cards.filter(c => c.within_safety_cap)
  const executableImpactCents = withinCapCards.reduce((sum, c) => sum + c.impact_cents, 0)

  return {
    rule,
    sop_name: sopName,
    plain_english_prompt: prompt,
    as_of_date: asOfDate,
    matched_count: cards.length,
    within_cap_count: withinCapCards.length,
    cap_exceeded_count: cards.length - withinCapCards.length,
    total_impact_cents: totalImpactCents,
    executable_impact_cents: executableImpactCents,
    proof_cards: cards,
    summary:
      cards.length === 0
        ? `Dry-run checked all workspace records: 0 anomalies matched rule (${rule.condition_summary}).`
        : `Dry-run matched ${cards.length} record(s) totaling ${formatCents(totalImpactCents)} (${withinCapCards.length} within ${formatCents(rule.safety_cap_cents)} safety cap).`,
  }
}

export function executeCompiledSop(params: {
  workspaceId: string
  sop: ExecutableSopRecord
  simulation: SopSimulationResult
  config?: WorkspaceAutonomyConfig
  nowIso?: string
}): SopExecutionResult {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const config = params.config ?? DEFAULT_AUTONOMY_CONFIG
  const cappedImpact = Math.min(
    params.simulation.total_impact_cents,
    params.sop.safety_cap_cents,
  )
  const decision = evaluateAutonomyGate(
    params.sop.compiled_rule_json.autonomy_action_key,
    cappedImpact,
    config,
  )

  const updatedSop: ExecutableSopRecord = {
    ...params.sop,
    status: 'active',
    last_simulated_impact_cents: params.simulation.total_impact_cents,
    run_count: params.sop.run_count + 1,
    updated_at: nowIso,
  }

  return {
    executable_sop: updatedSop,
    simulation: params.simulation,
    autonomy_decision: decision,
    ledger_draft: {
      workspace_id: params.workspaceId,
      agent_name: 'Operations Compiler Engine',
      module: 'sops',
      action_type: 'execute_compiled_sop',
      autonomy_mode: config.autonomy_rules[params.sop.compiled_rule_json.autonomy_action_key],
      summary: `Activated & ran SOP "${params.sop.name}" (${params.simulation.matched_count} match(es) · ${formatCents(params.simulation.total_impact_cents)})`,
      impact_cents: params.simulation.total_impact_cents,
      before_state: {
        executable_sop_id: params.sop.id,
        sop_status: params.sop.status,
        run_count: params.sop.run_count,
      },
      after_state: {
        executable_sop_id: params.sop.id,
        sop_status: 'active',
        run_count: updatedSop.run_count,
        trigger: params.sop.compiled_rule_json.trigger,
        safety_cap_cents: params.sop.safety_cap_cents,
      },
      status: 'executed',
      reversed_at: null,
    },
  }
}
