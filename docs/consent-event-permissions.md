# Consent event privilege hardening

Applied in production via Supabase migration `restrict_consent_events_to_append_only_permissions` on 2026-10-16.

The `public.customer_contact_consent_events` table stores grant and revoke decisions as append-only events. Authenticated clients require only `SELECT` and `INSERT`, subject to existing workspace-scoped RLS policies. **Do not grant** `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`, or `REFERENCES` to authenticated clients; a `TRUNCATE` grant can bypass row-by-row RLS enforcement.

Verification query:

```sql
select grantee,privilege_type
from information_schema.role_table_grants
where table_schema='public'
and table_name='customer_contact_consent_events'
and grantee in ('anon','authenticated')
order by grantee,privilege_type;
```

Expected: authenticated `SELECT`, authenticated `INSERT`, no anonymous grants.

This does not yet enable sending. Any future messaging endpoint must recheck current consent *at send time*, suppress opted-out contacts, confirm an approved message, enforce unique delivery idempotency keys, and keep provider delivery receipts. Signed-in client tests with two separate workspaces are still necessary.
