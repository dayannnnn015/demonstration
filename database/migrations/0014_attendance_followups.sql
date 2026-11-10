-- Section 3B.4: manual manager follow-up; automatic alert policy remains unset.
-- Share the proven monitor query while allowing an exact enrollment lookup.
create function edunexus.attendance_monitor_evidence(p_section uuid,p_from date,p_to date,p_view text,p_limit integer,p_after uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; items jsonb; schedules jsonb;
begin
  context:=edunexus.attendance_context(p_section,p_from);
  if p_to is null or p_to<p_from or p_to-p_from>30 or p_to>(context->'school_year'->>'ends_on')::date
    or p_to>timezone('Asia/Manila',now())::date then
    raise exception using errcode='P0800',message='Monitor requires 1 to 31 nonfuture dates within one school year';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_view is null or p_view not in ('all','with_absences','incomplete') then
    raise exception using errcode='23514',message='Invalid monitor filter or page limit';
  end if;
  select jsonb_agg(edunexus.effective_calendar_day((context->'school_year'->>'id')::uuid,p_section,p_from+n)
    || jsonb_build_object('month_status',coalesce(m.status,'draft'),'month_version',coalesce(m.version,0)) order by n)
  into schedules from generate_series(0,p_to-p_from) n
    left join edunexus.attendance_months m on m.section_id=p_section and m.month_on=date_trunc('month',p_from+n)::date;

  with candidates as materialized (
    select e.id,e.version,e.learner_id recorded_learner_id,l.id learner_id,l.version learner_version,
      l.first_name,l.middle_name,l.last_name,l.name_extension,edunexus.resolve_enrollment_timeline(e.id) timeline
    from edunexus.enrollments e join edunexus.learners original on original.id=e.learner_id
      join edunexus.learners l on l.id=coalesce(original.merged_into,original.id)
    where e.academic_year_id=(context->'school_year'->>'id')::uuid and e.record_state='valid' and e.enrolled_on<=p_to
      and (p_target is null or e.id=p_target) and edunexus.can_read_enrollment(e.id) and (p_after is null or e.id>p_after)
  ), cells as materialized (
    select e.id,(d->>'day_on')::date day_on,d schedule,
      coalesce(state.value->>'event_type'<>'withdrawn' and (state.value->>'section_id')::uuid=p_section,false) eligible,
      case when a.section_id=p_section then m.am end am,case when a.section_id=p_section then m.pm end pm
    from candidates e cross join jsonb_array_elements(schedules) d
    left join lateral (select value from jsonb_array_elements(e.timeline) where (value->>'effective_on')::date<=(d->>'day_on')::date
      order by (value->>'effective_on')::date desc limit 1) state on true
    left join edunexus.attendance_marks m on m.enrollment_id=e.id and m.day_on=(d->>'day_on')::date
    left join edunexus.attendance_days a on a.id=m.attendance_day_id
  ), chosen as materialized (
    select id from cells group by id having bool_or(eligible) and
      (p_view='all' or (p_view='with_absences' and bool_or(eligible and (am='absent' or pm='absent')))
        or (p_view='incomplete' and bool_or(eligible and (not (schedule->>'configured')::boolean
          or schedule->>'am'='alternative_delivery' or schedule->>'pm'='alternative_delivery'
          or (schedule->>'am'='classroom' and am is null) or (schedule->>'pm'='classroom' and pm is null)))))
    order by id limit p_limit+1
  ) select coalesce(jsonb_agg(item order by id),'[]') into items from (
    select e.id,jsonb_build_object('enrollment_id',e.id,'enrollment_version',e.version,'recorded_learner_id',e.recorded_learner_id,
      'learner_id',e.learner_id,'learner_version',e.learner_version,'first_name',e.first_name,'middle_name',e.middle_name,'last_name',e.last_name,'name_extension',e.name_extension,
      'dates',(select jsonb_agg(jsonb_build_object('day_on',day_on,'eligible',eligible,'am',case when eligible then am end,'pm',case when eligible then pm end) order by day_on)
        from cells where id=e.id)) item
    from chosen join candidates e on e.id=chosen.id
  ) rows;
  return jsonb_build_object('section',context->'section','school_year',context->'school_year','visibility',context->'visibility',
    'source','live','from',p_from,'to',p_to,'view',p_view,'calendar_version',context->'calendar_version','days',schedules,
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(items) with ordinality where ordinality<=p_limit),
    'pagination',jsonb_build_object('limit',p_limit,'next_after_id',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'enrollment_id' else null end));
end $$;

revoke all on function edunexus.attendance_monitor_evidence(uuid,date,date,text,integer,uuid,uuid) from public,edunexus_app;
create or replace function edunexus.read_attendance_monitor(p_section uuid,p_from date,p_to date,p_view text,p_limit integer,p_after uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return edunexus.attendance_monitor_evidence(p_section,p_from,p_to,p_view,p_limit,p_after,null); end $$;

alter table edunexus.enrollments add constraint enrollments_identity_year_key unique(id,academic_year_id);
create table edunexus.attendance_followups (
  id uuid primary key default gen_random_uuid(),enrollment_id uuid not null,section_id uuid not null,academic_year_id uuid not null,
  from_on date not null,to_on date not null,category text not null check(category in ('absence','recording_gap')),
  status text not null default 'open' check(status in ('open','resolved','cancelled')),
  assignee_user_id uuid not null references edunexus.staff(user_id) on delete restrict,due_on date,
  opening_evidence jsonb not null,opening_hash text not null check(opening_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references edunexus.staff(user_id) on delete restrict,version integer not null default 1 check(version>=1),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(enrollment_id,academic_year_id) references edunexus.enrollments(id,academic_year_id) on delete restrict,
  foreign key(section_id,academic_year_id) references edunexus.sections(id,academic_year_id) on delete restrict,
  check(to_on>=from_on and to_on-from_on<=30),check(status='open' or due_on is null)
);
create unique index attendance_followup_open_idx on edunexus.attendance_followups(enrollment_id) where status='open';
create index attendance_followup_enrollment_idx on edunexus.attendance_followups(enrollment_id);
create index attendance_followup_year_idx on edunexus.attendance_followups(academic_year_id,status,id);
create index attendance_followup_section_idx on edunexus.attendance_followups(section_id,id);
create index attendance_followup_assignee_idx on edunexus.attendance_followups(assignee_user_id,status,id);
create index attendance_followup_creator_idx on edunexus.attendance_followups(created_by);
create table edunexus.attendance_followup_events (
  id uuid primary key default gen_random_uuid(),case_id uuid not null references edunexus.attendance_followups(id) on delete restrict,
  case_version integer not null check(case_version>=1),action text not null check(action in ('open','update','resolve','cancel','reopen')),
  review_snapshot jsonb not null,review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),unique(case_id,case_version)
);
create index attendance_followup_event_actor_idx on edunexus.attendance_followup_events(actor_user_id);
do $$ declare t text; begin
  foreach t in array array['attendance_followups','attendance_followup_events'] loop
    execute format('alter table edunexus.%I enable row level security',t);
    execute format('create policy manager_read on edunexus.%I for select to edunexus_app using(edunexus.is_manager())',t);
    execute format('create trigger audit_record after insert or update on edunexus.%I for each row execute function edunexus.audit_record()',t);
  end loop;
end $$;
create trigger version_record before update on edunexus.attendance_followups for each row execute function edunexus.version_record();
grant select on edunexus.attendance_followups,edunexus.attendance_followup_events to edunexus_app;

create function edunexus.followup_evidence(p_enrollment uuid,p_section uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; data jsonb; member jsonb; summary jsonb;
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  data:=edunexus.attendance_monitor_evidence(p_section,p_from,p_to,'all',1,null,p_enrollment);
  if e.academic_year_id<>(data->'school_year'->>'id')::uuid then raise exception using errcode='P0002',message='Enrollment scope not found'; end if;
  member:=data->'items'->0;
  select jsonb_build_object(
    'absent_sessions',count(*) filter(where s->>session='classroom' and d->>session='absent'),
    'missing_sessions',count(*) filter(where s->>session='classroom' and d->>session is null),
    'unsupported_sessions',count(*) filter(where s->>session='alternative_delivery'),
    'unconfigured_dates',count(*) filter(where session='am' and not (s->>'configured')::boolean)) into summary
  from jsonb_array_elements(coalesce(member->'dates','[]')) d join jsonb_array_elements(data->'days') s on s->>'day_on'=d->>'day_on'
    cross join (values('am'),('pm')) sessions(session) where (d->>'eligible')::boolean;
  return jsonb_build_object('evidence_version',1,'available',member is not null,'enrollment_version',e.version,'record_state',e.record_state,
    'snapshot',(data-'items'-'pagination'-'view') || jsonb_build_object('member',member),'summary',summary);
end $$;
create function edunexus.followup_assignee(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare staff edunexus.staff;
begin
  select * into staff from edunexus.staff where user_id=p_user and active and role in ('principal','administrative_officer');
  if not found then raise exception using errcode='P0900',message='Assign an active principal or administrative officer'; end if;
  return jsonb_build_object('user_id',staff.user_id,'display_name',staff.display_name,'role',staff.role,'version',staff.version);
end $$;
create function edunexus.read_attendance_followup(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c edunexus.attendance_followups; evidence jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into c from edunexus.attendance_followups where id=p_id;
  if not found then raise exception using errcode='P0002',message='Follow-up not found'; end if;
  evidence:=edunexus.followup_evidence(c.enrollment_id,c.section_id,c.from_on,c.to_on);
  return jsonb_build_object('record',to_jsonb(c),'current_evidence',evidence,
    'evidence_changed',encode(sha256(convert_to(evidence::text,'UTF8')),'hex')<>c.opening_hash,
    'overdue',c.status='open' and coalesce(c.due_on<timezone('Asia/Manila',now())::date,false));
end $$;
create function edunexus.preview_attendance_followup_open(p_enrollment uuid,p_section uuid,p_from date,p_to date,p_category text,p_assignee uuid,p_due date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence jsonb; owner jsonb; issues text[]:='{}'; plan jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  evidence:=edunexus.followup_evidence(p_enrollment,p_section,p_from,p_to);owner:=edunexus.followup_assignee(p_assignee);
  if p_category is null or p_category not in ('absence','recording_gap') or p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode='23514',message='Invalid follow-up category or reason'; end if;
  if p_due is not null and p_due<timezone('Asia/Manila',now())::date then raise exception using errcode='P0901',message='New due date cannot be in the past'; end if;
  if evidence->'snapshot'->'school_year'->>'status'<>'active' then issues:=array_append(issues,'YEAR_NOT_ACTIVE'); end if;
  if not (evidence->>'available')::boolean then issues:=array_append(issues,'NO_ELIGIBLE_MEMBERSHIP');
  elsif (p_category='absence' and (evidence->'summary'->>'absent_sessions')::integer=0)
    or (p_category='recording_gap' and (evidence->'summary'->>'missing_sessions')::integer+(evidence->'summary'->>'unsupported_sessions')::integer+(evidence->'summary'->>'unconfigured_dates')::integer=0) then
    issues:=array_append(issues,'NO_MATCHING_EVIDENCE'); end if;
  if exists(select 1 from edunexus.attendance_followups where enrollment_id=p_enrollment and status='open') then issues:=array_append(issues,'OPEN_CASE_EXISTS'); end if;
  plan:=jsonb_build_object('action','open','version',0,'before',null,'enrollment_id',p_enrollment,'section_id',p_section,
    'academic_year_id',evidence->'snapshot'->'school_year'->'id','from_on',p_from,'to_on',p_to,'category',p_category,'target_status','open',
    'assignee',owner,'due_on',p_due,'reason',btrim(p_reason),'actor_user_id',edunexus.actor_id(),'current_evidence',evidence,'issues',issues,'can_commit',cardinality(issues)=0);
  return plan || jsonb_build_object('review_hash',case when cardinality(issues)=0 then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;
create function edunexus.commit_attendance_followup_open(p_enrollment uuid,p_section uuid,p_from date,p_to date,p_category text,p_assignee uuid,p_due date,p_reason text,p_hash text)
returns edunexus.attendance_followup_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; root uuid; result edunexus.attendance_followup_events;
begin
  plan:=edunexus.preview_attendance_followup_open(p_enrollment,p_section,p_from,p_to,p_category,p_assignee,p_due,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0902',message='Resolve follow-up review issues'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0903',message='Follow-up evidence or proposal changed'; end if;
  insert into edunexus.attendance_followups(enrollment_id,section_id,academic_year_id,from_on,to_on,category,assignee_user_id,due_on,opening_evidence,opening_hash,created_by)
    values(p_enrollment,p_section,(plan->>'academic_year_id')::uuid,p_from,p_to,p_category,p_assignee,p_due,plan->'current_evidence',
      encode(sha256(convert_to((plan->'current_evidence')::text,'UTF8')),'hex'),edunexus.actor_id()) returning id into root;
  insert into edunexus.attendance_followup_events(case_id,case_version,action,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(root,1,'open',plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  return result;
end $$;
create function edunexus.preview_attendance_followup_change(p_id uuid,p_version integer,p_action text,p_assignee uuid,p_due date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare detail jsonb; c jsonb; owner jsonb; target text; issues text[]:='{}'; plan jsonb;
begin
  detail:=edunexus.read_attendance_followup(p_id);c:=detail->'record';owner:=edunexus.followup_assignee(p_assignee);
  if p_version is null or p_version<>(c->>'version')::integer then raise exception using errcode='P0003',message='Follow-up version changed'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]' then raise exception using errcode='23514',message='Invalid follow-up reason'; end if;
  if p_action='update' and c->>'status'='open' then target:='open';
  elsif p_action='resolve' and c->>'status'='open' then target:='resolved';
  elsif p_action='cancel' and c->>'status'='open' then target:='cancelled';
  elsif p_action='reopen' and c->>'status' in ('resolved','cancelled') then target:='open';
  else raise exception using errcode='P0904',message='Invalid follow-up transition'; end if;
  if target<>'open' and p_due is not null then raise exception using errcode='P0901',message='Clear due date when closing a case'; end if;
  if p_due is not null and p_due<timezone('Asia/Manila',now())::date and p_due is distinct from (c->>'due_on')::date then
    raise exception using errcode='P0901',message='A changed due date cannot be in the past'; end if;
  if p_action='reopen' and exists(select 1 from edunexus.attendance_followups where enrollment_id=(c->>'enrollment_id')::uuid and status='open' and id<>p_id) then
    issues:=array_append(issues,'OPEN_CASE_EXISTS'); end if;
  plan:=jsonb_build_object('action',p_action,'version',p_version,'before',c,'enrollment_id',c->'enrollment_id','section_id',c->'section_id',
    'academic_year_id',c->'academic_year_id','from_on',c->'from_on','to_on',c->'to_on','category',c->'category','target_status',target,
    'assignee',owner,'due_on',p_due,'reason',btrim(p_reason),'actor_user_id',edunexus.actor_id(),'current_evidence',detail->'current_evidence','issues',issues,'can_commit',cardinality(issues)=0);
  return plan || jsonb_build_object('review_hash',case when cardinality(issues)=0 then encode(sha256(convert_to(plan::text,'UTF8')),'hex') else null end);
end $$;
create function edunexus.commit_attendance_followup_change(p_id uuid,p_version integer,p_action text,p_assignee uuid,p_due date,p_reason text,p_hash text)
returns edunexus.attendance_followup_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; result edunexus.attendance_followup_events;
begin
  plan:=edunexus.preview_attendance_followup_change(p_id,p_version,p_action,p_assignee,p_due,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0902',message='Resolve follow-up review issues'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0903',message='Follow-up evidence or proposal changed'; end if;
  update edunexus.attendance_followups set status=plan->>'target_status',assignee_user_id=p_assignee,due_on=p_due where id=p_id;
  insert into edunexus.attendance_followup_events(case_id,case_version,action,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(p_id,p_version+1,p_action,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  return result;
end $$;
revoke all on function edunexus.followup_evidence(uuid,uuid,date,date),edunexus.followup_assignee(uuid),edunexus.read_attendance_followup(uuid),
  edunexus.preview_attendance_followup_open(uuid,uuid,date,date,text,uuid,date,text),edunexus.commit_attendance_followup_open(uuid,uuid,date,date,text,uuid,date,text,text),
  edunexus.preview_attendance_followup_change(uuid,integer,text,uuid,date,text),edunexus.commit_attendance_followup_change(uuid,integer,text,uuid,date,text,text) from public;
grant execute on function edunexus.read_attendance_followup(uuid),edunexus.preview_attendance_followup_open(uuid,uuid,date,date,text,uuid,date,text),
  edunexus.commit_attendance_followup_open(uuid,uuid,date,date,text,uuid,date,text,text),edunexus.preview_attendance_followup_change(uuid,integer,text,uuid,date,text),
  edunexus.commit_attendance_followup_change(uuid,integer,text,uuid,date,text,text) to edunexus_app;
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory'
));
