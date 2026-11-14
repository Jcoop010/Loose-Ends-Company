-- DRAFT 2026-11-15 — rolled-back acceptance test for the entitlement helper.
-- NOT EXECUTED. Requires a disposable database loaded with the schema + migrations.
-- Run: psql <disposable> -v ON_ERROR_STOP=1 -f tests/entitlement-gate.sql
-- Expected: all assertions raise NOTICE 'ok', final ROLLBACK leaves no residue.

\set ON_ERROR_STOP on
begin;

-- disposable fixture (names are synthetic; no production ids)
with w as (
  insert into public.workspaces(name) values ('Entitlement Gate Test Fixture') returning id
)
insert into public.workspace_subscriptions(workspace_id, plan_key, status, current_period_start, current_period_end, provider, updated_at)
select id, 'trial', 'trialing', now() - interval '1 day', now() + interval '13 days', 'stripe', now()
from w
;

do $$
declare
  v_ws uuid := (select id from public.workspaces where name='Entitlement Gate Test Fixture');
begin
  assert public.is_workspace_entitled(v_ws) is true, 'trialing workspace should be entitled';
  raise notice 'ok: trialing workspace entitled';

  update public.workspace_subscriptions
     set status='active', current_period_start=now()-interval '20 days', current_period_end=now()+interval '10 days'
   where workspace_id=v_ws;
  assert public.is_workspace_entitled(v_ws) is true, 'active workspace should be entitled';
  raise notice 'ok: active workspace entitled';

  update public.workspace_subscriptions set current_period_end=now()-interval '1 day' where workspace_id=v_ws;
  assert public.is_workspace_entitled(v_ws) is false, 'expired active must not be entitled';
  raise notice 'ok: expired active denied';

  update public.workspace_subscriptions set status='past_due', current_period_end=now()+interval '10 days' where workspace_id=v_ws;
  assert public.is_workspace_entitled(v_ws, false) is false, 'past_due denied without grace flag';
  assert public.is_workspace_entitled(v_ws, true)  is true,  'past_due allowed with grace flag';
  raise notice 'ok: past_due default-deny / grace-flag-allow';

  update public.workspace_subscriptions set status='canceled' where workspace_id=v_ws;
  assert public.is_workspace_entitled(v_ws, true) is false, 'canceled must never be entitled';
  raise notice 'ok: canceled denied';
end $$;

rollback;
