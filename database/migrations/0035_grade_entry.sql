-- How far each section's report-card entry has come, for the principal: how
-- many of its current learners have a grade recorded in each learning area
-- for each term and as a final grade, how many have a general average, and
-- how many outcomes are recorded and approved. Counts of records only: no
-- grade is read, summed or averaged, and no learner is named, so nothing is
-- written to the access log.
create function edunexus.read_grade_entry(p_year uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare y edunexus.academic_years;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=p_year;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  return jsonb_build_object(
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'status',y.status),
    'today',(now() at time zone 'Asia/Manila')::date,
    'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'name',p.name,'starts_on',p.starts_on,'ends_on',p.ends_on) order by p.ordinal),'[]'::jsonb)
      from edunexus.reporting_periods p where p.academic_year_id=p_year),
    'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'grade_level',s.grade_level,'name',s.name,
        'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id),
        'learners',(select count(*) from edunexus.enrollments e where e.section_id=s.id and e.record_state='valid' and e.status='enrolled'),
        'offerings',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'code',o.subject_snapshot->>'code','name',o.subject_snapshot->>'name',
            'recorded',(select coalesce(jsonb_object_agg(coalesce(g.period::text,'final'),g.n),'{}'::jsonb) from (
              select rg.reporting_period_id period,count(*) n from edunexus.report_grades rg join edunexus.enrollments e on e.id=rg.enrollment_id
              where rg.offering_id=o.id and rg.grade is not null and e.section_id=s.id and e.record_state='valid' and e.status='enrolled'
              group by rg.reporting_period_id) g)) order by o.display_order,o.subject_snapshot->>'name'),'[]'::jsonb)
          from edunexus.section_subjects o where o.section_id=s.id and o.active),
        'general_averages',(select count(*) from edunexus.report_summaries r join edunexus.enrollments e on e.id=r.enrollment_id
          where e.section_id=s.id and e.record_state='valid' and e.status='enrolled' and r.general_average is not null),
        'outcomes',(select jsonb_build_object('recorded',count(*) filter(where p.action is not null),'approved',count(*) filter(where p.status='approved'),'returned',count(*) filter(where p.status='returned'))
          from edunexus.promotion_decisions p join edunexus.enrollments e on e.id=p.enrollment_id
          where e.section_id=s.id and e.record_state='valid' and e.status='enrolled'))
        order by s.grade_level,lower(s.name),s.id),'[]'::jsonb)
      from edunexus.sections s where s.academic_year_id=p_year));
end $$;
revoke all on function edunexus.read_grade_entry(uuid) from public;
grant execute on function edunexus.read_grade_entry(uuid) to edunexus_app;
