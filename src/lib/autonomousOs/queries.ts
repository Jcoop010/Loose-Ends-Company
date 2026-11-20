import { opsCommand, createIdempotencyKey } from '../opsCommand'
import { fetchAllWorkspaceRows } from '../queries'
import { assertSupabaseConfigured, supabase } from '../supabase'
import {
  calculateLineTotals,
  convertSignedQuoteToInvoice,
  evaluateAutonomyGate,
  formatCents,
  generatePortalToken,
  normalizeAutonomyConfig,
  reverseLedgerAction,
} from './engine'
import type {
  AgentActionLedgerEntry,
  AutonomousInvoice,
  AutonomousInvoiceItem,
  AutonomousQuote,
  AutonomousQuoteItem,
  LineItemInput,
  PublicQuotePortalData,
  WorkspaceAutonomyConfig,
} from './types'

export interface PublicLeadOption {
  id: string
  business: string | null
  company_name?: string | null
  contact_name: string | null
  contact_email: string | null
  industry: string | null
  status: string
}

export async function fetchWorkspaceAutonomySettings(
  workspaceId: string,
): Promise<WorkspaceAutonomyConfig> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('workspace_settings')
    .select('workspace_id, modules_enabled, autonomy_rules, auto_limit_cents')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) throw error
  return normalizeAutonomyConfig(
    (data as {
      modules_enabled?: Partial<WorkspaceAutonomyConfig['modules_enabled']> | null
      autonomy_rules?: Partial<WorkspaceAutonomyConfig['autonomy_rules']> | null
      auto_limit_cents?: number | null
    } | null) ?? null,
  )
}

export async function saveWorkspaceAutonomySettings(
  workspaceId: string,
  config: WorkspaceAutonomyConfig,
): Promise<WorkspaceAutonomyConfig> {
  assertSupabaseConfigured()
  const payload = {
    workspace_id: workspaceId,
    modules_enabled: config.modules_enabled,
    autonomy_rules: config.autonomy_rules,
    auto_limit_cents: config.auto_limit_cents,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('workspace_settings')
    .upsert(payload, { onConflict: 'workspace_id' })
    .select('modules_enabled, autonomy_rules, auto_limit_cents')
    .single()

  if (error) throw error
  return normalizeAutonomyConfig(
    data as {
      modules_enabled?: Partial<WorkspaceAutonomyConfig['modules_enabled']> | null
      autonomy_rules?: Partial<WorkspaceAutonomyConfig['autonomy_rules']> | null
      auto_limit_cents?: number | null
    },
  )
}

export async function fetchWorkspacePublicLeads(
  workspaceId: string,
): Promise<PublicLeadOption[]> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('public_leads')
    .select('id, business, company_name, contact_name, contact_email, industry, status')
    .eq('workspace_id', workspaceId)
    .order('score', { ascending: false })
    .limit(50)

  if (error) throw error
  return (data ?? []) as PublicLeadOption[]
}

export async function fetchQuotesAndItems(workspaceId: string): Promise<{
  quotes: AutonomousQuote[]
  itemsByQuote: ReadonlyMap<string, AutonomousQuoteItem[]>
}> {
  const [quotes, items] = await Promise.all([
    fetchAllWorkspaceRows<AutonomousQuote>({
      table: 'quotes',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<AutonomousQuoteItem>({
      table: 'quote_items',
      workspaceId,
      orderBy: 'position',
      ascending: true,
    }),
  ])

  const map = new Map<string, AutonomousQuoteItem[]>()
  for (const item of items ?? []) {
    const existing = map.get(item.quote_id)
    if (existing) {
      existing.push(item)
    } else {
      map.set(item.quote_id, [item])
    }
  }
  return {
    quotes: quotes ?? [],
    itemsByQuote: map,
  }
}

export async function createQuoteWithItems(params: {
  workspaceId: string
  title: string
  customerName: string
  customerEmail?: string
  leadId?: string | null
  customerId?: string | null
  taxBps: number
  validUntil?: string | null
  notes?: string | null
  items: readonly LineItemInput[]
  markSent?: boolean
}): Promise<{ quote: AutonomousQuote; items: AutonomousQuoteItem[] }> {
  assertSupabaseConfigured()
  const totals = calculateLineTotals(params.items, params.taxBps)
  const portalToken = generatePortalToken()
  const quoteNumber = `QTE-${portalToken.slice(4, 10).toUpperCase()}`

  const { data: quoteData, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      workspace_id: params.workspaceId,
      lead_id: params.leadId || null,
      customer_id: params.customerId || null,
      quote_number: quoteNumber,
      title: params.title.trim(),
      customer_name: params.customerName.trim(),
      customer_email: params.customerEmail?.trim() || null,
      subtotal_cents: totals.subtotal_cents,
      tax_bps: totals.tax_bps,
      tax_cents: totals.tax_cents,
      total_cents: totals.total_cents,
      status: params.markSent ? 'sent' : 'draft',
      portal_token: portalToken,
      valid_until: params.validUntil || null,
      notes: params.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (quoteErr || !quoteData) {
    throw quoteErr ?? new Error('Unable to create quote.')
  }
  const quote = quoteData as AutonomousQuote

  const itemPayloads = totals.items.map(item => ({
    workspace_id: params.workspaceId,
    quote_id: quote.id,
    position: item.position,
    description: item.description,
    quantity: item.quantity,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: item.line_total_cents,
  }))

  const { data: itemsData, error: itemsErr } = await supabase
    .from('quote_items')
    .insert(itemPayloads)
    .select('*')

  if (itemsErr) throw itemsErr

  return {
    quote,
    items: (itemsData ?? []) as AutonomousQuoteItem[],
  }
}

export async function markQuoteSentInDb(
  workspaceId: string,
  quoteId: string,
): Promise<AutonomousQuote> {
  assertSupabaseConfigured()
  const { data, error } = await supabase
    .from('quotes')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', quoteId)
    .eq('status', 'draft')
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to mark quote as sent.')
  }
  return data as AutonomousQuote
}

export async function convertSignedQuoteToInvoiceInDb(params: {
  workspaceId: string
  quote: AutonomousQuote
  items: readonly AutonomousQuoteItem[]
  config: WorkspaceAutonomyConfig
}): Promise<{ invoice: AutonomousInvoice | null; ledgerEntry: AgentActionLedgerEntry }> {
  assertSupabaseConfigured()
  const { workspaceId, quote, items, config } = params

  const decision = evaluateAutonomyGate(
    'convert_signed_quote_to_invoice',
    quote.total_cents,
    config,
  )

  const draftPayload = convertSignedQuoteToInvoice(quote, items, {
    autonomyMode: config.autonomy_rules.convert_signed_quote_to_invoice,
    statusOverride: decision === 'queue_for_approval' ? 'pending_approval' : 'executed',
  })

  if (decision === 'queue_for_approval') {
    const { data: queuedLedger, error: queueErr } = await supabase
      .from('agent_action_ledger')
      .insert({
        workspace_id: workspaceId,
        agent_name: draftPayload.ledgerEntry.agent_name,
        module: draftPayload.ledgerEntry.module,
        action_type: draftPayload.ledgerEntry.action_type,
        autonomy_mode: draftPayload.ledgerEntry.autonomy_mode,
        summary: `Queued invoice conversion for signed quote ${quote.quote_number} (${formatCents(quote.total_cents)})`,
        impact_cents: draftPayload.ledgerEntry.impact_cents,
        before_state: { quote_id: quote.id, quote_status: quote.status, invoice_id: null },
        after_state: { quote_id: quote.id, pending_action: 'create_invoice', total_cents: quote.total_cents },
        status: 'pending_approval',
      })
      .select('*')
      .single()

    if (queueErr || !queuedLedger) {
      throw queueErr ?? new Error('Unable to queue invoice conversion for approval.')
    }
    return {
      invoice: null,
      ledgerEntry: queuedLedger as AgentActionLedgerEntry,
    }
  }

  const { data: invData, error: invErr } = await supabase
    .from('invoices')
    .insert({
      workspace_id: workspaceId,
      quote_id: quote.id,
      lead_id: quote.lead_id,
      customer_id: quote.customer_id,
      invoice_number: draftPayload.invoice.invoice_number,
      title: draftPayload.invoice.title,
      customer_name: draftPayload.invoice.customer_name,
      customer_email: draftPayload.invoice.customer_email,
      subtotal_cents: draftPayload.invoice.subtotal_cents,
      tax_bps: draftPayload.invoice.tax_bps,
      tax_cents: draftPayload.invoice.tax_cents,
      total_cents: draftPayload.invoice.total_cents,
      amount_paid_cents: 0,
      due_date: draftPayload.invoice.due_date,
      status: 'sent',
    })
    .select('*')
    .single()

  if (invErr || !invData) {
    throw invErr ?? new Error('Unable to create invoice from quote.')
  }
  const invoice = invData as AutonomousInvoice

  const invItemPayloads = draftPayload.invoiceItems.map(item => ({
    workspace_id: workspaceId,
    invoice_id: invoice.id,
    position: item.position,
    description: item.description,
    quantity: item.quantity,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: item.line_total_cents,
  }))

  const { error: invItemsErr } = await supabase.from('invoice_items').insert(invItemPayloads)
  if (invItemsErr) throw invItemsErr

  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      workspace_id: workspaceId,
      agent_name: draftPayload.ledgerEntry.agent_name,
      module: draftPayload.ledgerEntry.module,
      action_type: draftPayload.ledgerEntry.action_type,
      autonomy_mode: config.autonomy_rules.convert_signed_quote_to_invoice,
      summary: `Converted signed quote ${quote.quote_number} into invoice ${invoice.invoice_number} (${quote.customer_name})`,
      impact_cents: invoice.total_cents,
      before_state: { quote_id: quote.id, quote_status: 'signed', invoice_id: null },
      after_state: {
        quote_id: quote.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_status: invoice.status,
        total_cents: invoice.total_cents,
      },
      status: 'executed',
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerData) {
    throw ledgerErr ?? new Error('Invoice created, but agent ledger logging failed.')
  }

  return {
    invoice,
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
  }
}

export async function fetchInvoicesAndItems(workspaceId: string): Promise<{
  invoices: AutonomousInvoice[]
  itemsByInvoice: ReadonlyMap<string, AutonomousInvoiceItem[]>
}> {
  const [invoices, items] = await Promise.all([
    fetchAllWorkspaceRows<AutonomousInvoice>({
      table: 'invoices',
      workspaceId,
      orderBy: 'created_at',
      ascending: false,
    }),
    fetchAllWorkspaceRows<AutonomousInvoiceItem>({
      table: 'invoice_items',
      workspaceId,
      orderBy: 'position',
      ascending: true,
    }),
  ])

  const map = new Map<string, AutonomousInvoiceItem[]>()
  for (const item of items ?? []) {
    const list = map.get(item.invoice_id)
    if (list) {
      list.push(item)
    } else {
      map.set(item.invoice_id, [item])
    }
  }

  return {
    invoices: invoices ?? [],
    itemsByInvoice: map,
  }
}

export async function markInvoicePaidInDb(params: {
  workspaceId: string
  invoice: AutonomousInvoice
}): Promise<AutonomousInvoice> {
  assertSupabaseConfigured()
  const { workspaceId, invoice } = params
  const { data, error } = await supabase
    .from('invoices')
    .update({
      amount_paid_cents: invoice.total_cents,
      status: 'paid',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', invoice.id)
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to mark invoice paid.')
  }

  await supabase.from('agent_action_ledger').insert({
    workspace_id: workspaceId,
    agent_name: 'AR Collections Agent',
    module: 'billing',
    action_type: 'mark_invoice_paid',
    autonomy_mode: 'manual',
    summary: `Recorded full payment on invoice ${invoice.invoice_number} (${formatCents(invoice.total_cents)})`,
    impact_cents: invoice.total_cents,
    before_state: {
      invoice_id: invoice.id,
      invoice_status: invoice.status,
      amount_paid_cents: invoice.amount_paid_cents,
    },
    after_state: {
      invoice_id: invoice.id,
      invoice_status: 'paid',
      amount_paid_cents: invoice.total_cents,
    },
    status: 'executed',
  })

  return data as AutonomousInvoice
}

export async function stageCollectionNudgeInDb(params: {
  workspaceId: string
  invoice: AutonomousInvoice
  config: WorkspaceAutonomyConfig
}): Promise<{ ledgerEntry: AgentActionLedgerEntry; queuedDraft: boolean }> {
  assertSupabaseConfigured()
  const { workspaceId, invoice, config } = params

  const balanceCents = Math.max(0, invoice.total_cents - invoice.amount_paid_cents)
  const decision = evaluateAutonomyGate('send_invoice_reminder', balanceCents, config)
  const mode = config.autonomy_rules.send_invoice_reminder
  const subject = `Friendly reminder: Invoice ${invoice.invoice_number} (${formatCents(balanceCents)} open)`
  const message = `Hi ${invoice.customer_name},\n\nQuick reminder regarding invoice ${invoice.invoice_number} for "${invoice.title}" (${formatCents(balanceCents)}, due ${invoice.due_date}). Please let us know if you need another copy or payment link.\n\nReply STOP to opt out.`

  let queuedDraft = false
  if (invoice.customer_id && decision === 'execute_now') {
    await opsCommand(
      workspaceId,
      'draft_save',
      {
        customer_id: invoice.customer_id,
        channel: 'email',
        subject,
        message,
      },
      createIdempotencyKey(),
    )
    queuedDraft = true
  }

  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('agent_action_ledger')
    .insert({
      workspace_id: workspaceId,
      agent_name: 'AR Collections Agent',
      module: 'billing',
      action_type: 'send_invoice_reminder',
      autonomy_mode: mode,
      summary: `Staged collection nudge for ${invoice.invoice_number} (${invoice.customer_name} · ${formatCents(balanceCents)})`,
      impact_cents: balanceCents,
      before_state: {
        invoice_id: invoice.id,
        invoice_status: invoice.status,
        nudge_staged: false,
      },
      after_state: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        subject,
        queued_draft: queuedDraft,
      },
      status: decision === 'execute_now' ? 'executed' : 'pending_approval',
    })
    .select('*')
    .single()

  if (ledgerErr || !ledgerData) {
    throw ledgerErr ?? new Error('Unable to log collection nudge in agent ledger.')
  }

  return {
    ledgerEntry: ledgerData as AgentActionLedgerEntry,
    queuedDraft,
  }
}

export async function fetchAgentActionLedger(
  workspaceId: string,
): Promise<AgentActionLedgerEntry[]> {
  const rows = await fetchAllWorkspaceRows<AgentActionLedgerEntry>({
    table: 'agent_action_ledger',
    workspaceId,
    orderBy: 'created_at',
    ascending: false,
  })
  return rows ?? []
}

export async function approvePendingLedgerEntryInDb(params: {
  workspaceId: string
  entry: AgentActionLedgerEntry
  config: WorkspaceAutonomyConfig
}): Promise<AgentActionLedgerEntry> {
  assertSupabaseConfigured()
  const { workspaceId, entry, config } = params
  if (entry.status !== 'pending_approval') {
    throw new Error('Only pending actions can be approved.')
  }

  const after = entry.after_state ?? {}
  if (
    entry.action_type === 'convert_signed_quote_to_invoice' &&
    typeof after.quote_id === 'string' &&
    !after.invoice_id
  ) {
    const [{ data: qData, error: qErr }, { data: qiData, error: qiErr }] = await Promise.all([
      supabase
        .from('quotes')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', after.quote_id)
        .single(),
      supabase
        .from('quote_items')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('quote_id', after.quote_id)
        .order('position', { ascending: true }),
    ])

    if (qErr || !qData) {
      throw qErr ?? new Error('Linked quote could not be found.')
    }
    if (qiErr) throw qiErr

    const quote = qData as AutonomousQuote
    const items = (qiData ?? []) as AutonomousQuoteItem[]
    const fullAutoConfig: WorkspaceAutonomyConfig = {
      ...config,
      autonomy_rules: {
        ...config.autonomy_rules,
        convert_signed_quote_to_invoice: 'full_auto',
      },
      auto_limit_cents: Math.max(config.auto_limit_cents, quote.total_cents),
    }
    const { invoice } = await convertSignedQuoteToInvoiceInDb({
      workspaceId,
      quote,
      items,
      config: fullAutoConfig,
    })

    const { data: updated, error: updErr } = await supabase
      .from('agent_action_ledger')
      .update({
        status: 'executed',
        after_state: {
          ...after,
          invoice_id: invoice?.id ?? null,
          invoice_number: invoice?.invoice_number ?? null,
        },
      })
      .eq('workspace_id', workspaceId)
      .eq('id', entry.id)
      .select('*')
      .single()

    if (updErr || !updated) {
      throw updErr ?? new Error('Unable to mark ledger entry executed.')
    }
    return updated as AgentActionLedgerEntry
  }

  const { data: updated, error: updErr } = await supabase
    .from('agent_action_ledger')
    .update({ status: 'executed' })
    .eq('workspace_id', workspaceId)
    .eq('id', entry.id)
    .select('*')
    .single()

  if (updErr || !updated) {
    throw updErr ?? new Error('Unable to approve ledger entry.')
  }
  return updated as AgentActionLedgerEntry
}

export async function reverseLedgerEntryInDb(params: {
  workspaceId: string
  entry: AgentActionLedgerEntry
}): Promise<AgentActionLedgerEntry> {
  assertSupabaseConfigured()
  const { workspaceId, entry } = params
  const { updatedEntry, restoredState } = reverseLedgerAction(entry)

  const after = entry.after_state ?? {}
  if (typeof after.invoice_id === 'string' && after.invoice_id) {
    await supabase
      .from('invoices')
      .update({ status: 'void', updated_at: updatedEntry.reversed_at })
      .eq('workspace_id', workspaceId)
      .eq('id', after.invoice_id)
  }

  if (
    entry.action_type === 'mark_invoice_paid' &&
    typeof after.invoice_id === 'string' &&
    restoredState &&
    typeof restoredState.invoice_status === 'string'
  ) {
    const prevPaid =
      typeof restoredState.amount_paid_cents === 'number' ? restoredState.amount_paid_cents : 0
    await supabase
      .from('invoices')
      .update({
        status: restoredState.invoice_status,
        amount_paid_cents: prevPaid,
        updated_at: updatedEntry.reversed_at,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', after.invoice_id)
  }

  if (entry.action_type === 'stage_auto_po' && typeof after.po_id === 'string' && after.po_id) {
    await supabase
      .from('purchase_orders')
      .update({ status: 'closed', updated_at: updatedEntry.reversed_at })
      .eq('workspace_id', workspaceId)
      .eq('id', after.po_id)
  }

  if (
    (entry.action_type === 'approve_vendor_bill' ||
      entry.action_type === 'dispute_vendor_bill' ||
      entry.action_type === 'mark_vendor_bill_paid') &&
    typeof after.bill_id === 'string' &&
    restoredState &&
    typeof restoredState.bill_match_status === 'string'
  ) {
    await supabase
      .from('vendor_bills')
      .update({
        match_status: restoredState.bill_match_status,
        updated_at: updatedEntry.reversed_at,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', after.bill_id)
  }

  const { data, error } = await supabase
    .from('agent_action_ledger')
    .update({
      status: 'reversed',
      reversed_at: updatedEntry.reversed_at,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', entry.id)
    .eq('status', 'executed')
    .select('*')
    .single()

  if (error || !data) {
    throw error ?? new Error('Unable to reverse agent ledger action.')
  }
  return data as AgentActionLedgerEntry
}

export async function fetchPublicQuotePortal(
  portalToken: string,
): Promise<PublicQuotePortalData | null> {
  assertSupabaseConfigured()
  const { data, error } = await supabase.rpc('get_public_quote_portal', {
    p_portal_token: portalToken.trim(),
  })
  if (error) throw error
  return (data as PublicQuotePortalData | null) ?? null
}

export async function signPublicQuotePortal(
  portalToken: string,
  signerName: string,
): Promise<PublicQuotePortalData> {
  assertSupabaseConfigured()
  const { data, error } = await supabase.rpc('sign_public_quote_portal', {
    p_portal_token: portalToken.trim(),
    p_signer_name: signerName.trim(),
  })
  if (error) throw error
  if (!data) {
    throw new Error('Quote portal could not be updated.')
  }
  return data as PublicQuotePortalData
}
