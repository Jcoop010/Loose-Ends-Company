import React, { useState } from 'react'
import { CheckCircle2, Play, Plus, Workflow as WorkflowIcon } from 'lucide-react'
import { invokeWorkflowRunner } from '../../../lib/edgeFunctions'
import { formatDateTime } from '../../../lib/format'
import { createWorkflowRecipe, toggleWorkflowEnabled } from '../../../lib/queries'
import type {
  Workflow,
  WorkflowMode,
  WorkflowRun,
  WorkflowTriggerType,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface WorkflowBuilderPanelProps {
  workspaceId: string
  isAdminOrOwner: boolean
  workflows: Workflow[]
  workflowRuns: WorkflowRun[]
  timezone?: string | null
  onChanged: () => Promise<void> | void
}

export function WorkflowBuilderPanel({
  workspaceId,
  isAdminOrOwner,
  workflows,
  workflowRuns,
  timezone,
  onChanged,
}: WorkflowBuilderPanelProps): React.ReactElement {
  const toast = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<WorkflowMode>('approval')
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('record_created')
  const [entityType, setEntityType] = useState('opportunities')
  const [taskTitle, setTaskTitle] = useState('Review new opportunity & verify consent')
  const [delayHours, setDelayHours] = useState('0')
  const [creating, setCreating] = useState(false)

  const [pumping, setPumping] = useState(false)
  const [approvingRunId, setApprovingRunId] = useState<string | null>(null)
  const [togglingWfId, setTogglingWfId] = useState<string | null>(null)

  const waitingRuns = workflowRuns.filter(r => r.status === 'waiting_approval')
  const recentRuns = workflowRuns.filter(r => r.status !== 'waiting_approval').slice(0, 20)

  const handlePumpEvents = async () => {
    if (pumping) return
    setPumping(true)
    try {
      const res = await invokeWorkflowRunner(workspaceId)
      toast.success(
        'Workflow runner executed',
        `Processed ${res.processed_events ?? 0} queued event(s).`,
      )
      await onChanged()
    } catch (err) {
      toast.error('Runner error', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setPumping(false)
    }
  }

  const handleApproveRun = async (runId: string) => {
    if (!isAdminOrOwner || approvingRunId) return
    setApprovingRunId(runId)
    try {
      await invokeWorkflowRunner(workspaceId, { approveRunId: runId })
      toast.success('Workflow run approved & executed')
      await onChanged()
    } catch (err) {
      toast.error('Approval failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setApprovingRunId(null)
    }
  }

  const handleToggleWorkflow = async (wf: Workflow) => {
    if (!isAdminOrOwner || togglingWfId) return
    setTogglingWfId(wf.id)
    try {
      await toggleWorkflowEnabled({
        workspaceId,
        workflowId: wf.id,
        enabled: !wf.enabled,
      })
      toast.success(!wf.enabled ? 'Workflow enabled' : 'Workflow paused', wf.name)
      await onChanged()
    } catch (err) {
      toast.error('Toggle failed', err instanceof Error ? err.message : 'Owner/admin required.')
    } finally {
      setTogglingWfId(null)
    }
  }

  const handleCreateRecipe = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isAdminOrOwner || !name.trim() || !taskTitle.trim()) return
    setCreating(true)
    try {
      await createWorkflowRecipe({
        workspaceId,
        name: name.trim(),
        description: description.trim() || null,
        mode,
        triggerType,
        entityType,
        actions: [
          {
            type: 'create_task',
            title: taskTitle.trim(),
            priority: 3,
            delay_hours: Math.max(0, Math.trunc(Number(delayHours) || 0)),
          },
        ],
        enabled: true,
      })
      setCreateOpen(false)
      setName('')
      setDescription('')
      toast.success('Workflow recipe created', name.trim())
      await onChanged()
    } catch (err) {
      toast.error('Could not create workflow', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Waiting Approval Queue */}
      <section
        aria-label="Workflow runs awaiting approval"
        className="exec-surface p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Runs Awaiting Owner Approval ({waitingRuns.length})
            </h2>
            <p className="text-xs text-slate-600">
              Approval-mode workflows pause in <code>waiting_approval</code> until confirmed via{' '}
              <code>workflow-runner</code>.
            </p>
          </div>

          <button
            type="button"
            disabled={pumping}
            onClick={() => void handlePumpEvents()}
            className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
          >
            <Play className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            {pumping ? 'Running Pump…' : 'Process Queued Events'}
          </button>
        </div>

        {waitingRuns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4 text-xs text-slate-600">
            No workflow runs are currently waiting for approval.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-amber-200 bg-amber-50/30">
            {waitingRuns.map(run => {
              const wf = workflows.find(w => w.id === run.workflow_id)
              return (
                <li
                  key={run.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="amber">waiting_approval</Badge>
                      <span className="text-sm font-bold text-slate-900">
                        {wf?.name ?? `Workflow ${run.workflow_id.slice(0, 8)}`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 tabular-nums">
                      Queued {formatDateTime(run.created_at, timezone)}
                    </p>
                  </div>

                  {isAdminOrOwner ? (
                    <button
                      type="button"
                      disabled={approvingRunId === run.id}
                      onClick={() => void handleApproveRun(run.id)}
                      className="exec-btn-emerald !px-3.5 !py-2 !text-xs shrink-0 touch-target"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {approvingRunId === run.id ? 'Approving…' : 'Approve & Execute'}
                    </button>
                  ) : (
                    <Badge tone="neutral">Owner/Admin Required</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 2. Workflow Recipes + Run History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section
          aria-label="Workflow automation recipes"
          className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">Automation Recipes</h3>
              <p className="text-xs text-slate-600">
                Internal task and follow-up rules managed by workspace admins.
              </p>
            </div>
            {isAdminOrOwner ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New Recipe
              </button>
            ) : null}
          </div>

          {workflows.length === 0 ? (
            <EmptyState
              icon={<WorkflowIcon className="h-5 w-5" />}
              title="No custom workflows configured"
              description="Create an approval-gated or automatic task rule when customers, quotes, or opportunities change."
            />
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
              {workflows.map(wf => (
                <li
                  key={wf.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={wf.enabled ? 'emerald' : 'neutral'}>
                        {wf.enabled ? 'Enabled' : 'Paused'}
                      </Badge>
                      <Badge tone="sky">{wf.mode}</Badge>
                      <span className="text-sm font-bold text-slate-900">{wf.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {wf.description || `Trigger: ${wf.trigger_type} (${wf.trigger_config?.entity_type ?? 'record'})`}
                    </p>
                  </div>

                  {isAdminOrOwner ? (
                    <button
                      type="button"
                      disabled={togglingWfId === wf.id}
                      onClick={() => void handleToggleWorkflow(wf)}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs shrink-0 touch-target"
                    >
                      {wf.enabled ? 'Pause' : 'Enable'}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Recent workflow execution history"
          className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4"
        >
          <h3 className="text-base font-bold text-slate-900">Recent Run History</h3>
          {recentRuns.length === 0 ? (
            <p className="text-xs text-slate-500">No completed or skipped runs recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
              {recentRuns.map(run => {
                const wf = workflows.find(w => w.id === run.workflow_id)
                return (
                  <li key={run.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-slate-900">
                        {wf?.name ?? run.workflow_id.slice(0, 8)}
                      </span>
                      <Badge
                        tone={
                          run.status === 'completed'
                            ? 'emerald'
                            : run.status === 'failed'
                              ? 'rose'
                              : 'neutral'
                        }
                      >
                        {run.status}
                      </Badge>
                    </div>
                    {run.error ? <p className="text-rose-700">{run.error}</p> : null}
                    <p className="text-slate-400 tabular-nums">
                      {formatDateTime(run.created_at, timezone)}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Create Workflow Recipe Modal */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Workflow Recipe"
        description="Creates an internal task rule scoped to your workspace."
      >
        <form onSubmit={handleCreateRecipe} className="space-y-4">
          <div>
            <label htmlFor="wf-name" className="exec-label">
              Workflow Name
            </label>
            <input
              id="wf-name"
              type="text"
              required
              placeholder="e.g., High-Value Opportunity Owner Check-In"
              value={name}
              onChange={e => setName(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="wf-mode" className="exec-label">
                Execution Mode
              </label>
              <select
                id="wf-mode"
                value={mode}
                onChange={e => setMode(e.target.value as WorkflowMode)}
                className="exec-input"
              >
                <option value="approval">Owner Approval</option>
                <option value="automatic">Automatic (Internal Task)</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div>
              <label htmlFor="wf-trigger" className="exec-label">
                Trigger
              </label>
              <select
                id="wf-trigger"
                value={triggerType}
                onChange={e => setTriggerType(e.target.value as WorkflowTriggerType)}
                className="exec-input"
              >
                <option value="record_created">Record Created</option>
                <option value="record_updated">Record Updated</option>
                <option value="record_due">Record Due</option>
              </select>
            </div>

            <div>
              <label htmlFor="wf-entity" className="exec-label">
                Entity Table
              </label>
              <select
                id="wf-entity"
                value={entityType}
                onChange={e => setEntityType(e.target.value)}
                className="exec-input"
              >
                <option value="opportunities">Opportunities</option>
                <option value="documents">Documents</option>
                <option value="appointments">Appointments</option>
                <option value="customers">Customers</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-9">
              <label htmlFor="wf-task-title" className="exec-label">
                Task Title to Create
              </label>
              <input
                id="wf-task-title"
                type="text"
                required
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                className="exec-input"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="wf-delay" className="exec-label">
                Delay (Hours)
              </label>
              <input
                id="wf-delay"
                type="number"
                min={0}
                max={720}
                value={delayHours}
                onChange={e => setDelayHours(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>
          </div>

          <div>
            <label htmlFor="wf-desc" className="exec-label">
              Description (Optional)
            </label>
            <input
              id="wf-desc"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="exec-btn-primary touch-target"
            >
              {creating ? 'Creating…' : 'Save Recipe'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
