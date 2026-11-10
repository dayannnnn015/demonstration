-- Section 4A.4: reviewed immutable adoption of an exact assessment-draft revision.
-- Adoption records a school decision. It binds nothing and computes nothing.
create table edunexus.assessment_policy_adoptions (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references edunexus.academic_years(id) on delete restrict,
  policy_id uuid not null references edunexus.assessment_policy_drafts(id) on delete restrict,
  policy_version integer not null check(policy_version>=1),
  policy_snapshot jsonb not null check(jsonb_typeof(policy_snapshot)='object'),
  grade_levels integer[] not null check(cardinality(grade_levels) between 1 and 6 and grade_levels <@ array[1,2,3,4,5,6] and array_position(grade_levels,null) is null),
  adopted_on date not null,
  adoption_reference text not null check(length(btrim(adoption_reference)) between 10 and 500 and adoption_reference !~ '[[:cntrl:]]'),
  status text not null default 'adopted' check(status in ('adopted','withdrawn')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index assessment_adoption_active_idx on edunexus.assessment_policy_adoptions(academic_year_id,policy_id) where status='adopted';
create index assessment_adoption_year_idx on edunexus.assessment_policy_adoptions(academic_year_id);
create index assessment_adoption_policy_idx on edunexus.assessment_policy_adoptions(policy_id);
create table edunexus.assessment_policy_adoption_events (
  id uuid primary key default gen_random_uuid(),adoption_id uuid not null references edunexus.assessment_policy_adoptions(id) on delete restrict,
  adoption_version integer not null check(adoption_version>=1),action text not null check(action in ('adopt','withdraw')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(adoption_id,adoption_version)
);
create index assessment_adoption_event_actor_idx on edunexus.assessment_policy_adoption_events(actor_user_id);
alter table edunexus.assessment_policy_adoptions enable row level security;
alter table edunexus.assessment_policy_adoption_events enable row level security;
create policy manager_read on edunexus.assessment_policy_adoptions for select to edunexus_app using(edunexus.is_manager());
create policy manager_read on edunexus.assessment_policy_adoption_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.assessment_policy_adoptions,edunexus.assessment_policy_adoption_events to edunexus_app;
create trigger version_record before update on edunexus.assessment_policy_adoptions for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.assessment_policy_adoptions for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.assessment_policy_adoption_events for each row execute function edunexus.audit_record();

-- The frozen snapshot is the adopted content. Nothing here reads it back into the
-- draft, so a later draft revision never changes what the school adopted.
create function edunexus.write_assessment_policy_adoption(p_id uuid,p_version integer,p_year uuid,p_policy uuid,p_policy_version integer,p_adopted_on date,p_reference text,p_reason text)
returns edunexus.assessment_policy_adoptions language plpgsql security definer set search_path='' as $$
declare prior edunexus.assessment_policy_adoptions; result edunexus.assessment_policy_adoptions; draft edunexus.assessment_policy_drafts; year edunexus.academic_years;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid adoption reason'; end if;
  if p_id is null then
    if p_version is distinct from 0 then raise exception using errcode='23514',message='Initial adoption version must be zero'; end if;
    if p_reference is null or length(btrim(p_reference)) not between 10 and 500 or p_reference ~ '[[:cntrl:]]' or p_adopted_on is null then
      raise exception using errcode='23514',message='Adoption requires an explicit school reference and date'; end if;
    select * into year from edunexus.academic_years where id=p_year for share;
    if not found then raise exception using errcode='P0002',message='School year not found'; end if;
    if year.status='closed' then raise exception using errcode='P1301',message='Closed school years cannot adopt a policy'; end if;
    if p_adopted_on<year.starts_on or p_adopted_on>year.ends_on then raise exception using errcode='P1301',message='Adoption date must fall inside the school year'; end if;
    select * into draft from edunexus.assessment_policy_drafts where id=p_policy;
    if not found then raise exception using errcode='P0002',message='Policy draft not found'; end if;
    if p_policy_version is distinct from draft.version then raise exception using errcode='P0003',message='Policy draft changed'; end if;
    if draft.status<>'draft' then raise exception using errcode='P1300',message='Only a current unarchived draft revision can be adopted'; end if;
    insert into edunexus.assessment_policy_adoptions(academic_year_id,policy_id,policy_version,policy_snapshot,grade_levels,adopted_on,adoption_reference)
      values(year.id,draft.id,draft.version,to_jsonb(draft)-'created_at'-'updated_at',draft.grade_levels,p_adopted_on,btrim(p_reference)) returning * into result;
  else
    if p_reference is not null or p_adopted_on is not null or p_policy_version is not null then raise exception using errcode='23514',message='Withdrawal reviews only the current adoption version'; end if;
    select * into prior from edunexus.assessment_policy_adoptions where id=p_id;
    if not found then raise exception using errcode='P0002',message='Adoption not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Adoption changed'; end if;
    if prior.status<>'adopted' then raise exception using errcode='P1300',message='This adoption was already withdrawn'; end if;
    select * into year from edunexus.academic_years where id=prior.academic_year_id for share;
    if year.status='closed' then raise exception using errcode='P1301',message='Closed school years cannot change an adoption'; end if;
    update edunexus.assessment_policy_adoptions set status='withdrawn' where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_policy_adoption_events(adoption_id,adoption_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'adopt' else 'withdraw' end,case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.adopt_assessment_policy(p_year uuid,p_policy uuid,p_policy_version integer,p_adopted_on date,p_reference text,p_reason text)
returns edunexus.assessment_policy_adoptions language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_policy_adoption(null,0,p_year,p_policy,p_policy_version,p_adopted_on,p_reference,p_reason); end $$;
create function edunexus.withdraw_assessment_policy_adoption(p_id uuid,p_version integer,p_reason text)
returns edunexus.assessment_policy_adoptions language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_policy_adoption(p_id,p_version,null,null,null,null,null,p_reason); end $$;
revoke all on function edunexus.write_assessment_policy_adoption(uuid,integer,uuid,uuid,integer,date,text,text),
  edunexus.adopt_assessment_policy(uuid,uuid,integer,date,text,text),edunexus.withdraw_assessment_policy_adoption(uuid,integer,text) from public;
grant execute on function edunexus.adopt_assessment_policy(uuid,uuid,integer,date,text,text),edunexus.withdraw_assessment_policy_adoption(uuid,integer,text) to edunexus_app;

-- Archiving retires a proposal. Keep it consistent with a standing school decision:
-- withdraw the adoption first. Ordinary revisions stay allowed and never reach the
-- frozen snapshot. Replaces the Section 4A.3 writer without altering migration 0017.
create or replace function edunexus.write_assessment_policy_draft(p_id uuid,p_version integer,p_code text,p_name text,p_source text,p_grades integer[],p_components jsonb,p_status text,p_reason text)
returns edunexus.assessment_policy_drafts language plpgsql security definer set search_path='' as $$
declare prior edunexus.assessment_policy_drafts; result edunexus.assessment_policy_drafts; grades integer[]; normalized_components jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid policy change reason'; end if;
  if p_name is null or p_source is null or p_status is null or p_grades is null or array_ndims(p_grades) is distinct from 1
    or cardinality(p_grades) not between 1 and 6 or array_position(p_grades,null) is not null or not p_grades <@ array[1,2,3,4,5,6] then
    raise exception using errcode='23514',message='Weighted drafts require explicit Grades 1 to 6 applicability'; end if;
  select array_agg(distinct value order by value) into grades from unnest(p_grades) value;
  if cardinality(grades)<>cardinality(p_grades) then raise exception using errcode='23514',message='Grade levels must be distinct'; end if;
  normalized_components:=edunexus.normalize_policy_components(p_components);
  if p_id is null then
    if p_version is distinct from 0 or p_code is null then raise exception using errcode='23514',message='Policy code required'; end if;
    insert into edunexus.assessment_policy_drafts(code,name,source_reference,grade_levels,components,status)
      values(upper(btrim(p_code)),btrim(p_name),btrim(p_source),grades,normalized_components,p_status) returning * into result;
  else
    select * into prior from edunexus.assessment_policy_drafts where id=p_id;
    if not found then raise exception using errcode='P0002',message='Policy draft not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Policy draft changed'; end if;
    if p_code is not null then raise exception using errcode='23514',message='Policy codes are immutable'; end if;
    if row(prior.name,prior.source_reference,prior.grade_levels,prior.components,prior.status) is not distinct from row(btrim(p_name),btrim(p_source),grades,normalized_components,p_status) then
      raise exception using errcode='P1200',message='Policy draft proposal has no changes'; end if;
    if p_status='archived' and prior.status<>'archived' and exists(select 1 from edunexus.assessment_policy_adoptions where policy_id=p_id and status='adopted') then
      raise exception using errcode='P1302',message='Withdraw the standing adoption before archiving this draft'; end if;
    update edunexus.assessment_policy_drafts set name=btrim(p_name),source_reference=btrim(p_source),grade_levels=grades,components=normalized_components,status=p_status where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_policy_draft_events(policy_id,policy_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
revoke all on function edunexus.write_assessment_policy_draft(uuid,integer,text,text,text,integer[],jsonb,text,text) from public;
