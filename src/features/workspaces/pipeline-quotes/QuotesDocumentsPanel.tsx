import React, { useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  FilePlus2,
  FileText,
  History,
  Printer,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import {
  customerDisplayName,
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import { createDocumentRecord, updateDocumentStatus } from '../../../lib/queries'
import type {
  Customer,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  InventoryItem,
  OpsJob,
  OpsQuoteApproval,
  OpsQuoteRevision,
} from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface QuotesDocumentsPanelProps {
  workspaceId: string
  workspaceName: string
  documents: DocumentRecord[]
  jobs: OpsJob[]
  quoteRevisions: OpsQuoteRevision[]
  quoteApprovals: OpsQuoteApproval[]
  inventoryById: ReadonlyMap<string, InventoryItem>
  customers: Customer[]
  customersById: ReadonlyMap<string, Customer>
  timezone?: string | null
  onChanged: () => Promise<void> | void
}

type DocFilter = 'all' | 'quotes' | 'invoices' | 'receipts'

export function QuotesDocumentsPanel({
  workspaceId,
  workspaceName,
  documents,
  jobs,
  quoteRevisions,
  quoteApprovals,
  inventoryById,
  customers,
  customersById,
  timezone,
  onChanged,
}: QuotesDocumentsPanelProps): React.ReactElement {
  const toast = useToast()
  const [docFilter, setDocFilter] = useState<DocFilter>('all')

  // Create standalone document modal
  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [docType, setDocType] = useState<DocumentType>('quote')
  const [docNumber, setDocNumber] = useState('')
  const [docCustomerId, setDocCustomerId] = useState('')
  const [docTotal, setDocTotal] = useState('')
  const [docDueAt, setDocDueAt] = useState('')
  const [docStatus, setDocStatus] = useState<DocumentStatus>('sent')
  const [savingDoc, setSavingDoc] = useState(false)

  // Revise Estimate modal (`opsCommand(..., 'estimate_revise', ...)`)
  const [reviseJob, setReviseJob] = useState<OpsJob | null>(null)
  const [reviseTitle, setReviseTitle] = useState('')
  const [reviseLabor, setReviseLabor] = useState('')
  const [reviseReason, setReviseReason] = useState('')
  const [revising, setRevising] = useState(false)
  const reviseKeyRef = useRef<string>(createIdempotencyKey())

  // Record Approval modal (`opsCommand(..., 'job_transition', { status: 'approved', approval_evidence })`)
  const [approveJob, setApproveJob] = useState<OpsJob | null>(null)
  const [approvalEvidence, setApprovalEvidence] = useState('')
  const [approving, setApproving] = useState(false)
  const approveKeyRef = useRef<string>(createIdempotencyKey())

  // Printable Quote Snapshot modal
  const [printRevision, setPrintRevision] = useState<OpsQuoteRevision | null>(null)

  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [busyDocId, setBusyDocId] = useState<string | null>(null)

  const estimateJobs = useMemo(
    () => jobs.filter(j => j.status === 'draft' || j.status === 'quoted' || j.status === 'approved'),
    [jobs],
  )

  const filteredDocs = useMemo(() => {
    return documents.filter(doc => {
      if (docFilter === 'all') return true
      if (docFilter === 'quotes') {
        return doc.document_type === 'quote' || doc.document_type === 'estimate'
      }
      if (docFilter === 'invoices') return doc.document_type === 'invoice'
      return doc.document_type === 'receipt' || doc.document_type === 'payment'
    })
  }, [documents, docFilter])

  const handleIssueQuoteSnapshot = async (job: OpsJob) => {
    if (busyJobId) return
    setBusyJobId(job.id)
    try {
      const res = await opsCommand(
        workspaceId,
        'job_transition',
        { id: job.id, status: 'quoted' },
        createIdempotencyKey(),
      )
      toast.success(
        `Quote snapshot R${res.revision ?? job.revision + 1} generated`,
        'Immutable snapshot saved to ops_quote_revisions.',
      )
      await onChanged()
    } catch (err) {
      toast.error(
        'Could not issue quote snapshot',
        err instanceof Error ? err.message : 'Ensure job is in draft state.',
      )
    } finally {
      setBusyJobId(null)
    }
  }

  const handleSubmitRevise = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reviseJob) return
    const parsedLabor = Number(reviseLabor)
    if (reviseReason.trim().length < 5) {
      toast.error('Revision reason required', 'Enter at least 5 characters explaining the change.')
      return
    }
    if (!Number.isFinite(parsedLabor) || parsedLabor < 0) {
      toast.error('Invalid labor total', 'Enter a non-negative dollar amount.')
      return
    }

    setRevising(true)
    try {
      await opsCommand(
        workspaceId,
        'estimate_revise',
        {
          id: reviseJob.id,
          title: reviseTitle.trim() || reviseJob.title,
          labor_total: Math.round(parsedLabor * 100) / 100,
          reason: reviseReason.trim(),
        },
        reviseKeyRef.current,
      )
      setReviseJob(null)
      toast.success(
        'Estimate reopened as draft',
        'Adjust materials or click Issue Quote Snapshot to publish the next revision.',
      )
      await onChanged()
    } catch (err) {
      toast.error(
        'Estimate revision blocked',
        err instanceof Error ? err.message : 'Cancel any active booking before revising.',
      )
    } finally {
      setRevising(false)
    }
  }

  const handleSubmitApprove = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!approveJob) return
    if (approvalEvidence.trim().length < 5) {
      toast.error(
        'Approval evidence required',
        'Record signed PO, email timestamp, or authorization reference (5+ chars).',
      )
      return
    }
    setApproving(true)
    try {
      await opsCommand(
        workspaceId,
        'job_transition',
        {
          id: approveJob.id,
          status: 'approved',
          approval_evidence: approvalEvidence.trim(),
        },
        approveKeyRef.current,
      )
      setApproveJob(null)
      setApprovalEvidence('')
      toast.success(
        'Quote approved & archived',
        'Approval evidence retained in ops_quote_approvals.',
      )
      await onChanged()
    } catch (err) {
      toast.error(
        'Could not approve quote',
        err instanceof Error ? err.message : 'Quote must be in quoted status.',
      )
    } finally {
      setApproving(false)
    }
  }

  const handleCreateDocument = async (event: React.FormEvent) => {
    event.preventDefault()
    const totalNum = Number(docTotal)
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      toast.error('Invalid total', 'Enter a valid non-negative document amount.')
      return
    }
    setSavingDoc(true)
    try {
      const created = await createDocumentRecord({
        workspaceId,
        customerId: docCustomerId || null,
        documentType: docType,
        documentNumber: docNumber.trim() || `${docType.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-5)}`,
        status: docStatus,
        total: totalNum,
        dueAt: docDueAt ? new Date(`${docDueAt}T17:00:00`).toISOString() : null,
      })
      setCreateDocOpen(false)
      setDocNumber('')
      setDocTotal('')
      setDocDueAt('')
      toast.success(
        'Document created',
        `${created.document_number ?? created.document_type} · ${formatCurrency(created.total)}`,
      )
      await onChanged()
    } catch (err) {
      toast.error('Could not save document', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSavingDoc(false)
    }
  }

  const handleUpdateDocStatus = async (doc: DocumentRecord, status: DocumentStatus) => {
    if (busyDocId) return
    setBusyDocId(doc.id)
    try {
      await updateDocumentStatus({
        workspaceId,
        documentId: doc.id,
        status,
      })
      toast.success('Document status updated', `${doc.document_number ?? 'Document'} → ${status}`)
      await onChanged()
    } catch (err) {
      toast.error('Status update failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setBusyDocId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Estimate Revisions & Approval Evidence */}
      <section aria-label="Estimate revisions and quote approvals" className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Job Estimates, Revisions & Approval Evidence
            </h2>
            <p className="text-xs text-slate-600">
              Snapshots are stored immutably in <code>ops_quote_revisions</code> and approvals in{' '}
              <code>ops_quote_approvals</code>.
            </p>
          </div>
          <Badge tone="sky">{quoteRevisions.length} Snapshot(s)</Badge>
        </div>

        {estimateJobs.length === 0 ? (
          <p className="text-xs text-slate-500">
            Create a draft work order in Dispatch & Jobs to build a parts + labor quote with
            revision history.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {estimateJobs.map(job => {
              const cust = job.customer_id ? customersById.get(job.customer_id) : undefined
              const latestRev = quoteRevisions.find(r => r.job_id === job.id)
              const approvalsForJob = quoteApprovals.filter(a => a.job_id === job.id)

              return (
                <li key={job.id} className="p-4 space-y-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            job.status === 'approved'
                              ? 'emerald'
                              : job.status === 'quoted'
                                ? 'sky'
                                : 'neutral'
                          }
                        >
                          {job.status} · Rev {job.revision}
                        </Badge>
                        <span className="text-sm font-bold text-slate-900">{job.title}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                        {cust ? customerDisplayName(cust) : 'Unassigned'} · Labor{' '}
                        {formatCurrency(job.labor_total)}
                        {latestRev ? ` · Snapshot Total ${formatCurrency(latestRev.total)}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {job.status === 'draft' ? (
                        <button
                          type="button"
                          disabled={busyJobId === job.id}
                          onClick={() => void handleIssueQuoteSnapshot(job)}
                          className="exec-btn-primary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <History className="h-3.5 w-3.5" aria-hidden="true" />
                          Issue Quote Snapshot
                        </button>
                      ) : null}

                      {job.status === 'quoted' ? (
                        <button
                          type="button"
                          onClick={() => {
                            approveKeyRef.current = createIdempotencyKey()
                            setApproveJob(job)
                            setApprovalEvidence('')
                          }}
                          className="exec-btn-emerald !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Record Approval
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => {
                          reviseKeyRef.current = createIdempotencyKey()
                          setReviseJob(job)
                          setReviseTitle(job.title)
                          setReviseLabor(String(job.labor_total))
                          setReviseReason('')
                        }}
                        className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Revise Estimate
                      </button>

                      {latestRev ? (
                        <button
                          type="button"
                          onClick={() => setPrintRevision(latestRev)}
                          className="exec-btn-secondary !px-3 !py-1.5 !text-xs touch-target"
                        >
                          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                          Printable Quote
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {approvalsForJob.length > 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-950 space-y-1">
                      {approvalsForJob.map(ap => (
                        <div key={ap.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-semibold">
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                            Approved R{ap.revision}: {ap.evidence}
                          </span>
                          <span className="text-emerald-800 tabular-nums">
                            {formatDateTime(ap.approved_at, timezone)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 2. Documents Ledger (Quotes, Invoices, Receipts) */}
      <section aria-label="Quotes, invoices, and receipts ledger" className="exec-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Quotes, Invoices & Receipts Ledger
            </h2>
            <p className="text-xs text-slate-600">
              All commercial documents scoped to your workspace.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['all', 'All'],
                ['quotes', 'Quotes'],
                ['invoices', 'Invoices'],
                ['receipts', 'Receipts'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDocFilter(key)}
                className={`touch-target rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  docFilter === key
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setCreateDocOpen(true)}
              className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
            >
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
              New Document
            </button>
          </div>
        </div>

        {filteredDocs.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No documents in this view"
            description="Issue a quote snapshot from a job or create a standalone quote, invoice, or receipt."
          />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {filteredDocs.slice(0, 50).map(doc => {
              const cust = doc.customer_id ? customersById.get(doc.customer_id) : undefined
              return (
                <li
                  key={doc.id}
                  className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-700">
                        {doc.document_number ?? doc.id.slice(0, 8).toUpperCase()}
                      </span>
                      <Badge tone="neutral">{doc.document_type}</Badge>
                      <Badge
                        tone={
                          doc.status === 'paid'
                            ? 'emerald'
                            : doc.status === 'overdue'
                              ? 'rose'
                              : doc.status === 'sent'
                                ? 'amber'
                                : 'neutral'
                        }
                      >
                        {doc.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 tabular-nums">
                      {cust ? customerDisplayName(cust) : 'Unassigned Customer'} · Created{' '}
                      {formatDate(doc.created_at, timezone)}
                      {doc.due_at ? ` · Due ${formatDate(doc.due_at, timezone)}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="mr-1 text-sm font-extrabold text-slate-950 tabular-nums">
                      {formatCurrency(doc.total)}
                    </span>
                    <select
                      aria-label={`Change status for ${doc.document_number ?? 'document'}`}
                      disabled={busyDocId === doc.id}
                      value={doc.status}
                      onChange={e =>
                        void handleUpdateDocStatus(doc, e.target.value as DocumentStatus)
                      }
                      className="exec-input !w-auto !py-1.5 !text-xs"
                    >
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="overdue">Overdue</option>
                      <option value="paid">Paid (Owner-Reported)</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Revise Estimate Modal */}
      <Dialog
        open={reviseJob !== null}
        onClose={() => setReviseJob(null)}
        title="Revise Estimate"
        description="Runs ops_command('estimate_revise') to reopen the estimate in draft mode while preserving prior revision snapshots."
      >
        {reviseJob ? (
          <form onSubmit={handleSubmitRevise} className="space-y-4">
            <div>
              <label htmlFor="revise-title" className="exec-label">
                Estimate Title
              </label>
              <input
                id="revise-title"
                type="text"
                required
                value={reviseTitle}
                onChange={e => setReviseTitle(e.target.value)}
                className="exec-input"
              />
            </div>

            <div>
              <label htmlFor="revise-labor" className="exec-label">
                Updated Labor Total ($)
              </label>
              <input
                id="revise-labor"
                type="number"
                required
                min={0}
                step="0.01"
                value={reviseLabor}
                onChange={e => setReviseLabor(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="revise-reason" className="exec-label">
                Revision Reason (5+ characters)
              </label>
              <input
                id="revise-reason"
                type="text"
                required
                minLength={5}
                placeholder="e.g., Added crane lift and upgraded thermostat per customer request"
                value={reviseReason}
                onChange={e => setReviseReason(e.target.value)}
                className="exec-input"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReviseJob(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={revising}
                className="exec-btn-primary touch-target"
              >
                {revising ? 'Revising…' : 'Save Estimate Revision'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* Record Quote Approval Modal */}
      <Dialog
        open={approveJob !== null}
        onClose={() => setApproveJob(null)}
        title="Record Customer Quote Approval"
        description="Transitions the quote to approved and stores immutable approval evidence in ops_quote_approvals."
      >
        {approveJob ? (
          <form onSubmit={handleSubmitApprove} className="space-y-4">
            <p className="text-xs text-slate-600">
              Approving <strong>{approveJob.title}</strong> (Revision {approveJob.revision}).
            </p>
            <div>
              <label htmlFor="quote-approval-evidence" className="exec-label">
                Approval Evidence Reference (5+ characters)
              </label>
              <input
                id="quote-approval-evidence"
                type="text"
                required
                minLength={5}
                placeholder="e.g., Signed proposal PDF #QTE-2041 or email confirmation"
                value={approvalEvidence}
                onChange={e => setApprovalEvidence(e.target.value)}
                className="exec-input"
              />
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setApproveJob(null)}
                className="exec-btn-secondary touch-target"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={approving}
                className="exec-btn-emerald touch-target"
              >
                {approving ? 'Recording…' : 'Confirm Quote Approval'}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* Printable Quote Snapshot Modal */}
      <Dialog
        open={printRevision !== null}
        onClose={() => setPrintRevision(null)}
        title={
          printRevision
            ? `Quote Snapshot — Revision R${printRevision.revision}`
            : 'Printable Quote'
        }
        description="Immutable snapshot of labor and reserved materials at the time this revision was issued."
        maxWidthClass="max-w-2xl"
        footer={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPrintRevision(null)}
              className="exec-btn-secondary touch-target"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') window.print()
              }}
              className="exec-btn-primary touch-target"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print / Save PDF
            </button>
          </div>
        }
      >
        {printRevision ? (
          <div className="space-y-5 rounded-xl border border-slate-200 p-5 bg-white text-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-lg font-extrabold">{workspaceName}</p>
                <p className="text-xs text-slate-600">
                  {printRevision.snapshot.job.title ?? 'Service Estimate'}
                </p>
              </div>
              <div className="text-right text-xs tabular-nums">
                <p className="font-bold text-slate-900">Revision R{printRevision.revision}</p>
                <p className="text-slate-500">
                  Issued {formatDateTime(printRevision.created_at, timezone)}
                </p>
              </div>
            </div>

            {printRevision.snapshot.job.customer_id ? (
              <div className="text-xs">
                <span className="font-semibold uppercase tracking-wider text-slate-500">
                  Prepared For
                </span>
                <p className="mt-0.5 text-sm font-bold text-slate-900">
                  {customerDisplayName(
                    customersById.get(printRevision.snapshot.job.customer_id),
                  )}
                </p>
              </div>
            ) : null}

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Line Item</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                <tr>
                  <td className="py-2.5 font-medium text-slate-900">
                    Field Labor & Commissioning
                  </td>
                  <td className="py-2.5 text-right">1</td>
                  <td className="py-2.5 text-right">
                    {formatCurrency(printRevision.snapshot.job.labor_total ?? 0)}
                  </td>
                  <td className="py-2.5 text-right font-semibold">
                    {formatCurrency(printRevision.snapshot.job.labor_total ?? 0)}
                  </td>
                </tr>
                {(printRevision.snapshot.materials ?? []).map(mat => {
                  const inv = inventoryById.get(mat.item_id)
                  return (
                    <tr key={mat.item_id}>
                      <td className="py-2.5 font-medium text-slate-900">
                        {inv ? `${inv.name} (${inv.sku})` : `Material ${mat.item_id.slice(0, 8)}`}
                      </td>
                      <td className="py-2.5 text-right">{mat.quantity}</td>
                      <td className="py-2.5 text-right">{formatCurrency(mat.unit_price)}</td>
                      <td className="py-2.5 text-right font-semibold">
                        {formatCurrency(mat.quantity * mat.unit_price)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 text-sm font-extrabold tabular-nums">
                  <td colSpan={3} className="pt-3 text-right pr-4">
                    Quote Total
                  </td>
                  <td className="pt-3 text-right">{formatCurrency(printRevision.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </Dialog>

      {/* New Standalone Document Modal */}
      <Dialog
        open={createDocOpen}
        onClose={() => setCreateDocOpen(false)}
        title="Create Document"
        description="Record a quote, invoice, or receipt in the workspace documents ledger."
      >
        <form onSubmit={handleCreateDocument} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-type" className="exec-label">
                Document Type
              </label>
              <select
                id="doc-type"
                value={docType}
                onChange={e => setDocType(e.target.value as DocumentType)}
                className="exec-input"
              >
                <option value="quote">Quote</option>
                <option value="estimate">Estimate</option>
                <option value="invoice">Invoice</option>
                <option value="receipt">Receipt</option>
              </select>
            </div>
            <div>
              <label htmlFor="doc-number" className="exec-label">
                Document Number
              </label>
              <input
                id="doc-number"
                type="text"
                placeholder="e.g., INV-2050"
                value={docNumber}
                onChange={e => setDocNumber(e.target.value)}
                className="exec-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="doc-customer" className="exec-label">
              Customer (Optional)
            </label>
            <select
              id="doc-customer"
              value={docCustomerId}
              onChange={e => setDocCustomerId(e.target.value)}
              className="exec-input"
            >
              <option value="">Unassigned</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {customerDisplayName(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="doc-total" className="exec-label">
                Total ($)
              </label>
              <input
                id="doc-total"
                type="number"
                required
                min={0}
                step="0.01"
                value={docTotal}
                onChange={e => setDocTotal(e.target.value)}
                className="exec-input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="doc-status" className="exec-label">
                Initial Status
              </label>
              <select
                id="doc-status"
                value={docStatus}
                onChange={e => setDocStatus(e.target.value as DocumentStatus)}
                className="exec-input"
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="overdue">Overdue</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            <div>
              <label htmlFor="doc-due" className="exec-label">
                Due Date
              </label>
              <input
                id="doc-due"
                type="date"
                value={docDueAt}
                onChange={e => setDocDueAt(e.target.value)}
                className="exec-input"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setCreateDocOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDoc}
              className="exec-btn-primary touch-target"
            >
              {savingDoc ? 'Saving…' : 'Create Document'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
