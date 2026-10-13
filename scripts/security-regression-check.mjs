import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(file), "utf8");
const checks = [
  {
    file: "v3.1/autonomy-center.js",
    required: [
      "updated_at,recovered_amount,customers(first_name,last_name,phone)",
    ],
    description: "The live opportunity scan must fetch recovered_amount so the confirmed-recovered metric reflects stored records instead of silently showing zero.",
  },
  {
    file: "supabase/functions/create-subscription-checkout/index.ts",
    required: [
      "auth.getUser()",
      "workspace_members",
      '["owner", "admin"]',
      "const prices: Record<string, string>",
      'mode: "subscription"',
      'host === "loose-ends-os.vercel.app"',
    ],
    description: "Checkout must authenticate users, authorize workspace billing admins, use an allowlisted plan, and constrain return origins.",
  },
  {
    file: "supabase/functions/create-billing-portal/index.ts",
    required: [
      "auth.getUser()",
      "workspace_members",
      '["owner", "admin"]',
      "billing_portal/sessions",
      "return_url:",
    ],
    description: "Billing portal must authenticate and authorize the workspace before creating a Stripe portal session.",
  },
  {
    file: "supabase/functions/stripe-webhook/index.ts",
    required: [
      "verifyStripeSignature",
      "crypto.subtle.sign",
      "Date.now() / 1000 - Number(timestamp)) > 300",
      "stripe_webhook_events",
      "processed_at",
      'ledgerError.code === "23505"',
    ],
    description: "Webhook must verify recent Stripe signatures and retain idempotent event-processing records.",
  },
  {
    file: "supabase/functions/workflow-runner/index.ts",
    required: [
      "auth.getUser()",
      "workspace_members",
      "workflow_events",
      'runError.code === "23505"',
      "duplicateLookupError",
    ],
    description: "Workflow runner must authenticate, scope execution to workspace membership/events, and handle concurrent idempotency conflicts safely.",
  },
  {
    file: "supabase/functions/quickbooks-sync/index.ts",
    required: [
      "auth.getUser()",
      "workspace_members",
      "quickbooks_connections",
      "ready_for_oauth",
      '"Access-Control-Allow-Origin"',
      'req.method === "OPTIONS"',
      "loose-ends-v3-1-",
    ],
    description: "QuickBooks bridge must authenticate and verify workspace membership without claiming OAuth sync is live before credentials exist.",
  },
  {
    file: "supabase/migrations/20261013012951_lock_workflow_events_to_trusted_triggers.sql",
    required: [
      "SECURITY DEFINER",
      "SET search_path TO 'public', 'pg_temp'",
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
    description: "Client roles must not be able to invoke the privileged trigger function directly.",
  },
];

for (const check of checks) {
  assert.ok(fs.existsSync(check.file), `Missing security-critical file: ${check.file}`);
  const source = read(check.file);
  const missing = check.required.filter((marker) => !source.includes(marker));
  assert.deepEqual(missing, [], `${check.description} Missing markers: ${missing.join(", ")}`);
}

console.log(`Passed ${checks.length} backend security regression checks.`);
