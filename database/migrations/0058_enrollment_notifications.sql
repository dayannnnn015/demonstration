-- Notifications for enrollment and class assignment: the second group of the
-- approved first release.
--
-- **The emission is at the intent boundary, not the row writer, and that is the
-- whole design of this migration.** The obvious place to notify would have been
-- `place_enrollment`, since every enrolment in the system goes through it. But
-- it is called *in a loop*: `src/modules/registry-review/service.ts` calls it
-- once per row of a reviewed import, and `commit_next_year_placement` (0049)
-- once per promoted learner. Emitting there would have sent an adviser fifty
-- notifications for one class list, and the office several hundred for one
-- year's promotion -- burying the signal in its own noise, which is the same
-- failure the Overview and the command palette are each shaped to avoid.
--
-- So `place_enrollment` is left exactly as 0054 wrote it and emits nothing, and
-- the notification is sent by whichever function represents the *act a person
-- took*:
--
--   * `finish_import` -- one import, however many learners, with a count. It is
--     called once per commit and already holds the receipt, so the count is a
--     fact it has rather than one this migration has to recompute.
--   * `move_enrollment` -- one movement per API call (`registry/service.ts`
--     calls it once per request and nothing calls it in a loop), so a per-call
--     notification is one deliberate act reported once.
--
-- The adviser's own pull and register (0054) and next year's placement (0049)
-- are the same shape of problem and are deliberately left for their own
-- increments rather than restated here.
--
-- Every kind used below was declared in 0056, so this migration adds no check
-- constraint and widens nothing.

-- What a notification says about a class: its name and grade as they are now,
-- and never a learner. Null-safe, because an enrolment may have no section.
create function edunexus.section_notification_payload(p_section uuid) returns jsonb language sql stable set search_path='' as $$
  select coalesce((select jsonb_build_object('section_name',s.name,'grade_level',s.grade_level)
    from edunexus.sections s where s.id=p_section),'{}'::jsonb)
$$;

-- 0005's function, restated because it is applied and must never be edited,
-- with the emission added after the receipt is stored. The early return for an
-- already-committed preview is above that line, so re-committing the same
-- import notifies nobody a second time.
create or replace function edunexus.finish_import(p_id uuid,p_plan text,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result edunexus.import_previews; placed_section uuid; placed_count integer; adviser uuid; about jsonb;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into result from edunexus.import_previews where id=p_id and actor_user_id=edunexus.actor_id() for update;
  if not found then raise exception using errcode='P0002',message='Preview not found'; end if;
  if result.plan_hash is distinct from p_plan then raise exception using errcode='P0005',message='Reviewed records changed'; end if;
  if result.receipt is not null then return result.receipt; end if;
  if result.expires_at<=clock_timestamp() then raise exception using errcode='P0004',message='Preview expired'; end if;
  if p_receipt is null or jsonb_typeof(p_receipt->'items') is distinct from 'array'
    or jsonb_array_length(p_receipt->'items')<>result.row_count then
    raise exception using errcode='23514',message='Invalid import receipt';
  end if;
  update edunexus.import_previews set committed_at=clock_timestamp(),receipt=p_receipt where id=p_id;

  -- One notification for the import, carrying how many learners it brought in.
  placed_section:=nullif(p_receipt->>'section_id','')::uuid;
  placed_count:=jsonb_array_length(p_receipt->'items');
  if placed_section is not null then
    -- Into a class: its adviser is told their class list has arrived.
    select adviser_user_id into adviser from edunexus.sections where id=placed_section;
    perform edunexus.notify(adviser,'learner_placed','enrollments',p_id,nullif(p_receipt->>'academic_year_id','')::uuid,placed_section,null,
      edunexus.section_notification_payload(placed_section)||jsonb_build_object('count',placed_count));
  else
    -- Onto the registry at a grade with no class: nobody advises these
    -- learners yet, so it is the office's to pick up, and the SF4 is refused
    -- until every registered learner is in a class (0052).
    perform edunexus.notify_managers('learner_unplaced','enrollments',p_id,nullif(p_receipt->>'academic_year_id','')::uuid,null,null,
      jsonb_build_object('grade_level',(p_receipt->>'grade_level')::integer,'count',placed_count));
  end if;
  return p_receipt;
end $$;

-- 0054's function, restated for the same reason, with the emission added after
-- the update. `about` is read before the move so the class a learner is leaving
-- can still be named.
create or replace function edunexus.move_enrollment(p_id uuid,p_version integer,p_action text,p_date date,p_section uuid,p_exit_reason text)
returns edunexus.enrollments language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; y edunexus.academic_years; s edunexus.sections; new_status text; reason text; was uuid; left_behind uuid; joined uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_id;
  if not found then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  -- The one movement an adviser may make: giving a class to an enrolment that
  -- has none, in a section they advise. Everything else -- taking a learner out
  -- of another adviser's section, withdrawing, re-entering -- stays a manager's.
  -- Read first so `e.section_id` can be seen; an adviser who guesses an
  -- enrolment id learns only that it exists, which it must already to be guessed.
  if not (edunexus.is_manager() or (p_action='reassigned' and p_section is not null and e.section_id is null
      and e.record_state='valid' and edunexus.may_advise_section(p_section))) then
    raise exception using errcode='42501',message='Manager access required'; end if;
  select * into y from edunexus.academic_years where id=e.academic_year_id for update;
  perform 1 from edunexus.learners where id=e.learner_id for update;
  select * into e from edunexus.enrollments where id=p_id for update;
  if p_version is null or e.version<>p_version then raise exception using errcode='P0003',message='Enrollment version conflict'; end if;
  if y.status='closed' or p_date is null or p_date<=e.effective_on or p_date>y.ends_on or p_date>timezone('Asia/Manila',now())::date then
    raise exception using errcode='23514',message='Movement must advance the timeline within an open year and cannot be future dated';
  end if;
  was:=e.section_id;
  if p_action='withdrawn' then
    if e.status<>'enrolled' or p_section is not null or p_exit_reason is null or p_exit_reason not in ('transfer_out','withdrawal','dropout','death') then
      raise exception using errcode='23514',message='Invalid withdrawal';
    end if;
    new_status:='withdrawn';reason:=p_exit_reason;p_section:=e.section_id;
  elsif p_action in ('reassigned','reentered') then
    if p_exit_reason is not null or (p_action='reassigned' and (e.status<>'enrolled' or p_section is not distinct from e.section_id))
      or (p_action='reentered' and (e.status<>'withdrawn' or e.last_reason='death')) then
      raise exception using errcode='23514',message='Invalid enrollment transition';
    end if;
    if p_section is null then raise exception using errcode='23514',message='A section is required to assign or re-enter'; end if;
    select * into s from edunexus.sections where id=p_section;
    if not found or s.academic_year_id<>e.academic_year_id or s.grade_level<>e.grade_level then
      raise exception using errcode='23514',message='Target section must match enrollment year and grade';
    end if;
    new_status:='enrolled';reason:=case when p_action='reassigned' then 'section_change' else 'return_to_school' end;
  else raise exception using errcode='23514',message='Unknown enrollment transition'; end if;
  update edunexus.enrollments set section_id=p_section,status=new_status,effective_on=p_date,last_reason=reason where id=e.id returning * into e;

  -- Who is affected: the adviser of the class the learner left, the adviser of
  -- the class they joined, and the managers. `notify` drops the actor's own row,
  -- so an adviser who takes a learner into their own class is not told about it.
  select adviser_user_id into left_behind from edunexus.sections where id=was;
  select adviser_user_id into joined from edunexus.sections where id=e.section_id;
  if p_action='withdrawn' then
    perform edunexus.notify(left_behind,'learner_withdrawn','enrollments',e.id,e.academic_year_id,was,e.learner_id,edunexus.section_notification_payload(was));
    perform edunexus.notify_managers('learner_withdrawn','enrollments',e.id,e.academic_year_id,was,e.learner_id,edunexus.section_notification_payload(was));
  elsif p_action='reentered' then
    perform edunexus.notify(joined,'learner_reentered','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
    perform edunexus.notify_managers('learner_reentered','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
  else
    -- Reassigned. The class gaining the learner hears that one arrived; the
    -- class losing them hears that one moved. With no previous class there is
    -- nobody to tell, which is the adviser-pull case.
    perform edunexus.notify(joined,'learner_placed','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
    if was is distinct from e.section_id then
      perform edunexus.notify(left_behind,'learner_moved','enrollments',e.id,e.academic_year_id,was,e.learner_id,edunexus.section_notification_payload(was));
    end if;
    perform edunexus.notify_managers('learner_moved','enrollments',e.id,e.academic_year_id,e.section_id,e.learner_id,edunexus.section_notification_payload(e.section_id));
  end if;
  return e;
end $$;

revoke all on function edunexus.section_notification_payload(uuid) from public;
