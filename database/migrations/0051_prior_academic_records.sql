-- The academic history the school already holds on paper and in spreadsheets.
--
-- EDUNEXUS derives the SF10 from what it recorded itself, so a learner who is
-- in Grade 3 when the school starts using it has one scholastic block and five
-- empty ones, while their Kinder-to-Grade-2 history sits in the adviser's own
-- files. This is the one-off transcription that closes that gap, for every
-- existing learner from Kindergarten to Grade 6 rather than for Grade 6 alone.
--
-- Three things this deliberately does not do.
--
-- It does not encode history as enrollments. A past year entered that way would
-- need an academic year, a section, reporting periods and section subjects
-- invented for it, and those would then surface as real classes on the SF2, the
-- SF4, the register and promotion. A prior year is a transcription of a document
-- and is kept as one, beside the enrollments rather than among them.
--
-- It computes nothing. The General Average is the one the source document
-- already carries, exactly as `report_summaries` holds the one from the ECR
-- (decided 2026-10-08). No total, average or transmutation is derived here.
--
-- It records no Kindergarten grade. The SF10-ES has no scholastic block for
-- Kinder: Kinder is the *credential* that makes a learner eligible for Grade 1,
-- and that is what `learner_eligibility` holds. The Kindergarten grading gate
-- stays shut, so `grade_level` is 1 to 6 and a Kinder block is refused with the
-- reason (decided 2026-11-03).

-- One scholastic block: one learner, one school year, at one grade. The school
-- named is the school that taught the year, which is Balili for its own
-- learners and the previous school for a transferee, because the SF10's block
-- heading has those fields for exactly that reason.
create table edunexus.learner_prior_years (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references edunexus.learners(id) on delete restrict,
  start_year integer not null check(start_year between 1990 and 2100),
  -- Kinder is the eligibility credential, not a block; see the header.
  grade_level integer not null check(grade_level between 1 and 6),
  school_name text not null check(length(btrim(school_name)) between 1 and 150 and school_name !~ '[[:cntrl:]]'),
  school_code text check(school_code is null or school_code ~ '^[0-9]{6}$'),
  school_address text check(school_address is null or (length(btrim(school_address)) between 1 and 300 and school_address !~ '[[:cntrl:]]')),
  section_name text check(section_name is null or (length(btrim(section_name)) between 1 and 60 and section_name !~ '[[:cntrl:]]')),
  adviser_name text check(adviser_name is null or (length(btrim(adviser_name)) between 1 and 150 and adviser_name !~ '[[:cntrl:]]')),
  general_average numeric(5,2) check(general_average is null or general_average between 0 and 100),
  remark text check(remark is null or remark in ('passed','failed')),
  -- Which document this was transcribed from. A permanent record copied out of a
  -- spreadsheet is only as good as the note saying which spreadsheet, so it is
  -- required and journalled. It is never printed: the form has no box for it.
  source text not null check(length(btrim(source)) between 10 and 500 and source !~ '[[:cntrl:]]'),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- One learner is at one grade in one school year, so this is both the identity of
-- a block and the rule that stops the same year being encoded twice. A repeated
-- grade is a different school year and is unaffected.
create unique index learner_prior_year_idx on edunexus.learner_prior_years(learner_id,start_year);
create index learner_prior_year_order_idx on edunexus.learner_prior_years(learner_id,start_year desc);

-- The learning areas of one prior year, as the source document lists them. The
-- subject catalog is optional here: a year taught under an earlier curriculum
-- may name an area the catalog never carried, and inventing a catalog row for it
-- would put a subject nobody chose into the school's own list.
create table edunexus.learner_prior_grades (
  id uuid primary key default gen_random_uuid(),
  -- Cascading, uniquely in this schema: a subject row has no life apart from its
  -- block, and the journal, not the row, is the record of what the block said.
  prior_year_id uuid not null references edunexus.learner_prior_years(id) on delete cascade,
  subject_id uuid references edunexus.subjects(id) on delete restrict,
  code text check(code is null or code ~ '^[A-Z][A-Z0-9_-]{0,23}$'),
  name text not null check(length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  display_order integer not null check(display_order between 1 and 40),
  q1 numeric(5,2) check(q1 is null or q1 between 0 and 100),
  q2 numeric(5,2) check(q2 is null or q2 between 0 and 100),
  q3 numeric(5,2) check(q3 is null or q3 between 0 and 100),
  q4 numeric(5,2) check(q4 is null or q4 between 0 and 100),
  final numeric(5,2) check(final is null or final between 0 and 100),
  remark text check(remark is null or remark in ('passed','failed')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- The same learning area twice in one year is the duplicate that matters, and it
-- is the same area however it was capitalised on the day it was typed.
create unique index learner_prior_grade_name_idx on edunexus.learner_prior_grades(prior_year_id,lower(btrim(name)));
create unique index learner_prior_grade_order_idx on edunexus.learner_prior_grades(prior_year_id,display_order);
create index learner_prior_grade_subject_idx on edunexus.learner_prior_grades(subject_id);

-- The SF10's ELIGIBILITY FOR ELEMENTARY SCHOOL ENROLLMENT block, which is where
-- a learner's Kindergarten record belongs: the credential presented for Grade 1,
-- the school that issued it, or the test that stood in for it. One per learner.
create table edunexus.learner_eligibility (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references edunexus.learners(id) on delete restrict,
  credential text not null check(credential in ('kinder_progress_report','eccd_checklist','kindergarten_certificate','pept','others')),
  -- The form's own "Others (Pls. Specify)". Required for 'others', refused otherwise.
  credential_other text check(credential_other is null or (length(btrim(credential_other)) between 1 and 150 and credential_other !~ '[[:cntrl:]]')),
  school_name text check(school_name is null or (length(btrim(school_name)) between 1 and 150 and school_name !~ '[[:cntrl:]]')),
  school_code text check(school_code is null or school_code ~ '^[0-9]{6}$'),
  school_address text check(school_address is null or (length(btrim(school_address)) between 1 and 300 and school_address !~ '[[:cntrl:]]')),
  -- As the form prints it, beside the PEPT box. Text, because the form does not
  -- say it is a number and nothing here needs to do arithmetic on it.
  pept_rating text check(pept_rating is null or (length(btrim(pept_rating)) between 1 and 30 and pept_rating !~ '[[:cntrl:]]')),
  examined_on date,
  testing_center text check(testing_center is null or (length(btrim(testing_center)) between 1 and 300 and testing_center !~ '[[:cntrl:]]')),
  remark text check(remark is null or (length(btrim(remark)) between 1 and 150 and remark !~ '[[:cntrl:]]')),
  source text not null check(length(btrim(source)) between 10 and 500 and source !~ '[[:cntrl:]]'),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(learner_id),
  check(case when credential='others' then credential_other is not null else credential_other is null end),
  check(case when credential='pept' then true else pept_rating is null end)
);

-- One row per saved block, with the whole block before and after, so a
-- transcription that turns out to be wrong can be shown to have been corrected
-- rather than quietly replaced. The identity column is deliberate: this journal
-- is paged newest first, and a random uuid cursor is not chronological.
create table edunexus.learner_prior_record_events (
  id bigint generated always as identity primary key,
  learner_id uuid not null references edunexus.learners(id) on delete restrict,
  -- No foreign key: a removed block's journal rows outlive it, which is the point.
  prior_year_id uuid,
  kind text not null check(kind in ('prior_year','eligibility')),
  action text not null check(action in ('create','update','delete')),
  before_snapshot jsonb,after_snapshot jsonb,
  reason text not null check(length(btrim(reason)) between 10 and 500 and reason !~ '[[:cntrl:]]'),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check(case action when 'create' then before_snapshot is null and after_snapshot is not null
    when 'delete' then before_snapshot is not null and after_snapshot is null
    else before_snapshot is not null and after_snapshot is not null end)
);
create index learner_prior_record_event_learner_idx on edunexus.learner_prior_record_events(learner_id,id desc);
create index learner_prior_record_event_actor_idx on edunexus.learner_prior_record_events(actor_user_id);

do $$ declare t text; begin
  foreach t in array array['learner_prior_years','learner_prior_grades','learner_eligibility'] loop
    execute format('alter table edunexus.%I enable row level security',t);
    execute format('create trigger version_record before update on edunexus.%I for each row execute function edunexus.version_record()',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
  end loop;
end $$;
-- A learner's history is read exactly as the learner is: by a manager for
-- anyone, by an adviser for a learner currently in a section they advise.
create policy scoped_read on edunexus.learner_prior_years for select to edunexus_app using(edunexus.can_read_learner(learner_id));
create policy scoped_read on edunexus.learner_prior_grades for select to edunexus_app using(exists(
  select 1 from edunexus.learner_prior_years y where y.id=prior_year_id and edunexus.can_read_learner(y.learner_id)));
create policy scoped_read on edunexus.learner_eligibility for select to edunexus_app using(edunexus.can_read_learner(learner_id));
alter table edunexus.learner_prior_record_events enable row level security;
create policy scoped_read on edunexus.learner_prior_record_events for select to edunexus_app using(edunexus.can_read_learner(learner_id));
create trigger audit_record after insert on edunexus.learner_prior_record_events for each row execute function edunexus.audit_record();
grant select on edunexus.learner_prior_years,edunexus.learner_prior_grades,edunexus.learner_eligibility,edunexus.learner_prior_record_events to edunexus_app;

-- Who may encode a learner's history.
--
-- Managers, for every learner. An adviser, for a learner currently in a section
-- they advise in an open school year -- which is what can_read_learner already
-- means for a teacher, so the scope is the existing policy rather than a second
-- one beside it.
--
-- This reverses the settled rule that only managers change learner records
-- (decided 2026-11-03). The reason is where the documents are: the historical
-- grades are in the advisers' own spreadsheets, and routing 897 learners'
-- history through two office accounts would either take a year or be done by
-- advisers signing in as somebody else. Encoding stays confined to a teacher's
-- own current learners, every write is journalled with a reason under their own
-- name, and nothing else about what a teacher may change is widened.
create function edunexus.may_write_prior_records(p_learner uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.actor_role() is not null and edunexus.can_read_learner(p_learner)
$$;

-- The learner a prior record is written against, after the checks every writer
-- shares. Security definer bypasses row security, so this re-checks it.
create function edunexus.prior_record_learner(p_learner uuid) returns edunexus.learners language plpgsql security definer set search_path='' as $$
declare l edunexus.learners;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into l from edunexus.learners where id=p_learner;
  if not found or not edunexus.can_read_learner(l.id) then raise exception using errcode='P0002',message='Learner not found'; end if;
  -- A linked duplicate is kept exactly as it was: its history belongs on the record that counts.
  if l.merged_into is not null then raise exception using errcode='P2501',message='This profile is linked into another; encode the history on the record that is kept'; end if;
  if not edunexus.may_write_prior_records(l.id) then raise exception using errcode='P2500',message='Encode history only for your own current learners'; end if;
  return l;
end $$;

create function edunexus.check_prior_reason(p_reason text) returns void language plpgsql immutable set search_path='' as $$
begin
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid reason'; end if;
end $$;

-- A whole block as it is journalled and read back: its own fields and its
-- learning areas in order. One shape, so a before snapshot and an after
-- snapshot are comparable and the API lays out what it was given.
create function edunexus.prior_year_snapshot(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',y.id,'learner_id',y.learner_id,'start_year',y.start_year,'grade_level',y.grade_level,
    'school_name',y.school_name,'school_code',y.school_code,'school_address',y.school_address,'section_name',y.section_name,
    'adviser_name',y.adviser_name,'general_average',y.general_average,'remark',y.remark,'source',y.source,'version',y.version,
    -- A subject row's own id is deliberately not here. The block is written
    -- whole, so every save re-creates its rows with new ids, and a snapshot
    -- carrying them could never equal the one before it -- which is exactly
    -- what decides whether a save changed anything.
    'subjects',(select coalesce(jsonb_agg(jsonb_build_object('subject_id',g.subject_id,'code',g.code,'name',g.name,
        'display_order',g.display_order,'q1',g.q1,'q2',g.q2,'q3',g.q3,'q4',g.q4,'final',g.final,'remark',g.remark) order by g.display_order),'[]'::jsonb)
      from edunexus.learner_prior_grades g where g.prior_year_id=y.id))
  from edunexus.learner_prior_years y where y.id=p_id
$$;

-- Record or correct one scholastic block with its learning areas, in one
-- transaction. The learning areas given are the block's whole list: a row left
-- out is a row removed, because the source document is the authority and a
-- half-replaced block would be neither document.
create function edunexus.write_learner_prior_year(p_id uuid,p_version integer,p_learner uuid,p_year jsonb,p_subjects jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l edunexus.learners; prior edunexus.learner_prior_years; result edunexus.learner_prior_years; before jsonb; after jsonb;
  entry jsonb; seen text[]:='{}'; n integer:=0; this_year integer; subject_id uuid; nm text; remark text;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_prior_reason(p_reason);
  if p_year is null or jsonb_typeof(p_year)<>'object'
    or p_year-array['start_year','grade_level','school_name','school_code','school_address','section_name','adviser_name','general_average','remark','source']<>'{}'::jsonb
    then raise exception using errcode='23514',message='Invalid prior year fields'; end if;
  if p_subjects is null or jsonb_typeof(p_subjects)<>'array' then raise exception using errcode='23514',message='Invalid learning areas'; end if;
  if jsonb_array_length(p_subjects)<1 then raise exception using errcode='P2507',message='A school year needs at least one learning area'; end if;
  if jsonb_array_length(p_subjects)>40 then raise exception using errcode='23514',message='At most 40 learning areas in one school year'; end if;
  if p_id is null then
    if p_version is distinct from 0 then raise exception using errcode='P0003',message='This history changed while you were editing'; end if;
    l:=edunexus.prior_record_learner(p_learner);
  else
    select * into prior from edunexus.learner_prior_years where id=p_id;
    if not found then raise exception using errcode='P0002',message='Prior school year not found'; end if;
    l:=edunexus.prior_record_learner(prior.learner_id);
    if p_learner is not null and p_learner is distinct from prior.learner_id then raise exception using errcode='23514',message='A block cannot be moved to another learner'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='This history changed while you were editing'; end if;
    before:=edunexus.prior_year_snapshot(prior.id);
  end if;
  if jsonb_typeof(p_year->'start_year')<>'number' or jsonb_typeof(p_year->'grade_level')<>'number' then raise exception using errcode='23514',message='A school year and a grade level are required'; end if;
  this_year:=extract(year from timezone('Asia/Manila',now()))::integer;
  if (p_year->>'start_year')::integer not between 1990 and this_year then
    raise exception using errcode='P2503',message='Encode a school year that has already begun, from 1990 to this one'; end if;
  if (p_year->>'grade_level')::integer not between 1 and 6 then
    raise exception using errcode='P2504',message='A scholastic block is Grade 1 to Grade 6; a Kindergarten record is the eligibility credential for Grade 1'; end if;
  -- A year EDUNEXUS already holds as an enrollment is already a block on the SF10.
  -- Encoding it again would print the same year twice on a permanent record.
  if exists(select 1 from edunexus.enrollments e join edunexus.academic_years y on y.id=e.academic_year_id
    where e.record_state='valid' and e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=l.id)
      and y.start_year=(p_year->>'start_year')::integer) then
    raise exception using errcode='P2502',message='EDUNEXUS already holds this school year for this learner; its grades are entered on Promotion, not here'; end if;
  if p_id is null then
    insert into edunexus.learner_prior_years(learner_id,start_year,grade_level,school_name,school_code,school_address,section_name,adviser_name,general_average,remark,source)
      values(l.id,(p_year->>'start_year')::integer,(p_year->>'grade_level')::integer,btrim(p_year->>'school_name'),nullif(btrim(p_year->>'school_code'),''),
        nullif(btrim(p_year->>'school_address'),''),nullif(btrim(p_year->>'section_name'),''),nullif(btrim(p_year->>'adviser_name'),''),
        edunexus.report_grade_value(p_year->'general_average'),nullif(p_year->>'remark',''),btrim(p_year->>'source')) returning * into result;
  else
    update edunexus.learner_prior_years set start_year=(p_year->>'start_year')::integer,grade_level=(p_year->>'grade_level')::integer,
      school_name=btrim(p_year->>'school_name'),school_code=nullif(btrim(p_year->>'school_code'),''),school_address=nullif(btrim(p_year->>'school_address'),''),
      section_name=nullif(btrim(p_year->>'section_name'),''),adviser_name=nullif(btrim(p_year->>'adviser_name'),''),
      general_average=edunexus.report_grade_value(p_year->'general_average'),remark=nullif(p_year->>'remark',''),source=btrim(p_year->>'source')
      where id=prior.id returning * into result;
    delete from edunexus.learner_prior_grades where prior_year_id=prior.id;
  end if;
  if result.remark is not null and result.remark not in ('passed','failed') then raise exception using errcode='23514',message='A remark is passed or failed'; end if;
  for entry in select x.value from jsonb_array_elements(p_subjects) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['subject_id','code','name','q1','q2','q3','q4','final','remark']<>'{}'::jsonb
      then raise exception using errcode='23514',message='Invalid learning area fields'; end if;
    nm:=btrim(entry->>'name');
    if nm is null or length(nm) not between 1 and 120 or nm ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Name each learning area as the document prints it'; end if;
    if lower(nm)=any(seen) then raise exception using errcode='P2505',message='The same learning area appears twice in this school year'; end if;
    seen:=array_append(seen,lower(nm));
    subject_id:=nullif(entry->>'subject_id','')::uuid;
    if subject_id is not null and not exists(select 1 from edunexus.subjects where id=subject_id) then raise exception using errcode='P0002',message='Subject not found'; end if;
    remark:=nullif(entry->>'remark','');
    if remark is not null and remark not in ('passed','failed') then raise exception using errcode='23514',message='A remark is passed or failed'; end if;
    n:=n+1;
    insert into edunexus.learner_prior_grades(prior_year_id,subject_id,code,name,display_order,q1,q2,q3,q4,final,remark)
      values(result.id,subject_id,nullif(upper(btrim(entry->>'code')),''),nm,n,
        edunexus.report_grade_value(entry->'q1'),edunexus.report_grade_value(entry->'q2'),edunexus.report_grade_value(entry->'q3'),
        edunexus.report_grade_value(entry->'q4'),edunexus.report_grade_value(entry->'final'),remark);
  end loop;
  after:=edunexus.prior_year_snapshot(result.id);
  if before is not null and before-'version'=after-'version' then raise exception using errcode='P2506',message='Nothing has changed'; end if;
  insert into edunexus.learner_prior_record_events(learner_id,prior_year_id,kind,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(l.id,result.id,'prior_year',case when p_id is null then 'create' else 'update' end,before,after,btrim(p_reason),
      edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return after;
end $$;

-- Remove a block that should never have been there. The learning areas go with
-- it, and the journal keeps what it said.
create function edunexus.delete_learner_prior_year(p_id uuid,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior edunexus.learner_prior_years; l edunexus.learners; before jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_prior_reason(p_reason);
  select * into prior from edunexus.learner_prior_years where id=p_id;
  if not found then raise exception using errcode='P0002',message='Prior school year not found'; end if;
  l:=edunexus.prior_record_learner(prior.learner_id);
  if p_version is distinct from prior.version then raise exception using errcode='P0003',message='This history changed while you were editing'; end if;
  before:=edunexus.prior_year_snapshot(prior.id);
  delete from edunexus.learner_prior_years where id=prior.id;
  insert into edunexus.learner_prior_record_events(learner_id,prior_year_id,kind,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(l.id,prior.id,'prior_year','delete',before,null,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return before;
end $$;

create function edunexus.eligibility_snapshot(p_learner uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',e.id,'learner_id',e.learner_id,'credential',e.credential,'credential_other',e.credential_other,
    'school_name',e.school_name,'school_code',e.school_code,'school_address',e.school_address,'pept_rating',e.pept_rating,
    'examined_on',e.examined_on,'testing_center',e.testing_center,'remark',e.remark,'source',e.source,'version',e.version)
  from edunexus.learner_eligibility e where e.learner_id=p_learner
$$;

-- The credential presented for Grade 1, which is where a Kindergarten record
-- goes. It carries no grade, by the rule in this file's header.
create function edunexus.write_learner_eligibility(p_learner uuid,p_version integer,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l edunexus.learners; prior edunexus.learner_eligibility; result edunexus.learner_eligibility; before jsonb; after jsonb; cred text;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_prior_reason(p_reason);
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_payload-array['credential','credential_other','school_name','school_code','school_address','pept_rating','examined_on','testing_center','remark','source']<>'{}'::jsonb
    then raise exception using errcode='23514',message='Invalid eligibility fields'; end if;
  l:=edunexus.prior_record_learner(p_learner);
  cred:=p_payload->>'credential';
  if cred is null or cred not in ('kinder_progress_report','eccd_checklist','kindergarten_certificate','pept','others') then
    raise exception using errcode='P2508',message='Name the credential presented for Grade 1'; end if;
  if cred='others' and nullif(btrim(p_payload->>'credential_other'),'') is null then
    raise exception using errcode='P2508',message='Say which other credential was presented'; end if;
  if cred<>'others' and nullif(btrim(p_payload->>'credential_other'),'') is not null then
    raise exception using errcode='P2508',message='Only an "other" credential is specified in words'; end if;
  if cred<>'pept' and nullif(btrim(p_payload->>'pept_rating'),'') is not null then
    raise exception using errcode='P2508',message='A PEPT rating belongs only to a PEPT credential'; end if;
  select * into prior from edunexus.learner_eligibility where learner_id=l.id;
  if found then
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='This history changed while you were editing'; end if;
    before:=edunexus.eligibility_snapshot(l.id);
    update edunexus.learner_eligibility set credential=cred,credential_other=nullif(btrim(p_payload->>'credential_other'),''),
      school_name=nullif(btrim(p_payload->>'school_name'),''),school_code=nullif(btrim(p_payload->>'school_code'),''),
      school_address=nullif(btrim(p_payload->>'school_address'),''),pept_rating=nullif(btrim(p_payload->>'pept_rating'),''),
      examined_on=nullif(p_payload->>'examined_on','')::date,testing_center=nullif(btrim(p_payload->>'testing_center'),''),
      remark=nullif(btrim(p_payload->>'remark'),''),source=btrim(p_payload->>'source') where id=prior.id returning * into result;
  else
    if p_version is distinct from 0 then raise exception using errcode='P0003',message='This history changed while you were editing'; end if;
    insert into edunexus.learner_eligibility(learner_id,credential,credential_other,school_name,school_code,school_address,pept_rating,examined_on,testing_center,remark,source)
      values(l.id,cred,nullif(btrim(p_payload->>'credential_other'),''),nullif(btrim(p_payload->>'school_name'),''),nullif(btrim(p_payload->>'school_code'),''),
        nullif(btrim(p_payload->>'school_address'),''),nullif(btrim(p_payload->>'pept_rating'),''),nullif(p_payload->>'examined_on','')::date,
        nullif(btrim(p_payload->>'testing_center'),''),nullif(btrim(p_payload->>'remark'),''),btrim(p_payload->>'source')) returning * into result;
  end if;
  after:=edunexus.eligibility_snapshot(l.id);
  if before is not null and before-'version'=after-'version' then raise exception using errcode='P2506',message='Nothing has changed'; end if;
  insert into edunexus.learner_prior_record_events(learner_id,prior_year_id,kind,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(l.id,null,'eligibility',case when prior.id is null then 'create' else 'update' end,before,after,btrim(p_reason),
      edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return after;
end $$;

-- Everything the encoding screen needs for one learner: who they are, the
-- credential, the blocks already encoded, and the school years EDUNEXUS holds
-- itself -- those last so the screen can show one continuous history and say
-- which years are not its to encode, rather than refusing a save to explain it.
create function edunexus.read_learner_prior_records(p_learner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l edunexus.learners;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select retained.* into l from edunexus.learners original join edunexus.learners retained on retained.id=coalesce(original.merged_into,original.id) where original.id=p_learner;
  if not found or not edunexus.can_read_learner(l.id) then raise exception using errcode='P0002',message='Learner not found'; end if;
  return jsonb_build_object(
    'learner',jsonb_build_object('id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,'name_extension',l.name_extension,
      'sex',l.sex,'lrn',l.lrn,'birth_date',l.birth_date,'version',l.version),
    'may_write',edunexus.may_write_prior_records(l.id) and l.merged_into is null,
    'school',edunexus.form_school_heading(),
    'eligibility',edunexus.eligibility_snapshot(l.id),
    'prior_years',(select coalesce(jsonb_agg(edunexus.prior_year_snapshot(y.id) order by y.start_year),'[]'::jsonb)
      from edunexus.learner_prior_years y where y.learner_id=l.id),
    'recorded_years',(select coalesce(jsonb_agg(jsonb_build_object('academic_year_id',y.id,'start_year',y.start_year,'grade_level',e.grade_level,
        'section_name',s.name,'status',e.status) order by y.start_year),'[]'::jsonb)
      from edunexus.enrollments e join edunexus.academic_years y on y.id=e.academic_year_id
      left join edunexus.sections s on s.id=e.section_id
      where e.record_state='valid' and e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=l.id) and edunexus.can_read_enrollment(e.id)));
end $$;

-- The SF10 gains the encoded history and the eligibility credential, and loses a
-- bug: the enrollment join to `sections` was inner, so since 0048 made
-- `section_id` nullable a learner enrolled at a grade but not yet in a class
-- dropped off their own permanent record without a word. It is outward now.
create or replace function edunexus.read_sf10_source(p_learner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l edunexus.learners;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select retained.* into l from edunexus.learners original join edunexus.learners retained on retained.id=coalesce(original.merged_into,original.id) where original.id=p_learner;
  if not found or not edunexus.can_read_learner(l.id) then raise exception using errcode='P0002',message='Learner not found'; end if;
  return jsonb_build_object('school',edunexus.form_school_heading(),
    'learner',jsonb_build_object('id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,'name_extension',l.name_extension,
      'sex',l.sex,'lrn',l.lrn,'birth_date',l.birth_date),
    'eligibility',edunexus.eligibility_snapshot(l.id),
    'prior_years',(select coalesce(jsonb_agg(edunexus.prior_year_snapshot(y.id) order by y.start_year),'[]'::jsonb)
      from edunexus.learner_prior_years y where y.learner_id=l.id),
    'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'grade_level',e.grade_level,'status',e.status,'section_name',s.name,
        'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id),
        'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on),
        'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'name',p.name) order by p.ordinal),'[]'::jsonb) from edunexus.reporting_periods p where p.academic_year_id=y.id),
        'offerings',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'display_order',o.display_order,'code',o.subject_snapshot->>'code','name',o.subject_snapshot->>'name')
          order by o.display_order,o.subject_snapshot->>'name'),'[]'::jsonb) from edunexus.section_subjects o
          where (o.section_id=e.section_id and o.active) or o.id in (select offering_id from edunexus.report_grades where enrollment_id=e.id)),
        'grades',(select coalesce(jsonb_agg(jsonb_build_object('offering_id',offering_id,'reporting_period_id',reporting_period_id,'grade',grade,'remark',remark)),'[]'::jsonb)
          from edunexus.report_grades where enrollment_id=e.id),
        'summary',(select jsonb_build_object('general_average',general_average,'remark',remark) from edunexus.report_summaries where enrollment_id=e.id),
        'promotion',(select jsonb_build_object('action',action) from edunexus.promotion_decisions where enrollment_id=e.id and status='approved' and action is not null))
      order by y.start_year,e.id),'[]'::jsonb)
      from edunexus.enrollments e left join edunexus.sections s on s.id=e.section_id join edunexus.academic_years y on y.id=e.academic_year_id
      where e.record_state='valid' and e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=l.id) and edunexus.can_read_enrollment(e.id)));
end $$;

-- Encoded history names a learner, so reading and writing it is logged like
-- every other read that does.
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
  'priorRecordsGet','priorRecordsWrite','priorRecordHistory'
));

revoke all on function edunexus.may_write_prior_records(uuid),edunexus.prior_record_learner(uuid),edunexus.check_prior_reason(text),
  edunexus.prior_year_snapshot(uuid),edunexus.eligibility_snapshot(uuid),edunexus.write_learner_prior_year(uuid,integer,uuid,jsonb,jsonb,text),
  edunexus.delete_learner_prior_year(uuid,integer,text),edunexus.write_learner_eligibility(uuid,integer,jsonb,text),
  edunexus.read_learner_prior_records(uuid) from public;
grant execute on function edunexus.write_learner_prior_year(uuid,integer,uuid,jsonb,jsonb,text),edunexus.delete_learner_prior_year(uuid,integer,text),
  edunexus.write_learner_eligibility(uuid,integer,jsonb,text),edunexus.read_learner_prior_records(uuid),edunexus.may_write_prior_records(uuid) to edunexus_app;
