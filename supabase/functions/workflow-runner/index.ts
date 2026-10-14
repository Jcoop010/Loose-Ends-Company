import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const CANONICAL_ORIGIN = "https://loose-ends-os.vercel.app";
// Production Supabase APIs are not exposed to ephemeral Vercel preview deployments.
const ALLOWED_BROWSER_ORIGINS = new Set([CANONICAL_ORIGIN]);
function allowedBrowserOrigin(origin: string): string | null {
  if (!origin) return CANONICAL_ORIGIN; // Permit trusted server-to-server callers without an Origin header.
  try {
    const candidate = new URL(origin);
    if (candidate.protocol === "https:" && ALLOWED_BROWSER_ORIGINS.has(candidate.origin)) return candidate.origin;
  } catch { /* Invalid Origin is rejected below. */ }
  return null;
}
function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(body: unknown, status = 200, origin = CANONICAL_ORIGIN) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function matches(record: any, conditions: any[]) {
  // Fail closed on malformed configurations rather than firing unintended actions.
  if (!Array.isArray(conditions)) return false;
  return conditions.every((c: any) => {
    if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.field !== "string" || !c.field || typeof c.operator !== "string") return false;
    const value = record?.[c.field];
    // Missing or nonnumeric fields must never satisfy numeric workflow conditions.
    if (["gt", "gte", "lt", "lte"].includes(c.operator)) {
      if (value === null || value === undefined || value === "" || c.value === null || c.value === undefined || c.value === "") return false;
      if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(c.value))) return false;
    }
    switch (c.operator) {
      case "equals": return String(value ?? "") === String(c.value ?? "");
      case "not_equals": return String(value ?? "") !== String(c.value ?? "");
      case "contains": return String(value ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
      case "gt": return Number(value) > Number(c.value);
      case "gte": return Number(value) >= Number(c.value);
      case "lt": return Number(value) < Number(c.value);
      case "lte": return Number(value) <= Number(c.value);
      case "exists": return value !== null && value !== undefined && value !== "";
      // Fail closed: a typo or unsupported operator must never trigger an action.
      default: return false;
    }
  });
}

function duplicateResult(run: any, workflowId: string) {
  // A failed or interrupted run can have partial side effects. Keep its event
  // pending and require review rather than re-executing or hiding the failure.
  const settled = ["completed", "waiting_approval"].includes(run.status);
  return {
    settled,
    result: {
      workflow_id: workflowId, run_id: run.id,
      status: settled ? "duplicate" : "blocked",
      run_status: run.status,
      ...(settled ? {} : { error: "An existing run is failed or unfinished. Review its history before retrying actions." }),
    },
  };
}

async function workspaceFor(db: any, userId: string, requestedWorkspaceId?: string | null) {
  let query = db.from("workspace_members").select("workspace_id").eq("user_id", userId);
  if (requestedWorkspaceId) query = query.eq("workspace_id", requestedWorkspaceId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data?.workspace_id || null;
}

function validatedDelayHours(value: unknown): number {
  const hours = value === undefined || value === null ? 0 : Number(value);
  if (!Number.isFinite(hours) || hours < 0 || hours > 8760) throw new Error("Workflow delay must be between 0 and 8760 hours");
  return hours;
}

async function executeActions(db: any, workspaceId: string, workflow: any, run: any, approvedBy: string | null = null) {
  const event = run.context?.event || {};
  const record = run.context?.record || event?.payload?.record || {};
  const entity = event.entity_type || "";
  const customerId = record.customer_id || (entity === "customers" ? record.id : null);
  const opportunityId = record.opportunity_id || (entity === "opportunities" ? record.id : null);
  const outputs: any[] = [];
  // Validate all actions before the first side effect; malformed later actions
  // must not leave earlier tasks or follow-ups created unnecessarily.
  if (!Array.isArray(workflow.actions)) throw new Error("Workflow actions must be an array");
  for (const action of workflow.actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("Invalid workflow action");
    if (action.type === "create_task" || action.type === "create_follow_up") validatedDelayHours(action.delay_hours);
    if (action.type === "create_task") {
      const priority = action.priority === undefined || action.priority === null ? 1 : Number(action.priority);
      if (action.priority === "" || !Number.isFinite(priority) || priority < 0) throw new Error("Workflow task priority must be a nonnegative finite number");
    }
    if (action.type === "update_opportunity") {
      const patch = action.patch;
      const allowed = new Set(["title", "reason", "status", "priority", "amount", "due_at"]);
      if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
          !Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key))) {
        throw new Error("Invalid opportunity update fields");
      }
      if ("amount" in patch && (patch.amount === null || patch.amount === "" || !Number.isFinite(Number(patch.amount)) || Number(patch.amount) < 0)) {
        throw new Error("Invalid opportunity amount");
      }
      if ("priority" in patch && (patch.priority === null || patch.priority === "" || !Number.isFinite(Number(patch.priority)) || Number(patch.priority) < 0)) {
        throw new Error("Invalid opportunity priority");
      }
    }
    if (!["create_task", "create_follow_up", "update_opportunity"].includes(action.type) || (action.type === "update_opportunity" && (!record.id || entity !== "opportunities"))) throw new Error(`Unsupported workflow action: ${String(action.type || "unknown")}`);
  }

  // All effects and run completion occur in one Postgres transaction.
  // A crashed request cannot leave a partially committed multi-action run.
  const { data: atomicOutputs, error: atomicError } = await db.rpc("complete_workflow_run_atomically", {
    p_run_id: run.id, p_workspace_id: workspaceId, p_approved_by: approvedBy,
  });
  if (atomicError) throw atomicError;
  if (!Array.isArray(atomicOutputs)) throw new Error("Atomic workflow execution did not return outputs");
  return atomicOutputs;
}

Deno.serve(async (req: Request) => {
  const origin = allowedBrowserOrigin(req.headers.get("Origin") || "");
  if (!origin) return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
    status: 403, headers: { "Content-Type": "application/json", "Vary": "Origin" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405, origin);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Authorization required" }, 401, origin);

    // Validate the caller with their own JWT before using the privileged client.
    const userDb = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userDb.auth.getUser();
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401, origin);

    const user = authData.user;
    const body = await req.json().catch(() => ({}));
    const requestedWorkspaceId = typeof body.workspace_id === "string" && body.workspace_id.trim() ? body.workspace_id.trim() : null;
    const workspaceId = await workspaceFor(userDb, user.id, requestedWorkspaceId);
    if (requestedWorkspaceId && !workspaceId) return json({ error: "You do not have access to the requested workspace." }, 403, origin);
    if (!workspaceId) return json({ error: "No workspace" }, 400, origin);

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) return json({ error: "Workflow execution is not configured." }, 503, origin);
    // Run records are server-owned. All reads/writes below are explicitly scoped to
    // the membership-verified workspace; clients cannot forge completion or approval fields.
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.approve_run_id) {
      const { data: membership, error: membershipError } = await db.from("workspace_members")
        .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
      if (membershipError) return json({ error: membershipError.message }, 500, origin);
      if (!membership || !["owner", "admin"].includes(String(membership.role || ""))) {
        return json({ error: "Only workspace owners or admins can approve workflow runs." }, 403, origin);
      }
      const { data: run, error: runError } = await db.from("workflow_runs").select("*")
        .eq("id", body.approve_run_id).eq("workspace_id", workspaceId).maybeSingle();
      if (runError) return json({ error: runError.message }, 500, origin);
      if (!run) return json({ error: "Run not found" }, 404, origin);
      if (run.status !== "waiting_approval") return json({ error: "Run is not awaiting approval", status: run.status }, 409, origin);

      const { data: workflow, error: workflowError } = await db.from("workflows").select("*")
        .eq("id", run.workflow_id).eq("workspace_id", workspaceId).maybeSingle();
      if (workflowError) return json({ error: workflowError.message }, 500, origin);
      if (!workflow) return json({ error: "Workflow not found" }, 404, origin);

      // Atomically claim an approval before executing any actions. Two owner clicks,
      // retries, or concurrent requests must never execute the same approved run twice.
      const { data: claimedRun, error: startError } = await db.from("workflow_runs")
        .update({ status: "running", started_at: new Date().toISOString(), error: null })
        .eq("id", run.id).eq("workspace_id", workspaceId).eq("status", "waiting_approval")
        .select("id").maybeSingle();
      if (startError) return json({ error: startError.message }, 500, origin);
      if (!claimedRun) return json({ error: "This run was already claimed or is no longer awaiting approval.", status: "conflict" }, 409, origin);

      try {
        const outputs = await executeActions(db, workspaceId, workflow, run, user.id);
        return json({ ok: true, status: "completed", run: { ...run, status: "completed" }, outputs }, 200, origin);
      } catch (error: any) {
        const message = error?.message || String(error);
        await db.from("workflow_runs").update({ status: "failed", error: message, completed_at: new Date().toISOString() })
          .eq("id", run.id).eq("workspace_id", workspaceId);
        return json({ error: message, status: "failed" }, 500, origin);
      }
    }

    const { data: events, error: eventsError } = await db.from("workflow_events").select("*")
      .eq("workspace_id", workspaceId).is("processed_at", null).order("created_at", { ascending: true }).limit(25);
    if (eventsError) return json({ error: eventsError.message }, 500, origin);
    const { data: workflows, error: workflowsError } = await db.from("workflows").select("*")
      .eq("workspace_id", workspaceId).eq("enabled", true);
    if (workflowsError) return json({ error: workflowsError.message }, 500, origin);

    const results: any[] = [];
    for (const event of events || []) {
      const eventType = String(event.event_type || "");
      const operation = eventType.split(":")[0];
      const entity = event.entity_type || "";
      const record = event.payload?.record || {};
      let eventHadError = false;

      for (const workflow of workflows || []) {
        const matchesCreated = workflow.trigger_type === "record_created" && operation === "insert";
        const matchesUpdated = workflow.trigger_type === "record_updated" && operation === "update";
        if ((!matchesCreated && !matchesUpdated) || (workflow.trigger_config?.entity_type || "") !== entity) continue;
        const conditions = workflow.conditions || [];
        if (!matches(record, conditions)) continue;
        // For condition-based update workflows, only fire when the record enters the matching state.
        // A later unrelated edit must not create duplicate overdue/completed follow-up tasks.
        const oldRecord = event.payload?.old_record || {};
        if (matchesUpdated && conditions.length > 0 && matches(oldRecord, conditions)) continue;

        const idempotencyKey = `${event.id}:${workflow.id}`;
        const { data: existing, error: existingError } = await db.from("workflow_runs").select("id,status,context,started_at")
          .eq("workspace_id", workspaceId).eq("workflow_id", workflow.id).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (existingError) {
          eventHadError = true;
          results.push({ workflow_id: workflow.id, status: "error", error: existingError.message });
          continue;
        }
        if (existing) {
          // Only new atomic-action runs can be safely resumed after interruption.
          // Legacy runs may have partial effects and always require manual review.
          const elapsed = Date.now() - Date.parse(String(existing.started_at || ""));
          if (existing.status === "running" && existing.context?.atomic_actions === true &&
              Number.isFinite(elapsed) && elapsed > 15 * 60 * 1000) {
            try {
              const outputs = await executeActions(db, workspaceId, workflow, existing);
              results.push({ workflow_id: workflow.id, status: "recovered", run_id: existing.id, outputs });
            } catch (error: any) {
              eventHadError = true;
              results.push({ workflow_id: workflow.id, status: "retry_pending",
                run_id: existing.id, error: error?.message || String(error) });
            }
            continue;
          }
          const duplicate = duplicateResult(existing, workflow.id);
          if (!duplicate.settled) eventHadError = true;
          results.push(duplicate.result);
          continue;
        }

        const waiting = workflow.mode !== "automatic";
        const { data: run, error: runError } = await db.from("workflow_runs").insert({
          workspace_id: workspaceId,
          workflow_id: workflow.id,
          trigger_event_id: event.id,
          status: waiting ? "waiting_approval" : "running",
          idempotency_key: idempotencyKey,
          context: { event, record, atomic_actions: true },
          started_at: new Date().toISOString(),
        }).select().single();

        if (runError) {
          // A concurrent runner may win the unique (workflow_id, idempotency_key)
          // insert after our earlier lookup. Treat that race as a duplicate, not a
          // failed event; the winning run owns execution for this event/workflow pair.
          if (runError.code === "23505") {
            const { data: duplicateRun, error: duplicateLookupError } = await db.from("workflow_runs").select("id,status,context,started_at")
              .eq("workspace_id", workspaceId).eq("workflow_id", workflow.id).eq("idempotency_key", idempotencyKey).maybeSingle();
            if (!duplicateLookupError && duplicateRun) {
              const duplicate = duplicateResult(duplicateRun, workflow.id);
              if (!duplicate.settled) eventHadError = true;
              results.push(duplicate.result);
              continue;
            }
          }
          eventHadError = true;
          results.push({ workflow_id: workflow.id, status: "error", error: runError.message });
          continue;
        }
        if (waiting) {
          results.push({ workflow_id: workflow.id, status: "waiting_approval", run_id: run.id });
          continue;
        }

        try {
          const outputs = await executeActions(db, workspaceId, workflow, run);
          results.push({ workflow_id: workflow.id, status: "completed", run_id: run.id, outputs });
        } catch (error: any) {
          const message = error?.message || String(error);
          await db.from("workflow_runs").update({ status: "failed", error: message, completed_at: new Date().toISOString() })
            .eq("id", run.id).eq("workspace_id", workspaceId);
          eventHadError = true;
          results.push({ workflow_id: workflow.id, status: "failed", run_id: run.id, error: message });
        }
      }

      if (!eventHadError) {
        const { error: markError } = await db.from("workflow_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", event.id).eq("workspace_id", workspaceId);
        if (markError) results.push({ event_id: event.id, status: "unprocessed", error: markError.message });
      } else {
        results.push({ event_id: event.id, status: "retry_pending" });
      }
    }

    return json({ processed_events: (events || []).length, results }, 200, origin);
  } catch (error: any) {
    return json({ error: error?.message || String(error) }, 500, origin);
  }
});
