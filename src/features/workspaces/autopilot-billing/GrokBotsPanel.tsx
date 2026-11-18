import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileSearch,
  Save,
  Sparkles,
  XCircle,
} from 'lucide-react'
import {
  invokeGrokBotAuditLeaks,
  invokeGrokBotParseDocument,
} from '../../../lib/edgeFunctions'
import { formatCents, formatDateTime } from '../../../lib/format'
import {
  fetchBotManuals,
  fetchBotRuns,
  fetchStagedLedgerEntries,
  reviewStagedLedgerEntry,
  upsertBotManual,
} from '../../../lib/queries'
import type {
  BotAutonomyMode,
  BotManual,
  BotRole,
  BotRun,
  StagedLedgerEntry,
} from '../../../types/domain'
import { Badge, EmptyState, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface GrokBotsPanelProps {
  workspaceId: string
  isAdminOrOwner: boolean
  timezone?: string | null
}

const BOT_ROLE_META: Record<
  BotRole,
  { title: string; subtitle: string; defaultManual: string }
> = {
  billing: {
    title: 'Billing & Document Parser Bot',
    subtitle: 'Parses receipts/invoices into integer cents and flags arithmetic discrepancies.',
    defaultManual:
      '# Billing & Document Parser SOP\n- Verify every completed job checklist item and reserved material before staging an invoice draft.\n- Recompute line-item subtotals and tax in integer cents; flag any vendor receipt or estimate where line items + tax do not equal total.\n- Stage all outputs as `pending_approval` in `staged_ledger_entries`.',
  },
  cash_applications: {
    title: 'Cash Applications & Match Bot',
    subtitle: 'Reconciles supplier POs, vendor bills, and remittance advice.',
    defaultManual:
      '# Cash Applications & Receipt Match SOP\n- Match incoming vendor bills, supplier POs, and remittance advice against open documents by exact dollar amount and reference number.\n- Flag partial payments or unapproved price increases (>3% over PO cost) as `discrepancy_flag` entries.',
  },
  collections: {
    title: 'Collections & Leak Recovery Bot',
    subtitle: 'Prioritizes unbilled jobs, overdue invoices, and consent-verified follow-ups.',
    defaultManual:
      '# Collections & Revenue Leak Recovery SOP\n- Prioritize overdue invoices (>7 days past due), completed unbilled jobs, and stale quotes (>5 days old).\n- Verify active channel opt-in in `customer_contact_consent_events` before proposing any customer follow-up.',
  },
  outreach: {
    title: 'Founder-to-Founder Outreach Bot',
    subtitle: 'Tailors SMB prospect emails to detected operational bottlenecks.',
    defaultManual:
      '# Founder-to-Founder SMB Outreach SOP\n- Tailor outreach to the prospect\'s specific industry bottleneck (unbilled field work, stale estimates, stockouts, or overdue receivables).\n- Reference the live interactive sandbox (`https://loose-ends-os.vercel.app/demo`) and queue all drafts with `requires_approval = true`.',
  },
}

const SAMPLE_RECEIPT_CLEAN = `Vendor: Johnstone Supply Wholesale
Invoice #: INV-2026-8841
Date: 2026-11-18
R-410A Refrigerant Cylinder 25lb 2 x $145.00
24V Contactor Relay 3 x $28.00
Tax: $22.44
Total: $396.44`

const SAMPLE_RECEIPT_MISMATCH = `Vendor: Tri-State Fleet & Hydraulic Supply
Invoice #: BILL-99204
Date: 2026-11-18
High-Pressure Hose Assembly 2 x $115.00
Hydraulic Coupler Kit 1 x $65.00
Tax: $18.00
Total: $348.00`

export function GrokBotsPanel({
  workspaceId,
  isAdminOrOwner,
  timezone,
}: GrokBotsPanelProps): React.ReactElement {
  const toast = useToast()

  const [manuals, setManuals] = useState<BotManual[]>([])
  const [stagedEntries, setStagedEntries] = useState<StagedLedgerEntry[]>([])
  const [botRuns, setBotRuns] = useState<BotRun[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedRole, setSelectedRole] = useState<BotRole>('billing')
  const [editMode, setEditMode] = useState<BotAutonomyMode>('propose')
  const [editInstructions, setEditInstructions] = useState(
    BOT_ROLE_META.billing.defaultManual,
  )
  const [savingManual, setSavingManual] = useState(false)

  const [documentText, setDocumentText] = useState(SAMPLE_RECEIPT_CLEAN)
  const [parsingDoc, setParsingDoc] = useState(false)
  const [auditingLeaks, setAuditingLeaks] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [m, s, r] = await Promise.all([
        fetchBotManuals(workspaceId),
        fetchStagedLedgerEntries(workspaceId),
        fetchBotRuns(workspaceId),
      ])
      setManuals(m)
      setStagedEntries(s)
      setBotRuns(r)
    } catch (err) {
      toast.error(
        'Could not load Grok Bot state',
        err instanceof Error ? err.message : 'Retry shortly.',
      )
    } finally {
      setLoading(false)
    }
  }, [workspaceId, toast])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    const found = manuals.find(m => m.bot_role === selectedRole)
    if (found) {
      setEditMode(found.mode)
      setEditInstructions(found.instructions_markdown)
    } else {
      setEditMode('propose')
      setEditInstructions(BOT_ROLE_META[selectedRole].defaultManual)
    }
  }, [selectedRole, manuals])

  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdminOrOwner) return
    setSavingManual(true)
    try {
      const saved = await upsertBotManual({
        workspaceId,
        botRole: selectedRole,
        mode: editMode,
        instructionsMarkdown: editInstructions,
      })
      setManuals(prev => {
        const filtered = prev.filter(m => m.bot_role !== selectedRole)
        return [...filtered, saved]
      })
      toast.success(
        'Bot SOP Manual updated',
        `${BOT_ROLE_META[selectedRole].title} set to ${saved.mode} mode.`,
      )
    } catch (err) {
      toast.error(
        'Could not save SOP manual',
        err instanceof Error ? err.message : 'Retry.',
      )
    } finally {
      setSavingManual(false)
    }
  }

  const handleParseDocument = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!documentText.trim()) return
    setParsingDoc(true)
    try {
      const res = await invokeGrokBotParseDocument({
        workspaceId,
        botRole: 'billing',
        documentText,
      })
      toast.success(
        res.has_discrepancy
          ? 'Discrepancy flagged in staged ledger'
          : 'Document parsed & staged for approval',
        `${res.staged_entry.vendor_name ?? 'Vendor'} · ${formatCents(res.staged_entry.amount_cents)}`,
      )
      await loadAll()
    } catch (err) {
      toast.error(
        'Document parse failed',
        err instanceof Error ? err.message : 'Retry.',
      )
    } finally {
      setParsingDoc(false)
    }
  }

  const handleAuditLeaks = async () => {
    setAuditingLeaks(true)
    try {
      const res = await invokeGrokBotAuditLeaks({ workspaceId })
      toast.success('Grok Leak Audit completed', res.executive_summary)
      await loadAll()
    } catch (err) {
      toast.error(
        'Leak audit unavailable',
        err instanceof Error ? err.message : 'Retry.',
      )
    } finally {
      setAuditingLeaks(false)
    }
  }

  const handleReviewEntry = async (
    entry: StagedLedgerEntry,
    decision: 'approved' | 'rejected',
  ) => {
    if (reviewingId) return
    setReviewingId(entry.id)
    try {
      const updated = await reviewStagedLedgerEntry({
        workspaceId,
        entryId: entry.id,
        decision,
      })
      setStagedEntries(prev =>
        prev.map(item => (item.id === updated.id ? updated : item)),
      )
      toast.success(
        decision === 'approved' ? 'Staged entry approved' : 'Staged entry rejected',
        `${entry.vendor_name ?? entry.entry_type} (${formatCents(entry.amount_cents)})`,
      )
    } catch (err) {
      toast.error(
        'Review failed',
        err instanceof Error ? err.message : 'Retry.',
      )
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Row: SOP Manuals & Document Parser */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Versioned Bot SOP Manuals & Autonomy Mode */}
        <section
          aria-label="Grok Bot SOP Manuals"
          className="exec-surface p-5 sm:p-6 lg:col-span-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-slate-900" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900">
                  Scoped Grok Bot SOP Manuals
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Owners control each bot&apos;s operating instructions and autonomy gate. Bot
                executions read manuals as immutable policy.
              </p>
            </div>
            <Badge tone="emerald">grok-4.7</Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {(['billing', 'cash_applications', 'collections', 'outreach'] as BotRole[]).map(
              role => {
                const active = selectedRole === role
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSelectedRole(role)}
                    className={`touch-target rounded-xl px-2.5 py-2 text-xs font-semibold transition ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {role.replace('_', ' ').toUpperCase()}
                  </button>
                )
              },
            )}
          </div>

          <form onSubmit={handleSaveManual} className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-xs font-bold text-slate-900">
                  {BOT_ROLE_META[selectedRole].title}
                </p>
                <p className="text-[11px] text-slate-600">
                  {BOT_ROLE_META[selectedRole].subtitle}
                </p>
              </div>
              <div className="shrink-0">
                <label htmlFor="bot-mode-select" className="sr-only">
                  Autonomy Mode
                </label>
                <select
                  id="bot-mode-select"
                  value={editMode}
                  disabled={!isAdminOrOwner}
                  onChange={e => setEditMode(e.target.value as BotAutonomyMode)}
                  className="exec-input !py-1.5 !text-xs font-semibold"
                >
                  <option value="observe">Observe Only (Audit Log)</option>
                  <option value="propose">Propose (Owner Approval Gate)</option>
                  <option value="auto_with_escalation">Auto + Escalate Exceptions</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="bot-sop-markdown" className="exec-label">
                SOP Instructions (Markdown)
              </label>
              <textarea
                id="bot-sop-markdown"
                rows={6}
                disabled={!isAdminOrOwner}
                value={editInstructions}
                onChange={e => setEditInstructions(e.target.value)}
                className="exec-input font-mono !text-xs"
              />
            </div>

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={!isAdminOrOwner || savingManual}
                className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                {savingManual ? 'Saving SOP…' : 'Save SOP Manual'}
              </button>
            </div>
          </form>
        </section>

        {/* Right: Receipt / Vendor Bill Structured Parser & Leak Auditor */}
        <section
          aria-label="Grok Receipt and Invoice Parser"
          className="exec-surface p-5 sm:p-6 lg:col-span-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <FileSearch className="h-4 w-4 text-slate-900" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900">
                  Receipt & Vendor Bill Verification Parser
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Extracts structured line items via xAI Structured Outputs, recomputes integer
                cents in TypeScript, and flags arithmetic mismatches.
              </p>
            </div>

            <button
              type="button"
              disabled={auditingLeaks}
              onClick={() => void handleAuditLeaks()}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
              {auditingLeaks ? 'Auditing Leaks…' : 'Audit Unbilled Leaks'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDocumentText(SAMPLE_RECEIPT_CLEAN)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
            >
              Load Clean Wholesale Bill ($396.44)
            </button>
            <button
              type="button"
              onClick={() => setDocumentText(SAMPLE_RECEIPT_MISMATCH)}
              className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
            >
              Load Arithmetic Discrepancy Bill ($35.00 Overcharge)
            </button>
          </div>

          <form onSubmit={handleParseDocument} className="space-y-3">
            <div>
              <label htmlFor="grok-doc-input" className="exec-label">
                Receipt / Invoice Text or OCR Payload
              </label>
              <textarea
                id="grok-doc-input"
                rows={7}
                required
                value={documentText}
                onChange={e => setDocumentText(e.target.value)}
                className="exec-input font-mono !text-xs"
              />
            </div>

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={parsingDoc}
                className="exec-btn-emerald !px-4 !py-2 !text-xs touch-target"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {parsingDoc ? 'Verifying & Staging…' : 'Parse & Stage Ledger Entry'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Bottom Row: Staged Ledger Approvals Queue & Bot Run Audit Trail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section
          aria-label="Staged Ledger Entries Queue"
          className="exec-surface overflow-hidden lg:col-span-7"
        >
          <div className="flex items-center justify-between border-b border-slate-200 p-4 sm:p-5">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Staged Ledger Approvals (<code>staged_ledger_entries</code>)
              </h3>
              <p className="text-xs text-slate-600">
                Every bot proposal waits in <code>pending_approval</code> until reviewed by an
                owner.
              </p>
            </div>
            <Badge tone="amber">
              {stagedEntries.filter(e => e.status === 'pending_approval').length} pending
            </Badge>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : stagedEntries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Bot className="h-5 w-5" />}
                title="No staged ledger entries yet"
                description="Parse a receipt or run a Grok leak audit above to stage entries for approval."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {stagedEntries.map(entry => {
                const isDiscrepancy = entry.entry_type === 'discrepancy_flag'
                return (
                  <li key={entry.id} className="p-4 sm:p-5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {entry.vendor_name ?? 'Ledger Proposal'}
                        </span>
                        <Badge tone={isDiscrepancy ? 'rose' : 'neutral'}>
                          {entry.entry_type}
                        </Badge>
                        <Badge
                          tone={
                            entry.status === 'approved' || entry.status === 'applied'
                              ? 'emerald'
                              : entry.status === 'rejected'
                                ? 'rose'
                                : 'amber'
                          }
                        >
                          {entry.status}
                        </Badge>
                      </div>
                      <span className="text-sm font-bold text-slate-950 tabular-nums">
                        {formatCents(entry.amount_cents)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600">{entry.reasoning_summary}</p>

                    {entry.line_items && entry.line_items.length > 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] space-y-1">
                        {entry.line_items.map((li, idx) => (
                          <div
                            key={`${entry.id}-li-${idx}`}
                            className="flex items-center justify-between text-slate-700"
                          >
                            <span>
                              {li.quantity} × {li.description}
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatCents(Math.round(li.quantity * li.unit_price_cents))}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {isDiscrepancy ? (
                      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-900">
                        <AlertTriangle
                          className="h-3.5 w-3.5 shrink-0 text-rose-600"
                          aria-hidden="true"
                        />
                        <span>
                          Discrepancy detected — verify vendor math before approving.
                        </span>
                      </div>
                    ) : null}

                    {entry.status === 'pending_approval' ? (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={reviewingId === entry.id}
                          onClick={() => void handleReviewEntry(entry, 'approved')}
                          className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Approve Entry
                        </button>
                        <button
                          type="button"
                          disabled={reviewingId === entry.id}
                          onClick={() => void handleReviewEntry(entry, 'rejected')}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Right: Bot Run Audit Log */}
        <section
          aria-label="Grok Bot Run Audit Log"
          className="exec-surface overflow-hidden lg:col-span-5"
        >
          <div className="flex items-center justify-between border-b border-slate-200 p-4 sm:p-5">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Bot Execution Audit Log (<code>bot_runs</code>)
              </h3>
              <p className="text-xs text-slate-600">
                Immutable trace of every Grok & deterministic accounting check.
              </p>
            </div>
            <Badge tone="neutral">{botRuns.length} runs</Badge>
          </div>

          {botRuns.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">
              No bot executions recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 text-xs">
              {botRuns.map(run => (
                <li key={run.id} className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold uppercase text-slate-900">
                        {run.bot_role}
                      </span>
                      <Badge
                        tone={run.status === 'completed' ? 'emerald' : 'amber'}
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {formatDateTime(run.created_at, timezone)}
                    </span>
                  </div>
                  <p className="text-slate-700 font-medium">{run.input_summary}</p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Model: {run.model} · Mode: {run.mode}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
