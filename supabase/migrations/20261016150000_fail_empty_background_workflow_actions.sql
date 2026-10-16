-- Keep the background scheduler consistent with the edge workflow runner:
-- an automatic workflow with no actions must fail, not report success.
-- This migration updates the stored function only; it does not execute jobs.
do $migration$
declare
  definition text;
  target text := '      outputs := ''[]''::jsonb;' || chr(10) || '      begin';
  replacement text := '      outputs := ''[]''::jsonb;' || chr(10) ||
    '      begin' || chr(10) ||
    '        if jsonb_typeof(wf.actions) is distinct from ''array'' or jsonb_array_length(wf.actions) = 0 then' || chr(10) ||
    '          raise exception ''Workflow has no actions to execute'';' || chr(10) ||
    '        end if;';
begin
  definition := pg_get_functiondef('public.process_record_workflow_events()'::regprocedure);
  if position(target in definition) = 0 then
    raise exception 'Background workflow function changed; manual review required';
  end if;
  definition := replace(definition, target, replacement);
  execute definition;
end
$migration$;
