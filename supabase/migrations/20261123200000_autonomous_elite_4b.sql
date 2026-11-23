-- Release 4B: Operations Compiler (executable_sops) & Vendor Fraud Shield (vendor_fraud_alerts)

-- 1. public.executable_sops
create table if not exists public.executable_sops (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces(id) on delete cascade,
  name                        text not null,
  plain_english_prompt        text not null,
  compiled_rule_json          jsonb not null default '{}'::jsonb,
  status                      text not null default 'draft' check (
    status in ('draft', 'active', 'paused')
  ),
  safety_cap_cents            integer not null default 100000 check (safety_cap_cents >= 0),
  last_simulated_impact_cents integer not null default 0 check (last_simulated_impact_cents >= 0),
  run_count                   integer not null default 0 check (run_count >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists executable_sops_workspace_created_idx
  on public.executable_sops (workspace_id, created_at desc);

create index if not exists executable_sops_workspace_status_idx
  on public.executable_sops (workspace_id, status);

-- 2. public.vendor_fraud_alerts
create table if not exists public.vendor_fraud_alerts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  bill_id        uuid references public.vendor_bills(id) on delete set null,
  vendor_name    text not null,
  alert_type     text not null check (
    alert_type in ('price_spike_over_10pct', 'duplicate_cent_amount', 'remit_change')
  ),
  variance_cents integer not null default 0 check (variance_cents >= 0),
  proof_summary  text not null default '',
  status         text not null default 'frozen' check (
    status in ('frozen', 'approved_override', 'dismissed')
  ),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists vendor_fraud_alerts_workspace_created_idx
  on public.vendor_fraud_alerts (workspace_id, created_at desc);

create index if not exists vendor_fraud_alerts_workspace_status_idx
  on public.vendor_fraud_alerts (workspace_id, status);

create index if not exists vendor_fraud_alerts_workspace_bill_idx
  on public.vendor_fraud_alerts (workspace_id, bill_id);

-- 3. Strict Workspace-Owner RLS on Release 4B Tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['executable_sops', 'vendor_fraud_alerts'] loop
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
