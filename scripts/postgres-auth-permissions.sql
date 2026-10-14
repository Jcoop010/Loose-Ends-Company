-- Role permissions for privileged RPCs must be enforced by PostgreSQL.
-- These checks execute against the isolated CI PostgreSQL database.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.claim_stripe_webhook_event(text,text,boolean,uuid,integer)',
    'public.finish_stripe_webhook_event(text,uuid,text)',
    'public.apply_stripe_subscription_event(text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,boolean,bigint)',
    'public.complete_workflow_run_atomically(uuid,uuid,uuid)'
  ] loop
    if not pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role cannot execute %', fn;
    end if;
    if pg_catalog.has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'anon can execute privileged RPC %', fn;
    end if;
    if pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'authenticated can execute privileged RPC %', fn;
    end if;
  end loop;
end $$;
select 'Privileged function role-permission checks passed' as result;
