-- A list may hold several grades, and any number of lists may wait.
--
-- The class-list template gained a `grade_level` column on 2026-11-07, so one
-- file carries learners of several grades — which is what the office actually
-- has when it registers the school, rather than one class at a time. Two
-- things follow from that, and the school asked for both.
--
-- **A submission is no longer scoped to one grade.** `grade_level` may now be
-- null alongside a null `section_id`, meaning the grades are in the rows. The
-- older shapes are untouched: a class list still names its section, and a
-- single-grade registry list still names its grade.
--
-- **And the one-list-at-a-time rule goes.** `roster_submission_waiting_idx`
-- and `roster_submission_waiting_grade_idx` each allowed one waiting list per
-- section and per grade, which made sense when a list *was* a grade: two lists
-- of the same learners must not both be approved. It stops making sense once a
-- list is just a set of rows — an adviser sending Tuesday's arrivals should not
-- have to withdraw Monday's, and the school said so plainly. What actually
-- prevents a learner being enrolled twice is unchanged and is the thing that
-- was always doing the work: `place_enrollment` refuses a second enrolment in
-- one school year, and the reviewed import refuses the whole file when a row
-- matches a learner already enrolled. Approving the same list twice therefore
-- fails on its rows, not on an index.
drop index edunexus.roster_submission_waiting_idx;
drop index edunexus.roster_submission_waiting_grade_idx;

alter table edunexus.roster_submissions drop constraint roster_submission_target_chk;
-- Never both: a class list has one section and takes its grade from it; a
-- registry list has a grade, or has none and its rows carry their own.
alter table edunexus.roster_submissions
  add constraint roster_submission_target_chk check(not (section_id is not null and grade_level is not null));

-- The submitter, with the grades its rows carry.
--
-- `submit_roster_list` took one grade and could not express a list spanning
-- several, so this supersedes it and its grant is withdrawn below — the same
-- thing 0061 did to `submit_roster`, for the same reason.
--
-- **The gate is unchanged in substance and is now checked per grade.** An
-- adviser may submit rows only at grades they advise a class at in that year;
-- a list spanning two grades is allowed only if they advise a class at both.
-- An adviser's reach therefore has not widened by one learner: every row they
-- can send, they could already have sent as a single-grade list.
create function edunexus.submit_roster_grades(p_section uuid,p_grades smallint[],p_year uuid,p_enrolled_on date,p_entry_kind text,p_csv text,p_row_count integer,p_reason text)
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
    if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then
      raise exception using errcode='P1701',message='Submit a class list only for a section you currently advise'; end if;
    select * into y from edunexus.academic_years where id=s.academic_year_id for share;
    stored:=null;
  else
    select * into y from edunexus.academic_years where id=p_year for share;
    if not found then raise exception using errcode='P0002',message='School year not found'; end if;
    if p_grades is null or cardinality(p_grades)=0 then
      raise exception using errcode='23514',message='A list with no class must say which grades its learners are enrolling at'; end if;
    foreach g in array p_grades loop
      if g<0 or g>6 then raise exception using errcode='23514',message='A grade level is 0 for Kindergarten, then 1 to 6'; end if;
      if not edunexus.is_manager() and not exists(
        select 1 from edunexus.sections c where c.academic_year_id=y.id and c.grade_level=g
          and c.adviser_user_id=edunexus.actor_id()) then
        raise exception using errcode='P1701',message='Submit a list only for a grade you currently advise a class at'; end if;
    end loop;
    -- One grade is still recorded as that grade, so every reader that already
    -- understood a single-grade list keeps working. Several is null: the rows
    -- say which, and no one grade would be true of the list.
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

-- A list whose grades are in its rows is accepted by a registry import for the
-- same school year. The grade cannot be matched because the list has no single
-- grade to match — what is still matched, and is the point of the rule, is
-- that the import was committed **by this manager** and landed its learners
-- with no class, as the list asked.
create or replace function edunexus.decide_roster_submission(p_id uuid,p_version integer,p_decision text,p_import uuid,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare prior edunexus.roster_submissions; result edunexus.roster_submissions; receipt edunexus.import_previews; fits boolean;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  perform edunexus.check_roster_reason(p_reason);
  select * into prior from edunexus.roster_submissions where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Class list not found'; end if;
  if prior.version is distinct from p_version then raise exception using errcode='P0003',message='Class list changed'; end if;
  if prior.status<>'submitted' then raise exception using errcode='P1700',message='This class list is no longer waiting'; end if;
  if p_decision='accepted' then
    select * into receipt from edunexus.import_previews where id=p_import;
    fits:=found and receipt.committed_at is not null and receipt.actor_user_id is not distinct from edunexus.actor_id();
    if fits then
      if prior.section_id is not null then
        fits:=receipt.receipt->>'section_id' is not distinct from prior.section_id::text;
      else
        fits:=receipt.receipt->>'section_id' is null
          and receipt.receipt->>'academic_year_id' is not distinct from prior.academic_year_id::text
          and (prior.grade_level is null
            or (receipt.receipt->>'grade_level')::int is not distinct from prior.grade_level::int);
      end if;
    end if;
    if not fits then raise exception using errcode='P1704',
      message='Accept a class list only with an import you committed for its section, or for its grade when it has no class'; end if;
  elsif p_decision='declined' then
    if p_import is not null then raise exception using errcode='23514',message='A declined class list has no import'; end if;
  else raise exception using errcode='23514',message='Choose accepted or declined'; end if;
  update edunexus.roster_submissions set status=p_decision,decided_by=edunexus.actor_id(),import_id=case when p_decision='accepted' then p_import end
    where id=p_id returning * into result;
  perform edunexus.journal_roster_submission(prior,result,case when p_decision='accepted' then 'accept' else 'decline' end,p_reason);
  perform edunexus.notify(result.submitted_by,case when p_decision='accepted' then 'roster_imported' else 'roster_declined' end,
    'roster_submissions',result.id,result.academic_year_id,result.section_id,null,
    edunexus.roster_notification_payload(result)||jsonb_build_object('decision',p_decision));
  return result;
end $$;

-- A list with no single grade names none, rather than naming a null one.
create or replace function edunexus.roster_notification_payload(p edunexus.roster_submissions) returns jsonb language sql stable set search_path='' as $$
  select case
    when p.section_id is not null then
      (select jsonb_build_object('section_name',s.name,'grade_level',s.grade_level,'row_count',p.row_count)
       from edunexus.sections s where s.id=p.section_id)
    when p.grade_level is not null then jsonb_build_object('grade_level',p.grade_level,'row_count',p.row_count)
    else jsonb_build_object('row_count',p.row_count) end
$$;

revoke all on function edunexus.submit_roster_grades(uuid,smallint[],uuid,date,text,text,integer,text) from public;
grant execute on function edunexus.submit_roster_grades(uuid,smallint[],uuid,date,text,text,integer,text) to edunexus_app;
-- One writer for a submission, as 0061 left one: 0061's stays defined so that
-- migration still describes something that exists, and is no longer reachable.
revoke execute on function edunexus.submit_roster_list(uuid,smallint,uuid,date,text,text,integer,text) from edunexus_app;
