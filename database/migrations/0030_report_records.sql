-- What the report cards and the permanent record print beyond attendance.
-- The grades are the ones the DepEd ECR already computed: an adviser enters
-- each term's grade, the final grade with its remark, and the general average
-- (decided 2026-10-08). EDUNEXUS records, checks and prints them and computes
-- none of them; the grading gate stays shut. Observed values use the card's own
-- marks (AO, SO, RO, NO), and comments are the adviser's own words. Kindergarten
-- has no card yet, so nothing here accepts a Kindergarten learner.

create table edunexus.report_grades (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  offering_id uuid not null references edunexus.section_subjects(id) on delete restrict,
  -- A term's grade, or the final grade when the period is null.
  reporting_period_id uuid references edunexus.reporting_periods(id) on delete restrict,
  -- As the ECR shows it: 0 to 100, at most two decimal places, never rounded here.
  grade numeric(5,2) check(grade is null or grade between 0 and 100),
  remark text check(remark is null or remark in ('passed','failed')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(reporting_period_id is null or remark is null)
);
create unique index report_grade_period_idx on edunexus.report_grades(enrollment_id,offering_id,reporting_period_id) where reporting_period_id is not null;
create unique index report_grade_final_idx on edunexus.report_grades(enrollment_id,offering_id) where reporting_period_id is null;
create index report_grade_offering_idx on edunexus.report_grades(offering_id);
create index report_grade_period_ref_idx on edunexus.report_grades(reporting_period_id);

create table edunexus.report_summaries (
  enrollment_id uuid primary key references edunexus.enrollments(id) on delete restrict,
  general_average numeric(5,2) check(general_average is null or general_average between 0 and 100),
  remark text check(remark is null or remark in ('passed','failed')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

-- The card's behaviour statements, one mark each per term.
create table edunexus.report_values (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  reporting_period_id uuid not null references edunexus.reporting_periods(id) on delete restrict,
  ratings jsonb not null default '{}'::jsonb check(jsonb_typeof(ratings)='object'),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(enrollment_id,reporting_period_id)
);
create index report_value_period_idx on edunexus.report_values(reporting_period_id);

-- The adviser's words: the Grade 1 card's two narratives per term, the Grades 2-3
-- card's comment per term, and the SF2's remark for a month.
create table edunexus.report_notes (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  kind text not null check(kind in ('can_do','to_improve','comment','sf2_remark')),
  reporting_period_id uuid references edunexus.reporting_periods(id) on delete restrict,
  month_on date check(month_on is null or extract(day from month_on)=1),
  body text check(body is null or (length(btrim(body)) between 1 and 1000 and body !~ '[\u0001-\u0009\u000b-\u001f\u007f]')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(case when kind='sf2_remark' then month_on is not null and reporting_period_id is null else reporting_period_id is not null and month_on is null end)
);
create unique index report_note_period_idx on edunexus.report_notes(enrollment_id,kind,reporting_period_id) where reporting_period_id is not null;
create unique index report_note_month_idx on edunexus.report_notes(enrollment_id,kind,month_on) where month_on is not null;
create index report_note_period_ref_idx on edunexus.report_notes(reporting_period_id);

-- One journal row per saved batch, like the score journal, with each learner's before and after.
create table edunexus.report_record_events (
  id bigint generated always as identity primary key,
  section_id uuid not null references edunexus.sections(id) on delete restrict,
  kind text not null check(kind in ('grades','summaries','values','notes')),
  scope jsonb not null check(jsonb_typeof(scope)='object'),
  entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 1 and 100),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index report_record_event_section_idx on edunexus.report_record_events(section_id,id desc);
create index report_record_event_actor_idx on edunexus.report_record_events(actor_user_id);

do $$ declare t text; begin
  foreach t in array array['report_grades','report_values','report_notes'] loop
    execute format('alter table edunexus.%I enable row level security',t);
    execute format('create policy scoped_read on edunexus.%I for select to edunexus_app using(edunexus.can_read_enrollment(enrollment_id))',t);
    execute format('create trigger version_record before update on edunexus.%I for each row execute function edunexus.version_record()',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
  end loop;
end $$;
alter table edunexus.report_summaries enable row level security;
create policy scoped_read on edunexus.report_summaries for select to edunexus_app using(edunexus.can_read_enrollment(enrollment_id));
create trigger version_record before update on edunexus.report_summaries for each row execute function edunexus.version_record();
-- audit_record names the row by id or user_id; a summary is keyed by its enrollment, so it is named here.
create function edunexus.audit_report_summary() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into edunexus.audit_events(actor_user_id,request_id,operation,entity_table,entity_id,changed_fields)
  values(edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid,tg_op,tg_table_name,new.enrollment_id::text,
    array(select key from jsonb_each(to_jsonb(new)) where key not in ('created_at','updated_at','version') and (tg_op='INSERT' or value is distinct from to_jsonb(old)->key) order by key));
  return new;
end $$;
create trigger audit_record after insert or update on edunexus.report_summaries for each row execute function edunexus.audit_report_summary();
alter table edunexus.report_record_events enable row level security;
create policy scoped_read on edunexus.report_record_events for select to edunexus_app using(edunexus.is_manager() or exists(
  select 1 from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
  where s.id=section_id and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed'));
create trigger audit_record after insert on edunexus.report_record_events for each row execute function edunexus.audit_record();
grant select on edunexus.report_grades,edunexus.report_summaries,edunexus.report_values,edunexus.report_notes,edunexus.report_record_events to edunexus_app;

-- The section a batch is for, after the checks every writer shares.
create function edunexus.report_section_for_write(p_section uuid) returns edunexus.sections language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if y.status='closed' then raise exception using errcode='P1900',message='A closed school year''s records are read only'; end if;
  if s.grade_level=0 then raise exception using errcode='P1901',message='There is no Kindergarten card to record for'; end if;
  return s;
end $$;

-- A learner in this section now, whose record the caller may read.
create function edunexus.report_enrollment(p_section uuid,p_enrollment uuid) returns void language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments;
begin
  select * into e from edunexus.enrollments where id=p_enrollment;
  if not found or e.section_id<>p_section or e.record_state<>'valid' then raise exception using errcode='P1902',message='Record only for learners in this section'; end if;
  if not edunexus.can_read_enrollment(e.id) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
end $$;

create function edunexus.check_report_batch(p_entries jsonb,p_reason text) returns void language plpgsql immutable set search_path='' as $$
begin
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid reason'; end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100 then raise exception using errcode='23514',message='Record 1 to 100 entries at a time'; end if;
end $$;

-- A grade as the ECR shows it, or null to clear it: 0 to 100, at most two decimal places.
create function edunexus.report_grade_value(p_value jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare g numeric;
begin
  if p_value is null or jsonb_typeof(p_value)='null' then return null; end if;
  if jsonb_typeof(p_value)<>'number' then raise exception using errcode='P1903',message='A grade is a number from 0 to 100'; end if;
  g:=(p_value#>>'{}')::numeric;
  if g<0 or g>100 or g<>round(g,2) then raise exception using errcode='P1903',message='A grade is a number from 0 to 100 with at most two decimal places'; end if;
  return g;
end $$;

create function edunexus.record_report_grades(p_offering uuid,p_period uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o edunexus.section_subjects; s edunexus.sections; entry jsonb; existing edunexus.report_grades; saved edunexus.report_grades;
  changes jsonb:='[]'; seen uuid[]:='{}'; g numeric; r text; e uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  select * into o from edunexus.section_subjects where id=p_offering;
  if not found then raise exception using errcode='P0002',message='Offering not found'; end if;
  s:=edunexus.report_section_for_write(o.section_id);
  if p_period is not null and not exists(select 1 from edunexus.reporting_periods where id=p_period and academic_year_id=s.academic_year_id) then
    raise exception using errcode='P1905',message='Use a reporting period of this school year'; end if;
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','grade','remark','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->'grade' is null then raise exception using errcode='23514',message='Invalid grade entry fields'; end if;
    if p_period is not null and entry ? 'remark' then raise exception using errcode='23514',message='Only a final grade has a remark'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    g:=edunexus.report_grade_value(entry->'grade');
    r:=nullif(entry->>'remark','');
    if r is not null and r not in ('passed','failed') then raise exception using errcode='23514',message='A remark is passed or failed'; end if;
    select * into existing from edunexus.report_grades where enrollment_id=e and offering_id=p_offering and reporting_period_id is not distinct from p_period;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A grade changed while you were editing'; end if;
      if existing.grade is not distinct from g and existing.remark is not distinct from r then continue; end if;
      update edunexus.report_grades set grade=g,remark=r where id=existing.id returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('grade',existing.grade,'remark',existing.remark),
        'after',jsonb_build_object('grade',g,'remark',r),'version',saved.version));
    else
      if (entry->>'version')::integer is distinct from 0 then raise exception using errcode='P0003',message='A grade changed while you were editing'; end if;
      if g is null and r is null then continue; end if;
      insert into edunexus.report_grades(enrollment_id,offering_id,reporting_period_id,grade,remark) values(e,p_offering,p_period,g,r) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',null,'after',jsonb_build_object('grade',g,'remark',r),'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.report_record_events(section_id,kind,scope,entries,reason,actor_user_id,request_id)
    values(s.id,'grades',jsonb_build_object('offering_id',p_offering,'reporting_period_id',p_period),changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

create function edunexus.record_report_summaries(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.report_summaries; saved edunexus.report_summaries;
  changes jsonb:='[]'; seen uuid[]:='{}'; g numeric; r text; e uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.report_section_for_write(p_section);
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','general_average','remark','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->'general_average' is null then raise exception using errcode='23514',message='Invalid general average entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    g:=edunexus.report_grade_value(entry->'general_average');
    r:=nullif(entry->>'remark','');
    if r is not null and r not in ('passed','failed') then raise exception using errcode='23514',message='A remark is passed or failed'; end if;
    select * into existing from edunexus.report_summaries where enrollment_id=e;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A general average changed while you were editing'; end if;
      if existing.general_average is not distinct from g and existing.remark is not distinct from r then continue; end if;
      update edunexus.report_summaries set general_average=g,remark=r where enrollment_id=e returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('general_average',existing.general_average,'remark',existing.remark),
        'after',jsonb_build_object('general_average',g,'remark',r),'version',saved.version));
    else
      if (entry->>'version')::integer is distinct from 0 then raise exception using errcode='P0003',message='A general average changed while you were editing'; end if;
      if g is null and r is null then continue; end if;
      insert into edunexus.report_summaries(enrollment_id,general_average,remark) values(e,g,r) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',null,'after',jsonb_build_object('general_average',g,'remark',r),'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.report_record_events(section_id,kind,scope,entries,reason,actor_user_id,request_id)
    values(s.id,'summaries','{}'::jsonb,changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

-- The card's seven behaviour statements, in the card's order.
create function edunexus.report_value_codes() returns text[] language sql immutable set search_path='' as $$
  select array['MD1','MD2','MT1','MT2','MK1','MB1','MB2']
$$;

create function edunexus.record_report_values(p_section uuid,p_period uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.report_values; saved edunexus.report_values; changes jsonb:='[]'; seen uuid[]:='{}';
  e uuid; marks jsonb; item record; prior jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.report_section_for_write(p_section);
  if p_period is null or not exists(select 1 from edunexus.reporting_periods where id=p_period and academic_year_id=s.academic_year_id) then
    raise exception using errcode='P1905',message='Use a reporting period of this school year'; end if;
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','ratings','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or jsonb_typeof(entry->'ratings') is distinct from 'object' then raise exception using errcode='23514',message='Invalid observed values entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    marks:='{}'::jsonb;
    for item in select key,value from jsonb_each(entry->'ratings') loop
      if not item.key=any(edunexus.report_value_codes()) then raise exception using errcode='P1906',message='Unknown behaviour statement'; end if;
      if jsonb_typeof(item.value)='null' then continue; end if;
      if item.value#>>'{}' not in ('AO','SO','RO','NO') then raise exception using errcode='P1906',message='A mark is AO, SO, RO or NO'; end if;
      marks:=marks||jsonb_build_object(item.key,item.value#>>'{}');
    end loop;
    select * into existing from edunexus.report_values where enrollment_id=e and reporting_period_id=p_period;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='Observed values changed while you were editing'; end if;
      if existing.ratings=marks then continue; end if;
      prior:=existing.ratings;
      update edunexus.report_values set ratings=marks where id=existing.id returning * into saved;
    else
      if (entry->>'version')::integer is distinct from 0 then raise exception using errcode='P0003',message='Observed values changed while you were editing'; end if;
      if marks='{}'::jsonb then continue; end if;
      prior:=null;
      insert into edunexus.report_values(enrollment_id,reporting_period_id,ratings) values(e,p_period,marks) returning * into saved;
    end if;
    changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',prior,'after',marks,'version',saved.version));
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.report_record_events(section_id,kind,scope,entries,reason,actor_user_id,request_id)
    values(s.id,'values',jsonb_build_object('reporting_period_id',p_period),changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

create function edunexus.record_report_notes(p_section uuid,p_kind text,p_period uuid,p_month date,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; entry jsonb; existing edunexus.report_notes; saved edunexus.report_notes; changes jsonb:='[]'; seen uuid[]:='{}';
  e uuid; b text;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.report_section_for_write(p_section);
  select * into y from edunexus.academic_years where id=s.academic_year_id;
  if p_kind is null or p_kind not in ('can_do','to_improve','comment','sf2_remark') then raise exception using errcode='23514',message='Unknown kind of note'; end if;
  if p_kind='sf2_remark' then
    if p_period is not null or p_month is null or extract(day from p_month)<>1 or p_month>y.ends_on or (p_month+interval '1 month - 1 day')::date<y.starts_on then
      raise exception using errcode='P0700',message='Use the first day of a month in the school year'; end if;
  elsif p_month is not null or p_period is null or not exists(select 1 from edunexus.reporting_periods where id=p_period and academic_year_id=y.id) then
    raise exception using errcode='P1905',message='Use a reporting period of this school year'; end if;
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','body','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->'body' is null or jsonb_typeof(entry->'body') not in ('string','null') then
      raise exception using errcode='23514',message='Invalid note entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    b:=nullif(btrim(entry->>'body'),'');
    if b is not null and (length(b)>1000 or b ~ '[\u0001-\u0009\u000b-\u001f\u007f]') then raise exception using errcode='23514',message='A note is up to 1000 characters'; end if;
    select * into existing from edunexus.report_notes where enrollment_id=e and kind=p_kind and reporting_period_id is not distinct from p_period and month_on is not distinct from p_month;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A note changed while you were editing'; end if;
      if existing.body is not distinct from b then continue; end if;
      update edunexus.report_notes set body=b where id=existing.id returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',existing.body,'after',b,'version',saved.version));
    else
      if (entry->>'version')::integer is distinct from 0 then raise exception using errcode='P0003',message='A note changed while you were editing'; end if;
      if b is null then continue; end if;
      insert into edunexus.report_notes(enrollment_id,kind,reporting_period_id,month_on,body) values(e,p_kind,p_period,p_month,b) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',null,'after',b,'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.report_record_events(section_id,kind,scope,entries,reason,actor_user_id,request_id)
    values(s.id,'notes',jsonb_build_object('kind',p_kind,'reporting_period_id',p_period,'month_on',p_month),changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

-- Everything recorded for one section's report cards: its terms, its learning
-- areas, and for each learner now in it their grades, general average, observed
-- values and notes. It names learners, so the service logs it.
create function edunexus.read_report_records(p_section uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id;
  if not edunexus.is_manager() and y.status='closed' then raise exception using errcode='P0002',message='Section not found'; end if;
  return jsonb_build_object(
    'section',jsonb_build_object('id',s.id,'grade_level',s.grade_level,'name',s.name,'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id)),
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,'status',y.status),
    'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal,'name',name,'starts_on',starts_on,'ends_on',ends_on) order by ordinal),'[]'::jsonb)
      from edunexus.reporting_periods where academic_year_id=y.id),
    'offerings',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_order',display_order,'active',active,'code',subject_snapshot->>'code','name',subject_snapshot->>'name')
      order by display_order,subject_snapshot->>'name'),'[]'::jsonb) from edunexus.section_subjects where section_id=s.id),
    'learners',(select coalesce(jsonb_agg(jsonb_build_object('enrollment_id',e.id,'status',e.status,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,
      'name_extension',l.name_extension,'sex',l.sex,'lrn',l.lrn,
      'grades',(select coalesce(jsonb_agg(jsonb_build_object('offering_id',g.offering_id,'reporting_period_id',g.reporting_period_id,'grade',g.grade,'remark',g.remark,'version',g.version)),'[]'::jsonb)
        from edunexus.report_grades g where g.enrollment_id=e.id),
      'summary',(select jsonb_build_object('general_average',m.general_average,'remark',m.remark,'version',m.version) from edunexus.report_summaries m where m.enrollment_id=e.id),
      'values',(select coalesce(jsonb_agg(jsonb_build_object('reporting_period_id',v.reporting_period_id,'ratings',v.ratings,'version',v.version)),'[]'::jsonb)
        from edunexus.report_values v where v.enrollment_id=e.id),
      'notes',(select coalesce(jsonb_agg(jsonb_build_object('kind',n.kind,'reporting_period_id',n.reporting_period_id,'month_on',n.month_on,'body',n.body,'version',n.version)),'[]'::jsonb)
        from edunexus.report_notes n where n.enrollment_id=e.id))
      order by l.sex desc,lower(l.last_name),lower(l.first_name),e.id),'[]'::jsonb)
      from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
      where e.section_id=s.id and e.record_state='valid' and edunexus.can_read_enrollment(e.id)));
end $$;

-- The SF2 now carries the adviser's remark for the month beside the movements.
-- Apart from the 'remark' key, this is the body of 0029's read.
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
      'learners',(select coalesce(jsonb_agg(member order by member->>'enrollment_id'),'[]'::jsonb) from members)) into payload;
  return payload;
end $$;

revoke all on function edunexus.report_section_for_write(uuid),edunexus.report_enrollment(uuid,uuid),edunexus.check_report_batch(jsonb,text),edunexus.report_grade_value(jsonb),
  edunexus.report_value_codes(),edunexus.audit_report_summary(),
  edunexus.record_report_grades(uuid,uuid,jsonb,text),edunexus.record_report_summaries(uuid,jsonb,text),edunexus.record_report_values(uuid,uuid,jsonb,text),
  edunexus.record_report_notes(uuid,text,uuid,date,jsonb,text),edunexus.read_report_records(uuid) from public;
grant execute on function edunexus.record_report_grades(uuid,uuid,jsonb,text),edunexus.record_report_summaries(uuid,jsonb,text),edunexus.record_report_values(uuid,uuid,jsonb,text),
  edunexus.record_report_notes(uuid,text,uuid,date,jsonb,text),edunexus.read_report_records(uuid) to edunexus_app;
