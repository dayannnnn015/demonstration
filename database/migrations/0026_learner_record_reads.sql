-- One learner's own record, read without reading anyone else's.
-- Attendance and scores could only be read a whole section at a time, and every
-- section read writes an access row naming every learner on it, so a page about
-- one learner would have disclosed thirty. These two reads return one enrollment
-- and are logged as exactly that. Both count and list what was recorded; nothing
-- here totals a score, weighs a component or turns sessions into a rate.
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory','enrollmentAttendance','enrollmentScores'
));

-- Session counts by month, as the monthly review counts them: a classroom session
-- on a date the learner belonged to a section is expected, and one with no mark is
-- missing, never present and never absent. The learner is followed across a
-- reassignment, each date against the section they were in that day.
create function edunexus.read_enrollment_attendance(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; y edunexus.academic_years; first_date date; last_date date; payload jsonb;
begin
  -- Shared, as register reads have taken it since 0023: no calendar, roster or month
  -- change runs underneath. Everything below is one statement, so a register
  -- confirmation elsewhere cannot show this learner half of its marks.
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if not found or not edunexus.can_read_enrollment(p_enrollment) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id;
  first_date:=greatest(y.starts_on,e.enrolled_on);
  last_date:=least(y.ends_on,(now() at time zone 'Asia/Manila')::date);
  with timeline as materialized (
    select edunexus.resolve_enrollment_timeline(e.id) entries
  ), days as materialized (
    select g::date day_on,(state.value->>'section_id')::uuid section_id
    from timeline cross join generate_series(first_date,last_date,interval '1 day') g
    cross join lateral (select value from jsonb_array_elements(timeline.entries) where (value->>'effective_on')::date<=g::date order by (value->>'effective_on')::date desc limit 1) state
    where state.value->>'event_type'<>'withdrawn'
  ), cells as materialized (
    select d.day_on,d.section_id,edunexus.effective_calendar_day(e.academic_year_id,d.section_id,d.day_on) schedule,m.am,m.pm
    from days d left join edunexus.attendance_marks m on m.enrollment_id=e.id and m.day_on=d.day_on
  ), monthly as (
    select date_trunc('month',day_on)::date month_on,
      (count(*) filter(where schedule->>'am'='classroom')+count(*) filter(where schedule->>'pm'='classroom'))::integer expected_sessions,
      (count(*) filter(where am='present')+count(*) filter(where pm='present'))::integer present_sessions,
      (count(*) filter(where am='absent')+count(*) filter(where pm='absent'))::integer absent_sessions,
      (count(*) filter(where schedule->>'am'='classroom' and am is null)+count(*) filter(where schedule->>'pm'='classroom' and pm is null))::integer missing_sessions,
      (count(*) filter(where schedule->>'am'='alternative_delivery')+count(*) filter(where schedule->>'pm'='alternative_delivery'))::integer alternative_delivery_sessions,
      count(*) filter(where not coalesce((schedule->>'configured')::boolean,false))::integer unconfigured_dates
    from cells group by 1
  ) select jsonb_build_object('enrollment_id',e.id,'learner_id',e.learner_id,'academic_year_id',y.id,'from',first_date,'to',last_date,
      'months',coalesce((select jsonb_agg(to_jsonb(monthly) order by month_on) from monthly),'[]'::jsonb),
      'absences',coalesce((select jsonb_agg(jsonb_build_object('day_on',day_on,'section_id',section_id,'am',am,'pm',pm) order by day_on desc) from cells where am='absent' or pm='absent'),'[]'::jsonb))
    into payload;
  return payload;
end $$;

-- Every assessment in the sections the learner belonged to this year, with their
-- raw mark or null. Null means nothing is recorded; it is never a zero.
create function edunexus.read_enrollment_scores(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; payload jsonb;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if not found or not edunexus.can_read_enrollment(p_enrollment) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  with held as (
    select distinct (value->>'section_id')::uuid id from jsonb_array_elements(edunexus.resolve_enrollment_timeline(e.id)) where value->>'section_id' is not null
  ), task_rows as (
    select t.id task_id,t.offering_id,o.subject_snapshot->>'code' subject_code,o.subject_snapshot->>'name' subject_name,o.display_order,
      p.id reporting_period_id,p.ordinal period_ordinal,p.name period_name,t.component_code,t.sequence,t.title,t.max_score,t.status,s.raw_score,s.version score_version
    from edunexus.assessment_tasks t
    join edunexus.section_subjects o on o.id=t.offering_id
    join edunexus.reporting_periods p on p.id=t.reporting_period_id
    left join edunexus.assessment_scores s on s.task_id=t.id and s.enrollment_id=e.id
    where t.academic_year_id=e.academic_year_id and (t.section_id in (select id from held) or s.id is not null)
  ) select jsonb_build_object('enrollment_id',e.id,'academic_year_id',e.academic_year_id,
      'items',coalesce((select jsonb_agg(to_jsonb(task_rows) order by period_ordinal,display_order,subject_code,component_code,sequence) from task_rows),'[]'::jsonb))
    into payload;
  return payload;
end $$;

revoke all on function edunexus.read_enrollment_attendance(uuid),edunexus.read_enrollment_scores(uuid) from public;
grant execute on function edunexus.read_enrollment_attendance(uuid),edunexus.read_enrollment_scores(uuid) to edunexus_app;
