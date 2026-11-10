-- Conditional promotion, from DepEd Order No. 15, s. 2026 (Revised Guidelines on
-- Classroom Assessment, Grading System, and Awards and Recognition), which
-- repeals DO 8, s. 2015 from school year 2026-2027. Its section 67: a learner
-- who fails at most two learning areas attends the Summer Remedial Class; one
-- who still fails one or two after it "shall be conditionally promoted",
-- moving up with back subjects; one who fails more than two is retained. So a
-- school now records a fourth outcome, which leads to the next grade like a
-- promotion. Recorded, never derived: nothing reads a grade to choose it.
alter table edunexus.promotion_decisions drop constraint promotion_decisions_action_check;
alter table edunexus.promotion_decisions add constraint promotion_decisions_action_check
  check(action is null or action in ('promoted','conditionally_promoted','retained','remedial'));

-- 0033's writer, accepting the fourth outcome.
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
  return jsonb_build_object('changed',jsonb_array_length(changes),'entries',changes);
end $$;

-- 0034's commit, placing a conditionally promoted learner in the next grade.
create or replace function edunexus.commit_next_year_placement(p_source uuid,p_target uuid,p_grade smallint,p_seed bigint,p_hash text,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare pair record; entry jsonb; e edunexus.enrollments; p edunexus.promotion_decisions; s edunexus.sections; placed edunexus.enrollments; target_grade integer; done jsonb:='[]'::jsonb; learner uuid;
begin
  perform pg_advisory_xact_lock(82412001);
  select * into pair from edunexus.next_year_pair(p_source,p_target);
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 1000 then raise exception using errcode='22023',message='Between 1 and 1000 placements are required'; end if;
  if (select count(distinct x->>'enrollment_id') from jsonb_array_elements(p_entries) x)<>jsonb_array_length(p_entries) then
    raise exception using errcode='P2102',message='A learner is placed once'; end if;
  for entry in select x from jsonb_array_elements(p_entries) x loop
    select * into e from edunexus.enrollments where id=(entry->>'enrollment_id')::uuid and academic_year_id=p_source and record_state='valid' and status='enrolled';
    if not found then raise exception using errcode='P2102',message='Only a learner enrolled at the end of the year is placed'; end if;
    select * into p from edunexus.promotion_decisions where enrollment_id=e.id and status='approved' and action in ('promoted','conditionally_promoted','retained');
    if not found then raise exception using errcode='P2102',message='A learner is placed only from an approved promotion, conditional promotion or retention'; end if;
    target_grade:=e.grade_level+case when p.action in ('promoted','conditionally_promoted') then 1 else 0 end;
    select * into s from edunexus.sections where id=(entry->>'section_id')::uuid and academic_year_id=p_target and grade_level=target_grade;
    if not found or (p_grade is not null and target_grade<>p_grade) then raise exception using errcode='P2102',message='A learner is placed in a section of the grade their outcome leads to'; end if;
    select coalesce(merged_into,id) into learner from edunexus.learners where id=e.learner_id;
    placed:=edunexus.enroll_learner(learner,s.id,(pair.target).starts_on,'regular');
    done:=done||jsonb_build_object('source_enrollment_id',e.id,'learner_id',learner,'action',p.action,'enrollment_id',placed.id,'section_id',s.id,'grade_level',s.grade_level);
  end loop;
  insert into edunexus.next_year_placements(source_year_id,target_year_id,grade_level,seed,review_hash,entries,reason,actor_user_id,request_id)
  values(p_source,p_target,p_grade,p_seed,p_hash,done,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('placed',jsonb_array_length(done),'entries',done);
end $$;
