import React, { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Clock,
  DollarSign,
  Play,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import {
  CALCULATOR_PRESETS,
  LEAK_CALCULATOR_BOUNDS,
  LOOSE_ENDS_MONTHLY_CENTS,
  calculateOpsLeakEstimate,
  formatCalculatorDollars,
  formatCalculatorExactCents,
  validateCalculatorEmail,
  type LeakCalculatorResult,
} from '../../lib/growth/leakCalculatorEngine'
import { submitCalculatorLead } from '../../lib/queries'
import { useAppRouter } from '../../state/RouterContext'

export interface CalculatorPageProps {
  onSubmitLead?: (params: {
    email: string
    estimate: LeakCalculatorResult
  }) => Promise<{ duplicate: boolean; email: string }>
  onHandoff?: (targetUrl: string) => void
}

export function CalculatorPage({
  onSubmitLead = submitCalculatorLead,
  onHandoff,
}: CalculatorPageProps): React.ReactElement {
  const { navigate } = useAppRouter()

  const [monthlyRevenueCents, setMonthlyRevenueCents] = useState<number>(
    LEAK_CALCULATOR_BOUNDS.monthlyRevenueCents.default,
  )
  const [teamSeats, setTeamSeats] = useState<number>(
    LEAK_CALCULATOR_BOUNDS.teamSeats.default,
  )
  const [monthlyOverdueAndBillsCents, setMonthlyOverdueAndBillsCents] = useState<number>(
    LEAK_CALCULATOR_BOUNDS.monthlyOverdueAndBillsCents.default,
  )

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submittedNotice, setSubmittedNotice] = useState<string | null>(null)

  const estimate = useMemo(
    () =>
      calculateOpsLeakEstimate({
        monthlyRevenueCents,
        teamSeats,
        monthlyOverdueAndBillsCents,
      }),
    [monthlyRevenueCents, teamSeats, monthlyOverdueAndBillsCents],
  )

  const routeToLiveSandbox = () => {
    const prodDemoUrl = 'https://www.looseendsos.app/demo'
    if (onHandoff) {
      onHandoff(prodDemoUrl)
      return
    }
    if (typeof window !== 'undefined') {
      const host = window.location.hostname
      if (host === 'www.looseendsos.app' || host === 'looseendsos.app' || host === 'localhost' || host === '127.0.0.1') {
        navigate('/demo')
        return
      }
      window.location.assign(prodDemoUrl)
      return
    }
    navigate('/demo')
  }

  const handleCaptureSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const check = validateCalculatorEmail(email)
    if (!check.valid) {
      setFormError(check.error ?? 'Enter a valid email address.')
      return
    }

    setSubmitting(true)
    try {
      const res = await onSubmitLead({
        email: check.normalized,
        estimate,
      })
      setSubmittedNotice(
        res.duplicate
          ? `Checklist already queued for ${res.email} — launching /demo sandbox…`
          : `Shadow Audit checklist saved for ${res.email} — launching /demo sandbox…`,
      )
      routeToLiveSandbox()
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Could not save your checklist request right now. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#070d17] text-slate-100">
      <a href="#calculator-main" className="skip-link">
        Skip to leak calculator
      </a>

      {/* Sticky Obsidian Dark Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0b1320]/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2.5 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-slate-700 bg-[#131f33] text-slate-100 touch-target shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Home
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm sm:text-base font-bold text-white">
                  Loose Ends OS
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.16)] px-2.5 py-0.5 text-[11px] font-semibold text-[#fdba74]">
                  <Calculator className="h-3 w-3" aria-hidden="true" />
                  Leak Estimator
                </span>
              </div>
              <p className="hidden sm:block truncate text-xs text-slate-400">
                QuickBooks &amp; Ops Leak Estimator · Flat $199/mo unlimited seats
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs border-slate-700 bg-[#0e1726] text-slate-200 touch-target"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => routeToLiveSandbox()}
              className="exec-btn-primary !px-3.5 !py-1.5 !text-xs touch-target"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Live Sandbox (/demo)
            </button>
          </div>
        </div>
      </header>

      <main
        id="calculator-main"
        className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12 space-y-8"
      >
        {/* Hero Intro */}
        <section className="exec-rail rounded-2xl border border-slate-800 p-6 sm:p-8 space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2.5 max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-3 py-1 text-xs font-semibold text-[#fdba74]">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                No Login Required · Deterministic Integer-Cent ROI Model
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
                QuickBooks &amp; Ops Leak Estimator
              </h1>
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                See what per-seat QuickBooks/Zoho/CRM bloat, unbilled quotes, overdue AR, and
                &gt;10% supplier price creep cost your shop each year — and how fast flat{' '}
                <strong className="text-white tabular-nums">
                  {formatCalculatorDollars(LOOSE_ENDS_MONTHLY_CENTS)}/mo unlimited seats
                </strong>{' '}
                pays for itself.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {CALCULATOR_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setMonthlyRevenueCents(preset.input.monthlyRevenueCents)
                    setTeamSeats(preset.input.teamSeats)
                    setMonthlyOverdueAndBillsCents(preset.input.monthlyOverdueAndBillsCents)
                  }}
                  className="rounded-xl border border-slate-700 bg-[#0e1726] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-[#fb923c]/60 hover:bg-[#131f33] transition"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Main 3-Slider Input + Deterministic Outputs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left: 3 Sliders */}
          <section
            aria-label="Business metrics sliders"
            className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-6"
          >
            <div>
              <h2 className="text-base font-bold text-white">1. Tune Your Monthly Baseline</h2>
              <p className="mt-1 text-xs text-slate-400">
                Adjust all 3 sliders to model your exact team headcount and monthly AR/AP volume.
              </p>
            </div>

            {/* Slider 1: Monthly Revenue */}
            <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="calc-monthly-revenue"
                  className="text-xs font-bold uppercase tracking-wider text-slate-200"
                >
                  Monthly Revenue
                </label>
                <span
                  id="calc-monthly-revenue-value"
                  className="text-base font-extrabold text-[#fdba74] tabular-nums"
                >
                  {formatCalculatorDollars(monthlyRevenueCents)}/mo
                </span>
              </div>
              <input
                id="calc-monthly-revenue"
                type="range"
                min={LEAK_CALCULATOR_BOUNDS.monthlyRevenueCents.min}
                max={LEAK_CALCULATOR_BOUNDS.monthlyRevenueCents.max}
                step={LEAK_CALCULATOR_BOUNDS.monthlyRevenueCents.step}
                value={monthlyRevenueCents}
                aria-valuetext={`${formatCalculatorDollars(monthlyRevenueCents)} per month`}
                onChange={e => setMonthlyRevenueCents(Number(e.target.value))}
                className="w-full h-2 cursor-pointer accent-[#ea580c] bg-slate-800 rounded-lg"
              />
              <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                <span>$20,000</span>
                <span>$500,000</span>
              </div>
            </div>

            {/* Slider 2: Team Size / Software Seats */}
            <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="calc-team-seats"
                  className="text-xs font-bold uppercase tracking-wider text-slate-200"
                >
                  Team Size / Software Seats
                </label>
                <span
                  id="calc-team-seats-value"
                  className="text-base font-extrabold text-[#fdba74] tabular-nums"
                >
                  {teamSeats} seats
                </span>
              </div>
              <input
                id="calc-team-seats"
                type="range"
                min={LEAK_CALCULATOR_BOUNDS.teamSeats.min}
                max={LEAK_CALCULATOR_BOUNDS.teamSeats.max}
                step={LEAK_CALCULATOR_BOUNDS.teamSeats.step}
                value={teamSeats}
                aria-valuetext={`${teamSeats} software seats`}
                onChange={e => setTeamSeats(Number(e.target.value))}
                className="w-full h-2 cursor-pointer accent-[#ea580c] bg-slate-800 rounded-lg"
              />
              <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                <span>3 seats</span>
                <span>50 seats (QBO/CRM tax eliminated)</span>
              </div>
            </div>

            {/* Slider 3: Average Monthly Unpaid / Overdue Invoices + Vendor Bills */}
            <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="calc-overdue-bills"
                  className="text-xs font-bold uppercase tracking-wider text-slate-200"
                >
                  Monthly Overdue Invoices + Vendor Bills
                </label>
                <span
                  id="calc-overdue-bills-value"
                  className="text-base font-extrabold text-[#fdba74] tabular-nums"
                >
                  {formatCalculatorDollars(monthlyOverdueAndBillsCents)}/mo
                </span>
              </div>
              <input
                id="calc-overdue-bills"
                type="range"
                min={LEAK_CALCULATOR_BOUNDS.monthlyOverdueAndBillsCents.min}
                max={LEAK_CALCULATOR_BOUNDS.monthlyOverdueAndBillsCents.max}
                step={LEAK_CALCULATOR_BOUNDS.monthlyOverdueAndBillsCents.step}
                value={monthlyOverdueAndBillsCents}
                aria-valuetext={`${formatCalculatorDollars(monthlyOverdueAndBillsCents)} per month`}
                onChange={e => setMonthlyOverdueAndBillsCents(Number(e.target.value))}
                className="w-full h-2 cursor-pointer accent-[#ea580c] bg-slate-800 rounded-lg"
              />
              <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                <span>$2,000</span>
                <span>$150,000</span>
              </div>
            </div>

            {/* Audit Basis Transparency Note */}
            <div className="rounded-xl border border-slate-800 bg-[#131f33]/70 p-3.5 text-[11px] text-slate-300 space-y-1">
              <p className="font-semibold text-white">Deterministic Formula Basis</p>
              <p className="tabular-nums">
                • Seat Tax: $150 QBO base + $79/seat/mo vs flat $199/mo unlimited seats
              </p>
              <p className="tabular-nums">
                • Recoverable Cash: 1.5% unbilled quotes + 6.0% overdue AR recovery + 4.5% vendor
                spike/duplicate protection
              </p>
            </div>
          </section>

          {/* Right: Deterministic Savings + Lead Handoff */}
          <section
            aria-label="Estimated savings and recoverable cash"
            className="lg:col-span-7 space-y-5"
          >
            {/* Primary Output Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-emerald-500/35 bg-[#0b1320] p-5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                  Annual Seat-Tax Savings
                </div>
                <p
                  data-testid="calc-annual-seat-savings"
                  className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums"
                >
                  {formatCalculatorExactCents(estimate.annual_seat_tax_savings_cents)}
                </p>
                <p className="text-xs text-slate-300 tabular-nums">
                  {formatCalculatorExactCents(estimate.monthly_seat_tax_savings_cents)}/mo saved vs{' '}
                  {formatCalculatorExactCents(estimate.legacy_monthly_cents)}/mo legacy stack
                </p>
              </div>

              <div className="rounded-2xl border border-[#fb923c]/40 bg-[#0b1320] p-5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#fdba74]">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  Est. Recoverable Cash
                </div>
                <p
                  data-testid="calc-annual-recoverable-cash"
                  className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums"
                >
                  {formatCalculatorExactCents(estimate.annual_recoverable_cash_cents)}
                </p>
                <p className="text-xs text-slate-300 tabular-nums">
                  {formatCalculatorExactCents(estimate.monthly_recoverable_cash_cents)}/mo unbilled
                  quotes, AR &amp; AP leaks
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-[#0b1320] p-5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  ROI Payback Period
                </div>
                <p
                  data-testid="calc-payback-days"
                  className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums"
                >
                  {estimate.payback_days} day{estimate.payback_days === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-slate-300 tabular-nums">
                  Break-even on flat $199.00/mo ({formatCalculatorExactCents(estimate.annual_total_impact_cents)}/yr total impact)
                </p>
              </div>
            </div>

            {/* Line-Item Recoverable Cash Breakdown */}
            <div className="rounded-2xl border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                  Where Your Annual Cash Leaks &amp; Recovers
                </h2>
                <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 tabular-nums">
                  Combined Impact: {formatCalculatorExactCents(estimate.annual_total_impact_cents)}/yr
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3.5 space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Unbilled Completed Quotes
                  </span>
                  <p className="text-lg font-bold text-white tabular-nums">
                    {formatCalculatorExactCents(estimate.annual_unbilled_quotes_cents)}/yr
                  </p>
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {formatCalculatorExactCents(estimate.monthly_unbilled_quotes_cents)}/mo recovered
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3.5 space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Overdue AR Collections
                  </span>
                  <p className="text-lg font-bold text-white tabular-nums">
                    {formatCalculatorExactCents(estimate.annual_overdue_ar_recovery_cents)}/yr
                  </p>
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {formatCalculatorExactCents(estimate.monthly_overdue_ar_recovery_cents)}/mo via
                    Day 3/10/21 nudges
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3.5 space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    &gt;10% Vendor Spikes Frozen
                  </span>
                  <p className="text-lg font-bold text-white tabular-nums">
                    {formatCalculatorExactCents(estimate.annual_vendor_spike_savings_cents)}/yr
                  </p>
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {formatCalculatorExactCents(estimate.monthly_vendor_spike_savings_cents)}/mo caught
                    via 3-Way Match
                  </p>
                </div>
              </div>
            </div>

            {/* Single-Field Email Capture -> Immediate /demo Handoff */}
            <form
              onSubmit={handleCaptureSubmit}
              noValidate
              className="rounded-2xl border-2 border-[#ea580c] bg-[#0b1320] p-5 sm:p-6 space-y-4 shadow-lg"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#fdba74]">
                  <ShieldCheck className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
                  Step 2 · Verify On Your Own CSV in Read-Only Shadow Mode
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-white">
                  Send me my custom Shadow Audit checklist
                </h3>
                <p className="text-xs sm:text-sm text-slate-300">
                  Enter your email to save this estimate and launch the interactive air-gapped
                  sandbox immediately.
                </p>
              </div>

              {formError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
                >
                  {formError}
                </div>
              ) : null}

              {submittedNotice ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{submittedNotice}</span>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <label htmlFor="calculator-lead-email" className="sr-only">
                    Work email for Shadow Audit checklist
                  </label>
                  <input
                    id="calculator-lead-email"
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="exec-input !bg-[#0e1726] !text-white !border-slate-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="exec-btn-primary whitespace-nowrap !px-5 touch-target"
                >
                  <span>
                    {submitting
                      ? 'Unlocking /demo…'
                      : 'Email my custom Shadow Audit checklist & unlock live sandbox'}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}
