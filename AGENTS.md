# AGENTS.md — Loose Ends OS Architectural & Security Guardrails

This document defines the target architecture, security invariants, and phased migration rules for consolidating **Loose Ends OS** from the legacy `v3.1/*.js` script stack into a single compiled **React 18 + TypeScript + Tailwind v4** application.

---

## 1. Target `src/` Architecture

All new frontend modules live under `src/` and compile into a single Vite SPA organized around three top-level route groups:

- **Public Landing (`/`)** — `src/features/landing/`
  - Marketing surface, deterministic product capability overview, standardized `$199/month` single-plan pricing, `/demo` and Sign-In entrypoints, and direct lead capture into `public.public_leads` without requiring prior authentication.
- **Interactive Demo (`/demo`)** — `src/features/demo/`
  - Walk-in sales sandbox backed by an isolated in-memory/device-local `DemoStoreContext` (`src/state/DemoStoreContext.tsx`).
  - Includes the 5-minute guided walkthrough, conservative ROI/revenue-leak sizing calculator, and one-click sample reset.
  - **Never** reads or mutates authenticated Supabase tables or Edge Functions.
- **5 Authenticated Workspaces (`/dashboard/*`)** — `src/features/workspaces/`, gated by `AuthGate` + `SessionContext` + `AppShell`:
  1. **Command Center (`/dashboard`)** — `command-center/`
     - Executive KPIs (`ops_summary`, `ops_coordination_summary`), deterministic evidence-based Revenue Leak Scanner, Next Best Actions queue, Verified Collections vs. Owner-Reported Recovery (`verified_recovery_payments`), and Finance/Invoice Aging (`ops_invoice_aging`, `ops_expenses`).
  2. **Pipeline & Quotes (`/dashboard/pipeline`)** — `pipeline-quotes/`
     - Unified Customer 360 (`customers` server-side `ilike` search + `customer-bulk-import` Edge Function with SHA-256 checkpoint resume), Loose Ends & Opportunities pipeline (`loose_ends`, `opportunities`, `recovery_events`), Quotes/Revisions & Invoices (`documents`, `ops_quote_revisions`, `ops_quote_approvals`), and Consent-Gated Communication Drafts (`ops_communication_drafts`).
  3. **Dispatch & Jobs (`/dashboard/dispatch`)** — `dispatch-jobs/`
     - Estimate-to-invoice job lifecycle (`ops_jobs`, industry checklists, `job_materials`, `ops_job_attachments`), conflict-guarded Dispatch Calendar (`appointments` with business hours & travel buffers), Recurring Service Plans (`ops_service_plans`), Tasks (`tasks`), and Team Workload & Availability (`ops_team_status`, `ops_employee_profiles`, `ops_availability`).
  4. **Inventory & POs (`/dashboard/inventory`)** — `inventory-pos/`
     - Paginated SKU catalog (`inventory_items`), Stock Movement History (`inventory_movements`), idempotent Inventory CSV import, Job Material Reservations, and Internal Purchase Order Drafts → Approvals → Delivery Receipt (`ops_purchase_orders`).
  5. **Autopilot & Billing (`/dashboard/autopilot`)** — `autopilot-billing/`
     - Owner Kill Switch & Coordination Policy (`ops_policies`), Autonomous Low-Stock & Business Event Queues with dead-letter retry (`ops_queue`, `ops_business_events`, `ops_audit`), Custom Workflows & Human Approval Queue (`workflows`, `workflow_runs`, `workflow-runner`), Workspace Onboarding/Health & QuickBooks sync (`workspace_settings`, `quickbooks_connections`, `quickbooks-sync`), and `$199/month` Stripe Checkout & Customer Billing Portal (`workspace_subscriptions`, `create-subscription-checkout`, `create-billing-portal`).

Shared infrastructure resides in:
- `src/lib/` — `supabase.ts`, `auth.ts` (including HIBP k-anonymity password breach screening and `PASSWORD_RECOVERY` handling), `opsCommand.ts`, `edgeFunctions.ts`, `realtime.ts` (`loose-ends-live-<workspace_id>` channel), `csv.ts`, `leakScanner.ts`, `format.ts`.
- `src/state/` — `RouterContext.tsx`, `SessionContext.tsx`, `DemoStoreContext.tsx`.
- `src/components/` — `shell/` (`AppShell.tsx`, `GlobalSearch.tsx`, `AuthGate.tsx`) and `ui/` (`Dialog.tsx`, `Toast.tsx`, `MetricCard.tsx`, `ErrorBoundary.tsx`).

---

## 2. Strict Security & Data Integrity Rules

1. **Transactional Operational Mutations (`ops_command` + UUID Idempotency Keys)**
   - Every write to operations tables (`inventory_items`, `inventory_movements`, `ops_jobs`, `job_materials`, `ops_purchase_orders`, `ops_expenses`, `ops_policies`, `ops_employee_profiles`, `ops_availability`, `ops_service_plans`, `ops_communication_drafts`, `ops_job_attachments`, `ops_queue`, `ops_business_events`, and scheduled job bookings) **must** invoke `supabase.rpc('ops_command', { p_workspace, p_action, p_payload, p_key })`.
   - Always supply a stable `crypto.randomUUID()` idempotency key (`p_key`) per logical user submission (or deterministic `inventory-csv:<sha256>:<row>` receipt for CSV imports). Reuse the key when retrying an unchanged failed request; mint a fresh UUID whenever form inputs change.
2. **Atomic Opportunity Collection (`collect_opportunity` RPC)**
   - Confirming collected revenue on an opportunity **must** call `supabase.rpc('collect_opportunity', { p_opportunity_id, p_amount })` after explicit owner confirmation of the actual collected dollar amount (never projected estimates, `NaN`, `Infinity`, or `<= 0`).
   - Keep owner-confirmed recoveries strictly separated in UI copy and metrics from provider-verified settlements in `verified_recovery_payments`.
3. **Consent-Gated Outbound Drafts (`customer_contact_consent_events` + `recovery-delivery-preflight`)**
   - No customer SMS, email, or call outreach is ever transmitted automatically.
   - Approving, copying, or queuing any recovery/communication draft **must** verify that the latest `customer_contact_consent_events` row for `(workspace_id, customer_id, channel)` has `decision = 'granted'` with matching `evidence_reference`, record `audit_events` (`action = 'recovery_draft_approved'`), and pass `supabase.functions.invoke('recovery-delivery-preflight', ...)` (or `ops_command('draft_review', ...)`).
4. **Zero `localStorage` Caching of Authenticated Customer/Workspace Data**
   - Never persist customer records, opportunities, sales orders, calendar events, workflows, or workspace state in `localStorage` or `sessionStorage` for authenticated sessions (the sole permitted exception is a non-PII import job UUID keyed by SHA-256 file hash for resumable `customer-bulk-import` batches, deleted upon completion).
   - `SessionContext` must guard all async Supabase reads/writes with a monotonic generation counter and **synchronously wipe all in-memory workspace data** upon `SIGNED_OUT`, `USER_DELETED`, account switch, or workspace mismatch so late responses can never leak across accounts.
5. **Secrets & Billing Origin Safety**
   - Browser bundles may only use `SUPABASE_URL` and the publishable/anon key protected by RLS. Stripe secret keys and Supabase service-role keys remain strictly inside `supabase/functions/*`.

---

## 3. Phased Migration & CI Continuity Rule

- **Phases 1–3 (Parallel Build-Out):** Do **not** modify `index.html` or any of the 30 loaded `v3.1/*.js` runtime scripts. Keep the production `v3.1` shell and all existing `.github/workflows/build.yml` regression tests green while building and testing `src/` modules in parallel.
- **Phase 4 (Cutover):** Only switch `index.html` to mount `/src/main.tsx`, retire the `v3.1/` directory and Vite legacy asset emitter, and migrate runtime tests once all 5 authenticated workspaces, `/` landing, and `/demo` achieve full feature and security parity.
