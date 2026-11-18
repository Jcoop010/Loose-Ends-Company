-- ============================================================================
-- Migration: 20261119120000_create_grok_bot_tables.sql
-- Purpose  : Create scoped Grok Accounting & Outreach Bot tables:
--            1. public.bot_manuals (versioned SOP manuals & autonomy mode)
--            2. public.staged_ledger_entries (owner-gated invoice/receipt/match staging)
--            3. public.bot_runs (immutable bot execution audit trail)
--            Plus seed default SOP manuals for workspace 1dfa4852-9415-446a-b8c2-6d2263f65998.
-- ============================================================================

-- 1. public.bot_manuals
create table if not exists public.bot_manuals (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  bot_role              text not null check (bot_role in ('billing', 'cash_applications', 'collections', 'outreach')),
  mode                  text not null default 'propose' check (mode in ('observe', 'propose', 'auto_with_escalation')),
  instructions_markdown text not null,
  updated_by            uuid,
  updated_at            timestamptz not null default now(),
  unique (workspace_id, bot_role)
);

create index if not exists bot_manuals_workspace_role_idx
  on public.bot_manuals (workspace_id, bot_role);

alter table public.bot_manuals enable row level security;

grant select, insert, update on table public.bot_manuals to authenticated;

drop policy if exists "workspace members can read bot manuals" on public.bot_manuals;
create policy "workspace members can read bot manuals"
  on public.bot_manuals for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can upsert bot manuals" on public.bot_manuals;
create policy "workspace members can upsert bot manuals"
  on public.bot_manuals for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can update bot manuals" on public.bot_manuals;
create policy "workspace members can update bot manuals"
  on public.bot_manuals for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- 2. public.staged_ledger_entries
create table if not exists public.staged_ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  bot_role          text not null check (bot_role in ('billing', 'cash_applications', 'collections', 'outreach')),
  entry_type        text not null check (entry_type in ('invoice_draft', 'expense_receipt', 'payment_match', 'credit_adjustment', 'discrepancy_flag')),
  customer_id       uuid references public.customers(id) on delete set null,
  vendor_name       text,
  amount_cents      bigint not null default 0,
  currency          text not null default 'USD',
  line_items        jsonb not null default '[]'::jsonb,
  reasoning_summary text not null default '',
  confidence_score  numeric(5,2) not null default 0.90 check (confidence_score between 0 and 1),
  status            text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected', 'applied')),
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists staged_ledger_entries_workspace_status_idx
  on public.staged_ledger_entries (workspace_id, status, created_at desc);

alter table public.staged_ledger_entries enable row level security;

grant select, insert, update on table public.staged_ledger_entries to authenticated;

drop policy if exists "workspace members can read staged ledger entries" on public.staged_ledger_entries;
create policy "workspace members can read staged ledger entries"
  on public.staged_ledger_entries for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can insert staged ledger entries" on public.staged_ledger_entries;
create policy "workspace members can insert staged ledger entries"
  on public.staged_ledger_entries for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can update staged ledger entries" on public.staged_ledger_entries;
create policy "workspace members can update staged ledger entries"
  on public.staged_ledger_entries for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- 3. public.bot_runs
create table if not exists public.bot_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  bot_role      text not null check (bot_role in ('billing', 'cash_applications', 'collections', 'outreach')),
  model         text not null default 'grok-4.7',
  mode          text not null default 'propose' check (mode in ('observe', 'propose', 'auto_with_escalation')),
  status        text not null default 'completed' check (status in ('running', 'completed', 'fallback_deterministic', 'failed')),
  input_summary text not null default '',
  output_json   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists bot_runs_workspace_created_idx
  on public.bot_runs (workspace_id, created_at desc);

alter table public.bot_runs enable row level security;

grant select, insert on table public.bot_runs to authenticated;

drop policy if exists "workspace members can read bot runs" on public.bot_runs;
create policy "workspace members can read bot runs"
  on public.bot_runs for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can insert bot runs" on public.bot_runs;
create policy "workspace members can insert bot runs"
  on public.bot_runs for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

-- 4. Seed Default SOP Manuals for Primary Workspace (1dfa4852-9415-446a-b8c2-6d2263f65998)
do $$
begin
  if exists (select 1 from public.workspaces where id = '1dfa4852-9415-446a-b8c2-6d2263f65998') then
    insert into public.bot_manuals (workspace_id, bot_role, mode, instructions_markdown)
    values
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'billing',
        'propose',
        E'# Billing & Document Parser SOP\n- Verify every completed job checklist item and reserved material before staging an invoice draft.\n- Recompute line-item subtotals and tax in integer cents; flag any vendor receipt or estimate where line items + tax do not equal total.\n- Stage all outputs as `pending_approval` in `staged_ledger_entries`. Never finalize or transmit an invoice without owner sign-off.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'cash_applications',
        'propose',
        E'# Cash Applications & Receipt Match SOP\n- Match incoming vendor bills, supplier POs, and remittance advice against open documents by exact dollar amount and reference number.\n- Flag partial payments, unapproved price increases (>3% over PO cost), or duplicate invoice numbers as `discrepancy_flag` entries.\n- Never write directly to `verified_recovery_payments` (reserved strictly for Stripe webhook settlements).'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'collections',
        'propose',
        E'# Collections & Revenue Leak Recovery SOP\n- Prioritize overdue invoices (>7 days past due), completed unbilled jobs, and stale quotes (>5 days old).\n- Verify active channel opt-in in `customer_contact_consent_events` before proposing any customer follow-up.\n- Maintain a constructive, service-first tone and hold every draft at `delivery_status = not_sent` for owner review.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'outreach',
        'propose',
        E'# Founder-to-Founder SMB Outreach SOP\n- Tailor outreach to the prospect''s specific industry bottleneck (unbilled field work, stale estimates, stockouts, or overdue receivables).\n- Reference the live interactive sandbox (`https://loose-ends-os.vercel.app/demo`) and the $249 Document Operations Pilot.\n- Queue all outreach in `ops_communication_drafts` with `requires_approval = true` and `delivery_status = not_sent`.'
      )
    on conflict (workspace_id, bot_role) do nothing;
  end if;
end $$;
