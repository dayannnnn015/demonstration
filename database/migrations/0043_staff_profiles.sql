-- A staff member's own profile: how they appear in the workspace (initials, a
-- drawn icon or their photo) and the interface preferences that follow their
-- account rather than the machine. Each person writes only their own; a
-- principal or administrative officer may take down a photo with a reason, as
-- they manage that account (an administrative officer manages teachers only).
--
-- A photo is held here, not in a storage bucket: 33 staff at under 140 KB each
-- is small, and a row keeps it under the same row policy, journal and backup as
-- every other record. The browser re-encodes it and the API strips what a
-- camera leaves in the file, so no location or device detail is ever stored.
-- Nothing in the workspace loads an image: it is drawn on a canvas from these
-- bytes, so the content policy's img-src stays 'self' (settled 2026-10-28).
create table edunexus.staff_profiles (
  user_id uuid primary key references edunexus.staff(user_id) on delete cascade,
  avatar text not null default 'initials' check(avatar in ('initials','icon','photo')),
  avatar_icon text check(avatar_icon in ('book','pencil','globe','leaf','sun','star','music','flask','ball','heart','compass','palette')),
  avatar_tone text not null default 'slate' check(avatar_tone in ('slate','blue','green','ochre','plum','teal')),
  landing text check(landing ~ '^[a-z0-9-]{1,40}$'),
  text_size text not null default 'standard' check(text_size in ('standard','large','larger')),
  motion text not null default 'system' check(motion in ('system','reduce')),
  theme text not null default 'light' check(theme in ('light','dark','system')),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(avatar<>'icon' or avatar_icon is not null)
);

-- The full image for the profile page, and a thumbnail small enough to travel with every list that shows a face.
create table edunexus.staff_photos (
  user_id uuid primary key references edunexus.staff(user_id) on delete cascade,
  image bytea not null check(octet_length(image) between 200 and 143360),
  thumb bytea not null check(octet_length(thumb) between 100 and 20480),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check(width between 64 and 1024),height integer not null check(height between 64 and 1024),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table edunexus.staff_profile_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references edunexus.staff(user_id) on delete restrict,
  kind text not null check(kind in ('profile','photo_set','photo_remove','photo_taken_down')),
  -- A photo's bytes are never copied here: its hash and size say which one it was, and a removed photo is gone.
  before jsonb, after jsonb not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid,
  recorded_at timestamptz not null default clock_timestamp()
);
create index staff_profile_event_user_idx on edunexus.staff_profile_events(user_id,id desc);
create index staff_profile_event_actor_idx on edunexus.staff_profile_events(actor_user_id);

alter table edunexus.staff_profiles enable row level security;
alter table edunexus.staff_photos enable row level security;
alter table edunexus.staff_profile_events enable row level security;
create policy own_or_manager on edunexus.staff_profiles for select to edunexus_app using(user_id=edunexus.actor_id() or edunexus.is_manager());
create policy own_or_manager on edunexus.staff_photos for select to edunexus_app using(user_id=edunexus.actor_id() or edunexus.is_manager());
create policy own_or_manager on edunexus.staff_profile_events for select to edunexus_app using(user_id=edunexus.actor_id() or edunexus.is_manager());
grant select on edunexus.staff_profiles,edunexus.staff_photos,edunexus.staff_profile_events to edunexus_app;
create trigger version_record before update on edunexus.staff_profiles for each row execute function edunexus.version_record();
create trigger version_record before update on edunexus.staff_photos for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.staff_profiles for each row execute function edunexus.audit_record();
create trigger audit_record after insert or update on edunexus.staff_photos for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.staff_profile_events for each row execute function edunexus.audit_record();

-- PostgreSQL wraps base64 every 76 characters; a browser's decoder refuses the newlines, so they are taken out.
-- What a person's profile looks like with nothing saved yet: version 0, initials, the defaults.
create function edunexus.staff_profile_view(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('avatar',p.avatar,'avatar_icon',p.avatar_icon,'avatar_tone',p.avatar_tone,'landing',p.landing,
      'text_size',p.text_size,'motion',p.motion,'theme',p.theme,'version',p.version) from edunexus.staff_profiles p where p.user_id=p_user),
    jsonb_build_object('avatar','initials','avatar_icon',null,'avatar_tone','slate','landing',null,'text_size','standard','motion','system','theme','light','version',0))
  ||jsonb_build_object('photo',(select jsonb_build_object('sha256',f.sha256,'thumb',translate(encode(f.thumb,'base64'),E'\n',''),'updated_at',f.updated_at)
      from edunexus.staff_photos f where f.user_id=p_user))
$$;

-- Whether the actor may manage this account's photo: their own, or as its manager, never an inactive actor.
create function edunexus.may_manage_profile(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select edunexus.actor_role() is not null and (p_user=edunexus.actor_id() or edunexus.actor_role()='principal'
    or (edunexus.actor_role()='administrative_officer' and exists(select 1 from edunexus.staff where user_id=p_user and role='teacher')))
$$;

create function edunexus.journal_profile(p_user uuid,p_kind text,p_before jsonb,p_after jsonb,p_reason text) returns void language sql security definer set search_path='' as $$
  insert into edunexus.staff_profile_events(user_id,kind,before,after,reason,actor_user_id,request_id)
  values(p_user,p_kind,p_before,p_after,p_reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid)
$$;

-- What the journal keeps of a profile: the settings, and which photo by its hash, never the picture.
create function edunexus.profile_snapshot(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select (edunexus.staff_profile_view(p_user)-'photo')||jsonb_build_object('photo',(select jsonb_build_object('sha256',f.sha256,'bytes',octet_length(f.image),'width',f.width,'height',f.height)
    from edunexus.staff_photos f where f.user_id=p_user))
$$;

-- The caller's own profile page: who the school has them as, the sections they advise, and their settings.
create function edunexus.read_my_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s edunexus.staff;
begin
  select * into s from edunexus.staff where user_id=edunexus.actor_id() and active;
  if not found then raise exception using errcode='42501',message='Active staff access required'; end if;
  return jsonb_build_object('user_id',s.user_id,'display_name',s.display_name,'role',s.role,'position',s.position,'specialization',s.specialization,
    'profile',edunexus.staff_profile_view(s.user_id),
    'advises',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'grade_level',x.grade_level,'name',x.name,'start_year',y.start_year,'year_status',y.status)
        order by y.start_year desc,x.grade_level,x.name),'[]'::jsonb)
      from edunexus.sections x join edunexus.academic_years y on y.id=x.academic_year_id where x.adviser_user_id=s.user_id and y.status in ('draft','active')));
end $$;

-- Creates the row on first save (version 0) or changes it. The reason is the system's own: a person choosing their
-- own colour or text size is not asked to justify it, and the journal still says who changed what and when.
create function edunexus.save_my_profile(p_version integer,p_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id(); cur edunexus.staff_profiles; before jsonb; after jsonb; f jsonb:=p_fields;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  if jsonb_typeof(f)<>'object' or f-array['avatar','avatar_icon','avatar_tone','landing','text_size','motion','theme']<>'{}'::jsonb then
    raise exception using errcode='23514',message='Invalid profile fields'; end if;
  perform pg_advisory_xact_lock(82412003,hashtext(me::text));
  select * into cur from edunexus.staff_profiles where user_id=me for update;
  if coalesce(cur.version,0) is distinct from p_version then raise exception using errcode='P0003',message='Your profile changed in another window'; end if;
  if f->>'avatar'='photo' and not exists(select 1 from edunexus.staff_photos where user_id=me) then
    raise exception using errcode='P2400',message='There is no photo to show'; end if;
  before:=edunexus.profile_snapshot(me);
  insert into edunexus.staff_profiles as p(user_id,avatar,avatar_icon,avatar_tone,landing,text_size,motion,theme)
  values(me,coalesce(f->>'avatar','initials'),f->>'avatar_icon',coalesce(f->>'avatar_tone','slate'),f->>'landing',coalesce(f->>'text_size','standard'),
    coalesce(f->>'motion','system'),coalesce(f->>'theme','light'))
  on conflict(user_id) do update set
    avatar=case when f ? 'avatar' then excluded.avatar else p.avatar end,
    avatar_icon=case when f ? 'avatar_icon' then excluded.avatar_icon else p.avatar_icon end,
    avatar_tone=case when f ? 'avatar_tone' then excluded.avatar_tone else p.avatar_tone end,
    landing=case when f ? 'landing' then excluded.landing else p.landing end,
    text_size=case when f ? 'text_size' then excluded.text_size else p.text_size end,
    motion=case when f ? 'motion' then excluded.motion else p.motion end,
    theme=case when f ? 'theme' then excluded.theme else p.theme end;
  after:=edunexus.profile_snapshot(me);
  if before-'version'=after-'version' then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  perform edunexus.journal_profile(me,'profile',case when p_version=0 then null else before end,after,'Changed their own profile settings.');
  return edunexus.staff_profile_view(me);
end $$;

-- Sets or replaces the caller's photo and shows it. The API has already checked the image and removed its metadata.
create function edunexus.set_my_photo(p_version integer,p_image bytea,p_thumb bytea,p_sha256 text,p_width integer,p_height integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id(); cur edunexus.staff_profiles; before jsonb;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  perform pg_advisory_xact_lock(82412003,hashtext(me::text));
  select * into cur from edunexus.staff_profiles where user_id=me for update;
  if coalesce(cur.version,0) is distinct from p_version then raise exception using errcode='P0003',message='Your profile changed in another window'; end if;
  if exists(select 1 from edunexus.staff_photos where user_id=me and sha256=p_sha256) then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  before:=edunexus.profile_snapshot(me);
  insert into edunexus.staff_photos as f(user_id,image,thumb,sha256,width,height) values(me,p_image,p_thumb,p_sha256,p_width,p_height)
  on conflict(user_id) do update set image=excluded.image,thumb=excluded.thumb,sha256=excluded.sha256,width=excluded.width,height=excluded.height;
  insert into edunexus.staff_profiles as p(user_id,avatar) values(me,'photo') on conflict(user_id) do update set avatar='photo';
  perform edunexus.journal_profile(me,'photo_set',before,edunexus.profile_snapshot(me),'Changed their own profile photo.');
  return edunexus.staff_profile_view(me);
end $$;

-- Removes a photo for good. One's own (p_reason null, the system's words) or, as that account's manager, someone
-- else's with a written reason. The avatar falls back to initials; an icon chosen earlier is kept for the next time.
create function edunexus.remove_staff_photo(p_user uuid,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cur edunexus.staff_profiles; before jsonb; own boolean:=p_user=edunexus.actor_id(); reason text;
begin
  if not edunexus.may_manage_profile(p_user) then raise exception using errcode='42501',message='Only this person or their manager can remove the photo'; end if;
  reason:=case when own and p_reason is null then 'Removed their own profile photo.' else edunexus.site_reason(p_reason) end;
  perform pg_advisory_xact_lock(82412003,hashtext(p_user::text));
  select * into cur from edunexus.staff_profiles where user_id=p_user for update;
  if coalesce(cur.version,0) is distinct from p_version then raise exception using errcode='P0003',message='The profile changed while you were reading it'; end if;
  if not exists(select 1 from edunexus.staff_photos where user_id=p_user) then raise exception using errcode='P2400',message='There is no photo to remove'; end if;
  before:=edunexus.profile_snapshot(p_user);
  delete from edunexus.staff_photos where user_id=p_user;
  update edunexus.staff_profiles set avatar='initials' where user_id=p_user and avatar='photo';
  perform edunexus.journal_profile(p_user,case when own then 'photo_remove' else 'photo_taken_down' end,before,edunexus.profile_snapshot(p_user),reason);
  return edunexus.staff_profile_view(p_user);
end $$;

-- The full image, for the profile page and a manager's view of the account. Not for an inactive account's photo.
create function edunexus.read_staff_photo(p_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
  if not (p_user=edunexus.actor_id() and edunexus.actor_role() is not null) and not edunexus.is_manager() then
    raise exception using errcode='42501',message='Only this person or a manager can see the photo'; end if;
  select jsonb_build_object('user_id',f.user_id,'image',translate(encode(f.image,'base64'),E'\n',''),'sha256',f.sha256,'width',f.width,'height',f.height,'updated_at',f.updated_at) into r
    from edunexus.staff_photos f join edunexus.staff s on s.user_id=f.user_id and s.active where f.user_id=p_user;
  if r is null then raise exception using errcode='P0002',message='No photo'; end if;
  return r;
end $$;

-- The managers' staff list draws each face: the settings and the thumbnail, never the full image.
create function edunexus.read_staff_avatars(p_users uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if cardinality(p_users)>100 then raise exception using errcode='23514',message='Too many people at once'; end if;
  return (select coalesce(jsonb_object_agg(s.user_id,edunexus.staff_profile_view(s.user_id)-array['landing','text_size','motion','theme']),'{}'::jsonb)
    from edunexus.staff s where s.user_id=any(p_users));
end $$;

revoke all on function edunexus.staff_profile_view(uuid),edunexus.may_manage_profile(uuid),edunexus.journal_profile(uuid,text,jsonb,jsonb,text),
  edunexus.profile_snapshot(uuid),edunexus.read_my_profile(),edunexus.save_my_profile(integer,jsonb),
  edunexus.set_my_photo(integer,bytea,bytea,text,integer,integer),edunexus.remove_staff_photo(uuid,integer,text),
  edunexus.read_staff_photo(uuid),edunexus.read_staff_avatars(uuid[]) from public;
grant execute on function edunexus.read_my_profile(),edunexus.save_my_profile(integer,jsonb),
  edunexus.set_my_photo(integer,bytea,bytea,text,integer,integer),edunexus.remove_staff_photo(uuid,integer,text),
  edunexus.read_staff_photo(uuid),edunexus.read_staff_avatars(uuid[]) to edunexus_app;
