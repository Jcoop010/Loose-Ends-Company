import { formatCents } from './engine'
import type {
  AutonomousInvoice,
  BankFeedDirection,
  BankFeedSource,
  BankFeedStatus,
  BankFeedTransactionRecord,
  BankReconcileCommitPlan,
  BankReconciliationResult,
  ParsedBankTransactionInput,
  VendorBillRecord,
} from './types'

export const BANK_FEED_STATUS_LABELS: Readonly<Record<BankFeedStatus, string>> = {
  unmatched: 'Unmatched',
  auto_matched: 'Auto-Matched (Ready)',
  reconciled: 'Reconciled',
  excluded: 'Excluded',
}

export const BANK_FEED_SOURCE_LABELS: Readonly<Record<BankFeedSource, string>> = {
  plaid_webhook: 'Plaid Webhook',
  ofx_qbo: 'OFX / QBO File',
  bank_csv: 'Bank CSV',
}

export const SAMPLE_BANK_FEED_CSV = [
  'date,merchant,amount,direction',
  '2026-11-18,Cedar Point Urgent Care,1850.00,inflow',
  '2026-11-18,Apex Industrial Supply,640.00,outflow',
  '2026-11-19,Blue Ridge Property Group,950.00,inflow',
].join('\n')

export const SAMPLE_PLAID_WEBHOOK_JSON = JSON.stringify(
  {
    source: 'plaid_webhook',
    transactions: [
      {
        transaction_id: 'plaid_tx_1',
        date: '2026-11-18',
        merchant_name: 'Cedar Point Urgent Care',
        amount: -1850.0,
      },
      {
        transaction_id: 'plaid_tx_2',
        date: '2026-11-18',
        merchant_name: 'Apex Industrial Supply',
        amount: 640.0,
      },
    ],
  },
  null,
  2,
)

function normalizeTextTokens(raw: string): Set<string> {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
  return new Set(words)
}

function hasCounterpartyOverlap(a: string, b: string): boolean {
  const setA = normalizeTextTokens(a)
  const setB = normalizeTextTokens(b)
  for (const token of setA) {
    if (setB.has(token)) return true
  }
  return false
}

function diffUtcDays(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${isoB.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 30
  return Math.abs(Math.round((a - b) / 86_400_000))
}

function parseIsoDateFlexible(raw: string, fallback: string): string {
  const clean = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
  // OFX format YYYYMMDD...
  const ofx = /^(\d{4})(\d{2})(\d{2})/.exec(clean)
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`
  return fallback
}

function parseCsvRowCells(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function toCentsSigned(raw: string): number | null {
  const clean = raw.replace(/[$,\s]/g, '').trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(clean)) return null
  const num = Number(clean)
  if (!Number.isFinite(num)) return null
  const cents = Math.round(num * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

/**
 * Pure deterministic parser for OFX/QBO `<STMTTRN>` XML/SGML, Plaid webhook JSON payloads,
 * or standard Bank CSV exports in exact integer cents.
 */
export function parseBankFeedPayload(
  rawInput: string,
  source: BankFeedSource,
  fallbackDate = new Date().toISOString().slice(0, 10),
): ParsedBankTransactionInput[] {
  const trimmed = rawInput.trim()
  if (!trimmed) return []

  if (source === 'plaid_webhook') {
    const parsed: unknown = JSON.parse(trimmed)
    const rawList: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { transactions?: unknown[] }).transactions)
        ? ((parsed as { transactions: unknown[] }).transactions ?? [])
        : []

    const results: ParsedBankTransactionInput[] = []
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue
      const rec = item as {
        date?: unknown
        posted_date?: unknown
        merchant_name?: unknown
        name?: unknown
        amount?: unknown
        amount_cents?: unknown
        direction?: unknown
      }
      const merchant =
        (typeof rec.merchant_name === 'string' && rec.merchant_name.trim()) ||
        (typeof rec.name === 'string' && rec.name.trim()) ||
        'Bank Transaction'
      const postedDate = parseIsoDateFlexible(
        typeof rec.date === 'string'
          ? rec.date
          : typeof rec.posted_date === 'string'
            ? rec.posted_date
            : fallbackDate,
        fallbackDate,
      )

      let cents = 0
      let direction: BankFeedDirection = 'outflow'

      if (typeof rec.amount_cents === 'number' && Number.isSafeInteger(rec.amount_cents)) {
        cents = Math.abs(rec.amount_cents)
        direction =
          rec.direction === 'inflow' || rec.direction === 'outflow'
            ? rec.direction
            : rec.amount_cents < 0
              ? 'outflow'
              : 'inflow'
      } else if (typeof rec.amount === 'number' && Number.isFinite(rec.amount)) {
        // Plaid standard: negative amount = money in (credit/inflow), positive = debit/outflow
        cents = Math.round(Math.abs(rec.amount) * 100)
        if (rec.direction === 'inflow' || rec.direction === 'outflow') {
          direction = rec.direction
        } else {
          direction = rec.amount < 0 ? 'inflow' : 'outflow'
        }
      }

      if (cents > 0) {
        results.push({
          posted_date: postedDate,
          merchant_name: merchant,
          amount_cents: cents,
          direction,
          source: 'plaid_webhook',
        })
      }
    }
    return results
  }

  if (source === 'ofx_qbo') {
    const blocks = trimmed.split(/<STMTTRN>/i).slice(1)
    const results: ParsedBankTransactionInput[] = []
    for (const block of blocks) {
      const dateRaw = /<DTPOSTED>([^<\r\n]+)/i.exec(block)?.[1] ?? fallbackDate
      const amtRaw = /<TRNAMT>([^<\r\n]+)/i.exec(block)?.[1] ?? '0'
      const nameRaw =
        /<NAME>([^<\r\n]+)/i.exec(block)?.[1] ??
        /<MEMO>([^<\r\n]+)/i.exec(block)?.[1] ??
        'OFX Transaction'
      const signedCents = toCentsSigned(amtRaw)
      if (signedCents === null || signedCents === 0) continue
      results.push({
        posted_date: parseIsoDateFlexible(dateRaw, fallbackDate),
        merchant_name: nameRaw.trim(),
        amount_cents: Math.abs(signedCents),
        direction: signedCents > 0 ? 'inflow' : 'outflow',
        source: 'ofx_qbo',
      })
    }
    return results
  }

  // bank_csv
  const lines = trimmed
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
  if (lines.length < 2) return []

  const headers = parseCsvRowCells(lines[0]).map(h => h.toLowerCase())
  const dateIdx = headers.findIndex(h => /date/.test(h))
  const merchantIdx = headers.findIndex(h => /(merchant|name|description|payee|memo)/.test(h))
  const amountIdx = headers.findIndex(h => /^amount/.test(h))
  const dirIdx = headers.findIndex(h => /(direction|type)/.test(h))
  const creditIdx = headers.findIndex(h => /credit|deposit|inflow/.test(h))
  const debitIdx = headers.findIndex(h => /debit|withdrawal|outflow/.test(h))

  const results: ParsedBankTransactionInput[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRowCells(lines[i])
    const postedDate = parseIsoDateFlexible(
      dateIdx >= 0 ? (cells[dateIdx] ?? '') : fallbackDate,
      fallbackDate,
    )
    const merchantName =
      (merchantIdx >= 0 ? cells[merchantIdx] : cells[1] ?? 'Bank Row') || 'Bank Row'

    let amountCents = 0
    let direction: BankFeedDirection = 'outflow'

    if (amountIdx >= 0 && cells[amountIdx]) {
      const signed = toCentsSigned(cells[amountIdx])
      if (signed !== null && signed !== 0) {
        amountCents = Math.abs(signed)
        const dirVal = dirIdx >= 0 ? (cells[dirIdx] ?? '').toLowerCase() : ''
        if (dirVal.includes('inflow') || dirVal.includes('credit') || dirVal.includes('deposit')) {
          direction = 'inflow'
        } else if (
          dirVal.includes('outflow') ||
          dirVal.includes('debit') ||
          dirVal.includes('withdrawal')
        ) {
          direction = 'outflow'
        } else {
          direction = signed > 0 ? 'inflow' : 'outflow'
        }
      }
    } else {
      const credit = creditIdx >= 0 ? toCentsSigned(cells[creditIdx] ?? '') : null
      const debit = debitIdx >= 0 ? toCentsSigned(cells[debitIdx] ?? '') : null
      if (credit && Math.abs(credit) > 0) {
        amountCents = Math.abs(credit)
        direction = 'inflow'
      } else if (debit && Math.abs(debit) > 0) {
        amountCents = Math.abs(debit)
        direction = 'outflow'
      }
    }

    if (amountCents > 0) {
      results.push({
        posted_date: postedDate,
        merchant_name: merchantName.trim(),
        amount_cents: amountCents,
        direction,
        source: 'bank_csv',
      })
    }
  }
  return results
}

/**
 * Deterministically matches bank inflows to invoices and bank outflows to non-frozen vendor bills
 * in exact integer cents with basis-point confidence scores and plain-English Proof Cards.
 */
export function autoReconcileBankFeed(params: {
  workspaceId: string
  entityId?: string | null
  transactions: readonly ParsedBankTransactionInput[]
  invoices: readonly AutonomousInvoice[]
  vendorBills: readonly VendorBillRecord[]
  asOfDate?: string
}): BankReconciliationResult {
  const asOfDate =
    params.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)
      ? params.asOfDate
      : new Date().toISOString().slice(0, 10)

  const usedInvoiceIds = new Set<string>()
  const usedBillIds = new Set<string>()

  let autoMatchedCount = 0
  let unmatchedCount = 0
  let matchedInflowCents = 0
  let matchedOutflowCents = 0

  const records: BankFeedTransactionRecord[] = params.transactions.map((tx, idx) => {
    const txId = `bf_${idx + 1}_${tx.posted_date.replace(/-/g, '')}`

    if (tx.direction === 'inflow') {
      let bestInv: AutonomousInvoice | null = null
      let bestConfidence = 0
      let bestDays = 999

      for (const inv of params.invoices) {
        if (inv.status === 'void' || inv.status === 'draft') continue
        if (usedInvoiceIds.has(inv.id)) continue
        const openCents = Math.max(0, inv.total_cents - inv.amount_paid_cents)
        const matchAmount = openCents > 0 ? openCents : inv.total_cents
        if (matchAmount !== tx.amount_cents) continue

        const invDate = (inv.due_date || inv.created_at || tx.posted_date).slice(0, 10)
        const daysDelta = diffUtcDays(tx.posted_date, invDate)
        const nameOverlap = hasCounterpartyOverlap(tx.merchant_name, inv.customer_name)
        const confidence =
          nameOverlap || daysDelta <= 3 ? 10000 : daysDelta <= 14 ? 9200 : 8500

        if (confidence > bestConfidence || (confidence === bestConfidence && daysDelta < bestDays)) {
          bestInv = inv
          bestConfidence = confidence
          bestDays = daysDelta
        }
      }

      if (bestInv) {
        usedInvoiceIds.add(bestInv.id)
        autoMatchedCount += 1
        matchedInflowCents += tx.amount_cents
        return {
          id: txId,
          workspace_id: params.workspaceId,
          entity_id: params.entityId ?? null,
          source: tx.source,
          posted_date: tx.posted_date,
          merchant_name: tx.merchant_name,
          amount_cents: tx.amount_cents,
          direction: 'inflow',
          matched_record_id: bestInv.id,
          match_confidence_bps: bestConfidence,
          status: 'auto_matched',
          proof_summary:
            `Matched +${formatCents(tx.amount_cents)} (${tx.amount_cents.toLocaleString('en-US')}c) inflow ` +
            `to ${bestInv.invoice_number} (${bestInv.customer_name}) · ${(bestConfidence / 100).toFixed(1)}% confidence.`,
        }
      }
    } else {
      let bestBill: VendorBillRecord | null = null
      let bestConfidence = 0
      let bestDays = 999

      for (const bill of params.vendorBills) {
        if (bill.match_status === 'disputed' || bill.match_status === 'exception_flagged') continue
        if (usedBillIds.has(bill.id)) continue
        if (bill.total_cents !== tx.amount_cents) continue

        const billDate = (bill.due_date || bill.created_at || tx.posted_date).slice(0, 10)
        const daysDelta = diffUtcDays(tx.posted_date, billDate)
        const nameOverlap = hasCounterpartyOverlap(tx.merchant_name, bill.vendor_name)
        const confidence =
          nameOverlap || daysDelta <= 3 ? 10000 : daysDelta <= 14 ? 9200 : 8500

        if (confidence > bestConfidence || (confidence === bestConfidence && daysDelta < bestDays)) {
          bestBill = bill
          bestConfidence = confidence
          bestDays = daysDelta
        }
      }

      if (bestBill) {
        usedBillIds.add(bestBill.id)
        autoMatchedCount += 1
        matchedOutflowCents += tx.amount_cents
        return {
          id: txId,
          workspace_id: params.workspaceId,
          entity_id: params.entityId ?? null,
          source: tx.source,
          posted_date: tx.posted_date,
          merchant_name: tx.merchant_name,
          amount_cents: tx.amount_cents,
          direction: 'outflow',
          matched_record_id: bestBill.id,
          match_confidence_bps: bestConfidence,
          status: 'auto_matched',
          proof_summary:
            `Matched -${formatCents(tx.amount_cents)} (${tx.amount_cents.toLocaleString('en-US')}c) outflow ` +
            `to ${bestBill.invoice_number} (${bestBill.vendor_name}) · ${(bestConfidence / 100).toFixed(1)}% confidence.`,
        }
      }
    }

    unmatchedCount += 1
    return {
      id: txId,
      workspace_id: params.workspaceId,
      entity_id: params.entityId ?? null,
      source: tx.source,
      posted_date: tx.posted_date,
      merchant_name: tx.merchant_name,
      amount_cents: tx.amount_cents,
      direction: tx.direction,
      matched_record_id: null,
      match_confidence_bps: 0,
      status: 'unmatched',
      proof_summary: `No exact ${formatCents(tx.amount_cents)} open AR invoice or clean AP vendor bill match found.`,
    }
  })

  return {
    as_of_date: asOfDate,
    scanned_count: records.length,
    auto_matched_count: autoMatchedCount,
    unmatched_count: unmatchedCount,
    matched_inflow_cents: matchedInflowCents,
    matched_outflow_cents: matchedOutflowCents,
    transactions: records,
  }
}

export function buildReconcileMatchedPlan(params: {
  workspaceId: string
  transactions: readonly BankFeedTransactionRecord[]
  nowIso?: string
}): BankReconcileCommitPlan {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const reconciledIds: string[] = []
  let totalReconciledCents = 0

  const updated = params.transactions.map(tx => {
    if (tx.status !== 'auto_matched') return tx
    reconciledIds.push(tx.id)
    totalReconciledCents += Math.max(0, Math.trunc(tx.amount_cents))
    return {
      ...tx,
      status: 'reconciled' as const,
      updated_at: nowIso,
    }
  })

  return {
    reconciled_ids: reconciledIds,
    updated_transactions: updated,
    total_reconciled_cents: totalReconciledCents,
    ledger_draft: {
      workspace_id: params.workspaceId,
      agent_name: 'Bank Feed Auto-Reconciliation Engine',
      module: 'bookkeeping',
      action_type: 'reconcile_bank_feed',
      autonomy_mode: 'approve_1tap',
      summary: `Reconciled ${reconciledIds.length} auto-matched bank feed transaction(s) totaling ${formatCents(totalReconciledCents)}`,
      impact_cents: totalReconciledCents,
      before_state: {
        tx_ids: reconciledIds,
        previous_status: 'auto_matched',
      },
      after_state: {
        tx_ids: reconciledIds,
        next_status: 'reconciled',
      },
      status: 'executed',
      reversed_at: null,
    },
  }
}
