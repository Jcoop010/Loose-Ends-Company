-- Workflow execution state is server-owned. Authenticated workspace members may
-- inspect runs, but cannot forge statuses, approval metadata, contexts, or results.
-- The workflow-runner Edge Function validates the caller and workspace, then uses
-- the service-role client for explicitly workspace-scoped run transitions.
DROP POLICY IF EXISTS workflow_runs_member_insert ON public.workflow_runs;
DROP POLICY IF EXISTS workflow_runs_member_update ON public.workflow_runs;

-- Preserve workspace-scoped read access for the UI and audit views.
DROP POLICY IF EXISTS workflow_runs_member_select ON public.workflow_runs;
CREATE POLICY workflow_runs_member_select
  ON public.workflow_runs
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
