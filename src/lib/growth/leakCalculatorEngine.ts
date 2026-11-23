import type { OutreachLane } from '../../types/domain'

export const LOOSE_ENDS_MONTHLY_CENTS = 19_900 // $199.00/mo flat unlimited seats
export const LEGACY_BASE_PLATFORM_CENTS = 15_000 // $150.00/mo QBO/accounting base
export const LEGACY_PER_SEAT_MONTHLY_CENTS = 7_900 // $79.00/mo per user across fragmented CRM/FSM/e-sign/AP tools

export const UNBILLED_QUOTES_BPS = 150 // 1.50% of monthly revenue leaked in unbilled quotes/jobs
export const AR_EXPOSURE_SHARE_BPS = 6_000 // 60% overdue AR invoices / 40% vendor AP bills
export const OVERDUE_AR_RECOVERY_BPS = 600 // 6.00% of monthly overdue AR recovered via automated collections
export const VENDOR_SPIKE_CATCH_BPS = 450 // 4.50% of monthly vendor bills saved via >10% spike & dup freeze

export const LEAK_CALCULATOR_BOUNDS = {
  monthlyRevenueCents: {
    min: 2_000_000, // $20,000
    max: 50_000_000, // $500,000
    step: 500_000, // $5,000
    default: 12_000_000, // $120,000
  },
  teamSeats: {
    min: 3,
    max: 50,
    step: 1,
    default: 12,
  },
  monthlyOverdueAndBillsCents: {
    min: 200_000, // $2,000
    max: 15_000_000, // $150,000
    step: 100_000, // $1,000
    default: 3_500_000, // $35,000
  },
} as const

export interface LeakCalculatorInput {
  monthlyRevenueCents: number
  teamSeats: number
  monthlyOverdueAndBillsCents: number
}

export interface LeakCalculatorResult {
  monthly_revenue_cents: number
  team_seats: number
  monthly_overdue_and_bills_cents: number
  legacy_monthly_cents: number
  loose_ends_monthly_cents: number
  monthly_seat_tax_savings_cents: number
  annual_seat_tax_savings_cents: number
  monthly_ar_exposure_cents: number
  monthly_ap_exposure_cents: number
  monthly_unbilled_quotes_cents: number
  monthly_overdue_ar_recovery_cents: number
  monthly_vendor_spike_savings_cents: number
  annual_unbilled_quotes_cents: number
  annual_overdue_ar_recovery_cents: number
  annual_vendor_spike_savings_cents: number
  monthly_recoverable_cash_cents: number
  annual_recoverable_cash_cents: number
  monthly_total_impact_cents: number
  annual_total_impact_cents: number
  payback_days: number
}

export interface CalculatorPreset {
  id: string
  label: string
  input: LeakCalculatorInput
}

export const CALCULATOR_PRESETS: readonly CalculatorPreset[] = [
  {
    id: 'small_trade',
    label: '5-Tech HVAC / Trade ($45k/mo)',
    input: {
      monthlyRevenueCents: 4_500_000,
      teamSeats: 6,
      monthlyOverdueAndBillsCents: 1_400_000,
    },
  },
  {
    id: 'mid_contractor',
    label: '12-Seat Mechanical ($120k/mo)',
    input: {
      monthlyRevenueCents: 12_000_000,
      teamSeats: 12,
      monthlyOverdueAndBillsCents: 3_500_000,
    },
  },
  {
    id: 'multi_entity',
    label: '28-Seat Multi-Entity Clinic/GC ($320k/mo)',
    input: {
      monthlyRevenueCents: 32_000_000,
      teamSeats: 28,
      monthlyOverdueAndBillsCents: 9_000_000,
    },
  },
]

function clampSafeInt(raw: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(raw)) {
    throw new Error(`${label} must be a finite number.`)
  }
  const rounded = Math.trunc(raw)
  if (!Number.isSafeInteger(rounded)) {
    throw new Error(`${label} must fit within safe integer bounds.`)
  }
  return Math.max(min, Math.min(max, rounded))
}

function mulBps(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000)
}

/**
 * Computes deterministic integer-cent seat-tax savings vs QuickBooks/Zoho stacks,
 * recoverable operational cash (unbilled quotes, overdue AR, >10% vendor spikes),
 * and ROI payback period against the flat $199/mo Loose Ends subscription.
 */
export function calculateOpsLeakEstimate(input: LeakCalculatorInput): LeakCalculatorResult {
  const revCents = clampSafeInt(
    input.monthlyRevenueCents,
    LEAK_CALCULATOR_BOUNDS.monthlyRevenueCents.min,
    LEAK_CALCULATOR_BOUNDS.monthlyRevenueCents.max,
    'monthlyRevenueCents',
  )
  const seats = clampSafeInt(
    input.teamSeats,
    LEAK_CALCULATOR_BOUNDS.teamSeats.min,
    LEAK_CALCULATOR_BOUNDS.teamSeats.max,
    'teamSeats',
  )
  const exposureCents = clampSafeInt(
    input.monthlyOverdueAndBillsCents,
    LEAK_CALCULATOR_BOUNDS.monthlyOverdueAndBillsCents.min,
    LEAK_CALCULATOR_BOUNDS.monthlyOverdueAndBillsCents.max,
    'monthlyOverdueAndBillsCents',
  )

  const legacyMonthlyCents =
    LEGACY_BASE_PLATFORM_CENTS + seats * LEGACY_PER_SEAT_MONTHLY_CENTS
  const monthlySeatTaxSavingsCents = Math.max(
    0,
    legacyMonthlyCents - LOOSE_ENDS_MONTHLY_CENTS,
  )
  const annualSeatTaxSavingsCents = monthlySeatTaxSavingsCents * 12

  const monthlyUnbilledQuotesCents = mulBps(revCents, UNBILLED_QUOTES_BPS)
  const monthlyArExposureCents = mulBps(exposureCents, AR_EXPOSURE_SHARE_BPS)
  const monthlyApExposureCents = exposureCents - monthlyArExposureCents

  const monthlyOverdueArRecoveryCents = mulBps(
    monthlyArExposureCents,
    OVERDUE_AR_RECOVERY_BPS,
  )
  const monthlyVendorSpikeSavingsCents = mulBps(
    monthlyApExposureCents,
    VENDOR_SPIKE_CATCH_BPS,
  )

  const monthlyRecoverableCashCents =
    monthlyUnbilledQuotesCents +
    monthlyOverdueArRecoveryCents +
    monthlyVendorSpikeSavingsCents
  const annualRecoverableCashCents = monthlyRecoverableCashCents * 12

  const monthlyTotalImpactCents =
    monthlySeatTaxSavingsCents + monthlyRecoverableCashCents
  const annualTotalImpactCents =
    annualSeatTaxSavingsCents + annualRecoverableCashCents

  const paybackDays =
    monthlyTotalImpactCents > 0
      ? Math.max(1, Math.ceil((LOOSE_ENDS_MONTHLY_CENTS * 30) / monthlyTotalImpactCents))
      : 30

  return {
    monthly_revenue_cents: revCents,
    team_seats: seats,
    monthly_overdue_and_bills_cents: exposureCents,
    legacy_monthly_cents: legacyMonthlyCents,
    loose_ends_monthly_cents: LOOSE_ENDS_MONTHLY_CENTS,
    monthly_seat_tax_savings_cents: monthlySeatTaxSavingsCents,
    annual_seat_tax_savings_cents: annualSeatTaxSavingsCents,
    monthly_ar_exposure_cents: monthlyArExposureCents,
    monthly_ap_exposure_cents: monthlyApExposureCents,
    monthly_unbilled_quotes_cents: monthlyUnbilledQuotesCents,
    monthly_overdue_ar_recovery_cents: monthlyOverdueArRecoveryCents,
    monthly_vendor_spike_savings_cents: monthlyVendorSpikeSavingsCents,
    annual_unbilled_quotes_cents: monthlyUnbilledQuotesCents * 12,
    annual_overdue_ar_recovery_cents: monthlyOverdueArRecoveryCents * 12,
    annual_vendor_spike_savings_cents: monthlyVendorSpikeSavingsCents * 12,
    monthly_recoverable_cash_cents: monthlyRecoverableCashCents,
    annual_recoverable_cash_cents: annualRecoverableCashCents,
    monthly_total_impact_cents: monthlyTotalImpactCents,
    annual_total_impact_cents: annualTotalImpactCents,
    payback_days: paybackDays,
  }
}

export function formatCalculatorDollars(cents: number): string {
  const whole = Math.round(cents / 100)
  return `$${whole.toLocaleString('en-US')}`
}

export function formatCalculatorExactCents(cents: number): string {
  const abs = Math.abs(Math.trunc(cents))
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  const rem = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}$${dollars}.${rem}`
}

const CALCULATOR_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateCalculatorEmail(raw: string): {
  valid: boolean
  normalized: string
  error: string | null
} {
  const normalized = raw.trim().toLowerCase()
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter your work email to send the checklist and launch the sandbox.',
    }
  }
  if (!CALCULATOR_EMAIL_REGEX.test(normalized) || normalized.length > 200) {
    return {
      valid: false,
      normalized,
      error: 'Enter a valid work email address (e.g. owner@company.com).',
    }
  }
  return { valid: true, normalized, error: null }
}

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
])

function deriveBusinessLabelFromEmail(email: string): string {
  const [localPart = 'Owner', domain = 'inbound'] = email.split('@')
  if (FREE_MAIL_DOMAINS.has(domain)) {
    const cleanLocal = localPart.replace(/[^A-Za-z0-9]/g, ' ').trim() || 'Inbound Lead'
    return `${cleanLocal} (${email})`
  }
  const root = domain.split('.')[0] || domain
  const formatted = root
    .split(/[-_]+/)
    .filter(Boolean)
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ')
  return `${formatted || domain} (${email})`
}

export interface InboundCalculatorLeadPayload {
  workspace_id: null
  name: string
  business: string
  contact_name: string
  email: string
  contact_email: string
  business_type: string
  biggest_problem: string
  notes: string
  outreach_lane: OutreachLane
  status: 'DRAFT_READY'
  score: number
}

export function buildInboundCalculatorLeadRow(
  rawEmail: string,
  estimate: LeakCalculatorResult,
): InboundCalculatorLeadPayload {
  const validation = validateCalculatorEmail(rawEmail)
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Valid email address is required.')
  }
  const email = validation.normalized
  const localName = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Inbound Owner'
  const business = deriveBusinessLabelFromEmail(email)

  return {
    workspace_id: null,
    name: localName,
    business,
    contact_name: localName,
    email,
    contact_email: email,
    business_type: 'QuickBooks & Ops Leak Estimator',
    biggest_problem: `Est. ${formatCalculatorDollars(estimate.annual_total_impact_cents)}/yr savings + recoverable cash (${estimate.team_seats} seats)`,
    notes:
      `[INBOUND CALCULATOR] Rev ${formatCalculatorExactCents(estimate.monthly_revenue_cents)}/mo | ` +
      `${estimate.team_seats} seats | AR+AP ${formatCalculatorExactCents(estimate.monthly_overdue_and_bills_cents)}/mo | ` +
      `Seat Savings ${formatCalculatorExactCents(estimate.annual_seat_tax_savings_cents)}/yr | ` +
      `Recoverable ${formatCalculatorExactCents(estimate.annual_recoverable_cash_cents)}/yr | ` +
      `Payback ${estimate.payback_days}d`,
    outreach_lane: 'inbound_calculator',
    status: 'DRAFT_READY',
    score: 95,
  }
}
