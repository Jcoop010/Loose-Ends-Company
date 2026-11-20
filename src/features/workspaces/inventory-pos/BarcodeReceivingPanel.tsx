import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CameraOff, CheckCircle2, QrCode, ScanBarcode } from 'lucide-react'
import { formatCents } from '../../../lib/format'
import * as release2Queries from '../../../lib/autonomousOs/release2Queries'
import type {
  GoodsReceiptLineItem,
  GoodsReceiptRecord,
  PurchaseOrderItemRecord,
  PurchaseOrderRecord,
} from '../../../lib/autonomousOs'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

interface BrowserBarcodeDetector {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
}

interface WindowWithBarcodeDetector {
  BarcodeDetector?: new (opts?: { formats?: string[] }) => BrowserBarcodeDetector
}

interface EditableReceiveLine {
  sku: string
  description: string
  ordered_qty: number
  already_received_qty: number
  received_qty: number
  damaged_qty: number
}

export function BarcodeReceivingPanel({
  workspaceId,
  purchaseOrders,
  poItemsByPo,
  goodsReceipts,
  onReceiptLogged,
}: {
  workspaceId: string
  purchaseOrders: readonly PurchaseOrderRecord[]
  poItemsByPo: ReadonlyMap<string, PurchaseOrderItemRecord[]>
  goodsReceipts: readonly GoodsReceiptRecord[]
  onReceiptLogged: () => Promise<void> | void
}): React.ReactElement {
  const toast = useToast()

  const receivablePos = useMemo(
    () =>
      purchaseOrders.filter(
        po => po.status !== 'received' && po.status !== 'closed',
      ),
    [purchaseOrders],
  )

  const [selectedPoId, setSelectedPoId] = useState<string>('')
  const [scanInput, setScanInput] = useState('')
  const [receivedBy, setReceivedBy] = useState('Receiving Dock')
  const [lines, setLines] = useState<EditableReceiveLine[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraStatus, setCameraStatus] = useState<string | null>(null)
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (receivablePos.length === 0) {
      setSelectedPoId('')
      return
    }
    if (!selectedPoId || !receivablePos.some(p => p.id === selectedPoId)) {
      setSelectedPoId(receivablePos[0].id)
    }
  }, [receivablePos, selectedPoId])

  useEffect(() => {
    if (!selectedPoId) {
      setLines([])
      return
    }
    const items = poItemsByPo.get(selectedPoId) ?? []
    setLines(
      items.map(item => ({
        sku: item.sku,
        description: item.description,
        ordered_qty: item.ordered_qty,
        already_received_qty: item.received_qty,
        received_qty: Math.max(0, item.ordered_qty - item.received_qty),
        damaged_qty: 0,
      })),
    )
  }, [selectedPoId, poItemsByPo])

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  const applyScannedBarcode = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim().toUpperCase()
      if (!code) return
      setLastScannedCode(code)

      setLines(prev => {
        const matchIdx = prev.findIndex(line => line.sku.trim().toUpperCase() === code)
        if (matchIdx === -1) {
          toast.info('Scanned SKU not on open PO', `${code} is not listed on the selected PO.`)
          return prev
        }
        toast.success(`Scanned ${code}`, '+1 received unit recorded on receiving slip.')
        return prev.map((line, idx) =>
          idx === matchIdx ? { ...line, received_qty: line.received_qty + 1 } : line,
        )
      })
    },
    [toast],
  )

  const handleStartCamera = async () => {
    if (cameraActive) {
      stopCamera()
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('Camera API unavailable in this browser. Use USB/manual SKU scan input.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
      setCameraStatus('Camera active. Point at QR or UPC/Code-128 SKU label, or use manual box.')

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }

      const detectorCtor = (window as unknown as WindowWithBarcodeDetector).BarcodeDetector
      if (detectorCtor && videoRef.current) {
        const detector = new detectorCtor({
          formats: ['qr_code', 'code_128', 'ean_13', 'upc_a'],
        })
        let cooldownCode = ''
        let cooldownUntil = 0
        scanTimerRef.current = window.setInterval(() => {
          if (!videoRef.current) return
          void detector
            .detect(videoRef.current)
            .then(found => {
              const rawVal = found[0]?.rawValue?.trim()
              if (!rawVal) return
              const now = Date.now()
              if (rawVal === cooldownCode && now < cooldownUntil) return
              cooldownCode = rawVal
              cooldownUntil = now + 1800
              applyScannedBarcode(rawVal)
            })
            .catch(() => undefined)
        }, 650)
      } else {
        setCameraStatus(
          'Camera feed running (native BarcodeDetector unavailable in browser; enter/scan SKU below).',
        )
      }
    } catch (err) {
      setCameraStatus(
        err instanceof Error
          ? `Camera permission unavailable (${err.message}). Use USB/manual SKU input.`
          : 'Camera unavailable. Use USB/manual SKU input.',
      )
      stopCamera()
    }
  }

  const handleManualScanSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!scanInput.trim()) return
    applyScannedBarcode(scanInput)
    setScanInput('')
  }

  const handleCommitReceipt = async () => {
    if (!selectedPoId || lines.length === 0 || submitting) return
    const payloadLines: GoodsReceiptLineItem[] = lines.map(line => ({
      sku: line.sku,
      ordered_qty: line.ordered_qty,
      received_qty: Math.max(0, Math.trunc(line.received_qty)),
      damaged_qty: Math.max(0, Math.trunc(line.damaged_qty)),
    }))

    const totalReceiving = payloadLines.reduce((acc, item) => acc + item.received_qty, 0)
    if (totalReceiving <= 0) {
      toast.error('Nothing to receive', 'Enter or scan at least 1 received unit.')
      return
    }

    setSubmitting(true)
    try {
      const result = await release2Queries.recordGoodsReceiptInDb({
        workspaceId,
        poId: selectedPoId,
        receivedBy,
        items: payloadLines,
      })
      toast.success(
        `Goods Receipt logged (${result.po_status})`,
        `Updated stock on hand for ${result.updated_skus.join(', ') || 'PO SKUs'}.`,
      )
      await onReceiptLogged()
    } catch (err) {
      toast.error('Goods Receipt failed', err instanceof Error ? err.message : 'Retry.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="exec-surface p-5 sm:p-6 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-[#ea580c]" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-900">
                Mobile Barcode &amp; QR Goods Receipt (GRN)
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              Scan incoming dock barcodes or type an SKU to increment counts, flag damaged units, and update <code className="font-mono">on_hand_qty</code> cleanly.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleStartCamera()}
            className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target"
          >
            {cameraActive ? (
              <>
                <CameraOff className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                Stop Camera Scanner
              </>
            ) : (
              <>
                <Camera className="h-3.5 w-3.5 text-[#ea580c]" aria-hidden="true" />
                Start Camera Scanner
              </>
            )}
          </button>
        </div>

        {cameraActive ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2">
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full max-h-56 rounded-lg object-cover bg-black"
            />
            {cameraStatus ? <p className="text-xs text-slate-300">{cameraStatus}</p> : null}
          </div>
        ) : cameraStatus ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            {cameraStatus}
          </div>
        ) : null}

        {receivablePos.length === 0 ? (
          <EmptyState
            icon={<ScanBarcode className="h-5 w-5" aria-hidden="true" />}
            title="No open Purchase Orders awaiting receipt"
            description="Stage an Auto-PO on low-stock SKUs first, then scan incoming shipments here to generate Goods Receipt Notes."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
              <div className="sm:col-span-5">
                <label
                  htmlFor="grn-po-select"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Open Purchase Order
                </label>
                <select
                  id="grn-po-select"
                  value={selectedPoId}
                  onChange={e => setSelectedPoId(e.target.value)}
                  className="exec-input w-full text-xs font-semibold"
                >
                  {receivablePos.map(po => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} — {po.vendor_name} ({po.status} · {formatCents(po.total_cents)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="grn-received-by"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Received By
                </label>
                <input
                  id="grn-received-by"
                  value={receivedBy}
                  onChange={e => setReceivedBy(e.target.value)}
                  placeholder="Name or Dock Station"
                  className="exec-input w-full text-xs"
                />
              </div>

              <form onSubmit={handleManualScanSubmit} className="sm:col-span-4 flex gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="grn-barcode-input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Scan Barcode / SKU (+1)
                  </label>
                  <input
                    id="grn-barcode-input"
                    value={scanInput}
                    onChange={e => setScanInput(e.target.value)}
                    placeholder="Scan UPC or type SKU + Enter"
                    className="exec-input w-full text-xs font-mono uppercase"
                  />
                </div>
                <button
                  type="submit"
                  className="exec-btn-primary self-end !px-3 !py-2 !text-xs touch-target"
                >
                  Scan
                </button>
              </form>
            </div>

            {lastScannedCode ? (
              <p className="text-xs text-slate-600">
                Last scan input: <code className="font-mono font-bold text-slate-900">{lastScannedCode}</code>
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-3.5 py-2.5">SKU &amp; Item</th>
                    <th className="px-3.5 py-2.5 text-right">Ordered</th>
                    <th className="px-3.5 py-2.5 text-right">Prev Recv</th>
                    <th className="px-3.5 py-2.5 text-right">Receive Now</th>
                    <th className="px-3.5 py-2.5 text-right">Damaged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lines.map((line, index) => (
                    <tr key={line.sku}>
                      <td className="px-3.5 py-2.5">
                        <p className="font-mono font-bold text-slate-900">{line.sku}</p>
                        <p className="text-slate-600">{line.description}</p>
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-semibold tabular-nums">
                        {line.ordered_qty}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-slate-600 tabular-nums">
                        {line.already_received_qty}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          aria-label={`Receive quantity for ${line.sku}`}
                          value={line.received_qty}
                          onChange={e => {
                            const val = Math.max(0, Math.trunc(Number(e.target.value || 0)))
                            setLines(prev =>
                              prev.map((row, idx) =>
                                idx === index ? { ...row, received_qty: val } : row,
                              ),
                            )
                          }}
                          className="exec-input w-20 !py-1 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          aria-label={`Damaged quantity for ${line.sku}`}
                          value={line.damaged_qty}
                          onChange={e => {
                            const val = Math.max(0, Math.trunc(Number(e.target.value || 0)))
                            setLines(prev =>
                              prev.map((row, idx) =>
                                idx === index ? { ...row, damaged_qty: val } : row,
                              ),
                            )
                          }}
                          className="exec-input w-20 !py-1 text-right tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-600">
                Damaged units are excluded from usable <code className="font-mono">on_hand_qty</code> and flagged in 3-Way Match.
              </span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCommitReceipt()}
                className="exec-btn-primary !px-4 !py-2 !text-xs touch-target"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {submitting ? 'Logging GRN…' : 'Log Goods Receipt & Update Stock'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Recent Goods Receipts History */}
      <section className="exec-surface p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900">
            Recent Goods Receipt Notes ({goodsReceipts.length})
          </h4>
          <Badge tone="neutral">Immutable Dock Audit</Badge>
        </div>
        {goodsReceipts.length === 0 ? (
          <p className="text-xs text-slate-500">No Goods Receipt Notes logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {goodsReceipts.slice(0, 8).map(rec => (
              <li
                key={rec.id}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900">{rec.received_by}</span>
                  <span className="text-slate-500"> · {rec.received_at.slice(0, 16).replace('T', ' ')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(rec.items_json ?? []).map(item => (
                    <Badge key={`${rec.id}-${item.sku}`} tone={item.damaged_qty > 0 ? 'amber' : 'emerald'}>
                      {item.sku}: +{item.received_qty - item.damaged_qty} usable
                      {item.damaged_qty > 0 ? ` (${item.damaged_qty} dmg)` : ''}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
