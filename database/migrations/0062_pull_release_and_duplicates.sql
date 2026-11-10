-- Three faults the school found in use, and one capability they asked for.
--
-- 1. An adviser could not take in a learner the office had registered *that
--    day*. `move_enrollment` requires the movement to advance the timeline --
--    `p_date <= e.effective_on` is refused -- which is right for a movement
--    *between* classes, where two sections would otherwise claim the same day.
--    But giving a first class to an enrolment that has none is not that
--    movement: nothing is being left, so nothing is ambiguous, and the office
--    registering a learner in the morning and the adviser taking them in that
--    afternoon is the ordinary case rather than an edge. The school hit it on
--    their first day of use, and the refusal they saw -- "movement must advance
--    the timeline within an open year and cannot be future dated" -- explains
--    nothing to an adviser who picked today. So: same day is allowed when, and
--    only when, the enrolment has no section. Every other rule is untouched;
--    the future-date rule in particular still stands.
--
-- 2. A manager could create a second record for one child. `POST /learners`
--    inserted directly, so the only duplicate guard was the unique LRN -- and a
--    second record carrying a *different* LRN sailed through. The workspace
--    warned and then let the manager continue, which is a warning and not a
--    control. An adviser has been refused this since 0054 (`P2601`); the office
--    was not. Two records for one child is the worst thing this system can
--    hold: two SF10s, two attendance histories, and no way to tell which is the
--    record. So the same check now stands in front of both, and a genuinely
--    different child with the same name and birth date is registered by saying
--    so in writing, which is journalled with the record.
--
-- 3. An adviser who took in the wrong learner had no way back. The pull was
--    built; its undo was not, so the only remedy was to ask the office. Taking
--    a learner back out returns the enrolment to having no class -- exactly the
--    state it was pulled from -- and never moves them into another class, which
--    stays a manager's act. It is the mirror of `pull_learner_into_section` and
--    is gated by the same predicate.

-- 1. Same-day assignment of a first class.
create or replace function edunexus.move_enrollment(p_id uuid,p_version integer,p_action text,p_date date,p_section uuid,p_exit_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; y edunexus.academic_years; s edunexus.sections; new_status text; reason text; was uuid; left_behind uuid; joined uuid; first_class boolean;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  if not (edunexus.is_manager() or (p_action='reassigned' and p_section is not null and e.section_id is null
      and e.record_state='valid' and edunexus.may_advise_section(p_section))) then
    raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  perform 1 from edunexus.learners where id=e.learner_id for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment version conflict'; end if;
  -- Giving a class to an enrolment that has none. The learner leaves nothing,
  -- so the same day is not two sections claiming one day; it is the day they
  -- were registered and the day they joined, which is usually one day.
  first_class:=p_action='reassigned' and e.section_id is null and p_section is not null;
  if y.status='closed' or p_date is null or p_date>y.ends_on or p_date>timezone('Asia/Manila',now())::date
    or (case when first_class then p_date<e.effective_on else p_date<=e.effective_on end) then
    raise exception using errcode='23514',message=case when first_class
      then 'The first day in the class must fall inside an open school year, cannot be in the future, and cannot be before the learner was registered'
      else 'Movement must advance the timeline within an open year and cannot be future dated' end;
  end if;
  was:=e.section_id;
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

  select adviser_user_id into left_behind from edunexus.sections where id=was;
  select adviser_user_id into joined from edunexus.sections where id=e.section_id;
  if p_action='withdrawn' then
    perform edunexus.notify(left_behind,'learner_withdrawn','enrollments',e.id,e.academic_year_id,was,e.learner_id,edunexus.section_notification_payload(was));
    perform edunexus.notify_managers('learner_withdrawn','enrollments',e.id,e.academic_year_id,was,e.learner_id,edunexus.section_notification_payload(was));
  elsif p_action='reentered' then
    perform edunexus.notify(joined,'learner_reentered','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
    perform edunexus.notify_managers('learner_reentered','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
  else
    perform edunexus.notify(joined,'learner_placed','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
    if was is distinct from e.section_id then
      perform edunexus.notify(left_behind,'learner_moved','enrollments',e.id,e.academic_year_id,was,e.learner_id,edunexus.section_notification_payload(was));
    end if;
    perform edunexus.notify_managers('learner_moved','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
  end if;
  return e;
end $$;

-- 2. One registration path for a manager, with the duplicate guard an adviser
--    has had since 0054. `p_distinct_reason` is how a real second child with
--    the same name and birth date is registered: it is required, written down,
--    and kept -- never a checkbox that only the person who ticked it remembers.
create function edunexus.register_learner(p_profile jsonb,p_distinct_reason text)
returns edunexus.learners language plpgsql security definer set search_path='' as $$
declare l edunexus.learners; existing edunexus.learners;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_profile is null or jsonb_typeof(p_profile)<>'object'
    or p_profile-array['lrn','first_name','middle_name','last_name','name_extension','birth_date','sex','address','guardian_name','guardian_contact']<>'{}'::jsonb
    then raise exception using errcode='23514',message='Invalid learner fields'; end if;
  -- Matched as the reviewed import matches, and as `register_learner_into_section`
  -- does: first name, last name and birth date, case and accents set aside.
  select * into existing from edunexus.learners c where c.merged_into is null
    and c.birth_date=(p_profile->>'birth_date')::date
    and lower(edunexus.unaccent_fallback(btrim(c.first_name)))=lower(edunexus.unaccent_fallback(btrim(p_profile->>'first_name')))
    and lower(edunexus.unaccent_fallback(btrim(c.last_name)))=lower(edunexus.unaccent_fallback(btrim(p_profile->>'last_name')))
    limit 1;
  if found then
    if p_distinct_reason is null or length(btrim(p_distinct_reason)) not between 10 and 500 or p_distinct_reason ~ '[[:cntrl:]]' then
      raise exception using errcode='P2605',
        message='A learner with this name and birth date is already on the registry. Open that record instead, or say in writing why this is a different child.'; end if;
  end if;
  insert into edunexus.learners(lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address,guardian_name,guardian_contact)
    values(nullif(btrim(p_profile->>'lrn'),''),btrim(p_profile->>'first_name'),nullif(btrim(p_profile->>'middle_name'),''),
      btrim(p_profile->>'last_name'),nullif(btrim(p_profile->>'name_extension'),''),(p_profile->>'birth_date')::date,
      p_profile->>'sex',nullif(btrim(p_profile->>'address'),''),nullif(btrim(p_profile->>'guardian_name'),''),
      nullif(btrim(p_profile->>'guardian_contact'),'')) returning * into l;
  return l;
end $$;

-- 3. Taking a learner back out of a class the adviser advises.
--
-- The mirror of `pull_learner_into_section`, and deliberately only that: the
-- enrolment returns to having **no class**, which is the state it was pulled
-- from. It never moves the learner into another class, never withdraws them
-- from school and never touches the learner record -- all three remain a
-- manager's. The enrolment, its history and everything recorded against it
-- stay exactly where they are; only the class is given back.
create function edunexus.release_learner_from_section(p_id uuid,p_version integer,p_date date,p_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; y edunexus.academic_years; was uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode='23514',message='A reason of 10 to 500 characters on one line is required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  if e.section_id is null then raise exception using errcode='P2606',message='This learner is already in no class'; end if;
  -- A manager may do it too; an adviser only for a class they advise now.
  if not (edunexus.is_manager() or edunexus.may_advise_section(e.section_id)) then
    raise exception using errcode='P2600',message='Take learners out only of a class you advise'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  perform 1 from edunexus.learners where id=e.learner_id for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment version conflict'; end if;
  if e.record_state<>'valid' then raise exception using errcode='P0301',message='This enrollment was voided'; end if;
  if e.status<>'enrolled' then raise exception using errcode='23514',message='A withdrawn learner is re-entered by the office, not released'; end if;
  if y.status='closed' or p_date is null or p_date>y.ends_on or p_date<e.effective_on
    or p_date>timezone('Asia/Manila',now())::date then
    raise exception using errcode='23514',
      message='The day the learner left the class must fall inside an open school year, cannot be in the future, and cannot be before they joined it'; end if;
  was:=e.section_id;
  update edunexus.enrollments set section_id=null,effective_on=p_date,last_reason='section_change' where id=e.id returning * into e;
  -- The office hears it, because a learner in no class is theirs to place and
  -- the SF4 is refused while any remain. The adviser who did it is not told
  -- about their own act: `notify` drops the actor's own row.
  perform edunexus.notify_managers('learner_unplaced','enrollments',e.id,e.academic_year_id,was,e.learner_id,
    edunexus.section_notification_payload(was));
  return e;
end $$;

revoke all on function edunexus.register_learner(jsonb,text),edunexus.release_learner_from_section(uuid,integer,date,text) from public;
grant execute on function edunexus.register_learner(jsonb,text),edunexus.release_learner_from_section(uuid,integer,date,text) to edunexus_app;
