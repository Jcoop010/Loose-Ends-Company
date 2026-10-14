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
  // Never let a valid test-mode webhook mutate live-mode entitlements (or vice versa).
  // Stripe credentials are environment-specific, independent of signature validity.
  if (typeof event.livemode !== "boolean" ||
      (!stripeSecret.startsWith("sk_live_") && !stripeSecret.startsWith("sk_test_") &&
       !stripeSecret.startsWith("rk_live_") && !stripeSecret.startsWith("rk_test_")) ||
      ((stripeSecret.startsWith("sk_live_") || stripeSecret.startsWith("rk_live_")) && !event.livemode) ||
      ((stripeSecret.startsWith("sk_test_") || stripeSecret.startsWith("rk_test_")) && event.livemode)) {
    return json({ error: "Stripe event mode does not match billing configuration." }, 400);
  }
  if (typeof event.created !== "number" || !Number.isSafeInteger(event.created) ||
      event.created < 0 || event.created > 8640000000) {
    return json({ error: "Invalid Stripe event creation timestamp." }, 400);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const claimToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await admin.rpc("claim_stripe_webhook_event", {
    p_event_id: event.id, p_event_type: event.type, p_livemode: event.livemode,
    p_token: claimToken, p_lease_seconds: 900,
  });
  if (claimError) {
    console.error("Could not claim Stripe event", claimError);
    return json({ error: "Could not record event." }, 500);
  }
  if (claim === "processed") return json({ received: true, duplicate: true });
  if (claim === "busy") return json({ error: "Webhook event is being processed." }, 503);
  if (claim !== "claimed") return json({ error: "Unexpected webhook claim state." }, 500);

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
    // Fail closed on malformed provider IDs before any billing mapping or Stripe API read.
    if (subscriptionId && (typeof subscriptionId !== "string" || !/^sub_[a-zA-Z0-9]+$/.test(subscriptionId))) {
      throw new Error("Invalid Stripe subscription identifier");
    }
    // Relevant subscription lifecycle notifications must carry an unambiguous ID;
    // a missing ID must never be resolved from customer metadata alone.
    if (eventType.startsWith("customer.subscription.") && !subscriptionId) {
      throw new Error("Stripe subscription event is missing its subscription identifier");
    }
    // Never create or overwrite a paid entitlement from a checkout missing a subscription.
    if (checkout?.mode === "subscription" && !subscriptionId) throw new Error("Subscription checkout is missing its subscription identifier");
    const subscriptionInvoice = Boolean(invoice && subscriptionId);
    const relevant = (eventType === "checkout.session.completed" && obj.mode === "subscription") ||
      ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"].includes(eventType) ||
      (subscriptionInvoice && (
        eventType === "invoice.payment_succeeded" || eventType === "invoice.paid" ||
        eventType === "invoice.payment_failed" || eventType === "invoice.payment_action_required"
      ));
    // Checkout workspace references must agree; never silently prefer metadata
    // over a conflicting client_reference_id when assigning paid access.
    if (checkout?.mode === "subscription" && obj.metadata?.workspace_id &&
        checkout.client_reference_id && obj.metadata.workspace_id !== checkout.client_reference_id) {
      throw new Error("Stripe checkout workspace references disagree");
    }
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
        if (!response.ok) {
          // Stripe may no longer return a deleted subscription. A signed deletion
          // event is only allowed to move entitlement state to canceled, never active.
          if (response.status === 404 && eventType === "customer.subscription.deleted") {
            liveSubscription = { ...subscription, status: "canceled" };
          } else {
            throw new Error(body?.error?.message || "Could not retrieve subscription from Stripe");
          }
        } else {
          liveSubscription = body;
        }
      }
      const allowedStatuses = new Set(["trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]);
      const status = liveSubscription?.status;
      if (typeof status !== "string" || !allowedStatuses.has(status)) {
        throw new Error("Invalid current Stripe subscription status");
      }
      const periodDate = (value: unknown): string | null => {
        if (value === undefined || value === null) return null;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
            value > 8640000000) throw new Error("Invalid Stripe subscription period timestamp");
        return new Date(value * 1000).toISOString();
      };
      const periodStart = periodDate(liveSubscription?.current_period_start);
      const periodEnd = periodDate(liveSubscription?.current_period_end);
      const cancellationValue = liveSubscription?.cancel_at_period_end;
      if (cancellationValue !== undefined && cancellationValue !== null && typeof cancellationValue !== "boolean") {
        throw new Error("Invalid Stripe cancellation flag");
      }
      const cancelAtPeriodEnd = cancellationValue ?? false;
      // Never write an entitlement using a mismatched provider response.
      // A stale/malformed API response must not redirect billing identities.
      if (!liveSubscription || typeof liveSubscription.id !== "string" || liveSubscription.id !== subscriptionId) {
        throw new Error("Stripe subscription response identifier mismatch");
      }
      const liveCustomerId = typeof liveSubscription.customer === "string"
        ? liveSubscription.customer : liveSubscription.customer?.id;
      if (typeof liveCustomerId !== "string" || !liveCustomerId.startsWith("cus_")) {
        throw new Error("Stripe subscription response is missing a valid customer identifier");
      }
      if (customerId && customerId !== liveCustomerId) {
        throw new Error("Stripe subscription customer identifier mismatch");
      }
      // The event may omit its customer ID. In that case its earlier mapping
      // checks never covered the customer returned by Stripe's live API.
      // Resolve that live customer before allowing a workspace entitlement write.
      const { data: liveCustomerMapping, error: liveCustomerMappingError } = await admin
        .from("workspace_subscriptions").select("workspace_id")
        .eq("provider_customer_id", liveCustomerId).maybeSingle();
      if (liveCustomerMappingError) throw liveCustomerMappingError;
      if (liveCustomerMapping && liveCustomerMapping.workspace_id !== workspaceId) {
        throw new Error("Stripe live customer belongs to a different workspace");
      }
      // A subscription's authenticated Stripe metadata must not contradict the
      // workspace selected from the signed event or existing provider mappings.
      const liveWorkspaceId = liveSubscription.metadata?.workspace_id;
      if (liveWorkspaceId && liveWorkspaceId !== workspaceId) {
        throw new Error("Stripe live subscription belongs to a different workspace");
      }
      // Only trusted subscription metadata may select a plan. Do not accept
      // arbitrary plan keys copied from stale checkout or event payloads.
      const livePlanKey = liveSubscription.metadata?.plan_key;
      if (livePlanKey !== undefined && (typeof livePlanKey !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(livePlanKey))) {
        throw new Error("Invalid Stripe subscription plan key");
      }
      // Stripe subscription state is authoritative for the plan. An event's
      // historical metadata must not overwrite current plan information.
      if (!livePlanKey && (obj.metadata?.plan_key || checkout?.metadata?.plan_key)) {
        throw new Error("Stripe subscription plan metadata is missing from current provider state");
      }
      const providerSubscriptionId = liveSubscription.id;
      const providerCustomerId = liveCustomerId;
      const planKey = liveSubscription?.metadata?.plan_key || obj.metadata?.plan_key || checkout?.metadata?.plan_key || "revenue_recovery";
      if (typeof planKey !== "string" || !["starter", "growth", "scale", "revenue_recovery"].includes(planKey)) {
        throw new Error("Invalid resolved Stripe subscription plan key");
      }
      // The live Stripe lookup is authoritative. A delayed deletion webhook must
      // not cancel a subscription that Stripe currently reports as active.
      // The 404 fallback above already sets canceled when the subscription is gone.
      // Do not turn a currently active subscription past_due solely because a
      // delayed invoice failure event arrived after recovery. The live Stripe
      // subscription status is the source of truth for entitlement state.
      // The database checks this worker's lease and commits entitlement +
      // event completion atomically. A stale worker cannot write after takeover.
      const { data: applied, error: upsertError } = await admin.rpc("apply_stripe_subscription_event", {
        p_event_id: event.id, p_token: claimToken, p_workspace_id: workspaceId,
        p_customer_id: providerCustomerId, p_subscription_id: providerSubscriptionId,
        p_plan_key: planKey, p_status: status, p_period_start: periodStart,
        p_period_end: periodEnd, p_cancel_at_period_end: cancelAtPeriodEnd,
        p_event_created: event.created,
      });
      if (upsertError || applied !== true) throw new Error("Stripe processing lease expired before entitlement update");
      return json({ received: true });
    }
    const { data: completed, error: completionError } = await admin.rpc("finish_stripe_webhook_event", {
      p_event_id: event.id, p_token: claimToken, p_error: null,
    });
    if (completionError || completed !== true) throw new Error("Stripe webhook processing lease expired before completion");
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    console.error("Stripe webhook processing failed", event.id, message);
    const { error: finishError } = await admin.rpc("finish_stripe_webhook_event", {
      p_event_id: event.id, p_token: claimToken, p_error: message,
    });
    if (finishError) console.error("Could not record Stripe webhook failure", finishError);
    return json({ error: "Webhook processing failed." }, 500);
  }
});
