import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(file), "utf8");
const checks = [
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
    file: "supabase/functions/create-subscription-checkout/index.ts",
    required: [
      "auth.getUser()", "workspace_members", '["owner", "admin"]',
      "const prices: Record<string, string>", 'mode: "subscription"',
      "function allowedBrowserOrigin", '"Access-Control-Allow-Origin": origin',
      'host === "loose-ends-os.vercel.app"', "Origin is not allowed.",
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
    file: "supabase/functions/stripe-webhook/index.ts",
    required: [
      "verifyStripeSignature", "crypto.subtle.sign",
      "Date.now() / 1000 - Number(timestamp)) > 300",
      "stripe_webhook_events", "processed_at", 'ledgerError.code === "23505"',
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
      "ready_for_oauth", '"Access-Control-Allow-Origin"', 'req.method === "OPTIONS"',
      "loose-ends-v3-1-",
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
    file: "supabase/migrations/20261013180500_tighten_workspace_policies_to_authenticated.sql",
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
for (const file of [
  "supabase/functions/create-subscription-checkout/index.ts",
  "supabase/functions/create-billing-portal/index.ts",
]) {
  assert.ok(!read(file).includes('"Access-Control-Allow-Origin": "*"'), `${file} must not allow wildcard CORS`);
}
const workspacePolicyMigration = read("supabase/migrations/20261013180500_tighten_workspace_policies_to_authenticated.sql");
assert.ok(!/\\bTO\\s+public\\b/i.test(workspacePolicyMigration), "Workspace-scoped policies must not target PUBLIC");
assert.ok(!/\\bTO\\s+anon\\b/i.test(workspacePolicyMigration), "Workspace-scoped policies must not target anon");

console.log(`Passed ${checks.length} backend security regression checks plus billing-origin and workspace-role restrictions.`);
