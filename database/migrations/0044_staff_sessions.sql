-- Where your account is signed in, as the API has seen it. Each sign-in session
-- (the session_id the sign-in service writes into every access token) is noted
-- when the workspace first reads /me in it, and again at most every five minutes,
-- with a coarse device label (browser and system) and whether a second step was
-- used. No IP address, location or full user-agent string is kept: knowing that a
-- session on "Chrome on Android" is still open is what lets a person end it.
--
-- A log, like record_access_events: it carries no version and no audit trigger,
-- since it records what happened rather than a record anyone edits; and only the
-- person sees their own. Rows older than 90 days are dropped as new ones arrive.
create table edunexus.staff_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references edunexus.staff(user_id) on delete cascade,
  session_id uuid not null,
  device text not null check(length(device) between 1 and 80 and device !~ '[[:cntrl:]]'),
  assurance text not null check(assurance in ('aal1','aal2')),
  first_seen timestamptz not null default clock_timestamp(),
  last_seen timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  unique(user_id,session_id)
);
create index staff_session_recent_idx on edunexus.staff_sessions(user_id,last_seen desc);
alter table edunexus.staff_sessions enable row level security;
create policy own_sessions on edunexus.staff_sessions for select to edunexus_app using(user_id=edunexus.actor_id());
grant select on edunexus.staff_sessions to edunexus_app;

-- Ending your other sessions is a security action worth keeping, so the profile journal gains a kind for it.
alter table edunexus.staff_profile_events drop constraint staff_profile_events_kind_check;
alter table edunexus.staff_profile_events add constraint staff_profile_events_kind_check check(kind in ('profile','photo_set','photo_remove','photo_taken_down','sessions_ended'));

create function edunexus.note_staff_session(p_session uuid,p_device text,p_assurance text) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id();
begin
  if edunexus.actor_role() is null or p_session is null then return; end if;
  if p_assurance not in ('aal1','aal2') then raise exception using errcode='23514',message='Invalid assurance'; end if;
  insert into edunexus.staff_sessions as s(user_id,session_id,device,assurance)
  values(me,p_session,left(regexp_replace(coalesce(nullif(btrim(p_device),''),'Unknown browser'),'[[:cntrl:]]','','g'),80),p_assurance)
  on conflict(user_id,session_id) do update set last_seen=clock_timestamp(),assurance=excluded.assurance
    where s.last_seen<clock_timestamp()-interval '5 minutes' or s.assurance<>excluded.assurance;
  delete from edunexus.staff_sessions where user_id=me and last_seen<clock_timestamp()-interval '90 days';
end $$;

-- The caller's sessions, newest first, with the one making this request marked.
create function edunexus.read_my_sessions(p_current uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('device',s.device,'assurance',s.assurance,'first_seen',s.first_seen,
      'last_seen',s.last_seen,'ended_at',s.ended_at,'current',s.session_id=p_current) order by s.session_id=p_current desc,s.last_seen desc),'[]'::jsonb)
    from (select * from edunexus.staff_sessions where user_id=edunexus.actor_id() order by last_seen desc limit 20) s));
end $$;

-- Marks every other session ended, after the sign-in service has revoked them, and journals it.
create function edunexus.end_my_other_sessions(p_current uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id(); n integer;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  if p_current is null then raise exception using errcode='P2401',message='This session cannot be told apart from the others'; end if;
  with gone as (update edunexus.staff_sessions set ended_at=clock_timestamp() where user_id=me and session_id<>p_current and ended_at is null returning 1)
  select count(*) into n from gone;
  insert into edunexus.staff_profile_events(user_id,kind,before,after,reason,actor_user_id,request_id)
  values(me,'sessions_ended',null,jsonb_build_object('ended',n),'Signed out everywhere else.',me,nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('ended',n);
end $$;

revoke all on function edunexus.note_staff_session(uuid,text,text),edunexus.read_my_sessions(uuid),edunexus.end_my_other_sessions(uuid) from public;
grant execute on function edunexus.note_staff_session(uuid,text,text),edunexus.read_my_sessions(uuid),edunexus.end_my_other_sessions(uuid) to edunexus_app;
