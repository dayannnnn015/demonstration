-- The same-day tie-break, everywhere else that resolves a timeline.
--
-- `0065` fixed two readers: the daily register and the month the SF2 counts
-- from. It should have fixed all of them. Every function that answers "which
-- class was this learner in on this day" carries its own copy of the
-- resolution, and each ordered by `effective_on` alone and stopped at one --
-- so two entries sharing a date tied, and the earlier won.
--
-- A learner the office registered and the adviser took in on the same morning
-- therefore resolved to the state *before* they had a class, and went missing
-- from the SF2, the SF4 counts, the SF9, the absence monitor, the school-wide
-- attendance summary and their own attendance record -- while appearing
-- correctly on the Learner registry, which reads the enrolment row rather
-- than resolving a timeline. That is exactly the shape the school reported:
-- present in one place, absent from everything else.
--
-- Each function below is restated from its latest definition with the tie
-- broken on array order, which `resolve_enrollment_timeline` already builds
-- by `enrollment_version`: within one date, the entry recorded last is the
-- state. Nothing else in any of them changes, and nothing changes at all for
-- an enrolment whose events fall on different days -- which is every
-- enrolment made before `0062` allowed a same-day first class.
--
-- `tests/same-day-register.test.ts` now walks the schema itself and fails if
-- any function still carries the untie-broken form, so the next reader added
-- cannot quietly reintroduce it.

-- edunexus.guard_attendance_month_enrollment, restated from 0012_monthly_attendance.sql.
create or replace function edunexus.guard_attendance_month_enrollment() returns trigger language plpgsql security definer set search_path='' as $$
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
      cross join lateral (select value from jsonb_array_elements(timeline) with ordinality t(value,n) where (value->>'effective_on')::date<=(frozen.payload->>'from')::date+n order by (value->>'effective_on')::date desc,t.n desc limit 1) state
      where validity='valid' and state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=frozen.section_id
    ) dates;
    if expected<>actual then raise exception using errcode='P0708',message='Enrollment change affects a frozen attendance month'; end if;
  end loop;return null;
end $$;

-- edunexus.attendance_monitor_evidence, restated from 0014_attendance_followups.sql.
create or replace function edunexus.attendance_monitor_evidence(p_section uuid,p_from date,p_to date,p_view text,p_limit integer,p_after uuid,p_target uuid)
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
      and (p_target is null or e.id=p_target) and edunexus.can_read_enrollment(e.id) and (p_after is null or e.id>p_after)
  ), cells as materialized (
    select e.id,(d->>'day_on')::date day_on,d schedule,
      coalesce(state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=p_section,false) eligible,
      case when a.section_id=p_section then m.am end am,case when a.section_id=p_section then m.pm end pm
    from candidates e cross join jsonb_array_elements(schedules) d
    left join lateral (select value from jsonb_array_elements(e.timeline) with ordinality t(value,n) where (value->>'effective_on')::date<=(d->>'day_on')::date
      order by (value->>'effective_on')::date desc,t.n desc limit 1) state on true
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

-- edunexus.read_enrollment_attendance, restated from 0026_learner_record_reads.sql.
create or replace function edunexus.read_enrollment_attendance(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
    cross join lateral (select value from jsonb_array_elements(timeline.entries) with ordinality t(value,n) where (value->>'effective_on')::date<=g::date order by (value->>'effective_on')::date desc,t.n desc limit 1) state
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

-- edunexus.read_daily_attendance_summary, restated from 0027_school_attendance_reports.sql.
create or replace function edunexus.read_daily_attendance_summary(p_day date) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
  -- Shared, like every register read since 0023; one statement, so one snapshot.
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  if p_day is null then raise exception using errcode='23514',message='Choose a date'; end if;
  with scoped as materialized (
    select s.id,s.academic_year_id,s.grade_level,s.name,s.adviser_user_id,st.display_name adviser_name,y.status year_status
    from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
    left join edunexus.staff st on st.user_id=s.adviser_user_id
    where p_day between y.starts_on and y.ends_on
      and (edunexus.is_manager() or (s.adviser_user_id=edunexus.actor_id() and y.status<>'closed'))
  ), members as materialized (
    select (state.value->>'section_id')::uuid section_id,e.id enrollment_id
    from edunexus.enrollments e
    cross join lateral (select value from jsonb_array_elements(edunexus.resolve_enrollment_timeline(e.id)) with ordinality t(value,n)
      where (value->>'effective_on')::date<=p_day order by (value->>'effective_on')::date desc,t.n desc limit 1) state
    where e.record_state='valid' and e.academic_year_id in (select academic_year_id from scoped) and e.enrolled_on<=p_day
      and state.value->>'event_type'<>'withdrawn'
  ), per_section as (
    select s.*,edunexus.effective_calendar_day(s.academic_year_id,s.id,p_day) schedule,
      (select count(*) from members m where m.section_id=s.id)::integer learners,
      (select count(*) filter(where k.am='present') from members m join edunexus.attendance_marks k on k.enrollment_id=m.enrollment_id and k.day_on=p_day where m.section_id=s.id)::integer am_present,
      (select count(*) filter(where k.am='absent') from members m join edunexus.attendance_marks k on k.enrollment_id=m.enrollment_id and k.day_on=p_day where m.section_id=s.id)::integer am_absent,
      (select count(*) filter(where k.pm='present') from members m join edunexus.attendance_marks k on k.enrollment_id=m.enrollment_id and k.day_on=p_day where m.section_id=s.id)::integer pm_present,
      (select count(*) filter(where k.pm='absent') from members m join edunexus.attendance_marks k on k.enrollment_id=m.enrollment_id and k.day_on=p_day where m.section_id=s.id)::integer pm_absent,
      (select max(d.updated_at) from edunexus.attendance_days d where d.section_id=s.id and d.day_on=p_day) recorded_at
    from scoped s
  ) select jsonb_build_object('day_on',p_day,'sections',coalesce(jsonb_agg(jsonb_build_object(
      'section_id',id,'academic_year_id',academic_year_id,'grade_level',grade_level,'name',name,'adviser_user_id',adviser_user_id,'adviser_name',adviser_name,
      'am',schedule->>'am','pm',schedule->>'pm','configured',coalesce((schedule->>'configured')::boolean,false),'learners',learners,
      'am_present',am_present,'am_absent',am_absent,'am_unmarked',case when schedule->>'am'='classroom' then learners-am_present-am_absent else null end,
      'pm_present',pm_present,'pm_absent',pm_absent,'pm_unmarked',case when schedule->>'pm'='classroom' then learners-pm_present-pm_absent else null end,
      'recorded_at',recorded_at) order by grade_level,lower(name),id),'[]'::jsonb)) into payload from per_section;
  return payload;
end $$;

-- edunexus.read_sf4_counts, restated from 0027_school_attendance_reports.sql.
create or replace function edunexus.read_sf4_counts(p_year uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare y edunexus.academic_years; first_date date; last_date date; payload jsonb;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=p_year;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  if p_month is null or extract(day from p_month)<>1 then raise exception using errcode='P0700',message='Use the first day of the month'; end if;
  first_date:=greatest(p_month,y.starts_on);last_date:=least((p_month+interval '1 month - 1 day')::date,y.ends_on);
  if first_date>last_date then raise exception using errcode='P0700',message='Month does not overlap school year'; end if;
  with learners as materialized (
    select e.id enrollment_id,l.sex,edunexus.resolve_enrollment_timeline(e.id) timeline
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    where e.academic_year_id=p_year and e.record_state='valid'
  ), registered as (
    select (state.value->>'section_id')::uuid section_id,x.sex
    from learners x cross join lateral (select value from jsonb_array_elements(x.timeline) with ordinality t(value,n)
      where (value->>'effective_on')::date<=last_date order by (value->>'effective_on')::date desc,t.n desc limit 1) state
    where state.value->>'event_type'<>'withdrawn'
  ), movements as (
    select (entry.value->>'section_id')::uuid section_id,x.sex,entry.value->>'reason' reason,
      case when (entry.value->>'effective_on')::date<first_date then 'a' else 'b' end span
    from learners x cross join lateral jsonb_array_elements(x.timeline) entry
    where (entry.value->>'effective_on')::date<=last_date
      and entry.value->>'reason' in ('transfer_in','transfer_out','dropout','death','withdrawal')
  ), counted as (
    select s.id,s.grade_level,s.name,st.display_name adviser_name,m.status month_status,
      jsonb_build_object('male',(select count(*) from registered r where r.section_id=s.id and r.sex='male'),'female',(select count(*) from registered r where r.section_id=s.id and r.sex='female')) registered,
      (select coalesce(jsonb_object_agg(k.reason,k.counts),'{}'::jsonb) from (
        select v.reason,jsonb_build_object(
          'a',jsonb_build_object('male',count(*) filter(where v.span='a' and v.sex='male'),'female',count(*) filter(where v.span='a' and v.sex='female')),
          'b',jsonb_build_object('male',count(*) filter(where v.span='b' and v.sex='male'),'female',count(*) filter(where v.span='b' and v.sex='female'))) counts
        from movements v where v.section_id=s.id group by v.reason) k) movement
    from edunexus.sections s left join edunexus.staff st on st.user_id=s.adviser_user_id
    left join edunexus.attendance_months m on m.section_id=s.id and m.month_on=p_month
    where s.academic_year_id=p_year
  ) select jsonb_build_object('academic_year_id',p_year,'month_on',p_month,'from',first_date,'to',last_date,
      'sections',coalesce(jsonb_agg(jsonb_build_object('section_id',id,'grade_level',grade_level,'name',name,'adviser_name',adviser_name,
        'month_status',coalesce(month_status,'draft'),'registered',registered,'movement',movement) order by grade_level,lower(name),id),'[]'::jsonb))
    into payload from counted;
  return payload;
end $$;

-- edunexus.read_sf9_source, restated from 0033_promotions.sql.
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
        cross join lateral (select value from jsonb_array_elements(timeline) with ordinality t(value,n) where (value->>'effective_on')::date<=g.day_on order by (value->>'effective_on')::date desc,t.n desc limit 1) state
        where state.value->>'event_type'<>'withdrawn') d
      left join edunexus.attendance_marks k on k.enrollment_id=e.id and k.day_on=d.day_on));
end $$;

-- edunexus.read_sf2_source, restated from 0050_sf2_movements.sql.
create or replace function edunexus.read_sf2_source(p_section uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; first_date date; last_date date; cutoff date; payload jsonb;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  perform pg_advisory_xact_lock_shared(82412002,hashtext(p_section::text));
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id;
  if not edunexus.is_manager() and y.status='closed' then raise exception using errcode='P0002',message='Section not found'; end if;
  if p_month is null or extract(day from p_month)<>1 then raise exception using errcode='P0700',message='Use the first day of the month'; end if;
  first_date:=greatest(p_month,y.starts_on);last_date:=least((p_month+interval '1 month - 1 day')::date,y.ends_on);
  if first_date>last_date then raise exception using errcode='P0700',message='Month does not overlap school year'; end if;
  cutoff:=edunexus.first_friday(y.starts_on);
  with days as materialized (
    select first_date+n day_on,edunexus.effective_calendar_day(y.id,p_section,first_date+n) schedule from generate_series(0,last_date-first_date) n
  ), enrollments as materialized (
    select e.id,l.first_name,l.middle_name,l.last_name,l.name_extension,l.sex,l.lrn,edunexus.resolve_enrollment_timeline(e.id) timeline
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    where e.academic_year_id=y.id and e.record_state='valid'
  ), membership as materialized (
    select x.id,d.day_on from enrollments x cross join days d
    cross join lateral (select value from jsonb_array_elements(x.timeline) with ordinality t(value,n) where (value->>'effective_on')::date<=d.day_on order by (value->>'effective_on')::date desc,t.n desc limit 1) state
    where state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=p_section
  ), at_cutoff as (
    select x.sex from enrollments x
    cross join lateral (select value from jsonb_array_elements(x.timeline) with ordinality t(value,n) where (value->>'effective_on')::date<=cutoff order by (value->>'effective_on')::date desc,t.n desc limit 1) state
    where state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=p_section
  ), movements as (
    select x.sex,entry.value->>'reason' reason,
      case when (entry.value->>'effective_on')::date<first_date then 'a' else 'b' end span
    from enrollments x cross join lateral jsonb_array_elements(x.timeline) entry
    where (entry.value->>'effective_on')::date<=last_date and (entry.value->>'section_id')::uuid=p_section
      and entry.value->>'reason' in ('transfer_in','transfer_out','dropout','death','withdrawal')
  ), members as (
    select x.id,jsonb_build_object('enrollment_id',x.id,'first_name',x.first_name,'middle_name',x.middle_name,'last_name',x.last_name,'name_extension',x.name_extension,
      'sex',x.sex,'lrn',x.lrn,
      'first_entry',(select jsonb_build_object('reason',value->>'reason','effective_on',value->>'effective_on','section_id',value->>'section_id')
        from jsonb_array_elements(x.timeline) order by (value->>'effective_on')::date limit 1),
      'events',(select coalesce(jsonb_agg(jsonb_build_object('event_type',value->>'event_type','reason',value->>'reason','effective_on',value->>'effective_on','section_id',value->>'section_id')
        order by (value->>'effective_on')::date),'[]'::jsonb) from jsonb_array_elements(x.timeline)
        where (value->>'effective_on')::date between first_date and last_date and (value->>'section_id')::uuid=p_section),
      'remark',(select n.body from edunexus.report_notes n where n.enrollment_id=x.id and n.kind='sf2_remark' and n.month_on=p_month),
      'cells',(select jsonb_agg(jsonb_build_object('day_on',m.day_on,'am',k.am,'pm',k.pm) order by m.day_on)
        from membership m left join edunexus.attendance_marks k on k.enrollment_id=x.id and k.day_on=m.day_on where m.id=x.id)) member
    from enrollments x where exists(select 1 from membership m where m.id=x.id)
  ) select jsonb_build_object('school',edunexus.form_school_heading(),
      'section',jsonb_build_object('id',s.id,'grade_level',s.grade_level,'name',s.name,'adviser_user_id',s.adviser_user_id,
        'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id)),
      'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,'status',y.status),
      'month_on',p_month,'from',first_date,'to',last_date,'cutoff',cutoff,'today',timezone('Asia/Manila',now())::date,
      'month_status',coalesce((select status from edunexus.attendance_months where section_id=p_section and month_on=p_month),'draft'),
      'days',(select jsonb_agg(jsonb_build_object('day_on',day_on,'am',schedule->>'am','pm',schedule->>'pm','configured',coalesce((schedule->>'configured')::boolean,false)) order by day_on) from days),
      'at_cutoff',jsonb_build_object('male',(select count(*) from at_cutoff where sex='male'),'female',(select count(*) from at_cutoff where sex='female')),
      -- Shaped exactly as read_sf4_source's, so the two forms cannot read one month's movements differently.
      'movements',(select coalesce(jsonb_object_agg(k.reason,k.counts),'{}'::jsonb) from (
        select v.reason,jsonb_build_object(
          'a',jsonb_build_object('male',count(*) filter(where v.span='a' and v.sex='male'),'female',count(*) filter(where v.span='a' and v.sex='female')),
          'b',jsonb_build_object('male',count(*) filter(where v.span='b' and v.sex='male'),'female',count(*) filter(where v.span='b' and v.sex='female'))) counts
        from movements v group by v.reason) k),
      'learners',(select coalesce(jsonb_agg(member order by member->>'enrollment_id'),'[]'::jsonb) from members)) into payload;
  return payload;
end $$;
