-- The daily register took the exclusive academic lock for every read and every
-- confirmation, so the whole school's registers queued behind one another. With
-- 27 advisers opening the register at once, more than half passed the
-- three-second lock timeout before seeing a learner
-- (docs/load-measurement-2026-09-25.md).
--
-- Two locks now guard the register, always taken in this order: the academic
-- lock, then a lock for the one section (82412002, keyed by the section).
--
-- A read takes both shared. Reads of any sections run alongside each other and
-- never alongside a school-wide writer — calendar, timeline, placement, month,
-- follow-up and the rest — which all still hold the academic lock exclusively.
--
-- A confirmation takes the academic lock shared, which still excludes every
-- school-wide writer, and its own section's lock exclusively. Two confirmations
-- of one section therefore still queue, and the second meets the version check;
-- a read of that section waits for the confirmation, so a register is still read
-- in one consistent state; and other sections are not held up at all. Two
-- sections never write the same mark: a learner belongs to one section on any
-- date, and only a school-wide writer can move them.
--
-- Every transaction takes its locks first and in the same order, and one that
-- already holds a lock exclusively may always take it again shared, so no
-- transaction ever waits for a lock while holding one another needs.
--
-- Apart from the locks, both bodies are exactly those of 0011; 0012 renamed the
-- context to wrap it.
create or replace function edunexus.attendance_context_before_months(p_section uuid,p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  perform pg_advisory_xact_lock_shared(82412002,hashtext(p_section::text));
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id for share;
  if not edunexus.is_manager() and y.status='closed' then raise exception using errcode='P0002',message='Section not found'; end if;
  if p_date is null or p_date<y.starts_on or p_date>y.ends_on then raise exception using errcode='P0600',message='Attendance date outside year'; end if;
  return jsonb_build_object('section',to_jsonb(s)-'created_at'-'updated_at','school_year',to_jsonb(y)-'created_at'-'updated_at',
    'day_on',p_date,'version',coalesce((select version from edunexus.attendance_days where section_id=p_section and day_on=p_date),0),
    'calendar_version',coalesce((select version from edunexus.instructional_calendars where id=y.id),0),
    'schedule',edunexus.effective_calendar_day(y.id,p_section,p_date),'visibility',case when edunexus.is_manager() then 'full_historical_roster' else 'current_access_only' end);
end $$;

create or replace function edunexus.commit_daily_attendance(p_section uuid,p_date date,p_version integer,p_changes jsonb,p_reason text,p_hash text)
returns edunexus.attendance_review_events language plpgsql security definer set search_path='' as $$
declare plan jsonb; day_id uuid; item jsonb; result edunexus.attendance_review_events;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  perform pg_advisory_xact_lock(82412002,hashtext(p_section::text));
  plan:=edunexus.preview_daily_attendance(p_section,p_date,p_version,p_changes,p_reason);
  if p_hash is distinct from plan->>'review_hash' then raise exception using errcode='P0605',message='Attendance review changed'; end if;
  insert into edunexus.attendance_days(section_id,day_on) values(p_section,p_date) on conflict(section_id,day_on) do update set version=edunexus.attendance_days.version+1 returning id into day_id;
  insert into edunexus.attendance_review_events(attendance_day_id,attendance_version,review_snapshot,review_hash,reason,actor_user_id,request_id)
    values(day_id,p_version+1,plan-'review_hash',p_hash,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid) returning * into result;
  for item in select value from jsonb_array_elements(plan->'changes') where (value->>'changed')::boolean loop
    insert into edunexus.attendance_marks(attendance_day_id,enrollment_id,day_on,am,pm) values(day_id,(item->>'enrollment_id')::uuid,p_date,item->'after'->>'am',item->'after'->>'pm')
      on conflict(enrollment_id,day_on) do update set attendance_day_id=excluded.attendance_day_id,am=excluded.am,pm=excluded.pm;
  end loop;
  return result;
end $$;
