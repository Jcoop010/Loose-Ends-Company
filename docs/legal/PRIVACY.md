# Loose Ends Co. — Privacy Policy

> **Status: DRAFT 2026-11-15 — for owner and legal review. NOT legal advice. NOT published. Do not represent as an approved policy until the owner and, ideally, counsel review and adopt it.**
> **[OWNER-DECISION REQUIRED]**: legal entity name & state of formation · mailing address · support contact email · named data-protection contact · governing-state privacy law references (e.g., WV vs. user states)

Last updated: draft of 2026-11-15 (unpublished)

## 1. Who we are
Loose Ends Co. ("Loose Ends", "we", "us") is a software company providing a business-operations and revenue-recovery workspace for small service businesses. [LEGAL ENTITY NAME], [STATE OF FORMATION], [MAILING ADDRESS]. Contact: [SUPPORT CONTACT — OWNER TO SUPPLY].

## 2. What data we collect
- **Account data** — name, email address, and encrypted credentials (handled by Supabase Auth). Payment card data is never sent to or stored by us.
- **Workspace data** — business records you enter or import: customers, contacts, estimates, jobs, invoices, tasks, schedules, documents you attach, and your notes. System logs needed to operate the service (e.g., error and access logs).
- **Billing data** — Stripe stores your payment details. We receive subscription status and the last4/brand of the card only as provided by Stripe. We store the Stripe customer/subscription identifiers and billing status in our database.

We do **not** collect: government IDs, health information, biometrics, or precise geolocation.

## 3. How we use it
- To operate the workspace: store your records, run deterministic checks on them, and show you your own data.
- To bill you: process subscription payments through Stripe and maintain entitlement status.
- To support you: respond to requests you send to our support contact.
- Internal, privacy-preserving statistics (e.g., uptime, error rates).

We do **not** use your customer data to train advertising models, sell it, or share it with unrelated third parties for marketing.

## 4. Customer data you control
You are the data controller for the business records you store. We process them on your instructions to provide the service. Your customers' contact details must be entered lawfully by you (e.g., with applicable consent for outreach you direct us to prepare). You are responsible for honoring opt-outs and applicable messaging laws (e.g., TCPA for SMS, CAN-SPAM for email, and state law).

## 5. Processors and storage
- **Supabase** (database, authentication, storage) — project on the US infrastructure.
- **Stripe** (payments).
- **Vercel** (static hosting and edge functions).
These processors receive only what they need to perform their function. Data is stored on US infrastructure. An executed DPA should be obtained for each before paid onboarding scales.

## 6. Retention
Workspace data is retained while your workspace exists and for 30 days after account deletion, then deleted within 90 days unless law requires longer. Stripe keeps its own copies under its terms. Backups rotate and converge to deletion within 30 days of expiry.

## 7. Your rights
You may request access, correction, export, or deletion of your workspace data by contacting [SUPPORT CONTACT]. You may delete your account in the app or request tenant deletion. We will respond within 30 days. You may also export your own data in the app (CSV export where provided).

## 8. Security
Row-level security on workspace-scoped tables; service-role keys never ship to browsers; HTTPS everywhere; signup/recovery screening; invite-only workspace membership. No system is perfectly secure; report vulnerabilities to [SECURITY CONTACT — OWNER TO SUPPLY].

## 9. Children
Not for children under 16. We do not knowingly collect their data.

## 10. Changes
We will post changes on this page and, for material changes, notify account holders by email at least 14 days in advance.

## 11. Contact
[SUPPORT CONTACT] · [MAILING ADDRESS] · ATTN: Privacy
