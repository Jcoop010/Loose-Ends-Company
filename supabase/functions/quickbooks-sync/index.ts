import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CANONICAL_ORIGIN = "https://loose-ends-os.vercel.app";
// Production Supabase APIs are not exposed to ephemeral Vercel preview deployments.
const ALLOWED_BROWSER_ORIGINS = new Set([CANONICAL_ORIGIN]);
function allowedBrowserOrigin(origin: string): string | null {
  if (!origin) return CANONICAL_ORIGIN;
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

Deno.serve(async (req: Request) => {
  const origin = allowedBrowserOrigin(req.headers.get("Origin") || "");
  if (!origin) return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
    status: 403, headers: { "Content-Type": "application/json", "Vary": "Origin" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405, origin);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseUrl || !anonKey) return json({ error: "QuickBooks bridge is not configured" }, 503, origin);

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401, origin);

    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
      return json({ error: "A valid workspace_id is required" }, 400, origin);
    }

    const { data: member, error: memberError } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError) return json({ error: "Could not verify workspace membership" }, 500, origin);
    if (!member) return json({ error: "Not a workspace member" }, 403, origin);

    const { data: connection, error } = await supabase
      .from("quickbooks_connections")
      .select("realm_id,status,last_sync_at,last_sync_count,last_error")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return json({ error: "Could not load QuickBooks connection status" }, 500, origin);

    const readyForOAuth = Boolean(Deno.env.get("INTUIT_CLIENT_ID") && Deno.env.get("INTUIT_CLIENT_SECRET"));
    return json({
      ok: true,
      workspace_id: workspaceId,
      connection: connection ?? { status: "disconnected" },
      ready_for_oauth: readyForOAuth,
      message: readyForOAuth
        ? "QuickBooks credentials are configured; OAuth connection and live sync still need to be completed and verified."
        : "QuickBooks sync bridge is installed. OAuth credentials are still required before live QBO API sync can run.",
    }, 200, origin);
  } catch (error) {
    console.error("quickbooks-sync error", error);
    return json({ error: "QuickBooks status check failed" }, 500, origin);
  }
});
