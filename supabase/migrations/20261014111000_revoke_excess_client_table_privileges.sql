-- Defense in depth: remove client table grants that were broader than the RLS policies.
-- Keep the intended public lead intake insert and workspace-scoped read access only.
BEGIN;

-- Ordinary Data API operations never require these privileges. TRUNCATE is
-- not governed by row policies, so client roles must not retain it anywhere.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.public_leads FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.public_leads TO anon, authenticated;

REVOKE ALL ON TABLE public.workflow_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_events TO authenticated;

REVOKE ALL ON TABLE public.workflow_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_runs TO authenticated;

REVOKE ALL ON TABLE public.workspace_records FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.workspace_settings FROM PUBLIC, anon;

REVOKE DELETE ON TABLE public.workspaces FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.quickbooks_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quickbooks_connections TO authenticated;
REVOKE ALL ON TABLE public.workspace_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workspace_subscriptions TO authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM PUBLIC, anon, authenticated;

COMMIT;
