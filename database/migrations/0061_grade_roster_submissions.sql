-- An adviser submits a list at a grade, with no class.
--
-- Until now a submission was always *a class list*: `section_id not null`, and
-- the import that accepted it put the learners straight into that section. The
-- school asked for the other shape as well -- an adviser prepares the learners
-- enrolling at their grade, a manager approves them onto the registry, and the
-- advisers of that grade then pull the ones who are theirs (decided
-- 2026-11-06). It is the submission equivalent of what `0048` already allowed a
-- manager's own import to do: land learners at a grade, in no class.
--
-- **The gate is the grades the submitter advises a class at, and nothing
-- wider.** An adviser's authority in this system comes from the sections they
-- advise and has never come from their role, so a grade they advise nobody at
-- is refused exactly as another adviser's section is. That keeps the new shape
-- strictly inside the old one's reach: every learner an adviser could put on a
-- grade list, they could already have put on their own class list.
--
-- A manager submitting is unchanged and unrestricted, as before.
alter table edunexus.roster_submissions
  alter column section_id drop not null,
  add column grade_level smallint;

-- Exactly one of the two, never both and never neither: a list is for a class
-- or for a grade, and which it is decides how it is imported and what the
-- acceptance below will match.
alter table edunexus.roster_submissions
  add constraint roster_submission_target_chk check((section_id is null)<>(grade_level is null)),
  add constraint roster_submission_grade_chk check(grade_level is null or grade_level between 0 and 6);

-- `roster_submission_waiting_idx` keeps one class list waiting per section. A
-- grade list belongs to no section, so it needs its own: one waiting per grade
-- of a year, for the same reason -- two lists for the same learners cannot both
-- be approved.
create unique index roster_submission_waiting_grade_idx
  on edunexus.roster_submissions(academic_year_id,grade_level) where status='submitted' and section_id is null;

-- The payload for a grade list names the grade and no section, because there is
-- no section to name. `grade_level` and `row_count` are already on the closed
-- key list 0057 enforces, so no notification learns a new word for this.
create or replace function edunexus.roster_notification_payload(p edunexus.roster_submissions) returns jsonb language sql stable set search_path='' as $$
  select case when p.section_id is null
    then jsonb_build_object('grade_level',p.grade_level,'row_count',p.row_count)
    else (select jsonb_build_object('section_name',s.name,'grade_level',s.grade_level,'row_count',p.row_count)
          from edunexus.sections s where s.id=p.section_id) end
$$;

-- The submitter, for either shape. `submit_roster` is left exactly as 0028
-- wrote it and its grant is withdrawn below, so there is one writer rather than
-- two that can drift.
create function edunexus.submit_roster_list(p_section uuid,p_grade smallint,p_year uuid,p_enrolled_on date,p_entry_kind text,p_csv text,p_row_count integer,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; result edunexus.roster_submissions; empty edunexus.roster_submissions;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  perform edunexus.check_roster_reason(p_reason);
  if (p_section is null)=(p_grade is null) then
    raise exception using errcode='23514',message='A class list is for one class or for one grade, not both and not neither'; end if;

  if p_section is not null then
    select * into s from edunexus.sections where id=p_section;
    -- A teacher submits only for a section they advise now; anything else is answered as not found.
    if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then
      raise exception using errcode='P1701',message='Submit a class list only for a section you currently advise'; end if;
    select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  else
    select * into y from edunexus.academic_years where id=p_year for share;
    if not found then raise exception using errcode='P0002',message='School year not found'; end if;
    -- The whole of the new permission, and it is deliberately narrow: a grade
    -- the submitter advises a class at, in this very year. An adviser who
    -- advises nobody at that grade is refused in the same words as an adviser
    -- reaching for somebody else's section.
    if not edunexus.is_manager() and not exists(
      select 1 from edunexus.sections c where c.academic_year_id=y.id and c.grade_level=p_grade
        and c.adviser_user_id=edunexus.actor_id()) then
      raise exception using errcode='P1701',message='Submit a list only for a grade you currently advise a class at'; end if;
  end if;

  if y.status='closed' then raise exception using errcode='P1702',message='The school year is closed'; end if;
  if p_enrolled_on is null or p_enrolled_on not between y.starts_on and y.ends_on then
    raise exception using errcode='P1702',message='The enrollment date must fall inside the school year'; end if;
  if p_entry_kind is null or p_entry_kind not in ('regular','transfer_in') or p_csv is null or octet_length(p_csv) not between 1 and 24000
    or p_row_count is null or p_row_count not between 1 and 50 then raise exception using errcode='23514',message='Invalid class list'; end if;

  if p_section is not null and exists(select 1 from edunexus.roster_submissions where section_id=p_section and status='submitted') then
    raise exception using errcode='P1703',message='A class list for this section is already waiting'; end if;
  if p_section is null and exists(select 1 from edunexus.roster_submissions
    where academic_year_id=y.id and grade_level=p_grade and section_id is null and status='submitted') then
    raise exception using errcode='P1703',message='A list for this grade is already waiting'; end if;

  insert into edunexus.roster_submissions(section_id,grade_level,academic_year_id,enrolled_on,entry_kind,csv,row_count,submitted_by)
    values(p_section,case when p_section is null then p_grade end,y.id,p_enrolled_on,p_entry_kind,p_csv,p_row_count,edunexus.actor_id())
    returning * into result;
  perform edunexus.journal_roster_submission(empty,result,'submit',p_reason);
  perform edunexus.notify_managers('roster_submitted','roster_submissions',result.id,result.academic_year_id,result.section_id,null,
    edunexus.roster_notification_payload(result));
  return result;
end $$;

-- Acceptance, for either shape. The rule is unchanged in substance: a list is
-- accepted only with an import this very manager committed, *for the thing the
-- list was for*. For a class list that is still the section. For a grade list
-- it is an import that landed its learners at that grade with no section --
-- `receipt.section_id` null and the grade and year matching -- which is exactly
-- what `0048`'s registry import writes.
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
          and (receipt.receipt->>'grade_level')::int is not distinct from prior.grade_level::int
          and receipt.receipt->>'academic_year_id' is not distinct from prior.academic_year_id::text;
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

revoke all on function edunexus.submit_roster_list(uuid,smallint,uuid,date,text,text,integer,text) from public;
grant execute on function edunexus.submit_roster_list(uuid,smallint,uuid,date,text,text,integer,text) to edunexus_app;
-- One writer for a submission from here on: 0028's remains defined so the
-- migration is not edited, and is simply no longer reachable by the runtime.
revoke execute on function edunexus.submit_roster(uuid,date,text,text,integer,text) from edunexus_app;
