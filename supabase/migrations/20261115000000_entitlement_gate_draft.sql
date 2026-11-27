-- DRAFT (2026-11-15) — NOT APPLIED. For owner and counsel/DB review.
-- Purpose: single source of truth for "may this workspace use Loose Ends OS premium surfaces?"
-- Context: new workspaces auto-provision workspace_subscriptions { plan_key='trial',
--   status='trialing', trial_ends_at=now()+14d, current_period_end=now()+14d } (see
--   20261011142500_align_default_workflow_triggers.sql / initialize_workspace_saas_state).
--   Paid lifecycle arrives only via the Stripe webhook (apply_stripe_subscription_event).
-- This function grants no write access and exposes only a boolean.
-- Owner decision flags:
--   * past_due grace: default EXCLUDES it; pass p_include_grace := true to honor a grace period
--     (recommended to mirror the client gate's allowPastDue option).
--   * Where to attach enforcement (behind owner/legal choices): billing page stays reachable;
--     premium views gate on this function; direct table-write hardening stays per existing RLS.

create or replace function public.is_workspace_entitled(p_workspace_id uuid, p_include_grace boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_subscriptions s
    where s.workspace_id = p_workspace_id
      and (
        (s.status in ('trialing','active')
         and (s.current_period_end is null or s.current_period_end > now()))
        or (p_include_grace
            and s.status = 'past_due'
            and (s.current_period_end is null or s.current_period_end > now()))
      )
  );
$$;

revoke all on function public.is_workspace_entitled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.is_workspace_entitled(uuid, boolean) to authenticated;

comment on function public.is_workspace_entitled(uuid, boolean) is
  'DRAFT 2026-11-15: returns true when the workspace subscription is trialing/active with an unexpired period (optionally past_due grace). Client mirror: v3.1/entitlement-gate.js. Apply only with owner approval + legal sign-off of TERMS/REFUNDS drafts.';
