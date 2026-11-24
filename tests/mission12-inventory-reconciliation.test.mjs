import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { loadSrcModule } from './helpers/load-src-module.mjs'

const {
  computeVarianceBps,
  evaluateInventoryValuation,
  exportReconciliationReportCsv,
  generateReorderDraftProposals,
  parseCycleCountCsv,
  parseInventoryCatalogCsv,
  runThreeWayInventoryReconciliation,
} = loadSrcModule('src/lib/inventory/index.ts')

const ROOT = process.cwd()

test('Mission 12 Valuation Engine: integer-cent valuation, available_qty, low-stock & negative anomalies', () => {
  const summary = evaluateInventoryValuation(
    [
      {
        id: 'item-1',
        workspace_id: 'ws-1',
        sku: 'hvac-cap-45',
        name: 'Dual Run Capacitor',
        barcode: '084910200451',
        category: 'HVAC',
        unit_of_measure: 'each',
        unit_cost_cents: 1850,
        unit_price_cents: 5400,
        reorder_point_qty: 12,
        reorder_qty: 24,
        preferred_vendor_name: 'Midwest Supply',
        on_hand_qty: 10,
        reserved_qty: 3,
        incoming_qty: 2,
        is_active: true,
      },
      {
        id: 'item-2',
        workspace_id: 'ws-1',
        sku: 'VALVE-34',
        name: 'Brass Valve',
        barcode: null,
        category: 'Plumbing',
        unit_of_measure: 'each',
        unit_cost_cents: 3200,
        unit_price_cents: 7900,
        reorder_point_qty: 5,
        reorder_qty: 10,
        preferred_vendor_name: 'Apex Parts',
        on_hand_qty: 2,
        reserved_qty: 4, // over-reserved negative anomaly
        incoming_qty: 0,
        is_active: true,
      },
    ],
  )

  assert.equal(summary.total_skus, 2)
  assert.equal(summary.total_on_hand_units, 12)
  assert.equal(summary.total_valuation_cents, 10 * 1850 + 2 * 3200)
  assert.equal(summary.low_stock_count, 2)
  assert.equal(summary.negative_anomaly_count, 1)

  const cap = summary.rows.find(r => r.sku === 'HVAC-CAP-45')
  assert.ok(cap)
  assert.equal(cap.available_qty, 7) // 10 - 3
  assert.equal(cap.is_low_stock, true) // 7 + 2 <= 12

  const proposals = generateReorderDraftProposals(summary)
  assert.equal(proposals.length, 2)
  assert.equal(proposals[0]?.vendor_name, 'Midwest Supply')
  assert.equal(proposals[0]?.estimated_total_cents, proposals[0].suggested_qty * 1850)
})

test('Mission 12 Valuation Engine: aggregates multi-location balances cleanly', () => {
  const summary = evaluateInventoryValuation(
    [
      {
        id: 'item-a',
        workspace_id: 'ws-1',
        sku: 'FILT-20',
        name: 'MERV-13 Filter',
        barcode: null,
        category: null,
        unit_of_measure: 'case',
        unit_cost_cents: 4500,
        unit_price_cents: 9000,
        reorder_point_qty: 10,
        reorder_qty: 15,
        preferred_vendor_name: 'Filter Co',
        on_hand_qty: 0,
        reserved_qty: 0,
        is_active: true,
      },
    ],
    [
      {
        id: 'bal-1',
        workspace_id: 'ws-1',
        item_id: 'item-a',
        location_id: 'loc-main',
        on_hand_qty: 8,
        reserved_qty: 1,
        incoming_qty: 5,
        last_counted_at: null,
        updated_at: '2026-11-23T00:00:00Z',
      },
      {
        id: 'bal-2',
        workspace_id: 'ws-1',
        item_id: 'item-a',
        location_id: 'loc-truck',
        on_hand_qty: 4,
        reserved_qty: 0,
        incoming_qty: 0,
        last_counted_at: null,
        updated_at: '2026-11-23T00:00:00Z',
      },
    ],
  )

  const row = summary.rows[0]
  assert.ok(row)
  assert.equal(row.on_hand_qty, 12)
  assert.equal(row.reserved_qty, 1)
  assert.equal(row.available_qty, 11)
  assert.equal(row.incoming_qty, 5)
  assert.equal(row.is_low_stock, false) // 11 + 5 > 10
  assert.equal(row.valuation_cents, 12 * 4500)
})

test('Mission 12 3-Way Reconciliation Engine: detects Phantom Inventory, Unbilled Receipts, Negative Stock & Unit Cost Drift', () => {
  const valuation = evaluateInventoryValuation([
    {
      id: 'item-1',
      workspace_id: 'ws-1',
      sku: 'VALVE-34',
      name: 'Brass Valve',
      barcode: null,
      category: null,
      unit_of_measure: 'each',
      unit_cost_cents: 3200,
      unit_price_cents: 7900,
      reorder_point_qty: 5,
      reorder_qty: 10,
      preferred_vendor_name: 'Apex Parts',
      on_hand_qty: 15,
      reserved_qty: 2,
      is_active: true,
    },
    {
      id: 'item-2',
      workspace_id: 'ws-1',
      sku: 'PIPE-CU-1',
      name: 'Copper Pipe',
      barcode: null,
      category: null,
      unit_of_measure: 'ft',
      unit_cost_cents: 1200,
      unit_price_cents: 2500,
      reorder_point_qty: 10,
      reorder_qty: 20,
      preferred_vendor_name: 'Apex Parts',
      on_hand_qty: -2,
      reserved_qty: 0,
      is_active: true,
    },
  ])

  const report = runThreeWayInventoryReconciliation({
    valuationRows: valuation.rows,
    physicalCounts: [
      {
        item_id: 'item-1',
        sku: 'VALVE-34',
        item_name: 'Brass Valve',
        book_qty: 15,
        counted_qty: 10, // -33.33% => Phantom Inventory
        unit_cost_cents: 3200,
        reason_code: 'shrinkage',
      },
    ],
    poLines: [
      {
        po_number: 'PO-101',
        vendor_name: 'Apex Parts',
        sku: 'VALVE-34',
        ordered_qty: 20,
        unit_cost_cents: 3200,
      },
    ],
    grnLines: [
      {
        receipt_number: 'GRN-101',
        po_number: 'PO-101',
        sku: 'VALVE-34',
        received_qty: 20,
        unit_cost_cents: 3200,
      },
    ],
    vendorBillLines: [
      {
        invoice_number: 'BILL-101',
        po_number: 'PO-101',
        vendor_name: 'Apex Parts',
        sku: 'VALVE-34',
        billed_qty: 16, // 4 unbilled units
        unit_cost_cents: 3500, // +9.38% cost drift (>200 bps)
      },
    ],
    costDriftToleranceBps: 200,
  })

  assert.equal(report.is_clean, false)
  assert.equal(report.phantom_count, 1)
  assert.equal(report.unbilled_receipt_count, 1)
  assert.equal(report.negative_stock_count, 1)
  assert.equal(report.cost_drift_count, 1)
  assert.equal(report.total_variance_qty, -5)
  assert.equal(report.total_variance_cents, -5 * 3200)
  assert.ok(report.fraud_shield_alerts.length >= 2)
  assert.equal(computeVarianceBps(3200, 3500), 938)

  const csv = exportReconciliationReportCsv(report)
  assert.match(csv, /^code,severity,sku,/)
  assert.match(csv, /phantom_inventory/)
  assert.match(csv, /unit_cost_drift/)
  assert.match(csv, /unbilled_receipt/)
})

test('Mission 12 CSV Parsers: catalog CSV & cycle-count sheet parsing', () => {
  const catalog = parseInventoryCatalogCsv(
    'sku,name,barcode,on_hand_qty,reorder_point_qty,reorder_qty,unit_cost_dollars,unit_price_dollars,preferred_vendor\n' +
      'CAP-45,"Dual Capacitor, 45/5",084910200451,18,12,24,18.50,54.00,Midwest Supply\n',
  )
  assert.equal(catalog.errors.length, 0)
  assert.equal(catalog.rows.length, 1)
  assert.equal(catalog.rows[0]?.unit_cost_cents, 1850)
  assert.equal(catalog.rows[0]?.unit_price_cents, 5400)
  assert.equal(catalog.rows[0]?.name, 'Dual Capacitor, 45/5')

  const counts = parseCycleCountCsv(
    'sku,barcode,counted_qty,reason_code,notes\nCAP-45,084910200451,11,shrinkage,Back shelf verified\n',
  )
  assert.equal(counts.errors.length, 0)
  assert.equal(counts.rows.length, 1)
  assert.equal(counts.rows[0]?.counted_qty, 11)
  assert.equal(counts.rows[0]?.reason_code, 'shrinkage')
})

test('Mission 12 SQL Migration, MCP Tools & Air-Gap Security Contracts', () => {
  const sql = readFileSync(
    path.join(ROOT, 'supabase/migrations/20261127000000_mission12_inventory_audit_reconciliation.sql'),
    'utf8',
  )
  assert.match(sql, /inventory_enabled boolean not null default true/i)
  assert.match(sql, /create table if not exists public\.inventory_locations/i)
  assert.match(sql, /create table if not exists public\.inventory_balances/i)
  assert.match(sql, /create table if not exists public\.inventory_audits/i)
  assert.match(sql, /create table if not exists public\.inventory_audit_lines/i)
  assert.match(sql, /create table if not exists public\.inventory_reorder_drafts/i)
  assert.match(sql, /record_inventory_movement_atomic/i)
  assert.match(sql, /transfer_inventory_atomic/i)
  assert.match(sql, /approve_and_reconcile_audit_atomic/i)
  assert.match(sql, /reconcile_grn_to_inventory_atomic/i)
  assert.match(sql, /set search_path = public, pg_temp/i)
  assert.match(sql, /is_workspace_owner/i)
  assert.doesNotMatch(sql, /\bdrop\s+(table|policy|constraint|index|function)\b/i)

  const mcp = readFileSync(path.join(ROOT, 'supabase/functions/loose-ends-mcp/index.ts'), 'utf8')
  assert.match(mcp, /name: "get_inventory_summary"/)
  assert.match(mcp, /name: "get_inventory_variance_report"/)
  assert.match(mcp, /name: "stage_reorder_draft"/)
  assert.match(mcp, /blocked_observe_mode/)

  // Air-gap contract: /demo sandbox must have ZERO supabase/edgeFunctions/opsCommand/queries references
  const sandboxSrc = readFileSync(
    path.join(ROOT, 'src/features/demo/Mission12InventorySandbox.tsx'),
    'utf8',
  )
  assert.match(sandboxSrc, /id="mission-12-inventory-sandbox"/)
  assert.doesNotMatch(sandboxSrc, /supabase|edgeFunctions|opsCommand|queries/i)

  // Authenticated live UI must have zero localStorage usage
  const liveUiSrc = readFileSync(
    path.join(ROOT, 'src/features/workspaces/inventory-pos/Mission12InventorySuite.tsx'),
    'utf8',
  )
  assert.doesNotMatch(liveUiSrc, /localStorage|sessionStorage/)
})
