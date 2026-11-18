-- ============================================================================
-- Migration: 20261118120000_create_public_leads.sql
-- Purpose  : Upgrade existing public.public_leads table (originally created for
--            landing page audit requests) to support the full SMB scouting &
--            owner-gated outreach draft pipeline in public.ops_communication_drafts.
-- Safe to run against production https://uehfvpnnoitgybsmdgef.supabase.co
-- whether public.public_leads already exists or is being created fresh.
-- ============================================================================

-- 1. Create base table if it does not yet exist
create table if not exists public.public_leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default 'Owner / Operations',
  business        text not null,
  phone           text,
  email           text,
  business_type   text,
  biggest_problem text,
  created_at      timestamptz not null default now()
);

-- 2. Upgrade existing public.public_leads columns & constraints idempotently
alter table public.public_leads
  alter column name set default 'Owner / Operations',
  alter column phone drop not null,
  alter column email drop not null,
  add column if not exists workspace_id  uuid references public.workspaces(id) on delete set null,
  add column if not exists industry      text,
  add column if not exists location      text,
  add column if not exists contact_name  text,
  add column if not exists contact_email text,
  add column if not exists website       text,
  add column if not exists notes         text,
  add column if not exists status        text not null default 'DRAFT_READY',
  add column if not exists score         integer,
  add column if not exists updated_at    timestamptz not null default now();

-- Add generated company_name alias column if not already present
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'public_leads'
      and column_name  = 'company_name'
  ) then
    alter table public.public_leads
      add column company_name text generated always as (business) stored;
  end if;
end $$;

-- 3. Ensure status and score check constraints match the full pipeline lifecycle
alter table public.public_leads
  drop constraint if exists public_leads_status_check,
  add constraint public_leads_status_check
    check (status in (
      'DRAFT_READY',
      'DRAFT_GENERATED',
      'OWNER_APPROVED',
      'CONTACTED',
      'DEMO_SCHEDULED',
      'PILOT_SOLD',
      'LOST'
    ));

alter table public.public_leads
  drop constraint if exists public_leads_score_check,
  add constraint public_leads_score_check
    check (score is null or (score between 0 and 100));

-- 4. Deduplicate any legacy rows sharing the same business name before adding unique constraint
delete from public.public_leads a
using public.public_leads b
where a.ctid < b.ctid
  and a.business = b.business;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.public_leads'::regclass
      and conname  = 'public_leads_business_key'
  ) then
    alter table public.public_leads
      add constraint public_leads_business_key unique (business);
  end if;
end $$;

create index if not exists public_leads_status_score_idx
  on public.public_leads (status, score desc);

create index if not exists public_leads_workspace_idx
  on public.public_leads (workspace_id)
  where workspace_id is not null;

-- 5. Extend public.ops_communication_drafts for outbound prospect drafts
alter table public.ops_communication_drafts
  alter column customer_id drop not null,
  add column if not exists lead_id           uuid references public.public_leads(id) on delete set null,
  add column if not exists recipient_email   text,
  add column if not exists recipient_name    text,
  add column if not exists company_name      text,
  add column if not exists requires_approval boolean not null default true;

create unique index if not exists ops_drafts_lead_id_unique_idx
  on public.ops_communication_drafts (lead_id)
  where lead_id is not null;

-- 6. Extend customer_contact_consent_events for direct email suppression checks
alter table public.customer_contact_consent_events
  add column if not exists email  text,
  add column if not exists status text;

create index if not exists consent_events_email_idx
  on public.customer_contact_consent_events (email)
  where email is not null;

-- 7. Auto-update updated_at trigger on public.public_leads
create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker
set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'public_leads_updated_at'
  ) then
    create trigger public_leads_updated_at
      before update on public.public_leads
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 8. Row-Level Security & Grants on public.public_leads
alter table public.public_leads enable row level security;

grant insert on table public.public_leads to anon;
grant select, insert, update on table public.public_leads to authenticated;

drop policy if exists "anon can insert leads" on public.public_leads;
create policy "anon can insert leads"
  on public.public_leads for insert
  to anon
  with check (true);

drop policy if exists "workspace members can read own leads" on public.public_leads;
create policy "workspace members can read own leads"
  on public.public_leads for select
  to authenticated
  using (
    workspace_id is null
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = public_leads.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists "workspace members can update own leads" on public.public_leads;
create policy "workspace members can update own leads"
  on public.public_leads for update
  to authenticated
  using (
    workspace_id is null
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = public_leads.workspace_id
        and wm.user_id = auth.uid()
    )
  )
  with check (true);
