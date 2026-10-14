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
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !stripeSecret || !supabaseUrl || !serviceKey) return json({ error: "Webhook is not configured." }, 503);
  const rawBody = await req.text();
  const signature = req.headers.get("Stripe-Signature") || "";
  if (!await verifyStripeSignature(rawBody, signature, secret)) return json({ error: "Invalid webhook signature." }, 400);
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }
  if (!event || typeof event.id !== "string" || !event.id.startsWith("evt_") ||
      typeof event.type !== "string" || !event.type ||
      !event.data || !event.data.object || typeof event.data.object !== "object") {
    return json({ error: "Invalid Stripe event." }, 400);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: ledgerError } = await admin.from("stripe_webhook_events").insert({
    event_id: event.id, event_type: event.type, livemode: Boolean(event.livemode),
  });
  if (ledgerError) {
    if (ledgerError.code === "23505") {
      const { data: existing, error: lookupError } = await admin.from("stripe_webhook_events").select("processed_at").eq("event_id", event.id).maybeSingle();
      if (lookupError || !existing) return json({ error: "Could not verify event processing state." }, 500);
      if (existing?.processed_at) return json({ received: true, duplicate: true });
      // An earlier attempt failed before completion; safely retry its idempotent upsert.
    } else {
      console.error("Could not persist Stripe event", ledgerError);
      return json({ error: "Could not record event." }, 500);
    }
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
      (checkout && typeof checkout.subscription === "string" ? checkout.subscription : null) ||
      (invoice?.parent?.subscription_details?.subscription || null);
    // Never create or overwrite a paid entitlement from a checkout missing a subscription.
    if (checkout?.mode === "subscription" && !subscriptionId) throw new Error("Subscription checkout is missing its subscription identifier");
    const subscriptionInvoice = Boolean(invoice && subscriptionId);
    const relevant = (eventType === "checkout.session.completed" && obj.mode === "subscription") ||
      eventType.startsWith("customer.subscription.") ||
      (subscriptionInvoice && (
        eventType === "invoice.payment_succeeded" || eventType === "invoice.paid" ||
        eventType === "invoice.payment_failed" || eventType === "invoice.payment_action_required"
      ));
    let workspaceId = obj.metadata?.workspace_id || checkout?.client_reference_id || null;
    if (relevant && !workspaceId && customerId) {
      const { data: row, error: mappingError } = await admin.from("workspace_subscriptions").select("workspace_id")
        .eq("provider_customer_id", customerId).maybeSingle();
      if (mappingError) throw mappingError;
      workspaceId = row?.workspace_id || null;
    }
    if (relevant && !workspaceId && subscriptionId) {
      const { data: row, error: mappingError } = await admin.from("workspace_subscriptions").select("workspace_id")
        .eq("provider_subscription_id", subscriptionId).maybeSingle();
      if (mappingError) throw mappingError;
      workspaceId = row?.workspace_id || null;
    }
    // A valid Stripe signature does not authorize changing another workspace's billing row.
    // Reject conflicts between event metadata and established provider identifiers.
    if (relevant && workspaceId && (customerId || subscriptionId)) {
      for (const [column, providerId] of [["provider_customer_id", customerId], ["provider_subscription_id", subscriptionId]] as const) {
        if (!providerId) continue;
        const { data: mapped, error: mappingError } = await admin.from("workspace_subscriptions")
          .select("workspace_id").eq(column, providerId).maybeSingle();
        if (mappingError) throw mappingError;
        if (mapped && mapped.workspace_id !== workspaceId) throw new Error("Stripe provider identifier belongs to a different workspace");
      }
    }
    if (relevant && !workspaceId) throw new Error("Could not map Stripe event to a workspace");
    if (workspaceId && relevant) {
      // Reconcile against Stripe's current state: webhook snapshots can arrive out of order.
      let liveSubscription: any = null;
      if (subscriptionId) {
        const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(subscriptionId), {
          headers: { Authorization: "Bearer " + stripeSecret },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "Could not retrieve subscription from Stripe");
        liveSubscription = body;
      }
      let status = String(liveSubscription?.status || "incomplete");
      let periodStart: string | null = liveSubscription?.current_period_start ? new Date(liveSubscription.current_period_start * 1000).toISOString() : null;
      let periodEnd: string | null = liveSubscription?.current_period_end ? new Date(liveSubscription.current_period_end * 1000).toISOString() : null;
      let cancelAtPeriodEnd = Boolean(liveSubscription?.cancel_at_period_end);
      const providerSubscriptionId = liveSubscription?.id || subscriptionId;
      const providerCustomerId = (typeof liveSubscription?.customer === "string" ? liveSubscription.customer : liveSubscription?.customer?.id) || customerId;
      const planKey = liveSubscription?.metadata?.plan_key || obj.metadata?.plan_key || checkout?.metadata?.plan_key || "revenue_recovery";
      if (eventType === "customer.subscription.deleted") status = "canceled";
      // Only subscription invoices reach this path. Reflect failed/action-required
      // subscription payments even if Stripe's subscription read still reports active
      // during its retry/dunning window; never downgrade a terminal subscription state.
      if (eventType === "invoice.payment_failed" || eventType === "invoice.payment_action_required") {
        if (!["canceled", "unpaid", "incomplete_expired"].includes(status)) status = "past_due";
      }
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
    const { error: completionError } = await admin.from("stripe_webhook_events")
      .update({ processed_at: new Date().toISOString(), processing_error: null }).eq("event_id", event.id);
    if (completionError) throw completionError;
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    console.error("Stripe webhook processing failed", event.id, message);
    await admin.from("stripe_webhook_events").update({ processing_error: message }).eq("event_id", event.id);
    return json({ error: "Webhook processing failed." }, 500);
  }
});
