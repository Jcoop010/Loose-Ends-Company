import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(file), "utf8");
const checks = [
  {
    file: "supabase/migrations/20261014111000_revoke_excess_client_table_privileges.sql",
    required: [
      "REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated",
      "REVOKE ALL ON TABLE public.public_leads FROM PUBLIC, anon, authenticated",
      "GRANT INSERT ON TABLE public.public_leads TO anon, authenticated",
      "GRANT SELECT ON TABLE public.quickbooks_connections TO authenticated",
      "GRANT SELECT ON TABLE public.workspace_subscriptions TO authenticated",
    ],
    description: "Client roles must not retain privileges outside RLS, public lead reads, or server-owned billing/integration writes.",
  },
  {
    file: "v3.1/live-product-layer.js",
    required: ["S.auth.onAuthStateChange", "Workspace fallback lookup failed", "activeWorkspaceId!==w.id", "audit logging needs attention"],
    description: "Live data must initialize after sign-in, recover missing nested workspace joins, switch subscriptions when workspaces change, and surface partial recovery-action failures.",
  },
  {
    file: "v3.1/auth-live.js",
    required: ["Workspace membership lookup failed", "Workspace record lookup failed", "Workspace membership is incomplete", "Could not create workspace"],
    description: "Authentication recovery must report workspace lookup/bootstrap failures instead of silently creating duplicate workspaces or claiming a live session.",
  },
  {
    file: "v3.1/autonomy-center.js",
    required: ["updated_at,recovered_amount,customers(first_name,last_name,phone)"],
    description: "The live opportunity scan must fetch recovered_amount so confirmed-recovered metrics reflect stored records.",
  },
  {
    file: "supabase/functions/bootstrap-workspace/index.ts",
    required: [
      "function allowedBrowserOrigin",
      '"Access-Control-Allow-Origin": origin',
      "Origin is not allowed.",
      "auth.getUser()",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    description: "Workspace bootstrap must authenticate the caller and reject untrusted browser origins before privileged workspace creation.",
  },
  {
    file: "supabase/functions/create-subscription-checkout/index.ts",
    required: [
      "auth.getUser()", "workspace_members", '["owner", "admin"]',
      "const prices: Record<string, string>", 'mode: "subscription"',
      "function allowedBrowserOrigin", '"Access-Control-Allow-Origin": origin',
      "const ALLOWED_BROWSER_ORIGINS = new Set([CANONICAL_ORIGIN])",
      '"https://loose-ends-os.vercel.app"',
      "Origin is not allowed.",
    ],
    description: "Checkout must authenticate users, authorize workspace billing admins, use an allowlisted plan, and reject untrusted browser origins.",
  },
  {
    file: "supabase/functions/create-billing-portal/index.ts",
    required: [
      "auth.getUser()", "workspace_members", '["owner", "admin"]',
      "billing_portal/sessions", "return_url:", "function allowedBrowserOrigin",
      '"Access-Control-Allow-Origin": origin', "Origin is not allowed.",
    ],
    description: "Billing portal must authenticate and authorize the workspace and reject untrusted browser origins.",
  },
  {
    file: "supabase/functions/workflow-runner/index.ts",
    required: ["function allowedBrowserOrigin", '"Access-Control-Allow-Origin": origin', "Origin is not allowed.", "auth.getUser()", "workspace_members"],
    description: "Workflow runner must reject untrusted browser origins and authorize users against workspace membership.",
  },
  {
    file: "supabase/functions/quickbooks-sync/index.ts",
    required: ["function allowedBrowserOrigin", '"Access-Control-Allow-Origin": origin', "Origin is not allowed.", "auth.getUser()", "workspace_members"],
    description: "QuickBooks bridge must reject untrusted browser origins and authorize workspace membership.",
  },
  {
    file: "supabase/functions/stripe-webhook/index.ts",
    required: [
      "verifyStripeSignature", "crypto.subtle.sign",
      "Date.now() / 1000 - Number(timestamp)) > 300",
      "claim_stripe_webhook_event", "finish_stripe_webhook_event", "claimToken",
    ],
    description: "Webhook must verify recent Stripe signatures and retain idempotent event-processing records.",
  },
  {
    file: "supabase/functions/workflow-runner/index.ts",
    required: [
      "auth.getUser()", "const oldRecord = event.payload?.old_record || {}",
      "matches(oldRecord, conditions)", "workspace_members", "workflow_events",
      'runError.code === "23505"', "duplicateLookupError",
    ],
    description: "Workflow runner must authenticate, scope execution to workspace membership/events, and handle concurrent idempotency conflicts safely.",
  },
  {
    file: "supabase/functions/quickbooks-sync/index.ts",
    required: [
      "auth.getUser()", "workspace_members", "quickbooks_connections",
      "ready_for_oauth", '"Access-Control-Allow-Origin": origin', 'req.method === "OPTIONS"',
      "const ALLOWED_BROWSER_ORIGINS = new Set([CANONICAL_ORIGIN])",
    ],
    description: "QuickBooks bridge must authenticate and verify workspace membership without claiming OAuth sync is live before credentials exist.",
  },
  {
    file: "supabase/migrations/20261013012951_lock_workflow_events_to_trusted_triggers.sql",
    required: [
      "SECURITY DEFINER", "SET search_path TO 'public', 'pg_temp'",
      "DROP POLICY IF EXISTS workflow_events_member_insert",
      "DROP POLICY IF EXISTS workflow_events_member_update",
    ],
    description: "Workflow event trigger must use a fixed search path and disallow client event injection/state edits.",
  },
  {
    file: "supabase/migrations/20261013013104_revoke_client_exec_emit_workflow_event.sql",
    required: [
      "REVOKE EXECUTE ON FUNCTION public.emit_workflow_event() FROM PUBLIC",
      "REVOKE EXECUTE ON FUNCTION public.emit_workflow_event() FROM anon",
      "REVOKE EXECUTE ON FUNCTION public.emit_workflow_event() FROM authenticated",
    ],
    description: "Client roles must not invoke the privileged trigger function directly.",
  },
  {
    file: "supabase/migrations/20261013191121_lock_workspace_ownership_fields.sql",
    required: [
      "REVOKE UPDATE ON TABLE public.workspaces FROM PUBLIC, anon, authenticated",
      "GRANT UPDATE (name, slug) ON TABLE public.workspaces TO authenticated",
      "DROP POLICY IF EXISTS workspace_member_update ON public.workspaces",
      "CREATE POLICY workspace_admin_update",
      "wm.role IN ('owner', 'admin')",
    ],
    description: "Workspace members must not change the canonical owner id or promote themselves via the membership bootstrap policy.",
  },
  {
    file: "supabase/migrations/20261013191419_lock_billing_entitlement_client_writes.sql",
    required: [
      "REVOKE UPDATE ON TABLE public.workspace_subscriptions FROM PUBLIC, anon, authenticated",
    ],
    description: "Clients cannot write subscription entitlement fields, even when they hold an admin role.",
  },
  {
    file: "supabase/migrations/20261013191217_lock_billing_and_integration_state.sql",
    required: [
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.workspace_subscriptions FROM PUBLIC, anon, authenticated",
      "DROP POLICY IF EXISTS subscriptions_admin_update ON public.workspace_subscriptions",
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.quickbooks_connections FROM PUBLIC, anon, authenticated",
      "DROP POLICY IF EXISTS quickbooks_connection_admin_update ON public.quickbooks_connections",
    ],
    description: "Paid entitlements and integration status must be changed only by trusted server-side functions.",
  },
  {
    file: "supabase/migrations/20261013192144_rate_limit_public_lead_capture.sql",
    required: [
      "CREATE OR REPLACE FUNCTION public.enforce_public_lead_rate_limit()",
      "SECURITY DEFINER",
      "pg_advisory_xact_lock",
      "recent_email_count >= 5",
      "recent_phone_count >= 5",
      "REVOKE EXECUTE ON FUNCTION public.enforce_public_lead_rate_limit() FROM anon",
      "CREATE TRIGGER enforce_public_lead_rate_limit",
    ],
    description: "Anonymous lead capture must throttle repeated submissions per normalized email and phone.",
  },
  {
    file: "supabase/migrations/20261013191555_revoke_client_workflow_run_writes.sql",
    required: [
      "REVOKE INSERT, UPDATE ON TABLE public.workflow_runs FROM PUBLIC, anon, authenticated",
    ],
    description: "Authenticated clients must not have table-level write privileges for workflow run state.",
  },
  {
    file: "supabase/migrations/20261013191448_lock_workflow_run_writes_to_service_role.sql",
    required: [
      "DROP POLICY IF EXISTS workflow_runs_member_insert ON public.workflow_runs",
      "DROP POLICY IF EXISTS workflow_runs_member_update ON public.workflow_runs",
      "CREATE POLICY workflow_runs_member_select",
      "TO authenticated",
      "public.is_workspace_member(workspace_id)",
    ],
    description: "Clients may read only their workspace's workflow runs and cannot forge execution status or approval metadata.",
  },
  {
    file: "supabase/migrations/20261013181010_tighten_workspace_policies_to_authenticated.sql",
    required: [
      "activity_events_member_insert ON public.activity_events",
      "workflow_events_member_select ON public.workflow_events",
      "workflow_runs_member_insert ON public.workflow_runs",
      "workspace_records_member_delete ON public.workspace_records",
      "workspace_settings_member_update ON public.workspace_settings",
      "TO authenticated",
      "public.is_workspace_member(workspace_id)",
    ],
    description: "Workspace-scoped RLS policies must be limited to authenticated clients while retaining membership and admin predicates.",
  },
];

for (const check of checks) {
  assert.ok(fs.existsSync(check.file), `Missing security-critical file: ${check.file}`);
  const source = read(check.file);
  const missing = check.required.filter((marker) => !source.includes(marker));
  assert.deepEqual(missing, [], `${check.description} Missing markers: ${missing.join(", ")}`);
}

const billingOrderingMigration = read("supabase/migrations/20261014182000_serialize_stripe_billing_events.sql");
for (const marker of [
  "pg_advisory_xact_lock", "stripe_last_event_created",
  "p_event_created >= v_last_created",
  "processing_token is distinct from p_token",
  "processing_lease_until <= clock_timestamp()",
  "processed_at = clock_timestamp()",
  "to service_role",
]) {
  assert.ok(billingOrderingMigration.includes(marker),
    `Stripe billing must retain serialized, fenced, monotonic processing: ${marker}`);
}
const billingWebhook = read("supabase/functions/stripe-webhook/index.ts");
assert.ok(billingWebhook.includes("p_event_created: event.created"),
  "Stripe billing RPC must receive the signed event creation time");
assert.ok(billingWebhook.includes('admin.rpc("apply_stripe_subscription_event"'),
  "Stripe entitlement updates must use the atomic billing RPC");
assert.ok(!billingWebhook.includes('from("workspace_subscriptions").upsert('),
  "Stripe webhook must not bypass the fenced entitlement RPC");

const originRestrictedFunctions = [
  "supabase/functions/bootstrap-workspace/index.ts",
  "supabase/functions/create-subscription-checkout/index.ts",
  "supabase/functions/create-billing-portal/index.ts",
  "supabase/functions/workflow-runner/index.ts",
  "supabase/functions/quickbooks-sync/index.ts",
];
for (const file of originRestrictedFunctions) {
  const source = read(file);
  assert.ok(!source.includes('"Access-Control-Allow-Origin": "*"'), `${file} must not allow wildcard CORS`);
  assert.ok(source.includes("https://loose-ends-os.vercel.app"), `${file} must allow the canonical app origin`);
  assert.ok(!source.includes("https://loose-ends-v3-1-"), `${file} must not expose production APIs to ephemeral preview deployments`);
  assert.ok(!source.includes('host.startsWith("loose-ends-v3-1-")'), `${file} must not trust arbitrary preview deployments`);
  assert.ok(!source.includes('host.endsWith("-loose-ends-co.vercel.app")'), `${file} must not trust arbitrary Vercel hosts`);
}
const runnerSource = read("supabase/functions/workflow-runner/index.ts");
assert.ok(runnerSource.includes("userDb.auth.getUser()"), "Workflow runner must authenticate with the caller JWT");
assert.ok(runnerSource.includes("const serviceKey = Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\")"), "Workflow runner must use the service role only after authenticating the caller");
assert.ok(runnerSource.includes("workspaceFor(userDb, user.id, requestedWorkspaceId)"), "Workflow runner must verify membership before privileged operations");
const workspacePolicyMigration = read("supabase/migrations/20261013181010_tighten_workspace_policies_to_authenticated.sql");
assert.ok(!/\bTO\s+public\b/i.test(workspacePolicyMigration), "Workspace-scoped policies must not target PUBLIC");
assert.ok(!/\bTO\s+anon\b/i.test(workspacePolicyMigration), "Workspace-scoped policies must not target anon");

console.log(`Passed ${checks.length} backend security regression checks plus billing-origin and workspace-role restrictions.`);
