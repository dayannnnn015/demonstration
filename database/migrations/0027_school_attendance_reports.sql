-- Two school-wide reads that count and name nobody.
-- A principal needs to see the whole school's register for a day, and the SF4
-- for a month. Reading every section's sheet to build either would log every
-- learner in the school on each page load, so both are counted in the database
-- and return section-level numbers only, which is the one reason a learner read
-- may skip the privacy audit (as GET /enrollment-counts has since 0.37.0).
-- Nothing here is a rate, an average or a credited day: the SF4's daily average
-- and percentage wait on the school's rule for turning two sessions into a day.

-- Each section's register for one date: who belonged to it that day, which
-- sessions were classroom sessions, and how many of those sessions are marked
-- present, absent or not at all. A teacher sees only the sections they advise.
create function edunexus.read_daily_attendance_summary(p_day date) returns jsonb language plpgsql security definer set search_path='' as $$
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
    cross join lateral (select value from jsonb_array_elements(edunexus.resolve_enrollment_timeline(e.id))
      where (value->>'effective_on')::date<=p_day order by (value->>'effective_on')::date desc limit 1) state
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

-- The SF4's counted columns for one month, per section and by sex: learners
-- registered on the last day of the month, and transfers in and out, dropouts,
-- deaths and other withdrawals, each for the month (B) and before it in the
-- school year (A). Movements are read from the corrected timeline, so a
-- reviewed correction is what the report shows.
create function edunexus.read_sf4_counts(p_year uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
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
    from learners x cross join lateral (select value from jsonb_array_elements(x.timeline)
      where (value->>'effective_on')::date<=last_date order by (value->>'effective_on')::date desc limit 1) state
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

revoke all on function edunexus.read_daily_attendance_summary(date),edunexus.read_sf4_counts(uuid,date) from public;
grant execute on function edunexus.read_daily_attendance_summary(date),edunexus.read_sf4_counts(uuid,date) to edunexus_app;
