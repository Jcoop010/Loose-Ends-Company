import {
  DEFAULT_AUTO_LIMIT_CENTS,
  DEFAULT_AUTONOMY_RULES,
  DEFAULT_MODULES_ENABLED,
  type AgentActionLedgerEntry,
  type ArSummaryMetrics,
  type AutonomyActionKey,
  type AutonomyGateDecision,
  type AutonomyMode,
  type AutonomyRulesMap,
  type AutonomousInvoice,
  type AutonomousInvoiceItem,
  type AutonomousQuote,
  type AutonomousQuoteItem,
  type CalculatedLineItem,
  type LineItemInput,
  type LineTotalsResult,
  type WorkspaceAutonomyConfig,
  type WorkspaceModuleKey,
  type WorkspaceModulesEnabled,
} from './types'

function assertSafeNonNegativeInt(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer in cents`)
  }
  return value
}

function cloneJsonRecord(
  input: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!input) return null
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>
}

export function isValidAutonomyMode(value: unknown): value is AutonomyMode {
  return value === 'manual' || value === 'approve_1tap' || value === 'full_auto'
}

export function normalizeModulesEnabled(
  raw?: Partial<Record<WorkspaceModuleKey, unknown>> | null,
): WorkspaceModulesEnabled {
  const base: WorkspaceModulesEnabled = { ...DEFAULT_MODULES_ENABLED }
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const keys: WorkspaceModuleKey[] = [
    'crm',
    'quotes',
    'billing',
    'inventory',
    'bookkeeping',
    'projects',
    'vault',
  ]
  for (const key of keys) {
    if (typeof raw[key] === 'boolean') {
      base[key] = raw[key] as boolean
    }
  }
  return base
}

export function normalizeAutonomyRules(
  raw?: Partial<Record<AutonomyActionKey, unknown>> | null,
): AutonomyRulesMap {
  const base: AutonomyRulesMap = { ...DEFAULT_AUTONOMY_RULES }
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const keys: AutonomyActionKey[] = [
    'send_quote_followup',
    'convert_signed_quote_to_invoice',
    'send_invoice_reminder',
    'flag_overdue_ar',
    'stage_auto_po',
    'approve_clean_vendor_bill',
  ]
  for (const key of keys) {
    if (isValidAutonomyMode(raw[key])) {
      base[key] = raw[key] as AutonomyMode
    }
  }
  return base
}

export function normalizeAutonomyConfig(settings?: {
  modules_enabled?: Partial<Record<WorkspaceModuleKey, unknown>> | null
  autonomy_rules?: Partial<Record<AutonomyActionKey, unknown>> | null
  auto_limit_cents?: number | null
} | null): WorkspaceAutonomyConfig {
  const limitRaw = settings?.auto_limit_cents
  const autoLimitCents =
    typeof limitRaw === 'number' && Number.isSafeInteger(limitRaw) && limitRaw >= 0
      ? limitRaw
      : DEFAULT_AUTO_LIMIT_CENTS

  return {
    modules_enabled: normalizeModulesEnabled(settings?.modules_enabled),
    autonomy_rules: normalizeAutonomyRules(settings?.autonomy_rules),
    auto_limit_cents: autoLimitCents,
  }
}

export function calculateLineTotals(
  rawItems: readonly LineItemInput[],
  taxBps = 0,
): LineTotalsResult {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('At least one line item is required')
  }
  if (!Number.isSafeInteger(taxBps) || taxBps < 0 || taxBps > 5000) {
    throw new Error('taxBps must be a safe integer between 0 and 5000 (0% to 50%)')
  }

  const items: CalculatedLineItem[] = []
  let subtotalCents = 0

  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index]
    const description = String(raw.description ?? '').trim()
    if (!description) {
      throw new Error(`Line item #${index + 1} description is required`)
    }
    if (!Number.isSafeInteger(raw.quantity) || raw.quantity < 1) {
      throw new Error(`Line item #${index + 1} quantity must be a positive safe integer`)
    }
    const unitPriceCents = assertSafeNonNegativeInt(
      raw.unit_price_cents,
      `Line item #${index + 1} unit_price_cents`,
    )
    const lineTotalCents = assertSafeNonNegativeInt(
      raw.quantity * unitPriceCents,
      `Line item #${index + 1} line_total_cents`,
    )

    subtotalCents = assertSafeNonNegativeInt(subtotalCents + lineTotalCents, 'subtotal_cents')
    items.push({
      id: raw.id,
      position: index,
      description,
      quantity: raw.quantity,
      unit_price_cents: unitPriceCents,
      line_total_cents: lineTotalCents,
    })
  }

  // Exact integer half-up tax calculation in basis points (10000 bps = 100%)
  const taxCents = assertSafeNonNegativeInt(
    Math.floor((subtotalCents * taxBps + 5000) / 10000),
    'tax_cents',
  )
  const totalCents = assertSafeNonNegativeInt(subtotalCents + taxCents, 'total_cents')

  return {
    items,
    subtotal_cents: subtotalCents,
    tax_bps: taxBps,
    tax_cents: taxCents,
    total_cents: totalCents,
  }
}

export function evaluateAutonomyGate(
  actionKey: AutonomyActionKey,
  amountCents: number,
  rulesOrConfig: AutonomyRulesMap | WorkspaceAutonomyConfig,
  explicitLimitCents?: number,
): AutonomyGateDecision {
  const safeAmount = assertSafeNonNegativeInt(amountCents, 'amountCents')

  const rules: AutonomyRulesMap =
    'autonomy_rules' in rulesOrConfig ? rulesOrConfig.autonomy_rules : rulesOrConfig
  const limitCentsRaw =
    explicitLimitCents !== undefined
      ? explicitLimitCents
      : 'auto_limit_cents' in rulesOrConfig
        ? rulesOrConfig.auto_limit_cents
        : DEFAULT_AUTO_LIMIT_CENTS
  const safeLimit = assertSafeNonNegativeInt(limitCentsRaw, 'autoLimitCents')

  const mode = rules[actionKey] ?? 'approve_1tap'
  if (mode === 'manual') {
    return 'manual_only'
  }
  if (mode === 'approve_1tap') {
    return 'queue_for_approval'
  }
  return safeAmount <= safeLimit ? 'execute_now' : 'queue_for_approval'
}

export function convertSignedQuoteToInvoice(
  quote: AutonomousQuote,
  items: readonly Pick<
    AutonomousQuoteItem,
    'description' | 'quantity' | 'unit_price_cents' | 'line_total_cents' | 'position'
  >[],
  options?: {
    invoiceId?: string
    invoiceNumber?: string
    ledgerId?: string
    nowIso?: string
    dueDate?: string
    autonomyMode?: AutonomyMode
    statusOverride?: 'executed' | 'pending_approval'
    stripeCheckoutUrl?: string | null
  },
): {
  invoice: AutonomousInvoice
  invoiceItems: AutonomousInvoiceItem[]
  ledgerEntry: AgentActionLedgerEntry
} {
  if (quote.status !== 'signed') {
    throw new Error(`Cannot convert quote ${quote.quote_number}: status is "${quote.status}", expected "signed"`)
  }

  const orderedItems = [...items].sort((a, b) => a.position - b.position)
  const recomputed = calculateLineTotals(
    orderedItems.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
    })),
    quote.tax_bps,
  )

  const nowIso = options?.nowIso ?? new Date().toISOString()
  const baseTime = Date.parse(nowIso) || Date.now()
  const dueDate =
    options?.dueDate ??
    new Date(baseTime + 14 * 86_400_000).toISOString().slice(0, 10)
  const suffix = quote.quote_number.replace(/^QTE-/i, '') || quote.id.slice(0, 6).toUpperCase()
  const invoiceId = options?.invoiceId ?? `inv_${quote.id}`
  const invoiceNumber = options?.invoiceNumber ?? `INV-${suffix}`
  const autonomyMode = options?.autonomyMode ?? 'full_auto'
  const ledgerStatus = options?.statusOverride ?? 'executed'

  const invoice: AutonomousInvoice = {
    id: invoiceId,
    workspace_id: quote.workspace_id,
    quote_id: quote.id,
    lead_id: quote.lead_id,
    customer_id: quote.customer_id,
    invoice_number: invoiceNumber,
    title: quote.title,
    customer_name: quote.customer_name,
    customer_email: quote.customer_email,
    subtotal_cents: recomputed.subtotal_cents,
    tax_bps: recomputed.tax_bps,
    tax_cents: recomputed.tax_cents,
    total_cents: recomputed.total_cents,
    amount_paid_cents: 0,
    due_date: dueDate,
    stripe_checkout_url: options?.stripeCheckoutUrl ?? null,
    status: 'sent',
    created_at: nowIso,
    updated_at: nowIso,
  }

  const invoiceItems: AutonomousInvoiceItem[] = recomputed.items.map((item, idx) => ({
    id: `${invoiceId}_item_${idx + 1}`,
    workspace_id: quote.workspace_id,
    invoice_id: invoiceId,
    position: item.position,
    description: item.description,
    quantity: item.quantity,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: item.line_total_cents,
    created_at: nowIso,
  }))

  const ledgerEntry: AgentActionLedgerEntry = {
    id: options?.ledgerId ?? `led_${invoiceId}`,
    workspace_id: quote.workspace_id,
    agent_name: 'Revenue-to-Cash Agent',
    module: 'quotes',
    action_type: 'convert_signed_quote_to_invoice',
    autonomy_mode: autonomyMode,
    summary: `Converted signed quote ${quote.quote_number} into invoice ${invoiceNumber} (${quote.customer_name})`,
    impact_cents: recomputed.total_cents,
    before_state: {
      quote_id: quote.id,
      quote_status: quote.status,
      invoice_id: null,
    },
    after_state: {
      quote_id: quote.id,
      quote_status: 'signed',
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      invoice_status: invoice.status,
      total_cents: recomputed.total_cents,
    },
    status: ledgerStatus,
    reversed_at: null,
    created_at: nowIso,
  }

  return {
    invoice,
    invoiceItems,
    ledgerEntry,
  }
}

export function reverseLedgerAction(
  entry: AgentActionLedgerEntry,
  nowIso = new Date().toISOString(),
): {
  updatedEntry: AgentActionLedgerEntry
  restoredState: Record<string, unknown> | null
} {
  if (entry.status !== 'executed') {
    throw new Error(`Only executed ledger actions can be reversed (current status: "${entry.status}")`)
  }

  return {
    updatedEntry: {
      ...entry,
      status: 'reversed',
      reversed_at: nowIso,
    },
    restoredState: cloneJsonRecord(entry.before_state),
  }
}

export function generatePortalToken(): string {
  const bytes = new Uint8Array(12)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `qpt_${hex}`
}

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0
  const sign = safe < 0 ? '-' : ''
  const absDollars = Math.abs(safe) / 100
  return `${sign}$${absDollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function computeArSummary(
  invoices: readonly AutonomousInvoice[],
  todayIso = new Date().toISOString().slice(0, 10),
): ArSummaryMetrics {
  let totalBilledCents = 0
  let totalCollectedCents = 0
  let openArCents = 0
  let overdueArCents = 0
  let openCount = 0
  let overdueCount = 0
  let paidCount = 0

  for (const inv of invoices) {
    if (inv.status === 'void') continue

    const total = Number.isSafeInteger(inv.total_cents) ? Math.max(0, inv.total_cents) : 0
    const paid = Number.isSafeInteger(inv.amount_paid_cents)
      ? Math.min(total, Math.max(0, inv.amount_paid_cents))
      : 0

    totalBilledCents += total

    if (inv.status === 'paid') {
      totalCollectedCents += Math.max(paid, total)
      paidCount += 1
      continue
    }

    totalCollectedCents += paid
    const balance = Math.max(0, total - paid)
    openArCents += balance
    openCount += 1

    const isPastDue =
      inv.status === 'overdue' || (inv.status === 'sent' && inv.due_date < todayIso)
    if (isPastDue && balance > 0) {
      overdueArCents += balance
      overdueCount += 1
    }
  }

  return {
    totalBilledCents,
    totalCollectedCents,
    openArCents,
    overdueArCents,
    openCount,
    overdueCount,
    paidCount,
  }
}
