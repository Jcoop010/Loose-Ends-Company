import { formatCents } from './engine'
import { evaluateStockLevels } from './inventoryEngine'
import { compilePlainEnglishSop, SOP_TRIGGER_LABELS } from './sopCompiler'
import type {
  CommandResultItem,
  CommandRouteResult,
  CommandRouterSnapshot,
  ComplianceDeadlineItem,
  ComplianceEvaluationResult,
  ComplianceVaultItem,
  WhatIfCashflowResult,
  WhatIfCashflowWindow,
} from './types'

function assertSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer`)
  }
  return value
}

function assertSafeNonNegativeInt(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`)
  }
  return value
}

function diffDaysUtc(targetIso: string, referenceIso: string): number {
  const targetMs = Date.parse(`${targetIso.slice(0, 10)}T00:00:00Z`)
  const refMs = Date.parse(`${referenceIso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(targetMs) || !Number.isFinite(refMs)) {
    return 0
  }
  return Math.round((targetMs - refMs) / 86_400_000)
}

function subtractDaysIso(dateIso: string, days: number): string {
  const ms = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`)
  const safeMs = Number.isFinite(ms) ? ms : Date.now()
  return new Date(safeMs - Math.max(0, days) * 86_400_000).toISOString().slice(0, 10)
}

export function evaluateComplianceDeadlines(
  items: readonly ComplianceVaultItem[],
  referenceDate: string = new Date().toISOString().slice(0, 10),
): ComplianceEvaluationResult {
  const refDate = referenceDate.slice(0, 10)
  const evaluatedItems: ComplianceDeadlineItem[] = []
  const expiringItems: ComplianceDeadlineItem[] = []

  let activeDocsCount = 0
  let noticeStagedCount = 0
  let annualSpendProtectedCents = 0
  let annualSpendAtRiskCents = 0

  for (const item of items) {
    const noticeDays = assertSafeNonNegativeInt(
      item.notice_window_days,
      `${item.title}.notice_window_days`,
    )
    const annualValueCents = assertSafeNonNegativeInt(
      item.annual_value_cents,
      `${item.title}.annual_value_cents`,
    )

    const daysRemaining = diffDaysUtc(item.expires_on, refDate)
    const noticeDeadlineOn = subtractDaysIso(item.expires_on, noticeDays)
    const isExpired = daysRemaining < 0
    const withinNoticeWindow = daysRemaining <= noticeDays

    if (item.status === 'notice_staged') {
      noticeStagedCount += 1
    }
    if (item.status !== 'cancelled' && item.status !== 'expired' && !isExpired) {
      activeDocsCount += 1
    }
    if (item.status !== 'cancelled') {
      annualSpendProtectedCents += annualValueCents
    }

    const actionNeeded =
      item.status !== 'cancelled' &&
      item.status !== 'notice_staged' &&
      withinNoticeWindow

    if (actionNeeded) {
      annualSpendAtRiskCents += annualValueCents
    }

    const actionVerb =
      item.doc_type === 'coi' || item.doc_type === 'license'
        ? 'Renewal Verification'
        : 'Renewal / Non-Renewal Notice'

    const noticeDraft = {
      requires_approval: true as const,
      vault_item_id: item.id,
      doc_type: item.doc_type,
      counterparty: item.counterparty,
      subject: `${actionVerb}: ${item.title} (${item.counterparty} · expires ${item.expires_on})`,
      body_markdown: [
        `Hello ${item.counterparty} Account Team,`,
        ``,
        `This notice serves as formal communication regarding **${item.title}** (${item.doc_type.toUpperCase()}), scheduled to expire/renew on **${item.expires_on}** (required notice deadline: **${noticeDeadlineOn}**, ${noticeDays}-day notice window).`,
        ``,
        `- **Current Annual Commitment**: ${formatCents(annualValueCents)}`,
        `- **Status Window**: ${daysRemaining < 0 ? `${Math.abs(daysRemaining)} days past expiration` : `${daysRemaining} days remaining`}`,
        ``,
        `Please confirm updated renewal terms or acknowledge non-renewal prior to ${noticeDeadlineOn}.`,
      ].join('\n'),
      annual_value_cents: annualValueCents,
    }

    const entry: ComplianceDeadlineItem = {
      item,
      days_remaining: daysRemaining,
      notice_deadline_on: noticeDeadlineOn,
      within_notice_window: withinNoticeWindow,
      is_expired: isExpired,
      action_needed: actionNeeded,
      notice_draft: noticeDraft,
      ledger_draft: {
        workspace_id: item.workspace_id,
        agent_name: 'Compliance Vault Guardian',
        module: 'vault',
        action_type: 'stage_compliance_notice',
        autonomy_mode: 'approve_1tap',
        summary: `Staged ${actionVerb} for ${item.title} (${item.counterparty} · ${formatCents(annualValueCents)}/yr)`,
        impact_cents: annualValueCents,
        before_state: {
          vault_item_id: item.id,
          vault_status: item.status,
        },
        after_state: {
          vault_item_id: item.id,
          vault_status: 'notice_staged',
          expires_on: item.expires_on,
        },
        status: 'executed',
        reversed_at: null,
      },
    }

    evaluatedItems.push(entry)
    if (actionNeeded) {
      expiringItems.push(entry)
    }
  }

  evaluatedItems.sort((a, b) => a.days_remaining - b.days_remaining)
  expiringItems.sort((a, b) => a.days_remaining - b.days_remaining)

  return {
    reference_date: refDate,
    total_docs_count: items.length,
    active_docs_count: activeDocsCount,
    expiring_within_window_count: expiringItems.length,
    notice_staged_count: noticeStagedCount,
    annual_spend_protected_cents: annualSpendProtectedCents,
    annual_spend_at_risk_cents: annualSpendAtRiskCents,
    evaluated_items: evaluatedItems,
    expiring_items: expiringItems,
  }
}

export function simulateWhatIfCashflow(
  baselineCents: number,
  monthlyDeltaCents: number,
  oneTimeDeltaCents: number,
  horizonDays = 90,
  options?: {
    safetyBufferCents?: number
    baselineWindowOffsets?: { d30?: number; d60?: number; d90?: number }
  },
): WhatIfCashflowResult {
  const safeBaseline = assertSafeInteger(baselineCents, 'baselineCents')
  const safeMonthly = assertSafeInteger(monthlyDeltaCents, 'monthlyDeltaCents')
  const safeOneTime = assertSafeInteger(oneTimeDeltaCents, 'oneTimeDeltaCents')
  const safeHorizon = assertSafeNonNegativeInt(horizonDays, 'horizonDays')
  const safetyBuffer = assertSafeNonNegativeInt(
    options?.safetyBufferCents ?? 500000,
    'safetyBufferCents',
  )

  const offsets = options?.baselineWindowOffsets ?? {}
  const offsetMap: Record<30 | 60 | 90, number> = {
    30: assertSafeInteger(offsets.d30 ?? 0, 'baselineWindowOffsets.d30'),
    60: assertSafeInteger(offsets.d60 ?? offsets.d30 ?? 0, 'baselineWindowOffsets.d60'),
    90: assertSafeInteger(
      offsets.d90 ?? offsets.d60 ?? offsets.d30 ?? 0,
      'baselineWindowOffsets.d90',
    ),
  }

  let lowestSimulated = safeBaseline
  let firstBreachHorizon: 30 | 60 | 90 | null = null

  const windows = ([30, 60, 90] as const).map((horizon): WhatIfCashflowWindow => {
    const monthsElapsed = horizon / 30
    const baselineBalance = safeBaseline + offsetMap[horizon]
    const scenarioDelta = safeOneTime + safeMonthly * monthsElapsed
    const simulatedBalance = baselineBalance + scenarioDelta

    if (simulatedBalance < lowestSimulated) {
      lowestSimulated = simulatedBalance
    }

    const belowBuffer = simulatedBalance < safetyBuffer
    if (belowBuffer && firstBreachHorizon === null) {
      firstBreachHorizon = horizon
    }

    return {
      horizon_days: horizon,
      label: `${horizon} Days`,
      baseline_balance_cents: baselineBalance,
      scenario_delta_cents: scenarioDelta,
      simulated_balance_cents: simulatedBalance,
      below_buffer: belowBuffer,
      buffer_shortfall_cents: belowBuffer ? safetyBuffer - simulatedBalance : 0,
    }
  })

  const horizonMonths = Math.max(1, Math.round(safeHorizon / 30))
  const closestWindow =
    safeHorizon <= 30 ? windows[0] : safeHorizon <= 60 ? windows[1] : windows[2]
  const endBaseline =
    safeHorizon === 30 || safeHorizon === 60 || safeHorizon === 90
      ? closestWindow.baseline_balance_cents
      : safeBaseline
  const endDelta = safeOneTime + safeMonthly * horizonMonths
  const endSimulated = endBaseline + endDelta

  return {
    horizon_days: safeHorizon,
    baseline_cents: safeBaseline,
    monthly_delta_cents: safeMonthly,
    one_time_delta_cents: safeOneTime,
    safety_buffer_cents: safetyBuffer,
    end_of_horizon_baseline_cents: endBaseline,
    end_of_horizon_simulated_cents: endSimulated,
    net_variance_cents: endDelta,
    lowest_simulated_balance_cents: lowestSimulated,
    any_buffer_breach: firstBreachHorizon !== null,
    first_breach_horizon_days: firstBreachHorizon,
    windows: [windows[0], windows[1], windows[2]],
  }
}

function parseDollarThresholdCents(text: string): number {
  const match = /(?:over|above|>|>=|\$|at least)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text)
  if (!match) return 0
  const numeric = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return Math.round(numeric * 100)
}

function parseWhatIfCommandDeltas(text: string): {
  monthlyDeltaCents: number
  oneTimeDeltaCents: number
  summaryLabel: string
} {
  const countMatch =
    /\b(\d+)\s+(?:new\s+)?(?:staff|employees|hires|contractors|people|techs|seats|units|servers)\b/i.exec(
      text,
    )
  const quantity = countMatch ? Math.max(1, Math.trunc(Number(countMatch[1]))) : 1

  const amountMatch = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(text)
  const rawDollars = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0
  const unitCents =
    Number.isFinite(rawDollars) && rawDollars > 0 ? Math.round(rawDollars * 100) : 500000

  const isPositive =
    /\b(add\s+revenue|new\s+revenue|gain|increase\s+sales|inflow|retainer|save|cut\s+cost)\b/i.test(
      text,
    ) || /\+\s*\$/.test(text)
  const sign = isPositive ? 1 : -1

  const isMonthly =
    /\/mo\b|per\s*month|monthly|\ba\s+month\b/i.test(text) || Boolean(countMatch)

  const totalCents = sign * quantity * unitCents
  if (isMonthly) {
    return {
      monthlyDeltaCents: totalCents,
      oneTimeDeltaCents: 0,
      summaryLabel: `${quantity > 1 ? `${quantity} x ` : ''}${formatCents(Math.abs(unitCents))}/mo ${sign < 0 ? 'cost' : 'inflow'}`,
    }
  }
  return {
    monthlyDeltaCents: 0,
    oneTimeDeltaCents: totalCents,
    summaryLabel: `${formatCents(Math.abs(totalCents))} one-time ${sign < 0 ? 'spend' : 'inflow'}`,
  }
}

export function routeNaturalCommand(
  input: string,
  snapshot: CommandRouterSnapshot,
): CommandRouteResult {
  const raw = input.trim()
  const refDate = (snapshot.referenceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
  const normalized = raw.toLowerCase()

  // 1. Operations Compiler ("Automate: ...") direct Cmd+K routing
  if (/^automate\b|\bcompile\s+sop\b/i.test(normalized)) {
    const compiled = compilePlainEnglishSop(raw)
    return {
      intent: 'compile_sop',
      headline: `Compile Operational SOP: ${compiled.name}`,
      summary: compiled.rule.condition_summary,
      items: [
        {
          id: 'compile-sop-preview',
          title: `Trigger: ${SOP_TRIGGER_LABELS[compiled.rule.trigger]}`,
          subtitle: `Hard Safety Cap ${formatCents(compiled.rule.safety_cap_cents)} · Click to inspect AST, run historical dry-run & activate`,
          badge: compiled.rule.trigger,
          amount_cents: compiled.rule.safety_cap_cents,
          action: {
            label: 'Open Operations Compiler',
            kind: 'navigate',
            route: `/dashboard/sops?prompt=${encodeURIComponent(raw)}`,
          },
        },
      ],
      primary_action: {
        label: 'Compile & Dry-Run in SOPs',
        kind: 'navigate',
        route: `/dashboard/sops?prompt=${encodeURIComponent(raw)}`,
      },
      simulation: null,
    }
  }

  // 2. Undo last action
  if (/\b(undo|reverse|rollback)\b/i.test(normalized)) {
    const reversible = snapshot.ledgerEntries.filter(e => e.status === 'executed')
    const latest = reversible[0] ?? null
    if (!latest) {
      return {
        intent: 'undo_last_action',
        headline: 'No executed actions available to reverse',
        summary: 'Your Agent Action Ledger has no active executed actions eligible for 1-Click Undo.',
        items: [],
        primary_action: { label: 'Open Agent Ledger', kind: 'navigate', route: '/dashboard/autonomy' },
        simulation: null,
      }
    }

    return {
      intent: 'undo_last_action',
      headline: `Ready to reverse: ${latest.action_type}`,
      summary: latest.summary,
      items: [
        {
          id: latest.id,
          title: latest.summary,
          subtitle: `${latest.agent_name} · ${latest.module} · ${latest.created_at.slice(0, 16).replace('T', ' ')}`,
          badge: formatCents(latest.impact_cents),
          amount_cents: latest.impact_cents,
          action: {
            label: 'Undo Now',
            kind: 'undo_ledger',
            targetId: latest.id,
          },
        },
      ],
      primary_action: {
        label: '1-Click Undo Latest Action',
        kind: 'undo_ledger',
        targetId: latest.id,
      },
      simulation: null,
    }
  }

  // 2. What-If Cashflow Simulator queries
  if (
    /\b(simulate|what\s*-?if|scenario|hir(?:e|ing)|runway)\b/i.test(normalized) ||
    (/\/\s*mo\b/i.test(normalized) && /\$/.test(normalized))
  ) {
    const parsed = parseWhatIfCommandDeltas(raw)
    const simulation = simulateWhatIfCashflow(
      snapshot.baselineBalanceCents,
      parsed.monthlyDeltaCents,
      parsed.oneTimeDeltaCents,
      90,
      { safetyBufferCents: snapshot.safetyBufferCents ?? 500000 },
    )

    return {
      intent: 'what_if_simulation',
      headline: `90-Day What-If (${parsed.summaryLabel})`,
      summary: `End-of-90d balance shifts from ${formatCents(simulation.end_of_horizon_baseline_cents)} to ${formatCents(simulation.end_of_horizon_simulated_cents)} (net variance ${formatCents(simulation.net_variance_cents)})${simulation.any_buffer_breach ? ` · dips below buffer at Day ${simulation.first_breach_horizon_days}` : ''}.`,
      items: simulation.windows.map(win => ({
        id: `whatif-${win.horizon_days}`,
        title: `${win.label} Projected Balance: ${formatCents(win.simulated_balance_cents)}`,
        subtitle: `Baseline ${formatCents(win.baseline_balance_cents)} · Scenario delta ${formatCents(win.scenario_delta_cents)}`,
        badge: win.below_buffer
          ? `Buffer Shortfall ${formatCents(win.buffer_shortfall_cents)}`
          : 'Healthy Buffer',
        amount_cents: win.simulated_balance_cents,
      })),
      primary_action: {
        label: 'Open Interactive What-If Sliders',
        kind: 'open_what_if',
        monthlyDeltaCents: parsed.monthlyDeltaCents,
        oneTimeDeltaCents: parsed.oneTimeDeltaCents,
      },
      simulation,
    }
  }

  // 3. Overdue / Open Invoices
  if (/\b(invoice|invoices|ar|receivable|receivables|overdue)\b/i.test(normalized)) {
    const minCents = parseDollarThresholdCents(raw)
    const wantOverdueOnly = /\boverdue|past due|late\b/i.test(normalized)

    const matching = snapshot.invoices
      .filter(inv => {
        if (inv.status === 'paid' || inv.status === 'void') return false
        const balance = Math.max(0, inv.total_cents - inv.amount_paid_cents)
        if (balance <= 0 || balance < minCents) return false
        if (!wantOverdueOnly) return true
        return inv.status === 'overdue' || (inv.status === 'sent' && inv.due_date < refDate)
      })
      .sort((a, b) => (b.total_cents - b.amount_paid_cents) - (a.total_cents - a.amount_paid_cents))

    const totalBalance = matching.reduce(
      (sum, inv) => sum + Math.max(0, inv.total_cents - inv.amount_paid_cents),
      0,
    )

    return {
      intent: 'overdue_invoices',
      headline: `${matching.length} ${wantOverdueOnly ? 'Overdue' : 'Open'} Invoice(s)${minCents > 0 ? ` over ${formatCents(minCents)}` : ''}`,
      summary: `Total collectible balance: ${formatCents(totalBalance)} across ${matching.length} invoice(s).`,
      items: matching.slice(0, 8).map(inv => {
        const balance = Math.max(0, inv.total_cents - inv.amount_paid_cents)
        return {
          id: inv.id,
          title: `${inv.invoice_number} — ${inv.customer_name}`,
          subtitle: `${inv.title} · Due ${inv.due_date}`,
          badge: formatCents(balance),
          amount_cents: balance,
          action: {
            label: 'Open AR',
            kind: 'navigate',
            route: '/dashboard/invoices',
          },
        }
      }),
      primary_action: {
        label: 'View Invoices & AR',
        kind: 'navigate',
        route: '/dashboard/invoices',
      },
      simulation: null,
    }
  }

  // 4. Low Stock SKUs
  if (/\b(low\s*stock|reorder|shortage|stock|sku|skus|inventory)\b/i.test(normalized)) {
    const stockEval = evaluateStockLevels(snapshot.inventoryItems, undefined, {
      todayIso: refDate,
    })

    return {
      intent: 'low_stock_skus',
      headline: `${stockEval.total_low_stock_count} Low-Stock SKU(s) Below Reorder Point`,
      summary: `Estimated replenishment spend: ${formatCents(stockEval.total_reorder_cost_cents)} across ${stockEval.auto_po_drafts.length} supplier PO group(s).`,
      items: stockEval.low_stock_items.slice(0, 8).map(sku => ({
        id: sku.item_id,
        title: `${sku.sku} — ${sku.name}`,
        subtitle: `Avail ${sku.available_qty} vs Reorder Pt ${sku.reorder_point_qty} · Vendor: ${sku.preferred_vendor}`,
        badge: `Order ${sku.reorder_qty}`,
        amount_cents: sku.reorder_qty * sku.unit_cost_cents,
        action: {
          label: 'Restock',
          kind: 'navigate',
          route: '/dashboard/inventory',
        },
      })),
      primary_action: {
        label: 'Open Inventory & Procurement',
        kind: 'navigate',
        route: '/dashboard/inventory',
      },
      simulation: null,
    }
  }

  // 5. Expiring Contracts / Compliance Vault
  if (/\b(expir|contract|contracts|coi|compliance|vault|license|renewal|lease)\b/i.test(normalized)) {
    const evalVault = evaluateComplianceDeadlines(snapshot.complianceItems, refDate)
    const rows =
      evalVault.expiring_items.length > 0 ? evalVault.expiring_items : evalVault.evaluated_items

    return {
      intent: 'expiring_compliance',
      headline: `${evalVault.expiring_within_window_count} Compliance Doc(s) Within Notice Window`,
      summary: `${formatCents(evalVault.annual_spend_at_risk_cents)} annual spend entering notice window out of ${formatCents(evalVault.annual_spend_protected_cents)} tracked.`,
      items: rows.slice(0, 8).map(entry => ({
        id: entry.item.id,
        title: `${entry.item.title} (${entry.item.counterparty})`,
        subtitle: `${entry.item.doc_type.toUpperCase()} · Expires ${entry.item.expires_on} (${entry.days_remaining}d remaining)`,
        badge: formatCents(entry.item.annual_value_cents),
        amount_cents: entry.item.annual_value_cents,
        action: {
          label: 'Review in Vault',
          kind: 'navigate',
          route: '/dashboard/vault',
        },
      })),
      primary_action: {
        label: 'Open Compliance Vault',
        kind: 'navigate',
        route: '/dashboard/vault',
      },
      simulation: null,
    }
  }

  // 6. Living SOPs
  if (/\b(sop|sops|playbook|playbooks|procedure|procedures)\b/i.test(normalized)) {
    return {
      intent: 'living_sops',
      headline: `${snapshot.sops.length} Living Operational SOP(s)`,
      summary: 'Versioned, auto-compiled operational playbooks across CRM, Quotes, Inventory, Bookkeeping, and Compliance.',
      items: snapshot.sops.slice(0, 8).map(sop => ({
        id: sop.id,
        title: `${sop.title} (v${sop.version})`,
        subtitle: `${sop.module_key.toUpperCase()} · Trigger: ${sop.trigger_event} (${sop.steps_json.length} steps)`,
        badge: `v${sop.version}`,
        action: {
          label: 'Open Playbook',
          kind: 'navigate',
          route: '/dashboard/sops',
        },
      })),
      primary_action: {
        label: 'Open Living SOPs',
        kind: 'navigate',
        route: '/dashboard/sops',
      },
      simulation: null,
    }
  }

  // 7. Default Command Suggestions & Matching Routes
  const suggestions: CommandResultItem[] = [
    {
      id: 'sug-overdue',
      title: 'overdue invoices over $1000',
      subtitle: 'Filter open/overdue receivables above any dollar threshold',
      badge: 'AR',
      action: { label: 'Run', kind: 'run_command', commandText: 'overdue invoices over $1000' },
    },
    {
      id: 'sug-low-stock',
      title: 'low stock skus',
      subtitle: 'Identify inventory below reorder point with supplier PO totals',
      badge: 'Inventory',
      action: { label: 'Run', kind: 'run_command', commandText: 'low stock skus' },
    },
    {
      id: 'sug-expiring',
      title: 'expiring contracts',
      subtitle: 'Surface COIs, SaaS contracts & leases inside notice window',
      badge: 'Vault',
      action: { label: 'Run', kind: 'run_command', commandText: 'expiring contracts' },
    },
    {
      id: 'sug-whatif',
      title: 'simulate hiring 2 staff at $5000/mo',
      subtitle: 'Run 30/60/90-day What-If runway forecast in integer cents',
      badge: 'What-If',
      action: {
        label: 'Simulate',
        kind: 'run_command',
        commandText: 'simulate hiring 2 staff at $5000/mo',
      },
    },
    {
      id: 'sug-undo',
      title: 'undo last action',
      subtitle: 'Immediately reverse the latest executed Agent Ledger action',
      badge: '1-Click Undo',
      action: { label: 'Stage Undo', kind: 'run_command', commandText: 'undo last action' },
    },
  ]

  return {
    intent: 'quick_jump',
    headline: raw ? `Command Suggestions for "${raw}"` : 'Plain-English Operational Command Router',
    summary: 'Try any natural command below or jump directly to a workspace.',
    items: suggestions,
    primary_action: null,
    simulation: null,
  }
}
