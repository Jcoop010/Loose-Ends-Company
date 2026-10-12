import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function verifyStripeSignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = new TextEncoder().encode(timestamp + "." + rawBody);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const expectedHex = Array.from(expected).map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => {
    if (signature.length !== expectedHex.length) return false;
    let diff = 0;
    for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ expectedHex.charCodeAt(i);
    return diff === 0;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) return json({ error: "Webhook is not configured." }, 503);
  const rawBody = await req.text();
  const signature = req.headers.get("Stripe-Signature") || "";
  if (!await verifyStripeSignature(rawBody, signature, secret)) return json({ error: "Invalid webhook signature." }, 400);
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: ledgerError } = await admin.from("stripe_webhook_events").insert({
    event_id: event.id, event_type: event.type, livemode: Boolean(event.livemode), payload: event,
  });
  if (ledgerError) {
    if (ledgerError.code === "23505") return json({ received: true, duplicate: true });
    console.error("Could not persist Stripe event", ledgerError);
    return json({ error: "Could not record event." }, 500);
  }

  try {
    const obj = event.data?.object || {};
    const eventType = String(event.type || "");
    const subscription = eventType.startsWith("customer.subscription.") ? obj : null;
    const checkout = eventType === "checkout.session.completed" ? obj : null;
    const invoice = eventType.startsWith("invoice.") ? obj : null;
    const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
    const subscriptionId = subscription?.id ||
      (typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id) ||
      (checkout && typeof checkout.subscription === "string" ? checkout.subscription : null);
    let workspaceId = obj.metadata?.workspace_id || checkout?.client_reference_id || null;
    if (!workspaceId && customerId) {
      const { data: row } = await admin.from("workspace_subscriptions").select("workspace_id")
        .eq("provider_customer_id", customerId).maybeSingle();
      workspaceId = row?.workspace_id || null;
    }
    if (!workspaceId && subscriptionId) {
      const { data: row } = await admin.from("workspace_subscriptions").select("workspace_id")
        .eq("provider_subscription_id", subscriptionId).maybeSingle();
      workspaceId = row?.workspace_id || null;
    }
    if (workspaceId && (
      eventType === "checkout.session.completed" ||
      eventType.startsWith("customer.subscription.") ||
      eventType === "invoice.payment_succeeded" ||
      eventType === "invoice.paid" ||
      eventType === "invoice.payment_failed" ||
      eventType === "invoice.payment_action_required"
    )) {
      let status = "incomplete";
      let periodStart: string | null = null;
      let periodEnd: string | null = null;
      let cancelAtPeriodEnd = false;
      let providerSubscriptionId = subscriptionId;
      let providerCustomerId = customerId;
      let planKey = obj.metadata?.plan_key || checkout?.metadata?.plan_key || "revenue_recovery";
      if (subscription) {
        status = String(subscription.status || "incomplete");
        periodStart = subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null;
        periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
        cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
        providerCustomerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
        planKey = subscription.metadata?.plan_key || planKey;
      } else if (eventType === "checkout.session.completed") {
        status = checkout?.payment_status === "paid" || checkout?.status === "complete" ? "active" : "incomplete";
      } else if (invoice) {
        status = eventType === "invoice.payment_failed" || eventType === "invoice.payment_action_required" ? "past_due" : "active";
      }
      if (eventType === "customer.subscription.deleted") status = "canceled";
      const { error: upsertError } = await admin.from("workspace_subscriptions").upsert({
        workspace_id: workspaceId,
        provider: "stripe",
        provider_customer_id: providerCustomerId || null,
        provider_subscription_id: providerSubscriptionId || null,
        plan_key: planKey,
        status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" });
      if (upsertError) throw upsertError;
    }
    await admin.from("stripe_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null }).eq("event_id", event.id);
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    console.error("Stripe webhook processing failed", event.id, message);
    await admin.from("stripe_webhook_events").update({ processing_error: message }).eq("event_id", event.id);
    return json({ error: "Webhook processing failed." }, 500);
  }
});
