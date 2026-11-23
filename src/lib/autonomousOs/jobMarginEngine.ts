import { formatCents } from './engine'
import type {
  EvaluatedJobMargin,
  JobChangeOrderPlan,
  JobMarginPortfolioSummary,
  JobMarginRecord,
  JobMarginStatus,
  WorkspaceEntityType,
} from './types'

export const JOB_MARGIN_STATUS_LABELS: Readonly<Record<JobMarginStatus, string>> = {
  healthy: 'Healthy Margin',
  margin_warning: 'Margin Below Target',
  over_budget: 'Over Budget (Negative)',
}

export const ENTITY_TYPE_LABELS: Readonly<Record<WorkspaceEntityType, string>> = {
  llc: 'LLC',
  scorp: 'S-Corp',
  ccorp: 'C-Corp',
  sole_prop: 'Sole Prop',
}

export function filterByEntityId<T extends { entity_id?: string | null }>(
  rows: readonly T[],
  activeEntityId: string | null | undefined,
): T[] {
  if (!activeEntityId || activeEntityId === 'consolidated' || activeEntityId === 'primary') {
    return [...rows]
  }
  return rows.filter(row => row.entity_id === activeEntityId)
}

/**
 * Evaluates a job's real-time profitability in pure integer cents & basis points:
 * `net_margin_cents = quoted_revenue_cents - (material_po_cents + vendor_bill_cents + labor_cents)`.
 */
export function evaluateJobMargin(record: JobMarginRecord): EvaluatedJobMargin {
  const quoted = Math.max(0, Math.trunc(record.quoted_revenue_cents))
  const material = Math.max(0, Math.trunc(record.material_po_cents))
  const bills = Math.max(0, Math.trunc(record.vendor_bill_cents))
  const labor = Math.max(0, Math.trunc(record.labor_cents))
  const targetBps = Math.min(9999, Math.max(0, Math.trunc(record.target_margin_bps || 3000)))

  const totalCostCents = material + bills + labor
  const netMarginCents = quoted - totalCostCents
  const actualMarginBps = quoted > 0 ? Math.round((netMarginCents * 10000) / quoted) : 0
  const marginDeltaBps = actualMarginBps - targetBps

  const computedStatus: JobMarginStatus =
    netMarginCents < 0
      ? 'over_budget'
      : actualMarginBps < targetBps
        ? 'margin_warning'
        : 'healthy'

  let suggestedChangeOrderCents = 0
  if (computedStatus !== 'healthy' && totalCostCents > 0) {
    const requiredRevenueCents = Math.ceil((totalCostCents * 10000) / (10000 - targetBps))
    suggestedChangeOrderCents = Math.max(0, requiredRevenueCents - quoted)
  }

  const changeOrderDraft =
    suggestedChangeOrderCents > 0
      ? `Change Order for ${record.job_name} (${record.client_name}): add ${formatCents(suggestedChangeOrderCents)} ` +
        `(${suggestedChangeOrderCents.toLocaleString('en-US')}c) due to material & vendor cost creep ` +
        `(${formatCents(totalCostCents)} actual vs ${formatCents(quoted)} quoted) to restore ` +
        `${(targetBps / 100).toFixed(1)}% target gross margin.`
      : `Job ${record.job_name} meets or exceeds ${(targetBps / 100).toFixed(1)}% margin target.`

  return {
    job: record,
    total_cost_cents: totalCostCents,
    net_margin_cents: netMarginCents,
    actual_margin_bps: actualMarginBps,
    target_margin_bps: targetBps,
    margin_delta_bps: marginDeltaBps,
    computed_status: computedStatus,
    suggested_change_order_cents: suggestedChangeOrderCents,
    change_order_draft: changeOrderDraft,
  }
}

export function evaluateJobMarginPortfolio(
  records: readonly JobMarginRecord[],
  activeEntityId?: string | null,
): JobMarginPortfolioSummary {
  const scoped = filterByEntityId(records, activeEntityId)
  const evaluated = scoped.map(evaluateJobMargin)

  let healthyCount = 0
  let warningCount = 0
  let overBudgetCount = 0
  let totalQuotedCents = 0
  let totalCostCents = 0

  for (const item of evaluated) {
    totalQuotedCents += Math.max(0, Math.trunc(item.job.quoted_revenue_cents))
    totalCostCents += item.total_cost_cents
    if (item.computed_status === 'over_budget') overBudgetCount += 1
    else if (item.computed_status === 'margin_warning') warningCount += 1
    else healthyCount += 1
  }

  const totalNetMarginCents = totalQuotedCents - totalCostCents
  const weightedMarginBps =
    totalQuotedCents > 0 ? Math.round((totalNetMarginCents * 10000) / totalQuotedCents) : 0

  return {
    job_count: evaluated.length,
    healthy_count: healthyCount,
    warning_count: warningCount,
    over_budget_count: overBudgetCount,
    total_quoted_cents: totalQuotedCents,
    total_cost_cents: totalCostCents,
    total_net_margin_cents: totalNetMarginCents,
    weighted_margin_bps: weightedMarginBps,
    evaluated_jobs: evaluated,
  }
}

export function buildDraftChangeOrderPlan(params: {
  workspaceId: string
  job: JobMarginRecord
  nowIso?: string
}): JobChangeOrderPlan {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const evaluated = evaluateJobMargin(params.job)
  const deltaCents = evaluated.suggested_change_order_cents
  const nextQuotedCents = Math.max(0, params.job.quoted_revenue_cents + deltaCents)

  const afterEval = evaluateJobMargin({
    ...params.job,
    quoted_revenue_cents: nextQuotedCents,
  })

  const updatedJob: JobMarginRecord = {
    ...params.job,
    quoted_revenue_cents: nextQuotedCents,
    status: afterEval.computed_status,
    updated_at: nowIso,
  }

  return {
    updated_job: updatedJob,
    change_order_cents: deltaCents,
    ledger_draft: {
      workspace_id: params.workspaceId,
      agent_name: 'Live Job Margin Guard',
      module: 'dispatch',
      action_type: 'draft_job_change_order',
      autonomy_mode: 'approve_1tap',
      summary: `Applied +${formatCents(deltaCents)} change order on ${params.job.job_name} (${(evaluated.actual_margin_bps / 100).toFixed(1)}% -> ${(afterEval.actual_margin_bps / 100).toFixed(1)}%)`,
      impact_cents: deltaCents,
      before_state: {
        job_margin_id: params.job.id,
        quoted_revenue_cents: params.job.quoted_revenue_cents,
        status: params.job.status,
      },
      after_state: {
        job_margin_id: params.job.id,
        quoted_revenue_cents: nextQuotedCents,
        status: updatedJob.status,
      },
      status: 'executed',
      reversed_at: null,
    },
  }
}
