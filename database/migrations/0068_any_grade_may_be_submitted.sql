-- An adviser submits a list at any grade.
--
-- `0064` allowed a grade list only at a grade the submitter advised a class
-- at. The school asked twice for that to go, and this removes it: the grades
-- on a list are now whatever its rows say, and the submitter's own classes do
-- not constrain them.
--
-- **The reason the gate is safe to drop, which is also why it was never worth
-- much.** A submission creates nothing. It is a CSV file on
-- `roster_submissions` with a reason attached; no learner record, no
-- enrolment and no registry row exists until a manager approves it through
-- the reviewed import, which checks every row against the registry and is
-- refused whole if any one of them is wrong. The gate therefore protected
-- nothing a manager's approval does not already protect — it only decided
-- *who may ask*, and the school has said that an adviser may ask about any
-- grade. In a school of 33 staff where the office reads every list before it
-- becomes a record, that is theirs to decide.
--
-- **What did not change.** A class list naming a section is still refused
-- unless the submitter advises that section: it names a class, and a class
-- belongs to its adviser. Only the grade list, which names no class, is open.
-- Everything after submission is untouched: the same approval, the same
-- duplicate checking, the same journal.
create or replace function edunexus.submit_roster_grades(p_section uuid,p_grades smallint[],p_year uuid,p_enrolled_on date,p_entry_kind text,p_csv text,p_row_count integer,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; result edunexus.roster_submissions; empty edunexus.roster_submissions; g smallint; stored smallint;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  perform edunexus.check_roster_reason(p_reason);

  if p_section is not null then
    if p_grades is not null and cardinality(p_grades)>0 then
      raise exception using errcode='23514',message='A class list takes its grade from its section'; end if;
    select * into s from edunexus.sections where id=p_section;
    -- A class list still belongs to the adviser of that class.
    if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then
      raise exception using errcode='P1701',message='Submit a class list only for a section you currently advise'; end if;
    select * into y from edunexus.academic_years where id=s.academic_year_id for share;
    stored:=null;
  else
    select * into y from edunexus.academic_years where id=p_year for share;
    if not found then raise exception using errcode='P0002',message='School year not found'; end if;
    if p_grades is null or cardinality(p_grades)=0 then
      raise exception using errcode='23514',message='A list with no class must say which grades its learners are enrolling at'; end if;
    -- The grades are checked for being grades, and for nothing else. Which
    -- classes the submitter advises no longer decides what they may put on a
    -- list, because the list is a request and the office answers it.
    foreach g in array p_grades loop
      if g<0 or g>6 then raise exception using errcode='23514',message='A grade level is 0 for Kindergarten, then 1 to 6'; end if;
    end loop;
    stored:=case when cardinality(p_grades)=1 then p_grades[1] end;
  end if;

  if y.status='closed' then raise exception using errcode='P1702',message='The school year is closed'; end if;
  if p_enrolled_on is null or p_enrolled_on not between y.starts_on and y.ends_on then
    raise exception using errcode='P1702',message='The enrollment date must fall inside the school year'; end if;
  if p_entry_kind is null or p_entry_kind not in ('regular','transfer_in') or p_csv is null or octet_length(p_csv) not between 1 and 24000
    or p_row_count is null or p_row_count not between 1 and 50 then raise exception using errcode='23514',message='Invalid class list'; end if;

  insert into edunexus.roster_submissions(section_id,grade_level,academic_year_id,enrolled_on,entry_kind,csv,row_count,submitted_by)
    values(p_section,stored,y.id,p_enrolled_on,p_entry_kind,p_csv,p_row_count,edunexus.actor_id())
    returning * into result;
  perform edunexus.journal_roster_submission(empty,result,'submit',p_reason);
  perform edunexus.notify_managers('roster_submitted','roster_submissions',result.id,result.academic_year_id,result.section_id,null,
    edunexus.roster_notification_payload(result));
  return result;
end $$;
