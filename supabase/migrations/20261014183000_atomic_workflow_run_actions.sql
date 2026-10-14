-- Execute a workflow's internal actions and mark it complete in one transaction.
-- A failed transaction leaves no newly created tasks or follow-ups.
create or replace function public.complete_workflow_run_atomically(
  p_run_id uuid, p_workspace_id uuid, p_approved_by uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.workflow_runs%rowtype;
  v_workflow public.workflows%rowtype;
  v_action jsonb;
  v_event jsonb;
  v_record jsonb;
  v_entity text;
  v_customer uuid;
  v_opportunity uuid;
  v_id uuid;
  v_delay numeric;
  v_priority numeric;
  v_patch jsonb;
  v_outputs jsonb := '[]'::jsonb;
begin
  select * into v_run from public.workflow_runs
    where id = p_run_id and workspace_id = p_workspace_id for update;
  if not found or v_run.status <> 'running' then
    raise exception 'Workflow run is not claimed for execution';
  end if;
  select * into v_workflow from public.workflows
    where id = v_run.workflow_id and workspace_id = p_workspace_id;
  if not found or jsonb_typeof(v_workflow.actions) <> 'array' then
    raise exception 'Workflow actions are invalid';
  end if;
  if jsonb_array_length(v_workflow.actions) > 50 then
    raise exception 'Workflow exceeds maximum action count';
  end if;
  v_event := coalesce(v_run.context->'event','{}'::jsonb);
  v_record := coalesce(v_run.context->'record',v_event#>'{payload,record}','{}'::jsonb);
  v_entity := v_event->>'entity_type';
  v_customer := nullif(coalesce(v_record->>'customer_id', case when v_entity = 'customers' then v_record->>'id' end),'')::uuid;
  v_opportunity := nullif(coalesce(v_record->>'opportunity_id', case when v_entity = 'opportunities' then v_record->>'id' end),'')::uuid;

  for v_action in select value from jsonb_array_elements(v_workflow.actions) loop
    if jsonb_typeof(v_action) <> 'object' then raise exception 'Malformed workflow action'; end if;
    if v_action->>'type' in ('create_task','create_follow_up') then
      v_delay := coalesce(nullif(v_action->>'delay_hours','')::numeric,0);
      if v_delay < 0 or v_delay > 8760 then raise exception 'Invalid action delay'; end if;
    end if;
    if v_action->>'type' = 'create_task' then
      v_priority := coalesce(nullif(v_action->>'priority','')::numeric,1);
      if v_priority < 0 then raise exception 'Invalid task priority'; end if;
      insert into public.tasks
        (workspace_id,customer_id,opportunity_id,title,status,priority,due_at)
      values (p_workspace_id,v_customer,v_opportunity,
        coalesce(nullif(v_action->>'title',''),'Workflow task'),'open',v_priority,
        clock_timestamp() + make_interval(secs => (v_delay * 3600)::double precision))
      returning id into v_id;
    elsif v_action->>'type' = 'create_follow_up' then
      insert into public.follow_ups
        (workspace_id,customer_id,opportunity_id,channel,status,scheduled_at,message)
      values (p_workspace_id,v_customer,v_opportunity,
        coalesce(nullif(v_action->>'channel',''),'task'),'pending',
        clock_timestamp() + make_interval(secs => (v_delay * 3600)::double precision),
        coalesce(nullif(v_action->>'message',''),'Workflow follow-up'))
      returning id into v_id;
    elsif v_action->>'type' = 'update_opportunity' then
      if v_entity is distinct from 'opportunities' or nullif(v_record->>'id','') is null then
        raise exception 'Opportunity update has no target';
      end if;
      v_patch := v_action->'patch';
      if jsonb_typeof(v_patch) <> 'object' or v_patch = '{}'::jsonb
        or exists (select 1 from jsonb_object_keys(v_patch) as k(key)
          where k.key not in ('title','reason','status','priority','amount','due_at')) then
        raise exception 'Invalid opportunity update patch';
      end if;
      update public.opportunities set
        title = case when v_patch ? 'title' then v_patch->>'title' else title end,
        reason = case when v_patch ? 'reason' then v_patch->>'reason' else reason end,
        status = case when v_patch ? 'status' then v_patch->>'status' else status end,
        priority = case when v_patch ? 'priority' then (v_patch->>'priority')::numeric else priority end,
        amount = case when v_patch ? 'amount' then (v_patch->>'amount')::numeric else amount end,
        due_at = case when v_patch ? 'due_at' then (v_patch->>'due_at')::timestamptz else due_at end,
        updated_at = clock_timestamp()
      where id = (v_record->>'id')::uuid and workspace_id = p_workspace_id
      returning id into v_id;
      if v_id is null then raise exception 'Opportunity not found'; end if;
    else
      raise exception 'Unsupported workflow action';
    end if;
    v_outputs := v_outputs || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type',v_action->>'type','id',v_id));
    v_id := null;
  end loop;
  update public.workflow_runs set
    status = 'completed',
    result = case when p_approved_by is null
      then pg_catalog.jsonb_build_object('outputs',v_outputs)
      else pg_catalog.jsonb_build_object('outputs',v_outputs,'approved_by',p_approved_by) end,
    approved_by = coalesce(p_approved_by,approved_by),
    completed_at = clock_timestamp(), error = null
  where id = p_run_id and workspace_id = p_workspace_id;
  return v_outputs;
end;
$$;
revoke all on function public.complete_workflow_run_atomically(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.complete_workflow_run_atomically(uuid,uuid,uuid) to service_role;
