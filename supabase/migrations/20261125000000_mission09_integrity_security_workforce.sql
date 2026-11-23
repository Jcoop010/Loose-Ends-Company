-- ============================================================================
-- Migration: 20261125000000_mission09_integrity_security_workforce.sql
-- Purpose  : Mission 09 Remediation (Phases 2, 3, 4 & 5)
--            1. Financial Integrity & Atomic Transactional RPCs
--            2. Entity Identity Verification (remove fabricated EINs) + Entity FK Guard
--            3. Multi-Tenant RLS Hardening (public_leads, bot_manuals, staged queues, tokens, ledger)
--            4. Stripe Refund Event Ledger
--            5. Phase 5 Autonomous Workforce Shared Task Ledger + Atomic Lease Claim
--
-- SAFETY: Additive & non-destructive. Does NOT drop tables or truncate customer data.
-- ============================================================================

-- 1. Harden is_workspace_owner helper search_path & execute privileges
create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_workspace_owner(uuid) from public, anon;
grant execute on function public.is_workspace_owner(uuid) to authenticated, service_role;

-- 2. Entity Identity Verification & Cleanup of Fabricated EINs
alter table public.workspace_entities
  add column if not exists ein_verified boolean not null default false,
  add column if not exists identity_status text not null default 'unverified';

alter table public.workspace_entities
  alter column ein_last4 drop not null,
  alter column ein_last4 drop default;

alter table public.workspace_entities
  drop constraint if exists workspace_entities_ein_last4_check,
  add constraint workspace_entities_ein_last4_check
    check (ein_last4 is null or ein_last4 ~ '^[0-9]{4}$'),
  drop constraint if exists workspace_entities_identity_status_check,
  add constraint workspace_entities_identity_status_check
    check (identity_status in ('unverified', 'owner_supplied', 'verified'));

-- Clear fabricated sample EIN defaults ('4821', '0000') where not verified
update public.workspace_entities
set ein_last4 = null,
    identity_status = 'unverified',
    updated_at = now()
where coalesce(ein_verified, false) = false
  and ein_last4 in ('4821', '0000');

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_entities'::regclass
      and conname = 'workspace_entities_ws_id_unique'
  ) then
    alter table public.workspace_entities
      add constraint workspace_entities_ws_id_unique unique (workspace_id, id);
  end if;
end $$;

create unique index if not exists workspace_entities_one_primary_idx
  on public.workspace_entities (workspace_id)
  where is_primary = true;

-- 3. Financial Integrity Extensions, Dedupe Keys & Hashes
alter table public.inbound_bill_captures
  add column if not exists content_hash text,
  add column if not exists extraction_method text not null default 'plain_text',
  add column if not exists extraction_confidence_bps integer not null default 0 check (extraction_confidence_bps between 0 and 10000),
  add column if not exists human_verified boolean not null default false,
  add column if not exists verified_by uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists posted_ledger_entry_id uuid references public.ledger_entries(id) on delete set null;

create unique index if not exists inbound_bill_captures_ws_hash_idx
  on public.inbound_bill_captures (workspace_id, content_hash)
  where content_hash is not null;

create unique index if not exists inbound_bill_captures_ws_idem_idx
  on public.inbound_bill_captures (workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.vendor_fraud_alerts
  add column if not exists capture_id uuid references public.inbound_bill_captures(id) on delete set null;

create index if not exists vendor_fraud_alerts_ws_capture_idx
  on public.vendor_fraud_alerts (workspace_id, capture_id)
  where capture_id is not null;

alter table public.bank_feed_transactions
  add column if not exists external_tx_id text,
  add column if not exists source_fingerprint text,
  add column if not exists manual_override_reason text,
  add column if not exists idempotency_key text;

create unique index if not exists bank_feed_tx_ws_ext_idx
  on public.bank_feed_transactions (workspace_id, source, external_tx_id)
  where external_tx_id is not null;

create unique index if not exists bank_feed_tx_ws_fp_idx
  on public.bank_feed_transactions (workspace_id, source_fingerprint)
  where source_fingerprint is not null;

alter table public.ledger_entries
  add column if not exists entity_id uuid references public.workspace_entities(id) on delete set null,
  add column if not exists idempotency_key text,
  add column if not exists reversal_of_entry_id uuid references public.ledger_entries(id) on delete set null;

create unique index if not exists ledger_entries_ws_idem_idx
  on public.ledger_entries (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- Cross-Workspace entity_id ownership trigger guard
create or replace function public.enforce_entity_workspace_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if NEW.entity_id is not null then
    if not exists (
      select 1 from public.workspace_entities e
      where e.id = NEW.entity_id
        and e.workspace_id = NEW.workspace_id
    ) then
      raise exception 'entity_id % does not belong to workspace %', NEW.entity_id, NEW.workspace_id
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['bank_feed_transactions', 'inbound_bill_captures', 'job_margin_records', 'ledger_entries'] loop
    execute format('drop trigger if exists enforce_entity_ws_ownership_%s on public.%I', tbl, tbl);
    execute format(
      'create trigger enforce_entity_ws_ownership_%s before insert or update on public.%I for each row execute function public.enforce_entity_workspace_ownership()',
      tbl, tbl
    );
  end loop;
end $$;

-- 4. Atomic Transactional Financial RPCs

create or replace function public.post_inbound_bill_capture_atomic(
  p_workspace_id uuid,
  p_capture_id uuid,
  p_idempotency_key text,
  p_human_verified boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cap public.inbound_bill_captures%rowtype;
  v_le public.ledger_entries%rowtype;
  v_agent public.agent_action_ledger%rowtype;
  v_now timestamptz := now();
  v_desc text;
  v_prev_status text;
begin
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;
  if coalesce(p_human_verified, false) = false then
    raise exception 'Human verification is required before posting captured vendor bills to the GL';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Valid idempotency_key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':post_capture', 9091));

  select * into v_cap
  from public.inbound_bill_captures
  where workspace_id = p_workspace_id and id = p_capture_id
  for update;

  if not found then
    raise exception 'Inbound bill capture not found in workspace';
  end if;

  if v_cap.match_status = 'posted' then
    if v_cap.idempotency_key = p_idempotency_key and v_cap.posted_ledger_entry_id is not null then
      select * into v_le from public.ledger_entries where id = v_cap.posted_ledger_entry_id;
      select * into v_agent
      from public.agent_action_ledger
      where workspace_id = p_workspace_id
        and action_type = 'post_inbound_bill_capture'
        and after_state->>'capture_id' = v_cap.id::text
      order by created_at desc limit 1;
      return jsonb_build_object(
        'duplicate', true,
        'capture', to_jsonb(v_cap),
        'ledger_entry', to_jsonb(v_le),
        'agent_ledger_entry', to_jsonb(v_agent)
      );
    end if;
    raise exception 'Inbound bill capture % has already been posted to the GL', p_capture_id;
  end if;

  if v_cap.match_status = 'fraud_frozen' then
    raise exception 'Cannot post fraud_frozen bill capture until Vendor Fraud Shield override is approved';
  end if;

  if exists (
    select 1 from public.ledger_entries
    where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key
  ) then
    raise exception 'Idempotency key already used by another ledger entry';
  end if;

  v_prev_status := v_cap.match_status;
  v_desc := format(
    'Posted %s (%s%s)',
    v_cap.file_name,
    v_cap.vendor_name,
    case when v_cap.po_reference is not null then ' · ' || v_cap.po_reference else '' end
  );

  insert into public.ledger_entries (
    workspace_id,
    entity_id,
    entry_type,
    category,
    description,
    amount_cents,
    occurred_on,
    source_ref,
    idempotency_key
  ) values (
    p_workspace_id,
    v_cap.entity_id,
    'cogs',
    'Inbound AP Capture',
    v_desc,
    greatest(0, v_cap.extracted_total_cents),
    v_now::date,
    coalesce(v_cap.po_reference, v_cap.file_name),
    p_idempotency_key
  )
  returning * into v_le;

  update public.inbound_bill_captures
  set match_status = 'posted',
      human_verified = true,
      verified_by = v_user,
      verified_at = v_now,
      idempotency_key = p_idempotency_key,
      posted_ledger_entry_id = v_le.id,
      updated_at = v_now
  where workspace_id = p_workspace_id and id = p_capture_id
  returning * into v_cap;

  insert into public.agent_action_ledger (
    workspace_id,
    agent_name,
    module,
    action_type,
    autonomy_mode,
    summary,
    impact_cents,
    before_state,
    after_state,
    status
  ) values (
    p_workspace_id,
    'Inbox-to-Ledger Engine',
    'bookkeeping',
    'post_inbound_bill_capture',
    'approve_1tap',
    format('Posted inbound capture %s (%s · $%s) to AP Ledger', v_cap.file_name, v_cap.vendor_name, to_char(v_cap.extracted_total_cents::numeric / 100.0, 'FM999999990.00')),
    v_cap.extracted_total_cents,
    jsonb_build_object(
      'capture_id', v_cap.id,
      'previous_match_status', v_prev_status,
      'human_verified', false
    ),
    jsonb_build_object(
      'capture_id', v_cap.id,
      'next_match_status', 'posted',
      'ledger_entry_id', v_le.id,
      'idempotency_key', p_idempotency_key
    ),
    'executed'
  )
  returning * into v_agent;

  return jsonb_build_object(
    'duplicate', false,
    'capture', to_jsonb(v_cap),
    'ledger_entry', to_jsonb(v_le),
    'agent_ledger_entry', to_jsonb(v_agent)
  );
end;
$$;

revoke all on function public.post_inbound_bill_capture_atomic(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.post_inbound_bill_capture_atomic(uuid, uuid, text, boolean) to authenticated, service_role;

create or replace function public.reconcile_bank_feed_atomic(
  p_workspace_id uuid,
  p_tx_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_locked_count integer := 0;
  v_total_cents bigint := 0;
  v_updated_ids uuid[];
  v_existing_agent public.agent_action_ledger%rowtype;
  v_agent public.agent_action_ledger%rowtype;
  v_now timestamptz := now();
begin
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Valid idempotency_key required';
  end if;
  if coalesce(array_length(p_tx_ids, 1), 0) = 0 then
    raise exception 'At least one transaction id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':reconcile_bank', 9092));

  select * into v_existing_agent
  from public.agent_action_ledger
  where workspace_id = p_workspace_id
    and action_type = 'reconcile_bank_feed'
    and after_state->>'idempotency_key' = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'duplicate', true,
      'reconciled_count', coalesce(jsonb_array_length(v_existing_agent.after_state->'tx_ids'), 0),
      'agent_ledger_entry', to_jsonb(v_existing_agent)
    );
  end if;

  select count(*), coalesce(sum(amount_cents), 0), array_agg(id)
  into v_locked_count, v_total_cents, v_updated_ids
  from (
    select id, amount_cents
    from public.bank_feed_transactions
    where workspace_id = p_workspace_id
      and id = any(p_tx_ids)
      and status = 'auto_matched'
    for update
  ) locked;

  if v_locked_count = 0 or v_locked_count <> array_length(p_tx_ids, 1) then
    raise exception 'One or more bank transactions are not in auto_matched state or do not belong to this workspace';
  end if;

  update public.bank_feed_transactions
  set status = 'reconciled',
      idempotency_key = p_idempotency_key,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and id = any(v_updated_ids);

  insert into public.agent_action_ledger (
    workspace_id,
    agent_name,
    module,
    action_type,
    autonomy_mode,
    summary,
    impact_cents,
    before_state,
    after_state,
    status
  ) values (
    p_workspace_id,
    'Bank Feed Reconciler',
    'bookkeeping',
    'reconcile_bank_feed',
    'approve_1tap',
    format('Reconciled %s exact-cent bank transaction(s) ($%s)', v_locked_count, to_char(v_total_cents::numeric / 100.0, 'FM999999990.00')),
    v_total_cents::integer,
    jsonb_build_object('tx_ids', v_updated_ids, 'previous_status', 'auto_matched'),
    jsonb_build_object('tx_ids', v_updated_ids, 'next_status', 'reconciled', 'idempotency_key', p_idempotency_key),
    'executed'
  )
  returning * into v_agent;

  return jsonb_build_object(
    'duplicate', false,
    'reconciled_count', v_locked_count,
    'agent_ledger_entry', to_jsonb(v_agent)
  );
end;
$$;

revoke all on function public.reconcile_bank_feed_atomic(uuid, uuid[], text) from public, anon;
grant execute on function public.reconcile_bank_feed_atomic(uuid, uuid[], text) to authenticated, service_role;

create or replace function public.apply_job_change_order_atomic(
  p_workspace_id uuid,
  p_job_id uuid,
  p_expected_quoted_cents integer,
  p_new_quoted_cents integer,
  p_new_status text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.job_margin_records%rowtype;
  v_prev_quoted integer;
  v_prev_status text;
  v_delta integer;
  v_existing_agent public.agent_action_ledger%rowtype;
  v_agent public.agent_action_ledger%rowtype;
  v_now timestamptz := now();
begin
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Valid idempotency_key required';
  end if;
  if p_new_status not in ('healthy', 'margin_warning', 'over_budget') then
    raise exception 'Invalid job margin status';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':job_change_order', 9093));

  select * into v_existing_agent
  from public.agent_action_ledger
  where workspace_id = p_workspace_id
    and action_type = 'draft_job_change_order'
    and after_state->>'idempotency_key' = p_idempotency_key
  limit 1;

  if found then
    select * into v_job from public.job_margin_records where id = p_job_id and workspace_id = p_workspace_id;
    return jsonb_build_object(
      'duplicate', true,
      'updated_job', to_jsonb(v_job),
      'agent_ledger_entry', to_jsonb(v_existing_agent)
    );
  end if;

  select * into v_job
  from public.job_margin_records
  where workspace_id = p_workspace_id and id = p_job_id
  for update;

  if not found then
    raise exception 'Job margin record not found in workspace';
  end if;

  if v_job.quoted_revenue_cents <> p_expected_quoted_cents then
    raise exception 'Concurrent job update detected: expected quoted_revenue_cents % but current is %',
      p_expected_quoted_cents, v_job.quoted_revenue_cents;
  end if;

  v_delta := p_new_quoted_cents - p_expected_quoted_cents;
  if v_delta <= 0 then
    raise exception 'Change order must strictly increase quoted revenue';
  end if;

  v_prev_quoted := v_job.quoted_revenue_cents;
  v_prev_status := v_job.status;

  update public.job_margin_records
  set quoted_revenue_cents = p_new_quoted_cents,
      status = p_new_status,
      updated_at = v_now
  where workspace_id = p_workspace_id and id = p_job_id
  returning * into v_job;

  insert into public.agent_action_ledger (
    workspace_id,
    agent_name,
    module,
    action_type,
    autonomy_mode,
    summary,
    impact_cents,
    before_state,
    after_state,
    status
  ) values (
    p_workspace_id,
    'Live Job Margin Guard',
    'dispatch',
    'draft_job_change_order',
    'approve_1tap',
    format('Applied +$%s change order on %s', to_char(v_delta::numeric / 100.0, 'FM999999990.00'), v_job.job_name),
    v_delta,
    jsonb_build_object(
      'job_margin_id', v_job.id,
      'quoted_revenue_cents', v_prev_quoted,
      'status', v_prev_status
    ),
    jsonb_build_object(
      'job_margin_id', v_job.id,
      'quoted_revenue_cents', v_job.quoted_revenue_cents,
      'status', v_job.status,
      'idempotency_key', p_idempotency_key
    ),
    'executed'
  )
  returning * into v_agent;

  return jsonb_build_object(
    'duplicate', false,
    'updated_job', to_jsonb(v_job),
    'agent_ledger_entry', to_jsonb(v_agent)
  );
end;
$$;

revoke all on function public.apply_job_change_order_atomic(uuid, uuid, integer, integer, text, text) from public, anon;
grant execute on function public.apply_job_change_order_atomic(uuid, uuid, integer, integer, text, text) to authenticated, service_role;

create or replace function public.reverse_agent_action_atomic(
  p_workspace_id uuid,
  p_ledger_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.agent_action_ledger%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := now();
  v_le_id uuid;
  v_le public.ledger_entries%rowtype;
  v_capture_id uuid;
  v_alert_id uuid;
  v_linked_cap_id uuid;
begin
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':reverse_action', 9094));

  select * into v_entry
  from public.agent_action_ledger
  where workspace_id = p_workspace_id and id = p_ledger_id
  for update;

  if not found then
    raise exception 'Agent action ledger entry not found in workspace';
  end if;
  if v_entry.status <> 'executed' then
    raise exception 'Only executed ledger entries can be reversed (current status: %)', v_entry.status;
  end if;

  v_before := coalesce(v_entry.before_state, '{}'::jsonb);
  v_after := coalesce(v_entry.after_state, '{}'::jsonb);

  if v_entry.action_type = 'create_invoice' and nullif(v_after->>'invoice_id', '') is not null then
    update public.invoices
    set status = 'void', updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_after->>'invoice_id')::uuid;
  elsif v_entry.action_type = 'mark_invoice_paid' and nullif(v_after->>'invoice_id', '') is not null then
    update public.invoices
    set status = coalesce(nullif(v_before->>'invoice_status', ''), 'sent'),
        amount_paid_cents = coalesce((v_before->>'amount_paid_cents')::integer, 0),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_after->>'invoice_id')::uuid;
  elsif v_entry.action_type = 'stage_auto_po' and nullif(v_after->>'po_id', '') is not null then
    update public.purchase_orders
    set status = 'closed', updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_after->>'po_id')::uuid;
  elsif v_entry.action_type in ('approve_vendor_bill', 'dispute_vendor_bill', 'mark_vendor_bill_paid')
        and nullif(v_after->>'bill_id', '') is not null then
    update public.vendor_bills
    set match_status = coalesce(nullif(v_before->>'bill_match_status', ''), 'matched_clean'),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_after->>'bill_id')::uuid;

    if nullif(v_after->>'ledger_entry_id', '') is not null then
      v_le_id := (v_after->>'ledger_entry_id')::uuid;
      select * into v_le from public.ledger_entries where workspace_id = p_workspace_id and id = v_le_id;
      if found and not exists (
        select 1 from public.ledger_entries where workspace_id = p_workspace_id and reversal_of_entry_id = v_le_id
      ) then
        insert into public.ledger_entries (
          workspace_id, entity_id, entry_type, category, description,
          amount_cents, occurred_on, source_ref, reversal_of_entry_id
        ) values (
          p_workspace_id, v_le.entity_id, v_le.entry_type, v_le.category,
          'REVERSAL: ' || v_le.description, -v_le.amount_cents, v_now::date, v_le.source_ref, v_le_id
        );
      end if;
    end if;
  elsif v_entry.action_type = 'stage_compliance_notice' and nullif(v_after->>'vault_item_id', '') is not null then
    update public.compliance_vault_items
    set status = coalesce(nullif(v_before->>'vault_status', ''), 'expiring_soon'),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_after->>'vault_item_id')::uuid;
  elsif v_entry.action_type = 'promote_shadow_session' and nullif(v_after->>'shadow_session_id', '') is not null then
    if jsonb_typeof(v_before->'open_finding_ids') = 'array' then
      update public.shadow_findings
      set status = 'open', updated_at = v_now
      where workspace_id = p_workspace_id
        and session_id = (v_after->>'shadow_session_id')::uuid
        and id in (select (elem #>> '{}')::uuid from jsonb_array_elements(v_before->'open_finding_ids') elem);
    end if;
    update public.shadow_sessions
    set status = coalesce(nullif(v_before->>'session_status', ''), 'ready'),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_after->>'shadow_session_id')::uuid;
  elsif v_entry.action_type = 'stage_collections_run' and jsonb_typeof(v_after->'touch_ids') = 'array' then
    update public.collection_touches
    set status = 'reversed', updated_at = v_now
    where workspace_id = p_workspace_id
      and id in (select (elem #>> '{}')::uuid from jsonb_array_elements(v_after->'touch_ids') elem);
  elsif v_entry.action_type = 'execute_compiled_sop' and nullif(v_before->>'executable_sop_id', '') is not null then
    update public.executable_sops
    set status = coalesce(nullif(v_before->>'sop_status', ''), 'paused'),
        run_count = coalesce((v_before->>'run_count')::integer, 0),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_before->>'executable_sop_id')::uuid;
  elsif v_entry.action_type = 'override_vendor_fraud_alert' and nullif(v_before->>'alert_id', '') is not null then
    v_alert_id := (v_before->>'alert_id')::uuid;
    update public.vendor_fraud_alerts
    set status = coalesce(nullif(v_before->>'alert_status', ''), 'frozen'),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = v_alert_id
    returning capture_id into v_linked_cap_id;
    if v_linked_cap_id is not null then
      update public.inbound_bill_captures
      set match_status = 'fraud_frozen', updated_at = v_now
      where workspace_id = p_workspace_id and id = v_linked_cap_id and match_status <> 'posted';
    end if;
  elsif v_entry.action_type = 'post_inbound_bill_capture' and nullif(v_before->>'capture_id', '') is not null then
    v_capture_id := (v_before->>'capture_id')::uuid;
    update public.inbound_bill_captures
    set match_status = coalesce(nullif(v_before->>'previous_match_status', ''), '3way_matched'),
        human_verified = false,
        posted_ledger_entry_id = null,
        idempotency_key = null,
        updated_at = v_now
    where workspace_id = p_workspace_id and id = v_capture_id;

    if nullif(v_after->>'ledger_entry_id', '') is not null then
      v_le_id := (v_after->>'ledger_entry_id')::uuid;
      select * into v_le from public.ledger_entries where workspace_id = p_workspace_id and id = v_le_id;
      if found and not exists (
        select 1 from public.ledger_entries where workspace_id = p_workspace_id and reversal_of_entry_id = v_le_id
      ) then
        insert into public.ledger_entries (
          workspace_id, entity_id, entry_type, category, description,
          amount_cents, occurred_on, source_ref, reversal_of_entry_id
        ) values (
          p_workspace_id, v_le.entity_id, v_le.entry_type, v_le.category,
          'REVERSAL: ' || v_le.description, -v_le.amount_cents, v_now::date, v_le.source_ref, v_le_id
        );
      end if;
    end if;
  elsif v_entry.action_type = 'reconcile_bank_feed' and jsonb_typeof(v_before->'tx_ids') = 'array' then
    update public.bank_feed_transactions
    set status = coalesce(nullif(v_before->>'previous_status', ''), 'auto_matched'),
        updated_at = v_now
    where workspace_id = p_workspace_id
      and id in (select (elem #>> '{}')::uuid from jsonb_array_elements(v_before->'tx_ids') elem);
  elsif v_entry.action_type = 'draft_job_change_order' and nullif(v_before->>'job_margin_id', '') is not null then
    update public.job_margin_records
    set quoted_revenue_cents = coalesce((v_before->>'quoted_revenue_cents')::integer, quoted_revenue_cents),
        status = coalesce(nullif(v_before->>'status', ''), 'margin_warning'),
        updated_at = v_now
    where workspace_id = p_workspace_id and id = (v_before->>'job_margin_id')::uuid;
  end if;

  update public.agent_action_ledger
  set status = 'reversed',
      reversed_at = v_now
  where workspace_id = p_workspace_id and id = p_ledger_id and status = 'executed'
  returning * into v_entry;

  return to_jsonb(v_entry);
end;
$$;

revoke all on function public.reverse_agent_action_atomic(uuid, uuid) from public, anon;
grant execute on function public.reverse_agent_action_atomic(uuid, uuid) to authenticated, service_role;

-- 5. Security & Multi-Tenant RLS Hardening

-- 5a. Lock down public_leads against cross-tenant reads, hijacks & anon workspace spoofing
drop policy if exists "anon can insert leads" on public.public_leads;
create policy "anon can insert leads"
  on public.public_leads for insert
  to anon
  with check (
    workspace_id is null
    and status = 'DRAFT_READY'
    and call_outcome is null
    and outreach_lane in ('trades_clinics', 'bookkeepers_cpa', 'inbound_calculator')
  );

drop policy if exists "workspace members can read own leads" on public.public_leads;
create policy "workspace members can read own leads"
  on public.public_leads for select
  to authenticated
  using (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace members can update own leads" on public.public_leads;
create policy "workspace members can update own leads"
  on public.public_leads for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- 5b. Upgrade bot_manuals, staged_ops_actions, staged_ledger_entries, workspace_mcp_tokens to owner-only
drop policy if exists "workspace members can read bot manuals" on public.bot_manuals;
drop policy if exists "workspace members can upsert bot manuals" on public.bot_manuals;
drop policy if exists "workspace members can update bot manuals" on public.bot_manuals;
create policy "workspace owners manage bot manuals"
  on public.bot_manuals for all
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace members can read staged ops actions" on public.staged_ops_actions;
drop policy if exists "workspace members can insert staged ops actions" on public.staged_ops_actions;
drop policy if exists "workspace members can update staged ops actions" on public.staged_ops_actions;
create policy "workspace owners manage staged ops actions"
  on public.staged_ops_actions for all
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace members can read staged ledger entries" on public.staged_ledger_entries;
drop policy if exists "workspace members can insert staged ledger entries" on public.staged_ledger_entries;
drop policy if exists "workspace members can update staged ledger entries" on public.staged_ledger_entries;
create policy "workspace owners manage staged ledger entries"
  on public.staged_ledger_entries for all
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "workspace members can read mcp tokens" on public.workspace_mcp_tokens;
create policy "workspace owners read mcp tokens"
  on public.workspace_mcp_tokens for select
  to authenticated
  using (public.is_workspace_owner(workspace_id));

-- 5c. Make agent_action_ledger append-only (revoke DELETE from authenticated)
drop policy if exists "workspace owners delete agent ledger" on public.agent_action_ledger;

-- 5d. Scope ops_drafts_lead_step_unique_idx per workspace_id
drop index if exists public.ops_drafts_lead_step_unique_idx;
create unique index if not exists ops_drafts_lead_step_unique_idx
  on public.ops_communication_drafts (workspace_id, lead_id, sequence_step)
  where lead_id is not null;

-- 6. Stripe Refund Event Ledger
create table if not exists public.stripe_refund_events (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid references public.workspaces(id) on delete cascade,
  stripe_event_id        text not null unique,
  charge_id              text not null,
  refund_id              text,
  provider_customer_id   text,
  amount_refunded_cents  integer not null check (amount_refunded_cents >= 0),
  currency               text not null default 'usd',
  reason                 text,
  refund_status          text not null default 'succeeded',
  created_at             timestamptz not null default now()
);

create index if not exists stripe_refund_events_ws_idx
  on public.stripe_refund_events (workspace_id, created_at desc);

alter table public.stripe_refund_events enable row level security;
revoke all on table public.stripe_refund_events from public, anon;
grant select on table public.stripe_refund_events to authenticated;

drop policy if exists "workspace owners read stripe refunds" on public.stripe_refund_events;
create policy "workspace owners read stripe refunds"
  on public.stripe_refund_events for select
  to authenticated
  using (public.is_workspace_owner(workspace_id));

-- 7. Phase 5: Shared Autonomous Workforce Task Ledger & Atomic Lease Claim
create table if not exists public.agent_workforce_tasks (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  correlation_id          uuid not null default gen_random_uuid(),
  parent_task_id          uuid references public.agent_workforce_tasks(id) on delete set null,
  assigned_role           text not null check (
    assigned_role in (
      'ceo_orchestrator',
      'market_research',
      'prospect_qualification',
      'business_intelligence',
      'sales_followup',
      'financial_operations',
      'document_processing',
      'customer_operations',
      'compliance_quality',
      'engineering_monitoring'
    )
  ),
  provider                text not null check (
    provider in ('gemini', 'grok', 'ollama_local', 'opencode', 'deterministic_engine')
  ),
  title                   text not null,
  expected_outcome        text not null,
  completion_test         text not null,
  payload                 jsonb not null default '{}'::jsonb,
  hop_count               integer not null default 0 check (hop_count >= 0),
  max_hops                integer not null default 2 check (max_hops between 0 and 2),
  visited_roles           text[] not null default '{}',
  lease_token             uuid,
  lease_expires_at        timestamptz,
  attempts                integer not null default 0 check (attempts >= 0),
  max_attempts            integer not null default 3 check (max_attempts between 1 and 5),
  next_retry_at           timestamptz,
  budget_cents            integer not null default 500 check (budget_cents >= 0),
  spent_cents             integer not null default 0 check (spent_cents >= 0),
  token_budget            integer not null default 20000 check (token_budget >= 0),
  tokens_used             integer not null default 0 check (tokens_used >= 0),
  requires_human_approval boolean not null default true,
  approval_status         text not null default 'pending' check (
    approval_status in ('not_required', 'pending', 'approved', 'rejected')
  ),
  status                  text not null default 'queued' check (
    status in ('queued', 'leased', 'awaiting_approval', 'completed', 'dead_letter', 'cancelled')
  ),
  dead_letter_reason      text,
  escalated_to            text,
  idempotency_key         text not null,
  deadline_at             timestamptz not null default (now() + interval '24 hours'),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  check (hop_count <= max_hops)
);

create index if not exists agent_workforce_tasks_claim_idx
  on public.agent_workforce_tasks (workspace_id, status, next_retry_at, created_at asc);

alter table public.agent_workforce_tasks enable row level security;
revoke all on table public.agent_workforce_tasks from public, anon;
grant select, insert, update on table public.agent_workforce_tasks to authenticated;

drop policy if exists "workspace owners manage workforce tasks" on public.agent_workforce_tasks;
create policy "workspace owners manage workforce tasks"
  on public.agent_workforce_tasks for all
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create or replace function public.claim_workforce_task_atomic(
  p_workspace_id uuid,
  p_assigned_role text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.agent_workforce_tasks%rowtype;
  v_lease uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Workspace owner or admin permission required' using errcode = '42501';
  end if;

  select * into v_task
  from public.agent_workforce_tasks t
  where t.workspace_id = p_workspace_id
    and t.assigned_role = p_assigned_role
    and t.status in ('queued', 'leased')
    and (t.status = 'queued' or (t.lease_expires_at is not null and t.lease_expires_at < v_now))
    and (t.next_retry_at is null or t.next_retry_at <= v_now)
    and t.attempts < t.max_attempts
    and t.spent_cents <= t.budget_cents
    and t.tokens_used <= t.token_budget
    and t.deadline_at > v_now
  order by t.created_at asc
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('claimed', false, 'task', null);
  end if;

  update public.agent_workforce_tasks
  set status = 'leased',
      lease_token = v_lease,
      lease_expires_at = v_now + make_interval(secs => greatest(30, least(1800, coalesce(p_lease_seconds, 300)))),
      attempts = attempts + 1,
      updated_at = v_now
  where id = v_task.id
  returning * into v_task;

  return jsonb_build_object('claimed', true, 'task', to_jsonb(v_task));
end;
$$;

revoke all on function public.claim_workforce_task_atomic(uuid, text, integer) from public, anon;
grant execute on function public.claim_workforce_task_atomic(uuid, text, integer) to authenticated, service_role;
