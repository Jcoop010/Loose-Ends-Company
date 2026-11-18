# Loose Ends Co. — Stripe Test-Mode Acceptance Plan (2026-11-15, DRAFT — not executed)

> **Purpose:** verify the full billing path in **Stripe test mode** before any live customer pays. No live charges. Live price `price_1URCPvIS04s94hSMFJ9azsC8` stays untouched; a **separate test-mode Price** is created by the owner for this exercise (or test mode is used on the same Product with a test price — owner/Stripe decides).
> **Executing this plan does not authorize any live-mode test.** Live billing stays exactly as-is until the owner approves the "go live" step and the production deploy.

## Architecture under test (current repo state)
- Edge Function `create-subscription-checkout` — Supabase auth, workspace `owner|admin` role, single `revenue_recovery` plan → live $199 price today; **for test mode**: deploy a test-mode build (or test price) mapped in env, NEVER the live price.
- Edge Function `create-billing-portal` — Stripe customer portal (cancel/update payment method).
- Edge Function `stripe-webhook` — HMAC verify, livemode/secret-key match enforcement, idempotent claim → `claim_stripe_webhook_event` RPC → `apply_stripe_subscription_event` RPC (atomic entitlement + event completion).
- Vercel Function `api/create-subscription-checkout.js` — legacy duplicate found in repo (hosted-checkout creator, hardcoded `loose-ends-os.vercel.app` Origin). **Not production per 2026-10-25 verification (production = Supabase Edge Functions + Stripe webhook).** Question for owner: retire or keep-as-emergency-fallback. Do not deploy edits without approval; see PR note (Origin now env-configurable, default unchanged).

## Preconditions (owner to provide or confirm)
1. Stripe **test** secret key (`sk_test_…`) and test webhook signing secret for the staging Supabase functions (or a Supabase branch/project configured with test keys). Live keys never enter CI, repo, or chat.
2. Test-mode Price (e.g., $199/mo) — note ID; **do not create products in live mode for this test**.
3. A disposable test Supabase project OR strict "test data only" discipline in production tables with rollback verified (`tests/stripe-billing-transactions.sql` suite validates transactions roll back).
4. Disposable test user + disposable workspace (owner/admin role) created for the test; credentials handed over securely; deleted/rolled back after.
5. Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (3DS), `4000 0000 0000 9995` (decline), Stripe test clock for renewal aging.
6. App deployed from the PR branch or local run with functions reachable.

## Acceptance scenarios (execute in order)
| # | Scenario | Expected | Evidence |
|---|---|---|---|
| T1 | Anonymous POST → checkout | 401/403, no session created | response body; Stripe dashboard shows no new session |
| T2 | Workspace member (non-owner/admin) POST | 403 "Only a workspace owner or admin can manage billing." | same |
| T3 | Owner, valid workspace, idempotent double-submit | 200 with Checkout URL; Stripe shows exactly one session (Idempotency-Key) | session IDs match |
| T4 | Checkout happy path (4242…) | `checkout.session.completed` → webhook 200; `workspace_subscriptions` row `active`; dashboard shows subscription; access enabled | DB rows, function logs, UI screenshot |
| T5 | Invalid webhook signature | 400 "Invalid webhook signature."; no DB write | function logs; DB unchanged |
| T6 | Replayed webhook (same event id) | 200 `{duplicate: true}`; no state change | logs; DB unchanged |
| T7 | Mismatched-mode event (test event vs live secret) | 400 "Stripe event mode does not match billing configuration." | logs |
| T8 | `invoice.payment_failed` → dunning | status → `past_due`; access **degraded but** per policy; Stripe retries visible | DB status; Stripe dashboard |
| T9 | Payment failure → final failure (unpaid) | status `unpaid`; access removed; app respects entitlement (blocks premium views per policy) | DB + UI |
| T10 | Recovery from past_due (next invoice succeeds) | status → `active`; access restored | DB + UI |
| T11 | Renewal via test clock (advance 30d) | subscription renews; webhook processed; entitlement preserved; ledger unchanged (no double-count) | Stripe events; DB |
| T12 | Cancel via billing portal (cancel_at_period_end) | `cancel_at_period_end=true`; access until period end; webhook updates row | Stripe portal; DB |
| T13 | After period end | status → `canceled`; access removed | test clock; DB; UI |
| T14 | Refund via portal (Option A) | charge refunded; entitlement follows Stripe status; our ledger shows refund; customer-visible history intact | Stripe refund; DB; support note |
| T15 | Out-of-order/stale `invoice.payment_failed` after recovery | NOT downgraded (live Stripe state authoritative) | logs; DB remains `active` |
| T16 | Malicious metadata (wrong workspace plan key / conflicting client_reference_id) | 400 or safe ignore; never cross-workspace write | logs; DB unchanged |
| T17 | Plan/price mismatch: subscription created from unexpected price | plan_key validated against allowlist; unexpected → error, no entitlement | logs |
| T18 | Live-mode keys absent in test env → checkout/webhook fail closed | 503/"not configured", never silent success | logs |
| T19 | Portal: non-subscriber | 409 "No billing customer is linked yet." | UI + logs |
| T20 | Concurrent load on claim RPC (duplicate delivery bursts) | one `claimed`, rest `processed`/`busy`; single entitlement mutation | DB `stripe_webhook_events`; no duplicates |

## Also verify (own no-charge checks)
- The legacy `api/create-subscription-checkout.js` either 503s cleanly (no Stripe key) or is not reachable in production; documented in PR.
- `public/revenue-checkup.html` still renders and still points to `/dashboard`; no pricing elsewhere on site contradicts $199.
- `npm run build` + all CI suites green in the PR.

## Go / No-Go for live $199 onboarding
**Go** only when: T1–T20 all pass and are attached as evidence (screenshots/logs/exports), owner has approved legal pages (or explicitly logged in writing that they ship without counsel review), deployed function versions match repo source (checkout v14+/portal v10+/webhook v8+ or newer), and the deployed origin allowlist matches the actual serving domain (**confirm live domain vs. hardcoded `loose-ends-os.vercel.app`** — currently the live alias is `loose-ends-v3-1.vercel.app`; mismatch = checkout 403 for real customers).
**No-Go** (conditions that block): any failed acceptance row; unverified domain; missing legal pages without owner sign-off; any requirement to change **live** Stripe configuration without approval.

## Rollback plan (see PR body too)
Git revert of this PR → redeploy; database untouched (no migrations); Stripe untouched; env vars unchanged (APP_ORIGIN default preserves existing behavior). In a real incident (runaway charges): owner disables Stripe checkout sessions via Stripe dashboard (all-checkouts off) — reversible in minutes; workspace entitlement then blocks at renewal boundaries.

## Explicitly out of scope
No live transaction, no live-mode test, no promotion codes audit beyond flagging (see PR notes), no entitlement-enforcement rewrite (roadmap item after acceptance), no price changes beyond the $199 standardization.
