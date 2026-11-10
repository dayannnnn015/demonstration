-- The SF2's summary counted the month's transfers, dropouts and deaths from its
-- own roster, so a learner whose departure took effect on the first day of the
-- month was never on that month's register and never counted. The SF4 reads the
-- timeline directly and did count them, which is how one section's SF2 and the
-- SF4 compiled from it came to disagree by one (proved in
-- tests/forms-movements.test.ts: the SF4 said two transfers out, the SF2 said one).
--
-- The form's column is the movements *of the month*, so the SF4's reading is the
-- one that is right. This adds the same aggregate to the SF2's source, defined
-- exactly as read_sf4_source defines it, and the roster is left alone: a learner
-- with no day in the month still gets no row on the register.
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
    cross join lateral (select value from jsonb_array_elements(x.timeline) where (value->>'effective_on')::date<=d.day_on order by (value->>'effective_on')::date desc limit 1) state
    where state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=p_section
  ), at_cutoff as (
    select x.sex from enrollments x
    cross join lateral (select value from jsonb_array_elements(x.timeline) where (value->>'effective_on')::date<=cutoff order by (value->>'effective_on')::date desc limit 1) state
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

