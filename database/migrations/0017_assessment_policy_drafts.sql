-- Section 4A.3: non-operational weighted-assessment drafts. No approval or binding.
create table edunexus.assessment_policy_drafts (
  id uuid primary key default gen_random_uuid(),code text not null unique check(code ~ '^[A-Z][A-Z0-9_-]{0,23}$'),
  name text not null check(length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  source_reference text not null check(length(btrim(source_reference)) between 10 and 500 and source_reference !~ '[[:cntrl:]]'),
  grade_levels integer[] not null check(cardinality(grade_levels) between 1 and 6 and grade_levels <@ array[1,2,3,4,5,6] and array_position(grade_levels,null) is null),
  components jsonb not null check(jsonb_typeof(components)='array' and jsonb_array_length(components) between 1 and 10),
  status text not null default 'draft' check(status in ('draft','archived')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table edunexus.assessment_policy_draft_events (
  id uuid primary key default gen_random_uuid(),policy_id uuid not null references edunexus.assessment_policy_drafts(id) on delete restrict,
  policy_version integer not null check(policy_version>=1),action text not null check(action in ('create','update')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(policy_id,policy_version)
);
create index assessment_policy_event_actor_idx on edunexus.assessment_policy_draft_events(actor_user_id);
alter table edunexus.assessment_policy_drafts enable row level security;
alter table edunexus.assessment_policy_draft_events enable row level security;
create policy manager_read on edunexus.assessment_policy_drafts for select to edunexus_app using(edunexus.is_manager());
create policy manager_read on edunexus.assessment_policy_draft_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.assessment_policy_drafts,edunexus.assessment_policy_draft_events to edunexus_app;
create trigger version_record before update on edunexus.assessment_policy_drafts for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.assessment_policy_drafts for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.assessment_policy_draft_events for each row execute function edunexus.audit_record();

create function edunexus.normalize_policy_components(p_components jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare c jsonb; normalized jsonb:='[]'; code text; codes text[]:='{}'; weight numeric; total integer:=0;
begin
  if p_components is null or jsonb_typeof(p_components)<>'array' then raise exception using errcode='P1201',message='Components must be an array'; end if;
  if jsonb_array_length(p_components) not between 1 and 10 then raise exception using errcode='P1201',message='Use 1 to 10 components'; end if;
  for c in select value from jsonb_array_elements(p_components) loop
    if jsonb_typeof(c)<>'object' or c-array['code','name','weight_basis_points']<>'{}'::jsonb
      or jsonb_typeof(c->'code') is distinct from 'string' or jsonb_typeof(c->'name') is distinct from 'string'
      or jsonb_typeof(c->'weight_basis_points') is distinct from 'number' then raise exception using errcode='P1201',message='Invalid component fields'; end if;
    code:=upper(btrim(c->>'code'));weight:=(c->>'weight_basis_points')::numeric;
    if code !~ '^[A-Z][A-Z0-9_-]{0,23}$' or code=any(codes) or length(btrim(c->>'name')) not between 1 and 120
      or (c->>'name') ~ '[[:cntrl:]]' or weight<>trunc(weight) or weight not between 1 and 10000 then
      raise exception using errcode='P1201',message='Use distinct component codes, names and positive integer weights'; end if;
    codes:=array_append(codes,code);total:=total+weight::integer;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('code',code,'name',btrim(c->>'name'),'weight_basis_points',weight::integer));
  end loop;
  if total<>10000 then raise exception using errcode='P1201',message='Component weights must total 10000 basis points'; end if;
  return (select jsonb_agg(value order by value->>'code') from jsonb_array_elements(normalized));
end $$;

create function edunexus.write_assessment_policy_draft(p_id uuid,p_version integer,p_code text,p_name text,p_source text,p_grades integer[],p_components jsonb,p_status text,p_reason text)
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
    update edunexus.assessment_policy_drafts set name=btrim(p_name),source_reference=btrim(p_source),grade_levels=grades,components=normalized_components,status=p_status where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_policy_draft_events(policy_id,policy_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.create_assessment_policy_draft(p_code text,p_name text,p_source text,p_grades integer[],p_components jsonb,p_status text,p_reason text)
returns edunexus.assessment_policy_drafts language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_policy_draft(null,0,p_code,p_name,p_source,p_grades,p_components,p_status,p_reason); end $$;
create function edunexus.update_assessment_policy_draft(p_id uuid,p_version integer,p_name text,p_source text,p_grades integer[],p_components jsonb,p_status text,p_reason text)
returns edunexus.assessment_policy_drafts language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_policy_draft(p_id,p_version,null,p_name,p_source,p_grades,p_components,p_status,p_reason); end $$;
revoke all on function edunexus.normalize_policy_components(jsonb),edunexus.write_assessment_policy_draft(uuid,integer,text,text,text,integer[],jsonb,text,text),
  edunexus.create_assessment_policy_draft(text,text,text,integer[],jsonb,text,text),edunexus.update_assessment_policy_draft(uuid,integer,text,text,integer[],jsonb,text,text) from public;
grant execute on function edunexus.create_assessment_policy_draft(text,text,text,integer[],jsonb,text,text),
  edunexus.update_assessment_policy_draft(uuid,integer,text,text,integer[],jsonb,text,text) to edunexus_app;
