-- Reviewed identity links preserve original learner/enrollment ownership.
alter table edunexus.learners add column merged_into uuid references edunexus.learners(id) on delete restrict;
alter table edunexus.learners add column identity_revision integer not null default 0;
alter table edunexus.learners add constraint learner_not_self_linked check(merged_into is distinct from id);
create index learners_merged_into_idx on edunexus.learners(merged_into) where merged_into is not null;
create table edunexus.learner_identity_events (
  id uuid primary key default gen_random_uuid(),
  canonical_id uuid not null references edunexus.learners(id) on delete restrict,
  duplicate_id uuid not null references edunexus.learners(id) on delete restrict,
  action text not null check(action in ('link','unlink')),
  canonical_version integer not null,
  duplicate_version integer not null,
  before_canonical jsonb not null,
  before_duplicate jsonb not null,
  enrollment_ids uuid[] not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  transaction_id text not null default txid_current()::text,
  check(canonical_id<>duplicate_id),
  unique(duplicate_id,duplicate_version)
);
create index identity_events_canonical_idx on edunexus.learner_identity_events(canonical_id,recorded_at desc,id);
create index identity_events_actor_idx on edunexus.learner_identity_events(actor_user_id);
alter table edunexus.learner_identity_events enable row level security;
create policy identity_events_read on edunexus.learner_identity_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.learner_identity_events to edunexus_app;
create trigger audit_record after insert on edunexus.learner_identity_events for each row execute function edunexus.audit_record();

create function edunexus.guard_learner_identity() returns trigger language plpgsql security definer set search_path='' as $$
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
    where (l.id=new.id or l.merged_into=new.id) and e.enrolled_on<=new.birth_date) then
    raise exception using errcode='23514',message='Birth date must precede every linked enrollment';
  end if;
  return new;
end $$;
create trigger identity_learner_guard before update on edunexus.learners for each row execute function edunexus.guard_learner_identity();

create function edunexus.guard_enrollment_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare original edunexus.learners; canonical edunexus.learners;
begin
  perform pg_advisory_xact_lock(82412001);
  select * into original from edunexus.learners where id=new.learner_id;
  select * into canonical from edunexus.learners where id=coalesce(original.merged_into,original.id);
  if tg_op='INSERT' then
    if original.merged_into is not null then raise exception using errcode='P0201',message='Enroll the retained learner'; end if;
    if exists(select 1 from edunexus.enrollments e join edunexus.learners l on l.id=e.learner_id
      where coalesce(l.merged_into,l.id)=canonical.id and e.academic_year_id=new.academic_year_id) then
      raise exception using errcode='23505',message='Identity already enrolled in this year';
    end if;
  elsif new.learner_id<>old.learner_id then raise exception using errcode='23514',message='Original enrollment identity is immutable'; end if;
  if new.enrolled_on<=canonical.birth_date then raise exception using errcode='23514',message='Enrollment must follow canonical birth date'; end if;
  return new;
end $$;
create trigger enrollment_identity_guard before insert or update on edunexus.enrollments for each row execute function edunexus.guard_enrollment_identity();

create or replace function edunexus.can_read_learner(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.is_manager() or exists(select 1 from edunexus.learners c where c.id=p_id and c.merged_into is null and exists(
    select 1 from edunexus.enrollments e join edunexus.learners l on l.id=e.learner_id
    where (l.id=c.id or l.merged_into=c.id) and edunexus.can_read_enrollment(e.id)
  ))
$$;
-- Only disclose a mapping to managers or teachers with a currently visible
-- enrollment originally attached to that profile. Do not broaden roster RLS.
create function edunexus.visible_learner_identity(p_id uuid) returns uuid language sql stable security definer set search_path='' as $$
  select coalesce(l.merged_into,l.id) from edunexus.learners l where l.id=p_id and
    (edunexus.is_manager() or exists(select 1 from edunexus.enrollments e where e.learner_id=p_id and edunexus.can_read_enrollment(e.id)))
$$;

create function edunexus.preview_learner_identity(p_canonical uuid,p_duplicate uuid,p_cv integer,p_dv integer,p_action text,p_reason text)
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
      select academic_year_id from edunexus.enrollments where learner_id=any(members) group by academic_year_id having count(*)>1
    ) overlapping_years;
    if cardinality(conflicts)>0 then problems:=array_append(problems,'OVERLAPPING_ENROLLMENT_YEARS'); end if;
    if exists(select 1 from edunexus.enrollments where learner_id=any(members) and enrolled_on<=c.birth_date) then problems:=array_append(problems,'BIRTH_DATE_CONFLICT'); end if;
  else
    if d.merged_into is distinct from c.id then problems:=array_append(problems,'LINK_NOT_FOUND'); end if;
    if exists(select 1 from edunexus.enrollments where learner_id=d.id and enrolled_on<=d.birth_date) then problems:=array_append(problems,'BIRTH_DATE_CONFLICT'); end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'recorded_learner_id',learner_id,'academic_year_id',academic_year_id,
    'grade_level',grade_level,'section_id',section_id,'status',status,'enrolled_on',enrolled_on,'effective_on',effective_on,'version',version) order by academic_year_id,id),'[]')
    into enrollment_rows from edunexus.enrollments where learner_id=any(members);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'start_year',start_year,'status',status,'version',version) order by id),'[]')
    into year_rows from edunexus.academic_years where id in (select academic_year_id from edunexus.enrollments where learner_id=any(members));
  -- Profile snapshots deliberately exclude timestamps for stable serialization.
  plan:=jsonb_build_object('canonical',to_jsonb(c)-'created_at'-'updated_at','duplicate',to_jsonb(d)-'created_at'-'updated_at',
    'action',p_action,'reason',btrim(p_reason),'actor_user_id',edunexus.actor_id(),'member_ids',members,
    'enrollments',enrollment_rows,'school_years',year_rows,'issues',problems,'conflicting_year_ids',coalesce(conflicts,'{}'::uuid[]),'can_commit',cardinality(problems)=0);
  return plan || jsonb_build_object('review_hash',case when cardinality(problems)=0 then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;

create function edunexus.reconcile_learner_identity(p_canonical uuid,p_duplicate uuid,p_cv integer,p_dv integer,p_action text,p_reason text,p_hash text)
returns edunexus.learner_identity_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; result edunexus.learner_identity_events;
begin
  plan:=edunexus.preview_learner_identity(p_canonical,p_duplicate,p_cv,p_dv,p_action,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0200',message='Resolve identity conflicts first'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0202',message='Identity review changed'; end if;
  insert into edunexus.learner_identity_events(canonical_id,duplicate_id,action,canonical_version,duplicate_version,before_canonical,before_duplicate,enrollment_ids,reason,review_hash,actor_user_id,request_id)
  values(p_canonical,p_duplicate,p_action,p_cv+1,p_dv+1,plan->'canonical',plan->'duplicate',
    array(select (value->>'id')::uuid from jsonb_array_elements(plan->'enrollments')),btrim(p_reason),p_hash,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid)
    returning * into result;
  update edunexus.learners set merged_into=case when p_action='link' then p_canonical else null end,identity_revision=identity_revision+1 where id=p_duplicate;
  update edunexus.learners set identity_revision=identity_revision+1 where id=p_canonical;
  return result;
end $$;

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory'
));
revoke all on function edunexus.guard_learner_identity(),edunexus.guard_enrollment_identity(),edunexus.visible_learner_identity(uuid),
  edunexus.preview_learner_identity(uuid,uuid,integer,integer,text,text),edunexus.reconcile_learner_identity(uuid,uuid,integer,integer,text,text,text) from public;
grant execute on function edunexus.visible_learner_identity(uuid),edunexus.preview_learner_identity(uuid,uuid,integer,integer,text,text),
  edunexus.reconcile_learner_identity(uuid,uuid,integer,integer,text,text,text) to edunexus_app;

-- Bind timeline validation/review to the retained profile after reconciliation.
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
