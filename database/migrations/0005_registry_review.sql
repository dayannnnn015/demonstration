-- Section 2B.1: reviewed LRN corrections and bounded import review receipts.
-- CSV/profile payloads are never staged in the database.
create table edunexus.lrn_corrections (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references edunexus.learners(id) on delete restrict,
  learner_version integer not null,
  previous_lrn text not null check(previous_lrn ~ '^[0-9]{12}$'),
  corrected_lrn text not null check(corrected_lrn ~ '^[0-9]{12}$'),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  transaction_id text not null default txid_current()::text,
  unique(learner_id,learner_version),
  check(previous_lrn<>corrected_lrn)
);
create index lrn_corrections_actor_idx on edunexus.lrn_corrections(actor_user_id);
alter table edunexus.lrn_corrections enable row level security;
create policy lrn_corrections_read on edunexus.lrn_corrections for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.lrn_corrections to edunexus_app;

-- Acquire the shared roster lock before any learner row lock. This also prevents
-- a competing profile insert from appearing between duplicate review and commit.
create function edunexus.lock_registry_write() returns trigger language plpgsql set search_path='' as $$
begin perform pg_advisory_xact_lock(82412001); return null; end $$;
create trigger registry_write_lock before insert or update on edunexus.learners
  for each statement execute function edunexus.lock_registry_write();

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
    if exists(select 1 from edunexus.enrollments where learner_id=old.id and enrolled_on<=new.birth_date) then
      raise exception using errcode='23514',message='Birth date must precede enrollment';
    end if;
  end if;
  return new;
end $$;

create function edunexus.correct_lrn(p_id uuid,p_version integer,p_previous text,p_corrected text,p_reason text)
returns edunexus.learners language plpgsql security definer set search_path='' as $$
declare l edunexus.learners;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into l from edunexus.learners where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Learner not found'; end if;
  if p_version is null or l.version<>p_version or p_previous is distinct from l.lrn then
    raise exception using errcode='P0003',message='Learner changed';
  end if;
  if l.lrn is null then raise exception using errcode='23514',message='Use initial LRN assignment'; end if;
  insert into edunexus.lrn_corrections(learner_id,learner_version,previous_lrn,corrected_lrn,reason,actor_user_id,request_id)
  values(l.id,l.version+1,l.lrn,p_corrected,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  update edunexus.learners set lrn=p_corrected where id=l.id returning * into l;
  return l;
end $$;

create table edunexus.import_previews (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  request_id uuid not null,
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'),
  row_count integer not null check(row_count between 1 and 50),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
  committed_at timestamptz,
  receipt jsonb,
  check((committed_at is null)=(receipt is null))
);
create index import_previews_actor_idx on edunexus.import_previews(actor_user_id,created_at desc);
create index import_previews_expiry_idx on edunexus.import_previews(expires_at) where committed_at is null;
alter table edunexus.import_previews enable row level security;
create policy import_previews_read on edunexus.import_previews for select to edunexus_app
  using(edunexus.is_manager() and actor_user_id=edunexus.actor_id());
grant select on edunexus.import_previews to edunexus_app;

create function edunexus.create_import_preview(p_input text,p_plan text,p_count integer)
returns edunexus.import_previews language plpgsql security definer set search_path='' as $$
declare result edunexus.import_previews;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  delete from edunexus.import_previews where committed_at is null and expires_at<=clock_timestamp();
  if (select count(*) from edunexus.import_previews where actor_user_id=edunexus.actor_id() and committed_at is null)>=10 then
    raise exception using errcode='P0006',message='Too many pending previews';
  end if;
  insert into edunexus.import_previews(actor_user_id,request_id,input_hash,plan_hash,row_count)
  values(edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid,p_input,p_plan,p_count) returning * into result;
  return result;
end $$;

create function edunexus.lock_import_preview(p_id uuid,p_input text)
returns edunexus.import_previews language plpgsql security definer set search_path='' as $$
declare result edunexus.import_previews;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into result from edunexus.import_previews where id=p_id and actor_user_id=edunexus.actor_id() for update;
  if not found then raise exception using errcode='P0002',message='Preview not found'; end if;
  if result.input_hash is distinct from p_input then raise exception using errcode='P0005',message='Preview input changed'; end if;
  -- Completed retries return their original receipt even after expiry.
  if result.receipt is null and result.expires_at<=clock_timestamp() then raise exception using errcode='P0004',message='Preview expired'; end if;
  return result;
end $$;

create function edunexus.finish_import(p_id uuid,p_plan text,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result edunexus.import_previews;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into result from edunexus.import_previews where id=p_id and actor_user_id=edunexus.actor_id() for update;
  if not found then raise exception using errcode='P0002',message='Preview not found'; end if;
  if result.plan_hash is distinct from p_plan then raise exception using errcode='P0005',message='Reviewed records changed'; end if;
  if result.receipt is not null then return result.receipt; end if;
  if result.expires_at<=clock_timestamp() then raise exception using errcode='P0004',message='Preview expired'; end if;
  if p_receipt is null or jsonb_typeof(p_receipt->'items') is distinct from 'array'
    or jsonb_array_length(p_receipt->'items')<>result.row_count then
    raise exception using errcode='23514',message='Invalid import receipt';
  end if;
  update edunexus.import_previews set committed_at=clock_timestamp(),receipt=p_receipt where id=p_id;
  return p_receipt;
end $$;

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory',
  'lrnCorrectionHistory','importPreview','importCommit','importGet'
));
revoke all on function edunexus.lock_registry_write(),edunexus.correct_lrn(uuid,integer,text,text,text),
  edunexus.create_import_preview(text,text,integer),edunexus.lock_import_preview(uuid,text),edunexus.finish_import(uuid,text,jsonb) from public;
grant execute on function edunexus.correct_lrn(uuid,integer,text,text,text),
  edunexus.create_import_preview(text,text,integer),edunexus.lock_import_preview(uuid,text),edunexus.finish_import(uuid,text,jsonb) to edunexus_app;
