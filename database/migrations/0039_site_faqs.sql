-- Questions parents and guardians ask, answered on the school's front page.
-- The principal or administrative officer writes each one as a draft and
-- publishes it, as with announcements: the front page shows only what the
-- school published (settled 2026-10-10), so nothing here is supplied by
-- EDUNEXUS. Its own journal rather than a widened site_events, so 0037's
-- checks stay as they were applied.
create table edunexus.site_faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null check(length(btrim(question)) between 3 and 200 and question !~ '[[:cntrl:]]'),
  answer text not null check(length(btrim(answer)) between 3 and 3000),
  position integer not null default 100 check(position between 1 and 999),
  status text not null default 'draft' check(status in ('draft','published','archived')),
  published_at timestamptz,
  created_by uuid not null references edunexus.staff(user_id) on delete restrict,
  updated_by uuid not null references edunexus.staff(user_id) on delete restrict,
  version integer not null default 1 check(version>=1),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(status<>'published' or published_at is not null)
);
create index site_faq_public_idx on edunexus.site_faqs(position,published_at) where status='published';
create index site_faq_created_by_idx on edunexus.site_faqs(created_by);
create index site_faq_updated_by_idx on edunexus.site_faqs(updated_by);

create table edunexus.site_faq_events (
  id bigint generated always as identity primary key,
  faq_id uuid not null references edunexus.site_faqs(id) on delete restrict,
  kind text not null check(kind in ('create','update','publish','unpublish','archive')),
  before jsonb, after jsonb not null,
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index site_faq_event_faq_idx on edunexus.site_faq_events(faq_id,id desc);
create index site_faq_event_actor_idx on edunexus.site_faq_events(actor_user_id);

alter table edunexus.site_faqs enable row level security;
alter table edunexus.site_faq_events enable row level security;
create policy scoped_read on edunexus.site_faqs for select to edunexus_app using(edunexus.is_manager() or (status='published' and edunexus.actor_role() is not null));
create policy manager_read on edunexus.site_faq_events for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.site_faqs,edunexus.site_faq_events to edunexus_app;
create trigger version_record before update on edunexus.site_faqs for each row execute function edunexus.version_record();
create trigger audit_record after insert or update on edunexus.site_faqs for each row execute function edunexus.audit_record();
create trigger audit_record after insert on edunexus.site_faq_events for each row execute function edunexus.audit_record();

create function edunexus.site_faq_view(q edunexus.site_faqs) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('id',q.id,'question',q.question,'answer',q.answer,'position',q.position,'status',q.status,'published_at',q.published_at,'version',q.version,'updated_at',q.updated_at)
$$;

-- Creates a question (p_id null, version 0) or changes one; publishing is separate.
create function edunexus.save_site_faq(p_id uuid,p_version integer,p_fields jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q edunexus.site_faqs; before jsonb; reason text:=edunexus.site_reason(p_reason);
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if jsonb_typeof(p_fields)<>'object' or p_fields-array['question','answer','position']<>'{}'::jsonb then
    raise exception using errcode='23514',message='Invalid question fields'; end if;
  if p_id is null then
    if p_version is distinct from 0 then raise exception using errcode='P0003',message='This question changed while you were editing'; end if;
    insert into edunexus.site_faqs(question,answer,position,created_by,updated_by)
    values(btrim(p_fields->>'question'),btrim(p_fields->>'answer'),coalesce((p_fields->>'position')::integer,100),edunexus.actor_id(),edunexus.actor_id()) returning * into q;
    insert into edunexus.site_faq_events(faq_id,kind,before,after,reason,actor_user_id,request_id)
      values(q.id,'create',null,edunexus.site_faq_view(q),reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
    return edunexus.site_faq_view(q);
  end if;
  select * into q from edunexus.site_faqs where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Question not found'; end if;
  if q.version is distinct from p_version then raise exception using errcode='P0003',message='This question changed while you were editing'; end if;
  if q.status='archived' then raise exception using errcode='P2300',message='An archived question is kept as it was'; end if;
  before:=edunexus.site_faq_view(q);
  update edunexus.site_faqs set question=btrim(p_fields->>'question'),answer=btrim(p_fields->>'answer'),position=coalesce((p_fields->>'position')::integer,100),
    updated_by=edunexus.actor_id() where id=p_id returning * into q;
  if before-array['version','updated_at']=edunexus.site_faq_view(q)-array['version','updated_at'] then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.site_faq_events(faq_id,kind,before,after,reason,actor_user_id,request_id)
    values(q.id,'update',before,edunexus.site_faq_view(q),reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return edunexus.site_faq_view(q);
end $$;

-- Publish puts it on the front page; unpublish takes it back to a draft; archive retires it for good.
create function edunexus.set_site_faq_status(p_id uuid,p_version integer,p_action text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q edunexus.site_faqs; before jsonb; reason text:=edunexus.site_reason(p_reason);
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  if p_action not in ('publish','unpublish','archive') then raise exception using errcode='23514',message='Invalid action'; end if;
  select * into q from edunexus.site_faqs where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Question not found'; end if;
  if q.version is distinct from p_version then raise exception using errcode='P0003',message='This question changed while you were editing'; end if;
  if q.status='archived' or (p_action='publish' and q.status='published') or (p_action='unpublish' and q.status<>'published') then
    raise exception using errcode='P2301',message='The question is not in a state that allows this'; end if;
  before:=edunexus.site_faq_view(q);
  update edunexus.site_faqs set status=case p_action when 'publish' then 'published' when 'unpublish' then 'draft' else 'archived' end,
    published_at=case when p_action='publish' then coalesce(published_at,now()) else published_at end,updated_by=edunexus.actor_id()
    where id=p_id returning * into q;
  insert into edunexus.site_faq_events(faq_id,kind,before,after,reason,actor_user_id,request_id)
    values(q.id,p_action,before,edunexus.site_faq_view(q),reason,edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return edunexus.site_faq_view(q);
end $$;

-- The managers' list: every question but the archived, unless asked for, in the order the front page shows them.
create function edunexus.read_site_faqs(p_archived boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(edunexus.site_faq_view(q)||jsonb_build_object('updated_by',(select display_name from edunexus.staff where user_id=q.updated_by))
      order by q.status='archived',q.position,q.created_at),'[]'::jsonb)
    from edunexus.site_faqs q where p_archived or q.status<>'archived'));
end $$;

-- 0037's public read, with the published questions added. Everything else it returns is unchanged.
create or replace function edunexus.read_public_site() returns jsonb language sql stable security definer set search_path='' as $$
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
      from (select * from edunexus.announcements where status='published' order by pinned desc,published_at desc limit 60) a),
    'faqs',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'answer',q.answer) order by q.position,q.published_at),'[]'::jsonb)
      from (select * from edunexus.site_faqs where status='published' order by position,published_at limit 100) q))
$$;

revoke all on function edunexus.site_faq_view(edunexus.site_faqs),edunexus.save_site_faq(uuid,integer,jsonb,text),
  edunexus.set_site_faq_status(uuid,integer,text,text),edunexus.read_site_faqs(boolean),edunexus.read_public_site() from public;
grant execute on function edunexus.save_site_faq(uuid,integer,jsonb,text),edunexus.set_site_faq_status(uuid,integer,text,text),
  edunexus.read_site_faqs(boolean),edunexus.read_public_site() to edunexus_app;
