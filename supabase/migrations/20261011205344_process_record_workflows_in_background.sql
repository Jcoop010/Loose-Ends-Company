alter function public.run_background_workflows() rename to run_scheduled_and_due_workflows;

create or replace function public.process_record_workflow_events()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  ev record;
  wf record;
  act jsonb;
  rec jsonb;
  run_id uuid;
  customer_id uuid;
  opportunity_id uuid;
  idem text;
  outputs jsonb;
  patch jsonb;
  action_count integer := 0;
  run_count integer := 0;
  failure_count integer := 0;
  event_failed boolean;
  error_message text;
begin
  for ev in
    select e.*
    from public.workflow_events e
    where e.processed_at is null
      and e.event_type ~ '^(insert|update):'
      and e.entity_type in ('customers','opportunities','documents','appointments','tasks')
    order by e.created_at
    limit 100
    for update skip locked
  loop
    rec := coalesce(ev.payload->'record', '{}'::jsonb);
    customer_id := nullif(rec->>'customer_id','')::uuid;
    if ev.entity_type = 'customers' then customer_id := ev.entity_id; end if;
    opportunity_id := nullif(rec->>'opportunity_id','')::uuid;
    if ev.entity_type = 'opportunities' then opportunity_id := ev.entity_id; end if;
    event_failed := false;

    for wf in
      select w.*
      from public.workflows w
      where w.workspace_id = ev.workspace_id
        and w.enabled = true
        and w.trigger_type = case
          when split_part(ev.event_type, ':', 1) = 'insert' then 'record_created'
          else 'record_updated'
        end
        and coalesce(w.trigger_config->>'entity_type','') = ev.entity_type
    loop
      if not public.workflow_conditions_match(rec, wf.conditions) then continue; end if;

      idem := ev.id::text || ':' || wf.id::text;
      run_id := null;
      insert into public.workflow_runs
        (workspace_id, workflow_id, trigger_event_id, status, idempotency_key, context, started_at)
      values
        (ev.workspace_id, wf.id, ev.id,
         case when wf.mode = 'automatic' then 'running' else 'waiting_approval' end,
         idem, jsonb_build_object('event_id', ev.id, 'event', jsonb_build_object(
           'id', ev.id, 'event_type', ev.event_type, 'entity_type', ev.entity_type,
           'entity_id', ev.entity_id, 'payload', ev.payload), 'record', rec), now())
      on conflict (workflow_id, idempotency_key) do update
        set status = 'running', error = null, started_at = now(), completed_at = null
        where workflow_runs.status = 'failed'
      returning id into run_id;

      if run_id is null then continue; end if;
      run_count := run_count + 1;

      if wf.mode <> 'automatic' then
        update public.workflow_runs
        set status = 'waiting_approval', started_at = null, completed_at = null, error = null
        where id = run_id and workspace_id = ev.workspace_id;
        continue;
      end if;

      outputs := '[]'::jsonb;
      begin
        for act in select value from jsonb_array_elements(coalesce(wf.actions, '[]'::jsonb))
        loop
          if act->>'type' = 'create_task' then
            insert into public.tasks
              (workspace_id, customer_id, opportunity_id, title, status, priority, due_at)
            values
              (ev.workspace_id, customer_id, opportunity_id,
               coalesce(nullif(act->>'title',''), 'Workflow task'),
               'open', coalesce(nullif(act->>'priority','')::numeric, 1),
               now() + make_interval(hours => coalesce(nullif(act->>'delay_hours','')::integer, 0)));
            outputs := outputs || jsonb_build_array(jsonb_build_object('type','create_task'));
            action_count := action_count + 1;
          elsif act->>'type' = 'create_follow_up' then
            insert into public.follow_ups
              (workspace_id, customer_id, opportunity_id, channel, status, scheduled_at, message)
            values
              (ev.workspace_id, customer_id, opportunity_id,
               coalesce(nullif(act->>'channel',''), 'task'), 'pending',
               now() + make_interval(hours => coalesce(nullif(act->>'delay_hours','')::integer, 0)),
               coalesce(nullif(act->>'message',''), 'Workflow follow-up'));
            outputs := outputs || jsonb_build_array(jsonb_build_object('type','create_follow_up'));
            action_count := action_count + 1;
          elsif act->>'type' = 'update_opportunity' and ev.entity_type = 'opportunities' then
            patch := coalesce(act->'patch', '{}'::jsonb);
            update public.opportunities
            set title = coalesce(patch->>'title', title),
                reason = coalesce(patch->>'reason', reason),
                status = coalesce(patch->>'status', status),
                priority = coalesce(nullif(patch->>'priority','')::numeric, priority),
                amount = coalesce(nullif(patch->>'amount','')::numeric, amount),
                due_at = coalesce(nullif(patch->>'due_at','')::timestamptz, due_at),
                updated_at = now()
            where id = ev.entity_id and workspace_id = ev.workspace_id;
            outputs := outputs || jsonb_build_array(jsonb_build_object('type','update_opportunity','id',ev.entity_id));
            action_count := action_count + 1;
          else
            raise exception 'Unsupported workflow action for background processing: %', coalesce(act->>'type','unknown');
          end if;
        end loop;

        update public.workflow_runs
        set status = 'completed', result = jsonb_build_object('outputs', outputs, 'background', true),
            completed_at = now(), error = null
        where id = run_id and workspace_id = ev.workspace_id;
      exception when others then
        get stacked diagnostics error_message = message_text;
        update public.workflow_runs
        set status = 'failed', error = error_message, completed_at = now()
        where id = run_id and workspace_id = ev.workspace_id;
        event_failed := true;
        failure_count := failure_count + 1;
      end;
    end loop;

    if not event_failed then
      update public.workflow_events set processed_at = now()
      where id = ev.id and workspace_id = ev.workspace_id;
    end if;
  end loop;

  return jsonb_build_object(
    'processed_actions', action_count,
    'runs_created_or_retried', run_count,
    'failed_runs', failure_count,
    'ran_at', now()
  );
end;
$function$;

create or replace function public.run_background_workflows()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  scheduled_result jsonb;
  record_result jsonb;
begin
  scheduled_result := public.run_scheduled_and_due_workflows();
  record_result := public.process_record_workflow_events();
  return jsonb_build_object('scheduled_and_due', scheduled_result, 'record_events', record_result, 'ran_at', now());
end;
$function$;

revoke all on function public.process_record_workflow_events() from public, anon, authenticated;
revoke all on function public.run_background_workflows() from public, anon, authenticated;
