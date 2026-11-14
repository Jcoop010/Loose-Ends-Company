# Stripe TEST-MODE Setup Checklist — single runbook (2026-11-15)

> **Never place secret keys in source code, GitHub issues, logs, chat, screenshots, or commit messages. Only env-var NAMES appear here. Values are set by the owner directly in provider dashboards and are never echoed.**
> Prerequisite gates: canonical-domain 301 in place (or explicitly deferring), legal drafts approved or explicit owner go-ahead, disposable test environment ready.

## A. Stripe — test mode provisioning (owner, ~10 min)
- [ ] In the SAME Stripe account, enable **Test mode** (toggle top-right). Test and live data are segregated; the live price and any live customers stay untouched.
- [ ] Create Product `Loose Ends OS (TEST)` → Price **$199.00 / month recurring (USD)** → copy the test `price_…` ID into the password manager (never into a file).
- [ ] Confirm **no live products/prices were created or edited**.
- [ ] Create webhook endpoint for the STAGING functions: `<staging-functions-base>/stripe-webhook` with events:
      `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`
      → copy the resulting test `whsec_…` to the functions env (below).
- [ ] Note test card set for the run (4242… succeeds; 4000 0000 0000 0341 3DS; 4000 0000 0000 9995 decline) — public Stripe test cards, safe to list.

## B. Supabase — disposable test environment (owner decision)
**Preferred: Supabase preview branch** of the existing project (keeps schema parity), or a **separate disposable project** seeded from migrations. Either way:
- [ ] Apply all migrations from `supabase/migrations/` including the webhook RPCs; confirm `stripe_webhook_events`, `workspace_subscriptions` tables exist with seed rows absent.
- [ ] Deploy the three functions to staging: `create-subscription-checkout`, `create-billing-portal`, `stripe-webhook`. Set secrets in function env (names only): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (staging values), `STRIPE_SECRET_KEY` (sk_test…), `STRIPE_WEBHOOK_SECRET` (whsec_… from test endpoint).
- [ ] Verify the function env ONLY — never bake keys into source, config maps, or `.env` commits.
- [ ] Reject the "temporarily swap live secrets" option: the production RPCs enforce livemode↔key-mode and workspace billing-mode matches — swapping secrets would brick production checkout (by design) and risk live-data entitlements leaking test state.

## C. Disposable users and workspaces
- [ ] Sign up **User A** (workspace owner) and **User B** (workspace admin) in the disposable env; invite B into A's workspace. Note User B is non-owner for RBAC assertions (T2).
- [ ] Create **User C** → fresh workspace, never check out (its 14-day trial exists by seed; use to verify gate blocks after simulated trial end, or set `current_period_end` to the past for the test via SQL fixture with explicit owner-run rollback).
- [ ] Confirm no real customer email addresses or records are used; everything in the disposable env is synthetic.

## D. Stripe test clocks (renewal/failure simulation)
- [ ] Create one test clock; attach the customer/subscription from T4 to it; advance by 30+ days for T10/T11/T13 (renewal, past_due recovery, cancellation end).

## E. Secret hygiene verification (owner + agent, ~5 min)
- [ ] `grep -ri "sk_live\|sk_test\|rk_live\|rk_test\|whsec_"` across the two repos — expect **zero** hits (scripts only reference variable NAMES).
- [ ] Confirm GitHub push protection / secret scanning enabled (owner action in Settings if not).
- [ ] Confirm no secrets in workflow run logs; none in commits; none in issues (spot-check #41/#52/#53/#54).
- [ ] After the run: rotate `whsec_…` and test keys once tests complete; revoke disposable users; snapshot evidence BEFORE rotation/revocation.

## F. Execution order (maps to T1–T20 in docs/STRIPE-TEST-MODE-ACCEPTANCE.md)
1. T1–T2 (auth/RBAC rejections) → 2. T3 (idempotent session) → 3. T4 (happy path) → 4. T5–T7 (signature/replay/mode) → 5. T8–T11 (payment lifecycle + test clock) → 6. T12–T14 (cancel/refund) → 7. T15–T17 (out-of-order/tampering) → 8. T18–T20 (fail-closed + concurrency).
Evidence per step: HTTP status + response body (no secrets), function log excerpt, DB row excerpt (IDs only), Stripe dashboard screenshot counter.

## G. Go / No-Go
All T1–T20 pass AND evidence attached AND rollback rehearsed (revert PR) AND legal gates or explicit written owner risk-acceptance → **Go** for a soft live founding run. Any failure → stop, fix in staging, re-run failed tier only. No live keys are issued to the app during this phase under any circumstances.

## H. What this checklist deliberately excludes
No live-mode tests. No price/product edits in live mode. No charge creation. No customer data import. No promotion-code changes (audit is a separate owner action). No new infrastructure (preview branch / existing project only, per owner budget).
