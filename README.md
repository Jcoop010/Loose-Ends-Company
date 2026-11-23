# Loose Ends Operations OS

**Production-oriented AI Business Operations OS for SMB trades, medical/dental clinics, and accounting/bookkeeping practices.**

- **Production Web App:** https://www.looseendsos.app (`Vercel`, auto-deploys from `main`)
- **Database & Edge Functions:** Supabase (`uehfvpnnoitgybsmdgef`)
- **Flat Workspace Pricing:** \$199/month unlimited workspace seats (no per-seat SaaS tax)

---

## Architecture Overview

- **Frontend (`src/`):** React 18, TypeScript (`strict: true`, `noUnusedLocals`, `noUnusedParameters`, zero `any`), Vite, Obsidian Dark executive rail UI (`AppShell`, `RouterContext`, `SessionContext`).
  - Public routes: `/` (Landing), `/calculator` (QuickBooks & Ops Leak Estimator), `/demo` & `/demo/:section` (100% air-gapped interactive sandbox using in-memory `DemoStoreContext`), `/portal/:token` (client quote/invoice e-sign & payment handoff).
  - Authenticated dashboard (`/dashboard*`): Command Center, CRM & Pipeline, Quotes & E-Sign, Invoices & AR, Agent Ledger & Autonomy (with 1-Click Undo), Fulfillment & Schedules, Inventory & Procurement (3-Way Match), Bookkeeping & AP (CPA Tax Packet, Inbox-to-Ledger Capture, CSV/OFX Bank Feed Reconciliation), Compliance Vault, Living SOPs, Shadow Mode (CSV Leak Audit), and Billing/MCP settings.
- **Deterministic Business Engines (`src/lib/`):**
  - Pure integer-cent (`*_cents`, basis points `*_bps`) financial and workflow engines: `shadowEngine.ts`, `cpaPacketEngine.ts`, `collectionsEngine.ts`, `inboxToLedgerEngine.ts`, `bankReconciliationEngine.ts`, `jobMarginEngine.ts`, `documentParser.ts`, `leakCalculatorEngine.ts`, `sequencerEngine.ts`, and `workforceOrchestrator.ts`.
  - Binary PDF text-stream parser (`documentParser.ts`) with `5 MB` cap, `FlateDecode` decompression (`DecompressionStream`), SHA-256 `content_hash` deduplication, and explicit `0%` confidence flagging for scanned image-only PDFs (no fabricated `$0.00` totals).
- **Supabase SQL & Edge Functions (`supabase/`):**
  - Migrations (`supabase/migrations/`) covering Release 1–5 schemas, Growth Engine v1, and Mission 09 transactional RPCs (`post_inbound_bill_capture_atomic`, `reconcile_bank_feed_atomic`, `apply_job_change_order_atomic`, `reverse_agent_action_atomic`, `claim_workforce_task_atomic`), workspace-owner RLS, and refund tracking.
  - Edge Functions (`supabase/functions/`): `create-subscription-checkout`, `create-billing-portal`, `stripe-webhook`, `customer-bulk-import`, `grok-bot-router`, `loose-ends-mcp`, `recovery-delivery-preflight`, `workflow-runner`, and `inbound-bill-webhook`.
- **CLI & Local AI Worker Tooling (`scripts/`):**
  - Outbound lead discovery (`scoutProspects.ts`, `scoutRegionalLeads.ts`), local Ollama / xAI outreach draft generator (`generateOutreachDrafts.ts`), human-approved dispatcher with multi-inbox rotation and CAN-SPAM / consent checks (`sendApprovedDrafts.ts`), and local receipt OCR auditing (`parseReceiptLocal.ts`).

---

## Honest Integration Boundaries (Verified State)

- **Shadow Audit & Bank Feed Ingestion:** Supports CSV (QuickBooks, Zoho, Stripe, Bank), OFX/QBO statements, and manual JSON payloads. Live Plaid Link / `/transactions/sync` and live QuickBooks Online OAuth sync (`quickbooks-sync`) are **not** connected.
- **Inbound Email Forwarding (`bills+<slug>@inbound.looseendsos.app`):** `supabase/functions/inbound-bill-webhook` requires deploying with `INBOUND_EMAIL_WEBHOOK_SECRET` and configuring external MX/inbound webhook routing. Manual PDF/CSV/text upload works directly in Bookkeeping & AP.
- **Customer Communications & Billing:** Outbound email scripts and MCP draft tools enforce human approval and CAN-SPAM / opt-out checks (`--dry-run` default on dispatcher). Stripe checkout uses hosted Stripe Checkout & Webhook HMAC verification.

---

## Local Development & Verification Commands

```powershell
# TypeScript strict check
npm.cmd run typecheck

# Build production Vite bundle into dist/
npm.cmd run build

# Scan built dist/ bundle for leaked server secrets
node scripts/scan-dist-secrets.mjs

# Run full offline regression suite
npm.cmd test
```

> Never commit or print raw secrets (`.env`, `.env.local`, service-role keys, Stripe secrets, webhook secrets, or MCP bearer tokens).

---

## Mission 09 Audit & Certification Documentation

- [`docs/MISSION-09-BASELINE.md`](docs/MISSION-09-BASELINE.md) — Repository inventory & 6-category capability classification
- [`docs/MISSION-09-FINDINGS.md`](docs/MISSION-09-FINDINGS.md) — Evidence-based P0/P1/P2 findings ledger (`F-01`–`F-10`)
- [`docs/MISSION-09-REMEDIATION.md`](docs/MISSION-09-REMEDIATION.md) — Complete file-by-file remediation log
- [`docs/MISSION-09-CERTIFICATION.md`](docs/MISSION-09-CERTIFICATION.md) — Test, build, security & audit verification gates + Phase 9 rollout checklist
- [`docs/MISSION-09-OPENWORKS-DEMO.md`](docs/MISSION-09-OPENWORKS-DEMO.md) — OpenAI OpenWorks demos 1–3, synthetic sample datasets & workshop outline
- [`docs/MISSION-09-REVENUE-READINESS.md`](docs/MISSION-09-REVENUE-READINESS.md) — Mid-Ohio Valley + national pilot commercial rollout plan
