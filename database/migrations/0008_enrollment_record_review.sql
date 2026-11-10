-- Section 2B.4: reviewed void/restoration of erroneous annual records.
-- Voiding is an administrative record correction, never a learner withdrawal.
alter table edunexus.enrollments add column record_state text not null default 'valid' check(record_state in ('valid','voided'));
alter table edunexus.enrollments drop constraint enrollments_learner_id_academic_year_id_key;
create unique index enrollments_valid_learner_year_idx on edunexus.enrollments(learner_id,academic_year_id) where record_state='valid';
-- Retain an index for original ownership, including voided history and FK checks.
create index enrollments_original_learner_idx on edunexus.enrollments(learner_id,id);

create table edunexus.enrollment_record_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  enrollment_version integer not null check(enrollment_version>=2),
  action text not null check(action in ('void','restore')),
  reason_code text not null check(reason_code in ('duplicate_record','incorrect_entry','restoration')),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  replacement_enrollment_id uuid references edunexus.enrollments(id) on delete restrict,
  review_snapshot jsonb not null check(jsonb_typeof(review_snapshot)='object'),
  review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  transaction_id text not null default txid_current()::text,
  unique(enrollment_id,enrollment_version),
  check(replacement_enrollment_id is distinct from enrollment_id),
  check((action='void' and reason_code='duplicate_record' and replacement_enrollment_id is not null)
    or (action='void' and reason_code='incorrect_entry' and replacement_enrollment_id is null)
    or (action='restore' and reason_code='restoration' and replacement_enrollment_id is null))
);
create index enrollment_record_events_replacement_idx on edunexus.enrollment_record_events(replacement_enrollment_id) where replacement_enrollment_id is not null;
create index enrollment_record_events_actor_idx on edunexus.enrollment_record_events(actor_user_id);
alter table edunexus.enrollment_record_events enable row level security;
create policy enrollment_record_events_read on edunexus.enrollment_record_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.enrollment_record_events to edunexus_app;
create trigger audit_record after insert on edunexus.enrollment_record_events for each row execute function edunexus.audit_record();

create function edunexus.guard_enrollment_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.record_state<>'valid' then raise exception using errcode='42501',message='Create a valid record first'; end if;
  elsif new.record_state<>old.record_state then
    if not exists(select 1 from edunexus.enrollment_record_events where enrollment_id=old.id
      and enrollment_version=old.version+1 and transaction_id=txid_current()::text and actor_user_id=edunexus.actor_id()
      and action=case when new.record_state='voided' then 'void' else 'restore' end)
      or (to_jsonb(new)-'record_state'-'version'-'updated_at') is distinct from (to_jsonb(old)-'record_state'-'version'-'updated_at') then
      raise exception using errcode='42501',message='Reviewed record-state command required';
    end if;
  elsif old.record_state='voided' then
    raise exception using errcode='P0301',message='Voided enrollment is read only';
  end if;
  return new;
end $$;
create trigger enrollment_record_guard before insert or update on edunexus.enrollments for each row execute function edunexus.guard_enrollment_record();

create function edunexus.preview_enrollment_record(p_id uuid,p_version integer,p_action text,p_code text,p_reason text,p_replacement uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; r edunexus.enrollments; y edunexus.academic_years;
  l edunexus.learners; original edunexus.learners; rl edunexus.learners; ro edunexus.learners;
  plan jsonb; related jsonb; replacement jsonb:='null'; problems text[]:='{}'; dependents uuid[]; members uuid[];
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_action is null or p_code is null or p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]'
    or not ((p_action='void' and p_code='duplicate_record' and p_replacement is not null)
      or (p_action='void' and p_code='incorrect_entry' and p_replacement is null)
      or (p_action='restore' and p_code='restoration' and p_replacement is null)) then
    raise exception using errcode='23514',message='Invalid enrollment record review';
  end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  select * into original from edunexus.learners where id=e.learner_id;
  select * into l from edunexus.learners where id=coalesce(original.merged_into,original.id);
  select array_agg(id order by id) into members from edunexus.learners where id=l.id or merged_into=l.id;
  perform 1 from edunexus.learners where id=any(members) order by id for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment changed'; end if;
  if y.status='closed' then problems:=array_append(problems,'YEAR_CLOSED'); end if;
  if (p_action='void' and e.record_state<>'valid') or (p_action='restore' and e.record_state<>'voided') then
    problems:=array_append(problems,'RECORD_STATE_UNCHANGED');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'record_state',record_state,'recorded_learner_id',learner_id) order by id),'[]') into related
    from edunexus.enrollments where academic_year_id=e.academic_year_id and learner_id=any(members);
  -- A voided record is frozen at the version of its latest record event.
  -- Start with the indexed replacement reference instead of scanning histories.
  select coalesce(array_agg(v.id order by v.id),'{}') into dependents from edunexus.enrollment_record_events latest
    join edunexus.enrollments v on v.id=latest.enrollment_id and v.version=latest.enrollment_version
    where v.record_state='voided' and latest.replacement_enrollment_id=e.id;
  if p_action='void' and cardinality(dependents)>0 then problems:=array_append(problems,'REPLACEMENT_IN_USE'); end if;
  if p_action='restore' then
    if exists(select 1 from edunexus.enrollments where id<>e.id and academic_year_id=e.academic_year_id and learner_id=any(members) and record_state='valid') then
      problems:=array_append(problems,'ANNUAL_ENROLLMENT_EXISTS');
    end if;
    if e.enrolled_on<=l.birth_date then problems:=array_append(problems,'BIRTH_DATE_CONFLICT'); end if;
  end if;
  if p_replacement is not null then
    select * into r from edunexus.enrollments where id=p_replacement;
    if not found then raise exception using errcode='P0002',message='Replacement enrollment not found'; end if;
    if r.id=e.id or r.academic_year_id<>e.academic_year_id or r.record_state<>'valid' then
      problems:=array_append(problems,'INVALID_REPLACEMENT');
    end if;
    select * into ro from edunexus.learners where id=r.learner_id;
    select * into rl from edunexus.learners where id=coalesce(ro.merged_into,ro.id);
    if l.birth_date<>rl.birth_date or l.sex<>rl.sex or (l.lrn is not null and rl.lrn is not null and l.lrn<>rl.lrn) then
      problems:=array_append(problems,'REPLACEMENT_IDENTITY_CONFLICT');
    end if;
    replacement:=jsonb_build_object('enrollment',to_jsonb(r)-'created_at'-'updated_at','learner',to_jsonb(rl)-'created_at'-'updated_at',
      'recorded_learner',to_jsonb(ro)-'created_at'-'updated_at','timeline',edunexus.resolve_enrollment_timeline(r.id));
  end if;
  plan:=jsonb_build_object('enrollment',to_jsonb(e)-'created_at'-'updated_at','learner',to_jsonb(l)-'created_at'-'updated_at',
    'recorded_learner',to_jsonb(original)-'created_at'-'updated_at','timeline',edunexus.resolve_enrollment_timeline(e.id),
    'school_year',to_jsonb(y)-'created_at'-'updated_at','related_enrollments',related,'dependent_enrollment_ids',dependents,
    'replacement',replacement,'action',p_action,'reason_code',p_code,'reason',btrim(p_reason),'replacement_enrollment_id',p_replacement,
    'actor_user_id',edunexus.actor_id(),'issues',problems,'can_commit',cardinality(problems)=0);
  return plan || jsonb_build_object('review_hash',case when cardinality(problems)=0 then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;

create function edunexus.review_enrollment_record(p_id uuid,p_version integer,p_action text,p_code text,p_reason text,p_replacement uuid,p_hash text)
returns edunexus.enrollment_record_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; result edunexus.enrollment_record_events;
begin
  plan:=edunexus.preview_enrollment_record(p_id,p_version,p_action,p_code,p_reason,p_replacement);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0300',message='Resolve enrollment record conflicts first'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0302',message='Enrollment record review changed'; end if;
  insert into edunexus.enrollment_record_events(enrollment_id,enrollment_version,action,reason_code,reason,replacement_enrollment_id,review_snapshot,review_hash,actor_user_id,request_id)
  values(p_id,p_version+1,p_action,p_code,btrim(p_reason),p_replacement,plan-'review_hash',p_hash,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  update edunexus.enrollments set record_state=case when p_action='void' then 'voided' else 'valid' end where id=p_id;
  return result;
end $$;

create or replace function edunexus.guard_enrollment_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare original edunexus.learners; canonical edunexus.learners; check_unique boolean:=false;
begin
  perform pg_advisory_xact_lock(82412001);
  select * into original from edunexus.learners where id=new.learner_id;
  select * into canonical from edunexus.learners where id=coalesce(original.merged_into,original.id);
  if tg_op='INSERT' then
    if original.merged_into is not null then raise exception using errcode='P0201',message='Enroll the retained learner'; end if;
    check_unique:=true;
  else
    if new.learner_id<>old.learner_id then raise exception using errcode='23514',message='Original enrollment identity is immutable'; end if;
    check_unique:=old.record_state='voided' and new.record_state='valid';
  end if;
  if check_unique and exists(select 1 from edunexus.enrollments e join edunexus.learners l on l.id=e.learner_id
    where e.id<>new.id and coalesce(l.merged_into,l.id)=canonical.id and e.academic_year_id=new.academic_year_id and e.record_state='valid') then
    raise exception using errcode='23505',message='Identity already has a valid enrollment in this year';
  end if;
  if new.record_state='valid' and new.enrolled_on<=canonical.birth_date then raise exception using errcode='23514',message='Enrollment must follow canonical birth date'; end if;
  return new;
end $$;

create or replace function edunexus.can_read_enrollment(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.is_manager() or (edunexus.actor_role()='teacher' and exists(
    select 1 from edunexus.enrollments e join edunexus.sections s on s.id=e.section_id join edunexus.academic_years y on y.id=e.academic_year_id
    where e.id=p_id and e.record_state='valid' and e.status='enrolled' and y.status<>'closed' and s.adviser_user_id=edunexus.actor_id()
  ))
$$;

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory'
));
revoke all on function edunexus.guard_enrollment_record(),edunexus.preview_enrollment_record(uuid,integer,text,text,text,uuid),
  edunexus.review_enrollment_record(uuid,integer,text,text,text,uuid,text) from public;
grant execute on function edunexus.preview_enrollment_record(uuid,integer,text,text,text,uuid),
  edunexus.review_enrollment_record(uuid,integer,text,text,text,uuid,text) to edunexus_app;

-- Updated integration functions; previously applied migrations stay immutable.
create or replace function edunexus.guard_learner() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.birth_date > timezone('Asia/Manila',now())::date or new.birth_date < date '1900-01-01' then
    raise exception using errcode='23514',message='Invalid learner birth date';
  end if;
  if tg_op='UPDATE' then
    if old.lrn is not null and new.lrn is distinct from old.lrn and not exists(
      select 1 from edunexus.lrn_corrections where learner_id=old.id and learner_version=old.version+1
        and previous_lrn=old.lrn and corrected_lrn=new.lrn and transaction_id=txid_current()::text
        and actor_user_id=edunexus.actor_id()
    ) then raise exception using errcode='23514',message='Assigned LRN requires a reviewed correction'; end if;
    if exists(select 1 from edunexus.enrollments where record_state='valid' and learner_id=old.id and enrolled_on<=new.birth_date) then
      raise exception using errcode='23514',message='Birth date must precede enrollment';
    end if;
  end if;
  return new;
end $$;

create or replace function edunexus.guard_learner_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare intent edunexus.learner_identity_events;
begin
  if new.merged_into is distinct from old.merged_into or new.identity_revision<>old.identity_revision then
    select * into intent from edunexus.learner_identity_events where transaction_id=txid_current()::text and actor_user_id=edunexus.actor_id()
      and ((canonical_id=old.id and canonical_version=old.version+1) or (duplicate_id=old.id and duplicate_version=old.version+1));
    if not found or new.identity_revision<>old.identity_revision+1
      or (intent.canonical_id=old.id and new.merged_into is not null)
      or (intent.duplicate_id=old.id and new.merged_into is distinct from case when intent.action='link' then intent.canonical_id else null::uuid end) then
      raise exception using errcode='42501',message='Reviewed identity command required';
    end if;
  elsif old.merged_into is not null then raise exception using errcode='P0201',message='Linked profile is read only'; end if;
  if new.merged_into is null and exists(select 1 from edunexus.enrollments e join edunexus.learners l on l.id=e.learner_id
    where (l.id=new.id or l.merged_into=new.id) and e.record_state='valid' and e.enrolled_on<=new.birth_date) then
    raise exception using errcode='23514',message='Birth date must precede every linked enrollment';
  end if;
  return new;
end $$;

create or replace function edunexus.preview_learner_identity(p_canonical uuid,p_duplicate uuid,p_cv integer,p_dv integer,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c edunexus.learners; d edunexus.learners; members uuid[]; enrollment_rows jsonb; year_rows jsonb; plan jsonb;
  problems text[]:='{}'; conflicts uuid[]; yid uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_canonical is null or p_duplicate is null or p_canonical=p_duplicate or p_action is null or p_action not in ('link','unlink')
    or p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode='23514',message='Invalid reconciliation request';
  end if;
  select array_agg(id order by id) into members from edunexus.learners where id in (p_canonical,p_duplicate) or merged_into=p_canonical or merged_into=p_duplicate;
  -- Match enrollment/timeline lock order. Closed years may be associated without
  -- changing any enrollment, original movement, or correction snapshot.
  for yid in select distinct academic_year_id from edunexus.enrollments where learner_id=any(members) order by academic_year_id loop
    perform 1 from edunexus.academic_years where id=yid for update;
  end loop;
  perform 1 from edunexus.learners where id=any(members) order by id for update;
  select * into c from edunexus.learners where id=p_canonical;
  if not found then raise exception using errcode='P0002',message='Learner not found'; end if;
  select * into d from edunexus.learners where id=p_duplicate;
  if not found then raise exception using errcode='P0002',message='Learner not found'; end if;
  if p_cv is null or p_dv is null or c.version<>p_cv or d.version<>p_dv then raise exception using errcode='P0003',message='Learner changed'; end if;
  if c.merged_into is not null then problems:=array_append(problems,'TARGET_IS_LINKED'); end if;
  if exists(select 1 from edunexus.learners where merged_into=d.id) then problems:=array_append(problems,'SOURCE_HAS_LINKS'); end if;
  if p_action='link' then
    if d.merged_into is not null then problems:=array_append(problems,'SOURCE_IS_LINKED'); end if;
    if d.lrn is not null then problems:=array_append(problems,'SOURCE_HAS_LRN'); end if;
    if c.birth_date<>d.birth_date or c.sex<>d.sex then problems:=array_append(problems,'IDENTITY_FIELDS_DIFFER'); end if;
    select array_agg(academic_year_id order by academic_year_id) into conflicts from (
      select academic_year_id from edunexus.enrollments where record_state='valid' and learner_id=any(members) group by academic_year_id having count(*)>1
    ) overlapping_years;
    if cardinality(conflicts)>0 then problems:=array_append(problems,'OVERLAPPING_ENROLLMENT_YEARS'); end if;
    if exists(select 1 from edunexus.enrollments where record_state='valid' and learner_id=any(members) and enrolled_on<=c.birth_date) then problems:=array_append(problems,'BIRTH_DATE_CONFLICT'); end if;
  else
    if d.merged_into is distinct from c.id then problems:=array_append(problems,'LINK_NOT_FOUND'); end if;
    if exists(select 1 from edunexus.enrollments where record_state='valid' and learner_id=d.id and enrolled_on<=d.birth_date) then problems:=array_append(problems,'BIRTH_DATE_CONFLICT'); end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'recorded_learner_id',learner_id,'academic_year_id',academic_year_id,
    'record_state',record_state,'grade_level',grade_level,'section_id',section_id,'status',status,'enrolled_on',enrolled_on,'effective_on',effective_on,'version',version) order by academic_year_id,id),'[]')
    into enrollment_rows from edunexus.enrollments where learner_id=any(members);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'start_year',start_year,'status',status,'version',version) order by id),'[]')
    into year_rows from edunexus.academic_years where id in (select academic_year_id from edunexus.enrollments where learner_id=any(members));
  -- Profile snapshots deliberately exclude timestamps for stable serialization.
  plan:=jsonb_build_object('canonical',to_jsonb(c)-'created_at'-'updated_at','duplicate',to_jsonb(d)-'created_at'-'updated_at',
    'action',p_action,'reason',btrim(p_reason),'actor_user_id',edunexus.actor_id(),'member_ids',members,
    'enrollments',enrollment_rows,'school_years',year_rows,'issues',problems,'conflicting_year_ids',coalesce(conflicts,'{}'::uuid[]),'can_commit',cardinality(problems)=0);
  return plan || jsonb_build_object('review_hash',case when cardinality(problems)=0 then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;

create or replace function edunexus.get_enrollment_timeline(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments;
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  -- Keep the enrollment version and resolved entries in a single snapshot.
  select * into e from edunexus.enrollments where id=p_id for share;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  return jsonb_build_object('enrollment_id',e.id,'version',e.version,'record_state',e.record_state,'usable_for_reporting',e.record_state='valid','entries',edunexus.resolve_enrollment_timeline(e.id),
    'latest_correction_id',(select id from edunexus.enrollment_corrections where enrollment_id=e.id order by enrollment_version desc limit 1));
end $$;

create or replace function edunexus.preview_enrollment_timeline(p_id uuid,p_version integer,p_entries jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  e edunexus.enrollments; y edunexus.academic_years; l edunexus.learners; s edunexus.sections;
  item jsonb; before_rows jsonb; normalized jsonb:='[]'; context jsonb; section_context jsonb;
  d date; sid uuid; kind text; why text; current_state text; previous_date date; previous_section uuid; previous_reason text;
  n integer:=0; first_day date; first_affected date; review text;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  select * into l from edunexus.learners where id=(select coalesce(merged_into,id) from edunexus.learners where id=e.learner_id) for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment changed'; end if;
  if e.record_state='voided' then raise exception using errcode='P0301',message='Voided enrollment is read only'; end if;
  if y.status='closed' then raise exception using errcode='P0105',message='School year is closed'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode='23514',message='A review reason is required';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception using errcode='23514',message='Timeline must be an array'; end if;
  if jsonb_array_length(p_entries) not between 1 and 1000 then raise exception using errcode='23514',message='Invalid timeline size'; end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    n:=n+1;
    if jsonb_typeof(item) is distinct from 'object' then raise exception using errcode='23514',message='Invalid timeline entry'; end if;
    if not (item ?& array['event_type','effective_on','section_id','reason'])
      or (select count(*) from jsonb_object_keys(item))<>4
      or exists(select 1 from jsonb_each(item) where jsonb_typeof(value)<>'string') then
      raise exception using errcode='23514',message='Invalid timeline entry fields';
    end if;
    if (item->>'effective_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='P0100',message='Invalid date'; end if;
    begin d:=(item->>'effective_on')::date; sid:=(item->>'section_id')::uuid;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception using errcode='23514',message='Invalid date or section identifier';
    end;
    kind:=item->>'event_type'; why:=item->>'reason';
    if d<y.starts_on or d>y.ends_on or d<=l.birth_date or (n>1 and (d<=previous_date or d>timezone('Asia/Manila',now())::date)) then
      raise exception using errcode='P0100',message='Timeline dates are invalid';
    end if;
    select * into s from edunexus.sections where id=sid;
    if not found or s.academic_year_id<>e.academic_year_id or s.grade_level<>e.grade_level then
      raise exception using errcode='P0102',message='Section must match enrollment year and grade';
    end if;
    if n=1 then
      if kind<>'enrolled' or why not in ('regular','transfer_in') then raise exception using errcode='P0101',message='Timeline must start with enrollment'; end if;
      current_state:='enrolled'; first_day:=d;
    elsif kind='reassigned' then
      if current_state<>'enrolled' or sid=previous_section or why<>'section_change' then raise exception using errcode='P0101',message='Invalid reassignment'; end if;
    elsif kind='withdrawn' then
      if current_state<>'enrolled' or sid<>previous_section or why not in ('transfer_out','withdrawal','dropout','death') then raise exception using errcode='P0101',message='Invalid withdrawal'; end if;
      current_state:='withdrawn';
    elsif kind='reentered' then
      if current_state<>'withdrawn' or previous_reason='death' or why<>'return_to_school' then raise exception using errcode='P0101',message='Invalid reentry'; end if;
      current_state:='enrolled';
    else raise exception using errcode='P0101',message='Invalid transition'; end if;
    normalized:=normalized || jsonb_build_array(jsonb_build_object('event_type',kind,'effective_on',d,'section_id',sid,'reason',why));
    previous_date:=d; previous_section:=sid; previous_reason:=why;
  end loop;
  before_rows:=edunexus.resolve_enrollment_timeline(e.id);
  if before_rows=normalized then raise exception using errcode='P0103',message='Timeline is unchanged'; end if;
  select min(least((a.value->>'effective_on')::date,(b.value->>'effective_on')::date)) into first_affected
    from jsonb_array_elements(before_rows) with ordinality a(value,position)
    full join jsonb_array_elements(normalized) with ordinality b(value,position) using(position)
    where a.value is distinct from b.value;
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'adviser_user_id',adviser_user_id,'version',version) order by id) into section_context
    from edunexus.sections where id in (select (value->>'section_id')::uuid from jsonb_array_elements(before_rows || normalized));
  context:=jsonb_build_object('enrollment_id',e.id,'version',e.version,'learner_version',l.version,'learner_id',l.id,'recorded_learner_id',e.learner_id,'actor_user_id',edunexus.actor_id(),
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,'status',y.status,'version',y.version),
    'sections',section_context,'before_entries',before_rows,'after_entries',normalized,'reason',btrim(p_reason),'first_affected_on',first_affected,
    'previous_state',jsonb_build_object('enrolled_on',e.enrolled_on,'effective_on',e.effective_on,'status',e.status,'section_id',e.section_id,'last_reason',e.last_reason),
    'proposed_state',jsonb_build_object('enrolled_on',first_day,'effective_on',d,'status',current_state,'section_id',sid,'last_reason',why));
  review:=encode(sha256(convert_to(context::text,'UTF8')),'hex');
  return context || jsonb_build_object('review_hash',review);
end $$;

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
  if e.record_state='voided' then raise exception using errcode='P0301',message='Voided enrollment is read only'; end if;
  if y.status='closed' or p_date is null or p_date<=e.effective_on or p_date>y.ends_on or p_date>timezone('Asia/Manila',now())::date then
    raise exception using errcode='23514',message='Movement must advance the timeline within an open year and cannot be future dated';
  end if;
  if p_action='withdrawn' then
    if e.status<>'enrolled' or p_section is not null or p_exit_reason is null or p_exit_reason not in ('transfer_out','withdrawal','dropout','death') then
      raise exception using errcode='23514',message='Invalid withdrawal';
    end if;
    new_status:='withdrawn';reason:=p_exit_reason;p_section:=e.section_id;
  elsif p_action in ('reassigned','reentered') then
    if p_exit_reason is not null or (p_action='reassigned' and (e.status<>'enrolled' or p_section=e.section_id))
      or (p_action='reentered' and (e.status<>'withdrawn' or e.last_reason='death')) then
      raise exception using errcode='23514',message='Invalid enrollment transition';
    end if;
    select * into s from edunexus.sections where id=p_section;
    if not found or s.academic_year_id<>e.academic_year_id or s.grade_level<>e.grade_level then
      raise exception using errcode='23514',message='Target section must match enrollment year and grade';
    end if;
    new_status:='enrolled';reason:=case when p_action='reassigned' then 'section_change' else 'return_to_school' end;
  else raise exception using errcode='23514',message='Unknown enrollment transition'; end if;
  update edunexus.enrollments set section_id=p_section,status=new_status,effective_on=p_date,last_reason=reason where id=e.id returning * into e;
  return e;
end $$;

create or replace function edunexus.record_enrollment_event() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  if tg_op='UPDATE' and exists(select 1 from edunexus.enrollment_record_events where enrollment_id=new.id and enrollment_version=new.version and transaction_id=txid_current()::text and actor_user_id=edunexus.actor_id()) then return new; end if;
  -- A correction changes the projection, not the real-world movement sequence.
  -- Only an owner-written correction intent for this exact version/TX permits
  -- suppression; runtime session settings cannot suppress movement history.
  if tg_op='UPDATE' and exists(select 1 from edunexus.enrollment_corrections
    where enrollment_id=new.id and enrollment_version=new.version and transaction_id=txid_current()::text and actor_user_id=edunexus.actor_id()) then return new; end if;
  if tg_op='INSERT' then kind:='enrolled';
  elsif new.status='withdrawn' then kind:='withdrawn';
  elsif old.status='withdrawn' then kind:='reentered'; else kind:='reassigned'; end if;
  insert into edunexus.enrollment_events(enrollment_id,enrollment_version,event_type,effective_on,section_id,reason,actor_user_id,request_id)
  values(new.id,new.version,kind,new.effective_on,new.section_id,new.last_reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return new;
end $$;
