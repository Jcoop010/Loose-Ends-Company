import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react'
import { customerDisplayName, formatDateTime, parseIsoMs } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import type {
  Appointment,
  Customer,
  OpsJob,
  OpsTeamMemberStatus,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface DispatchCalendarProps {
  workspaceId: string
  appointments: Appointment[]
  jobs: OpsJob[]
  customersById: ReadonlyMap<string, Customer>
  teamMembers: OpsTeamMemberStatus[]
  preselectedJobId?: string | null
  onClearPreselectedJob?: () => void
  timezone?: string | null
  onCalendarChanged: () => Promise<void> | void
}

function toLocalDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toDatetimeLocalValue(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultDispatchWindowForDate(dateKey: string): { start: string; end: string } {
  return {
    start: `${dateKey}T09:00`,
    end: `${dateKey}T11:00`,
  }
}

export function DispatchCalendar({
  workspaceId,
  appointments,
  jobs,
  customersById,
  teamMembers,
  preselectedJobId,
  onClearPreselectedJob,
  timezone,
  onCalendarChanged,
}: DispatchCalendarProps): React.ReactElement {
  const toast = useToast()

  const [viewMode, setViewMode] = useState<'month' | 'day'>('month')
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date())
  const selectedDayKey = toLocalDateKey(cursorDate)

  // Schedule Approved Job Modal (`schedule_job`)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [schedStart, setSchedStart] = useState(() => defaultDispatchWindowForDate(selectedDayKey).start)
  const [schedEnd, setSchedEnd] = useState(() => defaultDispatchWindowForDate(selectedDayKey).end)
  const [schedError, setSchedError] = useState<string | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const schedKeyRef = useRef<string>(createIdempotencyKey())

  // Edit / Cancel Existing Appointment Modal (`booking_update`)
  const [editAppt, setEditAppt] = useState<Appointment | null>(null)
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editWorker, setEditWorker] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [updatingBooking, setUpdatingBooking] = useState(false)
  const editKeyRef = useRef<string>(createIdempotencyKey())

  const schedulableJobs = useMemo(
    () => jobs.filter(j => j.status === 'approved' || j.status === 'scheduled'),
    [jobs],
  )

  // Automatically open Schedule Job modal when triggered from JobsPipelinePanel
  useEffect(() => {
    if (!preselectedJobId) return
    schedKeyRef.current = createIdempotencyKey()
    setSelectedJobId(preselectedJobId)
    const win = defaultDispatchWindowForDate(toLocalDateKey(new Date(Date.now() + 86_400_000)))
    setSchedStart(win.start)
    setSchedEnd(win.end)
    setSchedError(null)
    setScheduleOpen(true)
    onClearPreselectedJob?.()
  }, [preselectedJobId, onClearPreselectedJob])

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appt of appointments) {
      const ms = parseIsoMs(appt.starts_at)
      if (ms === null) continue
      const key = toLocalDateKey(new Date(ms))
      const bucket = map.get(key) ?? []
      bucket.push(appt)
      map.set(key, bucket)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (parseIsoMs(a.starts_at) ?? 0) - (parseIsoMs(b.starts_at) ?? 0))
    }
    return map
  }, [appointments])

  const monthCells = useMemo(() => {
    const year = cursorDate.getFullYear()
    const month = cursorDate.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    const startOffset = firstOfMonth.getDay()
    const gridStart = new Date(year, month, 1 - startOffset)

    return Array.from({ length: 42 }, (_, idx) => {
      const cellDate = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + idx,
      )
      const key = toLocalDateKey(cellDate)
      return {
        date: cellDate,
        key,
        inCurrentMonth: cellDate.getMonth() === month,
        bookings: appointmentsByDay.get(key) ?? [],
      }
    })
  }, [cursorDate, appointmentsByDay])

  const dayBookings = appointmentsByDay.get(selectedDayKey) ?? []

  const shiftCursor = (delta: number) => {
    setCursorDate(prev => {
      if (viewMode === 'month') {
        return new Date(prev.getFullYear(), prev.getMonth() + delta, 1)
      }
      return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + delta)
    })
  }

  const handleScheduleJob = async (event: React.FormEvent) => {
    event.preventDefault()
    setSchedError(null)
    if (!selectedJobId) {
      setSchedError('Choose an approved work order to schedule.')
      return
    }
    const startIso = new Date(schedStart).toISOString()
    const endIso = new Date(schedEnd).toISOString()
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      setSchedError('End time must be after start time.')
      return
    }

    setScheduling(true)
    try {
      await opsCommand(
        workspaceId,
        'schedule_job',
        {
          id: selectedJobId,
          starts_at: startIso,
          ends_at: endIso,
        },
        schedKeyRef.current,
      )
      setScheduleOpen(false)
      toast.success('Job scheduled on dispatch calendar', 'Conflict & hours check passed.')
      await onCalendarChanged()
    } catch (err) {
      // Surface `ops_calendar_guard` overlap / business-hours / travel-buffer error directly in modal
      setSchedError(
        err instanceof Error
          ? err.message
          : 'Scheduling blocked by calendar conflict or operating hours guard.',
      )
      schedKeyRef.current = createIdempotencyKey()
    } finally {
      setScheduling(false)
    }
  }

  const openEditBooking = (appt: Appointment) => {
    editKeyRef.current = createIdempotencyKey()
    setEditAppt(appt)
    setEditStart(toDatetimeLocalValue(appt.starts_at))
    setEditEnd(
      toDatetimeLocalValue(
        appt.ends_at ?? new Date((parseIsoMs(appt.starts_at) ?? Date.now()) + 2 * 3_600_000),
      ),
    )
    setEditWorker(appt.assigned_worker ?? '')
    setEditError(null)
  }

  const handleUpdateBooking = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editAppt) return
    setEditError(null)

    const startIso = new Date(editStart).toISOString()
    const endIso = new Date(editEnd).toISOString()
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      setEditError('Appointment end time must be after start time.')
      return
    }

    setUpdatingBooking(true)
    try {
      await opsCommand(
        workspaceId,
        'booking_update',
        {
          id: editAppt.id,
          starts_at: startIso,
          ends_at: endIso,
          assigned_worker: editWorker || null,
          status: 'scheduled',
        },
        editKeyRef.current,
      )
      setEditAppt(null)
      toast.success('Dispatch booking updated')
      await onCalendarChanged()
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : 'Reschedule blocked by ops_calendar_guard conflict or business-hours check.',
      )
      editKeyRef.current = createIdempotencyKey()
    } finally {
      setUpdatingBooking(false)
    }
  }

  const handleCancelBooking = async () => {
    if (!editAppt || updatingBooking) return
    setEditError(null)
    setUpdatingBooking(true)
    try {
      await opsCommand(
        workspaceId,
        'booking_update',
        {
          id: editAppt.id,
          status: 'cancelled',
        },
        createIdempotencyKey(),
      )
      setEditAppt(null)
      toast.info('Booking cancelled', 'Linked scheduled job returned to approved status.')
      await onCalendarChanged()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to cancel booking.')
    } finally {
      setUpdatingBooking(false)
    }
  }

  const headingLabel =
    viewMode === 'month'
      ? cursorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : cursorDate.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })

  return (
    <div className="space-y-4">
      {/* Calendar Header & Controls */}
      <section aria-label="Dispatch schedule calendar" className="exec-surface p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftCursor(-1)}
              aria-label={viewMode === 'month' ? 'Previous month' : 'Previous day'}
              className="exec-btn-secondary !p-2 touch-target"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h2 className="min-w-[180px] text-center text-base font-bold text-slate-900">
              {headingLabel}
            </h2>
            <button
              type="button"
              onClick={() => shiftCursor(1)}
              aria-label={viewMode === 'month' ? 'Next month' : 'Next day'}
              className="exec-btn-secondary !p-2 touch-target"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={`touch-target rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  viewMode === 'month' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode('day')}
                className={`touch-target rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  viewMode === 'day' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                DayAgenda
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                schedKeyRef.current = createIdempotencyKey()
                setSelectedJobId(schedulableJobs[0]?.id ?? '')
                const win = defaultDispatchWindowForDate(selectedDayKey)
                setSchedStart(win.start)
                setSchedEnd(win.end)
                setSchedError(null)
                setScheduleOpen(true)
              }}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Schedule Approved Job
            </button>
          </div>
        </div>

        {/* Month Grid */}
        {viewMode === 'month' ? (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 border-b border-slate-200 pb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day}>{day}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden mt-2">
                {monthCells.map(cell => {
                  const isSelected = cell.key === selectedDayKey
                  return (
                    <div
                      key={cell.key}
                      className={`min-h-[96px] bg-white p-2 flex flex-col justify-between ${
                        !cell.inCurrentMonth ? 'bg-slate-50/70 text-slate-400' : ''
                      } ${isSelected ? 'ring-2 ring-inset ring-[#ea580c]' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setCursorDate(cell.date)
                            setViewMode('day')
                          }}
                          className="h-6 w-6 rounded-full text-xs font-bold hover:bg-slate-100 tabular-nums"
                        >
                          {cell.date.getDate()}
                        </button>
                        {cell.bookings.length > 0 ? (
                          <span className="text-[10px] font-bold text-[#c2410c] tabular-nums">
                            {cell.bookings.length}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 space-y-1">
                        {cell.bookings.slice(0, 2).map(appt => (
                          <button
                            key={appt.id}
                            type="button"
                            onClick={() => openEditBooking(appt)}
                            className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${
                              appt.status === 'cancelled' || appt.status === 'canceled'
                                ? 'bg-slate-100 text-slate-400 line-through'
                                : appt.status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-900'
                                  : 'bg-[#fff7ed] text-[#9a3412] hover:bg-orange-100'
                            }`}
                          >
                            {appt.title}
                          </button>
                        ))}
                        {cell.bookings.length > 2 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCursorDate(cell.date)
                              setViewMode('day')
                            }}
                            className="text-[10px] font-semibold text-slate-500 hover:text-slate-900"
                          >
                            +{cell.bookings.length - 2} more
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Day Schedule View */
          <div className="space-y-3">
            {dayBookings.length === 0 ? (
              <EmptyState
                icon={<CalendarIcon className="h-5 w-5" />}
                title="No dispatches scheduled for this date"
                description="Schedule an approved work order into an open technician window."
              />
            ) : (
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {dayBookings.map(appt => {
                  const cust = appt.customer_id ? customersById.get(appt.customer_id) : undefined
                  const tech = teamMembers.find(m => m.user_id === appt.assigned_worker)
                  return (
                    <li
                      key={appt.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              appt.status === 'completed'
                                ? 'emerald'
                                : appt.status === 'cancelled' || appt.status === 'canceled'
                                  ? 'neutral'
                                  : 'sky'
                            }
                          >
                            {appt.status}
                          </Badge>
                          <span className="text-sm font-bold text-slate-900">{appt.title}</span>
                        </div>
                        <p className="text-xs text-slate-600 tabular-nums">
                          <Clock className="inline h-3.5 w-3.5 mr-1 text-slate-400" />
                          {formatDateTime(appt.starts_at, timezone)}
                          {appt.ends_at ? ` – ${formatDateTime(appt.ends_at, timezone)}` : ''} ·{' '}
                          {cust ? customerDisplayName(cust) : 'Customer'} · Tech:{' '}
                          <strong>{tech?.display_name ?? 'Unassigned'}</strong>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => openEditBooking(appt)}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target self-start sm:self-auto"
                      >
                        Reschedule / Edit
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Schedule Approved Job Modal (`schedule_job`) */}
      <Dialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule Approved Work Order"
        description="Enforced by PostgreSQL ops_calendar_guard (checks overlaps, travel buffers, shift availability, and business hours)."
      >
        <form onSubmit={handleScheduleJob} className="space-y-4">
          {schedError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              <span>{schedError}</span>
            </div>
          ) : null}

          {schedulableJobs.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              No approved jobs are waiting for scheduling. Record customer approval on a quoted job
              first.
            </p>
          ) : (
            <div>
              <label htmlFor="sched-job-select" className="exec-label">
                Approved Work Order
              </label>
              <select
                id="sched-job-select"
                required
                value={selectedJobId}
                onChange={e => setSelectedJobId(e.target.value)}
                className="exec-input"
              >
                <option value="">Select approved job…</option>
                {schedulableJobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.title} ({j.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sched-start" className="exec-label">
                Start Window
              </label>
              <input
                id="sched-start"
                type="datetime-local"
                required
                value={schedStart}
                onChange={e => setSchedStart(e.target.value)}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="sched-end" className="exec-label">
                End Window
              </label>
              <input
                id="sched-end"
                type="datetime-local"
                required
                value={schedEnd}
                onChange={e => setSchedEnd(e.target.value)}
                className="exec-input"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setScheduleOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={scheduling || schedulableJobs.length === 0}
              className="exec-btn-primary touch-target"
            >
              {scheduling ? 'Checking Conflicts…' : 'Confirm Dispatch Slot'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Reschedule / Cancel Booking Modal (`booking_update`) */}
      <Dialog
        open={editAppt !== null}
        onClose={() => setEditAppt(null)}
        title={editAppt ? `Booking: ${editAppt.title}` : 'Edit Booking'}
        description="Reschedule window, reassign technician, or cancel this booking via ops_command('booking_update')."
      >
        {editAppt ? (
          <form onSubmit={handleUpdateBooking} className="space-y-4">
            {editError ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-900"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                <span>{editError}</span>
              </div>
            ) : null}

            <div>
              <label htmlFor="booking-worker" className="exec-label">
                Assigned Technician
              </label>
              <select
                id="booking-worker"
                value={editWorker}
                onChange={e => setEditWorker(e.target.value)}
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="booking-start" className="exec-label">
                  Start Window
                </label>
                <input
                  id="booking-start"
                  type="datetime-local"
                  required
                  value={editStart}
                  onChange={e => setEditStart(e.target.value)}
                  className="exec-input"
                />
              </div>
              <div>
                <label htmlFor="booking-end" className="exec-label">
                  End Window
                </label>
                <input
                  id="booking-end"
                  type="datetime-local"
                  required
                  value={editEnd}
                  onChange={e => setEditEnd(e.target.value)}
                  className="exec-input"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {editAppt.status !== 'cancelled' && editAppt.status !== 'canceled' ? (
                <button
                  type="button"
                  disabled={updatingBooking}
                  onClick={() => void handleCancelBooking()}
                  className="exec-btn-secondary !text-rose-700 touch-target"
                >
                  Cancel Booking
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditAppt(null)}
                  className="exec-btn-secondary touch-target"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={updatingBooking}
                  className="exec-btn-primary touch-target"
                >
                  {updatingBooking ? 'Updating…' : 'Save Booking'}
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  )
}
