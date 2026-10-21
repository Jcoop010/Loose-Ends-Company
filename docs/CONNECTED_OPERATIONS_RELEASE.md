# Loose Ends OS — implementation and acceptance record

Updated October 21, 2026. This replaces the earlier release's limitations list.

The existing application, Supabase project, customer data and $199/month Stripe price are preserved. No customer charges, supplier purchases or outbound customer messages were made during testing.

## Implemented and connected

| Area | Delivered behavior |
| --- | --- |
| Command Center | Operational health, evidence-based priorities, departmental navigation, pending actions, failures and outcome counts. Legacy demo ribbons and stacked launch panels are excluded. |
| CRM | Creation, server search, editable unified customer profile, notes and linked jobs, estimates, documents, appointments, communication drafts, consent/opt-outs, tasks, follow-ups, opportunities and verified recovery payments. Profiles show up to 25 recent records per section. New operational forms search the complete workspace customer table with bounded results. |
| Inventory | SKU/barcode/category/supplier/location/cost/price, stock/reservations/availability, valuation, archive, CSV metadata import, transactional receipts/adjustments/returns, movement history, job allocations and low-stock purchasing drafts. Negative available stock and duplicate deductions are prevented. |
| Estimates and jobs | Customer associations, priorities, workers, industry checklists, service/asset details, secure attachment references, revision reasons, immutable quote snapshots, retained prior revisions, approval evidence, valid transitions and atomic stock consumption plus one invoice draft on completion. Quoted materials cannot be changed without a revision. Checklist editing preserves incomplete steps. |
| Scheduling and dispatch | Shared existing appointments table, worker assignments, rescheduling, cancellation, job assignment consistency, duplicate-booking rejection, worker unavailability/shifts, inactive-worker checks, optional business-hour enforcement, business time zone and configurable travel buffers. No external calendar provider is claimed. |
| Recurring services | Due service plans produce one reviewable estimate draft per due occurrence. They do not approve work or schedule customers automatically. Malformed recurring configurations are paused with an audit error without stopping other processing. |
| Team | Named employee profiles tied to existing membership, job titles, work phones, skills, active status, availability and database-aggregated workload. Profiles do not grant permissions or implement payroll. |
| Finance | Invoice and expense records, vendor bills and owner-reported paid status, aging buckets, inventory valuation, pre-labor material margin, separate owner-reported amounts and independently provider-verified USD recovery payments. No banking or money movement is implied. |
| Communications | Shared customer email/SMS drafts, source-event attribution, review/deny, channel-consent gate and automatic rejection of existing drafts when consent is revoked. Approval never sends a message. Replaying an old approval receipt cannot restore a revoked draft. |
| Industry templates | General, auto repair, HVAC, plumbing, electrical, contracting, landscaping and home services. Shared modules use selected checklists and relevant vehicle/equipment/site/service fields. |
| Autonomous coordination | Production minute-based cron observes jobs, new customers/leads, invoices, appointments and overdue tasks; re-reads source state; applies owner policies; creates internal tasks and unsent drafts; verifies saved outcomes; and records audit history/outcome metrics. Obsolete quotes and settled obligations are skipped. Recurring jobs and inventory drafts run on the backend without a browser. |
| Recovery and authorization | Workspace RLS, tenant checks, owner/admin command permissions, transactional receipts, idempotency content validation, rate limits, bounded processing, backoff, three-attempt dead-letter handling, expired-lease recovery, owner retry, kill/pause policies, explicit approvals and audit records. The new operations master switch covers the new engines; older custom workflows keep their existing individual controls. |
| Reporting and dependencies | Business-day dashboard counts respect business time zone; invoice aging is server-aggregated. Relationship indexes cover every foreign key identified by the performance advisor. Tailwind/PostCSS upgraded and both stylesheets compile. Full and runtime dependency audits are clean; CI now rejects high-severity development findings as well. |

## Executed verification

| Check | Evidence and boundary |
| --- | --- |
| Node regressions | 26 test files, including new DOM regression checks for incomplete checklists, department views, single-screen rendering and sign-out clearing. Source invariants and backend mocks are not treated as integration proof. |
| TypeScript/build/CSS | Typecheck, Vite production build, and compilation of both standalone and React stylesheets. |
| Real PostgreSQL transactions | Existing operations suite plus coordination and recovery suites, run in rolled-back fixtures using authenticated and anonymous roles. Covers quote revisions, approval gates, source-state checks, availability, hours, duplicate bookings, recurrence, malformed templates, consent, opt-outs, bounded retry, dead-letter handling and owner recovery. |
| Authenticated DOM → deployed Supabase | A disposable QA account exercised the actual UI handlers against real Supabase: policy, employee profile, incomplete industry checklist, quote and revised amount, approval, booking/reschedule, checklist completion, single invoice, communication draft, customer profile edit, vendor-bill paid record, finance and all new department views. This verifies DOM behavior/API/data/response boundaries, not real browser rendering or the sign-in form. |
| Real HTTP/import | Previous release verified the deployed importer with cross-tenant rejection, incomplete finish rejection, duplicate matches, receipt replay, resume and accurate final counts. Parser quoting/multiline regressions remain in the suite. No browser file-picker claim is made. |
| Concurrent stock replay | Previous release sent eight identical authenticated HTTP stock receipts concurrently; exactly one unit was added. This is an idempotency test, not a general concurrency benchmark. |
| Actual scheduled worker | The production cron processed QA events independently of the UI, persisted verified tasks/drafts and recorded zero dead-letter failures in the live QA flow. Draft delivery remained `not_sent`; no external order was submitted. |
| Synthetic scale | Rolled-back fixture with 2,000 customers and 5,000 inventory items: summary approximately 166 ms and a 50-item inventory page approximately 1.4 ms on the tested database. These single-query measurements are not promises about production throughput or concurrent load. |
| Dependency audits | Full and production/runtime reports: zero reported vulnerabilities after the toolchain upgrade. |
| Database advisors | Foreign-key index notices addressed. Remaining performance notices concern indexes not yet used. Private/default-deny receipt/import tables retain informational RLS-without-policy notices. Existing Auth compromised-password protection remains disabled in project settings. |

## External and acceptance blockers

- The Stripe connector explicitly returned `Reauthentication required / oauth_token_invalid_grant`. A full authorized Stripe sandbox subscription lifecycle (checkout, activation, failures, cancellation, duplicate/out-of-order provider events, portal and reconciliation) remains unverified. Existing live billing configuration and price are unchanged. Unsigned webhooks and unauthenticated billing requests were previously verified rejected.
- The production browser is signed out. Real authenticated mobile/desktop screen acceptance, accessibility inspection and the browser file-picker journey require secure sign-in. The real Supabase-backed DOM tests above do not substitute for these checks.
- Supplier ordering, external customer sending/delivery, external calendar synchronization, bank/accounting reconciliation, tax filing, refunds/transfers and payroll remain disabled or outside the verified integration scope. Do not advertise them as connected or operational.
- The engine uses deterministic evidence/policy rules and measured outcomes. It does not retrain models, silently rewrite policies, optimize geographic routes or automatically commit customers to recurring work. Travel buffers are configurable time allowances, not route calculations.
- Attachment support is by named HTTPS reference; this release does not create an unrestricted file-upload/storage system. Quote views are internal revision snapshots; legal e-signature and external document delivery are not claimed.
- General production throughput, multi-user load and long-duration soak testing remain unverified. Legacy Revenue Intelligence retains its existing bounded report loader; new operations views use bounded queries and server aggregates.

## Recovery

Pause the new operations master switch to cancel pending new-engine actions and prevent new processing. Existing custom workflows retain their own disable controls. Review dead-letter errors, fix the cause and use owner retry. Disabling a recurring plan prevents future drafts; existing business records remain for explicit review. No recovery procedure deletes movement history or silently changes approved money/policies. Correct stock through reasoned adjustments. A frontend rollback can return to the previous Vercel production deployment while leaving the additive schema intact. Do not drop tables after customer records exist.

Disposable QA records must be removed after the final acceptance checks; they are isolated from customer workspaces and create no provider charges or communications.
