-- A registrar fixing a class list previews it again and again (testing finding
-- F33, decided by Claude under the user's delegation of 27 October 2026). Each
-- committable preview was kept for 30 minutes, and the eleventh within that time
-- was refused with PREVIEW_LIMIT, locking the registrar out of importing.
--
-- Now the same file previewed again, with the same plan, returns the preview
-- already pending; and at ten pending previews a new one replaces the caller's
-- oldest, so no caller ever holds more than ten. A replaced preview is a
-- superseded receipt: committing it is refused as expired, and a new preview
-- is asked for, exactly as when one runs out of time.
create or replace function edunexus.create_import_preview(p_input text,p_plan text,p_count integer)
returns edunexus.import_previews language plpgsql security definer set search_path='' as $$
declare result edunexus.import_previews;
begin
  perform pg_advisory_xact_lock(82412001);
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  delete from edunexus.import_previews where committed_at is null and expires_at<=clock_timestamp();
  select * into result from edunexus.import_previews
    where actor_user_id=edunexus.actor_id() and committed_at is null and input_hash=p_input and plan_hash=p_plan
    order by created_at desc limit 1;
  if found then return result; end if;
  delete from edunexus.import_previews where id in (
    select id from edunexus.import_previews where actor_user_id=edunexus.actor_id() and committed_at is null
    order by created_at desc offset 9);
  insert into edunexus.import_previews(actor_user_id,request_id,input_hash,plan_hash,row_count)
  values(edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid,p_input,p_plan,p_count) returning * into result;
  return result;
end $$;
