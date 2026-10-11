-- Align seeded workflows with the runner's supported trigger contract.
update public.workflows
set name='Follow up on open opportunities',
    description='Queue a human-reviewed follow-up when an open opportunity changes.',
    trigger_type='record_updated',
    trigger_config=jsonb_build_object('entity_type','opportunities'),
    conditions=jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','open')),
    actions=jsonb_build_array(jsonb_build_object('type','create_follow_up','channel','task','message','Review and follow up on this open opportunity.','delay_hours',0)),
    updated_at=now()
where name='Recover stale opportunities';

update public.workflows
set trigger_type='record_created',
    trigger_config=jsonb_build_object('entity_type','customers'),
    conditions='[]'::jsonb,
    actions=jsonb_build_array(jsonb_build_object('type','create_task','title','Welcome new customer','priority',1,'delay_hours',0)),
    updated_at=now()
where name='Welcome new customers';

update public.workflows
set trigger_type='record_updated',
    trigger_config=jsonb_build_object('entity_type','appointments'),
    conditions=jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','completed')),
    actions=jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up after completed appointment','priority',2,'delay_hours',24)),
    updated_at=now()
where name='Appointment follow-up';

update public.workflows
set trigger_type='record_updated',
    trigger_config=jsonb_build_object('entity_type','documents'),
    conditions=jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','overdue')),
    actions=jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up on overdue invoice','priority',3,'delay_hours',0)),
    updated_at=now()
where name='Overdue invoice alert';

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
    (new.id,'Follow up on open opportunities','Queue a human-reviewed follow-up when an open opportunity changes.',true,'approval','record_updated',jsonb_build_object('entity_type','opportunities'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','open')),jsonb_build_array(jsonb_build_object('type','create_follow_up','channel','task','message','Review and follow up on this open opportunity.','delay_hours',0))),
    (new.id,'Welcome new customers','Create a welcome task when a new customer is added.',true,'automatic','record_created',jsonb_build_object('entity_type','customers'),'[]'::jsonb,jsonb_build_array(jsonb_build_object('type','create_task','title','Welcome new customer','priority',1,'delay_hours',0))),
    (new.id,'Appointment follow-up','Create a task 24 hours after an appointment is marked completed.',true,'approval','record_updated',jsonb_build_object('entity_type','appointments'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','completed')),jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up after completed appointment','priority',2,'delay_hours',24))),
    (new.id,'Overdue invoice alert','Create a task when an invoice is marked overdue.',true,'approval','record_updated',jsonb_build_object('entity_type','documents'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','overdue')),jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up on overdue invoice','priority',3,'delay_hours',0)))
  on conflict do nothing;
  return new;
end;
$function$;
