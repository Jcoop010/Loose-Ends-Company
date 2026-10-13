-- The trigger invokes this function internally; clients must not be able to call it via PostgREST RPC.
REVOKE EXECUTE ON FUNCTION public.emit_workflow_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_workflow_event() FROM anon;
REVOKE EXECUTE ON FUNCTION public.emit_workflow_event() FROM authenticated;
