create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, description text, enabled boolean not null default true,
  mode text not null default 'manual' check (mode in ('manual','automatic','approval')),
  trigger_type text not null check (trigger_type in ('record_created','record_updated','record_due','manual','schedule')),
  trigger_config jsonb not null default '{}'::jsonb, conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade, trigger_event_id uuid,
  status text not null default 'queued' check (status in ('queued','running','waiting_approval','completed','failed','skipped')),
  idempotency_key text not null, context jsonb not null default '{}'::jsonb, result jsonb not null default '{}'::jsonb,
  error text, started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
  unique(workflow_id,idempotency_key)
);
create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null, entity_type text not null, entity_id uuid, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists workflows_workspace_idx on public.workflows(workspace_id, enabled);
create index if not exists workflow_runs_workspace_idx on public.workflow_runs(workspace_id, created_at desc);
create index if not exists workflow_events_workspace_idx on public.workflow_events(workspace_id, created_at desc);
alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_events enable row level security;
create policy workflows_member_all on public.workflows for all using (exists (select 1 from public.workspace_members wm where wm.workspace_id=workflows.workspace_id and wm.user_id=auth.uid())) with check (exists (select 1 from public.workspace_members wm where wm.workspace_id=workflows.workspace_id and wm.user_id=auth.uid()));
create policy workflow_runs_member_select on public.workflow_runs for select using (exists (select 1 from public.workspace_members wm where wm.workspace_id=workflow_runs.workspace_id and wm.user_id=auth.uid()));
create policy workflow_events_member_select on public.workflow_events for select using (exists (select 1 from public.workspace_members wm where wm.workspace_id=workflow_events.workspace_id and wm.user_id=auth.uid()));
create policy workflow_events_member_insert on public.workflow_events for insert with check (exists (select 1 from public.workspace_members wm where wm.workspace_id=workflow_events.workspace_id and wm.user_id=auth.uid()));
create or replace function public.emit_workflow_event() returns trigger language plpgsql security invoker as $$ declare ws uuid; payload jsonb; begin ws := coalesce((case when TG_OP='DELETE' then OLD.workspace_id else NEW.workspace_id end), null); if ws is null then return coalesce(NEW,OLD); end if; payload := jsonb_build_object('operation',TG_OP,'table',TG_TABLE_NAME,'record',case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end,'old_record',case when TG_OP='UPDATE' then to_jsonb(OLD) else null end); insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(ws, lower(TG_OP)||':'||TG_TABLE_NAME, TG_TABLE_NAME, case when TG_OP='DELETE' then OLD.id else NEW.id end, payload); return coalesce(NEW,OLD); end; $$;
drop trigger if exists workflows_customers_event on public.customers; create trigger workflows_customers_event after insert or update or delete on public.customers for each row execute function public.emit_workflow_event();
drop trigger if exists workflows_opportunities_event on public.opportunities; create trigger workflows_opportunities_event after insert or update or delete on public.opportunities for each row execute function public.emit_workflow_event();
drop trigger if exists workflows_appointments_event on public.appointments; create trigger workflows_appointments_event after insert or update or delete on public.appointments for each row execute function public.emit_workflow_event();
drop trigger if exists workflows_tasks_event on public.tasks; create trigger workflows_tasks_event after insert or update or delete on public.tasks for each row execute function public.emit_workflow_event();
drop trigger if exists workflows_documents_event on public.documents; create trigger workflows_documents_event after insert or update or delete on public.documents for each row execute function public.emit_workflow_event();
