import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function matches(record: any, conditions: any[]) {
  return (conditions || []).every((c: any) => {
    const value = record?.[c.field];
    switch (c.operator) {
      case "equals": return String(value ?? "") === String(c.value ?? "");
      case "not_equals": return String(value ?? "") !== String(c.value ?? "");
      case "contains": return String(value ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
      case "gt": return Number(value) > Number(c.value);
      case "gte": return Number(value) >= Number(c.value);
      case "lt": return Number(value) < Number(c.value);
      case "lte": return Number(value) <= Number(c.value);
      case "exists": return value !== null && value !== undefined && value !== "";
      default: return true;
    }
  });
}

async function workspaceFor(db: any, userId: string) {
  const { data, error } = await db.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (error) throw error;
  return data?.workspace_id || null;
}

async function executeActions(db: any, workspaceId: string, workflow: any, run: any) {
  const event = run.context?.event || {};
  const record = run.context?.record || event?.payload?.record || {};
  const entity = event.entity_type || "";
  const customerId = record.customer_id || null;
  const opportunityId = record.opportunity_id || (entity === "opportunities" ? record.id : null);
  const outputs: any[] = [];

  for (const action of workflow.actions || []) {
    if (action.type === "create_task") {
      const { data, error } = await db.from("tasks").insert({
        workspace_id: workspaceId,
        customer_id: customerId,
        opportunity_id: opportunityId,
        title: action.title || "Workflow task",
        status: "open",
        priority: Number(action.priority || 1),
        due_at: new Date(Date.now() + Number(action.delay_hours || 0) * 3600000).toISOString(),
      }).select().single();
      if (error) throw error;
      outputs.push({ type: action.type, id: data?.id });
    } else if (action.type === "create_follow_up") {
      const { data, error } = await db.from("follow_ups").insert({
        workspace_id: workspaceId,
        customer_id: customerId,
        opportunity_id: opportunityId,
        channel: action.channel || "task",
        status: "pending",
        scheduled_at: new Date(Date.now() + Number(action.delay_hours || 0) * 3600000).toISOString(),
        message: action.message || "Workflow follow-up",
      }).select().single();
      if (error) throw error;
      outputs.push({ type: action.type, id: data?.id });
    } else if (action.type === "update_opportunity" && record.id && entity === "opportunities") {
      const input = action.patch || {};
      const patch: Record<string, unknown> = {};
      for (const key of ["title", "reason", "status", "priority", "amount", "due_at"]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key];
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from("opportunities").update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", record.id).eq("workspace_id", workspaceId);
        if (error) throw error;
      }
      outputs.push({ type: action.type, id: record.id });
    }
  }
  return outputs;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Authorization required" }, 401);

    const db = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const user = authData.user;
    const body = await req.json().catch(() => ({}));
    const workspaceId = await workspaceFor(db, user.id);
    if (!workspaceId) return json({ error: "No workspace" }, 400);

    if (body.approve_run_id) {
      const { data: run, error: runError } = await db.from("workflow_runs").select("*")
        .eq("id", body.approve_run_id).eq("workspace_id", workspaceId).maybeSingle();
      if (runError) return json({ error: runError.message }, 500);
      if (!run) return json({ error: "Run not found" }, 404);
      if (run.status !== "waiting_approval") return json({ error: "Run is not awaiting approval", status: run.status }, 409);

      const { data: workflow, error: workflowError } = await db.from("workflows").select("*")
        .eq("id", run.workflow_id).eq("workspace_id", workspaceId).maybeSingle();
      if (workflowError) return json({ error: workflowError.message }, 500);
      if (!workflow) return json({ error: "Workflow not found" }, 404);

      const { error: startError } = await db.from("workflow_runs")
        .update({ status: "running", started_at: new Date().toISOString(), error: null })
        .eq("id", run.id).eq("workspace_id", workspaceId);
      if (startError) return json({ error: startError.message }, 500);

      try {
        const outputs = await executeActions(db, workspaceId, workflow, run);
        const { data: done, error: doneError } = await db.from("workflow_runs")
          .update({ status: "completed", result: { outputs, approved_by: user.id }, approved_by: user.id, completed_at: new Date().toISOString() })
          .eq("id", run.id).eq("workspace_id", workspaceId).select().single();
        if (doneError) throw doneError;
        return json({ ok: true, status: "completed", run: done, outputs });
      } catch (error: any) {
        const message = error?.message || String(error);
        await db.from("workflow_runs").update({ status: "failed", error: message, completed_at: new Date().toISOString() })
          .eq("id", run.id).eq("workspace_id", workspaceId);
        return json({ error: message, status: "failed" }, 500);
      }
    }

    const { data: events, error: eventsError } = await db.from("workflow_events").select("*")
      .eq("workspace_id", workspaceId).is("processed_at", null).order("created_at", { ascending: true }).limit(25);
    if (eventsError) return json({ error: eventsError.message }, 500);
    const { data: workflows, error: workflowsError } = await db.from("workflows").select("*")
      .eq("workspace_id", workspaceId).eq("enabled", true);
    if (workflowsError) return json({ error: workflowsError.message }, 500);

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
        if (!matches(record, workflow.conditions || [])) continue;

        const idempotencyKey = `${event.id}:${workflow.id}`;
        const { data: existing, error: existingError } = await db.from("workflow_runs").select("id,status")
          .eq("workspace_id", workspaceId).eq("workflow_id", workflow.id).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (existingError) {
          eventHadError = true;
          results.push({ workflow_id: workflow.id, status: "error", error: existingError.message });
          continue;
        }
        if (existing) {
          results.push({ workflow_id: workflow.id, status: "duplicate", run_id: existing.id });
          continue;
        }

        const waiting = workflow.mode !== "automatic";
        const { data: run, error: runError } = await db.from("workflow_runs").insert({
          workspace_id: workspaceId,
          workflow_id: workflow.id,
          trigger_event_id: event.id,
          status: waiting ? "waiting_approval" : "running",
          idempotency_key: idempotencyKey,
          context: { event, record },
          started_at: new Date().toISOString(),
        }).select().single();

        if (runError) {
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
          const { error: completeError } = await db.from("workflow_runs")
            .update({ status: "completed", result: { outputs }, completed_at: new Date().toISOString() })
            .eq("id", run.id).eq("workspace_id", workspaceId);
          if (completeError) throw completeError;
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

    return json({ processed_events: (events || []).length, results });
  } catch (error: any) {
    return json({ error: error?.message || String(error) }, 500);
  }
});