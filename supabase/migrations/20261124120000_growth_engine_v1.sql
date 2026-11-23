-- Growth Engine v1: Public Leak Calculator (`inbound_calculator`), 48h Call Follow-Up Outcomes & RLS

-- 1. Extend public.public_leads for inbound_calculator + call/walk-in follow-up tracking
alter table public.public_leads
  add column if not exists call_outcome text,
  add column if not exists call_followed_up_at timestamptz;

alter table public.public_leads
  drop constraint if exists public_leads_lane_check,
  add constraint public_leads_lane_check
    check (outreach_lane in ('trades_clinics', 'bookkeepers_cpa', 'inbound_calculator')),
  drop constraint if exists public_leads_call_outcome_check,
  add constraint public_leads_call_outcome_check
    check (
      call_outcome is null
      or call_outcome in ('booked_shadow_audit', 'left_voicemail', 'not_interested')
    ),
  drop constraint if exists public_leads_status_check,
  add constraint public_leads_status_check
    check (status in (
      'DRAFT_READY',
      'DRAFT_GENERATED',
      'OWNER_APPROVED',
      'CONTACTED',
      'REPLIED',
      'DEMO_SCHEDULED',
      'PILOT_SOLD',
      'LOST',
      'BOUNCED',
      'UNSUBSCRIBED'
    ));

-- 2. Extend public.ops_communication_drafts lane check to allow inbound_calculator
alter table public.ops_communication_drafts
  drop constraint if exists ops_communication_drafts_lane_check,
  add constraint ops_communication_drafts_lane_check
    check (outreach_lane in ('trades_clinics', 'bookkeepers_cpa', 'inbound_calculator'));

create index if not exists public_leads_lane_created_idx
  on public.public_leads (outreach_lane, created_at desc);

-- 3. Ensure both anonymous /calculator visitors and signed-in testers can submit public_leads safely
alter table public.public_leads enable row level security;

grant insert on table public.public_leads to anon;
grant select, insert, update on table public.public_leads to authenticated;

drop policy if exists "anon can insert leads" on public.public_leads;
create policy "anon can insert leads"
  on public.public_leads for insert
  to anon
  with check (true);

drop policy if exists "authenticated can insert public leads" on public.public_leads;
create policy "authenticated can insert public leads"
  on public.public_leads for insert
  to authenticated
  with check (
    workspace_id is null
    or public.is_workspace_owner(workspace_id)
  );
