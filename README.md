# Primal Directive

Primal Directive is a multifunctional operating system for small businesses. It brings customer relationships, sales, scheduling, tasks, documents, requests, revenue intelligence, alerts, follow-up, marketing, business intelligence, and workflow automation into one operating layer.

Revenue recovery remains a core differentiator: the system identifies revenue opportunities, ranks what deserves attention, drives follow-up, tracks recovery stages, and records confirmed recovered revenue.

## Product architecture

- **Frontend:** Vite + React + TypeScript.
- **Auth/data:** Supabase Auth + Postgres with workspace-scoped RLS.
- **Core operating model:** customers → opportunities → tasks/follow-ups → operational outcomes.
- **Revenue lifecycle:** Potential → Contacted → Responded → Scheduled → Completed → Collected.
- **Revenue signals:** missed calls, aging/declined estimates, inactive customers, maintenance due, unpaid invoices, unbilled work, and aging leads when the source data provides enough evidence.
- **Automation:** workflow rules can be manual, approval-based, or automatic, including scheduled and due-event execution through the background workflow scheduler.
- **Persistence:** application data syncs to Supabase when authenticated; localStorage remains a resilience/demo fallback.
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

## Product boundary

Primal Directive is an operating and orchestration layer. It should not attempt to replace accounting, payments, messaging, CRM, scheduling, or other specialized systems when those systems already provide authoritative capabilities. Integrations should supply events and execution capabilities; Primal Directive should determine what matters, why it matters, what happens next, and what business outcome resulted.

## Release discipline

Production deployment should happen only after a coherent release has been built and verified. Feature branches and pull requests may be used for development and CI validation; the production Vercel deployment should be updated deliberately rather than on every intermediate change.
