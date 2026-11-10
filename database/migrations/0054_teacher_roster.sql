-- An adviser takes their own learners into their own class, and the office sees
-- how far the school has got with the historical encoding.
--
-- Two separate things, in one migration because they are one request and they
-- share nothing but the lock.
--
-- ---------------------------------------------------------------------------
-- This reverses a settled decision, and says so where the decision lives.
-- ---------------------------------------------------------------------------
--
-- "Managers change learner records; teachers read only their currently assigned
-- learners" has been the rule since 0004, with one exception added on
-- 2026-11-03 for historical encoding. The user decided on 2026-11-05 that an
-- adviser may also **take an already-registered learner into a class they
-- advise** and **register a new learner into it**. The reversal is recorded in
-- docs/constraints.md with its date, as the roadmap's own step 7 required.
--
-- What is widened is kept as small as it can be, because the widening is the
-- risk:
--
--   * An adviser acts only on a section they advise, in a year that is not
--     closed. `may_advise_section` is the single predicate, and every new path
--     goes through it.
--   * An adviser may assign a class only to an enrolment that has **no class
--     yet**. Taking a learner out of a colleague's section stays a manager's
--     movement: a teacher cannot reassign, withdraw or re-enter anybody.
--   * An adviser may create a learner, but **not a near-duplicate**: a name and
--     birth date already on the registry is refused with the learner's own
--     page named, because two records for one child is the failure this system
--     most has to avoid and a teacher cannot see the registry to check.
--   * Nothing else a teacher may change is widened. No profile correction, no
--     LRN, no grade, no withdrawal, no deletion.
--
-- Everything still goes through `place_enrollment` and `move_enrollment` — the
-- same two writers the registry form, the roster import and next year's
-- placement use — so the LRN rule, the date rules, the one-enrolment-a-year
-- index, the version check and the `enrollment_events` journal are the same
-- ones, not a second set written for teachers.

-- Who may act on a section: the adviser of it, or any manager, while its school
-- year is open. Security definer, because it is called from inside functions
-- that bypass row security and must therefore re-check it themselves.
create function edunexus.may_advise_section(p_section uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.actor_role() is not null and exists(
    select 1 from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
    where s.id=p_section and y.status<>'closed'
      and (edunexus.is_manager() or s.adviser_user_id=edunexus.actor_id()))
$$;

-- 1. The two writers, replaced with the narrower guard.
--
-- Replaced rather than edited: 0048 is applied and checksummed, and both keep
-- their 0048 signatures so every existing caller is untouched. The only change
-- in each is the authorisation line.
create or replace function edunexus.place_enrollment(p_learner uuid,p_year uuid,p_grade smallint,p_section uuid,p_date date,p_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; l edunexus.learners; result edunexus.enrollments;
begin
  perform pg_advisory_xact_lock(82412001);
  -- A manager enrols anyone anywhere. An adviser enrols only **into a section
  -- they advise**: with no section this is still manager-only, because an
  -- enrolment with no class belongs to nobody's class and so to no adviser.
  if not (edunexus.is_manager() or (p_section is not null and edunexus.may_advise_section(p_section))) then
    raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=p_year for update;
  if not found then raise exception using errcode='23503',message='School year not found'; end if;
  if p_grade is null or p_grade<0 or p_grade>6 then raise exception using errcode='23514',message='Grade level must be between 0 and 6'; end if;
  if p_section is not null then
    select * into s from edunexus.sections where id=p_section;
    if not found then raise exception using errcode='23503',message='Section not found'; end if;
    if s.academic_year_id<>p_year or s.grade_level<>p_grade then
      raise exception using errcode='23514',message='Section must match the enrollment year and grade';
    end if;
  end if;
  select * into l from edunexus.learners where id=p_learner for update;
  if not found then raise exception using errcode='23503',message='Learner not found'; end if;
  if l.lrn is null then raise exception using errcode='P0303',message='This learner has no LRN on file. Record it on the Learner registry before enrolling them.'; end if;
  if y.status='closed' or p_date is null or p_date<y.starts_on or p_date>y.ends_on or p_date<=l.birth_date then
    raise exception using errcode='23514',message='Enrollment date or school year is invalid';
  end if;
  if p_reason is null or p_reason not in ('regular','transfer_in') then raise exception using errcode='23514',message='Invalid enrollment reason'; end if;
  insert into edunexus.enrollments(learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
  values(p_learner,p_year,p_grade,p_section,p_date,p_date,p_reason) returning * into result;
  return result;
end $$;

create or replace function edunexus.move_enrollment(p_id uuid,p_version integer,p_action text,p_date date,p_section uuid,p_exit_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; y edunexus.academic_years; s edunexus.sections; new_status text; reason text;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  -- The one movement an adviser may make: giving a class to an enrolment that
  -- has none, in a section they advise. Everything else -- taking a learner out
  -- of another adviser's section, withdrawing, re-entering -- stays a manager's.
  -- Read first so `e.section_id` can be seen; an adviser who guesses an
  -- enrolment id learns only that it exists, which it must already to be guessed.
  if not (edunexus.is_manager() or (p_action='reassigned' and p_section is not null and e.section_id is null
      and e.record_state='valid' and edunexus.may_advise_section(p_section))) then
    raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  perform 1 from edunexus.learners where id=e.learner_id for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment version conflict'; end if;
  if y.status='closed' or p_date is null or p_date<=e.effective_on or p_date>y.ends_on or p_date>timezone('Asia/Manila',now())::date then
    raise exception using errcode='23514',message='Movement must advance the timeline within an open year and cannot be future dated';
  end if;
  if p_action='withdrawn' then
    if e.status<>'enrolled' or p_section is not null or p_exit_reason is null or p_exit_reason not in ('transfer_out','withdrawal','dropout','death') then
      raise exception using errcode='23514',message='Invalid withdrawal';
    end if;
    new_status:='withdrawn';reason:=p_exit_reason;p_section:=e.section_id;
  elsif p_action in ('reassigned','reentered') then
    if p_exit_reason is not null or (p_action='reassigned' and (e.status<>'enrolled' or p_section is not distinct from e.section_id))
      or (p_action='reentered' and (e.status<>'withdrawn' or e.last_reason='death')) then
      raise exception using errcode='23514',message='Invalid enrollment transition';
    end if;
    if p_section is null then raise exception using errcode='23514',message='A section is required to assign or re-enter'; end if;
    select * into s from edunexus.sections where id=p_section;
    if not found or s.academic_year_id<>e.academic_year_id or s.grade_level<>e.grade_level then
      raise exception using errcode='23514',message='Target section must match enrollment year and grade';
    end if;
    new_status:='enrolled';reason:=case when p_action='reassigned' then 'section_change' else 'return_to_school' end;
  else raise exception using errcode='23514',message='Unknown enrollment transition'; end if;
  update edunexus.enrollments set section_id=p_section,status=new_status,effective_on=p_date,last_reason=reason where id=e.id returning * into e;
  return e;
end $$;

-- 2. What an adviser may take into their class.
--
-- The learners registered for this section's school year **at this section's
-- grade, with no class yet** -- which is exactly what the registry-first import
-- of 0.89.0 produces, and the case the brief names. An optional search
-- additionally finds a learner on the registry with no enrolment this year at
-- all, so a returning learner can be taken in without the office keying them
-- again; it needs two characters, because a bare list of every learner the
-- school has ever held is not an adviser's to read.
--
-- This names learners outside the adviser's own class, which is the point of
-- the feature and the reason every call writes a `record_access_events` row
-- naming exactly the records it returned.
-- The registry's own search folds accents, so this does too rather than finding
-- a different set of learners for the same words. `unaccent` is an extension the
-- hosted database may not carry, so the fold is spelled out for the letters the
-- school's own names actually use. Declared before its callers, which plpgsql
-- would tolerate either way but a reader should not have to.
create function edunexus.unaccent_fallback(p_text text) returns text language sql immutable set search_path='' as $$
  select translate(coalesce(p_text,''),'áàâäãåéèêëíìîïóòôöõúùûüñÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑ','aaaaaaeeeeiiiiooooouuuunAAAAAAEEEEIIIIOOOOOUUUUN')
$$;

-- Not declared `stable`: it takes the academic lock, as every other read here
-- does, and `read_grade_entry` is volatile for the same reason.
create function edunexus.read_pullable_learners(p_section uuid,p_search text,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; words text[];
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if not edunexus.may_advise_section(p_section) then raise exception using errcode='P2600',message='Take learners only into a class you advise'; end if;
  select * into s from edunexus.sections where id=p_section;
  select * into y from edunexus.academic_years where id=s.academic_year_id;
  -- A search of punctuation alone leaves no usable word, and must read as no
  -- search rather than as a search nothing can match.
  words:=case when p_search is null or length(btrim(p_search))<2 then null else nullif(
    array_remove(string_to_array(lower(btrim(regexp_replace(edunexus.unaccent_fallback(p_search),'[^A-Za-z0-9]+',' ','g'))),' '),''),
    '{}'::text[]) end;
  return jsonb_build_object(
    'section',jsonb_build_object('id',s.id,'name',s.name,'grade_level',s.grade_level,
      'academic_year_id',y.id,'start_year',y.start_year,'status',y.status,'starts_on',y.starts_on,'ends_on',y.ends_on),
    'items',(select coalesce(jsonb_agg(x order by x->>'last_name',x->>'first_name'),'[]'::jsonb) from (
      select jsonb_build_object('learner_id',l.id,'lrn',l.lrn,'first_name',l.first_name,'middle_name',l.middle_name,
        'last_name',l.last_name,'name_extension',l.name_extension,'sex',l.sex,'birth_date',l.birth_date,'address',l.address,
        'enrollment_id',e.id,'enrollment_version',e.version,'enrolled_on',e.enrolled_on,
        -- `assign` is an enrolment this section's grade already holds with no
        -- class; `enrol` is a learner not enrolled this year at all. The two
        -- are written differently and the screen says which it will do.
        'how',case when e.id is null then 'enrol' else 'assign' end) x
      from edunexus.learners l
      left join edunexus.enrollments e on e.learner_id=l.id and e.academic_year_id=y.id and e.record_state='valid'
        and e.status='enrolled' and e.section_id is null and e.grade_level=s.grade_level
      where l.merged_into is null and l.lrn is not null
        and (e.id is not null or (words is not null and not exists(
          select 1 from edunexus.enrollments o where o.learner_id=l.id and o.academic_year_id=y.id and o.record_state='valid')))
        and (words is null or (select bool_and(
          lower(edunexus.unaccent_fallback(coalesce(l.first_name,'')||' '||coalesce(l.middle_name,'')||' '||coalesce(l.last_name,'')||' '||coalesce(l.lrn,''))) like '%'||w||'%')
          from unnest(words) w))
      order by lower(l.last_name),lower(l.first_name),l.id
      limit greatest(1,least(coalesce(p_limit,25),50))) t));
end $$;

-- 3. Taking one learner into a class.
--
-- This has to be a function rather than a few statements in the service, and the
-- reason is the row policy doing its job: an adviser **cannot see** an unplaced
-- learner or their enrolment, so a service running under row security cannot
-- look up what it is about to take in. `visible_learner_identity` answers null
-- for exactly that caller, which is right. So the decision of *which* write
-- applies is made here, where row security is bypassed and therefore re-checked.
--
-- Which write applies is read from the records, never from what the caller
-- says, so a stale list cannot turn an assignment into a second enrolment.
create function edunexus.pull_learner_into_section(p_section uuid,p_learner uuid,p_version integer,p_date date,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; retained uuid; held edunexus.enrollments; result edunexus.enrollments; how text;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.may_advise_section(p_section) then raise exception using errcode='P2600',message='Take learners only into a class you advise'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found then raise exception using errcode='P0002',message='Section not found'; end if;
  select coalesce(merged_into,id) into retained from edunexus.learners where id=p_learner;
  if retained is null then raise exception using errcode='P0002',message='Learner not found'; end if;
  -- The enrolment they already hold for this school year, if any. The learner
  -- group, not the one row, because a linked duplicate's enrolment is theirs.
  select * into held from edunexus.enrollments e
    where e.academic_year_id=s.academic_year_id and e.record_state='valid'
      and e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=retained)
    limit 1;
  if found then
    if held.section_id is not null then raise exception using errcode='P2602',
      message='This learner is already in a class this school year'; end if;
    if held.grade_level<>s.grade_level then raise exception using errcode='P2603',
      message='This learner is registered at another grade this school year'; end if;
    if p_version is null then raise exception using errcode='P2604',
      message='Read the list again and take the learner in from it'; end if;
    -- The same mover as every other section change, so the version check, the
    -- date rules and the `enrollment_events` journal row are the same ones.
    result:=edunexus.move_enrollment(held.id,p_version,'reassigned',p_date,p_section,null);
    how:='assign';
  else
    result:=edunexus.place_enrollment(retained,s.academic_year_id,s.grade_level,p_section,p_date,p_reason);
    how:='enrol';
  end if;
  return jsonb_build_object('enrollment',to_jsonb(result),'how',how);
end $$;

-- 4. An adviser registers a new learner straight into their class.
--
-- The duplicate guard is the whole of why this is a function rather than two
-- requests. An adviser cannot search the registry, so they cannot check whether
-- the child is already on it -- and a second record for one child is the worst
-- thing this system can be made to hold: two SF10s, two attendance histories,
-- and no way to tell which is the record. So a name and birth date already on
-- file is refused, and the message tells them to take that learner in instead.
create function edunexus.register_learner_into_section(p_section uuid,p_profile jsonb,p_date date,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; l edunexus.learners; e edunexus.enrollments; existing edunexus.learners;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.may_advise_section(p_section) then raise exception using errcode='P2600',message='Register learners only into a class you advise'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found then raise exception using errcode='P0002',message='Section not found'; end if;
  if p_profile is null or jsonb_typeof(p_profile)<>'object'
    or p_profile-array['lrn','first_name','middle_name','last_name','name_extension','birth_date','sex','address']<>'{}'::jsonb
    then raise exception using errcode='23514',message='Invalid learner fields'; end if;
  -- The same child, already on the registry. Matched the way the reviewed import
  -- matches: first name, last name and birth date, case and accents set aside.
  select * into existing from edunexus.learners c where c.merged_into is null
    and c.birth_date=(p_profile->>'birth_date')::date
    and lower(edunexus.unaccent_fallback(btrim(c.first_name)))=lower(edunexus.unaccent_fallback(btrim(p_profile->>'first_name')))
    and lower(edunexus.unaccent_fallback(btrim(c.last_name)))=lower(edunexus.unaccent_fallback(btrim(p_profile->>'last_name')))
    limit 1;
  if found then raise exception using errcode='P2601',
    message='A learner with this name and birth date is already on the school registry. Take that learner into your class instead of making a second record for the same child; the office can help if it is a different child with the same name.'; end if;
  insert into edunexus.learners(lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address)
    values(nullif(btrim(p_profile->>'lrn'),''),btrim(p_profile->>'first_name'),nullif(btrim(p_profile->>'middle_name'),''),
      btrim(p_profile->>'last_name'),nullif(btrim(p_profile->>'name_extension'),''),(p_profile->>'birth_date')::date,
      p_profile->>'sex',nullif(btrim(p_profile->>'address'),'')) returning * into l;
  -- The same writer as every other enrolment, so the LRN rule, the date rules
  -- and the one-enrolment-a-year index are the same ones.
  e:=edunexus.place_enrollment(l.id,s.academic_year_id,s.grade_level,s.id,p_date,p_reason);
  return jsonb_build_object('learner',to_jsonb(l),'enrollment',to_jsonb(e));
end $$;

-- 5. School-wide oversight of the historical encoding.
--
-- Mirrors `read_grade_entry` (0035) exactly, which is the same shape of problem
-- already solved: counts for every section of a year, **no learner named and no
-- grade read**, so opening the screen writes no `record_access_events` row. A
-- view that paged the registry to work this out would bury the privacy audit in
-- its own noise, which is the rule the Overview has followed since 0.27.0.
--
-- What a manager needs to answer: which classes are done, which are not, and
-- whose they are. So: the learners each section currently holds, how many have
-- any encoded previous year, how many have the Grade 1 credential recorded, how
-- many have neither, the encoded years counted, and the adviser's name. Nothing
-- here reads a rating.
create function edunexus.read_encoding_progress(p_year uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare y edunexus.academic_years;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=p_year;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  return jsonb_build_object(
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'status',y.status),
    'today',(now() at time zone 'Asia/Manila')::date,
    'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'grade_level',s.grade_level,'name',s.name,
        'adviser_user_id',s.adviser_user_id,
        'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id),
        'learners',c.learners,'with_years',c.with_years,'with_credential',c.with_credential,
        'with_nothing',c.learners-c.with_any,'encoded_years',c.encoded_years)
        order by s.grade_level,lower(s.name),s.id),'[]'::jsonb)
      from edunexus.sections s
      cross join lateral (
        select count(*) learners,
          count(*) filter(where p.years>0) with_years,
          count(*) filter(where p.credential) with_credential,
          count(*) filter(where p.years>0 or p.credential) with_any,
          coalesce(sum(p.years),0) encoded_years
        from edunexus.enrollments e
        cross join lateral (
          select (select count(*) from edunexus.learner_prior_years py
            where py.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=coalesce(le.merged_into,le.id))) years,
            exists(select 1 from edunexus.learner_eligibility el
              where el.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=coalesce(le.merged_into,le.id))) credential
          from edunexus.learners le where le.id=e.learner_id) p
        where e.section_id=s.id and e.record_state='valid' and e.status='enrolled') c
      where s.academic_year_id=p_year),
    -- Registered at a grade with no class yet, so on no section's row above.
    -- Counted here so the total a manager reads is the whole school, exactly as
    -- the SF4 reports its unplaced learners rather than dropping them (0052).
    'unplaced',(select coalesce(jsonb_agg(jsonb_build_object('grade_level',g.grade_level,'learners',g.learners,
        'with_years',g.with_years,'with_credential',g.with_credential,'with_nothing',g.learners-g.with_any) order by g.grade_level),'[]'::jsonb)
      from (
        select e.grade_level,count(*) learners,
          count(*) filter(where p.years>0) with_years,
          count(*) filter(where p.credential) with_credential,
          count(*) filter(where p.years>0 or p.credential) with_any
        from edunexus.enrollments e
        cross join lateral (
          select (select count(*) from edunexus.learner_prior_years py
            where py.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=coalesce(le.merged_into,le.id))) years,
            exists(select 1 from edunexus.learner_eligibility el
              where el.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=coalesce(le.merged_into,le.id))) credential
          from edunexus.learners le where le.id=e.learner_id) p
        where e.academic_year_id=p_year and e.section_id is null and e.record_state='valid' and e.status='enrolled'
        group by e.grade_level) g));
end $$;

-- Taking a learner into a class names learners outside the adviser's own, so it
-- is logged like every other read that names one. The oversight read names
-- nobody and so appears nowhere here.
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory','enrollmentAttendance','enrollmentScores',
  'sf2Get','sf2Issue','sf9Get','sf9Issue','sf10Get','sf10Issue','reportRecordsGet','reportRecordsWrite',
  'promotionsGet','promotionsWrite','gradeSummaryGet','nextYearPreview','nextYearCommit',
  'priorRecordsGet','priorRecordsWrite','priorRecordHistory','pullableList','learnerPull','learnerRegister'
));

revoke all on function edunexus.may_advise_section(uuid),edunexus.unaccent_fallback(text),
  edunexus.read_pullable_learners(uuid,text,integer),edunexus.pull_learner_into_section(uuid,uuid,integer,date,text),
  edunexus.register_learner_into_section(uuid,jsonb,date,text),edunexus.read_encoding_progress(uuid) from public;
grant execute on function edunexus.may_advise_section(uuid),edunexus.unaccent_fallback(text),
  edunexus.read_pullable_learners(uuid,text,integer),edunexus.pull_learner_into_section(uuid,uuid,integer,date,text),
  edunexus.register_learner_into_section(uuid,jsonb,date,text),edunexus.read_encoding_progress(uuid) to edunexus_app;
