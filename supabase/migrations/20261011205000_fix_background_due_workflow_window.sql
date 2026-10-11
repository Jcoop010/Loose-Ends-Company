-- Process overdue records regardless of how long they have been overdue.
-- Deduplicate by the workflow/entity event identity, not an arbitrary 10-minute window.
do $migration$
declare
  v_definition text;
  v_old_due text := 'due_at>now_ts-interval ''10 minutes''';
  v_old_window text := ' and e.created_at>now_ts-interval ''10 minutes''';
begin
  v_definition := pg_get_functiondef('public.run_background_workflows()'::regprocedure);

  if position(v_old_due in v_definition) = 0 then
    raise exception 'Expected due-date window was not found; refusing to alter scheduler function';
  end if;
  if position(v_old_window in v_definition) = 0 then
    raise exception 'Expected event deduplication window was not found; refusing to alter scheduler function';
  end if;

  v_definition := replace(v_definition, v_old_due, 'due_at<=now_ts');
  v_definition := replace(v_definition, v_old_window, '');

  if position(v_old_due in v_definition) > 0 or position(v_old_window in v_definition) > 0 then
    raise exception 'Scheduler function replacement was incomplete; refusing to apply';
  end if;

  execute v_definition;
end
$migration$;
