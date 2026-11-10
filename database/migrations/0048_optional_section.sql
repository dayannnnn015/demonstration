-- Optional section assignment on an enrolment.
--
-- A learner is enrolled in a school year, at a grade. Until now the database
-- also demanded a section at that same moment: enrollments.section_id was NOT
-- NULL, and the composite foreign key tied the grade to a real section. The
-- school does not work that way at promotion. A principal moves a learner up to
-- the succeeding grade; which class they land in is decided later, by someone
-- else, and is a separate piece of work. So a year and a grade are now enough
-- to hold a valid enrolment, and the section is filled in when it is known.
--
-- What deliberately does not change:
--
--   * grade_level stays NOT NULL. It is now supplied directly rather than read
--     off the section, so it survives having no section to read it from.
--   * The composite foreign key is left exactly as 0004 wrote it. It is MATCH
--     SIMPLE, the default, so Postgres skips the check when section_id is null
--     and enforces all three columns when it is not. A section belonging to
--     another year or grade is still rejected, with no new code to do it.
--   * The partial unique index from 0008 on (learner_id, academic_year_id)
--     where record_state='valid' is untouched: one valid enrolment a year.
--   * can_read_enrollment still joins sections, so a learner with no section
--     stays invisible to every teacher. That is the point, not an oversight:
--     retrieving unplaced learners into a class list is a separate future
--     workflow, and no permission is widened here to anticipate it.
--   * Enrolment and class-roster membership stay separate ideas. Nothing here
--     records who teaches a learner; a section is a column, not a roster.

alter table edunexus.enrollments alter column section_id drop not null;

-- The journal says what the row said, so it has to be able to say "none". It
-- stays append-only and nothing already written is touched; only rows recorded
-- from here on can carry a null section.
alter table edunexus.enrollment_events alter column section_id drop not null;

-- The one writer. 0004's enroll_learner derived the year and grade from the
-- section, which cannot work when there is no section, so both are arguments
-- now and the section is the optional one.
create function edunexus.place_enrollment(p_learner uuid,p_year uuid,p_grade smallint,p_section uuid,p_date date,p_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; l edunexus.learners; result edunexus.enrollments;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=p_year for update;
  if not found then raise exception using errcode='23503',message='School year not found'; end if;
  if p_grade is null or p_grade<0 or p_grade>6 then raise exception using errcode='23514',message='Grade level must be between 0 and 6'; end if;
  -- A section is optional; one that is given must belong to this year and grade.
  -- The foreign key would catch it too, but a named error reads better than a
  -- constraint violation on three columns.
  if p_section is not null then
    select * into s from edunexus.sections where id=p_section;
    if not found then raise exception using errcode='23503',message='Section not found'; end if;
    if s.academic_year_id<>p_year or s.grade_level<>p_grade then
      raise exception using errcode='23514',message='Section must match the enrollment year and grade';
    end if;
  end if;
  select * into l from edunexus.learners where id=p_learner for update;
  if not found then raise exception using errcode='23503',message='Learner not found'; end if;
  -- Registering a learner has required an LRN since the registry was built, so
  -- this only ever catches a record from before that rule, which the registry
  -- draws as "LRN missing" and offers a task to fill. The school's position is
  -- that an enrolment is not complete without one, and every way into an
  -- enrolment comes through here, so the rule holds for the registry form, the
  -- roster import and next year's placement alike. EDUNEXUS never invents one.
  if l.lrn is null then raise exception using errcode='P0303',message='This learner has no LRN on file. Record it on the Learner registry before enrolling them.'; end if;
  if y.status='closed' or p_date is null or p_date<y.starts_on or p_date>y.ends_on or p_date<=l.birth_date then
    raise exception using errcode='23514',message='Enrollment date or school year is invalid';
  end if;
  if p_reason is null or p_reason not in ('regular','transfer_in') then raise exception using errcode='23514',message='Invalid enrollment reason'; end if;
  insert into edunexus.enrollments(learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
  values(p_learner,p_year,p_grade,p_section,p_date,p_date,p_reason) returning * into result;
  return result;
end $$;

-- 0004's signature kept, so every existing caller — the registry's enrolment
-- form, the roster import, next year's placement — goes on working unchanged
-- and through exactly the same checks.
create or replace function edunexus.enroll_learner(p_learner uuid,p_section uuid,p_date date,p_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare s edunexus.sections;
begin
  select * into s from edunexus.sections where id=p_section;
  if not found then raise exception using errcode='23503',message='Section not found'; end if;
  return edunexus.place_enrollment(p_learner,s.academic_year_id,s.grade_level,s.id,p_date,p_reason);
end $$;

-- 0004's mover, which compared sections with `=`. Against a null section that
-- yields null rather than false, so the guard it was written to be fell open.
-- `is distinct from` says what was meant, and assigning a section to an
-- enrolment that had none is now an ordinary reassignment.
create or replace function edunexus.move_enrollment(p_id uuid,p_version integer,p_action text,p_date date,p_section uuid,p_exit_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; y edunexus.academic_years; s edunexus.sections; new_status text; reason text;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
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
    -- Whatever the row held, including nothing, is what the withdrawal keeps.
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

revoke all on function edunexus.place_enrollment(uuid,uuid,smallint,uuid,date,text) from public;
grant execute on function edunexus.place_enrollment(uuid,uuid,smallint,uuid,date,text) to edunexus_app;
