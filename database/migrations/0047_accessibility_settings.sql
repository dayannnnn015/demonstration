-- Accessibility settings on My profile (the group's notes of 28 October, N6), beside 0043's text size, motion
-- and theme, and saved the same way: each person their own, journalled, following the account from one computer
-- to the next. Contrast defaults to the device's own setting, as motion does; the rest default to the design as it is.
alter table edunexus.staff_profiles
  add column contrast text not null default 'system' check(contrast in ('system','more')),
  add column links text not null default 'standard' check(links in ('standard','underline')),
  add column focus text not null default 'standard' check(focus in ('standard','strong')),
  add column targets text not null default 'standard' check(targets in ('standard','large')),
  add column spacing text not null default 'standard' check(spacing in ('standard','relaxed')),
  add column typeface text not null default 'standard' check(typeface in ('standard','readable'));

create or replace function edunexus.staff_profile_view(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('avatar',p.avatar,'avatar_icon',p.avatar_icon,'avatar_tone',p.avatar_tone,'landing',p.landing,
      'text_size',p.text_size,'motion',p.motion,'theme',p.theme,'contrast',p.contrast,'links',p.links,'focus',p.focus,'targets',p.targets,
      'spacing',p.spacing,'typeface',p.typeface,'version',p.version) from edunexus.staff_profiles p where p.user_id=p_user),
    jsonb_build_object('avatar','initials','avatar_icon',null,'avatar_tone','slate','landing',null,'text_size','standard','motion','system','theme','light',
      'contrast','system','links','standard','focus','standard','targets','standard','spacing','standard','typeface','standard','version',0))
  ||jsonb_build_object('photo',(select jsonb_build_object('sha256',f.sha256,'thumb',translate(encode(f.thumb,'base64'),E'\n',''),'updated_at',f.updated_at)
      from edunexus.staff_photos f where f.user_id=p_user))
$$;

create or replace function edunexus.save_my_profile(p_version integer,p_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id(); cur edunexus.staff_profiles; before jsonb; after jsonb; f jsonb:=p_fields;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  if jsonb_typeof(f)<>'object' or f-array['avatar','avatar_icon','avatar_tone','landing','text_size','motion','theme','contrast','links','focus','targets','spacing','typeface']<>'{}'::jsonb then
    raise exception using errcode='23514',message='Invalid profile fields'; end if;
  perform pg_advisory_xact_lock(82412003,hashtext(me::text));
  select * into cur from edunexus.staff_profiles where user_id=me for update;
  if coalesce(cur.version,0) is distinct from p_version then raise exception using errcode='P0003',message='Your profile changed in another window'; end if;
  if f->>'avatar'='photo' and not exists(select 1 from edunexus.staff_photos where user_id=me) then
    raise exception using errcode='P2400',message='There is no photo to show'; end if;
  before:=edunexus.profile_snapshot(me);
  insert into edunexus.staff_profiles as p(user_id,avatar,avatar_icon,avatar_tone,landing,text_size,motion,theme,contrast,links,focus,targets,spacing,typeface)
  values(me,coalesce(f->>'avatar','initials'),f->>'avatar_icon',coalesce(f->>'avatar_tone','slate'),f->>'landing',coalesce(f->>'text_size','standard'),
    coalesce(f->>'motion','system'),coalesce(f->>'theme','light'),coalesce(f->>'contrast','system'),coalesce(f->>'links','standard'),coalesce(f->>'focus','standard'),
    coalesce(f->>'targets','standard'),coalesce(f->>'spacing','standard'),coalesce(f->>'typeface','standard'))
  on conflict(user_id) do update set
    avatar=case when f ? 'avatar' then excluded.avatar else p.avatar end,
    avatar_icon=case when f ? 'avatar_icon' then excluded.avatar_icon else p.avatar_icon end,
    avatar_tone=case when f ? 'avatar_tone' then excluded.avatar_tone else p.avatar_tone end,
    landing=case when f ? 'landing' then excluded.landing else p.landing end,
    text_size=case when f ? 'text_size' then excluded.text_size else p.text_size end,
    motion=case when f ? 'motion' then excluded.motion else p.motion end,
    theme=case when f ? 'theme' then excluded.theme else p.theme end,
    contrast=case when f ? 'contrast' then excluded.contrast else p.contrast end,
    links=case when f ? 'links' then excluded.links else p.links end,
    focus=case when f ? 'focus' then excluded.focus else p.focus end,
    targets=case when f ? 'targets' then excluded.targets else p.targets end,
    spacing=case when f ? 'spacing' then excluded.spacing else p.spacing end,
    typeface=case when f ? 'typeface' then excluded.typeface else p.typeface end;
  after:=edunexus.profile_snapshot(me);
  if before-'version'=after-'version' then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  perform edunexus.journal_profile(me,'profile',case when p_version=0 then null else before end,after,'Changed their own profile settings.');
  return edunexus.staff_profile_view(me);
end $$;

-- A manager's staff list still draws only the face: none of a person's settings travel with it.
create or replace function edunexus.read_staff_avatars(p_users uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if cardinality(p_users)>100 then raise exception using errcode='23514',message='Too many people at once'; end if;
  return (select coalesce(jsonb_object_agg(s.user_id,edunexus.staff_profile_view(s.user_id)
      -array['landing','text_size','motion','theme','contrast','links','focus','targets','spacing','typeface']),'{}'::jsonb)
    from edunexus.staff s where s.user_id=any(p_users));
end $$;
