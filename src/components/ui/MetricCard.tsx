import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export type BadgeTone = 'neutral' | 'emerald' | 'amber' | 'rose' | 'sky' | 'obsidian'

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border border-slate-200',
  emerald: 'pill-emerald',
  amber: 'pill-amber',
  rose: 'pill-rose',
  sky: 'bg-sky-50 text-sky-800 border border-sky-200',
  obsidian: 'bg-slate-900 text-white border border-slate-800',
}

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-tight ${BADGE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export interface MetricCardProps {
  label: string
  value: string | number
  subtitle?: string
  badge?: { text: string; tone?: BadgeTone }
  icon?: React.ReactNode
  accent?: 'slate' | 'emerald' | 'amber' | 'rose' | 'sky'
  onClick?: () => void
}

const ACCENT_TOP_BAR: Record<NonNullable<MetricCardProps['accent']>, string> = {
  slate: 'bg-slate-800',
  emerald: 'bg-emerald-600',
  amber: 'bg-amber-500',
  rose: 'bg-rose-600',
  sky: 'bg-sky-600',
}

export function MetricCard({
  label,
  value,
  subtitle,
  badge,
  icon,
  accent = 'slate',
  onClick,
}: MetricCardProps): React.ReactElement {
  const content = (
    <>
      <div className={`h-1 w-full ${ACCENT_TOP_BAR[accent]}`} aria-hidden="true" />
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
          {icon ? (
            <span className="text-slate-400" aria-hidden="true">
              {icon}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-2xl sm:text-[1.65rem] font-bold tracking-tight text-slate-900 tabular-nums">
            {value}
          </span>
          {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
        </div>
        {subtitle ? (
          <p className="mt-1.5 text-xs text-slate-600 leading-snug">{subtitle}</p>
        ) : null}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="exec-surface group relative overflow-hidden text-left w-full transition-shadow hover:border-slate-300 hover:shadow-md"
      >
        {content}
      </button>
    )
  }

  return <div className="exec-surface relative overflow-hidden">{content}</div>
}

export function PaginationBar({
  page,
  pageSize,
  currentCount,
  hasMore,
  onPageChange,
  label = 'Records',
}: {
  page: number
  pageSize: number
  currentCount: number
  hasMore: boolean
  onPageChange: (nextPage: number) => void
  label?: string
}): React.ReactElement {
  const start = currentCount === 0 ? 0 : page * pageSize + 1
  const end = page * pageSize + currentCount

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600"
    >
      <span className="tabular-nums">
        {currentCount === 0 ? `No ${label.toLowerCase()} on this page` : `Showing ${start}–${end}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
          className="exec-btn-secondary !min-h-[38px] !px-3 !py-1.5 !text-xs"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Previous
        </button>
        <span className="px-1.5 font-semibold text-slate-800 tabular-nums">Page {page + 1}</span>
        <button
          type="button"
          disabled={!hasMore}
          onClick={() => onPageChange(page + 1)}
          className="exec-btn-secondary !min-h-[38px] !px-3 !py-1.5 !text-xs"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      {icon ? (
        <div
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 shadow-xs"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-xs sm:text-sm text-slate-600 leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-slate-200/80 ${className}`}
    />
  )
}

export function MetricCardSkeleton(): React.ReactElement {
  return (
    <div className="exec-surface p-5" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-28" />
      <Skeleton className="mt-2.5 h-3 w-36" />
    </div>
  )
}
