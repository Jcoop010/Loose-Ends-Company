import React from 'react'
import { ArrowRight, Calculator, Compass, RotateCcw } from 'lucide-react'
import { useAppRouter, type DashboardSection } from '../../state/RouterContext'

interface WalkthroughStep {
  number: number
  section: DashboardSection
  title: string
  instruction: string
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    number: 1,
    section: 'command',
    title: 'Command Center Leaks',
    instruction:
      'Review documented leaks across overdue invoices, the unbilled Oak Street Bakery cooler job, and stalled quotes—then create a deduplicated follow-up task in 1 click.',
  },
  {
    number: 2,
    section: 'pipeline',
    title: 'Consent-Gated Pipeline',
    instruction:
      'Collect payment on an open opportunity, inspect recorded SMS/Email opt-in evidence, and test how revoked consent blocks outbound drafts automatically.',
  },
  {
    number: 3,
    section: 'dispatch',
    title: 'Dispatch & Unbilled Jobs',
    instruction:
      'Schedule a conflict-checked technician window or issue the missing invoice for the completed walk-in cooler repair to clear the leak immediately.',
  },
  {
    number: 4,
    section: 'inventory',
    title: 'Low-Stock SKUs & POs',
    instruction:
      'Inspect reserved EPA-608 refrigerant & capacitors, approve a draft Purchase Order, and mark a PO received to post stock back to on-hand inventory.',
  },
  {
    number: 5,
    section: 'autopilot',
    title: 'Owner-Gated Autopilot',
    instruction:
      'Approve a queued high-value quote workflow run, toggle operating-hours enforcement, and inspect the immutable audit trail.',
  },
]

export function WalkthroughBanner({
  onOpenCalculator,
  onReset,
}: {
  onOpenCalculator: () => void
  onReset: () => void
}): React.ReactElement {
  const { section, navigate, navigateSection } = useAppRouter()
  const currentStep =
    WALKTHROUGH_STEPS.find(step => step.section === section) ?? WALKTHROUGH_STEPS[0]

  return (
    <section
      aria-label="Interactive sandbox walkthrough"
      className="rounded-2xl border border-slate-800 exec-rail p-4 sm:p-5 shadow-lg"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-2.5 py-0.5 text-xs font-semibold tracking-tight text-[#fdba74]">
              <Compass className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Air-Gapped Sandbox · Step {currentStep.number} of 5
            </span>
            <span className="text-xs text-slate-300">
              In-memory HVAC sample ledger · Zero network or browser storage writes
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-white">
            {currentStep.number}. {currentStep.title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
            {currentStep.instruction}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenCalculator}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-[#fb923c]/60 hover:bg-slate-800 touch-target transition"
          >
            <Calculator className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
            ROI Calculator
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-[#fb923c]/60 hover:bg-slate-800 touch-target transition"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset Sample Data
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="exec-btn-primary whitespace-nowrap !px-3.5 !py-2 !text-xs touch-target"
          >
            Start Real Workspace
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 5-Step Guided Selector */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {WALKTHROUGH_STEPS.map(step => {
          const active = step.section === section
          return (
            <button
              key={step.section}
              type="button"
              onClick={() => navigateSection(step.section, { demo: true })}
              aria-current={active ? 'step' : undefined}
              className={`touch-target rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? 'border-[#fb923c]/70 bg-[rgba(234,88,12,0.14)] text-white shadow-xs'
                  : 'border-slate-700/80 bg-slate-900/75 text-slate-200 hover:border-[#fb923c]/50 hover:text-white'
              }`}
            >
              <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-[#fdba74] tabular-nums">
                Step 0{step.number}
              </span>
              <span className="mt-0.5 block text-xs font-semibold leading-snug">{step.title}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
