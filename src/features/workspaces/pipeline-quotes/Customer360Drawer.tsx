import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileSpreadsheet,
  Plus,
  Search,
  Upload,
  UserCheck,
  UserRound,
} from 'lucide-react'
import {
  customerDisplayName,
  formatCents,
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import {
  createCustomerRecord,
  fetchCustomer360,
  fetchWorkspacePage,
  searchCustomers,
} from '../../../lib/queries'
import type { Customer, Customer360Snapshot } from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import {
  Badge,
  EmptyState,
  PaginationBar,
  Skeleton,
} from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'
import { CustomerBulkImportModal } from './CustomerBulkImportModal'

const PAGE_SIZE = 25

export interface Customer360DrawerProps {
  workspaceId: string
  selectedCustomerId: string | null
  onSelectCustomer: (customerId: string | null) => void
  timezone?: string | null
  onCustomersChanged: () => Promise<void> | void
}

export function Customer360Drawer({
  workspaceId,
  selectedCustomerId,
  onSelectCustomer,
  timezone,
  onCustomersChanged,
}: Customer360DrawerProps): React.ReactElement {
  const toast = useToast()

  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)
  const [directoryRows, setDirectoryRows] = useState<Customer[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [directoryError, setDirectoryError] = useState<string | null>(null)

  // New Customer Modal
  const [createOpen, setCreateOpen] = useState(false)
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [creating, setCreating] = useState(false)

  // Bulk Import Modal
  const [importOpen, setImportOpen] = useState(false)

  // Customer 360 Drawer Snapshot & Profile Edit Form
  const [snapshot, setSnapshot] = useState<Customer360Snapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const dirSeqRef = useRef(0)
  const drawerSeqRef = useRef(0)
  const profileSaveKeyRef = useRef<string>(createIdempotencyKey())

  const loadDirectory = useCallback(async () => {
    const seq = ++dirSeqRef.current
    setDirectoryLoading(true)
    setDirectoryError(null)

    try {
      const trimmed = searchQuery.trim()
      const rows = trimmed
        ? await searchCustomers(workspaceId, trimmed, 50)
        : await fetchWorkspacePage<Customer>({
            table: 'customers',
            workspaceId,
            page,
            pageSize: PAGE_SIZE,
            orderBy: 'created_at',
            ascending: false,
          })

      if (dirSeqRef.current !== seq) return
      setDirectoryRows(rows)
    } catch (err) {
      if (dirSeqRef.current !== seq) return
      setDirectoryError(
        err instanceof Error ? err.message : 'Unable to load customer directory.',
      )
    } finally {
      if (dirSeqRef.current === seq) {
        setDirectoryLoading(false)
      }
    }
  }, [workspaceId, searchQuery, page])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadDirectory()
    }, searchQuery.trim() ? 220 : 0)
    return () => clearTimeout(timer)
  }, [loadDirectory, searchQuery])

  // Hydrate Customer 360 whenever selectedCustomerId changes
  useEffect(() => {
    if (!selectedCustomerId) {
      setSnapshot(null)
      setSnapshotError(null)
      return undefined
    }

    const seq = ++drawerSeqRef.current
    setSnapshotLoading(true)
    setSnapshotError(null)
    profileSaveKeyRef.current = createIdempotencyKey()

    void fetchCustomer360(workspaceId, selectedCustomerId)
      .then(data => {
        if (drawerSeqRef.current !== seq) return
        setSnapshot(data)
        setEditFirst(data.customer.first_name)
        setEditLast(data.customer.last_name ?? '')
        setEditEmail(data.customer.email ?? '')
        setEditPhone(data.customer.phone ?? '')
        setEditNotes(data.customer.notes ?? '')
      })
      .catch(err => {
        if (drawerSeqRef.current !== seq) return
        setSnapshotError(
          err instanceof Error ? err.message : 'Unable to load Customer 360 profile.',
        )
      })
      .finally(() => {
        if (drawerSeqRef.current === seq) {
          setSnapshotLoading(false)
        }
      })

    return () => {
      drawerSeqRef.current += 1
    }
  }, [workspaceId, selectedCustomerId])

  const handleCreateCustomer = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newFirst.trim()) return
    setCreating(true)
    try {
      const created = await createCustomerRecord({
        workspaceId,
        firstName: newFirst,
        lastName: newLast,
        email: newEmail,
        phone: newPhone,
        notes: newNotes,
      })
      setCreateOpen(false)
      setNewFirst('')
      setNewLast('')
      setNewEmail('')
      setNewPhone('')
      setNewNotes('')
      toast.success('Customer added', customerDisplayName(created))
      await loadDirectory()
      await onCustomersChanged()
      onSelectCustomer(created.id)
    } catch (err) {
      toast.error(
        'Could not create customer',
        err instanceof Error ? err.message : 'Verify fields and retry.',
      )
    } finally {
      setCreating(false)
    }
  }

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!snapshot) return
    setSavingProfile(true)
    try {
      await opsCommand(
        workspaceId,
        'customer_update',
        {
          id: snapshot.customer.id,
          first_name: editFirst.trim(),
          last_name: editLast.trim() || null,
          email: editEmail.trim().toLowerCase() || null,
          phone: editPhone.trim() || null,
          notes: editNotes.trim() || null,
        },
        profileSaveKeyRef.current,
      )
      profileSaveKeyRef.current = createIdempotencyKey()
      toast.success('Customer profile updated', 'Saved via ops_command (customer_update).')
      const refreshed = await fetchCustomer360(workspaceId, snapshot.customer.id)
      setSnapshot(refreshed)
      await loadDirectory()
      await onCustomersChanged()
    } catch (err) {
      toast.error(
        'Profile update failed',
        err instanceof Error ? err.message : 'Owner or admin role required for customer_update.',
      )
    } finally {
      setSavingProfile(false)
    }
  }

  const isSearching = searchQuery.trim().length > 0

  return (
    <div className="space-y-4">
      <section aria-label="Customer directory" className="exec-surface overflow-hidden">
        {/* Directory Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="relative flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value)
                setPage(0)
              }}
              placeholder="Search name, email, or phone on server…"
              aria-label="Search customers on server"
              className="exec-input pl-10"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Bulk CSV Import
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New Customer
            </button>
          </div>
        </div>

        {directoryError ? (
          <div
            role="alert"
            className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
          >
            {directoryError}
          </div>
        ) : directoryLoading ? (
          <div className="p-5 space-y-2.5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : directoryRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<UserRound className="h-5 w-5" />}
              title={isSearching ? 'No matching customers found' : 'No customers in workspace yet'}
              description="Add a customer directly or upload a CSV export from your previous CRM or accounting software."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="exec-btn-primary !text-xs touch-target"
                  >
                    Add Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportOpen(true)}
                    className="exec-btn-secondary !text-xs touch-target"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                    Import CSV
                  </button>
                </div>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {directoryRows.map(cust => (
              <li key={cust.id}>
                <button
                  type="button"
                  onClick={() => onSelectCustomer(cust.id)}
                  className="touch-target flex w-full flex-col gap-2 px-4 py-3.5 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {customerDisplayName(cust)}
                    </p>
                    <p className="truncate text-xs text-slate-600">
                      {[cust.email, cust.phone].filter(Boolean).join(' · ') ||
                        'No email/phone recorded'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500 tabular-nums">
                      Added {formatDate(cust.created_at, timezone)}
                    </span>
                    <Badge tone="brand">Open 360 →</Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!isSearching ? (
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            currentCount={directoryRows.length}
            hasMore={directoryRows.length === PAGE_SIZE}
            onPageChange={setPage}
            label="Customers"
          />
        ) : null}
      </section>

      {/* Slide-Over Customer 360 Drawer */}
      <Dialog
        open={selectedCustomerId !== null}
        onClose={() => onSelectCustomer(null)}
        variant="drawer"
        title={snapshot ? customerDisplayName(snapshot.customer) : 'Customer 360 Profile'}
        description="Unified jobs, quotes, invoices, opportunities, verified payments, and channel consent log."
      >
        {snapshotLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : snapshotError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
          >
            {snapshotError}
          </div>
        ) : snapshot ? (
          <div className="space-y-6">
            {/* Profile Edit Form (`opsCommand(..., 'customer_update', ...)`) */}
            <form
              onSubmit={handleSaveProfile}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Contact Profile
                </span>
                <UserCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="c360-first" className="exec-label">
                    First Name
                  </label>
                  <input
                    id="c360-first"
                    type="text"
                    required
                    value={editFirst}
                    onChange={e => setEditFirst(e.target.value)}
                    className="exec-input !text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="c360-last" className="exec-label">
                    Last Name
                  </label>
                  <input
                    id="c360-last"
                    type="text"
                    value={editLast}
                    onChange={e => setEditLast(e.target.value)}
                    className="exec-input !text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="c360-email" className="exec-label">
                    Email
                  </label>
                  <input
                    id="c360-email"
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="exec-input !text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="c360-phone" className="exec-label">
                    Phone
                  </label>
                  <input
                    id="c360-phone"
                    type="tel"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="exec-input !text-xs"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="c360-notes" className="exec-label">
                  Equipment & Site Notes
                </label>
                <textarea
                  id="c360-notes"
                  rows={2}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  className="exec-input !text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={savingProfile}
                className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
              >
                {savingProfile ? 'Saving Profile…' : 'Save Profile Changes'}
              </button>
            </form>

            {/* Jobs */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Work Orders & Jobs ({snapshot.jobs.length})
              </h4>
              {snapshot.jobs.length === 0 ? (
                <p className="text-xs text-slate-500">No jobs recorded for this customer.</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                  {snapshot.jobs.map(job => (
                    <li key={job.id} className="flex items-center justify-between gap-2 p-3">
                      <div>
                        <p className="font-semibold text-slate-900">{job.title}</p>
                        <p className="text-slate-500 tabular-nums">
                          Rev {job.revision} · Labor {formatCurrency(job.labor_total)}
                        </p>
                      </div>
                      <Badge tone={job.status === 'completed' ? 'emerald' : 'sky'}>
                        {job.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Quotes & Invoices */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Quotes, Invoices & Receipts ({snapshot.documents.length})
              </h4>
              {snapshot.documents.length === 0 ? (
                <p className="text-xs text-slate-500">No documents recorded.</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                  {snapshot.documents.map(doc => (
                    <li key={doc.id} className="flex items-center justify-between gap-2 p-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {doc.document_number ?? doc.document_type.toUpperCase()} (
                          {doc.document_type})
                        </p>
                        <p className="text-slate-500 tabular-nums">
                          {formatDate(doc.created_at, timezone)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 tabular-nums">
                          {formatCurrency(doc.total)}
                        </span>
                        <Badge
                          tone={
                            doc.status === 'paid'
                              ? 'emerald'
                              : doc.status === 'overdue'
                                ? 'rose'
                                : 'amber'
                          }
                        >
                          {doc.status}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Opportunities & Verified Settlements */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Opportunities & Verified Payments ({snapshot.opportunities.length})
              </h4>
              {snapshot.verifiedPayments.map(vp => (
                <div
                  key={vp.id}
                  className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-emerald-950">
                    Webhook Verified ({vp.payment_provider})
                  </span>
                  <span className="font-bold text-emerald-800 tabular-nums">
                    {formatCents(vp.amount_cents, vp.currency)}
                  </span>
                </div>
              ))}
              {snapshot.opportunities.length > 0 ? (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                  {snapshot.opportunities.map(opp => (
                    <li key={opp.id} className="flex items-center justify-between gap-2 p-3">
                      <span className="font-semibold text-slate-900">{opp.title}</span>
                      <span className="font-bold tabular-nums">{formatCurrency(opp.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* Consent Log */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Channel Consent Audit Log ({snapshot.consentEvents.length})
              </h4>
              {snapshot.consentEvents.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No SMS/email/call consent events recorded yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-xs">
                  {snapshot.consentEvents.map(ev => (
                    <li key={ev.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold uppercase text-slate-800">{ev.channel}</span>
                        <Badge tone={ev.decision === 'granted' ? 'emerald' : 'rose'}>
                          {ev.decision}
                        </Badge>
                      </div>
                      <p className="text-slate-600 font-mono text-[11px]">
                        Ref: {ev.evidence_reference}
                      </p>
                      <p className="text-slate-400 text-[11px] tabular-nums">
                        {formatDateTime(ev.created_at, timezone)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Create Single Customer Modal */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Customer"
        description="Creates a workspace-isolated customer record."
      >
        <form onSubmit={handleCreateCustomer} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="new-cust-first" className="exec-label">
                First Name
              </label>
              <input
                id="new-cust-first"
                type="text"
                required
                value={newFirst}
                onChange={e => setNewFirst(e.target.value)}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="new-cust-last" className="exec-label">
                Last Name
              </label>
              <input
                id="new-cust-last"
                type="text"
                value={newLast}
                onChange={e => setNewLast(e.target.value)}
                className="exec-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="new-cust-email" className="exec-label">
                Email
              </label>
              <input
                id="new-cust-email"
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="exec-input"
              />
            </div>
            <div>
              <label htmlFor="new-cust-phone" className="exec-label">
                Phone
              </label>
              <input
                id="new-cust-phone"
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                className="exec-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="new-cust-notes" className="exec-label">
              Site / Equipment Notes
            </label>
            <textarea
              id="new-cust-notes"
              rows={2}
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              className="exec-input"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="exec-btn-primary touch-target"
            >
              {creating ? 'Creating…' : 'Create Customer'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Bulk CSV Import Modal */}
      <CustomerBulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        workspaceId={workspaceId}
        onImported={async () => {
          await loadDirectory()
          await onCustomersChanged()
        }}
      />
    </div>
  )
}
