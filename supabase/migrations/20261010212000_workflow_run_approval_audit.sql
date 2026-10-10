alter table public.workflow_runs
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

comment on column public.workflow_runs.approved_by is
  'Authenticated workspace member who approved a workflow run, when approval was required.';