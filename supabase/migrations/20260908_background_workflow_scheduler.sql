-- Background workflow scheduler. Runs schedule and record_due automations server-side.
-- Durable DB-native actions: create_task, create_follow_up, update_opportunity.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.workflow_conditions_match(record jsonb, conditions jsonb)
returns boolean language plpgsql immutable as $$
declare c jsonb; value text; expected text; op text;
begin
  for c in select value from jsonb_array_elements(coalesce(conditions,'[]'::jsonb)) loop
    value := record ->> (c ->> 'field'); expected := c ->> 'value'; op := coalesce(c ->> 'operator','equals');
    if op='equals' and coalesce(value,'')<>coalesce(expected,'') then return false; end if;
    if op='not_equals' and coalesce(value,'')=coalesce(expected,'') then return false; end if;
    if op='contains' and position(lower(coalesce(expected,'')) in lower(coalesce(value,'')))=0 then return false; end if;
    if op='exists' and coalesce(value,'')='' then return false; end if;
    if op='gt' and not (coalesce(value,'0')::numeric > coalesce(expected,'0')::numeric) then return false; end if;
    if op='gte' and not (coalesce(value,'0')::numeric >= coalesce(expected,'0')::numeric) then return false; end if;
    if op='lt' and not (coalesce(value,'0')::numeric < coalesce(expected,'0')::numeric) then return false; end if;
    if op='lte' and not (coalesce(value,'0')::numeric <= coalesce(expected,'0')::numeric) then return false; end if;
  end loop; return true;
exception when invalid_text_representation then return false; end $$;

create or replace function public.run_background_workflows()
returns jsonb language plpgsql security definer set search_path=public as $$
declare wf record; rec record; ev_id uuid; run_id uuid; idem text; record_json jsonb; entity text; due_field text; interval_minutes integer; last_schedule timestamptz; action jsonb; patch jsonb; inserted_count integer:=0; executed_count integer:=0; now_ts timestamptz:=now();
begin
  for wf in select * from public.workflows where enabled=true and trigger_type='schedule' loop
    interval_minutes:=greatest(1,coalesce((wf.trigger_config->>'interval_minutes')::integer,60));
    select max(created_at) into last_schedule from public.workflow_events where workspace_id=wf.workspace_id and event_type='schedule' and payload->>'workflow_id'=wf.id::text;
    if last_schedule is null or last_schedule <= now_ts-make_interval(mins=>interval_minutes) then
      insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(wf.workspace_id,'schedule','workflow',wf.id,jsonb_build_object('workflow_id',wf.id,'record',jsonb_build_object())) returning id into ev_id;
      inserted_count:=inserted_count+1;
      if wf.mode='automatic' then
        idem:=ev_id::text||':'||wf.id::text;
        insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'running',idem,jsonb_build_object('event_id',ev_id,'record',jsonb_build_object()),now_ts) on conflict(workflow_id,idempotency_key) do nothing returning id into run_id;
        if run_id is not null then
          for action in select value from jsonb_array_elements(coalesce(wf.actions,'[]'::jsonb)) loop
            if action->>'type'='create_task' then insert into public.tasks(workspace_id,title,status,priority,due_at) values(wf.workspace_id,coalesce(action->>'title','Workflow task'),'open',coalesce((action->>'priority')::numeric,1),now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)));
            elsif action->>'type'='create_follow_up' then insert into public.follow_ups(workspace_id,channel,status,scheduled_at,message) values(wf.workspace_id,coalesce(action->>'channel','task'),'pending',now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)),coalesce(action->>'message','Workflow follow-up'));
            end if;
          end loop;
          update public.workflow_runs set status='completed',result=jsonb_build_object('background',true),completed_at=now() where id=run_id; executed_count:=executed_count+1;
        end if;
      else
        insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'waiting_approval',ev_id::text||':'||wf.id::text,jsonb_build_object('event_id',ev_id,'record',jsonb_build_object()),now_ts) on conflict(workflow_id,idempotency_key) do nothing;
      end if;
    end if;
  end loop;

  for wf in select * from public.workflows where enabled=true and trigger_type='record_due' loop
    entity:=coalesce(wf.trigger_config->>'entity_type','opportunities'); due_field:=coalesce(wf.trigger_config->>'due_field','due_at');
    if entity='opportunities' and due_field='due_at' then
      for rec in select * from public.opportunities where workspace_id=wf.workspace_id and due_at is not null and due_at<=now_ts and due_at>now_ts-interval '10 minutes' loop
        record_json:=to_jsonb(rec); if not public.workflow_conditions_match(record_json,wf.conditions) then continue; end if;
        if exists(select 1 from public.workflow_events e where e.workspace_id=wf.workspace_id and e.entity_type='opportunities' and e.entity_id=rec.id and e.event_type='due' and e.payload->>'workflow_id'=wf.id::text and e.created_at>now_ts-interval '10 minutes') then continue; end if;
        idem:=wf.id::text||':due:'||rec.id::text||':'||to_char(rec.due_at at time zone 'UTC','YYYYMMDDHH24MI');
        insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(wf.workspace_id,'due','opportunities',rec.id,jsonb_build_object('record',record_json,'workflow_id',wf.id)) returning id into ev_id; inserted_count:=inserted_count+1;
        if wf.mode='automatic' then
          insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'running',idem,jsonb_build_object('event_id',ev_id,'record',record_json),now_ts) on conflict(workflow_id,idempotency_key) do nothing returning id into run_id;
          if run_id is not null then
            for action in select value from jsonb_array_elements(coalesce(wf.actions,'[]'::jsonb)) loop
              if action->>'type'='create_task' then insert into public.tasks(workspace_id,customer_id,opportunity_id,title,status,priority,due_at) values(wf.workspace_id,rec.customer_id,rec.id,coalesce(action->>'title','Follow up on due opportunity'),'open',coalesce((action->>'priority')::numeric,1),now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)));
              elsif action->>'type'='create_follow_up' then insert into public.follow_ups(workspace_id,customer_id,opportunity_id,channel,status,scheduled_at,message) values(wf.workspace_id,rec.customer_id,rec.id,coalesce(action->>'channel','task'),'pending',now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)),coalesce(action->>'message','Workflow follow-up'));
              elsif action->>'type'='update_opportunity' then patch:=coalesce(action->'patch','{}'::jsonb); update public.opportunities set title=coalesce(patch->>'title',title),reason=coalesce(patch->>'reason',reason),status=coalesce(patch->>'status',status),priority=coalesce((patch->>'priority')::numeric,priority),amount=coalesce((patch->>'amount')::numeric,amount),due_at=coalesce((patch->>'due_at')::timestamptz,due_at),updated_at=now() where id=rec.id and workspace_id=wf.workspace_id;
              end if;
            end loop;
            update public.workflow_runs set status='completed',result=jsonb_build_object('background',true),completed_at=now() where id=run_id; executed_count:=executed_count+1;
          end if;
        else
          insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'waiting_approval',idem,jsonb_build_object('event_id',ev_id,'record',record_json),now_ts) on conflict(workflow_id,idempotency_key) do nothing;
        end if;
      end loop;
    elsif entity='documents' and due_field='due_at' then
      for rec in select * from public.documents where workspace_id=wf.workspace_id and due_at is not null and due_at<=now_ts and due_at>now_ts-interval '10 minutes' loop
        record_json:=to_jsonb(rec); if not public.workflow_conditions_match(record_json,wf.conditions) then continue; end if;
        if exists(select 1 from public.workflow_events e where e.workspace_id=wf.workspace_id and e.entity_type='documents' and e.entity_id=rec.id and e.event_type='due' and e.payload->>'workflow_id'=wf.id::text and e.created_at>now_ts-interval '10 minutes') then continue; end if;
        idem:=wf.id::text||':due:'||rec.id::text||':'||to_char(rec.due_at at time zone 'UTC','YYYYMMDDHH24MI');
        insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(wf.workspace_id,'due','documents',rec.id,jsonb_build_object('record',record_json,'workflow_id',wf.id)) returning id into ev_id; inserted_count:=inserted_count+1;
        insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,case when wf.mode='automatic' then 'completed' else 'waiting_approval' end,idem,jsonb_build_object('event_id',ev_id,'record',record_json),now_ts) on conflict(workflow_id,idempotency_key) do nothing returning id into run_id;
        if run_id is not null and wf.mode='automatic' then
          for action in select value from jsonb_array_elements(coalesce(wf.actions,'[]'::jsonb)) loop
            if action->>'type'='create_task' then insert into public.tasks(workspace_id,customer_id,opportunity_id,title,status,priority,due_at) values(wf.workspace_id,rec.customer_id,rec.opportunity_id,coalesce(action->>'title','Review due document'),'open',coalesce((action->>'priority')::numeric,1),now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)));
            elsif action->>'type'='create_follow_up' then insert into public.follow_ups(workspace_id,customer_id,opportunity_id,channel,status,scheduled_at,message) values(wf.workspace_id,rec.customer_id,rec.opportunity_id,coalesce(action->>'channel','task'),'pending',now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)),coalesce(action->>'message','Workflow follow-up'));
            end if;
          end loop;
          update public.workflow_runs set result=jsonb_build_object('background',true),completed_at=now() where id=run_id; executed_count:=executed_count+1;
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('scheduled_or_due_events',inserted_count,'executed_runs',executed_count,'ran_at',now_ts);
end $$;

revoke all on function public.run_background_workflows() from public,anon,authenticated;
select cron.schedule('loose-ends-background-workflows','* * * * *',$$select public.run_background_workflows();$$) where not exists(select 1 from cron.job where jobname='loose-ends-background-workflows');
create index if not exists idx_workflow_events_schedule_lookup on public.workflow_events(workspace_id,event_type,created_at desc);
create index if not exists idx_opportunities_due_workspace on public.opportunities(workspace_id,due_at) where due_at is not null;
create index if not exists idx_documents_due_workspace on public.documents(workspace_id,due_at) where due_at is not null;
