import React, { useMemo, useRef, useState } from 'react'
import {
  CalendarPlus,
  CheckSquare,
  ExternalLink,
  Link2,
  PackagePlus,
  Plus,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import { customerDisplayName, formatCurrency } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import type {
  Customer,
  InventoryItem,
  JobChecklistItem,
  JobMaterial,
  JobPriority,
  JobStatus,
  OpsJob,
  OpsJobAttachment,
  OpsTeamMemberStatus,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState, PaginationBar } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const PAGE_SIZE = 15

const INDUSTRY_CHECKLIST_PRESETS: Record<string, string[]> = {
  hvac: [
    'Verify disconnect & line voltage before service',
    'Inspect coil cleanliness, static pressure & superheat/subcool',
    'Confirm thermostat call & condensate safety switch',
  ],
  plumbing: [
    'Locate main shutoff & verify static water pressure',
    'Pressure-test repaired fittings / drain flow',
    'Clean work area & review shutoff valve with customer',
  ],
  electrical: [
    'Lockout/tagout breaker & verify zero voltage',
    'Torque panel terminations & verify GFCI/AFCI trip',
    'Label circuit directory & restore power',
  ],
  general: [
    'Confirm job scope & site safety walkthrough',
    'Complete work items & quality inspection',
    'Capture completion sign-off notes',
  ],
}

function statusBadgeTone(
  status: JobStatus,
): 'neutral' | 'sky' | 'emerald' | 'amber' | 'rose' {
  if (status === 'completed') return 'emerald'
  if (status === 'in_progress' || status === 'scheduled') return 'sky'
  if (status === 'approved') return 'emerald'
  if (status === 'quoted') return 'amber'
  if (status === 'cancelled') return 'rose'
  return 'neutral'
}

export interface JobsPipelinePanelProps {
  workspaceId: string
  jobs: OpsJob[]
  jobMaterials: JobMaterial[]
  attachments: OpsJobAttachment[]
  inventoryItems: InventoryItem[]
  customers: Customer[]
  customersById: ReadonlyMap<string, Customer>
  teamMembers: OpsTeamMemberStatus[]
  onOpenScheduleForJob: (jobId: string) => void
  onJobsChanged: () => Promise<void> | void
}

export function JobsPipelinePanel({
  workspaceId,
  jobs,
  jobMaterials,
  attachments,
  inventoryItems,
  customers,
  customersById,
  teamMembers,
  onOpenScheduleForJob,
  onJobsChanged,
}: JobsPipelinePanelProps): React.ReactElement {
  const toast = useToast()

  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [page, setPage] = useState(0)

  // Create Job Modal (`job_save`)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCustomerId, setNewCustomerId] = useState('')
  const [newAssignedTo, setNewAssignedTo] = useState('')
  const [newPriority, setNewPriority] = useState<JobPriority>('normal')
  const [newLabor, setNewLabor] = useState('0')
  const [newNotes, setNewNotes] = useState('')
  const [checklistPreset, setChecklistPreset] = useState('hvac')
  const [creatingJob, setCreatingJob] = useState(false)
  const createJobKeyRef = useRef<string>(createIdempotencyKey())

  // Job Detail / Materials / Checklist / Attachments Drawer
  const [inspectJobId, setInspectJobId] = useState<string | null>(null)
  const [reserveItemId, setReserveItemId] = useState('')
  const [reserveQty, setReserveQty] = useState('1')
  const [newChecklistStep, setNewChecklistStep] = useState('')
  const [attachName, setAttachName] = useState('')
  const [attachUrl, setAttachUrl] = useState('')
  const [equipModel, setEquipModel] = useState('')
  const [equipSerial, setEquipSerial] = useState('')
  const [approvalEvidenceInput, setApprovalEvidenceInput] = useState('')
  const [busyAction, setBusyAction] = useState(false)

  const filteredJobs = useMemo(
    () => (statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)),
    [jobs, statusFilter],
  )

  const pagedJobs = useMemo(
    () => filteredJobs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filteredJobs, page],
  )

  const inspectedJob = useMemo(
    () => (inspectJobId ? jobs.find(j => j.id === inspectJobId) ?? null : null),
    [jobs, inspectJobId],
  )

  const inventoryById = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of inventoryItems) {
      map.set(item.id, item)
    }
    return map
  }, [inventoryItems])

  const openInspector = (job: OpsJob) => {
    setInspectJobId(job.id)
    setEquipModel(job.service_details?.equipment ?? '')
    setEquipSerial(job.service_details?.serial ?? '')
    setApprovalEvidenceInput(job.approval_evidence ?? '')
    const availableSkus = inventoryItems.filter(i => !i.archived && i.quantity - i.reserved > 0)
    setReserveItemId(availableSkus[0]?.id ?? '')
    setReserveQty('1')
  }

  const computeFinancials = (job: OpsJob) => {
    const mats = jobMaterials.filter(m => m.job_id === job.id && m.state !== 'released')
    const materialRevenue = mats.reduce((sum, m) => sum + m.quantity * m.unit_price, 0)
    const materialCost = mats.reduce((sum, m) => sum + m.quantity * m.unit_cost, 0)
    const billableTotal = job.labor_total + materialRevenue
    const grossMargin = billableTotal - materialCost
    return {
      mats,
      materialRevenue: Math.round(materialRevenue * 100) / 100,
      materialCost: Math.round(materialCost * 100) / 100,
      billableTotal: Math.round(billableTotal * 100) / 100,
      grossMargin: Math.round(grossMargin * 100) / 100,
    }
  }

  const handleCreateJob = async (event: React.FormEvent) => {
    event.preventDefault()
    const laborNum = Number(newLabor)
    if (!newTitle.trim()) return
    if (!Number.isFinite(laborNum) || laborNum < 0) {
      toast.error('Invalid labor total', 'Enter a non-negative labor amount.')
      return
    }

    const checklist: JobChecklistItem[] = (
      INDUSTRY_CHECKLIST_PRESETS[checklistPreset] ?? []
    ).map(title => ({ title, done: false }))

    setCreatingJob(true)
    try {
      const res = await opsCommand(
        workspaceId,
        'job_save',
        {
          customer_id: newCustomerId || null,
          assigned_to: newAssignedTo || null,
          title: newTitle.trim(),
          priority: newPriority,
          notes: newNotes.trim() || null,
          labor_total: Math.round(laborNum * 100) / 100,
          checklist,
        },
        createJobKeyRef.current,
      )
      setCreateOpen(false)
      setNewTitle('')
      setNewLabor('0')
      setNewNotes('')
      toast.success('Work order created', 'Open the job to allocate materials or issue a quote.')
      await onJobsChanged()
      if (res.id) {
        setInspectJobId(res.id)
      }
    } catch (err) {
      toast.error('Could not create work order', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setCreatingJob(false)
    }
  }

  const handleTransitionJob = async (
    job: OpsJob,
    nextStatus: Exclude<JobStatus, 'draft'>,
    extra?: { approval_evidence?: string; checklist_confirmed?: boolean },
  ) => {
    if (busyAction) return
    if (nextStatus === 'completed') {
      const incomplete = (job.checklist ?? []).some(step => !step.done)
      if (incomplete) {
        toast.error(
          'Checklist incomplete',
          'Check off every field checklist item before marking this job completed.',
        )
        return
      }
    }
    if (nextStatus === 'approved' && (!extra?.approval_evidence || extra.approval_evidence.trim().length < 5)) {
      toast.error(
        'Approval evidence required',
        'Enter customer approval evidence (5+ characters) before approving.',
      )
      return
    }

    setBusyAction(true)
    try {
      await opsCommand(
        workspaceId,
        'job_transition',
        {
          id: job.id,
          status: nextStatus,
          approval_evidence: extra?.approval_evidence?.trim(),
          checklist_confirmed: nextStatus === 'completed' ? true : undefined,
        },
        createIdempotencyKey(),
      )
      toast.success(`Job moved to ${nextStatus}`, job.title)
      await onJobsChanged()
    } catch (err) {
      toast.error('Transition blocked', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyAction(false)
    }
  }

  const handleToggleChecklist = async (job: OpsJob, index: number) => {
    if (busyAction || job.status === 'completed' || job.status === 'cancelled') return
    const updatedChecklist = (job.checklist ?? []).map((item, idx) =>
      idx === index ? { ...item, done: !item.done } : item,
    )
    setBusyAction(true)
    try {
      await opsCommand(
        workspaceId,
        'job_update',
        {
          id: job.id,
          assigned_to: job.assigned_to,
          notes: job.notes,
          checklist: updatedChecklist,
        },
        createIdempotencyKey(),
      )
      await onJobsChanged()
    } catch (err) {
      toast.error('Checklist update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyAction(false)
    }
  }

  const handleAddChecklistStep = async (event: React.FormEvent, job: OpsJob) => {
    event.preventDefault()
    const stepTitle = newChecklistStep.trim()
    if (!stepTitle || busyAction) return
    setBusyAction(true)
    try {
      await opsCommand(
        workspaceId,
        'job_update',
        {
          id: job.id,
          assigned_to: job.assigned_to,
          notes: job.notes,
          checklist: [...(job.checklist ?? []), { title: stepTitle, done: false }],
        },
        createIdempotencyKey(),
      )
      setNewChecklistStep('')
      await onJobsChanged()
    } catch (err) {
      toast.error('Could not add step', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyAction(false)
    }
  }

  const handleReserveMaterial = async (event: React.FormEvent, job: OpsJob) => {
    event.preventDefault()
    const qty = Number(reserveQty)
    if (!reserveItemId || !Number.isFinite(qty) || qty <= 0) {
      toast.error('Invalid quantity', 'Enter a positive quantity to reserve.')
      return
    }
    setBusyAction(true)
    try {
      await opsCommand(
        workspaceId,
        'reserve_material',
        {
          id: job.id,
          item_id: reserveItemId,
          quantity: qty,
        },
        createIdempotencyKey(),
      )
      toast.success('Material reserved on job', 'Available warehouse stock updated.')
      await onJobsChanged()
    } catch (err) {
      toast.error(
        'Reservation blocked',
        err instanceof Error ? err.message : 'Check available stock or revise estimate to draft.',
      )
    } finally {
      setBusyAction(false)
    }
  }

  const handleReleaseMaterial = async (jobId: string, itemId: string) => {
    if (busyAction) return
    setBusyAction(true)
    try {
      await opsCommand(
        workspaceId,
        'release_material',
        { id: jobId, item_id: itemId },
        createIdempotencyKey(),
      )
      toast.info('Material reservation released')
      await onJobsChanged()
    } catch (err) {
      toast.error(
        'Release blocked',
        err instanceof Error ? err.message : 'Materials can only be changed while job is in draft.',
      )
    } finally {
      setBusyAction(false)
    }
  }

  const handleSaveServiceDetails = async (event: React.FormEvent, job: OpsJob) => {
    event.preventDefault()
    setBusyAction(true)
    try {
      const nextDetails: Record<string, string> = {
        ...(job.service_details ?? {}),
      }
      if (equipModel.trim()) nextDetails.equipment = equipModel.trim()
      if (equipSerial.trim()) nextDetails.serial = equipSerial.trim()

      await opsCommand(
        workspaceId,
        'job_details',
        {
          id: job.id,
          service_details: nextDetails,
        },
        createIdempotencyKey(),
      )
      toast.success('Equipment details saved')
      await onJobsChanged()
    } catch (err) {
      toast.error('Could not save details', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyAction(false)
    }
  }

  const handleAddAttachment = async (event: React.FormEvent, job: OpsJob) => {
    event.preventDefault()
    const cleanName = attachName.trim()
    const cleanUrl = attachUrl.trim()
    if (!cleanName || !cleanUrl.startsWith('https://')) {
      toast.error(
        'HTTPS URL required',
        'Attachment references must include a label and begin with https://.',
      )
      return
    }
    setBusyAction(true)
    try {
      await opsCommand(
        workspaceId,
        'attachment_add',
        {
          job_id: job.id,
          name: cleanName,
          url: cleanUrl,
        },
        createIdempotencyKey(),
      )
      setAttachName('')
      setAttachUrl('')
      toast.success('Job attachment linked', cleanName)
      await onJobsChanged()
    } catch (err) {
      toast.error('Attachment error', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyAction(false)
    }
  }

  return (
    <div className="space-y-4">
      <section aria-label="Work orders and jobs pipeline" className="exec-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'All Jobs'],
                ['draft', 'Draft'],
                ['quoted', 'Quoted'],
                ['approved', 'Approved'],
                ['scheduled', 'Scheduled'],
                ['in_progress', 'In Progress'],
                ['completed', 'Completed'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setStatusFilter(key)
                  setPage(0)
                }}
                className={`touch-target rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === key
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              createJobKeyRef.current = createIdempotencyKey()
              setCreateOpen(true)
            }}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New Work Order
          </button>
        </div>

        {pagedJobs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Wrench className="h-5 w-5" />}
              title="No work orders in this stage"
              description="Create a draft work order, reserve truck/warehouse parts, issue a quote snapshot, and dispatch a technician."
              action={
                <button
                  type="button"
                  onClick={() => {
                    createJobKeyRef.current = createIdempotencyKey()
                    setCreateOpen(true)
                  }}
                  className="exec-btn-primary !text-xs touch-target"
                >
                  Create Work Order
                </button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {pagedJobs.map(job => {
              const cust = job.customer_id ? customersById.get(job.customer_id) : undefined
              const tech = teamMembers.find(m => m.user_id === job.assigned_to)
              const fin = computeFinancials(job)
              const doneSteps = (job.checklist ?? []).filter(c => c.done).length
              const totalSteps = (job.checklist ?? []).length

              return (
                <li
                  key={job.id}
                  className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusBadgeTone(job.status)}>{job.status}</Badge>
                      <Badge
                        tone={
                          job.priority === 'urgent'
                            ? 'rose'
                            : job.priority === 'high'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {job.priority}
                      </Badge>
                      <span className="text-sm font-bold text-slate-900">{job.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 tabular-nums">
                      {cust ? customerDisplayName(cust) : 'Unassigned Customer'} · Tech:{' '}
                      <strong>{tech?.display_name ?? 'Unassigned'}</strong>
                      {totalSteps > 0 ? ` · Checklist ${doneSteps}/${totalSteps}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="mr-2 text-right tabular-nums">
                      <span className="block text-sm font-extrabold text-slate-950">
                        {formatCurrency(fin.billableTotal)}
                      </span>
                      <span className="block text-[11px] text-emerald-700">
                        Margin {formatCurrency(fin.grossMargin)}
                      </span>
                    </div>

                    {(job.status === 'approved' || job.status === 'scheduled') ? (
                      <button
                        type="button"
                        onClick={() => onOpenScheduleForJob(job.id)}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Schedule
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => openInspector(job)}
                      className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                    >
                      Manage Job →
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          currentCount={pagedJobs.length}
          hasMore={(page + 1) * PAGE_SIZE < filteredJobs.length}
          onPageChange={setPage}
          label="Jobs"
        />
      </section>

      {/* Slide-Over Job Lifecycle, Materials, Checklist & Attachments Drawer */}
      <Dialog
        open={inspectedJob !== null}
        onClose={() => setInspectJobId(null)}
        variant="drawer"
        title={inspectedJob ? inspectedJob.title : 'Manage Work Order'}
        description="Full lifecycle transitions, reserved job materials, field checklist, equipment metadata, and HTTPS attachments."
      >
        {inspectedJob ? (
          (() => {
            const fin = computeFinancials(inspectedJob)
            const jobAttachments = attachments.filter(a => a.job_id === inspectedJob.id)
            const isClosed =
              inspectedJob.status === 'completed' || inspectedJob.status === 'cancelled'

            return (
              <div className="space-y-6">
                {/* Financial Margin Bar */}
                <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs tabular-nums">
                  <div>
                    <span className="block text-slate-500">Billable Total</span>
                    <strong className="text-base text-slate-950">
                      {formatCurrency(fin.billableTotal)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-slate-500">Parts Cost</span>
                    <strong className="text-base text-slate-800">
                      {formatCurrency(fin.materialCost)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-emerald-800">Gross Margin</span>
                    <strong className="text-base text-emerald-700">
                      {formatCurrency(fin.grossMargin)}
                    </strong>
                  </div>
                </div>

                {/* Lifecycle Transitions */}
                <div className="space-y-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Stage Transitions (Current: {inspectedJob.status})
                  </span>

                  {inspectedJob.status === 'quoted' ? (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                      <label htmlFor="job-approve-ev" className="exec-label">
                        Customer Approval Evidence (5+ chars)
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          id="job-approve-ev"
                          type="text"
                          value={approvalEvidenceInput}
                          onChange={e => setApprovalEvidenceInput(e.target.value)}
                          placeholder="Signed proposal or email confirmation"
                          className="exec-input !text-xs flex-1"
                        />
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() =>
                            void handleTransitionJob(inspectedJob, 'approved', {
                              approval_evidence: approvalEvidenceInput,
                            })
                          }
                          className="exec-btn-emerald !px-3.5 !py-2 !text-xs touch-target"
                        >
                          Approve Estimate
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {inspectedJob.status === 'draft' ? (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleTransitionJob(inspectedJob, 'quoted')}
                        className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
                      >
                        Issue Quote Snapshot (→ Quoted)
                      </button>
                    ) : null}

                    {inspectedJob.status === 'approved' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setInspectJobId(null)
                            onOpenScheduleForJob(inspectedJob.id)
                          }}
                          className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
                        >
                          Schedule Technician
                        </button>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => void handleTransitionJob(inspectedJob, 'in_progress')}
                          className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
                        >
                          Start Work Immediately
                        </button>
                      </>
                    ) : null}

                    {inspectedJob.status === 'scheduled' ? (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleTransitionJob(inspectedJob, 'in_progress')}
                        className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
                      >
                        Start On-Site Work (→ In Progress)
                      </button>
                    ) : null}

                    {inspectedJob.status === 'in_progress' ? (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          void handleTransitionJob(inspectedJob, 'completed', {
                            checklist_confirmed: true,
                          })
                        }
                        className="exec-btn-emerald !px-3.5 !py-2 !text-xs touch-target"
                      >
                        Complete Job & Draft Invoice
                      </button>
                    ) : null}

                    {!isClosed ? (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleTransitionJob(inspectedJob, 'cancelled')}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs text-rose-700 touch-target"
                      >
                        Cancel Job
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Field Checklist */}
                <div className="space-y-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Field Quality Checklist
                  </span>
                  <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                    {(inspectedJob.checklist ?? []).map((step, idx) => (
                      <li key={`${step.title}-${idx}`}>
                        <button
                          type="button"
                          disabled={isClosed || busyAction}
                          onClick={() => void handleToggleChecklist(inspectedJob, idx)}
                          className="touch-target flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-50"
                        >
                          {step.done ? (
                            <CheckSquare className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <Square className="h-4 w-4 shrink-0 text-slate-400" />
                          )}
                          <span
                            className={
                              step.done ? 'line-through text-slate-500' : 'font-medium text-slate-900'
                            }
                          >
                            {step.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>

                  {!isClosed ? (
                    <form
                      onSubmit={e => void handleAddChecklistStep(e, inspectedJob)}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={newChecklistStep}
                        onChange={e => setNewChecklistStep(e.target.value)}
                        placeholder="Add checklist step…"
                        aria-label="New checklist step"
                        className="exec-input !text-xs flex-1"
                      />
                      <button
                        type="submit"
                        disabled={busyAction || !newChecklistStep.trim()}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        Add Step
                      </button>
                    </form>
                  ) : null}
                </div>

                {/* Materials Reservation (`reserve_material`, `release_material`) */}
                <div className="space-y-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Allocated Parts & Materials
                  </span>
                  {fin.mats.length === 0 ? (
                    <p className="text-xs text-slate-500">No inventory SKUs reserved on this job.</p>
                  ) : (
                    <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                      {fin.mats.map(mat => {
                        const sku = inventoryById.get(mat.item_id)
                        return (
                          <li
                            key={mat.item_id}
                            className="flex items-center justify-between gap-2 p-3"
                          >
                            <div>
                              <p className="font-semibold text-slate-900">
                                {sku ? `${sku.sku} — ${sku.name}` : mat.item_id.slice(0, 8)}
                              </p>
                              <p className="text-slate-500 tabular-nums">
                                Qty {mat.quantity} × {formatCurrency(mat.unit_price)} ({mat.state})
                              </p>
                            </div>
                            {inspectedJob.status === 'draft' && mat.state === 'reserved' ? (
                              <button
                                type="button"
                                disabled={busyAction}
                                onClick={() =>
                                  void handleReleaseMaterial(inspectedJob.id, mat.item_id)
                                }
                                aria-label="Release reserved material"
                                className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {inspectedJob.status === 'draft' ? (
                    <form
                      onSubmit={e => void handleReserveMaterial(e, inspectedJob)}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                    >
                      <select
                        aria-label="Select SKU to reserve"
                        value={reserveItemId}
                        onChange={e => setReserveItemId(e.target.value)}
                        className="exec-input !text-xs sm:col-span-7"
                      >
                        <option value="">Select available SKU…</option>
                        {inventoryItems
                          .filter(i => !i.archived && i.quantity - i.reserved > 0)
                          .map(i => (
                            <option key={i.id} value={i.id}>
                              {i.sku} · {i.name} ({i.quantity - i.reserved} avail)
                            </option>
                          ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        aria-label="Quantity to reserve"
                        value={reserveQty}
                        onChange={e => setReserveQty(e.target.value)}
                        className="exec-input !text-xs tabular-nums sm:col-span-2"
                      />
                      <button
                        type="submit"
                        disabled={busyAction || !reserveItemId}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs sm:col-span-3 touch-target"
                      >
                        <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Reserve
                      </button>
                    </form>
                  ) : !isClosed ? (
                    <p className="text-[11px] text-slate-500">
                      Materials are locked once quoted. Use Revise Estimate in Pipeline & Quotes to
                      adjust reserved parts.
                    </p>
                  ) : null}
                </div>

                {/* Equipment Service Details (`job_details`) */}
                {!isClosed ? (
                  <form
                    onSubmit={e => void handleSaveServiceDetails(e, inspectedJob)}
                    className="space-y-2.5 rounded-xl border border-slate-200 p-3.5"
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Equipment Metadata
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        placeholder="Equipment / Model"
                        aria-label="Equipment model"
                        value={equipModel}
                        onChange={e => setEquipModel(e.target.value)}
                        className="exec-input !text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Serial / Asset Tag"
                        aria-label="Equipment serial"
                        value={equipSerial}
                        onChange={e => setEquipSerial(e.target.value)}
                        className="exec-input !text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                    >
                      Save Equipment Metadata
                    </button>
                  </form>
                ) : null}

                {/* HTTPS Job Attachments (`attachment_add`) */}
                <div className="space-y-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    HTTPS Attachments ({jobAttachments.length})
                  </span>
                  {jobAttachments.length > 0 ? (
                    <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                      {jobAttachments.map(att => (
                        <li key={att.id} className="flex items-center justify-between gap-2 p-2.5">
                          <span className="truncate font-semibold text-slate-900">{att.name}</span>
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
                          >
                            Open
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <form
                    onSubmit={e => void handleAddAttachment(e, inspectedJob)}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                  >
                    <input
                      type="text"
                      placeholder="Photo / Spec label"
                      aria-label="Attachment label"
                      value={attachName}
                      onChange={e => setAttachName(e.target.value)}
                      className="exec-input !text-xs sm:col-span-4"
                    />
                    <input
                      type="url"
                      placeholder="https://..."
                      aria-label="HTTPS attachment URL"
                      value={attachUrl}
                      onChange={e => setAttachUrl(e.target.value)}
                      className="exec-input !text-xs sm:col-span-5"
                    />
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs sm:col-span-3 touch-target"
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Attach
                    </button>
                  </form>
                </div>
              </div>
            )
          })()
        ) : null}
      </Dialog>

      {/* New Work Order Modal */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Work Order"
        description="Creates a new draft job in ops_jobs via ops_command('job_save')."
      >
        <form onSubmit={handleCreateJob} className="space-y-4">
          <div>
            <label htmlFor="job-new-title" className="exec-label">
              Job Title / Scope
            </label>
            <input
              id="job-new-title"
              type="text"
              required
              placeholder="e.g., Rooftop Package Unit Compressor & Contactor Service"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="job-new-cust" className="exec-label">
                Customer
              </label>
              <select
                id="job-new-cust"
                value={newCustomerId}
                onChange={e => setNewCustomerId(e.target.value)}
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
              <label htmlFor="job-new-tech" className="exec-label">
                Assigned Technician
              </label>
              <select
                id="job-new-tech"
                value={newAssignedTo}
                onChange={e => setNewAssignedTo(e.target.value)}
                className="exec-input"
              >
                <option value="">Unassigned</option>
                {teamMembers.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.user_id.slice(0, 8)} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="job-new-prio" className="exec-label">
                Priority
              </label>
              <select
                id="job-new-prio"
                value={newPriority}
                onChange={e => setNewPriority(e.target.value as JobPriority)}
                className="exec-input"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label htmlFor="job-new-labor" className="exec-label">
                Labor Total ($)
              </label>
              <input
                id="job-new-labor"
                type="number"
                required
                min={0}
                step="0.01"
                value={newLabor}
                onChange={e => setNewLabor(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="job-new-preset" className="exec-label">
                Checklist Template
              </label>
              <select
                id="job-new-preset"
                value={checklistPreset}
                onChange={e => setChecklistPreset(e.target.value)}
                className="exec-input"
              >
                <option value="hvac">HVAC</option>
                <option value="plumbing">Plumbing</option>
                <option value="electrical">Electrical</option>
                <option value="general">General Service</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="job-new-notes" className="exec-label">
              Access / Dispatch Notes
            </label>
            <textarea
              id="job-new-notes"
              rows={2}
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
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
              disabled={creatingJob}
              className="exec-btn-primary touch-target"
            >
              {creatingJob ? 'Creating…' : 'Create Work Order'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
