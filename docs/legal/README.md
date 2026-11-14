# Legal Drafts — Review Status (updated 2026-11-15: Option A adopted in draft)

**Created 2026-11-15 by agent; refund policy finalized to the proposed 14-day good-faith policy (Option A) for owner and counsel review. These remain DRAFTS — not legal advice, not adopted policy, not published. Publication requires explicit owner approval and (recommended) legal counsel review.**

## Files
| File | Contents | Blocking review items |
|---|---|---|
| `PRIVACY.md` | Data we collect, use, retention, processors, rights | legal entity name & state · mailing address · support contact · security contact · governing-law references |
| `TERMS.md` | Service description, billing ($199/mo), cancellation + Option A refunds, acceptable use, liability | governing state & venue · liability cap · arbitration vs. courts · entity name |
| `REFUNDS-CANCELLATION.md` | Cancel anytime via Stripe portal; **Option A adopted: full refund within first 14 calendar days, once per customer, no questions asked; no refunds/proration thereafter** | confirm/adjust 14-day window + one-refund limit · support contact |
| `SUPPORT.md` | Support routing, scope, data requests, vulnerability disclosure | support contact · security contact · SLA decision · status-page decision |

## Publication gates (all must clear; none assumed)
1. Owner confirms the 14-day window and one-refund-per-customer limit (or amends).
2. Owner supplies: legal entity name, state of formation, mailing address, support contact, security contact.
3. Owner confirms governing state/venue (West Virginia assumed as draft — confirm).
4. Counsel review of all four documents (recommended) OR an explicit written owner risk-acceptance.
5. Owner approves creating PUBLIC `/legal/...` pages in the app shell + footer links (`index.html`, `public/revenue-checkup.html`) — drafts live in `docs/legal/` only and are NOT deployed.
6. Owner approves effective date and change-notification method.

## Open questions for counsel
- Whether WV auto-renewal ("negative option") statutes require specific renewal-notice language for $199/mo subscriptions.
- TCPA/CAN-SPAM exposure of in-app "owner-approved outreach" drafts (user sends from own channels vs. any in-app send).
- Whether Stripe Checkout plus our workspace entitlement records constitute a compliant auto-renewal disclosure flow.
- Whether one-refund-per-customer is enforceable as written (identity matching provider_customer_id).
