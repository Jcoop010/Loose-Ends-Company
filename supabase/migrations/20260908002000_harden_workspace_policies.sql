-- Remove overlapping owner SELECT/UPDATE policies. Workspace owners are members,
-- so the member policies already grant the same access without evaluating two
-- permissive policies for every query.
drop policy if exists workspace_owner_select on public.workspaces;
drop policy if exists workspace_owner_update on public.workspaces;
