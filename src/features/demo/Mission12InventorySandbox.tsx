import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Barcode,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  RotateCcw,
  ShieldAlert,
  ShoppingCart,
} from 'lucide-react'
import {
  evaluateInventoryValuation,
  generateReorderDraftProposals,
  runThreeWayInventoryReconciliation,
  type InventorySkuSnapshot,
} from '../../lib/inventory'
import { formatCents } from '../../lib/format'
import { Badge } from '../../components/ui/MetricCard'
import { useToast } from '../../components/ui/Toast'

// 100% air-gapped interactive demo data (strictly inside /demo, zero backend calls)
const INITIAL_DEMO_SKUS: InventorySkuSnapshot[] = [
  {
    id: 'demo-sku-01',
    workspace_id: 'demo-workspace',
    sku: 'HVAC-CAP-45',
    name: 'Dual Run Capacitor 45/5 MFD',
    barcode: '084910200451',
    category: 'HVAC Electrical',
    unit_of_measure: 'each',
    unit_cost_cents: 1850,
    unit_price_cents: 5400,
    reorder_point_qty: 12,
    reorder_qty: 24,
    preferred_vendor_name: 'Midwest Supply Wholesale',
    on_hand_qty: 18,
    reserved_qty: 4,
    incoming_qty: 0,
    is_active: true,
  },
  {
    id: 'demo-sku-02',
    workspace_id: 'demo-workspace',
    sku: 'VALVE-BRASS-34',
    name: '3/4" Commercial Brass Ball Valve',
    barcode: '084910200342',
    category: 'Plumbing',
    unit_of_measure: 'each',
    unit_cost_cents: 3200,
    unit_price_cents: 7900,
    reorder_point_qty: 10,
    reorder_qty: 20,
    preferred_vendor_name: 'Apex Mechanical Parts',
    on_hand_qty: 15,
    reserved_qty: 2,
    incoming_qty: 0,
    is_active: true,
  },
  {
    id: 'demo-sku-03',
    workspace_id: 'demo-workspace',
    sku: 'FILT-MERV13-20',
    name: 'MERV-13 Pleated Filter 20x25x4',
    barcode: '084910200203',
    category: 'Filtration',
    unit_of_measure: 'case',
    unit_cost_cents: 4500,
    unit_price_cents: 9800,
    reorder_point_qty: 8,
    reorder_qty: 16,
    preferred_vendor_name: 'Midwest Supply Wholesale',
    on_hand_qty: 6,
    reserved_qty: 1,
    incoming_qty: 0,
    is_active: true,
  },
]

interface DemoReorderItem {
  id: string
  sku: string
  vendor_name: string
  suggested_qty: number
  unit_cost_cents: number
  estimated_total_cents: number
  status: 'draft' | 'approved' | 'dismissed'
}

export function Mission12InventorySandbox(): React.ReactElement {
  const toast = useToast()
  const [skus, setSkus] = useState<InventorySkuSnapshot[]>(INITIAL_DEMO_SKUS)
  const [auditStatus, setAuditStatus] = useState<'idle' | 'pending_approval' | 'reconciled'>('idle')
  const [countedCapacitors, setCountedCapacitors] = useState<number>(18)
  const [countedValves, setCountedValves] = useState<number>(15)
  const [reorderQueue, setReorderQueue] = useState<DemoReorderItem[]>([
    {
      id: 'demo-po-1',
      sku: 'FILT-MERV13-20',
      vendor_name: 'Midwest Supply Wholesale',
      suggested_qty: 16,
      unit_cost_cents: 4500,
      estimated_total_cents: 72000,
      status: 'draft',
    },
  ])

  const valuation = useMemo(() => evaluateInventoryValuation(skus), [skus])
  const proposals = useMemo(() => generateReorderDraftProposals(valuation), [valuation])

  const reconciliation = useMemo(() => {
    const capSku = skus.find(s => s.sku === 'HVAC-CAP-45')
    const valveSku = skus.find(s => s.sku === 'VALVE-BRASS-34')
    const physicalCounts =
      auditStatus === 'pending_approval' && capSku && valveSku
        ? [
            {
              item_id: capSku.id,
              sku: capSku.sku,
              item_name: capSku.name,
              book_qty: capSku.on_hand_qty,
              counted_qty: countedCapacitors,
              unit_cost_cents: capSku.unit_cost_cents,
              reason_code: 'shrinkage' as const,
            },
            {
              item_id: valveSku.id,
              sku: valveSku.sku,
              item_name: valveSku.name,
              book_qty: valveSku.on_hand_qty,
              counted_qty: countedValves,
              unit_cost_cents: valveSku.unit_cost_cents,
              reason_code: 'shrinkage' as const,
            },
          ]
        : []

    return runThreeWayInventoryReconciliation({
      valuationRows: valuation.rows,
      physicalCounts,
      poLines: [
        {
          po_number: 'PO-2026-410',
          vendor_name: 'Apex Mechanical Parts',
          sku: 'VALVE-BRASS-34',
          ordered_qty: 20,
          unit_cost_cents: 3200,
        },
      ],
      grnLines: [
        {
          receipt_number: 'GRN-2026-118',
          po_number: 'PO-2026-410',
          sku: 'VALVE-BRASS-34',
          received_qty: 20,
          unit_cost_cents: 3200,
        },
      ],
      vendorBillLines: [
        {
          invoice_number: 'INV-APEX-991',
          po_number: 'PO-2026-410',
          vendor_name: 'Apex Mechanical Parts',
          sku: 'VALVE-BRASS-34',
          billed_qty: 16,
          unit_cost_cents: 3450, // +7.81% unit cost drift
        },
      ],
      costDriftToleranceBps: 200,
    })
  }, [auditStatus, countedCapacitors, countedValves, skus, valuation.rows])

  const handleSimulateCycleShrinkage = () => {
    setCountedCapacitors(11) // -7 units shrinkage on HVAC-CAP-45 ($129.50)
    setCountedValves(10) // -5 units phantom inventory on VALVE-BRASS-34 ($160.00)
    setAuditStatus('pending_approval')
    toast.info(
      'Cycle Count Submitted for Approval',
      '12 missing units flagged across 2 SKUs. Book balances stay locked until owner approves.',
    )
  }

  const handleApproveAndReconcile = () => {
    setSkus(prev =>
      prev.map(item => {
        if (item.sku === 'HVAC-CAP-45') return { ...item, on_hand_qty: countedCapacitors }
        if (item.sku === 'VALVE-BRASS-34') return { ...item, on_hand_qty: countedValves }
        return item
      }),
    )
    setAuditStatus('reconciled')

    // Stage low-stock reorder draft for HVAC-CAP-45 now that available (11 - 4 = 7) <= reorder_point (12)
    setReorderQueue(prev => {
      if (prev.some(d => d.sku === 'HVAC-CAP-45')) return prev
      return [
        {
          id: 'demo-po-2',
          sku: 'HVAC-CAP-45',
          vendor_name: 'Midwest Supply Wholesale',
          suggested_qty: 24,
          unit_cost_cents: 1850,
          estimated_total_cents: 44400,
          status: 'draft',
        },
        ...prev,
      ]
    })

    toast.success(
      'Audit Reconciled Atomically',
      'Immutable audit_adjustment rows posted, balances updated, and low-stock Draft PO staged.',
    )
  }

  const handleReorderDecision = (id: string, status: 'approved' | 'dismissed') => {
    setReorderQueue(prev => prev.map(item => (item.id === id ? { ...item, status } : item)))
    toast.success(
      status === 'approved' ? 'Draft PO Approved' : 'Draft PO Dismissed',
      status === 'approved'
        ? 'Human-in-the-loop owner approval recorded.'
        : 'Reorder draft removed from active queue.',
    )
  }

  const handleReset = () => {
    setSkus(INITIAL_DEMO_SKUS)
    setAuditStatus('idle')
    setCountedCapacitors(18)
    setCountedValves(15)
    setReorderQueue([
      {
        id: 'demo-po-1',
        sku: 'FILT-MERV13-20',
        vendor_name: 'Midwest Supply Wholesale',
        suggested_qty: 16,
        unit_cost_cents: 4500,
        estimated_total_cents: 72000,
        status: 'draft',
      },
    ])
    toast.info('Inventory Sandbox Reset', 'Restored initial warehouse book balances.')
  }

  return (
    <div
      id="mission-12-inventory-sandbox"
      className="rounded-2xl border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-5 text-slate-100"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#EA580C]/20 border border-[#EA580C]/40 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#fdba74]">
              <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
              Mission 12 · Inventory Audit &amp; 3-Way Reconciliation
            </span>
            <Badge tone={reconciliation.is_clean ? 'emerald' : 'rose'}>
              {reconciliation.discrepancies.length} Discrepancy Flag(s)
            </Badge>
          </div>
          <h3 className="mt-2 text-lg font-bold text-white">
            Autonomous Stock Ledger, Cycle Count &amp; Reorder Sandbox
          </h3>
          <p className="text-xs text-slate-400">
            100% air-gapped local simulation. Test cycle-count shrinkage, 3-way Fraud Shield flags (Phantom Inventory, Unbilled Receipts, Unit Cost Drift), 1-tap Approve &amp; Reconcile, and Draft PO approvals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSimulateCycleShrinkage}
            disabled={auditStatus === 'pending_approval'}
            className="exec-btn-primary !px-3 !py-1.5 !text-xs"
          >
            <Barcode className="h-3.5 w-3.5" aria-hidden="true" />
            Simulate Cycle Count Shrinkage
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Book Valuation
          </p>
          <p className="mt-1 text-lg font-bold text-white tabular-nums">
            {formatCents(valuation.total_valuation_cents)}
          </p>
          <p className="text-[11px] text-slate-400">{valuation.total_on_hand_units} units on hand</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Audit Status
          </p>
          <p className="mt-1 text-lg font-bold text-[#fdba74] capitalize">
            {auditStatus.replace('_', ' ')}
          </p>
          <p className="text-[11px] text-slate-400">Human-in-the-loop gate</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            3-Way Exposure
          </p>
          <p className="mt-1 text-lg font-bold text-rose-400 tabular-nums">
            {formatCents(reconciliation.total_exposure_cents)}
          </p>
          <p className="text-[11px] text-slate-400">
            {reconciliation.fraud_shield_alerts.length} Fraud Shield alert(s)
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Low-Stock SKUs
          </p>
          <p className="mt-1 text-lg font-bold text-amber-300 tabular-nums">
            {proposals.length}
          </p>
          <p className="text-[11px] text-slate-400">
            {reorderQueue.filter(r => r.status === 'draft').length} draft PO(s) queued
          </p>
        </div>
      </div>

      {/* Main Split: 3-Way Reconciliation & Reorder Queue */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Reconciliation & 1-Tap Approve */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
              <h4 className="text-sm font-bold text-white">3-Way Reconciliation &amp; Audit Gate</h4>
            </div>
            {auditStatus === 'pending_approval' ? (
              <button
                type="button"
                onClick={handleApproveAndReconcile}
                className="exec-btn-emerald !px-3 !py-1.5 !text-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Approve &amp; Reconcile
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            {reconciliation.discrepancies.map(flag => (
              <div
                key={flag.id}
                className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                    <span className="font-mono font-bold text-white">{flag.sku}</span>
                    <Badge tone="rose">{flag.code.replace(/_/g, ' ')}</Badge>
                  </div>
                  <span className="font-bold text-rose-300 tabular-nums">
                    {formatCents(flag.variance_cents)}
                  </span>
                </div>
                <p className="text-slate-300">{flag.summary}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Autonomous Reorder Queue */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
              <h4 className="text-sm font-bold text-white">Autonomous Reorder Queue</h4>
            </div>
            <ClipboardCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            {reorderQueue.map(draft => (
              <div
                key={draft.id}
                className="rounded-lg border border-slate-800 bg-[#0b1320] p-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white">{draft.sku}</span>
                    <Badge
                      tone={
                        draft.status === 'approved'
                          ? 'emerald'
                          : draft.status === 'dismissed'
                            ? 'neutral'
                            : 'amber'
                      }
                    >
                      {draft.status}
                    </Badge>
                  </div>
                  <p className="text-slate-400 mt-0.5">
                    {draft.vendor_name} · Qty {draft.suggested_qty} ·{' '}
                    <strong className="text-slate-200">{formatCents(draft.estimated_total_cents)}</strong>
                  </p>
                </div>

                {draft.status === 'draft' ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleReorderDecision(draft.id, 'approved')}
                      className="exec-btn-emerald !px-2.5 !py-1 !text-[11px]"
                    >
                      Approve Draft PO
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReorderDecision(draft.id, 'dismissed')}
                      className="exec-btn-secondary !px-2.5 !py-1 !text-[11px]"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
