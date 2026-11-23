import { buildTextContentHashSync } from './documentParser'
import { formatCents } from './engine'
import { runThreeWayMatch } from './inventoryEngine'
import { scanVendorBillsForFraud } from './vendorFraudEngine'
import type {
  GoodsReceiptLineItem,
  InboundBillCaptureEvaluation,
  InboundBillCaptureRecord,
  InboundBillMatchStatus,
  InboundBillPostPlan,
  ParsedInboundBillPayload,
  PurchaseOrderItemRecord,
  VendorBillFraudInput,
  VendorBillLineItem,
} from './types'

export const INBOUND_BILL_STATUS_LABELS: Readonly<Record<InboundBillMatchStatus, string>> = {
  '3way_matched': '3-Way Matched (PO = GRN = Bill)',
  fraud_frozen: 'Fraud Frozen (>10% Spike / Dup)',
  needs_review: 'Needs Review',
  posted: 'Posted to GL',
}

export const SAMPLE_INBOUND_BILL_CLEAN_TEXT = [
  'Vendor: Apex Industrial Supply',
  'Invoice: VB-9040',
  'PO: PO-2026-1104',
  'Due: 2026-12-08',
  'COIL-10 | Evaporator Replacement Coil | Qty 4 | $160.00',
  'Total: $640.00',
].join('\n')

export const SAMPLE_INBOUND_BILL_SPIKE_TEXT = [
  'Vendor: Titan Mechanical Supply',
  'Invoice: VB-9048',
  'PO: PO-2026-1109',
  'Due: 2026-12-10',
  'Remit: ACH-9988',
  'VALVE-42 | Brass Control Valve Batch | Qty 50 | $56.00',
  'Total: $2,800.00',
].join('\n')

export function buildWorkspaceBillCaptureAddress(slugOrName: string | null | undefined): string {
  const cleaned = (slugOrName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `bills@${cleaned || 'workspace'}.looseendsos.app`
}

function parseDollarCentsStrict(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '').trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(cleaned)) return null
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num < 0) return null
  const cents = Math.round(num * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

/**
 * Pure deterministic extractor turning inbound PDF/email bill text into exact
 * integer-cent line items and structured metadata (zero external LLM calls).
 */
export function parseInboundBillText(
  rawText: string,
  options?: { asOfDate?: string; fileName?: string },
): ParsedInboundBillPayload {
  const text = rawText.trim()
  const asOfDate =
    options?.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate)
      ? options.asOfDate
      : new Date().toISOString().slice(0, 10)

  const headerValue = (label: RegExp): string | null => {
    for (const line of text.split(/\r?\n/)) {
      const m = label.exec(line.trim())
      if (m && m[1]?.trim()) return m[1].trim()
    }
    return null
  }

  const vendorName =
    headerValue(/^(?:vendor|supplier|from)\s*:\s*(.+)$/i) ?? 'Inbound Vendor Capture'
  const invoiceNumber =
    headerValue(/^(?:invoice(?:\s*#|number|no)?|inv|bill(?:\s*#)?)?\s*:\s*([A-Za-z0-9._/-]+)$/i) ??
    (/invoice[:#\s]+([A-Za-z0-9-]{3,})/i.exec(text)?.[1] ?? 'VB-INBOUND-01')
  const poReference =
    headerValue(/^(?:po(?:\s*#|reference|number)?|purchase\s*order)\s*:\s*(.+)$/i) ??
    (/\b(PO-[A-Za-z0-9-]+)\b/i.exec(text)?.[1] ?? null)
  const rawDue = headerValue(/^(?:due(?:\s*date)?)\s*:\s*(\d{4}-\d{2}-\d{2})$/i)
  const remitHint = headerValue(/^(?:remit(?:\s*account)?|ach)\s*:\s*(.+)$/i)

  const lineItems: VendorBillLineItem[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    // Match pipe-delimited format: SKU | Description | Qty 50 | $56.00
    const pipeMatch =
      /^([A-Za-z0-9._-]+)\s*\|\s*([^|]+)\|\s*(?:qty\s*)?(\d+)\s*\|\s*(\$?[\d,]+(?:\.\d{1,2})?)/i.exec(
        line,
      )
    if (pipeMatch) {
      const unitCents = parseDollarCentsStrict(pipeMatch[4])
      const qty = Math.max(1, Math.trunc(Number(pipeMatch[3])))
      if (unitCents !== null) {
        lineItems.push({
          sku: pipeMatch[1].trim().toUpperCase(),
          description: pipeMatch[2].trim(),
          quantity: qty,
          unit_cost_cents: unitCents,
        })
      }
      continue
    }

    // Match comma-delimited format: SKU, Description, 50, 56.00
    const csvMatch =
      /^([A-Za-z0-9._-]+)\s*,\s*([^,]+),\s*(\d+)\s*,\s*(\$?[\d,]+(?:\.\d{1,2})?)$/i.exec(line)
    if (csvMatch) {
      const unitCents = parseDollarCentsStrict(csvMatch[4])
      const qty = Math.max(1, Math.trunc(Number(csvMatch[3])))
      if (unitCents !== null) {
        lineItems.push({
          sku: csvMatch[1].trim().toUpperCase(),
          description: csvMatch[2].trim(),
          quantity: qty,
          unit_cost_cents: unitCents,
        })
      }
    }
  }

  let extractedTotalCents = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_cost_cents,
    0,
  )

  if (extractedTotalCents === 0) {
    const totalMatch = /(?:total|amount\s*due|balance)\s*[:=]\s*(\$?[\d,]+(?:\.\d{1,2})?)/i.exec(
      text,
    )
    const parsedTotal = totalMatch ? parseDollarCentsStrict(totalMatch[1]) : null
    if (parsedTotal !== null) {
      extractedTotalCents = parsedTotal
    }
  }

  const hasExplicitVendor = vendorName !== 'Inbound Vendor Capture'
  const hasExplicitInv = !invoiceNumber.startsWith('VB-') || /invoice\s*(?:#|no|num)?/i.test(text)
  const extractionConfidenceBps =
    lineItems.length > 0 && extractedTotalCents > 0
      ? 10000
      : extractedTotalCents > 0 && hasExplicitVendor
        ? 8500
        : extractedTotalCents > 0
          ? 6500
          : hasExplicitVendor || hasExplicitInv
            ? 3500
            : 0

  return {
    vendor_name: vendorName,
    invoice_number: invoiceNumber,
    po_reference: poReference,
    due_date: rawDue ?? asOfDate,
    remit_account_hint: remitHint,
    line_items: lineItems,
    extracted_total_cents: extractedTotalCents,
    extraction_confidence_bps: extractionConfidenceBps,
  }
}

/**
 * Parses an inbound vendor bill capture, executes PO === GRN === Bill 3-Way Match,
 * and pipes anomalies straight through `scanVendorBillsForFraud` (auto-freezing
 * >10% unit price spikes, exact-cent duplicates <=7d, or unverified remit changes).
 */
export function processInboundBillCapture(params: {
  workspaceId: string
  entityId?: string | null
  sourceAddress: string
  fileName: string
  rawText: string
  poItems?: readonly (
    | PurchaseOrderItemRecord
    | Pick<PurchaseOrderItemRecord, 'sku' | 'ordered_qty' | 'unit_cost_cents'>
  )[]
  receiptItems?: readonly GoodsReceiptLineItem[]
  existingBills?: readonly VendorBillFraudInput[]
  priorUnitCostsBySku?: ReadonlyMap<string, number> | Readonly<Record<string, number>>
  knownRemitByVendor?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  asOfDate?: string
}): InboundBillCaptureEvaluation {
  const asOfDate =
    params.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)
      ? params.asOfDate
      : new Date().toISOString().slice(0, 10)

  const parsed = parseInboundBillText(params.rawText, {
    asOfDate,
    fileName: params.fileName,
  })

  const candidateBillId = `ibc_bill_${parsed.invoice_number.replace(/[^A-Za-z0-9]/g, '_').toLowerCase()}`
  const existingNumbers = (params.existingBills ?? []).map(b => b.invoice_number)

  let threeWayMatch = null
  if (
    params.poItems &&
    params.poItems.length > 0 &&
    params.receiptItems &&
    params.receiptItems.length > 0 &&
    parsed.line_items.length > 0
  ) {
    const billSkus = new Set(parsed.line_items.map(l => l.sku.trim().toUpperCase()))
    const normalizedPoRef = parsed.po_reference?.trim().toUpperCase() ?? null
    const poMatchedByRef =
      normalizedPoRef !== null
        ? params.poItems.filter(
            item => 'po_id' in item && item.po_id.trim().toUpperCase() === normalizedPoRef,
          )
        : []
    const poMatchedBySku = params.poItems.filter(item =>
      billSkus.has(item.sku.trim().toUpperCase()),
    )
    const scopedPoItems =
      poMatchedByRef.length > 0
        ? poMatchedByRef
        : poMatchedBySku.length > 0
          ? poMatchedBySku
          : params.poItems

    const relevantSkus = new Set([
      ...billSkus,
      ...scopedPoItems.map(item => item.sku.trim().toUpperCase()),
    ])
    const scopedReceiptItems = params.receiptItems.filter(r =>
      relevantSkus.has(r.sku.trim().toUpperCase()),
    )

    threeWayMatch = runThreeWayMatch(
      scopedPoItems,
      scopedReceiptItems,
      parsed.line_items,
      200,
      {
        poNumber: parsed.po_reference ?? undefined,
        vendorName: parsed.vendor_name,
        invoiceNumber: parsed.invoice_number,
        existingInvoiceNumbers: existingNumbers,
      },
    )
  }

  const derivedPriorUnitCosts = new Map<string, number>()
  if (params.priorUnitCostsBySku instanceof Map) {
    for (const [k, v] of params.priorUnitCostsBySku.entries()) {
      derivedPriorUnitCosts.set(k.trim().toUpperCase(), v)
    }
  } else if (params.priorUnitCostsBySku) {
    for (const [k, v] of Object.entries(params.priorUnitCostsBySku)) {
      derivedPriorUnitCosts.set(k.trim().toUpperCase(), v)
    }
  }
  for (const poLine of params.poItems ?? []) {
    const key = poLine.sku.trim().toUpperCase()
    if (!derivedPriorUnitCosts.has(key) && poLine.unit_cost_cents > 0) {
      derivedPriorUnitCosts.set(key, poLine.unit_cost_cents)
    }
  }

  const billInput: VendorBillFraudInput = {
    id: candidateBillId,
    workspace_id: params.workspaceId,
    po_id: parsed.po_reference,
    vendor_name: parsed.vendor_name,
    invoice_number: parsed.invoice_number,
    subtotal_cents: parsed.extracted_total_cents,
    tax_cents: 0,
    total_cents: parsed.extracted_total_cents,
    due_date: parsed.due_date,
    items_json: parsed.line_items,
    match_status:
      threeWayMatch && threeWayMatch.match_status !== 'matched_clean'
        ? 'exception_flagged'
        : 'matched_clean',
    match_variance_cents: threeWayMatch ? Math.abs(threeWayMatch.match_variance_cents) : 0,
    discrepancy_summary: threeWayMatch?.discrepancy_summary ?? null,
    remit_account_hint: parsed.remit_account_hint,
    created_at: `${asOfDate}T09:00:00Z`,
  }

  const scanResult = scanVendorBillsForFraud({
    workspaceId: params.workspaceId,
    bills: [...(params.existingBills ?? []), billInput],
    priorUnitCostsBySku: derivedPriorUnitCosts,
    knownRemitByVendor: params.knownRemitByVendor,
    asOfDate,
  })

  const billAlerts = scanResult.alerts.filter(a => a.bill_id === candidateBillId)

  let matchStatus: InboundBillMatchStatus = 'needs_review'
  let proofSummary = `Extracted ${formatCents(parsed.extracted_total_cents)} (${parsed.extracted_total_cents.toLocaleString('en-US')}c) from ${params.fileName}; awaiting PO baseline verification.`

  if (billAlerts.length > 0) {
    matchStatus = 'fraud_frozen'
    proofSummary = billAlerts.map(a => a.proof_summary).join(' | ')
  } else if (threeWayMatch) {
    if (threeWayMatch.match_status === 'matched_clean') {
      matchStatus = '3way_matched'
      proofSummary =
        `3-Way Match Verified: PO ${parsed.po_reference ?? 'matched'} === GRN === Bill ${parsed.invoice_number} ` +
        `at ${formatCents(parsed.extracted_total_cents)} (${parsed.extracted_total_cents.toLocaleString('en-US')}c, $0.00 variance).`
    } else {
      matchStatus = 'needs_review'
      proofSummary =
        threeWayMatch.discrepancy_summary ||
        `3-Way variance ${formatCents(Math.abs(threeWayMatch.match_variance_cents))} detected on ${parsed.invoice_number}.`
    }
  }

  return {
    parsed,
    capture_draft: {
      workspace_id: params.workspaceId,
      entity_id: params.entityId ?? null,
      source_address: params.sourceAddress,
      file_name: params.fileName,
      vendor_name: parsed.vendor_name,
      extracted_total_cents: parsed.extracted_total_cents,
      po_reference: parsed.po_reference,
      match_status: matchStatus,
      proof_summary: proofSummary,
      content_hash: buildTextContentHashSync(`${params.fileName}|${params.rawText}`),
      extraction_method: 'plain_text',
      extraction_confidence_bps: parsed.extraction_confidence_bps ?? 0,
      human_verified: false,
    },
    fraud_alerts: billAlerts,
    three_way_match: threeWayMatch,
  }
}

export function buildPostCapturedBillPlan(params: {
  workspaceId: string
  capture: InboundBillCaptureRecord
  nowIso?: string
  requireHumanVerified?: boolean
  humanVerified?: boolean
}): InboundBillPostPlan {
  if (params.capture.match_status === 'fraud_frozen') {
    throw new Error('Cannot post a fraud-frozen bill capture until Vendor Fraud Shield clears it.')
  }
  if (params.capture.match_status === 'posted') {
    throw new Error('Inbound bill capture has already been posted to the AP Ledger.')
  }
  const verified = Boolean(params.humanVerified || params.capture.human_verified)
  if (params.requireHumanVerified && !verified) {
    throw new Error('Human verification of extracted vendor, PO, and total is required before GL posting.')
  }
  const nowIso = params.nowIso ?? new Date().toISOString()
  const updatedCapture: InboundBillCaptureRecord = {
    ...params.capture,
    match_status: 'posted',
    human_verified: verified,
    updated_at: nowIso,
  }

  return {
    updated_capture: updatedCapture,
    ledger_entry_draft: {
      workspace_id: params.workspaceId,
      entity_id: params.capture.entity_id ?? null,
      entry_type: 'cogs',
      category: 'Inbound AP Capture',
      description: `Posted ${params.capture.file_name} (${params.capture.vendor_name}${
        params.capture.po_reference ? ` · ${params.capture.po_reference}` : ''
      })`,
      amount_cents: Math.max(0, Math.trunc(params.capture.extracted_total_cents)),
      occurred_on: nowIso.slice(0, 10),
      source_ref: params.capture.po_reference ?? params.capture.file_name,
    },
    agent_ledger_draft: {
      workspace_id: params.workspaceId,
      agent_name: 'Inbox-to-Ledger Engine',
      module: 'bookkeeping',
      action_type: 'post_inbound_bill_capture',
      autonomy_mode: 'approve_1tap',
      summary: `Posted inbound capture ${params.capture.file_name} (${params.capture.vendor_name} · ${formatCents(params.capture.extracted_total_cents)}) to AP Ledger`,
      impact_cents: params.capture.extracted_total_cents,
      before_state: {
        capture_id: params.capture.id,
        previous_match_status: params.capture.match_status,
      },
      after_state: {
        capture_id: params.capture.id,
        next_match_status: 'posted',
      },
      status: 'executed',
      reversed_at: null,
    },
  }
}
