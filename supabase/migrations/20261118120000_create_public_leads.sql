-- public_leads: inbound lead capture (public demo form) + outbound scouted prospects
-- This table is intentionally accessible via the public (anon) role for the demo form
-- and via authenticated/service_role for the scouting and outreach draft agents.

create table if not exists public.public_leads (
  id              uuid primary key default gen_random_uuid(),
  -- Optional workspace association (null = not yet claimed by any workspace)
  workspace_id    uuid references public.workspaces(id) on delete set null,
  -- Core contact fields (inbound form uses name / business; scouting uses company_name)
  name            text not null default 'Owner / Operations' check (length(trim(name)) between 1 and 200),
  business        text not null check (length(trim(business)) between 1 and 200),
  company_name    text generated always as (business) stored,
  phone           text,
  email           text,
  business_type   text,
  biggest_problem text,
  -- Extended scouting fields (scoutProspects.ts & generateOutreachDrafts.ts populate/read these)
  industry        text,
  location        text,
  contact_name    text,
  contact_email   text,
  website         text,
  notes           text,
  -- Pipeline status lifecycle:
  --   DRAFT_READY -> DRAFT_GENERATED -> OWNER_APPROVED -> CONTACTED -> DEMO_SCHEDULED -> PILOT_SOLD -> LOST
  status          text not null default 'DRAFT_READY'
                    check (status in (
                      'DRAFT_READY',
                      'DRAFT_GENERATED',
                      'OWNER_APPROVED',
                      'CONTACTED',
                      'DEMO_SCHEDULED',
                      'PILOT_SOLD',
                      'LOST'
                    )),
  score           integer check (score between 0 and 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Deduplicate by company name (scout upsert key)
  unique (business)
);

create index if not exists public_leads_status_score_idx
  on public.public_leads (status, score desc);

create index if not exists public_leads_workspace_idx
  on public.public_leads (workspace_id)
  where workspace_id is not null;

-- Extend ops_communication_drafts for pre-customer outbound prospect drafts
alter table public.ops_communication_drafts
  alter column customer_id drop not null,
  add column if not exists lead_id uuid references public.public_leads(id) on delete set null,
  add column if not exists recipient_email text,
  add column if not exists recipient_name text,
  add column if not exists company_name text,
  add column if not exists requires_approval boolean not null default true;

-- Extend customer_contact_consent_events with optional email/status columns for direct email suppression lookup
alter table public.customer_contact_consent_events
  add column if not exists email text,
  add column if not exists status text;

create index if not exists consent_events_email_idx
  on public.customer_contact_consent_events (email)
  where email is not null;

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker
set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

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

-- Anon role: insert only (demo form submissions)
alter table public.public_leads enable row level security;

create policy "anon can insert leads"
  on public.public_leads for insert
  to anon
  with check (true);

-- Authenticated users can read/update leads that belong to their workspace
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

-- Service role (scouting & outreach draft agents) bypasses RLS automatically
