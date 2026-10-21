-- Requires business-coordination.sql fixture, still inside its BEGIN/ROLLBACK transaction.
select set_config('request.jwt.claim.sub',current_setting('test.coord_user'),true);
set local role authenticated;
select public.ops_command(current_setting('test.coord_ws')::uuid,'coordination_policy','{"enabled":true,"coordinate_enabled":true,"timezone":"UTC","business_start":"08:00","business_end":"18:00","business_days":[1,2,3,4,5]}','coord-recovery-policy');
select pg_temp.assert(pg_temp.denied(current_setting('test.coord_ws')::uuid,'service_plan_save','{"title":"Invalid recurring plan","interval_days":30,"next_due":"2030-01-01","template":{"labor_total":"NaN"}}','coord-bad-plan'),'invalid recurring template rejected');
reset role;
-- Simulate a corrupt internal event. All created actions must roll back before retry.
insert into public.ops_business_events(workspace_id,event_key,event_type,entity_type,entity_id,payload)
select current_setting('test.coord_ws')::uuid,'qa-corrupt-event','job_quoted','ops_jobs',id,'{"revision":"invalid"}' from public.ops_jobs where workspace_id=current_setting('test.coord_ws')::uuid and status='quoted' limit 1;
select le_ops.tick_business();
update public.ops_business_events set available_at=now() where event_key='qa-corrupt-event' and workspace_id=current_setting('test.coord_ws')::uuid;
select le_ops.tick_business();
update public.ops_business_events set available_at=now() where event_key='qa-corrupt-event' and workspace_id=current_setting('test.coord_ws')::uuid;
select le_ops.tick_business();
select pg_temp.assert((select status='dead_letter' and attempts=3 from public.ops_business_events where event_key='qa-corrupt-event' and workspace_id=current_setting('test.coord_ws')::uuid),'failed internal event enters dead letter after bounded attempts');
-- Fix the event source under a trusted test transaction; owner retries through the real command.
update public.ops_business_events set payload=jsonb_build_object('revision',j.revision-1) from public.ops_jobs j where ops_business_events.entity_id=j.id and ops_business_events.event_key='qa-corrupt-event' and ops_business_events.workspace_id=current_setting('test.coord_ws')::uuid;
set local role authenticated;
select public.ops_command(current_setting('test.coord_ws')::uuid,'business_retry',jsonb_build_object('id',(select id from public.ops_business_events where workspace_id=current_setting('test.coord_ws')::uuid and event_key='qa-corrupt-event')),'coord-recover-once');
reset role;
select le_ops.tick_business();
select pg_temp.assert((select status='completed' and attempts=1 from public.ops_business_events where workspace_id=current_setting('test.coord_ws')::uuid and event_key='qa-corrupt-event'),'owner recovery completes after repair');
-- One malformed recurring row must be isolated, never stop other workspaces' workers.
insert into public.ops_service_plans(workspace_id,title,interval_days,next_due,template) values(current_setting('test.coord_ws')::uuid,'QA corrupt recurring row',30,now()-interval '1 hour','{"labor_total":"bad"}');
select le_ops.tick_business();
select pg_temp.assert((select not enabled and failure_count=1 and last_error is not null from public.ops_service_plans where workspace_id=current_setting('test.coord_ws')::uuid and title='QA corrupt recurring row'),'malformed recurrence is paused with an auditable error');
select 'Coordination bounded retry, dead letter, repair, owner retry and recurrence isolation passed' as result;
