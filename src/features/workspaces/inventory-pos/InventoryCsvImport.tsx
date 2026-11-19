import React, { useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import {
  parseInventoryCsv,
  sha256Hex,
  type ParsedInventoryCsvRow,
} from '../../../lib/csv'
import { formatCurrency } from '../../../lib/format'
import { opsCommand } from '../../../lib/opsCommand'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface InventoryCsvImportProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  onImported: () => Promise<void> | void
}

const SAMPLE_SKU_CSV = `sku,name,category,supplier,location,purchase_cost,selling_price,quantity,reorder_threshold,reorder_quantity
REF-410A-25,R-410A Refrigerant Cylinder 25lb,Refrigerants,United Refrigeration,Cage A-1,168,295,6,4,8
CAP-45-5-440,Dual Run Capacitor 45/5 MFD 440V,Electrical,Johnstone Supply,Truck Bin B-4,19,68,12,6,15`

export function InventoryCsvImport({
  open,
  onClose,
  workspaceId,
  onImported,
}: InventoryCsvImportProps): React.ReactElement {
  const toast = useToast()

  const [rawCsv, setRawCsv] = useState('')
  const [rows, setRows] = useState<ParsedInventoryCsvRow[]>([])
  const [fileHash, setFileHash] = useState('')
  const [postInitialStock, setPostInitialStock] = useState(true)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [processedCount, setProcessedCount] = useState(0)
  const [doneCount, setDoneCount] = useState<number | null>(null)

  const analyzeInput = async (input: string) => {
    setRawCsv(input)
    setParseError(null)
    setDoneCount(null)

    if (!input.trim()) {
      setRows([])
      setFileHash('')
      return
    }

    try {
      const parsed = parseInventoryCsv(input)
      if (parsed.length === 0) {
        setRows([])
        setFileHash('')
        setParseError('No valid SKU rows found. Include at minimum `sku` and `name` columns.')
        return
      }
      if (parsed.length > 1000) {
        setRows([])
        setFileHash('')
        setParseError('Import up to 1,000 SKUs per CSV batch.')
        return
      }
      const digest = await sha256Hex(input)
      setRows(parsed)
      setFileHash(digest)
    } catch (err) {
      setRows([])
      setFileHash('')
      setParseError(err instanceof Error ? err.message : 'Malformed CSV input.')
    }
  }

  const handleFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const content = await file.text()
    await analyzeInput(content)
  }

  const handleRunImport = async () => {
    if (!fileHash || rows.length === 0 || importing) return
    setParseError(null)
    setImporting(true)
    setProcessedCount(0)

    try {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]
        const deterministicSaveKey = 'inventory-csv:' + fileHash + ':' + rowIndex

        const saved = await opsCommand(
          workspaceId,
          'inventory_save',
          {
            name: row.name,
            sku: row.sku,
            barcode: row.barcode,
            category: row.category,
            description: row.description,
            supplier: row.supplier,
            location: row.location,
            purchase_cost: row.purchase_cost,
            selling_price: row.selling_price,
            reorder_threshold: row.reorder_threshold,
            reorder_quantity: Math.max(1, row.reorder_quantity || 1),
          },
          deterministicSaveKey,
        )

        if (postInitialStock && row.quantity > 0 && saved.id) {
          const deterministicStockKey = 'inventory-csv-stock:' + fileHash + ':' + rowIndex
          await opsCommand(
            workspaceId,
            'stock_move',
            {
              id: saved.id,
              kind: 'receipt',
              quantity: row.quantity,
              reason: `Initial CSV stock import (${fileHash.slice(0, 8)})`,
            },
            deterministicStockKey,
          )
        }

        setProcessedCount(rowIndex + 1)
      }

      setDoneCount(rows.length)
      toast.success(
        'Inventory CSV imported',
        `${rows.length} SKU(s) reconciled with deterministic idempotency keys.`,
      )
      await onImported()
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `${err.message} (Safe to retry: already-processed rows reuse their deterministic 'inventory-csv:' receipt key.)`
          : 'CSV import paused. Retry to resume safely from deterministic receipts.',
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!importing) onClose()
      }}
      title="Batch SKU Pricebook CSV Import"
      description="Uses SHA-256 file fingerprinting with deterministic 'inventory-csv:<hash>:<row>' idempotency keys so retries never duplicate SKUs or stock."
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

        {doneCount !== null ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-950"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Verified and imported {doneCount} SKU row(s).
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="exec-btn-secondary !text-xs cursor-pointer touch-target">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Select SKU CSV File
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={e => void handleFilePick(e)}
              className="sr-only"
            />
          </label>

          <button
            type="button"
            disabled={importing}
            onClick={() => void analyzeInput(SAMPLE_SKU_CSV)}
            className="text-xs font-semibold text-[#c2410c] underline hover:text-[#9a3412]"
          >
            Load sample HVAC parts CSV
          </button>
        </div>

        <div>
          <label htmlFor="sku-csv-input" className="exec-label">
            CSV Data
          </label>
          <textarea
            id="sku-csv-input"
            rows={5}
            disabled={importing}
            value={rawCsv}
            onChange={e => void analyzeInput(e.target.value)}
            placeholder={SAMPLE_SKU_CSV}
            className="exec-input font-mono text-xs"
          />
        </div>

        {rows.length > 0 && fileHash ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 tabular-nums">
                Ready: {rows.length} valid SKU row(s)
              </span>
              <Badge tone="brand">SHA-256 {fileHash.slice(0, 12)}…</Badge>
            </div>
            <p className="text-slate-600 tabular-nums">
              Preview first row: <strong>{rows[0].sku}</strong> — {rows[0].name} (Cost{' '}
              {formatCurrency(rows[0].purchase_cost)} / Sell {formatCurrency(rows[0].selling_price)}
              )
            </p>
            <label className="flex items-center gap-2 pt-1 font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={postInitialStock}
                disabled={importing}
                onChange={e => setPostInitialStock(e.target.checked)}
                className="h-4 w-4 accent-[#ea580c]"
              />
              Post initial stock receipt when CSV <code>quantity &gt; 0</code>
            </label>
          </div>
        ) : null}

        {importing ? (
          <div className="space-y-1.5 text-xs tabular-nums">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Reconciling SKUs…</span>
              <span className="font-bold text-slate-900">
                {processedCount} / {rows.length}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{
                  width: `${Math.min(100, Math.round((processedCount / Math.max(1, rows.length)) * 100))}%`,
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
            disabled={importing || !fileHash || rows.length === 0}
            onClick={() => void handleRunImport()}
            className="exec-btn-primary touch-target"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {importing ? 'Importing…' : `Import ${rows.length} SKU(s)`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
