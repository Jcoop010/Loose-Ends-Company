-- Defense in depth: remove client table grants that were broader than the RLS policies.
-- Keep the intended public lead intake insert and workspace-scoped read access only.
BEGIN;

REVOKE ALL ON TABLE public.public_leads FROM anon, authenticated;
GRANT INSERT ON TABLE public.public_leads TO anon, authenticated;

REVOKE ALL ON TABLE public.workflow_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.workflow_events TO authenticated;

REVOKE ALL ON TABLE public.workflow_runs FROM anon, authenticated;
GRANT SELECT ON TABLE public.workflow_runs TO authenticated;

REVOKE ALL ON TABLE public.workspace_records FROM anon;
REVOKE ALL ON TABLE public.workspace_settings FROM anon;

REVOKE DELETE ON TABLE public.workspaces FROM authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.quickbooks_connections FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workspace_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated;

COMMIT;
