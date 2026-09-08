-- Keep the database lifecycle expressive enough for the recovery pipeline shown by the app.
alter table public.opportunities drop constraint if exists opportunities_status_check;
alter table public.opportunities add constraint opportunities_status_check
  check (status = any (array['open'::text,'contacted'::text,'responded'::text,'scheduled'::text,'completed'::text,'recovered'::text,'dismissed'::text]));

-- Foreign-key indexes used by the revenue graph and action layer.
create index if not exists appointments_opportunity_idx on public.appointments(opportunity_id) where opportunity_id is not null;
create index if not exists contacts_customer_idx on public.contacts(customer_id);
create index if not exists documents_opportunity_idx on public.documents(opportunity_id) where opportunity_id is not null;
create index if not exists tasks_opportunity_idx on public.tasks(opportunity_id) where opportunity_id is not null;
create index if not exists loose_ends_opportunity_idx on public.loose_ends(opportunity_id) where opportunity_id is not null;

-- The queue is the product's hot path.
create index if not exists loose_ends_workspace_queue_idx
  on public.loose_ends(workspace_id, status, priority, score desc, next_action_at)
  where status in ('open','in_progress');
