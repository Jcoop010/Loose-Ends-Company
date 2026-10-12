# Loose Ends Co. billing setup

## Stripe catalog already created
- Product: Loose Ends Co. — Revenue Recovery OS
- Live monthly price: $499 USD
- Product ID: prod_VQbnlZ9Hqg8hNl
- Price ID: price_1UPkZjIS04s94hSMzuM0J6rF

No customer has been charged by creating this product/price.

## Webhook endpoint already created
- Endpoint ID: `we_1UPkc9IS04s94hSMcQ71l7OZ`
- URL: https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/stripe-webhook
- Events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.paid, invoice.payment_failed, invoice.payment_action_required

## Required Supabase Edge Function secrets
Open Supabase Dashboard → Project Settings → Edge Functions → Secrets for project `uehfvpnnoitgybsmdgef`. Add:
- `STRIPE_SECRET_KEY`: server-side live Stripe secret key. Never put this in browser code, GitHub, or chat.
- `STRIPE_PRICE_ID`: `price_1UPkZjIS04s94hSMzuM0J6rF`
- `STRIPE_WEBHOOK_SECRET`: signing secret shown for the webhook endpoint above in Stripe Dashboard → Developers → Webhooks.

Supabase already supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.

## Final activation checks
1. In Stripe Dashboard, enable the customer portal and allow payment-method updates, invoice viewing, and cancellation at period end.
2. Set the three secrets above in Supabase Edge Function secrets.
3. Test checkout and cancellation with an internal test workspace before promoting the app's billing UI to production. The connected Stripe account currently reports live mode; do not use a real customer card for a test.
4. Confirm the webhook endpoint shows successful deliveries and `workspace_subscriptions` changes only after signed events.
5. For one-time setup fees, audits, or other service charges, create separate explicit one-time prices/invoices after the amount and service terms are finalized. Do not reuse the monthly recurring price for one-time work.

## Security notes
- Checkout and portal functions require a valid Supabase session and workspace owner/admin membership.
- Webhook requests are authenticated with Stripe's signature and a five-minute timestamp tolerance.
- Webhook event IDs are recorded for idempotency; raw event payloads are not retained.
- Never trust a Checkout success redirect as proof of payment; use the verified webhook-synced subscription status.
