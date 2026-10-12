create policy stripe_webhook_events_no_client_access
on public.stripe_webhook_events
for all
to anon, authenticated
using (false)
with check (false);
