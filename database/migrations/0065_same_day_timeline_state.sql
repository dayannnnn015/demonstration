-- Two enrolment events on one day: the later one is the state.
--
-- `enrollment_state_on` and the monthly builder both resolved a timeline by
-- taking the newest entry on or before the day — ordering by `effective_on`
-- alone and stopping at one. With two entries sharing a date, which came back
-- was arbitrary, and in practice it was the earlier.
--
-- **That was not reachable until 0062.** Giving a first class on the day the
-- learner was registered was refused before it, so an enrolment could not
-- carry both its `enrolled` event and a `reassigned` event on one date. 0062
-- allowed exactly that, at the school's request, and a learner the office
-- registered and the adviser took in on the same morning then resolved to the
-- state *before* they had a class — so they were missing from that day's
-- register, and from the month the SF2 counts from. Four learners in a class,
-- three on the register.
--
-- The fix is a tie-break, not a new rule. `resolve_enrollment_timeline`
-- already returns its entries ordered by `enrollment_version`, so within one
-- date the last in the array is the one recorded last, and that is the state.
-- Nothing changes for an enrolment whose events fall on different days, which
-- is every enrolment made before 0062.
create or replace function edunexus.enrollment_state_on(p_id uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
  select value from jsonb_array_elements(edunexus.resolve_enrollment_timeline(p_id)) with ordinality t(value,n)
  where (value->>'effective_on')::date<=p_date order by (value->>'effective_on')::date desc,t.n desc limit 1
$$;

-- The same tie-break where the month is built, which reads the timeline it
-- materialised rather than calling the function above.
create or replace function edunexus.build_attendance_month(p_scope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
    cross join lateral (select value from jsonb_array_elements(e.timeline) with ordinality t(value,n)
      where (value->>'effective_on')::date<=d.day_on order by (value->>'effective_on')::date desc,t.n desc limit 1) state
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
