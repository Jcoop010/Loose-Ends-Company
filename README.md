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
