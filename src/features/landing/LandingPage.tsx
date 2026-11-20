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
      'Evidence-backed leak scanner across overdue invoices, unbilled delivered work, stalled quotes, and open commitments—paired with strict separation between Stripe-verified settlements and owner-reported payments.',
  },
  {
    step: '02',
    title: 'CRM & Pipeline',
    icon: FileSpreadsheet,
    summary:
      'Customer 360 timelines, qualified lead discovery, revision-tracked quotes, and follow-up drafts gated by explicit channel consent.',
  },
  {
    step: '03',
    title: 'Quotes & E-Sign Portal',
    icon: ShieldCheck,
    summary:
      'Itemized quotes with unique /portal/[token] links where clients e-sign online and trigger automatic invoice conversion under your Autonomy Dial.',
  },
  {
    step: '04',
    title: 'Invoices & AR Ledger',
    icon: CalendarClock,
    summary:
      'Real-time billed, collected, and overdue AR metrics paired with 1-click collection nudges and exact integer-cent accounting.',
  },
  {
    step: '05',
    title: 'Agent Ledger & Autonomy',
    icon: Boxes,
    summary:
      'Dial every workflow between Manual, 1-Tap Approve, and Full Auto with dollar caps, modular feature toggles, and 1-Click Undo/Reverse.',
  },
]

const COMPARISON_ROWS = [
  {
    capability: 'CRM, Quotes, E-Sign, Invoices & Agents in One Database',
    looseEnds: 'Included in single Postgres ledger',
    fragmented: '3–4 disconnected apps + Zapier sync lag',
    enterprise: 'Requires 6–12 month custom implementation',
  },
  {
    capability: 'Team & Collaborator Seat Pricing',
    looseEnds: 'Unlimited workspace seats ($0/seat)',
    fragmented: '$49–$129/user across multiple tools',
    enterprise: '$195–$350+ per seat/month',
  },
  {
    capability: 'Autonomous Audit Trail & Reversible Actions',
    looseEnds: 'Manual / 1-Tap / Full Auto dial + 1-Click Undo',
    fragmented: 'Silent background automations with no rollback',
    enterprise: 'Opaque enterprise workflow add-on',
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-1.5 sm:gap-4 px-3 py-3 sm:px-6 sm:py-3.5">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-[#c2410c] border border-[#fb923c]/40 text-white font-black text-xs sm:text-sm">
              LE
            </div>
            <div className="min-w-0">
              <span className="block whitespace-nowrap text-sm font-bold tracking-tight text-slate-950">
                Loose Ends
              </span>
              <span className="hidden sm:block text-[11px] text-slate-500">
                All-in-One Autonomous Business OS
              </span>
            </div>
          </div>

          <nav aria-label="Public navigation" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#architecture" className="hover:text-[#c2410c] transition-colors">
              Modular OS
            </a>
            <a href="#comparison" className="hover:text-[#c2410c] transition-colors">
              Stack Comparison
            </a>
            <a href="#pricing" className="hover:text-[#c2410c] transition-colors">
              $199/mo Flat Pricing
            </a>
            <a href="#audit" className="hover:text-[#c2410c] transition-colors">
              Free Leak Audit
            </a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="exec-btn-secondary whitespace-nowrap !gap-1.5 !px-2.5 sm:!px-3.5 !py-2 !text-xs sm:!text-sm touch-target"
            >
              <span>Sign In</span>
              <ArrowRight className="hidden sm:inline-block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/demo')}
              className="exec-btn-primary whitespace-nowrap !gap-1.5 !px-2.5 sm:!px-3.5 !py-2 !text-xs sm:!text-sm touch-target"
            >
              <Play className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" aria-hidden="true" />
              <span>Try Live Demo</span>
            </button>
          </div>
        </div>
      </header>

      <main id="landing-main">
        {/* Executive Hero */}
        <section className="exec-rail border-b border-slate-800">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20 lg:py-24">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-3.5 py-1 text-xs font-semibold text-[#fdba74]">
                  <span>All-in-One Autonomous Business OS · Agencies, E-Commerce, Wholesale, Clinics &amp; Services</span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-[1.12]">
                  CRM, quotes &amp; e-sign, invoices &amp; autonomous agents in one ledger.
                </h1>

                <p className="max-w-2xl text-base sm:text-lg text-slate-300 leading-relaxed">
                  Growing agencies, e-commerce brands, wholesalers, clinics, and service teams lose
                  margin when quotes stall, invoices sit uncollected, and tools don&apos;t talk.
                  Loose Ends OS runs your revenue-to-cash workflow autonomously—with Manual, 1-Tap,
                  or Full Auto controls and 1-Click Undo—for a flat{' '}
                  <strong className="text-white font-semibold tabular-nums">$199/month</strong> per
                  workspace.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate('/demo')}
                    className="exec-btn-primary whitespace-nowrap !px-5 !py-3 !text-sm sm:!text-base touch-target shadow-lg"
                  >
                    <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Launch Live Sandbox (/demo)
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-600 bg-slate-900/90 px-5 py-3 text-sm sm:text-base font-semibold text-white hover:border-[#fb923c] hover:bg-slate-800 touch-target transition"
                  >
                    Sign In / Start Workspace
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800/90 max-w-xl">
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-white tabular-nums">$199/mo</p>
                    <p className="text-xs text-slate-400">Flat per workspace · unlimited seats</p>
                  </div>
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-[#fb923c] tabular-nums">$0</p>
                    <p className="text-xs text-slate-400">Setup fees · month-to-month</p>
                  </div>
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-white tabular-nums">100%</p>
                    <p className="text-xs text-slate-400">Reversible &amp; consent-gated</p>
                  </div>
                </div>
              </div>

              {/* Single-Ledger Chain Diagram Card */}
              <div className="lg:col-span-5">
                <div className="rounded-2xl border border-slate-700/80 bg-slate-900/90 p-5 sm:p-6 shadow-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Autonomous Revenue-to-Cash Chain
                    </span>
                    <Badge tone="emerald">Deterministic Cent Math</Badge>
                  </div>

                  <ol className="space-y-2.5 text-xs sm:text-sm">
                    {[
                      {
                        stage: '1. Quote & Branded E-Sign',
                        detail: 'Send itemized quotes with instant /portal/[token] signature',
                        metric: 'QTE-2041 · $6,450',
                      },
                      {
                        stage: '2. Autonomy Dial Gate',
                        detail: 'Choose Manual, 1-Tap Approve, or Full Auto by dollar cap',
                        metric: 'Full Auto <= $500',
                      },
                      {
                        stage: '3. Auto-Generated Invoice',
                        detail: 'Signed quote converts immediately to tracked AR with due date',
                        metric: 'INV-2041 · Issued',
                      },
                      {
                        stage: '4. Agent Action Ledger + Undo',
                        detail: 'Every bot action logs before/after state with 1-Click Reverse',
                        metric: '1-Click Undo Ready',
                      },
                      {
                        stage: '5. Consent-Gated AR Nudges',
                        detail: 'Verifies channel opt-in before staging any payment reminder',
                        metric: 'Audit trail logged',
                      },
                    ].map(row => (
                      <li
                        key={row.stage}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/75 px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-white">{row.stage}</p>
                          <p className="text-xs text-slate-300 leading-snug">{row.detail}</p>
                        </div>
                        <span className="self-start sm:self-center shrink-0 rounded-md border border-[#fb923c]/30 bg-[rgba(234,88,12,0.14)] px-2 py-1 font-mono text-[11px] text-[#fdba74] tabular-nums">
                          {row.metric}
                        </span>
                      </li>
                    ))}
                  </ol>

                  <div className="flex items-start gap-2 pt-1 text-xs text-slate-300">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fb923c]" aria-hidden="true" />
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
            <Badge tone="brand">5 Focused Workspaces · Zero Clutter</Badge>
            <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
              One operational database instead of five disconnected tabs
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600">
              When a job finishes in the field, your schedule, parts inventory, invoice, and
              customer history update together—zero double-entry, zero math errors.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FIVE_PILLARS.map(pillar => {
              const Icon = pillar.icon
              return (
                <div key={pillar.step} className="exec-surface p-5 sm:p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-500 tabular-nums">
                        WORKSPACE {pillar.step}
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]">
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
                <span className="inline-flex items-center gap-1 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-2.5 py-0.5 text-xs font-semibold text-[#fdba74]">
                  Interactive Preview
                </span>
                <h3 className="mt-3 text-base font-bold">Test-drive the Autonomous OS sandbox now</h3>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Simulate a client e-signature in <code>/portal</code>, watch the agent
                  auto-generate the invoice, test the Autonomy Dial, and try 1-Click Undo live in
                  your browser.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/demo')}
                className="mt-5 exec-btn-primary w-full touch-target"
              >
                <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
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
                Built for growing agencies, e-commerce, wholesale, clinics &amp; service teams
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-600">
                Stop paying per-seat SaaS taxes or duct-taping spreadsheets between your CRM,
                quoting tool, invoicing, and accounting.
              </p>
            </div>

            {/* Mobile Stacked Cards (prevents cramped horizontal clipping at 375px) */}
            <div className="mt-6 space-y-3 md:hidden">
              {COMPARISON_ROWS.map(row => (
                <div
                  key={row.capability}
                  className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 text-xs"
                >
                  <p className="font-bold text-slate-900">{row.capability}</p>
                  <div className="rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[#9a3412] font-semibold">
                    <span className="inline-flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>Loose Ends ($199/mo): {row.looseEnds}</span>
                    </span>
                  </div>
                  <p className="text-slate-600 flex items-start gap-1.5">
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span>Fragmented Stack: {row.fragmented}</span>
                  </p>
                  <p className="text-slate-600">Legacy Enterprise: {row.enterprise}</p>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="mt-8 hidden md:block overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="py-3.5 px-4 font-semibold text-slate-700">Operational Requirement</th>
                    <th className="py-3.5 px-4 font-bold text-[#9a3412] bg-[#fff7ed]">
                      Loose Ends OS ($199/mo flat)
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-slate-600">
                      Fragmented CRM + Quoting + Invoicing
                    </th>
                    <th className="py-3.5 px-4 font-semibold text-slate-600">
                      Legacy Per-Seat Enterprise Suites
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {COMPARISON_ROWS.map(row => (
                    <tr key={row.capability}>
                      <td className="py-3.5 px-4 font-medium text-slate-900">{row.capability}</td>
                      <td className="py-3.5 px-4 bg-[#fff7ed]/60 font-semibold text-[#9a3412]">
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
            {/* Flat $199/mo Plan + $249 Risk-Reversal Audit Pilot */}
            <div className="space-y-5 lg:col-span-5">
              <div className="exec-surface p-6 sm:p-8 border-slate-300">
                <Badge tone="brand">Transparent Workspace Pricing</Badge>
                <h2 className="mt-3 text-2xl font-bold text-slate-950">
                  One flat plan. Every module included.
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
                    'Unlimited seats across your entire team ($0/seat)',
                    'All Release 1 modules: Command Center, CRM, Quotes & E-Sign, Invoices & AR, Autonomy Ledger',
                    'Branded Client /portal/[token] e-sign + payment handoff',
                    'Manual, 1-Tap Approve & Full Auto dial with 1-Click Undo',
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
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/demo')}
                    className="exec-btn-secondary w-full touch-target"
                  >
                    <Play className="h-4 w-4 shrink-0 text-[#ea580c]" aria-hidden="true" />
                    Try Interactive Sandbox First
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-[#ea580c] bg-[#0b1320] p-6 sm:p-7 text-white shadow-lg">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-3 py-1 text-xs font-semibold text-[#fdba74]">
                  Done-For-You 48-Hour Pilot
                </span>
                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg sm:text-xl font-bold text-white">
                    Revenue Recovery Audit Pilot
                  </h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
                      $249
                    </span>
                    <span className="text-xs font-medium text-slate-300">/ one-time</span>
                  </div>
                </div>
                <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Hands-on 48-hour diagnostic across open quotes, unbilled completed jobs, and
                  vendor overcharges with a prioritized Operations Readiness Scorecard.
                </p>

                <div className="mt-4 rounded-xl border border-[#fb923c]/50 bg-[rgba(234,88,12,0.18)] px-4 py-3 text-xs sm:text-sm font-semibold text-white leading-snug">
                  <span className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#fb923c]" aria-hidden="true" />
                    <span>
                      48-Hour Guarantee: If we don&apos;t uncover at least $500 in recoverable
                      revenue or wasted spend, you pay $0.
                    </span>
                  </span>
                </div>

                <a href="#audit" className="mt-5 exec-btn-primary w-full touch-target">
                  Request $249 Audit Pilot
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </a>
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
              className="font-semibold text-slate-700 hover:text-[#c2410c]"
            >
              Interactive Sandbox (/demo)
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="font-semibold text-slate-700 hover:text-[#c2410c]"
            >
              Workspace Sign In
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
