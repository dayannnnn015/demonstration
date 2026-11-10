-- Promotion: what the school decided at the end of the year, recorded.
-- The manuscript's two use cases: the adviser recommends each learner's
-- outcome and the principal or administrative officer approves it. The
-- outcomes are the SF10 workbook's own words (PROMOTED, RETAINED, REMEDIAL).
-- Nothing here derives an outcome from grades: the adviser records the
-- school's decision, made by DepEd's rules on the ECR's final grades, and the
-- approver confirms it. An approved outcome fills the SF9's and SF10's
-- "eligible for admission to Grade", and is what next year's classes are
-- prepared from.
create table edunexus.promotion_decisions (
  enrollment_id uuid primary key references edunexus.enrollments(id) on delete restrict,
  action text check(action is null or action in ('promoted','retained','remedial')),
  status text not null default 'recommended' check(status in ('recommended','approved','returned')),
  recommended_by uuid not null references edunexus.staff(user_id) on delete restrict,
  decided_by uuid references edunexus.staff(user_id) on delete restrict,
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check((status='recommended')=(decided_by is null)),
  check(status<>'approved' or action is not null)
);
create index promotion_recommended_by_idx on edunexus.promotion_decisions(recommended_by);
create index promotion_decided_by_idx on edunexus.promotion_decisions(decided_by);
create table edunexus.promotion_events (
  id bigint generated always as identity primary key,
  section_id uuid not null references edunexus.sections(id) on delete restrict,
  kind text not null check(kind in ('recommend','approve','return')),
  entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 1 and 100),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index promotion_event_section_idx on edunexus.promotion_events(section_id,id desc);
create index promotion_event_actor_idx on edunexus.promotion_events(actor_user_id);
alter table edunexus.promotion_decisions enable row level security;
alter table edunexus.promotion_events enable row level security;
create policy scoped_read on edunexus.promotion_decisions for select to edunexus_app using(edunexus.can_read_enrollment(enrollment_id));
create policy scoped_read on edunexus.promotion_events for select to edunexus_app using(edunexus.is_manager() or exists(
  select 1 from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
  where s.id=section_id and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed'));
grant select on edunexus.promotion_decisions,edunexus.promotion_events to edunexus_app;
create trigger version_record before update on edunexus.promotion_decisions for each row execute function edunexus.version_record();
create function edunexus.audit_promotion() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into edunexus.audit_events(actor_user_id,request_id,operation,entity_table,entity_id,changed_fields)
  values(edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid,tg_op,tg_table_name,new.enrollment_id::text,
    array(select key from jsonb_each(to_jsonb(new)) where key not in ('created_at','updated_at','version') and (tg_op='INSERT' or value is distinct from to_jsonb(old)->key) order by key));
  return new;
end $$;
create trigger audit_record after insert or update on edunexus.promotion_decisions for each row execute function edunexus.audit_promotion();
create trigger audit_record after insert on edunexus.promotion_events for each row execute function edunexus.audit_record();

-- The section a promotion batch is for: Kindergarten included, since a Kindergarten learner is promoted to Grade 1.
create function edunexus.promotion_section(p_section uuid,p_manager_only boolean) returns edunexus.sections language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years;
begin
  if p_manager_only and not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if y.status='closed' then raise exception using errcode='P1900',message='A closed school year''s records are read only'; end if;
  return s;
end $$;

create function edunexus.record_promotion_recommendations(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.promotion_decisions; saved edunexus.promotion_decisions; changes jsonb:='[]'; seen uuid[]:='{}'; e uuid; a text;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.promotion_section(p_section,false);
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','action','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->'action' is null or jsonb_typeof(entry->'action') not in ('string','null') then
      raise exception using errcode='23514',message='Invalid promotion entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    a:=entry->>'action';
    if a is not null and a not in ('promoted','retained','remedial') then raise exception using errcode='23514',message='An outcome is promoted, retained or remedial'; end if;
    select * into existing from edunexus.promotion_decisions where enrollment_id=e for update;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
      -- An approved outcome is the school's; it changes only after an approver returns it.
      if existing.status='approved' then raise exception using errcode='P2000',message='This outcome is approved; ask the principal to return it first'; end if;
      if existing.action is not distinct from a and existing.status='recommended' then continue; end if;
      update edunexus.promotion_decisions set action=a,status='recommended',recommended_by=edunexus.actor_id(),decided_by=null where enrollment_id=e returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('action',existing.action,'status',existing.status),
        'after',jsonb_build_object('action',a,'status','recommended'),'version',saved.version));
    else
      if (entry->>'version')::integer is distinct from 0 then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
      if a is null then continue; end if;
      insert into edunexus.promotion_decisions(enrollment_id,action,recommended_by) values(e,a,edunexus.actor_id()) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',null,'after',jsonb_build_object('action',a,'status','recommended'),'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.promotion_events(section_id,kind,entries,reason,actor_user_id,request_id)
    values(s.id,'recommend',changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

create function edunexus.decide_promotions(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.promotion_decisions; saved edunexus.promotion_decisions; changes jsonb:='[]'; seen uuid[]:='{}'; e uuid; d text; kinds text[]:='{}';
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.promotion_section(p_section,true);
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','decision','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->>'decision' is null or entry->>'decision' not in ('approved','returned') then
      raise exception using errcode='23514',message='Invalid decision entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    d:=entry->>'decision';
    select * into existing from edunexus.promotion_decisions where enrollment_id=e for update;
    if not found or existing.action is null then raise exception using errcode='P2001',message='There is no recommended outcome to decide'; end if;
    if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
    if existing.status=d then continue; end if;
    update edunexus.promotion_decisions set status=d,decided_by=edunexus.actor_id() where enrollment_id=e returning * into saved;
    changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('action',existing.action,'status',existing.status),
      'after',jsonb_build_object('action',existing.action,'status',d),'version',saved.version));
    kinds:=array_append(kinds,d);
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.promotion_events(section_id,kind,entries,reason,actor_user_id,request_id)
    values(s.id,case when 'returned'=any(kinds) then 'return' else 'approve' end,changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

-- A section's outcomes, or the whole year's for a manager preparing next year's classes.
create function edunexus.read_promotions(p_year uuid,p_section uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  if p_section is null then
    if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  else
    select * into s from edunexus.sections where id=p_section;
    if not found or s.academic_year_id is distinct from p_year or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then
      raise exception using errcode='P0002',message='Section not found'; end if;
  end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('enrollment_id',p.enrollment_id,'section_id',e.section_id,'grade_level',e.grade_level,
      'action',p.action,'status',p.status,'version',p.version,'updated_at',p.updated_at,
      'recommended_by',(select display_name from edunexus.staff where user_id=p.recommended_by),'decided_by',(select display_name from edunexus.staff where user_id=p.decided_by))
      order by e.grade_level,e.section_id,p.enrollment_id),'[]'::jsonb)
    from edunexus.promotion_decisions p join edunexus.enrollments e on e.id=p.enrollment_id
    where e.academic_year_id=p_year and e.record_state='valid' and (p_section is null or e.section_id=p_section) and edunexus.can_read_enrollment(e.id)));
end $$;

-- The forms print an approved outcome as the grade the learner is eligible for.
-- Apart from the 'promotion' key, these are 0031's bodies.
create or replace function edunexus.read_sf9_source(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; s edunexus.sections; y edunexus.academic_years; l edunexus.learners; timeline jsonb;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if not found or e.record_state<>'valid' or not edunexus.can_read_enrollment(e.id) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  select * into s from edunexus.sections where id=e.section_id;
  select * into y from edunexus.academic_years where id=e.academic_year_id;
  select retained.* into l from edunexus.learners original join edunexus.learners retained on retained.id=coalesce(original.merged_into,original.id) where original.id=e.learner_id;
  timeline:=edunexus.resolve_enrollment_timeline(e.id);
  return jsonb_build_object('school',edunexus.form_school_heading(),'today',timezone('Asia/Manila',now())::date,
    'learner',jsonb_build_object('id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,'name_extension',l.name_extension,
      'sex',l.sex,'lrn',l.lrn,'birth_date',l.birth_date),
    'enrollment',jsonb_build_object('id',e.id,'grade_level',e.grade_level,'status',e.status,'section_id',s.id,'section_name',s.name,
      'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id)),
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,'status',y.status),
    'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal,'name',name,'starts_on',starts_on,'ends_on',ends_on) order by ordinal),'[]'::jsonb)
      from edunexus.reporting_periods where academic_year_id=y.id),
    'offerings',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'display_order',o.display_order,'code',o.subject_snapshot->>'code','name',o.subject_snapshot->>'name')
      order by o.display_order,o.subject_snapshot->>'name'),'[]'::jsonb) from edunexus.section_subjects o
      where (o.section_id=s.id and o.active) or o.id in (select offering_id from edunexus.report_grades where enrollment_id=e.id)),
    'grades',(select coalesce(jsonb_agg(jsonb_build_object('offering_id',offering_id,'reporting_period_id',reporting_period_id,'grade',grade,'remark',remark)),'[]'::jsonb)
      from edunexus.report_grades where enrollment_id=e.id),
    'summary',(select jsonb_build_object('general_average',general_average,'remark',remark) from edunexus.report_summaries where enrollment_id=e.id),
    'promotion',(select jsonb_build_object('action',action) from edunexus.promotion_decisions where enrollment_id=e.id and status='approved' and action is not null),
    'values',(select coalesce(jsonb_agg(jsonb_build_object('reporting_period_id',reporting_period_id,'ratings',ratings)),'[]'::jsonb) from edunexus.report_values where enrollment_id=e.id),
    'notes',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'reporting_period_id',reporting_period_id,'body',body)),'[]'::jsonb)
      from edunexus.report_notes where enrollment_id=e.id and kind<>'sf2_remark' and body is not null),
    'days',(select coalesce(jsonb_agg(jsonb_build_object('day_on',d.day_on,'am',d.schedule->>'am','pm',d.schedule->>'pm','configured',coalesce((d.schedule->>'configured')::boolean,false),
        'mark_am',k.am,'mark_pm',k.pm) order by d.day_on),'[]'::jsonb)
      from (select g.day_on,edunexus.effective_calendar_day(y.id,(state.value->>'section_id')::uuid,g.day_on) schedule
        from (select y.starts_on+n day_on from generate_series(0,y.ends_on-y.starts_on) n) g
        cross join lateral (select value from jsonb_array_elements(timeline) where (value->>'effective_on')::date<=g.day_on order by (value->>'effective_on')::date desc limit 1) state
        where state.value->>'event_type'<>'withdrawn') d
      left join edunexus.attendance_marks k on k.enrollment_id=e.id and k.day_on=d.day_on));
end $$;

create or replace function edunexus.read_sf10_source(p_learner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l edunexus.learners;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select retained.* into l from edunexus.learners original join edunexus.learners retained on retained.id=coalesce(original.merged_into,original.id) where original.id=p_learner;
  if not found or not edunexus.can_read_learner(l.id) then raise exception using errcode='P0002',message='Learner not found'; end if;
  return jsonb_build_object('school',edunexus.form_school_heading(),
    'learner',jsonb_build_object('id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,'name_extension',l.name_extension,
      'sex',l.sex,'lrn',l.lrn,'birth_date',l.birth_date),
    'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'grade_level',e.grade_level,'status',e.status,'section_name',s.name,
        'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id),
        'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on),
        'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'name',p.name) order by p.ordinal),'[]'::jsonb) from edunexus.reporting_periods p where p.academic_year_id=y.id),
        'offerings',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'display_order',o.display_order,'code',o.subject_snapshot->>'code','name',o.subject_snapshot->>'name')
          order by o.display_order,o.subject_snapshot->>'name'),'[]'::jsonb) from edunexus.section_subjects o
          where (o.section_id=s.id and o.active) or o.id in (select offering_id from edunexus.report_grades where enrollment_id=e.id)),
        'grades',(select coalesce(jsonb_agg(jsonb_build_object('offering_id',offering_id,'reporting_period_id',reporting_period_id,'grade',grade,'remark',remark)),'[]'::jsonb)
          from edunexus.report_grades where enrollment_id=e.id),
        'summary',(select jsonb_build_object('general_average',general_average,'remark',remark) from edunexus.report_summaries where enrollment_id=e.id),
        'promotion',(select jsonb_build_object('action',action) from edunexus.promotion_decisions where enrollment_id=e.id and status='approved' and action is not null))
      order by y.start_year,e.id),'[]'::jsonb)
      from edunexus.enrollments e join edunexus.sections s on s.id=e.section_id join edunexus.academic_years y on y.id=e.academic_year_id
      where e.record_state='valid' and e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=l.id) and edunexus.can_read_enrollment(e.id)));
end $$;

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory','enrollmentAttendance','enrollmentScores',
  'sf2Get','sf2Issue','sf9Get','sf9Issue','sf10Get','sf10Issue','reportRecordsGet','reportRecordsWrite',
  'promotionsGet','promotionsWrite','gradeSummaryGet'
));

revoke all on function edunexus.promotion_section(uuid,boolean),edunexus.audit_promotion(),edunexus.record_promotion_recommendations(uuid,jsonb,text),
  edunexus.decide_promotions(uuid,jsonb,text),edunexus.read_promotions(uuid,uuid) from public;
grant execute on function edunexus.record_promotion_recommendations(uuid,jsonb,text),edunexus.decide_promotions(uuid,jsonb,text),edunexus.read_promotions(uuid,uuid) to edunexus_app;
