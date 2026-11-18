import type { CustomerSummaryRef, OpsInvoiceAgingKey } from '../types/domain'

const DAY_MS = 86_400_000

export function formatCurrency(
  amount: number | null | undefined,
  options?: { currency?: string; maximumFractionDigits?: number },
): string {
  const safe = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
  const currency = options?.currency || 'USD'
  const hasCents = Math.abs(Math.round(safe * 100) % 100) > 0
  const maximumFractionDigits = options?.maximumFractionDigits ?? (hasCents ? 2 : 0)
  const minimumFractionDigits = hasCents && maximumFractionDigits >= 2 ? 2 : 0

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(safe)
}

export function formatCents(amountCents: number | null | undefined, currency = 'USD'): string {
  const safeCents = typeof amountCents === 'number' && Number.isFinite(amountCents) ? amountCents : 0
  return formatCurrency(safeCents / 100, { currency, maximumFractionDigits: 2 })
}

export function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

export function daysElapsedSince(
  iso: string | null | undefined,
  now: Date | number = Date.now(),
): number {
  const targetMs = parseIsoMs(iso)
  if (targetMs === null) return 0
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return Math.max(0, Math.floor((nowMs - targetMs) / DAY_MS))
}

export function daysPastDue(
  dueAt: string | null | undefined,
  now: Date | number = Date.now(),
): number {
  const dueMs = parseIsoMs(dueAt)
  if (dueMs === null) return 0
  const nowMs = typeof now === 'number' ? now : now.getTime()
  if (nowMs <= dueMs) return 0
  return Math.floor((nowMs - dueMs) / DAY_MS)
}

export function agingBucketForDays(daysOverdue: number): OpsInvoiceAgingKey {
  if (daysOverdue <= 0) return 'not_due'
  if (daysOverdue <= 30) return 'days_1_30'
  if (daysOverdue <= 60) return 'days_31_60'
  if (daysOverdue <= 90) return 'days_61_90'
  return 'over_90'
}

export function formatAgingBadge(
  dueAt: string | null | undefined,
  now: Date | number = Date.now(),
): string {
  const dueMs = parseIsoMs(dueAt)
  if (dueMs === null) return 'No due date'
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const diffDays = Math.floor((nowMs - dueMs) / DAY_MS)
  if (diffDays > 0) {
    return `${diffDays}d past due`
  }
  if (diffDays === 0) {
    return 'Due today'
  }
  return `Due in ${Math.abs(diffDays)}d`
}

function resolveValidTimeZone(timezone?: string | null): string {
  const candidate = timezone?.trim() || 'America/New_York'
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate })
    return candidate
  } catch {
    return 'America/New_York'
  }
}

export function formatDate(
  iso: string | null | undefined,
  timezone?: string | null,
): string {
  const ms = parseIsoMs(iso)
  if (ms === null) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: resolveValidTimeZone(timezone),
  }).format(new Date(ms))
}

export function formatDateTime(
  iso: string | null | undefined,
  timezone?: string | null,
): string {
  const ms = parseIsoMs(iso)
  if (ms === null) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: resolveValidTimeZone(timezone),
  }).format(new Date(ms))
}

export function formatInTimezone(
  iso: string | null | undefined,
  timezone: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  const ms = parseIsoMs(iso)
  if (ms === null) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: resolveValidTimeZone(timezone),
    ...(options ?? {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
  }).format(new Date(ms))
}

export function customerDisplayName(customer: CustomerSummaryRef | null | undefined): string {
  if (!customer) return 'Unassigned Customer'
  const full = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
  if (full) return full
  if (customer.email) return customer.email
  if (customer.phone) return customer.phone
  return 'Customer'
}
