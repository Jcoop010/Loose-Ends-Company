-- Workflow definitions are readable by workspace members, but only owners/admins can mutate them.
drop policy if exists workflows_member_all on public.workflows;
drop policy if exists workflows_member_select on public.workflows;
drop policy if exists workflows_admin_insert on public.workflows;
drop policy if exists workflows_admin_update on public.workflows;
drop policy if exists workflows_admin_delete on public.workflows;

create policy workflows_member_select on public.workflows
for select to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workflows.workspace_id and wm.user_id = (select auth.uid())
));

create policy workflows_admin_insert on public.workflows
for insert to authenticated
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workflows.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')
));

create policy workflows_admin_update on public.workflows
for update to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workflows.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')
))
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workflows.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')
));

create policy workflows_admin_delete on public.workflows
for delete to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workflows.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')
));

update public.workflows
set trigger_type='record_created',
    trigger_config=jsonb_build_object('entity_type','opportunities'),
    updated_at=now()
where name='Follow up on open opportunities';

create or replace function public.initialize_workspace_saas_state()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.workspace_settings(workspace_id,business_type)
  values(new.id,'Other Small Business')
  on conflict (workspace_id) do nothing;

  insert into public.workspace_subscriptions(workspace_id,plan_key,status,trial_ends_at,current_period_start,current_period_end)
  values(new.id,'trial','trialing',now()+interval '14 days',now(),now()+interval '14 days')
  on conflict (workspace_id) do nothing;

  insert into public.workflows(workspace_id,name,description,enabled,mode,trigger_type,trigger_config,conditions,actions)
  values
    (new.id,'Follow up on open opportunities','Queue a human-reviewed follow-up when a new open opportunity is created.',true,'approval','record_created',jsonb_build_object('entity_type','opportunities'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','open')),jsonb_build_array(jsonb_build_object('type','create_follow_up','channel','task','message','Review and follow up on this open opportunity.','delay_hours',0))),
    (new.id,'Welcome new customers','Create a welcome task when a new customer is added.',true,'automatic','record_created',jsonb_build_object('entity_type','customers'),'[]'::jsonb,jsonb_build_array(jsonb_build_object('type','create_task','title','Welcome new customer','priority',1,'delay_hours',0))),
    (new.id,'Appointment follow-up','Create a task 24 hours after an appointment is marked completed.',true,'approval','record_updated',jsonb_build_object('entity_type','appointments'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','completed')),jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up after completed appointment','priority',2,'delay_hours',24))),
    (new.id,'Overdue invoice alert','Create a task when an invoice is marked overdue.',true,'approval','record_updated',jsonb_build_object('entity_type','documents'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','overdue')),jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up on overdue invoice','priority',3,'delay_hours',0)))
  on conflict do nothing;
  return new;
end;
$function$;
