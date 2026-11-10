-- The SF9 and SF10 read what was recorded and nothing else. The API lays them
-- out and counts attendance days by the school's recorded rule; the grades are
-- the ones entered from the ECR (0030). Both name a learner, so the service logs
-- each read under the enrollments it shows.

-- One enrollment's year for its report card: the learner, the section and its
-- adviser, the year's terms, the learning areas the learner was graded in or is
-- offered now, every report-card record, and every date the learner belonged
-- to a section with that date's sessions and the learner's two marks.
create function edunexus.read_sf9_source(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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

-- One learner's permanent record: their identity, and for every school year
-- the caller may read, the grade, section, adviser, terms, learning areas,
-- grades and general average recorded for it.
create function edunexus.read_sf10_source(p_learner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
        'summary',(select jsonb_build_object('general_average',general_average,'remark',remark) from edunexus.report_summaries where enrollment_id=e.id))
      order by y.start_year,e.id),'[]'::jsonb)
      from edunexus.enrollments e join edunexus.sections s on s.id=e.section_id join edunexus.academic_years y on y.id=e.academic_year_id
      where e.record_state='valid' and e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=l.id) and edunexus.can_read_enrollment(e.id)));
end $$;

revoke all on function edunexus.read_sf9_source(uuid),edunexus.read_sf10_source(uuid) from public;
grant execute on function edunexus.read_sf9_source(uuid),edunexus.read_sf10_source(uuid) to edunexus_app;
