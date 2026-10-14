-- Fenced, atomic entitlement write: validate lease and update subscription in one transaction.
create or replace function public.apply_stripe_subscription_event(
  p_event_id text, p_token uuid, p_workspace_id uuid,
  p_customer_id text, p_subscription_id text, p_plan_key text,
  p_status text, p_period_start timestamptz, p_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_event public.stripe_webhook_events%rowtype;
begin
  select * into v_event from public.stripe_webhook_events
    where event_id = p_event_id for update;
  if not found or v_event.processed_at is not null
    or v_event.processing_token is distinct from p_token
    or v_event.processing_lease_until is null
    or v_event.processing_lease_until <= clock_timestamp() then
    return false;
  end if;

  if p_workspace_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_plan_key not in ('starter','growth','scale','revenue_recovery')
    or p_status not in ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')
    or p_cancel_at_period_end is null then
    raise exception 'Invalid Stripe entitlement update';
  end if;

  insert into public.workspace_subscriptions
    (workspace_id,provider,provider_customer_id,provider_subscription_id,
     plan_key,status,current_period_start,current_period_end,cancel_at_period_end,updated_at)
  values
    (p_workspace_id,'stripe',p_customer_id,p_subscription_id,
     p_plan_key,p_status,p_period_start,p_period_end,p_cancel_at_period_end,clock_timestamp())
  on conflict (workspace_id) do update set
    provider = excluded.provider,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id,
    plan_key = excluded.plan_key,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = excluded.updated_at;

  update public.stripe_webhook_events
    set processed_at = clock_timestamp(), processing_error = null,
        processing_token = null, processing_lease_until = null
    where event_id = p_event_id;
  return true;
end;
$$;

revoke all on function public.apply_stripe_subscription_event(text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,boolean)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,boolean)
  to service_role;
