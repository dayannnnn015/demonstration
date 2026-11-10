-- Section 4A.5: record which section subject offerings an adopted revision governs.
-- Binding still computes nothing; it only states where an adopted policy applies.
create table edunexus.assessment_policy_bindings (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references edunexus.section_subjects(id) on delete restrict,
  adoption_id uuid not null references edunexus.assessment_policy_adoptions(id) on delete restrict,
  section_id uuid not null,academic_year_id uuid not null,
  status text not null default 'bound' check(status in ('bound','released')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict
);
create unique index assessment_binding_active_idx on edunexus.assessment_policy_bindings(offering_id) where status='bound';
create index assessment_binding_adoption_idx on edunexus.assessment_policy_bindings(adoption_id);
create index assessment_binding_year_idx on edunexus.assessment_policy_bindings(academic_year_id);
create index assessment_binding_section_idx on edunexus.assessment_policy_bindings(section_id);
create table edunexus.assessment_policy_binding_events (
  id uuid primary key default gen_random_uuid(),binding_id uuid not null references edunexus.assessment_policy_bindings(id) on delete restrict,
  binding_version integer not null check(binding_version>=1),action text not null check(action in ('bind','release')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(binding_id,binding_version)
);
create index assessment_binding_event_actor_idx on edunexus.assessment_policy_binding_events(actor_user_id);
alter table edunexus.assessment_policy_bindings enable row level security;
alter table edunexus.assessment_policy_binding_events enable row level security;
create policy manager_read on edunexus.assessment_policy_bindings for select to edunexus_app using(edunexus.is_manager());
create policy manager_read on edunexus.assessment_policy_binding_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.assessment_policy_bindings,edunexus.assessment_policy_binding_events to edunexus_app;
create trigger version_record before update on edunexus.assessment_policy_bindings for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.assessment_policy_bindings for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.assessment_policy_binding_events for each row execute function edunexus.audit_record();

create function edunexus.write_assessment_policy_binding(p_id uuid,p_version integer,p_offering uuid,p_offering_version integer,p_adoption uuid,p_adoption_version integer,p_reason text)
returns edunexus.assessment_policy_bindings language plpgsql security definer set search_path='' as $$
declare prior edunexus.assessment_policy_bindings; result edunexus.assessment_policy_bindings; offering edunexus.section_subjects;
  adoption edunexus.assessment_policy_adoptions; section edunexus.sections; year edunexus.academic_years;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid binding reason'; end if;
  if p_id is null then
    if p_version is distinct from 0 then raise exception using errcode='23514',message='Initial binding version must be zero'; end if;
    select * into offering from edunexus.section_subjects where id=p_offering;
    if not found then raise exception using errcode='P0002',message='Offering not found'; end if;
    if p_offering_version is distinct from offering.version then raise exception using errcode='P0003',message='Offering changed'; end if;
    select * into adoption from edunexus.assessment_policy_adoptions where id=p_adoption;
    if not found then raise exception using errcode='P0002',message='Adoption not found'; end if;
    if p_adoption_version is distinct from adoption.version then raise exception using errcode='P0003',message='Adoption changed'; end if;
    if adoption.status<>'adopted' then raise exception using errcode='P1400',message='Only a standing adoption can govern an offering'; end if;
    select * into year from edunexus.academic_years where id=offering.academic_year_id for share;
    if year.status='closed' then raise exception using errcode='P1100',message='Closed-year offerings are read only'; end if;
    if adoption.academic_year_id<>offering.academic_year_id then raise exception using errcode='P1401',message='The adoption and offering must share one school year'; end if;
    if not offering.active then raise exception using errcode='P1401',message='Reactivate the offering before binding a policy to it'; end if;
    select * into section from edunexus.sections where id=offering.section_id;
    if not section.grade_level=any(adoption.grade_levels) then raise exception using errcode='P1401',message='The adopted revision does not apply to this section grade'; end if;
    insert into edunexus.assessment_policy_bindings(offering_id,adoption_id,section_id,academic_year_id)
      values(offering.id,adoption.id,offering.section_id,offering.academic_year_id) returning * into result;
  else
    if p_offering is not null or p_adoption is not null or p_offering_version is not null or p_adoption_version is not null then
      raise exception using errcode='23514',message='Release reviews only the current binding version'; end if;
    select * into prior from edunexus.assessment_policy_bindings where id=p_id;
    if not found then raise exception using errcode='P0002',message='Binding not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Binding changed'; end if;
    if prior.status<>'bound' then raise exception using errcode='P1400',message='This binding was already released'; end if;
    select * into year from edunexus.academic_years where id=prior.academic_year_id for share;
    if year.status='closed' then raise exception using errcode='P1100',message='Closed-year offerings are read only'; end if;
    update edunexus.assessment_policy_bindings set status='released' where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_policy_binding_events(binding_id,binding_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'bind' else 'release' end,case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.bind_assessment_policy(p_offering uuid,p_offering_version integer,p_adoption uuid,p_adoption_version integer,p_reason text)
returns edunexus.assessment_policy_bindings language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_policy_binding(null,0,p_offering,p_offering_version,p_adoption,p_adoption_version,p_reason); end $$;
create function edunexus.release_assessment_policy_binding(p_id uuid,p_version integer,p_reason text)
returns edunexus.assessment_policy_bindings language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_policy_binding(p_id,p_version,null,null,null,null,p_reason); end $$;
revoke all on function edunexus.write_assessment_policy_binding(uuid,integer,uuid,integer,uuid,integer,text),
  edunexus.bind_assessment_policy(uuid,integer,uuid,integer,text),edunexus.release_assessment_policy_binding(uuid,integer,text) from public;
grant execute on function edunexus.bind_assessment_policy(uuid,integer,uuid,integer,text),edunexus.release_assessment_policy_binding(uuid,integer,text) to edunexus_app;

-- A standing binding is a live statement that an adopted revision governs an
-- offering. Withdrawing the adoption or retiring the offering underneath it would
-- leave that statement dangling, so both require releasing the binding first.
-- Replaces the Section 4A.4 and 4A.2 writers without altering migrations 0016-0018.
create or replace function edunexus.write_assessment_policy_adoption(p_id uuid,p_version integer,p_year uuid,p_policy uuid,p_policy_version integer,p_adopted_on date,p_reference text,p_reason text)
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
    if exists(select 1 from edunexus.assessment_policy_bindings where adoption_id=p_id and status='bound') then
      raise exception using errcode='P1402',message='Release the subject bindings before withdrawing this adoption'; end if;
    update edunexus.assessment_policy_adoptions set status='withdrawn' where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_policy_adoption_events(adoption_id,adoption_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'adopt' else 'withdraw' end,case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
revoke all on function edunexus.write_assessment_policy_adoption(uuid,integer,uuid,uuid,integer,date,text,text) from public;

create or replace function edunexus.write_section_subject(p_id uuid,p_section uuid,p_subject uuid,p_version integer,p_subject_version integer,p_active boolean,p_order integer,p_refresh boolean,p_reason text)
returns edunexus.section_subjects language plpgsql security definer set search_path='' as $$
declare prior edunexus.section_subjects; result edunexus.section_subjects; subject edunexus.subjects; context jsonb; snapshot jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' or p_active is null or p_refresh is null or p_order is null or p_order not between 1 and 999 then
    raise exception using errcode='23514',message='Invalid offering proposal'; end if;
  if p_id is not null then
    select * into prior from edunexus.section_subjects where id=p_id;
    if not found then raise exception using errcode='P0002',message='Offering not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Offering changed'; end if;
    p_section:=prior.section_id;p_subject:=prior.subject_id;snapshot:=prior.subject_snapshot;
  elsif p_version is distinct from 0 then raise exception using errcode='23514',message='Initial offering version must be zero'; end if;
  context:=edunexus.section_subject_context(p_section);
  if context->'school_year'->>'status'='closed' then raise exception using errcode='P1100',message='Closed-year offerings are read only'; end if;
  select * into subject from edunexus.subjects where id=p_subject;
  if not found then raise exception using errcode='23503',message='Subject not found'; end if;
  if p_id is null or p_refresh then
    if p_id is not null and context->'school_year'->>'status'<>'draft' then raise exception using errcode='P1102',message='Subject snapshots can only be refreshed in a draft year'; end if;
    if p_subject_version is distinct from subject.version then raise exception using errcode='P0003',message='Catalog subject changed'; end if;
    if not subject.active or not (context->'section'->>'grade_level')::integer=any(subject.grade_levels) then raise exception using errcode='P1101',message='Choose an active subject applicable to the section grade'; end if;
    snapshot:=to_jsonb(subject)-'created_at'-'updated_at';
  elsif p_subject_version is not null then raise exception using errcode='23514',message='Subject version is only supplied for explicit refresh'; end if;
  if p_id is not null and p_active and not prior.active and not subject.active then raise exception using errcode='P1101',message='An archived subject cannot be reactivated'; end if;
  if p_id is null then
    insert into edunexus.section_subjects(section_id,academic_year_id,subject_id,subject_snapshot,active,display_order)
      values(p_section,(context->'school_year'->>'id')::uuid,p_subject,snapshot,p_active,p_order) returning * into result;
  else
    if row(prior.active,prior.display_order,prior.subject_snapshot) is not distinct from row(p_active,p_order,snapshot) then raise exception using errcode='P1103',message='Offering proposal has no changes'; end if;
    if prior.active and not p_active and exists(select 1 from edunexus.assessment_policy_bindings where offering_id=p_id and status='bound') then
      raise exception using errcode='P1403',message='Release the assessment-policy binding before retiring this offering'; end if;
    update edunexus.section_subjects set active=p_active,display_order=p_order,subject_snapshot=snapshot where id=p_id returning * into result;
  end if;
  insert into edunexus.section_subject_events(offering_id,offering_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' when p_refresh then 'refresh' else 'update' end,
      case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
revoke all on function edunexus.write_section_subject(uuid,uuid,uuid,integer,integer,boolean,integer,boolean,text) from public;
