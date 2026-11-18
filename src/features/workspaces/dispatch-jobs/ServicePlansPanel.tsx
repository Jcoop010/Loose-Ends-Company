import React, { useRef, useState } from 'react'
import { PauseCircle, PlayCircle, Plus, Repeat } from 'lucide-react'
import { customerDisplayName, formatCurrency, formatDate } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import type {
  Customer,
  OpsServicePlan,
  OpsTeamMemberStatus,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface ServicePlansPanelProps {
  workspaceId: string
  plans: OpsServicePlan[]
  customers: Customer[]
  customersById: ReadonlyMap<string, Customer>
  teamMembers: OpsTeamMemberStatus[]
  timezone?: string | null
  onPlansChanged: () => Promise<void> | void
}

function defaultNextDueDate(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
}

export function ServicePlansPanel({
  workspaceId,
  plans,
  customers,
  customersById,
  teamMembers,
  timezone,
  onPlansChanged,
}: ServicePlansPanelProps): React.ReactElement {
  const toast = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [intervalDays, setIntervalDays] = useState('90')
  const [nextDue, setNextDue] = useState(defaultNextDueDate)
  const [laborTotal, setLaborTotal] = useState('250')
  const [checklistRaw, setChecklistRaw] = useState(
    'Inspect coils, filters & belt tension\nVerify amp draw & condensate safety switch',
  )
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const saveKeyRef = useRef<string>(createIdempotencyKey())

  const handleSavePlan = async (event: React.FormEvent) => {
    event.preventDefault()
    const days = Math.trunc(Number(intervalDays))
    const labor = Number(laborTotal)
    if (!title.trim()) return
    if (!Number.isFinite(days) || days < 1 || days > 1095) {
      toast.error('Invalid interval', 'Enter a recurring interval between 1 and 1,095 days.')
      return
    }
    if (!Number.isFinite(labor) || labor < 0) {
      toast.error('Invalid labor rate', 'Enter a non-negative template labor total.')
      return
    }

    const checklist = checklistRaw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 50)
      .map(step => ({ title: step, done: false }))

    setSaving(true)
    try {
      await opsCommand(
        workspaceId,
        'service_plan_save',
        {
          customer_id: customerId || null,
          assigned_to: assignedTo || null,
          title: title.trim(),
          interval_days: days,
          next_due: new Date(`${nextDue}T09:00:00Z`).toISOString(),
          enabled: true,
          template: {
            labor_total: Math.round(labor * 100) / 100,
            checklist,
          },
        },
        saveKeyRef.current,
      )
      setCreateOpen(false)
      setTitle('')
      toast.success('Recurring service plan saved', 'Coordination engine spawns draft jobs when due.')
      await onPlansChanged()
    } catch (err) {
      toast.error('Could not save plan', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePlan = async (plan: OpsServicePlan) => {
    if (togglingId) return
    setTogglingId(plan.id)
    try {
      await opsCommand(
        workspaceId,
        'service_plan_toggle',
        {
          id: plan.id,
          enabled: !plan.enabled,
        },
        createIdempotencyKey(),
      )
      toast.success(
        !plan.enabled ? 'Service plan enabled' : 'Service plan paused',
        plan.title,
      )
      await onPlansChanged()
    } catch (err) {
      toast.error('Toggle failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <section
      aria-label="Recurring preventive maintenance plans"
      className="exec-surface p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Recurring Preventive Maintenance Plans
          </h2>
          <p className="text-xs text-slate-600">
            Automatically generates draft work orders with pre-filled checklists and labor when
            contracts come due.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            saveKeyRef.current = createIdempotencyKey()
            setNextDue(defaultNextDueDate())
            setCreateOpen(true)
          }}
          className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New Maintenance Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={<Repeat className="h-5 w-5" />}
          title="No recurring service agreements yet"
          description="Set up quarterly, semi-annual, or annual maintenance templates so contract visits never get missed."
        />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {plans.map(plan => {
            const cust = plan.customer_id ? customersById.get(plan.customer_id) : undefined
            const tech = teamMembers.find(m => m.user_id === plan.assigned_to)
            const templateLabor = Number(plan.template?.labor_total ?? 0)
            return (
              <li
                key={plan.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={plan.enabled ? 'emerald' : 'neutral'}>
                      {plan.enabled ? 'Active' : 'Paused'}
                    </Badge>
                    <span className="text-sm font-bold text-slate-900">{plan.title}</span>
                  </div>
                  <p className="text-xs text-slate-600 tabular-nums">
                    {cust ? customerDisplayName(cust) : 'Workspace Template'} · Every{' '}
                    <strong>{plan.interval_days}d</strong> · Next due{' '}
                    <strong>{formatDate(plan.next_due, timezone)}</strong>
                    {tech?.display_name ? ` · Tech: ${tech.display_name}` : ''} · Template labor{' '}
                    {formatCurrency(templateLabor)}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={togglingId === plan.id}
                  onClick={() => void handleTogglePlan(plan)}
                  className="exec-btn-secondary !px-3 !py-1.5 !text-xs shrink-0 touch-target"
                >
                  {plan.enabled ? (
                    <>
                      <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Pause Plan
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      Resume Plan
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Recurring Service Plan"
        description="Saved to ops_service_plans via ops_command('service_plan_save')."
      >
        <form onSubmit={handleSavePlan} className="space-y-4">
          <div>
            <label htmlFor="plan-title" className="exec-label">
              Agreement / Service Title
            </label>
            <input
              id="plan-title"
              type="text"
              required
              placeholder="e.g., Quarterly Rooftop HVAC & Filter Contract"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="plan-cust" className="exec-label">
                Customer
              </label>
              <select
                id="plan-cust"
                value={customerId}
                onChange={e => setCustomerId(e.target.value)}
                className="exec-input"
              >
                <option value="">Unassigned</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {customerDisplayName(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="plan-tech" className="exec-label">
                Preferred Technician
              </label>
              <select
                id="plan-tech"
                value={assignedTo}
                onChange={e => setAssignedTo(e.target.value)}
                className="exec-input"
              >
                <option value="">Unassigned</option>
                {teamMembers.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.user_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="plan-interval" className="exec-label">
                Cadence (Days)
              </label>
              <input
                id="plan-interval"
                type="number"
                required
                min={1}
                max={1095}
                value={intervalDays}
                onChange={e => setIntervalDays(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="plan-due" className="exec-label">
                Next Due Date
              </label>
              <input
                id="plan-due"
                type="date"
                required
                value={nextDue}
                onChange={e => setNextDue(e.target.value)}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="plan-labor" className="exec-label">
                Template Labor ($)
              </label>
              <input
                id="plan-labor"
                type="number"
                required
                min={0}
                step="0.01"
                value={laborTotal}
                onChange={e => setLaborTotal(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>
          </div>

          <div>
            <label htmlFor="plan-checklist" className="exec-label">
              Checklist Items (One per line)
            </label>
            <textarea
              id="plan-checklist"
              rows={3}
              value={checklistRaw}
              onChange={e => setChecklistRaw(e.target.value)}
              className="exec-input text-xs"
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
              disabled={saving}
              className="exec-btn-primary touch-target"
            >
              {saving ? 'Saving Plan…' : 'Save Maintenance Plan'}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
