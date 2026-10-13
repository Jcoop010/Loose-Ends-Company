import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("authentication required");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("authentication required");

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    let slug = String(body.slug || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (!name) throw new Error("workspace name is required");
    if (!slug) slug = `workspace-${user.id.replaceAll("-", "").slice(0, 8)}`;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const existing = await admin.from("workspace_members").select("workspace_id,workspaces(*)").eq("user_id", user.id).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.workspaces) return new Response(JSON.stringify({ workspace: existing.data.workspaces }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let workspace: Record<string, unknown> | null = null;
    const created = await admin
      .from("workspaces")
      .insert({ name, slug, owner_user_id: user.id })
      .select("*")
      .single();

    if (!created.error) {
      workspace = created.data;
    } else if (created.error.code === "23505") {
      // Concurrent sign-up/auth callbacks may both attempt the same workspace.
      // Reuse it only when the authenticated user owns that exact slug.
      const { data, error } = await admin.from("workspaces").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      if (data?.owner_user_id === user.id) workspace = data;
      else throw new Error("workspace slug already exists");
    } else {
      throw created.error;
    }

    if (!workspace?.id) throw new Error("workspace_creation_failed");

    const { error: memberError } = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
    if (memberError) {
      if (memberError.code === "23505") {
        const { data: confirmed, error: confirmError } = await admin.from("workspace_members")
          .select("workspace_id").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
        if (confirmError) throw confirmError;
        if (confirmed) return new Response(JSON.stringify({ workspace }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Do not delete the workspace here: another concurrent request may
      // already have successfully attached the user to it.
      throw memberError;
    }

    return new Response(JSON.stringify({ workspace }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "workspace_bootstrap_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
