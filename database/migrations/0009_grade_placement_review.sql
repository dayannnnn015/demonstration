-- Section 2B.5: whole-year grade-placement corrections share the effective
-- timeline journal. Historical rows retain unknown grade metadata as NULL.
alter table edunexus.enrollment_corrections
  add column correction_kind text not null default 'timeline' check(correction_kind in ('timeline','placement')),
  add column previous_grade_level smallint check(previous_grade_level between 0 and 6),
  add column corrected_grade_level smallint check(corrected_grade_level between 0 and 6),
  add constraint enrollment_correction_grade_check check(
    (correction_kind='timeline' and previous_grade_level is not distinct from corrected_grade_level)
    or (correction_kind='placement' and previous_grade_level is not null and corrected_grade_level is not null and previous_grade_level<>corrected_grade_level));
create index enrollment_placement_history_idx on edunexus.enrollment_corrections(enrollment_id,enrollment_version desc) where correction_kind='placement';

create function edunexus.guard_enrollment_placement() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.academic_year_id<>old.academic_year_id then raise exception using errcode='23514',message='Original school year is immutable'; end if;
  if new.grade_level<>old.grade_level and not exists(select 1 from edunexus.enrollment_corrections
    where enrollment_id=old.id and enrollment_version=old.version+1 and correction_kind='placement'
      and previous_grade_level=old.grade_level and corrected_grade_level=new.grade_level
      and transaction_id=txid_current()::text and actor_user_id=edunexus.actor_id()) then
    raise exception using errcode='42501',message='Reviewed grade-placement correction required';
  end if;
  return new;
end $$;
create trigger enrollment_placement_guard before update on edunexus.enrollments for each row execute function edunexus.guard_enrollment_placement();

create or replace function edunexus.preview_enrollment_timeline(p_id uuid,p_version integer,p_entries jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return edunexus.preview_enrollment_revision(p_id,p_version,p_entries,p_reason,null); end $$;

create function edunexus.preview_enrollment_placement(p_id uuid,p_version integer,p_grade integer,p_entries jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_grade is null then raise exception using errcode='23514',message='Target grade required'; end if;
  return edunexus.preview_enrollment_revision(p_id,p_version,p_entries,p_reason,p_grade);
end $$;

-- One private writer keeps both correction workflows and their reference rows
-- atomic, with identical version/hash validation and projection behavior.
create function edunexus.apply_enrollment_revision(p_id uuid,p_version integer,p_entries jsonb,p_reason text,p_review text,p_grade integer)
returns edunexus.enrollment_corrections language plpgsql security definer set search_path='' as $$
declare plan jsonb; result edunexus.enrollment_corrections; state jsonb;
begin
  plan:=edunexus.preview_enrollment_revision(p_id,p_version,p_entries,p_reason,p_grade);
  if p_review is distinct from plan->>'review_hash' then raise exception using errcode='P0104',message='Reviewed enrollment correction changed'; end if;
  insert into edunexus.enrollment_corrections(enrollment_id,enrollment_version,before_entries,after_entries,first_affected_on,reason,review_hash,actor_user_id,request_id,
    correction_kind,previous_grade_level,corrected_grade_level)
  values(p_id,p_version+1,plan->'before_entries',plan->'after_entries',(plan->>'first_affected_on')::date,btrim(p_reason),p_review,
    edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid,
    plan->>'correction_kind',(plan->>'previous_grade_level')::smallint,(plan->>'corrected_grade_level')::smallint) returning * into result;
  insert into edunexus.enrollment_correction_sections(correction_id,section_id)
    select result.id,(value->>'section_id')::uuid from jsonb_array_elements(result.before_entries || result.after_entries) group by value->>'section_id';
  state:=plan->'proposed_state';
  update edunexus.enrollments set grade_level=(plan->>'corrected_grade_level')::smallint,
    enrolled_on=(state->>'enrolled_on')::date,effective_on=(state->>'effective_on')::date,
    section_id=(state->>'section_id')::uuid,status=state->>'status',last_reason=state->>'last_reason' where id=p_id;
  return result;
end $$;

create or replace function edunexus.correct_enrollment_timeline(p_id uuid,p_version integer,p_entries jsonb,p_reason text,p_review text)
returns edunexus.enrollment_corrections language plpgsql security definer set search_path='' as $$
begin return edunexus.apply_enrollment_revision(p_id,p_version,p_entries,p_reason,p_review,null); end $$;

create function edunexus.correct_enrollment_placement(p_id uuid,p_version integer,p_grade integer,p_entries jsonb,p_reason text,p_review text)
returns edunexus.enrollment_corrections language plpgsql security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_grade is null then raise exception using errcode='23514',message='Target grade required'; end if;
  return edunexus.apply_enrollment_revision(p_id,p_version,p_entries,p_reason,p_review,p_grade);
end $$;

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory'
));
revoke all on function edunexus.guard_enrollment_placement(),edunexus.apply_enrollment_revision(uuid,integer,jsonb,text,text,integer),
  edunexus.preview_enrollment_placement(uuid,integer,integer,jsonb,text),edunexus.correct_enrollment_placement(uuid,integer,integer,jsonb,text,text) from public;
grant execute on function edunexus.preview_enrollment_placement(uuid,integer,integer,jsonb,text),
  edunexus.correct_enrollment_placement(uuid,integer,integer,jsonb,text,text) to edunexus_app;

-- Shared revision validator, private to manager-checking wrappers.
create function edunexus.preview_enrollment_revision(p_id uuid,p_version integer,p_entries jsonb,p_reason text,p_grade integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  e edunexus.enrollments; y edunexus.academic_years; l edunexus.learners; s edunexus.sections;
  item jsonb; before_rows jsonb; normalized jsonb:='[]'; context jsonb; section_context jsonb;
  d date; sid uuid; kind text; why text; current_state text; previous_date date; previous_section uuid; previous_reason text;
  target_grade integer; revision_kind text;
  n integer:=0; first_day date; first_affected date; review text;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  select * into l from edunexus.learners where id=(select coalesce(merged_into,id) from edunexus.learners where id=e.learner_id) for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment changed'; end if;
  if e.record_state='voided' then raise exception using errcode='P0301',message='Voided enrollment is read only'; end if;
  if y.status='closed' then raise exception using errcode='P0105',message='School year is closed'; end if;
  target_grade:=coalesce(p_grade,e.grade_level);
  revision_kind:=case when p_grade is null then 'timeline' else 'placement' end;
  if target_grade not between 0 and 6 then raise exception using errcode='23514',message='Grade must be Kindergarten through Grade 6'; end if;
  if p_grade=e.grade_level then raise exception using errcode='P0400',message='Use timeline review for same-grade corrections'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode='23514',message='A review reason is required';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception using errcode='23514',message='Timeline must be an array'; end if;
  if jsonb_array_length(p_entries) not between 1 and 1000 then raise exception using errcode='23514',message='Invalid timeline size'; end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    n:=n+1;
    if jsonb_typeof(item) is distinct from 'object' then raise exception using errcode='23514',message='Invalid timeline entry'; end if;
    if not (item ?& array['event_type','effective_on','section_id','reason'])
      or (select count(*) from jsonb_object_keys(item))<>4
      or exists(select 1 from jsonb_each(item) where jsonb_typeof(value)<>'string') then
      raise exception using errcode='23514',message='Invalid timeline entry fields';
    end if;
    if (item->>'effective_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='P0100',message='Invalid date'; end if;
    begin d:=(item->>'effective_on')::date; sid:=(item->>'section_id')::uuid;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception using errcode='23514',message='Invalid date or section identifier';
    end;
    kind:=item->>'event_type'; why:=item->>'reason';
    if d<y.starts_on or d>y.ends_on or d<=l.birth_date or (n>1 and (d<=previous_date or d>timezone('Asia/Manila',now())::date)) then
      raise exception using errcode='P0100',message='Timeline dates are invalid';
    end if;
    select * into s from edunexus.sections where id=sid;
    if not found or s.academic_year_id<>e.academic_year_id or s.grade_level<>target_grade then
      raise exception using errcode='P0102',message='Section must match enrollment year and grade';
    end if;
    if n=1 then
      if kind<>'enrolled' or why not in ('regular','transfer_in') then raise exception using errcode='P0101',message='Timeline must start with enrollment'; end if;
      current_state:='enrolled'; first_day:=d;
    elsif kind='reassigned' then
      if current_state<>'enrolled' or sid=previous_section or why<>'section_change' then raise exception using errcode='P0101',message='Invalid reassignment'; end if;
    elsif kind='withdrawn' then
      if current_state<>'enrolled' or sid<>previous_section or why not in ('transfer_out','withdrawal','dropout','death') then raise exception using errcode='P0101',message='Invalid withdrawal'; end if;
      current_state:='withdrawn';
    elsif kind='reentered' then
      if current_state<>'withdrawn' or previous_reason='death' or why<>'return_to_school' then raise exception using errcode='P0101',message='Invalid reentry'; end if;
      current_state:='enrolled';
    else raise exception using errcode='P0101',message='Invalid transition'; end if;
    normalized:=normalized || jsonb_build_array(jsonb_build_object('event_type',kind,'effective_on',d,'section_id',sid,'reason',why));
    previous_date:=d; previous_section:=sid; previous_reason:=why;
  end loop;
  before_rows:=edunexus.resolve_enrollment_timeline(e.id);
  if p_grade is not null and (select coalesce(jsonb_agg(a.value-'section_id' order by a.position),'[]') from jsonb_array_elements(before_rows) with ordinality a(value,position))
    is distinct from (select coalesce(jsonb_agg(b.value-'section_id' order by b.position),'[]') from jsonb_array_elements(normalized) with ordinality b(value,position)) then
    raise exception using errcode='P0401',message='Placement corrections preserve dates, transitions, and reasons';
  end if;
  if before_rows=normalized then raise exception using errcode='P0103',message='Timeline is unchanged'; end if;
  select min(least((a.value->>'effective_on')::date,(b.value->>'effective_on')::date)) into first_affected
    from jsonb_array_elements(before_rows) with ordinality a(value,position)
    full join jsonb_array_elements(normalized) with ordinality b(value,position) using(position)
    where a.value is distinct from b.value;
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'academic_year_id',academic_year_id,'grade_level',grade_level,'adviser_user_id',adviser_user_id,'version',version) order by id) into section_context
    from edunexus.sections where id in (select (value->>'section_id')::uuid from jsonb_array_elements(before_rows || normalized));
  context:=jsonb_build_object('enrollment_id',e.id,'correction_kind',revision_kind,'previous_grade_level',e.grade_level,'corrected_grade_level',target_grade,'version',e.version,'learner_version',l.version,'learner_id',l.id,'recorded_learner_id',e.learner_id,'actor_user_id',edunexus.actor_id(),
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,'status',y.status,'version',y.version),
    'sections',section_context,'before_entries',before_rows,'after_entries',normalized,'reason',btrim(p_reason),'first_affected_on',first_affected,
    'previous_state',jsonb_build_object('enrolled_on',e.enrolled_on,'effective_on',e.effective_on,'status',e.status,'section_id',e.section_id,'last_reason',e.last_reason),
    'proposed_state',jsonb_build_object('enrolled_on',first_day,'effective_on',d,'status',current_state,'section_id',sid,'last_reason',why));
  review:=encode(sha256(convert_to(context::text,'UTF8')),'hex');
  return context || jsonb_build_object('review_hash',review);
end $$;
revoke all on function edunexus.preview_enrollment_revision(uuid,integer,jsonb,text,integer) from public;

create or replace function edunexus.get_enrollment_timeline(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments;
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  -- Keep the enrollment version and resolved entries in a single snapshot.
  select * into e from edunexus.enrollments where id=p_id for share;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  return jsonb_build_object('enrollment_id',e.id,'academic_year_id',e.academic_year_id,'grade_level',e.grade_level,'version',e.version,'record_state',e.record_state,'usable_for_reporting',e.record_state='valid','entries',edunexus.resolve_enrollment_timeline(e.id),
    'latest_correction_id',(select id from edunexus.enrollment_corrections where enrollment_id=e.id order by enrollment_version desc limit 1));
end $$;
