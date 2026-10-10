alter table public.workflow_events
  add column if not exists processed_at timestamptz;

create index if not exists workflow_events_unprocessed_idx
  on public.workflow_events(workspace_id, created_at)
  where processed_at is null;

drop policy if exists workflow_events_member_update on public.workflow_events;
create policy workflow_events_member_update
  on public.workflow_events
  for update
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workflow_events.workspace_id
      and wm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workflow_events.workspace_id
      and wm.user_id = auth.uid()
  ));