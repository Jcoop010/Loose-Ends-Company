-- Retain owner-recorded approval evidence independently of the current job revision.
create table public.ops_quote_approvals(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,job_id uuid not null,revision integer not null,
 evidence text not null,actor_id uuid,approved_at timestamptz not null,source text not null default 'owner_record',created_at timestamptz not null default now(),
 unique(job_id,revision,approved_at),foreign key(workspace_id,job_id) references public.ops_jobs(workspace_id,id)
);
create index ops_approval_history on public.ops_quote_approvals(workspace_id,job_id,revision);
alter table public.ops_quote_approvals enable row level security;
revoke all on public.ops_quote_approvals from public,anon,authenticated;
grant select on public.ops_quote_approvals to authenticated;
create policy workspace_read on public.ops_quote_approvals for select to authenticated using(public.is_workspace_member(workspace_id));
insert into public.ops_quote_approvals(workspace_id,job_id,revision,evidence,approved_at,source)
select workspace_id,id,revision,approval_evidence,approved_at,'existing_job_record' from public.ops_jobs where approved_at is not null and approval_evidence is not null;
create function le_ops.retain_quote_approval() returns trigger language plpgsql security definer set search_path=public,le_ops,pg_temp as $$
begin
 if new.status='approved' and old.status is distinct from new.status then
 insert into public.ops_quote_approvals(workspace_id,job_id,revision,evidence,actor_id,approved_at) values(new.workspace_id,new.id,new.revision,new.approval_evidence,auth.uid(),new.approved_at) on conflict do nothing;
 end if;
 return new;
end$$;
revoke all on function le_ops.retain_quote_approval() from public,anon,authenticated;
create trigger ops_retain_quote_approval after update of status on public.ops_jobs for each row execute function le_ops.retain_quote_approval();
