-- Defense in depth: authenticated clients should not even hold table-level write
-- privileges for workflow execution records. The validated Edge Function uses service_role.
REVOKE INSERT, UPDATE ON TABLE public.workflow_runs FROM PUBLIC, anon, authenticated;
