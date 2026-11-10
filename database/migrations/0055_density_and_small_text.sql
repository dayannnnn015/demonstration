-- Two more of a person's own interface settings, asked for on 2026-11-05 and
-- saved exactly as 0043's and 0047's are: each person their own, journalled,
-- following the account from one computer to the next.
--
--   density    how much room a screen gives each row and each control. The
--              registers and the learner lists are long, and a clerk reading
--              them all day wants more on a screen while someone marking
--              attendance on a tablet wants fewer, larger rows.
--   text_size  gains 'small', which the earlier check did not allow. It is
--              offered below Standard and is nobody's default: the scale only
--              ever grew before, and a smaller one is a real need for a person
--              who wants more of a long table at once.
--
-- Nothing here reads or writes a learner record, and no permission changes: a
-- person may still only save their own, through `save_my_profile`.

alter table edunexus.staff_profiles
  add column density text not null default 'comfortable' check(density in ('compact','comfortable','spacious'));

-- The 0043 check is replaced rather than altered: a check constraint cannot be
-- widened in place, and the column's own name is the one Postgres gave it.
alter table edunexus.staff_profiles drop constraint staff_profiles_text_size_check;
alter table edunexus.staff_profiles add constraint staff_profiles_text_size_check
  check(text_size in ('small','standard','large','larger'));

grant update(density) on edunexus.staff_profiles to edunexus_app;

-- The view every read of a profile goes through, and what `profile_snapshot`
-- journals, since that is built from this.
create or replace function edunexus.staff_profile_view(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_build_object('avatar',p.avatar,'avatar_icon',p.avatar_icon,'avatar_tone',p.avatar_tone,'landing',p.landing,
      'text_size',p.text_size,'motion',p.motion,'theme',p.theme,'contrast',p.contrast,'links',p.links,'focus',p.focus,'targets',p.targets,
      'spacing',p.spacing,'typeface',p.typeface,'density',p.density,'version',p.version) from edunexus.staff_profiles p where p.user_id=p_user),
    jsonb_build_object('avatar','initials','avatar_icon',null,'avatar_tone','slate','landing',null,'text_size','standard','motion','system','theme','light',
      'contrast','system','links','standard','focus','standard','targets','standard','spacing','standard','typeface','standard','density','comfortable','version',0))
  ||jsonb_build_object('photo',(select jsonb_build_object('sha256',f.sha256,'thumb',translate(encode(f.thumb,'base64'),E'\n',''),'updated_at',f.updated_at)
      from edunexus.staff_photos f where f.user_id=p_user))
$$;

create or replace function edunexus.save_my_profile(p_version integer,p_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=edunexus.actor_id(); cur edunexus.staff_profiles; before jsonb; after jsonb; f jsonb:=p_fields;
begin
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff access required'; end if;
  if jsonb_typeof(f)<>'object' or f-array['avatar','avatar_icon','avatar_tone','landing','text_size','motion','theme','contrast','links','focus','targets','spacing','typeface','density']<>'{}'::jsonb then
    raise exception using errcode='23514',message='Invalid profile fields'; end if;
  perform pg_advisory_xact_lock(82412003,hashtext(me::text));
  select * into cur from edunexus.staff_profiles where user_id=me for update;
  if coalesce(cur.version,0) is distinct from p_version then raise exception using errcode='P0003',message='Your profile changed in another window'; end if;
  if f->>'avatar'='photo' and not exists(select 1 from edunexus.staff_photos where user_id=me) then
    raise exception using errcode='P2400',message='There is no photo to show'; end if;
  before:=edunexus.profile_snapshot(me);
  insert into edunexus.staff_profiles as p(user_id,avatar,avatar_icon,avatar_tone,landing,text_size,motion,theme,contrast,links,focus,targets,spacing,typeface,density)
  values(me,coalesce(f->>'avatar','initials'),f->>'avatar_icon',coalesce(f->>'avatar_tone','slate'),f->>'landing',coalesce(f->>'text_size','standard'),
    coalesce(f->>'motion','system'),coalesce(f->>'theme','light'),coalesce(f->>'contrast','system'),coalesce(f->>'links','standard'),coalesce(f->>'focus','standard'),
    coalesce(f->>'targets','standard'),coalesce(f->>'spacing','standard'),coalesce(f->>'typeface','standard'),coalesce(f->>'density','comfortable'))
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
    typeface=case when f ? 'typeface' then excluded.typeface else p.typeface end,
    density=case when f ? 'density' then excluded.density else p.density end;
  after:=edunexus.profile_snapshot(me);
  if before-'version'=after-'version' then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  perform edunexus.journal_profile(me,'profile',case when p_version=0 then null else before end,after,'Changed their own profile settings.');
  return edunexus.staff_profile_view(me);
end $$;
