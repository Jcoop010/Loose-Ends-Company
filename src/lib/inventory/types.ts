// Pure TypeScript domain types for Mission 12: Inventory Management, Auditing & Reconciliation
// Zero floating-point currency math — all monetary values are integer cents (BIGINT-safe).

export type InventoryLocationType = 'warehouse' | 'storefront' | 'truck' | 'bin' | 'consignment'

export type InventoryMovementType =
  | 'receive'
  | 'sale_deduct'
  | 'transfer_in'
  | 'transfer_out'
  | 'audit_adjustment'
  | 'return_restock'
  | 'damage_writeoff'
  | 'initial_load'

export type InventoryAuditType = 'cycle_count' | 'full_physical' | 'spot_check' | 'grn_reconcile'

export type InventoryAuditStatus =
  | 'draft'
  | 'in_progress'
  | 'pending_approval'
  | 'reconciled'
  | 'cancelled'

export type AuditReasonCode =
  | 'matched'
  | 'shrinkage'
  | 'damage'
  | 'receiving_error'
  | 'misplaced'
  | 'vendor_shortage'
  | 'unexplained'

export type ReorderDraftStatus = 'draft' | 'approved' | 'converted_to_po' | 'dismissed'
export type ReorderDraftSource = 'low_stock_engine' | 'audit_reconcile' | 'mcp_bot' | 'manual'

export interface InventoryLocation {
  id: string
  workspace_id: string
  name: string
  code: string
  location_type: InventoryLocationType
  address: string | null
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface InventoryBalance {
  id: string
  workspace_id: string
  item_id: string
  location_id: string
  on_hand_qty: number
  reserved_qty: number
  incoming_qty: number
  last_counted_at: string | null
  updated_at: string
}

export interface InventorySkuSnapshot {
  id: string
  workspace_id: string
  sku: string
  name: string
  barcode: string | null
  category: string | null
  unit_of_measure: string
  unit_cost_cents: number
  unit_price_cents: number
  reorder_point_qty: number
  reorder_qty: number
  preferred_vendor_name: string | null
  on_hand_qty: number
  reserved_qty: number
  incoming_qty?: number
  is_active: boolean
}

export interface InventoryMovementRecord {
  id: string
  workspace_id: string
  item_id: string
  location_id: string | null
  movement_type: InventoryMovementType | string
  qty_delta: number
  balance_after: number
  unit_cost_cents: number
  reference_type: string | null
  reference_id: string | null
  lot_or_serial: string | null
  notes: string | null
  idempotency_key: string | null
  created_at: string
}

export interface InventoryAudit {
  id: string
  workspace_id: string
  location_id: string | null
  audit_number: string
  title: string
  audit_type: InventoryAuditType
  status: InventoryAuditStatus
  total_expected_qty: number
  total_counted_qty: number
  total_variance_qty: number
  total_variance_cents: number
  notes: string | null
  submitted_at: string | null
  approved_by: string | null
  reconciled_at: string | null
  created_at: string
  updated_at: string
}

export interface InventoryAuditLine {
  id: string
  workspace_id: string
  audit_id: string
  item_id: string
  sku?: string
  item_name?: string
  location_id: string | null
  expected_qty: number
  counted_qty: number
  variance_qty: number
  unit_cost_cents: number
  variance_cents: number
  reason_code: AuditReasonCode
  notes: string | null
  scanned_barcode: string | null
}

export interface InventoryReorderDraft {
  id: string
  workspace_id: string
  item_id: string
  sku?: string
  item_name?: string
  location_id: string | null
  vendor_name: string
  suggested_qty: number
  unit_cost_cents: number
  estimated_total_cents: number
  status: ReorderDraftStatus
  source: ReorderDraftSource
  notes: string | null
  approved_by: string | null
  approved_at: string | null
  po_id: string | null
  idempotency_key: string | null
  created_at: string
}

export interface InventoryValuationRow {
  item_id: string
  sku: string
  name: string
  barcode: string | null
  category: string | null
  preferred_vendor_name: string
  on_hand_qty: number
  reserved_qty: number
  incoming_qty: number
  available_qty: number
  reorder_point_qty: number
  reorder_qty: number
  unit_cost_cents: number
  unit_price_cents: number
  valuation_cents: number
  retail_value_cents: number
  is_low_stock: boolean
  is_negative_anomaly: boolean
  suggested_reorder_qty: number
}

export interface InventoryValuationSummary {
  rows: InventoryValuationRow[]
  total_skus: number
  total_on_hand_units: number
  total_available_units: number
  total_valuation_cents: number
  total_retail_value_cents: number
  low_stock_count: number
  negative_anomaly_count: number
}

export interface ReorderDraftProposal {
  item_id: string
  sku: string
  name: string
  vendor_name: string
  available_qty: number
  incoming_qty: number
  reorder_point_qty: number
  suggested_qty: number
  unit_cost_cents: number
  estimated_total_cents: number
  reason: string
}

export type InventoryDiscrepancyCode =
  | 'phantom_inventory'
  | 'unbilled_receipt'
  | 'negative_stock_anomaly'
  | 'unit_cost_drift'
  | 'physical_shrinkage'

export type DiscrepancySeverity = 'low' | 'medium' | 'high' | 'critical'

export interface InventoryDiscrepancyFlag {
  id: string
  code: InventoryDiscrepancyCode
  severity: DiscrepancySeverity
  sku: string
  item_name: string
  reference_number: string | null
  expected_qty: number
  actual_qty: number
  variance_qty: number
  variance_bps: number
  variance_cents: number
  summary: string
  recommended_action: string
}

export interface PoLineForReconcile {
  po_number: string
  vendor_name: string
  sku: string
  ordered_qty: number
  unit_cost_cents: number
}

export interface GrnLineForReconcile {
  receipt_number: string
  po_number: string | null
  sku: string
  received_qty: number
  unit_cost_cents: number
}

export interface VendorBillLineForReconcile {
  invoice_number: string
  po_number: string | null
  vendor_name: string
  sku: string
  billed_qty: number
  unit_cost_cents: number
}

export interface PhysicalCountInput {
  item_id: string
  sku: string
  item_name: string
  book_qty: number
  counted_qty: number
  unit_cost_cents: number
  reason_code?: AuditReasonCode
}

export interface ThreeWayInventoryInput {
  valuationRows: InventoryValuationRow[]
  physicalCounts?: PhysicalCountInput[]
  poLines?: PoLineForReconcile[]
  grnLines?: GrnLineForReconcile[]
  vendorBillLines?: VendorBillLineForReconcile[]
  costDriftToleranceBps?: number
}

export interface InventoryFraudShieldPayload {
  alert_type: 'inventory_variance' | 'unit_cost_drift' | 'phantom_inventory' | 'unbilled_receipt'
  severity: DiscrepancySeverity
  sku: string
  exposure_cents: number
  headline: string
  detail: string
}

export interface ReconciliationReport {
  discrepancies: InventoryDiscrepancyFlag[]
  fraud_shield_alerts: InventoryFraudShieldPayload[]
  total_variance_qty: number
  total_variance_cents: number
  total_exposure_cents: number
  phantom_count: number
  unbilled_receipt_count: number
  negative_stock_count: number
  cost_drift_count: number
  shrinkage_count: number
  is_clean: boolean
}

export interface ParsedInventoryCsvRow {
  lineNumber: number
  sku: string
  name: string
  barcode: string | null
  category: string | null
  on_hand_qty: number
  reorder_point_qty: number
  reorder_qty: number
  unit_cost_cents: number
  unit_price_cents: number
  preferred_vendor_name: string | null
}

export interface ParsedCycleCountCsvRow {
  lineNumber: number
  sku: string
  barcode: string | null
  counted_qty: number
  reason_code: AuditReasonCode
  notes: string | null
}

export interface CsvParseResult<T> {
  rows: T[]
  errors: Array<{ lineNumber: number; message: string }>
}
