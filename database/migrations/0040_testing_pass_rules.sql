-- From the testing pass (T3 and T5), decided by Claude under the user's
-- delegation of 26 October 2026.
--
-- F16: two school years could share dates, so a date could belong to two
-- years. A year's dates are fixed once it exists, so the new rule is checked
-- when a year is created.
--
-- F24: declaring a holiday (or any change that stops a classroom session) on a
-- date whose marks are already recorded previewed cleanly, and was refused
-- only at commit by guard_attendance_calendar. The preview now names the date
-- and the sections as a RECORDED_MARKS conflict, so the review cannot be
-- confirmed until those marks are reviewed and cleared. The commit-time guard
-- is unchanged and still the authority.
create or replace function edunexus.guard_year() returns trigger language plpgsql set search_path = '' as $$
declare n integer; max_ordinal integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception using errcode = '23514', message = 'Create school years as drafts'; end if;
    -- A date belongs to one school year. Dates are fixed once a year exists, so the check is needed only here.
    perform pg_advisory_xact_lock(82412001);
    -- A year with the same start year is left to its unique key, which answers it as a duplicate beside the field.
    if exists (select 1 from edunexus.academic_years a where a.id <> new.id and a.start_year <> new.start_year
      and daterange(a.starts_on, a.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
      raise exception using errcode = '23514', message = 'School years cannot overlap, and these dates fall inside a school year already recorded';
    end if;
    return new;
  end if;
  if old.status = 'closed' then raise exception using errcode = '23514', message = 'Closed school years are immutable'; end if;
  if new.start_year <> old.start_year or new.starts_on <> old.starts_on or new.ends_on <> old.ends_on then
    raise exception using errcode = '23514', message = 'School year dates are immutable in Section 1';
  end if;
  if new.status <> old.status and not ((old.status = 'draft' and new.status = 'active') or (old.status = 'active' and new.status = 'closed')) then
    raise exception using errcode = '23514', message = 'Invalid school year transition';
  end if;
  if old.status = 'draft' and new.status = 'active' then
    select count(*), max(ordinal) into n, max_ordinal from edunexus.reporting_periods where academic_year_id = old.id;
    if n = 0 or n <> max_ordinal then raise exception using errcode = '23514', message = 'Configure consecutively numbered reporting periods first'; end if;
    if exists (select 1 from edunexus.reporting_periods a join edunexus.reporting_periods b on a.academic_year_id=b.academic_year_id
      where a.academic_year_id=old.id and a.ordinal < b.ordinal and a.starts_on >= b.starts_on) then
      raise exception using errcode = '23514', message = 'Reporting periods must follow chronological order';
    end if;
  end if;
  return new;
end $$;

create or replace function edunexus.preview_instructional_calendar(p_year uuid,p_section uuid,p_version integer,p_changes jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare y edunexus.academic_years; s edunexus.sections; current_version integer; item jsonb; d date; before_state jsonb; after_state jsonb;
  normalized jsonb:='[]'; conflicts jsonb:='[]'; problems text[]:='{}'; seen date[]:='{}'; override_ids uuid[]; changed_count integer:=0; plan jsonb;
  marked_section record; after_schedule jsonb; scope_state jsonb; marked_ids uuid[];
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
      -- A session that would stop being a class where marks are already recorded is refused at commit by
      -- guard_attendance_calendar; the review now says so first, naming the date and the sections, so the
      -- principal is not refused only after confirming (testing finding F24).
      marked_ids:='{}';
      for marked_section in select distinct ad.section_id from edunexus.attendance_days ad join edunexus.sections sx on sx.id=ad.section_id
        where ad.day_on=d and sx.academic_year_id=p_year and (p_section is null or ad.section_id=p_section) loop
        if p_section is null then
          scope_state:=edunexus.calendar_scope_day(p_year,marked_section.section_id,d);
          after_schedule:=case when (scope_state->>'configured')::boolean then scope_state else after_state end;
        else
          after_schedule:=case when (after_state->>'configured')::boolean then after_state else edunexus.calendar_scope_day(p_year,null,d) end;
        end if;
        if exists(select 1 from edunexus.attendance_marks m join edunexus.attendance_days ad on ad.id=m.attendance_day_id
          where ad.section_id=marked_section.section_id and ad.day_on=d
            and ((m.am is not null and after_schedule->>'am' is distinct from 'classroom') or (m.pm is not null and after_schedule->>'pm' is distinct from 'classroom'))) then
          marked_ids:=array_append(marked_ids,marked_section.section_id);
        end if;
      end loop;
      if cardinality(marked_ids)>0 then
        if not 'RECORDED_MARKS'=any(problems) then problems:=array_append(problems,'RECORDED_MARKS'); end if;
        conflicts:=conflicts || jsonb_build_array(jsonb_build_object('day_on',d,'code','RECORDED_MARKS','section_ids',marked_ids));
      end if;
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
