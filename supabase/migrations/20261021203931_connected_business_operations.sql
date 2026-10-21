-- Additive operations model. Existing customer, billing, import and workflow data is untouched.
create schema if not exists le_ops;
revoke all on schema le_ops from public, anon;
grant usage on schema le_ops to authenticated;

create table public.inventory_items (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(trim(name)) between 1 and 200), sku text not null check(length(sku) between 1 and 100),
 barcode text, category text, description text, supplier text, location text,
 purchase_cost numeric(14,2) not null default 0 check(purchase_cost>=0), selling_price numeric(14,2) not null default 0 check(selling_price>=0),
 quantity numeric(14,3) not null default 0 check(quantity>=0), reserved numeric(14,3) not null default 0 check(reserved>=0 and reserved<=quantity),
 reorder_threshold numeric(14,3) not null default 0 check(reorder_threshold>=0), reorder_quantity numeric(14,3) not null default 1 check(reorder_quantity>0),
 archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,sku)
);
create index inventory_search on public.inventory_items(workspace_id,archived,sku);
create table public.ops_jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 customer_id uuid references public.customers(id), title text not null check(length(trim(title)) between 1 and 200),
 status text not null default 'draft' check(status in ('draft','quoted','approved','scheduled','in_progress','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 assigned_to uuid, notes text, checklist jsonb not null default '[]', labor_total numeric(14,2) not null default 0 check(labor_total>=0),
 approved_at timestamptz, approval_evidence text, completed_at timestamptz, invoice_id uuid references public.documents(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,id)
);
create index ops_jobs_workspace_status on public.ops_jobs(workspace_id,status,created_at desc);
create table public.job_materials (
 workspace_id uuid not null, job_id uuid not null, item_id uuid not null,
 quantity numeric(14,3) not null check(quantity>0), unit_cost numeric(14,2) not null, unit_price numeric(14,2) not null,
 state text not null default 'reserved' check(state in ('reserved','consumed','released')),
 primary key(job_id,item_id), foreign key(workspace_id,job_id) references public.ops_jobs(workspace_id,id),
 foreign key(workspace_id,item_id) references public.inventory_items(workspace_id,id)
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, item_id uuid not null, job_id uuid,
 kind text not null check(kind in ('receipt','adjustment','return','reserve','release','consume')),
 quantity numeric(14,3) not null, balance numeric(14,3) not null check(balance>=0), reason text not null,
 actor_id uuid, created_at timestamptz not null default now(),
 foreign key(workspace_id,item_id) references public.inventory_items(workspace_id,id),
 foreign key(workspace_id,job_id) references public.ops_jobs(workspace_id,id)
);
create index inventory_history on public.inventory_movements(workspace_id,item_id,created_at desc);
create table public.ops_purchase_orders (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,item_id uuid not null,
 supplier text,quantity numeric(14,3) not null check(quantity>0),unit_cost numeric(14,2) not null check(unit_cost>=0),
 status text not null default 'draft' check(status in ('draft','approved','denied','received')),
 approved_by uuid, receipt_reference text, created_at timestamptz not null default now(),
 foreign key(workspace_id,item_id) references public.inventory_items(workspace_id,id)
);
create unique index ops_one_open_purchase on public.ops_purchase_orders(workspace_id,item_id) where status in ('draft','approved');
create table public.ops_policies (
 workspace_id uuid primary key references public.workspaces(id), enabled boolean not null default false,
 draft_limit numeric(14,2) not null default 1000 check(draft_limit>=0), industry text not null default 'general',
 updated_by uuid,updated_at timestamptz not null default now()
);
create table public.ops_queue (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),item_id uuid not null,
 event_key text not null, status text not null default 'pending' check(status in ('pending','running','completed','deferred','dead_letter','cancelled')),
 attempts integer not null default 0, available_at timestamptz not null default now(), started_at timestamptz,completed_at timestamptz,
 result jsonb,error text,created_at timestamptz not null default now(),unique(workspace_id,event_key),
 foreign key(workspace_id,item_id) references public.inventory_items(workspace_id,id)
);
create index ops_queue_claim on public.ops_queue(status,available_at);
create table public.ops_audit (
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),
 actor_id uuid,action text not null,entity_id uuid,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create index ops_audit_workspace on public.ops_audit(workspace_id,created_at desc);
create table public.ops_expenses (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 job_id uuid, vendor text not null, description text, amount numeric(14,2) not null check(amount>=0 and amount::text<>'NaN'),
 due_at date, paid boolean not null default false, created_at timestamptz not null default now(),
 foreign key(workspace_id,job_id) references public.ops_jobs(workspace_id,id)
);
create index ops_expenses_workspace on public.ops_expenses(workspace_id,created_at desc);
create table le_ops.receipts (
 workspace_id uuid not null,key text not null,action text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(workspace_id,key)
);
alter table le_ops.receipts enable row level security;

-- Only authenticated workspace members can read. Mutations go through validated commands.
do $$ declare t text; begin
 foreach t in array array['inventory_items','ops_jobs','job_materials','inventory_movements','ops_purchase_orders','ops_policies','ops_queue','ops_audit','ops_expenses'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy workspace_read on public.%I for select to authenticated using(public.is_workspace_member(workspace_id))',t);
 end loop;
end $$;

create function le_ops.command(p_workspace uuid,p_action text,p_payload jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
declare
 u uuid:=auth.uid(); r le_ops.receipts; out jsonb; ident uuid; item public.inventory_items; job public.ops_jobs;
 mat public.job_materials; po public.ops_purchase_orders; qty numeric; inv uuid; total numeric; cust uuid; assigned uuid; target text;
begin
 if u is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=u and role in ('owner','admin')) then
 raise exception 'Owner or administrator permission required' using errcode='42501'; end if;
 if p_key is null or length(p_key) not between 8 and 150 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 then raise exception 'Invalid command'; end if;
 -- Serializes a workspace command, preventing concurrent duplicate receipts and stock races.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,73021));
 select * into r from le_ops.receipts where workspace_id=p_workspace and key=p_key;
 if found then
 if r.action<>p_action or r.payload<>p_payload then raise exception 'Idempotency key reused with different content'; end if;
 return r.result; end if;
 if (select count(*) from le_ops.receipts where workspace_id=p_workspace and created_at>now()-interval '1 minute')>=120 then raise exception 'Workspace operation rate limit reached; retry shortly'; end if;
 ident:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
 if p_action='inventory_save' then
 if exists(select 1 from public.inventory_items where id=ident and workspace_id<>p_workspace) then raise exception 'Item unavailable'; end if;
 insert into public.inventory_items(id,workspace_id,name,sku,barcode,category,description,supplier,location,purchase_cost,selling_price,reorder_threshold,reorder_quantity)
 values(ident,p_workspace,trim(p_payload->>'name'),trim(p_payload->>'sku'),p_payload->>'barcode',p_payload->>'category',p_payload->>'description',p_payload->>'supplier',p_payload->>'location',coalesce((p_payload->>'purchase_cost')::numeric,0),coalesce((p_payload->>'selling_price')::numeric,0),coalesce((p_payload->>'reorder_threshold')::numeric,0),coalesce((p_payload->>'reorder_quantity')::numeric,1))
 on conflict(id) do update set name=excluded.name,sku=excluded.sku,barcode=excluded.barcode,category=excluded.category,description=excluded.description,supplier=excluded.supplier,location=excluded.location,purchase_cost=excluded.purchase_cost,selling_price=excluded.selling_price,reorder_threshold=excluded.reorder_threshold,reorder_quantity=excluded.reorder_quantity,updated_at=now();
 elsif p_action in ('stock_move','inventory_archive') then
 select * into strict item from public.inventory_items where id=ident and workspace_id=p_workspace for update;
 if p_action='inventory_archive' then
 if item.reserved>0 then raise exception 'Release reservations before archiving'; end if;
 update public.inventory_items set archived=true,updated_at=now() where id=ident;
 else
 if item.archived then raise exception 'Archived item'; end if;
 qty:=(p_payload->>'quantity')::numeric;
 if qty is null or qty=0 or qty::text in ('NaN','Infinity','-Infinity') or p_payload->>'kind' not in ('receipt','adjustment','return') or coalesce(length(trim(p_payload->>'reason')),0)=0 then raise exception 'A valid quantity, movement type and reason are required'; end if;
 if p_payload->>'kind' in ('receipt','return') and qty<0 then raise exception 'Receipt and return quantities must be positive'; end if;
 if item.quantity+qty<item.reserved then raise exception 'Insufficient available stock'; end if;
 update public.inventory_items set quantity=quantity+qty,updated_at=now() where id=ident;
 insert into public.inventory_movements(workspace_id,item_id,kind,quantity,balance,reason,actor_id) values(p_workspace,ident,p_payload->>'kind',qty,item.quantity+qty,p_payload->>'reason',u);
 end if;
 elsif p_action='job_save' then
 cust:=nullif(p_payload->>'customer_id','')::uuid; assigned:=nullif(p_payload->>'assigned_to','')::uuid;
 if cust is not null and not exists(select 1 from public.customers where id=cust and workspace_id=p_workspace) then raise exception 'Customer unavailable'; end if;
 if assigned is not null and not exists(select 1 from public.workspace_members where user_id=assigned and workspace_id=p_workspace) then raise exception 'Worker unavailable'; end if;
 if exists(select 1 from public.ops_jobs where id=ident) then raise exception 'Use job transitions to update existing work'; end if;
 insert into public.ops_jobs(id,workspace_id,customer_id,title,priority,assigned_to,notes,labor_total,checklist) values(ident,p_workspace,cust,p_payload->>'title',coalesce(p_payload->>'priority','normal'),assigned,p_payload->>'notes',coalesce((p_payload->>'labor_total')::numeric,0),coalesce(p_payload->'checklist','[]'));
 elsif p_action='reserve_material' then
 select * into strict job from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if job.status not in ('draft','quoted','approved','scheduled','in_progress') then raise exception 'Job is closed'; end if;
 select * into strict item from public.inventory_items where id=(p_payload->>'item_id')::uuid and workspace_id=p_workspace and not archived for update;
 qty:=(p_payload->>'quantity')::numeric;
 if qty is null or qty<=0 or qty>item.quantity-item.reserved then raise exception 'Insufficient available stock or invalid quantity'; end if;
 insert into public.job_materials(workspace_id,job_id,item_id,quantity,unit_cost,unit_price) values(p_workspace,ident,item.id,qty,item.purchase_cost,item.selling_price);
 update public.inventory_items set reserved=reserved+qty,updated_at=now() where id=item.id;
 insert into public.inventory_movements(workspace_id,item_id,job_id,kind,quantity,balance,reason,actor_id) values(p_workspace,item.id,ident,'reserve',qty,item.quantity,'Job allocation',u);
 elsif p_action='job_transition' then
 select * into strict job from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 target:=p_payload->>'status';
 if target='completed' and job.status='completed' then out:=jsonb_build_object('id',ident,'invoice_id',job.invoice_id,'status','completed');
 elsif (job.status='draft' and target='quoted') or (job.status='quoted' and target='approved') or (job.status='approved' and target in ('scheduled','in_progress')) or (job.status='scheduled' and target='in_progress') or (job.status='in_progress' and target='completed') or (job.status not in ('completed','cancelled') and target='cancelled') then
 if target='approved' and length(trim(coalesce(p_payload->>'approval_evidence','')))<5 then raise exception 'Record customer approval evidence'; end if;
 if target='completed' and exists(select 1 from jsonb_array_elements(job.checklist) x where coalesce(x->>'done','false')<>'true') then raise exception 'Finish all checklist items'; end if;
 if target='completed' and (p_payload->>'checklist_confirmed') is distinct from 'true' then raise exception 'Confirm completion checklist'; end if;
 if target in ('completed','cancelled') then
 for mat in select * from public.job_materials where job_id=ident and state='reserved' order by item_id for update loop
 select * into strict item from public.inventory_items where id=mat.item_id and workspace_id=p_workspace for update;
 update public.inventory_items set reserved=reserved-mat.quantity,quantity=quantity-case when target='completed' then mat.quantity else 0 end,updated_at=now() where id=mat.item_id;
 update public.job_materials set state=case when target='completed' then 'consumed' else 'released' end where job_id=ident and item_id=mat.item_id;
 insert into public.inventory_movements(workspace_id,item_id,job_id,kind,quantity,balance,reason,actor_id) values(p_workspace,mat.item_id,ident,case when target='completed' then 'consume' else 'release' end,mat.quantity,item.quantity-case when target='completed' then mat.quantity else 0 end,'Job '||target,u);
 end loop;
 end if;
 if target='completed' then
 select job.labor_total+coalesce(sum(quantity*unit_price),0) into total from public.job_materials where job_id=ident and state='consumed';
 insert into public.documents(workspace_id,customer_id,document_type,document_number,status,total) values(p_workspace,job.customer_id,'invoice','JOB-'||ident::text,'draft',total) returning id into inv;
 end if;
 update public.ops_jobs set status=target,approved_at=case when target='approved' then now() else approved_at end,approval_evidence=case when target='approved' then p_payload->>'approval_evidence' else approval_evidence end,completed_at=case when target='completed' then now() else completed_at end,invoice_id=coalesce(inv,invoice_id),updated_at=now() where id=ident;
 out:=jsonb_build_object('id',ident,'status',target,'invoice_id',coalesce(inv,job.invoice_id));
 else raise exception 'Invalid job transition from % to %',job.status,target; end if;
 elsif p_action='job_update' then
 select * into strict job from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if job.status in ('completed','cancelled') then raise exception 'Closed jobs cannot be edited'; end if;
 assigned:=nullif(p_payload->>'assigned_to','')::uuid;
 if assigned is not null and not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=assigned) then raise exception 'Worker unavailable'; end if;
 update public.ops_jobs set assigned_to=assigned,notes=coalesce(p_payload->>'notes',notes),checklist=coalesce(p_payload->'checklist',checklist),updated_at=now() where id=ident;
 elsif p_action='release_material' then
 select * into strict job from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 select * into strict mat from public.job_materials where job_id=ident and item_id=(p_payload->>'item_id')::uuid and state='reserved' for update;
 select * into strict item from public.inventory_items where id=mat.item_id and workspace_id=p_workspace for update;
 update public.inventory_items set reserved=reserved-mat.quantity,updated_at=now() where id=mat.item_id;
 delete from public.job_materials where job_id=ident and item_id=mat.item_id;
 insert into public.inventory_movements(workspace_id,item_id,job_id,kind,quantity,balance,reason,actor_id) values(p_workspace,mat.item_id,ident,'release',mat.quantity,item.quantity,'Manual reservation release',u);
 elsif p_action='schedule_job' then
 select * into strict job from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if job.status not in ('approved','scheduled') then raise exception 'Approve the estimate before scheduling'; end if;
 insert into public.appointments(workspace_id,customer_id,title,starts_at,ends_at,ops_job_id,assigned_worker,notes) values(p_workspace,job.customer_id,job.title,(p_payload->>'starts_at')::timestamptz,(p_payload->>'ends_at')::timestamptz,job.id,job.assigned_to,job.notes);
 update public.ops_jobs set status='scheduled',updated_at=now() where id=ident;
 elsif p_action='expense_save' then
 insert into public.ops_expenses(id,workspace_id,job_id,vendor,description,amount,due_at,paid) values(ident,p_workspace,nullif(p_payload->>'job_id','')::uuid,p_payload->>'vendor',p_payload->>'description',(p_payload->>'amount')::numeric,nullif(p_payload->>'due_at','')::date,coalesce((p_payload->>'paid')::boolean,false));
 elsif p_action='policy_save' then
 insert into public.ops_policies(workspace_id,enabled,draft_limit,industry,updated_by) values(p_workspace,coalesce((p_payload->>'enabled')::boolean,false),coalesce((p_payload->>'draft_limit')::numeric,1000),coalesce(p_payload->>'industry','general'),u)
 on conflict(workspace_id) do update set enabled=excluded.enabled,draft_limit=excluded.draft_limit,industry=excluded.industry,updated_by=u,updated_at=now();
 if not coalesce((p_payload->>'enabled')::boolean,false) then update public.ops_queue set status='cancelled',completed_at=now(),error='Owner kill switch' where workspace_id=p_workspace and status in ('pending','deferred'); end if;
 elsif p_action='purchase_draft' then
 select * into strict item from public.inventory_items where id=ident and workspace_id=p_workspace and not archived;
 insert into public.ops_purchase_orders(workspace_id,item_id,supplier,quantity,unit_cost) values(p_workspace,ident,item.supplier,item.reorder_quantity,item.purchase_cost) returning id into ident;
 elsif p_action='purchase_transition' then
 select * into strict po from public.ops_purchase_orders where id=ident and workspace_id=p_workspace for update;
 target:=p_payload->>'status';
 if (po.status='draft' and target in ('approved','denied')) or (po.status='approved' and target='received') then
 if target='received' then
 if length(trim(coalesce(p_payload->>'receipt_reference','')))<3 then raise exception 'Receiving reference required'; end if;
 select * into strict item from public.inventory_items where id=po.item_id and workspace_id=p_workspace for update;
 update public.inventory_items set quantity=quantity+po.quantity,updated_at=now() where id=po.item_id;
 insert into public.inventory_movements(workspace_id,item_id,kind,quantity,balance,reason,actor_id) values(p_workspace,po.item_id,'receipt',po.quantity,item.quantity+po.quantity,'PO received: '||(p_payload->>'receipt_reference'),u);
 end if;
 update public.ops_purchase_orders set status=target,approved_by=case when target='approved' then u else approved_by end,receipt_reference=coalesce(p_payload->>'receipt_reference',receipt_reference) where id=ident;
 elsif po.status=target then null;
 else raise exception 'Invalid purchase transition'; end if;
 elsif p_action='queue_retry' then
 update public.ops_queue set status='pending',attempts=0,available_at=now(),error=null where id=ident and workspace_id=p_workspace and status='dead_letter';
 if not found then raise exception 'No dead-letter operation found'; end if;
 else raise exception 'Unsupported operation'; end if;
 out:=coalesce(out,jsonb_build_object('id',ident,'verified',true));
 insert into le_ops.receipts(workspace_id,key,action,payload,result) values(p_workspace,p_key,p_action,p_payload,out);
 insert into public.ops_audit(workspace_id,actor_id,action,entity_id,details) values(p_workspace,u,p_action,ident,jsonb_build_object('receipt_key',p_key,'result',out));
 return out;
end $$;
revoke all on function le_ops.command(uuid,text,jsonb,text) from public,anon;
grant execute on function le_ops.command(uuid,text,jsonb,text) to authenticated;
create function public.ops_command(p_workspace uuid,p_action text,p_payload jsonb,p_key text)
returns jsonb language sql security invoker set search_path='' as $$select le_ops.command(p_workspace,p_action,p_payload,p_key)$$;
revoke all on function public.ops_command(uuid,text,jsonb,text) from public,anon;
grant execute on function public.ops_command(uuid,text,jsonb,text) to authenticated;

-- Safe autonomous action: ONLY prepare an internal PO draft. Never sends or spends money.
create function le_ops.tick() returns jsonb language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
declare q public.ops_queue; item public.inventory_items; pol public.ops_policies; po uuid; done integer:=0;
begin
 if not pg_try_advisory_xact_lock(73021,1) then return '{"busy":true}'; end if;
 insert into public.ops_queue(workspace_id,item_id,event_key)
 select i.workspace_id,i.id,'low_stock:'||i.id||':'||i.updated_at::text from public.inventory_items i join public.ops_policies p on p.workspace_id=i.workspace_id and p.enabled
 where not i.archived and i.quantity-i.reserved<=i.reorder_threshold
 and not exists(select 1 from public.ops_purchase_orders o where o.workspace_id=i.workspace_id and o.item_id=i.id and o.status in ('draft','approved'))
 and not exists(select 1 from public.ops_queue x where x.workspace_id=i.workspace_id and x.item_id=i.id and x.status in ('pending','running','deferred','dead_letter'))
 order by i.workspace_id,i.id limit 100 on conflict do nothing;
 update public.ops_queue set status=case when attempts>=3 then 'dead_letter' else 'pending' end,error='Execution lease expired',available_at=now() where status='running' and started_at<now()-interval '5 minutes';
 for q in select * from public.ops_queue where status in ('pending','deferred') and available_at<=now() order by created_at limit 100 for update skip locked loop
 -- Same lock as human commands: kill switch, receiving and drafting cannot race.
 perform pg_advisory_xact_lock(hashtextextended(q.workspace_id::text,73021));
 select * into pol from public.ops_policies where workspace_id=q.workspace_id;
 if pol.enabled is distinct from true then
 update public.ops_queue set status='cancelled',completed_at=now(),error='Automation disabled' where id=q.id; continue; end if;
 update public.ops_queue set status='running',attempts=attempts+1,started_at=now() where id=q.id;
 begin
 select * into strict item from public.inventory_items where id=q.item_id and workspace_id=q.workspace_id for update;
 if item.archived or item.quantity-item.reserved>item.reorder_threshold then
 update public.ops_queue set status='completed',completed_at=now(),result='{"outcome":"shortage_resolved"}' where id=q.id;
 elsif item.purchase_cost*item.reorder_quantity>pol.draft_limit then
 update public.ops_queue set status='deferred',available_at=now()+interval '1 hour',error='Above draft policy limit; owner review required' where id=q.id;
 else
 select id into po from public.ops_purchase_orders where workspace_id=q.workspace_id and item_id=item.id and status in ('draft','approved');
 if po is null then insert into public.ops_purchase_orders(workspace_id,item_id,supplier,quantity,unit_cost) values(q.workspace_id,item.id,item.supplier,item.reorder_quantity,item.purchase_cost) returning id into po; end if;
 if not exists(select 1 from public.ops_purchase_orders where id=po and workspace_id=q.workspace_id) then raise exception 'Draft verification failed'; end if;
 update public.ops_queue set status='completed',completed_at=now(),result=jsonb_build_object('outcome','draft_verified','purchase_order_id',po,'external_order_submitted',false) where id=q.id;
 end if;
 insert into public.ops_audit(workspace_id,action,entity_id,details) select q.workspace_id,'observe_analyze_decide_act_verify',q.id,jsonb_build_object('status',status,'result',result,'error',error) from public.ops_queue where id=q.id;
 done:=done+1;
 exception when others then
 update public.ops_queue set status=case when attempts>=3 then 'dead_letter' else 'pending' end,error=left(sqlerrm,500),available_at=now()+interval '5 minutes',completed_at=case when attempts>=3 then now() end where id=q.id;
 insert into public.ops_audit(workspace_id,action,entity_id,details) values(q.workspace_id,'execution_failed',q.id,jsonb_build_object('error',left(sqlerrm,500)));
 end;
 end loop;
 return jsonb_build_object('processed',done,'verified_at',now());
end $$;
revoke all on function le_ops.tick() from public,anon,authenticated;
select cron.schedule('loose-ends-safe-operations','* * * * *','set statement_timeout=''45s''; set lock_timeout=''3s''; select le_ops.tick();');

-- Reject PostgreSQL special numeric values in business amounts as well as negative values.
alter table public.inventory_items add constraint inventory_finite check(purchase_cost::text<>'NaN' and selling_price::text<>'NaN' and quantity::text<>'NaN' and reserved::text<>'NaN' and reorder_threshold::text<>'NaN' and reorder_quantity::text<>'NaN');
alter table public.ops_jobs add constraint labor_finite check(labor_total::text<>'NaN' and jsonb_typeof(checklist)='array');
alter table public.ops_policies add constraint policy_finite check(draft_limit::text<>'NaN');
alter table public.ops_purchase_orders add constraint purchase_finite check(unit_cost::text<>'NaN' and quantity::text<>'NaN');

-- Scheduling uses the existing calendar, not a second disconnected calendar.
alter table public.appointments add column if not exists ops_job_id uuid;
alter table public.appointments add column if not exists assigned_worker uuid;
alter table public.appointments add constraint appointments_ops_job_fk foreign key(workspace_id,ops_job_id) references public.ops_jobs(workspace_id,id);
create index appointments_conflict_window on public.appointments(workspace_id,starts_at,ends_at) where status not in ('cancelled','canceled');
create function le_ops.check_appointment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Authenticated requests must belong to this workspace; background callers are already trusted.
 if auth.uid() is not null and not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,73021));
 if new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and workspace_id=new.workspace_id) then raise exception 'Customer unavailable'; end if;
 if new.assigned_worker is not null and not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=new.assigned_worker) then raise exception 'Worker unavailable'; end if;
 if new.status in ('cancelled','canceled') then return new; end if;
 if new.ends_at is null or new.ends_at<=new.starts_at then raise exception 'A valid appointment end time is required'; end if;
 if exists(select 1 from public.appointments a where a.workspace_id=new.workspace_id and a.id<>new.id and a.status not in ('cancelled','canceled') and a.starts_at<new.ends_at and coalesce(a.ends_at,a.starts_at+interval '1 hour')>new.starts_at and (a.assigned_worker is null or new.assigned_worker is null or a.assigned_worker=new.assigned_worker)) then raise exception 'Scheduling conflict: resource already booked'; end if;
 return new;
end $$;
revoke all on function le_ops.check_appointment() from public,anon,authenticated;
create trigger ops_calendar_guard before insert or update of starts_at,ends_at,assigned_worker,customer_id,workspace_id,status on public.appointments for each row execute function le_ops.check_appointment();

create function public.ops_summary(p_workspace uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'open_jobs',(select count(*) from public.ops_jobs where workspace_id=p_workspace and status not in ('completed','cancelled')),
 'open_estimates',(select count(*) from public.ops_jobs where workspace_id=p_workspace and status in ('draft','quoted')),
 'today_jobs',(select count(*) from public.appointments where workspace_id=p_workspace and starts_at>=date_trunc('day',now()) and starts_at<date_trunc('day',now())+interval '1 day' and status not in ('cancelled','canceled')),
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
) where public.is_workspace_member(p_workspace);
$$;
revoke all on function public.ops_summary(uuid) from public,anon;
grant execute on function public.ops_summary(uuid) to authenticated;
