create or replace function le_ops.claim_stripe_event(p_event_id text,p_event_type text,p_livemode boolean,p_token uuid,p_lease_seconds integer default 900)returns text language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
declare e public.stripe_webhook_events;
begin
 if p_event_id is null or p_event_id!~'^evt_[A-Za-z0-9_]{1,120}$'or p_event_type is null or length(p_event_type)not between 1 and 200 or p_livemode is null or p_token is null or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid Stripe event claim';end if;
 insert into public.stripe_webhook_events(event_id,event_type,livemode)values(p_event_id,p_event_type,p_livemode)on conflict(event_id)do nothing;
 select * into strict e from public.stripe_webhook_events where event_id=p_event_id for update;
 if e.event_type<>p_event_type or e.livemode<>p_livemode then raise exception 'Stripe event identity changed';end if;
 if e.processed_at is not null then return 'processed';end if;
 if e.lease_token is not null and e.lease_expires_at>clock_timestamp()then return 'busy';end if;
 update public.stripe_webhook_events set lease_token=p_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=attempts+1,processing_error=null where event_id=p_event_id;
 return 'claimed';
end$$;
create or replace function le_ops.apply_stripe_event(p_event_id text,p_token uuid,p_workspace_id uuid,p_customer_id text,p_subscription_id text,p_plan_key text,p_status text,p_period_start timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean,p_event_created bigint)returns boolean language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
declare e public.stripe_webhook_events;s public.workspace_subscriptions;stale boolean:=false;
begin
 select * into e from public.stripe_webhook_events where event_id=p_event_id for update;
 if not found or e.lease_token is distinct from p_token or e.lease_expires_at is null or e.lease_expires_at<=clock_timestamp()or e.processed_at is not null then return false;end if;
 if p_workspace_id is null or p_customer_id is null or p_customer_id!~'^cus_[A-Za-z0-9]+$'or p_subscription_id is null or p_subscription_id!~'^sub_[A-Za-z0-9]+$'or p_plan_key is null or p_plan_key not in('starter','growth','scale','revenue_recovery')or p_status is null or p_status not in('trialing','active','past_due','canceled','incomplete','incomplete_expired','paused','unpaid')or p_cancel_at_period_end is null or p_event_created is null or p_event_created not between 0 and 8640000000 then raise exception 'Invalid Stripe subscription state';end if;
 if p_period_start is not null and p_period_end is not null and p_period_end<p_period_start then raise exception 'Invalid Stripe period range';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,73022));
 if e.lease_expires_at<=clock_timestamp()then return false;end if;
 if exists(select 1 from public.workspace_subscriptions where workspace_id<>p_workspace_id and(provider_customer_id=p_customer_id or provider_subscription_id=p_subscription_id))then raise exception 'Provider billing identity belongs to a different workspace';end if;
 select * into s from public.workspace_subscriptions where workspace_id=p_workspace_id for update;
 if found then
  if s.billing_livemode is not null and s.billing_livemode<>e.livemode then raise exception 'Billing environment mismatch';end if;
  stale:=s.last_event_created is not null and s.last_event_created>p_event_created;
  if not stale and s.provider_subscription_id is not null and s.provider_subscription_id<>p_subscription_id and s.status not in('canceled','incomplete_expired')then raise exception 'Workspace is mapped to another current subscription';end if;
 end if;
 if not stale then
 insert into public.workspace_subscriptions(workspace_id,provider,provider_customer_id,provider_subscription_id,plan_key,status,current_period_start,current_period_end,cancel_at_period_end,last_event_created,last_event_id,billing_livemode,updated_at)
 values(p_workspace_id,'stripe',p_customer_id,p_subscription_id,p_plan_key,p_status,p_period_start,p_period_end,p_cancel_at_period_end,p_event_created,p_event_id,e.livemode,clock_timestamp())
 on conflict(workspace_id)do update set provider=excluded.provider,provider_customer_id=excluded.provider_customer_id,provider_subscription_id=excluded.provider_subscription_id,plan_key=excluded.plan_key,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,last_event_created=excluded.last_event_created,last_event_id=excluded.last_event_id,billing_livemode=excluded.billing_livemode,updated_at=excluded.updated_at;
 end if;
 if not le_ops.finish_stripe_event(p_event_id,p_token,null)then raise exception 'Stripe event lease expired before commit';end if;
 insert into public.ops_audit(workspace_id,action,details)values(p_workspace_id,case when stale then 'stripe_stale_event_ignored'else 'stripe_subscription_state_applied'end,jsonb_build_object('event_id',p_event_id,'event_created',p_event_created,'status',p_status,'livemode',e.livemode,'source','signature_verified_webhook_current_provider_lookup'));
 return true;
end$$;
alter table public.stripe_webhook_events add constraint stripe_lease_pair check((lease_token is null)=(lease_expires_at is null)),add constraint stripe_attempts_nonnegative check(attempts>=0);
