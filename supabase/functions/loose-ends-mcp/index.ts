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
  "collections",
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

type BotRole = (typeof ALLOWED_BOT_ROLES)[number];
type WorkspaceDomain = (typeof ALLOWED_DOMAINS)[number];
type StagedActionType = (typeof ALLOWED_ACTION_TYPES)[number];
type AuditGrade = (typeof ALLOWED_GRADES)[number];
type RequiredScope = "read_all" | "stage_actions";

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

interface ConsentCheckResult {
  suppressed: boolean;
  reason: string;
  consent_events: ConsentEventRow[];
}

interface InventoryRow {
  id?: string;
  name?: string;
  sku?: string;
  quantity: number;
  reserved: number;
  reorder_threshold: number;
  reorder_quantity?: number;
  purchase_cost?: number;
  selling_price?: number;
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
      "Read-only access to the authenticated workspace's versioned SOP manual and autonomy mode for one of the 7 bot roles.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["bot_role"],
      properties: {
        bot_role: {
          type: "string",
          enum: [...ALLOWED_BOT_ROLES],
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
      "Write-narrow (staged): Fail-closed consent verification in customer_contact_consent_events followed by owner-gated draft insert in ops_communication_drafts.",
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
        lead_id: { type: "string" },
        customer_id: { type: "string" },
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
  if (toolName === "queue_communication_draft") {
    const draft = toolResult.draft as { id?: string; status?: string; delivery_status?: string } | null;
    return {
      draft_id: draft?.id ?? null,
      status: draft?.status ?? "draft",
      delivery_status: draft?.delivery_status ?? "not_sent",
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
        version: "1.4.0",
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
      const botRoleRaw = typeof args.bot_role === "string" ? args.bot_role.trim() : "";
      if (!isOneOf(botRoleRaw, ALLOWED_BOT_ROLES)) {
        throw new Error(
          `bot_role must be one of: ${ALLOWED_BOT_ROLES.join(", ")}`
        );
      }
      auditBotRole = botRoleRaw;
      const { data: manual, error } = await admin
        .from("bot_manuals")
        .select("id, workspace_id, bot_role, mode, instructions_markdown, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("bot_role", botRoleRaw)
        .maybeSingle();

      if (error) {
        throw new Error("Failed to load workspace bot manual");
      }
      toolResult = { manual: manual ?? null, read_only: true };
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
      toolResult = {
        draft: draftRow,
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
