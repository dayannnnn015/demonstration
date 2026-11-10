-- How much work waits on a principal or administrative officer, as numbers.
--
-- The UI notes of 8 November, note 8: "could it show a number for how many
-- requests wait for approval". The rail draws a count beside **Admissions**,
-- **Promotion** and **Staff access**, and it asks for them on every screen, so
-- the read has to be what the bell's count already is: numbers only, naming no
-- learner, no list and no staff member, and so writing no record_access_events
-- row (the same reason `GET /enrollment-counts` writes none).
--
-- Each count is what that screen calls waiting:
--   class_lists   — a class list an adviser submitted, not yet approved,
--                   declined or withdrawn (roster_submissions, 0028/0061).
--   outcomes      — an end-of-year outcome the adviser endorsed and nobody has
--                   approved or returned yet, for a valid enrolment in the
--                   active school year (promotion_decisions, 0033).
--   name_requests — a pending correction of a colleague's name or position that
--                   the caller may decide: never their own, and an
--                   administrative officer's only for the principal, which is
--                   `may_manage_profile` exactly as `read_name_requests` (0045)
--                   says `may_decide`.
--
-- **Nothing about attendance is counted** (decision U-D1): the absence-alert
-- gate stays shut. A teacher is answered zeros rather than refused, because the
-- rail asks for everyone and an adviser decides none of these.
--
-- Security definer because a count must not depend on which rows a policy
-- happens to show; the manager check and the may-decide rule are restated here,
-- as AGENTS.md requires of every such function.
create function edunexus.read_waiting_counts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  active uuid;
begin
  if edunexus.actor_role() is null then
    raise exception using errcode='42501', message='Active staff access required';
  end if;
  if not edunexus.is_manager() then
    return jsonb_build_object('class_lists', 0, 'outcomes', 0, 'name_requests', 0);
  end if;
  select id into active from edunexus.academic_years where status = 'active';
  return jsonb_build_object(
    'class_lists', (select count(*) from edunexus.roster_submissions where status = 'submitted'),
    'outcomes', (select count(*) from edunexus.promotion_decisions d
                   join edunexus.enrollments e on e.id = d.enrollment_id
                  where d.status = 'recommended' and e.record_state = 'valid' and e.academic_year_id = active),
    'name_requests', (select count(*) from edunexus.staff_name_requests r
                       where r.status = 'pending' and r.user_id <> edunexus.actor_id() and edunexus.may_manage_profile(r.user_id))
  );
end $$;

revoke all on function edunexus.read_waiting_counts() from public;
grant execute on function edunexus.read_waiting_counts() to edunexus_app;
