# Canonical Production Domain — Verification & Recommendation (2026-11-15)

> Status: verification only. **Nothing was deployed and no production settings were changed.** Dashboard steps below require the owner.

## Observed facts (verified 2026-11-14/15)
| Check | `loose-ends-os.vercel.app` | `loose-ends-v3-1.vercel.app` |
|---|---|---|
| GET `/` | HTTP 200, byte-identical (Content-Length 5375, same ETag `c964f8bf…`) | HTTP 200, same build (Age 31731) |
| `/revenue-checkup.html` | 200, `$199/month` page | 200, same |
| HSTS / CSP / security headers | present (nosniff, frame-ancestors, Referrer-Policy) | identical |
| Server | Vercel | Vercel |
| Checkout Edge Functions allowlist | **allowed** (`CANONICAL_ORIGIN`) | **not in allowlist → checkout 403** |

Both aliases serve the same Vercel project/deployment. The repo, both billing Edge Functions, the legacy Vercel function default, and tests all point at `loose-ends-os.vercel.app`. Only the earlier planning artifacts (and my draft announcement — fixed in this PR) reference the v3-1 alias.

## Recommendation (owner decision)
**Canonical: `https://loose-ends-os.vercel.app`** — it is what the billing path already trusts. Retire the v3-1 alias as a 301 redirect at the Vercel domain layer (owner dashboard, one setting — cheaper and safer than expanding code allowlists).

If the owner prefers `loose-ends-v3-1.vercel.app` as canonical instead: code change required — add the alias to `ALLOWED_BROWSER_ORIGINS` in `create-subscription-checkout`, `create-billing-portal`, `customer-bulk-import`, `recovery-delivery-preflight` + redeploy functions + re-verify (or swap `CANONICAL_ORIGIN` and redeploy all four). That path also works but touches billing-adjacent code; do it only if the alias must stay primary.

## Exact owner dashboard steps (recommended path)
**Vercel (project ≈ "loose-ends-os"):** Domains → `loose-ends-v3-1.vercel.app` → "Redirect to" → `loose-ends-os.vercel.app` (301, preserve path). Do NOT delete the domain yet until redirect verified.
**Supabase:** Authentication → URL Configuration → Site URL = `https://loose-ends-os.vercel.app`; add `https://loose-ends-os.vercel.app/**` to redirect allowlist (remove the v3-1 alias if present — confirm before removing).
**Stripe:** confirm webhook endpoint = `https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/stripe-webhook` (or the staging endpoint used in testing) and that checkout success/cancel URLs (`{origin}/dashboard?billing=success|cancelled`) resolve on the canonical domain; no change expected.
**Verify after redirect:** `curl -sI -L https://loose-ends-v3-1.vercel.app/dashboard` → final `200` on loose-ends-os; sign in → open Billing → checkout reaches Stripe (test keys only).

## Rollback
Vercel: flip the domain redirect off/revert to "serves" — domain edit is reversible in minutes. No code deploy, no DB change, no Stripe change. If v3-1 misroutes, delete the redirect to restore previous behavior; code stays untouched.

## Checkout 403 elimination
Root cause: Origin not in Edge Function allowlist. Fix = redirect (allowlist unchanged) OR allowlist expansion (code + redeploy). Either is owner-approved work only; no settings were changed in this cycle.

## Pre-flight dependency matrix (verified in repo 2026-11-15)
| Dependency | Where | Canonical-OK? | Action needed |
|---|---|---|---|
| Edge Function allowlist `loose-ends-os.vercel.app` (create-subscription-checkout, create-billing-portal, customer-bulk-import, recovery-delivery-preflight) | `supabase/functions/*/index.ts` | ✓ | none |
| Legacy Vercel function default origin | `api/create-subscription-checkout.js` (`APP_ORIGIN` override, default unchanged) | ✓ | none (retire candidate only with owner decision) |
| Password-reset return URL `window.location.origin + '/dashboard'` | `v3.1/account-recovery.js` | ✓ inherits domain | none — resolves on canonical after 301 |
| Checkout success/cancel URLs (`{origin}/dashboard?billing=success|cancelled`) | billing Functions | ✓ adaptive | none |
| Stripe webhook endpoint `https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/stripe-webhook` | Stripe dashboard (not visible from repo) | n/a (host independent of site) | owner confirm it exists & secret stored in functions env |
| `/dashboard` route | `vercel.json` rewrites → `/index.html` | ✓ | none |
| Supabase Auth Site URL + redirect allowlist | Supabase dashboard (not visible from repo) | UNKNOWN — must contain only canonical (+ local dev entries) after change | owner: set Site URL = canonical; add `https://loose-ends-os.vercel.app/**`; remove v3-1 entries if present (confirm first) |
| Responses from billing RPCs (service_role only) | migrations | ✓ | none |

## Redirect runbook (owner dashboard — ~2 minutes)
1. Vercel → project (production) → Domains → `loose-ends-v3-1.vercel.app` → **Redirect to** `loose-ends-os.vercel.app` (301, preserve path). Leave the domain attached; do NOT delete.
2. Supabase → Authentication → URL Configuration → Site URL = `https://loose-ends-os.vercel.app`; allowlist `https://loose-ends-os.vercel.app/**` (+ `http://localhost:5173/**` if needed for dev); remove the v3-1 alias entries (confirm they exist first).
3. Stripe → Webhooks → confirm endpoint host (must remain `https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/stripe-webhook`); confirm `STRIPE_WEBHOOK_SECRET` lives in Supabase functions env, not in repo/Vercel static env.
4. Verify: `curl -sI -L https://loose-ends-v3-1.vercel.app/dashboard` (or `/`) → expect final `HTTP 200` on loose-ends-os; then sign in → open Billing → checkout starts (test keys only until T1–T20 pass).

## Rollback
Delete/revert the Vercel domain redirect (1 click, instant). Supabase URLs can be edited back in the same settings pane. No code deploy, no DB change, no Stripe change; risk is limited to auth links issued in the gap window.

## Acceptance criteria for the flip (owner checklist)
- [ ] 301 from v3-1 to canonical verified with -L (path preserved)
- [ ] Signed-in workspace opens Billing page against canonical origin
- [ ] Test-mode checkout session completes end-to-end (blocked until sandbox keys)
- [ ] Password-reset email link lands on canonical /dashboard
- [ ] No console errors on demo/workspace load
