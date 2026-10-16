# Recovery approval guard (production)

Applied to Supabase project via migration `enforce_recovery_approvals_in_database` on October 16, 2026.

Before an `audit_events` insert whose action is `recovery_draft_approved`, trigger `enforce_recovery_draft_approval` executes `public.guard_recovery_draft_approval()` as SECURITY INVOKER.

The guard rejects missing authenticated actor identity; non-owner/admin approvers; opportunity/customer/workspace mismatches; absent or invalid channel; missing or superseded current consent; missing consent event UUID; mismatched evidence reference; and any delivery status other than `not_sent`.

Consent is still staff-recorded evidence; it is not independently verified against a telecom provider. **No sending mechanism is enabled by this guard.** A future delivery endpoint MUST recheck consent and suppression at send time, enforce idempotency, and maintain its own delivery history. This trigger does not establish end-to-end compliance or payment attribution.

Operational read-only verification:

```sql
select tgname,tgenabled,pg_get_triggerdef(oid)
from pg_trigger
where tgrelid='public.audit_events'::regclass and tgname='enforce_recovery_draft_approval';

select prosecdef from pg_proc
where oid='public.guard_recovery_draft_approval()'::regprocedure;
```
