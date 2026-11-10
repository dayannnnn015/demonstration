-- The attendance forms: SF2 for a section's month, SF4 for the school's.
-- The SF2 prints one mark per day and DepEd's own formulas; EDUNEXUS records a
-- morning and an afternoon mark. How a pair becomes a day is the school's rule,
-- so the principal records it here, with a reason, and nothing has a default:
-- until it is recorded every figure that depends on it stays empty. The forms
-- are computed by the API from the raw reads below; the database supplies what
-- was recorded and never a rate. Each form handed out is recorded with a
-- fingerprint of exactly what it said, so a reissue is a visible correction.

-- What the forms print in their headings and signature blocks.
alter table edunexus.school_profile
  add column region text check(region is null or (length(btrim(region)) between 1 and 150 and region !~ '[[:cntrl:]]')),
  add column division text check(division is null or (length(btrim(division)) between 1 and 150 and division !~ '[[:cntrl:]]')),
  add column district text check(district is null or (length(btrim(district)) between 1 and 150 and district !~ '[[:cntrl:]]')),
  add column school_head_name text check(school_head_name is null or (length(btrim(school_head_name)) between 1 and 150 and school_head_name !~ '[[:cntrl:]]')),
  add column school_head_position text check(school_head_position is null or (length(btrim(school_head_position)) between 1 and 150 and school_head_position !~ '[[:cntrl:]]'));
grant update (region,division,district,school_head_name,school_head_position) on edunexus.school_profile to edunexus_app;

-- The SF4 prints each adviser's position and specialization beside their section.
alter table edunexus.staff
  add column position text check(position is null or (length(btrim(position)) between 1 and 120 and position !~ '[[:cntrl:]]')),
  add column specialization text check(specialization is null or (length(btrim(specialization)) between 1 and 120 and specialization !~ '[[:cntrl:]]'));
grant update (position,specialization) on edunexus.staff to edunexus_app;

-- The school's rule for turning a morning and an afternoon mark into the SF2's
-- one daily mark. One row, recorded by the principal; no row means no rule.
create table edunexus.attendance_day_rule (
  id smallint primary key default 1 check(id=1),
  -- One session present and the other absent: marked tardy and counted present
  -- (the SF2's half-shaded mark), marked absent, or counted as half a day.
  mixed_day text not null check(mixed_day in ('tardy','absent','half_day')),
  -- A date with only one classroom session: a day of classes decided by that
  -- session, or not a day of classes at all.
  single_session_day text not null check(single_session_day in ('counts','not_counted')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table edunexus.attendance_day_rule_events (
  id bigint generated always as identity primary key,
  rule_version integer not null check(rule_version>=1) unique,
  before_snapshot jsonb,after_snapshot jsonb not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index attendance_day_rule_event_actor_idx on edunexus.attendance_day_rule_events(actor_user_id);
alter table edunexus.attendance_day_rule enable row level security;
alter table edunexus.attendance_day_rule_events enable row level security;
create policy staff_read on edunexus.attendance_day_rule for select to edunexus_app using(edunexus.actor_role() is not null);
create policy staff_read on edunexus.attendance_day_rule_events for select to edunexus_app using(edunexus.actor_role() is not null);
grant select on edunexus.attendance_day_rule,edunexus.attendance_day_rule_events to edunexus_app;
create trigger version_record before update on edunexus.attendance_day_rule for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.attendance_day_rule for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.attendance_day_rule_events for each row execute function edunexus.audit_record();

create function edunexus.record_attendance_day_rule(p_version integer,p_mixed text,p_single text,p_reason text)
returns edunexus.attendance_day_rule language plpgsql security definer set search_path='' as $$
declare prior edunexus.attendance_day_rule; result edunexus.attendance_day_rule;
begin
  perform pg_advisory_xact_lock(82412001);
  -- The school head attests every SF2, so the rule those forms are computed by is theirs to record.
  if edunexus.actor_role() is distinct from 'principal' then raise exception using errcode='P1800',message='Only the principal records the school''s attendance rule'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid rule reason'; end if;
  if p_mixed is null or p_mixed not in ('tardy','absent','half_day') or p_single is null or p_single not in ('counts','not_counted') then
    raise exception using errcode='23514',message='Choose an answer to both questions'; end if;
  select * into prior from edunexus.attendance_day_rule where id=1 for update;
  if not found then
    if p_version is distinct from 0 then raise exception using errcode='P0003',message='The rule changed while you were editing'; end if;
    insert into edunexus.attendance_day_rule(mixed_day,single_session_day) values(p_mixed,p_single) returning * into result;
  else
    if prior.version is distinct from p_version then raise exception using errcode='P0003',message='The rule changed while you were editing'; end if;
    if prior.mixed_day=p_mixed and prior.single_session_day=p_single then raise exception using errcode='P1801',message='The rule is already recorded that way'; end if;
    update edunexus.attendance_day_rule set mixed_day=p_mixed,single_session_day=p_single where id=1 returning * into result;
  end if;
  insert into edunexus.attendance_day_rule_events(rule_version,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.version,case when prior.id is null then null else to_jsonb(prior) end,to_jsonb(result),btrim(p_reason),edunexus.actor_id(),
      nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;

-- The rule and who recorded it. Every staff member may read it: an adviser's SF2 is computed by it.
create function edunexus.read_attendance_day_rule() returns jsonb language plpgsql security definer set search_path='' as $$
declare rule edunexus.attendance_day_rule; event edunexus.attendance_day_rule_events;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into rule from edunexus.attendance_day_rule where id=1;
  if not found then return jsonb_build_object('rule',null,'history','[]'::jsonb); end if;
  return jsonb_build_object('rule',jsonb_build_object('mixed_day',rule.mixed_day,'single_session_day',rule.single_session_day,'version',rule.version,'updated_at',rule.updated_at),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('rule_version',e.rule_version,'mixed_day',e.after_snapshot->>'mixed_day','single_session_day',e.after_snapshot->>'single_session_day',
      'reason',e.reason,'recorded_by',s.display_name,'recorded_at',e.recorded_at) order by e.id desc),'[]'::jsonb)
      from edunexus.attendance_day_rule_events e left join edunexus.staff s on s.user_id=e.actor_user_id));
end $$;

-- What every form heading prints. Teachers read it through the form reads,
-- since their own row is the only staff row they may read.
create function edunexus.form_school_heading() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('name',name,'school_code',school_code,'address',address,'region',region,'division',division,'district',district,
    'school_head_name',school_head_name,'school_head_position',school_head_position) from edunexus.school_profile where id=1
$$;

-- The first Friday of the school year: the SF2's beginning-of-year cut-off.
create function edunexus.first_friday(p_from date) returns date language sql immutable set search_path='' as $$
  select p_from+((12-extract(isodow from p_from)::integer)%7)
$$;

-- Everything one section's SF2 for one month is computed from: the school
-- heading, the dates and their sessions, every learner who belonged to the
-- section on any date of the month with their two marks on each of those dates,
-- the movements of the month, and who was enrolled at the cut-off. Raw values
-- only; the API applies the school's rule and DepEd's formulas.
create function edunexus.read_sf2_source(p_section uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; first_date date; last_date date; cutoff date; payload jsonb;
begin
  -- The register's own read locks, in the register's order (0023).
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
  ), members as (
    select x.id,jsonb_build_object('enrollment_id',x.id,'first_name',x.first_name,'middle_name',x.middle_name,'last_name',x.last_name,'name_extension',x.name_extension,
      'sex',x.sex,'lrn',x.lrn,
      'first_entry',(select jsonb_build_object('reason',value->>'reason','effective_on',value->>'effective_on','section_id',value->>'section_id')
        from jsonb_array_elements(x.timeline) order by (value->>'effective_on')::date limit 1),
      'events',(select coalesce(jsonb_agg(jsonb_build_object('event_type',value->>'event_type','reason',value->>'reason','effective_on',value->>'effective_on','section_id',value->>'section_id')
        order by (value->>'effective_on')::date),'[]'::jsonb) from jsonb_array_elements(x.timeline)
        where (value->>'effective_on')::date between first_date and last_date and (value->>'section_id')::uuid=p_section),
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
      'learners',(select coalesce(jsonb_agg(member order by member->>'enrollment_id'),'[]'::jsonb) from members)) into payload;
  return payload;
end $$;

-- Everything the school's SF4 for one month is computed from: per section,
-- the dates and their sessions, how many learners of each sex held each pair of
-- marks on each date, who was registered on the month's last day, and the
-- movements before and within the month. Counts only; no learner is named.
create function edunexus.read_sf4_source(p_year uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
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
  ), membership as materialized (
    select x.id,x.sex,(state.value->>'section_id')::uuid section_id,first_date+n day_on
    from learners x cross join generate_series(0,last_date-first_date) n
    cross join lateral (select value from jsonb_array_elements(x.timeline) where (value->>'effective_on')::date<=first_date+n order by (value->>'effective_on')::date desc limit 1) state
    where state.value->>'event_type'<>'withdrawn'
  ), groups as materialized (
    select m.section_id,m.day_on,m.sex,k.am,k.pm,count(*)::integer n
    from membership m left join edunexus.attendance_marks k on k.enrollment_id=m.id and k.day_on=m.day_on
    group by m.section_id,m.day_on,m.sex,k.am,k.pm
  ), movements as (
    select (entry.value->>'section_id')::uuid section_id,x.sex,entry.value->>'reason' reason,
      case when (entry.value->>'effective_on')::date<first_date then 'a' else 'b' end span
    from learners x cross join lateral jsonb_array_elements(x.timeline) entry
    where (entry.value->>'effective_on')::date<=last_date
      and entry.value->>'reason' in ('transfer_in','transfer_out','dropout','death','withdrawal')
  ), sections as (
    select s.id,s.grade_level,s.name,st.display_name adviser_name,st.position adviser_position,st.specialization adviser_specialization,m.status month_status,
      jsonb_build_object('male',(select count(*) from membership r where r.section_id=s.id and r.day_on=last_date and r.sex='male'),
        'female',(select count(*) from membership r where r.section_id=s.id and r.day_on=last_date and r.sex='female')) registered,
      (select coalesce(jsonb_object_agg(k.reason,k.counts),'{}'::jsonb) from (
        select v.reason,jsonb_build_object(
          'a',jsonb_build_object('male',count(*) filter(where v.span='a' and v.sex='male'),'female',count(*) filter(where v.span='a' and v.sex='female')),
          'b',jsonb_build_object('male',count(*) filter(where v.span='b' and v.sex='male'),'female',count(*) filter(where v.span='b' and v.sex='female'))) counts
        from movements v where v.section_id=s.id group by v.reason) k) movement,
      (select jsonb_agg(jsonb_build_object('day_on',d.day_on,'am',d.schedule->>'am','pm',d.schedule->>'pm','configured',coalesce((d.schedule->>'configured')::boolean,false),
        'groups',(select coalesce(jsonb_agg(jsonb_build_array(g.sex,g.am,g.pm,g.n)),'[]'::jsonb) from groups g where g.section_id=s.id and g.day_on=d.day_on)) order by d.day_on)
        from (select first_date+n day_on,edunexus.effective_calendar_day(p_year,s.id,first_date+n) schedule from generate_series(0,last_date-first_date) n) d) days
    from edunexus.sections s left join edunexus.staff st on st.user_id=s.adviser_user_id
    left join edunexus.attendance_months m on m.section_id=s.id and m.month_on=p_month
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

-- A record of every form handed out: which form, for what, a fingerprint of
-- exactly what it said, and who issued it. Printing the same content again
-- returns the same record; different content for the same scope is a
-- correction, needs a reason, and names the record it replaces.
create table edunexus.form_issuances (
  id uuid primary key default gen_random_uuid(),
  serial bigint generated always as identity unique,
  form text not null check(form in ('sf2','sf4','sf9','sf10')),
  academic_year_id uuid references edunexus.academic_years(id) on delete restrict,
  section_id uuid references edunexus.sections(id) on delete restrict,
  enrollment_id uuid references edunexus.enrollments(id) on delete restrict,
  learner_id uuid references edunexus.learners(id) on delete restrict,
  month_on date check(month_on is null or extract(day from month_on)=1),
  data_hash text not null check(data_hash ~ '^[a-f0-9]{64}$'),
  day_rule_version integer check(day_rule_version is null or day_rule_version>=1),
  supersedes_id uuid references edunexus.form_issuances(id) on delete restrict,
  reason text check(reason is null or (length(btrim(reason)) between 10 and 500 and reason !~ '[[:cntrl:]]')),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  issued_at timestamptz not null default clock_timestamp(),
  check(case form
    when 'sf2' then academic_year_id is not null and section_id is not null and month_on is not null and enrollment_id is null and learner_id is null
    when 'sf4' then academic_year_id is not null and month_on is not null and section_id is null and enrollment_id is null and learner_id is null
    when 'sf9' then academic_year_id is not null and enrollment_id is not null and section_id is null and month_on is null and learner_id is null
    else learner_id is not null and academic_year_id is null and section_id is null and enrollment_id is null and month_on is null end),
  check((supersedes_id is null)=(reason is null))
);
create index form_issuance_scope_idx on edunexus.form_issuances(form,academic_year_id,section_id,month_on,serial desc);
create index form_issuance_enrollment_idx on edunexus.form_issuances(enrollment_id);
create index form_issuance_learner_idx on edunexus.form_issuances(learner_id);
create index form_issuance_section_idx on edunexus.form_issuances(section_id);
create index form_issuance_actor_idx on edunexus.form_issuances(actor_user_id);
create index form_issuance_supersedes_idx on edunexus.form_issuances(supersedes_id);
alter table edunexus.form_issuances enable row level security;
-- Managers read every record; a teacher reads the records they issued.
create policy scoped_read on edunexus.form_issuances for select to edunexus_app using(edunexus.is_manager() or actor_user_id=edunexus.actor_id());
grant select on edunexus.form_issuances to edunexus_app;
create trigger audit_record after insert on edunexus.form_issuances for each row execute function edunexus.audit_record();

create function edunexus.record_form_issuance(p_form text,p_year uuid,p_section uuid,p_enrollment uuid,p_learner uuid,p_month date,p_hash text,p_rule_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior edunexus.form_issuances; result edunexus.form_issuances; s edunexus.sections;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  -- Security definer bypasses row policy, so who may issue what is checked here, as each read checks it.
  if p_form='sf2' then
    select * into s from edunexus.sections where id=p_section;
    if not found or s.academic_year_id is distinct from p_year or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then
      raise exception using errcode='P0002',message='Section not found'; end if;
  elsif p_form='sf4' then
    if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  elsif p_form='sf9' then
    if not edunexus.can_read_enrollment(p_enrollment) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  elsif p_form='sf10' then
    if not edunexus.can_read_learner(p_learner) then raise exception using errcode='P0002',message='Learner not found'; end if;
  else raise exception using errcode='23514',message='Unknown form'; end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='23514',message='Invalid form fingerprint'; end if;
  select * into prior from edunexus.form_issuances where form=p_form and academic_year_id is not distinct from p_year and section_id is not distinct from p_section
    and enrollment_id is not distinct from p_enrollment and learner_id is not distinct from p_learner and month_on is not distinct from p_month
    order by serial desc limit 1 for update;
  if found and prior.data_hash=p_hash then return to_jsonb(prior)||jsonb_build_object('reprint',true); end if;
  if found and (p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]') then
    raise exception using errcode='P1802',message='This form was issued before with different content; say why it is being corrected'; end if;
  insert into edunexus.form_issuances(form,academic_year_id,section_id,enrollment_id,learner_id,month_on,data_hash,day_rule_version,supersedes_id,reason,actor_user_id,request_id)
    values(p_form,p_year,p_section,p_enrollment,p_learner,p_month,p_hash,p_rule_version,prior.id,case when prior.id is null then null else btrim(p_reason) end,
      edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  return to_jsonb(result)||jsonb_build_object('reprint',false);
end $$;

-- The forms name learners, so their reads are logged like every other read that does.
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory','enrollmentAttendance','enrollmentScores',
  'sf2Get','sf2Issue','sf9Get','sf9Issue','sf10Get','sf10Issue','reportRecordsGet','reportRecordsWrite'
));

revoke all on function edunexus.record_attendance_day_rule(integer,text,text,text),edunexus.read_attendance_day_rule(),edunexus.form_school_heading(),
  edunexus.first_friday(date),edunexus.read_sf2_source(uuid,date),edunexus.read_sf4_source(uuid,date),
  edunexus.record_form_issuance(text,uuid,uuid,uuid,uuid,date,text,integer,text) from public;
grant execute on function edunexus.record_attendance_day_rule(integer,text,text,text),edunexus.read_attendance_day_rule(),
  edunexus.read_sf2_source(uuid,date),edunexus.read_sf4_source(uuid,date),
  edunexus.record_form_issuance(text,uuid,uuid,uuid,uuid,date,text,integer,text) to edunexus_app;
