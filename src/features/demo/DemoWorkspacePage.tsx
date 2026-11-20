import React, { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CalendarClock,
  CheckCircle2,
  FileSpreadsheet,
  LayoutDashboard,
  Plus,
  Printer,
  ShieldCheck,
} from 'lucide-react'
import {
  customerDisplayName,
  formatCents,
  formatCurrency,
  formatDateTime,
} from '../../lib/format'
import { calculateJobBillableTotal } from '../../lib/leakScanner'
import { useDemoStore } from '../../state/DemoStoreContext'
import { useAppRouter, type DashboardSection } from '../../state/RouterContext'
import type { ConsentChannel, ConsentDecision } from '../../types/domain'
import { Badge, MetricCard } from '../../components/ui/MetricCard'
import { useToast } from '../../components/ui/Toast'
import { RoiAuditCalculatorModal } from './RoiAuditCalculatorModal'
import { AutonomousSandboxPanel } from './AutonomousSandboxPanel'
import { WalkthroughBanner } from './WalkthroughBanner'

const DEMO_TABS: Array<{
  section: DashboardSection
  label: string
  mobileLabel: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { section: 'command', label: 'Command Center', mobileLabel: 'Command', icon: LayoutDashboard },
  { section: 'pipeline', label: 'Pipeline & Quotes', mobileLabel: 'Pipeline', icon: FileSpreadsheet },
  { section: 'dispatch', label: 'Dispatch & Jobs', mobileLabel: 'Dispatch', icon: CalendarClock },
  { section: 'inventory', label: 'Inventory & POs', mobileLabel: 'Inventory', icon: Boxes },
  { section: 'autopilot', label: 'Autopilot & Billing', mobileLabel: 'Autopilot', icon: ShieldCheck },
]

function defaultTomorrowSlot(): { start: string; end: string } {
  const base = new Date(Date.now() + 86_400_000)
  base.setMinutes(0, 0, 0)
  base.setHours(13)
  const end = new Date(base.getTime() + 2 * 3_600_000)
  const toLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return { start: toLocalInput(base), end: toLocalInput(end) }
}

export function DemoWorkspacePage(): React.ReactElement {
  const { section, navigate, navigateSection } = useAppRouter()
  const demo = useDemoStore()
  const toast = useToast()

  const [roiOpen, setRoiOpen] = useState(false)

  // Consent form state (Pipeline tab)
  const [consentCustomerId, setConsentCustomerId] = useState(
    demo.state.customers[3]?.id ?? demo.state.customers[0]?.id ?? '',
  )
  const [consentChannel, setConsentChannel] = useState<ConsentChannel>('sms')
  const [consentDecision, setConsentDecision] = useState<ConsentDecision>('granted')
  const [consentEvidence, setConsentEvidence] = useState('SIGNED-WORKORDER-OPTIN-2026')

  // Dispatch scheduling state (Dispatch tab)
  const initialSlot = defaultTomorrowSlot()
  const [scheduleJobId, setScheduleJobId] = useState(demo.state.jobs[2]?.id ?? '')
  const [scheduleWorkerId, setScheduleWorkerId] = useState(
    demo.state.employees[1]?.user_id ?? '',
  )
  const [scheduleStart, setScheduleStart] = useState(initialSlot.start)
  const [scheduleEnd, setScheduleEnd] = useState(initialSlot.end)

  // Vendor expense state (Command Center tab)
  const [vendorName, setVendorName] = useState('')
  const [vendorAmount, setVendorAmount] = useState('')
  const [vendorDesc, setVendorDesc] = useState('')

  // Grok Receipt Parser state (Autopilot tab)
  const [demoReceiptText, setDemoReceiptText] = useState(
    'Vendor: Johnstone Supply Wholesale\nInvoice #: INV-2026-8841\nR-410A Refrigerant Cylinder 25lb 2 x $145.00\n24V Contactor Relay 3 x $28.00\nTax: $22.44\nTotal: $396.44',
  )

  const customerNameById = (id: string | null | undefined): string => {
    if (!id) return 'Unassigned Customer'
    const found = demo.state.customers.find(c => c.id === id)
    return customerDisplayName(found)
  }

  const handleReset = () => {
    demo.resetDemo()
    toast.info('Sandbox reset', 'Pre-seeded HVAC quotes, jobs, SKUs, and drafts restored.')
  }

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)] pb-24 md:pb-12">
      <a href="#demo-main-content" className="skip-link">
        Skip to sandbox content
      </a>

      {/* Top Sandbox Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2.5 px-3.5 py-3 sm:px-6">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="exec-btn-secondary whitespace-nowrap shrink-0 !px-2.5 sm:!px-3 !py-1.5 !text-xs touch-target"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Overview
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="truncate text-sm sm:text-base font-bold text-slate-950">
                  {demo.state.workspace.name}
                </h1>
                <Badge tone="brand" className="whitespace-nowrap shrink-0">
                  Demo
                </Badge>
              </div>
              <p className="hidden sm:block truncate text-xs text-slate-500">
                100% air-gapped browser state · Test real workflows without creating an account
              </p>
            </div>
          </div>

          {/* Desktop 5-Pillar Switcher */}
          <nav aria-label="Sandbox workspaces" className="hidden lg:flex items-center gap-1 shrink-0">
            {DEMO_TABS.map(tab => {
              const Icon = tab.icon
              const active = tab.section === section
              return (
                <button
                  key={tab.section}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigateSection(tab.section, { demo: true })}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-xl px-2.5 xl:px-3 py-2 text-xs font-semibold transition ${
                    active
                      ? 'bg-[#c2410c] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-[#fff7ed] hover:text-[#9a3412]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="xl:hidden">{tab.mobileLabel}</span>
                  <span className="hidden xl:inline">{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main
        id="demo-main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-4 py-5 sm:px-6 space-y-6 outline-none"
      >
        <WalkthroughBanner
          onOpenCalculator={() => setRoiOpen(true)}
          onReset={handleReset}
        />

        {/* ================================================================
            TAB 1: COMMAND CENTER
           ================================================================ */}
        {section === 'command' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                label="Documented Leaks"
                value={formatCurrency(demo.leakScan.documentedExposureTotal)}
                subtitle={`${demo.leakScan.totalCount} active evidence items`}
                accent="amber"
              />
              <MetricCard
                label="Open Jobs"
                value={demo.opsSummary.open_jobs}
                subtitle={`${demo.opsSummary.today_jobs} scheduled within 24h`}
                accent="brand"
                onClick={() => navigateSection('dispatch', { demo: true })}
              />
              <MetricCard
                label="Open Estimates"
                value={demo.opsSummary.open_estimates}
                subtitle="Awaiting customer sign-off"
                accent="slate"
                onClick={() => navigateSection('pipeline', { demo: true })}
              />
              <MetricCard
                label="Low-Stock SKUs"
                value={demo.opsSummary.low_stock}
                subtitle={`Stock value ${formatCurrency(demo.opsSummary.inventory_value)}`}
                accent={demo.opsSummary.low_stock > 0 ? 'rose' : 'emerald'}
                onClick={() => navigateSection('inventory', { demo: true })}
              />
              <MetricCard
                label="Awaiting Approval"
                value={demo.opsSummary.awaiting_approval}
                subtitle="Draft POs, messages & rules"
                accent="amber"
                onClick={() => navigateSection('autopilot', { demo: true })}
              />
              <MetricCard
                label="Unpaid Invoices"
                value={formatCurrency(demo.opsSummary.unpaid_invoices)}
                subtitle={`Bills due: ${formatCurrency(demo.opsSummary.bills_due)}`}
                accent="rose"
              />
            </div>

            {/* Verified vs. Owner-Reported Revenue + Balanced Leak Scanner Row */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
              <div className="space-y-4 lg:col-span-5">
                <div className="exec-surface p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Verified vs. Self-Reported Collections
                    </h3>
                    <Badge tone="emerald">Strict Separation</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-900">
                        Stripe Webhook Verified
                      </span>
                      <p className="mt-1 text-xl font-bold text-emerald-950 tabular-nums">
                        {formatCurrency(demo.opsSummary.verified_collections)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-emerald-800">
                        {demo.state.verifiedPayments.length} provider-settled payment(s)
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                        Owner-Reported Paid
                      </span>
                      <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                        {formatCurrency(demo.opsSummary.owner_reported_paid)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Marked paid on workspace invoices
                      </p>
                    </div>
                  </div>
                  {demo.state.verifiedPayments.map(vp => (
                    <div
                      key={vp.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {customerNameById(vp.customer_id)} · {vp.payment_provider.toUpperCase()}
                        </p>
                        <p className="text-slate-500 font-mono text-[11px]">
                          {vp.provider_payment_id}
                        </p>
                      </div>
                      <span className="shrink-0 font-bold text-emerald-700 tabular-nums">
                        {formatCents(vp.amount_cents, vp.currency)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="exec-surface p-5 space-y-3">
                  <h3 className="text-base font-bold text-slate-900">Invoice Aging Buckets</h3>
                  <div className="space-y-2">
                    {demo.invoiceAging.map(bucket => (
                      <div
                        key={bucket.key}
                        className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs sm:text-sm"
                      >
                        <span className="font-medium text-slate-700">{bucket.label}</span>
                        <span className="font-bold text-slate-950 tabular-nums">
                          {formatCurrency(bucket.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Interactive Evidence-Backed Leak Scanner */}
              <div className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Live Revenue &amp; Billing Leak Scanner
                    </h3>
                    <p className="text-xs text-slate-600">
                      Every signal links to an actual invoice, quote, completed job, or past booking.
                    </p>
                  </div>
                  <Badge tone="brand" className="whitespace-nowrap">
                    {demo.leakScan.totalCount} Active Leaks · {formatCurrency(demo.leakScan.documentedExposureTotal)}
                  </Badge>
                </div>

                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {demo.leakScan.items.map(item => (
                    <li
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              item.severity === 'critical'
                                ? 'rose'
                                : item.severity === 'high'
                                  ? 'amber'
                                  : 'neutral'
                            }
                          >
                            {item.category.replace(/_/g, ' ')}
                          </Badge>
                          <span className="text-sm font-semibold text-slate-900">{item.title}</span>
                        </div>
                        <p className="text-xs text-slate-600">
                          <strong>{item.customerName}</strong> — {item.evidence}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="text-sm font-bold text-slate-900 tabular-nums">
                          {item.amount > 0 ? formatCurrency(item.amount) : 'Operational'}
                        </span>
                        {item.category === 'unbilled_completed_job' ? (
                          <button
                            type="button"
                            onClick={() => {
                              const doc = demo.issueInvoiceForJob(item.sourceId)
                              toast.success(
                                `Issued ${doc.document_number}`,
                                `Billed ${formatCurrency(doc.total)} and cleared unbilled job leak.`,
                              )
                            }}
                            className="exec-btn-emerald whitespace-nowrap !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Issue Invoice Now
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={item.hasOpenTask}
                            onClick={() => {
                              const res = demo.createDemoFollowUpTask({
                                title: `Follow up: ${item.title}`,
                                customerId: item.customerId,
                                opportunityId: item.opportunityId,
                              })
                              if (res.duplicate) {
                                toast.info('Task already queued', res.task.title)
                              } else {
                                toast.success('Follow-up task queued', res.task.title)
                              }
                            }}
                            className="exec-btn-secondary whitespace-nowrap !px-3 !py-1.5 !text-xs touch-target"
                          >
                            {item.hasOpenTask ? 'Task Queued' : 'Create Task'}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Zero-Keyboard Ops Showcase & Print Operations Binder (10-second discoverability) */}
            <section
              aria-label="Zero-Keyboard Ops and Staged Approvals Preview"
              className="exec-surface p-5 sm:p-6 space-y-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Zero-Keyboard Ops &amp; Staged Bot Approvals
                    </h3>
                    <Badge tone="brand" className="whitespace-nowrap">
                      17 MCP Tools
                    </Badge>
                    <Badge tone="amber" className="whitespace-nowrap">
                      {demo.state.stagedOpsActions.filter(a => a.status === 'pending_approval').length} pending
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    Review truck-cab voicemails, vendor bill duplicate-fee flags, photo shelf counts, and readiness scorecards with 1-click owner approval.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="exec-btn-secondary whitespace-nowrap !px-3 !py-1.5 !text-xs touch-target"
                  >
                    <Printer className="h-3.5 w-3.5 shrink-0 text-[#ea580c]" aria-hidden="true" />
                    Print Operations Binder
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateSection('autopilot', { demo: true })}
                    className="exec-btn-primary whitespace-nowrap !px-3.5 !py-1.5 !text-xs touch-target"
                  >
                    Open Full Bot Queue ({demo.state.stagedOpsActions.length})
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {demo.state.stagedOpsActions.slice(0, 3).map(action => (
                  <div
                    key={action.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge
                          tone={
                            action.status === 'approved'
                              ? 'emerald'
                              : action.status === 'rejected'
                                ? 'rose'
                                : 'amber'
                          }
                        >
                          {action.status}
                        </Badge>
                        <span className="text-sm font-bold text-slate-950 tabular-nums">
                          {formatCents(action.amount_cents)}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-slate-900 leading-snug">
                        {action.title}
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed">{action.summary}</p>
                    </div>

                    {action.status === 'pending_approval' ? (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            demo.reviewDemoStagedOpsAction(action.id, 'approved')
                            toast.success('Staged action approved', action.title)
                          }}
                          className="exec-btn-emerald whitespace-nowrap flex-1 !px-3 !py-1.5 !text-xs touch-target"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            demo.reviewDemoStagedOpsAction(action.id, 'rejected')
                            toast.info('Staged action rejected', action.title)
                          }}
                          className="exec-btn-secondary whitespace-nowrap !px-3 !py-1.5 !text-xs touch-target"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <AutonomousSandboxPanel />

            {/* Vendor Bills & Open Tasks */}
            <div className="exec-surface p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">Vendor Bills &amp; Open Tasks</h3>
                <span className="text-xs font-semibold text-slate-600 tabular-nums">
                  Bills due: {formatCurrency(demo.opsSummary.bills_due)}
                </span>
              </div>

              <form
                onSubmit={e => {
                  e.preventDefault()
                  try {
                    const bill = demo.saveDemoExpense({
                      vendor: vendorName,
                      amount: Number(vendorAmount),
                      description: vendorDesc,
                    })
                    setVendorName('')
                    setVendorAmount('')
                    setVendorDesc('')
                    toast.success('Vendor bill recorded', `${bill.vendor} · ${formatCurrency(bill.amount)}`)
                  } catch (err) {
                    toast.error('Invalid bill', err instanceof Error ? err.message : 'Check fields.')
                  }
                }}
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
              >
                <input
                  type="text"
                  required
                  placeholder="Supplier name"
                  aria-label="Supplier name"
                  value={vendorName}
                  onChange={e => setVendorName(e.target.value)}
                  className="exec-input !text-xs"
                />
                <input
                  type="number"
                  required
                  min={1}
                  step="0.01"
                  placeholder="Amount ($)"
                  aria-label="Bill amount"
                  value={vendorAmount}
                  onChange={e => setVendorAmount(e.target.value)}
                  className="exec-input !text-xs tabular-nums"
                />
                <button type="submit" className="exec-btn-primary whitespace-nowrap !text-xs touch-target">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Log Vendor Bill
                </button>
              </form>

              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                {demo.state.expenses.map(exp => (
                  <li key={exp.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                    <div>
                      <p className="font-semibold text-slate-900">{exp.vendor}</p>
                      <p className="text-slate-500">{exp.description || 'Supplier invoice'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold tabular-nums">{formatCurrency(exp.amount)}</span>
                      <button
                        type="button"
                        onClick={() => demo.toggleDemoExpensePaid(exp.id, !exp.paid)}
                        className="exec-btn-secondary whitespace-nowrap !px-2.5 !py-1 !text-xs"
                      >
                        {exp.paid ? 'Paid ✓' : 'Mark Paid'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* ================================================================
            TAB 2: PIPELINE & CONSENT-GATED DRAFTS
           ================================================================ */}
        {section === 'pipeline' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Opportunities Queue */}
            <div className="exec-surface p-5 sm:p-6 lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Revenue Recovery Opportunities
                  </h3>
                  <p className="text-xs text-slate-600">
                    Atomic collection updates opportunity status and appends a recovery ledger entry.
                  </p>
                </div>
              </div>

              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {demo.state.opportunities.map(opp => {
                  const isRecovered = opp.status === 'recovered'
                  return (
                    <li key={opp.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{opp.title}</p>
                          <p className="text-xs text-slate-600">
                            {customerNameById(opp.customer_id)} · {opp.reason}
                          </p>
                        </div>
                        <Badge tone={isRecovered ? 'emerald' : 'amber'}>{opp.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-sm font-bold text-slate-950 tabular-nums">
                          {formatCurrency(opp.amount)}
                        </span>
                        {!isRecovered ? (
                          <button
                            type="button"
                            onClick={() => {
                              demo.collectDemoOpportunity(opp.id, opp.amount)
                              toast.success(
                                'Collection recorded',
                                `${formatCurrency(opp.amount)} marked collected in sandbox ledger.`,
                              )
                            }}
                            className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Record Collection ({formatCurrency(opp.amount)})
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Collected {formatCurrency(opp.recovered_amount ?? opp.amount)}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Consent Ledger + Draft Approval Queue */}
            <div className="space-y-6 lg:col-span-6">
              <div className="exec-surface p-5 sm:p-6 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Consent-Gated Outbound Drafts
                  </h3>
                  <p className="text-xs text-slate-600">
                    Approving a draft verifies active channel consent (`granted`) and keeps{' '}
                    <code>delivery_status = &apos;not_sent&apos;</code> until preflight.
                  </p>
                </div>

                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {demo.state.drafts.map(draft => {
                    const latestConsent = demo.state.consentEvents.find(
                      c => c.customer_id === draft.customer_id && c.channel === draft.channel,
                    )
                    return (
                      <li key={draft.id} className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                            {customerNameById(draft.customer_id)} · {draft.channel.toUpperCase()}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone={
                                latestConsent?.decision === 'granted' ? 'emerald' : 'rose'
                              }
                            >
                              Consent: {latestConsent?.decision ?? 'missing'}
                            </Badge>
                            <Badge
                              tone={
                                draft.status === 'approved'
                                  ? 'emerald'
                                  : draft.status === 'rejected'
                                    ? 'rose'
                                    : 'amber'
                              }
                            >
                              {draft.status}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{draft.subject}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">{draft.message}</p>
                        {draft.status !== 'approved' ? (
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  demo.reviewDemoDraft(draft.id, 'approved')
                                  toast.success(
                                    'Draft approved after consent check',
                                    'Audit event logged with delivery_status: not_sent.',
                                  )
                                } catch (err) {
                                  toast.error(
                                    'Consent Guard Blocked Approval',
                                    err instanceof Error ? err.message : 'Consent missing.',
                                  )
                                }
                              }}
                              className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                            >
                              Verify Consent & Approve
                            </button>
                            {draft.status === 'draft' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  demo.reviewDemoDraft(draft.id, 'rejected')
                                  toast.info('Draft rejected')
                                }}
                                className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                              >
                                Reject
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>

              <form
                onSubmit={e => {
                  e.preventDefault()
                  try {
                    const ev = demo.recordDemoConsent({
                      customerId: consentCustomerId,
                      channel: consentChannel,
                      decision: consentDecision,
                      evidenceReference: consentEvidence,
                    })
                    toast.success(
                      `Recorded ${ev.decision} consent`,
                      `${customerNameById(ev.customer_id)} (${ev.channel.toUpperCase()})`,
                    )
                  } catch (err) {
                    toast.error('Consent error', err instanceof Error ? err.message : 'Invalid input.')
                  }
                }}
                className="exec-surface p-5 space-y-3"
              >
                <h4 className="text-sm font-bold text-slate-900">
                  Record Channel Consent Grant / Revocation
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <select
                    aria-label="Select customer for consent event"
                    value={consentCustomerId}
                    onChange={e => setConsentCustomerId(e.target.value)}
                    className="exec-input !text-xs"
                  >
                    {demo.state.customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {customerDisplayName(c)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Communication channel"
                    value={consentChannel}
                    onChange={e => setConsentChannel(e.target.value as ConsentChannel)}
                    className="exec-input !text-xs"
                  >
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                    <option value="call">Phone Call</option>
                  </select>
                  <select
                    aria-label="Consent decision"
                    value={consentDecision}
                    onChange={e => setConsentDecision(e.target.value as ConsentDecision)}
                    className="exec-input !text-xs"
                  >
                    <option value="granted">Grant Opt-In</option>
                    <option value="revoked">Revoke (Auto-Rejects Drafts)</option>
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    required
                    minLength={8}
                    aria-label="Consent evidence reference"
                    value={consentEvidence}
                    onChange={e => setConsentEvidence(e.target.value)}
                    placeholder="Evidence reference (8+ chars)"
                    className="exec-input !text-xs flex-1"
                  />
                  <button type="submit" className="exec-btn-secondary !text-xs touch-target">
                    Append Consent Event
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {/* ================================================================
            TAB 3: DISPATCH & JOBS
           ================================================================ */}
        {section === 'dispatch' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4">
              <h3 className="text-base font-bold text-slate-900">Active Work Orders & Quotes</h3>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {demo.state.jobs.map(job => {
                  const billable = calculateJobBillableTotal(job, demo.state.jobMaterials)
                  const unbilledCompleted = job.status === 'completed' && !job.invoice_id
                  return (
                    <li key={job.id} className="p-4 space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{job.title}</p>
                          <p className="text-xs text-slate-600">
                            {customerNameById(job.customer_id)} · Billable total{' '}
                            <strong className="tabular-nums">{formatCurrency(billable)}</strong>
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            tone={
                              unbilledCompleted
                                ? 'rose'
                                : job.status === 'completed'
                                  ? 'emerald'
                                  : 'brand'
                            }
                          >
                            {unbilledCompleted ? 'Completed · Unbilled' : job.status}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {unbilledCompleted ? (
                          <button
                            type="button"
                            onClick={() => {
                              const doc = demo.issueInvoiceForJob(job.id)
                              toast.success(
                                `Invoice ${doc.document_number} issued`,
                                `${formatCurrency(doc.total)} linked to job.`,
                              )
                            }}
                            className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Generate Invoice ({formatCurrency(billable)})
                          </button>
                        ) : null}
                        {job.status === 'quoted' ? (
                          <button
                            type="button"
                            onClick={() => {
                              demo.transitionJob(
                                job.id,
                                'approved',
                                'Signed homeowner quote acceptance #QTE-2041',
                              )
                              toast.success('Quote approved', 'Approval evidence saved on job.')
                            }}
                            className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Record Approval
                          </button>
                        ) : null}
                        {job.status === 'in_progress' || job.status === 'scheduled' ? (
                          <button
                            type="button"
                            onClick={() => {
                              demo.transitionJob(job.id, 'completed')
                              toast.success(
                                'Job marked completed',
                                'Generate invoice to bill labor and materials.',
                              )
                            }}
                            className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Mark Completed
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="space-y-6 lg:col-span-5">
              <form
                onSubmit={e => {
                  e.preventDefault()
                  try {
                    const appt = demo.scheduleDemoJob({
                      jobId: scheduleJobId,
                      assignedWorker: scheduleWorkerId,
                      startsAt: new Date(scheduleStart).toISOString(),
                      endsAt: new Date(scheduleEnd).toISOString(),
                    })
                    toast.success('Technician dispatched', `${appt.title} added to calendar.`)
                  } catch (err) {
                    toast.error(
                      'Dispatch Guard',
                      err instanceof Error ? err.message : 'Unable to schedule.',
                    )
                  }
                }}
                className="exec-surface p-5 space-y-3.5"
              >
                <h3 className="text-base font-bold text-slate-900">
                  Conflict-Checked Job Scheduler
                </h3>
                <div>
                  <label htmlFor="demo-sched-job" className="exec-label">
                    Work Order
                  </label>
                  <select
                    id="demo-sched-job"
                    value={scheduleJobId}
                    onChange={e => setScheduleJobId(e.target.value)}
                    className="exec-input !text-xs"
                  >
                    {demo.state.jobs.map(j => (
                      <option key={j.id} value={j.id}>
                        {j.title} ({j.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="demo-sched-tech" className="exec-label">
                    Assigned Technician
                  </label>
                  <select
                    id="demo-sched-tech"
                    value={scheduleWorkerId}
                    onChange={e => setScheduleWorkerId(e.target.value)}
                    className="exec-input !text-xs"
                  >
                    {demo.state.employees.map(emp => (
                      <option key={emp.user_id} value={emp.user_id}>
                        {emp.display_name} — {emp.job_title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="demo-sched-start" className="exec-label">
                      Start Window
                    </label>
                    <input
                      id="demo-sched-start"
                      type="datetime-local"
                      required
                      value={scheduleStart}
                      onChange={e => setScheduleStart(e.target.value)}
                      className="exec-input !text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="demo-sched-end" className="exec-label">
                      End Window
                    </label>
                    <input
                      id="demo-sched-end"
                      type="datetime-local"
                      required
                      value={scheduleEnd}
                      onChange={e => setScheduleEnd(e.target.value)}
                      className="exec-input !text-xs"
                    />
                  </div>
                </div>
                <button type="submit" className="exec-btn-primary w-full touch-target !text-xs">
                  Assign Dispatch Slot
                </button>
              </form>

              <div className="exec-surface p-5 space-y-3">
                <h4 className="text-sm font-bold text-slate-900">Technician Calendar</h4>
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                  {demo.state.appointments.map(appt => {
                    const tech = demo.state.employees.find(e => e.user_id === appt.assigned_worker)
                    return (
                      <li key={appt.id} className="p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{appt.title}</span>
                          <Badge tone="brand">{appt.status}</Badge>
                        </div>
                        <p className="text-slate-600 tabular-nums">
                          {tech?.display_name ?? 'Unassigned'} · {formatDateTime(appt.starts_at)}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {/* ================================================================
            TAB 4: INVENTORY & PURCHASE ORDERS
           ================================================================ */}
        {section === 'inventory' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            <div className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Parts & Refrigerant Stock Ledger
                  </h3>
                  <p className="text-xs text-slate-600">
                    Available stock subtracts reserved job materials before triggering reorder alerts.
                  </p>
                </div>
              </div>

              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {demo.state.inventoryItems.map(item => {
                  const available = item.quantity - item.reserved
                  const low = available <= item.reorder_threshold
                  return (
                    <li key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-700">
                            {item.sku}
                          </span>
                          <span className="text-sm font-bold text-slate-900">{item.name}</span>
                          {low ? (
                            <Badge tone="rose">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              Low Stock
                            </Badge>
                          ) : (
                            <Badge tone="emerald">Healthy</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-600 tabular-nums">
                          On hand: <strong>{item.quantity}</strong> · Reserved:{' '}
                          <strong>{item.reserved}</strong> · Available: <strong>{available}</strong>{' '}
                          (Reorder ≤ {item.reorder_threshold}) · Cost{' '}
                          {formatCurrency(item.purchase_cost)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            const po = demo.createDraftPurchaseOrder(item.id)
                            toast.success(
                              'Draft PO created',
                              `${po.quantity} units of ${item.sku} queued for owner approval.`,
                            )
                          }}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          Draft Restock PO
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4 lg:sticky lg:top-20">
              <h3 className="text-base font-bold text-slate-900">Supplier Purchase Orders</h3>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {demo.state.purchaseOrders.map(po => {
                  const sku = demo.state.inventoryItems.find(i => i.id === po.item_id)
                  return (
                    <li key={po.id} className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {sku?.sku ?? 'SKU'} · {po.quantity} units
                          </p>
                          <p className="text-xs text-slate-600 tabular-nums">
                            {po.supplier ?? 'Supplier'} · Total{' '}
                            {formatCurrency(po.quantity * po.unit_cost)}
                          </p>
                        </div>
                        <Badge
                          tone={
                            po.status === 'received'
                              ? 'emerald'
                              : po.status === 'approved'
                                ? 'brand'
                                : 'amber'
                          }
                        >
                          {po.status}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {po.status === 'draft' ? (
                          <button
                            type="button"
                            onClick={() => {
                              demo.transitionPurchaseOrder(po.id, 'approved')
                              toast.success('Purchase Order approved', 'Ready to receive shipment.')
                            }}
                            className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Owner Approve PO
                          </button>
                        ) : null}
                        {po.status === 'approved' ? (
                          <button
                            type="button"
                            onClick={() => {
                              demo.transitionPurchaseOrder(
                                po.id,
                                'received',
                                `PACKING-SLIP-${po.id.slice(0, 4).toUpperCase()}`,
                              )
                              toast.success(
                                'Shipment received into stock',
                                `+${po.quantity} units added to ${sku?.sku ?? 'inventory'}.`,
                              )
                            }}
                            className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Receive & Post Stock (+{po.quantity})
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        ) : null}

        {/* ================================================================
            TAB 5: AUTOPILOT & BILLING
           ================================================================ */}
        {section === 'autopilot' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            <div className="space-y-6 lg:col-span-7">
              <div className="exec-surface p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Human-in-the-Loop Workflow Approvals
                    </h3>
                    <p className="text-xs text-slate-600">
                      High-value quote and recovery rules pause in <code>waiting_approval</code> until
                      an owner approves execution.
                    </p>
                  </div>
                </div>

                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {demo.state.workflowRuns.map(run => {
                    const wf = demo.state.workflows.find(w => w.id === run.workflow_id)
                    return (
                      <li key={run.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              {wf?.name ?? 'Workflow Run'}
                            </span>
                            <Badge
                              tone={run.status === 'completed' ? 'emerald' : 'amber'}
                            >
                              {run.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            Record:{' '}
                            {String(run.context.record?.title ?? 'Stalled Quote QTE-2041')}
                          </p>
                        </div>
                        {run.status === 'waiting_approval' ? (
                          <button
                            type="button"
                            onClick={() => {
                              demo.approveWorkflowRun(run.id)
                              toast.success(
                                'Workflow run approved',
                                'Follow-up task created in Command Center.',
                              )
                            }}
                            className="exec-btn-emerald !px-3.5 !py-2 !text-xs touch-target"
                          >
                            Approve & Execute
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700">
                            Approved & Completed ✓
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="exec-surface p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Zero-Keyboard Ops, Remote HTTPS MCP &amp; Staged Bot Approvals
                    </h3>
                    <p className="text-xs text-slate-600">
                      Remote MCP Endpoint:{' '}
                      <code>/functions/v1/loose-ends-mcp (sandbox preview)</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="exec-btn-secondary whitespace-nowrap !px-3 !py-1.5 !text-xs touch-target"
                    >
                      <Printer className="h-3.5 w-3.5 shrink-0 text-[#ea580c]" aria-hidden="true" />
                      Print Operations Binder
                    </button>
                    <Badge tone="brand" className="whitespace-nowrap">
                      grok-4.7 · 17 MCP Tools
                    </Badge>
                  </div>
                </div>

                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {demo.state.stagedOpsActions.map(action => (
                    <li key={action.id} className="p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs sm:text-sm font-bold text-slate-900">
                            {action.title}
                          </span>
                          <Badge tone="neutral">{action.workspace_domain}</Badge>
                          <Badge
                            tone={
                              action.action_type === 'vendor_bill_audit' ||
                              action.action_type === 'discrepancy_flag'
                                ? 'rose'
                                : 'neutral'
                            }
                          >
                            {action.action_type}
                          </Badge>
                          <Badge
                            tone={
                              action.status === 'approved'
                                ? 'emerald'
                                : action.status === 'rejected'
                                  ? 'rose'
                                  : 'amber'
                            }
                          >
                            {action.status}
                          </Badge>
                        </div>
                        <span className="text-sm font-bold text-slate-950 tabular-nums">
                          {formatCents(action.amount_cents)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{action.summary}</p>
                      {action.status === 'pending_approval' ? (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              demo.reviewDemoStagedOpsAction(action.id, 'approved')
                              toast.success('Staged action approved', action.title)
                            }}
                            className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Approve Action
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              demo.reviewDemoStagedOpsAction(action.id, 'rejected')
                              toast.info('Staged action rejected', action.title)
                            }}
                            className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  {demo.state.botManuals.map(manual => (
                    <div
                      key={manual.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <span className="font-bold uppercase text-slate-800 whitespace-nowrap">
                        {manual.bot_role.replace(/_/g, ' ')}
                      </span>
                      <select
                        aria-label={`${manual.bot_role} autonomy mode`}
                        value={manual.mode}
                        onChange={e =>
                          demo.updateDemoBotManual({
                            botRole: manual.bot_role,
                            mode: e.target.value as 'observe' | 'propose' | 'auto_with_escalation',
                            instructionsMarkdown: manual.instructions_markdown,
                          })
                        }
                        className="exec-input w-full sm:!w-auto !py-1.5 !px-2.5 !text-xs font-semibold"
                      >
                        <option value="observe">Observe</option>
                        <option value="propose">Propose (Owner Gate)</option>
                        <option value="auto_with_escalation">Auto + Escalate</option>
                      </select>
                    </div>
                  ))}
                </div>

                <form
                  onSubmit={e => {
                    e.preventDefault()
                    try {
                      const entry = demo.parseDemoReceiptWithGrokBot(demoReceiptText)
                      toast.success(
                        entry.entry_type === 'discrepancy_flag'
                          ? 'Discrepancy flagged in staged ledger'
                          : 'Receipt parsed & staged for approval',
                        `${entry.vendor_name ?? 'Vendor'} · ${formatCents(entry.amount_cents)}`,
                      )
                    } catch (err) {
                      toast.error(
                        'Parse error',
                        err instanceof Error ? err.message : 'Check receipt text.',
                      )
                    }
                  }}
                  className="space-y-2.5"
                >
                  <label htmlFor="demo-grok-receipt" className="exec-label">
                    Test Receipt / Vendor Bill Parser (Integer Cent Recomputation)
                  </label>
                  <textarea
                    id="demo-grok-receipt"
                    rows={4}
                    value={demoReceiptText}
                    onChange={e => setDemoReceiptText(e.target.value)}
                    className="exec-input font-mono !text-xs"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
                    >
                      Parse & Stage Receipt
                    </button>
                  </div>
                </form>

                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {demo.state.stagedLedgerEntries.map(entry => (
                    <li key={entry.id} className="p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs sm:text-sm font-bold text-slate-900">
                            {entry.vendor_name ?? entry.entry_type}
                          </span>
                          <Badge
                            tone={entry.entry_type === 'discrepancy_flag' ? 'rose' : 'neutral'}
                          >
                            {entry.entry_type}
                          </Badge>
                          <Badge
                            tone={
                              entry.status === 'approved'
                                ? 'emerald'
                                : entry.status === 'rejected'
                                  ? 'rose'
                                  : 'amber'
                            }
                          >
                            {entry.status}
                          </Badge>
                        </div>
                        <span className="text-sm font-bold text-slate-950 tabular-nums">
                          {formatCents(entry.amount_cents)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{entry.reasoning_summary}</p>
                      {entry.status === 'pending_approval' ? (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              demo.reviewDemoStagedEntry(entry.id, 'approved')
                              toast.success('Staged entry approved', entry.vendor_name ?? '')
                            }}
                            className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Approve Entry
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              demo.reviewDemoStagedEntry(entry.id, 'rejected')
                              toast.info('Staged entry rejected', entry.vendor_name ?? '')
                            }}
                            className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="exec-surface p-5 sm:p-6 space-y-4">
                <h3 className="text-base font-bold text-slate-900">
                  Coordination & Operating Hours Policy
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                  <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 cursor-pointer">
                    <span className="font-semibold text-slate-800">
                      Autopilot Queue Enabled
                    </span>
                    <input
                      type="checkbox"
                      checked={demo.state.policy.enabled}
                      onChange={e => demo.updateDemoPolicy({ enabled: e.target.checked })}
                      className="h-4 w-4 accent-[#ea580c]"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 cursor-pointer">
                    <span className="font-semibold text-slate-800">
                      Enforce {demo.state.policy.business_start}–{demo.state.policy.business_end}{' '}
                      Hours
                    </span>
                    <input
                      type="checkbox"
                      checked={demo.state.policy.enforce_hours}
                      onChange={e =>
                        demo.updateDemoPolicy({ enforce_hours: e.target.checked })
                      }
                      className="h-4 w-4 accent-[#ea580c]"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4 lg:sticky lg:top-20">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Immutable Audit Trail</h3>
                <Badge tone="neutral">{demo.state.auditEvents.length} events</Badge>
              </div>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                {demo.state.auditEvents.map(ev => (
                  <li key={ev.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-slate-900">{ev.action}</span>
                      <span className="text-slate-500 tabular-nums">
                        {formatDateTime(ev.created_at)}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      Entity: {ev.entity_type} · {JSON.stringify(ev.metadata)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : section === 'quotes' || section === 'invoices' || section === 'autonomy' ? (
          <AutonomousSandboxPanel />
        ) : null}
      </main>

      {/* Mobile 5-Tab Bottom Navigation Bar */}
      <nav
        aria-label="Mobile sandbox navigation"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/98 backdrop-blur-xs lg:hidden"
      >
        <div className="grid grid-cols-5">
          {DEMO_TABS.map(tab => {
            const Icon = tab.icon
            const active = tab.section === section
            return (
              <button
                key={tab.section}
                type="button"
                data-touch="true"
                aria-current={active ? 'page' : undefined}
                onClick={() => navigateSection(tab.section, { demo: true })}
                className={`touch-target flex flex-col items-center justify-center gap-1 py-2 px-1 text-[11px] font-semibold transition ${
                  active
                    ? 'text-[#9a3412] bg-[#fff7ed] border-t-2 border-[#ea580c]'
                    : 'text-slate-500 border-t-2 border-transparent hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${active ? 'text-[#ea580c]' : 'text-slate-400'}`}
                  aria-hidden="true"
                />
                <span className="truncate max-w-full">{tab.mobileLabel}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <RoiAuditCalculatorModal open={roiOpen} onClose={() => setRoiOpen(false)} />
    </div>
  )
}
