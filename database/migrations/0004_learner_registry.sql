-- Section 2A: minimum learner identity and an append-only enrollment timeline.
-- No sample learners, generated LRNs, imports, or grade calculations.
create table edunexus.learners (
  id uuid primary key default gen_random_uuid(),
  lrn text unique check (lrn ~ '^[0-9]{12}$'),
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  middle_name text check (length(btrim(middle_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  name_extension text check (length(btrim(name_extension)) between 1 and 20),
  birth_date date not null,
  sex text not null check (sex in ('male','female')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learners_name_idx on edunexus.learners(lower(last_name),lower(first_name),id);
create index learners_birth_date_idx on edunexus.learners(birth_date,id);

alter table edunexus.sections add constraint sections_identity_year_grade_key unique(id,academic_year_id,grade_level);
create table edunexus.enrollments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references edunexus.learners(id) on delete restrict,
  academic_year_id uuid not null references edunexus.academic_years(id) on delete restrict,
  grade_level smallint not null,
  section_id uuid not null,
  enrolled_on date not null,
  effective_on date not null,
  status text not null default 'enrolled' check(status in ('enrolled','withdrawn')),
  last_reason text not null check(last_reason in ('regular','transfer_in','section_change','transfer_out','withdrawal','dropout','death','return_to_school')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(learner_id,academic_year_id),
  foreign key(section_id,academic_year_id,grade_level) references edunexus.sections(id,academic_year_id,grade_level) on delete restrict,
  check(effective_on >= enrolled_on)
);
create index enrollments_year_idx on edunexus.enrollments(academic_year_id,id);
create index enrollments_section_status_idx on edunexus.enrollments(section_id,status,id);
create table edunexus.enrollment_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references edunexus.enrollments(id) on delete restrict,
  enrollment_version integer not null,
  event_type text not null check(event_type in ('enrolled','reassigned','withdrawn','reentered')),
  effective_on date not null,
  section_id uuid not null references edunexus.sections(id) on delete restrict,
  reason text not null,
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(enrollment_id,enrollment_version)
);
create index enrollment_events_section_idx on edunexus.enrollment_events(section_id);
create index enrollment_events_actor_idx on edunexus.enrollment_events(actor_user_id);

create function edunexus.guard_learner() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.birth_date > timezone('Asia/Manila',now())::date or new.birth_date < date '1900-01-01' then
    raise exception using errcode='23514',message='Invalid learner birth date';
  end if;
  if tg_op='UPDATE' then
    if old.lrn is not null and new.lrn is distinct from old.lrn then
      raise exception using errcode='23514',message='Assigned LRN requires a reviewed correction workflow';
    end if;
    if exists(select 1 from edunexus.enrollments where learner_id=old.id and enrolled_on <= new.birth_date) then
      raise exception using errcode='23514',message='Birth date must precede enrollment';
    end if;
  end if;
  return new;
end $$;
create trigger learner_guard before insert or update on edunexus.learners for each row execute function edunexus.guard_learner();

create function edunexus.record_enrollment_event() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  if tg_op='INSERT' then kind:='enrolled';
  elsif new.status='withdrawn' then kind:='withdrawn';
  elsif old.status='withdrawn' then kind:='reentered';
  else kind:='reassigned'; end if;
  insert into edunexus.enrollment_events(enrollment_id,enrollment_version,event_type,effective_on,section_id,reason,actor_user_id,request_id)
  values(new.id,new.version,kind,new.effective_on,new.section_id,new.last_reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return new;
end $$;
create trigger enrollment_event after insert or update on edunexus.enrollments for each row execute function edunexus.record_enrollment_event();

-- All enrollment writes pass through two narrowly scoped, atomic functions.
-- The runtime has no direct INSERT/UPDATE privileges on enrollment tables.
create function edunexus.enroll_learner(p_learner uuid,p_section uuid,p_date date,p_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; l edunexus.learners; result edunexus.enrollments;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found then raise exception using errcode='23503',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for update;
  select * into l from edunexus.learners where id=p_learner for update;
  if not found then raise exception using errcode='23503',message='Learner not found'; end if;
  if y.status='closed' or p_date is null or p_date<y.starts_on or p_date>y.ends_on or p_date<=l.birth_date then
    raise exception using errcode='23514',message='Enrollment date or school year is invalid';
  end if;
  if p_reason is null or p_reason not in ('regular','transfer_in') then raise exception using errcode='23514',message='Invalid enrollment reason'; end if;
  insert into edunexus.enrollments(learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
  values(p_learner,s.academic_year_id,s.grade_level,s.id,p_date,p_date,p_reason) returning * into result;
  return result;
end $$;

create function edunexus.move_enrollment(p_id uuid,p_version integer,p_action text,p_date date,p_section uuid,p_exit_reason text)
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

-- A teacher sees current rosters of their assigned open-year sections only.
-- Historical access, unassigned learners, and other sections remain managerial.
create function edunexus.can_read_enrollment(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.is_manager() or (edunexus.actor_role()='teacher' and exists(
    select 1 from edunexus.enrollments e join edunexus.sections s on s.id=e.section_id
    join edunexus.academic_years y on y.id=e.academic_year_id
    where e.id=p_id and e.status='enrolled' and y.status<>'closed' and s.adviser_user_id=edunexus.actor_id()
  ))
$$;
create function edunexus.can_read_learner(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.is_manager() or exists(select 1 from edunexus.enrollments where learner_id=p_id and edunexus.can_read_enrollment(id))
$$;

do $$ declare t text; begin
  foreach t in array array['learners','enrollments'] loop
    execute format('create trigger version_record before update on edunexus.%I for each row execute function edunexus.version_record()',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
    execute format('alter table edunexus.%I enable row level security',t);
  end loop;
end $$;
alter table edunexus.enrollment_events enable row level security;
create policy learner_read on edunexus.learners for select to edunexus_app using(edunexus.can_read_learner(id));
create policy learner_insert on edunexus.learners for insert to edunexus_app with check(edunexus.is_manager());
create policy learner_update on edunexus.learners for update to edunexus_app using(edunexus.is_manager()) with check(edunexus.is_manager());
create policy enrollment_read on edunexus.enrollments for select to edunexus_app using(edunexus.can_read_enrollment(id));
create policy enrollment_events_read on edunexus.enrollment_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.learners,edunexus.enrollments,edunexus.enrollment_events to edunexus_app;
grant insert(lrn,first_name,middle_name,last_name,name_extension,birth_date,sex) on edunexus.learners to edunexus_app;
grant update(lrn,first_name,middle_name,last_name,name_extension,birth_date,sex) on edunexus.learners to edunexus_app;
revoke all on function edunexus.enroll_learner(uuid,uuid,date,text),edunexus.move_enrollment(uuid,integer,text,date,uuid,text),edunexus.can_read_enrollment(uuid),edunexus.can_read_learner(uuid),edunexus.guard_learner(),edunexus.record_enrollment_event() from public;
grant execute on function edunexus.enroll_learner(uuid,uuid,date,text),edunexus.move_enrollment(uuid,integer,text,date,uuid,text),edunexus.can_read_enrollment(uuid),edunexus.can_read_learner(uuid) to edunexus_app;

create table edunexus.record_access_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,
  resource text not null check(resource in ('learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory')),
  record_ids uuid[] not null check(cardinality(record_ids)<=100)
);
create index record_access_actor_idx on edunexus.record_access_events(actor_user_id,id desc);
alter table edunexus.record_access_events enable row level security;
create policy record_access_read on edunexus.record_access_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.record_access_events to edunexus_app;
create function edunexus.record_access(p_resource text,p_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  insert into edunexus.record_access_events(actor_user_id,request_id,resource,record_ids)
  values(edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid,p_resource,p_ids);
end $$;
revoke all on function edunexus.record_access(text,uuid[]) from public;
grant execute on function edunexus.record_access(text,uuid[]) to edunexus_app;
