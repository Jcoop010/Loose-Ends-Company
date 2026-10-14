\set ON_ERROR_STOP on
create role service_role nologin;
create role authenticated nologin;
create role anon nologin;
create table public.stripe_webhook_events (
  event_id text primary key, event_type text not null, livemode boolean not null,
  processed_at timestamptz, processing_error text
);
create table public.workspace_subscriptions (
  workspace_id uuid primary key, provider text, provider_customer_id text,
  provider_subscription_id text, plan_key text, status text,
  current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean, updated_at timestamptz
);
create table public.workflows (
  id uuid primary key, workspace_id uuid not null, actions jsonb not null
);
create table public.workflow_runs (
  id uuid primary key, workspace_id uuid not null, workflow_id uuid not null,
  status text not null, context jsonb not null default '{}'::jsonb,
  result jsonb, error text, approved_by uuid,
  completed_at timestamptz
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  customer_id uuid, opportunity_id uuid, title text, status text, priority numeric, due_at timestamptz
);
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  customer_id uuid, opportunity_id uuid, channel text, status text, scheduled_at timestamptz, message text
);
create table public.opportunities (
  id uuid primary key, workspace_id uuid not null, title text, reason text,
  status text, priority numeric, amount numeric, due_at timestamptz, updated_at timestamptz
);
\ir ../supabase/migrations/20261014180000_stripe_webhook_processing_leases.sql
\ir ../supabase/migrations/20261014181000_atomic_stripe_entitlement_completion.sql
\ir ../supabase/migrations/20261014182000_serialize_stripe_billing_events.sql
\ir ../supabase/migrations/20261014183000_atomic_workflow_run_actions.sql

do $$
declare claimed text; token uuid := gen_random_uuid(); other uuid := gen_random_uuid();
ws uuid := '11111111-1111-4111-8111-111111111111';
ok boolean; status_after text; run_id uuid := gen_random_uuid(); workflow_id uuid := gen_random_uuid();
begin
  claimed := public.claim_stripe_webhook_event('evt_testone','customer.subscription.updated',false,token,60);
  if claimed <> 'claimed' then raise exception 'Could not claim new event'; end if;
  if public.claim_stripe_webhook_event('evt_testone','customer.subscription.updated',false,other,60) <> 'busy'
    then raise exception 'Duplicate worker was not blocked'; end if;
  if public.finish_stripe_webhook_event('evt_testone',other,null)
    then raise exception 'Invalid worker completed another claim'; end if;

  ok := public.apply_stripe_subscription_event('evt_testone',other,ws,
    'cus_one','sub_one','starter','active',null,null,false,100);
  if ok then raise exception 'Unclaimed worker wrote an entitlement'; end if;
  ok := public.apply_stripe_subscription_event('evt_testone',token,ws,
    'cus_one','sub_one','starter','active',null,null,false,100);
  if not ok then raise exception 'Claimed worker failed entitlement update'; end if;
  if public.claim_stripe_webhook_event('evt_testone','customer.subscription.updated',false,other,60) <> 'processed'
    then raise exception 'Processed event not recognized'; end if;
  claimed := public.claim_stripe_webhook_event('evt_testtwo','customer.subscription.updated',false,other,60);
  ok := public.apply_stripe_subscription_event('evt_testtwo',other,ws,
    'cus_one','sub_one','starter','canceled',null,null,false,99);
  select status into status_after from public.workspace_subscriptions where workspace_id = ws;
  if not ok or status_after <> 'active' then raise exception 'Old event regressed newer subscription'; end if;

  insert into public.workflows(id,workspace_id,actions) values
    (workflow_id,ws,'[{"type":"create_task","title":"Smoke test","priority":1}]');
  insert into public.workflow_runs(id,workspace_id,workflow_id,status,context) values
    (run_id,ws,workflow_id,'running','{"event":{"entity_type":"customers"},"record":{"id":"22222222-2222-4222-8222-222222222222"}}');
  perform public.complete_workflow_run_atomically(run_id,ws,null);
  if (select count(*) from public.tasks where workspace_id=ws) <> 1 then
    raise exception 'Workflow task not created'; end if;
  if (select status from public.workflow_runs where id=run_id) <> 'completed' then
    raise exception 'Workflow was not completed'; end if;
end $$;

-- An invalid second action must roll back the first action and run completion.
do $$
declare ws uuid := '11111111-1111-4111-8111-111111111111';
workflow_id uuid := gen_random_uuid(); run_id uuid := gen_random_uuid();
begin
  insert into public.workflows (id,workspace_id,actions) values
    (workflow_id,ws,'[{"type":"create_task","title":"Must roll back"},{"type":"not_supported"}]');
  insert into public.workflow_runs (id,workspace_id,workflow_id,status,context) values
    (run_id,ws,workflow_id,'running','{}');
  begin
    perform public.complete_workflow_run_atomically(run_id,ws,null);
    raise exception 'Expected unsupported workflow action failure';
  exception when others then
    if sqlerrm = 'Expected unsupported workflow action failure' then raise; end if;
  end;
  if (select count(*) from public.tasks where workspace_id=ws) <> 1 then
    raise exception 'Partial task insert survived failed atomic workflow'; end if;
  if (select status from public.workflow_runs where id=run_id) <> 'running' then
    raise exception 'Failed workflow was marked complete'; end if;
end $$;

-- A successfully completed run must not execute twice.
do $$
declare ws uuid := '11111111-1111-4111-8111-111111111111';
workflow_id uuid := gen_random_uuid(); run_id uuid := gen_random_uuid();
begin
  select id into run_id from public.workflow_runs where status='completed' limit 1;
  begin
    perform public.complete_workflow_run_atomically(run_id,ws,null);
    raise exception 'Expected duplicate workflow rejection';
  exception when others then
    if sqlerrm = 'Expected duplicate workflow rejection' then raise; end if;
  end;
  if (select count(*) from public.tasks where workspace_id=ws) <> 1 then
    raise exception 'Duplicate execution created another task'; end if;
end $$;

select 'Postgres migrations and smoke tests passed' as result;
