-- Section 3A: explicitly configured AM/PM schedules, with reviewed changes.
-- No official holidays, calendar dates, or attendance marks are seeded.
alter table edunexus.sections add constraint sections_identity_year_key unique(id,academic_year_id);
create table edunexus.instructional_calendars (
  id uuid primary key references edunexus.academic_years(id) on delete restrict,
  version integer not null default 1 check(version>=1),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table edunexus.instructional_days (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references edunexus.instructional_calendars(id) on delete restrict,
  section_id uuid,
  day_on date not null,
  configured boolean not null,
  am text check(am in ('classroom','alternative_delivery','no_class','suspended')),
  pm text check(pm in ('classroom','alternative_delivery','no_class','suspended')),
  day_type text check(day_type in ('regular','holiday','school_break','weekend','makeup','suspension','other')),
  label text check(length(btrim(label)) between 1 and 120 and label !~ '[[:cntrl:]]'),
  version integer not null default 1,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict,
  check((configured and am is not null and pm is not null and day_type is not null and label is not null)
    or (not configured and am is null and pm is null and day_type is null and label is null)),
  check(not configured or case
    when day_type in ('holiday','school_break','weekend') then am='no_class' and pm='no_class'
    when day_type in ('regular','makeup') then am<>'suspended' and pm<>'suspended' and (am in ('classroom','alternative_delivery') or pm in ('classroom','alternative_delivery'))
    when day_type='suspension' then am in ('suspended','alternative_delivery') or pm in ('suspended','alternative_delivery')
    else true end)
);
create unique index instructional_days_school_idx on edunexus.instructional_days(academic_year_id,day_on) where section_id is null;
create unique index instructional_days_section_idx on edunexus.instructional_days(section_id,day_on) where section_id is not null;
create index instructional_days_overrides_idx on edunexus.instructional_days(academic_year_id,day_on,section_id) where section_id is not null and configured;
create table edunexus.calendar_review_events (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references edunexus.instructional_calendars(id) on delete restrict,
  section_id uuid,
  calendar_version integer not null check(calendar_version>=1),
  review_snapshot jsonb not null check(jsonb_typeof(review_snapshot)='object'),
  review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(academic_year_id,calendar_version),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict
);
create index calendar_review_actor_idx on edunexus.calendar_review_events(actor_user_id);
create index calendar_review_section_idx on edunexus.calendar_review_events(section_id) where section_id is not null;
do $$ declare t text; begin
  foreach t in array array['instructional_calendars','instructional_days','calendar_review_events'] loop
    execute format('alter table edunexus.%I enable row level security',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
  end loop;
  foreach t in array array['instructional_calendars','instructional_days'] loop
    execute format('create trigger version_record before update on edunexus.%I for each row execute function edunexus.version_record()',t);
  end loop;
end $$;
create policy calendar_read on edunexus.instructional_calendars for select to edunexus_app using(edunexus.actor_role() is not null);
create policy calendar_days_read on edunexus.instructional_days for select to edunexus_app using(edunexus.is_manager() or (edunexus.actor_role() is not null and
  (section_id is null or exists(select 1 from edunexus.sections s where s.id=section_id and s.adviser_user_id=edunexus.actor_id()))));
create policy calendar_history_read on edunexus.calendar_review_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.instructional_calendars,edunexus.instructional_days,edunexus.calendar_review_events to edunexus_app;

-- Owner-only scope accessor: absent and cleared rows both mean unconfigured.
create function edunexus.calendar_scope_day(p_year uuid,p_section uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('configured',configured,'am',am,'pm',pm,'day_type',day_type,'label',label)
    from edunexus.instructional_days where academic_year_id=p_year and section_id is not distinct from p_section and day_on=p_date),
    jsonb_build_object('configured',false,'am',null,'pm',null,'day_type',null,'label',null))
$$;
create function edunexus.effective_calendar_day(p_year uuid,p_section uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare state jsonb; source text:='unconfigured';
begin
  if p_section is not null then state:=edunexus.calendar_scope_day(p_year,p_section,p_date); end if;
  if (state->>'configured')::boolean then source:='section';
  else state:=edunexus.calendar_scope_day(p_year,null,p_date); if (state->>'configured')::boolean then source:='school'; end if; end if;
  return state || jsonb_build_object('day_on',p_date,'source',source);
end $$;

create function edunexus.read_instructional_calendar(p_year uuid,p_section uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare y edunexus.academic_years; s edunexus.sections; days jsonb; current_version integer;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  -- Writers lock this year exclusively, including the first calendar commit.
  select * into y from edunexus.academic_years where id=p_year for share;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>61 or p_from<y.starts_on or p_to>y.ends_on then
    raise exception using errcode='P0500',message='Calendar range must be within the year and at most 62 dates'; end if;
  if p_section is not null then
    select * into s from edunexus.sections where id=p_section and academic_year_id=p_year;
    if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  end if;
  select coalesce((select version from edunexus.instructional_calendars where id=p_year),0) into current_version;
  select jsonb_agg(edunexus.effective_calendar_day(p_year,p_section,p_from+n) order by n) into days from generate_series(0,p_to-p_from) n;
  return jsonb_build_object('academic_year_id',p_year,'calendar_version',current_version,'section_id',p_section,'from',p_from,'to',p_to,'days',days,
    'summary',jsonb_build_object('dates_requested',jsonb_array_length(days),
      'configured_days',(select count(*) from jsonb_array_elements(days) d where (d->>'configured')::boolean),
      'unconfigured_days',(select count(*) from jsonb_array_elements(days) d where not (d->>'configured')::boolean),
      'classroom_sessions',(select count(*) from jsonb_array_elements(days) d cross join lateral (values(d->>'am'),(d->>'pm')) modes(mode) where mode='classroom'),
      'alternative_delivery_sessions',(select count(*) from jsonb_array_elements(days) d cross join lateral (values(d->>'am'),(d->>'pm')) modes(mode) where mode='alternative_delivery'),
      'no_class_sessions',(select count(*) from jsonb_array_elements(days) d cross join lateral (values(d->>'am'),(d->>'pm')) modes(mode) where mode='no_class'),
      'suspended_sessions',(select count(*) from jsonb_array_elements(days) d cross join lateral (values(d->>'am'),(d->>'pm')) modes(mode) where mode='suspended')));
end $$;

create function edunexus.preview_instructional_calendar(p_year uuid,p_section uuid,p_version integer,p_changes jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare y edunexus.academic_years; s edunexus.sections; current_version integer; item jsonb; d date; before_state jsonb; after_state jsonb;
  normalized jsonb:='[]'; conflicts jsonb:='[]'; problems text[]:='{}'; seen date[]:='{}'; override_ids uuid[]; changed_count integer:=0; plan jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=p_year for update;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  select coalesce((select version from edunexus.instructional_calendars where id=p_year),0) into current_version;
  if p_version is null or p_version<>current_version then raise exception using errcode='P0003',message='Calendar changed'; end if;
  if y.status='closed' then raise exception using errcode='P0105',message='School year is closed'; end if;
  if p_section is not null then
    select * into s from edunexus.sections where id=p_section and academic_year_id=p_year;
    if not found then raise exception using errcode='P0002',message='Section not found'; end if;
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]'
    or jsonb_typeof(p_changes) is distinct from 'array' then raise exception using errcode='23514',message='Invalid calendar review'; end if;
  if jsonb_array_length(p_changes) not between 1 and 62 then raise exception using errcode='23514',message='Supply 1 to 62 date changes'; end if;
  for item in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'action' is null or item->>'action' not in ('set','clear')
      or jsonb_typeof(item->'day_on') is distinct from 'string' or (item->>'day_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='23514',message='Invalid calendar change'; end if;
    begin d:=(item->>'day_on')::date; exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='23514',message='Invalid calendar date'; end;
    if d<y.starts_on or d>y.ends_on or d=any(seen) then raise exception using errcode='P0500',message='Dates must be distinct and within the year'; end if;
    seen:=array_append(seen,d);
    if item->>'action'='clear' then
      if (select count(*) from jsonb_object_keys(item))<>2 then raise exception using errcode='23514',message='Clear needs only date and action'; end if;
      after_state:=jsonb_build_object('configured',false,'am',null,'pm',null,'day_type',null,'label',null);
    else
      if not (item ?& array['day_on','action','am','pm','day_type','label']) or (select count(*) from jsonb_object_keys(item))<>6
        or exists(select 1 from jsonb_each(item) where jsonb_typeof(value)<>'string') then raise exception using errcode='23514',message='Invalid day fields'; end if;
      if item->>'am' not in ('classroom','alternative_delivery','no_class','suspended') or item->>'pm' not in ('classroom','alternative_delivery','no_class','suspended')
        or item->>'day_type' not in ('regular','holiday','school_break','weekend','makeup','suspension','other')
        or length(btrim(item->>'label')) not between 1 and 120 or item->>'label' ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid session or day classification'; end if;
      if (case when item->>'day_type' in ('holiday','school_break','weekend') then item->>'am'<>'no_class' or item->>'pm'<>'no_class'
        when item->>'day_type' in ('regular','makeup') then item->>'am'='suspended' or item->>'pm'='suspended' or (item->>'am' not in ('classroom','alternative_delivery') and item->>'pm' not in ('classroom','alternative_delivery'))
        when item->>'day_type'='suspension' then item->>'am' not in ('suspended','alternative_delivery') and item->>'pm' not in ('suspended','alternative_delivery') else false end) then
        raise exception using errcode='23514',message='Day classification conflicts with sessions'; end if;
      after_state:=jsonb_build_object('configured',true,'am',item->>'am','pm',item->>'pm','day_type',item->>'day_type','label',btrim(item->>'label'));
      if p_section is not null and not (edunexus.calendar_scope_day(p_year,null,d)->>'configured')::boolean then
        if not 'BASE_DAY_UNCONFIGURED'=any(problems) then problems:=array_append(problems,'BASE_DAY_UNCONFIGURED'); end if;
        conflicts:=conflicts || jsonb_build_array(jsonb_build_object('day_on',d,'code','BASE_DAY_UNCONFIGURED','section_ids',array[p_section]));
      end if;
    end if;
    before_state:=edunexus.calendar_scope_day(p_year,p_section,d);
    if before_state<>after_state then
      changed_count:=changed_count+1;
      if p_section is null then
        select array_agg(section_id order by section_id) into override_ids from edunexus.instructional_days where academic_year_id=p_year and day_on=d and section_id is not null and configured;
        if cardinality(override_ids)>0 then
          if not 'SECTION_OVERRIDES_PRESENT'=any(problems) then problems:=array_append(problems,'SECTION_OVERRIDES_PRESENT'); end if;
          conflicts:=conflicts || jsonb_build_array(jsonb_build_object('day_on',d,'code','SECTION_OVERRIDES_PRESENT','section_ids',override_ids));
        end if;
      end if;
    end if;
    normalized:=normalized || jsonb_build_array(jsonb_build_object('day_on',d,'action',item->>'action','before',before_state,'after',after_state,
      'before_effective',edunexus.effective_calendar_day(p_year,p_section,d),
      'after_effective',case when p_section is not null and not (after_state->>'configured')::boolean then edunexus.effective_calendar_day(p_year,null,d)
        else after_state || jsonb_build_object('day_on',d,'source',case when not (after_state->>'configured')::boolean then 'unconfigured' when p_section is null then 'school' else 'section' end) end,
      'changed',before_state<>after_state));
  end loop;
  if changed_count=0 then raise exception using errcode='P0501',message='Calendar has no changes'; end if;
  select jsonb_agg(value order by value->>'day_on') into normalized from jsonb_array_elements(normalized);
  plan:=jsonb_build_object('academic_year_id',p_year,'calendar_version',current_version,'section_id',p_section,
    'school_year',to_jsonb(y)-'created_at'-'updated_at','section',case when p_section is null then null else to_jsonb(s)-'created_at'-'updated_at' end,
    'changes',normalized,'changed_count',changed_count,'issues',problems,'conflicts',conflicts,'can_commit',cardinality(problems)=0,'actor_user_id',edunexus.actor_id(),'reason',btrim(p_reason));
  return plan || jsonb_build_object('review_hash',case when cardinality(problems)=0 then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;

create function edunexus.commit_instructional_calendar(p_year uuid,p_section uuid,p_version integer,p_changes jsonb,p_reason text,p_hash text)
returns edunexus.calendar_review_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; result edunexus.calendar_review_events; change jsonb; state jsonb; day_id uuid;
begin
  plan:=edunexus.preview_instructional_calendar(p_year,p_section,p_version,p_changes,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0502',message='Resolve calendar conflicts first'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0503',message='Calendar review changed'; end if;
  insert into edunexus.instructional_calendars(id) values(p_year) on conflict(id) do update set version=edunexus.instructional_calendars.version+1;
  insert into edunexus.calendar_review_events(academic_year_id,section_id,calendar_version,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(p_year,p_section,p_version+1,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  for change in select value from jsonb_array_elements(plan->'changes') where (value->>'changed')::boolean loop
    state:=change->'after';
    select id into day_id from edunexus.instructional_days where academic_year_id=p_year and section_id is not distinct from p_section and day_on=(change->>'day_on')::date;
    if found then update edunexus.instructional_days set configured=(state->>'configured')::boolean,am=state->>'am',pm=state->>'pm',day_type=state->>'day_type',label=state->>'label' where id=day_id;
    else insert into edunexus.instructional_days(academic_year_id,section_id,day_on,configured,am,pm,day_type,label)
      values(p_year,p_section,(change->>'day_on')::date,(state->>'configured')::boolean,state->>'am',state->>'pm',state->>'day_type',state->>'label'); end if;
  end loop;
  return result;
end $$;
revoke all on function edunexus.calendar_scope_day(uuid,uuid,date),edunexus.effective_calendar_day(uuid,uuid,date),
  edunexus.read_instructional_calendar(uuid,uuid,date,date),edunexus.preview_instructional_calendar(uuid,uuid,integer,jsonb,text),
  edunexus.commit_instructional_calendar(uuid,uuid,integer,jsonb,text,text) from public;
grant execute on function edunexus.read_instructional_calendar(uuid,uuid,date,date),edunexus.preview_instructional_calendar(uuid,uuid,integer,jsonb,text),
  edunexus.commit_instructional_calendar(uuid,uuid,integer,jsonb,text,text) to edunexus_app;

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory'
));
