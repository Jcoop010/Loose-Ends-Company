-- Track the approval foreign-key index applied to the existing Supabase project.
CREATE INDEX IF NOT EXISTS workflow_runs_approved_by_idx
  ON public.workflow_runs (approved_by);
