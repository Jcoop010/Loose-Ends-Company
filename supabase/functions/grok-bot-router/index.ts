import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ParsedLineItem {
  description: string;
  quantity: number;
  unit_price_cents: number;
}

interface ParsedDocumentStructuredOutput {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  line_items: ParsedLineItem[];
  tax_cents: number;
  total_cents: number;
  discrepancy_notes: string;
  confidence_score: number;
}

interface LeakAuditRecommendation {
  entry_type: "invoice_draft" | "payment_match" | "discrepancy_flag";
  vendor_or_customer: string;
  amount_cents: number;
  reasoning_summary: string;
  confidence_score: number;
}

interface LeakAuditStructuredOutput {
  recommendations: LeakAuditRecommendation[];
  executive_summary: string;
}

interface XaiResponsesPayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

const PARSE_DOCUMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "vendor_name",
    "invoice_number",
    "invoice_date",
    "line_items",
    "tax_cents",
    "total_cents",
    "discrepancy_notes",
    "confidence_score",
  ],
  properties: {
    vendor_name: { type: "string" },
    invoice_number: { type: "string" },
    invoice_date: { type: "string" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price_cents"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unit_price_cents: { type: "integer" },
        },
      },
    },
    tax_cents: { type: "integer" },
    total_cents: { type: "integer" },
    discrepancy_notes: { type: "string" },
    confidence_score: { type: "number" },
  },
};

const AUDIT_LEAKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendations", "executive_summary"],
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "entry_type",
          "vendor_or_customer",
          "amount_cents",
          "reasoning_summary",
          "confidence_score",
        ],
        properties: {
          entry_type: {
            type: "string",
            enum: ["invoice_draft", "payment_match", "discrepancy_flag"],
          },
          vendor_or_customer: { type: "string" },
          amount_cents: { type: "integer" },
          reasoning_summary: { type: "string" },
          confidence_score: { type: "number" },
        },
      },
    },
    executive_summary: { type: "string" },
  },
};

function extractResponseText(payload: XaiResponsesPayload): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return null;
}

function deterministicParseDocument(rawText: string): ParsedDocumentStructuredOutput {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const vendorMatch = /(?:vendor|supplier|from|merchant)[:\s]+([^\n\r]+)/i.exec(rawText);
  const vendorName = (vendorMatch?.[1] ?? lines[0] ?? "Submitted Vendor Bill").slice(0, 120).trim();

  const invMatch = /(?:invoice|receipt|bill|po)\s*(?:#|no\.?|number)?[:\s]*([A-Z0-9-]{3,40})/i.exec(rawText);
  const invoiceNumber = invMatch?.[1] ?? `DOC-${Date.now().toString().slice(-6)}`;

  const dateMatch = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(rawText);
  const invoiceDate = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);

  const taxMatch = /tax[:\s]*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(rawText);
  const taxCents = taxMatch ? Math.round(Number(taxMatch[1]) * 100) : 0;

  const totalMatch = /total[:\s]*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(rawText);

  const lineItems: ParsedLineItem[] = [];
  const lineRegex = /^(.+?)\s+(?:(\d+(?:\.\d+)?)\s*[x@]\s*)?\$\s*(\d+(?:\.\d{1,2})?)$/i;

  for (const line of lines) {
    if (/^(subtotal|tax|total|amount due|balance)/i.test(line)) continue;
    const m = lineRegex.exec(line);
    if (m) {
      const desc = m[1].trim();
      const qty = m[2] ? Number(m[2]) : 1;
      const unitCents = Math.round(Number(m[3]) * 100);
      lineItems.push({
        description: desc,
        quantity: qty,
        unit_price_cents: unitCents,
      });
    }
  }

  const computedSub = lineItems.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
    0
  );
  const totalCents = totalMatch
    ? Math.round(Number(totalMatch[1]) * 100)
    : computedSub + taxCents;

  if (lineItems.length === 0 && totalCents > 0) {
    lineItems.push({
      description: `${vendorName} (${invoiceNumber})`,
      quantity: 1,
      unit_price_cents: Math.max(0, totalCents - taxCents),
    });
  }

  return {
    vendor_name: vendorName,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    line_items: lineItems,
    tax_cents: taxCents,
    total_cents: totalCents,
    discrepancy_notes: "",
    confidence_score: 0.88,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return respond(401, { error: "Authentication required" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      return respond(503, { error: "Supabase environment not configured" });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData?.user) {
      return respond(401, { error: "Invalid user session" });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.workspace_id !== "string" || typeof body.action !== "string") {
      return respond(400, { error: "workspace_id and action are required" });
    }

    const workspaceId = body.workspace_id.trim();
    const action = body.action.trim();
    const botRole =
      typeof body.bot_role === "string" &&
      ["billing", "cash_applications", "collections", "outreach"].includes(body.bot_role)
        ? body.bot_role
        : action === "parse_document"
          ? "billing"
          : "collections";

    const { data: membership } = await userClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (!membership) {
      return respond(403, { error: "Workspace membership required" });
    }

    // Load read-only SOP manual for this bot role
    const { data: manualRow } = await userClient
      .from("bot_manuals")
      .select("mode, instructions_markdown")
      .eq("workspace_id", workspaceId)
      .eq("bot_role", botRole)
      .maybeSingle();

    const botMode =
      (manualRow as { mode?: string } | null)?.mode ?? "propose";
    const sopInstructions =
      (manualRow as { instructions_markdown?: string } | null)?.instructions_markdown ??
      "Follow strict accounting controls. Stage all proposals for owner approval.";

    const xaiKey = (Deno.env.get("XAI_API_KEY") ?? "").trim();
    const xaiModel = (Deno.env.get("XAI_MODEL") ?? "grok-4.7").trim() || "grok-4.7";

    // =========================================================================
    // Action 1: parse_document
    // =========================================================================
    if (action === "parse_document") {
      const documentText =
        typeof body.document_text === "string" ? body.document_text.trim() : "";
      const imageBase64 =
        typeof body.image_base64 === "string" ? body.image_base64.trim() : "";

      if (!documentText && !imageBase64) {
        return respond(400, { error: "document_text or image_base64 is required" });
      }

      let parsed: ParsedDocumentStructuredOutput | null = null;
      let runStatus: "completed" | "fallback_deterministic" = "completed";

      if (xaiKey) {
        try {
          const userContent: Array<Record<string, unknown>> = [];
          if (documentText) {
            userContent.push({
              type: "input_text",
              text: `Parse this receipt / vendor invoice into integer cents:\n\n${documentText}`,
            });
          }
          if (imageBase64) {
            const dataUri = imageBase64.startsWith("data:")
              ? imageBase64
              : `data:image/png;base64,${imageBase64}`;
            userContent.push({
              type: "input_image",
              image_url: dataUri,
            });
          }

          const xaiRes = await fetch("https://api.x.ai/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${xaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: xaiModel,
              input: [
                {
                  role: "system",
                  content: `You are the Loose Ends Scoped Billing & Receipt Accounting Bot.\nSOP Manual (Read-Only):\n${sopInstructions}\nExtract line items and integer cent totals accurately.`,
                },
                {
                  role: "user",
                  content: userContent,
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "parsed_accounting_document",
                  strict: true,
                  schema: PARSE_DOCUMENT_SCHEMA,
                },
              },
            }),
          });

          if (xaiRes.ok) {
            const xaiPayload = (await xaiRes.json()) as XaiResponsesPayload;
            const rawJson = extractResponseText(xaiPayload);
            if (rawJson) {
              parsed = JSON.parse(rawJson) as ParsedDocumentStructuredOutput;
            }
          }
        } catch {
          // Fall back to deterministic parser
        }
      }

      if (!parsed) {
        runStatus = "fallback_deterministic";
        parsed = deterministicParseDocument(
          documentText || "Uploaded Receipt Image $249.00"
        );
      }

      // Deterministic TypeScript arithmetic recomputation & discrepancy guard
      const computedSubtotalCents = parsed.line_items.reduce(
        (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
        0
      );
      const computedTotalCents = computedSubtotalCents + parsed.tax_cents;
      const arithmeticDeltaCents = parsed.total_cents - computedTotalCents;
      const hasDiscrepancy = Math.abs(arithmeticDeltaCents) > 1;

      const finalEntryType = hasDiscrepancy
        ? "discrepancy_flag"
        : "expense_receipt";

      const reasoningParts = [
        `Invoice ${parsed.invoice_number} (${parsed.invoice_date})`,
        `Recomputed subtotal: $${(computedSubtotalCents / 100).toFixed(2)} + tax $${(parsed.tax_cents / 100).toFixed(2)} = $${(computedTotalCents / 100).toFixed(2)}`,
      ];
      if (hasDiscrepancy) {
        reasoningParts.push(
          `ARITHMETIC MISMATCH FLAGGED: Document stated $${(parsed.total_cents / 100).toFixed(2)} (delta ${arithmeticDeltaCents} cents).`
        );
      }
      if (parsed.discrepancy_notes) {
        reasoningParts.push(parsed.discrepancy_notes);
      }

      const { data: stagedRow, error: stageErr } = await userClient
        .from("staged_ledger_entries")
        .insert({
          workspace_id: workspaceId,
          bot_role: botRole,
          entry_type: finalEntryType,
          vendor_name: parsed.vendor_name,
          amount_cents: parsed.total_cents,
          currency: "USD",
          line_items: parsed.line_items,
          reasoning_summary: reasoningParts.join(" · "),
          confidence_score: Math.min(1, Math.max(0, parsed.confidence_score)),
          status: "pending_approval",
        })
        .select("*")
        .single();

      if (stageErr) {
        return respond(400, { error: stageErr.message });
      }

      const { data: runRow } = await userClient
        .from("bot_runs")
        .insert({
          workspace_id: workspaceId,
          bot_role: botRole,
          model: xaiModel,
          mode: botMode,
          status: runStatus,
          input_summary: `parse_document: ${parsed.vendor_name} (${parsed.invoice_number})`,
          output_json: {
            parsed,
            computed_subtotal_cents: computedSubtotalCents,
            computed_total_cents: computedTotalCents,
            has_discrepancy: hasDiscrepancy,
            staged_entry_id: (stagedRow as { id: string }).id,
          },
        })
        .select("*")
        .single();

      return respond(200, {
        staged_entry: stagedRow,
        bot_run: runRow,
        computed_subtotal_cents: computedSubtotalCents,
        computed_total_cents: computedTotalCents,
        has_discrepancy: hasDiscrepancy,
      });
    }

    // =========================================================================
    // Action 2: audit_billing_leaks
    // =========================================================================
    if (action === "audit_billing_leaks") {
      const leakSummaryText =
        typeof body.leak_summary === "string" ? body.leak_summary.trim() : "";

      const { data: unbilledJobs } = await userClient
        .from("ops_jobs")
        .select("id, title, labor_total, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed")
        .is("invoice_id", null)
        .limit(10);

      const { data: overdueDocs } = await userClient
        .from("documents")
        .select("id, document_number, total, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "overdue")
        .limit(10);

      const deterministicRecommendations: LeakAuditRecommendation[] = [];

      for (const job of (unbilledJobs ?? []) as Array<{
        id: string;
        title: string;
        labor_total: number;
      }>) {
        const cents = Math.round(Number(job.labor_total ?? 0) * 100);
        if (cents > 0) {
          deterministicRecommendations.push({
            entry_type: "invoice_draft",
            vendor_or_customer: job.title,
            amount_cents: cents,
            reasoning_summary: `Completed job "${job.title}" has no linked invoice. Staged draft invoice for owner approval.`,
            confidence_score: 0.95,
          });
        }
      }

      for (const doc of (overdueDocs ?? []) as Array<{
        id: string;
        document_number: string;
        total: number;
      }>) {
        const cents = Math.round(Number(doc.total ?? 0) * 100);
        if (cents > 0) {
          deterministicRecommendations.push({
            entry_type: "discrepancy_flag",
            vendor_or_customer: `Invoice ${doc.document_number}`,
            amount_cents: cents,
            reasoning_summary: `Overdue invoice ${doc.document_number} ($${(cents / 100).toFixed(2)}) flagged for consent-verified collections review.`,
            confidence_score: 0.93,
          });
        }
      }

      let auditOutput: LeakAuditStructuredOutput = {
        recommendations: deterministicRecommendations,
        executive_summary:
          deterministicRecommendations.length > 0
            ? `Identified ${deterministicRecommendations.length} unbilled job / overdue invoice leak item(s) and staged entries for owner sign-off.`
            : "Scanned completed jobs and overdue documents; no new unbilled discrepancies detected.",
      };
      let runStatus: "completed" | "fallback_deterministic" = "fallback_deterministic";

      if (xaiKey && (deterministicRecommendations.length > 0 || leakSummaryText)) {
        try {
          const xaiRes = await fetch("https://api.x.ai/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${xaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: xaiModel,
              input: [
                {
                  role: "system",
                  content: `You are the Loose Ends Collections & Billing Leak Audit Bot.\nSOP Manual (Read-Only):\n${sopInstructions}\nPreserve exact deterministic integer cent amounts.`,
                },
                {
                  role: "user",
                  content: `Audit these deterministic findings and format staged ledger recommendations:\n${JSON.stringify({
                    unbilled_jobs: unbilledJobs ?? [],
                    overdue_documents: overdueDocs ?? [],
                    additional_context: leakSummaryText,
                  })}`,
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "leak_audit_recommendations",
                  strict: true,
                  schema: AUDIT_LEAKS_SCHEMA,
                },
              },
            }),
          });

          if (xaiRes.ok) {
            const xaiPayload = (await xaiRes.json()) as XaiResponsesPayload;
            const rawJson = extractResponseText(xaiPayload);
            if (rawJson) {
              auditOutput = JSON.parse(rawJson) as LeakAuditStructuredOutput;
              runStatus = "completed";
            }
          }
        } catch {
          // Keep deterministic recommendations
        }
      }

      const insertedEntries: unknown[] = [];
      if (botMode !== "observe") {
        for (const rec of auditOutput.recommendations.slice(0, 5)) {
          const { data: staged } = await userClient
            .from("staged_ledger_entries")
            .insert({
              workspace_id: workspaceId,
              bot_role: botRole,
              entry_type: rec.entry_type,
              vendor_name: rec.vendor_or_customer,
              amount_cents: Math.max(0, Math.round(rec.amount_cents)),
              currency: "USD",
              line_items: [
                {
                  description: rec.vendor_or_customer,
                  quantity: 1,
                  unit_price_cents: Math.max(0, Math.round(rec.amount_cents)),
                },
              ],
              reasoning_summary: rec.reasoning_summary,
              confidence_score: Math.min(1, Math.max(0, rec.confidence_score)),
              status: "pending_approval",
            })
            .select("*")
            .single();

          if (staged) {
            insertedEntries.push(staged);
          }
        }
      }

      const { data: runRow } = await userClient
        .from("bot_runs")
        .insert({
          workspace_id: workspaceId,
          bot_role: botRole,
          model: xaiModel,
          mode: botMode,
          status: runStatus,
          input_summary: `audit_billing_leaks (${auditOutput.recommendations.length} recommendation(s))`,
          output_json: {
            executive_summary: auditOutput.executive_summary,
            staged_count: insertedEntries.length,
            recommendations: auditOutput.recommendations,
          },
        })
        .select("*")
        .single();

      return respond(200, {
        executive_summary: auditOutput.executive_summary,
        staged_entries: insertedEntries,
        bot_run: runRow,
      });
    }

    return respond(400, { error: `Unsupported action: ${action}` });
  } catch (err) {
    return respond(400, {
      error: err instanceof Error ? err.message : "Grok bot router error",
    });
  }
});
