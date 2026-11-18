import React, { useRef, useState } from 'react'
import { CalendarOff, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { formatDateTime } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import type {
  OpsAvailability,
  OpsTeamMemberStatus,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface TeamAvailabilityPanelProps {
  workspaceId: string
  teamMembers: OpsTeamMemberStatus[]
  availabilityBlocks: OpsAvailability[]
  timezone?: string | null
  onTeamChanged: () => Promise<void> | void
}

function defaultShiftRange(): { start: string; end: string } {
  const base = new Date(Date.now() + 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const datePart = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
  return {
    start: `${datePart}T08:00`,
    end: `${datePart}T17:00`,
  }
}

export function TeamAvailabilityPanel({
  workspaceId,
  teamMembers,
  availabilityBlocks,
  timezone,
  onTeamChanged,
}: TeamAvailabilityPanelProps): React.ReactElement {
  const toast = useToast()

  // Edit Member Profile Modal (`employee_save`)
  const [editMember, setEditMember] = useState<OpsTeamMemberStatus | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [memberActive, setMemberActive] = useState(true)
  const [savingEmployee, setSavingEmployee] = useState(false)
  const empKeyRef = useRef<string>(createIdempotencyKey())

  // Add Shift / PTO Block Modal (`availability_save`)
  const initialRange = defaultShiftRange()
  const [availOpen, setAvailOpen] = useState(false)
  const [availUserId, setAvailUserId] = useState(teamMembers[0]?.user_id ?? '')
  const [availStart, setAvailStart] = useState(initialRange.start)
  const [availEnd, setAvailEnd] = useState(initialRange.end)
  const [availKind, setAvailKind] = useState<'leave' | 'shift'>('leave')
  const [availReason, setAvailReason] = useState('')
  const [savingAvail, setSavingAvail] = useState(false)
  const [removingAvailId, setRemovingAvailId] = useState<string | null>(null)
  const availKeyRef = useRef<string>(createIdempotencyKey())

  const openEmployeeModal = (member: OpsTeamMemberStatus) => {
    empKeyRef.current = createIdempotencyKey()
    setEditMember(member)
    setDisplayName(member.display_name ?? '')
    setJobTitle(member.job_title ?? '')
    setPhone(member.phone ?? '')
    setSkillsText((member.skills ?? []).join(', '))
    setMemberActive(member.active)
  }

  const handleSaveEmployee = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editMember || !displayName.trim()) return
    const skills = skillsText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    setSavingEmployee(true)
    try {
      await opsCommand(
        workspaceId,
        'employee_save',
        {
          user_id: editMember.user_id,
          display_name: displayName.trim(),
          job_title: jobTitle.trim() || null,
          phone: phone.trim() || null,
          skills,
          active: memberActive,
        },
        empKeyRef.current,
      )
      setEditMember(null)
      toast.success('Technician profile saved', displayName.trim())
      await onTeamChanged()
    } catch (err) {
      toast.error('Could not update profile', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingEmployee(false)
    }
  }

  const handleSaveAvailability = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!availUserId) return
    const startIso = new Date(availStart).toISOString()
    const endIso = new Date(availEnd).toISOString()
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      toast.error('Invalid window', 'End time must be after start time.')
      return
    }

    setSavingAvail(true)
    try {
      await opsCommand(
        workspaceId,
        'availability_save',
        {
          user_id: availUserId,
          starts_at: startIso,
          ends_at: endIso,
          available: availKind === 'shift',
          reason: availReason.trim() || (availKind === 'leave' ? 'Time off / unavailable' : 'Shift window'),
        },
        availKeyRef.current,
      )
      setAvailOpen(false)
      setAvailReason('')
      toast.success(
        availKind === 'leave' ? 'Unavailable block added' : 'Shift availability saved',
        'Enforced automatically by ops_calendar_guard.',
      )
      await onTeamChanged()
    } catch (err) {
      toast.error('Could not save block', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingAvail(false)
    }
  }

  const handleRemoveAvailability = async (blockId: string) => {
    if (removingAvailId) return
    setRemovingAvailId(blockId)
    try {
      await opsCommand(
        workspaceId,
        'availability_remove',
        { id: blockId },
        createIdempotencyKey(),
      )
      toast.info('Availability block removed')
      await onTeamChanged()
    } catch (err) {
      toast.error('Remove failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setRemovingAvailId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Team Roster & Open Job Load (`ops_team_status` + `employee_save`) */}
      <section
        aria-label="Team roster and technician workload"
        className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4"
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Team Roster & Live Open-Job Workload
          </h2>
          <p className="text-xs text-slate-600">
            Loaded from <code>ops_team_status</code>. Inactive technicians are blocked from new
            dispatch bookings automatically.
          </p>
        </div>

        {teamMembers.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No workspace members found"
            description="Workspace owners and technicians appear here automatically."
          />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {teamMembers.map(member => (
              <li
                key={member.user_id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {member.display_name || `Member ${member.user_id.slice(0, 8)}`}
                    </span>
                    <Badge tone="neutral">{member.role}</Badge>
                    <Badge tone={member.active ? 'emerald' : 'rose'}>
                      {member.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    {[member.job_title, member.phone].filter(Boolean).join(' · ') ||
                      'Edit profile to add title, phone, and trade certifications'}
                  </p>
                  {(member.skills ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {(member.skills ?? []).map(skill => (
                        <span
                          key={skill}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-900 tabular-nums">
                    {member.open_jobs} open job(s)
                  </span>
                  <button
                    type="button"
                    onClick={() => openEmployeeModal(member)}
                    className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit Profile
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Right: Shift & Time-Off Blocks (`ops_availability`) */}
      <section
        aria-label="Technician shifts and leave blocks"
        className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Shifts & Leave Blocks</h3>
            <p className="text-xs text-slate-600">
              Guarded during scheduling by <code>ops_calendar_guard</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              availKeyRef.current = createIdempotencyKey()
              setAvailUserId(teamMembers[0]?.user_id ?? '')
              const nextRange = defaultShiftRange()
              setAvailStart(nextRange.start)
              setAvailEnd(nextRange.end)
              setAvailOpen(true)
            }}
            className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Block
          </button>
        </div>

        {availabilityBlocks.length === 0 ? (
          <EmptyState
            icon={<CalendarOff className="h-5 w-5" />}
            title="No custom shift or PTO blocks"
            description="Log technician PTO, training windows, or on-call shifts so dispatch cannot double-book."
          />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
            {availabilityBlocks.map(block => {
              const member = teamMembers.find(m => m.user_id === block.user_id)
              return (
                <li
                  key={block.id}
                  className="flex items-center justify-between gap-2 p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {member?.display_name ?? block.user_id.slice(0, 8)}
                      </span>
                      <Badge tone={block.available ? 'emerald' : 'rose'}>
                        {block.available ? 'Available Shift' : 'Unavailable / PTO'}
                      </Badge>
                    </div>
                    <p className="text-slate-600 tabular-nums">
                      {formatDateTime(block.starts_at, timezone)} →{' '}
                      {formatDateTime(block.ends_at, timezone)}
                    </p>
                    {block.reason ? <p className="text-slate-500">{block.reason}</p> : null}
                  </div>

                  <button
                    type="button"
                    disabled={removingAvailId === block.id}
                    onClick={() => void handleRemoveAvailability(block.id)}
                    aria-label="Remove availability block"
                    className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Edit Employee Profile Modal */}
      <Dialog
        open={editMember !== null}
        onClose={() => setEditMember(null)}
        title="Edit Team Member Profile"
        description="Updates ops_employee_profiles via ops_command('employee_save')."
      >
        {editMember ? (
          <form onSubmit={handleSaveEmployee} className="space-y-4">
            <div>
              <label htmlFor="emp-name" className="exec-label">
                Display Name
              </label>
              <input
                id="emp-name"
                type="text"
                required
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="exec-input"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="emp-title" className="exec-label">
                  Job Title
                </label>
                <input
                  id="emp-title"
                  type="text"
                  placeholder="Lead EPA-608 Technician"
                  value={jobTitle}
                  onChange={e => setJobTitle(e.target.value)}
                  className="exec-input"
                />
              </div>
              <div>
                <label htmlFor="emp-phone" className="exec-label">
                  Mobile Phone
                </label>
                <input
                  id="emp-phone"
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="exec-input"
                />
              </div>
            </div>

            <div>
              <label htmlFor="emp-skills" className="exec-label">
                Skills & Certifications (Comma-separated)
              </label>
              <input
                id="emp-skills"
                type="text"
                placeholder="Heat Pumps, Rooftop Units, EPA-608"
                value={skillsText}
                onChange={e => setSkillsText(e.target.value)}
                className="exec-input"
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={memberActive}
                onChange={e => setMemberActive(e.target.checked)}
                className="h-4 w-4 accent-slate-900"
              />
              Active for dispatch scheduling
            </label>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditMember(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEmployee}
                className="exec-btn-primary touch-target"
              >
                {savingEmployee ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* Add Availability / Leave Block Modal */}
      <Dialog
        open={availOpen}
        onClose={() => setAvailOpen(false)}
        title="Add Shift or Leave Block"
        description="Saved to ops_availability via ops_command('availability_save')."
      >
        <form onSubmit={handleSaveAvailability} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="avail-member" className="exec-label">
                Team Member
              </label>
              <select
                id="avail-member"
                required
                value={availUserId}
                onChange={e => setAvailUserId(e.target.value)}
                className="exec-input"
              >
                {teamMembers.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.user_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="avail-kind" className="exec-label">
                Block Type
              </label>
              <select
                id="avail-kind"
                value={availKind}
                onChange={e => setAvailKind(e.target.value as 'leave' | 'shift')}
                className="exec-input"
              >
                <option value="leave">Unavailable / PTO</option>
                <option value="shift">Available On-Call Shift</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="avail-start" className="exec-label">
                Starts At
              </label>
              <input
                id="avail-start"
                type="datetime-local"
                required
                value={availStart}
                onChange={e => setAvailStart(e.target.value)}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="avail-end" className="exec-label">
                Ends At
              </label>
              <input
                id="avail-end"
                type="datetime-local"
                required
                value={availEnd}
                onChange={e => setAvailEnd(e.target.value)}
                className="exec-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="avail-reason" className="exec-label">
              Reason / Note
            </label>
            <input
              id="avail-reason"
              type="text"
              placeholder="e.g., Manufacturer heat-pump certification class"
              value={availReason}
              onChange={e => setAvailReason(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setAvailOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingAvail}
              className="exec-btn-primary touch-target"
            >
              {savingAvail ? 'Saving…' : 'Save Block'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
