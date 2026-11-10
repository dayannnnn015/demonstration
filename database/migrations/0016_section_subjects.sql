-- Section 4A.2: section offerings retain the subject revision selected for that year.
create table edunexus.section_subjects (
  id uuid primary key default gen_random_uuid(),section_id uuid not null,academic_year_id uuid not null,
  subject_id uuid not null references edunexus.subjects(id) on delete restrict,
  subject_snapshot jsonb not null check(jsonb_typeof(subject_snapshot)='object'),
  active boolean not null default true,display_order integer not null check(display_order between 1 and 999),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(section_id,subject_id),foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict
);
create index section_subject_year_idx on edunexus.section_subjects(academic_year_id);
create index section_subject_subject_idx on edunexus.section_subjects(subject_id);
create table edunexus.section_subject_events (
  id uuid primary key default gen_random_uuid(),offering_id uuid not null references edunexus.section_subjects(id) on delete restrict,
  offering_version integer not null check(offering_version>=1),action text not null check(action in ('create','update','refresh')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(offering_id,offering_version)
);
create index section_subject_event_actor_idx on edunexus.section_subject_events(actor_user_id);
alter table edunexus.section_subjects enable row level security;
alter table edunexus.section_subject_events enable row level security;
create policy scoped_read on edunexus.section_subjects for select to edunexus_app using(edunexus.is_manager() or
  (edunexus.actor_role()='teacher' and exists(select 1 from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
    where s.id=section_id and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed')));
create policy manager_read on edunexus.section_subject_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.section_subjects,edunexus.section_subject_events to edunexus_app;
create trigger version_record before update on edunexus.section_subjects for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.section_subjects for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.section_subject_events for each row execute function edunexus.audit_record();

create function edunexus.section_subject_context(p_section uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if not edunexus.is_manager() and y.status='closed' then raise exception using errcode='P0002',message='Section not found'; end if;
  return jsonb_build_object('section',to_jsonb(s)-'created_at'-'updated_at','school_year',to_jsonb(y)-'created_at'-'updated_at');
end $$;
create function edunexus.read_section_subjects(p_section uuid,p_active text,p_limit integer,p_after uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; items jsonb;
begin
  context:=edunexus.section_subject_context(p_section);
  if p_active is null or p_active not in ('true','false','all') or p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='23514',message='Invalid offering page'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into items from (
    select * from edunexus.section_subjects where section_id=p_section and (p_active='all' or active=(p_active='true')) and (p_after is null or id>p_after) order by id limit p_limit+1
  ) r;
  return context || jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(items) with ordinality where ordinality<=p_limit),
    'pagination',jsonb_build_object('limit',p_limit,'next_after_id',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'id' else null end));
end $$;
create function edunexus.read_section_subject(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r edunexus.section_subjects; context jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into r from edunexus.section_subjects where id=p_id;
  if not found then raise exception using errcode='P0002',message='Offering not found'; end if;
  context:=edunexus.section_subject_context(r.section_id);
  return context || jsonb_build_object('record',to_jsonb(r));
end $$;
create function edunexus.write_section_subject(p_id uuid,p_section uuid,p_subject uuid,p_version integer,p_subject_version integer,p_active boolean,p_order integer,p_refresh boolean,p_reason text)
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
    update edunexus.section_subjects set active=p_active,display_order=p_order,subject_snapshot=snapshot where id=p_id returning * into result;
  end if;
  insert into edunexus.section_subject_events(offering_id,offering_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' when p_refresh then 'refresh' else 'update' end,
      case when p_id is null then null else to_jsonb(prior) end,to_jsonb(result),btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.create_section_subject(p_section uuid,p_subject uuid,p_subject_version integer,p_order integer,p_reason text)
returns edunexus.section_subjects language plpgsql security definer set search_path='' as $$
begin return edunexus.write_section_subject(null,p_section,p_subject,0,p_subject_version,true,p_order,false,p_reason); end $$;
create function edunexus.update_section_subject(p_id uuid,p_version integer,p_active boolean,p_order integer,p_refresh boolean,p_subject_version integer,p_reason text)
returns edunexus.section_subjects language plpgsql security definer set search_path='' as $$
begin return edunexus.write_section_subject(p_id,null,null,p_version,p_subject_version,p_active,p_order,p_refresh,p_reason); end $$;
revoke all on function edunexus.section_subject_context(uuid),edunexus.read_section_subjects(uuid,text,integer,uuid),edunexus.read_section_subject(uuid),
  edunexus.write_section_subject(uuid,uuid,uuid,integer,integer,boolean,integer,boolean,text),edunexus.create_section_subject(uuid,uuid,integer,integer,text),
  edunexus.update_section_subject(uuid,integer,boolean,integer,boolean,integer,text) from public;
grant execute on function edunexus.read_section_subjects(uuid,text,integer,uuid),edunexus.read_section_subject(uuid),edunexus.create_section_subject(uuid,uuid,integer,integer,text),
  edunexus.update_section_subject(uuid,integer,boolean,integer,boolean,integer,text) to edunexus_app;
