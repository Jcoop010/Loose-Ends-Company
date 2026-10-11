-- Restore workspace-member access for core business tables that had RLS enabled but no policies.
-- Access is scoped to membership in the row's workspace; workflow definitions are owner/admin-managed.
create policy customers_member_select on public.customers
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy customers_member_insert on public.customers
  for insert to authenticated with check ((select public.is_workspace_member(workspace_id)));
create policy customers_member_update on public.customers
  for update to authenticated using ((select public.is_workspace_member(workspace_id)))
  with check ((select public.is_workspace_member(workspace_id)));
create policy customers_member_delete on public.customers
  for delete to authenticated using ((select public.is_workspace_member(workspace_id)));

create policy opportunities_member_select on public.opportunities
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy opportunities_member_insert on public.opportunities
  for insert to authenticated with check ((select public.is_workspace_member(workspace_id)));
create policy opportunities_member_update on public.opportunities
  for update to authenticated using ((select public.is_workspace_member(workspace_id)))
  with check ((select public.is_workspace_member(workspace_id)));
create policy opportunities_member_delete on public.opportunities
  for delete to authenticated using ((select public.is_workspace_member(workspace_id)));

create policy follow_ups_member_select on public.follow_ups
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy follow_ups_member_insert on public.follow_ups
  for insert to authenticated with check ((select public.is_workspace_member(workspace_id)));
create policy follow_ups_member_update on public.follow_ups
  for update to authenticated using ((select public.is_workspace_member(workspace_id)))
  with check ((select public.is_workspace_member(workspace_id)));
create policy follow_ups_member_delete on public.follow_ups
  for delete to authenticated using ((select public.is_workspace_member(workspace_id)));

create policy recovery_events_member_select on public.recovery_events
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy recovery_events_member_insert on public.recovery_events
  for insert to authenticated with check ((select public.is_workspace_member(workspace_id)));

create policy workflows_member_select on public.workflows
  for select to authenticated using ((select public.is_workspace_member(workspace_id)));
create policy workflows_admin_insert on public.workflows
  for insert to authenticated with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workflows.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  ));
create policy workflows_admin_update on public.workflows
  for update to authenticated using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workflows.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  )) with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workflows.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  ));
create policy workflows_admin_delete on public.workflows
  for delete to authenticated using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workflows.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  ));
