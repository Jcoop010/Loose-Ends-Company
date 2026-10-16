-- Workspace ownership is a security boundary. Members may not rewrite owner_user_id
-- and thereby satisfy the self-membership bootstrap policy to promote themselves.
REVOKE UPDATE ON TABLE public.workspaces FROM PUBLIC, anon, authenticated;
GRANT UPDATE (name, slug) ON TABLE public.workspaces TO authenticated;

DROP POLICY IF EXISTS workspace_member_update ON public.workspaces;
DROP POLICY IF EXISTS workspace_admin_update ON public.workspaces;
CREATE POLICY workspace_admin_update
  ON public.workspaces
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = (SELECT auth.uid())
        AND wm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = (SELECT auth.uid())
        AND wm.role IN ('owner', 'admin')
    )
  );
