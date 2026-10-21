create or replace function public.ops_summary(p_workspace uuid) returns jsonb language sql stable security invoker set search_path='' as $$
with tz as (select coalesce((select timezone from public.ops_policies where workspace_id=p_workspace),(select s.timezone from public.workspace_settings s where workspace_id=p_workspace and exists(select 1 from pg_timezone_names n where n.name=s.timezone)),'America/New_York') as name)
select jsonb_build_object(
 'open_jobs',(select count(*) from public.ops_jobs where workspace_id=p_workspace and status not in ('completed','cancelled')),
 'open_estimates',(select count(*) from public.ops_jobs where workspace_id=p_workspace and status in ('draft','quoted')),
 'today_jobs',(select count(*) from public.appointments where workspace_id=p_workspace and starts_at>=(date_trunc('day',now() at time zone tz.name) at time zone tz.name) and starts_at<((date_trunc('day',now() at time zone tz.name)+interval '1 day') at time zone tz.name) and status not in ('cancelled','canceled')),
 'low_stock',(select count(*) from public.inventory_items where workspace_id=p_workspace and not archived and quantity-reserved<=reorder_threshold),
 'inventory_value',(select coalesce(sum(quantity*purchase_cost),0) from public.inventory_items where workspace_id=p_workspace and not archived),
 'urgent_tasks',(select count(*) from public.tasks where workspace_id=p_workspace and status='open' and due_at<now()),
 'invoice_total',(select coalesce(sum(total),0) from public.documents where workspace_id=p_workspace and document_type='invoice' and status not in ('draft','cancelled')),
 'unpaid_invoices',(select coalesce(sum(total),0) from public.documents where workspace_id=p_workspace and document_type='invoice' and status in ('sent','overdue')),
 'owner_reported_paid',(select coalesce(sum(total),0) from public.documents where workspace_id=p_workspace and document_type='invoice' and status='paid'),
 'verified_collections',(select coalesce(sum(amount_cents),0)/100.0 from public.verified_recovery_payments where workspace_id=p_workspace and currency='usd' and provider_verified_at is not null),
 'expenses',(select coalesce(sum(amount),0) from public.ops_expenses where workspace_id=p_workspace),
 'bills_due',(select coalesce(sum(amount),0) from public.ops_expenses where workspace_id=p_workspace and not paid),
 'awaiting_approval',(select count(*) from public.ops_purchase_orders where workspace_id=p_workspace and status='draft'),
 'failed_operations',(select count(*) from public.ops_queue where workspace_id=p_workspace and status='dead_letter')
) from tz where public.is_workspace_member(p_workspace);
$$;

create function public.ops_invoice_aging(p_workspace uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'not_due',coalesce(sum(total) filter(where due_at>=now() or due_at is null),0),
 'days_1_30',coalesce(sum(total) filter(where due_at<now() and due_at>=now()-interval '30 days'),0),
 'days_31_60',coalesce(sum(total) filter(where due_at<now()-interval '30 days' and due_at>=now()-interval '60 days'),0),
 'days_61_90',coalesce(sum(total) filter(where due_at<now()-interval '60 days' and due_at>=now()-interval '90 days'),0),
 'over_90',coalesce(sum(total) filter(where due_at<now()-interval '90 days'),0)
) from public.documents where workspace_id=p_workspace and document_type='invoice' and status in ('sent','overdue') and public.is_workspace_member(p_workspace);
$$;
revoke all on function public.ops_invoice_aging(uuid) from public,anon;
grant execute on function public.ops_invoice_aging(uuid) to authenticated;
