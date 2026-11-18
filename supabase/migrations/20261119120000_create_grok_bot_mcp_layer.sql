-- ============================================================================
-- Migration: 20261119120000_create_grok_bot_mcp_layer.sql
-- Purpose  : Universal 5-Workspace Grok Bot & Cursor MCP Layer:
--            1. public.workspace_mcp_tokens (SHA-256 hashed MCP bearer tokens)
--            2. public.bot_manuals (7+ role versioned SOP manuals & autonomy mode)
--            3. public.staged_ops_actions (5-workspace staged proposals)
--            4. public.staged_ledger_entries (staged invoice/receipt/discrepancy ledger)
--            5. public.bot_runs (immutable audit trail across MCP & Edge Function runs)
--            Plus seed default read-only SOP manuals for all 7 roles on
--            workspace 1dfa4852-9415-446a-b8c2-6d2263f65998.
-- ============================================================================

-- 1. public.workspace_mcp_tokens (stores SHA-256 hashes only, never raw tokens)
create table if not exists public.workspace_mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label        text not null check (length(trim(label)) between 1 and 120),
  token_hash   text not null unique check (length(token_hash) = 64),
  token_prefix text not null check (length(token_prefix) between 6 and 24),
  scopes       text[] not null default array['read_all','stage_actions'],
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists workspace_mcp_tokens_workspace_idx
  on public.workspace_mcp_tokens (workspace_id, created_at desc);

alter table public.workspace_mcp_tokens enable row level security;

grant select, insert, update on table public.workspace_mcp_tokens to authenticated;

drop policy if exists "workspace members can read mcp tokens" on public.workspace_mcp_tokens;
create policy "workspace members can read mcp tokens"
  on public.workspace_mcp_tokens for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can create mcp tokens" on public.workspace_mcp_tokens;
create policy "workspace members can create mcp tokens"
  on public.workspace_mcp_tokens for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can revoke mcp tokens" on public.workspace_mcp_tokens;
create policy "workspace members can revoke mcp tokens"
  on public.workspace_mcp_tokens for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- 2. public.bot_manuals (supports all 7 universal roles + cash_applications)
create table if not exists public.bot_manuals (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  bot_role              text not null,
  mode                  text not null default 'propose' check (mode in ('observe', 'propose', 'auto_with_escalation')),
  instructions_markdown text not null,
  updated_by            uuid,
  updated_at            timestamptz not null default now(),
  unique (workspace_id, bot_role)
);

alter table public.bot_manuals
  drop constraint if exists bot_manuals_bot_role_check,
  add constraint bot_manuals_bot_role_check
    check (bot_role in (
      'chief_of_staff',
      'scout',
      'dispatcher',
      'buyer',
      'billing',
      'collections',
      'qa',
      'cash_applications',
      'outreach'
    ));

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

-- 3. public.staged_ops_actions (5-workspace staged actions awaiting owner approval)
create table if not exists public.staged_ops_actions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  bot_role         text not null check (bot_role in (
    'chief_of_staff',
    'scout',
    'dispatcher',
    'buyer',
    'billing',
    'collections',
    'qa',
    'cash_applications',
    'outreach'
  )),
  workspace_domain text not null check (workspace_domain in ('pipeline', 'jobs', 'inventory', 'comms', 'billing')),
  action_type      text not null check (action_type in (
    'quote_draft',
    'job_checklist_flag',
    'purchase_order_draft',
    'expense_receipt',
    'invoice_draft',
    'payment_match',
    'discrepancy_flag'
  )),
  customer_id      uuid references public.customers(id) on delete set null,
  title            text not null,
  summary          text not null default '',
  amount_cents     bigint not null default 0,
  payload          jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,2) not null default 0.92 check (confidence_score between 0 and 1),
  status           text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected', 'applied')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists staged_ops_actions_workspace_status_idx
  on public.staged_ops_actions (workspace_id, status, created_at desc);

alter table public.staged_ops_actions enable row level security;

grant select, insert, update on table public.staged_ops_actions to authenticated;

drop policy if exists "workspace members can read staged ops actions" on public.staged_ops_actions;
create policy "workspace members can read staged ops actions"
  on public.staged_ops_actions for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can insert staged ops actions" on public.staged_ops_actions;
create policy "workspace members can insert staged ops actions"
  on public.staged_ops_actions for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can update staged ops actions" on public.staged_ops_actions;
create policy "workspace members can update staged ops actions"
  on public.staged_ops_actions for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- 4. public.staged_ledger_entries
create table if not exists public.staged_ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  bot_role          text not null,
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

alter table public.staged_ledger_entries
  drop constraint if exists staged_ledger_entries_bot_role_check,
  add constraint staged_ledger_entries_bot_role_check
    check (bot_role in (
      'chief_of_staff',
      'scout',
      'dispatcher',
      'buyer',
      'billing',
      'collections',
      'qa',
      'cash_applications',
      'outreach'
    ));

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

-- 5. public.bot_runs (supports both MCP surface/tool_name and Grok router runs)
create table if not exists public.bot_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  bot_role      text not null,
  model         text not null default 'grok-4.7',
  mode          text not null default 'propose' check (mode in ('observe', 'propose', 'auto_with_escalation')),
  surface       text not null default 'mcp',
  tool_name     text not null default '',
  status        text not null default 'completed' check (status in ('running', 'completed', 'fallback_deterministic', 'failed')),
  input_summary text not null default '',
  output_json   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table public.bot_runs
  add column if not exists surface   text not null default 'mcp',
  add column if not exists tool_name text not null default '',
  drop constraint if exists bot_runs_bot_role_check,
  add constraint bot_runs_bot_role_check
    check (bot_role in (
      'chief_of_staff',
      'scout',
      'dispatcher',
      'buyer',
      'billing',
      'collections',
      'qa',
      'cash_applications',
      'outreach'
    ));

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

-- 6. Seed Default Read-Only SOP Manuals for All 7 Roles on Workspace 1dfa4852-9415-446a-b8c2-6d2263f65998
do $$
begin
  if exists (select 1 from public.workspaces where id = '1dfa4852-9415-446a-b8c2-6d2263f65998') then
    insert into public.bot_manuals (workspace_id, bot_role, mode, instructions_markdown)
    values
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'chief_of_staff',
        'propose',
        E'# Chief of Staff Bot SOP\n- Monitor daily cross-workspace health across Pipeline, Dispatch, Inventory, and Billing.\n- Surface high-impact bottlenecks as prioritized `staged_ops_actions` with exact integer cent figures.\n- Never execute financial or external messaging mutations without owner approval.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'scout',
        'propose',
        E'# SMB Prospect Scout & Enrichment Bot SOP\n- Prioritize Ohio Valley / Appalachian regional SMBs (WV, OH, PA) alongside growth metros.\n- Crawl business websites to verify real owner/operations emails (`owner@`, `office@`, `billing@`, `service@`, `info@`) and reject non-buyer prefixes (`resumes@`, `careers@`, `jobs@`, `hr@`) and agency footer domains.\n- Upsert leads at `DRAFT_READY` and queue outreach drafts with `requires_approval = true`.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'dispatcher',
        'propose',
        E'# Dispatch & Field Operations Bot SOP\n- Inspect open jobs (`ops_jobs`), technician availability, and incomplete checklist items.\n- Flag completed field jobs missing mandatory checklist sign-offs as `job_checklist_flag` in `staged_ops_actions` before invoicing.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'buyer',
        'propose',
        E'# Inventory & Purchasing Buyer Bot SOP\n- Monitor SKU stock levels where `quantity - reserved <= reorder_threshold`.\n- Stage `purchase_order_draft` actions in `staged_ops_actions` with exact reorder quantities and unit purchase costs for owner review.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'billing',
        'propose',
        E'# Billing & Document Parser Bot SOP\n- Parse vendor receipts and completed job records into integer cents.\n- Recompute line-item subtotals + tax deterministically; flag any arithmetic mismatch as `discrepancy_flag`.\n- Stage all invoice drafts and receipt entries as `pending_approval`.'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'collections',
        'propose',
        E'# Collections & Revenue Leak Recovery Bot SOP\n- Prioritize overdue invoices (>7 days past due), completed unbilled jobs, and stale quotes (>5 days old).\n- Verify active channel opt-in in `customer_contact_consent_events` before staging any customer communication draft (`delivery_status = not_sent`).'
      ),
      (
        '1dfa4852-9415-446a-b8c2-6d2263f65998',
        'qa',
        'propose',
        E'# Operations QA & Compliance Guard Bot SOP\n- Audit staged drafts, consent evidence references (8+ chars), and integer cent calculations.\n- Hard-block any communication draft whose recipient has an `opted_out` or `revoked` event in `customer_contact_consent_events`.'
      )
    on conflict (workspace_id, bot_role) do nothing;
  end if;
end $$;
