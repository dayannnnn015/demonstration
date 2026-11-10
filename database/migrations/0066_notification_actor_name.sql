-- An adviser is told who acted on their own notification.
--
-- `actor_name` came from a left join on `edunexus.staff`, whose `staff_read`
-- policy is own-row-or-manager, so an adviser read a null and the screen drew
-- "Not shown to you". That was the boundary answering rather than a gap, and
-- 0.92.0 recorded it deliberately: naming the manager by widening a teacher's
-- read of staff is the trade AGENTS.md refuses, and it still is.
--
-- The school asked to see the name (2026-11-07). This is the narrow way to
-- give it. **`staff_read` is untouched** — a teacher still cannot list staff,
-- search them, or read any row but their own. What they can now read is one
-- display name, for the one person who acted on a notification **addressed to
-- them**, which the function checks before it answers. There is no parameter
-- for a staff id: the only way in is a notification of your own, so the
-- disclosure cannot be aimed.
--
-- Nothing is stored, so it answers for notifications already sent as well as
-- new ones — which is why this is a read-side function rather than a new key
-- on `payload`, whose closed list exists to keep a learner's name out of a
-- notification and should not be widened for an unrelated reason.
create function edunexus.notification_actor_name(p_notification bigint) returns text
language sql stable security definer set search_path='' as $$
  select s.display_name
  from edunexus.notifications n
  join edunexus.staff s on s.user_id = n.actor_user_id
  where n.id = p_notification and n.recipient_user_id = edunexus.actor_id()
$$;

revoke all on function edunexus.notification_actor_name(bigint) from public;
grant execute on function edunexus.notification_actor_name(bigint) to edunexus_app;
