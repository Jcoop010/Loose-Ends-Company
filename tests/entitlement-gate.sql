-- DRAFT, NOT EXECUTED. Run ONLY on a disposable database after the draft migration.
-- Supply an existing disposable workspace, its member and a nonmember UUID:
-- psql <disposable> -v test_workspace=UUID -v test_user=UUID -v outsider_user=UUID -f tests/entitlement-gate.sql
-- All changes roll back. No production identifiers belong in this file.
\set ON_ERROR_STOP on
begin;
select set_config('test.workspace', :'test_workspace', true);
select set_config('test.member', :'test_user', true);
select set_config('test.outsider', :'outsider_user', true);
select set_config('request.jwt.claim.sub', :'test_user', true);

do $$
declare
  v_ws uuid := current_setting('test.workspace')::uuid;
  v_member uuid := current_setting('test.member')::uuid;
  v_outsider uuid := current_setting('test.outsider')::uuid;
  v_status text;
begin
  assert exists(select 1 from public.workspace_members where workspace_id=v_ws and user_id=v_member), 'fixture requires member';
  assert not exists(select 1 from public.workspace_members where workspace_id=v_ws and user_id=v_outsider), 'outsider must not belong to workspace';
  assert exists(select 1 from public.workspace_subscriptions where workspace_id=v_ws), 'fixture requires subscription';
  foreach v_status in array array['trialing','active','past_due'] loop
    update public.workspace_subscriptions set status=v_status, current_period_end=now()+interval '10 days' where workspace_id=v_ws;
    assert public.is_workspace_entitled(v_ws, true) is true, 'member with future period should pass';
    if v_status='past_due' then
      assert public.is_workspace_entitled(v_ws, false) is false, 'grace requires opt-in';
    end if;
    update public.workspace_subscriptions set current_period_end=now() where workspace_id=v_ws;
    assert public.is_workspace_entitled(v_ws, true) is false, 'boundary must deny';
    update public.workspace_subscriptions set current_period_end=null where workspace_id=v_ws;
    assert public.is_workspace_entitled(v_ws, true) is false, 'missing expiry must deny';
    update public.workspace_subscriptions set current_period_end='infinity'::timestamptz where workspace_id=v_ws;
    assert public.is_workspace_entitled(v_ws, true) is false, 'nonfinite expiry must deny';
  end loop;
  update public.workspace_subscriptions set status='active', current_period_end=now()+interval '10 days' where workspace_id=v_ws;
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  assert public.is_workspace_entitled(v_ws) is false, 'cross-workspace caller must be denied';
  perform set_config('request.jwt.claim.sub', '', true);
  assert public.is_workspace_entitled(v_ws) is false, 'unauthenticated caller must be denied';
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  update public.workspace_subscriptions set status='canceled' where workspace_id=v_ws;
  assert public.is_workspace_entitled(v_ws, true) is false, 'canceled must deny';
  raise notice 'entitlement + membership assertions passed';
end $$;
rollback;
