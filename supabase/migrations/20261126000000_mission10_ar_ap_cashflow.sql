-- ============================================================================
-- Migration: 20261126000000_mission10_ar_ap_cashflow.sql
-- Purpose  : Mission 10 — Elite AR/AP Cashflow Suite
--            1. Additive extensions to quotes, invoices, vendor_bills, bot_manuals & staged_ops_actions
--            2. invoice_payments & invoice_dunning_events ledgers with strict multi-tenant RLS
--            3. Atomic, idempotent SECURITY DEFINER RPCs (SET search_path = public, pg_temp):
--               - convert_quote_to_invoice_atomic
--               - record_invoice_payment_atomic (rejects overpayments; writes ledger_entries + agent_action_ledger)
--               - stage_invoice_dunning_atomic (respects bot_manuals.mode & deduplicates stage per invoice)
--
-- DEPLOYMENT LOCK: Local Mission 10 build artifact. Do NOT auto-apply without explicit approval.
-- ============================================================================

-- 1. Extend quotes status check to permit 'approved' and 'converted' cleanly
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.quotes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.quotes drop constraint if exists %I', v_con);
  end loop;
end $$;

alter table public.quotes
  add constraint quotes_status_check
    check (status in ('draft', 'sent', 'signed', 'approved', 'converted', 'declined', 'expired'));

-- 2. Extend public.invoices with Mission 10 integer-cent balance, deposit & link tracking
alter table public.invoices
  add column if not exists source_quote_id uuid references public.quotes(id) on delete set null,
  add column if not exists balance_due_cents bigint not null default 0 check (balance_due_cents >= 0),
  add column if not exists deposit_required_bps integer not null default 0 check (deposit_required_bps >= 0 and deposit_required_bps <= 10000),
  add column if not exists deposit_cents bigint not null default 0 check (deposit_cents >= 0),
  add column if not exists idempotency_key text,
  add column if not exists stripe_payment_link_url text;

-- Backfill additive invoice fields safely without mutating totals
update public.invoices
set source_quote_id = coalesce(source_quote_id, quote_id),
    stripe_payment_link_url = coalesce(stripe_payment_link_url, stripe_checkout_url),
    balance_due_cents = case
      when status in ('paid', 'void') then 0::bigint
      else greatest(0::bigint, coalesce(total_cents, 0)::bigint - coalesce(amount_paid_cents, 0)::bigint)
    end
where source_quote_id is distinct from coalesce(source_quote_id, quote_id)
   or stripe_payment_link_url is distinct from coalesce(stripe_payment_link_url, stripe_checkout_url)
   or (balance_due_cents = 0 and status not in ('paid', 'void') and coalesce(total_cents, 0) > coalesce(amount_paid_cents, 0));

do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.invoices drop constraint if exists %I', v_con);
  end loop;
end $$;

alter table public.invoices
  add constraint invoices_status_check
    check (status in ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void'));

create unique index if not exists idx_invoices_workspace_idempotency
  on public.invoices (workspace_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists idx_invoices_source_quote
  on public.invoices (workspace_id, source_quote_id)
  where source_quote_id is not null and status <> 'void';

-- 3. Extend public.vendor_bills with payment terms and early-pay discount fields (e.g. 2/10 Net 30)
alter table public.vendor_bills
  add column if not exists payment_terms_label text,
  add column if not exists early_pay_discount_bps integer not null default 0 check (early_pay_discount_bps >= 0 and early_pay_discount_bps <= 5000),
  add column if not exists early_pay_discount_days integer not null default 0 check (early_pay_discount_days >= 0 and early_pay_discount_days <= 90),
  add column if not exists bill_date date;

-- 4. Extend public.bot_manuals mode constraint to support 'draft_and_approve' alongside existing modes
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.bot_manuals'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%mode%'
  loop
    execute format('alter table public.bot_manuals drop constraint if exists %I', v_con);
  end loop;
end $$;

alter table public.bot_manuals
  add constraint bot_manuals_mode_check
    check (mode in ('observe', 'propose', 'draft_and_approve', 'auto_with_escalation'));

-- 5. Extend public.staged_ops_actions action_type CHECK to permit 'dunning_reminder'
alter table public.staged_ops_actions
  drop constraint if exists staged_ops_actions_action_type_check,
  add constraint staged_ops_actions_action_type_check
    check (action_type in (
      'quote_draft',
      'job_checklist_flag',
      'sms_voicemail_command',
      'open_loop_recovery',
      'vendor_bill_audit',
      'photo_inventory_import',
      'purchase_order_draft',
      'collection_call_request',
      'ops_readiness_scorecard',
      'expense_receipt',
      'invoice_draft',
      'payment_match',
      'discrepancy_flag',
      'dunning_reminder'
    ));

-- 6. Create public.invoice_payments ledger
create table if not exists public.invoice_payments (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete cascade,
  invoice_id               uuid not null references public.invoices(id) on delete cascade,
  amount_cents             bigint not null check (amount_cents > 0),
  payment_type             text not null check (payment_type in ('deposit', 'partial', 'final', 'credit_memo')),
  payment_method           text not null default 'manual' check (
    payment_method in ('stripe_card', 'stripe_ach', 'check', 'cash', 'ach_manual', 'credit_memo', 'manual')
  ),
  stripe_payment_intent_id text,
  notes                    text,
  idempotency_key          text not null,
  recorded_at              timestamptz not null default now(),
  created_by               uuid references auth.users(id) on delete set null,
  unique (workspace_id, idempotency_key)
);

create unique index if not exists idx_invoice_payments_stripe_pi
  on public.invoice_payments (workspace_id, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists idx_invoice_payments_ws_invoice
  on public.invoice_payments (workspace_id, invoice_id, recorded_at desc);

alter table public.invoice_payments enable row level security;
revoke all on table public.invoice_payments from public, anon;
grant select, insert, update, delete on table public.invoice_payments to authenticated;

drop policy if exists "workspace owners select invoice_payments" on public.invoice_payments;
create policy "workspace owners select invoice_payments"
  on public.invoice_payments for select
  to authenticated
  using (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners insert invoice_payments" on public.invoice_payments;
create policy "workspace owners insert invoice_payments"
  on public.invoice_payments for insert
  to authenticated
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners update invoice_payments" on public.invoice_payments;
create policy "workspace owners update invoice_payments"
  on public.invoice_payments for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners delete invoice_payments" on public.invoice_payments;
create policy "workspace owners delete invoice_payments"
  on public.invoice_payments for delete
  to authenticated
  using (public.is_workspace_owner(workspace_id));

-- 7. Create public.invoice_dunning_events (strictly 1 stage draft per invoice)
create table if not exists public.invoice_dunning_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  stage            text not null check (stage in ('pre_due_3d', 'due_plus_3d', 'overdue_14d', 'overdue_30d')),
  staged_action_id uuid references public.staged_ops_actions(id) on delete set null,
  late_fee_cents   bigint not null default 0 check (late_fee_cents >= 0),
  status           text not null default 'drafted' check (status in ('drafted', 'approved', 'dismissed', 'sent')),
  idempotency_key  text not null,
  drafted_at       timestamptz not null default now(),
  sent_at          timestamptz,
  unique (workspace_id, invoice_id, stage),
  unique (workspace_id, idempotency_key)
);

create index if not exists idx_invoice_dunning_events_ws_invoice
  on public.invoice_dunning_events (workspace_id, invoice_id, drafted_at desc);

alter table public.invoice_dunning_events enable row level security;
revoke all on table public.invoice_dunning_events from public, anon;
grant select, insert, update, delete on table public.invoice_dunning_events to authenticated;

drop policy if exists "workspace owners select invoice_dunning_events" on public.invoice_dunning_events;
create policy "workspace owners select invoice_dunning_events"
  on public.invoice_dunning_events for select
  to authenticated
  using (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners insert invoice_dunning_events" on public.invoice_dunning_events;
create policy "workspace owners insert invoice_dunning_events"
  on public.invoice_dunning_events for insert
  to authenticated
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners update invoice_dunning_events" on public.invoice_dunning_events;
create policy "workspace owners update invoice_dunning_events"
  on public.invoice_dunning_events for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners delete invoice_dunning_events" on public.invoice_dunning_events;
create policy "workspace owners delete invoice_dunning_events"
  on public.invoice_dunning_events for delete
  to authenticated
  using (public.is_workspace_owner(workspace_id));

-- 8. Atomic RPC: convert_quote_to_invoice_atomic
create or replace function public.convert_quote_to_invoice_atomic(
  p_workspace_id uuid,
  p_quote_id uuid,
  p_deposit_required_bps integer default 0,
  p_due_days integer default 30,
  p_idempotency_key text default null,
  p_actor_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_existing_inv public.invoices%rowtype;
  v_invoice public.invoices%rowtype;
  v_agent public.agent_action_ledger%rowtype;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_deposit_bps integer := greatest(0, least(10000, coalesce(p_deposit_required_bps, 0)));
  v_due_days integer := greatest(1, least(365, coalesce(p_due_days, 30)));
  v_deposit_cents bigint := 0;
  v_inv_number text;
  v_now timestamptz := now();
begin
  if not (auth.role() = 'service_role' or public.is_workspace_owner(p_workspace_id)) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;

  if v_idem is null then
    v_idem := 'quote_conv:' || p_quote_id::text;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':quote_to_inv:' || p_quote_id::text, 1001));

  -- Check idempotency_key deduplication first
  select * into v_existing_inv
  from public.invoices
  where workspace_id = p_workspace_id
    and idempotency_key = v_idem
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'duplicate', true,
      'invoice', to_jsonb(v_existing_inv)
    );
  end if;

  -- Check existing active invoice for this quote
  select * into v_existing_inv
  from public.invoices
  where workspace_id = p_workspace_id
    and (source_quote_id = p_quote_id or quote_id = p_quote_id)
    and status <> 'void'
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'duplicate', true,
      'invoice', to_jsonb(v_existing_inv)
    );
  end if;

  select * into v_quote
  from public.quotes
  where workspace_id = p_workspace_id
    and id = p_quote_id
  for update;

  if not found then
    raise exception 'Quote not found in workspace';
  end if;

  if v_quote.status not in ('approved', 'signed', 'accepted') then
    raise exception 'Quote must be approved or signed before converting to an invoice (current status: %)', v_quote.status;
  end if;

  v_deposit_cents := ((v_quote.total_cents::bigint * v_deposit_bps::bigint) + 5000::bigint) / 10000::bigint;
  v_inv_number := 'INV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.invoices (
    workspace_id,
    quote_id,
    source_quote_id,
    lead_id,
    customer_id,
    invoice_number,
    title,
    customer_name,
    customer_email,
    subtotal_cents,
    tax_bps,
    tax_cents,
    total_cents,
    amount_paid_cents,
    balance_due_cents,
    deposit_required_bps,
    deposit_cents,
    due_date,
    idempotency_key,
    status,
    created_at,
    updated_at
  ) values (
    p_workspace_id,
    v_quote.id,
    v_quote.id,
    v_quote.lead_id,
    v_quote.customer_id,
    v_inv_number,
    v_quote.title,
    v_quote.customer_name,
    v_quote.customer_email,
    v_quote.subtotal_cents,
    v_quote.tax_bps,
    v_quote.tax_cents,
    v_quote.total_cents,
    0,
    v_quote.total_cents::bigint,
    v_deposit_bps,
    v_deposit_cents,
    (v_now::date + v_due_days),
    v_idem,
    'sent',
    v_now,
    v_now
  )
  returning * into v_invoice;

  insert into public.invoice_items (
    workspace_id,
    invoice_id,
    position,
    description,
    quantity,
    unit_price_cents,
    line_total_cents
  )
  select
    p_workspace_id,
    v_invoice.id,
    qi.position,
    qi.description,
    qi.quantity,
    qi.unit_price_cents,
    qi.line_total_cents
  from public.quote_items qi
  where qi.workspace_id = p_workspace_id
    and qi.quote_id = v_quote.id
  order by qi.position asc, qi.created_at asc;

  update public.quotes
  set status = 'converted',
      updated_at = v_now
  where workspace_id = p_workspace_id
    and id = v_quote.id;

  insert into public.agent_action_ledger (
    workspace_id,
    agent_name,
    module,
    action_type,
    autonomy_mode,
    summary,
    impact_cents,
    before_state,
    after_state,
    status
  ) values (
    p_workspace_id,
    'AR Collections & Billing Agent',
    'billing',
    'convert_quote_to_invoice',
    'approve_1tap',
    format('Converted quote %s to invoice %s (%s cents; deposit %s bps = %s cents)', v_quote.quote_number, v_invoice.invoice_number, v_invoice.total_cents, v_deposit_bps, v_deposit_cents),
    v_invoice.total_cents,
    jsonb_build_object('quote_id', v_quote.id, 'quote_status', v_quote.status, 'actor_user_id', p_actor_user_id),
    jsonb_build_object(
      'quote_id', v_quote.id,
      'quote_status', 'converted',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'total_cents', v_invoice.total_cents,
      'balance_due_cents', v_invoice.balance_due_cents,
      'deposit_required_bps', v_deposit_bps,
      'deposit_cents', v_deposit_cents,
      'idempotency_key', v_idem
    ),
    'executed'
  )
  returning * into v_agent;

  return jsonb_build_object(
    'status', 'created',
    'duplicate', false,
    'invoice', to_jsonb(v_invoice),
    'agent_ledger_entry', to_jsonb(v_agent)
  );
end;
$$;

revoke all on function public.convert_quote_to_invoice_atomic(uuid, uuid, integer, integer, text, uuid) from public, anon;
grant execute on function public.convert_quote_to_invoice_atomic(uuid, uuid, integer, integer, text, uuid) to authenticated, service_role;

-- 9. Atomic RPC: record_invoice_payment_atomic
create or replace function public.record_invoice_payment_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_payment_type text,
  p_payment_method text default 'manual',
  p_stripe_payment_intent_id text default null,
  p_notes text default null,
  p_idempotency_key text default null,
  p_actor_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.invoices%rowtype;
  v_existing_payment public.invoice_payments%rowtype;
  v_payment public.invoice_payments%rowtype;
  v_le public.ledger_entries%rowtype;
  v_agent public.agent_action_ledger%rowtype;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_pi text := nullif(trim(coalesce(p_stripe_payment_intent_id, '')), '');
  v_method text := coalesce(nullif(trim(p_payment_method), ''), 'manual');
  v_balance_before bigint;
  v_new_paid bigint;
  v_new_balance bigint;
  v_new_status text;
  v_now timestamptz := now();
begin
  if not (auth.role() = 'service_role' or public.is_workspace_owner(p_workspace_id)) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payment amount_cents must be a positive integer';
  end if;

  if p_payment_type not in ('deposit', 'partial', 'final', 'credit_memo') then
    raise exception 'Invalid payment_type: %', p_payment_type;
  end if;

  if v_method not in ('stripe_card', 'stripe_ach', 'check', 'cash', 'ach_manual', 'credit_memo', 'manual') then
    raise exception 'Invalid payment_method: %', v_method;
  end if;

  if v_idem is null or length(v_idem) < 4 then
    raise exception 'Valid idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':inv_pay:' || p_invoice_id::text, 1002));

  -- Deduplicate by idempotency_key or stripe_payment_intent_id
  select * into v_existing_payment
  from public.invoice_payments
  where workspace_id = p_workspace_id
    and (
      idempotency_key = v_idem
      or (v_pi is not null and stripe_payment_intent_id = v_pi)
    )
  limit 1;

  if found then
    select * into v_inv from public.invoices where workspace_id = p_workspace_id and id = v_existing_payment.invoice_id;
    return jsonb_build_object(
      'status', 'duplicate',
      'duplicate', true,
      'payment', to_jsonb(v_existing_payment),
      'invoice', to_jsonb(v_inv)
    );
  end if;

  select * into v_inv
  from public.invoices
  where workspace_id = p_workspace_id
    and id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found in workspace';
  end if;

  if v_inv.status in ('paid', 'void') then
    raise exception 'Cannot record payment on invoice % with status %', v_inv.invoice_number, v_inv.status;
  end if;

  v_balance_before := greatest(0::bigint, v_inv.total_cents::bigint - coalesce(v_inv.amount_paid_cents, 0)::bigint);
  if p_amount_cents > v_balance_before then
    raise exception 'Overpayment rejected: payment % cents exceeds remaining balance % cents', p_amount_cents, v_balance_before;
  end if;

  v_new_paid := coalesce(v_inv.amount_paid_cents, 0)::bigint + p_amount_cents;
  v_new_balance := greatest(0::bigint, v_inv.total_cents::bigint - v_new_paid);
  if v_new_balance = 0 then
    v_new_status := 'paid';
  else
    v_new_status := 'partially_paid';
  end if;

  insert into public.invoice_payments (
    workspace_id,
    invoice_id,
    amount_cents,
    payment_type,
    payment_method,
    stripe_payment_intent_id,
    notes,
    idempotency_key,
    recorded_at,
    created_by
  ) values (
    p_workspace_id,
    p_invoice_id,
    p_amount_cents,
    p_payment_type,
    v_method,
    v_pi,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_idem,
    v_now,
    p_actor_user_id
  )
  returning * into v_payment;

  update public.invoices
  set amount_paid_cents = v_new_paid::integer,
      balance_due_cents = v_new_balance,
      status = v_new_status,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and id = p_invoice_id
  returning * into v_inv;

  -- Auto-pause any active collections/dunning reminders when invoice reaches zero balance
  if v_new_balance = 0 then
    update public.collection_touches
    set status = 'paused_paid',
        updated_at = v_now
    where workspace_id = p_workspace_id
      and invoice_id = p_invoice_id
      and status = 'staged';

    update public.invoice_dunning_events
    set status = 'dismissed'
    where workspace_id = p_workspace_id
      and invoice_id = p_invoice_id
      and status = 'drafted';
  end if;

  -- Append balanced cash receipt entry to immutable GL ledger_entries
  insert into public.ledger_entries (
    workspace_id,
    entry_type,
    category,
    description,
    amount_cents,
    occurred_on,
    source_ref,
    idempotency_key
  ) values (
    p_workspace_id,
    case when p_payment_type = 'credit_memo' then 'expense' else 'revenue' end,
    case when p_payment_type = 'credit_memo' then 'ar_credit_memo' else 'ar_payment_received' end,
    format('Invoice %s %s (%s) — %s cents', v_inv.invoice_number, p_payment_type, v_method, p_amount_cents),
    case when p_payment_type = 'credit_memo' then (-p_amount_cents)::integer else p_amount_cents::integer end,
    v_now::date,
    'invoice:' || v_inv.invoice_number,
    'inv_pay:' || v_idem
  )
  returning * into v_le;

  insert into public.agent_action_ledger (
    workspace_id,
    agent_name,
    module,
    action_type,
    autonomy_mode,
    summary,
    impact_cents,
    before_state,
    after_state,
    status
  ) values (
    p_workspace_id,
    case when v_pi is not null then 'Stripe Cash Application Sync' else 'AR Payment Collector' end,
    'billing',
    'record_invoice_payment',
    'manual',
    format('Applied %s payment (%s, %s cents) to %s; new balance %s cents', p_payment_type, v_method, p_amount_cents, v_inv.invoice_number, v_new_balance),
    p_amount_cents::integer,
    jsonb_build_object('invoice_id', p_invoice_id, 'balance_due_cents', v_balance_before),
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'payment_id', v_payment.id,
      'ledger_entry_id', v_le.id,
      'amount_cents', p_amount_cents,
      'balance_due_cents', v_new_balance,
      'status', v_new_status,
      'stripe_payment_intent_id', v_pi,
      'idempotency_key', v_idem
    ),
    'executed'
  )
  returning * into v_agent;

  return jsonb_build_object(
    'status', 'recorded',
    'duplicate', false,
    'payment', to_jsonb(v_payment),
    'invoice', to_jsonb(v_inv),
    'ledger_entry', to_jsonb(v_le),
    'agent_ledger_entry', to_jsonb(v_agent)
  );
end;
$$;

revoke all on function public.record_invoice_payment_atomic(uuid, uuid, bigint, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_invoice_payment_atomic(uuid, uuid, bigint, text, text, text, text, text, uuid) to authenticated, service_role;

-- 10. Atomic RPC: stage_invoice_dunning_atomic (Human-in-the-loop only; zero auto-send)
create or replace function public.stage_invoice_dunning_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_stage text,
  p_late_fee_cents bigint default 0,
  p_title text default '',
  p_summary text default '',
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := 'propose';
  v_inv public.invoices%rowtype;
  v_existing public.invoice_dunning_events%rowtype;
  v_staged public.staged_ops_actions%rowtype;
  v_dunning public.invoice_dunning_events%rowtype;
  v_agent public.agent_action_ledger%rowtype;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_late_fee bigint := greatest(0::bigint, coalesce(p_late_fee_cents, 0::bigint));
  v_now timestamptz := now();
begin
  if not (auth.role() = 'service_role' or public.is_workspace_owner(p_workspace_id)) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;

  if p_stage not in ('pre_due_3d', 'due_plus_3d', 'overdue_14d', 'overdue_30d') then
    raise exception 'Invalid dunning stage: %', p_stage;
  end if;

  if v_idem is null then
    v_idem := format('dunning:%s:%s', p_invoice_id::text, p_stage);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':dunning:' || p_invoice_id::text, 1003));

  -- Check bot_manuals mode for collections; respect 'observe' mode by never queuing actions
  select mode into v_mode
  from public.bot_manuals
  where workspace_id = p_workspace_id
    and bot_role = 'collections'
  limit 1;

  if v_mode = 'observe' then
    return jsonb_build_object(
      'status', 'skipped_observe_mode',
      'duplicate', false,
      'mode', v_mode
    );
  end if;

  -- Prevent duplicate stage drafting per invoice
  select * into v_existing
  from public.invoice_dunning_events
  where workspace_id = p_workspace_id
    and (
      (invoice_id = p_invoice_id and stage = p_stage)
      or idempotency_key = v_idem
    )
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'duplicate', true,
      'dunning_event', to_jsonb(v_existing)
    );
  end if;

  select * into v_inv
  from public.invoices
  where workspace_id = p_workspace_id
    and id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found in workspace';
  end if;

  if v_inv.status in ('paid', 'void') or coalesce(v_inv.balance_due_cents, v_inv.total_cents::bigint - v_inv.amount_paid_cents::bigint) <= 0 then
    raise exception 'Cannot stage dunning reminder for settled or void invoice %', v_inv.invoice_number;
  end if;

  insert into public.staged_ops_actions (
    workspace_id,
    bot_role,
    workspace_domain,
    action_type,
    customer_id,
    title,
    summary,
    amount_cents,
    payload,
    confidence_score,
    status
  ) values (
    p_workspace_id,
    'collections',
    'billing',
    'dunning_reminder',
    v_inv.customer_id,
    coalesce(nullif(trim(p_title), ''), format('[%s] %s · %s', p_stage, v_inv.invoice_number, v_inv.customer_name)),
    coalesce(nullif(trim(p_summary), ''), format('Human-approved dunning reminder draft for %s (%s cents due).', v_inv.invoice_number, v_inv.balance_due_cents)),
    v_inv.balance_due_cents + v_late_fee,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'invoice_id', p_invoice_id,
      'invoice_number', v_inv.invoice_number,
      'stage', p_stage,
      'late_fee_cents', v_late_fee,
      'auto_send', false,
      'idempotency_key', v_idem
    ),
    0.95,
    'pending_approval'
  )
  returning * into v_staged;

  insert into public.invoice_dunning_events (
    workspace_id,
    invoice_id,
    stage,
    staged_action_id,
    late_fee_cents,
    status,
    idempotency_key,
    drafted_at,
    sent_at
  ) values (
    p_workspace_id,
    p_invoice_id,
    p_stage,
    v_staged.id,
    v_late_fee,
    'drafted',
    v_idem,
    v_now,
    null
  )
  returning * into v_dunning;

  insert into public.agent_action_ledger (
    workspace_id,
    agent_name,
    module,
    action_type,
    autonomy_mode,
    summary,
    impact_cents,
    before_state,
    after_state,
    status
  ) values (
    p_workspace_id,
    'Collections Dunning Bot',
    'billing',
    'stage_invoice_dunning',
    'approve_1tap',
    format('Staged %s dunning draft for %s (balance %s cents, late fee %s cents; requires approval)', p_stage, v_inv.invoice_number, v_inv.balance_due_cents, v_late_fee),
    (v_inv.balance_due_cents + v_late_fee)::integer,
    jsonb_build_object('invoice_id', p_invoice_id, 'stage', p_stage),
    jsonb_build_object(
      'dunning_event_id', v_dunning.id,
      'staged_action_id', v_staged.id,
      'status', 'pending_approval',
      'idempotency_key', v_idem
    ),
    'pending_approval'
  )
  returning * into v_agent;

  return jsonb_build_object(
    'status', 'drafted',
    'duplicate', false,
    'staged_action', to_jsonb(v_staged),
    'dunning_event', to_jsonb(v_dunning),
    'agent_ledger_entry', to_jsonb(v_agent)
  );
end;
$$;

revoke all on function public.stage_invoice_dunning_atomic(uuid, uuid, text, bigint, text, text, jsonb, text) from public, anon;
grant execute on function public.stage_invoice_dunning_atomic(uuid, uuid, text, bigint, text, text, jsonb, text) to authenticated, service_role;
