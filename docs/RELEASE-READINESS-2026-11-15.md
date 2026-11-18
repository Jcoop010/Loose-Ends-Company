# RELEASE-READINESS REPORT — one business, technically capable of accepting a subscription safely (2026-11-15)

Status: preparation complete. **No live billing activation. No production settings changed. No deploys.** PRs under review: #80 (commercial readiness), #81 DRAFT (entitlement gate).

## 1. Canonical domain — verified, recommendation delivered
Both aliases serve the SAME Vercel deployment (HTTP 200, identical bytes, ETag `c964f8bf…`, identical CSP/HSTS). Billing is allowlisted to `loose-ends-os.vercel.app` everywhere (4–5 Edge Functions + legacy api default + tests + README). `loose-ends-v3-1.vercel.app` has no code path in the billing chain.

**Recommendation: canonical = `https://loose-ends-os.vercel.app`.** Retire v3-1 as a 301 in the Vercel dashboard (owner action, 2 minutes, reversible). Alternative (v3-1 canonical) costs 4 function allowlist edits + redeploys — not recommended. Exact owner steps + verification + rollback: `docs/CANONICAL-DOMAIN-2026-11-15.md` (PR #80 @ 710ea49). No settings were changed.

## 2. Checkout 403 — root cause and smallest fix
Origin allowlist mismatch (v3-1 → not in `ALLOWED_BROWSER_ORIGINS`) ⇒ 403 before any Stripe call. Eliminated by the 301 redirect above (code unchanged) or the allowlist path (code + redeploy, not done). The legacy Vercel function is env-configurable (`APP_ORIGIN`, default unchanged). Live probes (anonymous + foreign origin): rejected, 401/403, no CORS leak — fail-closed as expected.

## 3. Subscription entitlement — traced, enforced (draft), tested
Lifecycle mapped: checkout → payment → webhook (HMAC, idempotent claim/lease RPCs, cross-workspace rejection, out-of-order reconciliation) → `apply_stripe_subscription_event` upsert → **no enforcement existed beyond this point**.
Implemented on branch `feat/entitlement-gate-draft-2026-11-15` (**draft PR #81**, NOT merged/applied):
- `v3.1/entitlement-gate.js` fail-closed gate (entitled: trialing/active unexpired; past_due denied by default, `allowPastDue` opt-in; unknown/missing ⇒ denied; fail-closed CTA).
- 8 unit scenarios pass; added as CI step (additive only).
- Draft migration `20261115000000_entitlement_gate_draft.sql` (`is_workspace_entitled(uuid, boolean)`) — **NOT APPLIED**; rolled-back SQL assertion suite `tests/entitlement-gate.sql` — **NOT EXECUTED** (needs disposable DB).
- New-workspace reality discovered: 14-day auto trial (`initialize_workspace_saas_state`) — gate treats trialing-expired as blocked; correct product behavior (subscribe to continue).
Not wired to `index.html` by design — wiring belongs to the live-launch checklist after legal + domain + sandbox gates clear.

## 4. Sandbox acceptance — pending credentials
T1–T20 (`docs/STRIPE-TEST-MODE-ACCEPTANCE.md`, PR #80): auth, workspace roles, idempotent checkout, happy path, signature rejection, replay, mode mismatch, dunning, unpaid, recovery, renewal (test clock), cancel, refund, out-of-order events, malicious metadata, fail-closed, portal preconditions, concurrent claim bursts.
Executed locally: all node test suites pass; typecheck green; build green; live read-only probes pass; SQL suite pending.
**Blocked on owner:** Stripe TEST keys · test-mode Price (never live keys) · disposable workspace + user · Stripe test clock. Then I execute T1–T20 and attach evidence.

## 5. Legal / support outstanding (from PR #80 docs/legal/)
Entity name + state of formation · mailing address · support + security contacts · refund Option A (14-day good-faith, recommended for review) vs Option B (no refunds) · governing law (WV assumed) · counsel review · publish approval for /legal/* + footer links · SUPPORT.md SLA decision. None published; no legal claims made.

## 6. Rollback
Nothing live changed this cycle, so rollback is standard: revert PR(s) → `main` → Vercel auto-redeploy (~1 min); no DB migrations applied; no Stripe changes. `.sql` and `entitlement-gate.js` are inert until applied/wired. Emergency procedure for live launch (post-sandbox): owner disables live Checkout sessions in Stripe; webhook then stops entitlement changes; existing subscriptions unaffected. Not yet rehearsed against a live launch — honest status.

## 7. Workflow consolidation — dependency check done (nothing disabled)
Verified against `verify.yml`, push/PR CI in profit-pulse-command, Vercel (no crons), Supabase (no DB-side dependencies), and cross-workflow references: none of the 11 scheduled discovery/scout/qualification workflows feed any active revenue, security, or release operation (`verify.yml` still runs the full Python+TS suites on every push/PR).
Reversible plan (owner go/no-go): for each of the 11 — GitHub → Actions → select workflow → **"Disable workflow"** (one click, reversible, preserves files/artifacts/ledgers) OR owner-approved commit removing `schedule:` blocks only, keeping `workflow_dispatch`. Keep: `verify.yml`. Financial ledgers, suppression lists, prospect records untouched either way. Expected effect: no revenue change, fresh Actions-minute headroom, no loss of CI coverage. Income-engines' push-path verification can be retained as CI.

## 8. Exact remaining owner actions
1. Vercel domain 301 redirect v3-1 → loose-ends-os (dashboard) + Supabase Site URL/allowlist check + Stripe webhook URL confirm.
2. Sign dispositions: refund Option A or B; entity/address/contacts; counsel review of the 4 legal drafts; publish approval.
3. Provision sandbox: test keys, test Price, disposable workspace/user, test clock. (Then T1–T20 executed, evidence attached.)
4. Entitlement wiring approval — order: legal pages live → domain redirect → T1–T20 pass → then merge #81 wiring step + apply migration (owner-run) → deploy.
5. Confirmation for the 11 workflows: disable (recommended) or keep; explicitly choose.
6. Promotion-code audit in live Stripe (confirm no stray 100% codes); confirm legacy `api/create-subscription-checkout.js` stays fail-closed as-is or is retired.
7. Founding-member launch timing (only after 4 completes): channel + copy approval ($199/mo draft in PR #80).
**Money: $0.00 revenue · $0.00 expenses. No orders, no deploys, no live billing changes this cycle.**
