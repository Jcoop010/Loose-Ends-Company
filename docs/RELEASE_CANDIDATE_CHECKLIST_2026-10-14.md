# Loose Ends OS release candidate — October 14, 2026

**Status: NO-GO for public launch.** This is a launch checklist, not authorization to apply migrations, merge, or deploy.

## Verified references
- GitHub PR: https://github.com/Jcoop010/Loose-Ends-Company/pull/19
- Last independently passing database candidate: `d9036efca7f75de94740ca018a4c0eaa518c6161`; subsequent preview configuration changes require their own CI evidence on PR #19.
- PR head branch: `security/harden-billing-cors-20261013`
- PR base branch: `feat/autonomy-center-20261012` (not `main`)
- Vercel project: `loose-ends-os` (`prj_FmEO0eNjMrUmifo2iZ6e4glKfl3W`)
- Latest observed Vercel production deployment: `dpl_6CVJSWNLKRQrSTttAYkaCbfa297L`, SHA `b59c72b04a97511f8584869420ac1dc755136107`, branch `feat/autonomy-center-20261012`.
- Supabase production project: `uehfvpnnoitgybsmdgef`. Privilege migration `20261014111000` was applied and independently verified under the earlier authorization. The four later release migrations remain unapplied in production.

## Successful automated checks on candidate SHA
- Security and production build: https://github.com/Jcoop010/Loose-Ends-Company/actions/runs/38608953955
- PostgreSQL smoke, full public-schema replay, synthetic tenant tests and competing sessions: https://github.com/Jcoop010/Loose-Ends-Company/actions/runs/38608953532
- CI replays all captured public tables, constraints, indexes, functions, triggers, policies and grants before the four pending migrations. The catalog snapshot contains no customer rows. It models Auth users/functions for SQL tests; it does not provide hosted Auth HTTP, cron or vault infrastructure.
- Dependency audit has an explicitly allowed high-severity advisory; a successful CI result does not imply zero outstanding vulnerabilities.

## Hard launch gates
- [ ] Resolve or explicitly accept and document the remaining dependency advisory.
- [ ] Obtain connector access to the user-approved empty staging project `vdactpndbcwqvsfbzjrk`, provision the hosted schema and safe synthetic users. Current connection can access production but denies staging.
- [ ] Apply pending migrations in order to the staging copy: `20261014180000`, `20261014181000`, `20261014182000`, `20261014183000`. Confirm rollback/restore strategy and actual schema compatibility.
- [ ] Test two distinct synthetic users and workspaces: login, unauthorized reads/writes, membership changes, owners versus staff, client/anonymous permissions.
- [ ] Test actual signup/login/logout, CRUD, recovery, workflow actions and retries, Stripe **test-mode** checkout/webhooks/cancellation and payment entitlements, and failed provider/API responses.
- [ ] Obtain **preview deployment of exact release SHA** and verify its environment variables target staging, not production. No preview for this security branch was found in Vercel on October 14, 2026.
- [ ] Verify billing, auth callbacks, CORS, webhook secrets, published domain, privacy/terms, alerts, monitoring and support path.
- [ ] Confirm release branch lineage: PR #19 merges into feature branch; verify how that branch becomes the intended production branch before making a release.
- [ ] Back up production and record restore and rollback steps before applying migrations.
- [ ] Explicit go/no-go approval after all evidence is attached.

## Production safeguards
1. Do not run the pending migrations directly on the only production database for testing.
2. Do not point a preview environment at production credentials.
3. Do not merge PR #19 or promote a Vercel deployment until the launch gates pass.
4. After deployment, test login and a non-destructive read-only dashboard flow first. Stop rollout if errors or cross-workspace access appear.

## Known gap
Native PostgreSQL 17 CI now validates a complete public application schema replay and synthetic multi-tenant SQL transactions, including atomic actions and simultaneous webhook workers. This is **not** equivalent to hosted Supabase signup/login or browser/provider E2E tests. Initial CI failures from fixture setup and publishing quotation were fixed; the final referenced run passed every step. See [staging and release runbook](STAGING_AND_RELEASE_RUNBOOK.md) for the remaining gates and rollback procedure.
