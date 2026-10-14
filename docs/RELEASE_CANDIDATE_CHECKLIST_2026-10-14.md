# Loose Ends OS release candidate — October 14, 2026

**Status: NO-GO for public launch.** This is a launch checklist, not authorization to apply migrations, merge, or deploy.

## Verified references
- GitHub PR: https://github.com/Jcoop010/Loose-Ends-Company/pull/19
- Hardened candidate SHA: `dc062925d29dc5931cdfd463d96f5949b0983bf8`
- PR head branch: `security/harden-billing-cors-20261013`
- PR base branch: `feat/autonomy-center-20261012` (not `main`)
- Vercel project: `loose-ends-os` (`prj_FmEO0eNjMrUmifo2iZ6e4glKfl3W`)
- Latest observed Vercel production deployment: `dpl_6CVJSWNLKRQrSTttAYkaCbfa297L`, SHA `b59c72b04a97511f8584869420ac1dc755136107`, branch `feat/autonomy-center-20261012`.
- Supabase production project: `uehfvpnnoitgybsmdgef` (read-only inspected, no release DDL applied).

## Successful automated checks on candidate SHA
- Security and production build: https://github.com/Jcoop010/Loose-Ends-Company/actions/runs/38601586482
- PostgreSQL smoke and database-role checks: https://github.com/Jcoop010/Loose-Ends-Company/actions/runs/38601586158
- CI applies later database migrations to isolated fixtures, **not** a complete production schema.
- Dependency audit has an explicitly allowed high-severity advisory; a successful CI result does not imply zero outstanding vulnerabilities.

## Hard launch gates
- [ ] Resolve or explicitly accept and document the remaining dependency advisory.
- [ ] Obtain a **separate non-production Supabase environment** with full source schema and safe, synthetic users. Do not use production as staging.
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
CI has validated SQL transactions against fixture tables and compared a subset of live constraints. This is **not** equivalent to authentic multi-user E2E tests or a full-schema staging migration replay.
