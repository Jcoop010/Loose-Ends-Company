import React from 'react'
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  Check,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useAppRouter } from '../../state/RouterContext'
import { Badge } from '../../components/ui/MetricCard'
import { PublicAuditLeadForm } from './PublicAuditLeadForm'

const FIVE_PILLARS = [
  {
    step: '01',
    title: 'Command Center',
    icon: LayoutDashboard,
    summary:
      'Evidence-backed leak scanner across overdue invoices, unbilled completed jobs, stalled quotes, and past appointments—paired with strict separation between Stripe-verified collections and owner-reported payments.',
  },
  {
    step: '02',
    title: 'Pipeline & Quotes',
    icon: FileSpreadsheet,
    summary:
      'Revision-tracked estimates, recorded customer approval evidence, Customer 360 history, and follow-up drafts gated by explicit channel consent.',
  },
  {
    step: '03',
    title: 'Dispatch & Jobs',
    icon: CalendarClock,
    summary:
      'Conflict-checked technician scheduling, field checklists, reserved truck/warehouse materials, and recurring preventive maintenance plans.',
  },
  {
    step: '04',
    title: 'Inventory & POs',
    icon: Boxes,
    summary:
      'Live on-hand vs. reserved part balances, automatic low-stock detection, and owner-approved supplier Purchase Orders that post stock receipts on arrival.',
  },
  {
    step: '05',
    title: 'Autopilot & Billing',
    icon: ShieldCheck,
    summary:
      'Business-hours coordination rules, human-in-the-loop workflow approvals, QuickBooks sync, and flat $199/month workspace billing.',
  },
]

const COMPARISON_ROWS = [
  {
    capability: 'Quotes, Parts, Dispatch, Invoices & Follow-Up in One Database',
    looseEnds: 'Included in single Postgres ledger',
    fragmented: '3–4 disconnected apps + Zapier sync lag',
    enterprise: 'Requires 6–12 month custom implementation',
  },
  {
    capability: 'Technician & Office Seat Pricing',
    looseEnds: 'Unlimited workspace members ($0/seat)',
    fragmented: '$49–$129/user across multiple tools',
    enterprise: '$245–$398+ per technician/month',
  },
  {
    capability: 'Unbilled Completed Job Detection',
    looseEnds: 'Built-in deterministic ops_jobs vs. invoice check',
    fragmented: 'Manual Friday spreadsheet reconciliation',
    enterprise: 'Add-on reporting module',
  },
  {
    capability: 'Outbound Follow-Up Safety & TCPA/Email Consent',
    looseEnds: 'Mandatory consent ledger check + owner approval',
    fragmented: 'Auto-blasts risk messaging opted-out customers',
    enterprise: 'Separate marketing add-on fee',
  },
  {
    capability: 'Contract & Setup Commitment',
    looseEnds: 'Month-to-month · $0 setup fee',
    fragmented: 'Multiple overlapping annual renewals',
    enterprise: '12–24 month lock-in + $3k–$15k onboarding',
  },
]

export function LandingPage(): React.ReactElement {
  const { navigate } = useAppRouter()

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] text-slate-900">
      <a href="#landing-main" className="skip-link">
        Skip to main content
      </a>

      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-emerald-400 font-black text-sm">
              LE
            </div>
            <div>
              <span className="block text-sm font-bold tracking-tight text-slate-950">
                Loose Ends
              </span>
              <span className="hidden sm:block text-[11px] text-slate-500">
                Single-Ledger Operations & Revenue Recovery
              </span>
            </div>
          </div>

          <nav aria-label="Public navigation" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#architecture" className="hover:text-slate-950">
              5-Pillar Platform
            </a>
            <a href="#comparison" className="hover:text-slate-950">
              Stack Comparison
            </a>
            <a href="#pricing" className="hover:text-slate-950">
              $199/mo Flat Pricing
            </a>
            <a href="#audit" className="hover:text-slate-950">
              Free Leak Audit
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/demo')}
              className="exec-btn-secondary !px-3.5 !py-2 !text-xs sm:!text-sm touch-target"
            >
              <Play className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>Live Sandbox</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs sm:!text-sm touch-target"
            >
              <span>Sign In / Start</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main id="landing-main">
        {/* Executive Hero */}
        <section className="exec-rail border-b border-slate-800">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:py-24">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
                  <span>Single-Ledger Operations & Owner-Approved Revenue Recovery</span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-[1.12]">
                  Every quote, part, dispatch job, invoice, and follow-up in one ledger.
                </h1>

                <p className="max-w-2xl text-base sm:text-lg text-slate-300 leading-relaxed">
                  Service businesses lose margin when completed jobs never get billed, high-value
                  quotes stall without follow-up, and parts run out mid-dispatch. Loose Ends unifies
                  day-to-day operations and consent-verified revenue recovery for a flat{' '}
                  <strong className="text-white font-semibold tabular-nums">$199/month</strong> per
                  workspace.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate('/demo')}
                    className="exec-btn-emerald !px-5 !py-3 !text-sm sm:!text-base touch-target shadow-lg"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    Launch Live Sandbox (/demo)
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900/90 px-5 py-3 text-sm sm:text-base font-semibold text-white hover:bg-slate-800 touch-target"
                  >
                    Sign In / Start Workspace
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800/90 max-w-xl">
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-white tabular-nums">$199/mo</p>
                    <p className="text-xs text-slate-400">Flat per workspace · unlimited techs</p>
                  </div>
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-emerald-400 tabular-nums">$0</p>
                    <p className="text-xs text-slate-400">Setup fees · month-to-month</p>
                  </div>
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-white tabular-nums">100%</p>
                    <p className="text-xs text-slate-400">Owner-approved & consent-gated</p>
                  </div>
                </div>
              </div>

              {/* Single-Ledger Chain Diagram Card */}
              <div className="lg:col-span-5">
                <div className="rounded-2xl border border-slate-700/80 bg-slate-900/90 p-5 sm:p-6 shadow-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Connected Operational Chain
                    </span>
                    <Badge tone="emerald">Advisory-Locked Ledger</Badge>
                  </div>

                  <ol className="space-y-2.5 text-xs sm:text-sm">
                    {[
                      {
                        stage: '1. Quote & Approval',
                        detail: 'Revision snapshot + recorded customer approval evidence',
                        metric: 'QTE-2041 · $6,450',
                      },
                      {
                        stage: '2. Stock & Purchase Orders',
                        detail: 'Reserve parts on the job or draft low-stock supplier PO',
                        metric: 'REF-410A · 2 reserved',
                      },
                      {
                        stage: '3. Conflict-Checked Dispatch',
                        detail: 'Assign technician window with travel buffer & checklist',
                        metric: '07:30–18:00 enforced',
                      },
                      {
                        stage: '4. Completion & Invoicing',
                        detail: 'Flags completed jobs missing an invoice automatically',
                        metric: '0 unbilled leaks',
                      },
                      {
                        stage: '5. Consent-Gated Recovery',
                        detail: 'Verifies channel opt-in before queueing any reminder draft',
                        metric: 'Audit trail logged',
                      },
                    ].map(row => (
                      <li
                        key={row.stage}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/75 px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-white">{row.stage}</p>
                          <p className="truncate text-xs text-slate-400">{row.detail}</p>
                        </div>
                        <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 font-mono text-[11px] text-emerald-300 tabular-nums">
                          {row.metric}
                        </span>
                      </li>
                    ))}
                  </ol>

                  <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                    <span>
                      Provider-verified Stripe collections are never co-mingled with self-reported
                      payments.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5 Unified Workspaces */}
        <section id="architecture" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <Badge tone="sky">5 Focused Workspaces · Zero Clutter</Badge>
            <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
              One operational database instead of five disconnected tabs
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600">
              Every mutation runs through idempotent, role-checked PostgreSQL commands so inventory,
              schedules, invoices, and customer timelines stay in lockstep.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FIVE_PILLARS.map(pillar => {
              const Icon = pillar.icon
              return (
                <div key={pillar.step} className="exec-surface p-5 sm:p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-400 tabular-nums">
                        WORKSPACE {pillar.step}
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-emerald-400">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                    </div>
                    <h3 className="mt-3 text-base font-bold text-slate-900">{pillar.title}</h3>
                    <p className="mt-1.5 text-xs sm:text-sm text-slate-600 leading-relaxed">
                      {pillar.summary}
                    </p>
                  </div>
                </div>
              )
            })}

            <div className="rounded-2xl border border-slate-900 bg-slate-900 p-5 sm:p-6 text-white flex flex-col justify-between">
              <div>
                <Badge tone="emerald">Interactive Preview</Badge>
                <h3 className="mt-3 text-base font-bold">Test-drive the full HVAC sandbox now</h3>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Inspect stalled quotes, issue an invoice for an unbilled walk-in cooler repair,
                  receive a refrigerant PO, and test consent-blocked SMS safety live in your browser.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/demo')}
                className="mt-5 exec-btn-emerald w-full touch-target"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Explore /demo Sandbox
              </button>
            </div>
          </div>
        </section>

        {/* Factual Stack Comparison Grid */}
        <section id="comparison" className="border-y border-slate-200 bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <Badge tone="neutral">Factual Architecture Comparison</Badge>
              <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
                Built for 3–50 person trade & service operators
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-600">
                Stop paying per-technician enterprise taxes or duct-taping spreadsheets between your
                CRM, QuickBooks, and messaging app.
              </p>
            </div>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="py-3.5 px-4 font-semibold text-slate-700">Operational Requirement</th>
                    <th className="py-3.5 px-4 font-bold text-slate-950 bg-emerald-50/60">
                      Loose Ends ($199/mo flat)
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-slate-600">
                      Fragmented CRM + QBO + Podium
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-slate-600">
                      Legacy Per-Tech Enterprise Suites
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {COMPARISON_ROWS.map(row => (
                    <tr key={row.capability}>
                      <td className="py-3.5 px-4 font-medium text-slate-900">{row.capability}</td>
                      <td className="py-3.5 px-4 bg-emerald-50/35 font-semibold text-emerald-950">
                        <span className="inline-flex items-center gap-1.5">
                          <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                          {row.looseEnds}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <X className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                          {row.fragmented}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">{row.enterprise}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Transparent Pricing + Public Audit Form */}
        <section id="pricing" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            {/* Flat $199/mo Card */}
            <div className="exec-surface p-6 sm:p-8 lg:col-span-5 border-slate-300">
              <Badge tone="emerald">Transparent Workspace Pricing</Badge>
              <h2 className="mt-3 text-2xl font-bold text-slate-950">
                One flat plan. Every operational module included.
              </h2>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-950 tabular-nums">
                  $199
                </span>
                <span className="text-sm font-medium text-slate-600">/ month per workspace</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Month-to-month subscription via Stripe · $0 setup · Cancel anytime in Billing Portal.
              </p>

              <ul className="mt-6 space-y-2.5 text-xs sm:text-sm text-slate-700">
                {[
                  'Unlimited technicians, dispatchers, and office admins',
                  'All 5 workspaces: Command, Pipeline, Dispatch, Inventory & Autopilot',
                  'Deterministic Revenue & Unbilled-Job Leak Scanner',
                  'Resumable CSV Customer & Inventory SKU Bulk Imports',
                  'Consent-Gated Outbound Drafts + Full Audit Trail',
                  'QuickBooks Online Sync + Stripe Verified Collections Ledger',
                ].map(feature => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="exec-btn-primary w-full touch-target"
                >
                  Start Workspace ($199/mo)
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/demo')}
                  className="exec-btn-secondary w-full touch-target"
                >
                  <Play className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Try Interactive Sandbox First
                </button>
              </div>
            </div>

            {/* Free 10-Minute Audit Lead Form */}
            <div id="audit" className="lg:col-span-7">
              <PublicAuditLeadForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-6 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} Loose Ends Co. Single-Ledger Operations OS.</p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => navigate('/demo')}
              className="font-semibold text-slate-700 hover:text-slate-950"
            >
              Interactive Sandbox (/demo)
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="font-semibold text-slate-700 hover:text-slate-950"
            >
              Workspace Sign In
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
