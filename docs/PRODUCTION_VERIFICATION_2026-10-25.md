# Production verification — October 25, 2026

Release decision: **NO-GO for unattended paying-customer onboarding**. The engineering repairs below are validated; remaining gates are not certified.

## Implemented

- Replaced the obsolete asset timestamp assertion that failed Build #638 with an actual DOM injection regression. The real form renderer is tested against attribute injection and HTML injection; one versioned operations script must load.
- Integrated PR #77 billing migrations and tests as source history. The RPCs are already deployed; migrations were not reapplied. Refreshed source snapshots to deployed checkout v14, portal v10 and webhook v8.
- Added password-reset request and recovery-session UI to existing authentication. Matching passwords, breach screening, safe errors, duplicate-submit prevention and signout follow successful update. The UI flow passes mocked-adapter DOM tests; real mail delivery/reset-link acceptance is not certified.
- Pinned the browser Supabase SDK to the audited lockfile version 2.109.0.
- Added nosniff, referrer, permissions and CSP frame/base/object restrictions. Inline-script restrictions remain a legacy-runtime limitation.

## Evidence

- Build #638 (`39817910682`, job `119961143135`) failed solely at the obsolete operations script version assertion; reproduced locally before repair.
- 34 JavaScript regression files pass. TypeScript check and production build pass. Runtime syntax checks pass. No lint script/config exists; syntax validation is not represented as a full lint audit.
- npm dependency audit: zero reported vulnerabilities on October 25.
- Production SQL transaction suite passes Stripe activation, cancellation, stale delivery, replay, leases/takeover, live/test rejection, cross-workspace provider identity and role restrictions. Fixtures rolled back.
- Production connected-operations SQL passes tenant rejection, role authorization, duplicate receipt protection, input/stock validation, estimate approval, completion and single-invoice creation. Fixtures rolled back.
- Production coordination SQL passes quote/dispatch/consent/recurrence tests, including opt-out invalidation and replay not reviving an approval. Fixtures rolled back.
- Recovery RLS/ledger SQL checks pass. All 46 public tables have RLS enabled. Authenticated users have no insert/update/delete privileges on subscription rows; billing RPCs allow service_role only.
- Bounded rolled-back load: 5,000 inventory rows, 2,000 customers; summary 176.521 ms and 50-row inventory page 1.463 ms. This is not a concurrent capacity guarantee.
- Three cron jobs are enabled every minute. Last 24 hours: 4,320 succeeded, no failed runs reported.
- Live unauthenticated/cross-origin HTTP probes reject checkout and portal access. No charge/session creation was attempted.
- Stripe read-only check confirms active USD 199/month recurring price `price_1URCPvIS04s94hSMFJ9azsC8` on Loose Ends Co. Only live-mode account access is connected.
- Browser: production dashboard presents sign-in; public demo renders fictional-data labels and device-only behavior. Authenticated real-browser acceptance requires a securely supplied disposable test login and remains unperformed.
- Vercel environment metadata confirms production Stripe and Supabase variables are configured as sensitive; secret values were not retrieved.

## Outstanding gates

1. Connect an isolated Stripe sandbox and exercise hosted checkout, signed provider delivery, activation, payment failure, renewal, portal, cancellation and access enforcement end to end. No live transaction is authorized.
2. Complete authenticated browser signup/login, persistence, responsive/layout, recovery-email and tenant-isolation acceptance with disposable accounts. No account/email has been invented or borrowed from customer data.
3. Subscription rows are protected from client edits, but general operations do not currently enforce paid/trial entitlement checks. Product access policy must be implemented and tested across direct table writes, RPCs and privileged background workers before claiming subscription enforcement.
4. No published privacy/terms pages or confirmed support and data deletion/export process were found in the deployed entry points. Establish approved business policies/contact and verify the operational procedures before selling.
5. Supabase reports leaked-password protection disabled. Browser signup/recovery screening exists, but direct Auth API callers can bypass it. No paid upgrade was made.
6. A generative AI advisor is not verified in the production runtime. Current scan/prioritization can use deterministic evidence rules; do not describe it as a verified live model-backed advisor. PR #20 requires its provider secret and adaptation to the actual production runtime.
7. Provider delivery, backup restoration and concurrent load/recovery have not been certified.

## Older PR review

- #77: integrated in this release, with source parity refreshed and database tests rerun.
- #20: keep unmerged; targets an older security branch, edits the inactive React Ask page and requires an unavailable provider secret. Do not deploy by merging an old architecture.
- #18: keep unmerged; conflicts with main, includes legacy three-plan pricing and broad old runtime/build changes. Current operations and billing source supersede substantial portions.
- #13: keep unmerged; conflicts with main and restores obsolete $49/$149/$499 plan presentation and older webhook implementation.
- #12: keep unmerged; conflicts with main. Main already contains owner-confirmation, collected-amount and audit safeguards with newer atomic recovery handling.
- #8: keep unmerged; conflicts with main. Current cron jobs are active and passing; old branch also replaces the production entry point and changes README branding to Primal Directive.

No money spent, services upgraded, production customers modified, external customer messages sent or billing Edge Functions redeployed in this session.
