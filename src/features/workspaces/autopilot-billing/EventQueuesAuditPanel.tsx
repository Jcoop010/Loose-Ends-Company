import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertOctagon, CheckCircle2, RotateCcw, ScrollText } from 'lucide-react'
import { formatDateTime } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import { fetchWorkspacePage } from '../../../lib/queries'
import type {
  AuditEvent,
  OpsAuditEntry,
  OpsBusinessEvent,
  OpsQueueItem,
} from '../../../types/domain'
import {
  Badge,
  EmptyState,
  PaginationBar,
  Skeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

const AUDIT_PAGE_SIZE = 20

export interface EventQueuesAuditPanelProps {
  workspaceId: string
  isAdminOrOwner: boolean
  queueItems: OpsQueueItem[]
  businessEvents: OpsBusinessEvent[]
  timezone?: string | null
  onRetried: () => Promise<void> | void
}

export function EventQueuesAuditPanel({
  workspaceId,
  isAdminOrOwner,
  queueItems,
  businessEvents,
  timezone,
  onRetried,
}: EventQueuesAuditPanelProps): React.ReactElement {
  const toast = useToast()

  const [auditSource, setAuditSource] = useState<'ops_audit' | 'audit_events'>('ops_audit')
  const [auditPage, setAuditPage] = useState(0)
  const [opsAuditRows, setOpsAuditRows] = useState<OpsAuditEntry[]>([])
  const [auditEventRows, setAuditEventRows] = useState<AuditEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const auditSeqRef = useRef(0)

  const loadAuditPage = useCallback(async () => {
    const seq = ++auditSeqRef.current
    setAuditLoading(true)
    try {
      if (auditSource === 'ops_audit') {
        const rows = await fetchWorkspacePage<OpsAuditEntry>({
          table: 'ops_audit',
          workspaceId,
          page: auditPage,
          pageSize: AUDIT_PAGE_SIZE,
          orderBy: 'id',
          ascending: false,
        })
        if (auditSeqRef.current !== seq) return
        setOpsAuditRows(rows)
      } else {
        const rows = await fetchWorkspacePage<AuditEvent>({
          table: 'audit_events',
          workspaceId,
          page: auditPage,
          pageSize: AUDIT_PAGE_SIZE,
          orderBy: 'created_at',
          ascending: false,
        })
        if (auditSeqRef.current !== seq) return
        setAuditEventRows(rows)
      }
    } catch (err) {
      if (auditSeqRef.current !== seq) return
      toast.error('Audit log error', err instanceof Error ? err.message : 'Unable to load audit log.')
    } finally {
      if (auditSeqRef.current === seq) {
        setAuditLoading(false)
      }
    }
  }, [auditSource, workspaceId, auditPage, toast])

  useEffect(() => {
    void loadAuditPage()
  }, [loadAuditPage])

  const handleRetryQueueItem = async (itemId: string) => {
    if (!isAdminOrOwner || retryingId) return
    setRetryingId(itemId)
    try {
      await opsCommand(
        workspaceId,
        'queue_retry',
        { id: itemId },
        createIdempotencyKey(),
      )
      toast.success('Dead-letter queue item reset to pending')
      await onRetried()
      await loadAuditPage()
    } catch (err) {
      toast.error('Queue retry failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setRetryingId(null)
    }
  }

  const handleRetryBusinessEvent = async (eventId: string) => {
    if (!isAdminOrOwner || retryingId) return
    setRetryingId(eventId)
    try {
      await opsCommand(
        workspaceId,
        'business_retry',
        { id: eventId },
        createIdempotencyKey(),
      )
      toast.success('Dead-letter business event reset to pending')
      await onRetried()
      await loadAuditPage()
    } catch (err) {
      toast.error('Event retry failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setRetryingId(null)
    }
  }

  const sortedQueue = [...queueItems].sort((a, b) =>
    a.status === 'dead_letter' && b.status !== 'dead_letter' ? -1 : 0,
  )
  const sortedEvents = [...businessEvents].sort((a, b) =>
    a.status === 'dead_letter' && b.status !== 'dead_letter' ? -1 : 0,
  )

  const currentAuditCount =
    auditSource === 'ops_audit' ? opsAuditRows.length : auditEventRows.length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1. Inventory Automation Queue (`ops_queue`) */}
        <section aria-label="Inventory automation queue" className="exec-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Stock Automation Queue</h2>
              <p className="text-xs text-slate-600">
                <code>ops_queue</code> low-stock PO drafting items
              </p>
            </div>
            <Badge tone="neutral">{queueItems.length}</Badge>
          </div>

          {sortedQueue.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              title="Queue clear"
              description="No pending or failed stock automation items."
            />
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
              {sortedQueue.slice(0, 15).map(item => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          item.status === 'dead_letter'
                            ? 'rose'
                            : item.status === 'completed'
                              ? 'emerald'
                              : 'amber'
                        }
                      >
                        {item.status}
                      </Badge>
                      <span className="truncate font-mono font-semibold text-slate-900">
                        {item.event_key}
                      </span>
                    </div>
                    {item.error ? (
                      <p className="mt-1 text-rose-700 font-medium">{item.error}</p>
                    ) : (
                      <p className="mt-1 text-slate-500 tabular-nums">
                        Attempts: {item.attempts} · {formatDateTime(item.created_at, timezone)}
                      </p>
                    )}
                  </div>

                  {isAdminOrOwner && item.status === 'dead_letter' ? (
                    <button
                      type="button"
                      disabled={retryingId === item.id}
                      onClick={() => void handleRetryQueueItem(item.id)}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs shrink-0 touch-target"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Retry
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 2. Business Coordination Events (`ops_business_events`) */}
        <section aria-label="Business coordination events" className="exec-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Business Coordination Events</h2>
              <p className="text-xs text-slate-600">
                <code>ops_business_events</code> durable internal handoffs
              </p>
            </div>
            <Badge tone="neutral">{businessEvents.length}</Badge>
          </div>

          {sortedEvents.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              title="No queued business events"
              description="Observed job, quote, invoice, and booking coordination events appear here."
            />
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
              {sortedEvents.slice(0, 15).map(ev => (
                <li
                  key={ev.id}
                  className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          ev.status === 'dead_letter'
                            ? 'rose'
                            : ev.status === 'completed'
                              ? 'emerald'
                              : 'sky'
                        }
                      >
                        {ev.status === 'dead_letter' ? (
                          <AlertOctagon className="h-3 w-3" aria-hidden="true" />
                        ) : null}
                        {ev.status}
                      </Badge>
                      <span className="font-semibold text-slate-900">{ev.event_type}</span>
                    </div>
                    {ev.error ? (
                      <p className="mt-1 text-rose-700 font-medium">{ev.error}</p>
                    ) : (
                      <p className="mt-1 text-slate-500 tabular-nums">
                        {ev.entity_type} · {formatDateTime(ev.created_at, timezone)}
                      </p>
                    )}
                  </div>

                  {isAdminOrOwner && ev.status === 'dead_letter' ? (
                    <button
                      type="button"
                      disabled={retryingId === ev.id}
                      onClick={() => void handleRetryBusinessEvent(ev.id)}
                      className="exec-btn-secondary !px-3 !py-1.5 !text-xs shrink-0 touch-target"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Retry Event
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 3. Paginated Immutable Audit Ledger (`ops_audit` + `audit_events`) */}
      <section aria-label="Immutable workspace audit logs" className="exec-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Immutable Audit Logs</h2>
              <p className="text-xs text-slate-600">
                Inspect command receipts (<code>ops_audit</code>) and compliance approvals (
                <code>audit_events</code>).
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => {
                setAuditSource('ops_audit')
                setAuditPage(0)
              }}
              className={`touch-target rounded-lg px-3 py-1.5 text-xs font-semibold ${
                auditSource === 'ops_audit'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              ops_audit
            </button>
            <button
              type="button"
              onClick={() => {
                setAuditSource('audit_events')
                setAuditPage(0)
              }}
              className={`touch-target rounded-lg px-3 py-1.5 text-xs font-semibold ${
                auditSource === 'audit_events'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              audit_events
            </button>
          </div>
        </div>

        {auditLoading ? (
          <div className="p-5 space-y-2.5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : currentAuditCount === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ScrollText className="h-5 w-5" />}
              title="No audit records on this page"
              description="Every ops_command receipt and draft approval is logged here permanently."
            />
          </div>
        ) : auditSource === 'ops_audit' ? (
          <ul className="divide-y divide-slate-200 text-xs">
            {opsAuditRows.map(row => (
              <li
                key={row.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <span className="font-mono font-bold text-slate-900">{row.action}</span>
                  <p className="truncate text-slate-600 font-mono text-[11px]">
                    {JSON.stringify(row.details)}
                  </p>
                </div>
                <span className="text-slate-500 shrink-0 tabular-nums">
                  {formatDateTime(row.created_at, timezone)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-200 text-xs">
            {auditEventRows.map(ev => (
              <li
                key={ev.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <span className="font-mono font-bold text-slate-900">
                    {ev.action} ({ev.entity_type})
                  </span>
                  <p className="truncate text-slate-600 font-mono text-[11px]">
                    {JSON.stringify(ev.metadata)}
                  </p>
                </div>
                <span className="text-slate-500 shrink-0 tabular-nums">
                  {formatDateTime(ev.created_at, timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <PaginationBar
          page={auditPage}
          pageSize={AUDIT_PAGE_SIZE}
          currentCount={currentAuditCount}
          hasMore={currentAuditCount === AUDIT_PAGE_SIZE}
          onPageChange={setAuditPage}
          label="Audit entries"
        />
      </section>
    </div>
  )
}
