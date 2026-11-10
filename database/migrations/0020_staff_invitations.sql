-- Section 1 refinement: track staff invitations instead of pasting a bare UUID.
-- EDUNEXUS never mints an Auth identity: the operator still provisions it in
-- Supabase, and the runtime holds no service-role key.
create table edunexus.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(length(email) between 5 and 254 and email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' and email=lower(email)),
  display_name text not null check(length(btrim(display_name)) between 1 and 150 and display_name !~ '[[:cntrl:]]'),
  role edunexus.staff_role not null,
  status text not null default 'requested' check(status in ('requested','provisioned','cancelled')),
  linked_user_id uuid references edunexus.staff(user_id) on delete restrict,
  requested_by uuid not null references edunexus.staff(user_id) on delete restrict,
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check((status='provisioned')=(linked_user_id is not null))
);
create unique index staff_invitation_open_idx on edunexus.staff_invitations(email) where status='requested';
create unique index staff_invitation_user_idx on edunexus.staff_invitations(linked_user_id) where linked_user_id is not null;
create index staff_invitation_requester_idx on edunexus.staff_invitations(requested_by);
create table edunexus.staff_invitation_events (
  id uuid primary key default gen_random_uuid(),invitation_id uuid not null references edunexus.staff_invitations(id) on delete restrict,
  invitation_version integer not null check(invitation_version>=1),action text not null check(action in ('request','provision','cancel')),
  before_snapshot jsonb,after_snapshot jsonb not null,reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(invitation_id,invitation_version)
);
create index staff_invitation_event_actor_idx on edunexus.staff_invitation_events(actor_user_id);
alter table edunexus.staff_invitations enable row level security;
alter table edunexus.staff_invitation_events enable row level security;
create policy manager_read on edunexus.staff_invitations for select to edunexus_app using(edunexus.is_manager());
create policy manager_read on edunexus.staff_invitation_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.staff_invitations,edunexus.staff_invitation_events to edunexus_app;
create trigger version_record before update on edunexus.staff_invitations for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.staff_invitations for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.staff_invitation_events for each row execute function edunexus.audit_record();

-- Mirrors the staff_insert row policy, which a definer function bypasses.
create function edunexus.assert_may_grant_role(p_role edunexus.staff_role) returns void language plpgsql stable security definer set search_path='' as $$
begin
  if edunexus.actor_role()='principal' then return; end if;
  if edunexus.actor_role()='administrative_officer' and p_role='teacher' then return; end if;
  raise exception using errcode='42501',message='Principal access is required for this permission level';
end $$;

create function edunexus.write_staff_invitation(p_id uuid,p_version integer,p_action text,p_email text,p_name text,p_role edunexus.staff_role,p_user_id uuid,p_reason text)
returns edunexus.staff_invitations language plpgsql security definer set search_path='' as $$
declare prior edunexus.staff_invitations; result edunexus.staff_invitations;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid invitation reason'; end if;
  if p_action='request' then
    if p_version is distinct from 0 or p_email is null or p_name is null or p_role is null or p_user_id is not null then
      raise exception using errcode='23514',message='A request supplies an email, name and permission level only'; end if;
    perform edunexus.assert_may_grant_role(p_role);
    insert into edunexus.staff_invitations(email,display_name,role,requested_by)
      values(lower(btrim(p_email)),btrim(p_name),p_role,edunexus.actor_id()) returning * into result;
  else
    if p_email is not null or p_name is not null or p_role is not null then raise exception using errcode='23514',message='Only the current invitation version is reviewed'; end if;
    select * into prior from edunexus.staff_invitations where id=p_id;
    if not found then raise exception using errcode='P0002',message='Invitation not found'; end if;
    if p_version is distinct from prior.version then raise exception using errcode='P0003',message='Invitation changed'; end if;
    if prior.status<>'requested' then raise exception using errcode='P1500',message='This invitation was already completed or cancelled'; end if;
    perform edunexus.assert_may_grant_role(prior.role);
    if p_action='provision' then
      if p_user_id is null then raise exception using errcode='23514',message='Provisioning requires the Supabase Auth user identifier'; end if;
      -- The identity must already exist in Supabase; EDUNEXUS never creates one.
      insert into edunexus.staff(user_id,display_name,role) values(p_user_id,prior.display_name,prior.role);
      update edunexus.staff_invitations set status='provisioned',linked_user_id=p_user_id where id=p_id returning * into result;
    elsif p_action='cancel' then
      if p_user_id is not null then raise exception using errcode='23514',message='Cancellation reviews only the current invitation version'; end if;
      update edunexus.staff_invitations set status='cancelled' where id=p_id returning * into result;
    else raise exception using errcode='23514',message='Unsupported invitation action'; end if;
  end if;
  insert into edunexus.staff_invitation_events(invitation_id,invitation_version,action,before_snapshot,after_snapshot,reason,actor_user_id,request_id)
    values(result.id,result.version,p_action,case when p_action='request' then null else to_jsonb(prior) end,to_jsonb(result),
      btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return result;
end $$;
create function edunexus.request_staff_invitation(p_email text,p_name text,p_role edunexus.staff_role,p_reason text)
returns edunexus.staff_invitations language plpgsql security definer set search_path='' as $$
begin return edunexus.write_staff_invitation(null,0,'request',p_email,p_name,p_role,null,p_reason); end $$;
create function edunexus.provision_staff_invitation(p_id uuid,p_version integer,p_user_id uuid,p_reason text)
returns edunexus.staff_invitations language plpgsql security definer set search_path='' as $$
begin return edunexus.write_staff_invitation(p_id,p_version,'provision',null,null,null,p_user_id,p_reason); end $$;
create function edunexus.cancel_staff_invitation(p_id uuid,p_version integer,p_reason text)
returns edunexus.staff_invitations language plpgsql security definer set search_path='' as $$
begin return edunexus.write_staff_invitation(p_id,p_version,'cancel',null,null,null,null,p_reason); end $$;
revoke all on function edunexus.assert_may_grant_role(edunexus.staff_role),
  edunexus.write_staff_invitation(uuid,integer,text,text,text,edunexus.staff_role,uuid,text),
  edunexus.request_staff_invitation(text,text,edunexus.staff_role,text),
  edunexus.provision_staff_invitation(uuid,integer,uuid,text),edunexus.cancel_staff_invitation(uuid,integer,text) from public;
grant execute on function edunexus.request_staff_invitation(text,text,edunexus.staff_role,text),
  edunexus.provision_staff_invitation(uuid,integer,uuid,text),edunexus.cancel_staff_invitation(uuid,integer,text) to edunexus_app;
