-- ============================================================================
-- Loose Ends OS — Mission 12: Autonomous Inventory Management, Auditing &
-- Stock-to-Ledger Reconciliation Suite
-- Strictly additive migration (zero DROP statements, integer-cent BIGINT money,
-- immutable stock movement ledger, multi-tenant workspace-owner RLS, 4 atomic RPCs).
-- ============================================================================

-- 1. Modular Workspace Toggle (inventory_enabled default true, toggleable in settings)
alter table public.workspace_settings
  add column if not exists inventory_enabled boolean not null default true;

-- 2. Extend public.inventory_items additively with Mission 12 metadata columns
alter table public.inventory_items
  add column if not exists owner_id uuid default auth.uid(),
  add column if not exists unit_of_measure text not null default 'each',
  add column if not exists preferred_vendor_name text,
  add column if not exists track_serial_or_lot boolean not null default false,
  add column if not exists is_active boolean not null default true;

-- Backfill preferred_vendor_name from preferred_vendor / supplier where null
update public.inventory_items
set
  preferred_vendor_name = coalesce(preferred_vendor_name, preferred_vendor, supplier),
  is_active = not coalesce(archived, false)
where preferred_vendor_name is null;

-- 3. Multi-Location Warehouse / Truck / Bin Registry
create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid default auth.uid(),
  name text not null check (length(trim(name)) between 1 and 140),
  code text not null check (length(trim(code)) between 1 and 40),
  location_type text not null default 'warehouse'
    check (location_type in ('warehouse', 'storefront', 'truck', 'bin', 'consignment')),
  address text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create index if not exists idx_inventory_locations_workspace
  on public.inventory_locations (workspace_id, is_active, is_default desc);

-- 4. Per-Location Inventory Balances (mutated ONLY via atomic RPCs)
create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid default auth.uid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  on_hand_qty integer not null default 0,
  reserved_qty integer not null default 0 check (reserved_qty >= 0),
  incoming_qty integer not null default 0 check (incoming_qty >= 0),
  last_counted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, item_id, location_id)
);

create index if not exists idx_inventory_balances_ws_item
  on public.inventory_balances (workspace_id, item_id);

create index if not exists idx_inventory_balances_ws_location
  on public.inventory_balances (workspace_id, location_id);

-- 5. Extend public.inventory_movements additively for Immutable Stock Ledger
alter table public.inventory_movements
  add column if not exists owner_id uuid default auth.uid(),
  add column if not exists location_id uuid references public.inventory_locations(id) on delete set null,
  add column if not exists movement_type text,
  add column if not exists qty_delta integer,
  add column if not exists unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  add column if not exists reference_type text,
  add column if not exists reference_id text,
  add column if not exists lot_or_serial text,
  add column if not exists notes text,
  add column if not exists idempotency_key text;

create unique index if not exists idx_inventory_movements_ws_idempotency
  on public.inventory_movements (workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_inventory_movements_ws_location_created
  on public.inventory_movements (workspace_id, location_id, created_at desc);

-- 6. Cycle Count & Physical Inventory Audits (Human-in-the-Loop Approval Gate)
create table if not exists public.inventory_audits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid default auth.uid(),
  location_id uuid references public.inventory_locations(id) on delete set null,
  audit_number text not null check (length(trim(audit_number)) between 1 and 60),
  title text not null check (length(trim(title)) between 1 and 200),
  audit_type text not null default 'cycle_count'
    check (audit_type in ('cycle_count', 'full_physical', 'spot_check', 'grn_reconcile')),
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'pending_approval', 'reconciled', 'cancelled')),
  total_expected_qty integer not null default 0,
  total_counted_qty integer not null default 0,
  total_variance_qty integer not null default 0,
  total_variance_cents bigint not null default 0,
  notes text,
  submitted_at timestamptz,
  approved_by uuid,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, audit_number)
);

create index if not exists idx_inventory_audits_ws_status
  on public.inventory_audits (workspace_id, status, created_at desc);

-- 7. Cycle Count Audit Lines (Integer-Cent Variance Valuation)
create table if not exists public.inventory_audit_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid default auth.uid(),
  audit_id uuid not null references public.inventory_audits(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid references public.inventory_locations(id) on delete set null,
  expected_qty integer not null default 0,
  counted_qty integer not null default 0,
  variance_qty integer generated always as (counted_qty - expected_qty) stored,
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  variance_cents bigint generated always as ((counted_qty - expected_qty)::bigint * unit_cost_cents) stored,
  reason_code text not null default 'unexplained'
    check (reason_code in (
      'matched',
      'shrinkage',
      'damage',
      'receiving_error',
      'misplaced',
      'vendor_shortage',
      'unexplained'
    )),
  notes text,
  scanned_barcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, item_id)
);

create index if not exists idx_inventory_audit_lines_audit
  on public.inventory_audit_lines (workspace_id, audit_id);

-- 8. Autonomous Reorder Draft Queue (Staged for 1-Tap Owner Approval)
create table if not exists public.inventory_reorder_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid default auth.uid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid references public.inventory_locations(id) on delete set null,
  vendor_name text not null check (length(trim(vendor_name)) between 1 and 200),
  suggested_qty integer not null check (suggested_qty > 0),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  estimated_total_cents bigint generated always as (suggested_qty::bigint * unit_cost_cents) stored,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'converted_to_po', 'dismissed')),
  source text not null default 'low_stock_engine'
    check (source in ('low_stock_engine', 'audit_reconcile', 'mcp_bot', 'manual')),
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  po_id uuid references public.purchase_orders(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_reorder_drafts_ws_status
  on public.inventory_reorder_drafts (workspace_id, status, created_at desc);

create unique index if not exists idx_inventory_reorder_drafts_idempotency
  on public.inventory_reorder_drafts (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- 9. Strict Multi-Tenant Row-Level Security on All New Tables
alter table public.inventory_locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_audits enable row level security;
alter table public.inventory_audit_lines enable row level security;
alter table public.inventory_reorder_drafts enable row level security;

-- Enforce append-only / RPC-only mutations on inventory_balances
revoke insert, update, delete on table public.inventory_balances from public, anon, authenticated;
grant select on table public.inventory_balances to authenticated;

do $$
begin
  -- inventory_locations policies
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_locations' and policyname = 'inventory_locations_owner_all'
  ) then
    create policy inventory_locations_owner_all on public.inventory_locations
      for all to authenticated
      using (public.is_workspace_owner(workspace_id))
      with check (public.is_workspace_owner(workspace_id));
  end if;

  -- inventory_balances read-only owner policy (writes flow strictly via atomic RPCs)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_balances' and policyname = 'inventory_balances_owner_select'
  ) then
    create policy inventory_balances_owner_select on public.inventory_balances
      for select to authenticated
      using (public.is_workspace_owner(workspace_id));
  end if;

  -- inventory_audits policies
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_audits' and policyname = 'inventory_audits_owner_all'
  ) then
    create policy inventory_audits_owner_all on public.inventory_audits
      for all to authenticated
      using (public.is_workspace_owner(workspace_id))
      with check (public.is_workspace_owner(workspace_id));
  end if;

  -- inventory_audit_lines policies
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_audit_lines' and policyname = 'inventory_audit_lines_owner_all'
  ) then
    create policy inventory_audit_lines_owner_all on public.inventory_audit_lines
      for all to authenticated
      using (public.is_workspace_owner(workspace_id))
      with check (public.is_workspace_owner(workspace_id));
  end if;

  -- inventory_reorder_drafts policies
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_reorder_drafts' and policyname = 'inventory_reorder_drafts_owner_all'
  ) then
    create policy inventory_reorder_drafts_owner_all on public.inventory_reorder_drafts
      for all to authenticated
      using (public.is_workspace_owner(workspace_id))
      with check (public.is_workspace_owner(workspace_id));
  end if;
end $$;

-- ============================================================================
-- 10. ATOMIC RPC 1: record_inventory_movement_atomic
-- Appends an immutable row to inventory_movements, atomically updates
-- inventory_balances and inventory_items.on_hand_qty, and enforces idempotency.
-- ============================================================================
create or replace function public.record_inventory_movement_atomic(
  p_workspace_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_qty_delta integer,
  p_unit_cost_cents bigint default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_lot_or_serial text default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
  v_location_id uuid;
  v_balance public.inventory_balances%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_new_loc_qty integer;
  v_total_on_hand integer;
  v_unit_cost bigint;
  v_legacy_kind text;
  v_movement_id uuid;
begin
  if not (auth.role() = 'service_role' or public.is_workspace_owner(p_workspace_id)) then
    raise exception 'forbidden: workspace owner or service role required';
  end if;

  if p_movement_type not in (
    'receive',
    'sale_deduct',
    'transfer_in',
    'transfer_out',
    'audit_adjustment',
    'return_restock',
    'damage_writeoff',
    'initial_load'
  ) then
    raise exception 'invalid movement_type: %', p_movement_type;
  end if;

  if p_qty_delta = 0 then
    raise exception 'qty_delta cannot be zero';
  end if;

  -- Idempotency check
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select *
      into v_existing
      from public.inventory_movements
     where workspace_id = p_workspace_id
       and idempotency_key = trim(p_idempotency_key)
     limit 1;

    if found then
      return jsonb_build_object(
        'status', 'idempotent_replay',
        'movement_id', v_existing.id,
        'item_id', v_existing.item_id,
        'location_id', v_existing.location_id,
        'qty_delta', coalesce(v_existing.qty_delta, v_existing.quantity::integer),
        'balance_after', v_existing.balance::integer
      );
    end if;
  end if;

  -- Lock item row
  select *
    into v_item
    from public.inventory_items
   where id = p_item_id
     and workspace_id = p_workspace_id
     for update;

  if not found then
    raise exception 'inventory item not found in workspace';
  end if;

  -- Resolve or auto-create default location if none supplied
  v_location_id := p_location_id;
  if v_location_id is null then
    select id
      into v_location_id
      from public.inventory_locations
     where workspace_id = p_workspace_id
       and is_default = true
       and is_active = true
     limit 1;

    if v_location_id is null then
      insert into public.inventory_locations (
        workspace_id, owner_id, name, code, location_type, is_default, is_active
      )
      values (
        p_workspace_id, auth.uid(), 'Main Warehouse', 'MAIN', 'warehouse', true, true
      )
      on conflict (workspace_id, code) do update set is_default = true
      returning id into v_location_id;
    end if;
  else
    perform 1
      from public.inventory_locations
     where id = v_location_id
       and workspace_id = p_workspace_id;
    if not found then
      raise exception 'inventory location not found in workspace';
    end if;
  end if;

  -- Lock or initialize per-location balance row
  insert into public.inventory_balances (
    workspace_id, owner_id, item_id, location_id, on_hand_qty, reserved_qty, incoming_qty
  )
  values (
    p_workspace_id, auth.uid(), p_item_id, v_location_id, 0, 0, 0
  )
  on conflict (workspace_id, item_id, location_id) do nothing;

  select *
    into v_balance
    from public.inventory_balances
   where workspace_id = p_workspace_id
     and item_id = p_item_id
     and location_id = v_location_id
     for update;

  v_new_loc_qty := v_balance.on_hand_qty + p_qty_delta;
  if v_new_loc_qty < 0 then
    raise exception 'insufficient stock at location: current %, delta %', v_balance.on_hand_qty, p_qty_delta;
  end if;

  update public.inventory_balances
     set on_hand_qty = v_new_loc_qty,
         last_counted_at = case when p_movement_type = 'audit_adjustment' then now() else last_counted_at end,
         updated_at = now()
   where id = v_balance.id;

  -- Recalculate aggregate item on_hand_qty across all locations
  select coalesce(sum(on_hand_qty), 0)::integer
    into v_total_on_hand
    from public.inventory_balances
   where workspace_id = p_workspace_id
     and item_id = p_item_id;

  v_unit_cost := coalesce(p_unit_cost_cents, v_item.unit_cost_cents, 0);

  update public.inventory_items
     set on_hand_qty = greatest(0, v_total_on_hand),
         unit_cost_cents = case when p_unit_cost_cents is not null and p_unit_cost_cents >= 0 then p_unit_cost_cents else unit_cost_cents end,
         updated_at = now()
   where id = p_item_id
     and workspace_id = p_workspace_id;

  -- Map Mission 12 movement_type to legacy inventory_movements.kind check constraint
  v_legacy_kind := case p_movement_type
    when 'receive' then 'receipt'
    when 'initial_load' then 'receipt'
    when 'return_restock' then 'return'
    when 'sale_deduct' then 'consume'
    else 'adjustment'
  end;

  insert into public.inventory_movements (
    workspace_id,
    owner_id,
    item_id,
    location_id,
    kind,
    movement_type,
    quantity,
    qty_delta,
    balance,
    unit_cost_cents,
    reason,
    reference_type,
    reference_id,
    lot_or_serial,
    notes,
    idempotency_key,
    actor_id
  )
  values (
    p_workspace_id,
    auth.uid(),
    p_item_id,
    v_location_id,
    v_legacy_kind,
    p_movement_type,
    p_qty_delta,
    p_qty_delta,
    v_new_loc_qty,
    v_unit_cost,
    coalesce(nullif(trim(p_notes), ''), p_movement_type),
    p_reference_type,
    p_reference_id,
    p_lot_or_serial,
    p_notes,
    nullif(trim(p_idempotency_key), ''),
    auth.uid()
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'status', 'recorded',
    'movement_id', v_movement_id,
    'item_id', p_item_id,
    'location_id', v_location_id,
    'movement_type', p_movement_type,
    'qty_delta', p_qty_delta,
    'location_on_hand_qty', v_new_loc_qty,
    'total_on_hand_qty', v_total_on_hand,
    'unit_cost_cents', v_unit_cost
  );
end;
$$;

-- ============================================================================
-- 11. ATOMIC RPC 2: transfer_inventory_atomic
-- Atomically moves stock between two locations in a single transaction,
-- writing paired transfer_out + transfer_in rows to inventory_movements.
-- ============================================================================
create or replace function public.transfer_inventory_atomic(
  p_workspace_id uuid,
  p_item_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_qty integer,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out_result jsonb;
  v_in_result jsonb;
  v_base_key text;
  v_transfer_ref text;
begin
  if not (auth.role() = 'service_role' or public.is_workspace_owner(p_workspace_id)) then
    raise exception 'forbidden: workspace owner or service role required';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'transfer quantity must be a positive integer';
  end if;

  if p_from_location_id is null or p_to_location_id is null or p_from_location_id = p_to_location_id then
    raise exception 'source and destination locations must be distinct';
  end if;

  v_base_key := nullif(trim(p_idempotency_key), '');
  v_transfer_ref := coalesce(v_base_key, gen_random_uuid()::text);

  v_out_result := public.record_inventory_movement_atomic(
    p_workspace_id => p_workspace_id,
    p_item_id => p_item_id,
    p_location_id => p_from_location_id,
    p_movement_type => 'transfer_out',
    p_qty_delta => -p_qty,
    p_unit_cost_cents => null,
    p_reference_type => 'transfer',
    p_reference_id => v_transfer_ref,
    p_lot_or_serial => null,
    p_notes => coalesce(p_notes, 'Stock transfer out'),
    p_idempotency_key => case when v_base_key is not null then v_base_key || ':out' else null end
  );

  v_in_result := public.record_inventory_movement_atomic(
    p_workspace_id => p_workspace_id,
    p_item_id => p_item_id,
    p_location_id => p_to_location_id,
    p_movement_type => 'transfer_in',
    p_qty_delta => p_qty,
    p_unit_cost_cents => null,
    p_reference_type => 'transfer',
    p_reference_id => v_transfer_ref,
    p_lot_or_serial => null,
    p_notes => coalesce(p_notes, 'Stock transfer in'),
    p_idempotency_key => case when v_base_key is not null then v_base_key || ':in' else null end
  );

  return jsonb_build_object(
    'status', 'transferred',
    'transfer_ref', v_transfer_ref,
    'qty', p_qty,
    'out', v_out_result,
    'in', v_in_result
  );
end;
$$;

-- ============================================================================
-- 12. ATOMIC RPC 3: approve_and_reconcile_audit_atomic
-- Owner-approved cycle count reconciliation: posts audit_adjustment rows
-- to inventory_movements for every non-zero variance line, updates balances,
-- marks audit reconciled, and logs an executed entry in agent_action_ledger.
-- ============================================================================
create or replace function public.approve_and_reconcile_audit_atomic(
  p_audit_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_audit public.inventory_audits%rowtype;
  v_line record;
  v_lines_adjusted integer := 0;
  v_total_expected integer := 0;
  v_total_counted integer := 0;
  v_total_var_qty integer := 0;
  v_total_var_cents bigint := 0;
  v_move_res jsonb;
  v_line_key text;
begin
  select *
    into v_audit
    from public.inventory_audits
   where id = p_audit_id
     for update;

  if not found then
    raise exception 'inventory audit not found';
  end if;

  if not (auth.role() = 'service_role' or public.is_workspace_owner(v_audit.workspace_id)) then
    raise exception 'forbidden: workspace owner or service role required';
  end if;

  if v_audit.status = 'reconciled' then
    return jsonb_build_object(
      'status', 'already_reconciled',
      'audit_id', v_audit.id,
      'audit_number', v_audit.audit_number,
      'total_variance_qty', v_audit.total_variance_qty,
      'total_variance_cents', v_audit.total_variance_cents
    );
  end if;

  if v_audit.status = 'cancelled' then
    raise exception 'cannot reconcile a cancelled audit';
  end if;

  for v_line in
    select *
      from public.inventory_audit_lines
     where audit_id = v_audit.id
       and workspace_id = v_audit.workspace_id
     order by created_at asc
  loop
    v_total_expected := v_total_expected + v_line.expected_qty;
    v_total_counted := v_total_counted + v_line.counted_qty;
    v_total_var_qty := v_total_var_qty + v_line.variance_qty;
    v_total_var_cents := v_total_var_cents + v_line.variance_cents;

    if v_line.variance_qty <> 0 then
      v_line_key := coalesce(nullif(trim(p_idempotency_key), ''), 'audit:' || v_audit.id::text) || ':' || v_line.id::text;

      v_move_res := public.record_inventory_movement_atomic(
        p_workspace_id => v_audit.workspace_id,
        p_item_id => v_line.item_id,
        p_location_id => coalesce(v_line.location_id, v_audit.location_id),
        p_movement_type => 'audit_adjustment',
        p_qty_delta => v_line.variance_qty,
        p_unit_cost_cents => v_line.unit_cost_cents,
        p_reference_type => 'inventory_audit',
        p_reference_id => v_audit.id::text,
        p_lot_or_serial => null,
        p_notes => 'Audit ' || v_audit.audit_number || ' (' || v_line.reason_code || ')' || coalesce(': ' || v_line.notes, ''),
        p_idempotency_key => v_line_key
      );

      v_lines_adjusted := v_lines_adjusted + 1;
    end if;
  end loop;

  update public.inventory_audits
     set status = 'reconciled',
         total_expected_qty = v_total_expected,
         total_counted_qty = v_total_counted,
         total_variance_qty = v_total_var_qty,
         total_variance_cents = v_total_var_cents,
         approved_by = auth.uid(),
         reconciled_at = now(),
         updated_at = now()
   where id = v_audit.id;

  -- Record immutable executive audit trail in agent_action_ledger if table exists
  if to_regclass('public.agent_action_ledger') is not null then
    insert into public.agent_action_ledger (
      workspace_id,
      action_type,
      status,
      summary,
      amount_cents,
      payload
    )
    values (
      v_audit.workspace_id,
      'inventory_audit_reconciled',
      'executed',
      'Reconciled ' || v_audit.audit_number || ': ' || v_lines_adjusted || ' SKU(s) adjusted (variance ' || v_total_var_qty || ' units)',
      abs(v_total_var_cents),
      jsonb_build_object(
        'audit_id', v_audit.id,
        'audit_number', v_audit.audit_number,
        'lines_adjusted', v_lines_adjusted,
        'total_variance_qty', v_total_var_qty,
        'total_variance_cents', v_total_var_cents
      )
    );
  end if;

  return jsonb_build_object(
    'status', 'reconciled',
    'audit_id', v_audit.id,
    'audit_number', v_audit.audit_number,
    'lines_adjusted', v_lines_adjusted,
    'total_expected_qty', v_total_expected,
    'total_counted_qty', v_total_counted,
    'total_variance_qty', v_total_var_qty,
    'total_variance_cents', v_total_var_cents
  );
end;
$$;

-- ============================================================================
-- 13. ATOMIC RPC 4: reconcile_grn_to_inventory_atomic
-- Posts received Goods Receipt (GRN) line items directly into inventory_movements
-- and inventory_balances atomically with full idempotency per GRN + SKU.
-- ============================================================================
create or replace function public.reconcile_grn_to_inventory_atomic(
  p_workspace_id uuid,
  p_goods_receipt_id uuid,
  p_location_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grn public.goods_receipts%rowtype;
  v_entry jsonb;
  v_sku text;
  v_received_qty integer;
  v_item public.inventory_items%rowtype;
  v_items_posted integer := 0;
  v_units_posted integer := 0;
  v_base_key text;
begin
  if not (auth.role() = 'service_role' or public.is_workspace_owner(p_workspace_id)) then
    raise exception 'forbidden: workspace owner or service role required';
  end if;

  select *
    into v_grn
    from public.goods_receipts
   where id = p_goods_receipt_id
     and workspace_id = p_workspace_id
     for update;

  if not found then
    raise exception 'goods receipt not found in workspace';
  end if;

  v_base_key := coalesce(nullif(trim(p_idempotency_key), ''), 'grn:' || v_grn.id::text);

  for v_entry in
    select value from jsonb_array_elements(coalesce(v_grn.items_json, '[]'::jsonb))
  loop
    v_sku := upper(trim(coalesce(v_entry->>'sku', '')));
    v_received_qty := coalesce((v_entry->>'received_qty')::integer, 0);

    if length(v_sku) > 0 and v_received_qty > 0 then
      select *
        into v_item
        from public.inventory_items
       where workspace_id = p_workspace_id
         and upper(sku) = v_sku
       limit 1;

      if found then
        perform public.record_inventory_movement_atomic(
          p_workspace_id => p_workspace_id,
          p_item_id => v_item.id,
          p_location_id => p_location_id,
          p_movement_type => 'receive',
          p_qty_delta => v_received_qty,
          p_unit_cost_cents => v_item.unit_cost_cents,
          p_reference_type => 'goods_receipt',
          p_reference_id => v_grn.id::text,
          p_lot_or_serial => null,
          p_notes => 'GRN-' || left(v_grn.id::text, 8) || ' received SKU ' || v_sku,
          p_idempotency_key => v_base_key || ':' || v_sku
        );
        v_items_posted := v_items_posted + 1;
        v_units_posted := v_units_posted + v_received_qty;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'reconciled',
    'goods_receipt_id', v_grn.id,
    'receipt_number', 'GRN-' || left(v_grn.id::text, 8),
    'items_posted', v_items_posted,
    'units_posted', v_units_posted
  );
end;
$$;

-- 14. Restrict RPC execution to authenticated users & service_role only
revoke all on function public.record_inventory_movement_atomic(uuid, uuid, uuid, text, integer, bigint, text, text, text, text, text) from public, anon;
grant execute on function public.record_inventory_movement_atomic(uuid, uuid, uuid, text, integer, bigint, text, text, text, text, text) to authenticated, service_role;

revoke all on function public.transfer_inventory_atomic(uuid, uuid, uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.transfer_inventory_atomic(uuid, uuid, uuid, uuid, integer, text, text) to authenticated, service_role;

revoke all on function public.approve_and_reconcile_audit_atomic(uuid, text) from public, anon;
grant execute on function public.approve_and_reconcile_audit_atomic(uuid, text) to authenticated, service_role;

revoke all on function public.reconcile_grn_to_inventory_atomic(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.reconcile_grn_to_inventory_atomic(uuid, uuid, uuid, text) to authenticated, service_role;
