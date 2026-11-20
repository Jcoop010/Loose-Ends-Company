import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Copy,
  Download,
  FileText,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { type LivingSopRecord } from '../../../lib/autonomousOs'
import * as release3Queries from '../../../lib/autonomousOs/release3Queries'
import { formatDateTime } from '../../../lib/format'
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
  const toast = useToast()
  const workspaceId = workspace?.id ?? null

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sops, setSops] = useState<LivingSopRecord[]>([])
  const [moduleFilter, setModuleFilter] = useState<string>('all')

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
        const rows = await release3Queries.fetchLivingSops(workspaceId)
        setSops(rows)
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
