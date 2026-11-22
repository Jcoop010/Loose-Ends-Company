-- Shadow Mode v1: Zero-Migration Onboarding & Deterministic Leak Engine

-- 1. public.shadow_sessions
create table if not exists public.shadow_sessions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  source_system    text not null check (source_system in ('quickbooks', 'zoho', 'stripe', 'generic')),
  file_name        text not null,
  row_count        integer not null default 0 check (row_count >= 0),
  total_leak_cents integer not null default 0 check (total_leak_cents >= 0),
  status           text not null default 'analyzing' check (
    status in ('analyzing', 'ready', 'promoted', 'archived')
  ),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists shadow_sessions_workspace_created_idx
  on public.shadow_sessions (workspace_id, created_at desc);

create index if not exists shadow_sessions_workspace_status_idx
  on public.shadow_sessions (workspace_id, status);

-- 2. public.shadow_findings
create table if not exists public.shadow_findings (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  session_id    uuid not null references public.shadow_sessions(id) on delete cascade,
  category      text not null check (
    category in ('unbilled_quote', 'overdue_ar', 'duplicate_vendor_charge', 'recurring_creep')
  ),
  counterparty  text not null,
  amount_cents  integer not null check (amount_cents >= 0),
  proof_summary text not null default '',
  evidence_json jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (
    status in ('open', 'dismissed', 'promoted')
  ),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shadow_findings_session_status_idx
  on public.shadow_findings (session_id, status, amount_cents desc);

create index if not exists shadow_findings_workspace_status_idx
  on public.shadow_findings (workspace_id, status, category);

-- 3. Strict Workspace-Owner RLS on Shadow Mode Tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['shadow_sessions', 'shadow_findings'] loop
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
