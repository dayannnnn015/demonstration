-- An adviser's class list, submitted for a manager to import.
-- Teachers asked to bring in their own rosters. Learner records stay in the
-- hands of principals and administrative officers (the standing rule), so a
-- teacher does not import: they submit the list for their own section, and a
-- manager reviews it through the existing roster import, resolving duplicates
-- there, and accepts or declines it. The list is kept until then because the
-- import itself stores only fingerprints and must be run by one manager.
-- Journals keep a fingerprint of the list rather than a second copy of it.
create table edunexus.roster_submissions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null,academic_year_id uuid not null,
  enrolled_on date not null,entry_kind text not null check(entry_kind in ('regular','transfer_in')),
  csv text not null check(octet_length(csv) between 1 and 24000),
  row_count integer not null check(row_count between 1 and 50),
  status text not null default 'submitted' check(status in ('submitted','withdrawn','accepted','declined')),
  submitted_by uuid not null references edunexus.staff(user_id) on delete restrict,
  decided_by uuid references edunexus.staff(user_id) on delete restrict,
  import_id uuid references edunexus.import_previews(id) on delete restrict,
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict,
  check((status='accepted')=(import_id is not null)),
  check((status in ('accepted','declined'))=(decided_by is not null))
);
-- One list waits per section at a time, so two versions of a class cannot both be imported.
create unique index roster_submission_waiting_idx on edunexus.roster_submissions(section_id) where status='submitted';
create index roster_submission_by_idx on edunexus.roster_submissions(submitted_by,created_at desc);
create index roster_submission_status_idx on edunexus.roster_submissions(status,created_at desc);
create index roster_submission_decider_idx on edunexus.roster_submissions(decided_by);
create index roster_submission_import_idx on edunexus.roster_submissions(import_id);
create index roster_submission_year_idx on edunexus.roster_submissions(academic_year_id);

create table edunexus.roster_submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references edunexus.roster_submissions(id) on delete restrict,
  submission_version integer not null check(submission_version>=1),
  action text not null check(action in ('submit','withdraw','accept','decline')),
  before_snapshot jsonb,after_snapshot jsonb not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(submission_id,submission_version)
);
create index roster_submission_event_actor_idx on edunexus.roster_submission_events(actor_user_id);

alter table edunexus.roster_submissions enable row level security;
alter table edunexus.roster_submission_events enable row level security;
-- Managers read every list; a teacher reads the lists they submitted, and nothing else.
create policy scoped_read on edunexus.roster_submissions for select to edunexus_app using(edunexus.is_manager() or submitted_by=edunexus.actor_id());
create policy scoped_read on edunexus.roster_submission_events for select to edunexus_app using(edunexus.is_manager()
  or exists(select 1 from edunexus.roster_submissions s where s.id=submission_id and s.submitted_by=edunexus.actor_id()));
grant select on edunexus.roster_submissions,edunexus.roster_submission_events to edunexus_app;
create trigger version_record before update on edunexus.roster_submissions for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.roster_submissions for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.roster_submission_events for each row execute function edunexus.audit_record();

-- A snapshot without the list itself: the journal proves which list it was without keeping another copy of it.
create function edunexus.roster_submission_snapshot(p edunexus.roster_submissions) returns jsonb language sql immutable set search_path='' as $$
  select to_jsonb(p)-'csv' || jsonb_build_object('csv_sha256',encode(sha256(convert_to(p.csv,'UTF8')),'hex'))
$$;

create function edunexus.journal_roster_submission(p_before edunexus.roster_submissions,p_after edunexus.roster_submissions,p_action text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into edunexus.roster_submission_events(submission_id,submission_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
  values(p_after.id,p_after.version,p_action,case when p_before.id is null then null else edunexus.roster_submission_snapshot(p_before) end,
    edunexus.roster_submission_snapshot(p_after),btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
end $$;

create function edunexus.check_roster_reason(p_reason text) returns void language plpgsql immutable set search_path='' as $$
begin
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid roster submission reason'; end if;
end $$;

create function edunexus.submit_roster(p_section uuid,p_enrolled_on date,p_entry_kind text,p_csv text,p_row_count integer,p_reason text)
returns edunexus.roster_submissions language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; result edunexus.roster_submissions; empty edunexus.roster_submissions;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  perform edunexus.check_roster_reason(p_reason);
  select * into s from edunexus.sections where id=p_section;
  -- A teacher submits only for a section they advise now; anything else is answered as not found.
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
  return result;
end $$;

create function edunexus.withdraw_roster_submission(p_id uuid,p_version integer,p_reason text)
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
  return result;
end $$;

create function edunexus.decide_roster_submission(p_id uuid,p_version integer,p_decision text,p_import uuid,p_reason text)
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
    -- Accepted means imported: by this manager, committed, and into the section the list was for.
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
  return result;
end $$;

revoke all on function edunexus.roster_submission_snapshot(edunexus.roster_submissions),edunexus.journal_roster_submission(edunexus.roster_submissions,edunexus.roster_submissions,text,text),
  edunexus.check_roster_reason(text),edunexus.submit_roster(uuid,date,text,text,integer,text),edunexus.withdraw_roster_submission(uuid,integer,text),
  edunexus.decide_roster_submission(uuid,integer,text,uuid,text) from public;
grant execute on function edunexus.submit_roster(uuid,date,text,text,integer,text),edunexus.withdraw_roster_submission(uuid,integer,text),
  edunexus.decide_roster_submission(uuid,integer,text,uuid,text) to edunexus_app;
