import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(req: Request) {
  const requestedOrigin = req.headers.get("Origin") || "";
  let allowedOrigin = "https://loose-ends-os.vercel.app";
  try {
    const candidate = new URL(requestedOrigin);
    const host = candidate.hostname.toLowerCase();
    if (
      host === "loose-ends-os.vercel.app" ||
      (host.startsWith("loose-ends-v3-1-") && host.endsWith("-loose-ends-co.vercel.app"))
    ) {
      allowedOrigin = candidate.origin;
    }
  } catch {
    // Requests without a valid Origin receive the canonical origin header.
  }
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json(req, { error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseUrl || !anonKey) return json(req, { error: "QuickBooks bridge is not configured" }, 503);

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json(req, { error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
      return json(req, { error: "A valid workspace_id is required" }, 400);
    }

    const { data: member, error: memberError } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError) return json(req, { error: "Could not verify workspace membership" }, 500);
    if (!member) return json(req, { error: "Not a workspace member" }, 403);

    const { data: connection, error } = await supabase
      .from("quickbooks_connections")
      .select("realm_id,status,last_sync_at,last_sync_count,last_error")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return json(req, { error: "Could not load QuickBooks connection status" }, 500);

    const readyForOAuth = Boolean(Deno.env.get("INTUIT_CLIENT_ID") && Deno.env.get("INTUIT_CLIENT_SECRET"));
    return json(req, {
      ok: true,
      workspace_id: workspaceId,
      connection: connection ?? { status: "disconnected" },
      ready_for_oauth: readyForOAuth,
      message: readyForOAuth
        ? "QuickBooks credentials are configured; OAuth connection and live sync still need to be completed and verified."
        : "QuickBooks sync bridge is installed. OAuth credentials are still required before live QBO API sync can run.",
    });
  } catch (error) {
    console.error("quickbooks-sync error", error);
    return json(req, { error: "QuickBooks status check failed" }, 500);
  }
});
