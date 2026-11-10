-- Read-only classroom absence evidence; no school alert policy or official credits.
create function edunexus.read_attendance_monitor(p_section uuid,p_from date,p_to date,p_view text,p_limit integer,p_after uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; items jsonb; schedules jsonb;
begin
  context:=edunexus.attendance_context(p_section,p_from);
  if p_to is null or p_to<p_from or p_to-p_from>30 or p_to>(context->'school_year'->>'ends_on')::date
    or p_to>timezone('Asia/Manila',now())::date then
    raise exception using errcode='P0800',message='Monitor requires 1 to 31 nonfuture dates within one school year';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_view is null or p_view not in ('all','with_absences','incomplete') then
    raise exception using errcode='23514',message='Invalid monitor filter or page limit';
  end if;
  select jsonb_agg(edunexus.effective_calendar_day((context->'school_year'->>'id')::uuid,p_section,p_from+n)
    || jsonb_build_object('month_status',coalesce(m.status,'draft'),'month_version',coalesce(m.version,0)) order by n)
  into schedules from generate_series(0,p_to-p_from) n
    left join edunexus.attendance_months m on m.section_id=p_section and m.month_on=date_trunc('month',p_from+n)::date;

  with candidates as materialized (
    select e.id,e.version,e.learner_id recorded_learner_id,l.id learner_id,l.version learner_version,
      l.first_name,l.middle_name,l.last_name,l.name_extension,edunexus.resolve_enrollment_timeline(e.id) timeline
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id
      join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    where e.academic_year_id=(context->'school_year'->>'id')::uuid and e.record_state='valid' and e.enrolled_on<=p_to
      and edunexus.can_read_enrollment(e.id) and (p_after is null or e.id>p_after)
  ), cells as materialized (
    select e.id,(d->>'day_on')::date day_on,d schedule,
      coalesce(state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=p_section,false) eligible,
      case when a.section_id=p_section then m.am end am,case when a.section_id=p_section then m.pm end pm
    from candidates e cross join jsonb_array_elements(schedules) d
    left join lateral (select value from jsonb_array_elements(e.timeline) where (value->>'effective_on')::date<=(d->>'day_on')::date
      order by (value->>'effective_on')::date desc limit 1) state on true
    left join edunexus.attendance_marks m on m.enrollment_id=e.id and m.day_on=(d->>'day_on')::date
    left join edunexus.attendance_days a on a.id=m.attendance_day_id
  ), chosen as materialized (
    select id from cells group by id having bool_or(eligible) and
      (p_view='all' or (p_view='with_absences' and bool_or(eligible and (am='absent' or pm='absent')))
        or (p_view='incomplete' and bool_or(eligible and (not (schedule->>'configured')::boolean
          or schedule->>'am'='alternative_delivery' or schedule->>'pm'='alternative_delivery'
          or (schedule->>'am'='classroom' and am is null) or (schedule->>'pm'='classroom' and pm is null)))))
    order by id limit p_limit+1
  ) select coalesce(jsonb_agg(item order by id),'[]') into items from (
    select e.id,jsonb_build_object('enrollment_id',e.id,'enrollment_version',e.version,'recorded_learner_id',e.recorded_learner_id,
      'learner_id',e.learner_id,'learner_version',e.learner_version,'first_name',e.first_name,'middle_name',e.middle_name,'last_name',e.last_name,'name_extension',e.name_extension,
      'dates',(select jsonb_agg(jsonb_build_object('day_on',day_on,'eligible',eligible,'am',case when eligible then am end,'pm',case when eligible then pm end) order by day_on)
        from cells where id=e.id)) item
    from chosen join candidates e on e.id=chosen.id
  ) rows;
  return jsonb_build_object('section',context->'section','school_year',context->'school_year','visibility',context->'visibility',
    'source','live','from',p_from,'to',p_to,'view',p_view,'calendar_version',context->'calendar_version','days',schedules,
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(items) with ordinality where ordinality<=p_limit),
    'pagination',jsonb_build_object('limit',p_limit,'next_after_id',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'enrollment_id' else null end));
end $$;
revoke all on function edunexus.read_attendance_monitor(uuid,date,date,text,integer,uuid) from public;
grant execute on function edunexus.read_attendance_monitor(uuid,date,date,text,integer,uuid) to edunexus_app;
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor'
));
