-- Section 3B.2: completeness review, immutable submissions and controlled locks.
create table edunexus.attendance_month_snapshots (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null,academic_year_id uuid not null,month_on date not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  data_hash text not null check(data_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(id,section_id,month_on),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict,
  check(extract(day from month_on)=1)
);
create index attendance_snapshot_scope_idx on edunexus.attendance_month_snapshots(section_id,month_on);
create index attendance_snapshot_year_idx on edunexus.attendance_month_snapshots(academic_year_id);
create table edunexus.attendance_months (
  id uuid primary key default gen_random_uuid(),section_id uuid not null,academic_year_id uuid not null,month_on date not null,
  status text not null check(status in ('draft','submitted','locked')),
  snapshot_id uuid not null,
  version integer not null default 1 check(version>=1),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(section_id,month_on),check(extract(day from month_on)=1),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict,
  foreign key(snapshot_id,section_id,month_on) references edunexus.attendance_month_snapshots(id,section_id,month_on) on delete restrict
);
create index attendance_month_snapshot_idx on edunexus.attendance_months(snapshot_id);
create index attendance_month_frozen_year_idx on edunexus.attendance_months(academic_year_id,month_on,section_id) where status in ('submitted','locked');
create table edunexus.attendance_month_events (
  id uuid primary key default gen_random_uuid(),month_id uuid not null references edunexus.attendance_months(id) on delete restrict,
  month_version integer not null check(month_version>=1),action text not null check(action in ('submit','return','lock','reopen')),
  snapshot_id uuid not null references edunexus.attendance_month_snapshots(id) on delete restrict,
  review_snapshot jsonb not null,review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(month_id,month_version)
);
create index attendance_month_event_snapshot_idx on edunexus.attendance_month_events(snapshot_id);
create index attendance_month_event_actor_idx on edunexus.attendance_month_events(actor_user_id);
do $$ declare t text; begin
  foreach t in array array['attendance_month_snapshots','attendance_months','attendance_month_events'] loop
    execute format('alter table edunexus.%I enable row level security',t);
    execute format('create policy manager_read on edunexus.%I for select to edunexus_app using(edunexus.is_manager())',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
  end loop;
end $$;
create trigger version_record before update on edunexus.attendance_months for each row execute function edunexus.version_record();
grant select on edunexus.attendance_month_snapshots,edunexus.attendance_months,edunexus.attendance_month_events to edunexus_app;

create function edunexus.assert_attendance_month_open(p_section uuid,p_date date) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from edunexus.attendance_months where section_id=p_section and month_on=date_trunc('month',p_date)::date and status<>'draft') then
    raise exception using errcode='P0707',message='Return or reopen the attendance month before editing'; end if;
end $$;
-- Extend daily context without changing old saved journal snapshots.
alter function edunexus.attendance_context(uuid,date) rename to attendance_context_before_months;
create function edunexus.attendance_context(p_section uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; m edunexus.attendance_months;
begin
  context:=edunexus.attendance_context_before_months(p_section,p_date);
  select * into m from edunexus.attendance_months where section_id=p_section and month_on=date_trunc('month',p_date)::date;
  return context || jsonb_build_object('month_status',coalesce(m.status,'draft'),'month_version',coalesce(m.version,0));
end $$;
alter function edunexus.preview_daily_attendance(uuid,date,integer,jsonb,text) rename to preview_daily_attendance_before_months;
create function edunexus.preview_daily_attendance(p_section uuid,p_date date,p_version integer,p_changes jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform edunexus.attendance_context(p_section,p_date);
  perform edunexus.assert_attendance_month_open(p_section,p_date);
  return edunexus.preview_daily_attendance_before_months(p_section,p_date,p_version,p_changes,p_reason);
end $$;
alter function edunexus.read_daily_attendance(uuid,date,integer,uuid) rename to read_daily_attendance_before_months;
create function edunexus.read_daily_attendance(p_section uuid,p_date date,p_limit integer,p_after uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=edunexus.read_daily_attendance_before_months(p_section,p_date,p_limit,p_after);
  return result || jsonb_build_object('recording_available',(result->>'recording_available')::boolean and result->>'month_status'='draft');
end $$;
revoke all on function edunexus.preview_daily_attendance_before_months(uuid,date,integer,jsonb,text),edunexus.read_daily_attendance_before_months(uuid,date,integer,uuid) from edunexus_app;
grant execute on function edunexus.preview_daily_attendance(uuid,date,integer,jsonb,text),edunexus.read_daily_attendance(uuid,date,integer,uuid) to edunexus_app;

create function edunexus.attendance_month_scope(p_section uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; m edunexus.attendance_months; first_date date; last_date date;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if not edunexus.is_manager() and y.status='closed' then raise exception using errcode='P0002',message='Section not found'; end if;
  if p_month is null or extract(day from p_month)<>1 then raise exception using errcode='P0700',message='Use the first day of the month'; end if;
  first_date:=greatest(p_month,y.starts_on);last_date:=least((p_month+interval '1 month - 1 day')::date,y.ends_on);
  if first_date>last_date then raise exception using errcode='P0700',message='Month does not overlap school year'; end if;
  select * into m from edunexus.attendance_months where section_id=p_section and month_on=p_month;
  return jsonb_build_object('section_id',p_section,'academic_year_id',y.id,'month_on',p_month,'from',first_date,'to',last_date,
    'status',coalesce(m.status,'draft'),'version',coalesce(m.version,0),'snapshot_id',m.snapshot_id,
    'section',to_jsonb(s)-'created_at'-'updated_at','school_year',to_jsonb(y)-'created_at'-'updated_at');
end $$;
create function edunexus.build_attendance_month(p_scope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
  -- Materialize each effective timeline once, rather than resolving it per day.
  with days as materialized (
    select (p_scope->>'from')::date+n day_on,edunexus.effective_calendar_day((p_scope->>'academic_year_id')::uuid,(p_scope->>'section_id')::uuid,(p_scope->>'from')::date+n) schedule
    from generate_series(0,(p_scope->>'to')::date-(p_scope->>'from')::date) n
  ), enrollments as materialized (
    select e.id,e.version,e.learner_id recorded_learner_id,l.id learner_id,l.version learner_version,l.first_name,l.middle_name,l.last_name,l.name_extension,
      edunexus.resolve_enrollment_timeline(e.id) timeline
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    where e.academic_year_id=(p_scope->>'academic_year_id')::uuid and e.record_state='valid' and e.enrolled_on<=(p_scope->>'to')::date
  ), cells as materialized (
    select e.*,d.day_on,d.schedule,m.am,m.pm
    from enrollments e cross join days d
    cross join lateral (select value from jsonb_array_elements(e.timeline) where (value->>'effective_on')::date<=d.day_on order by (value->>'effective_on')::date desc limit 1) state
    left join edunexus.attendance_marks m on m.enrollment_id=e.id and m.day_on=d.day_on
    where state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=(p_scope->>'section_id')::uuid
  ), member_ids as materialized (
    select distinct id from cells limit 1001
  ), members as (
    select id,jsonb_build_object('enrollment_id',id,'enrollment_version',version,'recorded_learner_id',recorded_learner_id,'learner_id',learner_id,'learner_version',learner_version,
      'first_name',first_name,'middle_name',middle_name,'last_name',last_name,'name_extension',name_extension,
      'dates',jsonb_agg(jsonb_build_object('day_on',day_on,'am',am,'pm',pm) order by day_on)) member
    from cells where (select count(*) from member_ids)<=1000
    group by id,version,recorded_learner_id,learner_id,learner_version,first_name,middle_name,last_name,name_extension
  ), daily as (
    select d.day_on,d.schedule,count(c.id)::integer eligible_learners,
      count(*) filter(where c.id is not null and d.schedule->>'am'='classroom')::integer+count(*) filter(where c.id is not null and d.schedule->>'pm'='classroom')::integer expected_sessions,
      count(*) filter(where c.id is not null and d.schedule->>'am'='classroom' and c.am is null)::integer+count(*) filter(where c.id is not null and d.schedule->>'pm'='classroom' and c.pm is null)::integer missing_sessions,
      count(*) filter(where c.am='present')::integer+count(*) filter(where c.pm='present')::integer present_sessions,
      count(*) filter(where c.am='absent')::integer+count(*) filter(where c.pm='absent')::integer absent_sessions
    from days d left join cells c on c.day_on=d.day_on group by d.day_on,d.schedule
  ) select jsonb_build_object('section',p_scope->'section','school_year',p_scope->'school_year','month_on',p_scope->'month_on','from',p_scope->'from','to',p_scope->'to',
    'days',(select jsonb_agg(to_jsonb(daily) order by day_on) from daily),
    'members',(select coalesce(jsonb_agg(member order by id),'[]') from members),
    'summary',jsonb_build_object('member_count',(select count(*) from member_ids),'dates_requested',(select count(*) from days),
      'unconfigured_dates',(select count(*) from days where not (schedule->>'configured')::boolean),
      'unsupported_sessions',(select count(*) from days cross join lateral (values(schedule->>'am'),(schedule->>'pm')) modes(mode) where mode='alternative_delivery'),
      'expected_sessions',(select coalesce(sum(expected_sessions),0) from daily),'missing_sessions',(select coalesce(sum(missing_sessions),0) from daily),
      'present_sessions',(select coalesce(sum(present_sessions),0) from daily),'absent_sessions',(select coalesce(sum(absent_sessions),0) from daily))) into payload;
  if (payload->'summary'->>'member_count')::integer>1000 then raise exception using errcode='P0709',message='Monthly review exceeds supported processing size'; end if;
  return payload;
end $$;
create function edunexus.read_attendance_month_status(p_section uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
begin return edunexus.attendance_month_scope(p_section,p_month)-'section'-'school_year'-'snapshot_id'; end $$;
create function edunexus.read_attendance_month(p_section uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; payload jsonb; issues text[]:='{}'; digest text;
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  scope:=edunexus.attendance_month_scope(p_section,p_month);
  if scope->>'status'='draft' then payload:=edunexus.build_attendance_month(scope);digest:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  else select s.payload,s.data_hash into payload,digest from edunexus.attendance_month_snapshots s where id=(scope->>'snapshot_id')::uuid; end if;
  if scope->'school_year'->>'status'<>'active' then issues:=array_append(issues,'YEAR_NOT_ACTIVE'); end if;
  if (scope->>'to')::date>=timezone('Asia/Manila',now())::date then issues:=array_append(issues,'MONTH_NOT_ENDED'); end if;
  if (payload->'summary'->>'unconfigured_dates')::integer>0 then issues:=array_append(issues,'UNCONFIGURED_DATES'); end if;
  if (payload->'summary'->>'unsupported_sessions')::integer>0 then issues:=array_append(issues,'UNSUPPORTED_ADM'); end if;
  if (payload->'summary'->>'missing_sessions')::integer>0 then issues:=array_append(issues,'MISSING_MARKS'); end if;
  return scope || jsonb_build_object('review',payload-'members','data_hash',digest,'issues',issues,'can_submit',scope->>'status'='draft' and cardinality(issues)=0,
    'source',case when scope->>'status'='draft' then 'live' else 'submission_snapshot' end);
end $$;
create function edunexus.read_attendance_month_members(p_section uuid,p_month date,p_snapshot uuid,p_limit integer,p_after uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; payload jsonb; digest text; snapshot uuid; items jsonb;
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  scope:=edunexus.attendance_month_scope(p_section,p_month);
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='23514',message='Invalid page limit'; end if;
  snapshot:=coalesce(p_snapshot,case when scope->>'status'<>'draft' then (scope->>'snapshot_id')::uuid else null end);
  if snapshot is null then payload:=edunexus.build_attendance_month(scope);digest:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  else
    select s.payload,s.data_hash into payload,digest from edunexus.attendance_month_snapshots s where id=snapshot and section_id=p_section and month_on=p_month;
    if not found then raise exception using errcode='P0002',message='Snapshot not found'; end if;
  end if;
  select coalesce(jsonb_agg(value order by value->>'enrollment_id'),'[]') into items from (
    select value from jsonb_array_elements(payload->'members') where p_after is null or (value->>'enrollment_id')::uuid>p_after order by value->>'enrollment_id' limit p_limit+1
  ) page;
  return jsonb_build_object('section_id',p_section,'month_on',p_month,'snapshot_id',snapshot,'data_hash',digest,'member_count',payload->'summary'->'member_count',
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(items) with ordinality where ordinality<=p_limit),
    'pagination',jsonb_build_object('limit',p_limit,'next_after_id',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'enrollment_id' else null end));
end $$;
create function edunexus.preview_attendance_month(p_section uuid,p_month date,p_version integer,p_action text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_review jsonb; plan jsonb; target text;
begin
  current_review:=edunexus.read_attendance_month(p_section,p_month);
  if p_version is null or p_version<>(current_review->>'version')::integer then raise exception using errcode='P0003',message='Month changed'; end if;
  if current_review->'school_year'->>'status'<>'active' then raise exception using errcode='P0701',message='Month transitions require an active year'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid review reason'; end if;
  if p_action='submit' and current_review->>'status'='draft' then target:='submitted';
  elsif p_action='lock' and current_review->>'status'='submitted' then target:='locked';
  elsif p_action='return' and current_review->>'status'='submitted' then target:='draft';
  elsif p_action='reopen' and current_review->>'status'='locked' then target:='draft';
  else raise exception using errcode='P0702',message='Invalid month transition'; end if;
  plan:=current_review || jsonb_build_object('action',p_action,'target_status',target,'reason',btrim(p_reason),'actor_user_id',edunexus.actor_id(),
    'can_commit',p_action<>'submit' or (current_review->>'can_submit')::boolean);
  return plan || jsonb_build_object('review_hash',case when (plan->>'can_commit')::boolean then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;
create function edunexus.commit_attendance_month(p_section uuid,p_month date,p_version integer,p_action text,p_reason text,p_hash text)
returns edunexus.attendance_month_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; payload jsonb; snapshot uuid; root uuid; result edunexus.attendance_month_events;
begin
  plan:=edunexus.preview_attendance_month(p_section,p_month,p_version,p_action,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0703',message='Resolve monthly completeness issues before submission'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0704',message='Monthly review changed'; end if;
  if p_action='submit' then
    payload:=edunexus.build_attendance_month(plan);
    if encode(sha256(convert_to(payload::text,'UTF8')),'hex')<>plan->>'data_hash' then raise exception using errcode='P0704',message='Monthly data changed'; end if;
    insert into edunexus.attendance_month_snapshots(section_id,academic_year_id,month_on,payload,data_hash) values(p_section,(plan->>'academic_year_id')::uuid,p_month,payload,plan->>'data_hash') returning id into snapshot;
  else snapshot:=(plan->>'snapshot_id')::uuid; end if;
  insert into edunexus.attendance_months(section_id,academic_year_id,month_on,status,snapshot_id) values(p_section,(plan->>'academic_year_id')::uuid,p_month,plan->>'target_status',snapshot)
    on conflict(section_id,month_on) do update set status=excluded.status,snapshot_id=excluded.snapshot_id returning id into root;
  insert into edunexus.attendance_month_events(month_id,month_version,action,snapshot_id,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(root,p_version+1,p_action,snapshot,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  return result;
end $$;

create function edunexus.guard_attendance_month_day() returns trigger language plpgsql security definer set search_path='' as $$
declare s uuid; d date;
begin
  if tg_table_name='attendance_days' then s:=new.section_id;d:=new.day_on;
  else select section_id,day_on into s,d from edunexus.attendance_days where id=new.attendance_day_id; end if;
  perform edunexus.assert_attendance_month_open(s,d);return new;
end $$;
create trigger month_guard before insert or update on edunexus.attendance_days for each row execute function edunexus.guard_attendance_month_day();
create trigger month_guard before insert or update on edunexus.attendance_marks for each row execute function edunexus.guard_attendance_month_day();
create function edunexus.guard_attendance_month_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from edunexus.attendance_months where academic_year_id=new.academic_year_id and month_on=date_trunc('month',new.day_on)::date and status<>'draft'
    and (new.section_id is null or section_id=new.section_id)) then raise exception using errcode='P0707',message='Return or reopen affected section months before changing their calendar'; end if;
  return new;
end $$;
create trigger month_guard before insert or update on edunexus.instructional_days for each row execute function edunexus.guard_attendance_month_calendar();
create function edunexus.guard_attendance_month_enrollment() returns trigger language plpgsql security definer set search_path='' as $$
declare frozen record; expected jsonb; actual jsonb; timeline jsonb; validity text;
begin
  if not exists(select 1 from edunexus.attendance_months where academic_year_id=new.academic_year_id and status<>'draft') then return null; end if;
  select record_state into validity from edunexus.enrollments where id=new.id;timeline:=edunexus.resolve_enrollment_timeline(new.id);
  for frozen in select m.section_id,s.payload from edunexus.attendance_months m join edunexus.attendance_month_snapshots s on s.id=m.snapshot_id
    where m.academic_year_id=new.academic_year_id and m.status<>'draft' loop
    select coalesce(jsonb_agg(d->>'day_on' order by d->>'day_on'),'[]') into expected from jsonb_array_elements(frozen.payload->'members') member
      cross join lateral jsonb_array_elements(member->'dates') d where member->>'enrollment_id'=new.id::text;
    select coalesce(jsonb_agg(day_on order by day_on),'[]') into actual from (
      select ((frozen.payload->>'from')::date+n)::text day_on from generate_series(0,(frozen.payload->>'to')::date-(frozen.payload->>'from')::date) n
      cross join lateral (select value from jsonb_array_elements(timeline) where (value->>'effective_on')::date<=(frozen.payload->>'from')::date+n order by (value->>'effective_on')::date desc limit 1) state
      where validity='valid' and state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=frozen.section_id
    ) dates;
    if expected<>actual then raise exception using errcode='P0708',message='Enrollment change affects a frozen attendance month'; end if;
  end loop;return null;
end $$;
create constraint trigger attendance_month_enrollment_guard after insert or update on edunexus.enrollments deferrable initially deferred
  for each row execute function edunexus.guard_attendance_month_enrollment();
create function edunexus.guard_attendance_month_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.merged_into is distinct from old.merged_into or new.identity_revision<>old.identity_revision then
    if exists(select 1 from edunexus.attendance_months m join edunexus.attendance_month_snapshots s on s.id=m.snapshot_id
      where m.status<>'draft' and (s.payload @> jsonb_build_object('members',jsonb_build_array(jsonb_build_object('learner_id',old.id)))
        or s.payload @> jsonb_build_object('members',jsonb_build_array(jsonb_build_object('recorded_learner_id',old.id))))) then
      raise exception using errcode='P0708',message='Identity change affects a frozen attendance month'; end if;
  end if;return new;
end $$;
create trigger attendance_month_identity_guard before update on edunexus.learners for each row execute function edunexus.guard_attendance_month_identity();

revoke all on function edunexus.assert_attendance_month_open(uuid,date),edunexus.attendance_context(uuid,date),edunexus.attendance_context_before_months(uuid,date),
  edunexus.attendance_month_scope(uuid,date),edunexus.build_attendance_month(jsonb),edunexus.read_attendance_month_status(uuid,date),edunexus.read_attendance_month(uuid,date),edunexus.read_attendance_month_members(uuid,date,uuid,integer,uuid),
  edunexus.preview_attendance_month(uuid,date,integer,text,text),edunexus.commit_attendance_month(uuid,date,integer,text,text,text),
  edunexus.guard_attendance_month_day(),edunexus.guard_attendance_month_calendar(),edunexus.guard_attendance_month_enrollment(),edunexus.guard_attendance_month_identity(),
  edunexus.preview_daily_attendance(uuid,date,integer,jsonb,text),edunexus.read_daily_attendance(uuid,date,integer,uuid) from public;
grant execute on function edunexus.read_attendance_month_status(uuid,date),edunexus.read_attendance_month(uuid,date),edunexus.read_attendance_month_members(uuid,date,uuid,integer,uuid),
  edunexus.preview_attendance_month(uuid,date,integer,text,text),edunexus.commit_attendance_month(uuid,date,integer,text,text,text) to edunexus_app;
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot'
));
