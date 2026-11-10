-- Section 4A.1: explicit subject metadata, without seeded curricula or grade rules.
create table edunexus.subjects (
  id uuid primary key default gen_random_uuid(),code text not null unique check(code ~ '^[A-Z][A-Z0-9_-]{0,23}$'),
  name text not null check(length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  kind text not null check(kind in ('learning_area','developmental_domain')),
  grade_levels integer[] not null check(cardinality(grade_levels) between 1 and 7 and grade_levels <@ array[0,1,2,3,4,5,6] and array_position(grade_levels,null) is null),
  active boolean not null default true,version integer not null default 1 check(version>=1),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table edunexus.subject_events (
  id uuid primary key default gen_random_uuid(),subject_id uuid not null references edunexus.subjects(id) on delete restrict,
  subject_version integer not null check(subject_version>=1),action text not null check(action in ('create','update')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(subject_id,subject_version)
);
create index subject_event_actor_idx on edunexus.subject_events(actor_user_id);
alter table edunexus.subjects enable row level security;
alter table edunexus.subject_events enable row level security;
create policy staff_read on edunexus.subjects for select to edunexus_app using(edunexus.actor_role() is not null);
create policy manager_read on edunexus.subject_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.subjects,edunexus.subject_events to edunexus_app;
create trigger version_record before update on edunexus.subjects for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.subjects for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.subject_events for each row execute function edunexus.audit_record();

create function edunexus.write_subject(p_id uuid,p_version integer,p_code text,p_name text,p_kind text,p_grades integer[],p_active boolean,p_reason text)
returns edunexus.subjects language plpgsql security definer set search_path='' as $$
declare prior edunexus.subjects; result edunexus.subjects; grades integer[];
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid subject change reason'; end if;
  if p_name is null or p_kind is null or p_active is null or p_grades is null or array_ndims(p_grades) is distinct from 1
    or cardinality(p_grades) not between 1 and 7 or array_position(p_grades,null) is not null
    or not p_grades <@ array[0,1,2,3,4,5,6] then raise exception using errcode='23514',message='Invalid subject metadata'; end if;
  select array_agg(distinct value order by value) into grades from unnest(p_grades) value;
  if cardinality(grades)<>cardinality(p_grades) then raise exception using errcode='23514',message='Grade levels must be distinct'; end if;
  if p_id is null then
    if p_version is distinct from 0 or p_code is null then raise exception using errcode='23514',message='Subject code required'; end if;
    insert into edunexus.subjects(code,name,kind,grade_levels,active) values(upper(btrim(p_code)),btrim(p_name),p_kind,grades,p_active) returning * into result;
  else
    select * into prior from edunexus.subjects where id=p_id;
    if not found then raise exception using errcode='P0002',message='Subject not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Subject version changed'; end if;
    if p_code is not null then raise exception using errcode='23514',message='Subject codes are immutable'; end if;
    if row(prior.name,prior.kind,prior.grade_levels,prior.active) is not distinct from row(btrim(p_name),p_kind,grades,p_active) then
      raise exception using errcode='P1000',message='Subject proposal has no changes'; end if;
    update edunexus.subjects set name=btrim(p_name),kind=p_kind,grade_levels=grades,active=p_active where id=p_id returning * into result;
  end if;
  insert into edunexus.subject_events(subject_id,subject_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.create_subject(p_code text,p_name text,p_kind text,p_grades integer[],p_active boolean,p_reason text)
returns edunexus.subjects language plpgsql security definer set search_path='' as $$
begin return edunexus.write_subject(null,0,p_code,p_name,p_kind,p_grades,p_active,p_reason); end $$;
create function edunexus.update_subject(p_id uuid,p_version integer,p_name text,p_kind text,p_grades integer[],p_active boolean,p_reason text)
returns edunexus.subjects language plpgsql security definer set search_path='' as $$
begin return edunexus.write_subject(p_id,p_version,null,p_name,p_kind,p_grades,p_active,p_reason); end $$;
revoke all on function edunexus.write_subject(uuid,integer,text,text,text,integer[],boolean,text),edunexus.create_subject(text,text,text,integer[],boolean,text),
  edunexus.update_subject(uuid,integer,text,text,integer[],boolean,text) from public;
grant execute on function edunexus.create_subject(text,text,text,integer[],boolean,text),edunexus.update_subject(uuid,integer,text,text,integer[],boolean,text) to edunexus_app;
