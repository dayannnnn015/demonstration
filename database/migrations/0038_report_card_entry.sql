-- One learner's report card, box by box, saved whole or not at all: the
-- adviser types the card as it prints (each learning area's term grades, the
-- subject average and remark, the general average, the observed values and
-- the term narratives or comments) and every box that changed is recorded in
-- one transaction. Each part goes through the same writer the class tables
-- use, so every check, version and journal row is theirs; a part with nothing
-- changed is skipped, and the card is refused only when nothing changed at all.
-- Nothing here computes a grade.
create function edunexus.record_report_card(p_enrollment uuid,p_card jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; item jsonb; part jsonb; entries jsonb:='[]'; seen text[]:='{}'; k text; total integer:=0;
begin
  perform pg_advisory_xact_lock(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if not found or e.record_state<>'valid' or not edunexus.can_read_enrollment(e.id) then raise exception using errcode='P0002',message='Enrollment not found'; end if;
  if p_card is null or jsonb_typeof(p_card)<>'object' or p_card-array['grades','summary','values','notes']<>'{}'::jsonb
    or jsonb_typeof(coalesce(p_card->'grades','[]'))<>'array' or jsonb_typeof(coalesce(p_card->'values','[]'))<>'array' or jsonb_typeof(coalesce(p_card->'notes','[]'))<>'array'
    or jsonb_typeof(coalesce(p_card->'summary','null')) not in ('object','null') then raise exception using errcode='23514',message='Invalid report card fields'; end if;
  if jsonb_array_length(coalesce(p_card->'grades','[]'))+jsonb_array_length(coalesce(p_card->'values','[]'))+jsonb_array_length(coalesce(p_card->'notes','[]'))
    +(case when jsonb_typeof(p_card->'summary')='object' then 1 else 0 end) not between 1 and 300 then raise exception using errcode='23514',message='Record 1 to 300 boxes of one card at a time'; end if;

  for item in select x.value from jsonb_array_elements(coalesce(p_card->'grades','[]')) x loop
    if jsonb_typeof(item)<>'object' or item-array['offering_id','reporting_period_id','grade','remark','version']<>'{}'::jsonb or jsonb_typeof(item->'offering_id') is distinct from 'string'
      or jsonb_typeof(item->'reporting_period_id') not in ('string','null') then raise exception using errcode='23514',message='Invalid grade entry fields'; end if;
    k:='g:'||(item->>'offering_id')||':'||coalesce(item->>'reporting_period_id','final');
    if k=any(seen) then raise exception using errcode='23514',message='Each box appears once on a card'; end if;
    seen:=array_append(seen,k);
    if not exists(select 1 from edunexus.section_subjects where id=(item->>'offering_id')::uuid and section_id=e.section_id) then
      raise exception using errcode='P1902',message='Record only the learning areas of this learner''s section'; end if;
    begin
      part:=edunexus.record_report_grades((item->>'offering_id')::uuid,(item->>'reporting_period_id')::uuid,
        jsonb_build_array((item-array['offering_id','reporting_period_id'])||jsonb_build_object('enrollment_id',e.id)),p_reason);
      total:=total+(part->>'changed')::integer; entries:=entries||(part->'entries');
    exception when sqlstate 'P1904' then null;
    end;
  end loop;

  if jsonb_typeof(p_card->'summary')='object' then
    if (p_card->'summary')-array['general_average','remark','version']<>'{}'::jsonb then raise exception using errcode='23514',message='Invalid general average entry fields'; end if;
    begin
      part:=edunexus.record_report_summaries(e.section_id,jsonb_build_array((p_card->'summary')||jsonb_build_object('enrollment_id',e.id)),p_reason);
      total:=total+(part->>'changed')::integer; entries:=entries||(part->'entries');
    exception when sqlstate 'P1904' then null;
    end;
  end if;

  for item in select x.value from jsonb_array_elements(coalesce(p_card->'values','[]')) x loop
    if jsonb_typeof(item)<>'object' or item-array['reporting_period_id','ratings','version']<>'{}'::jsonb or jsonb_typeof(item->'reporting_period_id') is distinct from 'string' then
      raise exception using errcode='23514',message='Invalid observed values entry fields'; end if;
    k:='v:'||(item->>'reporting_period_id');
    if k=any(seen) then raise exception using errcode='23514',message='Each box appears once on a card'; end if;
    seen:=array_append(seen,k);
    begin
      part:=edunexus.record_report_values(e.section_id,(item->>'reporting_period_id')::uuid,jsonb_build_array((item-'reporting_period_id')||jsonb_build_object('enrollment_id',e.id)),p_reason);
      total:=total+(part->>'changed')::integer; entries:=entries||(part->'entries');
    exception when sqlstate 'P1904' then null;
    end;
  end loop;

  -- The card's narratives and comments; a learner's SF2 remark belongs to the register, not the card.
  for item in select x.value from jsonb_array_elements(coalesce(p_card->'notes','[]')) x loop
    if jsonb_typeof(item)<>'object' or item-array['kind','reporting_period_id','body','version']<>'{}'::jsonb or jsonb_typeof(item->'reporting_period_id') is distinct from 'string'
      or item->>'kind' is null or item->>'kind' not in ('can_do','to_improve','comment') then raise exception using errcode='23514',message='Invalid note entry fields'; end if;
    k:='n:'||(item->>'kind')||':'||(item->>'reporting_period_id');
    if k=any(seen) then raise exception using errcode='23514',message='Each box appears once on a card'; end if;
    seen:=array_append(seen,k);
    begin
      part:=edunexus.record_report_notes(e.section_id,item->>'kind',(item->>'reporting_period_id')::uuid,null,
        jsonb_build_array((item-array['kind','reporting_period_id'])||jsonb_build_object('enrollment_id',e.id)),p_reason);
      total:=total+(part->>'changed')::integer; entries:=entries||(part->'entries');
    exception when sqlstate 'P1904' then null;
    end;
  end loop;

  if total=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  return jsonb_build_object('changed',total,'entries',entries);
end $$;

revoke all on function edunexus.record_report_card(uuid,jsonb,text) from public;
grant execute on function edunexus.record_report_card(uuid,jsonb,text) to edunexus_app;
