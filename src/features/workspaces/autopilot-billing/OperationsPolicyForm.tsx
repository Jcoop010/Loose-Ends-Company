import React, { useEffect, useRef, useState } from 'react'
import { Lock, Power, ShieldCheck, Sliders } from 'lucide-react'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import type { OpsIndustry, OpsPolicy } from '../../../types/domain'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const INDUSTRIES: Array<{ value: OpsIndustry; label: string }> = [
  { value: 'hvac', label: 'HVAC & Mechanical' },
  { value: 'plumbing', label: 'Plumbing & Drain' },
  { value: 'electrical', label: 'Electrical Contracting' },
  { value: 'auto_repair', label: 'Auto Repair & Fleet' },
  { value: 'general_contracting', label: 'General Contracting' },
  { value: 'landscaping', label: 'Landscaping & Grounds' },
  { value: 'home_services', label: 'Home Services' },
  { value: 'general', label: 'General Trade / Commercial' },
]

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
]

const WEEKDAYS: Array<{ day: number; label: string }> = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
]

export interface OperationsPolicyFormProps {
  workspaceId: string
  isAdminOrOwner: boolean
  policy: OpsPolicy | null
  defaultTimezone?: string | null
  onSaved: () => Promise<void> | void
}

export function OperationsPolicyForm({
  workspaceId,
  isAdminOrOwner,
  policy,
  defaultTimezone,
  onSaved,
}: OperationsPolicyFormProps): React.ReactElement {
  const toast = useToast()

  const [enabled, setEnabled] = useState<boolean>(policy?.enabled ?? false)
  const [draftLimit, setDraftLimit] = useState<string>(String(policy?.draft_limit ?? 1000))
  const [industry, setIndustry] = useState<OpsIndustry>(policy?.industry ?? 'hvac')
  const [coordinateEnabled, setCoordinateEnabled] = useState<boolean>(
    policy?.coordinate_enabled ?? false,
  )
  const [timezone, setTimezone] = useState<string>(
    policy?.timezone ?? defaultTimezone ?? 'America/New_York',
  )
  const [businessStart, setBusinessStart] = useState<string>(
    (policy?.business_start ?? '08:00').slice(0, 5),
  )
  const [businessEnd, setBusinessEnd] = useState<string>(
    (policy?.business_end ?? '18:00').slice(0, 5),
  )
  const [businessDays, setBusinessDays] = useState<number[]>(
    policy?.business_days && policy.business_days.length > 0
      ? policy.business_days
      : [1, 2, 3, 4, 5],
  )
  const [enforceHours, setEnforceHours] = useState<boolean>(policy?.enforce_hours ?? false)
  const [travelBuffer, setTravelBuffer] = useState<string>(String(policy?.travel_buffer ?? 30))

  const [savingCore, setSavingCore] = useState(false)
  const [savingCoord, setSavingCoord] = useState(false)

  const coreKeyRef = useRef<string>(createIdempotencyKey())
  const coordKeyRef = useRef<string>(createIdempotencyKey())

  useEffect(() => {
    if (!policy) return
    setEnabled(policy.enabled)
    setDraftLimit(String(policy.draft_limit))
    setIndustry(policy.industry)
    setCoordinateEnabled(policy.coordinate_enabled)
    setTimezone(policy.timezone)
    setBusinessStart(policy.business_start.slice(0, 5))
    setBusinessEnd(policy.business_end.slice(0, 5))
    setBusinessDays(
      policy.business_days && policy.business_days.length > 0
        ? policy.business_days
        : [1, 2, 3, 4, 5],
    )
    setEnforceHours(policy.enforce_hours)
    setTravelBuffer(String(policy.travel_buffer))
  }, [policy])

  const toggleBusinessDay = (day: number) => {
    setBusinessDays(prev => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev // Keep at least 1 operating day per DB constraint
        return prev.filter(d => d !== day)
      }
      return [...prev, day].sort((a, b) => a - b)
    })
    coordKeyRef.current = createIdempotencyKey()
  }

  const handleSaveCorePolicy = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isAdminOrOwner) return
    const limitNum = Number(draftLimit)
    if (!Number.isFinite(limitNum) || limitNum < 0) {
      toast.error('Invalid PO draft limit', 'Enter a non-negative dollar limit.')
      return
    }

    setSavingCore(true)
    try {
      await opsCommand(
        workspaceId,
        'policy_save',
        {
          enabled,
          draft_limit: Math.round(limitNum * 100) / 100,
          industry,
        },
        coreKeyRef.current,
      )
      coreKeyRef.current = createIdempotencyKey()
      toast.success(
        enabled ? 'Autopilot policy enabled' : 'Kill switch engaged — Autopilot paused',
        'Saved via ops_command(policy_save).',
      )
      await onSaved()
    } catch (err) {
      toast.error('Policy save failed', err instanceof Error ? err.message : 'Retry.')
      coreKeyRef.current = createIdempotencyKey()
    } finally {
      setSavingCore(false)
    }
  }

  const handleSaveCoordinationPolicy = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isAdminOrOwner) return

    const bufferMins = Math.trunc(Number(travelBuffer) || 0)
    if (bufferMins < 0 || bufferMins > 240) {
      toast.error('Invalid travel buffer', 'Travel buffer must be between 0 and 240 minutes.')
      return
    }
    if (businessEnd <= businessStart) {
      toast.error('Invalid business hours', 'Closing time must be later than opening time.')
      return
    }

    setSavingCoord(true)
    try {
      await opsCommand(
        workspaceId,
        'coordination_policy',
        {
          enabled,
          coordinate_enabled: coordinateEnabled,
          timezone,
          business_start: businessStart,
          business_end: businessEnd,
          business_days: businessDays,
          enforce_hours: enforceHours,
          travel_buffer: bufferMins,
          industry,
        },
        coordKeyRef.current,
      )
      coordKeyRef.current = createIdempotencyKey()
      toast.success(
        'Coordination & operating hours saved',
        `${businessStart}–${businessEnd} (${timezone})`,
      )
      await onSaved()
    } catch (err) {
      toast.error('Coordination save failed', err instanceof Error ? err.message : 'Retry.')
      coordKeyRef.current = createIdempotencyKey()
    } finally {
      setSavingCoord(false)
    }
  }

  return (
    <div className="space-y-6">
      {!isAdminOrOwner ? (
        <div
          role="note"
          className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950"
        >
          <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            Workspace owner or administrator permission is required to modify Autopilot kill-switch
            and operating-hours guardrails.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 1. Master Kill Switch & Inventory PO Policy (`policy_save`) */}
        <form
          onSubmit={handleSaveCorePolicy}
          className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Power className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">Master Autopilot & PO Guard</h2>
            </div>
            <Badge tone={enabled ? 'emerald' : 'amber'}>
              {enabled ? 'Enabled' : 'Paused (Kill Switch)'}
            </Badge>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            When enabled, Loose Ends prepares internal low-stock PO drafts up to your spending cap.
            Turning this off immediately cancels pending automation queue items.
          </p>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
            <span className="text-sm font-semibold text-slate-900">
              Enable Operations Autopilot
            </span>
            <input
              type="checkbox"
              disabled={!isAdminOrOwner || savingCore}
              checked={enabled}
              onChange={e => {
                setEnabled(e.target.checked)
                coreKeyRef.current = createIdempotencyKey()
              }}
              className="h-4 w-4 accent-[#ea580c]"
            />
          </label>

          <div>
            <label htmlFor="pol-draft-limit" className="exec-label">
              Max Auto-Draft PO Value ($)
            </label>
            <input
              id="pol-draft-limit"
              type="number"
              min={0}
              step={50}
              disabled={!isAdminOrOwner || savingCore}
              value={draftLimit}
              onChange={e => {
                setDraftLimit(e.target.value)
                coreKeyRef.current = createIdempotencyKey()
              }}
              className="exec-input tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="pol-industry" className="exec-label">
              Trade Industry Profile
            </label>
            <select
              id="pol-industry"
              disabled={!isAdminOrOwner || savingCore}
              value={industry}
              onChange={e => {
                setIndustry(e.target.value as OpsIndustry)
                coreKeyRef.current = createIdempotencyKey()
              }}
              className="exec-input"
            >
              {INDUSTRIES.map(ind => (
                <option key={ind.value} value={ind.value}>
                  {ind.label}
                </option>
              ))}
            </select>
          </div>

          {isAdminOrOwner ? (
            <button
              type="submit"
              disabled={savingCore}
              className="exec-btn-primary w-full touch-target"
            >
              {savingCore ? 'Saving Policy…' : 'Save Master Policy'}
            </button>
          ) : null}
        </form>

        {/* 2. Business Coordination & Operating Hours Guard (`coordination_policy`) */}
        <form
          onSubmit={handleSaveCoordinationPolicy}
          className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">
                Coordination & Dispatch Hours Guardrails
              </h2>
            </div>
            <Badge tone={coordinateEnabled ? 'brand' : 'neutral'}>
              {coordinateEnabled ? 'Coordinating' : 'Manual Only'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
              <span className="text-xs sm:text-sm font-semibold text-slate-900">
                Event Coordination Queue
              </span>
              <input
                type="checkbox"
                disabled={!isAdminOrOwner || savingCoord}
                checked={coordinateEnabled}
                onChange={e => {
                  setCoordinateEnabled(e.target.checked)
                  coordKeyRef.current = createIdempotencyKey()
                }}
                className="h-4 w-4 accent-[#ea580c]"
              />
            </label>

            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
              <span className="text-xs sm:text-sm font-semibold text-slate-900">
                Enforce Dispatch Hours
              </span>
              <input
                type="checkbox"
                disabled={!isAdminOrOwner || savingCoord}
                checked={enforceHours}
                onChange={e => {
                  setEnforceHours(e.target.checked)
                  coordKeyRef.current = createIdempotencyKey()
                }}
                className="h-4 w-4 accent-[#ea580c]"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="coord-tz" className="exec-label">
                Operating Timezone
              </label>
              <select
                id="coord-tz"
                disabled={!isAdminOrOwner || savingCoord}
                value={timezone}
                onChange={e => {
                  setTimezone(e.target.value)
                  coordKeyRef.current = createIdempotencyKey()
                }}
                className="exec-input"
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="coord-start" className="exec-label">
                Opens
              </label>
              <input
                id="coord-start"
                type="time"
                required
                disabled={!isAdminOrOwner || savingCoord}
                value={businessStart}
                onChange={e => {
                  setBusinessStart(e.target.value)
                  coordKeyRef.current = createIdempotencyKey()
                }}
                className="exec-input tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="coord-end" className="exec-label">
                Closes
              </label>
              <input
                id="coord-end"
                type="time"
                required
                disabled={!isAdminOrOwner || savingCoord}
                value={businessEnd}
                onChange={e => {
                  setBusinessEnd(e.target.value)
                  coordKeyRef.current = createIdempotencyKey()
                }}
                className="exec-input tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-8">
              <span className="exec-label">Operating Business Days</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(w => {
                  const active = businessDays.includes(w.day)
                  return (
                    <button
                      key={w.day}
                      type="button"
                      disabled={!isAdminOrOwner || savingCoord}
                      onClick={() => toggleBusinessDay(w.day)}
                      className={`touch-target rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'bg-[#c2410c] text-white'
                          : 'border border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      {w.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="coord-buffer" className="exec-label">
                Travel Buffer (Mins)
              </label>
              <input
                id="coord-buffer"
                type="number"
                min={0}
                max={240}
                step={5}
                disabled={!isAdminOrOwner || savingCoord}
                value={travelBuffer}
                onChange={e => {
                  setTravelBuffer(e.target.value)
                  coordKeyRef.current = createIdempotencyKey()
                }}
                className="exec-input tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              Enforced directly inside PostgreSQL trigger <code>ops_calendar_guard</code> during
              every appointment creation or reschedule.
            </span>
          </div>

          {isAdminOrOwner ? (
            <button
              type="submit"
              disabled={savingCoord}
              className="exec-btn-primary w-full touch-target"
            >
              {savingCoord ? 'Saving Coordination Rules…' : 'Save Coordination & Hours Policy'}
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
