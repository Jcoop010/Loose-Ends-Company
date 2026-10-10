-- Match the existing membership rule while evaluating auth.uid() once per statement.
DROP POLICY IF EXISTS workflow_events_member_update ON public.workflow_events;
CREATE POLICY workflow_events_member_update
  ON public.workflow_events
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workflow_events.workspace_id
        AND wm.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workflow_events.workspace_id
        AND wm.user_id = (SELECT auth.uid())
    )
  );
