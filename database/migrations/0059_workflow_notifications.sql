-- Notifications for the monthly consolidation, promotion outcomes and the
-- instructional calendar: the rest of the approved first release that can be
-- emitted from a writer that exists.
--
-- **The attendance three are here on an explicit decision of 2026-11-05.** The
-- absence-alert gate blocks "any messaging on attendance" and is still
-- contested; the user ruled that it covers attendance *figures and thresholds*
-- rather than the submit/return/lock workflow around a consolidation. So
-- `month_submitted`, `month_returned` and `month_locked` report that a month
-- moved between desks, and **no notification here carries, counts, compares or
-- thresholds a single attendance figure**. Nothing tells anyone that a learner
-- was absent, or how often. The gate is where it was.
--
-- All four writers replaced here are already batch- or event-shaped: each is
-- called once per act a person takes, so the rule recorded on 2026-11-06 --
-- emit at the intent boundary, and check whether a writer is ever called in a
-- loop first -- is satisfied without restructuring anything. The two promotion
-- writers take a whole section's entries in one call and already write one
-- `promotion_events` row, so the notification carries a `count` the same way.
--
-- **What is still missing, and why it is not here.** `adviser_assigned` and
-- `adviser_removed` cannot be emitted yet. A section's adviser is set by plain
-- SQL in `src/modules/foundation/service.ts` -- `insert into edunexus.sections`
-- and `update edunexus.sections set ... adviser_user_id=...` -- not by a
-- `security definer` function, and there is nothing to `create or replace`.
-- The two ways to close that are a new writer function for `sections`, which is
-- a change to a core 0001 table's write path and its own increment, or granting
-- `notify` to `edunexus_app` -- which would destroy the property that only a
-- writer reporting its own change can send a notification. The second is not a
-- trade worth making for a convenience, so the kinds stay declared and unused.

-- Every active adviser of a year's sections, for a change that reaches all of
-- them. One notification each for one event, which is not noise: a school-wide
-- calendar change is exactly the thing 27 advisers each need to know once.
create function edunexus.notify_year_advisers(p_kind text,p_subject_table text,p_subject_id uuid,p_year uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
  for a in select distinct s.adviser_user_id from edunexus.sections s
    where s.academic_year_id=p_year and s.adviser_user_id is not null loop
    perform edunexus.notify(a,p_kind,p_subject_table,p_subject_id,p_year,null,null,p_payload);
  end loop;
end $$;

-- 0012's function, restated because it is applied and must never be edited,
-- with the emission added before the return. The month is named, never a figure
-- from it.
create or replace function edunexus.commit_attendance_month(p_section uuid,p_month date,p_version integer,p_action text,p_reason text,p_hash text)
returns edunexus.attendance_month_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; payload jsonb; snapshot uuid; root uuid; result edunexus.attendance_month_events; adviser uuid; about jsonb;
begin
  plan:=edunexus.preview_attendance_month(p_section,p_month,p_version,p_action,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0703',message='Resolve monthly completeness issues before submission'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0704',message='Monthly review changed'; end if;
  if p_action='submit' then
    payload:=edunexus.build_attendance_month(plan);
    if encode(sha256(convert_to(payload::text,'UTF8')),'hex')<>plan->>'data_hash' then raise exception using errcode='P0704',message='Monthly data changed'; end if;
    insert into edunexus.attendance_month_snapshots(section_id,academic_year_id,month_on,payload,data_hash) values(p_section,(plan->>'academic_year_id')::uuid,p_month,payload,plan->>'data_hash') returning id into snapshot;
  else snapshot:=(plan->>'snapshot_id')::uuid; end if;
  insert into edunexus.attendance_months(section_id,academic_year_id,month_on,status,snapshot_id) values(p_section,(plan->>'academic_year_id')::uuid,p_month,plan->>'target_status',snapshot)
    on conflict(section_id,month_on) do update set status=excluded.status,snapshot_id=excluded.snapshot_id returning id into root;
  insert into edunexus.attendance_month_events(month_id,month_version,action,snapshot_id,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(root,p_version+1,p_action,snapshot,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;

  -- Which month, and whose class. No count, no average, no percentage: this
  -- says a month moved, not anything about anyone's attendance.
  about:=edunexus.section_notification_payload(p_section)||jsonb_build_object('month',to_char(p_month,'YYYY-MM'));
  if p_action='submit' then
    -- Waiting for the office to check and lock.
    perform edunexus.notify_managers('month_submitted','attendance_months',root,(plan->>'academic_year_id')::uuid,p_section,null,about);
  else
    -- Locked, returned or reopened: back to the adviser whose month it is.
    -- `reopen` has no kind of its own and reports as returned, because a locked
    -- month reopened is a month back on the adviser's desk.
    select adviser_user_id into adviser from edunexus.sections where id=p_section;
    perform edunexus.notify(adviser,case when p_action='lock' then 'month_locked' else 'month_returned' end,
      'attendance_months',root,(plan->>'academic_year_id')::uuid,p_section,null,about);
  end if;
  return result;
end $$;

-- 0033's two writers, restated for the same reason. Both already loop over a
-- batch and write exactly one event row, so the notification is one per call
-- with a count, not one per learner.
create or replace function edunexus.record_promotion_recommendations(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.promotion_decisions; saved edunexus.promotion_decisions; changes jsonb:='[]'; seen uuid[]:='{}'; e uuid; a text;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.promotion_section(p_section,false);
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','action','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->'action' is null or jsonb_typeof(entry->'action') not in ('string','null') then
      raise exception using errcode='23514',message='Invalid promotion entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    a:=entry->>'action';
    if a is not null and a not in ('promoted','retained','remedial') then raise exception using errcode='23514',message='An outcome is promoted, retained or remedial'; end if;
    select * into existing from edunexus.promotion_decisions where enrollment_id=e for update;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
      -- An approved outcome is the school's; it changes only after an approver returns it.
      if existing.status='approved' then raise exception using errcode='P2000',message='This outcome is approved; ask the principal to return it first'; end if;
      if existing.action is not distinct from a and existing.status='recommended' then continue; end if;
      update edunexus.promotion_decisions set action=a,status='recommended',recommended_by=edunexus.actor_id(),decided_by=null where enrollment_id=e returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('action',existing.action,'status',existing.status),
        'after',jsonb_build_object('action',a,'status','recommended'),'version',saved.version));
    else
      if (entry->>'version')::integer is distinct from 0 then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
      if a is null then continue; end if;
      insert into edunexus.promotion_decisions(enrollment_id,action,recommended_by) values(e,a,edunexus.actor_id()) returning * into saved;
      changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',null,'after',jsonb_build_object('action',a,'status','recommended'),'version',saved.version));
    end if;
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.promotion_events(section_id,kind,entries,reason,actor_user_id,request_id)
    values(s.id,'recommend',changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  -- Outcomes are waiting for approval. One notification for the batch.
  perform edunexus.notify_managers('promotion_endorsed','sections',s.id,s.academic_year_id,s.id,null,
    edunexus.section_notification_payload(s.id)||jsonb_build_object('count',jsonb_array_length(changes)));
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

create or replace function edunexus.decide_promotions(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.promotion_decisions; saved edunexus.promotion_decisions; changes jsonb:='[]'; seen uuid[]:='{}'; e uuid; d text; kinds text[]:='{}'; adviser uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.promotion_section(p_section,true);
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','decision','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->>'decision' is null or entry->>'decision' not in ('approved','returned') then
      raise exception using errcode='23514',message='Invalid decision entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    d:=entry->>'decision';
    select * into existing from edunexus.promotion_decisions where enrollment_id=e for update;
    if not found or existing.action is null then raise exception using errcode='P2001',message='There is no recommended outcome to decide'; end if;
    if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
    if existing.status=d then continue; end if;
    update edunexus.promotion_decisions set status=d,decided_by=edunexus.actor_id() where enrollment_id=e returning * into saved;
    changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('action',existing.action,'status',existing.status),
      'after',jsonb_build_object('action',existing.action,'status',d),'version',saved.version));
    kinds:=array_append(kinds,d);
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.promotion_events(section_id,kind,entries,reason,actor_user_id,request_id)
    values(s.id,case when 'returned'=any(kinds) then 'return' else 'approve' end,changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  -- To the adviser whose outcomes these are. Returned wins a mixed batch, for
  -- the same reason the event row's own `kind` does: something needs doing.
  select adviser_user_id into adviser from edunexus.sections where id=s.id;
  perform edunexus.notify(adviser,case when 'returned'=any(kinds) then 'promotion_returned' else 'promotion_approved' end,
    'sections',s.id,s.academic_year_id,s.id,null,
    edunexus.section_notification_payload(s.id)||jsonb_build_object('count',jsonb_array_length(changes)));
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

-- 0010's function, restated for the same reason. A school-wide change reaches
-- every adviser of the year; a section's own reaches its adviser.
create or replace function edunexus.commit_instructional_calendar(p_year uuid,p_section uuid,p_version integer,p_changes jsonb,p_reason text,p_hash text)
returns edunexus.calendar_review_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; result edunexus.calendar_review_events; change jsonb; state jsonb; day_id uuid; adviser uuid;
begin
  plan:=edunexus.preview_instructional_calendar(p_year,p_section,p_version,p_changes,p_reason);
  if not (plan->>'can_commit')::boolean then raise exception using errcode='P0502',message='Resolve calendar conflicts first'; end if;
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0503',message='Calendar review changed'; end if;
  insert into edunexus.instructional_calendars(id) values(p_year) on conflict(id) do update set version=edunexus.instructional_calendars.version+1;
  insert into edunexus.calendar_review_events(academic_year_id,section_id,calendar_version,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(p_year,p_section,p_version+1,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  for change in select value from jsonb_array_elements(plan->'changes') where (value->>'changed')::boolean loop
    state:=change->'after';
    select id into day_id from edunexus.instructional_days where academic_year_id=p_year and section_id is not distinct from p_section and day_on=(change->>'day_on')::date;
    if found then update edunexus.instructional_days set configured=(state->>'configured')::boolean,am=state->>'am',pm=state->>'pm',day_type=state->>'day_type',label=state->>'label' where id=day_id;
    else insert into edunexus.instructional_days(academic_year_id,section_id,day_on,configured,am,pm,day_type,label)
      values(p_year,p_section,(change->>'day_on')::date,(state->>'configured')::boolean,state->>'am',state->>'pm',state->>'day_type',state->>'label'); end if;
  end loop;

  -- The calendar decides which days the register has and which days the SF2
  -- counts, so an adviser whose month is affected has to be told it moved.
  if p_section is null then
    perform edunexus.notify_year_advisers('calendar_changed','instructional_calendars',p_year,p_year,'{}'::jsonb);
  else
    select adviser_user_id into adviser from edunexus.sections where id=p_section;
    perform edunexus.notify(adviser,'calendar_changed','instructional_calendars',p_year,p_year,p_section,null,edunexus.section_notification_payload(p_section));
  end if;
  return result;
end $$;

revoke all on function edunexus.notify_year_advisers(text,text,uuid,uuid,jsonb) from public;
