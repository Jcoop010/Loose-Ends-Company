-- Isolated database only. Never run this file against production.
\set ON_ERROR_STOP on
\ir fixtures/production-public-schema-20261014.sql
\ir ../supabase/migrations/20261014180000_stripe_webhook_processing_leases.sql
\ir ../supabase/migrations/20261014181000_atomic_stripe_entitlement_completion.sql
\ir ../supabase/migrations/20261014182000_serialize_stripe_billing_events.sql
\ir ../supabase/migrations/20261014183000_atomic_workflow_run_actions.sql

begin;
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner-a@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','owner-b@example.invalid');
insert into public.workspaces(id,name,slug,owner_user_id) values
 ('11111111-1111-4111-8111-111111111111','Synthetic A','synthetic-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('33333333-3333-4333-8333-333333333333','Synthetic B','synthetic-b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner'),
 ('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','owner');
insert into public.customers(id,workspace_id,first_name) values
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Synthetic A'),
 ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','Synthetic B');

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
set local role authenticated;
do $$ declare n integer; blocked boolean; begin
 if (select count(*) from public.customers) <> 1 then raise exception 'Owner A read isolation failed'; end if;
 update public.customers set first_name='Must not change' where id='44444444-4444-4444-8444-444444444444';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'Owner A modified foreign customer'; end if;
 blocked := false;
 begin
  insert into public.customers(workspace_id,first_name) values('33333333-3333-4333-8333-333333333333','Forbidden');
 exception when insufficient_privilege then blocked := true; end;
 if not blocked then raise exception 'Foreign workspace insert accepted'; end if;
 blocked := false;
 begin
  update public.workspaces set owner_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id='11111111-1111-4111-8111-111111111111';
 exception when insufficient_privilege then blocked := true; end;
 if not blocked then raise exception 'Ownership field update accepted'; end if;
 blocked := false;
 begin
  update public.workspace_subscriptions set status='active' where workspace_id='11111111-1111-4111-8111-111111111111';
 exception when insufficient_privilege then blocked := true; end;
 if not blocked then raise exception 'Client entitlement update accepted'; end if;
 update public.customers set first_name='Synthetic A updated' where id='22222222-2222-4222-8222-222222222222';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'Legitimate customer update failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.customers) <> 1 then raise exception 'Owner B read isolation failed'; end if;
 if exists(select 1 from public.customers where id='22222222-2222-4222-8222-222222222222') then raise exception 'Owner B saw owner A customer'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 if has_table_privilege('anon','public.public_leads','SELECT') then raise exception 'Anonymous lead reads allowed'; end if;
 if not has_table_privilege('anon','public.public_leads','INSERT') then raise exception 'Anonymous lead intake unavailable'; end if;
 if has_table_privilege('anon','public.customers','TRUNCATE') then raise exception 'Anonymous truncate allowed'; end if;
end $$;
reset role;

-- Exercise actual foreign keys, triggers and constraints with the atomic actions.
do $$ declare
 flow uuid := gen_random_uuid(); run uuid := gen_random_uuid(); before_count integer;
begin
 insert into public.workflows(id,workspace_id,name,trigger_type,actions)
 values(flow,'11111111-1111-4111-8111-111111111111','Atomic QA','record_created','[{"type":"create_task","title":"Atomic QA","priority":1}]');
 insert into public.workflow_runs(id,workspace_id,workflow_id,status,idempotency_key,context)
 values(run,'11111111-1111-4111-8111-111111111111',flow,'running','full-schema-' || run::text,
 '{"event":{"entity_type":"customers"},"record":{"id":"22222222-2222-4222-8222-222222222222"}}');
 select count(*) into before_count from public.tasks;
 perform public.complete_workflow_run_atomically(run,'11111111-1111-4111-8111-111111111111',null);
 if (select count(*) from public.tasks) <> before_count+1 then raise exception 'Atomic action insert failed'; end if;
 if (select status from public.workflow_runs where id=run) <> 'completed' then raise exception 'Run completion failed'; end if;
 begin
  perform public.complete_workflow_run_atomically(run,'11111111-1111-4111-8111-111111111111',null);
  raise exception 'Duplicate execution accepted';
 exception when others then if sqlerrm='Duplicate execution accepted' then raise; end if; end;
 if (select count(*) from public.tasks) <> before_count+1 then raise exception 'Duplicate task created'; end if;
 update public.workflows set actions='[{"type":"create_task","title":"Must roll back"},{"type":"invalid"}]' where id=flow;
 update public.workflow_runs set status='running' where id=run;
 begin
  perform public.complete_workflow_run_atomically(run,'11111111-1111-4111-8111-111111111111',null);
  raise exception 'Invalid action accepted';
 exception when others then if sqlerrm='Invalid action accepted' then raise; end if; end;
 if (select count(*) from public.tasks) <> before_count+1 then raise exception 'Partial action survived rollback'; end if;
 if (select status from public.workflow_runs where id=run) <> 'running' then raise exception 'Failed transaction changed run state'; end if;
end $$;

-- Billing leases, duplicate and out-of-order events against the real subscription schema.
do $$ declare flow uuid := gen_random_uuid(); run uuid := gen_random_uuid(); rejected boolean := false; begin
 insert into public.workflows(id,workspace_id,name,trigger_type,actions)
 values(flow,'11111111-1111-4111-8111-111111111111','Foreign reference QA','record_created','[{"type":"create_task","title":"Forbidden reference"}]');
 insert into public.workflow_runs(id,workspace_id,workflow_id,status,idempotency_key,context)
 values(run,'11111111-1111-4111-8111-111111111111',flow,'running','foreign-reference-' || run::text,
 '{"record":{"customer_id":"44444444-4444-4444-8444-444444444444"}}');
 begin
  perform public.complete_workflow_run_atomically(run,'11111111-1111-4111-8111-111111111111',null);
 exception when raise_exception then rejected := true; end;
 if not rejected then raise exception 'Atomic workflow accepted customer from another workspace'; end if;
end $$;

-- Billing leases, duplicate and out-of-order events against the real subscription schema.
do $$ declare token uuid := gen_random_uuid(); other uuid := gen_random_uuid(); ok boolean; begin
 if public.claim_stripe_webhook_event('evt_fullschema1','customer.subscription.updated',false,token,60) <> 'claimed' then raise exception 'Lease claim failed'; end if;
 if public.claim_stripe_webhook_event('evt_fullschema1','customer.subscription.updated',false,other,60) <> 'busy' then raise exception 'Concurrent claim accepted'; end if;
 ok := public.apply_stripe_subscription_event('evt_fullschema1',token,'11111111-1111-4111-8111-111111111111','cus_full','sub_full','starter','active',null,null,false,200);
 if not ok then raise exception 'Atomic entitlement completion failed'; end if;
 if public.claim_stripe_webhook_event('evt_fullschema1','customer.subscription.updated',false,other,60) <> 'processed' then raise exception 'Duplicate event accepted'; end if;
 perform public.claim_stripe_webhook_event('evt_fullschema2','customer.subscription.updated',false,other,60);
 perform public.apply_stripe_subscription_event('evt_fullschema2',other,'11111111-1111-4111-8111-111111111111','cus_full','sub_full','starter','canceled',null,null,false,100);
 if (select status from public.workspace_subscriptions where workspace_id='11111111-1111-4111-8111-111111111111') <> 'active' then raise exception 'Old event regressed entitlement'; end if;
end $$;
rollback;
select 'Full public schema migration replay and synthetic role/action tests passed' as result;
