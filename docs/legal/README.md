# Legal Drafts — Review Status

**Created 2026-11-15 by agent. These are DRAFTS for owner and, ideally, legal counsel review. They are not legal advice, not adopted policy, and not for publication as approved legal documents until the owner explicitly approves them and any counsel review is complete.**

## Files
| File | Contents | Blocking review items |
|---|---|---|
| `PRIVACY.md` | Data we collect, use, retention, processors, rights | legal entity name & state · mailing address · support contact · security contact · governing-law references |
| `TERMS.md` | Service description, billing ($199/mo), cancellation, acceptable use, liability | governing state & venue · liability cap · arbitration vs. courts · entity name |
| `REFUNDS-CANCELLATION.md` | Cancel anytime via Stripe portal; **two refund options — Option A (14-day good-faith refund) / Option B (no refunds); owner must choose** | Option A or B · support contact |
| `SUPPORT.md` | Support routing, scope, data requests, vulnerability disclosure | support contact · security contact · SLA decision · status-page decision |

## Owner checklist before any of these may be published
1. Choose Option A or Option B in REFUNDS-CANCELLATION.md and confirm the 14-day window if A.
2. Supply: legal entity name, state of formation, mailing address, support email/contact, security contact.
3. Decide governing state/venue (West Virginia assumed as draft — confirm).
4. Have counsel (or an explicit owner decision accepting the risk) review all four documents.
5. Approve creating PUBLIC `/legal/...` pages in the app shell + footer links in `index.html` / `public/revenue-checkup.html` (drafts currently live in `docs/legal/` only and are NOT deployed).
6. Approve effective date and change-notification method.

## Open questions for counsel
- Whether WV auto-renewal ("negative option") statutes require specific renewal-notice language for $199/mo subscriptions.
- TCPA/CAN-SPAM exposure of in-app "owner-approved outreach" drafts (user sends from own channels vs. any in-app send).
- Whether Stripe Checkout plus our workspace entitlement records constitute a compliant auto-renewal disclosure flow.
