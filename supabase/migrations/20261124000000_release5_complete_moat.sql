-- ============================================================================
-- Migration: 20261124000000_release5_complete_moat.sql
-- Purpose  : Release 5 Complete Technical Moat — Multi-Entity Switcher
--            (`workspace_entities`), Bank Feed Auto-Reconciliation
--            (`bank_feed_transactions`), Inbox-to-Ledger Bill Captures
--            (`inbound_bill_captures`), and Live Job Margin Tracker
--            (`job_margin_records`), all protected by strict workspace-owner RLS.
-- ============================================================================

-- 1. public.workspace_entities (Multi-Entity Switcher)
create table if not exists public.workspace_entities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legal_name   text not null,
  ein_last4    text not null default '0000' check (length(ein_last4) = 4),
  entity_type  text not null default 'llc' check (entity_type in ('llc', 'scorp', 'ccorp', 'sole_prop')),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists workspace_entities_ws_primary_idx
  on public.workspace_entities (workspace_id, is_primary desc, created_at asc);

-- Idempotently seed 1 primary LLC entity per existing workspace that has no entities yet
insert into public.workspace_entities (
  workspace_id,
  legal_name,
  ein_last4,
  entity_type,
  is_primary
)
select
  w.id,
  case
    when w.name ~* '\b(llc|inc|corp|ltd)\b' then w.name
    else w.name || ' LLC'
  end,
  '4821',
  'llc',
  true
from public.workspaces w
where not exists (
  select 1 from public.workspace_entities we where we.workspace_id = w.id
);

-- 2. public.bank_feed_transactions (Plaid-ready, OFX/QBO, Bank CSV Auto-Reconciliation)
create table if not exists public.bank_feed_transactions (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  entity_id            uuid references public.workspace_entities(id) on delete set null,
  source               text not null default 'bank_csv' check (source in ('plaid_webhook', 'ofx_qbo', 'bank_csv')),
  posted_date          date not null,
  merchant_name        text not null,
  amount_cents         integer not null check (amount_cents >= 0),
  direction            text not null check (direction in ('inflow', 'outflow')),
  matched_record_id    uuid,
  match_confidence_bps integer not null default 0 check (match_confidence_bps between 0 and 10000),
  status               text not null default 'unmatched' check (status in ('unmatched', 'auto_matched', 'reconciled', 'excluded')),
  proof_summary        text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists bank_feed_tx_ws_status_idx
  on public.bank_feed_transactions (workspace_id, status, posted_date desc);

create index if not exists bank_feed_tx_ws_entity_idx
  on public.bank_feed_transactions (workspace_id, entity_id, posted_date desc);

-- 3. public.inbound_bill_captures (Inbox-to-Ledger Parsing & 3-Way Match + Fraud Handoff)
create table if not exists public.inbound_bill_captures (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  entity_id             uuid references public.workspace_entities(id) on delete set null,
  source_address        text not null,
  file_name             text not null,
  vendor_name           text not null,
  extracted_total_cents integer not null check (extracted_total_cents >= 0),
  po_reference          text,
  match_status          text not null default 'needs_review' check (match_status in ('3way_matched', 'fraud_frozen', 'needs_review', 'posted')),
  proof_summary         text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists inbound_bill_captures_ws_status_idx
  on public.inbound_bill_captures (workspace_id, match_status, created_at desc);

create index if not exists inbound_bill_captures_ws_entity_idx
  on public.inbound_bill_captures (workspace_id, entity_id, created_at desc);

-- 4. public.job_margin_records (Live Integer-Cent Job Margin & Change Order Guard)
create table if not exists public.job_margin_records (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  entity_id            uuid references public.workspace_entities(id) on delete set null,
  job_name             text not null,
  client_name          text not null,
  quoted_revenue_cents integer not null check (quoted_revenue_cents >= 0),
  material_po_cents    integer not null default 0 check (material_po_cents >= 0),
  vendor_bill_cents    integer not null default 0 check (vendor_bill_cents >= 0),
  labor_cents          integer not null default 0 check (labor_cents >= 0),
  target_margin_bps    integer not null default 3000 check (target_margin_bps between 0 and 10000),
  status               text not null default 'healthy' check (status in ('healthy', 'margin_warning', 'over_budget')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists job_margin_records_ws_status_idx
  on public.job_margin_records (workspace_id, status, created_at desc);

create index if not exists job_margin_records_ws_entity_idx
  on public.job_margin_records (workspace_id, entity_id, created_at desc);

-- 5. Strict Workspace-Owner RLS on all 4 Release 5 Tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['workspace_entities', 'bank_feed_transactions', 'inbound_bill_captures', 'job_margin_records'] loop
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
