# MISSION 09 — PHASE 1 BASELINE REPORT

**Repository:** `Jcoop010/Loose-Ends-Company`  
**Audit Baseline Branch / Commit:** `main` @ `a6ddeba` (`2026-11-23T14:52 EST`)  
**Audit Branch:** `mission-09/production-integrity-audit`  
**Live Deployment Targets (Read-Only Inventory):**
- Production web app: `https://www.looseendsos.app` (Vercel project `loose-ends-os` tracking `origin/main`)
- Supabase project ref: `uehfvpnnoitgybsmdgef`

---

## 1. Repository & Runtime Inventory (Verified on Disk)

| Layer | Inventory Count / Details |
|---|---|
| **Git State at Baseline** | Clean working tree on `main` at `a6ddeba` (`b54cbf2` Release 5, `db0e74f` Outbound Scale, `d1b28cc` Release 4B, `fc1053d` Release 4A, `7c29bf5` Shadow Mode). Multiple historical feature/fix branches present on `origin/*`. |
| **Application Routes (`src/state/RouterContext.tsx`)** | Public: `/`, `/calculator` (added at `a6ddeba`), `/demo` (+ `/demo/:section`), `/portal/:token`; Authenticated (`/dashboard*`): `command`, `pipeline`, `quotes`, `invoices`, `autonomy`, `dispatch` (alias `jobs`), `inventory`, `bookkeeping`, `vault`, `sops`, `shadow`, `autopilot` (alias `settings`). |
| **Vercel Configuration (`vercel.json`)** | Rewrites for `/dashboard/*`, `/demo/*`, `/calculator/*`, `/portal/:token*` -> `/index.html`; CSP + `X-Content-Type-Options` + `Referrer-Policy` headers configured. |
| **Database Migrations (`supabase/migrations/`)** | 38 SQL migrations (`20260907190000` through `20261124120000`). **Note (Drift):** Core early tables (`workspaces`, `workspace_members`, `customers`, `opportunities`, `audit_events`) and RPCs (`collect_opportunity`, `process_customer_import_batch`, `is_workspace_member`, `run_scheduled_and_due_workflows`) lack `CREATE` DDL in `supabase/migrations/`. |
| **Edge Functions (`supabase/functions/`)** | 8 functions: `create-billing-portal`, `create-subscription-checkout`, `customer-bulk-import`, `grok-bot-router`, `loose-ends-mcp` (`v2.6.0`, 32 tools), `recovery-delivery-preflight`, `stripe-webhook`, `workflow-runner`. **Referenced in UI/SDK but missing:** `quickbooks-sync`, `bootstrap-workspace`, inbound email webhook (`bills@...`), Plaid Link/webhook. |
| **CLI Automation Scripts (`scripts/`)** | `scoutProspects.ts`, `scoutRegionalLeads.ts`, `generateOutreachDrafts.ts`, `sendApprovedDrafts.ts`, `parseReceiptLocal.ts`, `check-dependency-audit.mjs`, `scan-dist-secrets.mjs`, `precompile-test-src.mjs`, `run-tests.mjs`. |
| **AI Providers Configured** | 2 providers: xAI Grok (`grok-bot-router` + fallback in `generateOutreachDrafts.ts`) and Local Ollama + Gemma 4 (`scripts/lib/ollamaClient.ts`, `parseReceiptLocal.ts`, `generateOutreachDrafts.ts`). Zero OpenAI/Anthropic SDKs. |
| **Baseline Checks at `a6ddeba`** | `npm.cmd run typecheck` (`0` errors), `npm.cmd test` (`47/47` test suites pass), `npm.cmd run build` (`vite build` exit `0`), `scan-dist-secrets.mjs` (`0` secret matches). `check-dependency-audit.mjs` failed locally due to `undefined` Windows `npm` path resolution in script (`audit` blocker). Live `/calculator` Playwright QA passed 6/7 checks (`0` console errors, `0` HTTP 5xx), but failed to capture a `public_leads` POST request in `networkRequests` during submit. |

---

## 2. Feature Classification Matrix (Mission 09 Taxonomy)

| Capability / Domain | Baseline Classification | Evidence Summary |
|---|---|---|
| **Static Secret Hygiene & Bundle Isolation** | **Implemented and tested** | `VITE_` prefix strictly limited to Supabase public URL/anon key (`src/lib/supabase.ts`); `scan-dist-secrets.mjs` (`0` matches); `tests/leak-scanner.test.mjs`, `tests/src-sdk-contracts.test.mjs`. |
| **Air-Gapped Interactive `/demo` Sandbox** | **Implemented and tested** | `DemoStoreContext.tsx` + `src/features/demo/*` run 100% in-memory with zero Supabase/SDK imports, verified by static contract tests & live browser QA. *(Copy overclaims Plaid badge prior to remediation.)* |
| **Deterministic Pure Math Engines** (`leakCalculator`, `shadowEngine`, `cpaPacketEngine`, `collectionsEngine`, `jobMarginEngine`) | **Implemented and tested** | Integer-cent `*_cents` math verified across unit suites; pure TS modules free of `any`. |
| **CAN-SPAM & TCPA Draft Compliance Guard** (`src/lib/canSpamGuard.ts`, `le_ops.command`) | **Implemented and tested** | SMS/Call require explicit granted opt-in; B2B cold email permits `421 Hill Street, Parkersburg, WV 26104` + opt-out footer unless suppressed. |
| **Public `/calculator` Lead Magnet & `/demo` Handoff** | **Implemented but not integration-tested** | Sliders, email validation, `buildInboundCalculatorLeadRow`, and SPA `/demo` handoff pass unit/JSDOM tests & live browser visual/slider QA. Live `public_leads` POST was not observed firing in live browser QA (`8831177c`) — requires integration verification & RLS hardening (`workspace_id IS NULL` leak). |
| **Stripe Webhook HMAC Signature & Replay Dedupe** | **Implemented and tested** | Real WebCrypto HMAC-SHA256, 300s timestamp window, `livemode`↔key check, and atomic DB lease/replay RPCs (`20261022124913`) tested with real crypto in `tests/stripe-webhook-handler.test.mjs`. |
| **Stripe Billing Portal & Subscription Webhook Events** (`checkout.session.completed`, `invoice.paid`) | **Implemented but not integration-tested** | Endpoint & webhook routing implemented; zero test coverage of `checkout.session.completed`/`invoice.paid`; blocked for live test-mode by credentials + hardcoded live price `price_1URCPvIS04s94hSMFJ9azsC8`. |
| **Inbox-to-Ledger Bill Capture & Posting** | **Partially implemented** | Non-atomic 3-query write; `file.text()` run on binary PDFs; hardcoded demo POs (`COIL-10`/`VALVE-42`) in live `Release5BookkeepingPanels.tsx`; Undo leaves orphaned COGS rows; `fraud_frozen` deadlock when resolving alerts (`bill_id: null`). |
| **Bank Feed Auto-Reconciliation (CSV / OFX-QBO)** | **Partially implemented** | Deterministic CSV/OFX parsers work, but zero DB duplicate/external-ID protection, non-atomic 2-query reconcile, matches already-paid invoices, awards 100% confidence with zero counterparty name overlap (`<=3d`), and never settles GL/invoices/bills. |
| **Live Job Margin Tracker & Change Orders** | **Partially implemented** | Pure math works; `applyJobChangeOrderInDb` is non-atomic without optimistic lock/idempotency; mutates `quoted_revenue_cents` in-place without customer quote approval; zero DB integration tests. |
| **1-Click Undo / Reversals (`reverseLedgerEntryInDb`)** | **Partially implemented** | **Critical bugs at baseline:** 13 unchecked `.update()` calls ignoring DB errors; ledger `'executed'` guard checked *last*; reverses `send_invoice_reminder` by voiding the customer's invoice; orphans COGS rows in `ledger_entries`. |
| **Multi-Entity Switcher & Entity Identity** | **Partially implemented** | Migration `20261124000000` backfills fabricated EIN `'4821'` + `' LLC'` onto real workspaces; `createWorkspaceEntity` fabricates `'0000'` and is unwired in UI; synthetic `'primary'` option hides new records; core ledger/AR/AP tables lack `entity_id`. |
| **Stripe Entitlement Gating, Failed Payments & Cancellation** | **Partially implemented** | `hasActiveSubscription` only toggles a cosmetic badge (`AppShell.tsx`); `invoice.payment_failed` `past_due`/`unpaid` transition & `cancel_at_period_end` untested. |
| **MCP Server (`loose-ends-mcp`) & AI Bot Governance** | **Partially implemented** | 32 tools verify SHA-256 token & `workspace_id`, but ignore `bot_manuals.mode` (`observe`), allow `run_three_way_match` inline array bypass/overwrite of `vendor_bills`, default quotes to `'sent'`, allow forged `'executed'` logs, and lack token admin re-validation. |
| **Inbound Email Capture (`bills@<slug>.looseendsos.app`)** | **UI demonstration only** | Pure string formatter (`inboxToLedgerEngine.ts:42-50`) + Copy button in UI; **no** MX/inbound webhook Edge Function exists. |
| **Plaid Bank Feed Synchronization** | **UI demonstration only** | Manual paste/sample fixture of fictional JSON (`SAMPLE_PLAID_WEBHOOK_JSON`); **no** Plaid SDK, Link flow, `/transactions/sync`, or webhook Edge Function exists. |
| **QuickBooks Online Live Sync (`quickbooks-sync`) & `bootstrap-workspace`** | **Missing** | Referenced in UI/`edgeFunctions.ts`, but Edge Functions do not exist in `supabase/functions/`. |
| **Stripe Refunds (`charge.refunded` / `refund.*` / API)** | **Missing** | Ignored with silent HTTP `200` no-op in `stripe-webhook/index.ts`; zero refund table, API, or tests. |
| **Multi-Agent Shared Task Ledger, Lease Locking & Budget Caps** | **Missing** | No shared `agent_tasks` ledger, task lease claiming, hop/cycle prevention, retry dead-lettering, or token/cent cost caps across AI runners. |
| **Live Stripe Test-Mode Checkout & Card E2E** | **Blocked by credentials or external services** | Hardcoded live price ID + missing live Stripe test secrets in sandbox environment prevent live test-mode checkout execution here. |
