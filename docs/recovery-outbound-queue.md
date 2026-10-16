# Disabled recovery outbound queue

Production schema: `public.recovery_outbound_jobs` (migration `create_disabled_outbound_queue_with_deduplication`).

The table reserves one outbound job per `(workspace_id, approval_event_id)` and enforces an additional unique `(workspace_id, idempotency_key)` constraint. All jobs default to `draft`; permitted states are `draft`, `blocked`, `canceled` only. There is **no sent, sending, or scheduled state**, provider integration, or consumer.

The table has RLS enabled. Authenticated clients may `SELECT` only their workspace's rows using `is_workspace_member(workspace_id)`. Anonymous users receive no grants. Authenticated clients cannot insert, update, or delete jobs.

**This is a schema foundation, not a functional delivery queue.** Before allowing server-side inserts, add a server-validated approval and consent trigger binding the approval event, customer, channel and workspace; enforce server-side privileges and immutable content; use an atomic claim/lease with revalidation of consent at send time; check account-level suppression; implement provider callbacks and opt-out parsing; and test duplicates/concurrency and tenant isolation.

Read-only validation:

```sql
select relrowsecurity from pg_class where oid='public.recovery_outbound_jobs'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='recovery_outbound_jobs'
and grantee in ('anon','authenticated');
```
