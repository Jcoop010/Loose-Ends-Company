-- Release 4A: Autonomous Collections Engine (collection_touches + strict workspace-owner RLS)

-- 1. public.collection_touches
create table if not exists public.collection_touches (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  stage            text not null check (
    stage in ('day_3_nudge', 'day_10_split_offer', 'day_21_owner_escalation')
  ),
  status           text not null default 'staged' check (
    status in ('staged', 'paused_paid', 'paused_disputed', 'sent', 'reversed')
  ),
  amount_due_cents integer not null default 0 check (amount_due_cents >= 0),
  portal_url       text,
  proof_summary    text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists collection_touches_workspace_created_idx
  on public.collection_touches (workspace_id, created_at desc);

create index if not exists collection_touches_workspace_invoice_stage_idx
  on public.collection_touches (workspace_id, invoice_id, stage);

create index if not exists collection_touches_workspace_status_idx
  on public.collection_touches (workspace_id, status);

-- 2. Strict Workspace-Owner RLS on collection_touches
alter table public.collection_touches enable row level security;
revoke all on table public.collection_touches from public, anon;
grant select, insert, update, delete on table public.collection_touches to authenticated;

drop policy if exists "workspace owners select collection_touches" on public.collection_touches;
create policy "workspace owners select collection_touches"
  on public.collection_touches for select to authenticated
  using (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners insert collection_touches" on public.collection_touches;
create policy "workspace owners insert collection_touches"
  on public.collection_touches for insert to authenticated
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners update collection_touches" on public.collection_touches;
create policy "workspace owners update collection_touches"
  on public.collection_touches for update to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners delete collection_touches" on public.collection_touches;
create policy "workspace owners delete collection_touches"
  on public.collection_touches for delete to authenticated
  using (public.is_workspace_owner(workspace_id));
