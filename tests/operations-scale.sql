-- Bounded synthetic workload, entirely rolled back. Not a concurrency/throughput guarantee.
select set_config('test.scale_user',(select id::text from auth.users order by created_at limit 1),true);
select set_config('test.scale_ws',gen_random_uuid()::text,true);
insert into public.workspaces(id,name,slug,owner_user_id) values(current_setting('test.scale_ws')::uuid,'Rollback scale QA','scale-qa-'||gen_random_uuid(),current_setting('test.scale_user')::uuid);
insert into public.workspace_members(workspace_id,user_id,role) values(current_setting('test.scale_ws')::uuid,current_setting('test.scale_user')::uuid,'owner');
insert into public.inventory_items(workspace_id,name,sku,quantity,purchase_cost,reorder_threshold) select current_setting('test.scale_ws')::uuid,'Synthetic inventory '||i,'QA-'||lpad(i::text,6,'0'),10,2,2 from generate_series(1,5000) i;
insert into public.customers(workspace_id,first_name,last_name,email) select current_setting('test.scale_ws')::uuid,'Synthetic customer',i::text,'qa-'||i||'@example.invalid' from generate_series(1,2000) i;
select set_config('request.jwt.claim.sub',current_setting('test.scale_user'),true);
set local role authenticated;
do $$declare started timestamptz;summary jsonb;page_count integer;begin
 started:=clock_timestamp();summary:=public.ops_summary(current_setting('test.scale_ws')::uuid);
 if (summary->>'inventory_value')::numeric<>100000 then raise exception 'Incorrect inventory aggregate at scale';end if;
 perform set_config('test.scale_summary_ms',(extract(epoch from clock_timestamp()-started)*1000)::text,true);
 started:=clock_timestamp();select count(*) into page_count from (select id from public.inventory_items where workspace_id=current_setting('test.scale_ws')::uuid and not archived order by sku limit 50) p;
 if page_count<>50 then raise exception 'Incorrect inventory page size';end if;
 perform set_config('test.scale_page_ms',(extract(epoch from clock_timestamp()-started)*1000)::text,true);
 if (select count(*) from public.customers where workspace_id=current_setting('test.scale_ws')::uuid)<>2000 then raise exception 'Incorrect customer count';end if;
end$$;
reset role;
select jsonb_build_object('inventory_records',5000,'customers',2000,'summary_ms',current_setting('test.scale_summary_ms')::numeric,'inventory_page_ms',current_setting('test.scale_page_ms')::numeric,'fixture_rollback_required',true) as scale_evidence;
