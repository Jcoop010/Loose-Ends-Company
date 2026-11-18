import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-mcp-token, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

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

const MCP_TOOLS = [
  {
    name: "get_workspace_overview",
    description:
      "Read-wide overview across all 5 Loose Ends workspaces: public leads, pipeline opportunities & quotes, active jobs, low-stock inventory, pending communication drafts, and staged bot actions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "list_public_leads",
    description:
      "List SMB prospects in public.public_leads with optional status and minimum qualification score filters.",
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
    description:
      "List open pipeline opportunities, loose ends, and quote/invoice documents for the workspace.",
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
    description:
      "List field service jobs (ops_jobs), open purchase orders (ops_purchase_orders), and SKU inventory items (inventory_items).",
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
    name: "get_customer_consent_status",
    description:
      "Check TCPA/CAN-SPAM channel consent and opt-out status in customer_contact_consent_events by email or customer_id.",
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
    description:
      "Read-only access to the workspace's versioned SOP manual and autonomy mode for a bot role.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["bot_role"],
      properties: {
        bot_role: {
          type: "string",
          enum: [
            "chief_of_staff",
            "scout",
            "dispatcher",
            "buyer",
            "billing",
            "collections",
            "qa",
          ],
        },
      },
    },
  },
  {
    name: "upsert_public_lead",
    description:
      "Write-narrow (staged): Upsert an enriched SMB prospect into public.public_leads at status DRAFT_READY.",
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
    name: "queue_communication_draft",
    description:
      "Write-narrow (staged): Re-verifies customer_contact_consent_events (hard-blocking revoked/opted-out contacts) and queues an owner-gated draft in ops_communication_drafts (status='draft', requires_approval=true, delivery_status='not_sent').",
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
    description:
      "Write-narrow (staged): Stage a quote draft, job checklist flag, PO draft, expense receipt, invoice draft, payment match, or discrepancy flag in public.staged_ops_actions at status='pending_approval'.",
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
          enum: [
            "chief_of_staff",
            "scout",
            "dispatcher",
            "buyer",
            "billing",
            "collections",
            "qa",
          ],
        },
        workspace_domain: {
          type: "string",
          enum: ["pipeline", "jobs", "inventory", "comms", "billing"],
        },
        action_type: {
          type: "string",
          enum: [
            "quote_draft",
            "job_checklist_flag",
            "purchase_order_draft",
            "expense_receipt",
            "invoice_draft",
            "payment_match",
            "discrepancy_flag",
          ],
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
  const { data: tokenRow, error: tokenErr } = await admin
    .from("workspace_mcp_tokens")
    .select("id, workspace_id, label, scopes, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return jsonRpcError(null, -32001, "Invalid or revoked Workspace MCP token", 401);
  }

  const workspaceId = (tokenRow as { workspace_id: string }).workspace_id;
  const tokenId = (tokenRow as { id: string }).id;

  await admin
    .from("workspace_mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenId);

  const body = (await req.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  } | null;

  const rpcId = body?.id ?? null;
  const method = body?.method ?? "";

  if (method === "initialize") {
    return jsonRpcResponse(rpcId, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "loose-ends-mcp",
        version: "1.2.1",
        workspace_id: workspaceId,
      },
    });
  }

  if (method === "notifications/initialized" || method === "ping") {
    return jsonRpcResponse(rpcId, {});
  }

  if (method === "tools/list") {
    return jsonRpcResponse(rpcId, { tools: MCP_TOOLS });
  }

  if (method !== "tools/call") {
    return jsonRpcError(rpcId, -32601, `Unsupported MCP method: ${method}`, 400);
  }

  const params = body?.params ?? {};
  const toolName = typeof params.name === "string" ? params.name.trim() : "";
  const args =
    params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

  try {
    let toolResult: Record<string, unknown> = {};
    let auditBotRole = "chief_of_staff";

    if (toolName === "get_workspace_overview") {
      const [
        { count: leadsCount },
        { count: draftsCount },
        { count: oppsCount },
        { count: jobsCount },
        { count: skusCount },
        { count: stagedOpsCount },
        { count: stagedLedgerCount },
      ] = await Promise.all([
        admin.from("public_leads").select("*", { count: "exact", head: true }),
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
      ]);

      toolResult = {
        workspace_id: workspaceId,
        counts: {
          public_leads: leadsCount ?? 0,
          pending_communication_drafts: draftsCount ?? 0,
          opportunities: oppsCount ?? 0,
          ops_jobs: jobsCount ?? 0,
          active_inventory_skus: skusCount ?? 0,
          pending_staged_ops_actions: stagedOpsCount ?? 0,
          pending_staged_ledger_entries: stagedLedgerCount ?? 0,
        },
      };
    } else if (toolName === "list_public_leads") {
      auditBotRole = "scout";
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      let q = admin
        .from("public_leads")
        .select(
          "id, business, industry, location, contact_name, contact_email, phone, website, score, status, created_at"
        )
        .order("score", { ascending: false })
        .limit(limit);
      if (typeof args.status === "string" && args.status) {
        q = q.eq("status", args.status);
      }
      if (typeof args.min_score === "number") {
        q = q.gte("score", args.min_score);
      }
      const { data, error } = await q;
      if (error) throw error;
      toolResult = { leads: data ?? [] };
    } else if (toolName === "list_pipeline_and_quotes") {
      auditBotRole = "collections";
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      const [{ data: opportunities }, { data: documents }] = await Promise.all([
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
      toolResult = {
        opportunities: opportunities ?? [],
        documents: documents ?? [],
      };
    } else if (toolName === "list_jobs_and_inventory") {
      auditBotRole = "dispatcher";
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      const [{ data: jobs }, { data: items }, { data: pos }] = await Promise.all([
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
      const rawItems = (items ?? []) as Array<{
        quantity: number;
        reserved: number;
        reorder_threshold: number;
      }>;
      const filteredItems =
        args.low_stock_only === true
          ? rawItems.filter(
              (i) => Number(i.quantity) - Number(i.reserved) <= Number(i.reorder_threshold)
            )
          : rawItems;
      toolResult = {
        jobs: jobs ?? [],
        inventory_items: filteredItems,
        purchase_orders: pos ?? [],
      };
    } else if (toolName === "get_customer_consent_status") {
      auditBotRole = "qa";
      const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
      const customerId =
        typeof args.customer_id === "string" ? args.customer_id.trim() : "";

      const events: unknown[] = [];
      if (email) {
        const { data: byEmail } = await admin
          .from("customer_contact_consent_events")
          .select("*")
          .eq("email", email)
          .order("created_at", { ascending: false })
          .limit(10);
        events.push(...(byEmail ?? []));
      }
      if (customerId) {
        const { data: byCust } = await admin
          .from("customer_contact_consent_events")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(10);
        events.push(...(byCust ?? []));
      }
      const typedEvents = events as Array<{ status?: string; decision?: string }>;
      const suppressed = typedEvents.some(
        (e) =>
          e.status === "opted_out" ||
          e.status === "revoked" ||
          e.decision === "revoked"
      );
      toolResult = {
        suppressed,
        consent_events: events,
      };
    } else if (toolName === "get_bot_manual") {
      const botRole =
        typeof args.bot_role === "string" ? args.bot_role.trim() : "chief_of_staff";
      auditBotRole = botRole;
      const { data: manual, error } = await admin
        .from("bot_manuals")
        .select("id, workspace_id, bot_role, mode, instructions_markdown, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("bot_role", botRole)
        .maybeSingle();
      if (error) throw error;
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
      const score =
        typeof args.score === "number"
          ? Math.min(100, Math.max(0, Math.round(args.score)))
          : contactEmail
            ? 92
            : 85;

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
          { onConflict: "business" }
        )
        .select("*")
        .single();
      if (error) throw error;
      toolResult = { lead: leadRow, status: "DRAFT_READY" };
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

      // Hard consent check before queuing
      const { data: consentRows } = await admin
        .from("customer_contact_consent_events")
        .select("id, status, decision")
        .eq("email", recipientEmail);

      const isRevoked = ((consentRows ?? []) as Array<{
        status?: string;
        decision?: string;
      }>).some(
        (e) =>
          e.status === "opted_out" ||
          e.status === "revoked" ||
          e.decision === "revoked"
      );

      if (isRevoked) {
        throw new Error(
          `Consent Guard: ${recipientEmail} has an opt-out or revocation on file. Draft creation blocked.`
        );
      }

      // Resolve or create workspace customer so draft links cleanly to Customer 360
      let customerId =
        typeof args.customer_id === "string" && args.customer_id.trim()
          ? args.customer_id.trim()
          : null;

      if (!customerId) {
        const { data: existingCust } = await admin
          .from("customers")
          .select("id")
          .eq("workspace_id", workspaceId)
          .ilike("email", recipientEmail)
          .limit(1)
          .maybeSingle();

        if (existingCust && (existingCust as { id?: string }).id) {
          customerId = (existingCust as { id: string }).id;
        } else {
          const { data: createdCust } = await admin
            .from("customers")
            .insert({
              workspace_id: workspaceId,
              first_name: recipientName.slice(0, 100),
              last_name: companyName.slice(0, 100),
              email: recipientEmail,
            })
            .select("id")
            .single();
          customerId = (createdCust as { id?: string } | null)?.id ?? null;
        }
      }

      const { data: draftRow, error: draftErr } = await admin
        .from("ops_communication_drafts")
        .insert({
          workspace_id: workspaceId,
          customer_id: customerId,
          lead_id:
            typeof args.lead_id === "string" && args.lead_id.trim()
              ? args.lead_id.trim()
              : null,
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

      if (draftErr) throw draftErr;
      toolResult = {
        draft: draftRow,
        status: "draft",
        delivery_status: "not_sent",
        requires_approval: true,
      };
    } else if (toolName === "stage_ops_action") {
      const botRole =
        typeof args.bot_role === "string" ? args.bot_role.trim() : "chief_of_staff";
      auditBotRole = botRole;
      const workspaceDomain =
        typeof args.workspace_domain === "string"
          ? args.workspace_domain.trim()
          : "billing";
      const actionType =
        typeof args.action_type === "string"
          ? args.action_type.trim()
          : "discrepancy_flag";
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      const amountCents = Math.max(0, Math.round(Number(args.amount_cents ?? 0)));
      const confidenceScore = Math.min(
        1,
        Math.max(0, Number(args.confidence_score ?? 0.92))
      );

      if (!title || !summary) {
        throw new Error("title and summary are required");
      }

      const { data: stagedRow, error: stageErr } = await admin
        .from("staged_ops_actions")
        .insert({
          workspace_id: workspaceId,
          bot_role: botRole,
          workspace_domain: workspaceDomain,
          action_type: actionType,
          customer_id:
            typeof args.customer_id === "string" && args.customer_id.trim()
              ? args.customer_id.trim()
              : null,
          title,
          summary,
          amount_cents: amountCents,
          confidence_score: confidenceScore,
          payload:
            args.payload && typeof args.payload === "object" ? args.payload : {},
          status: "pending_approval",
        })
        .select("*")
        .single();

      if (stageErr) throw stageErr;
      toolResult = {
        staged_action: stagedRow,
        status: "pending_approval",
      };
    } else {
      return jsonRpcError(rpcId, -32601, `Unknown MCP tool: ${toolName}`, 400);
    }

    await admin.from("bot_runs").insert({
      workspace_id: workspaceId,
      bot_role: auditBotRole,
      model: "mcp-client",
      mode: "propose",
      surface: "mcp",
      tool_name: toolName,
      status: "completed",
      input_summary: `MCP tools/call: ${toolName}`,
      output_json: toolResult,
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
  } catch (err) {
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
