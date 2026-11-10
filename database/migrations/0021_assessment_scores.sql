-- Section 4B.1: named assessments and raw learner scores. Nothing is summed,
-- weighted, averaged, transmuted or turned into a grade anywhere in this file.
-- A task must belong to a component the school actually adopted, so component
-- names are never invented here.
create table edunexus.assessment_tasks (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references edunexus.section_subjects(id) on delete restrict,
  binding_id uuid not null references edunexus.assessment_policy_bindings(id) on delete restrict,
  reporting_period_id uuid not null references edunexus.reporting_periods(id) on delete restrict,
  section_id uuid not null,academic_year_id uuid not null,
  component_code text not null check(component_code ~ '^[A-Z][A-Z0-9_-]{0,23}$'),
  sequence integer not null check(sequence between 1 and 99),
  title text not null check(length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),
  -- A sanity bound on recorded marks, not a grading rule. The school can revise it.
  max_score numeric(6,2) not null check(max_score>0 and max_score<=10000),
  status text not null default 'open' check(status in ('open','archived')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(offering_id,reporting_period_id,component_code,sequence),
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict
);
create index assessment_task_offering_idx on edunexus.assessment_tasks(offering_id);
create index assessment_task_period_idx on edunexus.assessment_tasks(reporting_period_id);
create index assessment_task_binding_idx on edunexus.assessment_tasks(binding_id);
create table edunexus.assessment_scores (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references edunexus.assessment_tasks(id) on delete restrict,
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  raw_score numeric(6,2) check(raw_score>=0),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(task_id,enrollment_id)
);
create index assessment_score_enrollment_idx on edunexus.assessment_scores(enrollment_id);
create table edunexus.assessment_task_events (
  id uuid primary key default gen_random_uuid(),task_id uuid not null references edunexus.assessment_tasks(id) on delete restrict,
  task_version integer not null check(task_version>=1),action text not null check(action in ('create','update')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(task_id,task_version)
);
-- One journal row per reviewed batch, like daily attendance, so a class entry
-- does not create one history row per learner.
create table edunexus.assessment_score_events (
  id bigint generated always as identity primary key,task_id uuid not null references edunexus.assessment_tasks(id) on delete restrict,
  entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 1 and 100),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index assessment_task_event_actor_idx on edunexus.assessment_task_events(actor_user_id);
create index assessment_score_event_task_idx on edunexus.assessment_score_events(task_id,id desc);
create index assessment_score_event_actor_idx on edunexus.assessment_score_events(actor_user_id);
alter table edunexus.assessment_tasks enable row level security;
alter table edunexus.assessment_scores enable row level security;
alter table edunexus.assessment_task_events enable row level security;
alter table edunexus.assessment_score_events enable row level security;
-- Advisers read their own current open-year sections; managers read everything.
create policy scoped_read on edunexus.assessment_tasks for select to edunexus_app using(edunexus.is_manager() or
  (edunexus.actor_role()='teacher' and exists(select 1 from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id
    where s.id=section_id and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed')));
create policy scoped_read on edunexus.assessment_scores for select to edunexus_app using(edunexus.is_manager() or
  exists(select 1 from edunexus.assessment_tasks t join edunexus.sections s on s.id=t.section_id join edunexus.academic_years y on y.id=s.academic_year_id
    where t.id=task_id and edunexus.actor_role()='teacher' and s.adviser_user_id=edunexus.actor_id() and y.status<>'closed'));
create policy manager_read on edunexus.assessment_task_events for select to edunexus_app using(edunexus.is_manager());
create policy manager_read on edunexus.assessment_score_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.assessment_tasks,edunexus.assessment_scores,edunexus.assessment_task_events,edunexus.assessment_score_events to edunexus_app;
create trigger version_record before update on edunexus.assessment_tasks for each row execute function edunexus.version_record();
create trigger version_record before update on edunexus.assessment_scores for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.assessment_tasks for each row execute function edunexus.audit_record();
create trigger audit_record after insert or update on edunexus.assessment_scores for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.assessment_task_events for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.assessment_score_events for each row execute function edunexus.audit_record();

-- Resolves the offering, its standing binding and the actor's access in one place.
create function edunexus.assessment_entry_context(p_offering uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare offering edunexus.section_subjects; section edunexus.sections; year edunexus.academic_years; binding edunexus.assessment_policy_bindings; adoption edunexus.assessment_policy_adoptions;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into offering from edunexus.section_subjects where id=p_offering;
  if not found then raise exception using errcode='P0002',message='Offering not found'; end if;
  select * into section from edunexus.sections where id=offering.section_id;
  if not edunexus.is_manager() and section.adviser_user_id is distinct from edunexus.actor_id() then raise exception using errcode='P0002',message='Offering not found'; end if;
  select * into year from edunexus.academic_years where id=offering.academic_year_id for share;
  if not edunexus.is_manager() and year.status='closed' then raise exception using errcode='P0002',message='Offering not found'; end if;
  select * into binding from edunexus.assessment_policy_bindings where offering_id=p_offering and status='bound';
  if not found then raise exception using errcode='P1601',message='Bind an adopted assessment policy to this offering first'; end if;
  select * into adoption from edunexus.assessment_policy_adoptions where id=binding.adoption_id;
  return jsonb_build_object('offering',to_jsonb(offering)-'created_at'-'updated_at','section',to_jsonb(section)-'created_at'-'updated_at',
    'school_year',to_jsonb(year)-'created_at'-'updated_at','binding',to_jsonb(binding)-'created_at'-'updated_at',
    'components',adoption.policy_snapshot->'components');
end $$;

create function edunexus.write_assessment_task(p_id uuid,p_version integer,p_offering uuid,p_period uuid,p_component text,p_sequence integer,p_title text,p_max numeric,p_status text,p_reason text)
returns edunexus.assessment_tasks language plpgsql security definer set search_path='' as $$
declare prior edunexus.assessment_tasks; result edunexus.assessment_tasks; context jsonb; period edunexus.reporting_periods; code text; highest numeric;
begin
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid assessment reason'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120 or p_title ~ '[[:cntrl:]]' or p_status is null or p_status not in ('open','archived')
    or p_max is null or p_max<=0 or p_max>10000 or p_max<>round(p_max,2) then raise exception using errcode='23514',message='Invalid assessment task'; end if;
  if p_id is null then
    if p_version is distinct from 0 or p_offering is null or p_period is null or p_component is null or p_sequence is null then
      raise exception using errcode='23514',message='A new task needs an offering, period, component and sequence'; end if;
    context:=edunexus.assessment_entry_context(p_offering);
    if context->'school_year'->>'status'='closed' then raise exception using errcode='P1600',message='Closed-year assessments are read only'; end if;
    code:=upper(btrim(p_component));
    if not exists(select 1 from jsonb_array_elements(context->'components') c where c->>'code'=code) then
      raise exception using errcode='P1601',message='Use a component code from the adopted policy revision'; end if;
    select * into period from edunexus.reporting_periods where id=p_period;
    if not found or period.academic_year_id<>(context->'school_year'->>'id')::uuid then
      raise exception using errcode='P1602',message='Use a reporting period of this school year'; end if;
    insert into edunexus.assessment_tasks(offering_id,binding_id,reporting_period_id,section_id,academic_year_id,component_code,sequence,title,max_score,status)
      values(p_offering,(context->'binding'->>'id')::uuid,p_period,(context->'section'->>'id')::uuid,(context->'school_year'->>'id')::uuid,
        code,p_sequence,btrim(p_title),p_max,p_status) returning * into result;
  else
    if p_offering is not null or p_period is not null or p_component is not null or p_sequence is not null then
      raise exception using errcode='23514',message='Offering, period, component and sequence are fixed once a task exists'; end if;
    select * into prior from edunexus.assessment_tasks where id=p_id;
    if not found then raise exception using errcode='P0002',message='Assessment task not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Assessment task changed'; end if;
    context:=edunexus.assessment_entry_context(prior.offering_id);
    if context->'school_year'->>'status'='closed' then raise exception using errcode='P1600',message='Closed-year assessments are read only'; end if;
    if row(prior.title,prior.max_score,prior.status) is not distinct from row(btrim(p_title),p_max,p_status) then
      raise exception using errcode='P1603',message='Assessment task proposal has no changes'; end if;
    -- Lowering the maximum below a recorded mark would invalidate saved evidence.
    select max(raw_score) into highest from edunexus.assessment_scores where task_id=p_id and raw_score is not null;
    if highest is not null and p_max<highest then raise exception using errcode='P1604',message='Recorded scores exceed the proposed maximum'; end if;
    update edunexus.assessment_tasks set title=btrim(p_title),max_score=p_max,status=p_status where id=p_id returning * into result;
  end if;
  insert into edunexus.assessment_task_events(task_id,task_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else to_jsonb(prior) end,
      to_jsonb(result),btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.create_assessment_task(p_offering uuid,p_period uuid,p_component text,p_sequence integer,p_title text,p_max numeric,p_reason text)
returns edunexus.assessment_tasks language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_task(null,0,p_offering,p_period,p_component,p_sequence,p_title,p_max,'open',p_reason); end $$;
create function edunexus.update_assessment_task(p_id uuid,p_version integer,p_title text,p_max numeric,p_status text,p_reason text)
returns edunexus.assessment_tasks language plpgsql security definer set search_path='' as $$
begin return edunexus.write_assessment_task(p_id,p_version,null,null,null,null,p_title,p_max,p_status,p_reason); end $$;

-- Records raw marks only. No total, percentage, average or grade is derived.
create function edunexus.record_assessment_scores(p_task uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare task edunexus.assessment_tasks; context jsonb; entry jsonb; enrollment edunexus.enrollments; existing edunexus.assessment_scores;
  saved edunexus.assessment_scores; changes jsonb:='[]'; seen uuid[]:='{}'; mark numeric; expected integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid score reason'; end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100 then
    raise exception using errcode='23514',message='Record 1 to 100 score entries at a time'; end if;
  select * into task from edunexus.assessment_tasks where id=p_task;
  if not found then raise exception using errcode='P0002',message='Assessment task not found'; end if;
  context:=edunexus.assessment_entry_context(task.offering_id);
  if context->'school_year'->>'status'='closed' then raise exception using errcode='P1600',message='Closed-year assessments are read only'; end if;
  if task.status<>'open' then raise exception using errcode='P1600',message='This assessment task is archived'; end if;
  for entry in select e.value from jsonb_array_elements(p_entries) e loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','raw_score','version']<>'{}'::jsonb
      or jsonb_typeof(entry->'enrollment_id') is distinct from 'string' or jsonb_typeof(entry->'version') is distinct from 'number'
      or jsonb_typeof(entry->'raw_score') not in ('number','null') then raise exception using errcode='23514',message='Invalid score entry fields'; end if;
    if (entry->>'enrollment_id')::uuid=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,(entry->>'enrollment_id')::uuid);
    expected:=(entry->>'version')::integer;
    mark:=case when jsonb_typeof(entry->'raw_score')='null' then null else (entry->>'raw_score')::numeric end;
    if mark is not null and (mark<0 or mark>task.max_score or mark<>round(mark,2)) then
      raise exception using errcode='P1605',message='Each score must be between zero and the task maximum'; end if;
    select * into enrollment from edunexus.enrollments where id=(entry->>'enrollment_id')::uuid;
    if not found or enrollment.section_id<>task.section_id or enrollment.record_state<>'valid' then
      raise exception using errcode='P1606',message='Record scores only for valid enrollments in this section'; end if;
    select * into existing from edunexus.assessment_scores where task_id=p_task and enrollment_id=enrollment.id;
    if found then
      if expected is distinct from existing.version then raise exception using errcode='P0003',message='A score changed while you were editing'; end if;
      if existing.raw_score is not distinct from mark then continue; end if;
      update edunexus.assessment_scores set raw_score=mark where id=existing.id returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',enrollment.id,'before',existing.raw_score,'after',mark,'version',saved.version));
    else
      if expected is distinct from 0 then raise exception using errcode='P0003',message='A score changed while you were editing'; end if;
      if mark is null then continue; end if;
      insert into edunexus.assessment_scores(task_id,enrollment_id,raw_score) values(p_task,enrollment.id,mark) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',enrollment.id,'before',null,'after',mark,'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1603',message='The score proposal has no changes'; end if;
  insert into edunexus.assessment_score_events(task_id,entries,reason,actor_user_id,request_id)
    values(p_task,changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('task_id',p_task,'changed',jsonb_array_length(changes),'entries',changes);
end $$;
revoke all on function edunexus.assessment_entry_context(uuid),
  edunexus.write_assessment_task(uuid,integer,uuid,uuid,text,integer,text,numeric,text,text),
  edunexus.create_assessment_task(uuid,uuid,text,integer,text,numeric,text),
  edunexus.update_assessment_task(uuid,integer,text,numeric,text,text),
  edunexus.record_assessment_scores(uuid,jsonb,text) from public;
grant execute on function edunexus.create_assessment_task(uuid,uuid,text,integer,text,numeric,text),
  edunexus.update_assessment_task(uuid,integer,text,numeric,text,text),
  edunexus.record_assessment_scores(uuid,jsonb,text) to edunexus_app;
