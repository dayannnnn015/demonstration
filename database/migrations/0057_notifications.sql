-- A personal inbox: the things that happened to work this person is responsible for.
--
-- This reverses two settled decisions, on the user's explicit decision of
-- 2026-11-05, and the reversal is the point of this header. 2026-09-19 recorded
-- that the workspace has "no notification bell and no alert badge", because the
-- absence-alert gate blocks "any messaging on attendance" and "a badge would be
-- decoration imitating a signal"; it ended "Add one when a rule exists to fire
-- it." 0.90.9, on 2026-11-05, declined notification preferences because
-- "EDUNEXUS sends no notifications". Both were shown to the user in those
-- words. The condition the first one named is what changed: a submitted class
-- list, an imported one and a declined one are rules that exist to fire it, and
-- they are nothing to do with attendance. The user also ruled, separately, that
-- the attendance gate covers attendance *figures and thresholds* and not the
-- submit/return/lock workflow around a consolidation -- so `month_submitted`,
-- `month_returned` and `month_locked` are named below. **Nothing here counts,
-- compares or thresholds an attendance figure, and nothing notifies anyone
-- about a learner's absences.** That gate stays shut exactly where it was.
--
-- Four properties this is built to keep.
--
-- **No learner is ever named.** `payload` admits a closed list of keys and a
-- learner's name is not among them, enforced by a check constraint rather than
-- by the care of whoever writes the next emitter. A notification says what
-- happened and to which class; the learner is carried as `learner_id` and
-- rendered as nothing at all. The reason is the one the Overview and the
-- command palette already turn on: every list under /learners and /enrollments
-- writes a `record_access_events` row naming the records it returned, so a bell
-- that previewed learner names would write an access row per poll and bury the
-- privacy audit in its own noise. The screen that shows a learner is the screen
-- that logs the disclosure. The notification only links to it.
--
-- **A notification is not a record of school fact.** It has no `version` and
-- writes no journal row of its own, which is a deliberate exception to the two
-- conventions in AGENTS.md, not an oversight. Every row here is *derived* from a
-- change that was already journalled by the writer that emitted it -- the
-- journal of record is `roster_submission_events` and its siblings -- so a
-- second journal would record only that a copy was delivered. `read_at` moves
-- null -> timestamp once and is idempotent, so a version check would add a
-- failure mode for someone with two tabs open and prevent no lost update.
-- Marking one's own inbox item read is not a change to any school record, and
-- asking for a 10-500 character reason to do it would be absurd.
--
-- **Nothing may forge one.** `notify` and `notify_managers` are revoked from
-- public and are *never* granted to `edunexus_app`. The API cannot insert a
-- notification; only another security-definer writer, running inside the same
-- transaction as the change it reports, can. There are no insert, update or
-- delete policies on the table at all.
--
-- **Nobody is notified of their own action.** `notify` drops a row addressed to
-- the actor, so a manager who submits a class list for a section they advise is
-- not told about it, and an adviser who imports nothing hears nothing.
--
-- The emitters live in later migrations, which `create or replace` the existing
-- writers one module at a time, following 0018, 0019 and 0021. This migration
-- carries the substrate and the roster-submission emitters only.

-- Every kind the approved first release names, declared once here. A check
-- constraint cannot be widened in place -- 0055 learned that about `text_size`
-- and had to replace the check -- so the whole first-release vocabulary is
-- listed now and a later emitter adds no constraint, only a `create or replace`.
create table edunexus.notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  kind text not null check(kind in (
    'roster_submitted','roster_imported','roster_declined','roster_withdrawn',
    'learner_placed','learner_moved','learner_withdrawn','learner_reentered','learner_unplaced',
    'month_submitted','month_returned','month_locked',
    'promotion_endorsed','promotion_approved','promotion_returned',
    'adviser_assigned','adviser_removed','calendar_changed',
    'year_activated','year_closed','next_year_placed')),
  subject_table text not null check(subject_table in ('roster_submissions','enrollments','attendance_months','promotion_decisions','sections','academic_years','instructional_calendars','next_year_placements')),
  subject_id uuid not null,
  academic_year_id uuid references edunexus.academic_years(id) on delete restrict,
  section_id uuid references edunexus.sections(id) on delete restrict,
  learner_id uuid references edunexus.learners(id) on delete restrict,
  -- The closed list that keeps a learner's name out of a preview. `payload`
  -- minus these keys must be empty, so an unlisted key is refused by the
  -- database and not by a reviewer noticing.
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'
    and payload-array['section_name','grade_level','row_count','count','month','year_label','decision']='{}'::jsonb),
  actor_user_id uuid references edunexus.staff(user_id) on delete restrict,
  request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz
);
-- The inbox, newest first. An identity column, not a uuid: a uuid cursor is not
-- chronological, which AGENTS.md records as a bug that only shows up under a
-- full test run.
create index notification_inbox_idx on edunexus.notifications(recipient_user_id,id desc);
-- The unread count the bell asks for, which must not scan a read inbox.
create index notification_unread_idx on edunexus.notifications(recipient_user_id) where read_at is null;
create index notification_subject_idx on edunexus.notifications(subject_table,subject_id);
create index notification_actor_idx on edunexus.notifications(actor_user_id);
create index notification_learner_idx on edunexus.notifications(learner_id);
create index notification_section_idx on edunexus.notifications(section_id);
create index notification_year_idx on edunexus.notifications(academic_year_id);

alter table edunexus.notifications enable row level security;
-- A notification belongs to one person. A manager does not read another
-- person's inbox: this is the one table in the system where being a manager
-- grants nothing, because an inbox is not a record about the school.
create policy scoped_read on edunexus.notifications for select to edunexus_app using(recipient_user_id=edunexus.actor_id());
grant select on edunexus.notifications to edunexus_app;

-- Addressed to one person. Silently drops a row addressed to the actor, or to
-- anyone who is not active staff, so an emitter never has to ask either
-- question. Returns nothing: an emitter must not be able to fail a school
-- change because a notification could not be delivered.
create function edunexus.notify(p_recipient uuid,p_kind text,p_subject_table text,p_subject_id uuid,p_year uuid,p_section uuid,p_learner uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_recipient is null or p_recipient=edunexus.actor_id() then return; end if;
  if not exists(select 1 from edunexus.staff where user_id=p_recipient and active) then return; end if;
  insert into edunexus.notifications(recipient_user_id,kind,subject_table,subject_id,academic_year_id,section_id,learner_id,payload,actor_user_id,request_id)
  values(p_recipient,p_kind,p_subject_table,p_subject_id,p_year,p_section,p_learner,coalesce(p_payload,'{}'::jsonb),edunexus.actor_id(),
    nullif(current_setting('edunexus.request_id',true),'')::uuid);
end $$;

-- Every active principal and administrative officer, which is what
-- `is_manager()` means, minus the actor.
create function edunexus.notify_managers(p_kind text,p_subject_table text,p_subject_id uuid,p_year uuid,p_section uuid,p_learner uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare m uuid;
begin
  for m in select user_id from edunexus.staff where active and role in ('principal','administrative_officer') loop
    perform edunexus.notify(m,p_kind,p_subject_table,p_subject_id,p_year,p_section,p_learner,p_payload);
  end loop;
end $$;

-- What a roster notification says: the class, never a learner. The section may
-- have been renamed since, so the name is captured as it was when it happened.
create function edunexus.roster_notification_payload(p edunexus.roster_submissions) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('section_name',s.name,'grade_level',s.grade_level,'row_count',p.row_count)
  from edunexus.sections s where s.id=p.section_id
$$;

create function edunexus.mark_notification_read(p_id bigint) returns edunexus.notifications language plpgsql security definer set search_path='' as $$
declare result edunexus.notifications;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  -- One message for a notification that does not exist and for one addressed to
  -- somebody else, so an id cannot be used to learn that a notification exists.
  update edunexus.notifications set read_at=coalesce(read_at,clock_timestamp())
    where id=p_id and recipient_user_id=edunexus.actor_id() returning * into result;
  if not found then raise exception using errcode='P2700',message='Notification not found'; end if;
  return result;
end $$;

-- Idempotent by design: nothing unread is not an error, it is a zero.
create function edunexus.mark_all_notifications_read() returns integer language plpgsql security definer set search_path='' as $$
declare marked integer;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  with done as (update edunexus.notifications set read_at=clock_timestamp()
    where recipient_user_id=edunexus.actor_id() and read_at is null returning 1)
  select count(*)::integer into marked from done;
  return marked;
end $$;

-- The roster emitters. Each is the 0028 function with its body unchanged except
-- for the one `perform edunexus.notify...` line, which is why the whole
-- function is restated: 0028 is applied and must never be edited.
create or replace function edunexus.submit_roster(p_section uuid,p_enrolled_on date,p_entry_kind text,p_csv text,p_row_count integer,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; result edunexus.roster_submissions; empty edunexus.roster_submissions;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  perform edunexus.check_roster_reason(p_reason);
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P1701',message='Submit a class list only for a section you currently advise'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if y.status='closed' then raise exception using errcode='P1702',message='The school year is closed'; end if;
  if p_enrolled_on is null or p_enrolled_on not between y.starts_on and y.ends_on then raise exception using errcode='P1702',message='The enrollment date must fall inside the school year'; end if;
  if p_entry_kind is null or p_entry_kind not in ('regular','transfer_in') or p_csv is null or octet_length(p_csv) not between 1 and 24000
    or p_row_count is null or p_row_count not between 1 and 50 then raise exception using errcode='23514',message='Invalid class list'; end if;
  if exists(select 1 from edunexus.roster_submissions where section_id=p_section and status='submitted') then
    raise exception using errcode='P1703',message='A class list for this section is already waiting'; end if;
  insert into edunexus.roster_submissions(section_id,academic_year_id,enrolled_on,entry_kind,csv,row_count,submitted_by)
    values(p_section,s.academic_year_id,p_enrolled_on,p_entry_kind,p_csv,p_row_count,edunexus.actor_id()) returning * into result;
  perform edunexus.journal_roster_submission(empty,result,'submit',p_reason);
  -- A waiting class list is work for the office, so the office is told.
  perform edunexus.notify_managers('roster_submitted','roster_submissions',result.id,result.academic_year_id,result.section_id,null,edunexus.roster_notification_payload(result));
  return result;
end $$;

create or replace function edunexus.withdraw_roster_submission(p_id uuid,p_version integer,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare prior edunexus.roster_submissions; result edunexus.roster_submissions;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  perform edunexus.check_roster_reason(p_reason);
  select * into prior from edunexus.roster_submissions where id=p_id for update;
  if not found or prior.submitted_by is distinct from edunexus.actor_id() then raise exception using errcode='P0002',message='Class list not found'; end if;
  if prior.version is distinct from p_version then raise exception using errcode='P0003',message='Class list changed'; end if;
  if prior.status<>'submitted' then raise exception using errcode='P1700',message='This class list is no longer waiting'; end if;
  update edunexus.roster_submissions set status='withdrawn' where id=p_id returning * into result;
  perform edunexus.journal_roster_submission(prior,result,'withdraw',p_reason);
  -- The office was told it was waiting, so the office is told it no longer is.
  perform edunexus.notify_managers('roster_withdrawn','roster_submissions',result.id,result.academic_year_id,result.section_id,null,edunexus.roster_notification_payload(result));
  return result;
end $$;

create or replace function edunexus.decide_roster_submission(p_id uuid,p_version integer,p_decision text,p_import uuid,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare prior edunexus.roster_submissions; result edunexus.roster_submissions; receipt edunexus.import_previews;
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
    if not found or receipt.committed_at is null or receipt.actor_user_id is distinct from edunexus.actor_id()
      or receipt.receipt->>'section_id' is distinct from prior.section_id::text then
      raise exception using errcode='P1704',message='Accept a class list only with an import you committed for its section'; end if;
  elsif p_decision='declined' then
    if p_import is not null then raise exception using errcode='23514',message='A declined class list has no import'; end if;
  else raise exception using errcode='23514',message='Choose accepted or declined'; end if;
  update edunexus.roster_submissions set status=p_decision,decided_by=edunexus.actor_id(),import_id=case when p_decision='accepted' then p_import end
    where id=p_id returning * into result;
  perform edunexus.journal_roster_submission(prior,result,case when p_decision='accepted' then 'accept' else 'decline' end,p_reason);
  -- The adviser who submitted it is told either way, and told which it was. A
  -- declined list *is* the "needs correction" signal: there is no such status on
  -- `roster_submissions`, whose four are submitted, withdrawn, accepted and
  -- declined, and none was invented here to carry a notification.
  perform edunexus.notify(result.submitted_by,case when p_decision='accepted' then 'roster_imported' else 'roster_declined' end,
    'roster_submissions',result.id,result.academic_year_id,result.section_id,null,
    edunexus.roster_notification_payload(result)||jsonb_build_object('decision',p_decision));
  return result;
end $$;

revoke all on function edunexus.notify(uuid,text,text,uuid,uuid,uuid,uuid,jsonb),
  edunexus.notify_managers(text,text,uuid,uuid,uuid,uuid,jsonb),
  edunexus.roster_notification_payload(edunexus.roster_submissions),
  edunexus.mark_notification_read(bigint),edunexus.mark_all_notifications_read() from public;
-- `notify` and `notify_managers` are deliberately absent here. The API holds
-- `edunexus_app`, and `edunexus_app` cannot send a notification -- only a
-- security-definer writer reporting a change it just made can.
grant execute on function edunexus.mark_notification_read(bigint),edunexus.mark_all_notifications_read() to edunexus_app;
