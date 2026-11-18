import React, { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Plus, RotateCcw } from 'lucide-react'
import { customerDisplayName, formatAgingBadge, parseIsoMs } from '../../../lib/format'
import { createFollowUpTask, updateTaskStatus } from '../../../lib/queries'
import type { Customer, Task } from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface TasksQueuePanelProps {
  workspaceId: string
  tasks: Task[]
  customers: Customer[]
  customersById: ReadonlyMap<string, Customer>
  onTasksChanged: () => Promise<void> | void
}

type StatusView = 'open' | 'completed' | 'all'
type DueFilter = 'all' | 'overdue' | 'upcoming'

export function TasksQueuePanel({
  workspaceId,
  tasks,
  customers,
  customersById,
  onTasksChanged,
}: TasksQueuePanelProps): React.ReactElement {
  const toast = useToast()

  const [statusView, setStatusView] = useState<StatusView>('open')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [priority, setPriority] = useState('3')
  const [dueInHours, setDueInHours] = useState('24')
  const [creating, setCreating] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filteredTasks = useMemo(() => {
    const nowMs = Date.now()
    return tasks.filter(task => {
      const isDone = task.status === 'done' || task.status === 'completed' || task.status === 'cancelled'
      if (statusView === 'open' && isDone) return false
      if (statusView === 'completed' && !isDone) return false

      if (dueFilter !== 'all') {
        const dueMs = parseIsoMs(task.due_at)
        if (dueFilter === 'overdue' && (dueMs === null || dueMs >= nowMs)) return false
        if (dueFilter === 'upcoming' && (dueMs === null || dueMs < nowMs)) return false
      }
      return true
    })
  }, [tasks, statusView, dueFilter])

  const handleCreateTask = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setCreating(true)
    try {
      const res = await createFollowUpTask({
        workspaceId,
        title: title.trim(),
        customerId: customerId || null,
        priority: Number(priority) || 2,
        dueInHours: Number(dueInHours) || 24,
      })
      setModalOpen(false)
      setTitle('')
      if (res.duplicate) {
        toast.info('Duplicate avoided', 'An open task with this title already exists.')
      } else {
        toast.success('Operational task queued', res.task.title)
      }
      await onTasksChanged()
    } catch (err) {
      toast.error('Could not create task', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleDone = async (task: Task) => {
    if (togglingId) return
    const currentlyDone = task.status === 'done' || task.status === 'completed'
    setTogglingId(task.id)
    try {
      await updateTaskStatus({
        workspaceId,
        taskId: task.id,
        status: currentlyDone ? 'open' : 'completed',
      })
      toast.success(currentlyDone ? 'Task reopened' : 'Task completed', task.title)
      await onTasksChanged()
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <section aria-label="Operational tasks queue" className="exec-surface p-5 sm:p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['open', 'Open'],
              ['completed', 'Completed'],
              ['all', 'All'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusView(key)}
              className={`touch-target rounded-full px-3 py-1.5 text-xs font-semibold ${
                statusView === key
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}

          <select
            aria-label="Filter tasks by due date"
            value={dueFilter}
            onChange={e => setDueFilter(e.target.value as DueFilter)}
            className="exec-input !w-auto !py-1.5 !text-xs"
          >
            <option value="all">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New Task
        </button>
      </div>

      {filteredTasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-5 w-5" />}
          title="No tasks match this filter"
          description="Operational follow-ups and technician action items appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {filteredTasks.map(task => {
            const cust = task.customer_id ? customersById.get(task.customer_id) : undefined
            const isDone = task.status === 'done' || task.status === 'completed'
            const isUrgent = task.priority >= 3
            return (
              <li
                key={task.id}
                className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={isDone ? 'emerald' : isUrgent ? 'rose' : 'amber'}>
                      {isDone ? 'Done' : isUrgent ? 'Urgent' : 'Normal'}
                    </Badge>
                    <span
                      className={`text-sm font-semibold ${
                        isDone ? 'line-through text-slate-400' : 'text-slate-900'
                      }`}
                    >
                      {task.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                    {cust ? `${customerDisplayName(cust)} · ` : ''}
                    {formatAgingBadge(task.due_at)}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={togglingId === task.id}
                  onClick={() => void handleToggleDone(task)}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs shrink-0 touch-target"
                >
                  {isDone ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reopen
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      Complete
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create Operational Task"
        description="Deduplicated against existing open workspace tasks."
      >
        <form onSubmit={handleCreateTask} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="exec-label">
              Task Title
            </label>
            <input
              id="task-title"
              type="text"
              required
              placeholder="e.g., Confirm crane permit for rooftop package unit"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="exec-input"
            />
          </div>

          <div>
            <label htmlFor="task-cust" className="exec-label">
              Linked Customer (Optional)
            </label>
            <select
              id="task-cust"
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              className="exec-input"
            >
              <option value="">None</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {customerDisplayName(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-prio" className="exec-label">
                Priority
              </label>
              <select
                id="task-prio"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="exec-input"
              >
                <option value="3">Urgent (P3)</option>
                <option value="2">Standard (P2)</option>
                <option value="1">Low (P1)</option>
              </select>
            </div>
            <div>
              <label htmlFor="task-due-hrs" className="exec-label">
                Due Window
              </label>
              <select
                id="task-due-hrs"
                value={dueInHours}
                onChange={e => setDueInHours(e.target.value)}
                className="exec-input"
              >
                <option value="4">In 4 hours</option>
                <option value="24">Tomorrow (24h)</option>
                <option value="72">In 3 days</option>
                <option value="168">In 7 days</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="exec-btn-primary touch-target"
            >
              {creating ? 'Saving…' : 'Create Task'}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
