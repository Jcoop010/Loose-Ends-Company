# MISSION 09 — REMEDIATION LOG (F-01 THROUGH F-10)

**Branch:** `mission-09/production-integrity-audit` (branched cleanly from `main` @ `a6ddeba`)  
**Phase 9 Lock:** All migrations and Edge Function changes remain staged on this isolated branch pending explicit owner deployment approval. No production database (`uehfvpnnoitgybsmdgef`), Vercel deployment, or `origin/main` branch was modified during remediation.

---

## Finding-by-Finding Remediation Matrix

### F-01 (P0): Safe Reversal Ledger & Error-Checked Rollback
- **Migration (`supabase/migrations/20261125000000_mission09_integrity_security_workforce.sql`):**
  - Created `public.reverse_agent_action_atomic(p_workspace_id, p_entry_id, p_reason)`: locks and transitions `agent_action_ledger.status` from `'executed'` -> `'reversed'` **first** under an advisory lock so concurrent undo requests fail deterministically instead of double-reversing.
  - Voids invoices **only** when `action_type = 'create_invoice'` (never on `'send_invoice_reminder'`).
  - Inserts offsetting negative reversal rows (`reversal_of_entry_id`) in `ledger_entries`, resets paid/partial AR state or AP bill state safely, unfreezes linked `inbound_bill_captures` when re-freezing fraud overrides, and restores `reconciled` bank transactions cleanly to `auto_matched`.
- **Client (`src/lib/autonomousOs/queries.ts`):**
  - Updated `reverseLedgerEntryInDb` to invoke `reverse_agent_action_atomic` RPC first; hardened fallback checks `{ error }` on every rollback query, claims `status = 'executed'` **first**, avoids voiding on `'send_invoice_reminder'`, and removes associated `ledger_entries` COGS rows on `post_inbound_bill_capture` / `mark_vendor_bill_paid`.

### F-02 (P0): Atomic Release 5 Financial RPCs, Dedupe & Name-Verified Bank Matching
- **Migration (`20261125000000_mission09_integrity_security_workforce.sql`):**
  - Added `content_hash`, `extraction_method`, `extraction_confidence_bps`, `human_verified`, `verified_by`, `verified_at`, `idempotency_key`, `posted_ledger_entry_id` + unique partial indexes on `inbound_bill_captures`.
  - Added `external_tx_id`, `source_fingerprint`, `manual_override_reason`, `idempotency_key` + unique partial indexes on `bank_feed_transactions`.
  - Added `entity_id`, `idempotency_key`, `reversal_of_entry_id` + unique partial index on `ledger_entries`.
  - Added transactional RPCs: `post_inbound_bill_capture_atomic`, `reconcile_bank_feed_atomic`, and `apply_job_change_order_atomic` (with optimistic `expected_quoted_revenue_cents` concurrency guard and non-zero delta constraint).
- **Engines & Queries (`src/lib/autonomousOs/bankReconciliationEngine.ts`, `release5Queries.ts`):**
  - `bankReconciliationEngine.ts`: skips paid invoices/bills (`inv.status === 'paid' || openCents <= 0`, `bill.match_status === 'paid'`), respects `existingMatchedRecordIds` so one invoice/bill cannot match multiple bank transactions, caps confidence at `9000` bps (`90.0%`) when counterparty `nameOverlap` is absent (reserving `10000` bps only for overlapping counterparty + `<= 3d`), preserves `external_tx_id` (`transaction_id`, `<FITID>`, CSV `id`), and computes deterministic `source_fingerprint`.
  - `release5Queries.ts`: invokes the atomic RPCs with compare-and-set fallback guards and SHA-256/content-hash deduplication.

### F-03 (P0): `public_leads` Multi-Tenant RLS Hardening
- **Migration (`20261125000000_mission09_integrity_security_workforce.sql`):**
  - Hardened `public.is_workspace_owner` (`set search_path = public, pg_temp`, revoked from `public`/`anon`).
  - Removed cross-tenant `workspace_id IS NULL` exposure from authenticated `SELECT`/`UPDATE` policies on `public_leads`; scoped authenticated access strictly to `public.is_workspace_owner(workspace_id)`.
  - Constrained anonymous `INSERT` policy on `public_leads` so unauthenticated submissions (e.g., `/calculator`) can only insert `workspace_id IS NULL`, `status = 'DRAFT_READY'`, and `call_outcome IS NULL`.
  - Updated `le_ops.command('draft_pause_sequence')` so callers cannot mutate arbitrary unscoped leads outside their workspace.

### F-04 (P0): Binary PDF Extraction, Workspace PO/GRN Wiring, Human Verification & Alert Unfreeze
- **Document Parser (`src/lib/autonomousOs/documentParser.ts`, `index.ts`):**
  - Added 5 MB size cap, extension validation (`.pdf`, `.txt`, `.csv`, `.json`), SHA-256 `content_hash`, binary `%PDF-` `BT..ET`/`Tj`/`TJ`/hex/compressed `/FlateDecode` (`DecompressionStream`) extractor, and `0%` confidence `'pdf_scanned_needs_ocr'` handling so image-only PDFs never silently parse as `$0.00`.
- **UI & Queries (`src/features/workspaces/bookkeeping-ap/Release5BookkeepingPanels.tsx`, `inboxToLedgerEngine.ts`, `release4bQueries.ts`, `release5Queries.ts`):**
  - Wired `fetchWorkspacePoAndReceiptData(workspaceId)` into `Release5BookkeepingPanels.tsx` and removed all hardcoded `COIL-10` / `VALVE-42` demo POs/GRNs.
  - Replaced binary `file.text()` on bill uploads with `file.arrayBuffer()` -> `validateAndExtractBillDocument`.
  - Added inline **Verify / Edit** review controls + `updateInboundBillCaptureReviewInDb`, enforcing `human_verified === true` before posting `'needs_review'` captures.
  - Added `vendor_fraud_alerts.capture_id` linkage so overriding an alert in `resolveVendorFraudAlertInDb` unfreezes the blocked `inbound_bill_captures` record cleanly back to `'needs_review'`.

### F-05 (P0): MCP Edge Function, Member RLS & Dispatcher Multi-Tenant Hardening
- **Migration (`20261125000000_mission09_integrity_security_workforce.sql`):**
  - Tightened RLS on `bot_manuals`, `staged_ops_actions`, `staged_ledger_entries`, and `workspace_mcp_tokens` to owner/admin (`is_workspace_owner(workspace_id)`).
  - Dropped authenticated `DELETE` policy on `agent_action_ledger` to preserve immutable audit trails.
- **MCP Server (`supabase/functions/loose-ends-mcp/index.ts`):**
  - Re-validates `tokenRow.owner_user_id` against live `workspace_members` (`owner`/`admin`) when present.
  - Added `assertBotNotObserveOnly` enforcing `bot_manuals.mode === 'observe'` across all staging/write tools.
  - `run_three_way_match`: forbids inline array overrides when `vendor_bill_id` is supplied and protects terminal `'paid'`/`'disputed'` bills from overwrite.
  - `create_quote_draft` defaults omitted `status` to `'draft'`; `log_agent_action` forces server-side `'pending_approval'`; `dismiss_communication_draft` blocks dismissing `'approved'` drafts; `upsert_public_lead` preserves active/terminal lead statuses; `stage_purchase_order` verifies `inventory_item_id` ownership within `workspaceId`; `save_ops_readiness_audit` strips executable HTML via `sanitizeAuditHtml`; consent lookup switched to `.ilike("email", email)` with 500-row limit.
- **CLI Outbound Scripts (`scripts/sendApprovedDrafts.ts`, `scripts/generateOutreachDrafts.ts`):**
  - `sendApprovedDrafts.ts`: requires unambiguous workspace (`DEFAULT_WORKSPACE_ID` or single workspace), scopes `.eq('workspace_id', ...)` across consent/customer/lead/inbox queries and updates, uses `.ilike()` for direct email suppression, and refuses cleartext `http://` Basic-auth SMTP relays on non-loopback hosts.
  - `generateOutreachDrafts.ts`: scopes `public_leads` and suppression lookups strictly by `workspaceId`, and appends the mandatory CAN-SPAM B2B opt-out + Parkersburg WV physical address via `ensureCanSpamOutreachFooter` before queueing `ops_communication_drafts`.

### F-06 (P1): Entity Identity Verification, Creation UI & Null-Entity Filtering
- **Migration & Types (`20261125000000`, `types.ts`, `jobMarginEngine.ts`):**
  - Removed `NOT NULL` / `'0000'` default on `workspace_entities.ein_last4`, nullified unverified `'4821'`/`'0000'` backfill rows, added `ein_verified` + `identity_status`, and added `enforce_entity_workspace_ownership()` trigger on `bank_feed_transactions`, `inbound_bill_captures`, `job_margin_records`, and `ledger_entries`.
  - Fixed `filterByEntityId` so `'consolidated'` and `'primary'` scopes preserve `entity_id: null` records.
- **UI (`SessionContext.tsx`, `AppShell.tsx`, `release5Queries.ts`):**
  - Removed synthetic `'primary'` switcher option and hardcoded `'···4821'`/`'0000'` padding; renders `(EIN Unverified)` when null/unverified.
  - Wired `createEntity` in `SessionContext.tsx` and Obsidian Dark **Add Legal Entity** dialog (`+ Entity`) in `AppShell.tsx`.

### F-07 (P1): Honest Integration Labels, Inbound Bill Webhook & Stripe Refunds/Idempotency
- **UI & MCP Copy (`Release5BookkeepingPanels.tsx`, `AutonomousSandboxPanel.tsx`, `LandingPage.tsx`, `loose-ends-mcp/index.ts`):**
  - Replaced misleading live Plaid & live QuickBooks Online API sync copy with accurate CSV / OFX-QBO / manual JSON & Shadow Audit descriptions (explicitly noting live Plaid / QBO OAuth sync are not connected).
- **Inbound Bill Webhook (`supabase/functions/inbound-bill-webhook/index.ts`):**
  - Added HMAC-SHA256 webhook handler (fail-closed `503` without `INBOUND_EMAIL_WEBHOOK_SECRET`), `5 MB` payload limit, workspace resolution, SHA-256 `content_hash` dedupe, integer-cent text parsing into valid `inbound_bill_captures` columns, and `agent_action_ledger` pending logging.
- **Stripe (`create-subscription-checkout/index.ts`, `stripe-webhook/index.ts`, `20261125000000`):**
  - Added `STRIPE_PRICE_ID_REVENUE_RECOVERY` env override (preserving fallback `price_1URCPvIS04s94hSMFJ9azsC8`) and `Idempotency-Key` support on Checkout session creation.
  - Added `public.stripe_refund_events` ledger + HMAC-verified `charge.refunded` / `charge.refund.updated` recording inside `stripe-webhook/index.ts`.

### F-08 (P1): Cross-Tenant FK Triggers, Grok Router Access & Observe Enforcement
- **Grok Bot Router (`supabase/functions/grok-bot-router/index.ts`):**
  - Replaced wildcard `*` CORS with origin allowlist (`looseendsos.app`, `www.looseendsos.app`, `loose-ends-os.vercel.app`), required `owner`/`admin` role, enforced 64 KB text & 5 MB base64 caps, eliminated `"Uploaded Receipt Image $249.00"` fabrication fallback (returns `502`), clamped `amount_cents >= 0`, and enforced `botMode === 'observe'` skip on `staged_ledger_entries`.
- **Cross-Workspace Uniqueness (`20261125000000`):** Scoped `ops_drafts_lead_step_unique_idx` by `(workspace_id, lead_id, sequence_step)` and enforced entity-workspace FK triggers.

### F-09 (P2): Multi-Role Autonomous Workforce Ledger & Control Engine
- **Schema & Orchestrator (`20261125000000`, `src/lib/workforce/workforceOrchestrator.ts`):**
  - Created `public.agent_workforce_tasks` + `public.claim_workforce_task_atomic` (`FOR UPDATE SKIP LOCKED`, `hop_count <= max_hops <= 2`, `visited_roles`, lease expiry, retries, cost/token budgets).
  - Implemented 10-role policy engine with idempotent enqueueing, hop-capped + cycle-blocked delegation, read-only -> write escalation prevention, lease claiming, token/budget dead-letter escalation, and human-approval gating before final completion.

### F-10 (P2): Documentation & Dependency Audit Verification
- Replaced obsolete `README.md` with accurate architecture, commands, and honest integration disclosures; ran real `npm audit --json` against `scripts/check-dependency-audit.mjs`. *(Note: early baseline table DDL consolidation outside existing migrations remains documented in `MISSION-09-BASELINE.md` for future snapshot export.)*
