# Loose Ends OS — connected operations release (2026-10-21)

This release extends the existing production JavaScript runtime. It does not replace the app, change Stripe prices or reset customer data.

## Implemented

- Unified Executive Command Center, with database aggregates, operational priorities, departmental navigation and recent autonomous outcomes. Legacy stacked revenue panels are suppressed in operations views. Existing CRM, sales, documents, workflows and Revenue Intelligence remain accessible.
- Inventory records: names, SKUs, barcode, category, supplier, description, location, cost, selling price, stock, reservations, reorder settings, valuation, search, pagination, editing and archive. Authenticated transactional receipts, returns, adjustments and immutable movement history. CSV metadata import supports quoted/multiline fields, bounded files, per-row confirmations and stable replay receipts. Opening stock is recorded through stock receipts.
- Jobs and estimates: customer and existing workspace-member assignment, priority, labor estimate, notes, completed checklist, recorded approval evidence, allowed status transitions, stock allocation, cancellation/release, scheduling in the existing appointments table, atomic completion/material consumption/invoice drafting and basic material margin visibility. Completion cannot create duplicate invoices. No invoice is sent or charged by completion.
- Purchasing: internal drafts, explicit owner/admin approval or denial and receiving references. Confirmed receiving adds stock atomically and cannot double receive. No supplier integration, purchase submission or payment execution is enabled.
- Finance: invoice aggregates, outstanding balances, owner-marked-paid invoices, independently verified USD recovery payments, expenses and vendor bill records, with evidence distinctions. Expense records are owner-reported; there is no bank reconciliation or autonomous money movement.
- Team: existing workspace roles and bounded assigned-workload visibility. Jobs assign actual workspace members. No payroll or invitations are added.
- Autonomous inventory operations: minute-based pg_cron observation, policy checks, internal draft generation, persisted verification, deduplication, 100-operation batches, workspace serialization, execution timeout, retry/backoff, dead-letter handling, owner retry, policy pause/kill switch and audit outcomes. Policies default to paused. Owner-defined limits constrain automatic draft preparation, not actual spending. External purchases remain disabled.
- Industry context choices: general, auto repair, HVAC, plumbing, electrical, general contracting, landscaping and home services. These are policy context settings; complete industry-specific forms, equipment models and workflow templates are not yet implemented.
- Database authorization: workspace-scoped RLS reads; owner/admin transactional RPC writes; protected private receipt store; compound tenant foreign keys; no direct authenticated writes to stock, queue or audit tables. Existing importer, billing and recovery records are preserved.
- Product positioning and public pricing: Business Operations OS / Your Business. Running Smarter.; landing page now reflects the authorized $199/month subscription rather than unrelated advertised tiers.

## Executed verification

- TypeScript typecheck and production Vite build.
- 25 existing/new Node regression files. Tests include runtime behavior, parser cases and source invariants; source assertions are not proof of live integrations. Repairs corrected stale asset-version assertions, a TypeScript test harness and incomplete query mocks without weakening production checks.
- `tests/connected-operations.sql` ran against PostgreSQL using authenticated and anonymous roles in rolled-back fixture transactions. Covered access rejection, malformed amounts, insufficient stock, reserved-stock protection, receipt replay, mismatched idempotency content, valid transitions, approval/checklist gates, single invoice, receiving, policy pause and calendar overlap.
- `tests/connected-operations-http.mjs` ran against deployed Supabase APIs using a disposable authenticated QA account/workspace. Tested the deployed bulk importer: unauthorized workspace, incomplete finish, duplicate contact matching, same-batch replay, status/resume, receipt reconciliation, multiline/quoted field values and exact final counts (3 processed, 2 customer records). This was real HTTP execution; file-picker interaction remains unverified.
- Real HTTP operations tested tenant checks, direct-write denial, receipt replay, insufficient stock, job allocation/approval/completion, one invoice and its exact total. Tests made no charges and sent no customer communications.
- Production pg_cron independently processed the HTTP QA shortage and persisted `draft_verified`, one PO draft and `external_order_submitted: false`.
- Runtime dependency audit: zero reported vulnerabilities. Full development audit: 5 high and 2 moderate findings in the Tailwind/globbing/parser toolchain; the repository's current full-audit gate permits noncritical development findings. No major Tailwind migration was attempted during this operational release.
- Supabase advisor: no new exposed-table permission warnings; private/default-deny receipt and importer tables appear as informational RLS-without-policy entries. Existing compromised-password protection remains disabled in Auth settings.

## Remaining limitations — not a declaration of full mission completion

The broad requested transformation is not fully complete. The implementation does not prove or provide all of the following:

- Authenticated mobile/desktop browser end-to-end acceptance, accessibility audit, concurrency/load benchmarks or representative large-workspace throughput. Browser inspection reached the production sign-in wall. Database role and real authenticated HTTP tests are separate evidence.
- Supplier purchasing integrations, external email/SMS sending, verified delivery, external calendar synchronization, bank/accounting reconciliation, autonomous refunds/transfers/charges or payroll. These capabilities remain disabled or outside this release's verified scope.
- Full recurring-service dispatch, travel-time routing, worker availability calendars, business-hours policy enforcement, rich employee profiles, attachments, versioned customer-facing estimates, equipment/vehicle models and industry workflow templates.
- Full cross-department event orchestration or adaptive learning. The new engine is a deterministic, auditable inventory-draft workflow. Existing workflows remain separate with existing per-workflow policies. The new kill switch controls the new inventory engine only.
- Full Stripe sandbox acceptance for subscription creation, cancellation, payment failure, duplicate/out-of-order webhooks and reconciliation. Existing billing functions/pricing were preserved, but no customer was charged to test them.
- Existing Revenue Intelligence still has its bounded legacy reporting behavior; only the new command center uses database aggregate summaries and avoids its full browser-side loader.
- Automatic stock replenishment based on predicted consumption, partial purchase receiving, tax calculations, invoice delivery and complete accounting profitability are not implemented.

## Recovery

Pause the inventory policy in Operations to stop new drafts and cancel pending/deferred inventory actions. Retain dead-letter jobs and use owner retry after resolving their cause. Existing drafts require explicit approval and do not contact suppliers. Preserve movement history; correct stock through reasoned adjustments rather than deleting ledger entries. A frontend rollback can use the preceding Vercel production deployment; the additive schema can remain in place. Do not drop new tables after business records exist. Customer-import retry/resume behavior and the original workflow cron remain intact.
