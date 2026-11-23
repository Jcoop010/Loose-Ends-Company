# MISSION 09 — COMMERCIAL & REVENUE READINESS PLAN

**Positioning:** Loose Ends Operations OS is an AI-assisted operational & AP/AR control layer for SMB trades, clinics, and bookkeeping teams at **\$199/month flat (unlimited workspace seats)** — positioned initially alongside existing accounting tools rather than forcing a rip-and-replace ledger migration.

---

## Target Beachhead & Go-To-Market Motion

1. **Primary Geography — Mid-Ohio Valley Regional Density (Parkersburg, WV · Marietta, OH · Vienna, WV · Charleston/Huntington Corridor):**
   - Local high-trust ICP: 5–40 person HVAC/plumbing/electrical contractors, independent medical/dental practices, and regional CPA/bookkeeping firms overwhelmed by unbilled completed field work, overdue AR follow-up, and manual vendor invoice checking.
   - Inbound capture funnel: `/calculator` public Leak Estimator -> `/demo` interactive sandbox -> `/dashboard/pipeline` 48-hour call follow-up queue + owner-approved outreach sequences (CAN-SPAM compliant footer + unsubscribe gate).
2. **Secondary Expansion — National Remote Pilot Cohort:**
   - CPA & fractional controller channel partners onboarding 3–10 SMB clients per workspace via multi-entity views and 1-Click CPA Trial Balance / P&L / Balance Sheet exports.

---

## Commercial Packaging (3 Clear Offers)

| Offer | Price & Structure | Scope Included | Delivery & Guardrail SLA |
|---|---|---|---|
| **1. Zero-Migration Shadow Leak Audit Sprint** | **\$495 one-time** *(credited 100% if converting within 30 days)* | Historical CSV ingest (QuickBooks, Zoho, Stripe, Bank), 4-bucket leak audit report, human-reviewed prioritized recovery queue, and 30-min founder review call. | Zero writes to customer's live QBO/email/bank; read-only file analysis with CSV/PDF proof packet. |
| **2. Loose Ends Autonomous OS Core** | **\$199 / month flat** *(unlimited workspace seats)* | Full SaaS workspace (CRM, Quotes `/portal/:token`, AR Collections drafts, PO 3-Way Match, Inbound Bill Capture & Fraud Shield, CSV/OFX Bank Reconciliation, CPA Tax Packet, Multi-Entity Switcher, Compliance Vault). | Self-serve Stripe Checkout (`create-subscription-checkout`); all external emails, POs, and GL posts gated by human approval unless explicitly enabled with 1-Click Undo. |
| **3. Assisted Onboarding & Custom SOP Setup** | **\$950 setup + \$199/mo** *(white-glove 14-day pilot)* | Workspace & multi-entity configuration, initial vendor/SKU PO baselines, custom Living SOP rules (`executable_sops`), CPA export alignment, and optional BYO-Agent MCP endpoint setup. | Owner approves every live webhook, sender inbox domain, and outreach batch before dispatch (`--dry-run` default on scripts). |

---

## Honest Commercial Boundaries (Pre-Launch Disclosure Checklist)

Sales conversations and SOWs must state accurately:
- **Live Bank Sync / Direct QuickBooks API:** Currently operates via structured **CSV, OFX/QBO, and manual JSON imports** — live Plaid OAuth (`Link`) and live QuickBooks Online REST sync (`quickbooks-sync`) are roadmap items and are **not** active integrations today.
- **Email-to-Bill Alias (`bills+<slug>@inbound.looseendsos.app`):** Requires deploying `inbound-bill-webhook` with `INBOUND_EMAIL_WEBHOOK_SECRET` and configuring MX/inbound forwarding during onboarding; browser PDF/text upload is live immediately.
- **Outbound Email & SMS Automation:** Outbound scripts require explicit owner approval (`status = 'approved'`) and pass CAN-SPAM / consent suppression checks; SMS remains disabled without recorded explicit opt-in.
- **OCR on Scanned Image PDFs:** Digital PDF text streams and structured text extract automatically; image-only scans flag `0%` confidence and require owner verification or local CLI OCR before GL posting.

---

## 14-Day Pilot Conversion Playbook

1. **Day 1:** Create tenant workspace, verify legal entity (`workspace_entities`), set baseline PO/SKUs and `vendor_bills`, run historical Shadow Leak CSV scan (`/dashboard/shadow`).
2. **Days 2–5:** Owner reviews top overdue AR (`collection_touches` staged drafts) and uploads active week's supplier bills (`Inbox-to-Ledger`) + bank export CSV/OFX (`Bank Reconciliation`).
3. **Days 7–10:** Review any frozen vendor price hikes (`vendor_fraud_alerts`), reconcile auto-matched bank rows, and generate interim CPA Trial Balance packet.
4. **Day 14:** Present pilot **Outcome Report** comparing cash flagged/collected and SaaS seat savings vs \$199/mo subscription; transition into paid monthly Stripe billing.
