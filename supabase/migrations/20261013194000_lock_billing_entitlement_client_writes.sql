-- Subscription status, plan, customer/subscription identifiers, and billing periods
-- are derived from trusted billing events. Workspace admins must not be able to
-- grant themselves a paid plan by updating the entitlement row directly.
REVOKE UPDATE ON TABLE public.workspace_subscriptions FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS subscriptions_admin_update ON public.workspace_subscriptions;

-- QuickBooks connection state is likewise server-owned. This bridge currently only
-- reads status; future OAuth callbacks/sync workers must write through trusted code.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.quickbooks_connections FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS quickbooks_connection_admin_insert ON public.quickbooks_connections;
DROP POLICY IF EXISTS quickbooks_connection_admin_update ON public.quickbooks_connections;
DROP POLICY IF EXISTS quickbooks_connection_admin_delete ON public.quickbooks_connections;
