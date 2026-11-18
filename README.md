# Loose Ends Co.

Loose Ends is a customer-retention and revenue-recovery operating system for local and service businesses. It continuously turns business signals into prioritized opportunities, follow-up actions, and measurable recovered revenue.

## Product model

- **Core promise:** find revenue leaks, fix the process, recover the revenue.
- **Customer retention:** identify inactive customers, maintenance opportunities, renewal/churn risk, and follow-up gaps.
- **Revenue recovery:** surface missed calls, aging/declined estimates, unpaid invoices, unbilled work, stalled leads, and other recoverable opportunities when source data supports them.
- **Operating system:** customers, sales orders, calendar, documents/requests, tasks, alerts, marketing, intelligence, settings, and revenue recovery in one workspace.
- **Recovery lifecycle:** Potential → Contacted → Responded → Scheduled → Completed → Collected.
- **Persistence:** Supabase Auth + Postgres with workspace-scoped data; localStorage provides resilience while cloud access is unavailable.
- **Integrations:** external systems remain the system of record for accounting, payments, messaging, and scheduling. Loose Ends orchestrates signals, prioritization, next actions, and outcomes.

## Architecture

- **Frontend:** Vite + React + TypeScript.
- **Auth/data:** Supabase Auth + Postgres.
- **Application state:** React context/store with cloud persistence helpers.
- **Revenue intelligence:** deterministic revenue-signal engine that can continuously scan the available workspace data.

## Run locally

```bash
npm install
npm run dev
```

## Validate a release

```bash
npm run typecheck
npm run build
npm run preview
```

GitHub Actions runs the same typecheck and production build on pushes and pull requests to `main`.

## Production

The production application is connected to the existing Vercel project **loose-ends-os** and deploys from `main`. Do not create a second repository or Vercel project for the product.

The public marketing site is available without authentication. The private `/dashboard` application is protected by Supabase Auth.

## Repository layout vs. production (audited 2026-11-15)

- The **deployed** production site is the static app shell in `index.html` + the vanilla JS layers in `v3.1/`, plus `public/revenue-checkup.html` ($199/month public page, the only public price) and `public/qa/acceptance.html` (noindex).
- The **React app** (`App.tsx`, `pages/**`, root `Landing.tsx`) is NOT bundled into the production build (the Vite entry is `index.html`, which does not load it). `pages/Landing.tsx` and `Landing.tsx` are kept identical, accurate, and deployable should the entry ever switch; they are not live today.
- Money path (production): Supabase Edge Functions `create-subscription-checkout`, `create-billing-portal`, `stripe-webhook`. Live price: **$199/month** `price_1URCPvIS04s94hSMFJ9azsC8`. The Vercel function `api/create-subscription-checkout.js` is a legacy duplicate and is not the production path; its `ORIGIN` is now env-configurable (`APP_ORIGIN`) with behavior unchanged by default.
- Open items and deployment risks: see PR description and `docs/STRIPE-TEST-MODE-ACCEPTANCE.md`. Legal drafts live in `docs/legal/` and are NOT published.
- Domain note: Supabase functions allow `loose-ends-os.vercel.app` while the external alias observed is `loose-ends-v3-1.vercel.app`. Which is canonical must be confirmed; a mismatch blocks checkout (403).
- Pricing is standardized to **$199/month** everywhere in this repo; the legacy $499/$4,990 pages are corrected in `Landing.tsx` / `pages/Landing.tsx`.
