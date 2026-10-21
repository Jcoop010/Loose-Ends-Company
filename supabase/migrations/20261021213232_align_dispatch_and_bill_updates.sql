-- Keep job and dispatch assignment consistent; record owner-reported bill settlement without money movement.
create or replace function le_ops.command(p_workspace uuid,p_action text,p_payload jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
declare u uuid:=auth.uid();receipt le_ops.receipts;ident uuid;out jsonb;j public.ops_jobs;rev integer;doc uuid;total numeric;who uuid;cid uuid;pol public.ops_policies;extra jsonb;ap public.appointments;
begin
 if u is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=u and role in ('owner','admin')) then raise exception 'Owner or administrator permission required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 or p_key is null or length(p_key) not between 8 and 150 then raise exception 'Invalid command';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,73021));
 select * into receipt from le_ops.receipts where workspace_id=p_workspace and key=p_key;
 if found then if receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Idempotency key reused with different content';end if;return receipt.result;end if;
 if (select count(*) from le_ops.receipts where workspace_id=p_workspace and created_at>now()-interval '1 minute')>=120 then raise exception 'Workspace operation rate limit reached; retry shortly';end if;
 ident:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
 if p_action='coordination_policy' then
 if not exists(select 1 from pg_timezone_names where name=p_payload->>'timezone') then raise exception 'Valid business time zone required';end if;
 insert into public.ops_policies(workspace_id,enabled,coordinate_enabled,timezone,business_start,business_end,business_days,enforce_hours,travel_buffer,industry,updated_by)
 values(p_workspace,coalesce((p_payload->>'enabled')::boolean,false),coalesce((p_payload->>'coordinate_enabled')::boolean,false),p_payload->>'timezone',(p_payload->>'business_start')::time,(p_payload->>'business_end')::time,array(select value::integer from jsonb_array_elements_text(p_payload->'business_days')),coalesce((p_payload->>'enforce_hours')::boolean,false),coalesce((p_payload->>'travel_buffer')::integer,0),coalesce(p_payload->>'industry','general'),u)
 on conflict(workspace_id) do update set enabled=excluded.enabled,coordinate_enabled=excluded.coordinate_enabled,timezone=excluded.timezone,business_start=excluded.business_start,business_end=excluded.business_end,business_days=excluded.business_days,enforce_hours=excluded.enforce_hours,travel_buffer=excluded.travel_buffer,industry=excluded.industry,updated_by=u,updated_at=now();
 if not coalesce((p_payload->>'enabled')::boolean,false) or not coalesce((p_payload->>'coordinate_enabled')::boolean,false) then update public.ops_business_events set status='cancelled',completed_at=now(),error='Owner policy pause' where workspace_id=p_workspace and status='pending';end if;
 elsif p_action='employee_save' then
 who:=(p_payload->>'user_id')::uuid;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=who) then raise exception 'Worker is not a workspace member';end if;
 insert into public.ops_employee_profiles(workspace_id,user_id,display_name,job_title,phone,skills,active) values(p_workspace,who,p_payload->>'display_name',p_payload->>'job_title',p_payload->>'phone',array(select jsonb_array_elements_text(coalesce(p_payload->'skills','[]'))),coalesce((p_payload->>'active')::boolean,true))
 on conflict(workspace_id,user_id) do update set display_name=excluded.display_name,job_title=excluded.job_title,phone=excluded.phone,skills=excluded.skills,active=excluded.active,updated_at=now();ident:=who;
 elsif p_action='availability_save' then
 insert into public.ops_availability(id,workspace_id,user_id,starts_at,ends_at,available,reason) values(ident,p_workspace,(p_payload->>'user_id')::uuid,(p_payload->>'starts_at')::timestamptz,(p_payload->>'ends_at')::timestamptz,coalesce((p_payload->>'available')::boolean,false),p_payload->>'reason');
 elsif p_action='availability_remove' then
 delete from public.ops_availability where workspace_id=p_workspace and id=ident;if not found then raise exception 'Availability not found';end if;
 elsif p_action='estimate_revise' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if j.status not in ('draft','quoted','approved') then raise exception 'Only an unstarted estimate can be revised';end if;
 if exists(select 1 from public.appointments where workspace_id=p_workspace and ops_job_id=ident and status not in ('cancelled','canceled')) then raise exception 'Cancel the booking before revising';end if;
 if coalesce(length(trim(p_payload->>'reason')),0)<5 then raise exception 'Revision reason required';end if;
 update public.ops_jobs set status='draft',labor_total=coalesce((p_payload->>'labor_total')::numeric,labor_total),title=coalesce(nullif(trim(p_payload->>'title'),''),title),approved_at=null,approval_evidence=null,notes=coalesce(notes,'')||E'\nRevision: '||(p_payload->>'reason'),updated_at=now() where id=ident;
 elsif p_action='job_details' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace for update;
 if j.status in ('completed','cancelled') then raise exception 'Job is closed';end if;
 if jsonb_typeof(coalesce(p_payload->'service_details','{}'))<>'object' then raise exception 'Service details must be an object';end if;
 update public.ops_jobs set service_details=coalesce(p_payload->'service_details','{}'),updated_at=now() where id=ident;
 elsif p_action='attachment_add' then
 perform 1 from public.ops_jobs where id=(p_payload->>'job_id')::uuid and workspace_id=p_workspace;if not found then raise exception 'Job unavailable';end if;
 if length(coalesce(p_payload->>'name','')) not between 1 and 200 or length(coalesce(p_payload->>'url',''))>2000 or p_payload->>'url' !~ '^https://' then raise exception 'Use a named HTTPS attachment reference';end if;
 insert into public.ops_job_attachments(id,workspace_id,job_id,name,url) values(ident,p_workspace,(p_payload->>'job_id')::uuid,p_payload->>'name',p_payload->>'url');
 elsif p_action='service_plan_save' then
 if jsonb_typeof(coalesce(p_payload->'template','{}'))<>'object' or jsonb_typeof(coalesce(p_payload->'template'->'checklist','[]'))<>'array' or jsonb_typeof(coalesce(p_payload->'template'->'service_details','{}'))<>'object' then raise exception 'Invalid recurring service template';end if;
 if coalesce((p_payload->'template'->>'labor_total')::numeric,0)<0 or coalesce((p_payload->'template'->>'labor_total')::numeric,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid recurring labor amount';end if;
 if jsonb_array_length(coalesce(p_payload->'template'->'checklist','[]'))>100 then raise exception 'Recurring checklist is too large';end if;
 cid:=nullif(p_payload->>'customer_id','')::uuid;who:=nullif(p_payload->>'assigned_to','')::uuid;
 if cid is not null and not exists(select 1 from public.customers where workspace_id=p_workspace and id=cid) then raise exception 'Customer unavailable';end if;
 if who is not null and not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=who) then raise exception 'Worker unavailable';end if;
 insert into public.ops_service_plans(id,workspace_id,customer_id,title,interval_days,next_due,assigned_to,enabled,template) values(ident,p_workspace,cid,p_payload->>'title',(p_payload->>'interval_days')::integer,(p_payload->>'next_due')::timestamptz,who,coalesce((p_payload->>'enabled')::boolean,true),coalesce(p_payload->'template','{}'));
 elsif p_action='service_plan_toggle' then
 update public.ops_service_plans set enabled=(p_payload->>'enabled')::boolean,updated_at=now() where id=ident and workspace_id=p_workspace;if not found then raise exception 'Service plan not found';end if;
 elsif p_action='booking_update' then
 select * into strict ap from public.appointments where id=ident and workspace_id=p_workspace for update;
 if p_payload->>'status'='cancelled' then
 update public.appointments set status='cancelled',updated_at=now() where id=ident;
 if ap.ops_job_id is not null then update public.ops_jobs set status='approved',updated_at=now() where id=ap.ops_job_id and workspace_id=p_workspace and status='scheduled';end if;
 else
 update public.appointments set starts_at=(p_payload->>'starts_at')::timestamptz,ends_at=(p_payload->>'ends_at')::timestamptz,assigned_worker=nullif(p_payload->>'assigned_worker','')::uuid,status='scheduled',updated_at=now() where id=ident;
 if ap.ops_job_id is not null then update public.ops_jobs set assigned_to=nullif(p_payload->>'assigned_worker','')::uuid,updated_at=now() where workspace_id=p_workspace and id=ap.ops_job_id;end if;
 end if;
 elsif p_action='expense_update' then
 update public.ops_expenses set paid=(p_payload->>'paid')::boolean where workspace_id=p_workspace and id=ident;
 if not found then raise exception 'Expense record unavailable';end if;
 elsif p_action='draft_save' then
 cid:=(p_payload->>'customer_id')::uuid;
 if not exists(select 1 from public.customers where id=cid and workspace_id=p_workspace) then raise exception 'Customer unavailable';end if;
 insert into public.ops_communication_drafts(id,workspace_id,customer_id,channel,subject,message) values(ident,p_workspace,cid,p_payload->>'channel',coalesce(p_payload->>'subject','Customer follow-up'),p_payload->>'message');
 elsif p_action='draft_review' then
 if p_payload->>'status' not in ('approved','rejected') then raise exception 'Invalid draft decision';end if;
 select customer_id into strict cid from public.ops_communication_drafts where workspace_id=p_workspace and id=ident;
 if p_payload->>'status'='approved' and not exists(select 1 from public.customer_contact_consent_events c join public.ops_communication_drafts d on c.customer_id=d.customer_id and c.channel=d.channel and c.workspace_id=d.workspace_id where d.id=ident and c.id=(select x.id from public.customer_contact_consent_events x where x.workspace_id=p_workspace and x.customer_id=cid and x.channel=d.channel order by created_at desc,id desc limit 1) and c.decision='granted') then raise exception 'Current channel consent required before draft approval';end if;
 update public.ops_communication_drafts set status=p_payload->>'status',approved_by=u,approved_at=now() where workspace_id=p_workspace and id=ident;
 elsif p_action='business_retry' then
 update public.ops_business_events set status='pending',attempts=0,available_at=now(),error=null where workspace_id=p_workspace and id=ident and status='dead_letter';if not found then raise exception 'Dead-letter event unavailable';end if;
 else
 -- New cross-cutting lifecycle rules apply even to calls using older UI modules.
 if p_action in ('reserve_material','release_material') then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace;
 if j.status<>'draft' then raise exception 'Revise the estimate before changing materials';end if;
 end if;
 if p_action='job_update' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace;
 if j.assigned_to is distinct from nullif(p_payload->>'assigned_to','')::uuid and exists(select 1 from public.appointments where workspace_id=p_workspace and ops_job_id=ident and status not in ('cancelled','canceled')) then raise exception 'Update the booking before reassigning this job';end if;
 end if;
 out:=le_ops.command_core(p_workspace,p_action,p_payload,p_key);
 if p_action='job_transition' and p_payload->>'status'='quoted' then
 select * into strict j from public.ops_jobs where id=ident and workspace_id=p_workspace;
 select coalesce(max(revision),0)+1 into rev from public.ops_quote_revisions where job_id=ident;
 select j.labor_total+coalesce(sum(quantity*unit_price),0) into total from public.job_materials where job_id=ident and state='reserved';
 insert into public.documents(workspace_id,customer_id,document_type,document_number,status,total) values(p_workspace,j.customer_id,'quote','EST-'||ident::text||'-R'||rev,'draft',total) returning id into doc;
 insert into public.ops_quote_revisions(workspace_id,job_id,revision,document_id,snapshot,total,actor_id) values(p_workspace,ident,rev,doc,jsonb_build_object('job',to_jsonb(j),'materials',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.job_materials m where job_id=ident),'revision',rev),total,u);
 update public.ops_jobs set revision=rev where id=ident;out:=out||jsonb_build_object('quote_id',doc,'revision',rev);
 update le_ops.receipts set result=out where workspace_id=p_workspace and key=p_key;
 elsif p_action='job_transition' and p_payload->>'status' in ('completed','cancelled') then
 update public.appointments set status=case when p_payload->>'status'='completed' then 'completed' else 'cancelled' end,updated_at=now() where workspace_id=p_workspace and ops_job_id=ident and status not in ('cancelled','canceled','completed');
 elsif p_action='policy_save' and (p_payload->>'enabled') is distinct from 'true' then
 update public.ops_business_events set status='cancelled',completed_at=now(),error='Owner kill switch' where workspace_id=p_workspace and status='pending';
 end if;
 return out;
 end if;
 out:=jsonb_build_object('id',ident,'confirmed',true);
 insert into le_ops.receipts(workspace_id,key,action,payload,result) values(p_workspace,p_key,p_action,p_payload,out);
 insert into public.ops_audit(workspace_id,actor_id,action,entity_id,details) values(p_workspace,u,p_action,ident,jsonb_build_object('receipt_key',p_key));
 return out;
end$$;
