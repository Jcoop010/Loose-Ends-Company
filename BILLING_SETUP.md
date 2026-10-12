# Loose Ends Co. billing setup

## Stripe subscription catalog (live)
- **Starter — $49/month:** product `prod_VQc5GwVW28Bvne`, price `price_1UPkrQIS04s94hSMACHur8dt`
- **Growth — $149/month:** product `prod_VQc5OdsdGKIboq`, price `price_1UPkrXIS04s94hSMY1kbdPGi`
- **Scale — $499/month:** product `prod_VQbnlZ9Hqg8hNl`, price `price_1UPkZjIS04s94hSMzuM0J6rF`

Starter covers customer records, tasks, calendar, and manual follow-up tracking. Growth adds sales pipeline, revenue recovery workflows, documents, and intelligence. Scale adds advanced recovery intelligence, custom playbooks, priority implementation support, and a monthly strategy review. Do not promise delivery of hands-on services until an owner-operated fulfillment process is in place.

No customer has been charged by creating this product/price. The account is live mode, so do not run a test using a real card.

## Webhook endpoint already created
- Endpoint ID: `we_1UPkc9IS04s94hSMcQ71l7OZ`
- URL: https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/stripe-webhook
- Events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.paid, invoice.payment_failed, invoice.payment_action_required

## Customer billing portal
- Live portal configuration created and set as the Stripe default. Customers can update email/name/address, update payment methods, view invoices, and cancel at the end of the current period.

## Required Supabase Edge Function secrets
Open [Supabase Edge Function secrets](https://supabase.com/dashboard/project/uehfvpnnoitgybsmdgef/settings/functions) for project `uehfvpnnoitgybsmdgef`. Add these two required secrets:
- `STRIPE_SECRET_KEY`: server-side live Stripe secret key. Never put this in browser code, GitHub, or chat.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the endpoint ID `we_1UPkc9IS04s94hSMcQ71l7OZ`, shown in [Stripe Webhooks](https://dashboard.stripe.com/webhooks) after opening that endpoint.

Checkout uses a server-side allowlist of the three price IDs above. Do not let the browser submit arbitrary Stripe price IDs.

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
