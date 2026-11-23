# MISSION 09 — OPENAI OPENWORKS DEMO & WORKSHOP PLAYBOOK

> **Disclosure on Data Shown:** Every company name, dollar figure, invoice, purchase order, bank row, and bill text below uses **synthetic sample data** built specifically for live sandbox and evaluation walk-throughs. No live customer PII or real financial accounts are exposed.

---

## Live Demonstration Architecture (Demos 1–3)

### Demo 1 — Zero-Migration Shadow Leak Audit (`CSV` -> Recoverable Cash in <60s)
- **Route:** `/demo` -> **Shadow Mode** panel (or `/calculator` -> **Launch Shadow Demo** handoff)
- **Synthetic Sample Dataset (`SAMPLE_SHADOW_QB_CSV`):** 8 synthetic QuickBooks/Zoho export rows representing:
  - Unbilled completed service tickets (`quote_completed_unbilled`)
  - Overdue AR balances (`>30d`, `>60d`)
  - Exact-cent duplicate vendor charges (`<=7d`)
  - Silent vendor recurring rate hikes (`>10%`)
- **What Buyers See:**
  1. Upload/load CSV in-browser -> deterministic integer-cent parser classifies leaks into 4 buckets with row-level Proof Citations.
  2. Click **Promote to Action Queue** -> stages human-approved drafts (`staged_ops_actions`) and logs reversible entries cleanly without auto-emailing or touching customer accounts.
- **Measured Outcome Metric:** Total recoverable cash cents detected + per-finding evidence string + zero floating-point rounding drift.

### Demo 2 — Inbox-to-Ledger 3-Way Match, Fraud Shield & Safe 1-Click Undo
- **Route:** `/demo` -> **Autonomous Inbox-to-Ledger + 3-Way Match** panel (or `/dashboard/bookkeeping` on authenticated workspace)
- **Synthetic Sample Fixtures (`SAMPLE_INBOUND_BILL_CLEAN_TEXT`, `SAMPLE_INBOUND_BILL_SPIKE_TEXT`):**
  1. **Clean Bill Scenario (Apex Industrial Supply — `PO-2026-1104`, `$640.00`):** PO qty (`4`) == Goods Receipt qty (`4`) == Bill qty (`4`) & unit cost `$160.00`. Clears `3way_matched` with `$0.00` variance -> 1-click Post to GL -> **1-Click Undo** cleanly restores pre-post state (no invoice voiding, no COGS double-counting).
  2. **Vendor Fraud Hike Scenario (Titan Valve Corp — `+33%` unit price jump from `$42.00` to `$56.00`):** Automatically freezes as `fraud_frozen`, opens a `Vendor Fraud Alert` citing historical PO unit cost (`4200c`), and locks GL posting until an owner explicitly reviews & approves override.
  3. **Scanned Image PDF Safety Check:** Uploading an image-only PDF flags `0% confidence` (`pdf_scanned_needs_ocr`) and requires manual text/field entry + checkbox **Human Verified** before GL posting—zero `$0.00` or `$249.00` fabricated totals.

### Demo 3 — Multi-Role Workforce Policies, Bank Feed Reconciliation & CPA Tax Packet
- **Routes:** `/demo` -> **Workforce / Bank Feed / CPA Audit Packet**; codebase verification `src/lib/workforce/workforceOrchestrator.ts`
- **Synthetic Bank Feed Fixture (`SAMPLE_BANK_FEED_CSV` / `SAMPLE_PLAID_WEBHOOK_JSON` manual format):**
  - Matches open AR inflows and AP outflows strictly on exact cents, skips already-paid records, refuses double-matching a single invoice to two deposits, and downgrades confidence (`90.0%` vs `100.0%`) if merchant name does not overlap counterparty.
- **CPA Tax & Audit Packet:** Compiles reconciled integer-cent **Trial Balance** (Total Debits == Total Credits), **P&L**, and **Balance Sheet** (`Assets == Liabilities + Equity`).
- **10-Role Workforce Governance:** Enforces `MAX_DELEGATION_HOPS = 2`, blocks cycles, blocks read-only -> write escalation, caps tokens/cost in `agent_workforce_tasks`, and pauses approval-required roles at `awaiting_approval`.

---

## Step-by-Step Spoken Demo Script (12 Minutes)

1. **Minute 0–2 (Positioning & Pricing Hook):** Open `/calculator`. Slide Revenue (`$140k/mo`), Seats (`12`), Overdue AR/Bills (`$18k`). Contrast flat `$199/mo unlimited seats` vs per-seat QuickBooks/SaaS creep. Emphasize zero migration required to start.
2. **Minute 2–5 (Shadow Mode Proof):** Click into `/demo`, run Shadow CSV scan on the synthetic HVAC/Trades export. Point out exact-cent evidence citations per finding—explain why SMB owners reject "AI black boxes" unless every dollar links back to an invoice or vendor charge.
3. **Minute 5–9 (AI Controls That Don't Wreck Your Books):** Trigger both **Clean 3-Way PO (`$640.00`)** and **+33% Fraud Spike**. Show Posting locked on `fraud_frozen`, then post Clean PO and hit **1-Click Undo** to prove reversibility.
4. **Minute 9–12 (CPA-Grade Trial Balance & Governance):** Show the integer-cent Balanced Trial Balance + Balance Sheet (`$0.00` rounding variance) and summarize our 10-role workforce guardrails (`hop <= 2`, budget caps, explicit owner approval gates).

---

## 60-Minute OpenWorks Workshop Outline

| Block | Duration | Focus & Audience Takeaway |
|---|---|---|
| **1. Why SMB AI Fails Without Deterministic Accounting** | 10 min | Floating-point bugs, silent invoice voids, fabricated OCR, and why LLMs must propose integer-cent JSON while PostgreSQL RPCs commit state. |
| **2. Live Walkthrough: Shadow Mode -> 3-Way Match -> CPA Packet** | 20 min | Live interactive run of Demos 1–3 using synthetic datasets (`$199/mo` commercial positioning + safety rails). |
| **3. Multi-Agent Control Planes (Hop Caps, Leases & Approval Gates)** | 15 min | Architecture breakdown of `agent_workforce_tasks`, `FOR UPDATE SKIP LOCKED`, read-only vs write RBAC, and `bot_manuals` (`observe` / `propose` / `auto_with_undo`). |
| **4. 14-Day Pilot Playbook & Q&A** | 15 min | Importing historical CSVs without risk, weekly exception review cadence, and security checklist before going live. |

---

## Measurable Pilot Baseline & Outcome Report Template

| Metric | Baseline (Day 0 CSV Audit) | Day 14 Verified Outcome | Data Source / Proof Ref |
|---|---|---|---|
| **Open / Overdue AR Scanned (`cents`)** | `$____.__` | `$____.__` recovered / staged | `shadow_sessions` + `collection_touches` |
| **Unbilled Completed Work Flagged** | `__ jobs ($____.__)` | `__ invoiced ($____.__)` | `shadow_findings` (`unbilled_quote`) |
| **Vendor Price Spikes / Duplicates Frozen** | `__ alerts ($____.__)` | `__ blocked before AP payment` | `vendor_fraud_alerts` + `inbound_bill_captures` |
| **Bank Rows Matched vs Reconciled** | `__ / __ CSV/OFX rows` | `$0.00` Trial Balance delta | `bank_feed_transactions` + CPA Packet |
| **Human Approval Rate vs Auto-Paused** | `100% owner-gated outbound` | `__ approved / __ rejected` | `ops_communication_drafts` + `agent_action_ledger` |
| **SaaS Seat Consolidation Delta** | `$____/mo` (N seats) | `$199/mo` flat (unlimited seats) | Workspace billing comparison |
