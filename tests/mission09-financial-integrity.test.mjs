import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const {
  MAX_DOCUMENT_BYTES,
  validateDocumentFileMeta,
  validateAndExtractBillDocument,
  processInboundBillCapture,
  buildPostCapturedBillPlan,
  parseBankFeedPayload,
  autoReconcileBankFeed,
  computeBankTransactionFingerprint,
  BANK_FEED_SOURCE_LABELS,
  filterByEntityId,
} = loadSrcModule('src/lib/autonomousOs/index.ts')

const wsId = '11111111-1111-4111-8111-111111111111'

// 1. Document ingestion limits & real PDF extraction (no binary .text() fabrication)
assert.equal(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024)
assert.match(validateDocumentFileMeta('empty.pdf', 0) ?? '', /empty/i)
assert.match(
  validateDocumentFileMeta('huge.pdf', MAX_DOCUMENT_BYTES + 1) ?? '',
  /5 MB/i,
)
assert.match(validateDocumentFileMeta('payload.exe', 1024) ?? '', /Unsupported/i)
assert.equal(validateDocumentFileMeta('vendor_bill.pdf', 4096), null)

// Uncompressed PDF BT/ET Tj stream extraction
const uncompressedPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Length 96 >> stream\nBT\n(Vendor: Apex Supply) Tj\n(Invoice #9040) Tj\n(COIL-10 x4 @ $160.00 Total: $640.00) Tj\nET\nendstream\nendobj\n%%EOF',
  'latin1',
)
const extractedPdf = await validateAndExtractBillDocument({
  fileName: 'apex_9040.pdf',
  bytes: new Uint8Array(uncompressedPdf),
})
assert.equal(extractedPdf.extraction_method, 'pdf_stream_extracted')
assert.equal(extractedPdf.extraction_confidence_bps, 8500)
assert.match(extractedPdf.content_hash, /^[0-9a-f]{64}$/)
assert.match(extractedPdf.extracted_text, /Vendor: Apex Supply/)
assert.match(extractedPdf.extracted_text, /\$640\.00/)

// Compressed /FlateDecode PDF stream extraction via DecompressionStream('deflate')
const compressedPayload = deflateSync(
  Buffer.from('BT\n(Titan Valve Corp) Tj\n(Total Due $1,120.00) Tj\nET', 'latin1'),
)
const compressedPdf = Buffer.concat([
  Buffer.from('%PDF-1.4\n2 0 obj << /Filter /FlateDecode >> stream\n', 'latin1'),
  compressedPayload,
  Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
])
const extractedCompressed = await validateAndExtractBillDocument({
  fileName: 'titan_flate.pdf',
  bytes: new Uint8Array(compressedPdf),
})
assert.equal(extractedCompressed.extraction_method, 'pdf_stream_extracted')
assert.match(extractedCompressed.extracted_text, /Titan Valve Corp/)
assert.match(extractedCompressed.extracted_text, /\$1,120\.00/)

// Image-only scanned PDF must flag 0% confidence & warning rather than fabricating totals
const scannedPdf = Buffer.from(
  '%PDF-1.4\n3 0 obj << /Subtype /Image /Width 800 /Height 600 >> stream\n\x89PNG\r\n\x1a\n\x00\x00fakeimagebytes\nendstream\n%%EOF',
  'latin1',
)
const scannedOut = await validateAndExtractBillDocument({
  fileName: 'scanned_receipt.pdf',
  bytes: new Uint8Array(scannedPdf),
})
assert.equal(scannedOut.extraction_method, 'pdf_scanned_needs_ocr')
assert.equal(scannedOut.extracted_text, '')
assert.equal(scannedOut.extraction_confidence_bps, 0)
assert.ok(scannedOut.warning)

// Corrupted binary text upload must return unsupported cleanly
const garbageBytes = Buffer.from([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd])
const garbageOut = await validateAndExtractBillDocument({
  fileName: 'corrupt.txt',
  bytes: new Uint8Array(garbageBytes),
})
assert.equal(garbageOut.extraction_method, 'unsupported')
assert.equal(garbageOut.extraction_confidence_bps, 0)

// 2. Inbox-to-Ledger human-verification gate, duplicate prevention & entity propagation
const unmatchedEval = processInboundBillCapture({
  workspaceId: wsId,
  entityId: 'ent-ohio-1',
  sourceAddress: 'bills@test.looseendsos.app',
  fileName: 'unmatched.txt',
  rawText: 'Vendor: Valley Freight\nInvoice #VF-101\nTotal Due: $250.00',
})
assert.equal(unmatchedEval.capture_draft.match_status, 'needs_review')
assert.equal(unmatchedEval.capture_draft.human_verified, false)

const unverifiedRecord = {
  ...unmatchedEval.capture_draft,
  id: 'cap-unverified',
  created_at: '2026-11-23T12:00:00Z',
  updated_at: '2026-11-23T12:00:00Z',
}

assert.throws(
  () =>
    buildPostCapturedBillPlan({
      workspaceId: wsId,
      capture: unverifiedRecord,
      requireHumanVerified: true,
      humanVerified: false,
    }),
  /Human verification/i,
)

const verifiedPlan = buildPostCapturedBillPlan({
  workspaceId: wsId,
  capture: unverifiedRecord,
  requireHumanVerified: true,
  humanVerified: true,
})
assert.equal(verifiedPlan.updated_capture.match_status, 'posted')
assert.equal(verifiedPlan.updated_capture.human_verified, true)
assert.equal(verifiedPlan.ledger_entry_draft.entity_id, 'ent-ohio-1')

assert.throws(
  () =>
    buildPostCapturedBillPlan({
      workspaceId: wsId,
      capture: { ...unverifiedRecord, match_status: 'posted' },
    }),
  /already been posted/i,
)

// 3. Bank Feed reconciliation hardening (skip paid, block double-match, honest labels, name overlap)
assert.equal(BANK_FEED_SOURCE_LABELS.plaid_webhook, 'Manual JSON Statement (No Live Plaid)')

const ofxWithFitid = `
<OFX><BANKMSGSRSV1><STMTTRN>
<DTPOSTED>20261120120000
<TRNAMT>900.00
<FITID>FIT-900-A
<NAME>Cedar Point Clinic ACH
</STMTTRN><STMTTRN>
<DTPOSTED>20261120120000
<TRNAMT>900.00
<FITID>FIT-900-B
<NAME>Unknown Wire Sender
</STMTTRN></BANKMSGSRSV1></OFX>`
const parsedOfx = parseBankFeedPayload(ofxWithFitid, 'ofx_qbo')
assert.equal(parsedOfx.length, 2)
assert.equal(parsedOfx[0].external_tx_id, 'FIT-900-A')

const fpA = computeBankTransactionFingerprint({
  source: 'ofx_qbo',
  posted_date: parsedOfx[0].posted_date,
  merchant_name: parsedOfx[0].merchant_name,
  amount_cents: parsedOfx[0].amount_cents,
  direction: parsedOfx[0].direction,
})
const fpA2 = computeBankTransactionFingerprint({
  source: 'ofx_qbo',
  posted_date: parsedOfx[0].posted_date,
  merchant_name: parsedOfx[0].merchant_name,
  amount_cents: parsedOfx[0].amount_cents,
  direction: parsedOfx[0].direction,
})
assert.equal(fpA, fpA2)
assert.notEqual(
  fpA,
  computeBankTransactionFingerprint({
    source: 'ofx_qbo',
    posted_date: parsedOfx[1].posted_date,
    merchant_name: parsedOfx[1].merchant_name,
    amount_cents: parsedOfx[1].amount_cents,
    direction: parsedOfx[1].direction,
  }),
)

const recon = autoReconcileBankFeed({
  workspaceId: wsId,
  transactions: parsedOfx,
  invoices: [
    {
      id: 'inv-paid',
      workspace_id: wsId,
      invoice_number: 'INV-100',
      customer_name: 'Cedar Point Clinic',
      due_date: '2026-11-20',
      total_cents: 90000,
      amount_paid_cents: 90000,
      status: 'paid',
    },
    {
      id: 'inv-open',
      workspace_id: wsId,
      invoice_number: 'INV-101',
      customer_name: 'Cedar Point Clinic',
      due_date: '2026-11-20',
      total_cents: 90000,
      amount_paid_cents: 0,
      status: 'sent',
    },
  ],
  vendorBills: [],
  existingMatchedRecordIds: new Set(['inv-open']),
})

// Both paid invoice AND already-matched inv-open are excluded cleanly
assert.equal(recon.auto_matched_count, 0)
assert.equal(recon.transactions.every(t => t.status === 'unmatched'), true)

// When open invoice isn't yet claimed: first tx with counterparty name overlap scores 10000 bps; second non-overlapping stays unmatched
const reconOpen = autoReconcileBankFeed({
  workspaceId: wsId,
  transactions: parsedOfx,
  invoices: [
    {
      id: 'inv-open-2',
      workspace_id: wsId,
      invoice_number: 'INV-102',
      customer_name: 'Cedar Point Clinic',
      due_date: '2026-11-20',
      total_cents: 90000,
      amount_paid_cents: 0,
      status: 'sent',
    },
  ],
  vendorBills: [],
})
assert.equal(reconOpen.auto_matched_count, 1)
assert.equal(reconOpen.transactions[0].match_confidence_bps, 10000)
assert.equal(reconOpen.transactions[1].status, 'unmatched')

// Exact cent without name overlap caps confidence at 9000 bps instead of 10000 bps
const noOverlapRecon = autoReconcileBankFeed({
  workspaceId: wsId,
  transactions: [parsedOfx[1]],
  invoices: [
    {
      id: 'inv-open-3',
      workspace_id: wsId,
      invoice_number: 'INV-103',
      customer_name: 'Cedar Point Clinic',
      due_date: '2026-11-20',
      total_cents: 90000,
      amount_paid_cents: 0,
      status: 'sent',
    },
  ],
  vendorBills: [],
})
assert.equal(noOverlapRecon.auto_matched_count, 1)
assert.equal(noOverlapRecon.transactions[0].match_confidence_bps, 9000)

// 4. Multi-entity scoping preserves entity_id: null rows under consolidated & primary
const sampleRows = [
  { id: 'r1', entity_id: null },
  { id: 'r2', entity_id: 'ent-a' },
  { id: 'r3', entity_id: 'ent-b' },
]
assert.equal(filterByEntityId(sampleRows, 'consolidated').length, 3)
assert.equal(filterByEntityId(sampleRows, 'primary').length, 3)
assert.deepEqual(
  filterByEntityId(sampleRows, 'ent-a').map(r => r.id),
  ['r2'],
)

// 5. SQL atomic RPCs, triggers, EIN cleanup & safe reversal invariants
const sql = readSrc('supabase/migrations/20261125000000_mission09_integrity_security_workforce.sql')
assert.match(sql, /create or replace function public\.post_inbound_bill_capture_atomic/i)
assert.match(sql, /create or replace function public\.reconcile_bank_feed_atomic/i)
assert.match(sql, /create or replace function public\.apply_job_change_order_atomic/i)
assert.match(sql, /create or replace function public\.reverse_agent_action_atomic/i)
assert.match(sql, /create or replace function public\.enforce_entity_workspace_ownership/i)
assert.match(sql, /ein_last4 = null/i)
assert.match(sql, /identity_status = 'unverified'/i)

const queriesSrc = readSrc('src/lib/autonomousOs/queries.ts')
assert.match(queriesSrc, /action_type === 'create_invoice'/)
assert.doesNotMatch(queriesSrc, /send_invoice_reminder'\)\s*\{\s*[\r\n]+\s*await supabase[\s\S]{0,120}status:\s*'void'/)

console.log('Mission 09 financial integrity tests passed')
