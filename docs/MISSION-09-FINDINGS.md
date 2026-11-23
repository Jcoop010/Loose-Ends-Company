# MISSION 09 — EVIDENCE-BASED AUDIT FINDINGS LEDGER

Compiled from read-only source, schema, Edge Function, script, and test audits conducted against commit `a6ddeba`. Every severity rating and line reference was directly verified in source files.

---

## P0 — Critical Financial, Security & Integrity Defects

### F-01: `reverseLedgerEntryInDb` Voids Customer Invoices on Reminder Undo & Ignores All 13 DB Rollback Errors
- **File:** `src/lib/autonomousOs/queries.ts:596-847`
- **Mechanism:**
  1. Line `605-611`: `if (typeof after.invoice_id === 'string' && after.invoice_id)` unconditionally executes `invoices.update({ status: 'void' })` without checking `entry.action_type`. Since `stageCollectionNudgeInDb` logs `action_type: 'send_invoice_reminder'` with `after_state: { invoice_id }`, undoing a reminder voids the customer's invoice.
  2. Lines `606-827`: Every domain rollback `.update()` discards `{ error }`. Failures silently fall through to lines `831-841` and mark `agent_action_ledger.status = 'reversed'`.
  3. Line `839`: `.eq('status', 'executed')` runs *after* all domain updates, creating race conditions where concurrent undos overwrite live state before failing the ledger update.
  4. Lines `640-656` & `766-784`: Reversing `post_inbound_bill_capture` or `mark_vendor_bill_paid` leaves the associated COGS debit in `ledger_entries`, compounding double-counted expenses on re-post.

### F-02: Non-Atomic Release 5 Financial Writes & Missing Idempotency / Dedupe
- **File:** `src/lib/autonomousOs/release5Queries.ts:73-392`, `supabase/migrations/20261124000000_release5_complete_moat.sql`
- **Mechanism:**
  - `postInboundBillCaptureInDb` (`:146-196`): 3 separate queries (`UPDATE inbound_bill_captures` -> `INSERT ledger_entries` -> `INSERT agent_action_ledger`), no DB `.neq('match_status', 'posted')` guard, no idempotency key, `ledger_entry_id` missing from `after_state`, fails mid-flight leaving `'posted'` captures with no GL entry or no undo entry.
  - `reconcileMatchedBankFeedInDb` (`:257-292`): 2 non-atomic queries, no `.eq('status', 'auto_matched')` guard, never updates linked `invoices` or `vendor_bills`.
  - `applyJobChangeOrderInDb` (`:355-392`): 2 non-atomic queries, no optimistic concurrency check on `quoted_revenue_cents`, allows `+0c` no-op writes.
  - `importAndAutoMatchBankFeedInDb` (`:213-255`) + `bankReconciliationEngine.ts`: zero `external_tx_id` or `source_fingerprint` unique index; discards Plaid `transaction_id`; matches already-`paid` invoices (`:331-335`) and grants `10000` bps (`100.0%`) confidence purely on `daysDelta <= 3` without counterparty name overlap (`:340-341, 384-385`).

### F-03: `public_leads` Cross-Tenant PII Exposure & Unauthenticated Workspace Injection
- **File:** `supabase/migrations/20261118120000_create_public_leads.sql:148-178`, `supabase/migrations/20261124120000_growth_engine_v1.sql:43-61`
- **Mechanism:**
  - Authenticated `SELECT` and `UPDATE` policies include `workspace_id IS NULL` with `UPDATE ... WITH CHECK (true)`, enabling any authenticated user in Workspace B to read, claim, overwrite, or reassign unscoped leads across workspaces.
  - Anonymous `INSERT` policy uses `WITH CHECK (true)`, permitting unauthenticated callers to supply arbitrary `workspace_id`, `status = 'PILOT_SOLD'`, `score`, and `call_outcome`.
  - `le_ops.command('draft_pause_sequence')` (`20261123220000:380-388`) mutates `workspace_id IS NULL` leads via `SECURITY DEFINER`.

### F-04: Live Inbox-to-Ledger Uses Hardcoded Demo POs, Reads Binary PDFs as UTF-8 Text & Deadlocks Frozen Bills
- **File:** `src/features/workspaces/bookkeeping-ap/Release5BookkeepingPanels.tsx:130-160, 336-349, 439-453`, `src/lib/autonomousOs/release4bQueries.ts:243-297`
- **Mechanism:**
  - `Release5BookkeepingPanels.tsx:130-160` passes hardcoded `COIL-10` / `VALVE-42` demo POs and GRNs in the live workspace instead of workspace DB PO/GRN rows.
  - Line `345` calls `file.text()` on `.pdf` uploads (binary PDF streams decode to garbage and fall back to `$0.00` synthetic defaults), with zero file-size limit, magic-byte validation, or hash dedupe.
  - Line `439` allows posting `'needs_review'` captures directly with no editable fields or human verification flag.
  - Fraud alerts on inbound captures insert `bill_id: null` (`release5Queries.ts:124`); overriding an alert in `resolveVendorFraudAlertInDb` (`release4bQueries.ts:260-296`) never clears `inbound_bill_captures.match_status = 'fraud_frozen'`.

### F-05: MCP `run_three_way_match` Live Bill Overwrite, Unenforced Approval Gates & Member-Writable Bot Prompts
- **File:** `supabase/functions/loose-ends-mcp/index.ts:2921, 3122-3156, 3437-3616`, `supabase/migrations/20261119120000_create_grok_bot_mcp_layer.sql:69-72, 148-159, 225-236, 318-329`
- **Mechanism:**
  - MCP `run_three_way_match` accepts inline `bill_items`/`po_items` even when `vendor_bill_id` is passed (`:3438, 3520, 3540`), clearing exceptions and overwriting live `vendor_bills.match_status` directly without approval.
  - `create_quote_draft` defaults omitted `status` to `'sent'` (`:2921`); `log_agent_action` lets callers write `'executed'`/`'reversed'` audit entries directly (`:3122-3156`); `bot_manuals.mode = 'observe'` is ignored by all 12 write tools; removed admins keep active MCP tokens (`:1790-1804`).
  - `bot_manuals`, `staged_ops_actions`, `staged_ledger_entries`, and `workspace_mcp_tokens` grant member-level RLS (`is_workspace_member`) instead of owner/admin RLS (`is_workspace_owner`).
  - `scripts/sendApprovedDrafts.ts:139, 480-534, 667-670` mixes multi-workspace sender pools and scopes suppression queries globally when `DEFAULT_WORKSPACE_ID` is unset and `>1` workspace exists.

---

## P1 — High-Priority Integrity, Security & Integration Gaps

### F-06: Fabricated EINs Backfilled on Live Entities, Unwired Creation & Entity Switcher Bug
- **File:** `supabase/migrations/20261124000000_release5_complete_moat.sql:15, 26-45`, `src/lib/autonomousOs/release5Queries.ts:35-57`, `src/components/shell/AppShell.tsx:417-424`, `src/lib/autonomousOs/jobMarginEngine.ts:24-32`
- **Mechanism:** Backfills `'4821'` + `' LLC'` onto real customer workspaces; `createWorkspaceEntity` pads empty/short input to `'0000'` and is never wired into UI; fallback `<option value="primary">` stores `entity_id: null` while filtering for `entity_id === 'primary'`, hiding newly saved records. Core GL/AR/AP tables omit `entity_id`.

### F-07: Overclaimed Integrations (`bills@...` Email & Plaid Webhook) & Stripe Gaps
- **Files:** `src/features/workspaces/bookkeeping-ap/Release5BookkeepingPanels.tsx:298-301, 476-574`, `supabase/functions/create-subscription-checkout/index.ts:31-42, 57`, `supabase/functions/stripe-webhook/index.ts:95-100`
- **Mechanism:** Zero inbound email webhook/MX handler exists for `bills@<slug>.looseendsos.app`; zero Plaid SDK/Link/`/transactions/sync` integration exists (`SAMPLE_PLAID_WEBHOOK_JSON` is manual JSON paste). Stripe `create-subscription-checkout` hardcodes live `price_1URCPvIS04s94hSMFJ9azsC8` (blocking test-mode) without `Idempotency-Key`, `stripe-webhook` drops `charge.refunded`/`refund.*` as silent `200` no-ops, and entitlement gating (`hasActiveSubscription`) is cosmetic only.

### F-08: Cross-Workspace Foreign Keys, `le_ops.command` Validation & Unscoped `grok-bot-router`
- **Files:** `supabase/migrations/20261124000000_release5_complete_moat.sql:51, 75, 97`, `supabase/migrations/20261123220000_outbound_scale_sequencer.sql:109-111, 327-359`, `supabase/functions/grok-bot-router/index.ts:251-358`, `supabase/migrations/20261120120000_release1_autonomous_os.sql:171-199, 207, 366-512`
- **Mechanism:** Single-column FKs (`entity_id`, `bill_id`, `invoice_id`, `inventory_item_id`, `lead_id`) permit cross-tenant UUID attachment/oracles; `ops_drafts_lead_step_unique_idx` omits `workspace_id`; `agent_action_ledger` permits authenticated `UPDATE`/`DELETE`; `sign_public_quote_portal` allows signing `draft`/expired quotes and spams duplicate `pending_approval` rows; `grok-bot-router` allows non-owner members, ignores `observe` in `parse_document`, and fabricates `$249.00` receipts when xAI fails on image input.

---

## P2 — Phase 5 Workforce Orchestration & Baseline Hygiene

### F-09: Missing Shared Task Ledger, Loop Prevention, Lease Locking & Token/Cost Budgets
- **Files:** `supabase/functions/grok-bot-router`, `supabase/functions/workflow-runner`, `scripts/*.ts`, `supabase/migrations/20261119120000_create_grok_bot_mcp_layer.sql`
- **Mechanism:** Zero unified task state machine with lease locking (`SKIP LOCKED`), delegation `hop_count <= max_hops` + cycle detection, bounded retries + dead-letter escalation, or `prompt_tokens`/`completion_tokens`/`budget_cents` enforcement.

### F-10: Outdated `README.md`, Migration Schema Drift & Dependency Audit Script Path Failure
- **Files:** `README.md:45-52`, `scripts/check-dependency-audit.mjs`, untracked baseline DDL
- **Mechanism:** `README.md` still describes an obsolete static `v3.1/` shell and legacy Vercel hosts; baseline tables (`workspaces`, `workspace_members`, `customers`, `opportunities`, `audit_events`) and RPCs (`collect_opportunity`, `process_customer_import_batch`) lack `CREATE` DDL in `supabase/migrations/`; `scripts/check-dependency-audit.mjs` exits `1` on Windows when resolving `npm` path.
