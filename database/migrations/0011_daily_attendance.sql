-- Section 3B.1: reviewed classroom attendance; no official attendance arithmetic.
create table edunexus.attendance_days (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references edunexus.sections(id) on delete restrict,
  day_on date not null,
  version integer not null default 1 check(version>=1),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(section_id,day_on)
);
create table edunexus.attendance_marks (
  id uuid primary key default gen_random_uuid(),
  attendance_day_id uuid not null references edunexus.attendance_days(id) on delete restrict,
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  day_on date not null,
  am text check(am in ('present','absent')),pm text check(pm in ('present','absent')),
  version integer not null default 1,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(enrollment_id,day_on)
);
create index attendance_marks_day_idx on edunexus.attendance_marks(attendance_day_id,enrollment_id);
create table edunexus.attendance_review_events (
  id uuid primary key default gen_random_uuid(),
  attendance_day_id uuid not null references edunexus.attendance_days(id) on delete restrict,
  attendance_version integer not null,
  review_snapshot jsonb not null,
  review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
  unique(attendance_day_id,attendance_version)
);
create index attendance_review_actor_idx on edunexus.attendance_review_events(actor_user_id);
do $$ declare t text; begin
  foreach t in array array['attendance_days','attendance_marks','attendance_review_events'] loop
    execute format('alter table edunexus.%I enable row level security',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
  end loop;
  foreach t in array array['attendance_days','attendance_marks'] loop
    execute format('create trigger version_record before update on edunexus.%I for each row execute function edunexus.version_record()',t);
  end loop;
end $$;
create policy attendance_day_read on edunexus.attendance_days for select to edunexus_app using(edunexus.is_manager() or
  (edunexus.actor_role()='teacher' and exists(select 1 from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
    where s.id=section_id and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed')));
create policy attendance_mark_read on edunexus.attendance_marks for select to edunexus_app using(edunexus.can_read_enrollment(enrollment_id)
  and exists(select 1 from edunexus.attendance_days d where d.id=attendance_day_id));
create policy attendance_review_read on edunexus.attendance_review_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.attendance_days,edunexus.attendance_marks,edunexus.attendance_review_events to edunexus_app;

-- Private resolver honors corrections before ordinary later movements.
create function edunexus.enrollment_state_on(p_id uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
  select value from jsonb_array_elements(edunexus.resolve_enrollment_timeline(p_id))
  where (value->>'effective_on')::date<=p_date order by (value->>'effective_on')::date desc limit 1
$$;
create function edunexus.attendance_context(p_section uuid,p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if not edunexus.is_manager() and y.status='closed' then raise exception using errcode='P0002',message='Section not found'; end if;
  if p_date is null or p_date<y.starts_on or p_date>y.ends_on then raise exception using errcode='P0600',message='Attendance date outside year'; end if;
  return jsonb_build_object('section',to_jsonb(s)-'created_at'-'updated_at','school_year',to_jsonb(y)-'created_at'-'updated_at',
    'day_on',p_date,'version',coalesce((select version from edunexus.attendance_days where section_id=p_section and day_on=p_date),0),
    'calendar_version',coalesce((select version from edunexus.instructional_calendars where id=y.id),0),
    'schedule',edunexus.effective_calendar_day(y.id,p_section,p_date),'visibility',case when edunexus.is_manager() then 'full_historical_roster' else 'current_access_only' end);
end $$;
create function edunexus.read_daily_attendance(p_section uuid,p_date date,p_limit integer,p_after uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; items jsonb;
begin
  context:=edunexus.attendance_context(p_section,p_date);
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='23514',message='Invalid page limit'; end if;
  select coalesce(jsonb_agg(row order by row->>'enrollment_id'),'[]') into items from (
    select jsonb_build_object('enrollment_id',e.id,'enrollment_version',e.version,'learner_id',l.id,'recorded_learner_id',e.learner_id,
      'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,'name_extension',l.name_extension,
      'am',case when d.section_id=p_section then m.am else null end,'pm',case when d.section_id=p_section then m.pm else null end) row
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id
    join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    cross join lateral (select edunexus.enrollment_state_on(e.id,p_date) state) effective
    left join edunexus.attendance_marks m on m.enrollment_id=e.id and m.day_on=p_date
    left join edunexus.attendance_days d on d.id=m.attendance_day_id
    where e.academic_year_id=(context->'school_year'->>'id')::uuid and e.record_state='valid'
      and edunexus.can_read_enrollment(e.id) and effective.state->>'event_type'<>'withdrawn' and (effective.state->>'section_id')::uuid=p_section
      and (p_after is null or e.id>p_after) order by e.id limit p_limit+1
  ) rows;
  return context || jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(items) with ordinality where ordinality<=p_limit),
    'pagination',jsonb_build_object('limit',p_limit,'next_after_id',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'enrollment_id' else null end),
    'recording_available',coalesce(context->'school_year'->>'status'='active' and p_date<=timezone('Asia/Manila',now())::date and (context->'schedule'->>'am'='classroom' or context->'schedule'->>'pm'='classroom'),false));
end $$;
create function edunexus.preview_daily_attendance(p_section uuid,p_date date,p_version integer,p_changes jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; item jsonb; e edunexus.enrollments; l edunexus.learners; state jsonb; before_state jsonb; after_state jsonb;
  entries jsonb:='[]'; seen uuid[]:='{}'; eid uuid; changed integer:=0; plan jsonb;
begin
  context:=edunexus.attendance_context(p_section,p_date);
  if p_version is null or p_version<>(context->>'version')::integer then raise exception using errcode='P0003',message='Attendance changed'; end if;
  if context->'school_year'->>'status'<>'active' or p_date>timezone('Asia/Manila',now())::date then raise exception using errcode='P0601',message='Use an active year and nonfuture date'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' or jsonb_typeof(p_changes) is distinct from 'array' then raise exception using errcode='23514',message='Invalid review'; end if;
  if jsonb_array_length(p_changes) not between 1 and 100 then raise exception using errcode='23514',message='Supply 1 to 100 learners'; end if;
  for item in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception using errcode='23514',message='Invalid attendance row'; end if;
    if not (item ?& array['enrollment_id','am','pm']) or (select count(*) from jsonb_object_keys(item))<>3
      or jsonb_typeof(item->'enrollment_id') is distinct from 'string'
      or (item->>'enrollment_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'am') not in ('string','null') or jsonb_typeof(item->'pm') not in ('string','null')
      or (item->>'am' is not null and item->>'am' not in ('present','absent')) or (item->>'pm' is not null and item->>'pm' not in ('present','absent')) then
      raise exception using errcode='23514',message='Invalid attendance fields'; end if;
    eid:=(item->>'enrollment_id')::uuid;
    if eid=any(seen) then raise exception using errcode='23514',message='Duplicate learner'; end if; seen:=array_append(seen,eid);
    select * into e from edunexus.enrollments where id=eid and academic_year_id=(context->'school_year'->>'id')::uuid and record_state='valid';
    if not found or not edunexus.can_read_enrollment(eid) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
    state:=edunexus.enrollment_state_on(eid,p_date);
    if state is null or state->>'event_type'='withdrawn' or (state->>'section_id')::uuid<>p_section then raise exception using errcode='P0602',message='Learner not enrolled in this section on date'; end if;
    if (item->>'am' is not null and context->'schedule'->>'am' is distinct from 'classroom') or (item->>'pm' is not null and context->'schedule'->>'pm' is distinct from 'classroom') then
      raise exception using errcode='P0603',message='Only configured classroom sessions accept these marks'; end if;
    select jsonb_build_object('am',m.am,'pm',m.pm) into before_state from edunexus.attendance_marks m join edunexus.attendance_days d on d.id=m.attendance_day_id
      where m.enrollment_id=eid and m.day_on=p_date and d.section_id=p_section;
    before_state:=coalesce(before_state,jsonb_build_object('am',null,'pm',null)); after_state:=item-'enrollment_id';
    select retained.* into l from edunexus.learners original join edunexus.learners retained on retained.id=coalesce(original.merged_into,original.id) where original.id=e.learner_id;
    entries:=entries || jsonb_build_array(jsonb_build_object('enrollment_id',eid,'enrollment_version',e.version,'learner_id',l.id,'learner_version',l.version,
      'recorded_learner_id',e.learner_id,'first_name',l.first_name,'last_name',l.last_name,'before',before_state,'after',after_state,'changed',before_state<>after_state));
    if before_state<>after_state then changed:=changed+1; end if;
  end loop;
  if changed=0 then raise exception using errcode='P0604',message='Attendance has no changes'; end if;
  select jsonb_agg(value order by value->>'enrollment_id') into entries from jsonb_array_elements(entries);
  plan:=context || jsonb_build_object('changes',entries,'changed_count',changed,'reason',btrim(p_reason),'actor_user_id',edunexus.actor_id());
  return plan || jsonb_build_object('review_hash',encode(sha256(convert_to(plan::text,'UTF8')),'hex'));
end $$;
create function edunexus.commit_daily_attendance(p_section uuid,p_date date,p_version integer,p_changes jsonb,p_reason text,p_hash text)
returns edunexus.attendance_review_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; day_id uuid; item jsonb; result edunexus.attendance_review_events;
begin
  plan:=edunexus.preview_daily_attendance(p_section,p_date,p_version,p_changes,p_reason);
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0605',message='Attendance review changed'; end if;
  insert into edunexus.attendance_days(section_id,day_on) values(p_section,p_date) on conflict(section_id,day_on) do update set version=edunexus.attendance_days.version+1 returning id into day_id;
  insert into edunexus.attendance_review_events(attendance_day_id,attendance_version,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(day_id,p_version+1,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  for item in select value from jsonb_array_elements(plan->'changes') where (value->>'changed')::boolean loop
    insert into edunexus.attendance_marks(attendance_day_id,enrollment_id,day_on,am,pm) values(day_id,(item->>'enrollment_id')::uuid,p_date,item->'after'->>'am',item->'after'->>'pm')
      on conflict(enrollment_id,day_on) do update set attendance_day_id=excluded.attendance_day_id,am=excluded.am,pm=excluded.pm;
  end loop;
  return result;
end $$;

-- Check the final corrected timeline, after the existing event triggers have run.
-- Clears preserve history but free a record for an otherwise conflicting repair.
create function edunexus.guard_attendance_enrollment() returns trigger language plpgsql security definer set search_path='' as $$
declare m record; state jsonb; validity text;
begin
  select record_state into validity from edunexus.enrollments where id=new.id;
  for m in select a.day_on,d.section_id from edunexus.attendance_marks a join edunexus.attendance_days d on d.id=a.attendance_day_id
    where a.enrollment_id=new.id and (a.am is not null or a.pm is not null) loop
    state:=edunexus.enrollment_state_on(new.id,m.day_on);
    if validity<>'valid' or state is null or state->>'event_type'='withdrawn' or (state->>'section_id')::uuid<>m.section_id then
      raise exception using errcode='P0606',message='Clear affected attendance through review before changing enrollment'; end if;
  end loop;
  return null;
end $$;
create constraint trigger attendance_enrollment_guard after update on edunexus.enrollments deferrable initially deferred
  for each row execute function edunexus.guard_attendance_enrollment();
create function edunexus.guard_attendance_calendar() returns trigger language plpgsql security definer set search_path='' as $$
declare r record; schedule jsonb;
begin
  for r in select distinct d.section_id from edunexus.attendance_days d join edunexus.sections s on s.id=d.section_id
    where d.day_on=new.day_on and s.academic_year_id=new.academic_year_id and (new.section_id is null or d.section_id=new.section_id) loop
    schedule:=edunexus.effective_calendar_day(new.academic_year_id,r.section_id,new.day_on);
    if exists(select 1 from edunexus.attendance_marks m join edunexus.attendance_days d on d.id=m.attendance_day_id
      where d.section_id=r.section_id and d.day_on=new.day_on and ((m.am is not null and schedule->>'am' is distinct from 'classroom') or (m.pm is not null and schedule->>'pm' is distinct from 'classroom'))) then
      raise exception using errcode='P0606',message='Clear affected attendance through review before changing sessions'; end if;
  end loop;
  return null;
end $$;
create trigger attendance_calendar_guard after insert or update on edunexus.instructional_days for each row execute function edunexus.guard_attendance_calendar();
revoke all on function edunexus.enrollment_state_on(uuid,date),edunexus.attendance_context(uuid,date),edunexus.read_daily_attendance(uuid,date,integer,uuid),
  edunexus.preview_daily_attendance(uuid,date,integer,jsonb,text),edunexus.commit_daily_attendance(uuid,date,integer,jsonb,text,text),
  edunexus.guard_attendance_enrollment(),edunexus.guard_attendance_calendar() from public;
grant execute on function edunexus.read_daily_attendance(uuid,date,integer,uuid),edunexus.preview_daily_attendance(uuid,date,integer,jsonb,text),
  edunexus.commit_daily_attendance(uuid,date,integer,jsonb,text,text) to edunexus_app;
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory'
));
