/// <reference path="../node-ambient.d.ts" />
/**
 * scripts/lib/receiptAudit.ts
 *
 * Pure, deterministic integer-cent receipt & vendor bill verification helpers.
 * Never trusts LLM arithmetic without strict TypeScript safe-integer recomputation.
 */

import type { JsonSchemaObject } from './ollamaClient';

export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
];

export const SUPPORTED_TEXT_EXTENSIONS: readonly string[] = [
  '.txt',
  '.csv',
  '.md',
  '.json',
];

export const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024;

export const SUSPICIOUS_FEE_KEYWORDS: readonly string[] = [
  'service fee',
  'fuel surcharge',
  'misc fee',
  'late fee',
];

export interface ExtractedReceiptLineItem {
  description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface ExtractedReceipt {
  vendor_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string;
  line_items: ExtractedReceiptLineItem[];
  subtotal_cents: number;
  tax_cents: number;
  extracted_total_cents: number;
  possible_duplicate_or_fee_flags: string[];
}

export interface VerifiedReceiptLineItem {
  description: string;
  quantity: number;
  unit_price_cents: number;
  extracted_line_total_cents: number;
  computed_line_total_cents: number;
  line_discrepancy_cents: number;
}

export interface ReceiptMathVerification {
  line_items: VerifiedReceiptLineItem[];
  computed_subtotal_cents: number;
  extracted_subtotal_cents: number;
  tax_cents: number;
  computed_total_cents: number;
  extracted_total_cents: number;
  subtotal_discrepancy_cents: number;
  discrepancy_cents: number;
  has_math_discrepancy: boolean;
  duplicate_line_flags: string[];
  suspicious_fee_flags: string[];
  all_flags: string[];
}

export interface ReceiptFileClassification {
  kind: 'image' | 'text';
  extension: string;
}

export interface StagedReceiptOpsActionInsert {
  workspace_id: string;
  bot_role: 'billing';
  workspace_domain: 'billing';
  action_type: 'vendor_bill_audit' | 'expense_receipt';
  title: string;
  summary: string;
  amount_cents: number;
  payload: Record<string, unknown>;
  confidence_score: number;
  status: 'pending_approval';
}

export const RECEIPT_EXTRACTION_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendor_name',
    'invoice_number',
    'invoice_date',
    'currency',
    'line_items',
    'subtotal_cents',
    'tax_cents',
    'extracted_total_cents',
    'possible_duplicate_or_fee_flags',
  ],
  properties: {
    vendor_name: { type: 'string' },
    invoice_number: { type: ['string', 'null'] },
    invoice_date: {
      type: ['string', 'null'],
      description: 'ISO date formatted as YYYY-MM-DD or null if unavailable.',
    },
    currency: { type: 'string' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unit_price_cents', 'line_total_cents'],
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number', minimum: 0 },
          unit_price_cents: { type: 'integer', minimum: 0 },
          line_total_cents: { type: 'integer', minimum: 0 },
        },
      },
    },
    subtotal_cents: { type: 'integer', minimum: 0 },
    tax_cents: { type: 'integer', minimum: 0 },
    extracted_total_cents: { type: 'integer', minimum: 0 },
    possible_duplicate_or_fee_flags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatCentsUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function isValidIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return false;
  }
  const timestamp = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  const reconstructed = new Date(timestamp).toISOString().slice(0, 10);
  return reconstructed === raw;
}

export function assertNonNegativeSafeInt(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Invalid monetary integer field "${fieldName}": expected non-negative safe integer, got ${String(value)}.`
    );
  }
  return value;
}

export function classifyReceiptFile(
  filePath: string,
  sizeBytes: number
): ReceiptFileClassification {
  const normalized = filePath.trim().replace(/\\/g, '/');
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dotIdx = fileName.lastIndexOf('.');
  const extension = dotIdx >= 0 ? fileName.slice(dotIdx).toLowerCase() : '';

  if (!extension) {
    throw new Error(`Unsupported receipt file "${fileName || filePath}": missing file extension.`);
  }

  const isImage = SUPPORTED_IMAGE_EXTENSIONS.indexOf(extension) !== -1;
  const isText = SUPPORTED_TEXT_EXTENSIONS.indexOf(extension) !== -1;
  if (!isImage && !isText) {
    throw new Error(
      `Unsupported receipt extension "${extension}". Allowed: ${SUPPORTED_IMAGE_EXTENSIONS.concat(SUPPORTED_TEXT_EXTENSIONS).join(', ')}.`
    );
  }

  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Receipt file "${fileName}" is empty (0 bytes).`);
  }

  if (sizeBytes > MAX_RECEIPT_FILE_BYTES) {
    throw new Error(
      `Receipt file "${fileName}" exceeds maximum size of 10 MB (${sizeBytes} bytes).`
    );
  }

  return {
    kind: isImage ? 'image' : 'text',
    extension,
  };
}

export function validateExtractedReceipt(raw: unknown): ExtractedReceipt | null {
  if (!isPlainRecord(raw)) {
    return null;
  }

  const vendorName = typeof raw.vendor_name === 'string' ? raw.vendor_name.trim() : '';
  if (!vendorName) {
    return null;
  }

  let invoiceNumber: string | null = null;
  if (raw.invoice_number !== null && raw.invoice_number !== undefined) {
    if (typeof raw.invoice_number !== 'string') {
      return null;
    }
    const cleanInv = raw.invoice_number.trim();
    invoiceNumber = cleanInv || null;
  }

  let invoiceDate: string | null = null;
  if (raw.invoice_date !== null && raw.invoice_date !== undefined) {
    if (typeof raw.invoice_date !== 'string') {
      return null;
    }
    const cleanDate = raw.invoice_date.trim();
    if (cleanDate) {
      if (!isValidIsoDate(cleanDate)) {
        return null;
      }
      invoiceDate = cleanDate;
    }
  }

  let currency = 'USD';
  if (raw.currency !== undefined && raw.currency !== null) {
    if (typeof raw.currency !== 'string') {
      return null;
    }
    const cleanCurrency = raw.currency.trim().toUpperCase();
    currency = cleanCurrency || 'USD';
  }

  if (
    typeof raw.subtotal_cents !== 'number' ||
    !Number.isSafeInteger(raw.subtotal_cents) ||
    raw.subtotal_cents < 0
  ) {
    return null;
  }
  if (
    typeof raw.tax_cents !== 'number' ||
    !Number.isSafeInteger(raw.tax_cents) ||
    raw.tax_cents < 0
  ) {
    return null;
  }
  if (
    typeof raw.extracted_total_cents !== 'number' ||
    !Number.isSafeInteger(raw.extracted_total_cents) ||
    raw.extracted_total_cents < 0
  ) {
    return null;
  }

  if (!Array.isArray(raw.line_items)) {
    return null;
  }

  const lineItems: ExtractedReceiptLineItem[] = [];
  for (const entry of raw.line_items) {
    if (!isPlainRecord(entry)) {
      return null;
    }
    const description =
      typeof entry.description === 'string' ? entry.description.trim() : '';
    if (!description) {
      return null;
    }
    if (
      typeof entry.quantity !== 'number' ||
      !Number.isFinite(entry.quantity) ||
      entry.quantity < 0
    ) {
      return null;
    }
    if (
      typeof entry.unit_price_cents !== 'number' ||
      !Number.isSafeInteger(entry.unit_price_cents) ||
      entry.unit_price_cents < 0
    ) {
      return null;
    }
    if (
      typeof entry.line_total_cents !== 'number' ||
      !Number.isSafeInteger(entry.line_total_cents) ||
      entry.line_total_cents < 0
    ) {
      return null;
    }
    lineItems.push({
      description,
      quantity: entry.quantity,
      unit_price_cents: entry.unit_price_cents,
      line_total_cents: entry.line_total_cents,
    });
  }

  if (!Array.isArray(raw.possible_duplicate_or_fee_flags)) {
    return null;
  }

  const modelFlags: string[] = [];
  for (const flag of raw.possible_duplicate_or_fee_flags) {
    if (typeof flag !== 'string') {
      return null;
    }
    const cleanFlag = flag.trim();
    if (cleanFlag) {
      modelFlags.push(cleanFlag);
    }
  }

  return {
    vendor_name: vendorName,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    currency,
    line_items: lineItems,
    subtotal_cents: raw.subtotal_cents,
    tax_cents: raw.tax_cents,
    extracted_total_cents: raw.extracted_total_cents,
    possible_duplicate_or_fee_flags: modelFlags,
  };
}

export function verifyReceiptMath(receipt: ExtractedReceipt): ReceiptMathVerification {
  const extractedSubtotalCents = assertNonNegativeSafeInt(
    receipt.subtotal_cents,
    'subtotal_cents'
  );
  const taxCents = assertNonNegativeSafeInt(receipt.tax_cents, 'tax_cents');
  const extractedTotalCents = assertNonNegativeSafeInt(
    receipt.extracted_total_cents,
    'extracted_total_cents'
  );

  const verifiedItems: VerifiedReceiptLineItem[] = [];
  let computedSubtotalCents = 0;
  let hasLineDiscrepancy = false;

  const seenLineCounts: Record<string, number> = {};
  const duplicateLineFlags: string[] = [];
  const suspiciousFeeFlags: string[] = [];

  for (let i = 0; i < receipt.line_items.length; i += 1) {
    const item = receipt.line_items[i];
    if (
      typeof item.quantity !== 'number' ||
      !Number.isFinite(item.quantity) ||
      item.quantity < 0
    ) {
      throw new Error(
        `Invalid quantity on line item ${i + 1} ("${item.description}"): expected finite non-negative number.`
      );
    }

    const unitPriceCents = assertNonNegativeSafeInt(
      item.unit_price_cents,
      `line_items[${i}].unit_price_cents`
    );
    const extractedLineTotalCents = assertNonNegativeSafeInt(
      item.line_total_cents,
      `line_items[${i}].line_total_cents`
    );

    const rawComputedLine = Number.isInteger(item.quantity)
      ? item.quantity * unitPriceCents
      : Math.round(item.quantity * unitPriceCents);
    const computedLineTotalCents = assertNonNegativeSafeInt(
      rawComputedLine,
      `line_items[${i}].computed_line_total_cents`
    );

    computedSubtotalCents = assertNonNegativeSafeInt(
      computedSubtotalCents + computedLineTotalCents,
      'computed_subtotal_cents'
    );

    const lineDiscrepancyCents = extractedLineTotalCents - computedLineTotalCents;
    if (lineDiscrepancyCents !== 0) {
      hasLineDiscrepancy = true;
    }

    verifiedItems.push({
      description: item.description.trim(),
      quantity: item.quantity,
      unit_price_cents: unitPriceCents,
      extracted_line_total_cents: extractedLineTotalCents,
      computed_line_total_cents: computedLineTotalCents,
      line_discrepancy_cents: lineDiscrepancyCents,
    });

    const normalizedDesc = item.description.trim().toLowerCase().replace(/\s+/g, ' ');
    const duplicateKey = `${normalizedDesc}::${String(extractedLineTotalCents)}`;
    seenLineCounts[duplicateKey] = (seenLineCounts[duplicateKey] ?? 0) + 1;
    if (seenLineCounts[duplicateKey] === 2) {
      duplicateLineFlags.push(
        `Duplicate line item: "${item.description.trim()}" (${formatCentsUsd(extractedLineTotalCents)})`
      );
    }

    for (const keyword of SUSPICIOUS_FEE_KEYWORDS) {
      if (normalizedDesc.includes(keyword)) {
        suspiciousFeeFlags.push(
          `Suspicious fee (${keyword}): "${item.description.trim()}" (${formatCentsUsd(extractedLineTotalCents)})`
        );
        break;
      }
    }
  }

  const computedTotalCents = assertNonNegativeSafeInt(
    computedSubtotalCents + taxCents,
    'computed_total_cents'
  );

  const subtotalDiscrepancyCents = extractedSubtotalCents - computedSubtotalCents;
  const discrepancyCents = extractedTotalCents - computedTotalCents;
  const hasMathDiscrepancy =
    discrepancyCents !== 0 || subtotalDiscrepancyCents !== 0 || hasLineDiscrepancy;

  const combinedFlags: string[] = [];
  const flagSeen: Record<string, boolean> = {};
  const addUniqueFlag = (flag: string): void => {
    const clean = flag.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(flagSeen, key)) {
      flagSeen[key] = true;
      combinedFlags.push(clean);
    }
  };

  if (discrepancyCents !== 0) {
    addUniqueFlag(
      `Total math discrepancy: extracted ${formatCentsUsd(extractedTotalCents)} vs computed ${formatCentsUsd(computedTotalCents)} (delta ${formatCentsUsd(discrepancyCents)})`
    );
  }
  if (subtotalDiscrepancyCents !== 0) {
    addUniqueFlag(
      `Subtotal discrepancy: extracted ${formatCentsUsd(extractedSubtotalCents)} vs computed ${formatCentsUsd(computedSubtotalCents)}`
    );
  }
  for (const flag of duplicateLineFlags) {
    addUniqueFlag(flag);
  }
  for (const flag of suspiciousFeeFlags) {
    addUniqueFlag(flag);
  }
  for (const flag of receipt.possible_duplicate_or_fee_flags) {
    addUniqueFlag(flag);
  }

  return {
    line_items: verifiedItems,
    computed_subtotal_cents: computedSubtotalCents,
    extracted_subtotal_cents: extractedSubtotalCents,
    tax_cents: taxCents,
    computed_total_cents: computedTotalCents,
    extracted_total_cents: extractedTotalCents,
    subtotal_discrepancy_cents: subtotalDiscrepancyCents,
    discrepancy_cents: discrepancyCents,
    has_math_discrepancy: hasMathDiscrepancy,
    duplicate_line_flags: duplicateLineFlags,
    suspicious_fee_flags: suspiciousFeeFlags,
    all_flags: combinedFlags,
  };
}

export function buildStagedReceiptAction(params: {
  workspaceId: string;
  receipt: ExtractedReceipt;
  verification: ReceiptMathVerification;
  sourceFileName: string;
  model: string;
}): StagedReceiptOpsActionInsert {
  const { workspaceId, receipt, verification, sourceFileName, model } = params;
  const hasAuditFindings =
    verification.has_math_discrepancy || verification.all_flags.length > 0;
  const actionType: 'vendor_bill_audit' | 'expense_receipt' = hasAuditFindings
    ? 'vendor_bill_audit'
    : 'expense_receipt';

  const confidenceScore = verification.has_math_discrepancy
    ? 0.62
    : verification.all_flags.length > 0
      ? 0.78
      : 0.94;

  const invoiceRef = receipt.invoice_number ? ` #${receipt.invoice_number}` : '';
  const statusTag = verification.has_math_discrepancy
    ? ' [MATH DISCREPANCY]'
    : verification.all_flags.length > 0
      ? ' [AUDIT FLAG]'
      : '';
  const title = `Local Receipt Audit — ${receipt.vendor_name}${invoiceRef}${statusTag}`;

  const discrepancyNote =
    verification.discrepancy_cents !== 0
      ? ` | Discrepancy: ${formatCentsUsd(verification.discrepancy_cents)} (extracted ${formatCentsUsd(verification.extracted_total_cents)} vs computed ${formatCentsUsd(verification.computed_total_cents)})`
      : '';
  const flagNote =
    verification.all_flags.length > 0
      ? ` | Flags (${verification.all_flags.length}): ${verification.all_flags.join('; ')}`
      : ' | Arithmetic & line items verified clean.';

  const summary = `Verified total: ${formatCentsUsd(verification.computed_total_cents)} (${verification.line_items.length} line item(s), tax ${formatCentsUsd(verification.tax_cents)})${discrepancyNote}${flagNote}`;

  return {
    workspace_id: workspaceId,
    bot_role: 'billing',
    workspace_domain: 'billing',
    action_type: actionType,
    title,
    summary,
    amount_cents: verification.computed_total_cents,
    payload: {
      source: 'local_ollama_vision_audit',
      source_file: sourceFileName,
      model,
      vendor_name: receipt.vendor_name,
      invoice_number: receipt.invoice_number,
      invoice_date: receipt.invoice_date,
      currency: receipt.currency,
      line_items: verification.line_items,
      computed_subtotal_cents: verification.computed_subtotal_cents,
      extracted_subtotal_cents: verification.extracted_subtotal_cents,
      tax_cents: verification.tax_cents,
      computed_total_cents: verification.computed_total_cents,
      extracted_total_cents: verification.extracted_total_cents,
      subtotal_discrepancy_cents: verification.subtotal_discrepancy_cents,
      discrepancy_cents: verification.discrepancy_cents,
      has_math_discrepancy: verification.has_math_discrepancy,
      duplicate_line_flags: verification.duplicate_line_flags,
      suspicious_fee_flags: verification.suspicious_fee_flags,
      all_flags: verification.all_flags,
    },
    confidence_score: confidenceScore,
    status: 'pending_approval',
  };
}
