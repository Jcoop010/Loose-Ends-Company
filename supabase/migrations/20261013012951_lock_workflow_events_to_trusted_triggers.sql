-- Keep workflow events trustworthy: client sessions may read events, but only database
-- triggers and the service role may create/update processing state.
CREATE OR REPLACE FUNCTION public.emit_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ws uuid;
  payload jsonb;
BEGIN
  -- Delete-trigger events are intentionally unsupported by the workflow runner.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  ws := NEW.workspace_id;
  IF ws IS NULL THEN
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'operation', TG_OP,
    'table', TG_TABLE_NAME,
    'record', to_jsonb(NEW),
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
  );

  INSERT INTO public.workflow_events(workspace_id, event_type, entity_type, entity_id, payload)
  VALUES (ws, lower(TG_OP) || ':' || TG_TABLE_NAME, TG_TABLE_NAME, NEW.id, payload);

  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS workflow_events_member_insert ON public.workflow_events;
DROP POLICY IF EXISTS workflow_events_member_update ON public.workflow_events;
