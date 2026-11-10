-- Asking for your own name or position to be corrected. Both print on the SF2,
-- SF4 and SF9, so they stay the managers' to change (settled 2026-10-28): a
-- staff member asks, with a note saying why, and a principal or administrative
-- officer approves or declines with a reason. Nobody decides their own, and an
-- administrative officer decides only a teacher's, as with every other change
-- to an account. An approval changes the staff record in the same transaction.
create table edunexus.staff_name_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references edunexus.staff(user_id) on delete cascade,
  current_name text not null,
  requested_name text check(requested_name is null or (length(btrim(requested_name)) between 1 and 150 and requested_name !~ '[[:cntrl:]]')),
  current_position text,
  requested_position text check(requested_position is null or (length(btrim(requested_position)) between 1 and 120 and requested_position !~ '[[:cntrl:]]')),
  note text not null check(length(btrim(note)) between 10 and 500 and note !~ '[[:cntrl:]]'),
  status text not null default 'pending' check(status in ('pending','approved','declined','withdrawn')),
  decided_by uuid references edunexus.staff(user_id) on delete restrict,
  decision_reason text check(decision_reason is null or length(btrim(decision_reason)) between 10 and 500),
  decided_at timestamptz,
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(requested_name is not null or requested_position is not null),
  check((status in ('approved','declined'))=(decided_by is not null and decision_reason is not null and decided_at is not null))
);
create unique index staff_name_request_open_idx on edunexus.staff_name_requests(user_id) where status='pending';
create index staff_name_request_status_idx on edunexus.staff_name_requests(status,created_at);
create index staff_name_request_decided_by_idx on edunexus.staff_name_requests(decided_by);

create table edunexus.staff_name_request_events (
  id bigint generated always as identity primary key,
  name_request_id uuid not null references edunexus.staff_name_requests(id) on delete cascade,
  kind text not null check(kind in ('request','withdraw','approve','decline')),
  before jsonb, after jsonb not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid,
  recorded_at timestamptz not null default clock_timestamp()
);
create index staff_name_request_event_request_idx on edunexus.staff_name_request_events(name_request_id,id desc);
create index staff_name_request_event_actor_idx on edunexus.staff_name_request_events(actor_user_id);

alter table edunexus.staff_name_requests enable row level security;
alter table edunexus.staff_name_request_events enable row level security;
create policy own_or_manager on edunexus.staff_name_requests for select to edunexus_app using(user_id=edunexus.actor_id() or edunexus.is_manager());
create policy own_or_manager on edunexus.staff_name_request_events for select to edunexus_app
  using(edunexus.is_manager() or exists(select 1 from edunexus.staff_name_requests r where r.id=name_request_id and r.user_id=edunexus.actor_id()));
grant select on edunexus.staff_name_requests,edunexus.staff_name_request_events to edunexus_app;
create trigger version_record before update on edunexus.staff_name_requests for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.staff_name_requests for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.staff_name_request_events for each row execute function edunexus.audit_record();

create function edunexus.name_request_view(r edunexus.staff_name_requests) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'user_id',r.user_id,'current_name',r.current_name,'requested_name',r.requested_name,'current_position',r.current_position,
    'requested_position',r.requested_position,'note',r.note,'status',r.status,'decision_reason',r.decision_reason,'decided_at',r.decided_at,
    'decided_by',(select display_name from edunexus.staff where user_id=r.decided_by),'created_at',r.created_at,'version',r.version)
$$;

create function edunexus.journal_name_request(p_request uuid,p_kind text,p_before jsonb,p_after jsonb,p_reason text) returns void language sql security definer set search_path='' as $$
  insert into edunexus.staff_name_request_events(name_request_id,kind,before,after,reason,actor_user_id,request_id)
  values(p_request,p_kind,p_before,p_after,p_reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid)
$$;

-- A staff member asks for their own name, position or both to be corrected. One open request at a time.
create function edunexus.request_name_change(p_name text,p_position text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.staff; r edunexus.staff_name_requests; name text:=nullif(btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')),''); pos text:=nullif(btrim(regexp_replace(coalesce(p_position,''),'\s+',' ','g')),'');
begin
  select * into s from edunexus.staff where user_id=edunexus.actor_id() and active;
  if not found then raise exception using errcode='42501',message='Active staff access required'; end if;
  perform pg_advisory_xact_lock(82412003,hashtext(s.user_id::text));
  if name is not distinct from s.display_name then name:=null; end if;
  if pos is not distinct from s.position then pos:=null; end if;
  if name is null and pos is null then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.staff_name_requests(user_id,current_name,requested_name,current_position,requested_position,note)
  values(s.user_id,s.display_name,name,s.position,pos,btrim(p_note)) returning * into r;
  perform edunexus.journal_name_request(r.id,'request',null,edunexus.name_request_view(r),btrim(p_note));
  return edunexus.name_request_view(r);
end $$;

-- Withdrawing your own open request.
create function edunexus.withdraw_name_request(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r edunexus.staff_name_requests; before jsonb;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  select * into r from edunexus.staff_name_requests where id=p_id and user_id=edunexus.actor_id() for update;
  if not found then raise exception using errcode='P0002',message='Request not found'; end if;
  if r.version is distinct from p_version then raise exception using errcode='P0003',message='The request changed'; end if;
  if r.status<>'pending' then raise exception using errcode='P2402',message='The request is already decided'; end if;
  before:=edunexus.name_request_view(r);
  update edunexus.staff_name_requests set status='withdrawn' where id=p_id returning * into r;
  perform edunexus.journal_name_request(r.id,'withdraw',before,edunexus.name_request_view(r),'Withdrew their own request.');
  return edunexus.name_request_view(r);
end $$;

-- A manager approves (changing the staff record) or declines, with a reason. Never their own; an administrative officer only a teacher's.
create function edunexus.decide_name_request(p_id uuid,p_version integer,p_decision text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r edunexus.staff_name_requests; before jsonb; reason text:=edunexus.site_reason(p_reason);
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_decision not in ('approve','decline') then raise exception using errcode='23514',message='Invalid decision'; end if;
  perform pg_advisory_xact_lock(82412001);
  select * into r from edunexus.staff_name_requests where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Request not found'; end if;
  if r.user_id=edunexus.actor_id() then raise exception using errcode='P2403',message='Nobody decides their own request'; end if;
  if not edunexus.may_manage_profile(r.user_id) then raise exception using errcode='42501',message='Only the principal decides an administrative account'; end if;
  if r.version is distinct from p_version then raise exception using errcode='P0003',message='The request changed'; end if;
  if r.status<>'pending' then raise exception using errcode='P2402',message='The request is already decided'; end if;
  before:=edunexus.name_request_view(r);
  if p_decision='approve' then
    update edunexus.staff set display_name=coalesce(r.requested_name,display_name),position=coalesce(r.requested_position,position) where user_id=r.user_id;
  end if;
  update edunexus.staff_name_requests set status=case p_decision when 'approve' then 'approved' else 'declined' end,
    decided_by=edunexus.actor_id(),decision_reason=reason,decided_at=clock_timestamp() where id=p_id returning * into r;
  perform edunexus.journal_name_request(r.id,p_decision,before,edunexus.name_request_view(r),reason);
  return edunexus.name_request_view(r);
end $$;

-- The managers' list: open requests by default, every one an administrative officer may decide or the principal may.
create function edunexus.read_name_requests(p_status text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(edunexus.name_request_view(r)||jsonb_build_object('requested_by',s.display_name,'role',s.role,
      'yours',r.user_id=edunexus.actor_id(),'may_decide',r.user_id<>edunexus.actor_id() and edunexus.may_manage_profile(r.user_id)) order by r.created_at),'[]'::jsonb)
    from (select * from edunexus.staff_name_requests where status=coalesce(p_status,status) order by created_at desc limit 100) r join edunexus.staff s on s.user_id=r.user_id));
end $$;

-- 0043's profile read, with the caller's latest request added. Everything else it returns is unchanged.
create or replace function edunexus.read_my_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s edunexus.staff;
begin
  select * into s from edunexus.staff where user_id=edunexus.actor_id() and active;
  if not found then raise exception using errcode='42501',message='Active staff access required'; end if;
  return jsonb_build_object('user_id',s.user_id,'display_name',s.display_name,'role',s.role,'position',s.position,'specialization',s.specialization,
    'profile',edunexus.staff_profile_view(s.user_id),
    'advises',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'grade_level',x.grade_level,'name',x.name,'start_year',y.start_year,'year_status',y.status)
        order by y.start_year desc,x.grade_level,x.name),'[]'::jsonb)
      from edunexus.sections x join edunexus.academic_years y on y.id=x.academic_year_id where x.adviser_user_id=s.user_id and y.status in ('draft','active')),
    'name_request',(select edunexus.name_request_view(r) from edunexus.staff_name_requests r where r.user_id=s.user_id
      and (r.status='pending' or r.updated_at>clock_timestamp()-interval '30 days') order by r.created_at desc limit 1));
end $$;

-- Your own activity: the changes you recorded and the learner records you were shown, newest first, a page at a time.
-- Reading it writes no access row: it names no learner, only how many records each read returned.
create function edunexus.read_my_activity(p_kind text,p_before bigint,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id(); lim integer:=least(greatest(coalesce(p_limit,25),1),100); items jsonb;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  if p_kind='changes' then
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'occurred_at',a.occurred_at,'operation',a.operation,'entity_table',a.entity_table,'changed_fields',a.changed_fields) order by a.id desc),'[]'::jsonb) into items
      from (select * from edunexus.audit_events where actor_user_id=me and (p_before is null or id<p_before) order by id desc limit lim+1) a;
  elsif p_kind='reads' then
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'occurred_at',e.occurred_at,'resource',e.resource,'record_count',cardinality(e.record_ids)) order by e.id desc),'[]'::jsonb) into items
      from (select * from edunexus.record_access_events where actor_user_id=me and (p_before is null or id<p_before) order by id desc limit lim+1) e;
  else raise exception using errcode='23514',message='Invalid activity kind'; end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc),'[]'::jsonb) from (select x from jsonb_array_elements(items) x order by (x->>'id')::bigint desc limit lim) t),
    'pagination',jsonb_build_object('limit',lim,'next_before_id',case when jsonb_array_length(items)>lim then (select x->>'id' from jsonb_array_elements(items) x order by (x->>'id')::bigint desc offset lim-1 limit 1) end));
end $$;

revoke all on function edunexus.name_request_view(edunexus.staff_name_requests),edunexus.journal_name_request(uuid,text,jsonb,jsonb,text),
  edunexus.request_name_change(text,text,text),edunexus.withdraw_name_request(uuid,integer),edunexus.decide_name_request(uuid,integer,text,text),
  edunexus.read_name_requests(text),edunexus.read_my_activity(text,bigint,integer) from public;
grant execute on function edunexus.request_name_change(text,text,text),edunexus.withdraw_name_request(uuid,integer),edunexus.decide_name_request(uuid,integer,text,text),
  edunexus.read_name_requests(text),edunexus.read_my_activity(text,bigint,integer) to edunexus_app;
