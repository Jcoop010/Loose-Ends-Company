# AGENTS.md — Loose Ends OS Architectural & Security Guardrails

This document defines the production architecture, security invariants, and CI verification rules for **Loose Ends OS** — a unified **React 18 + TypeScript + Tailwind v4** application backed by Supabase PostgreSQL (`le_ops` / RLS) and Edge Functions.

---

## 1. Production `src/` Architecture (Phase 4 Cutover Complete)

`src/` is the sole production frontend runtime, mounted via [index.html](index.html) (`/src/main.tsx`) and compiled into hashed static assets by Vite:

- **Public Landing (`/`)** — `src/features/landing/`
  - Executive Single-Ledger Operations & Revenue Recovery overview, transparent flat `$199/month` workspace pricing (unlimited technicians, month-to-month, `$0` setup), stack comparison grid, `/demo` and `/dashboard` entrypoints, and direct lead capture into `public.public_leads` via `PublicAuditLeadForm.tsx`.
- **Interactive Demo (`/demo`, `/demo/*`)** — `src/features/demo/`
  - Air-gapped sales sandbox backed exclusively by in-memory `DemoStoreContext` (`src/state/DemoStoreContext.tsx`).
  - Includes the 5-step `WalkthroughBanner`, conservative `RoiAuditCalculatorModal`, interactive 5-pillar HVAC sandbox (`DemoWorkspacePage.tsx`), and 1-click `resetDemo()`.
  - **Never** imports or calls Supabase or live network SDK modules.
- **5 Authenticated Workspaces (`/dashboard/*`)** — `src/features/workspaces/`, gated by `AuthGate` + `SessionContext` + `AppShell`:
  1. **Command Center (`/dashboard`)** — `command-center/`
     - Executive KPIs (`ops_summary`, `ops_coordination_summary`), deterministic evidence-based Revenue Leak Scanner (`leakScanner.ts` + deduplicated `tasks` creation), prioritized Next Best Actions, strict separation between Stripe webhook-verified settlements (`verified_recovery_payments`) and owner-reported paid invoices, and Receivables Aging + Vendor Bills (`ops_invoice_aging`, `ops_expenses`).
  2. **Pipeline & Quotes (`/dashboard/pipeline`)** — `pipeline-quotes/`
     - Unified Customer 360 (`customers` server-side `ilike` search + `customer-bulk-import` Edge Function with SHA-256 in-memory checkpoint resume), Loose Ends & Opportunities pipeline (`loose_ends`, `opportunities`, atomic `collect_opportunity`), Quotes/Revisions & Printable Snapshots (`documents`, `ops_quote_revisions`, `ops_quote_approvals`), and Consent-Gated Communication Drafts (`ops_communication_drafts`, `customer_contact_consent_events`, `recovery-delivery-preflight`).
  3. **Dispatch & Jobs (`/dashboard/dispatch`)** — `dispatch-jobs/`
     - Estimate-to-invoice job lifecycle (`ops_jobs`, industry checklists, `job_materials` margin calculator, HTTPS `ops_job_attachments`), conflict-guarded Dispatch Calendar (`appointments` enforced by `ops_calendar_guard`), Recurring Service Plans (`ops_service_plans`), Operational Tasks (`tasks`), and Team Workload & Shifts (`ops_team_status`, `ops_employee_profiles`, `ops_availability`).
  4. **Inventory & POs (`/dashboard/inventory`)** — `inventory-pos/`
     - Paginated SKU catalog (`inventory_items`), Stock Movement History (`inventory_movements`), deterministic `inventory-csv:<sha256>:<row>` CSV batch importer, Job Material Reservations, and Supplier Purchase Order Drafts → Approvals → Delivery Receipt (`ops_purchase_orders`).
  5. **Autopilot & Billing (`/dashboard/autopilot`)** — `autopilot-billing/`
     - Master Kill Switch & Coordination Policy (`ops_policies`), Autonomous Low-Stock & Business Event Queues with dead-letter retry (`ops_queue`, `ops_business_events`, `ops_audit`, `audit_events`), Custom Workflows & Human Approval Queue (`workflows`, `workflow_runs`, `workflow-runner`), Workspace Setup/Health Probes & QuickBooks sync (`workspace_settings`, `quickbooks_connections`, `quickbooks-sync`), and `$199/month` Stripe Checkout & Customer Billing Portal (`workspace_subscriptions`, `create-subscription-checkout`, `create-billing-portal`).

Shared infrastructure resides in:
- `src/types/domain.ts` — Strict domain interfaces across Auth, CRM/Recovery, `le_ops`, and Workflows (compiled with `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, zero `any`).
- `src/lib/` — `supabase.ts`, `auth.ts` (Web Crypto SHA-1 5-char k-anonymity HIBP check + `PASSWORD_RECOVERY` handling), `opsCommand.ts` (all 29 `ops_command` actions + typed RPCs), `edgeFunctions.ts`, `queries.ts` (10,000-row fail-closed pagination + sanitized `.or(...ilike...)` search), `realtime.ts` (`loose-ends-live-<workspace_id>` 500ms debounced channel), `csv.ts`, `leakScanner.ts`, `format.ts`.
- `src/state/` — `RouterContext.tsx`, `SessionContext.tsx`, `DemoStoreContext.tsx`.
- `src/components/` — `shell/` (`AppShell.tsx`, `GlobalSearch.tsx`, `AuthGate.tsx`) and `ui/` (`Dialog.tsx`, `Toast.tsx`, `MetricCard.tsx`, `ErrorBoundary.tsx`).

---

## 2. Strict Security & Data Integrity Rules

1. **Transactional Operational Mutations (`ops_command` + UUID Idempotency Keys)**
   - Every write to operations tables (`inventory_items`, `inventory_movements`, `ops_jobs`, `job_materials`, `ops_purchase_orders`, `ops_expenses`, `ops_policies`, `ops_employee_profiles`, `ops_availability`, `ops_service_plans`, `ops_communication_drafts`, `ops_job_attachments`, `ops_queue`, `ops_business_events`, and scheduled job bookings) **must** invoke `opsCommand(...)` (`supabase.rpc('ops_command', { p_workspace, p_action, p_payload, p_key })`).
   - Supply a `crypto.randomUUID()` idempotency key per logical submission (or deterministic `inventory-csv:<sha256>:<row>` receipt for SKU CSV imports).
2. **Atomic Opportunity Collection (`collect_opportunity` RPC)**
   - Confirming collected revenue on an opportunity **must** call `collectOpportunity(opportunityId, amount)` (`supabase.rpc('collect_opportunity', ...)`), never direct `.update()` on `opportunities` or `.insert()` on `recovery_events`.
   - Keep owner-confirmed recoveries strictly separated in UI copy and metrics from provider-verified settlements in `verified_recovery_payments`.
3. **Consent-Gated Outbound Drafts (`customer_contact_consent_events` + `recovery-delivery-preflight`)**
   - No customer SMS, email, or call outreach is ever transmitted automatically.
   - Approving or enqueuing any recovery/communication draft **must** verify that the latest `customer_contact_consent_events` row for `(workspace_id, customer_id, channel)` has `decision = 'granted'` with matching `evidence_reference`, record `audit_events` (`action = 'recovery_draft_approved'`, `delivery_status = 'not_sent'`), and pass `recovery-delivery-preflight` (or `ops_command('draft_review', ...)`).
4. **Zero Browser Storage Caching of Customer/Workspace Data**
   - Never read or write `localStorage` or `sessionStorage` in `src/**`. Resumable `customer-bulk-import` checkpoints are held strictly in an in-memory `Map` for the current tab session.
   - `SessionContext` guards all async hydrations with a monotonic `generationRef` counter and **synchronously wipes all in-memory session/workspace state** (`wipeAllSessionState`) upon `signOut` or `SIGNED_OUT`.
5. **Secrets, CSP & Billing Origin Safety**
   - Browser bundles use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` protected by RLS. Stripe secret keys and Supabase service-role keys remain strictly inside `supabase/functions/*`.
   - Checkout and portal redirects validate `https://checkout.stripe.com` and `https://billing.stripe.com` before navigation, and `vercel.json` enforces strict CSP headers without third-party script CDNs.

---

## 3. CI Verification Rule

Every change must pass `npm run typecheck`, `npm run build`, `node tests/src-sdk-contracts.test.mjs`, and the full regression suite in `.github/workflows/build.yml` with zero errors.
