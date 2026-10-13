-- Billing entitlements and integration connection state are authoritative server records.
-- Authenticated workspace admins may read them, but must not mint paid access or
-- forge an integration's connected/synced status through direct table writes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workspace_subscriptions FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS subscriptions_admin_update ON public.workspace_subscriptions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.quickbooks_connections FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS quickbooks_connection_admin_insert ON public.quickbooks_connections;
DROP POLICY IF EXISTS quickbooks_connection_admin_update ON public.quickbooks_connections;
DROP POLICY IF EXISTS quickbooks_connection_admin_delete ON public.quickbooks_connections;

-- Existing workspace-scoped SELECT policies remain in place. Trusted Edge Functions
-- use service_role for webhook reconciliation and integration state transitions.
