# Billing processing repair — October 22, 2026

The production Stripe webhook version 7 called three absent database RPCs: claim_stripe_webhook_event, apply_stripe_subscription_event and finish_stripe_webhook_event. A configured webhook endpoint therefore did not establish that subscription activation could work.

The additive migrations restore service-role-only API wrappers, private implementations, event leases and retry state, atomic entitlement/event completion, event ordering checkpoints, live/test-mode isolation and unique provider-to-workspace mappings. They extend the existing subscription status constraint to include Stripe's incomplete_expired state. They do not alter existing subscriptions, prices, financial commitments or customer charges.

The repository now retains the unchanged deployed sources captured for stripe-webhook v7, create-subscription-checkout v13 and create-billing-portal v9. No new billing Edge Function version was deployed for this repair.

Actual PostgreSQL transaction tests executed activation, cancellation, stale events, duplicate delivery, invalid/expired lease ownership, lease takeover, failed-event recovery, environment/tenant rejection and API-role permissions. Every fixture was rolled back. Handler tests execute the deployed source with real HMAC signatures and mocked database/Stripe adapters; they test invalid signatures, timestamp tolerance, mode mismatch, provider identity, delayed invoice failure and deletion reconciliation.

This is not a provider checkout certification. Only a live Stripe account is connected, and no test-mode lifecycle or real charge was initiated. Secure sandbox checkout, signed provider delivery, activation, portal and cancellation acceptance remain blocked pending an authorized sandbox connection.
