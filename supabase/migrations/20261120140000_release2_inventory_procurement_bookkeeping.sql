-- Release 2: Inventory, Procurement, 3-Way Matching & Native Bookkeeping schema, owner RLS, and GRN RPCs

-- 1. Extend public.inventory_items with deterministic Release 2 integer/procurement columns
alter table public.inventory_items
  add column if not exists bin_code text,
  add column if not exists on_hand_qty integer not null default 0 check (on_hand_qty >= 0),
  add column if not exists reserved_qty integer not null default 0 check (reserved_qty >= 0),
  add column if not exists reorder_point_qty integer not null default 0 check (reorder_point_qty >= 0),
  add column if not exists reorder_qty integer not null default 1 check (reorder_qty >= 1),
  add column if not exists unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),
  add column if not exists unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  add column if not exists preferred_vendor text,
  add column if not exists lead_time_days integer not null default 7 check (lead_time_days >= 0);

create unique index if not exists inventory_items_workspace_sku_idx
  on public.inventory_items (workspace_id, sku);

-- Backfill existing inventory_items rows from legacy columns before adding cross-column check
update public.inventory_items
set
  on_hand_qty = greatest(0, round(quantity)::integer),
  reserved_qty = greatest(0, least(greatest(0, round(quantity)::integer), round(reserved)::integer)),
  reorder_point_qty = greatest(0, round(reorder_threshold)::integer),
  reorder_qty = greatest(1, round(reorder_quantity)::integer),
  unit_cost_cents = greatest(0, round(purchase_cost * 100)::integer),
  unit_price_cents = greatest(0, round(selling_price * 100)::integer),
  preferred_vendor = coalesce(preferred_vendor, supplier)
where on_hand_qty <> greatest(0, round(quantity)::integer)
   or reserved_qty <> greatest(0, least(greatest(0, round(quantity)::integer), round(reserved)::integer))
   or reorder_point_qty <> greatest(0, round(reorder_threshold)::integer)
   or reorder_qty <> greatest(1, round(reorder_quantity)::integer)
   or unit_cost_cents <> greatest(0, round(purchase_cost * 100)::integer)
   or unit_price_cents <> greatest(0, round(selling_price * 100)::integer)
   or (preferred_vendor is null and supplier is not null);

alter table public.inventory_items
  drop constraint if exists inventory_items_reserved_qty_check,
  add constraint inventory_items_reserved_qty_check
    check (reserved_qty >= 0 and reserved_qty <= on_hand_qty);

create or replace function public.sync_inventory_items_r2_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.on_hand_qty = 0 and new.quantity > 0 then
      new.on_hand_qty := greatest(0, round(new.quantity)::integer);
    elsif new.quantity = 0 and new.on_hand_qty > 0 then
      new.quantity := new.on_hand_qty::numeric(14,3);
    end if;

    if new.reserved_qty = 0 and new.reserved > 0 then
      new.reserved_qty := greatest(0, least(new.on_hand_qty, round(new.reserved)::integer));
    elsif new.reserved = 0 and new.reserved_qty > 0 then
      new.reserved := least(new.quantity, new.reserved_qty::numeric(14,3));
    end if;

    if new.reorder_point_qty = 0 and new.reorder_threshold > 0 then
      new.reorder_point_qty := greatest(0, round(new.reorder_threshold)::integer);
    elsif new.reorder_threshold = 0 and new.reorder_point_qty > 0 then
      new.reorder_threshold := new.reorder_point_qty::numeric(14,3);
    end if;

    if new.reorder_qty = 1 and new.reorder_quantity <> 1 then
      new.reorder_qty := greatest(1, round(new.reorder_quantity)::integer);
    elsif new.reorder_quantity = 1 and new.reorder_qty <> 1 then
      new.reorder_quantity := new.reorder_qty::numeric(14,3);
    end if;

    if new.unit_cost_cents = 0 and new.purchase_cost > 0 then
      new.unit_cost_cents := greatest(0, round(new.purchase_cost * 100)::integer);
    elsif new.purchase_cost = 0 and new.unit_cost_cents > 0 then
      new.purchase_cost := round((new.unit_cost_cents::numeric / 100.0), 2);
    end if;

    if new.unit_price_cents = 0 and new.selling_price > 0 then
      new.unit_price_cents := greatest(0, round(new.selling_price * 100)::integer);
    elsif new.selling_price = 0 and new.unit_price_cents > 0 then
      new.selling_price := round((new.unit_price_cents::numeric / 100.0), 2);
    end if;

    if new.preferred_vendor is null and new.supplier is not null then
      new.preferred_vendor := new.supplier;
    elsif new.supplier is null and new.preferred_vendor is not null then
      new.supplier := new.preferred_vendor;
    end if;
  else
    if new.on_hand_qty is distinct from old.on_hand_qty then
      new.quantity := new.on_hand_qty::numeric(14,3);
    elsif new.quantity is distinct from old.quantity then
      new.on_hand_qty := greatest(0, round(new.quantity)::integer);
    end if;

    if new.reserved_qty is distinct from old.reserved_qty then
      new.reserved := new.reserved_qty::numeric(14,3);
    elsif new.reserved is distinct from old.reserved then
      new.reserved_qty := greatest(0, round(new.reserved)::integer);
    end if;

    if new.reorder_point_qty is distinct from old.reorder_point_qty then
      new.reorder_threshold := new.reorder_point_qty::numeric(14,3);
    elsif new.reorder_threshold is distinct from old.reorder_threshold then
      new.reorder_point_qty := greatest(0, round(new.reorder_threshold)::integer);
    end if;

    if new.reorder_qty is distinct from old.reorder_qty then
      new.reorder_quantity := new.reorder_qty::numeric(14,3);
    elsif new.reorder_quantity is distinct from old.reorder_quantity then
      new.reorder_qty := greatest(1, round(new.reorder_quantity)::integer);
    end if;

    if new.unit_cost_cents is distinct from old.unit_cost_cents then
      new.purchase_cost := round((new.unit_cost_cents::numeric / 100.0), 2);
    elsif new.purchase_cost is distinct from old.purchase_cost then
      new.unit_cost_cents := greatest(0, round(new.purchase_cost * 100)::integer);
    end if;

    if new.unit_price_cents is distinct from old.unit_price_cents then
      new.selling_price := round((new.unit_price_cents::numeric / 100.0), 2);
    elsif new.selling_price is distinct from old.selling_price then
      new.unit_price_cents := greatest(0, round(new.selling_price * 100)::integer);
    end if;

    if new.preferred_vendor is distinct from old.preferred_vendor then
      new.supplier := new.preferred_vendor;
    elsif new.supplier is distinct from old.supplier then
      new.preferred_vendor := new.supplier;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inventory_items_sync_r2 on public.inventory_items;
create trigger trg_inventory_items_sync_r2
  before insert or update on public.inventory_items
  for each row
  execute function public.sync_inventory_items_r2_columns();

-- Preserve strict command-only write lock on inventory_items (direct REST mutations stay 403)
revoke insert, update, delete on table public.inventory_items from public, anon, authenticated;

-- 2. public.purchase_orders & public.purchase_order_items
create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  po_number     text not null,
  vendor_name   text not null,
  status        text not null default 'draft' check (
    status in ('draft', 'pending_approval', 'sent', 'partially_received', 'received', 'closed')
  ),
  total_cents   integer not null default 0 check (total_cents >= 0),
  expected_date date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, po_number)
);

create index if not exists purchase_orders_workspace_created_idx
  on public.purchase_orders (workspace_id, created_at desc);

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  po_id             uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  sku               text not null,
  description       text not null,
  ordered_qty       integer not null check (ordered_qty > 0),
  received_qty      integer not null default 0 check (received_qty >= 0),
  unit_cost_cents   integer not null default 0 check (unit_cost_cents >= 0),
  line_total_cents  integer not null default 0 check (line_total_cents >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists purchase_order_items_po_idx
  on public.purchase_order_items (po_id, created_at asc);

-- 3. public.goods_receipts
create table if not exists public.goods_receipts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  po_id        uuid not null references public.purchase_orders(id) on delete cascade,
  received_by  text not null,
  items_json   jsonb not null default '[]'::jsonb,
  received_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists goods_receipts_workspace_po_idx
  on public.goods_receipts (workspace_id, po_id, received_at desc);

-- 4. public.vendor_bills
create table if not exists public.vendor_bills (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  po_id                 uuid references public.purchase_orders(id) on delete set null,
  vendor_name           text not null,
  invoice_number        text not null,
  subtotal_cents        integer not null default 0 check (subtotal_cents >= 0),
  tax_cents             integer not null default 0 check (tax_cents >= 0),
  total_cents           integer not null default 0 check (total_cents >= 0),
  due_date              date not null default (current_date + 30),
  items_json            jsonb not null default '[]'::jsonb,
  match_status          text not null default 'unmatched' check (
    match_status in ('unmatched', 'matched_clean', 'exception_flagged', 'disputed', 'paid')
  ),
  match_variance_cents  integer not null default 0,
  discrepancy_summary   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists vendor_bills_workspace_created_idx
  on public.vendor_bills (workspace_id, created_at desc);

create index if not exists vendor_bills_workspace_invoice_idx
  on public.vendor_bills (workspace_id, invoice_number);

-- 5. public.ledger_entries
create table if not exists public.ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_type   text not null check (entry_type in ('revenue', 'cogs', 'expense', 'ap_scheduled')),
  category     text not null,
  description  text not null,
  amount_cents integer not null,
  occurred_on  date not null default current_date,
  source_ref   text,
  created_at   timestamptz not null default now()
);

create index if not exists ledger_entries_workspace_occurred_idx
  on public.ledger_entries (workspace_id, occurred_on desc, created_at desc);

-- 6. Strict Workspace-Owner RLS on Release 2 Tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'purchase_orders',
    'purchase_order_items',
    'goods_receipts',
    'vendor_bills',
    'ledger_entries'
  ] loop
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

-- 7. Owner-Gated SECURITY DEFINER RPCs for inventory_items & GRN receiving
create or replace function public.upsert_inventory_item_r2(
  p_workspace_id uuid,
  p_sku text,
  p_name text,
  p_location text default null,
  p_bin_code text default null,
  p_on_hand_qty integer default 0,
  p_reserved_qty integer default 0,
  p_reorder_point_qty integer default 0,
  p_reorder_qty integer default 1,
  p_unit_cost_cents integer default 0,
  p_unit_price_cents integer default 0,
  p_preferred_vendor text default null,
  p_lead_time_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := trim(coalesce(p_sku, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_on_hand integer := greatest(0, coalesce(p_on_hand_qty, 0));
  v_reserved integer := greatest(0, least(v_on_hand, coalesce(p_reserved_qty, 0)));
  v_reorder_pt integer := greatest(0, coalesce(p_reorder_point_qty, 0));
  v_reorder_qty integer := greatest(1, coalesce(p_reorder_qty, 1));
  v_cost_cents integer := greatest(0, coalesce(p_unit_cost_cents, 0));
  v_price_cents integer := greatest(0, coalesce(p_unit_price_cents, 0));
  v_lead_days integer := greatest(0, coalesce(p_lead_time_days, 7));
  v_row public.inventory_items%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not coalesce(public.is_workspace_owner(p_workspace_id), false) then
    raise exception 'Owner or administrator permission required' using errcode = '42501';
  end if;

  if length(v_sku) < 1 or length(v_name) < 1 then
    raise exception 'sku and name are required';
  end if;

  insert into public.inventory_items (
    workspace_id,
    sku,
    name,
    location,
    bin_code,
    on_hand_qty,
    reserved_qty,
    reorder_point_qty,
    reorder_qty,
    unit_cost_cents,
    unit_price_cents,
    preferred_vendor,
    lead_time_days,
    quantity,
    reserved,
    reorder_threshold,
    reorder_quantity,
    purchase_cost,
    selling_price,
    supplier
  )
  values (
    p_workspace_id,
    v_sku,
    v_name,
    nullif(trim(coalesce(p_location, '')), ''),
    nullif(trim(coalesce(p_bin_code, '')), ''),
    v_on_hand,
    v_reserved,
    v_reorder_pt,
    v_reorder_qty,
    v_cost_cents,
    v_price_cents,
    nullif(trim(coalesce(p_preferred_vendor, '')), ''),
    v_lead_days,
    v_on_hand::numeric(14,3),
    v_reserved::numeric(14,3),
    v_reorder_pt::numeric(14,3),
    v_reorder_qty::numeric(14,3),
    round((v_cost_cents::numeric / 100.0), 2),
    round((v_price_cents::numeric / 100.0), 2),
    nullif(trim(coalesce(p_preferred_vendor, '')), '')
  )
  on conflict (workspace_id, sku) do update set
    name = excluded.name,
    location = excluded.location,
    bin_code = excluded.bin_code,
    on_hand_qty = excluded.on_hand_qty,
    reserved_qty = excluded.reserved_qty,
    reorder_point_qty = excluded.reorder_point_qty,
    reorder_qty = excluded.reorder_qty,
    unit_cost_cents = excluded.unit_cost_cents,
    unit_price_cents = excluded.unit_price_cents,
    preferred_vendor = excluded.preferred_vendor,
    lead_time_days = excluded.lead_time_days,
    quantity = excluded.quantity,
    reserved = excluded.reserved,
    reorder_threshold = excluded.reorder_threshold,
    reorder_quantity = excluded.reorder_quantity,
    purchase_cost = excluded.purchase_cost,
    selling_price = excluded.selling_price,
    supplier = excluded.supplier,
    archived = false,
    updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.record_goods_receipt_r2(
  p_workspace_id uuid,
  p_po_id uuid,
  p_received_by text,
  p_items_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_po public.purchase_orders%rowtype;
  v_receipt public.goods_receipts%rowtype;
  v_line jsonb;
  v_sku text;
  v_received_qty integer;
  v_damaged_qty integer;
  v_usable_qty integer;
  v_item public.inventory_items%rowtype;
  v_next_on_hand integer;
  v_all_received boolean;
  v_next_po_status text;
  v_updated_skus text[] := '{}';
  v_total_usable integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not coalesce(public.is_workspace_owner(p_workspace_id), false) then
    raise exception 'Owner or administrator permission required' using errcode = '42501';
  end if;

  if p_items_json is null or jsonb_typeof(p_items_json) <> 'array' or jsonb_array_length(p_items_json) = 0 then
    raise exception 'items_json must be a non-empty JSON array';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_po_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Purchase order not found in workspace';
  end if;

  insert into public.goods_receipts (
    workspace_id,
    po_id,
    received_by,
    items_json
  )
  values (
    p_workspace_id,
    p_po_id,
    coalesce(nullif(trim(p_received_by), ''), 'Warehouse Receiver'),
    p_items_json
  )
  returning * into v_receipt;

  for v_line in select value from jsonb_array_elements(p_items_json)
  loop
    v_sku := upper(trim(coalesce(v_line->>'sku', '')));
    v_received_qty := greatest(0, coalesce((v_line->>'received_qty')::integer, 0));
    v_damaged_qty := greatest(0, coalesce((v_line->>'damaged_qty')::integer, 0));
    v_usable_qty := greatest(0, v_received_qty - v_damaged_qty);

    if length(v_sku) = 0 then
      continue;
    end if;

    update public.purchase_order_items
    set received_qty = received_qty + v_usable_qty
    where workspace_id = p_workspace_id
      and po_id = p_po_id
      and upper(trim(sku)) = v_sku;

    if v_usable_qty > 0 then
      select *
      into v_item
      from public.inventory_items
      where workspace_id = p_workspace_id
        and upper(trim(sku)) = v_sku
      for update;

      if found then
        v_next_on_hand := v_item.on_hand_qty + v_usable_qty;
        update public.inventory_items
        set
          on_hand_qty = v_next_on_hand,
          quantity = v_next_on_hand::numeric(14,3),
          updated_at = now()
        where id = v_item.id
          and workspace_id = p_workspace_id;

        insert into public.inventory_movements (
          workspace_id,
          item_id,
          kind,
          quantity,
          balance,
          reason,
          actor_id
        )
        values (
          p_workspace_id,
          v_item.id,
          'receipt',
          v_usable_qty::numeric(14,3),
          v_next_on_hand::numeric(14,3),
          format('GRN for PO %s (damaged: %s)', v_po.po_number, v_damaged_qty),
          v_actor
        );
      end if;
    end if;

    v_total_usable := v_total_usable + v_usable_qty;
    v_updated_skus := array_append(v_updated_skus, v_sku);
  end loop;

  select exists (
    select 1
    from public.purchase_order_items
    where workspace_id = p_workspace_id
      and po_id = p_po_id
  ) and not exists (
    select 1
    from public.purchase_order_items
    where workspace_id = p_workspace_id
      and po_id = p_po_id
      and received_qty < ordered_qty
  )
  into v_all_received;

  v_next_po_status := case when v_all_received then 'received' else 'partially_received' end;

  update public.purchase_orders
  set
    status = v_next_po_status,
    updated_at = now()
  where id = p_po_id
    and workspace_id = p_workspace_id;

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
    p_workspace_id,
    'Receiving & Inventory Agent',
    'inventory',
    'record_goods_receipt',
    'manual',
    format('Recorded GRN for PO %s (%s usable units across %s SKUs)', v_po.po_number, v_total_usable, coalesce(array_length(v_updated_skus, 1), 0)),
    v_po.total_cents,
    jsonb_build_object('po_id', p_po_id, 'po_status', v_po.status),
    jsonb_build_object('po_id', p_po_id, 'po_status', v_next_po_status, 'goods_receipt_id', v_receipt.id, 'updated_skus', v_updated_skus),
    'executed'
  );

  return jsonb_build_object(
    'goods_receipt', to_jsonb(v_receipt),
    'po_status', v_next_po_status,
    'updated_skus', v_updated_skus
  );
end;
$$;

revoke all on function public.upsert_inventory_item_r2(uuid, text, text, text, text, integer, integer, integer, integer, integer, integer, text, integer) from public, anon;
grant execute on function public.upsert_inventory_item_r2(uuid, text, text, text, text, integer, integer, integer, integer, integer, integer, text, integer) to authenticated, service_role;

revoke all on function public.record_goods_receipt_r2(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.record_goods_receipt_r2(uuid, uuid, text, jsonb) to authenticated, service_role;
