-- Conditional promotion, put back where a later migration dropped it.
--
-- `0036_conditional_promotion.sql` widened the outcomes an adviser may endorse
-- from three to four: `promoted`, **`conditionally_promoted`**, `retained`,
-- `remedial`. It did that by replacing `record_promotion_recommendations`,
-- whose 0033 original allowed only the three.
--
-- `0059_workflow_notifications.sql` then replaced the same function again to
-- add the "outcomes are waiting for approval" notification, and restated it
-- **from 0033's text rather than from 0036's**. Its own comment says so in as
-- many words -- "0033's two writers, restated for the same reason" -- and the
-- one line that mattered went back with it:
--
--   if a is not null and a not in ('promoted','retained','remedial') then
--
-- So since 0059 the value is refused with `23514` by the only function that
-- records it, while everything around it still expects it:
--
--   * `promotion_decisions.action`'s CHECK still allows it (0036);
--   * `commit_next_year_placement` still carries such a learner to the next
--     grade (0036, kept by 0049);
--   * `promotionsRecommend`'s Zod contract still accepts it;
--   * the SF9 and SF10 still print it (`src/modules/forms/cards.ts`);
--   * **Promotion still offers it as a choice** (`web/screens/ReportCards.tsx`).
--
-- Live is at 0059, so an adviser at Balili who picks "Conditionally promoted"
-- today is refused. Found on 2026-11-06 by the demonstration record seeding,
-- which endorses whatever outcome a learner's final grades lead to.
--
-- Nothing is edited: 0059 is applied and checksummed. This is 0059's own body
-- with 0036's allowed set, which is the pattern 0018, 0019, 0021, 0048 and 0054
-- all follow.
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
    -- 0036's four, not 0033's three. This is the whole of the fix.
    if a is not null and a not in ('promoted','conditionally_promoted','retained','remedial') then raise exception using errcode='23514',message='An outcome is promoted, conditionally promoted, retained or remedial'; end if;
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
  -- Outcomes are waiting for approval. One notification for the batch, exactly as 0059 sends it.
  perform edunexus.notify_managers('promotion_endorsed','sections',s.id,s.academic_year_id,s.id,null,
    edunexus.section_notification_payload(s.id)||jsonb_build_object('count',jsonb_array_length(changes)));
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;
