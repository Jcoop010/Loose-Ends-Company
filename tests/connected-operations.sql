-- Run AFTER the migration inside BEGIN/ROLLBACK. No fixture survives this suite.
create function pg_temp.assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAILED: %',msg; end if; end$$;
create function pg_temp.denied(ws uuid,action text,payload jsonb,k text) returns boolean language plpgsql as $$begin perform public.ops_command(ws,action,payload,k); return false; exception when others then return true; end$$;
select set_config('test.ops_user',(select id::text from auth.users order by created_at limit 1),true);
select set_config('test.ops_ws',gen_random_uuid()::text,true);
select set_config('test.other_ws',gen_random_uuid()::text,true);
insert into public.workspaces(id,name,slug,owner_user_id) values(current_setting('test.ops_ws')::uuid,'Operations rollback QA','ops-qa-'||gen_random_uuid(),current_setting('test.ops_user')::uuid),(current_setting('test.other_ws')::uuid,'Other rollback QA','ops-other-'||gen_random_uuid(),null);
insert into public.workspace_members(workspace_id,user_id,role) values(current_setting('test.ops_ws')::uuid,current_setting('test.ops_user')::uuid,'owner');
select set_config('request.jwt.claim.sub',current_setting('test.ops_user'),true);
set local role authenticated;
do $$declare ws uuid:=current_setting('test.ops_ws')::uuid; item uuid; job uuid; po uuid; a jsonb; b jsonb; n integer; begin
 a:=public.ops_command(ws,'inventory_save','{"name":"QA part","sku":"QA1","purchase_cost":10,"selling_price":20,"reorder_threshold":2,"reorder_quantity":5}','qa-item-0001'); item:=(a->>'id')::uuid;
 perform pg_temp.assert(pg_temp.denied(current_setting('test.other_ws')::uuid,'stock_move',jsonb_build_object('id',item,'kind','receipt','quantity',5,'reason','QA'),'cross-tenant-1'),'cross-workspace rejection');
 perform pg_temp.assert(pg_temp.denied(ws,'inventory_save','{"name":"Bad","sku":"NaN","purchase_cost":"NaN"}','invalid-nan-1'),'reject NaN prices');
 a:=public.ops_command(ws,'stock_move',jsonb_build_object('id',item,'kind','receipt','quantity',5,'reason','QA'),'qa-receipt-1');
 b:=public.ops_command(ws,'stock_move',jsonb_build_object('id',item,'kind','receipt','quantity',5,'reason','QA'),'qa-receipt-1');
 perform pg_temp.assert(a=b,'replayed receipt');
 perform pg_temp.assert((select quantity=5 from public.inventory_items where id=item),'no duplicate receipt');
 perform pg_temp.assert(pg_temp.denied(ws,'stock_move',jsonb_build_object('id',item,'kind','adjustment','quantity',-6,'reason','QA'),'qa-negative-1'),'negative stock rejected');
 perform pg_temp.assert(pg_temp.denied(ws,'stock_move',jsonb_build_object('id',item,'kind','receipt','quantity',6,'reason','QA'),'qa-receipt-1'),'key content mismatch rejected');
 a:=public.ops_command(ws,'job_save','{"title":"QA work","labor_total":50}','qa-job-0001');job:=(a->>'id')::uuid;
 perform public.ops_command(ws,'reserve_material',jsonb_build_object('id',job,'item_id',item,'quantity',3),'qa-reserve-1');
 perform pg_temp.assert(pg_temp.denied(ws,'stock_move',jsonb_build_object('id',item,'kind','adjustment','quantity',-3,'reason','QA'),'qa-reserved-1'),'reserved stock protected');
 perform pg_temp.assert(pg_temp.denied(ws,'job_transition',jsonb_build_object('id',job,'status','completed','checklist_confirmed',true),'qa-skip-0001'),'cannot skip approval');
 perform public.ops_command(ws,'job_transition',jsonb_build_object('id',job,'status','quoted'),'qa-quote-001');
 perform pg_temp.assert(pg_temp.denied(ws,'job_transition',jsonb_build_object('id',job,'status','approved'),'qa-no-evidence'),'approval evidence mandatory');
 perform public.ops_command(ws,'job_transition',jsonb_build_object('id',job,'status','approved','approval_evidence','QA written acceptance'),'qa-approve-1');
 perform public.ops_command(ws,'job_transition',jsonb_build_object('id',job,'status','in_progress'),'qa-start-001');
 perform pg_temp.assert(pg_temp.denied(ws,'job_transition',jsonb_build_object('id',job,'status','completed'),'qa-no-checklist'),'checklist confirmation mandatory');
 a:=public.ops_command(ws,'job_transition',jsonb_build_object('id',job,'status','completed','checklist_confirmed',true),'qa-complete-1');
 b:=public.ops_command(ws,'job_transition',jsonb_build_object('id',job,'status','completed','checklist_confirmed',true),'qa-complete-2');
 perform pg_temp.assert(a->>'invoice_id'=b->>'invoice_id','completion uses single invoice');
 perform pg_temp.assert((select quantity=2 and reserved=0 from public.inventory_items where id=item),'stock consumed once');
 perform pg_temp.assert((select total=110 and status='draft' from public.documents where id=(a->>'invoice_id')::uuid),'atomic draft invoice total');
 perform public.ops_command(ws,'policy_save','{"enabled":true,"draft_limit":1000}','qa-policy-01');
 perform pg_temp.assert((select count(*)=0 from public.inventory_items where workspace_id=current_setting('test.other_ws')::uuid),'RLS tenant filtering');
end$$;
reset role;
select le_ops.tick();
set local role authenticated;
do $$declare ws uuid:=current_setting('test.ops_ws')::uuid; item uuid; po uuid; before_qty numeric; begin
 select id into item from public.inventory_items where workspace_id=ws;
 select id into po from public.ops_purchase_orders where workspace_id=ws;
 perform pg_temp.assert(po is not null,'backend queue prepared purchase draft');
 perform pg_temp.assert((select status='completed' and result->>'outcome'='draft_verified' from public.ops_queue where workspace_id=ws),'provider-independent action verified');
 perform public.ops_command(ws,'purchase_transition',jsonb_build_object('id',po,'status','approved'),'qa-po-approve');
 perform pg_temp.assert(pg_temp.denied(ws,'purchase_transition',jsonb_build_object('id',po,'status','received'),'qa-po-no-receipt'),'receiving needs evidence');
 perform public.ops_command(ws,'purchase_transition',jsonb_build_object('id',po,'status','received','receipt_reference','QA delivery 1'),'qa-po-receive');
 perform public.ops_command(ws,'purchase_transition',jsonb_build_object('id',po,'status','received','receipt_reference','QA delivery 1'),'qa-po-replay2');
 perform pg_temp.assert((select quantity=7 from public.inventory_items where id=item),'receiving deduplicated');
 perform public.ops_command(ws,'policy_save','{"enabled":false}','qa-kill-0001');
end$$;
-- Existing calendar receives the same database conflict guard.
insert into public.appointments(workspace_id,title,starts_at,ends_at) values(current_setting('test.ops_ws')::uuid,'QA booking','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z');
do $$begin
 begin
 insert into public.appointments(workspace_id,title,starts_at,ends_at) values(current_setting('test.ops_ws')::uuid,'QA conflict','2099-01-01T10:30:00Z','2099-01-01T11:30:00Z');
 raise exception 'FAILED: conflict was accepted';
 exception when others then if sqlerrm like 'FAILED:%' then raise; end if; end;
end$$;
reset role;
update public.workspace_members set role='member' where workspace_id=current_setting('test.ops_ws')::uuid;
set local role authenticated;
select pg_temp.assert(pg_temp.denied(current_setting('test.ops_ws')::uuid,'policy_save','{"enabled":true}','qa-member-01'),'member cannot alter policies');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 begin perform public.ops_command(current_setting('test.ops_ws')::uuid,'policy_save','{}','qa-anon-0001');raise exception 'FAILED: anonymous RPC accepted';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'Connected operations database assertions passed; all fixtures rolled back' as result;
