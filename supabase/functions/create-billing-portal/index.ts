import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CANONICAL_ORIGIN = "https://loose-ends-os.vercel.app";
const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
function allowedBrowserOrigin(origin: string): string | null {
  if (!origin) return CANONICAL_ORIGIN;
  try {
    const candidate = new URL(origin);
    if (candidate.protocol !== "https:") return null;
    const host = candidate.hostname.toLowerCase();
    if (host === "loose-ends-os.vercel.app" ||
        (host.startsWith("loose-ends-v3-1-") && host.endsWith("-loose-ends-co.vercel.app"))) {
      return candidate.origin;
    }
  } catch { /* Invalid Origin is rejected below. */ }
  return null;
}
const json = (body: unknown, status = 200, origin = CANONICAL_ORIGIN) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  const origin = allowedBrowserOrigin(req.headers.get("Origin") || "");
  if (!origin) return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
    status: 403, headers: { "Content-Type": "application/json", "Vary": "Origin" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405, origin);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey || !stripeSecret) {
      return json({ error: "Billing is not configured yet. Please contact the administrator." }, 503, origin);
    }
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in is required." }, 401, origin);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return json({ error: "Your session is invalid. Please sign in again." }, 401, origin);
    const input = await req.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
      return json({ error: "A valid workspace is required." }, 400, origin);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: member, error: memberError } = await admin.from("workspace_members")
      .select("workspace_id,role")
      .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (memberError || !member) return json({ error: "You do not have access to this workspace." }, 403, origin);
    if (!["owner", "admin"].includes(member.role)) return json({ error: "Only a workspace owner or admin can manage billing." }, 403, origin);
    const { data: sub, error: subError } = await admin.from("workspace_subscriptions")
      .select("provider_customer_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (subError) throw subError;
    if (!sub?.provider_customer_id) return json({ error: "No billing customer is linked yet. Start a subscription first." }, 409, origin);
    const body = new URLSearchParams({ customer: sub.provider_customer_id, return_url: origin + "/dashboard?billing=returned" });
    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + stripeSecret, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Stripe portal request failed");
    if (!data?.url) throw new Error("Stripe did not return a billing portal URL");
    return json({ url: data.url }, 200, origin);
  } catch (error) {
    console.error("create-billing-portal error", error);
    return json({ error: "Unable to open billing portal. Please try again or contact support." }, 500, origin);
  }
});
