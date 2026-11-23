import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;
const ALLOWED_ORIGIN = "https://looseendsos.app";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-inbound-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  const a = aHex.trim().toLowerCase();
  const b = bHex.trim().toLowerCase();
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function computeHmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseInboundBillText(rawText: string, fileName: string): {
  vendorName: string;
  invoiceNumber: string;
  poReference: string | null;
  lineCount: number;
  totalCents: number;
  confidenceBps: number;
} {
  const text = rawText.trim();
  const vendorMatch = text.match(/^\s*(?:Vendor|From|Supplier)\s*[:\-]\s*(.+)$/im);
  const invMatch = text.match(/^\s*(?:Invoice(?:\s*No\.?|#)?|Inv(?:oice)?)\s*[:#\-]\s*([A-Za-z0-9._\-\/]+)/im);
  const poMatch = text.match(/\b(PO[-_# ]?[A-Za-z0-9\-]{3,})\b/i);
  const vendorName = vendorMatch?.[1]?.trim() || "Inbound Vendor";
  const invoiceNumber = invMatch?.[1]?.trim().toUpperCase() || `INB-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const poReference = poMatch?.[1]?.replace(/^PO\s*#\s*/i, "PO-").trim().toUpperCase() || null;

  const lines = text.split(/\r?\n/);
  let lineCount = 0;
  let lineSum = 0;
  for (const line of lines) {
    const m = line.match(
      /(?:[•\-\*]|\b)([A-Z0-9]{2,}[A-Z0-9\-]*)\s+x\s*(\d+)\s*[@at]+\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
    );
    if (!m) continue;
    const qty = Math.max(1, Math.min(100_000, Number.parseInt(m[2], 10) || 1));
    const unitCents = Math.max(0, Math.round(Number(m[3].replace(/,/g, "")) * 100));
    if (Number.isSafeInteger(unitCents)) {
      lineCount += 1;
      lineSum += qty * unitCents;
    }
  }

  const totalMatch = text.match(/(?:Total(?:\s*Due)?|Amount\s*Due|Balance\s*Due)\s*[:\-]?\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  const parsedTotal = totalMatch ? Math.round(Number(totalMatch[1].replace(/,/g, "")) * 100) : 0;
  const totalCents = lineSum > 0 ? lineSum : Math.max(0, parsedTotal);

  let confidenceBps = 2500;
  if (lineCount > 0 && totalCents > 0) confidenceBps = vendorMatch && invMatch ? 9500 : 8000;
  else if (totalCents > 0) confidenceBps = 6000;

  return { vendorName, invoiceNumber, poReference, lineCount, totalCents, confidenceBps };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  // Fail closed unless webhook HMAC signing secret is configured
  const webhookSecret = (Deno.env.get("INBOUND_EMAIL_WEBHOOK_SECRET") ?? "").trim();
  if (!webhookSecret) {
    return respond(503, { error: "Inbound webhook secret is not configured" });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return respond(413, { error: "Payload exceeds 5 MB limit" });
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_WEBHOOK_BODY_BYTES) {
    return respond(413, { error: "Payload exceeds 5 MB limit" });
  }

  const providedSig = (req.headers.get("x-inbound-signature") ?? "").replace(/^sha256=/i, "").trim();
  const expectedSig = await computeHmacSha256Hex(webhookSecret, rawBody);
  if (!timingSafeHexEqual(providedSig, expectedSig)) {
    return respond(401, { error: "Invalid inbound webhook signature" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(503, { error: "Supabase service environment unavailable" });
  }

  const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  const explicitWorkspaceId =
    typeof payload.workspace_id === "string" && UUID_REGEX.test(payload.workspace_id.trim())
      ? payload.workspace_id.trim()
      : "";
  const toAddress = typeof payload.to === "string" ? payload.to.trim().toLowerCase() : "";
  const rawSlug = typeof payload.workspace_slug === "string"
    ? payload.workspace_slug.trim().toLowerCase()
    : toAddress.match(/^bills\+([a-z0-9-]+)@/i)?.[1] ?? "";
  const fileName = typeof payload.file_name === "string" && payload.file_name.trim()
    ? payload.file_name.trim().slice(0, 120)
    : "email-attachment.txt";
  const rawText = typeof payload.text === "string"
    ? payload.text
    : typeof payload.raw_bill_text === "string"
      ? payload.raw_bill_text
      : "";

  if ((!explicitWorkspaceId && !rawSlug) || !rawText.trim()) {
    return respond(400, {
      error: "workspace_id or workspace_slug (or bills+<slug>@ address) and text are required",
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const wsQuery = explicitWorkspaceId
    ? admin.from("workspaces").select("id, slug").eq("id", explicitWorkspaceId).maybeSingle()
    : admin.from("workspaces").select("id, slug").eq("slug", rawSlug).maybeSingle();
  const { data: workspaceRow, error: wsErr } = await wsQuery;

  if (wsErr || !workspaceRow) {
    return respond(404, { error: "Target workspace not found" });
  }
  const workspaceId = (workspaceRow as { id: string; slug?: string | null }).id;
  const resolvedSlug = (workspaceRow as { id: string; slug?: string | null }).slug || rawSlug || workspaceId.slice(0, 8);
  const contentHash = await sha256Hex(`${workspaceId}:${rawText.trim()}`);

  const { data: existingDup } = await admin
    .from("inbound_bill_captures")
    .select("id, vendor_name, extracted_total_cents, po_reference, match_status")
    .eq("workspace_id", workspaceId)
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (existingDup) {
    return respond(200, { duplicate: true, capture: existingDup });
  }

  const parsed = parseInboundBillText(rawText, fileName);
  const { data: inserted, error: insertErr } = await admin
    .from("inbound_bill_captures")
    .insert({
      workspace_id: workspaceId,
      source_address: toAddress || `bills+${resolvedSlug}@inbound.looseendsos.app`,
      file_name: fileName,
      vendor_name: parsed.vendorName,
      extracted_total_cents: parsed.totalCents,
      po_reference: parsed.poReference,
      match_status: "needs_review",
      proof_summary: `Webhook capture (${fileName}, invoice ${parsed.invoiceNumber}, ${parsed.lineCount} parsed line(s)) at ${(parsed.confidenceBps / 100).toFixed(0)}% confidence; awaiting owner verification.`,
      content_hash: contentHash,
      extraction_method: "webhook_text",
      extraction_confidence_bps: parsed.confidenceBps,
      human_verified: false,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    return respond(500, { error: "Failed to persist inbound bill capture" });
  }

  await admin.from("agent_action_ledger").insert({
    workspace_id: workspaceId,
    agent_name: "Inbox-to-Ledger Webhook",
    module: "bookkeeping",
    action_type: "inbound_bill_webhook_captured",
    autonomy_mode: "approve_1tap",
    summary: `Captured inbound bill ${parsed.invoiceNumber} from ${parsed.vendorName} (${fileName}) awaiting review.`,
    impact_cents: parsed.totalCents,
    after_state: {
      capture_id: (inserted as { id: string }).id,
      content_hash: contentHash,
      invoice_number: parsed.invoiceNumber,
      line_count: parsed.lineCount,
    },
    status: "pending_approval",
  });

  return respond(200, { duplicate: false, capture: inserted });
});
