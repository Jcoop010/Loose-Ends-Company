-- Release 3: Enterprise Autonomy Layer (Compliance Vault, Living SOPs & Vault Default)

-- 1. Enable vault module by default in workspace_settings.modules_enabled
alter table public.workspace_settings
  alter column modules_enabled
  set default '{"crm":true,"quotes":true,"billing":true,"inventory":false,"bookkeeping":false,"projects":false,"vault":true}'::jsonb;

update public.workspace_settings
set modules_enabled = jsonb_set(coalesce(modules_enabled, '{}'::jsonb), '{vault}', 'true'::jsonb, true),
    updated_at = now()
where modules_enabled is null
   or (modules_enabled->'vault') is null
   or (modules_enabled->>'vault') = 'false';

-- 2. public.compliance_vault_items
create table if not exists public.compliance_vault_items (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  doc_type           text not null check (doc_type in ('contract', 'coi', 'license', 'saas_renewal', 'lease')),
  title              text not null,
  counterparty       text not null,
  expires_on         date not null,
  notice_window_days integer not null default 45 check (notice_window_days >= 0),
  annual_value_cents integer not null default 0 check (annual_value_cents >= 0),
  status             text not null default 'active' check (
    status in ('active', 'expiring_soon', 'notice_staged', 'expired', 'cancelled')
  ),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists compliance_vault_items_workspace_expires_idx
  on public.compliance_vault_items (workspace_id, expires_on asc);

create index if not exists compliance_vault_items_workspace_status_idx
  on public.compliance_vault_items (workspace_id, status);

-- 3. public.living_sops
create table if not exists public.living_sops (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  module_key       text not null,
  title            text not null,
  trigger_event    text not null,
  steps_json       jsonb not null default '[]'::jsonb check (jsonb_typeof(steps_json) = 'array'),
  version          integer not null default 1 check (version >= 1),
  auto_generated   boolean not null default true,
  last_observed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists living_sops_workspace_module_title_idx
  on public.living_sops (workspace_id, module_key, title);

create index if not exists living_sops_workspace_module_updated_idx
  on public.living_sops (workspace_id, module_key, updated_at desc);

-- 4. Strict Workspace-Owner RLS on Release 3 Tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['compliance_vault_items', 'living_sops'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);

    execute format('drop policy if exists "workspace owners select %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners select %s" on public.%I for select to authenticated using (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );

    execute format('drop policy if exists "workspace owners insert %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners insert %s" on public.%I for insert to authenticated with check (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );

    execute format('drop policy if exists "workspace owners update %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners update %s" on public.%I for update to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );

    execute format('drop policy if exists "workspace owners delete %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "workspace owners delete %s" on public.%I for delete to authenticated using (public.is_workspace_owner(workspace_id))',
      tbl, tbl
    );
  end loop;
end $$;
