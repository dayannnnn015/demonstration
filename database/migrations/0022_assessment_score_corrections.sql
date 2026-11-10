-- Corrective migration for the 20 September 2026 backend review. It invents no
-- academic rule, adds no endpoint and computes nothing: it restores to Section
-- 4B.1 the access, absence and audit guarantees the rest of the system already
-- holds, and widens one column to the bound the API had always documented.

-- The documented maximum is 10000 and numeric(6,2) stops at 9999.99, so the
-- API's own bound raised an overflow instead of saving. This is a storage
-- precision fix; the academic meaning of the maximum is still the school's.
alter table edunexus.assessment_tasks alter column max_score type numeric(7,2);
alter table edunexus.assessment_scores alter column raw_score type numeric(7,2);

-- A teacher reads only the learners they currently teach. Checking the task's
-- section alone left a withdrawn or transferred learner's marks readable by
-- their former adviser, in HTTP and in direct restricted-role SQL alike.
-- can_read_enrollment is the same predicate daily attendance already uses, and
-- it stays true for a manager, so nothing is lost from the historical record.
alter policy scoped_read on edunexus.assessment_scores using(edunexus.is_manager() or
  (edunexus.actor_role()='teacher' and edunexus.can_read_enrollment(enrollment_id) and exists(
    select 1 from edunexus.assessment_tasks t join edunexus.sections s on s.id=t.section_id join edunexus.academic_years y on y.id=s.academic_year_id
    where t.id=task_id and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed')));

-- A score sheet names learners and their marks, so reading one is a disclosure
-- and belongs in the privacy audit beside every other learner read. Recording a
-- batch discloses the same names back in its response.
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory'
));

-- Replaced only to take the shared academic-setup lock before reading the row
-- it then version-checks. A waiting writer used to read task state committed by
-- the transaction ahead of it only after that transaction released the lock.
create or replace function edunexus.write_assessment_task(p_id uuid,p_version integer,p_offering uuid,p_period uuid,p_component text,p_sequence integer,p_title text,p_max numeric,p_status text,p_reason text)
returns edunexus.assessment_tasks language plpgsql security definer set search_path='' as $$
declare prior edunexus.assessment_tasks; result edunexus.assessment_tasks; context jsonb; period edunexus.reporting_periods; code text; highest numeric;
begin
  perform pg_advisory_xact_lock(82412001);
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid assessment reason'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120 or p_title ~ '[[:cntrl:]]' or p_status is null or p_status not in ('open','archived')
    or p_max is null or p_max<=0 or p_max>10000 or p_max<>round(p_max,2) then raise exception using errcode='23514',message='Invalid assessment task'; end if;
  if p_id is null then
    if p_version is distinct from 0 or p_offering is null or p_period is null or p_component is null or p_sequence is null then
      raise exception using errcode='23514',message='A new task needs an offering, period, component and sequence'; end if;
    context:=edunexus.assessment_entry_context(p_offering);
    if context->'school_year'->>'status'='closed' then raise exception using errcode='P1600',message='Closed-year assessments are read only'; end if;
    code:=upper(btrim(p_component));
    if not exists(select 1 from jsonb_array_elements(context->'components') c where c->>'code'=code) then
      raise exception using errcode='P1601',message='Use a component code from the adopted policy revision'; end if;
    select * into period from edunexus.reporting_periods where id=p_period;
    if not found or period.academic_year_id<>(context->'school_year'->>'id')::uuid then
      raise exception using errcode='P1602',message='Use a reporting period of this school year'; end if;
    insert into edunexus.assessment_tasks(offering_id,binding_id,reporting_period_id,section_id,academic_year_id,component_code,sequence,title,max_score,status)
      values(p_offering,(context->'binding'->>'id')::uuid,p_period,(context->'section'->>'id')::uuid,(context->'school_year'->>'id')::uuid,
        code,p_sequence,btrim(p_title),p_max,p_status) returning * into result;
  else
    if p_offering is not null or p_period is not null or p_component is not null or p_sequence is not null then
      raise exception using errcode='23514',message='Offering, period, component and sequence are fixed once a task exists'; end if;
    select * into prior from edunexus.assessment_tasks where id=p_id;
    if not found then raise exception using errcode='P0002',message='Assessment task not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Assessment task changed'; end if;
    context:=edunexus.assessment_entry_context(prior.offering_id);
    if context->'school_year'->>'status'='closed' then raise exception using errcode='P1600',message='Closed-year assessments are read only'; end if;
    if row(prior.title,prior.max_score,prior.status) is not distinct from row(btrim(p_title),p_max,p_status) then
      raise exception using errcode='P1603',message='Assessment task proposal has no changes'; end if;
    -- Lowering the maximum below a recorded mark would invalidate saved evidence.
    select max(raw_score) into highest from edunexus.assessment_scores where task_id=p_id and raw_score is not null;
    if highest is not null and p_max<highest then raise exception using errcode='P1604',message='Recorded scores exceed the proposed maximum'; end if;
    update edunexus.assessment_tasks set title=btrim(p_title),max_score=p_max,status=p_status where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_task_events(task_id,task_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else to_jsonb(prior) end,
      to_jsonb(result),btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;

-- Replaced for three corrections, none of them arithmetic. It locks before it
-- reads the task it validates against; it requires the raw_score key to be
-- present, so only an explicit JSON null clears a mark and a dropped key can no
-- longer erase one silently; and it re-checks current learner access, because a
-- security-definer function bypasses the row policy that would have caught it.
create or replace function edunexus.record_assessment_scores(p_task uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare task edunexus.assessment_tasks; context jsonb; entry jsonb; enrollment edunexus.enrollments; existing edunexus.assessment_scores;
  saved edunexus.assessment_scores; changes jsonb:='[]'; seen uuid[]:='{}'; mark numeric; expected integer;
begin
  perform pg_advisory_xact_lock(82412001);
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid score reason'; end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100 then
    raise exception using errcode='23514',message='Record 1 to 100 score entries at a time'; end if;
  select * into task from edunexus.assessment_tasks where id=p_task;
  if not found then raise exception using errcode='P0002',message='Assessment task not found'; end if;
  context:=edunexus.assessment_entry_context(task.offering_id);
  if context->'school_year'->>'status'='closed' then raise exception using errcode='P1600',message='Closed-year assessments are read only'; end if;
  if task.status<>'open' then raise exception using errcode='P1600',message='This assessment task is archived'; end if;
  for entry in select e.value from jsonb_array_elements(p_entries) e loop
    -- A missing raw_score key used to reach the null branch below and clear a
    -- recorded mark. Only an explicit JSON null may do that.
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','raw_score','version']<>'{}'::jsonb
      or jsonb_typeof(entry->'enrollment_id') is distinct from 'string' or jsonb_typeof(entry->'version') is distinct from 'number'
      or entry->'raw_score' is null or jsonb_typeof(entry->'raw_score') not in ('number','null') then raise exception using errcode='23514',message='Invalid score entry fields'; end if;
    if (entry->>'enrollment_id')::uuid=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,(entry->>'enrollment_id')::uuid);
    expected:=(entry->>'version')::integer;
    mark:=case when jsonb_typeof(entry->'raw_score')='null' then null else (entry->>'raw_score')::numeric end;
    if mark is not null and (mark<0 or mark>task.max_score or mark<>round(mark,2)) then
      raise exception using errcode='P1605',message='Each score must be between zero and the task maximum'; end if;
    select * into enrollment from edunexus.enrollments where id=(entry->>'enrollment_id')::uuid;
    if not found or enrollment.section_id<>task.section_id or enrollment.record_state<>'valid' then
      raise exception using errcode='P1606',message='Record scores only for valid enrollments in this section'; end if;
    if not edunexus.can_read_enrollment(enrollment.id) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
    select * into existing from edunexus.assessment_scores where task_id=p_task and enrollment_id=enrollment.id;
    if found then
      if expected is distinct from existing.version then raise exception using errcode='P0003',message='A score changed while you were editing'; end if;
      if existing.raw_score is not distinct from mark then continue; end if;
      update edunexus.assessment_scores set raw_score=mark where id=existing.id returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',enrollment.id,'before',existing.raw_score,'after',mark,'version',saved.version));
    else
      if expected is distinct from 0 then raise exception using errcode='P0003',message='A score changed while you were editing'; end if;
      if mark is null then continue; end if;
      insert into edunexus.assessment_scores(task_id,enrollment_id,raw_score) values(p_task,enrollment.id,mark) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',enrollment.id,'before',null,'after',mark,'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1603',message='The score proposal has no changes'; end if;
  insert into edunexus.assessment_score_events(task_id,entries,reason,actor_user_id,request_id)
    values(p_task,changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('task_id',p_task,'changed',jsonb_array_length(changes),'entries',changes);
end $$;
