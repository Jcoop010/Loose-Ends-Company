-- Defense in depth: workspace-scoped policies should not target the broad PUBLIC role.
-- Every predicate is preserved; authenticated clients retain existing member/admin access.
-- Anonymous clients must never match these workspace policies.
BEGIN;

DROP POLICY IF EXISTS activity_events_member_insert ON public.activity_events;
CREATE POLICY activity_events_member_insert ON public.activity_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = activity_events.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS activity_events_member_select ON public.activity_events;
CREATE POLICY activity_events_member_select ON public.activity_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = activity_events.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS workflow_events_member_select ON public.workflow_events;
CREATE POLICY workflow_events_member_select ON public.workflow_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workflow_events.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS workflow_runs_member_insert ON public.workflow_runs;
CREATE POLICY workflow_runs_member_insert ON public.workflow_runs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workflow_runs.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS workflow_runs_member_select ON public.workflow_runs;
CREATE POLICY workflow_runs_member_select ON public.workflow_runs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workflow_runs.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS workflow_runs_member_update ON public.workflow_runs;
CREATE POLICY workflow_runs_member_update ON public.workflow_runs
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workflow_runs.workspace_id AND wm.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workflow_runs.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS workspace_records_member_delete ON public.workspace_records;
CREATE POLICY workspace_records_member_delete ON public.workspace_records
  FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_records_member_insert ON public.workspace_records;
CREATE POLICY workspace_records_member_insert ON public.workspace_records
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_records_member_select ON public.workspace_records;
CREATE POLICY workspace_records_member_select ON public.workspace_records
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_records_member_update ON public.workspace_records;
CREATE POLICY workspace_records_member_update ON public.workspace_records
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_settings_member_insert ON public.workspace_settings;
CREATE POLICY workspace_settings_member_insert ON public.workspace_settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_settings.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.role = ANY (ARRAY['owner'::text, 'admin'::text])));

DROP POLICY IF EXISTS workspace_settings_member_select ON public.workspace_settings;
CREATE POLICY workspace_settings_member_select ON public.workspace_settings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_settings.workspace_id AND wm.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS workspace_settings_member_update ON public.workspace_settings;
CREATE POLICY workspace_settings_member_update ON public.workspace_settings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_settings.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_settings.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.role = ANY (ARRAY['owner'::text, 'admin'::text])));

COMMIT;
