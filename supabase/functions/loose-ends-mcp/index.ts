import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-mcp-token, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const ALLOWED_BOT_ROLES = [
  "chief_of_staff",
  "scout",
  "dispatcher",
  "buyer",
  "billing",
  "cash_applications",
  "collections",
  "outreach",
  "qa",
] as const;

const ALLOWED_DOMAINS = [
  "pipeline",
  "jobs",
  "inventory",
  "comms",
  "billing",
] as const;

const ALLOWED_ACTION_TYPES = [
  "quote_draft",
  "job_checklist_flag",
  "sms_voicemail_command",
  "open_loop_recovery",
  "vendor_bill_audit",
  "photo_inventory_import",
  "purchase_order_draft",
  "collection_call_request",
  "ops_readiness_scorecard",
  "expense_receipt",
  "invoice_draft",
  "payment_match",
  "discrepancy_flag",
] as const;

const ALLOWED_GRADES = ["A", "B", "C", "D"] as const;
const ALLOWED_AUTONOMY_MODES = ["manual", "approve_1tap", "full_auto"] as const;
const ALLOWED_LEDGER_STATUSES = ["executed", "pending_approval", "reversed"] as const;
const ALLOWED_INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "void"] as const;

type BotRole = (typeof ALLOWED_BOT_ROLES)[number];
type WorkspaceDomain = (typeof ALLOWED_DOMAINS)[number];
type StagedActionType = (typeof ALLOWED_ACTION_TYPES)[number];
type AuditGrade = (typeof ALLOWED_GRADES)[number];
type AutonomyMode = (typeof ALLOWED_AUTONOMY_MODES)[number];
type LedgerStatus = (typeof ALLOWED_LEDGER_STATUSES)[number];
type InvoiceStatus = (typeof ALLOWED_INVOICE_STATUSES)[number];
type RequiredScope = "read_all" | "stage_actions";

interface InvoiceRowForAr {
  id: string;
  invoice_number: string;
  title: string;
  customer_name: string;
  total_cents: number;
  amount_paid_cents: number;
  due_date: string;
  status: string;
  created_at: string;
}

const DEFAULT_MODULES_ENABLED: Readonly<Record<string, boolean>> = {
  crm: true,
  quotes: true,
  billing: true,
  inventory: false,
  bookkeeping: false,
  projects: false,
  vault: true,
};

const DEFAULT_AUTONOMY_RULES: Readonly<Record<string, AutonomyMode>> = {
  send_quote_followup: "approve_1tap",
  convert_signed_quote_to_invoice: "full_auto",
  send_invoice_reminder: "approve_1tap",
  flag_overdue_ar: "full_auto",
  stage_auto_po: "approve_1tap",
  approve_clean_vendor_bill: "full_auto",
  stage_compliance_notice: "approve_1tap",
};

const DEFAULT_AUTO_LIMIT_CENTS = 50000;

interface WorkspaceMcpTokenRow {
  id: string;
  workspace_id: string;
  label: string;
  scopes: string[] | null;
  revoked_at: string | null;
}

interface BotRunStateRow {
  state_hash: string | null;
}

interface ConsentEventRow {
  id?: string;
  workspace_id?: string | null;
  customer_id?: string | null;
  email?: string | null;
  channel?: string | null;
  status?: string | null;
  decision?: string | null;
  created_at?: string | null;
}

interface CustomerIdRow {
  id: string;
}

interface OpsReadinessAuditRow {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  business_name: string;
  website_url: string | null;
  score_0_100: number;
  grade: AuditGrade;
  findings: string[];
  report_html: string;
  created_at: string;
}

interface ExistingLeadDraftRow {
  id: string;
  status: string;
  delivery_status: string;
}

interface BotManualRow {
  id?: string;
  workspace_id: string;
  bot_role: string;
  mode: string;
  instructions_markdown: string;
  updated_at?: string | null;
}

interface BotRoleIndexEntry {
  role: BotRole;
  mode: string;
  title: string;
  summary: string;
  has_custom_manual: boolean;
}

interface OpsReadinessRubricCategory {
  id: string;
  name: string;
  max_points: number;
  criteria: readonly string[];
}

interface OpsReadinessRubric {
  total_points: 100;
  grade_bands: Readonly<Record<AuditGrade, string>>;
  categories: readonly OpsReadinessRubricCategory[];
}

interface ConsentCheckResult {
  suppressed: boolean;
  reason: string;
  consent_events: ConsentEventRow[];
}

interface InventoryRow {
  id?: string;
  name?: string;
  sku?: string;
  location?: string | null;
  bin_code?: string | null;
  preferred_vendor?: string | null;
  lead_time_days?: number;
  on_hand_qty?: number;
  reserved_qty?: number;
  reorder_point_qty?: number;
  reorder_qty?: number;
  unit_cost_cents?: number;
  quantity: number;
  reserved: number;
  reorder_threshold: number;
  reorder_quantity?: number;
  purchase_cost?: number;
  selling_price?: number;
}

interface Release2VendorBillRow {
  id: string;
  po_id: string | null;
  vendor_name: string;
  invoice_number: string;
  total_cents: number;
  due_date: string;
  items_json: unknown;
  match_status: string;
  match_variance_cents: number;
}

interface Release2LedgerEntryRow {
  id: string;
  entry_type: string;
  amount_cents: number;
  occurred_on: string;
}

interface McpThreeWayLineItem {
  sku: string;
  ordered_qty: number;
  unit_cost_cents: number;
}

interface McpReceiptLineItem {
  sku: string;
  received_qty: number;
  damaged_qty: number;
}

interface McpBillLineItem {
  sku: string;
  quantity: number;
  unit_cost_cents: number;
}

interface McpThreeWayException {
  code:
    | "short_shipment"
    | "over_shipment_billed"
    | "unit_price_hike"
    | "damaged_goods"
    | "duplicate_invoice"
    | "unexpected_sku";
  sku: string;
  ordered_qty: number;
  received_good_qty: number;
  damaged_qty: number;
  billed_qty: number;
  po_unit_cost_cents: number;
  billed_unit_cost_cents: number;
  variance_cents: number;
  detail: string;
}

function formatCentsUsd(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  return `${sign}$${(Math.abs(safe) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function computeMcpThreeWayMatch(params: {
  poItems: readonly McpThreeWayLineItem[];
  receiptItems: readonly McpReceiptLineItem[];
  billItems: readonly McpBillLineItem[];
  toleranceBps: number;
  poNumber: string;
  vendorName: string;
  invoiceNumber: string;
  isDuplicateInvoice: boolean;
}): Record<string, unknown> {
  const poBySku = new Map<string, { ordered_qty: number; unit_cost_cents: number }>();
  for (const row of params.poItems) {
    const sku = row.sku.trim().toUpperCase();
    if (!sku) continue;
    const prev = poBySku.get(sku);
    poBySku.set(sku, {
      ordered_qty: (prev?.ordered_qty ?? 0) + row.ordered_qty,
      unit_cost_cents: row.unit_cost_cents,
    });
  }

  const receiptBySku = new Map<string, { received_qty: number; damaged_qty: number }>();
  for (const row of params.receiptItems) {
    const sku = row.sku.trim().toUpperCase();
    if (!sku) continue;
    const prev = receiptBySku.get(sku);
    receiptBySku.set(sku, {
      received_qty: (prev?.received_qty ?? 0) + row.received_qty,
      damaged_qty: (prev?.damaged_qty ?? 0) + row.damaged_qty,
    });
  }

  const billBySku = new Map<string, { quantity: number; unit_cost_cents: number }>();
  for (const row of params.billItems) {
    const sku = row.sku.trim().toUpperCase();
    if (!sku) continue;
    const prev = billBySku.get(sku);
    billBySku.set(sku, {
      quantity: (prev?.quantity ?? 0) + row.quantity,
      unit_cost_cents: row.unit_cost_cents,
    });
  }

  const allSkus = Array.from(
    new Set([...poBySku.keys(), ...receiptBySku.keys(), ...billBySku.keys()])
  ).sort();

  const exceptions: McpThreeWayException[] = [];
  let poTotalCents = 0;
  let receivedPayableCents = 0;
  let billedTotalCents = 0;

  for (const sku of allSkus) {
    const po = poBySku.get(sku);
    const rec = receiptBySku.get(sku);
    const bill = billBySku.get(sku);

    const orderedQty = po?.ordered_qty ?? 0;
    const poUnitCost = po?.unit_cost_cents ?? 0;
    const recQty = rec?.received_qty ?? 0;
    const dmgQty = rec?.damaged_qty ?? 0;
    const goodRecQty = Math.max(0, recQty - dmgQty);
    const billedQty = bill?.quantity ?? 0;
    const billUnitCost = bill?.unit_cost_cents ?? 0;

    poTotalCents += orderedQty * poUnitCost;
    receivedPayableCents += goodRecQty * poUnitCost;
    billedTotalCents += billedQty * billUnitCost;

    if (!po && billedQty > 0) {
      exceptions.push({
        code: "unexpected_sku",
        sku,
        ordered_qty: 0,
        received_good_qty: goodRecQty,
        damaged_qty: dmgQty,
        billed_qty: billedQty,
        po_unit_cost_cents: 0,
        billed_unit_cost_cents: billUnitCost,
        variance_cents: billedQty * billUnitCost,
        detail: `${sku}: billed ${billedQty} unit(s) not present on Purchase Order.`,
      });
      continue;
    }

    if (dmgQty > 0) {
      exceptions.push({
        code: "damaged_goods",
        sku,
        ordered_qty: orderedQty,
        received_good_qty: goodRecQty,
        damaged_qty: dmgQty,
        billed_qty: billedQty,
        po_unit_cost_cents: poUnitCost,
        billed_unit_cost_cents: billUnitCost,
        variance_cents: dmgQty * poUnitCost,
        detail: `${sku}: ${dmgQty} unit(s) damaged on receipt.`,
      });
    }

    if (billedQty > goodRecQty) {
      const shortage = billedQty - goodRecQty;
      exceptions.push({
        code: billedQty > orderedQty ? "over_shipment_billed" : "short_shipment",
        sku,
        ordered_qty: orderedQty,
        received_good_qty: goodRecQty,
        damaged_qty: dmgQty,
        billed_qty: billedQty,
        po_unit_cost_cents: poUnitCost,
        billed_unit_cost_cents: billUnitCost,
        variance_cents: shortage * poUnitCost,
        detail: `${sku}: billed ${billedQty} vs ${goodRecQty} usable received (${shortage} unit shortage = ${formatCentsUsd(shortage * poUnitCost)}).`,
      });
    }

    if (poUnitCost > 0 && billedQty > 0) {
      const diff = Math.abs(billUnitCost - poUnitCost);
      if (diff * 10000 > poUnitCost * params.toleranceBps) {
        const impact = (billUnitCost - poUnitCost) * billedQty;
        exceptions.push({
          code: "unit_price_hike",
          sku,
          ordered_qty: orderedQty,
          received_good_qty: goodRecQty,
          damaged_qty: dmgQty,
          billed_qty: billedQty,
          po_unit_cost_cents: poUnitCost,
          billed_unit_cost_cents: billUnitCost,
          variance_cents: impact,
          detail: `${sku}: unit price billed ${formatCentsUsd(billUnitCost)} vs PO ${formatCentsUsd(poUnitCost)} (impact ${formatCentsUsd(impact)}).`,
        });
      }
    }
  }

  const matchVarianceCents = billedTotalCents - receivedPayableCents;
  if (params.isDuplicateInvoice) {
    exceptions.unshift({
      code: "duplicate_invoice",
      sku: allSkus[0] ?? "ALL",
      ordered_qty: 0,
      received_good_qty: 0,
      damaged_qty: 0,
      billed_qty: 0,
      po_unit_cost_cents: 0,
      billed_unit_cost_cents: 0,
      variance_cents: billedTotalCents,
      detail: `Duplicate vendor invoice #${params.invoiceNumber} detected.`,
    });
  }

  const absBps =
    receivedPayableCents > 0
      ? Math.round((Math.abs(matchVarianceCents) * 10000) / receivedPayableCents)
      : Math.abs(matchVarianceCents) > 0
        ? 10000
        : 0;

  const hasException = exceptions.length > 0 || absBps > params.toleranceBps;
  const matchStatus = hasException ? "exception_flagged" : "matched_clean";
  const discrepancySummary = hasException
    ? `Variance ${formatCentsUsd(matchVarianceCents)} (Billed ${formatCentsUsd(billedTotalCents)} vs GRN Payable ${formatCentsUsd(receivedPayableCents)}) | ${exceptions.map((e) => e.detail).join(" | ")}`
    : null;

  const vendorDisputeDraft = hasException
    ? {
        requires_approval: true,
        vendor_name: params.vendorName,
        invoice_number: params.invoiceNumber,
        po_number: params.poNumber,
        subject: `HOLD / Credit Memo Request: ${params.invoiceNumber} vs ${params.poNumber} (${formatCentsUsd(Math.abs(matchVarianceCents))} variance)`,
        body_markdown: `3-Way Match Variance Held (${formatCentsUsd(matchVarianceCents)}):\n${exceptions.map((e) => `- ${e.code.toUpperCase()} (${e.sku}): ${e.detail}`).join("\n")}`,
        disputed_amount_cents: Math.abs(matchVarianceCents),
      }
    : null;

  return {
    match_status: matchStatus,
    tolerance_bps: params.toleranceBps,
    po_total_cents: poTotalCents,
    received_payable_cents: receivedPayableCents,
    billed_total_cents: billedTotalCents,
    match_variance_cents: matchVarianceCents,
    exceptions,
    discrepancy_summary: discrepancySummary,
    vendor_dispute_draft: vendorDisputeDraft,
  };
}

interface OverviewCounts {
  public_leads: number;
  pending_communication_drafts: number;
  opportunities: number;
  ops_jobs: number;
  active_inventory_skus: number;
  pending_staged_ops_actions: number;
  pending_staged_ledger_entries: number;
  ops_readiness_audits: number;
}

interface OverviewLatestTimestamps {
  public_leads: string | null;
  ops_communication_drafts: string | null;
  opportunities: string | null;
  ops_jobs: string | null;
  inventory_items: string | null;
  staged_ops_actions: string | null;
  staged_ledger_entries: string | null;
  ops_readiness_audits: string | null;
}

interface McpToolDefinition {
  name: string;
  description: string;
  requiredScope: RequiredScope;
  inputSchema: Record<string, unknown>;
}

function jsonRpcResponse(
  id: string | number | null,
  result: unknown,
  status = 200
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  status = 400
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

async function sha256Hex(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalizeValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function normalizeLimit(raw: unknown, fallback = 25): number {
  const numeric = typeof raw === "number" ? raw : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.trunc(numeric)));
}

const OPS_READINESS_GRADING_RUBRIC: OpsReadinessRubric = {
  total_points: 100,
  grade_bands: {
    A: "85-100",
    B: "70-84",
    C: "50-69",
    D: "0-49",
  },
  categories: [
    {
      id: "lead_capture_and_booking_friction",
      name: "Lead Capture & Booking Friction",
      max_points: 25,
      criteria: [
        "Clear primary service CTA above the fold (10 pts)",
        "Online quote or booking request flow (10 pts)",
        "Accurate mobile tap-to-call / click-to-email links with zero broken or wrong numbers (5 pts)",
      ],
    },
    {
      id: "owner_contact_and_trust_clarity",
      name: "Owner Contact & Trust Clarity",
      max_points: 25,
      criteria: [
        "Verified owner/office email (owner@, office@, service@, billing@, info@) on matching domain (10 pts)",
        "Visible service area, operating hours, and licensing/insurance proof (10 pts)",
        "Consistent Name/Address/Phone across pages (5 pts)",
      ],
    },
    {
      id: "quote_to_cash_workflow_readiness",
      name: "Quote-to-Cash & Workflow Readiness",
      max_points: 20,
      criteria: [
        "Clear service scope, pricing ranges, or estimate request expectations (10 pts)",
        "Scheduling/dispatch, invoice/payment portal, or repeat maintenance plan evidence (10 pts)",
      ],
    },
    {
      id: "digital_hygiene_mobile_ux_speed",
      name: "Digital Hygiene, Mobile UX & Speed",
      max_points: 15,
      criteria: [
        "Valid HTTPS and responsive mobile layout without broken/clipped UI (8 pts)",
        "Live pages with no dead links, broken forms, or placeholder copy (7 pts)",
      ],
    },
    {
      id: "follow_up_reviews_retention",
      name: "Follow-Up, Reviews & Retention Signals",
      max_points: 15,
      criteria: [
        "Visible customer reviews, ratings, or testimonials (8 pts)",
        "Follow-up, seasonal reminder, or referral/loyalty capture (7 pts)",
      ],
    },
  ],
};

const OPS_READINESS_GRADING_RUBRIC_MARKDOWN = [
  "## Standard 100-Point A–D Operations Readiness Grading Rubric",
  "- Lead Capture & Booking Friction (25 pts): Clear primary service CTA above the fold (10); online quote/booking request flow (10); accurate mobile tap-to-call / click-to-email links with zero broken or wrong numbers (5).",
  "- Owner Contact & Trust Clarity (25 pts): Verified owner/office email (`owner@`, `office@`, `service@`, `billing@`, `info@`) on matching domain (10); visible service area, operating hours, and licensing/insurance proof (10); consistent Name/Address/Phone across pages (5).",
  "- Quote-to-Cash & Workflow Readiness (20 pts): Clear service scope, pricing ranges, or estimate request expectations (10); scheduling/dispatch, invoice/payment portal, or repeat maintenance plan evidence (10).",
  "- Digital Hygiene, Mobile UX & Speed (15 pts): Valid HTTPS and responsive mobile layout without broken/clipped UI (8); live pages with no dead links, broken forms, or placeholder copy (7).",
  "- Follow-Up, Reviews & Retention Signals (15 pts): Visible customer reviews, ratings, or testimonials (8); follow-up, seasonal reminder, or referral/loyalty capture (7).",
  "- Grade Bands: A = 85–100 | B = 70–84 | C = 50–69 | D = 0–49. Sum integer category scores into `score_0_100` (0–100) and pass 3–5 concrete evidence-backed `findings` to `save_ops_readiness_audit`.",
].join("\n");

const DEFAULT_BOT_ROLE_SUMMARIES: Readonly<
  Record<BotRole, { title: string; summary: string }>
> = {
  chief_of_staff: {
    title: "Chief of Staff Bot SOP",
    summary:
      "Compare workspace state_hash for silent unchanged runs and surface cross-workspace bottlenecks as staged actions.",
  },
  scout: {
    title: "SMB Prospect Scout & Ops Readiness Grader SOP",
    summary:
      "Verify real owner/office emails, grade SMBs on the 100-point A-D Operations Readiness Rubric, and stage outreach.",
  },
  dispatcher: {
    title: "Zero-Keyboard Dispatch & SMS/Voicemail Command SOP",
    summary:
      "Convert field transcripts into staged dispatch updates and block invoicing on incomplete checklists.",
  },
  buyer: {
    title: "Photo-to-Inventory & Purchasing Buyer SOP",
    summary:
      "Parse shelf photos/packing slips and stage purchase_order_draft proposals for low-stock SKUs.",
  },
  billing: {
    title: "Vendor Bill Auditor & Invoice Parser SOP",
    summary:
      "Recompute line-item subtotals + tax in integer cents and flag duplicate charges, surcharges, or price hikes.",
  },
  cash_applications: {
    title: "Cash Applications & Receipt Match SOP",
    summary:
      "Match incoming vendor bills, POs, and remittance advice deterministically in integer cents.",
  },
  collections: {
    title: "Open-Loop Inbox Recovery & Collections SOP",
    summary:
      "Detect unanswered estimates and overdue invoices (>7 days) and verify channel consent before follow-up.",
  },
  outreach: {
    title: "Founder-to-Founder SMB Outreach SOP",
    summary:
      "Write concise plain-English outreach referencing the live demo sandbox after fail-closed consent checks.",
  },
  qa: {
    title: "Operations QA & Compliance Guard Bot SOP",
    summary:
      "Audit staged drafts, consent evidence, and integer cent math; block any opted-out or revoked recipient.",
  },
};

const DEFAULT_SCOUT_MANUAL_MARKDOWN = [
  "# SMB Prospect Scout & Ops Readiness Grader SOP",
  "- Prioritize Ohio Valley / Appalachian regional SMBs (WV, OH, PA) alongside growth metros.",
  "- Crawl business websites to verify real owner/operations emails (`owner@`, `office@`, `billing@`, `service@`, `info@`) and generate a 0-100 (`A`-`D`) Operations Readiness Scorecard via `save_ops_readiness_audit`.",
  "- Reject non-buyer prefixes (`resumes@`, `careers@`, `jobs@`, `hr@`) and agency footer domains.",
  "",
  OPS_READINESS_GRADING_RUBRIC_MARKDOWN,
].join("\n");

function summarizeManualMarkdown(
  markdown: string,
  fallbackRole: BotRole
): { title: string; summary: string } {
  const defaults = DEFAULT_BOT_ROLE_SUMMARIES[fallbackRole];
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let title = defaults.title;
  let summary = "";

  for (const line of lines) {
    if (line.startsWith("#")) {
      const candidateTitle = line.replace(/^#+\s*/, "").trim();
      if (candidateTitle && title === defaults.title) {
        title = candidateTitle;
      }
      continue;
    }
    const cleanLine = line.replace(/^[-*]\s+/, "").trim();
    if (cleanLine) {
      summary = cleanLine;
      break;
    }
  }

  if (!summary) {
    summary = defaults.summary;
  } else if (summary.length > 140) {
    summary = `${summary.slice(0, 137).trimEnd()}...`;
  }

  return { title, summary };
}

function enrichScoutManual(
  manual: BotManualRow | null,
  workspaceId: string
): BotManualRow {
  if (!manual) {
    return {
      workspace_id: workspaceId,
      bot_role: "scout",
      mode: "propose",
      instructions_markdown: DEFAULT_SCOUT_MANUAL_MARKDOWN,
    };
  }
  const hasRubric = manual.instructions_markdown.includes(
    "Operations Readiness Grading Rubric"
  );
  return hasRubric
    ? manual
    : {
        ...manual,
        instructions_markdown: `${manual.instructions_markdown.trimEnd()}\n\n${OPS_READINESS_GRADING_RUBRIC_MARKDOWN}`,
      };
}

const TOOL_CATALOG: readonly McpToolDefinition[] = [
  {
    name: "get_workspace_overview",
    requiredScope: "read_all",
    description:
      "Workspace-scoped overview across all 5 Loose Ends domains with a deterministic 64-char SHA-256 state_hash; returns SILENT_OK when unchanged from the prior completed run unless force_full=true.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        force_full: { type: "boolean" },
      },
    },
  },
  {
    name: "list_public_leads",
    requiredScope: "read_all",
    description:
      "List SMB prospects in public.public_leads strictly for the authenticated workspace with optional status, minimum qualification score, and limit filters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: [
            "DRAFT_READY",
            "DRAFT_GENERATED",
            "OWNER_APPROVED",
            "CONTACTED",
            "DEMO_SCHEDULED",
            "PILOT_SOLD",
            "LOST",
          ],
        },
        min_score: { type: "integer", minimum: 0, maximum: 100 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "list_pipeline_and_quotes",
    requiredScope: "read_all",
    description:
      "List open pipeline opportunities and quote/invoice documents for the authenticated workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "list_jobs_and_inventory",
    requiredScope: "read_all",
    description:
      "List field service jobs (ops_jobs), purchase orders (ops_purchase_orders), and SKU inventory items (inventory_items) for the authenticated workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        low_stock_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "list_ops_readiness_audits",
    requiredScope: "read_all",
    description:
      "List A-D Operations Readiness Scorecards saved in public.ops_readiness_audits for the authenticated workspace with optional grade and limit filters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        grade: { type: "string", enum: [...ALLOWED_GRADES] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "ops_readiness_audits",
    requiredScope: "read_all",
    description:
      "Workspace-scoped Operations Readiness Audit summary and lookup returning total_audits, average_score, A-D grade_breakdown, and matching audit records.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        grade: { type: "string", enum: [...ALLOWED_GRADES] },
        lead_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "get_customer_consent_status",
    requiredScope: "read_all",
    description:
      "Fail-closed TCPA/CAN-SPAM channel consent and opt-out check scoped strictly to the authenticated workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        email: { type: "string" },
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "get_bot_manual",
    requiredScope: "read_all",
    description:
      "Read-only access to the authenticated workspace's versioned SOP manual and autonomy mode. Omit role/bot_role to receive a concise index of all available roles; pass role=\"scout\" for the embedded 100-point A-D Operations Readiness grading rubric.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        role: {
          type: "string",
          enum: [...ALLOWED_BOT_ROLES],
          description:
            "Optional bot role name. If omitted, returns a concise index of available roles.",
        },
        bot_role: {
          type: "string",
          enum: [...ALLOWED_BOT_ROLES],
          description: "Optional alias for role.",
        },
      },
    },
  },
  {
    name: "upsert_public_lead",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Workspace-scoped upsert of an enriched SMB prospect into public.public_leads on (workspace_id, business) at status DRAFT_READY.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["business", "industry", "location", "website"],
      properties: {
        business: { type: "string" },
        contact_name: { type: "string" },
        contact_email: { type: "string" },
        phone: { type: "string" },
        industry: { type: "string" },
        location: { type: "string" },
        website: { type: "string" },
        notes: { type: "string" },
        score: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
  },
  {
    name: "save_ops_readiness_audit",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Validate and save a 0-100 (A-D) Operations Readiness Scorecard into public.ops_readiness_audits and stage a scorecard card in public.staged_ops_actions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["business_name", "score_0_100", "grade", "findings"],
      properties: {
        lead_id: { type: "string" },
        business_name: { type: "string" },
        website_url: { type: "string" },
        score_0_100: { type: "integer", minimum: 0, maximum: 100 },
        grade: { type: "string", enum: [...ALLOWED_GRADES] },
        findings: {
          type: "array",
          items: { type: "string" },
        },
        report_html: { type: "string" },
      },
    },
  },
  {
    name: "queue_communication_draft",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Fail-closed consent verification in customer_contact_consent_events followed by owner-gated draft upsert in ops_communication_drafts. When lead_id is provided, verifies it belongs to the authenticated workspace and updates an existing unsent draft row in place.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["company_name", "recipient_email", "subject", "message"],
      properties: {
        company_name: { type: "string" },
        recipient_name: { type: "string" },
        recipient_email: { type: "string" },
        subject: { type: "string" },
        message: { type: "string" },
        lead_id: {
          type: "string",
          description:
            "Optional public_leads.id UUID in the authenticated workspace to link and upsert cleanly.",
        },
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "dismiss_communication_draft",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Archive/dismiss an unsent communication draft in public.ops_communication_drafts (sets status='rejected') so it leaves the active approval queue while preserving full audit history.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["draft_id"],
      properties: {
        draft_id: {
          type: "string",
          description:
            "UUID of the ops_communication_drafts row in the authenticated workspace.",
        },
        reason: {
          type: "string",
          description: "Optional short audit reason for dismissing the draft.",
        },
      },
    },
  },
  {
    name: "create_quote_draft",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Create an itemized integer-cent quote and quote_items in public.quotes linked optionally to lead_id, returning a unique shareable /portal/[token] path.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "customer_name", "items"],
      properties: {
        title: { type: "string" },
        customer_name: { type: "string" },
        customer_email: { type: "string" },
        lead_id: { type: "string" },
        customer_id: { type: "string" },
        tax_bps: { type: "integer", minimum: 0, maximum: 5000 },
        valid_until: { type: "string" },
        notes: { type: "string" },
        status: { type: "string", enum: ["draft", "sent"] },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["description", "quantity", "unit_price_cents"],
            properties: {
              description: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
              unit_price_cents: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
  },
  {
    name: "list_ar_summary",
    requiredScope: "read_all",
    description:
      "Read-only summary of open and overdue accounts receivable (invoices) in integer cents for the authenticated workspace, capped strictly at limit <= 10 invoices.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: [...ALLOWED_INVOICE_STATUSES] },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: "get_autonomy_rules",
    requiredScope: "read_all",
    description:
      "Read-only lookup of workspace_settings module toggles, Autonomy Dial modes (manual, approve_1tap, full_auto), and auto_limit_cents for the authenticated workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "log_agent_action",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Record an autonomous bot action with integer-cent impact and before/after state snapshots in public.agent_action_ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["agent_name", "module", "action_type", "autonomy_mode", "summary", "impact_cents"],
      properties: {
        agent_name: { type: "string" },
        module: { type: "string" },
        action_type: { type: "string" },
        autonomy_mode: { type: "string", enum: [...ALLOWED_AUTONOMY_MODES] },
        summary: { type: "string" },
        impact_cents: { type: "integer" },
        before_state: { type: "object" },
        after_state: { type: "object" },
        status: { type: "string", enum: [...ALLOWED_LEDGER_STATUSES] },
      },
    },
  },
  {
    name: "stage_ops_action",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Stage an integer-cent operation across the 5 workspace domains in public.staged_ops_actions at status='pending_approval'.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "bot_role",
        "workspace_domain",
        "action_type",
        "title",
        "summary",
        "amount_cents",
      ],
      properties: {
        bot_role: {
          type: "string",
          enum: [...ALLOWED_BOT_ROLES],
        },
        workspace_domain: {
          type: "string",
          enum: [...ALLOWED_DOMAINS],
        },
        action_type: {
          type: "string",
          enum: [...ALLOWED_ACTION_TYPES],
        },
        title: { type: "string" },
        summary: { type: "string" },
        amount_cents: { type: "integer", minimum: 0 },
        confidence_score: { type: "number", minimum: 0, maximum: 1 },
        customer_id: { type: "string" },
        payload: { type: "object" },
      },
    },
  },
  {
    name: "check_low_stock_skus",
    requiredScope: "read_all",
    description:
      "Read-only scan of workspace inventory_items where available_qty (on_hand_qty - reserved_qty) <= reorder_point_qty, capped strictly at limit <= 10.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: "stage_purchase_order",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Create an integer-cent draft/pending_approval Purchase Order with itemized SKUs in public.purchase_orders + purchase_order_items and log to agent_action_ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["vendor_name", "items"],
      properties: {
        vendor_name: { type: "string" },
        po_number: { type: "string" },
        expected_date: { type: "string" },
        status: { type: "string", enum: ["draft", "pending_approval"] },
        notes: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sku", "ordered_qty", "unit_cost_cents"],
            properties: {
              inventory_item_id: { type: "string" },
              sku: { type: "string" },
              description: { type: "string" },
              ordered_qty: { type: "integer", minimum: 1 },
              unit_cost_cents: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
  },
  {
    name: "run_three_way_match",
    requiredScope: "stage_actions",
    description:
      "Run deterministic integer-cent 3-Way Match (PO === Goods Receipt === Supplier Bill) on workspace records or inline line items, flagging short-shipments, price hikes, and duplicates.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        po_id: { type: "string" },
        vendor_bill_id: { type: "string" },
        po_number: { type: "string" },
        vendor_name: { type: "string" },
        invoice_number: { type: "string" },
        tolerance_bps: { type: "integer", minimum: 0, maximum: 5000 },
        po_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sku", "ordered_qty", "unit_cost_cents"],
            properties: {
              sku: { type: "string" },
              ordered_qty: { type: "integer", minimum: 1 },
              unit_cost_cents: { type: "integer", minimum: 0 },
            },
          },
        },
        receipt_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sku", "received_qty"],
            properties: {
              sku: { type: "string" },
              received_qty: { type: "integer", minimum: 0 },
              damaged_qty: { type: "integer", minimum: 0 },
            },
          },
        },
        bill_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sku", "quantity", "unit_cost_cents"],
            properties: {
              sku: { type: "string" },
              quantity: { type: "integer", minimum: 0 },
              unit_cost_cents: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
  },
  {
    name: "get_cashflow_summary",
    requiredScope: "read_all",
    description:
      "Read-only deterministic 30/60/90-day cashflow forecast combining workspace ledger_entries, open AR invoices, and scheduled vs disputed vendor_bills.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        starting_balance_cents: { type: "integer" },
        safety_buffer_cents: { type: "integer", minimum: 0 },
        as_of_date: { type: "string" },
      },
    },
  },
  {
    name: "list_expiring_compliance",
    requiredScope: "read_all",
    description:
      "Read-only list of workspace compliance_vault_items entering or past their notice_window_days deadline, capped strictly at limit <= 10.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        reference_date: { type: "string" },
        include_all_active: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: "stage_compliance_notice",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Mark a workspace compliance_vault_item notice_staged, enforce fail-closed consent + CAN-SPAM draft staging when counterparty contact is supplied, and log to agent_action_ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["vault_item_id"],
      properties: {
        vault_item_id: { type: "string" },
        notice_kind: { type: "string", enum: ["renewal", "cancellation"] },
        recipient_email: { type: "string" },
        recipient_name: { type: "string" },
        customer_id: { type: "string" },
        custom_note: { type: "string" },
      },
    },
  },
  {
    name: "upsert_living_sop",
    requiredScope: "stage_actions",
    description:
      "Write-narrow (staged): Create or auto-increment version of a Living Operational SOP playbook in public.living_sops for the authenticated workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["module_key", "title", "trigger_event", "steps"],
      properties: {
        module_key: { type: "string" },
        title: { type: "string" },
        trigger_event: { type: "string" },
        steps: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
        },
        auto_generated: { type: "boolean" },
      },
    },
  },
];

const PUBLIC_MCP_TOOLS = TOOL_CATALOG.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

const TOOL_BY_NAME: Record<string, McpToolDefinition> = Object.fromEntries(
  TOOL_CATALOG.map((tool) => [tool.name, tool])
);

async function checkCustomerConsentFailClosed(
  admin: SupabaseClient,
  workspaceId: string,
  rawEmail: string,
  rawCustomerId: string
): Promise<ConsentCheckResult> {
  const email = rawEmail.trim().toLowerCase();
  const customerId = rawCustomerId.trim();

  if (!email && !customerId) {
    return {
      suppressed: true,
      reason: "consent_verification_unavailable",
      consent_events: [],
    };
  }

  try {
    const events: ConsentEventRow[] = [];
    const checkedCustomerIds: string[] = [];

    if (customerId) {
      checkedCustomerIds.push(customerId);
    }

    if (email) {
      const { data: byEmail, error: byEmailErr } = await admin
        .from("customer_contact_consent_events")
        .select("id, workspace_id, customer_id, email, channel, status, decision, created_at")
        .eq("workspace_id", workspaceId)
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(10);

      if (byEmailErr) {
        return {
          suppressed: true,
          reason: "consent_verification_unavailable",
          consent_events: [],
        };
      }
      if (Array.isArray(byEmail)) {
        events.push(...(byEmail as ConsentEventRow[]));
      }

      const { data: matchingCustomers, error: custLookupErr } = await admin
        .from("customers")
        .select("id")
        .eq("workspace_id", workspaceId)
        .ilike("email", email)
        .limit(10);

      if (custLookupErr) {
        return {
          suppressed: true,
          reason: "consent_verification_unavailable",
          consent_events: [],
        };
      }
      for (const row of (matchingCustomers ?? []) as CustomerIdRow[]) {
        if (row.id && !checkedCustomerIds.includes(row.id)) {
          checkedCustomerIds.push(row.id);
        }
      }
    }

    if (checkedCustomerIds.length > 0) {
      const { data: byCust, error: byCustErr } = await admin
        .from("customer_contact_consent_events")
        .select("id, workspace_id, customer_id, email, channel, status, decision, created_at")
        .eq("workspace_id", workspaceId)
        .in("customer_id", checkedCustomerIds)
        .order("created_at", { ascending: false })
        .limit(20);

      if (byCustErr) {
        return {
          suppressed: true,
          reason: "consent_verification_unavailable",
          consent_events: [],
        };
      }
      if (Array.isArray(byCust)) {
        events.push(...(byCust as ConsentEventRow[]));
      }
    }

    const isRevoked = events.some(
      (evt) =>
        evt.status === "opted_out" ||
        evt.status === "revoked" ||
        evt.decision === "revoked"
    );

    return {
      suppressed: isRevoked,
      reason: isRevoked ? "consent_revoked_or_opted_out" : "clear",
      consent_events: events,
    };
  } catch {
    return {
      suppressed: true,
      reason: "consent_verification_unavailable",
      consent_events: [],
    };
  }
}

async function fetchLatestTimestamp(
  admin: SupabaseClient,
  table: string,
  workspaceId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from(table)
    .select("created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read latest timestamp for ${table}`);
  }
  const row = data as { created_at?: string | null } | null;
  return typeof row?.created_at === "string" ? row.created_at : null;
}

function buildSanitizedAuditOutput(
  toolName: string,
  toolResult: Record<string, unknown>,
  stateHash: string | null
): Record<string, unknown> {
  if (toolName === "get_workspace_overview") {
    return {
      status: toolResult.status ?? "OK",
      unchanged: toolResult.unchanged === true,
      state_hash: stateHash,
      counts: toolResult.counts ?? null,
    };
  }
  if (toolName === "get_customer_consent_status") {
    return {
      suppressed: Boolean(toolResult.suppressed),
      reason: toolResult.reason ?? "unknown",
      event_count: Array.isArray(toolResult.consent_events)
        ? toolResult.consent_events.length
        : 0,
    };
  }
  if (toolName === "list_public_leads") {
    return {
      lead_count: Array.isArray(toolResult.leads) ? toolResult.leads.length : 0,
    };
  }
  if (toolName === "list_pipeline_and_quotes") {
    return {
      opportunity_count: Array.isArray(toolResult.opportunities)
        ? toolResult.opportunities.length
        : 0,
      document_count: Array.isArray(toolResult.documents)
        ? toolResult.documents.length
        : 0,
    };
  }
  if (toolName === "list_jobs_and_inventory") {
    return {
      job_count: Array.isArray(toolResult.jobs) ? toolResult.jobs.length : 0,
      inventory_count: Array.isArray(toolResult.inventory_items)
        ? toolResult.inventory_items.length
        : 0,
      po_count: Array.isArray(toolResult.purchase_orders)
        ? toolResult.purchase_orders.length
        : 0,
    };
  }
  if (toolName === "list_ops_readiness_audits" || toolName === "ops_readiness_audits") {
    return {
      audit_count: Array.isArray(toolResult.audits) ? toolResult.audits.length : 0,
      average_score: toolResult.average_score ?? null,
    };
  }
  if (toolName === "save_ops_readiness_audit") {
    const audit = toolResult.audit as { id?: string; grade?: string; score_0_100?: number } | null;
    const staged = toolResult.staged_action as { id?: string } | null;
    return {
      audit_id: audit?.id ?? null,
      grade: audit?.grade ?? null,
      score_0_100: audit?.score_0_100 ?? null,
      staged_action_id: staged?.id ?? null,
    };
  }
  if (toolName === "get_bot_manual") {
    const manual = toolResult.manual as { bot_role?: string } | null;
    return {
      role: manual?.bot_role ?? null,
      returned_index: Array.isArray(toolResult.available_roles),
      available_role_count: Array.isArray(toolResult.available_roles)
        ? toolResult.available_roles.length
        : null,
    };
  }
  if (toolName === "queue_communication_draft") {
    const draft = toolResult.draft as {
      id?: string;
      lead_id?: string | null;
      status?: string;
      delivery_status?: string;
    } | null;
    return {
      draft_id: draft?.id ?? null,
      lead_id: toolResult.lead_id ?? draft?.lead_id ?? null,
      action: toolResult.action ?? "created_draft",
      status: draft?.status ?? "draft",
      delivery_status: draft?.delivery_status ?? "not_sent",
    };
  }
  if (toolName === "dismiss_communication_draft") {
    const draft = toolResult.draft as { id?: string; status?: string } | null;
    return {
      draft_id: draft?.id ?? null,
      status: draft?.status ?? "rejected",
      already_dismissed: Boolean(toolResult.already_dismissed),
      reason: toolResult.reason ?? null,
    };
  }
  if (toolName === "create_quote_draft") {
    const quote = toolResult.quote as { id?: string; quote_number?: string; total_cents?: number } | null;
    return {
      quote_id: quote?.id ?? null,
      quote_number: quote?.quote_number ?? null,
      total_cents: quote?.total_cents ?? null,
      portal_path: toolResult.portal_path ?? null,
    };
  }
  if (toolName === "list_ar_summary") {
    return {
      total_billed_cents: toolResult.total_billed_cents ?? 0,
      open_ar_cents: toolResult.open_ar_cents ?? 0,
      overdue_ar_cents: toolResult.overdue_ar_cents ?? 0,
      invoice_count: Array.isArray(toolResult.invoices) ? toolResult.invoices.length : 0,
    };
  }
  if (toolName === "get_autonomy_rules") {
    return {
      auto_limit_cents: toolResult.auto_limit_cents ?? DEFAULT_AUTO_LIMIT_CENTS,
      rules: toolResult.autonomy_rules ?? null,
    };
  }
  if (toolName === "log_agent_action") {
    const entry = toolResult.ledger_entry as { id?: string; status?: string; impact_cents?: number } | null;
    return {
      ledger_entry_id: entry?.id ?? null,
      status: entry?.status ?? "executed",
      impact_cents: entry?.impact_cents ?? 0,
    };
  }
  if (toolName === "stage_ops_action") {
    const staged = toolResult.staged_action as {
      id?: string;
      action_type?: string;
      amount_cents?: number;
      status?: string;
    } | null;
    return {
      staged_action_id: staged?.id ?? null,
      action_type: staged?.action_type ?? null,
      amount_cents: staged?.amount_cents ?? null,
      status: staged?.status ?? "pending_approval",
    };
  }
  if (toolName === "upsert_public_lead") {
    const lead = toolResult.lead as { id?: string; status?: string } | null;
    return {
      lead_id: lead?.id ?? null,
      status: lead?.status ?? "DRAFT_READY",
    };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonRpcError(null, -32603, "Supabase service environment unavailable", 503);
  }

  const rawBearer =
    req.headers.get("x-mcp-token") ??
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const token = rawBearer.trim();
  if (!token) {
    return jsonRpcError(null, -32001, "Missing Workspace MCP Bearer token", 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tokenHash = await sha256Hex(token);
  const { data: rawTokenRow, error: tokenErr } = await admin
    .from("workspace_mcp_tokens")
    .select("id, workspace_id, label, scopes, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  const tokenRow = rawTokenRow as WorkspaceMcpTokenRow | null;
  if (tokenErr || !tokenRow || !tokenRow.workspace_id) {
    return jsonRpcError(null, -32001, "Invalid or revoked Workspace MCP token", 401);
  }

  const workspaceId = tokenRow.workspace_id;
  const tokenId = tokenRow.id;
  const tokenScopes = Array.isArray(tokenRow.scopes) ? tokenRow.scopes : [];

  await admin
    .from("workspace_mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("workspace_id", workspaceId);

  const body = (await req.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  } | null;

  const rpcId = body?.id ?? null;
  const method = typeof body?.method === "string" ? body.method : "";

  if (method === "initialize") {
    return jsonRpcResponse(rpcId, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "loose-ends-mcp",
        version: "2.2.0",
        workspace_id: workspaceId,
      },
    });
  }

  if (method === "notifications/initialized" || method === "ping") {
    return jsonRpcResponse(rpcId, {});
  }

  if (method === "tools/list") {
    return jsonRpcResponse(rpcId, { tools: PUBLIC_MCP_TOOLS });
  }

  if (method !== "tools/call") {
    return jsonRpcError(rpcId, -32601, `Unsupported MCP method: ${method}`, 400);
  }

  const params = body?.params ?? {};
  const toolName = typeof params.name === "string" ? params.name.trim() : "";
  const args =
    params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

  const toolDef = Object.prototype.hasOwnProperty.call(TOOL_BY_NAME, toolName)
    ? TOOL_BY_NAME[toolName]
    : undefined;

  if (!toolDef) {
    return jsonRpcError(rpcId, -32601, `Unknown MCP tool: ${toolName}`, 400);
  }

  if (!tokenScopes.includes(toolDef.requiredScope)) {
    return jsonRpcError(
      rpcId,
      -32003,
      `Insufficient MCP token scope: "${toolDef.requiredScope}" is required for ${toolName}`,
      403
    );
  }

  try {
    let toolResult: Record<string, unknown> = {};
    let auditBotRole = "chief_of_staff";
    let computedStateHash: string | null = null;

    if (toolName === "get_workspace_overview") {
      const forceFull = args.force_full === true;

      const [
        leadsCountRes,
        draftsCountRes,
        oppsCountRes,
        jobsCountRes,
        skusCountRes,
        stagedOpsCountRes,
        stagedLedgerCountRes,
        auditsCountRes,
        latestLeadAt,
        latestDraftAt,
        latestOppAt,
        latestJobAt,
        latestSkuAt,
        latestStagedOpsAt,
        latestStagedLedgerAt,
        latestAuditAt,
        priorRunRes,
      ] = await Promise.all([
        admin
          .from("public_leads")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        admin
          .from("ops_communication_drafts")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("status", "draft")
          .eq("delivery_status", "not_sent"),
        admin
          .from("opportunities")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        admin
          .from("ops_jobs")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        admin
          .from("inventory_items")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("archived", false),
        admin
          .from("staged_ops_actions")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("status", "pending_approval"),
        admin
          .from("staged_ledger_entries")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("status", "pending_approval"),
        admin
          .from("ops_readiness_audits")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        fetchLatestTimestamp(admin, "public_leads", workspaceId),
        fetchLatestTimestamp(admin, "ops_communication_drafts", workspaceId),
        fetchLatestTimestamp(admin, "opportunities", workspaceId),
        fetchLatestTimestamp(admin, "ops_jobs", workspaceId),
        fetchLatestTimestamp(admin, "inventory_items", workspaceId),
        fetchLatestTimestamp(admin, "staged_ops_actions", workspaceId),
        fetchLatestTimestamp(admin, "staged_ledger_entries", workspaceId),
        fetchLatestTimestamp(admin, "ops_readiness_audits", workspaceId),
        admin
          .from("bot_runs")
          .select("state_hash")
          .eq("workspace_id", workspaceId)
          .eq("tool_name", "get_workspace_overview")
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const countErrors = [
        leadsCountRes.error,
        draftsCountRes.error,
        oppsCountRes.error,
        jobsCountRes.error,
        skusCountRes.error,
        stagedOpsCountRes.error,
        stagedLedgerCountRes.error,
        auditsCountRes.error,
        priorRunRes.error,
      ].filter(Boolean);

      if (countErrors.length > 0) {
        throw new Error("Failed to compute workspace overview metrics");
      }

      const countsPayload: OverviewCounts = {
        public_leads: leadsCountRes.count ?? 0,
        pending_communication_drafts: draftsCountRes.count ?? 0,
        opportunities: oppsCountRes.count ?? 0,
        ops_jobs: jobsCountRes.count ?? 0,
        active_inventory_skus: skusCountRes.count ?? 0,
        pending_staged_ops_actions: stagedOpsCountRes.count ?? 0,
        pending_staged_ledger_entries: stagedLedgerCountRes.count ?? 0,
        ops_readiness_audits: auditsCountRes.count ?? 0,
      };

      const latestTimestamps: OverviewLatestTimestamps = {
        public_leads: latestLeadAt,
        ops_communication_drafts: latestDraftAt,
        opportunities: latestOppAt,
        ops_jobs: latestJobAt,
        inventory_items: latestSkuAt,
        staged_ops_actions: latestStagedOpsAt,
        staged_ledger_entries: latestStagedLedgerAt,
        ops_readiness_audits: latestAuditAt,
      };

      computedStateHash = await sha256Hex(
        canonicalizeJson({
          workspace_id: workspaceId,
          counts: countsPayload,
          latest_timestamps: latestTimestamps,
        })
      );

      const previousHash =
        (priorRunRes.data as BotRunStateRow | null)?.state_hash ?? null;

      if (!forceFull && previousHash === computedStateHash) {
        toolResult = {
          status: "SILENT_OK",
          unchanged: true,
          workspace_id: workspaceId,
          state_hash: computedStateHash,
        };
      } else {
        toolResult = {
          status: "OK",
          unchanged: false,
          workspace_id: workspaceId,
          state_hash: computedStateHash,
          counts: countsPayload,
          latest_timestamps: latestTimestamps,
        };
      }
    } else if (toolName === "list_public_leads") {
      auditBotRole = "scout";
      const limit = normalizeLimit(args.limit, 25);
      let query = admin
        .from("public_leads")
        .select(
          "id, workspace_id, business, industry, location, contact_name, contact_email, phone, website, score, status, created_at"
        )
        .eq("workspace_id", workspaceId)
        .order("score", { ascending: false })
        .limit(limit);

      if (typeof args.status === "string" && args.status.trim()) {
        query = query.eq("status", args.status.trim());
      }
      if (typeof args.min_score === "number" && Number.isFinite(args.min_score)) {
        query = query.gte("score", Math.trunc(args.min_score));
      }

      const { data, error } = await query;
      if (error) {
        throw new Error("Failed to query workspace public leads");
      }
      toolResult = { leads: data ?? [] };
    } else if (toolName === "list_pipeline_and_quotes") {
      auditBotRole = "collections";
      const limit = normalizeLimit(args.limit, 25);
      const [oppsRes, docsRes] = await Promise.all([
        admin
          .from("opportunities")
          .select("id, customer_id, title, status, amount, due_at, created_at")
          .eq("workspace_id", workspaceId)
          .order("amount", { ascending: false })
          .limit(limit),
        admin
          .from("documents")
          .select(
            "id, customer_id, document_type, document_number, status, total, due_at, created_at"
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ]);
      if (oppsRes.error || docsRes.error) {
        throw new Error("Failed to query workspace pipeline and quotes");
      }
      toolResult = {
        opportunities: oppsRes.data ?? [],
        documents: docsRes.data ?? [],
      };
    } else if (toolName === "list_jobs_and_inventory") {
      auditBotRole = "dispatcher";
      const limit = normalizeLimit(args.limit, 25);
      const [jobsRes, itemsRes, posRes] = await Promise.all([
        admin
          .from("ops_jobs")
          .select(
            "id, customer_id, title, status, priority, labor_total, checklist, invoice_id, created_at"
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(limit),
        admin
          .from("inventory_items")
          .select(
            "id, name, sku, quantity, reserved, reorder_threshold, reorder_quantity, purchase_cost, selling_price"
          )
          .eq("workspace_id", workspaceId)
          .eq("archived", false)
          .limit(limit),
        admin
          .from("ops_purchase_orders")
          .select("id, item_id, supplier, quantity, unit_cost, status, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ]);

      if (jobsRes.error || itemsRes.error || posRes.error) {
        throw new Error("Failed to query workspace jobs and inventory");
      }

      const rawItems = (itemsRes.data ?? []) as InventoryRow[];
      const filteredItems =
        args.low_stock_only === true
          ? rawItems.filter(
              (item) =>
                Number(item.quantity) - Number(item.reserved) <=
                Number(item.reorder_threshold)
            )
          : rawItems;

      toolResult = {
        jobs: jobsRes.data ?? [],
        inventory_items: filteredItems,
        purchase_orders: posRes.data ?? [],
      };
    } else if (toolName === "list_ops_readiness_audits") {
      auditBotRole = "scout";
      const limit = normalizeLimit(args.limit, 25);
      let query = admin
        .from("ops_readiness_audits")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (isOneOf(args.grade, ALLOWED_GRADES)) {
        query = query.eq("grade", args.grade);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error("Failed to query workspace operations readiness audits");
      }
      toolResult = { audits: data ?? [] };
    } else if (toolName === "ops_readiness_audits") {
      auditBotRole = "scout";
      const limit = normalizeLimit(args.limit, 25);
      let query = admin
        .from("ops_readiness_audits")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (isOneOf(args.grade, ALLOWED_GRADES)) {
        query = query.eq("grade", args.grade);
      }
      if (typeof args.lead_id === "string" && args.lead_id.trim()) {
        query = query.eq("lead_id", args.lead_id.trim());
      }

      const { data, error } = await query;
      if (error) {
        throw new Error("Failed to load workspace operations readiness audit summary");
      }

      const audits = (data ?? []) as OpsReadinessAuditRow[];
      const gradeBreakdown: Record<AuditGrade, number> = {
        A: 0,
        B: 0,
        C: 0,
        D: 0,
      };
      let scoreSum = 0;

      for (const audit of audits) {
        if (isOneOf(audit.grade, ALLOWED_GRADES)) {
          gradeBreakdown[audit.grade] += 1;
        }
        if (Number.isFinite(audit.score_0_100)) {
          scoreSum += audit.score_0_100;
        }
      }

      toolResult = {
        workspace_id: workspaceId,
        total_audits: audits.length,
        average_score: audits.length > 0 ? Math.round(scoreSum / audits.length) : 0,
        grade_breakdown: gradeBreakdown,
        audits,
      };
    } else if (toolName === "get_customer_consent_status") {
      auditBotRole = "qa";
      const email = typeof args.email === "string" ? args.email : "";
      const customerId = typeof args.customer_id === "string" ? args.customer_id : "";
      const consent = await checkCustomerConsentFailClosed(
        admin,
        workspaceId,
        email,
        customerId
      );
      toolResult = {
        suppressed: consent.suppressed,
        reason: consent.reason,
        consent_events: consent.consent_events,
      };
    } else if (toolName === "get_bot_manual") {
      const rawRole =
        typeof args.role === "string" && args.role.trim()
          ? args.role.trim()
          : typeof args.bot_role === "string"
            ? args.bot_role.trim()
            : "";

      if (!rawRole) {
        const { data: manuals, error } = await admin
          .from("bot_manuals")
          .select("id, workspace_id, bot_role, mode, instructions_markdown, updated_at")
          .eq("workspace_id", workspaceId)
          .order("bot_role", { ascending: true });

        if (error) {
          throw new Error("Failed to list workspace bot manuals");
        }

        const typedManuals = (manuals ?? []) as BotManualRow[];
        const manualByRole = new Map<string, BotManualRow>();
        for (const entry of typedManuals) {
          if (entry.bot_role && !manualByRole.has(entry.bot_role)) {
            manualByRole.set(entry.bot_role, entry);
          }
        }

        const availableRoles: BotRoleIndexEntry[] = ALLOWED_BOT_ROLES.map((role) => {
          const existing = manualByRole.get(role) ?? null;
          const summaryMeta = existing
            ? summarizeManualMarkdown(existing.instructions_markdown, role)
            : DEFAULT_BOT_ROLE_SUMMARIES[role];
          return {
            role,
            mode: existing?.mode ?? "propose",
            title: summaryMeta.title,
            summary: summaryMeta.summary,
            has_custom_manual: existing !== null,
          };
        });

        toolResult = {
          read_only: true,
          workspace_id: workspaceId,
          usage:
            "Call get_bot_manual with role (or bot_role) set to one of available_roles to load its full SOP manual.",
          available_roles: availableRoles,
        };
      } else {
        if (!isOneOf(rawRole, ALLOWED_BOT_ROLES)) {
          throw new Error(
            `role must be one of: ${ALLOWED_BOT_ROLES.join(", ")}`
          );
        }
        auditBotRole = rawRole;
        const { data: manual, error } = await admin
          .from("bot_manuals")
          .select("id, workspace_id, bot_role, mode, instructions_markdown, updated_at")
          .eq("workspace_id", workspaceId)
          .eq("bot_role", rawRole)
          .maybeSingle();

        if (error) {
          throw new Error("Failed to load workspace bot manual");
        }

        if (rawRole === "scout") {
          const scoutManual = enrichScoutManual(
            (manual as BotManualRow | null) ?? null,
            workspaceId
          );
          toolResult = {
            manual: scoutManual,
            grading_rubric: OPS_READINESS_GRADING_RUBRIC,
            read_only: true,
          };
        } else {
          toolResult = { manual: manual ?? null, read_only: true };
        }
      }
    } else if (toolName === "upsert_public_lead") {
      auditBotRole = "scout";
      const business = typeof args.business === "string" ? args.business.trim() : "";
      const industry = typeof args.industry === "string" ? args.industry.trim() : "";
      const location = typeof args.location === "string" ? args.location.trim() : "";
      const website = typeof args.website === "string" ? args.website.trim() : "";
      if (!business || !industry || !location || !website) {
        throw new Error("business, industry, location, and website are required");
      }

      const contactName =
        typeof args.contact_name === "string" && args.contact_name.trim()
          ? args.contact_name.trim()
          : "Owner / Operations";
      const contactEmail =
        typeof args.contact_email === "string" && args.contact_email.trim()
          ? args.contact_email.trim().toLowerCase()
          : null;
      const phone =
        typeof args.phone === "string" && args.phone.trim() ? args.phone.trim() : null;
      const notes =
        typeof args.notes === "string" ? args.notes.trim() : "Discovered via Loose Ends MCP";

      let score: number;
      if (args.score !== undefined) {
        if (
          typeof args.score !== "number" ||
          !Number.isSafeInteger(args.score) ||
          args.score < 0 ||
          args.score > 100
        ) {
          throw new Error("score must be an integer between 0 and 100");
        }
        score = args.score;
      } else {
        score = contactEmail ? 92 : 85;
      }

      const { data: leadRow, error } = await admin
        .from("public_leads")
        .upsert(
          {
            workspace_id: workspaceId,
            business,
            name: contactName,
            contact_name: contactName,
            email: contactEmail,
            contact_email: contactEmail,
            phone,
            business_type: industry,
            industry,
            location,
            website,
            notes,
            score,
            status: "DRAFT_READY",
          },
          { onConflict: "workspace_id,business" }
        )
        .select("*")
        .single();

      if (error || !leadRow) {
        throw new Error("Failed to upsert workspace public lead");
      }
      toolResult = { lead: leadRow, status: "DRAFT_READY" };
    } else if (toolName === "save_ops_readiness_audit") {
      auditBotRole = "scout";
      const businessName =
        typeof args.business_name === "string" ? args.business_name.trim() : "";
      if (!businessName) {
        throw new Error("business_name is required");
      }

      if (
        typeof args.score_0_100 !== "number" ||
        !Number.isSafeInteger(args.score_0_100) ||
        args.score_0_100 < 0 ||
        args.score_0_100 > 100
      ) {
        throw new Error("score_0_100 must be an integer between 0 and 100");
      }
      const score0100 = args.score_0_100;

      if (!isOneOf(args.grade, ALLOWED_GRADES)) {
        throw new Error("grade must be one of A, B, C, or D");
      }
      const grade: AuditGrade = args.grade;

      if (!Array.isArray(args.findings)) {
        throw new Error("findings must be an array of strings");
      }
      const findings = args.findings
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);

      const websiteUrl =
        typeof args.website_url === "string" && args.website_url.trim()
          ? args.website_url.trim()
          : null;

      let leadId: string | null = null;
      if (typeof args.lead_id === "string" && args.lead_id.trim()) {
        const candidateLeadId = args.lead_id.trim();
        const { data: leadMatch, error: leadErr } = await admin
          .from("public_leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", candidateLeadId)
          .maybeSingle();
        if (leadErr || !leadMatch) {
          throw new Error("lead_id not found in authenticated workspace");
        }
        leadId = (leadMatch as { id: string }).id;
      }

      const reportHtml =
        typeof args.report_html === "string" && args.report_html.trim()
          ? args.report_html.trim()
          : `<div class="ops-scorecard"><h2>${escapeHtml(businessName)} — Operations Readiness Grade: ${grade} (${score0100}/100)</h2><ul>${findings
              .map((f) => `<li>${escapeHtml(f)}</li>`)
              .join("")}</ul></div>`;

      const { data: auditRow, error: auditErr } = await admin
        .from("ops_readiness_audits")
        .insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          business_name: businessName,
          website_url: websiteUrl,
          score_0_100: score0100,
          grade,
          findings,
          report_html: reportHtml,
        })
        .select("*")
        .single();

      if (auditErr || !auditRow) {
        throw new Error("Failed to save operations readiness audit");
      }

      const { data: stagedCard, error: stageErr } = await admin
        .from("staged_ops_actions")
        .insert({
          workspace_id: workspaceId,
          bot_role: "scout",
          workspace_domain: "pipeline",
          action_type: "ops_readiness_scorecard",
          title: `Ops Readiness Scorecard: ${businessName} (Grade ${grade} · ${score0100}/100)`,
          summary:
            findings.slice(0, 3).join(" · ") || "Operations readiness audit completed.",
          amount_cents: 24900,
          confidence_score: 0.95,
          payload: {
            audit_id: (auditRow as { id: string }).id,
            grade,
            score_0_100: score0100,
            website_url: websiteUrl,
          },
          status: "pending_approval",
        })
        .select("*")
        .single();

      if (stageErr) {
        throw new Error("Audit saved, but staging scorecard action failed");
      }

      toolResult = {
        audit: auditRow,
        staged_action: stagedCard ?? null,
      };
    } else if (toolName === "queue_communication_draft") {
      auditBotRole = "scout";
      const companyName =
        typeof args.company_name === "string" ? args.company_name.trim() : "";
      const recipientName =
        typeof args.recipient_name === "string" && args.recipient_name.trim()
          ? args.recipient_name.trim()
          : "Owner / Operations";
      const recipientEmail =
        typeof args.recipient_email === "string"
          ? args.recipient_email.trim().toLowerCase()
          : "";
      const subject = typeof args.subject === "string" ? args.subject.trim() : "";
      const message = typeof args.message === "string" ? args.message.trim() : "";

      if (!companyName || !recipientEmail || !subject || !message) {
        throw new Error(
          "company_name, recipient_email, subject, and message are required"
        );
      }

      let customerId: string | null = null;
      if (typeof args.customer_id === "string" && args.customer_id.trim()) {
        const candidateCustId = args.customer_id.trim();
        const { data: custMatch, error: custCheckErr } = await admin
          .from("customers")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", candidateCustId)
          .maybeSingle();
        if (custCheckErr || !custMatch) {
          throw new Error("customer_id not found in authenticated workspace");
        }
        customerId = (custMatch as CustomerIdRow).id;
      }

      if (args.lead_id !== undefined && args.lead_id !== null && typeof args.lead_id !== "string") {
        throw new Error("lead_id must be a string");
      }
      let leadId: string | null = null;
      if (typeof args.lead_id === "string" && args.lead_id.trim()) {
        const candidateLeadId = args.lead_id.trim();
        const { data: leadMatch, error: leadCheckErr } = await admin
          .from("public_leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", candidateLeadId)
          .maybeSingle();
        if (leadCheckErr || !leadMatch) {
          throw new Error("lead_id not found in authenticated workspace");
        }
        leadId = (leadMatch as { id: string }).id;
      }

      const consent = await checkCustomerConsentFailClosed(
        admin,
        workspaceId,
        recipientEmail,
        customerId ?? ""
      );

      if (consent.suppressed) {
        throw new Error(
          `Consent Guard (${consent.reason}): ${recipientEmail} cannot be drafted.`
        );
      }

      if (!customerId) {
        const { data: existingCust, error: findCustErr } = await admin
          .from("customers")
          .select("id")
          .eq("workspace_id", workspaceId)
          .ilike("email", recipientEmail)
          .limit(1)
          .maybeSingle();

        if (findCustErr) {
          throw new Error("Failed to resolve workspace customer record");
        }

        const matchedCust = existingCust as CustomerIdRow | null;
        if (matchedCust?.id) {
          customerId = matchedCust.id;
        } else {
          const { data: createdCust, error: createCustErr } = await admin
            .from("customers")
            .insert({
              workspace_id: workspaceId,
              first_name: recipientName.slice(0, 100),
              last_name: companyName.slice(0, 100),
              email: recipientEmail,
            })
            .select("id")
            .single();

          if (createCustErr || !createdCust) {
            throw new Error("Failed to create workspace customer record");
          }
          customerId = (createdCust as CustomerIdRow).id;
        }
      }

      let existingDraft: ExistingLeadDraftRow | null = null;
      if (leadId) {
        const { data: existingDraftData, error: existingDraftError } = await admin
          .from("ops_communication_drafts")
          .select("id, status, delivery_status")
          .eq("workspace_id", workspaceId)
          .eq("lead_id", leadId)
          .maybeSingle();

        if (existingDraftError) {
          throw new Error("Failed to check existing communication draft for lead_id");
        }
        existingDraft = (existingDraftData as ExistingLeadDraftRow | null) ?? null;

        if (
          existingDraft &&
          (existingDraft.status !== "draft" || existingDraft.delivery_status !== "not_sent")
        ) {
          throw new Error(
            `Communication draft for lead_id ${leadId} already exists with status "${existingDraft.status}" (${existingDraft.delivery_status}) and cannot be overwritten.`
          );
        }
      }

      let savedDraft: unknown = null;
      let draftAction: "created_draft" | "updated_existing_draft" = "created_draft";

      if (existingDraft) {
        const { data: updatedDraft, error: updateErr } = await admin
          .from("ops_communication_drafts")
          .update({
            customer_id: customerId,
            recipient_email: recipientEmail,
            recipient_name: recipientName,
            company_name: companyName,
            subject,
            message,
            status: "draft",
            delivery_status: "not_sent",
            requires_approval: true,
          })
          .eq("workspace_id", workspaceId)
          .eq("id", existingDraft.id)
          .select("*")
          .single();

        if (updateErr || !updatedDraft) {
          throw new Error("Failed to update existing communication draft");
        }
        savedDraft = updatedDraft;
        draftAction = "updated_existing_draft";
      } else {
        const { data: draftRow, error: draftErr } = await admin
          .from("ops_communication_drafts")
          .insert({
            workspace_id: workspaceId,
            customer_id: customerId,
            lead_id: leadId,
            channel: "email",
            recipient_email: recipientEmail,
            recipient_name: recipientName,
            company_name: companyName,
            subject,
            message,
            status: "draft",
            delivery_status: "not_sent",
            requires_approval: true,
          })
          .select("*")
          .single();

        if (draftErr || !draftRow) {
          throw new Error("Failed to queue communication draft");
        }
        savedDraft = draftRow;
      }

      if (leadId) {
        const { error: leadStatusErr } = await admin
          .from("public_leads")
          .update({ status: "DRAFT_GENERATED" })
          .eq("workspace_id", workspaceId)
          .eq("id", leadId)
          .eq("status", "DRAFT_READY");

        if (leadStatusErr) {
          throw new Error("Failed to update linked lead status after queuing draft");
        }
      }

      toolResult = {
        draft: savedDraft,
        lead_id: leadId,
        action: draftAction,
        status: "draft",
        delivery_status: "not_sent",
        requires_approval: true,
      };
    } else if (toolName === "stage_ops_action") {
      if (!isOneOf(args.bot_role, ALLOWED_BOT_ROLES)) {
        throw new Error(
          `bot_role must be one of: ${ALLOWED_BOT_ROLES.join(", ")}`
        );
      }
      const botRole: BotRole = args.bot_role;
      auditBotRole = botRole;

      if (!isOneOf(args.workspace_domain, ALLOWED_DOMAINS)) {
        throw new Error(
          `workspace_domain must be one of: ${ALLOWED_DOMAINS.join(", ")}`
        );
      }
      const workspaceDomain: WorkspaceDomain = args.workspace_domain;

      if (!isOneOf(args.action_type, ALLOWED_ACTION_TYPES)) {
        throw new Error(
          `action_type must be one of: ${ALLOWED_ACTION_TYPES.join(", ")}`
        );
      }
      const actionType: StagedActionType = args.action_type;

      const title = typeof args.title === "string" ? args.title.trim() : "";
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      if (!title || !summary) {
        throw new Error("title and summary are required");
      }

      if (
        typeof args.amount_cents !== "number" ||
        !Number.isSafeInteger(args.amount_cents) ||
        args.amount_cents < 0
      ) {
        throw new Error("amount_cents must be a non-negative safe integer");
      }
      const amountCents = args.amount_cents;

      let confidenceScore = 0.92;
      if (args.confidence_score !== undefined) {
        if (
          typeof args.confidence_score !== "number" ||
          !Number.isFinite(args.confidence_score) ||
          args.confidence_score < 0 ||
          args.confidence_score > 1
        ) {
          throw new Error("confidence_score must be a number between 0 and 1");
        }
        confidenceScore = args.confidence_score;
      }

      let customerId: string | null = null;
      if (typeof args.customer_id === "string" && args.customer_id.trim()) {
        const candidateCustId = args.customer_id.trim();
        const { data: custMatch, error: custCheckErr } = await admin
          .from("customers")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", candidateCustId)
          .maybeSingle();
        if (custCheckErr || !custMatch) {
          throw new Error("customer_id not found in authenticated workspace");
        }
        customerId = (custMatch as CustomerIdRow).id;
      }

      const safePayload =
        args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
          ? (args.payload as Record<string, unknown>)
          : {};

      const { data: stagedRow, error: stageErr } = await admin
        .from("staged_ops_actions")
        .insert({
          workspace_id: workspaceId,
          bot_role: botRole,
          workspace_domain: workspaceDomain,
          action_type: actionType,
          customer_id: customerId,
          title,
          summary,
          amount_cents: amountCents,
          confidence_score: confidenceScore,
          payload: safePayload,
          status: "pending_approval",
        })
        .select("*")
        .single();

      if (stageErr || !stagedRow) {
        throw new Error("Failed to stage workspace action");
      }

      toolResult = {
        staged_action: stagedRow,
        status: "pending_approval",
      };
    } else if (toolName === "dismiss_communication_draft") {
      auditBotRole = "qa";
      const draftId = typeof args.draft_id === "string" ? args.draft_id.trim() : "";
      if (!draftId) {
        throw new Error("draft_id is required");
      }
      const reason =
        typeof args.reason === "string" && args.reason.trim()
          ? args.reason.trim().slice(0, 300)
          : "Dismissed by owner / MCP review";

      const { data: existingData, error: lookupErr } = await admin
        .from("ops_communication_drafts")
        .select("id, workspace_id, status, delivery_status, approved_at")
        .eq("workspace_id", workspaceId)
        .eq("id", draftId)
        .maybeSingle();

      if (lookupErr || !existingData) {
        throw new Error("draft_id not found in authenticated workspace");
      }

      const existing = existingData as {
        id: string;
        workspace_id: string;
        status: string;
        delivery_status: string;
        approved_at: string | null;
      };

      if (existing.delivery_status === "sent") {
        throw new Error("Sent communication drafts cannot be dismissed");
      }

      if (existing.status === "rejected") {
        toolResult = {
          draft: existing,
          dismissed: true,
          already_dismissed: true,
          status: "rejected",
          delivery_status: existing.delivery_status,
          reason,
        };
      } else {
        const { data: updatedDraft, error: updateErr } = await admin
          .from("ops_communication_drafts")
          .update({
            status: "rejected",
            approved_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("id", draftId)
          .select("*")
          .single();

        if (updateErr || !updatedDraft) {
          throw new Error("Failed to dismiss communication draft");
        }

        toolResult = {
          draft: updatedDraft,
          dismissed: true,
          already_dismissed: false,
          status: "rejected",
          delivery_status: (updatedDraft as { delivery_status?: string }).delivery_status ?? "not_sent",
          reason,
        };
      }
    } else if (toolName === "create_quote_draft") {
      auditBotRole = "scout";
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const customerName =
        typeof args.customer_name === "string" ? args.customer_name.trim() : "";
      if (!title || !customerName) {
        throw new Error("title and customer_name are required");
      }

      if (!Array.isArray(args.items) || args.items.length === 0 || args.items.length > 50) {
        throw new Error("items must contain between 1 and 50 line items");
      }

      let taxBps = 0;
      if (args.tax_bps !== undefined) {
        if (
          typeof args.tax_bps !== "number" ||
          !Number.isSafeInteger(args.tax_bps) ||
          args.tax_bps < 0 ||
          args.tax_bps > 5000
        ) {
          throw new Error("tax_bps must be an integer between 0 and 5000");
        }
        taxBps = args.tax_bps;
      }

      let subtotalCents = 0;
      const computedItems: Array<{
        position: number;
        description: string;
        quantity: number;
        unit_price_cents: number;
        line_total_cents: number;
      }> = [];

      for (let i = 0; i < args.items.length; i += 1) {
        const rawItem = args.items[i] as Record<string, unknown> | null;
        if (!rawItem || typeof rawItem !== "object") {
          throw new Error(`items[${i}] must be an object`);
        }
        const description =
          typeof rawItem.description === "string" ? rawItem.description.trim() : "";
        const quantity = rawItem.quantity;
        const unitPriceCents = rawItem.unit_price_cents;
        if (!description) {
          throw new Error(`items[${i}].description is required`);
        }
        if (
          typeof quantity !== "number" ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1
        ) {
          throw new Error(`items[${i}].quantity must be a positive safe integer`);
        }
        if (
          typeof unitPriceCents !== "number" ||
          !Number.isSafeInteger(unitPriceCents) ||
          unitPriceCents < 0
        ) {
          throw new Error(`items[${i}].unit_price_cents must be a non-negative safe integer`);
        }
        const lineTotalCents = quantity * unitPriceCents;
        if (!Number.isSafeInteger(lineTotalCents)) {
          throw new Error("Line total exceeds safe integer bounds");
        }
        subtotalCents += lineTotalCents;
        computedItems.push({
          position: i,
          description,
          quantity,
          unit_price_cents: unitPriceCents,
          line_total_cents: lineTotalCents,
        });
      }

      const taxCents = Math.floor((subtotalCents * taxBps + 5000) / 10000);
      const totalCents = subtotalCents + taxCents;

      let leadId: string | null = null;
      if (typeof args.lead_id === "string" && args.lead_id.trim()) {
        const { data: leadMatch, error: leadErr } = await admin
          .from("public_leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", args.lead_id.trim())
          .maybeSingle();
        if (leadErr || !leadMatch) {
          throw new Error("lead_id not found in authenticated workspace");
        }
        leadId = (leadMatch as { id: string }).id;
      }

      let customerId: string | null = null;
      if (typeof args.customer_id === "string" && args.customer_id.trim()) {
        const { data: custMatch, error: custErr } = await admin
          .from("customers")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", args.customer_id.trim())
          .maybeSingle();
        if (custErr || !custMatch) {
          throw new Error("customer_id not found in authenticated workspace");
        }
        customerId = (custMatch as CustomerIdRow).id;
      }

      const quoteStatus: "draft" | "sent" = args.status === "draft" ? "draft" : "sent";
      const customerEmail =
        typeof args.customer_email === "string" && args.customer_email.trim()
          ? args.customer_email.trim().toLowerCase()
          : null;
      const validUntil =
        typeof args.valid_until === "string" && args.valid_until.trim()
          ? args.valid_until.trim()
          : null;
      const notes =
        typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : null;

      const portalToken = `qpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const quoteNumber = `QTE-${portalToken.slice(4, 10).toUpperCase()}`;

      const { data: quoteRow, error: quoteErr } = await admin
        .from("quotes")
        .insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          customer_id: customerId,
          quote_number: quoteNumber,
          title,
          customer_name: customerName,
          customer_email: customerEmail,
          subtotal_cents: subtotalCents,
          tax_bps: taxBps,
          tax_cents: taxCents,
          total_cents: totalCents,
          status: quoteStatus,
          portal_token: portalToken,
          valid_until: validUntil,
          notes,
        })
        .select("*")
        .single();

      if (quoteErr || !quoteRow) {
        throw new Error("Failed to create quote draft");
      }

      const createdQuoteId = (quoteRow as { id: string }).id;
      const { data: itemRows, error: itemErr } = await admin
        .from("quote_items")
        .insert(
          computedItems.map((item) => ({
            workspace_id: workspaceId,
            quote_id: createdQuoteId,
            position: item.position,
            description: item.description,
            quantity: item.quantity,
            unit_price_cents: item.unit_price_cents,
            line_total_cents: item.line_total_cents,
          }))
        )
        .select("*");

      if (itemErr) {
        throw new Error("Quote created, but saving quote items failed");
      }

      toolResult = {
        quote: quoteRow,
        items: itemRows ?? [],
        portal_path: `/portal/${portalToken}`,
      };
    } else if (toolName === "list_ar_summary") {
      auditBotRole = "collections";
      const rawLimit = typeof args.limit === "number" ? Math.trunc(args.limit) : 10;
      const limit = Number.isFinite(rawLimit) ? Math.min(10, Math.max(1, rawLimit)) : 10;

      if (args.status !== undefined && !isOneOf(args.status, ALLOWED_INVOICE_STATUSES)) {
        throw new Error(
          `status must be one of: ${ALLOWED_INVOICE_STATUSES.join(", ")}`
        );
      }

      const { data: rawInvoices, error: invErr } = await admin
        .from("invoices")
        .select(
          "id, invoice_number, title, customer_name, total_cents, amount_paid_cents, due_date, status, created_at"
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(500);

      if (invErr) {
        throw new Error("Failed to query workspace AR invoices");
      }

      const allInvoices = (rawInvoices ?? []) as InvoiceRowForAr[];
      const todayIso = new Date().toISOString().slice(0, 10);
      let totalBilledCents = 0;
      let totalCollectedCents = 0;
      let openArCents = 0;
      let overdueArCents = 0;
      let overdueCount = 0;

      for (const inv of allInvoices) {
        if (inv.status === "void") continue;
        const total = Number.isSafeInteger(inv.total_cents) ? Math.max(0, inv.total_cents) : 0;
        const paid = Number.isSafeInteger(inv.amount_paid_cents)
          ? Math.min(total, Math.max(0, inv.amount_paid_cents))
          : 0;
        totalBilledCents += total;
        if (inv.status === "paid") {
          totalCollectedCents += Math.max(paid, total);
        } else {
          totalCollectedCents += paid;
          const balance = Math.max(0, total - paid);
          openArCents += balance;
          if ((inv.status === "overdue" || inv.due_date < todayIso) && balance > 0) {
            overdueArCents += balance;
            overdueCount += 1;
          }
        }
      }

      const filtered =
        typeof args.status === "string"
          ? allInvoices.filter((inv) => inv.status === args.status)
          : allInvoices.filter((inv) => inv.status !== "paid" && inv.status !== "void");

      toolResult = {
        workspace_id: workspaceId,
        total_billed_cents: totalBilledCents,
        total_collected_cents: totalCollectedCents,
        open_ar_cents: openArCents,
        overdue_ar_cents: overdueArCents,
        overdue_count: overdueCount,
        invoices: filtered.slice(0, limit),
      };
    } else if (toolName === "get_autonomy_rules") {
      auditBotRole = "chief_of_staff";
      const { data: settingsRow, error: settingsErr } = await admin
        .from("workspace_settings")
        .select("workspace_id, modules_enabled, autonomy_rules, auto_limit_cents")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (settingsErr) {
        throw new Error("Failed to load workspace autonomy rules");
      }

      const typedSettings = settingsRow as {
        modules_enabled?: Record<string, unknown> | null;
        autonomy_rules?: Record<string, unknown> | null;
        auto_limit_cents?: number | null;
      } | null;

      const modulesEnabled: Record<string, boolean> = { ...DEFAULT_MODULES_ENABLED };
      if (typedSettings?.modules_enabled && typeof typedSettings.modules_enabled === "object") {
        for (const [k, v] of Object.entries(typedSettings.modules_enabled)) {
          if (typeof v === "boolean") {
            modulesEnabled[k] = v;
          }
        }
      }

      const autonomyRules: Record<string, AutonomyMode> = { ...DEFAULT_AUTONOMY_RULES };
      if (typedSettings?.autonomy_rules && typeof typedSettings.autonomy_rules === "object") {
        for (const [k, v] of Object.entries(typedSettings.autonomy_rules)) {
          if (isOneOf(v, ALLOWED_AUTONOMY_MODES)) {
            autonomyRules[k] = v;
          }
        }
      }

      const autoLimitCents =
        typeof typedSettings?.auto_limit_cents === "number" &&
        Number.isSafeInteger(typedSettings.auto_limit_cents) &&
        typedSettings.auto_limit_cents >= 0
          ? typedSettings.auto_limit_cents
          : DEFAULT_AUTO_LIMIT_CENTS;

      toolResult = {
        workspace_id: workspaceId,
        modules_enabled: modulesEnabled,
        autonomy_rules: autonomyRules,
        auto_limit_cents: autoLimitCents,
      };
    } else if (toolName === "log_agent_action") {
      const agentName = typeof args.agent_name === "string" ? args.agent_name.trim() : "";
      const moduleName = typeof args.module === "string" ? args.module.trim() : "";
      const actionType = typeof args.action_type === "string" ? args.action_type.trim() : "";
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      if (!agentName || !moduleName || !actionType || !summary) {
        throw new Error("agent_name, module, action_type, and summary are required");
      }
      if (!isOneOf(args.autonomy_mode, ALLOWED_AUTONOMY_MODES)) {
        throw new Error(
          `autonomy_mode must be one of: ${ALLOWED_AUTONOMY_MODES.join(", ")}`
        );
      }
      const autonomyMode: AutonomyMode = args.autonomy_mode;

      if (typeof args.impact_cents !== "number" || !Number.isSafeInteger(args.impact_cents)) {
        throw new Error("impact_cents must be a safe integer");
      }
      const impactCents = args.impact_cents;

      let status: LedgerStatus = "executed";
      if (args.status !== undefined) {
        if (!isOneOf(args.status, ALLOWED_LEDGER_STATUSES)) {
          throw new Error(
            `status must be one of: ${ALLOWED_LEDGER_STATUSES.join(", ")}`
          );
        }
        status = args.status;
      }

      const beforeState =
        args.before_state && typeof args.before_state === "object" && !Array.isArray(args.before_state)
          ? (args.before_state as Record<string, unknown>)
          : null;
      const afterState =
        args.after_state && typeof args.after_state === "object" && !Array.isArray(args.after_state)
          ? (args.after_state as Record<string, unknown>)
          : null;

      auditBotRole = isOneOf(moduleName, ALLOWED_BOT_ROLES) ? moduleName : "chief_of_staff";

      const { data: ledgerRow, error: ledgerErr } = await admin
        .from("agent_action_ledger")
        .insert({
          workspace_id: workspaceId,
          agent_name: agentName,
          module: moduleName,
          action_type: actionType,
          autonomy_mode: autonomyMode,
          summary,
          impact_cents: impactCents,
          before_state: beforeState,
          after_state: afterState,
          status,
        })
        .select("*")
        .single();

      if (ledgerErr || !ledgerRow) {
        throw new Error("Failed to log action into agent_action_ledger");
      }

      toolResult = {
        ledger_entry: ledgerRow,
      };
    } else if (toolName === "check_low_stock_skus") {
      auditBotRole = "buyer";
      const rawLimit = typeof args.limit === "number" ? Math.trunc(args.limit) : 10;
      const limit = Number.isFinite(rawLimit) ? Math.min(10, Math.max(1, rawLimit)) : 10;

      const { data: rawSkus, error: skuErr } = await admin
        .from("inventory_items")
        .select(
          "id, sku, name, location, bin_code, preferred_vendor, lead_time_days, on_hand_qty, reserved_qty, reorder_point_qty, reorder_qty, unit_cost_cents, quantity, reserved, reorder_threshold, reorder_quantity, purchase_cost"
        )
        .eq("workspace_id", workspaceId)
        .eq("archived", false)
        .limit(500);

      if (skuErr) {
        throw new Error("Failed to query workspace inventory_items");
      }

      const lowStockRows = ((rawSkus ?? []) as InventoryRow[])
        .map((row) => {
          const onHand =
            typeof row.on_hand_qty === "number" && Number.isSafeInteger(row.on_hand_qty)
              ? row.on_hand_qty
              : Math.max(0, Math.round(Number(row.quantity ?? 0)));
          const reserved =
            typeof row.reserved_qty === "number" && Number.isSafeInteger(row.reserved_qty)
              ? row.reserved_qty
              : Math.max(0, Math.round(Number(row.reserved ?? 0)));
          const reorderPoint =
            typeof row.reorder_point_qty === "number" && Number.isSafeInteger(row.reorder_point_qty)
              ? row.reorder_point_qty
              : Math.max(0, Math.round(Number(row.reorder_threshold ?? 0)));
          const reorderQty =
            typeof row.reorder_qty === "number" && Number.isSafeInteger(row.reorder_qty)
              ? Math.max(1, row.reorder_qty)
              : Math.max(1, Math.round(Number(row.reorder_quantity ?? 1)));
          const unitCostCents =
            typeof row.unit_cost_cents === "number" && Number.isSafeInteger(row.unit_cost_cents)
              ? row.unit_cost_cents
              : Math.max(0, Math.round(Number(row.purchase_cost ?? 0) * 100));
          const availableQty = onHand - reserved;
          return {
            id: row.id ?? "",
            sku: row.sku ?? "",
            name: row.name ?? "",
            location: row.location ?? null,
            bin_code: row.bin_code ?? null,
            preferred_vendor: row.preferred_vendor ?? null,
            on_hand_qty: onHand,
            reserved_qty: reserved,
            available_qty: availableQty,
            reorder_point_qty: reorderPoint,
            reorder_qty: reorderQty,
            unit_cost_cents: unitCostCents,
            estimated_reorder_cost_cents: reorderQty * unitCostCents,
          };
        })
        .filter((item) => item.available_qty <= item.reorder_point_qty)
        .sort((a, b) => a.available_qty - b.available_qty || a.sku.localeCompare(b.sku));

      const totalEstimatedReorderCostCents = lowStockRows.reduce(
        (sum, row) => sum + row.estimated_reorder_cost_cents,
        0
      );

      toolResult = {
        workspace_id: workspaceId,
        low_stock_count: lowStockRows.length,
        total_estimated_reorder_cost_cents: totalEstimatedReorderCostCents,
        items: lowStockRows.slice(0, limit),
      };
    } else if (toolName === "stage_purchase_order") {
      auditBotRole = "buyer";
      const vendorName = typeof args.vendor_name === "string" ? args.vendor_name.trim() : "";
      if (!vendorName) {
        throw new Error("vendor_name is required");
      }
      if (!Array.isArray(args.items) || args.items.length === 0) {
        throw new Error("items must be a non-empty array");
      }

      const poStatus = args.status === "draft" ? "draft" : "pending_approval";
      const expectedDate =
        typeof args.expected_date === "string" && args.expected_date.trim()
          ? args.expected_date.trim()
          : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const notes = typeof args.notes === "string" ? args.notes.trim() : null;

      let totalCents = 0;
      const computedPoItems: Array<{
        inventory_item_id: string | null;
        sku: string;
        description: string;
        ordered_qty: number;
        unit_cost_cents: number;
        line_total_cents: number;
      }> = [];

      for (const rawItem of args.items) {
        const entry =
          rawItem && typeof rawItem === "object"
            ? (rawItem as Record<string, unknown>)
            : null;
        if (!entry) {
          throw new Error("Each PO item must be an object");
        }
        const sku = typeof entry.sku === "string" ? entry.sku.trim().toUpperCase() : "";
        const description =
          typeof entry.description === "string" && entry.description.trim()
            ? entry.description.trim()
            : sku;
        const orderedQty = entry.ordered_qty;
        const unitCostCents = entry.unit_cost_cents;
        if (
          !sku ||
          typeof orderedQty !== "number" ||
          !Number.isSafeInteger(orderedQty) ||
          orderedQty < 1 ||
          typeof unitCostCents !== "number" ||
          !Number.isSafeInteger(unitCostCents) ||
          unitCostCents < 0
        ) {
          throw new Error(
            "Each PO item requires sku, ordered_qty >= 1, and integer unit_cost_cents >= 0"
          );
        }
        const lineTotalCents = orderedQty * unitCostCents;
        totalCents += lineTotalCents;
        computedPoItems.push({
          inventory_item_id:
            typeof entry.inventory_item_id === "string" && entry.inventory_item_id.trim()
              ? entry.inventory_item_id.trim()
              : null,
          sku,
          description,
          ordered_qty: orderedQty,
          unit_cost_cents: unitCostCents,
          line_total_cents: lineTotalCents,
        });
      }

      const poNumber =
        typeof args.po_number === "string" && args.po_number.trim()
          ? args.po_number.trim().toUpperCase()
          : `PO-${Date.now().toString(36).toUpperCase().slice(-6)}`;

      const { data: poRow, error: poErr } = await admin
        .from("purchase_orders")
        .insert({
          workspace_id: workspaceId,
          po_number: poNumber,
          vendor_name: vendorName,
          status: poStatus,
          total_cents: totalCents,
          expected_date: expectedDate,
          notes,
        })
        .select("*")
        .single();

      if (poErr || !poRow) {
        throw new Error("Failed to insert purchase_order");
      }
      const createdPoId = (poRow as { id: string }).id;

      const { data: poItemRows, error: poItemErr } = await admin
        .from("purchase_order_items")
        .insert(
          computedPoItems.map((line) => ({
            workspace_id: workspaceId,
            po_id: createdPoId,
            inventory_item_id: line.inventory_item_id,
            sku: line.sku,
            description: line.description,
            ordered_qty: line.ordered_qty,
            received_qty: 0,
            unit_cost_cents: line.unit_cost_cents,
            line_total_cents: line.line_total_cents,
          }))
        )
        .select("*");

      if (poItemErr) {
        throw new Error("Purchase order created, but saving line items failed");
      }

      const { data: ledgerRow, error: ledgerErr } = await admin
        .from("agent_action_ledger")
        .insert({
          workspace_id: workspaceId,
          agent_name: "Procurement & Restock Agent",
          module: "inventory",
          action_type: "stage_auto_po",
          autonomy_mode: "approve_1tap",
          summary: `Staged PO ${poNumber} for ${vendorName} (${formatCentsUsd(totalCents)})`,
          impact_cents: totalCents,
          before_state: { po_id: null, vendor_name: vendorName },
          after_state: {
            po_id: createdPoId,
            po_number: poNumber,
            po_status: poStatus,
            total_cents: totalCents,
          },
          status: "pending_approval",
        })
        .select("*")
        .single();

      if (ledgerErr || !ledgerRow) {
        throw new Error("PO staged, but logging into agent_action_ledger failed");
      }

      toolResult = {
        purchase_order: poRow,
        items: poItemRows ?? [],
        ledger_entry: ledgerRow,
      };
    } else if (toolName === "run_three_way_match") {
      auditBotRole = "qa";
      const rawTolerance =
        typeof args.tolerance_bps === "number" ? Math.trunc(args.tolerance_bps) : 200;
      if (!Number.isSafeInteger(rawTolerance) || rawTolerance < 0 || rawTolerance > 5000) {
        throw new Error("tolerance_bps must be an integer between 0 and 5000");
      }

      const poId = typeof args.po_id === "string" ? args.po_id.trim() : "";
      const billId = typeof args.vendor_bill_id === "string" ? args.vendor_bill_id.trim() : "";

      let resolvedPoId = poId;
      let poNumber = typeof args.po_number === "string" ? args.po_number.trim() : "PO-INLINE";
      let vendorName = typeof args.vendor_name === "string" ? args.vendor_name.trim() : "Supplier";
      let invoiceNumber =
        typeof args.invoice_number === "string" ? args.invoice_number.trim() : "BILL-INLINE";

      const poItems: McpThreeWayLineItem[] = [];
      const receiptItems: McpReceiptLineItem[] = [];
      const billItems: McpBillLineItem[] = [];

      if (billId) {
        const { data: billRow, error: billErr } = await admin
          .from("vendor_bills")
          .select("id, po_id, vendor_name, invoice_number, items_json")
          .eq("workspace_id", workspaceId)
          .eq("id", billId)
          .maybeSingle();
        if (billErr || !billRow) {
          throw new Error("vendor_bill_id not found in authenticated workspace");
        }
        const typedBill = billRow as Release2VendorBillRow;
        if (!resolvedPoId && typedBill.po_id) {
          resolvedPoId = typedBill.po_id;
        }
        vendorName = typedBill.vendor_name || vendorName;
        invoiceNumber = typedBill.invoice_number || invoiceNumber;
        if (Array.isArray(typedBill.items_json)) {
          for (const entry of typedBill.items_json) {
            if (entry && typeof entry === "object") {
              const obj = entry as Record<string, unknown>;
              const sku = typeof obj.sku === "string" ? obj.sku.trim().toUpperCase() : "";
              const qty = typeof obj.quantity === "number" ? Math.trunc(obj.quantity) : 0;
              const unitCost =
                typeof obj.unit_cost_cents === "number" ? Math.trunc(obj.unit_cost_cents) : 0;
              if (sku) {
                billItems.push({ sku, quantity: qty, unit_cost_cents: unitCost });
              }
            }
          }
        }
      }

      if (Array.isArray(args.bill_items)) {
        billItems.length = 0;
        for (const rawEntry of args.bill_items) {
          const obj = rawEntry as Record<string, unknown>;
          const sku = typeof obj.sku === "string" ? obj.sku.trim().toUpperCase() : "";
          const qty = Number(obj.quantity);
          const unitCost = Number(obj.unit_cost_cents);
          if (
            !sku ||
            !Number.isSafeInteger(qty) ||
            qty < 0 ||
            !Number.isSafeInteger(unitCost) ||
            unitCost < 0
          ) {
            throw new Error("Invalid bill_items entry");
          }
          billItems.push({ sku, quantity: qty, unit_cost_cents: unitCost });
        }
      }

      if (billItems.length === 0) {
        throw new Error("Provide bill_items or a valid vendor_bill_id with line items");
      }

      if (resolvedPoId) {
        const [{ data: poRow, error: poErr }, { data: poItemRows }, { data: recRows }] =
          await Promise.all([
            admin
              .from("purchase_orders")
              .select("id, po_number, vendor_name")
              .eq("workspace_id", workspaceId)
              .eq("id", resolvedPoId)
              .maybeSingle(),
            admin
              .from("purchase_order_items")
              .select("sku, ordered_qty, unit_cost_cents")
              .eq("workspace_id", workspaceId)
              .eq("po_id", resolvedPoId),
            admin
              .from("goods_receipts")
              .select("items_json")
              .eq("workspace_id", workspaceId)
              .eq("po_id", resolvedPoId),
          ]);

        if (poErr || !poRow) {
          throw new Error("po_id not found in authenticated workspace");
        }
        const typedPo = poRow as { po_number?: string; vendor_name?: string };
        poNumber = typedPo.po_number ?? poNumber;
        if (!vendorName || vendorName === "Supplier") {
          vendorName = typedPo.vendor_name ?? vendorName;
        }
        for (const r of (poItemRows ?? []) as Array<{
          sku: string;
          ordered_qty: number;
          unit_cost_cents: number;
        }>) {
          poItems.push({
            sku: r.sku,
            ordered_qty: Math.max(1, Math.trunc(r.ordered_qty)),
            unit_cost_cents: Math.max(0, Math.trunc(r.unit_cost_cents)),
          });
        }
        for (const grn of (recRows ?? []) as Array<{ items_json?: unknown }>) {
          if (Array.isArray(grn.items_json)) {
            for (const line of grn.items_json) {
              if (line && typeof line === "object") {
                const obj = line as Record<string, unknown>;
                const sku = typeof obj.sku === "string" ? obj.sku.trim().toUpperCase() : "";
                if (!sku) continue;
                receiptItems.push({
                  sku,
                  received_qty: Math.max(0, Math.trunc(Number(obj.received_qty ?? 0))),
                  damaged_qty: Math.max(0, Math.trunc(Number(obj.damaged_qty ?? 0))),
                });
              }
            }
          }
        }
      }

      if (Array.isArray(args.po_items)) {
        poItems.length = 0;
        for (const rawEntry of args.po_items) {
          const obj = rawEntry as Record<string, unknown>;
          const sku = typeof obj.sku === "string" ? obj.sku.trim().toUpperCase() : "";
          const orderedQty = Number(obj.ordered_qty);
          const unitCost = Number(obj.unit_cost_cents);
          if (
            !sku ||
            !Number.isSafeInteger(orderedQty) ||
            orderedQty < 1 ||
            !Number.isSafeInteger(unitCost) ||
            unitCost < 0
          ) {
            throw new Error("Invalid po_items entry");
          }
          poItems.push({ sku, ordered_qty: orderedQty, unit_cost_cents: unitCost });
        }
      }

      if (Array.isArray(args.receipt_items)) {
        receiptItems.length = 0;
        for (const rawEntry of args.receipt_items) {
          const obj = rawEntry as Record<string, unknown>;
          const sku = typeof obj.sku === "string" ? obj.sku.trim().toUpperCase() : "";
          const recQty = Number(obj.received_qty);
          const dmgQty =
            obj.damaged_qty !== undefined ? Number(obj.damaged_qty) : 0;
          if (
            !sku ||
            !Number.isSafeInteger(recQty) ||
            recQty < 0 ||
            !Number.isSafeInteger(dmgQty) ||
            dmgQty < 0
          ) {
            throw new Error("Invalid receipt_items entry");
          }
          receiptItems.push({ sku, received_qty: recQty, damaged_qty: dmgQty });
        }
      }

      let isDuplicateInvoice = false;
      if (invoiceNumber && invoiceNumber !== "BILL-INLINE") {
        const { data: dupRows, error: dupErr } = await admin
          .from("vendor_bills")
          .select("id, invoice_number")
          .eq("workspace_id", workspaceId)
          .eq("invoice_number", invoiceNumber)
          .limit(5);
        if (!dupErr && Array.isArray(dupRows)) {
          isDuplicateInvoice = (dupRows as Array<{ id: string }>).some(
            (r) => r.id !== billId
          );
        }
      }

      const matchOut = computeMcpThreeWayMatch({
        poItems,
        receiptItems,
        billItems,
        toleranceBps: rawTolerance,
        poNumber,
        vendorName,
        invoiceNumber,
        isDuplicateInvoice,
      });

      if (billId) {
        await admin
          .from("vendor_bills")
          .update({
            match_status: String(matchOut.match_status),
            match_variance_cents: Number(matchOut.match_variance_cents ?? 0),
            discrepancy_summary:
              typeof matchOut.discrepancy_summary === "string"
                ? matchOut.discrepancy_summary
                : null,
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("id", billId);
      }

      await admin.from("agent_action_ledger").insert({
        workspace_id: workspaceId,
        agent_name: "3-Way Match Controller",
        module: "bookkeeping",
        action_type: "run_three_way_match",
        autonomy_mode: "approve_1tap",
        summary: `3-Way Match (${String(matchOut.match_status)}) for ${invoiceNumber} vs ${poNumber}: variance ${formatCentsUsd(Number(matchOut.match_variance_cents ?? 0))}`,
        impact_cents: Math.abs(Number(matchOut.match_variance_cents ?? 0)),
        before_state: { vendor_bill_id: billId || null, po_id: resolvedPoId || null },
        after_state: {
          match_status: matchOut.match_status,
          match_variance_cents: matchOut.match_variance_cents,
        },
        status: matchOut.match_status === "matched_clean" ? "executed" : "pending_approval",
      });

      toolResult = {
        workspace_id: workspaceId,
        vendor_bill_id: billId || null,
        po_id: resolvedPoId || null,
        ...matchOut,
      };
    } else if (toolName === "get_cashflow_summary") {
      auditBotRole = "cash_applications";
      const asOfDate =
        typeof args.as_of_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.as_of_date.trim())
          ? args.as_of_date.trim()
          : new Date().toISOString().slice(0, 10);
      const safetyBufferCents =
        typeof args.safety_buffer_cents === "number" &&
        Number.isSafeInteger(args.safety_buffer_cents) &&
        args.safety_buffer_cents >= 0
          ? args.safety_buffer_cents
          : 500000;

      const [invRes, billsRes, ledgerRes] = await Promise.all([
        admin
          .from("invoices")
          .select("id, total_cents, amount_paid_cents, due_date, status")
          .eq("workspace_id", workspaceId)
          .limit(500),
        admin
          .from("vendor_bills")
          .select("id, total_cents, due_date, match_status")
          .eq("workspace_id", workspaceId)
          .limit(500),
        admin
          .from("ledger_entries")
          .select("id, entry_type, amount_cents, occurred_on")
          .eq("workspace_id", workspaceId)
          .limit(500),
      ]);

      if (invRes.error || billsRes.error || ledgerRes.error) {
        throw new Error("Failed to query workspace bookkeeping tables");
      }

      let netLedgerCents = 0;
      for (const row of (ledgerRes.data ?? []) as Release2LedgerEntryRow[]) {
        const amt = Number.isSafeInteger(row.amount_cents) ? Math.abs(row.amount_cents) : 0;
        if (row.entry_type === "revenue") {
          netLedgerCents += amt;
        } else if (row.entry_type === "cogs" || row.entry_type === "expense") {
          netLedgerCents -= amt;
        }
      }

      const startingBalanceCents =
        typeof args.starting_balance_cents === "number" &&
        Number.isSafeInteger(args.starting_balance_cents)
          ? args.starting_balance_cents
          : netLedgerCents;

      const startMs = Date.parse(`${asOfDate}T00:00:00Z`);
      const periodInflows: Record<30 | 60 | 90, number> = { 30: 0, 60: 0, 90: 0 };
      const periodOutflows: Record<30 | 60 | 90, number> = { 30: 0, 60: 0, 90: 0 };
      let totalOpenArCents = 0;
      let totalScheduledApCents = 0;
      let heldDisputedApCents = 0;

      for (const inv of (invRes.data ?? []) as InvoiceRowForAr[]) {
        if (inv.status === "paid" || inv.status === "void") continue;
        const remaining = Math.max(0, (inv.total_cents ?? 0) - (inv.amount_paid_cents ?? 0));
        if (remaining === 0) continue;
        totalOpenArCents += remaining;
        const dueMs = Date.parse(`${(inv.due_date || asOfDate).slice(0, 10)}T00:00:00Z`);
        const diffDays = Number.isFinite(dueMs) ? Math.round((dueMs - startMs) / 86_400_000) : 0;
        if (diffDays <= 30) periodInflows[30] += remaining;
        else if (diffDays <= 60) periodInflows[60] += remaining;
        else if (diffDays <= 90) periodInflows[90] += remaining;
      }

      for (const bill of (billsRes.data ?? []) as Release2VendorBillRow[]) {
        const amount = Math.max(0, bill.total_cents ?? 0);
        if (amount === 0 || bill.match_status === "paid") continue;
        if (bill.match_status === "disputed" || bill.match_status === "exception_flagged") {
          heldDisputedApCents += amount;
          continue;
        }
        totalScheduledApCents += amount;
        const dueMs = Date.parse(`${(bill.due_date || asOfDate).slice(0, 10)}T00:00:00Z`);
        const diffDays = Number.isFinite(dueMs) ? Math.round((dueMs - startMs) / 86_400_000) : 0;
        if (diffDays <= 30) periodOutflows[30] += amount;
        else if (diffDays <= 60) periodOutflows[60] += amount;
        else if (diffDays <= 90) periodOutflows[90] += amount;
      }

      let running = startingBalanceCents;
      let firstBreachHorizonDays: 30 | 60 | 90 | null = null;
      const windows = ([30, 60, 90] as const).map((horizon) => {
        const pIn = periodInflows[horizon];
        const pOut = periodOutflows[horizon];
        running = running + pIn - pOut;
        const below = running < safetyBufferCents;
        if (below && firstBreachHorizonDays === null) {
          firstBreachHorizonDays = horizon;
        }
        return {
          horizon_days: horizon,
          window_end_date: new Date(startMs + horizon * 86_400_000).toISOString().slice(0, 10),
          period_inflows_cents: pIn,
          period_outflows_cents: pOut,
          ending_balance_cents: running,
          below_buffer: below,
          buffer_shortfall_cents: below ? safetyBufferCents - running : 0,
        };
      });

      toolResult = {
        workspace_id: workspaceId,
        as_of_date: asOfDate,
        starting_balance_cents: startingBalanceCents,
        net_ledger_cashflow_cents: netLedgerCents,
        safety_buffer_cents: safetyBufferCents,
        total_open_ar_cents: totalOpenArCents,
        total_scheduled_ap_cents: totalScheduledApCents,
        held_disputed_ap_cents: heldDisputedApCents,
        any_buffer_breach: firstBreachHorizonDays !== null,
        first_breach_horizon_days: firstBreachHorizonDays,
        windows,
      };
    } else if (toolName === "list_expiring_compliance") {
      auditBotRole = "qa";
      const rawLimit = typeof args.limit === "number" ? Math.trunc(args.limit) : 10;
      const limit = Number.isFinite(rawLimit) ? Math.min(10, Math.max(1, rawLimit)) : 10;
      const refDate =
        typeof args.reference_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.reference_date.trim())
          ? args.reference_date.trim()
          : new Date().toISOString().slice(0, 10);
      const includeAllActive = args.include_all_active === true;

      const { data: vaultRows, error: vaultErr } = await admin
        .from("compliance_vault_items")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("expires_on", { ascending: true })
        .limit(500);

      if (vaultErr) {
        throw new Error("Failed to query compliance_vault_items");
      }

      const refMs = Date.parse(`${refDate}T00:00:00Z`);
      const evaluated = ((vaultRows ?? []) as Array<{
        id: string;
        workspace_id: string;
        doc_type: string;
        title: string;
        counterparty: string;
        expires_on: string;
        notice_window_days: number;
        annual_value_cents: number;
        status: string;
      }>)
        .filter((doc) => doc.status !== "cancelled")
        .map((doc) => {
          const expMs = Date.parse(`${(doc.expires_on || refDate).slice(0, 10)}T00:00:00Z`);
          const daysRemaining = Number.isFinite(expMs)
            ? Math.round((expMs - refMs) / 86_400_000)
            : 0;
          const noticeDays = Math.max(0, Math.trunc(doc.notice_window_days ?? 45));
          const withinNoticeWindow = daysRemaining <= noticeDays;
          return {
            ...doc,
            days_remaining: daysRemaining,
            within_notice_window: withinNoticeWindow,
          };
        })
        .filter(
          (doc) =>
            includeAllActive ||
            (doc.status !== "notice_staged" && doc.within_notice_window)
        )
        .sort((a, b) => a.days_remaining - b.days_remaining);

      const annualSpendAtRiskCents = evaluated.reduce(
        (sum, doc) => sum + (doc.within_notice_window ? Math.max(0, doc.annual_value_cents ?? 0) : 0),
        0
      );

      toolResult = {
        workspace_id: workspaceId,
        reference_date: refDate,
        expiring_count: evaluated.length,
        annual_spend_at_risk_cents: annualSpendAtRiskCents,
        items: evaluated.slice(0, limit),
      };
    } else if (toolName === "stage_compliance_notice") {
      auditBotRole = "chief_of_staff";
      const vaultItemId =
        typeof args.vault_item_id === "string" ? args.vault_item_id.trim() : "";
      if (!vaultItemId) {
        throw new Error("vault_item_id is required");
      }

      const { data: vaultRow, error: vaultLookupErr } = await admin
        .from("compliance_vault_items")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", vaultItemId)
        .maybeSingle();

      if (vaultLookupErr || !vaultRow) {
        throw new Error("vault_item_id not found in authenticated workspace");
      }

      const item = vaultRow as {
        id: string;
        doc_type: string;
        title: string;
        counterparty: string;
        expires_on: string;
        notice_window_days: number;
        annual_value_cents: number;
        status: string;
      };

      const noticeKind = args.notice_kind === "cancellation" ? "Non-Renewal / Cancellation Notice" : "Renewal Notice";
      const recipientEmail =
        typeof args.recipient_email === "string"
          ? args.recipient_email.trim().toLowerCase()
          : "";
      const recipientName =
        typeof args.recipient_name === "string" && args.recipient_name.trim()
          ? args.recipient_name.trim()
          : item.counterparty;
      const customNote = typeof args.custom_note === "string" ? args.custom_note.trim() : "";

      const subject = `${noticeKind}: ${item.title} (${item.counterparty} · expires ${item.expires_on})`;
      const messageBody = [
        `Hello ${recipientName},`,
        ``,
        `This communication serves as ${noticeKind.toLowerCase()} regarding ${item.title} (${item.doc_type.toUpperCase()}) scheduled to expire on ${item.expires_on} (${item.notice_window_days}-day notice window, annual commitment ${formatCentsUsd(item.annual_value_cents ?? 0)}).`,
        ...(customNote ? [``, customNote] : []),
        ``,
        `Please acknowledge receipt before the notice cutoff date.`,
        ``,
        `---`,
        `Loose Ends OS Compliance Desk · 421 Hill Street, Parkersburg, WV 26104`,
        `Reply UNSUBSCRIBE to opt out of future automated notices.`,
      ].join("\n");

      let stagedDraft: unknown = null;
      const rawCustomerId =
        typeof args.customer_id === "string" ? args.customer_id.trim() : "";

      if (recipientEmail || rawCustomerId) {
        const consent = await checkCustomerConsentFailClosed(
          admin,
          workspaceId,
          recipientEmail,
          rawCustomerId
        );
        if (consent.suppressed) {
          throw new Error(
            `Consent Guard (${consent.reason}): ${recipientEmail || rawCustomerId} cannot be drafted.`
          );
        }

        let resolvedCustomerId: string | null = null;
        if (rawCustomerId) {
          const { data: custMatch } = await admin
            .from("customers")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("id", rawCustomerId)
            .maybeSingle();
          if (!custMatch) {
            throw new Error("customer_id not found in authenticated workspace");
          }
          resolvedCustomerId = (custMatch as CustomerIdRow).id;
        }

        const { data: draftRow, error: draftErr } = await admin
          .from("ops_communication_drafts")
          .insert({
            workspace_id: workspaceId,
            customer_id: resolvedCustomerId,
            channel: "email",
            recipient_email: recipientEmail || null,
            recipient_name: recipientName,
            company_name: item.counterparty,
            subject,
            message: messageBody,
            status: "draft",
            delivery_status: "not_sent",
            requires_approval: true,
          })
          .select("*")
          .single();

        if (draftErr) {
          throw new Error("Failed to stage compliance notice draft");
        }
        stagedDraft = draftRow ?? null;
      }

      const { data: updatedVault, error: updateErr } = await admin
        .from("compliance_vault_items")
        .update({
          status: "notice_staged",
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", item.id)
        .select("*")
        .single();

      if (updateErr || !updatedVault) {
        throw new Error("Failed to update compliance_vault_items status");
      }

      const { data: ledgerRow, error: ledgerErr } = await admin
        .from("agent_action_ledger")
        .insert({
          workspace_id: workspaceId,
          agent_name: "Compliance Vault Guardian",
          module: "vault",
          action_type: "stage_compliance_notice",
          autonomy_mode: "approve_1tap",
          summary: `Staged ${noticeKind} for ${item.title} (${item.counterparty} · ${formatCentsUsd(item.annual_value_cents ?? 0)}/yr)`,
          impact_cents: item.annual_value_cents ?? 0,
          before_state: { vault_item_id: item.id, vault_status: item.status },
          after_state: {
            vault_item_id: item.id,
            vault_status: "notice_staged",
            subject,
          },
          status: "executed",
        })
        .select("*")
        .single();

      if (ledgerErr || !ledgerRow) {
        throw new Error("Notice staged, but Agent Action Ledger logging failed");
      }

      toolResult = {
        vault_item: updatedVault,
        communication_draft: stagedDraft,
        notice_preview: {
          requires_approval: true,
          subject,
          message: messageBody,
        },
        ledger_entry: ledgerRow,
      };
    } else if (toolName === "upsert_living_sop") {
      auditBotRole = "qa";
      const moduleKey =
        typeof args.module_key === "string" ? args.module_key.trim().toLowerCase() : "";
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const triggerEvent =
        typeof args.trigger_event === "string" ? args.trigger_event.trim() : "";
      const rawSteps = Array.isArray(args.steps)
        ? args.steps.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
        : [];
      const autoGenerated = args.auto_generated !== false;

      if (!moduleKey || !title || !triggerEvent || rawSteps.length === 0) {
        throw new Error("module_key, title, trigger_event, and non-empty steps are required");
      }

      const { data: existingSop, error: lookupErr } = await admin
        .from("living_sops")
        .select("id, version")
        .eq("workspace_id", workspaceId)
        .eq("module_key", moduleKey)
        .eq("title", title)
        .maybeSingle();

      if (lookupErr) {
        throw new Error("Failed to inspect existing living_sops");
      }

      const typedExisting = existingSop as { id?: string; version?: number } | null;
      const nextVersion =
        typedExisting && typeof typedExisting.version === "number"
          ? typedExisting.version + 1
          : 1;
      const nowIso = new Date().toISOString();

      const { data: sopRow, error: upsertErr } = await admin
        .from("living_sops")
        .upsert(
          {
            workspace_id: workspaceId,
            module_key: moduleKey,
            title,
            trigger_event: triggerEvent,
            steps_json: rawSteps,
            version: nextVersion,
            auto_generated: autoGenerated,
            last_observed_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: "workspace_id,module_key,title" }
        )
        .select("*")
        .single();

      if (upsertErr || !sopRow) {
        throw new Error("Failed to upsert living_sops playbook");
      }

      await admin.from("agent_action_ledger").insert({
        workspace_id: workspaceId,
        agent_name: "Living SOP Compiler",
        module: "vault",
        action_type: "upsert_living_sop",
        autonomy_mode: "full_auto",
        summary: `Compiled Living SOP "${title}" v${nextVersion} (${moduleKey})`,
        impact_cents: 0,
        before_state: { sop_version: nextVersion > 1 ? nextVersion - 1 : null },
        after_state: {
          sop_id: (sopRow as { id: string }).id,
          module_key: moduleKey,
          title,
          version: nextVersion,
        },
        status: "executed",
      });

      toolResult = {
        sop: sopRow,
        created: nextVersion === 1,
        version: nextVersion,
      };
    }

    await admin.from("bot_runs").insert({
      workspace_id: workspaceId,
      bot_role: auditBotRole,
      model: "mcp-client",
      mode: "propose",
      surface: "mcp",
      tool_name: toolName,
      state_hash: computedStateHash,
      status: "completed",
      input_summary: `MCP tools/call: ${toolName}`,
      output_json: buildSanitizedAuditOutput(toolName, toolResult, computedStateHash),
    });

    return jsonRpcResponse(rpcId, {
      content: [
        {
          type: "text",
          text: JSON.stringify(toolResult, null, 2),
        },
      ],
      structuredContent: toolResult,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "MCP tool execution failed";
    await admin.from("bot_runs").insert({
      workspace_id: workspaceId,
      bot_role: "qa",
      model: "mcp-client",
      mode: "propose",
      surface: "mcp",
      tool_name: toolName || "unknown",
      status: "failed",
      input_summary: `MCP tools/call failed: ${toolName}`,
      output_json: { error: errMsg },
    });
    return jsonRpcError(rpcId, -32000, errMsg, 400);
  }
});
