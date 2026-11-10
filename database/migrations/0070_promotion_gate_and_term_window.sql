-- Three things the school asked for on 2026-11-09, which the system did not do.
--
-- 1. **A term accepts grades only once it has started.** `reporting_periods`
--    has dates and no status, and the report-card writers checked only that a
--    period *belongs to the year* (0030's `P1905`). So an adviser could encode
--    the third term in June, and finishing the first term "unlocked" the second
--    only in the sense that nothing was ever locked. The school's rule, as
--    decided: a term opens on its own `starts_on` and stays open while the year
--    is open. Completing a term unlocks nothing; the next term opens on its own
--    configured date. A term already begun never closes, because the ECR's
--    figures arrive after the term is over and a correction must stay possible.
--
--    It is enforced by a **trigger on the three tables**, not inside the four
--    writers, so `record_report_grades`, `record_report_values`,
--    `record_report_notes` and `record_report_card` are all covered by one rule
--    that no later writer can forget. The final grade, the subject average and
--    the general average name no term and are not gated: they are not a
--    reporting period's records.
--
-- 2. **Promotion is closed until the class's report cards are complete.**
--    `promotion_section` checked only that the year was open and the caller
--    advised the section. Now both writers ask `read_promotion_readiness`,
--    which counts what *this grade's card prints* against every currently
--    enrolled learner -- every learning area in every configured term, each
--    subject average and its remark, and a general average -- and refuses with
--    `P2002` while one is missing. A grade that prints no numeric grade is
--    judged on what it does print: a descriptively graded grade (DO 15 s. 2026)
--    on its term narratives, and Kindergarten, which prints no card at all, on
--    nothing -- a Kinder outcome stays recordable, because it is the credential
--    presented for Grade 1.
--
--    It counts **records**, never a grade's value: nothing here reads, totals
--    or compares a mark, and the readiness read names no learner, so it writes
--    no `record_access_events` row (the same reason `read_grade_entry` names
--    none).
--
-- 3. **An approved outcome carries the learner into next year by itself.**
--    Approval set `status='approved'` and stopped. Carrying forward was a
--    separate manager action, Next year's classes, which a school could simply
--    never run. Now `decide_promotions` advances each learner it approves, in
--    the same transaction, through the same `place_enrollment` everything else
--    enrols through: the next grade for a promotion or conditional promotion,
--    the same grade for a retention, **no section** -- which is 0049's settled
--    decision and is exactly what makes them pullable by next year's adviser.
--
--    EDUNEXUS cannot invent a school year, so when the following year does not
--    exist yet the outcome is recorded and the carry-forward runs the moment
--    that year is created, from an `after insert` trigger on `academic_years`.
--    Nothing is silently skipped: every learner not advanced carries the reason
--    why, and a second approval advances nobody twice --
--    `enrollments_valid_learner_year_idx` makes a duplicate impossible, and the
--    advance looks for one first and reports `already_enrolled`.

-- 1 ------------------------------------------------------------------------
-- A term's records may only be written once the term has started. The guard is
-- on the table, so every writer -- and every writer added later -- obeys it.
create function edunexus.guard_report_period() returns trigger language plpgsql set search_path='' as $$
declare p edunexus.reporting_periods;
begin
  if new.reporting_period_id is null then return new; end if;
  select * into p from edunexus.reporting_periods where id=new.reporting_period_id;
  -- An unknown period is the writers' own refusal (P1905); this trigger judges only the date.
  if not found then return new; end if;
  if p.starts_on > (now() at time zone 'Asia/Manila')::date then
    raise exception using errcode='P1908',message=p.name;
  end if;
  return new;
end $$;
create trigger report_period_window before insert or update on edunexus.report_grades for each row execute function edunexus.guard_report_period();
create trigger report_period_window before insert or update on edunexus.report_values for each row execute function edunexus.guard_report_period();
create trigger report_period_window before insert or update on edunexus.report_notes for each row execute function edunexus.guard_report_period();

-- 2 ------------------------------------------------------------------------
-- What this grade's card prints, and so what promotion waits for. Grade 0
-- prints no card; a descriptively graded grade prints narratives and no numeric
-- grade (DO 15 s. 2026, Table 12, as web/deped.ts states it).
create function edunexus.promotion_requirement(p_grade smallint,p_start_year integer) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'descriptive',descriptive,
    'grades',p_grade>=1 and not descriptive,
    'note_kinds',case when not descriptive then array[]::text[]
      when p_grade=1 then array['can_do','to_improve'] else array['comment'] end)
  from (select p_grade between 1 and 3 and p_start_year>=2026 and p_grade<=p_start_year-2025 descriptive) q
$$;

-- How far one section's report cards have come, judged against what its card
-- prints. Counts only: no learner is named and no grade is read, so nothing is
-- written to the access log.
create function edunexus.read_promotion_readiness(p_section uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; y edunexus.academic_years; req jsonb; kinds text[]; heads integer; areas integer; terms integer;
  per_term jsonb; final_grades integer; final_remarks integer; averages integer; missing integer; blocked text;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  select * into s from edunexus.sections where id=p_section;
  if not found or (not edunexus.is_manager() and s.adviser_user_id is distinct from edunexus.actor_id()) then
    raise exception using errcode='P0002',message='Section not found'; end if;
  select * into y from edunexus.academic_years where id=s.academic_year_id;
  req:=edunexus.promotion_requirement(s.grade_level,y.start_year);
  kinds:=array(select jsonb_array_elements_text(req->'note_kinds'));
  select count(*) into heads from edunexus.enrollments e where e.section_id=s.id and e.record_state='valid' and e.status='enrolled';
  select count(*) into areas from edunexus.section_subjects o where o.section_id=s.id and o.active;
  select count(*) into terms from edunexus.reporting_periods where academic_year_id=y.id;
  -- Per term: every learning area for every learner, or -- where the card is
  -- descriptive -- every narrative the card holds.
  per_term:=(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'ordinal',p.ordinal,'name',p.name,'starts_on',p.starts_on,'ends_on',p.ends_on,
      'open',p.starts_on<=(now() at time zone 'Asia/Manila')::date,'missing',t.gap,'complete',t.gap=0) order by p.ordinal),'[]'::jsonb)
    from edunexus.reporting_periods p cross join lateral (select case
        when (req->>'grades')::boolean then heads*areas-(select count(*) from edunexus.report_grades g
          join edunexus.enrollments e on e.id=g.enrollment_id join edunexus.section_subjects o on o.id=g.offering_id
          where g.reporting_period_id=p.id and g.grade is not null and o.active and o.section_id=s.id
            and e.section_id=s.id and e.record_state='valid' and e.status='enrolled')
        when cardinality(kinds)>0 then heads*cardinality(kinds)-(select count(*) from edunexus.report_notes n
          join edunexus.enrollments e on e.id=n.enrollment_id
          where n.reporting_period_id=p.id and n.kind=any(kinds) and n.body is not null
            and e.section_id=s.id and e.record_state='valid' and e.status='enrolled')
        else 0 end gap) t
    where p.academic_year_id=y.id);
  if (req->>'grades')::boolean then
    select heads*areas-count(*) into final_grades from edunexus.report_grades g
      join edunexus.enrollments e on e.id=g.enrollment_id join edunexus.section_subjects o on o.id=g.offering_id
      where g.reporting_period_id is null and g.grade is not null and o.active and o.section_id=s.id
        and e.section_id=s.id and e.record_state='valid' and e.status='enrolled';
    select heads*areas-count(*) into final_remarks from edunexus.report_grades g
      join edunexus.enrollments e on e.id=g.enrollment_id join edunexus.section_subjects o on o.id=g.offering_id
      where g.reporting_period_id is null and g.remark is not null and o.active and o.section_id=s.id
        and e.section_id=s.id and e.record_state='valid' and e.status='enrolled';
    select heads-count(*) into averages from edunexus.report_summaries r join edunexus.enrollments e on e.id=r.enrollment_id
      where r.general_average is not null and e.section_id=s.id and e.record_state='valid' and e.status='enrolled';
  else final_grades:=0;final_remarks:=0;averages:=0; end if;
  select coalesce(sum((x->>'missing')::integer),0) into missing from jsonb_array_elements(per_term) x;
  missing:=missing+final_grades+final_remarks+averages;
  -- A grade whose card prints nothing waits for nothing: Kindergarten's outcome
  -- is the credential it presents for Grade 1, and is recorded with no card.
  if s.grade_level=0 then blocked:=null;
  elsif terms=0 then blocked:='no_periods';
  elsif (req->>'grades')::boolean and areas=0 then blocked:='no_offerings';
  elsif missing>0 then blocked:='incomplete';
  else blocked:=null; end if;
  return jsonb_build_object('section',jsonb_build_object('id',s.id,'grade_level',s.grade_level,'name',s.name,
      'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id)),
    'school_year',jsonb_build_object('id',y.id,'start_year',y.start_year,'status',y.status),
    'today',(now() at time zone 'Asia/Manila')::date,'learners',heads,'offerings',areas,
    'requires',req,'ready',blocked is null,'blocked_by',blocked,
    'missing_total',case when s.grade_level=0 then 0 else missing end,'periods',per_term,
    'final',jsonb_build_object('missing_grades',final_grades,'missing_remarks',final_remarks,'complete',final_grades+final_remarks=0),
    'general_average',jsonb_build_object('missing',averages,'complete',averages=0));
end $$;

create function edunexus.assert_promotion_ready(p_section uuid) returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  r:=edunexus.read_promotion_readiness(p_section);
  if (r->>'ready')::boolean then return; end if;
  raise exception using errcode='P2002',message=r->>'blocked_by';
end $$;

-- 3 ------------------------------------------------------------------------
-- One approved outcome, carried into the following school year. Returns why it
-- was not, rather than raising: an outcome is the school's decision and stands
-- whether or not next year exists to receive it yet. A real failure inside
-- place_enrollment still raises, and the whole approval rolls back with it.
create function edunexus.advance_approved_enrollment(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; p edunexus.promotion_decisions; src edunexus.academic_years; tgt edunexus.academic_years;
  l edunexus.learners; learner uuid; target_grade integer; placed edunexus.enrollments;
begin
  select * into p from edunexus.promotion_decisions where enrollment_id=p_enrollment;
  if not found or p.status<>'approved' or p.action is null then return jsonb_build_object('advanced',false,'why','not_approved'); end if;
  -- Remedial is not a carry-forward: 0034's rule, and the one outcome that names no next grade.
  if p.action='remedial' then return jsonb_build_object('advanced',false,'why','remedial'); end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if e.record_state<>'valid' or e.status<>'enrolled' then return jsonb_build_object('advanced',false,'why','not_enrolled'); end if;
  target_grade:=e.grade_level+case when p.action in ('promoted','conditionally_promoted') then 1 else 0 end;
  -- Grade 6 promoted has completed elementary school; there is no Grade 7 here.
  if target_grade>6 then return jsonb_build_object('advanced',false,'why','completer'); end if;
  select * into src from edunexus.academic_years where id=e.academic_year_id;
  select * into tgt from edunexus.academic_years where start_year=src.start_year+1 and status<>'closed' for update;
  if not found then return jsonb_build_object('advanced',false,'why','no_next_year'); end if;
  select coalesce(merged_into,id) into learner from edunexus.learners where id=e.learner_id;
  if exists(select 1 from edunexus.enrollments t join edunexus.learners tl on tl.id=t.learner_id
      where t.academic_year_id=tgt.id and t.record_state='valid' and coalesce(tl.merged_into,tl.id)=learner) then
    return jsonb_build_object('advanced',false,'why','already_enrolled','academic_year_id',tgt.id); end if;
  select * into l from edunexus.learners where id=learner;
  -- place_enrollment refuses a learner with no LRN (P0303). Reported rather than
  -- raised, so one missing LRN cannot block a whole class's approval.
  if l.lrn is null then return jsonb_build_object('advanced',false,'why','no_lrn'); end if;
  placed:=edunexus.place_enrollment(learner,tgt.id,target_grade::smallint,null,tgt.starts_on,'regular');
  return jsonb_build_object('advanced',true,'enrollment_id',placed.id,'academic_year_id',tgt.id,
    'start_year',tgt.start_year,'grade_level',target_grade,'action',p.action);
end $$;

-- The run is recorded where every other carry-forward is, so Next year's
-- classes shows it beside the manual runs. `review_hash` is NOT NULL and is a
-- preview fingerprint; an automatic run has no preview, so it carries a digest
-- of what it placed and says so in its reason.
create function edunexus.record_carry_forward(p_source uuid,p_target uuid,p_entries jsonb,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare chunk jsonb; n integer; i integer:=0;
begin
  if p_entries is null or jsonb_array_length(p_entries)=0 then return; end if;
  if edunexus.actor_id() is null or nullif(current_setting('edunexus.request_id',true),'') is null then return; end if;
  n:=jsonb_array_length(p_entries);
  -- next_year_placements.entries holds at most 1000, and the school's roll is ~897.
  while i<n loop
    chunk:=(select jsonb_agg(q.x) from (select value x,ordinality k from jsonb_array_elements(p_entries) with ordinality) q where q.k>i and q.k<=i+500);
    insert into edunexus.next_year_placements(source_year_id,target_year_id,grade_level,seed,review_hash,entries,reason,actor_user_id,request_id)
    values(p_source,p_target,null,0,md5(chunk::text)||md5(p_reason||chunk::text),chunk,p_reason,edunexus.actor_id(),
      nullif(current_setting('edunexus.request_id',true),'')::uuid);
    i:=i+500;
  end loop;
end $$;

-- 0059's writer, with 0060's four outcomes and the readiness gate.
create or replace function edunexus.record_promotion_recommendations(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.promotion_decisions; saved edunexus.promotion_decisions; changes jsonb:='[]'; seen uuid[]:='{}'; e uuid; a text;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.promotion_section(p_section,false);
  -- Promotion is closed until this class's report cards are complete.
  perform edunexus.assert_promotion_ready(s.id);
  for entry in select x.value from jsonb_array_elements(p_entries) x loop
    if jsonb_typeof(entry)<>'object' or entry-array['enrollment_id','action','version']<>'{}'::jsonb or jsonb_typeof(entry->'enrollment_id') is distinct from 'string'
      or jsonb_typeof(entry->'version') is distinct from 'number' or entry->'action' is null or jsonb_typeof(entry->'action') not in ('string','null') then
      raise exception using errcode='23514',message='Invalid promotion entry fields'; end if;
    e:=(entry->>'enrollment_id')::uuid;
    if e=any(seen) then raise exception using errcode='23514',message='Each learner appears once per batch'; end if;
    seen:=array_append(seen,e);
    perform edunexus.report_enrollment(s.id,e);
    a:=entry->>'action';
    if a is not null and a not in ('promoted','conditionally_promoted','retained','remedial') then raise exception using errcode='23514',message='An outcome is promoted, conditionally promoted, retained or remedial'; end if;
    select * into existing from edunexus.promotion_decisions where enrollment_id=e for update;
    if found then
      if (entry->>'version')::integer is distinct from existing.version then raise exception using errcode='P0003',message='A promotion changed while you were editing'; end if;
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
  perform edunexus.notify_managers('promotion_endorsed','sections',s.id,s.academic_year_id,s.id,null,
    edunexus.section_notification_payload(s.id)||jsonb_build_object('count',jsonb_array_length(changes)));
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

-- 0059's writer, with the readiness gate and the automatic advance.
create or replace function edunexus.decide_promotions(p_section uuid,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s edunexus.sections; entry jsonb; existing edunexus.promotion_decisions; saved edunexus.promotion_decisions; changes jsonb:='[]'; seen uuid[]:='{}';
  e uuid; d text; kinds text[]:='{}'; adviser uuid; moved jsonb:='[]'; step jsonb; target uuid; advanced integer:=0;
begin
  perform pg_advisory_xact_lock(82412001);
  perform edunexus.check_report_batch(p_entries,p_reason);
  s:=edunexus.promotion_section(p_section,true);
  perform edunexus.assert_promotion_ready(s.id);
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
    -- Already decided that way: nothing changes, and nobody advances twice.
    if existing.status=d then continue; end if;
    update edunexus.promotion_decisions set status=d,decided_by=edunexus.actor_id() where enrollment_id=e returning * into saved;
    -- The approval itself carries the learner forward, in this transaction.
    step:=case when d='approved' then edunexus.advance_approved_enrollment(e) else jsonb_build_object('advanced',false,'why','returned') end;
    if (step->>'advanced')::boolean then
      advanced:=advanced+1;target:=(step->>'academic_year_id')::uuid;
      moved:=moved||jsonb_build_array(jsonb_build_object('source_enrollment_id',e,'action',existing.action,
        'enrollment_id',step->>'enrollment_id','section_id',null,'grade_level',(step->>'grade_level')::integer));
    end if;
    changes:=changes||jsonb_build_array(jsonb_build_object('enrollment_id',e,'before',jsonb_build_object('action',existing.action,'status',existing.status),
      'after',jsonb_build_object('action',existing.action,'status',d),'version',saved.version,'advance',step));
    kinds:=array_append(kinds,d);
  end loop;
  if jsonb_array_length(changes)=0 then raise exception using errcode='P1904',message='Nothing has changed'; end if;
  insert into edunexus.promotion_events(section_id,kind,entries,reason,actor_user_id,request_id)
    values(s.id,case when 'returned'=any(kinds) then 'return' else 'approve' end,changes,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  if advanced>0 then perform edunexus.record_carry_forward(s.academic_year_id,target,moved,
    'Carried forward automatically when the outcome was approved.'); end if;
  select adviser_user_id into adviser from edunexus.sections where id=s.id;
  perform edunexus.notify(adviser,case when 'returned'=any(kinds) then 'promotion_returned' else 'promotion_approved' end,
    'sections',s.id,s.academic_year_id,s.id,null,
    edunexus.section_notification_payload(s.id)||jsonb_build_object('count',jsonb_array_length(changes)));
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes,'advanced',advanced,
    'waiting_for_next_year',(select count(*) from jsonb_array_elements(changes) x where x->'advance'->>'why'='no_next_year'));
end $$;

-- An outcome approved before next year existed is carried forward the moment it
-- does. The approval is already the school's decision; this only acts on it.
create function edunexus.carry_forward_on_new_year() returns trigger language plpgsql security definer set search_path='' as $$
declare src edunexus.academic_years; rec record; step jsonb; moved jsonb:='[]';
begin
  if edunexus.actor_id() is null or nullif(current_setting('edunexus.request_id',true),'') is null then return new; end if;
  select * into src from edunexus.academic_years where start_year=new.start_year-1;
  if not found then return new; end if;
  for rec in select p.enrollment_id id,p.action from edunexus.promotion_decisions p
      join edunexus.enrollments e on e.id=p.enrollment_id
      where e.academic_year_id=src.id and e.record_state='valid' and e.status='enrolled'
        and p.status='approved' and p.action in ('promoted','conditionally_promoted','retained')
      order by p.enrollment_id loop
    step:=edunexus.advance_approved_enrollment(rec.id);
    if (step->>'advanced')::boolean then
      moved:=moved||jsonb_build_array(jsonb_build_object('source_enrollment_id',rec.id,'action',rec.action,
        'enrollment_id',step->>'enrollment_id','section_id',null,'grade_level',(step->>'grade_level')::integer));
    end if;
  end loop;
  perform edunexus.record_carry_forward(src.id,new.id,moved,'Carried forward automatically when this school year was created.');
  return new;
end $$;
create trigger carry_forward_approved after insert on edunexus.academic_years for each row execute function edunexus.carry_forward_on_new_year();

revoke all on function edunexus.guard_report_period(),edunexus.promotion_requirement(smallint,integer),edunexus.read_promotion_readiness(uuid),
  edunexus.assert_promotion_ready(uuid),edunexus.advance_approved_enrollment(uuid),edunexus.record_carry_forward(uuid,uuid,jsonb,text),
  edunexus.carry_forward_on_new_year() from public;
grant execute on function edunexus.read_promotion_readiness(uuid) to edunexus_app;
