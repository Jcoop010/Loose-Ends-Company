import React, { useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { parseCustomerCsv, sha256Hex } from '../../../lib/csv'
import {
  CUSTOMER_IMPORT_BATCH_SIZE,
  CUSTOMER_IMPORT_MAX_ROWS,
  runCustomerBulkImport,
  type CustomerImportJobSummary,
  type CustomerImportRowInput,
} from '../../../lib/edgeFunctions'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface CustomerBulkImportModalProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  onImported: () => Promise<void> | void
}

const SAMPLE_CSV = `first_name,last_name,email,phone
Hannah,Mercer,hannah@mercerdental.example,(555) 390-1120
Grant,Calloway,gcalloway@oakstreetbakery.example,(555) 390-4418`

export function CustomerBulkImportModal({
  open,
  onClose,
  workspaceId,
  onImported,
}: CustomerBulkImportModalProps): React.ReactElement {
  const toast = useToast()
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<CustomerImportRowInput[]>([])
  const [fingerprint, setFingerprint] = useState<string>('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{
    processed: number
    total: number
    jobId: string
  } | null>(null)
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const [completedSummary, setCompletedSummary] = useState<CustomerImportJobSummary | null>(null)

  const analyzeCsv = async (raw: string) => {
    setCsvText(raw)
    setParseError(null)
    setCompletedSummary(null)

    if (!raw.trim()) {
      setParsedRows([])
      setFingerprint('')
      return
    }

    try {
      const rows = parseCustomerCsv(raw)
      if (rows.length === 0) {
        setParsedRows([])
        setFingerprint('')
        setParseError('No customer rows detected. Include header columns such as first_name, last_name, email, phone.')
        return
      }
      if (rows.length > CUSTOMER_IMPORT_MAX_ROWS) {
        setParsedRows(rows)
        setFingerprint('')
        setParseError(
          `CSV contains ${rows.length.toLocaleString()} rows, exceeding the ${CUSTOMER_IMPORT_MAX_ROWS.toLocaleString()}-row per-job cap. Split into smaller files.`,
        )
        return
      }
      const hash = await sha256Hex(raw)
      setParsedRows(rows)
      setFingerprint(hash)
    } catch (err) {
      setParsedRows([])
      setFingerprint('')
      setParseError(err instanceof Error ? err.message : 'Unable to parse CSV file.')
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    await analyzeCsv(text)
  }

  const handleRunImport = async () => {
    if (!fingerprint || parsedRows.length === 0 || importing) return
    setParseError(null)
    setImporting(true)

    try {
      const summary = await runCustomerBulkImport({
        workspaceId,
        rows: parsedRows,
        fingerprint,
        resumeJobId: lastJobId,
        onProgress: (processed, total, jobId) => {
          setLastJobId(jobId)
          setProgress({ processed, total, jobId })
        },
      })

      setCompletedSummary(summary)
      setLastJobId(null)
      toast.success(
        'Customer bulk import complete',
        `${summary.created} created · ${summary.matched} matched`,
      )
      await onImported()
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Import interrupted. Click Resume Import to continue from the last verified batch.',
      )
    } finally {
      setImporting(false)
    }
  }

  const missingContactCount = parsedRows.filter(r => !r.email && !r.phone).length
  const totalBatches = Math.ceil(parsedRows.length / CUSTOMER_IMPORT_BATCH_SIZE)

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!importing) onClose()
      }}
      title="Bulk Customer CSV Import"
      description={`RFC-4180 parser with SHA-256 resumable checkpoints (${CUSTOMER_IMPORT_BATCH_SIZE}-row batches, up to ${CUSTOMER_IMPORT_MAX_ROWS.toLocaleString()} rows).`}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4">
        {parseError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
          >
            {parseError}
          </div>
        ) : null}

        {completedSummary ? (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Import Job Verified ({completedSummary.status})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums">
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200">
                <span className="block text-slate-500">Processed</span>
                <strong className="text-sm text-slate-900">{completedSummary.processed}</strong>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200">
                <span className="block text-slate-500">Created</span>
                <strong className="text-sm text-emerald-700">{completedSummary.created}</strong>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200">
                <span className="block text-slate-500">Matched</span>
                <strong className="text-sm text-[#c2410c]">{completedSummary.matched}</strong>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200">
                <span className="block text-slate-500">Rejected</span>
                <strong className="text-sm text-amber-800">{completedSummary.rejected}</strong>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="exec-btn-secondary !text-xs cursor-pointer touch-target">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Choose CSV File
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => void handleFileChange(e)}
              className="sr-only"
              disabled={importing}
            />
          </label>

          <button
            type="button"
            disabled={importing}
            onClick={() => void analyzeCsv(SAMPLE_CSV)}
            className="text-xs font-semibold text-[#c2410c] underline hover:text-[#9a3412]"
          >
            Load 2-row sample template
          </button>
        </div>

        <div>
          <label htmlFor="customer-csv-textarea" className="exec-label">
            CSV Contents (first_name, last_name, email, phone)
          </label>
          <textarea
            id="customer-csv-textarea"
            rows={5}
            disabled={importing}
            value={csvText}
            onChange={e => void analyzeCsv(e.target.value)}
            placeholder={SAMPLE_CSV}
            className="exec-input font-mono text-xs"
          />
        </div>

        {parsedRows.length > 0 && fingerprint ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 tabular-nums">
                Validated {parsedRows.length.toLocaleString()} row(s) across {totalBatches} batch(es)
              </span>
              <Badge tone="brand">SHA-256 {fingerprint.slice(0, 12)}…</Badge>
            </div>
            {missingContactCount > 0 ? (
              <p className="text-amber-800">
                Note: {missingContactCount} row(s) have neither email nor phone and may be skipped
                during matching.
              </p>
            ) : null}
          </div>
        ) : null}

        {progress ? (
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between tabular-nums">
              <span className="font-semibold text-slate-700">
                Uploading batches (Job {progress.jobId.slice(0, 8)}…)
              </span>
              <span className="font-bold text-slate-900">
                {progress.processed} / {progress.total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{
                  width: `${Math.min(100, Math.round((progress.processed / Math.max(1, progress.total)) * 100))}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="exec-btn-secondary touch-target"
          >
            Close
          </button>
          <button
            type="button"
            disabled={importing || !fingerprint || parsedRows.length === 0}
            onClick={() => void handleRunImport()}
            className="exec-btn-primary touch-target"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {importing
              ? 'Importing Batches…'
              : lastJobId
                ? 'Resume Interrupted Import'
                : `Import ${parsedRows.length.toLocaleString()} Customer(s)`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
