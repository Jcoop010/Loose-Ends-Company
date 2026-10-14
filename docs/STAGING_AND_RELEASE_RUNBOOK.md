# Staging and controlled release

Status: NOT READY. No production migration, merge or deployment is authorized by this runbook.

## Staging configuration

The user approved the existing empty Supabase project `vdactpndbcwqvsfbzjrk` (`supabase-camel-flame`) for synthetic staging data. The current Supabase connection cannot access it. Use its owning account to authorize the connector; do not share keys in chat. Keep production access separate. Do not use the unrelated Primal Directive project.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the security branch's Vercel Preview environment only. Use staging's project origin and public browser key. Vercel preview builds now require both values and reject the production project origin and private keys. React, legacy scripts and the QuickBooks bridge share the injected configuration. Do not supply service-role keys to browser configuration.

Provision staging through supported tracked migrations after access is available. The schema-only fixture is a disposable PostgreSQL test harness, not a hosted Supabase bootstrap: it creates test roles and an Auth table shape, and does not implement Supabase Auth HTTP, vault or cron infrastructure. Capture a proper schema-only baseline for hosted staging, preserve hosted Auth objects, and apply the four pending migrations in order: `20261014180000`, `20261014181000`, `20261014182000`, `20261014183000`. Deploy candidate Edge Functions to staging, with explicit preview CORS origins and staging-only integration secrets.

Connect the Loose Ends Co Stripe sandbox/test-mode account. Current Stripe access exposes only live mode. Never use live charges for acceptance tests. Use Stripe test events signed for the staging webhook; confirm duplicate events, retry after a failed completion, cancellation, and entitlement changes from the browser through the actual backend. Existing mocked signature tests and database lease tests are supporting evidence, not provider E2E evidence.

## Acceptance evidence still required

Use two synthetic users and workspaces. Record preview URL, deployment ID and exact commit. Verify signup, email confirmation where configured, login, password reset, logout and session persistence; protected routes; membership and owner/staff boundaries; customer/opportunity/follow-up CRUD; CSV errors and import; recovery confirmation and dashboard totals from stored data; workflow approval, retry and execution history; desktop/mobile forms; and provider failures. Verify each write in staging and cross-workspace denial independently. Send no real customer messages.

QuickBooks currently exposes an honest unavailable/setup status; live OAuth/sync remains a product limitation. Do not advertise it as working before provider acceptance tests pass. Leaked-password protection is disabled on the free plan; no paid upgrade has been purchased.

## Controlled production release

1. Attach final CI and acceptance evidence to PR #19. Confirm its base is the intended `feat/autonomy-center-20261012` production lineage before merging; do not assume `main` deploys this application.
2. Confirm a restorable production backup and record its timestamp, ownership and restore procedure. A schema fixture is not a data backup.
3. Obtain explicit approval for the reviewed production migrations, merge and one final deployment, after all gates pass. Preserve production data. Apply migrations using the supported tracked workflow and independently verify grants/functions and application compatibility.
4. Deploy once through the existing authorized Vercel workflow. Record actual deployed SHA and deployment ID. Perform read-only production smoke checks first, then only explicitly authorized labeled tests. Review errors and integration health.

## Rollback and monitoring

Record the previous verified production deployment (`dpl_6CVJSWNLKRQrSTttAYkaCbfa297L`, commit `b59c72b04a97511f8584869420ac1dc755136107`) again immediately before release. If authentication, tenant isolation, billing or write failures appear, stop release and use the authorized Vercel rollback workflow to that verified deployment. Do not drop tables or blindly reverse migrations: prefer a reviewed forward fix, and restore data only through the approved backup procedure. Database atomic/lease behavior must stay compatible with whichever Edge Function version is deployed.

Review Vercel function errors and Supabase Auth/database logs after release; inspect stuck/failed workflow runs and Stripe webhook delivery failures. No recurring monitor or paid service has been provisioned. Assign an actual support owner/contact before public launch. Verify privacy/terms describe actual data use, retention, subprocessors, billing and support; drafts require business/legal review before publishing. Do not publish a launch announcement while these gates remain open.
