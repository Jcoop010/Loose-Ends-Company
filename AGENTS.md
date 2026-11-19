# AGENTS.md — Shared Rules (Antigravity, OpenCode & Copilot)

> Shared non-negotiable guardrails for **Loose Ends OS** (React 18 + TypeScript + Tailwind v4 + Vite + Supabase PostgreSQL/`le_ops` RLS + Edge Functions).

## 1. Repository & Branch Scope
- Single active repository and branch: **`Jcoop010/Loose-Ends-Company` (`main` ONLY)**.
- **Never** read, modify, commit to, or push `profit-pulse-command`.

## 2. Code, Financial & Runtime Standards
- **Strict TypeScript everywhere:** `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, and **zero `any` types**.
- **Deterministic integer-cent money math:** represent all amounts as integer `*_cents` validated with `Number.isSafeInteger`; never trust LLM arithmetic without TypeScript recomputation.
- **Air-gapped `/demo`:** `src/features/demo/*` and `DemoStoreContext` must remain 100% in-memory—never import or call Supabase or live network SDKs.
- **Transactional writes & storage:** route operational writes through `ops_command` RPC (with UUID idempotency keys) and revenue collections through atomic `collect_opportunity` RPC; never store workspace/customer data in `localStorage` or `sessionStorage`.

## 3. Secret Hygiene
- **NEVER** prefix server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LOOSE_ENDS_MCP_TOKEN`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `XAI_API_KEY`) with `VITE_`.
- Browser bundles may reference only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optional `VITE_SENTRY_DSN`.
- Never print, echo, log, or commit raw tokens, API keys, or service-role credentials in terminal output, tests, or documentation.

## 4. Outreach & Compliance Gate
- Every outbound cold outreach draft must stay `requires_approval = true` (`status = 'draft'`, `delivery_status = 'not_sent'`)—never auto-send.
- Enforce fail-closed consent checks against `customer_contact_consent_events` before queuing or approving any message.
- Every outbound email must include the approved CAN-SPAM footer (`421 Hill Street, Parkersburg, WV 26104` + clear unsubscribe line).

## 5. Verification Gate
- Always run `npm run typecheck`, `npm test`, and `npm run build` (all exiting `0`) before committing or pushing.
