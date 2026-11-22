import type {
  AutonomousInvoice,
  CpaAccountCategory,
  CpaAccountCode,
  CpaAuditPacket,
  CpaBalanceSheetReport,
  CpaJournalLine,
  CpaProfitAndLossReport,
  CpaTrialBalanceRow,
  LedgerEntryRecord,
  VendorBillRecord,
} from './types'

interface AccountMeta {
  readonly code: CpaAccountCode
  readonly name: string
  readonly category: CpaAccountCategory
  readonly normal_side: 'debit' | 'credit'
}

const CHART_OF_ACCOUNTS: readonly AccountMeta[] = [
  { code: '1000', name: 'Operating Cash', category: 'asset', normal_side: 'debit' },
  { code: '1200', name: 'Accounts Receivable', category: 'asset', normal_side: 'debit' },
  { code: '2000', name: 'Accounts Payable', category: 'liability', normal_side: 'credit' },
  { code: '3000', name: 'Owner Equity', category: 'equity', normal_side: 'credit' },
  { code: '4000', name: 'Operating Revenue', category: 'revenue', normal_side: 'credit' },
  { code: '5000', name: 'Cost of Goods Sold', category: 'cogs', normal_side: 'debit' },
  { code: '6000', name: 'Operating Expenses', category: 'expense', normal_side: 'debit' },
]

const ACCOUNT_MAP: Readonly<Record<CpaAccountCode, AccountMeta>> = {
  '1000': CHART_OF_ACCOUNTS[0],
  '1200': CHART_OF_ACCOUNTS[1],
  '2000': CHART_OF_ACCOUNTS[2],
  '3000': CHART_OF_ACCOUNTS[3],
  '4000': CHART_OF_ACCOUNTS[4],
  '5000': CHART_OF_ACCOUNTS[5],
  '6000': CHART_OF_ACCOUNTS[6],
}

function formatCentsUsd(cents: number): string {
  const safe = Number.isSafeInteger(cents) ? cents : Math.trunc(cents || 0)
  const sign = safe < 0 ? '-' : ''
  const dollars = (Math.abs(safe) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${sign}$${dollars}`
}

function safeNonNegCents(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.max(0, Math.trunc(val))
}

function pushBalancedPair(
  lines: CpaJournalLine[],
  seq: number,
  params: {
    occurred_on: string
    source_type: CpaJournalLine['source_type']
    source_ref: string
    description: string
    debit_account: CpaAccountCode
    credit_account: CpaAccountCode
    amount_cents: number
  },
): number {
  const amt = safeNonNegCents(params.amount_cents)
  if (amt === 0) return seq

  const drMeta = ACCOUNT_MAP[params.debit_account]
  const crMeta = ACCOUNT_MAP[params.credit_account]

  lines.push({
    line_id: `gl_${seq}_dr`,
    occurred_on: params.occurred_on,
    source_type: params.source_type,
    source_ref: params.source_ref,
    description: params.description,
    account_code: drMeta.code,
    account_name: drMeta.name,
    category: drMeta.category,
    debit_cents: amt,
    credit_cents: 0,
  })

  lines.push({
    line_id: `gl_${seq}_cr`,
    occurred_on: params.occurred_on,
    source_type: params.source_type,
    source_ref: params.source_ref,
    description: params.description,
    account_code: crMeta.code,
    account_name: crMeta.name,
    category: crMeta.category,
    debit_cents: 0,
    credit_cents: amt,
  })

  return seq + 1
}

/**
 * Pure, deterministic double-entry CPA tax & audit compiler in exact integer cents.
 * Always verifies total_debits_cents === total_credits_cents (variance_cents === 0).
 */
export function compileCpaAuditPacket(params: {
  workspaceName: string
  ledgerEntries: readonly LedgerEntryRecord[]
  invoices: readonly AutonomousInvoice[]
  vendorBills: readonly VendorBillRecord[]
  asOfDate?: string
  periodLabel?: string
  openingCashCents?: number
  nowIso?: string
}): CpaAuditPacket {
  const asOfDate =
    params.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(params.asOfDate)
      ? params.asOfDate
      : new Date().toISOString().slice(0, 10)
  const periodLabel = params.periodLabel?.trim() || `YTD through ${asOfDate}`
  const generatedAt = params.nowIso ?? new Date().toISOString()
  const openingCashCents = safeNonNegCents(params.openingCashCents ?? 0)

  const lines: CpaJournalLine[] = []
  let seq = 1

  if (openingCashCents > 0) {
    seq = pushBalancedPair(lines, seq, {
      occurred_on: asOfDate,
      source_type: 'opening',
      source_ref: 'OPENING-CASH',
      description: 'Opening operating cash & owner capital baseline',
      debit_account: '1000',
      credit_account: '3000',
      amount_cents: openingCashCents,
    })
  }

  const referencedSources = new Set<string>()
  for (const entry of params.ledgerEntries) {
    if (entry.source_ref && entry.source_ref.trim()) {
      referencedSources.add(entry.source_ref.trim().toLowerCase())
    }
    const amt = safeNonNegCents(Math.abs(entry.amount_cents))
    if (amt === 0) continue

    const occurredOn = (entry.occurred_on || asOfDate).slice(0, 10)
    const ref = entry.source_ref?.trim() || entry.id
    const desc = `${entry.category}: ${entry.description}`.trim()

    if (entry.entry_type === 'revenue') {
      seq = pushBalancedPair(lines, seq, {
        occurred_on: occurredOn,
        source_type: 'ledger_entry',
        source_ref: ref,
        description: desc,
        debit_account: '1000',
        credit_account: '4000',
        amount_cents: amt,
      })
    } else if (entry.entry_type === 'cogs') {
      seq = pushBalancedPair(lines, seq, {
        occurred_on: occurredOn,
        source_type: 'ledger_entry',
        source_ref: ref,
        description: desc,
        debit_account: '5000',
        credit_account: '1000',
        amount_cents: amt,
      })
    } else if (entry.entry_type === 'ap_scheduled') {
      seq = pushBalancedPair(lines, seq, {
        occurred_on: occurredOn,
        source_type: 'ledger_entry',
        source_ref: ref,
        description: desc,
        debit_account: '6000',
        credit_account: '2000',
        amount_cents: amt,
      })
    } else {
      seq = pushBalancedPair(lines, seq, {
        occurred_on: occurredOn,
        source_type: 'ledger_entry',
        source_ref: ref,
        description: desc,
        debit_account: '6000',
        credit_account: '1000',
        amount_cents: amt,
      })
    }
  }

  const includedInvoices = params.invoices.filter(inv => inv.status !== 'void')
  for (const inv of includedInvoices) {
    const total = safeNonNegCents(inv.total_cents)
    const paid =
      inv.status === 'paid'
        ? Math.max(total, safeNonNegCents(inv.amount_paid_cents))
        : Math.min(total, safeNonNegCents(inv.amount_paid_cents))
    const openAr = Math.max(0, total - paid)
    const occurredOn = (inv.created_at || asOfDate).slice(0, 10)
    const invKey = inv.invoice_number.trim().toLowerCase()
    const alreadyInLedger = referencedSources.has(invKey)

    if (paid > 0 && !alreadyInLedger) {
      seq = pushBalancedPair(lines, seq, {
        occurred_on: occurredOn,
        source_type: 'invoice',
        source_ref: inv.invoice_number,
        description: `Collected AR invoice ${inv.invoice_number} (${inv.customer_name})`,
        debit_account: '1000',
        credit_account: '4000',
        amount_cents: paid,
      })
    }

    if (openAr > 0) {
      seq = pushBalancedPair(lines, seq, {
        occurred_on: occurredOn,
        source_type: 'invoice',
        source_ref: inv.invoice_number,
        description: `Open receivable ${inv.invoice_number} (${inv.customer_name})`,
        debit_account: '1200',
        credit_account: '4000',
        amount_cents: openAr,
      })
    }
  }

  const includedBills = params.vendorBills.filter(
    bill => bill.match_status !== 'disputed' && bill.match_status !== 'exception_flagged',
  )
  for (const bill of includedBills) {
    const amt = safeNonNegCents(bill.total_cents)
    if (amt === 0) continue

    const billKey = bill.invoice_number.trim().toLowerCase()
    const alreadyInLedger = referencedSources.has(billKey)
    if (bill.match_status === 'paid') {
      if (!alreadyInLedger) {
        seq = pushBalancedPair(lines, seq, {
          occurred_on: (bill.created_at || asOfDate).slice(0, 10),
          source_type: 'vendor_bill',
          source_ref: bill.invoice_number,
          description: `Paid supplier bill ${bill.invoice_number} (${bill.vendor_name})`,
          debit_account: '5000',
          credit_account: '1000',
          amount_cents: amt,
        })
      }
      continue
    }

    seq = pushBalancedPair(lines, seq, {
      occurred_on: (bill.due_date || bill.created_at || asOfDate).slice(0, 10),
      source_type: 'vendor_bill',
      source_ref: bill.invoice_number,
      description: `Open supplier payable ${bill.invoice_number} (${bill.vendor_name})`,
      debit_account: '5000',
      credit_account: '2000',
      amount_cents: amt,
    })
  }

  lines.sort((a, b) => {
    const dCmp = a.occurred_on.localeCompare(b.occurred_on)
    if (dCmp !== 0) return dCmp
    return a.line_id.localeCompare(b.line_id)
  })

  const debitSums: Record<CpaAccountCode, number> = {
    '1000': 0,
    '1200': 0,
    '2000': 0,
    '3000': 0,
    '4000': 0,
    '5000': 0,
    '6000': 0,
  }
  const creditSums: Record<CpaAccountCode, number> = {
    '1000': 0,
    '1200': 0,
    '2000': 0,
    '3000': 0,
    '4000': 0,
    '5000': 0,
    '6000': 0,
  }

  for (const line of lines) {
    debitSums[line.account_code] += line.debit_cents
    creditSums[line.account_code] += line.credit_cents
  }

  const trialRows: CpaTrialBalanceRow[] = CHART_OF_ACCOUNTS.map(acct => {
    const dr = debitSums[acct.code]
    const cr = creditSums[acct.code]
    const net = acct.normal_side === 'debit' ? dr - cr : cr - dr
    return {
      account_code: acct.code,
      account_name: acct.name,
      category: acct.category,
      debit_cents: dr,
      credit_cents: cr,
      net_balance_cents: net,
      normal_side: acct.normal_side,
    }
  })

  const totalDebitsCents = trialRows.reduce((s, r) => s + r.debit_cents, 0)
  const totalCreditsCents = trialRows.reduce((s, r) => s + r.credit_cents, 0)
  const varianceCents = totalDebitsCents - totalCreditsCents

  if (varianceCents !== 0) {
    throw new Error(`CPA Trial Balance failed double-entry check (variance: ${varianceCents}c)`)
  }

  const cashCents = trialRows.find(r => r.account_code === '1000')?.net_balance_cents ?? 0
  const arCents = trialRows.find(r => r.account_code === '1200')?.net_balance_cents ?? 0
  const apCents = trialRows.find(r => r.account_code === '2000')?.net_balance_cents ?? 0
  const openingEquityCents = trialRows.find(r => r.account_code === '3000')?.net_balance_cents ?? 0
  const revenueCents = trialRows.find(r => r.account_code === '4000')?.net_balance_cents ?? 0
  const cogsCents = trialRows.find(r => r.account_code === '5000')?.net_balance_cents ?? 0
  const opExCents = trialRows.find(r => r.account_code === '6000')?.net_balance_cents ?? 0

  const grossProfitCents = revenueCents - cogsCents
  const netIncomeCents = grossProfitCents - opExCents
  const grossMarginBps =
    revenueCents > 0 ? Math.round((grossProfitCents * 10000) / revenueCents) : 0

  const profitAndLoss: CpaProfitAndLossReport = {
    revenue_cents: revenueCents,
    cogs_cents: cogsCents,
    gross_profit_cents: grossProfitCents,
    operating_expenses_cents: opExCents,
    net_income_cents: netIncomeCents,
    gross_margin_bps: grossMarginBps,
  }

  const totalAssetsCents = cashCents + arCents
  const totalLiabilitiesCents = apCents
  const totalEquityCents = openingEquityCents + netIncomeCents
  const liabilitiesPlusEquityCents = totalLiabilitiesCents + totalEquityCents
  const balanceSheetVarianceCents = totalAssetsCents - liabilitiesPlusEquityCents

  if (balanceSheetVarianceCents !== 0) {
    throw new Error(
      `CPA Balance Sheet failed Assets === Liabilities + Equity check (variance: ${balanceSheetVarianceCents}c)`,
    )
  }

  const balanceSheet: CpaBalanceSheetReport = {
    cash_cents: cashCents,
    accounts_receivable_cents: arCents,
    total_assets_cents: totalAssetsCents,
    accounts_payable_cents: apCents,
    total_liabilities_cents: totalLiabilitiesCents,
    opening_equity_cents: openingEquityCents,
    current_period_net_income_cents: netIncomeCents,
    total_equity_cents: totalEquityCents,
    liabilities_plus_equity_cents: liabilitiesPlusEquityCents,
    balance_sheet_variance_cents: balanceSheetVarianceCents,
    is_balanced: balanceSheetVarianceCents === 0,
  }

  const proofSummary =
    `Reconciled ${lines.length} double-entry GL posting(s) across ${params.ledgerEntries.length} ledger row(s), ${includedInvoices.length} invoice(s), and ${includedBills.length} bill(s): ` +
    `Debits ${formatCentsUsd(totalDebitsCents)} (${totalDebitsCents.toLocaleString('en-US')}c) === Credits ${formatCentsUsd(totalCreditsCents)} (${totalCreditsCents.toLocaleString('en-US')}c) · Variance $0.00 (0 cents).`

  return {
    workspace_name: params.workspaceName.trim() || 'Workspace',
    as_of_date: asOfDate,
    period_label: periodLabel,
    generated_at: generatedAt,
    entry_count: params.ledgerEntries.length,
    invoice_count: includedInvoices.length,
    vendor_bill_count: includedBills.length,
    trial_balance: {
      rows: trialRows,
      total_debits_cents: totalDebitsCents,
      total_credits_cents: totalCreditsCents,
      variance_cents: varianceCents,
      is_balanced: varianceCents === 0,
    },
    profit_and_loss: profitAndLoss,
    balance_sheet: balanceSheet,
    general_ledger: lines,
    proof_summary: proofSummary,
  }
}

function csvCell(val: string | number): string {
  const s = String(val)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function serializeCpaPacketToCsv(packet: CpaAuditPacket): string {
  const lines: string[] = [
    ['Section', 'Code', 'Account / Line Item', 'Category', 'Date', 'Ref', 'Debit ($)', 'Credit ($)', 'Debit (Cents)', 'Credit (Cents)', 'Amount (Cents)'].map(csvCell).join(','),
  ]

  for (const row of packet.trial_balance.rows) {
    lines.push(
      [
        'Trial Balance',
        row.account_code,
        row.account_name,
        row.category,
        packet.as_of_date,
        'TB',
        formatCentsUsd(row.debit_cents),
        formatCentsUsd(row.credit_cents),
        row.debit_cents,
        row.credit_cents,
        row.net_balance_cents,
      ]
        .map(csvCell)
        .join(','),
    )
  }

  lines.push(
    [
      'Trial Balance Totals',
      'TOTAL',
      'Reconciled Totals (Variance = $0.00)',
      'verification',
      packet.as_of_date,
      'TB-TOTAL',
      formatCentsUsd(packet.trial_balance.total_debits_cents),
      formatCentsUsd(packet.trial_balance.total_credits_cents),
      packet.trial_balance.total_debits_cents,
      packet.trial_balance.total_credits_cents,
      packet.trial_balance.variance_cents,
    ]
      .map(csvCell)
      .join(','),
  )

  const plRows: Array<[string, string, number]> = [
    ['Operating Revenue', 'revenue', packet.profit_and_loss.revenue_cents],
    ['Cost of Goods Sold', 'cogs', packet.profit_and_loss.cogs_cents],
    ['Gross Profit', 'subtotal', packet.profit_and_loss.gross_profit_cents],
    ['Operating Expenses', 'expense', packet.profit_and_loss.operating_expenses_cents],
    ['Net Income', 'net_income', packet.profit_and_loss.net_income_cents],
  ]
  for (const [label, cat, amtCents] of plRows) {
    lines.push(
      ['Profit & Loss', '', label, cat, packet.as_of_date, packet.period_label, '', '', 0, 0, amtCents]
        .map(csvCell)
        .join(','),
    )
  }

  const bsRows: Array<[string, string, number]> = [
    ['Operating Cash', 'asset', packet.balance_sheet.cash_cents],
    ['Accounts Receivable', 'asset', packet.balance_sheet.accounts_receivable_cents],
    ['Total Assets', 'asset_total', packet.balance_sheet.total_assets_cents],
    ['Accounts Payable', 'liability', packet.balance_sheet.accounts_payable_cents],
    ['Opening Owner Equity', 'equity', packet.balance_sheet.opening_equity_cents],
    ['Current Period Net Income', 'equity', packet.balance_sheet.current_period_net_income_cents],
    ['Total Liabilities & Equity', 'equity_liability_total', packet.balance_sheet.liabilities_plus_equity_cents],
  ]
  for (const [label, cat, amtCents] of bsRows) {
    lines.push(
      ['Balance Sheet', '', label, cat, packet.as_of_date, 'BS', '', '', 0, 0, amtCents]
        .map(csvCell)
        .join(','),
    )
  }

  for (const gl of packet.general_ledger) {
    lines.push(
      [
        'General Ledger',
        gl.account_code,
        `${gl.account_name} — ${gl.description}`,
        gl.category,
        gl.occurred_on,
        gl.source_ref,
        formatCentsUsd(gl.debit_cents),
        formatCentsUsd(gl.credit_cents),
        gl.debit_cents,
        gl.credit_cents,
        gl.debit_cents > 0 ? gl.debit_cents : -gl.credit_cents,
      ]
        .map(csvCell)
        .join(','),
    )
  }

  return lines.join('\n')
}

export function serializeCpaPacketToJson(packet: CpaAuditPacket): string {
  return JSON.stringify(packet, null, 2)
}
