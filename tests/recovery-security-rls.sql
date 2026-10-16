-- Read-only security regression audit for the recovery foundation.
-- Run against the project using a privileged SQL editor; no customer data is modified.
begin;
do $$
begin
 if has_table_privilege('authenticated','public.recovery_outbound_jobs','INSERT')
 or has_table_privilege('authenticated','public.recovery_outbound_jobs','UPDATE')
 or has_table_privilege('authenticated','public.recovery_outbound_jobs','DELETE')
 then raise exception 'Outbound queue privileges are too broad'; end if;
 if has_table_privilege('authenticated','public.customer_contact_consent_events','UPDATE')
 or has_table_privilege('authenticated','public.customer_contact_consent_events','DELETE')
 or has_table_privilege('authenticated','public.customer_contact_consent_events','TRUNCATE')
 then raise exception 'Consent events are not append-only'; end if;
 if not (select relrowsecurity from pg_class where oid='public.recovery_outbound_jobs'::regclass)
 or not (select relrowsecurity from pg_class where oid='public.customer_contact_consent_events'::regclass)
 then raise exception 'Recovery security table has RLS disabled'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
begin
 if (select count(*) from public.customer_contact_consent_events) <> 0 then
  raise exception 'No-membership identity could read customer consent records'; end if;
 if (select count(*) from public.recovery_outbound_jobs) <> 0 then
  raise exception 'No-membership identity could read outbound jobs'; end if;
end $$;
rollback;
