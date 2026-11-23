import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CANONICAL_ORIGIN = "https://looseendsos.app";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const ALLOWED_BROWSER_ORIGINS = new Set([
  CANONICAL_ORIGIN,
  "https://www.looseendsos.app",
  "https://loose-ends-os.vercel.app",
]);

function allowedBrowserOrigin(origin: string): string | null {
  if (!origin) return CANONICAL_ORIGIN;
  try {
    const candidate = new URL(origin);
    if (candidate.protocol === "https:" && ALLOWED_BROWSER_ORIGINS.has(candidate.origin)) {
      return candidate.origin;
    }
  } catch {
    // Reject malformed origins below
  }
  return null;
}

const json = (body: unknown, status = 200, origin = CANONICAL_ORIGIN) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function stripePost(
  path: string,
  params: Record<string, string>,
  secret: string,
  idempotencyKey?: string,
) {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    Authorization: "Bearer " + secret,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe payment link creation failed");
  return data;
}

Deno.serve(async (req: Request) => {
  const origin = allowedBrowserOrigin(req.headers.get("Origin") || "");
  if (!origin) {
    return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Vary": "Origin", "Cache-Control": "no-store" },
    });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405, origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey || !stripeSecret) {
      return json({ error: "Invoice payments are not configured yet." }, 503, origin);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Sign in is required." }, 401, origin);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      return json({ error: "Your session is invalid. Please sign in again." }, 401, origin);
    }

    const input = await req.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || "");
    const invoiceId = String(input.invoice_id || "");
    const paymentMode = input.payment_mode === "deposit" ? "deposit" : "balance";

    if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(invoiceId)) {
      return json({ error: "Valid workspace and invoice identifiers are required." }, 400, origin);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: member, error: memberError } = await admin
      .from("workspace_members")
      .select("workspace_id,role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError || !member) {
      return json({ error: "You do not have access to this workspace." }, 403, origin);
    }
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Only a workspace owner or admin can issue invoice payment links." }, 403, origin);
    }

    const { data: inv, error: invError } = await admin
      .from("invoices")
      .select(
        "id,workspace_id,invoice_number,title,customer_name,customer_email,total_cents,amount_paid_cents,balance_due_cents,deposit_cents,status",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", invoiceId)
      .maybeSingle();

    if (invError || !inv) {
      return json({ error: "Invoice not found in this workspace." }, 404, origin);
    }

    if (inv.status === "paid" || inv.status === "void") {
      return json({ error: `Invoice ${inv.invoice_number} is already ${inv.status}.` }, 409, origin);
    }

    const totalCents = Number.isSafeInteger(inv.total_cents) ? Math.max(0, inv.total_cents) : 0;
    const paidCents = Number.isSafeInteger(inv.amount_paid_cents) ? Math.max(0, inv.amount_paid_cents) : 0;
    const remainingCents =
      typeof inv.balance_due_cents === "number" &&
      Number.isSafeInteger(inv.balance_due_cents) &&
      inv.balance_due_cents >= 0
        ? Math.min(Math.max(0, totalCents - paidCents), inv.balance_due_cents || Math.max(0, totalCents - paidCents))
        : Math.max(0, totalCents - paidCents);

    if (remainingCents <= 0) {
      return json({ error: "Invoice has zero remaining balance due." }, 409, origin);
    }

    const depositCents =
      typeof inv.deposit_cents === "number" && Number.isSafeInteger(inv.deposit_cents)
        ? Math.max(0, inv.deposit_cents)
        : 0;
    const useDeposit = paymentMode === "deposit" && paidCents === 0 && depositCents > 0 && depositCents < remainingCents;
    const amountCents = useDeposit ? depositCents : remainingCents;
    const resolvedPaymentType = useDeposit ? "deposit" : paidCents > 0 ? "partial" : "final";

    const idempotencyKey =
      req.headers.get("Idempotency-Key")?.trim() ||
      req.headers.get("X-Idempotency-Key")?.trim() ||
      `invlink_${workspaceId}_${invoiceId}_${paymentMode}_${amountCents}`;

    const stripeParams: Record<string, string> = {
      mode: "payment",
      "payment_method_types[0]": "card",
      "payment_method_types[1]": "us_bank_account",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amountCents),
      "line_items[0][price_data][product_data][name]": `${inv.invoice_number}: ${inv.title}`.slice(0, 120),
      "line_items[0][price_data][product_data][description]": useDeposit
        ? `Required deposit for ${inv.customer_name}`
        : `Invoice payment for ${inv.customer_name}`,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/dashboard/invoices?payment=success&invoice_id=${invoiceId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/invoices?payment=cancelled&invoice_id=${invoiceId}`,
      client_reference_id: invoiceId,
      "metadata[workspace_id]": workspaceId,
      "metadata[invoice_id]": invoiceId,
      "metadata[invoice_number]": String(inv.invoice_number || ""),
      "metadata[payment_type]": resolvedPaymentType,
      "payment_intent_data[metadata][workspace_id]": workspaceId,
      "payment_intent_data[metadata][invoice_id]": invoiceId,
      "payment_intent_data[metadata][invoice_number]": String(inv.invoice_number || ""),
      "payment_intent_data[metadata][payment_type]": resolvedPaymentType,
    };

    if (typeof inv.customer_email === "string" && inv.customer_email.includes("@")) {
      stripeParams.customer_email = inv.customer_email.trim();
    }

    const session = await stripePost("checkout/sessions", stripeParams, stripeSecret, idempotencyKey);
    if (!session?.url) {
      throw new Error("Stripe did not return a hosted payment session URL.");
    }

    const hosted = new URL(session.url);
    if (
      hosted.protocol !== "https:" ||
      (hosted.hostname !== "checkout.stripe.com" && hosted.hostname !== "buy.stripe.com")
    ) {
      throw new Error("Unexpected Stripe payment link destination.");
    }

    await admin
      .from("invoices")
      .update({
        stripe_checkout_url: session.url,
        stripe_payment_link_url: session.url,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", invoiceId);

    return json(
      {
        url: session.url,
        amount_cents: amountCents,
        payment_type: useDeposit ? "deposit" : "balance",
        payment_methods: ["card", "us_bank_account"],
      },
      200,
      origin,
    );
  } catch (error) {
    console.error("create-invoice-payment-link error", error);
    return json({ error: "Unable to create invoice payment link. Please retry." }, 500, origin);
  }
});
