import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CANONICAL_ORIGIN = "https://loose-ends-os.vercel.app";
const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
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
const json = (body: unknown, status = 200, origin = CANONICAL_ORIGIN) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });

async function stripePost(path: string, params: Record<string, string>, secret: string) {
  const body = new URLSearchParams(params);
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe request failed");
  return data;
}

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
    const prices: Record<string, string> = {
      starter: "price_1UPkrQIS04s94hSMACHur8dt",
      growth: "price_1UPkrXIS04s94hSMY1kbdPGi",
      scale: "price_1UPkZjIS04s94hSMzuM0J6rF",
    };
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
    const planKey = String(input.plan_key || "starter").toLowerCase();
    const priceId = prices[planKey];
    if (!priceId) return json({ error: "Choose a valid subscription plan." }, 400, origin);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
      return json({ error: "A valid workspace is required." }, 400, origin);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: member, error: memberError } = await admin.from("workspace_members")
      .select("workspace_id,role,workspaces(name)")
      .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (memberError || !member) return json({ error: "You do not have access to this workspace." }, 403, origin);
    if (!["owner", "admin"].includes(member.role)) return json({ error: "Only a workspace owner or admin can manage billing." }, 403, origin);

    const { data: subRow } = await admin.from("workspace_subscriptions")
      .select("provider_customer_id,status")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (subRow?.status === "active" || (subRow?.status === "trialing" && subRow?.provider_customer_id)) {
      return json({ error: "This workspace already has an active subscription. Use Manage Billing instead." }, 409, origin);
    }
    const params: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: origin + "/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/dashboard?billing=cancelled",
      client_reference_id: workspaceId,
      "metadata[workspace_id]": workspaceId,
      "metadata[user_id]": user.id,
      "metadata[plan_key]": planKey,
      "subscription_data[metadata][workspace_id]": workspaceId,
      "subscription_data[metadata][user_id]": user.id,
      "subscription_data[metadata][plan_key]": planKey,
      "customer_email": user.email || "",
      "billing_address_collection": "required",
      "allow_promotion_codes": "true",
    };
    if (subRow?.provider_customer_id) {
      delete params.customer_email;
      params.customer = subRow.provider_customer_id;
    }
    const session = await stripePost("checkout/sessions", params, stripeSecret);
    if (!session?.url) throw new Error("Stripe did not return a Checkout URL");
    return json({ url: session.url }, 200, origin);
  } catch (error) {
    console.error("create-subscription-checkout error", error);
    return json({ error: "Unable to start checkout. Please try again or contact support." }, 500, origin);
  }
});
