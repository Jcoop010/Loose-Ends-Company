# Single-plan Stripe checkout deployment

The production `create-subscription-checkout` Edge Function currently maps `starter`, `growth`, and `scale` to legacy Stripe prices. The verified live $199/month USD Stripe price is `price_1URCPvIS04s94hSMFJ9azsC8`.

To move **new checkout sessions only** to the approved plan while preserving existing subscriptions:

1. In the function's `prices` map, replace the three legacy entries with `revenue_recovery: "price_1URCPvIS04s94hSMFJ9azsC8"`.
2. Change the default plan key from `starter` to `revenue_recovery`.
3. Keep workspace membership and owner/admin authorization, existing subscription conflict checks, metadata, and success/cancel URLs unchanged.
4. Confirm the deployed `stripe-webhook` still accepts `revenue_recovery` (verified in version 7).
5. Deploy only the checkout Edge Function with JWT verification enabled; do not touch existing Stripe subscriptions or customers.
6. Validate unauthorized requests fail and an authorized owner obtains a Checkout Session with the $199 monthly price. Do not complete a live charge during testing.

**Release gate:** The existing three-plan checkout must not be advertised as the $199 plan until this function is updated and a read-only verification confirms the deployed code and price.
