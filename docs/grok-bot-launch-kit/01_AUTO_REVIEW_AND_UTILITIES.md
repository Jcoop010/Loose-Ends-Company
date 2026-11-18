# 01 — Grok Bot Auto Review Guardrails & ReadMultiplex Utility Bots

Target Platform: **Loose Ends OS** (`https://loose-ends-os.vercel.app`)
Remote HTTPS MCP Endpoint: `https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/loose-ends-mcp`
Primary Workspace: `My Business` (`1dfa4852-9415-446a-b8c2-6d2263f65998`)

---

## Part 1: 4 Mandatory `Ask first` Auto Review Custom Rules

Paste these 4 rules directly into your Grok Bot / Cursor Agent **Auto Review -> Custom Rules (`Ask first`)** settings before enabling any scheduled routines:

### Rule 1 — External Email & SMS Transmission Gate (`Ask first`)
```text
RULE: External Communication & Consent Gate (ASK FIRST)
Never send an external email, SMS, or voice dial directly. Every outbound prospect or customer communication MUST first verify `get_customer_consent_status` (hard-blocking any contact with `opted_out` or `revoked` consent) and MUST be staged via `queue_communication_draft` with `status = 'draft'`, `requires_approval = true`, and `delivery_status = 'not_sent'`. Ask the owner before changing any draft status to `approved`.
```

### Rule 2 — Ledger, Invoice & Stripe Mutation Gate (`Ask first`)
```text
RULE: Financial Ledger & Billing Protection (ASK FIRST)
Never mutate finalized invoices, issue refunds, modify `verified_recovery_payments`, or change Stripe subscriptions directly. All parsed vendor bills, duplicate-fee flags, PO reorders, and unbilled job invoice proposals MUST be staged into `staged_ops_actions` or `staged_ledger_entries` with `status = 'pending_approval'` using exact integer cents (`amount_cents`). Ask the owner before applying any staged entry to the live ledger.
```

### Rule 3 — Read-Only SOP Manual Integrity (`Ask first`)
```text
RULE: Immutable SOP Manuals During Bot Runs (ASK FIRST)
Treat `bot_manuals` (`get_bot_manual`) and Notion SOP pages as strictly read-only policy during bot execution. A bot may never rewrite its own SOP manual, escalate its own `mode` from `propose` to `auto_with_escalation`, or mint/revoke `workspace_mcp_tokens`.
```

### Rule 4 — Non-Buyer & Agency Email Suppression (`Ask first`)
```text
RULE: SMB Prospect Inbox Hygiene (ASK FIRST)
When scouting or enriching SMB prospects via `upsert_public_lead`, strictly reject non-buyer prefixes (`resumes@`, `careers@`, `jobs@`, `hiring@`, `hr@`, `press@`, `media@`, `privacy@`, `legal@`, `abuse@`, `webmaster@`, `noreply@`) and third-party web-design agency footer domains. Prefer domain-matched owner/operations addresses (`owner@`, `founder@`, `office@`, `billing@`, `service@`, `estimates@`, `quotes@`, `info@`) and regional WV / OH / PA businesses.
```

---

## Part 2: Checklist of the 5 Free ReadMultiplex Utility Bots to Install

Install these 5 free utility bots from ReadMultiplex (`https://readmultiplex.com/grokbot-rocks/`) into your operator workspace to supervise your Loose Ends bots:

- [ ] **1. Mission Control Bot**
  - *Purpose*: Single-screen status aggregator across your 4 specialist Loose Ends bots. Reads `get_workspace_overview` (`state_hash` + pending approval counts) and posts a morning digest only when `state_hash` changes.
- [ ] **2. Bot Optimizer**
  - *Purpose*: Audits weekly token consumption across `bot_runs` and trims verbose tool outputs so your weekly Grok credits last all 7 days without exhaustion.
- [ ] **3. Librarian Bot**
  - *Purpose*: Indexes your read-only Notion SOP pages (`02_NOTION_READ_ONLY_SOPS.md`) and `bot_manuals` so specialist bots retrieve exact policy sections without re-reading long threads.
- [ ] **4. Zoom Meeting Companion**
  - *Purpose*: Captures live notes during 5-minute prospect sandbox walkthroughs (`https://loose-ends-os.vercel.app/demo`) and stages follow-up `$249 Document Operations Pilot` proposals via `stage_ops_action`.
- [ ] **5. Memory Transfer Bot**
  - *Purpose*: Compacts weekly `bot_runs` and approved `staged_ops_actions` into a single rolling state checkpoint when rotating threads.
