-- The SF4's read on a full school took up to 2.7 seconds against the seeded
-- production data (893 learners, 30 sections), holding the academic lock shared
-- while it ran: for every section on every day it rescanned the whole school's
-- memberships and mark counts. It now aggregates each once and joins them, and
-- finds each learner's section by date range rather than once per day. The
-- result is unchanged except that each day's groups now come in a fixed order;
-- the API treats them as a set. tests/attendance-forms.test.ts and a comparison
-- against 0029's body on the seeded data are the proof.
create or replace function edunexus.read_sf4_source(p_year uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
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
    select e.id,l.sex,edunexus.resolve_enrollment_timeline(e.id) timeline
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    where e.academic_year_id=p_year and e.record_state='valid'
  ), spans as materialized (
    -- Each timeline entry holds from its date until the next one's.
    select x.id,x.sex,(entry.value->>'section_id')::uuid section_id,entry.value->>'event_type' event_type,(entry.value->>'effective_on')::date starts_on,
      lead((entry.value->>'effective_on')::date) over (partition by x.id order by (entry.value->>'effective_on')::date,entry.ordinality) next_on
    from learners x cross join lateral jsonb_array_elements(x.timeline) with ordinality entry
  ), membership as materialized (
    select s.id,s.sex,s.section_id,d.day_on
    from spans s join (select first_date+n day_on from generate_series(0,last_date-first_date) n) d
      on d.day_on>=s.starts_on and (s.next_on is null or d.day_on<s.next_on)
    where s.event_type<>'withdrawn'
  ), counted as materialized (
    select m.section_id,m.day_on,m.sex,k.am,k.pm,count(*)::integer n
    from membership m left join edunexus.attendance_marks k on k.enrollment_id=m.id and k.day_on=m.day_on
    group by m.section_id,m.day_on,m.sex,k.am,k.pm
  ), day_groups as materialized (
    select section_id,day_on,jsonb_agg(jsonb_build_array(sex,am,pm,n) order by sex,am nulls first,pm nulls first) groups from counted group by section_id,day_on
  ), registered as materialized (
    select section_id,count(*) filter(where sex='male') male,count(*) filter(where sex='female') female from membership where day_on=last_date group by section_id
  ), calendar as materialized (
    select s.id section_id,first_date+n day_on,edunexus.effective_calendar_day(p_year,s.id,first_date+n) schedule
    from edunexus.sections s cross join generate_series(0,last_date-first_date) n where s.academic_year_id=p_year
  ), section_days as (
    select c.section_id,jsonb_agg(jsonb_build_object('day_on',c.day_on,'am',c.schedule->>'am','pm',c.schedule->>'pm','configured',coalesce((c.schedule->>'configured')::boolean,false),
      'groups',coalesce(g.groups,'[]'::jsonb)) order by c.day_on) days
    from calendar c left join day_groups g on g.section_id=c.section_id and g.day_on=c.day_on group by c.section_id
  ), movements as (
    select (entry.value->>'section_id')::uuid section_id,x.sex,entry.value->>'reason' reason,
      case when (entry.value->>'effective_on')::date<first_date then 'a' else 'b' end span
    from learners x cross join lateral jsonb_array_elements(x.timeline) entry
    where (entry.value->>'effective_on')::date<=last_date
      and entry.value->>'reason' in ('transfer_in','transfer_out','dropout','death','withdrawal')
  ), moved as (
    select section_id,jsonb_object_agg(reason,counts) movement from (
      select v.section_id,v.reason,jsonb_build_object(
        'a',jsonb_build_object('male',count(*) filter(where v.span='a' and v.sex='male'),'female',count(*) filter(where v.span='a' and v.sex='female')),
        'b',jsonb_build_object('male',count(*) filter(where v.span='b' and v.sex='male'),'female',count(*) filter(where v.span='b' and v.sex='female'))) counts
      from movements v group by v.section_id,v.reason) k group by section_id
  ), sections as (
    select s.id,s.grade_level,s.name,st.display_name adviser_name,st.position adviser_position,st.specialization adviser_specialization,m.status month_status,
      jsonb_build_object('male',coalesce(r.male,0),'female',coalesce(r.female,0)) registered,coalesce(mv.movement,'{}'::jsonb) movement,coalesce(d.days,'[]'::jsonb) days
    from edunexus.sections s left join edunexus.staff st on st.user_id=s.adviser_user_id
    left join edunexus.attendance_months m on m.section_id=s.id and m.month_on=p_month
    left join registered r on r.section_id=s.id left join moved mv on mv.section_id=s.id left join section_days d on d.section_id=s.id
    where s.academic_year_id=p_year
  ) select jsonb_build_object('school',edunexus.form_school_heading(),
      'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,'status',y.status),
      'month_on',p_month,'from',first_date,'to',last_date,'today',timezone('Asia/Manila',now())::date,
      'sections',(select coalesce(jsonb_agg(jsonb_build_object('section_id',id,'grade_level',grade_level,'name',name,'adviser_name',adviser_name,
        'adviser_position',adviser_position,'adviser_specialization',adviser_specialization,'month_status',coalesce(month_status,'draft'),
        'registered',registered,'movement',movement,'days',days) order by grade_level,lower(name),id),'[]'::jsonb) from sections),
      -- The SF4's second table: staff who advise no section this year.
      'other_staff',(select coalesce(jsonb_agg(jsonb_build_object('name',st.display_name,'role',st.role,'position',st.position,'specialization',st.specialization)
        order by st.role,lower(st.display_name)),'[]'::jsonb)
        from edunexus.staff st where st.active and st.role in ('teacher','administrative_officer')
          and not exists(select 1 from edunexus.sections x where x.academic_year_id=p_year and x.adviser_user_id=st.user_id))) into payload;
  return payload;
end $$;
