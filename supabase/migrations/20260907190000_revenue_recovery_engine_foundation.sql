create index if not exists opportunities_workspace_status_amount_idx on public.opportunities(workspace_id,status,amount desc);
create index if not exists opportunities_workspace_due_idx on public.opportunities(workspace_id,due_at) where due_at is not null;
create index if not exists follow_ups_workspace_status_scheduled_idx on public.follow_ups(workspace_id,status,scheduled_at);
create index if not exists recovery_events_workspace_created_idx on public.recovery_events(workspace_id,created_at desc);
create index if not exists customers_workspace_email_idx on public.customers(workspace_id,email) where email is not null;
create index if not exists customers_workspace_phone_idx on public.customers(workspace_id,phone) where phone is not null;

create or replace function public.revenue_recovery_summary(p_workspace_id uuid)
returns table(open_amount numeric, open_count bigint, contacted_amount numeric, scheduled_amount numeric, recovered_amount numeric, recovered_count bigint, recovery_rate numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(amount) filter (where status in ('open','contacted','scheduled')),0),
    count(*) filter (where status in ('open','contacted','scheduled')),
    coalesce(sum(amount) filter (where status='contacted'),0),
    coalesce(sum(amount) filter (where status='scheduled'),0),
    coalesce(sum(coalesce(recovered_amount,0)) filter (where status='recovered'),0),
    count(*) filter (where status='recovered'),
    case when coalesce(sum(amount),0)=0 then 0 else round((coalesce(sum(coalesce(recovered_amount,0)) filter (where status='recovered'),0) / nullif(sum(amount),0))*100,1) end
  from public.opportunities
  where workspace_id=p_workspace_id;
$$;

grant execute on function public.revenue_recovery_summary(uuid) to authenticated;
