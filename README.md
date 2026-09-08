# Loose Ends Co.

Loose Ends is a revenue-recovery operating system for service businesses. It identifies revenue opportunities, ranks what deserves attention, tracks recovery stages, and records confirmed recovered revenue.

## Architecture

- **Frontend:** Vite + React + TypeScript.
- **Auth/data:** Supabase Auth + Postgres with workspace-scoped RLS.
- **Recovery model:** customers → opportunities → follow-ups → recovery events.
- **Recovery lifecycle:** Potential → Contacted → Responded → Scheduled → Completed → Collected.
- **Revenue signals:** missed calls, aging/declined estimates, inactive customers, maintenance due, unpaid invoices, unbilled work, and aging leads when the source data provides enough evidence.
- **Persistence:** recovery/customer/follow-up changes sync to Supabase when authenticated; localStorage remains a resilience/demo fallback.
- **Accounting bridge:** QuickBooks Edge Function is installed and authenticated, but live Intuit OAuth credentials are still required before production QuickBooks API sync can run.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Important product boundary

Loose Ends should orchestrate revenue recovery rather than replace accounting, payments, messaging, CRM, or scheduling platforms. Integrations should supply events and execution capabilities; Loose Ends should decide what matters, why it matters, what to do next, and what revenue outcome occurred.

## Production deployment

The production application is deployed from the `main` branch. This marker commit is intentionally harmless and exists to trigger the connected Netlify production build after the current product work is synchronized.
