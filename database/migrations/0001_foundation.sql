-- EDUNEXUS Section 1. Run using the Supabase database owner, never the API login.
-- Supabase owns auth.users; local tests create a small auth.users fixture explicitly.
create role edunexus_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema edunexus;
revoke all on schema edunexus from public;
grant usage on schema edunexus to edunexus_app;
alter default privileges in schema edunexus revoke execute on functions from public;

create type edunexus.staff_role as enum ('principal', 'administrative_officer', 'teacher');
create type edunexus.year_status as enum ('draft', 'active', 'closed');

create table edunexus.school_profile (
  id smallint primary key default 1 check (id = 1),
  name text not null check (length(btrim(name)) between 1 and 150),
  school_code text check (school_code ~ '^[0-9]{6}$'),
  address text not null check (length(btrim(address)) between 1 and 300),
  timezone text not null default 'Asia/Manila' check (timezone = 'Asia/Manila'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table edunexus.staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 150),
  role edunexus.staff_role not null,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_active_role_idx on edunexus.staff(role, user_id) where active;

create table edunexus.academic_years (
  id uuid primary key default gen_random_uuid(),
  start_year integer not null unique check (start_year between 2000 and 2199),
  starts_on date not null,
  ends_on date not null,
  status edunexus.year_status not null default 'draft',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on),
  check (extract(year from starts_on) = start_year),
  check (extract(year from ends_on) between start_year and start_year + 1)
);
create unique index academic_years_one_active_idx on edunexus.academic_years(status) where status = 'active';

create table edunexus.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references edunexus.academic_years(id) on delete restrict,
  ordinal smallint not null check (ordinal between 1 and 12),
  name text not null check (length(btrim(name)) between 1 and 60),
  starts_on date not null,
  ends_on date not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, ordinal),
  check (ends_on >= starts_on)
);

create table edunexus.sections (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references edunexus.academic_years(id) on delete restrict,
  grade_level smallint not null check (grade_level between 0 and 6),
  name text not null check (length(btrim(name)) between 1 and 80),
  adviser_user_id uuid references edunexus.staff(user_id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sections_year_grade_name_idx on edunexus.sections(academic_year_id, grade_level, lower(btrim(name)));
create index sections_adviser_year_idx on edunexus.sections(adviser_user_id, academic_year_id);

create table edunexus.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  request_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  entity_table text not null,
  entity_id text not null,
  changed_fields text[] not null
);
create index audit_events_time_idx on edunexus.audit_events(id desc);
create index audit_events_actor_idx on edunexus.audit_events(actor_user_id, id desc);

create function edunexus.actor_id() returns uuid language sql stable
  set search_path = '' as $$ select nullif(current_setting('edunexus.actor_id', true), '')::uuid $$;

-- Definer helpers inspect staff without a recursive staff RLS policy. These have
-- fixed SQL, an empty search path and no caller-supplied user or role argument.
create function edunexus.actor_role() returns edunexus.staff_role language sql stable security definer
  set search_path = '' as $$
  select role from edunexus.staff where user_id = edunexus.actor_id() and active
$$;
create function edunexus.is_manager() returns boolean language sql stable
  set search_path = '' as $$
  select coalesce(edunexus.actor_role() in ('principal', 'administrative_officer'), false)
$$;

create function edunexus.version_record() returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end $$;

create function edunexus.audit_record() returns trigger language plpgsql security definer set search_path = '' as $$
declare fields text[];
begin
  select coalesce(array_agg(key order by key), '{}'::text[]) into fields
  from jsonb_each(to_jsonb(new))
  where key not in ('created_at', 'updated_at', 'version')
    and (tg_op = 'INSERT' or value is distinct from to_jsonb(old)->key);
  insert into edunexus.audit_events(actor_user_id, request_id, operation, entity_table, entity_id, changed_fields)
  values (edunexus.actor_id(), nullif(current_setting('edunexus.request_id', true), '')::uuid,
    tg_op, tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'user_id'), fields);
  return new;
end $$;

create function edunexus.guard_staff() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize privilege changes so two principals cannot deactivate one another
  -- concurrently and leave the school without an active principal.
  perform pg_advisory_xact_lock(82412001);
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception using errcode = '23514', message = 'Staff identity is immutable'; end if;
    if old.user_id = edunexus.actor_id() and (new.role <> old.role or new.active <> old.active) then
      raise exception using errcode = '23514', message = 'Cannot change your own access';
    end if;
    if old.role = 'principal' and old.active and (new.role <> 'principal' or not new.active)
      and not exists (select 1 from edunexus.staff where user_id <> old.user_id and role = 'principal' and active) then
      raise exception using errcode = '23514', message = 'An active principal is required';
    end if;
    if (not new.active or new.role <> 'teacher') and exists (
      select 1 from edunexus.sections s join edunexus.academic_years y on y.id = s.academic_year_id
      where s.adviser_user_id = old.user_id and y.status <> 'closed'
    ) then
      raise exception using errcode = '23514', message = 'Reassign open-year sections before changing adviser access';
    end if;
  end if;
  return new;
end $$;

create function edunexus.guard_year() returns trigger language plpgsql set search_path = '' as $$
declare n integer; max_ordinal integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception using errcode = '23514', message = 'Create school years as drafts'; end if;
    return new;
  end if;
  if old.status = 'closed' then raise exception using errcode = '23514', message = 'Closed school years are immutable'; end if;
  if new.start_year <> old.start_year or new.starts_on <> old.starts_on or new.ends_on <> old.ends_on then
    raise exception using errcode = '23514', message = 'School year dates are immutable in Section 1';
  end if;
  if new.status <> old.status and not ((old.status = 'draft' and new.status = 'active') or (old.status = 'active' and new.status = 'closed')) then
    raise exception using errcode = '23514', message = 'Invalid school year transition';
  end if;
  if old.status = 'draft' and new.status = 'active' then
    select count(*), max(ordinal) into n, max_ordinal from edunexus.reporting_periods where academic_year_id = old.id;
    if n = 0 or n <> max_ordinal then raise exception using errcode = '23514', message = 'Configure consecutively numbered reporting periods first'; end if;
    if exists (select 1 from edunexus.reporting_periods a join edunexus.reporting_periods b on a.academic_year_id=b.academic_year_id
      where a.academic_year_id=old.id and a.ordinal < b.ordinal and a.starts_on >= b.starts_on) then
      raise exception using errcode = '23514', message = 'Reporting periods must follow chronological order';
    end if;
  end if;
  return new;
end $$;

create function edunexus.guard_period() returns trigger language plpgsql set search_path = '' as $$
declare y edunexus.academic_years;
begin
  select * into y from edunexus.academic_years where id = new.academic_year_id for update;
  if not found then raise exception using errcode = '23503', message = 'School year not found'; end if;
  if y.status <> 'draft' then raise exception using errcode = '23514', message = 'Periods can only be configured in draft years'; end if;
  if new.starts_on < y.starts_on or new.ends_on > y.ends_on then
    raise exception using errcode = '23514', message = 'Period falls outside the school year';
  end if;
  if exists (select 1 from edunexus.reporting_periods where academic_year_id = y.id and id <> new.id
    and starts_on <= new.ends_on and ends_on >= new.starts_on) then
    raise exception using errcode = '23514', message = 'Reporting periods overlap';
  end if;
  return new;
end $$;

create function edunexus.guard_section() returns trigger language plpgsql set search_path = '' as $$
declare year_state edunexus.year_status;
begin
  -- Match the staff privilege-change lock before reading adviser activity.
  perform pg_advisory_xact_lock(82412001);
  select status into year_state from edunexus.academic_years where id = new.academic_year_id for update;
  if not found then raise exception using errcode = '23503', message = 'School year not found'; end if;
  if year_state = 'closed' then raise exception using errcode = '23514', message = 'Closed school years are immutable'; end if;
  if tg_op = 'UPDATE' and (new.academic_year_id <> old.academic_year_id or new.grade_level <> old.grade_level) then
    raise exception using errcode = '23514', message = 'Section year and grade are immutable';
  end if;
  if new.adviser_user_id is not null and not exists (
    select 1 from edunexus.staff where user_id = new.adviser_user_id and active and role = 'teacher'
  ) then raise exception using errcode = '23514', message = 'Adviser must be an active teacher'; end if;
  return new;
end $$;

create trigger staff_guard before insert or update on edunexus.staff for each row execute function edunexus.guard_staff();
create trigger year_guard before insert or update on edunexus.academic_years for each row execute function edunexus.guard_year();
create trigger period_guard before insert or update on edunexus.reporting_periods for each row execute function edunexus.guard_period();
create trigger section_guard before insert or update on edunexus.sections for each row execute function edunexus.guard_section();

do $$ declare t text; begin
  foreach t in array array['school_profile','staff','academic_years','reporting_periods','sections'] loop
    execute format('create trigger version_record before update on edunexus.%I for each row execute function edunexus.version_record()', t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()', t);
    execute format('alter table edunexus.%I enable row level security', t);
  end loop;
end $$;
alter table edunexus.audit_events enable row level security;

create policy school_read on edunexus.school_profile for select to edunexus_app using (edunexus.actor_role() is not null);
create policy school_update on edunexus.school_profile for update to edunexus_app using (edunexus.is_manager()) with check (edunexus.is_manager());
create policy staff_read on edunexus.staff for select to edunexus_app using (user_id = edunexus.actor_id() or edunexus.is_manager());
create policy staff_insert on edunexus.staff for insert to edunexus_app with check (
  edunexus.actor_role() = 'principal' or (edunexus.actor_role() = 'administrative_officer' and role = 'teacher')
);
create policy staff_update on edunexus.staff for update to edunexus_app using (
  edunexus.actor_role() = 'principal' or (edunexus.actor_role() = 'administrative_officer' and role = 'teacher')
) with check (
  edunexus.actor_role() = 'principal' or (edunexus.actor_role() = 'administrative_officer' and role = 'teacher')
);
create policy year_read on edunexus.academic_years for select to edunexus_app using (edunexus.actor_role() is not null);
create policy year_insert on edunexus.academic_years for insert to edunexus_app with check (edunexus.is_manager());
create policy year_update on edunexus.academic_years for update to edunexus_app using (edunexus.is_manager()) with check (edunexus.is_manager());
create policy period_read on edunexus.reporting_periods for select to edunexus_app using (edunexus.actor_role() is not null);
create policy period_insert on edunexus.reporting_periods for insert to edunexus_app with check (edunexus.is_manager());
create policy period_update on edunexus.reporting_periods for update to edunexus_app using (edunexus.is_manager()) with check (edunexus.is_manager());
create policy section_read on edunexus.sections for select to edunexus_app using (
  edunexus.is_manager() or (edunexus.actor_role() = 'teacher' and adviser_user_id = edunexus.actor_id())
);
create policy section_insert on edunexus.sections for insert to edunexus_app with check (edunexus.is_manager());
create policy section_update on edunexus.sections for update to edunexus_app using (edunexus.is_manager()) with check (edunexus.is_manager());
create policy audit_read on edunexus.audit_events for select to edunexus_app using (edunexus.is_manager());

grant select on edunexus.school_profile, edunexus.staff, edunexus.academic_years, edunexus.reporting_periods, edunexus.sections, edunexus.audit_events to edunexus_app;
grant insert (user_id, display_name, role) on edunexus.staff to edunexus_app;
grant update (display_name, role, active) on edunexus.staff to edunexus_app;
grant update (name, school_code, address) on edunexus.school_profile to edunexus_app;
grant insert (start_year, starts_on, ends_on) on edunexus.academic_years to edunexus_app;
grant update (status) on edunexus.academic_years to edunexus_app;
grant insert (academic_year_id, ordinal, name, starts_on, ends_on) on edunexus.reporting_periods to edunexus_app;
grant update (name, ordinal, starts_on, ends_on) on edunexus.reporting_periods to edunexus_app;
grant insert (academic_year_id, grade_level, name, adviser_user_id) on edunexus.sections to edunexus_app;
grant update (name, adviser_user_id) on edunexus.sections to edunexus_app;
revoke all on all functions in schema edunexus from public;
grant execute on function edunexus.actor_id(), edunexus.actor_role(), edunexus.is_manager() to edunexus_app;

-- Explicitly no DELETE, TRUNCATE, DDL, or audit mutation privileges. The runtime
-- login does not own these tables; RLS therefore applies without FORCE RLS.
