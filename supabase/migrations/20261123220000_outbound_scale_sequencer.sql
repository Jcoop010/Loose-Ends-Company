-- ============================================================================
-- Migration: 20261123220000_outbound_scale_sequencer.sql
-- Purpose  : Outbound Scale Upgrade — Multi-Inbox Rotation Pool, Automated
--            Day 3 / Day 7 Sequencer columns & unique lead-step index,
--            and le_ops.command support for batch CAN-SPAM approval,
--            follow-up staging, and sequence auto-pausing.
-- ============================================================================

-- 1. public.outbound_sender_inboxes (Multi-Inbox Rotation Pool)
create table if not exists public.outbound_sender_inboxes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  from_name       text not null,
  from_email      text not null unique,
  domain          text not null,
  daily_cap       integer not null default 20 check (daily_cap >= 0 and daily_cap <= 200),
  sent_today      integer not null default 0 check (sent_today >= 0),
  last_reset_date date not null default current_date,
  status          text not null default 'warming' check (status in ('warming', 'active', 'paused')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists outbound_sender_inboxes_ws_status_idx
  on public.outbound_sender_inboxes (workspace_id, status, sent_today asc);

create index if not exists outbound_sender_inboxes_ws_created_idx
  on public.outbound_sender_inboxes (workspace_id, created_at asc);

alter table public.outbound_sender_inboxes enable row level security;
revoke all on table public.outbound_sender_inboxes from public, anon;
grant select, insert, update, delete on table public.outbound_sender_inboxes to authenticated;

drop policy if exists "workspace owners select outbound_sender_inboxes" on public.outbound_sender_inboxes;
create policy "workspace owners select outbound_sender_inboxes"
  on public.outbound_sender_inboxes for select
  to authenticated
  using (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners insert outbound_sender_inboxes" on public.outbound_sender_inboxes;
create policy "workspace owners insert outbound_sender_inboxes"
  on public.outbound_sender_inboxes for insert
  to authenticated
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners update outbound_sender_inboxes" on public.outbound_sender_inboxes;
create policy "workspace owners update outbound_sender_inboxes"
  on public.outbound_sender_inboxes for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace owners delete outbound_sender_inboxes" on public.outbound_sender_inboxes;
create policy "workspace owners delete outbound_sender_inboxes"
  on public.outbound_sender_inboxes for delete
  to authenticated
  using (public.is_workspace_owner(workspace_id));

-- Idempotently seed the primary sender inbox on the earliest workspace (capped at 15/day for primary domain)
insert into public.outbound_sender_inboxes (
  workspace_id,
  from_name,
  from_email,
  domain,
  daily_cap,
  sent_today,
  last_reset_date,
  status
)
select
  w.id,
  'Justin Cooper',
  'justin@looseendsos.app',
  'looseendsos.app',
  15,
  0,
  current_date,
  'active'
from public.workspaces w
order by w.created_at asc
limit 1
on conflict (from_email) do nothing;

-- 2. Extend public.ops_communication_drafts and public.public_leads with lane & sequence tracking
alter table public.ops_communication_drafts
  add column if not exists outreach_lane text not null default 'trades_clinics',
  add column if not exists sequence_step integer not null default 1,
  add column if not exists parent_draft_id uuid references public.ops_communication_drafts(id) on delete set null,
  add column if not exists assigned_sender_id uuid references public.outbound_sender_inboxes(id) on delete set null,
  add column if not exists scheduled_after timestamptz,
  add column if not exists auto_paused_reason text;

alter table public.ops_communication_drafts
  drop constraint if exists ops_communication_drafts_lane_check,
  add constraint ops_communication_drafts_lane_check
    check (outreach_lane in ('trades_clinics', 'bookkeepers_cpa')),
  drop constraint if exists ops_communication_drafts_step_check,
  add constraint ops_communication_drafts_step_check
    check (sequence_step in (1, 2, 3)),
  drop constraint if exists ops_communication_drafts_auto_paused_check,
  add constraint ops_communication_drafts_auto_paused_check
    check (
      auto_paused_reason is null
      or auto_paused_reason in ('replied', 'bounced', 'unsubscribed', 'manual')
    );

-- Allow Day 1 (step 1), Day 3 (step 2), and Day 7 (step 3) drafts per lead without collision
drop index if exists public.ops_drafts_lead_id_unique_idx;
create unique index if not exists ops_drafts_lead_step_unique_idx
  on public.ops_communication_drafts (lead_id, sequence_step)
  where lead_id is not null;

create index if not exists ops_drafts_lane_step_idx
  on public.ops_communication_drafts (workspace_id, status, outreach_lane, sequence_step, created_at desc);

create index if not exists ops_drafts_parent_idx
  on public.ops_communication_drafts (workspace_id, parent_draft_id)
  where parent_draft_id is not null;

alter table public.public_leads
  add column if not exists outreach_lane text not null default 'trades_clinics',
  add column if not exists sequence_step integer not null default 1,
  add column if not exists parent_draft_id uuid references public.ops_communication_drafts(id) on delete set null,
  add column if not exists assigned_sender_id uuid references public.outbound_sender_inboxes(id) on delete set null,
  add column if not exists scheduled_after timestamptz,
  add column if not exists auto_paused_reason text;

alter table public.public_leads
  drop constraint if exists public_leads_lane_check,
  add constraint public_leads_lane_check
    check (outreach_lane in ('trades_clinics', 'bookkeepers_cpa')),
  drop constraint if exists public_leads_step_check,
  add constraint public_leads_step_check
    check (sequence_step in (1, 2, 3)),
  drop constraint if exists public_leads_auto_paused_check,
  add constraint public_leads_auto_paused_check
    check (
      auto_paused_reason is null
      or auto_paused_reason in ('replied', 'bounced', 'unsubscribed', 'manual')
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

-- 3. Extend le_ops.command preserving every existing action + adding sequencer actions
create or replace function le_ops.command(p_workspace uuid,p_action text,p_payload jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
declare
 u uuid:=auth.uid();
 receipt le_ops.receipts;
 ident uuid;
 out jsonb;
 j public.ops_jobs;
 rev integer;
 doc uuid;
 total numeric;
 who uuid;
 cid uuid;
 pol public.ops_policies;
 extra jsonb;
 ap public.appointments;
 d_chan text;
 d_msg text;
 d_email text;
 latest_consent_dec text;
 latest_consent_stat text;
 has_can_spam_footer boolean;
 seq_step integer;
 lane text;
 rec_email text;
 parent_uuid uuid;
 lead_uuid uuid;
 sched_at timestamptz;
 existing_draft_id uuid;
 pause_reason text;
 paused_cnt integer:=0;
 elem jsonb;
 batch_id uuid;
 d_row public.ops_communication_drafts%rowtype;
 d_cust_email text;
 approved_cnt integer:=0;
 skipped_cnt integer:=0;
 draft_ok boolean;
begin
 if u is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=u and role in ('owner','admin')) then raise exception 'Owner or administrator permission required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 or p_key is null or length(p_key) not between 8 and 150 then raise exception 'Invalid command';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,73021));
 select * into receipt from le_ops.receipts where workspace_id=p_workspace and key=p_key;
 if found then if receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Idempotency key reused with different content';end if;return receipt.result;end if;
 if (select count(*) from le_ops.receipts where workspace_id=p_workspace and created_at>now()-interval '1 minute')>=120 then raise exception 'Workspace operation rate limit reached; retry shortly';end if;
 ident:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
 if p_action='coordination_policy' then
 if not exists(select 1 from pg_timezone_names where name=p_payload->>'timezone') then raise exception 'Valid business time zone required';end if;
 insert into public.ops_policies(workspace_id,enabled,coordinate_enabled,timezone,business_start,business_end,business_days,enforce_hours,travel_buffer,industry,updated_by)
 values(p_workspace,coalesce((p_payload->>'enabled')::boolean,false),coalesce((p_payload->>'coordinate_enabled')::boolean,false),p_payload->>'timezone',(p_payload->>'business_start')::time,(p_payload->>'business_end')::time,array(select value::integer from jsonb_array_elements_text(p_payload->'business_days')),coalesce((p_payload->>'enforce_hours')::boolean,false),coalesce((p_payload->>'travel_buffer')::integer,0),coalesce(p_payload->>'industry','general'),u)
 on conflict(workspace_id) do update set enabled=excluded.enabled,coordinate_enabled=excluded.coordinate_enabled,timezone=excluded.timezone,business_start=excluded.business_start,business_end=excluded.business_end,business_days=excluded.business_days,enforce_hours=excluded.enforce_hours,travel_buffer=excluded.travel_buffer,industry=excluded.industry,updated_by=u,updated_at=now();
 if not coalesce((p_payload->>'enabled')::boolean,false) or not coalesce((p_payload->>'coordinate_enabled')::boolean,false) then update public.ops_business_events set status='cancelled',completed_at=now(),error='Owner policy pause' where workspace_id=p_workspace and status='pending';end if;
 elsif p_action='employee_save' then
 who:=(p_payload->>'user_id')::uuid;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=who) then raise exception 'Worker is not a workspace member';end if;
 insert into public.ops_employee_profiles(workspace_id,user_id,display_name,job_title,phone,skills,active) values(p_workspace,who,p_payload->>'display_name',p_payload->>'job_title',p_payload->>'phone',array(select jsonb_array_elements_text(coalesce(p_payload->'skills','[]'))),coalesce((p_payload->>'active')::boolean,true))
 on conflict(workspace_id,user_id) do update set display_name=excluded.display_name,job_title=excluded.job_title,phone=excluded.phone,skills=excluded.skills,active=excluded.active,updated_at=now();ident:=who;
 elsif p_action='availability_save' then
 insert into public.ops_availability(id,workspace_id,user_id,starts_at,ends_at,available,reason) values(ident,p_workspace,(p_payload->>'user_id')::uuid,(p_payload->>'starts_at')::timestamptz,(p_payload->>'ends_at')::timestamptz,coalesce((p_payload->>'available')::boolean,false),p_payload->>'reason');
 elsif p_action='availability_remove' then
 delete from public.ops_availability where workspace_id=p_workspace and id=ident;if not found then raise exception 'Availability not found';end if;
 elsif p_action='estimate_revise' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if j.status not in ('draft','quoted','approved') then raise exception 'Only an unstarted estimate can be revised';end if;
 if exists(select 1 from public.appointments where workspace_id=p_workspace and ops_job_id=ident and status not in ('cancelled','canceled')) then raise exception 'Cancel the booking before revising';end if;
 if coalesce(length(trim(p_payload->>'reason')),0)<5 then raise exception 'Revision reason required';end if;
 update public.ops_jobs set status='draft',labor_total=coalesce((p_payload->>'labor_total')::numeric,labor_total),title=coalesce(nullif(trim(p_payload->>'title'),''),title),approved_at=null,approval_evidence=null,notes=coalesce(notes,'')||E'\nRevision: '||(p_payload->>'reason'),updated_at=now() where id=ident;
 elsif p_action='job_details' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if j.status in ('completed','cancelled') then raise exception 'Job is closed';end if;
 if jsonb_typeof(coalesce(p_payload->'service_details','{}'))<>'object' then raise exception 'Service details must be an object';end if;
 update public.ops_jobs set service_details=coalesce(p_payload->'service_details','{}'),updated_at=now() where id=ident;
 elsif p_action='attachment_add' then
 perform 1 from public.ops_jobs where id=(p_payload->>'job_id')::uuid and workspace_id=p_workspace;if not found then raise exception 'Job unavailable';end if;
 if length(coalesce(p_payload->>'name','')) not between 1 and 200 or length(coalesce(p_payload->>'url',''))>2000 or p_payload->>'url' !~ '^https://' then raise exception 'Use a named HTTPS attachment reference';end if;
 insert into public.ops_job_attachments(id,workspace_id,job_id,name,url) values(ident,p_workspace,(p_payload->>'job_id')::uuid,p_payload->>'name',p_payload->>'url');
 elsif p_action='service_plan_save' then
 if jsonb_typeof(coalesce(p_payload->'template','{}'))<>'object' or jsonb_typeof(coalesce(p_payload->'template'->'checklist','[]'))<>'array' or jsonb_typeof(coalesce(p_payload->'template'->'service_details','{}'))<>'object' then raise exception 'Invalid recurring service template';end if;
 if coalesce((p_payload->'template'->>'labor_total')::numeric,0)<0 or coalesce((p_payload->'template'->>'labor_total')::numeric,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid recurring labor amount';end if;
 if jsonb_array_length(coalesce(p_payload->'template'->'checklist','[]'))>100 then raise exception 'Recurring checklist is too large';end if;
 cid:=nullif(p_payload->>'customer_id','')::uuid;who:=nullif(p_payload->>'assigned_to','')::uuid;
 if cid is not null and not exists(select 1 from public.customers where workspace_id=p_workspace and id=cid) then raise exception 'Customer unavailable';end if;
 if who is not null and not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=who) then raise exception 'Worker unavailable';end if;
 insert into public.ops_service_plans(id,workspace_id,customer_id,title,interval_days,next_due,assigned_to,enabled,template) values(ident,p_workspace,cid,p_payload->>'title',(p_payload->>'interval_days')::integer,(p_payload->>'next_due')::timestamptz,who,coalesce((p_payload->>'enabled')::boolean,true),coalesce(p_payload->'template','{}'));
 elsif p_action='service_plan_toggle' then
 update public.ops_service_plans set enabled=(p_payload->>'enabled')::boolean,updated_at=now() where id=ident and workspace_id=p_workspace;if not found then raise exception 'Service plan not found';end if;
 elsif p_action='booking_update' then
 select * into strict ap from public.appointments where id=ident and workspace_id=p_workspace for update;
 if p_payload->>'status'='cancelled' then
 update public.appointments set status='cancelled',updated_at=now() where id=ident;
 if ap.ops_job_id is not null then update public.ops_jobs set status='approved',updated_at=now() where id=ap.ops_job_id and workspace_id=p_workspace and status='scheduled';end if;
 else
 update public.appointments set starts_at=(p_payload->>'starts_at')::timestamptz,ends_at=(p_payload->>'ends_at')::timestamptz,assigned_worker=nullif(p_payload->>'assigned_worker','')::uuid,status='scheduled',updated_at=now() where id=ident;
 if ap.ops_job_id is not null then update public.ops_jobs set assigned_to=nullif(p_payload->>'assigned_worker','')::uuid,updated_at=now() where workspace_id=p_workspace and id=ap.ops_job_id;end if;
 end if;
 elsif p_action='customer_update' then
 if coalesce(length(trim(p_payload->>'first_name')),0) not between 1 and 100 or length(coalesce(p_payload->>'last_name',''))>100 or length(coalesce(p_payload->>'phone',''))>50 or length(coalesce(p_payload->>'email',''))>320 or length(coalesce(p_payload->>'notes',''))>10000 then raise exception 'Invalid customer fields';end if;
 update public.customers set first_name=trim(p_payload->>'first_name'),last_name=trim(p_payload->>'last_name'),phone=nullif(trim(p_payload->>'phone'),''),email=nullif(trim(p_payload->>'email'),''),notes=p_payload->>'notes',updated_at=now() where workspace_id=p_workspace and id=ident;
 if not found then raise exception 'Customer unavailable';end if;
 elsif p_action='expense_update' then
 update public.ops_expenses set paid=(p_payload->>'paid')::boolean where workspace_id=p_workspace and id=ident;
 if not found then raise exception 'Expense record unavailable';end if;
 elsif p_action='draft_save' then
 cid:=(p_payload->>'customer_id')::uuid;
 if not exists(select 1 from public.customers where id=cid and workspace_id=p_workspace) then raise exception 'Customer unavailable';end if;
 lane:=coalesce(nullif(trim(p_payload->>'outreach_lane'),''),'trades_clinics');
 if lane not in ('trades_clinics','bookkeepers_cpa') then raise exception 'Invalid outreach lane';end if;
 insert into public.ops_communication_drafts(id,workspace_id,customer_id,channel,subject,message,outreach_lane,sequence_step) values(ident,p_workspace,cid,p_payload->>'channel',coalesce(p_payload->>'subject','Customer follow-up'),p_payload->>'message',lane,1);
 elsif p_action='draft_review' then
 if p_payload->>'status' not in ('approved','rejected') then raise exception 'Invalid draft decision';end if;
 select customer_id,channel,message,recipient_email into strict cid,d_chan,d_msg,d_email from public.ops_communication_drafts where workspace_id=p_workspace and id=ident;
 if p_payload->>'status'='approved' then
   latest_consent_dec:=null;
   latest_consent_stat:=null;
   if cid is not null then
     select x.decision,x.status into latest_consent_dec,latest_consent_stat
     from public.customer_contact_consent_events x
     where x.workspace_id=p_workspace and x.customer_id=cid and x.channel=d_chan
     order by x.created_at desc,x.id desc limit 1;
   end if;
   if latest_consent_dec='revoked' or coalesce(latest_consent_stat,'') in ('opted_out','revoked') then
     raise exception 'Customer channel consent is revoked or opted out before draft approval';
   end if;
   if nullif(trim(coalesce(d_email,'')),'') is not null and exists(
     select 1 from public.customer_contact_consent_events x
     where x.workspace_id=p_workspace
       and lower(trim(coalesce(x.email,'')))=lower(trim(d_email))
       and (x.decision='revoked' or coalesce(x.status,'') in ('opted_out','revoked'))
   ) then
     raise exception 'Recipient email is opted out / suppressed before draft approval';
   end if;
   if d_chan='email' then
     has_can_spam_footer:=
       position('421 hill street, parkersburg, wv 26104' in regexp_replace(lower(coalesce(d_msg,'')),'\s+',' ','g'))>0
       and coalesce(d_msg,'') ~* '(^|[^a-z])(unsubscribe|opt[- ]?out)([^a-z]|$)';
     if coalesce(latest_consent_dec,'')<>'granted' and not has_can_spam_footer then
       raise exception 'B2B email requires physical address (421 Hill Street, Parkersburg, WV 26104) and unsubscribe/opt-out instruction, or recorded EMAIL opt-in';
     end if;
   else
     if cid is null or coalesce(latest_consent_dec,'')<>'granted' then
       raise exception 'Current channel consent required before draft approval';
     end if;
   end if;
 end if;
 update public.ops_communication_drafts set status=p_payload->>'status',approved_by=u,approved_at=now() where workspace_id=p_workspace and id=ident;
 elsif p_action='draft_stage_followup' then
 seq_step:=coalesce((p_payload->>'sequence_step')::integer,2);
 if seq_step not in (2,3) then raise exception 'Follow-up sequence_step must be 2 or 3';end if;
 lane:=coalesce(nullif(trim(p_payload->>'outreach_lane'),''),'trades_clinics');
 if lane not in ('trades_clinics','bookkeepers_cpa') then raise exception 'Invalid outreach_lane';end if;
 rec_email:=lower(trim(coalesce(p_payload->>'recipient_email','')));
 if rec_email='' or rec_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Valid recipient_email required for follow-up draft';end if;
 d_msg:=coalesce(p_payload->>'message','');
 has_can_spam_footer:=
   position('421 hill street, parkersburg, wv 26104' in regexp_replace(lower(d_msg),'\s+',' ','g'))>0
   and d_msg ~* '(^|[^a-z])(unsubscribe|opt[- ]?out)([^a-z]|$)';
 if not has_can_spam_footer then raise exception 'Follow-up draft missing required CAN-SPAM physical address or opt-out footer';end if;
 cid:=nullif(trim(coalesce(p_payload->>'customer_id','')),'')::uuid;
 if cid is not null and not exists(select 1 from public.customers where id=cid and workspace_id=p_workspace) then raise exception 'Customer unavailable';end if;
 if exists(
   select 1 from public.customer_contact_consent_events x
   where x.workspace_id=p_workspace
     and (
       (cid is not null and x.customer_id=cid and x.channel='email')
       or lower(trim(coalesce(x.email,'')))=rec_email
     )
     and (x.decision='revoked' or coalesce(x.status,'') in ('opted_out','revoked'))
 ) then
   raise exception 'Recipient opted out / suppressed; cannot stage follow-up';
 end if;
 lead_uuid:=nullif(trim(coalesce(p_payload->>'lead_id','')),'')::uuid;
 parent_uuid:=nullif(trim(coalesce(p_payload->>'parent_draft_id','')),'')::uuid;
 sched_at:=nullif(trim(coalesce(p_payload->>'scheduled_after','')),'')::timestamptz;
 if lead_uuid is not null and exists(
   select 1 from public.public_leads l
   where l.id=lead_uuid and (l.auto_paused_reason is not null or l.status in ('REPLIED','BOUNCED','UNSUBSCRIBED'))
 ) then
   out:=jsonb_build_object('id',ident,'confirmed',true,'skipped',true);
 else
   existing_draft_id:=null;
   if lead_uuid is not null then
     select d.id into existing_draft_id from public.ops_communication_drafts d
     where d.workspace_id=p_workspace and d.lead_id=lead_uuid and d.sequence_step=seq_step limit 1;
   end if;
   if existing_draft_id is null and parent_uuid is not null then
     select d.id into existing_draft_id from public.ops_communication_drafts d
     where d.workspace_id=p_workspace and d.parent_draft_id=parent_uuid and d.sequence_step=seq_step limit 1;
   end if;
   if existing_draft_id is not null then
     ident:=existing_draft_id;
     out:=jsonb_build_object('id',ident,'confirmed',true,'skipped',true);
   else
     insert into public.ops_communication_drafts(
       id,workspace_id,customer_id,lead_id,channel,recipient_email,recipient_name,company_name,
       subject,message,status,delivery_status,requires_approval,outreach_lane,sequence_step,
       parent_draft_id,scheduled_after
     ) values (
       ident,p_workspace,cid,lead_uuid,'email',rec_email,
       nullif(trim(coalesce(p_payload->>'recipient_name','')),''),
       nullif(trim(coalesce(p_payload->>'company_name','')),''),
       coalesce(nullif(trim(p_payload->>'subject'),''),'Quick bump'),
       d_msg,'draft','not_sent',true,lane,seq_step,parent_uuid,sched_at
     );
     out:=jsonb_build_object('id',ident,'confirmed',true);
   end if;
 end if;
 elsif p_action='draft_pause_sequence' then
 pause_reason:=p_payload->>'reason';
 if pause_reason not in ('replied','bounced','unsubscribed','manual') then raise exception 'Invalid pause reason';end if;
 lead_uuid:=nullif(trim(coalesce(p_payload->>'lead_id','')),'')::uuid;
 rec_email:=lower(trim(coalesce(p_payload->>'recipient_email','')));
 if lead_uuid is null and rec_email='' then raise exception 'lead_id or recipient_email required';end if;
 update public.ops_communication_drafts
 set status='rejected',auto_paused_reason=pause_reason
 where workspace_id=p_workspace
   and delivery_status='not_sent'
   and status in ('draft','approved')
   and (
     (lead_uuid is not null and lead_id=lead_uuid)
     or (rec_email<>'' and lower(trim(coalesce(recipient_email,'')))=rec_email)
   );
 get diagnostics paused_cnt = row_count;
 if lead_uuid is not null then
   update public.public_leads
   set auto_paused_reason=pause_reason,
       status=case pause_reason
         when 'replied' then 'REPLIED'
         when 'bounced' then 'BOUNCED'
         when 'unsubscribed' then 'UNSUBSCRIBED'
         else status
       end
   where id=lead_uuid and (workspace_id=p_workspace or workspace_id is null);
 end if;
 out:=jsonb_build_object('id',ident,'confirmed',true,'paused_count',paused_cnt);
 elsif p_action='draft_batch_approve' then
 if jsonb_typeof(p_payload->'draft_ids')<>'array' or jsonb_array_length(p_payload->'draft_ids') not between 1 and 50 then
   raise exception 'draft_ids must contain 1 to 50 draft UUIDs';
 end if;
 for elem in select * from jsonb_array_elements(p_payload->'draft_ids') loop
   batch_id:=nullif(trim(elem #>> '{}'),'')::uuid;
   if batch_id is null then skipped_cnt:=skipped_cnt+1; continue; end if;
   select * into d_row from public.ops_communication_drafts
   where workspace_id=p_workspace and id=batch_id and status='draft' and delivery_status='not_sent' and auto_paused_reason is null
   for update;
   if not found then skipped_cnt:=skipped_cnt+1; continue; end if;
   latest_consent_dec:=null;
   latest_consent_stat:=null;
   d_cust_email:=null;
   if d_row.customer_id is not null then
     select email into d_cust_email from public.customers where workspace_id=p_workspace and id=d_row.customer_id;
     select x.decision,x.status into latest_consent_dec,latest_consent_stat
     from public.customer_contact_consent_events x
     where x.workspace_id=p_workspace and x.customer_id=d_row.customer_id and x.channel=d_row.channel
     order by x.created_at desc,x.id desc limit 1;
   end if;
   rec_email:=lower(trim(coalesce(nullif(trim(coalesce(d_row.recipient_email,'')),''),d_cust_email,'')));
   draft_ok:=true;
   if latest_consent_dec='revoked' or coalesce(latest_consent_stat,'') in ('opted_out','revoked') then
     draft_ok:=false;
   end if;
   if draft_ok and rec_email<>'' and exists(
     select 1 from public.customer_contact_consent_events x
     where x.workspace_id=p_workspace
       and lower(trim(coalesce(x.email,'')))=rec_email
       and (x.decision='revoked' or coalesce(x.status,'') in ('opted_out','revoked'))
   ) then
     draft_ok:=false;
   end if;
   if draft_ok and d_row.channel='email' then
     if rec_email='' or rec_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
       draft_ok:=false;
     else
       has_can_spam_footer:=
         position('421 hill street, parkersburg, wv 26104' in regexp_replace(lower(coalesce(d_row.message,'')),'\s+',' ','g'))>0
         and coalesce(d_row.message,'') ~* '(^|[^a-z])(unsubscribe|opt[- ]?out)([^a-z]|$)';
       if coalesce(latest_consent_dec,'')<>'granted' and not has_can_spam_footer then
         draft_ok:=false;
       end if;
     end if;
   elsif draft_ok then
     if d_row.customer_id is null or coalesce(latest_consent_dec,'')<>'granted' then
       draft_ok:=false;
     end if;
   end if;
   if draft_ok then
     update public.ops_communication_drafts set status='approved',approved_by=u,approved_at=now() where workspace_id=p_workspace and id=d_row.id;
     approved_cnt:=approved_cnt+1;
   else
     skipped_cnt:=skipped_cnt+1;
   end if;
 end loop;
 out:=jsonb_build_object('id',ident,'confirmed',true,'approved_count',approved_cnt,'skipped_count',skipped_cnt);
 elsif p_action='business_retry' then
 update public.ops_business_events set status='pending',attempts=0,available_at=now(),error=null where workspace_id=p_workspace and id=ident and status='dead_letter';if not found then raise exception 'Dead-letter event unavailable';end if;
 else
 if p_action in ('reserve_material','release_material') then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace;
 if j.status<>'draft' then raise exception 'Revise the estimate before changing materials';end if;
 end if;
 if p_action='job_update' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace;
 if j.assigned_to is distinct from nullif(p_payload->>'assigned_to','')::uuid and exists(select 1 from public.appointments where workspace_id=p_workspace and ops_job_id=ident and status not in ('cancelled','canceled')) then raise exception 'Update the booking before reassigning this job';end if;
 end if;
 out:=le_ops.command_core(p_workspace,p_action,p_payload,p_key);
 if p_action='job_transition' and p_payload->>'status'='quoted' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace;
 select coalesce(max(revision),0)+1 into rev from public.ops_quote_revisions where job_id=ident;
 select j.labor_total+coalesce(sum(quantity*unit_price),0) into total from public.job_materials where job_id=ident and state='reserved';
 insert into public.documents(workspace_id,customer_id,document_type,document_number,status,total) values(p_workspace,j.customer_id,'quote','EST-'||ident::text||'-R'||rev,'draft',total) returning id into doc;
 insert into public.ops_quote_revisions(workspace_id,job_id,revision,document_id,snapshot,total,actor_id) values(p_workspace,ident,rev,doc,jsonb_build_object('job',to_jsonb(j),'materials',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.job_materials m where job_id=ident),'revision',rev),total,u);
 update public.ops_jobs set revision=rev where id=ident;out:=out||jsonb_build_object('quote_id',doc,'revision',rev);
 update le_ops.receipts set result=out where workspace_id=p_workspace and key=p_key;
 elsif p_action='job_transition' and p_payload->>'status' in ('completed','cancelled') then
 update public.appointments set status=case when p_payload->>'status'='completed' then 'completed' else 'cancelled' end,updated_at=now() where workspace_id=p_workspace and ops_job_id=ident and status not in ('cancelled','canceled','completed');
 elsif p_action='policy_save' and (p_payload->>'enabled') is distinct from 'true' then
 update public.ops_business_events set status='cancelled',completed_at=now(),error='Owner kill switch' where workspace_id=p_workspace and status='pending';
 end if;
 return out;
 end if;
 out:=coalesce(out,jsonb_build_object('id',ident,'confirmed',true));
 insert into le_ops.receipts(workspace_id,key,action,payload,result) values(p_workspace,p_key,p_action,p_payload,out);
 insert into public.ops_audit(workspace_id,actor_id,action,entity_id,details) values(p_workspace,u,p_action,ident,jsonb_build_object('receipt_key',p_key));
 return out;
end$$;
