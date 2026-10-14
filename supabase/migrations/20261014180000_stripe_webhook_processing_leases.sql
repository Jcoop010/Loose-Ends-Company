-- Durable, fenced processing leases for Stripe webhook events.
-- Migration only: the Edge Function must adopt these RPCs before recovery is enabled.
alter table public.stripe_webhook_events
  add column if not exists processing_token uuid,
  add column if not exists processing_lease_until timestamptz;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text, p_event_type text, p_livemode boolean,
  p_token uuid, p_lease_seconds integer default 900
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_row public.stripe_webhook_events%rowtype;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_event_type is null or length(p_event_type) = 0
    or p_livemode is null or p_token is null
    or p_lease_seconds not between 60 and 3600 then
    raise exception 'Invalid Stripe webhook claim arguments';
  end if;

  insert into public.stripe_webhook_events
    (event_id, event_type, livemode, processing_token, processing_lease_until)
  values
    (p_event_id, p_event_type, p_livemode, p_token, clock_timestamp() + make_interval(secs => p_lease_seconds))
  on conflict (event_id) do nothing;

  select * into v_row from public.stripe_webhook_events
    where event_id = p_event_id for update;
  if not found then raise exception 'Stripe ledger row missing'; end if;
  if v_row.event_type is distinct from p_event_type or v_row.livemode is distinct from p_livemode then
    raise exception 'Stripe ledger event identity conflict';
  end if;
  if v_row.processed_at is not null then return 'processed'; end if;
  if v_row.processing_token = p_token then return 'claimed'; end if;

  if v_row.processing_token is null
    or v_row.processing_lease_until is null
    or v_row.processing_lease_until <= clock_timestamp() then
    update public.stripe_webhook_events set
      processing_token = p_token,
      processing_lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      processing_error = null
    where event_id = p_event_id;
    return 'claimed';
  end if;
  return 'busy';
end;
$$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text, p_token uuid, p_error text default null
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if p_event_id is null or p_token is null then
    raise exception 'Invalid webhook completion arguments';
  end if;
  update public.stripe_webhook_events set
    processed_at = case when p_error is null then clock_timestamp() else processed_at end,
    processing_error = left(p_error, 2048),
    processing_token = null,
    processing_lease_until = null
  where event_id = p_event_id
    and processing_token = p_token
    and processed_at is null
    and processing_lease_until > clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text,text,boolean,uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text,text,boolean,uuid,integer) to service_role;
grant execute on function public.finish_stripe_webhook_event(text,uuid,text) to service_role;
