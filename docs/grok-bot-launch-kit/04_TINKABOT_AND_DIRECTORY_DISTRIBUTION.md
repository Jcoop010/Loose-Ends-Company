# 04 — Tinkabot Cursor Plugin Wrapper & GrokBot.Rocks Directory Distribution

Use these ready-to-paste templates to distribute **Loose Ends OS** as a Cursor Marketplace plugin and list 3 free public funnel bots on `https://readmultiplex.com/grokbot-rocks/`.

---

## Part 1: Exact `tinkabot` Prompt to Wrap `loose-ends-mcp` into a Cursor Plugin

Paste this prompt into `tinkabot` (or Cursor plugin builder) to package `loose-ends-mcp`:

```text
Package the Remote HTTPS MCP server for Loose Ends OS into a Cursor Marketplace plugin:

- Plugin ID: loose-ends-ops-mcp
- Display Name: Loose Ends Operations OS (5-Workspace SMB Ledger & Revenue Recovery)
- Description: Connect Cursor and Grok agents to Loose Ends OS (https://loose-ends-os.vercel.app) via Remote HTTPS MCP. Read-wide visibility across Pipeline, Dispatch, Inventory, Comms, and Billing; write-narrow owner-gated staging for quotes, SMS/voicemail job commands, vendor bill duplicate-charge audits, photo-to-inventory batches, and A–D Operations Readiness Scorecards.
- Remote MCP Endpoint: https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/loose-ends-mcp
- Auth Header: Authorization: Bearer ${env:LOOSE_ENDS_MCP_TOKEN}
- Included Tools (11):
  1. get_workspace_overview (with deterministic state_hash)
  2. list_public_leads
  3. list_pipeline_and_quotes
  4. list_jobs_and_inventory
  5. list_ops_readiness_audits
  6. get_customer_consent_status
  7. get_bot_manual
  8. upsert_public_lead
  9. save_ops_readiness_audit
  10. queue_communication_draft
  11. stage_ops_action
```

### Cursor `.cursor/mcp.json` Snippet for Local Operator Use
```json
{
  "mcpServers": {
    "loose-ends-os": {
      "url": "https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1/loose-ends-mcp",
      "headers": {
        "Authorization": "Bearer YOUR_LOOSE_ENDS_MCP_TOKEN"
      }
    }
  }
}
```

---

## Part 2: 3 Public Free Loose Ends Grok Bots for `readmultiplex.com/grokbot-rocks/`

Submit these 3 free utility bots to `https://readmultiplex.com/grokbot-rocks/` to claim your free **Builder Page** and drive organic SMB traffic directly to `https://loose-ends-os.vercel.app/demo`:

### Public Bot 1: SMB Operations Readiness Grader (A–D Scorecard)
- **Category**: Business Operations & Revenue Recovery
- **Tagline**: Instant 0–100 (`A`–`D`) Operations Readiness Scorecard for service, trade, clinic, and retail small businesses.
- **Description**: Paste any small business website or describe your current quote-to-invoice workflow. The bot audits 5 operational leak points (unbilled field work, stale estimates >5 days, missing checklist sign-offs, low-stock SKU drift, and overdue receivables) and generates a printable `A`–`D` Operations Readiness Scorecard with an interactive sandbox link at `https://loose-ends-os.vercel.app/demo`.

### Public Bot 2: `+bills` Vendor Invoice & Duplicate-Fee Auditor
- **Category**: Accounting & Cost Control
- **Tagline**: Catch vendor overcharges, unapproved surcharges, and math errors before paying supplier bills.
- **Description**: Paste any supplier invoice, wholesale receipt, or packing slip. The bot extracts line items into integer cents, recomputes `subtotal + tax = total` deterministically, flags duplicate fees or price increases against purchase orders, and formats a clean discrepancy report compatible with Loose Ends OS (`https://loose-ends-os.vercel.app/demo`).

### Public Bot 3: Truck-Cab Voicemail-to-Invoice & Job Checklist Bot
- **Category**: Field Service & Dispatch
- **Tagline**: Turn messy technician voice notes and texts into clean job checklists, parts allocations, and draft invoices.
- **Description**: Built for contractors, fleet repair, AV integrators, and field service teams. Paste a rough technician voice transcript or SMS ("Replaced 40/5 capacitor and 2 lbs R-410A on RTU-2, tested OK") and get a structured job completion checklist, parts margin breakdown, and customer-ready invoice draft previewed live at `https://loose-ends-os.vercel.app/demo`.
