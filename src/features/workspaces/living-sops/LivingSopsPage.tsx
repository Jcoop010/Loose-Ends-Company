import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  Download,
  FileText,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import {
  compilePlainEnglishSop,
  DEFAULT_AUTONOMY_CONFIG,
  formatCents as formatExactCents,
  simulateCompiledSop,
  SOP_ACTION_LABELS,
  SOP_COMPILER_PRESETS,
  SOP_TRIGGER_LABELS,
  type AgentActionLedgerEntry,
  type ExecutableSopRecord,
  type LivingSopRecord,
  type SopSimulationResult,
  type WorkspaceAutonomyConfig,
} from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import * as release3Queries from '../../../lib/autonomousOs/release3Queries'
import * as release4bQueries from '../../../lib/autonomousOs/release4bQueries'
import { formatDateTime } from '../../../lib/format'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import { Badge, EmptyState, Skeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const MODULE_FILTERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'crm', label: 'CRM' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'bookkeeping', label: 'Bookkeeping' },
  { key: 'vault', label: 'Compliance' },
]

function sopToMarkdown(sop: LivingSopRecord): string {
  return [
    `# ${sop.title} (v${sop.version})`,
    ``,
    `- **Module**: ${sop.module_key}`,
    `- **Trigger Event**: ${sop.trigger_event}`,
    `- **Auto-Compiled**: ${sop.auto_generated ? 'Yes' : 'Manual'}`,
    `- **Last Observed**: ${sop.last_observed_at}`,
    ``,
    `## Steps`,
    ...(Array.isArray(sop.steps_json) ? sop.steps_json.map((step, i) => `${i + 1}. ${step}`) : []),
  ].join('\n')
}

export function LivingSopsPage(): React.ReactElement {
  const { workspace } = useSession()
  const { getParam } = useAppRouter()
  const toast = useToast()
  const workspaceId = workspace?.id ?? null

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sops, setSops] = useState<LivingSopRecord[]>([])
  const [executableSops, setExecutableSops] = useState<ExecutableSopRecord[]>([])
  const [autonomyConfig, setAutonomyConfig] =
    useState<WorkspaceAutonomyConfig>(DEFAULT_AUTONOMY_CONFIG)
  const [moduleFilter, setModuleFilter] = useState<string>('all')

  const [compilerPrompt, setCompilerPrompt] = useState(
    () => getParam('prompt') || SOP_COMPILER_PRESETS[0].prompt,
  )
  const [compilerCapDollars, setCompilerCapDollars] = useState('2500')
  const [dryRunResult, setDryRunResult] = useState<SopSimulationResult | null>(null)
  const [compilingBusy, setCompilingBusy] = useState(false)
  const [activatingBusy, setActivatingBusy] = useState(false)
  const [latestSopLedger, setLatestSopLedger] = useState<AgentActionLedgerEntry | null>(null)
  const [undoingSop, setUndoingSop] = useState(false)

  const urlPromptParam = getParam('prompt')
  useEffect(() => {
    if (urlPromptParam && urlPromptParam.trim()) {
      setCompilerPrompt(urlPromptParam.trim())
    }
  }, [urlPromptParam])

  const [moduleKey, setModuleKey] = useState('quotes')
  const [title, setTitle] = useState('')
  const [triggerEvent, setTriggerEvent] = useState('')
  const [stepsText, setStepsText] = useState('')
  const [saving, setSaving] = useState(false)

  const loadSops = useCallback(
    async (background = false) => {
      if (!workspaceId) return
      if (background) setRefreshing(true)
      else setLoading(true)
      try {
        const [rows, execRows, autoCfg] = await Promise.all([
          release3Queries.fetchLivingSops(workspaceId),
          release4bQueries.fetchExecutableSops(workspaceId).catch(() => []),
          autonomousQueries.fetchWorkspaceAutonomySettings(workspaceId).catch(() => null),
        ])
        setSops(rows)
        setExecutableSops(execRows)
        if (autoCfg) setAutonomyConfig(autoCfg)
      } catch (err) {
        toast.error('Unable to load Living SOPs', err instanceof Error ? err.message : 'Retry.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [workspaceId, toast],
  )

  useEffect(() => {
    void loadSops(false)
  }, [loadSops])

  const visibleSops = useMemo(() => {
    if (moduleFilter === 'all') return sops
    return sops.filter(s => s.module_key.toLowerCase() === moduleFilter)
  }, [sops, moduleFilter])

  const handleSaveSop = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || saving) return
    const steps = stepsText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)

    if (!title.trim() || steps.length === 0) {
      toast.error('SOP incomplete', 'Title and at least one step line are required.')
      return
    }

    setSaving(true)
    try {
      const saved = await release3Queries.upsertLivingSopInDb({
        workspaceId,
        module_key: moduleKey,
        title,
        trigger_event: triggerEvent,
        steps,
        auto_generated: false,
      })
      toast.success(`Saved Living SOP v${saved.version}`, saved.title)
      setTitle('')
      setTriggerEvent('')
      setStepsText('')
      await loadSops(true)
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = (sop: LivingSopRecord) => {
    void navigator.clipboard?.writeText(sopToMarkdown(sop))
    toast.info('SOP Markdown copied', `${sop.title} (v${sop.version})`)
  }

  const handleExport = (sop: LivingSopRecord) => {
    const md = sopToMarkdown(sop)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sop.module_key}-${sop.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${sop.version}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Exported Markdown playbook', a.download)
  }

  const parsedCapCents = Math.max(0, Math.round(Number(compilerCapDollars || 0) * 100))
  const safeCapCents = Number.isSafeInteger(parsedCapCents) ? parsedCapCents : 250000

  const handleCompileDryRun = async (overridePrompt?: string, overrideCapCents?: number) => {
    if (!workspaceId || compilingBusy) return
    const targetPrompt = (overridePrompt ?? compilerPrompt).trim()
    if (!targetPrompt) {
      toast.error('Prompt required', 'Enter or pick an operational rule to compile.')
      return
    }
    setCompilingBusy(true)
    try {
      const compiled = compilePlainEnglishSop(targetPrompt, {
        safetyCapCents: overrideCapCents ?? safeCapCents,
      })
      const inputs = await release4bQueries.fetchSopSimulationInputs(workspaceId)
      const sim = simulateCompiledSop(compiled.rule, {
        sopName: compiled.name,
        plainEnglishPrompt: compiled.plain_english_prompt,
        vendorBills: inputs.vendorBills,
        invoices: inputs.invoices,
        complianceItems: inputs.complianceItems,
      })
      setDryRunResult(sim)
      toast.success('SOP Compiled & Dry-Run Complete', sim.summary)
    } catch (err) {
      toast.error('SOP Compile failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setCompilingBusy(false)
    }
  }

  const handleActivateCompiledSop = async () => {
    if (!workspaceId || activatingBusy || !compilerPrompt.trim()) return
    setActivatingBusy(true)
    try {
      const res = await release4bQueries.saveAndExecuteCompiledSopInDb({
        workspaceId,
        plainEnglishPrompt: compilerPrompt,
        safetyCapCents: safeCapCents,
        config: autonomyConfig,
      })
      setDryRunResult(res.execution.simulation)
      setLatestSopLedger(res.ledgerEntry)
      setExecutableSops(prev => [res.execution.executable_sop, ...prev])
      toast.success(
        'Executable SOP Activated',
        `${res.execution.executable_sop.name} · Logged to Agent Ledger with 1-Click Undo.`,
      )
    } catch (err) {
      toast.error('Activation failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setActivatingBusy(false)
    }
  }

  const handleUndoSopActivation = async () => {
    if (!workspaceId || !latestSopLedger || undoingSop) return
    setUndoingSop(true)
    try {
      const reversed = await autonomousQueries.reverseLedgerEntryInDb({
        workspaceId,
        entry: latestSopLedger,
      })
      setLatestSopLedger(reversed)
      await loadSops(true)
      toast.info('1-Click Undo completed', 'Executable SOP status & run count restored.')
    } catch (err) {
      toast.error('Undo failed', err instanceof Error ? err.message : 'Retry 1-Click Undo.')
    } finally {
      setUndoingSop(false)
    }
  }

  if (!workspaceId) return <div />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Living Operational SOPs</h2>
          <p className="text-xs text-slate-600">
            Self-updating, versioned playbooks auto-compiled from your live workspace workflows across CRM, Quotes, Inventory, Bookkeeping, and Compliance.
          </p>
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadSops(true)}
          className="exec-btn-secondary self-start !px-3.5 !py-2 !text-xs touch-target"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {/* Operations Compiler Panel */}
      <section className="exec-surface border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-4 text-slate-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
              <h3 className="text-base font-bold text-white">
                Operations Compiler (Plain-English -&gt; Safe Executable AST)
              </h3>
              <Badge tone="brand">Read-Only Dry-Run + Cap Guard</Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Compile natural rules into deterministic AST policies, test against live records, and activate with hard cent safety caps + 1-Click Undo.
            </p>
          </div>
          {latestSopLedger && latestSopLedger.status === 'executed' ? (
            <button
              type="button"
              disabled={undoingSop}
              onClick={() => void handleUndoSopActivation()}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-amber-500/40 text-amber-300"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {undoingSop ? 'Reversing…' : '1-Click Undo'}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {SOP_COMPILER_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setCompilerPrompt(preset.prompt)
                setCompilerCapDollars(String(Math.round(preset.safety_cap_cents / 100)))
                void handleCompileDryRun(preset.prompt, preset.safety_cap_cents)
              }}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-slate-700 bg-[#131f33] text-slate-200 hover:border-[#fb923c]"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
          <div className="sm:col-span-7">
            <label htmlFor="sop-compiler-prompt" className="block text-[11px] font-semibold text-slate-300 mb-1">
              Plain-English Rule
            </label>
            <input
              id="sop-compiler-prompt"
              value={compilerPrompt}
              onChange={e => setCompilerPrompt(e.target.value)}
              placeholder='e.g. "Automate: When vendor bill price spikes >5%, freeze up to $2,500 cap."'
              className="exec-input w-full text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sop-compiler-cap" className="block text-[11px] font-semibold text-slate-300 mb-1">
              Safety Cap ($)
            </label>
            <input
              id="sop-compiler-cap"
              type="number"
              min="0"
              step="10"
              value={compilerCapDollars}
              onChange={e => setCompilerCapDollars(e.target.value)}
              className="exec-input w-full text-xs tabular-nums"
            />
          </div>
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={compilingBusy}
              onClick={() => void handleCompileDryRun()}
              className="exec-btn-secondary !px-3 !py-2 !text-xs flex-1"
            >
              <Play className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
              {compilingBusy ? 'Simulating…' : 'Compile & Dry-Run'}
            </button>
            <button
              type="button"
              disabled={activatingBusy}
              onClick={() => void handleActivateCompiledSop()}
              className="exec-btn-emerald !px-3 !py-2 !text-xs flex-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {activatingBusy ? 'Saving…' : 'Activate'}
            </button>
          </div>
        </div>

        {dryRunResult ? (
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{SOP_TRIGGER_LABELS[dryRunResult.rule.trigger]}</Badge>
                <Badge tone="neutral">{SOP_ACTION_LABELS[dryRunResult.rule.action]}</Badge>
              </div>
              <span className="text-xs font-bold text-emerald-300 tabular-nums">
                {dryRunResult.matched_count} match(es) · {formatExactCents(dryRunResult.total_impact_cents)}
              </span>
            </div>
            <p className="text-xs text-slate-300">{dryRunResult.summary}</p>
            {dryRunResult.proof_cards.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {dryRunResult.proof_cards.slice(0, 4).map(card => (
                  <div
                    key={card.record_id}
                    className="rounded-lg border border-slate-700 bg-[#0b1320] p-2.5 text-[11px] space-y-1"
                  >
                    <div className="flex items-center justify-between font-semibold text-white">
                      <span>{card.counterparty}</span>
                      <span className="tabular-nums text-[#fdba74]">
                        {formatExactCents(card.impact_cents)}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-snug">{card.proof_summary}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {executableSops.length > 0 ? (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Compiled Executable SOPs ({executableSops.length})
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {executableSops.map(sop => (
                <div
                  key={sop.id}
                  className="rounded-xl border border-slate-800 bg-[#0e1726] p-3 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={sop.status === 'active' ? 'emerald' : 'neutral'}>
                        {sop.status}
                      </Badge>
                      <span className="font-bold text-white truncate">{sop.name}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 truncate">
                      Cap {formatExactCents(sop.safety_cap_cents)} · Runs: {sop.run_count}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!workspaceId) return
                      const nextStatus = sop.status === 'active' ? 'paused' : 'active'
                      const updated = await release4bQueries.toggleExecutableSopStatusInDb({
                        workspaceId,
                        sop,
                        nextStatus,
                      })
                      setExecutableSops(prev => prev.map(x => (x.id === sop.id ? updated : x)))
                    }}
                    className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                  >
                    <PauseCircle className="h-3 w-3" aria-hidden="true" />
                    {sop.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {MODULE_FILTERS.map(mod => {
          const active = moduleFilter === mod.key
          return (
            <button
              key={mod.key}
              type="button"
              onClick={() => setModuleFilter(mod.key)}
              className={`touch-target rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? 'bg-[#c2410c] text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {mod.label}
            </button>
          )
        })}
      </div>

      {/* Add / Increment SOP Form */}
      <section className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            Create or Version Playbook (reusing same Module + Title bumps version cleanly)
          </h3>
        </div>
        <form onSubmit={e => void handleSaveSop(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-start">
          <div className="sm:col-span-2">
            <label htmlFor="sop-mod" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Module
            </label>
            <select
              id="sop-mod"
              value={moduleKey}
              onChange={e => setModuleKey(e.target.value)}
              className="exec-input w-full text-xs"
            >
              <option value="crm">CRM</option>
              <option value="quotes">Quotes</option>
              <option value="inventory">Inventory</option>
              <option value="bookkeeping">Bookkeeping</option>
              <option value="vault">Compliance</option>
            </select>
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="sop-title" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Playbook Title
            </label>
            <input
              id="sop-title"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="3-Way Match Variance Resolution"
              className="exec-input w-full text-xs"
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="sop-trigger" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Trigger Event
            </label>
            <input
              id="sop-trigger"
              required
              value={triggerEvent}
              onChange={e => setTriggerEvent(e.target.value)}
              placeholder="vendor_bill.exception_flagged"
              className="exec-input w-full text-xs font-mono"
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="sop-steps" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Ordered Steps (1 per line)
            </label>
            <textarea
              id="sop-steps"
              required
              rows={2}
              value={stepsText}
              onChange={e => setStepsText(e.target.value)}
              placeholder={'Verify PO unit price\nCross-check GRN dock scan\nStage credit memo draft'}
              className="exec-input w-full text-xs"
            />
          </div>
          <div className="sm:col-span-1 sm:pt-5">
            <button
              type="submit"
              disabled={saving}
              className="exec-btn-primary w-full !px-2.5 !py-2 !text-xs touch-target"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {saving ? '…' : 'Save'}
            </button>
          </div>
        </form>
      </section>

      {/* Playbook Cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : visibleSops.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" aria-hidden="true" />}
          title="No Living SOPs in this module filter"
          description="Create a playbook above or call MCP tool upsert_living_sop from an autonomous agent as patterns emerge."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleSops.map(sop => (
            <article key={sop.id} className="exec-surface p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{sop.module_key.toUpperCase()}</Badge>
                    <Badge tone="emerald">v{sop.version}</Badge>
                    {sop.auto_generated ? <Badge tone="neutral">Auto-Compiled</Badge> : null}
                  </div>
                  <h4 className="mt-1.5 text-sm font-bold text-slate-900">{sop.title}</h4>
                  <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                    Trigger: {sop.trigger_event} · Observed {formatDateTime(sop.last_observed_at)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(sop)}
                    className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport(sop)}
                    className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    Export
                  </button>
                </div>
              </div>

              <ol className="space-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                {(Array.isArray(sop.steps_json) ? sop.steps_json : []).map((step, idx) => (
                  <li key={`${sop.id}-step-${idx}`}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
