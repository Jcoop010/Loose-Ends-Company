-- Release 1: All-in-One Autonomous Business OS schema, owner RLS, and controlled /portal/[token] RPCs

-- 1. Extend public.workspace_settings with modular OS toggles & Autonomy Dial rules
create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  business_type text not null default 'general',
  timezone text not null default 'America/New_York',
  onboarding_completed boolean not null default false,
  onboarding_completed_at timestamptz,
  currency text not null default 'USD',
  locale text not null default 'en-US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_settings
  add column if not exists modules_enabled jsonb not null default '{"crm":true,"quotes":true,"billing":true,"inventory":false,"bookkeeping":false,"projects":false,"vault":false}'::jsonb,
  add column if not exists autonomy_rules jsonb not null default '{"send_quote_followup":"approve_1tap","convert_signed_quote_to_invoice":"full_auto","send_invoice_reminder":"approve_1tap","flag_overdue_ar":"full_auto"}'::jsonb,
  add column if not exists auto_limit_cents integer not null default 50000;

alter table public.workspace_settings
  drop constraint if exists workspace_settings_auto_limit_cents_check,
  add constraint workspace_settings_auto_limit_cents_check
    check (auto_limit_cents >= 0);

alter table public.workspace_settings enable row level security;

revoke all on table public.workspace_settings from public, anon;
grant select, insert, update, delete on table public.workspace_settings to authenticated;

drop policy if exists "workspace members can read workspace settings" on public.workspace_settings;
create policy "workspace members can read workspace settings"
  on public.workspace_settings for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace owners can insert workspace settings" on public.workspace_settings;
create policy "workspace owners can insert workspace settings"
  on public.workspace_settings for insert
  to authenticated
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners can update workspace settings" on public.workspace_settings;
create policy "workspace owners can update workspace settings"
  on public.workspace_settings for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners can delete workspace settings" on public.workspace_settings;
create policy "workspace owners can delete workspace settings"
  on public.workspace_settings for delete
  to authenticated
  using (public.is_workspace_owner(workspace_id));

-- 2. public.quotes & public.quote_items
create table if not exists public.quotes (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  lead_id        uuid references public.public_leads(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  quote_number   text not null,
  title          text not null,
  customer_name  text not null,
  customer_email text,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  tax_bps        integer not null default 0 check (tax_bps between 0 and 5000),
  tax_cents      integer not null default 0 check (tax_cents >= 0),
  total_cents    integer not null default 0 check (total_cents >= 0),
  status         text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'declined', 'expired')),
  portal_token   text not null unique,
  signed_by_name text,
  signed_at      timestamptz,
  valid_until    date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists quotes_workspace_created_idx
  on public.quotes (workspace_id, created_at desc);

create unique index if not exists quotes_portal_token_idx
  on public.quotes (portal_token);

create table if not exists public.quote_items (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  quote_id         uuid not null references public.quotes(id) on delete cascade,
  position         integer not null default 0 check (position >= 0),
  description      text not null,
  quantity         integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  line_total_cents integer not null default 0 check (line_total_cents >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists quote_items_quote_pos_idx
  on public.quote_items (quote_id, position asc);

-- 3. public.invoices & public.invoice_items
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  quote_id            uuid references public.quotes(id) on delete set null,
  lead_id             uuid references public.public_leads(id) on delete set null,
  customer_id         uuid references public.customers(id) on delete set null,
  invoice_number      text not null,
  title               text not null,
  customer_name       text not null,
  customer_email      text,
  subtotal_cents      integer not null default 0 check (subtotal_cents >= 0),
  tax_bps             integer not null default 0 check (tax_bps between 0 and 5000),
  tax_cents           integer not null default 0 check (tax_cents >= 0),
  total_cents         integer not null default 0 check (total_cents >= 0),
  amount_paid_cents   integer not null default 0 check (amount_paid_cents >= 0),
  due_date            date not null default (current_date + 14),
  stripe_checkout_url text,
  status              text not null default 'sent' check (status in ('draft', 'sent', 'paid', 'overdue', 'void')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists invoices_workspace_created_idx
  on public.invoices (workspace_id, created_at desc);

create unique index if not exists invoices_workspace_quote_unique_idx
  on public.invoices (workspace_id, quote_id)
  where quote_id is not null and status <> 'void';

create table if not exists public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  position         integer not null default 0 check (position >= 0),
  description      text not null,
  quantity         integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  line_total_cents integer not null default 0 check (line_total_cents >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists invoice_items_invoice_pos_idx
  on public.invoice_items (invoice_id, position asc);

-- 4. public.agent_action_ledger
create table if not exists public.agent_action_ledger (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  agent_name    text not null,
  module        text not null,
  action_type   text not null,
  autonomy_mode text not null check (autonomy_mode in ('manual', 'approve_1tap', 'full_auto')),
  summary       text not null,
  impact_cents  integer not null default 0,
  before_state  jsonb,
  after_state   jsonb,
  status        text not null default 'executed' check (status in ('executed', 'pending_approval', 'reversed')),
  reversed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists agent_action_ledger_workspace_created_idx
  on public.agent_action_ledger (workspace_id, created_at desc);

-- 5. Strict Workspace-Owner RLS on Release 1 Tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['quotes', 'quote_items', 'invoices', 'invoice_items', 'agent_action_ledger'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);

    execute format('drop policy if exists "workspace owners select %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners select %s" on public.%I for select to authenticated using (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );

    execute format('drop policy if exists "workspace owners insert %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners insert %s" on public.%I for insert to authenticated with check (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );

    execute format('drop policy if exists "workspace owners update %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners update %s" on public.%I for update to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );

    execute format('drop policy if exists "workspace owners delete %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners delete %s" on public.%I for delete to authenticated using (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );
  end loop;
end $$;

-- 6. Controlled Public /portal/[token] RPCs (SECURITY DEFINER, exact-token scoped)
create or replace function public.get_public_quote_portal(p_portal_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := trim(coalesce(p_portal_token, ''));
  v_quote public.quotes%rowtype;
  v_workspace_name text;
  v_items jsonb;
  v_invoice public.invoices%rowtype;
  v_invoice_items jsonb;
begin
  if length(v_token) < 8 then
    return null;
  end if;

  select *
  into v_quote
  from public.quotes
  where portal_token = v_token
  limit 1;

  if not found then
    return null;
  end if;

  select name
  into v_workspace_name
  from public.workspaces
  where id = v_quote.workspace_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', qi.id,
        'position', qi.position,
        'description', qi.description,
        'quantity', qi.quantity,
        'unit_price_cents', qi.unit_price_cents,
        'line_total_cents', qi.line_total_cents
      )
      order by qi.position asc, qi.created_at asc
    ),
    '[]'::jsonb
  )
  into v_items
  from public.quote_items qi
  where qi.quote_id = v_quote.id
    and qi.workspace_id = v_quote.workspace_id;

  select *
  into v_invoice
  from public.invoices i
  where i.workspace_id = v_quote.workspace_id
    and i.quote_id = v_quote.id
    and i.status <> 'void'
  order by i.created_at desc
  limit 1;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ii.id,
          'position', ii.position,
          'description', ii.description,
          'quantity', ii.quantity,
          'unit_price_cents', ii.unit_price_cents,
          'line_total_cents', ii.line_total_cents
        )
        order by ii.position asc, ii.created_at asc
      ),
      '[]'::jsonb
    )
    into v_invoice_items
    from public.invoice_items ii
    where ii.invoice_id = v_invoice.id
      and ii.workspace_id = v_quote.workspace_id;
  else
    v_invoice_items := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'workspace_name', coalesce(v_workspace_name, 'Loose Ends Workspace'),
    'quote', jsonb_build_object(
      'id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'title', v_quote.title,
      'customer_name', v_quote.customer_name,
      'customer_email', v_quote.customer_email,
      'subtotal_cents', v_quote.subtotal_cents,
      'tax_bps', v_quote.tax_bps,
      'tax_cents', v_quote.tax_cents,
      'total_cents', v_quote.total_cents,
      'status', v_quote.status,
      'portal_token', v_quote.portal_token,
      'signed_by_name', v_quote.signed_by_name,
      'signed_at', v_quote.signed_at,
      'valid_until', v_quote.valid_until,
      'notes', v_quote.notes,
      'created_at', v_quote.created_at
    ),
    'items', v_items,
    'invoice', case when v_invoice.id is not null then jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'title', v_invoice.title,
      'customer_name', v_invoice.customer_name,
      'subtotal_cents', v_invoice.subtotal_cents,
      'tax_cents', v_invoice.tax_cents,
      'total_cents', v_invoice.total_cents,
      'amount_paid_cents', v_invoice.amount_paid_cents,
      'due_date', v_invoice.due_date,
      'stripe_checkout_url', v_invoice.stripe_checkout_url,
      'status', v_invoice.status,
      'created_at', v_invoice.created_at
    ) else null end,
    'invoice_items', v_invoice_items
  );
end;
$$;

create or replace function public.sign_public_quote_portal(
  p_portal_token text,
  p_signer_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := trim(coalesce(p_portal_token, ''));
  v_signer text := trim(coalesce(p_signer_name, ''));
  v_quote public.quotes%rowtype;
  v_rule text := 'full_auto';
  v_limit integer := 50000;
  v_existing_inv_id uuid;
  v_new_inv_id uuid;
  v_inv_number text;
  v_decision text := 'manual_only';
  v_signed_now timestamptz := now();
begin
  if length(v_token) < 8 then
    raise exception 'Invalid portal token';
  end if;
  if length(v_signer) < 2 or length(v_signer) > 120 then
    raise exception 'Signer name must be between 2 and 120 characters';
  end if;

  select *
  into v_quote
  from public.quotes
  where portal_token = v_token
  for update;

  if not found then
    raise exception 'Quote portal link not found';
  end if;

  if v_quote.status in ('declined', 'expired') then
    raise exception 'Quote with status "%" cannot be signed', v_quote.status;
  end if;

  if v_quote.status <> 'signed' then
    update public.quotes
    set
      status = 'signed',
      signed_by_name = v_signer,
      signed_at = v_signed_now,
      updated_at = v_signed_now
    where id = v_quote.id
    returning * into v_quote;
  end if;

  select
    coalesce(ws.autonomy_rules->>'convert_signed_quote_to_invoice', 'full_auto'),
    coalesce(ws.auto_limit_cents, 50000)
  into v_rule, v_limit
  from public.workspace_settings ws
  where ws.workspace_id = v_quote.workspace_id;

  v_rule := coalesce(v_rule, 'full_auto');
  v_limit := coalesce(v_limit, 50000);

  select i.id
  into v_existing_inv_id
  from public.invoices i
  where i.workspace_id = v_quote.workspace_id
    and i.quote_id = v_quote.id
    and i.status <> 'void'
  limit 1;

  if v_existing_inv_id is null then
    if v_rule = 'full_auto' and v_quote.total_cents <= v_limit then
      v_decision := 'execute_now';
      v_inv_number := 'INV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

      insert into public.invoices (
        workspace_id,
        quote_id,
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
        due_date,
        status
      )
      values (
        v_quote.workspace_id,
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
        current_date + 14,
        'sent'
      )
      returning id into v_new_inv_id;

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
        v_quote.workspace_id,
        v_new_inv_id,
        qi.position,
        qi.description,
        qi.quantity,
        qi.unit_price_cents,
        qi.line_total_cents
      from public.quote_items qi
      where qi.quote_id = v_quote.id
        and qi.workspace_id = v_quote.workspace_id
      order by qi.position asc, qi.created_at asc;

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
      )
      values (
        v_quote.workspace_id,
        'Revenue-to-Cash Agent',
        'quotes',
        'convert_signed_quote_to_invoice',
        'full_auto',
        format('Auto-converted signed quote %s into invoice %s for %s', v_quote.quote_number, v_inv_number, v_quote.customer_name),
        v_quote.total_cents,
        jsonb_build_object('quote_id', v_quote.id, 'quote_status', 'sent', 'invoice_id', null),
        jsonb_build_object('quote_id', v_quote.id, 'quote_status', 'signed', 'invoice_id', v_new_inv_id, 'invoice_number', v_inv_number, 'signed_by', v_signer),
        'executed'
      );
    elsif v_rule = 'approve_1tap' or (v_rule = 'full_auto' and v_quote.total_cents > v_limit) then
      v_decision := 'queue_for_approval';

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
      )
      values (
        v_quote.workspace_id,
        'Revenue-to-Cash Agent',
        'quotes',
        'convert_signed_quote_to_invoice',
        case when v_rule = 'full_auto' then 'full_auto' else 'approve_1tap' end,
        format('Signed quote %s (%s) queued for 1-Tap invoice approval', v_quote.quote_number, v_quote.customer_name),
        v_quote.total_cents,
        jsonb_build_object('quote_id', v_quote.id, 'quote_status', 'signed', 'invoice_id', null),
        jsonb_build_object('quote_id', v_quote.id, 'pending_action', 'create_invoice', 'signed_by', v_signer),
        'pending_approval'
      );
    else
      v_decision := 'manual_only';
    end if;
  else
    v_decision := 'already_converted';
  end if;

  return public.get_public_quote_portal(v_token) || jsonb_build_object('autonomy_decision', v_decision);
end;
$$;

revoke all on function public.get_public_quote_portal(text) from public;
grant execute on function public.get_public_quote_portal(text) to anon, authenticated;

revoke all on function public.sign_public_quote_portal(text, text) from public;
grant execute on function public.sign_public_quote_portal(text, text) to anon, authenticated;
