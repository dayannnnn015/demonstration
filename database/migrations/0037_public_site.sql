-- The school's public front page: announcements and events the principal or
-- administrative officer writes and publishes, the school's own site details
-- (tagline, about, contact), and the public reads that serve them. A public
-- read returns only what the school chose to publish, plus the school profile
-- and its school-wide holidays and breaks: nothing about a learner, a mark, a
-- grade or a staff member beyond the school head the forms already print.
create table edunexus.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('news','event','advisory')),
  title text not null check(length(btrim(title)) between 3 and 160 and title !~ '[[:cntrl:]]'),
  summary text not null check(length(btrim(summary)) between 3 and 300 and summary !~ '[[:cntrl:]]'),
  body text not null default '' check(length(body)<=6000),
  event_on date, event_ends_on date,
  event_time text check(event_time is null or (length(btrim(event_time)) between 1 and 60 and event_time !~ '[[:cntrl:]]')),
  venue text check(venue is null or (length(btrim(venue)) between 1 and 120 and venue !~ '[[:cntrl:]]')),
  pinned boolean not null default false,
  status text not null default 'draft' check(status in ('draft','published','archived')),
  published_at timestamptz,
  created_by uuid not null references edunexus.staff(user_id) on delete restrict,
  updated_by uuid not null references edunexus.staff(user_id) on delete restrict,
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check((kind='event')=(event_on is not null)),
  check(event_ends_on is null or (event_on is not null and event_ends_on>=event_on)),
  check(status<>'published' or published_at is not null)
);
create index announcement_public_idx on edunexus.announcements(pinned desc,published_at desc) where status='published';
create index announcement_created_by_idx on edunexus.announcements(created_by);
create index announcement_updated_by_idx on edunexus.announcements(updated_by);

-- One row: what the school says about itself on its front page. Empty until the school writes it.
create table edunexus.site_settings (
  id smallint primary key default 1 check(id=1),
  tagline text check(tagline is null or (length(btrim(tagline)) between 3 and 200 and tagline !~ '[[:cntrl:]]')),
  about text check(about is null or length(btrim(about)) between 3 and 3000),
  mission text check(mission is null or length(btrim(mission)) between 3 and 1500),
  vision text check(vision is null or length(btrim(vision)) between 3 and 1500),
  phone text check(phone is null or (length(btrim(phone)) between 3 and 60 and phone !~ '[[:cntrl:]]')),
  email text check(email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  office_hours text check(office_hours is null or (length(btrim(office_hours)) between 3 and 120 and office_hours !~ '[[:cntrl:]]')),
  facebook_url text check(facebook_url is null or facebook_url ~ '^https://(www\.|m\.)?facebook\.com/[^[:space:]]{1,200}$'),
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
insert into edunexus.site_settings(id) values(1);

create table edunexus.site_events (
  id bigint generated always as identity primary key,
  entity text not null check(entity in ('announcement','site')),
  announcement_id uuid references edunexus.announcements(id) on delete restrict,
  kind text not null check(kind in ('create','update','publish','unpublish','archive','settings')),
  before jsonb, after jsonb not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check((entity='announcement')=(announcement_id is not null))
);
create index site_event_announcement_idx on edunexus.site_events(announcement_id,id desc);
create index site_event_actor_idx on edunexus.site_events(actor_user_id);

alter table edunexus.announcements enable row level security;
alter table edunexus.site_settings enable row level security;
alter table edunexus.site_events enable row level security;
-- Staff may read what is published; managers read drafts and the journal too.
create policy scoped_read on edunexus.announcements for select to edunexus_app using(edunexus.is_manager() or (status='published' and edunexus.actor_role() is not null));
create policy staff_read on edunexus.site_settings for select to edunexus_app using(edunexus.actor_role() is not null);
create policy manager_read on edunexus.site_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.announcements,edunexus.site_settings,edunexus.site_events to edunexus_app;
create trigger version_record before update on edunexus.announcements for each row execute function edunexus.version_record();
create trigger version_record before update on edunexus.site_settings for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.announcements for each row execute function edunexus.audit_record();
create trigger audit_record after insert or update on edunexus.site_settings for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.site_events for each row execute function edunexus.audit_record();

create function edunexus.site_reason(p_reason text) returns text language plpgsql immutable set search_path='' as $$
begin
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid reason'; end if;
  return btrim(p_reason);
end $$;

create function edunexus.announcement_view(a edunexus.announcements) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('id',a.id,'kind',a.kind,'title',a.title,'summary',a.summary,'body',a.body,'event_on',a.event_on,'event_ends_on',a.event_ends_on,
    'event_time',a.event_time,'venue',a.venue,'pinned',a.pinned,'status',a.status,'published_at',a.published_at,'version',a.version,'updated_at',a.updated_at)
$$;

-- Creates an announcement (p_id null, version 0) or changes one, always as a draft change of its fields; publishing is separate.
create function edunexus.save_announcement(p_id uuid,p_version integer,p_fields jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a edunexus.announcements; before jsonb; reason text:=edunexus.site_reason(p_reason);
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if jsonb_typeof(p_fields)<>'object' or p_fields-array['kind','title','summary','body','event_on','event_ends_on','event_time','venue','pinned']<>'{}'::jsonb then
    raise exception using errcode='23514',message='Invalid announcement fields'; end if;
  if p_id is null then
    if p_version is distinct from 0 then raise exception using errcode='P0003',message='This announcement changed while you were editing'; end if;
    insert into edunexus.announcements(kind,title,summary,body,event_on,event_ends_on,event_time,venue,pinned,created_by,updated_by)
    values(p_fields->>'kind',btrim(p_fields->>'title'),btrim(p_fields->>'summary'),coalesce(p_fields->>'body',''),(p_fields->>'event_on')::date,(p_fields->>'event_ends_on')::date,
      nullif(btrim(p_fields->>'event_time'),''),nullif(btrim(p_fields->>'venue'),''),coalesce((p_fields->>'pinned')::boolean,false),edunexus.actor_id(),edunexus.actor_id()) returning * into a;
    insert into edunexus.site_events(entity,announcement_id,kind,before,after,reason,actor_user_id,request_id)
      values('announcement',a.id,'create',null,edunexus.announcement_view(a),reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
    return edunexus.announcement_view(a);
  end if;
  select * into a from edunexus.announcements where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Announcement not found'; end if;
  if a.version is distinct from p_version then raise exception using errcode='P0003',message='This announcement changed while you were editing'; end if;
  if a.status='archived' then raise exception using errcode='P2200',message='An archived announcement is kept as it was'; end if;
  before:=edunexus.announcement_view(a);
  update edunexus.announcements set kind=p_fields->>'kind',title=btrim(p_fields->>'title'),summary=btrim(p_fields->>'summary'),body=coalesce(p_fields->>'body',''),
    event_on=(p_fields->>'event_on')::date,event_ends_on=(p_fields->>'event_ends_on')::date,event_time=nullif(btrim(p_fields->>'event_time'),''),
    venue=nullif(btrim(p_fields->>'venue'),''),pinned=coalesce((p_fields->>'pinned')::boolean,false),updated_by=edunexus.actor_id() where id=p_id returning * into a;
  if before-array['version','updated_at']=edunexus.announcement_view(a)-array['version','updated_at'] then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.site_events(entity,announcement_id,kind,before,after,reason,actor_user_id,request_id)
    values('announcement',a.id,'update',before,edunexus.announcement_view(a),reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return edunexus.announcement_view(a);
end $$;

-- Publish puts it on the front page; unpublish takes it back to a draft; archive retires it for good.
create function edunexus.set_announcement_status(p_id uuid,p_version integer,p_action text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a edunexus.announcements; before jsonb; reason text:=edunexus.site_reason(p_reason);
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_action not in ('publish','unpublish','archive') then raise exception using errcode='23514',message='Invalid action'; end if;
  select * into a from edunexus.announcements where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Announcement not found'; end if;
  if a.version is distinct from p_version then raise exception using errcode='P0003',message='This announcement changed while you were editing'; end if;
  if a.status='archived' or (p_action='publish' and a.status='published') or (p_action='unpublish' and a.status<>'published') then
    raise exception using errcode='P2201',message='The announcement is not in a state that allows this'; end if;
  before:=edunexus.announcement_view(a);
  update edunexus.announcements set status=case p_action when 'publish' then 'published' when 'unpublish' then 'draft' else 'archived' end,
    published_at=case when p_action='publish' then coalesce(published_at,now()) else published_at end,updated_by=edunexus.actor_id()
    where id=p_id returning * into a;
  insert into edunexus.site_events(entity,announcement_id,kind,before,after,reason,actor_user_id,request_id)
    values('announcement',a.id,p_action,before,edunexus.announcement_view(a),reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return edunexus.announcement_view(a);
end $$;

create function edunexus.save_site_settings(p_version integer,p_fields jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.site_settings; before jsonb; reason text:=edunexus.site_reason(p_reason);
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if jsonb_typeof(p_fields)<>'object' or p_fields-array['tagline','about','mission','vision','phone','email','office_hours','facebook_url']<>'{}'::jsonb then
    raise exception using errcode='23514',message='Invalid site fields'; end if;
  select * into s from edunexus.site_settings where id=1 for update;
  if s.version is distinct from p_version then raise exception using errcode='P0003',message='The site details changed while you were editing'; end if;
  before:=to_jsonb(s)-array['id','created_at','updated_at','version'];
  update edunexus.site_settings set tagline=nullif(btrim(p_fields->>'tagline'),''),about=nullif(btrim(p_fields->>'about'),''),mission=nullif(btrim(p_fields->>'mission'),''),
    vision=nullif(btrim(p_fields->>'vision'),''),phone=nullif(btrim(p_fields->>'phone'),''),email=nullif(btrim(p_fields->>'email'),''),
    office_hours=nullif(btrim(p_fields->>'office_hours'),''),facebook_url=nullif(btrim(p_fields->>'facebook_url'),'') where id=1 returning * into s;
  if before=to_jsonb(s)-array['id','created_at','updated_at','version'] then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.site_events(entity,announcement_id,kind,before,after,reason,actor_user_id,request_id)
    values('site',null,'settings',before,to_jsonb(s)-array['id','created_at','updated_at','version'],reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return to_jsonb(s)-array['id','created_at','updated_at'];
end $$;

-- The managers' list: every announcement but the archived, unless asked for.
create function edunexus.read_announcements(p_archived boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(edunexus.announcement_view(a)||jsonb_build_object('updated_by',(select display_name from edunexus.staff where user_id=a.updated_by))
      order by a.status='published' desc,a.pinned desc,coalesce(a.published_at,a.updated_at) desc),'[]'::jsonb)
    from edunexus.announcements a where p_archived or a.status<>'archived'),
    'settings',(select to_jsonb(s)-array['id','created_at','updated_at'] from edunexus.site_settings s where id=1));
end $$;

-- The front page, for anyone: what the school published, its profile, its terms, and its school-wide days without classes ahead.
create function edunexus.read_public_site() returns jsonb language sql stable security definer set search_path='' as $$
  with y as (select * from edunexus.academic_years where status='active' order by start_year desc limit 1),
       today as (select (now() at time zone 'Asia/Manila')::date d)
  select jsonb_build_object(
    'school',(select jsonb_build_object('name',p.name,'school_code',p.school_code,'address',p.address,'region',p.region,'division',p.division,'district',p.district,
      'school_head_name',p.school_head_name,'school_head_position',p.school_head_position) from edunexus.school_profile p where id=1),
    'site',(select to_jsonb(s)-array['id','created_at','updated_at','version'] from edunexus.site_settings s where id=1),
    'seeded',exists(select 1 from edunexus.seeded_data_notice),
    'today',(select d from today),
    'school_year',(select jsonb_build_object('start_year',y.start_year,'starts_on',y.starts_on,'ends_on',y.ends_on,
      'terms',(select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'starts_on',p.starts_on,'ends_on',p.ends_on) order by p.ordinal),'[]'::jsonb)
        from edunexus.reporting_periods p where p.academic_year_id=y.id)) from y),
    'closed_days',(select coalesce(jsonb_agg(jsonb_build_object('day_on',d.day_on,'day_type',d.day_type,'label',d.label) order by d.day_on),'[]'::jsonb)
      from edunexus.instructional_days d join y on y.id=d.academic_year_id
      where d.section_id is null and d.configured and d.day_type in ('holiday','school_break','suspension')
        and d.day_on between (select d from today) and (select d from today)+120),
    'announcements',(select coalesce(jsonb_agg(edunexus.announcement_view(a)-array['status','version','updated_at'] order by a.pinned desc,a.published_at desc),'[]'::jsonb)
      from (select * from edunexus.announcements where status='published' order by pinned desc,published_at desc limit 60) a))
$$;

revoke all on function edunexus.site_reason(text),edunexus.announcement_view(edunexus.announcements),edunexus.save_announcement(uuid,integer,jsonb,text),
  edunexus.set_announcement_status(uuid,integer,text,text),edunexus.save_site_settings(integer,jsonb,text),edunexus.read_announcements(boolean),edunexus.read_public_site() from public;
grant execute on function edunexus.save_announcement(uuid,integer,jsonb,text),edunexus.set_announcement_status(uuid,integer,text,text),
  edunexus.save_site_settings(integer,jsonb,text),edunexus.read_announcements(boolean),edunexus.read_public_site() to edunexus_app;
