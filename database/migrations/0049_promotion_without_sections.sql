-- Promotion moves a learner up a grade. It does not choose their class.
--
-- 0034 built next year's classes as a draw: every promoted learner was dealt
-- into a section of the grade their outcome led to, balanced by sex and size
-- from a seed. That was the whole feature, and it is the wrong shape for how
-- the school works. A learner who moves up does not keep their old class and
-- is not given a new one by the principal; an adviser takes them into a class
-- afterwards, which is separate work and not built here.
--
-- So a promotion now enrols at the target year and the target grade with no
-- section, which 0048 made possible. What changes:
--
--   * commit_next_year_placement no longer reads section_id from an entry. An
--     entry is an enrolment to carry forward; the grade comes from its outcome.
--   * A grade with no sections yet no longer blocks anyone. Under the draw, a
--     learner whose next grade had no section was simply left behind, and the
--     school had to create sections before it could promote.
--   * read_next_year_source joins the source section outwards. A learner who
--     is themselves unplaced this year still has an outcome and must still be
--     carried forward; an inner join would quietly drop them.
--
-- What does not change: only an approved promotion, conditional promotion or
-- retention is carried forward, each learner once, the whole batch in one
-- transaction, and the run recorded in next_year_placements with its reason.

create or replace function edunexus.read_next_year_source(p_source uuid,p_target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare pair record;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  select * into pair from edunexus.next_year_pair(p_source,p_target);
  return jsonb_build_object(
    'source_year',jsonb_build_object('id',(pair.source).id,'start_year',(pair.source).start_year,'status',(pair.source).status),
    'target_year',jsonb_build_object('id',(pair.target).id,'start_year',(pair.target).start_year,'starts_on',(pair.target).starts_on,'status',(pair.target).status),
    'learners',(select coalesce(jsonb_agg(jsonb_build_object('enrollment_id',e.id,'learner_id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,
        'last_name',l.last_name,'name_extension',l.name_extension,'sex',l.sex,'grade_level',e.grade_level,'section_id',e.section_id,'section_name',s.name,
        'status',e.status,'action',p.action,'outcome_status',p.status,
        'already_enrolled',exists(select 1 from edunexus.enrollments t join edunexus.learners tl on tl.id=t.learner_id
          where t.academic_year_id=p_target and t.record_state='valid' and coalesce(tl.merged_into,tl.id)=l.id)) order by e.id),'[]'::jsonb)
      from edunexus.enrollments e join edunexus.learners l0 on l0.id=e.learner_id join edunexus.learners l on l.id=coalesce(l0.merged_into,l0.id)
      left join edunexus.sections s on s.id=e.section_id left join edunexus.promotion_decisions p on p.enrollment_id=e.id
      where e.academic_year_id=p_source and e.record_state='valid'),
    'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'grade_level',s.grade_level,'name',s.name,
        'adviser_name',(select display_name from edunexus.staff where user_id=s.adviser_user_id),
        'male',(select count(*) from edunexus.enrollments t join edunexus.learners tl on tl.id=t.learner_id where t.section_id=s.id and t.record_state='valid' and t.status='enrolled' and tl.sex='male'),
        'female',(select count(*) from edunexus.enrollments t join edunexus.learners tl on tl.id=t.learner_id where t.section_id=s.id and t.record_state='valid' and t.status='enrolled' and tl.sex='female'))
        order by s.grade_level,lower(s.name),s.id),'[]'::jsonb)
      from edunexus.sections s where s.academic_year_id=p_target),
    'runs',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'grade_level',r.grade_level,'seed',r.seed,'placed',jsonb_array_length(r.entries),'reason',r.reason,
        'actor_name',(select display_name from edunexus.staff where user_id=r.actor_user_id),'recorded_at',r.recorded_at) order by r.id desc),'[]'::jsonb)
      from edunexus.next_year_placements r where r.source_year_id=p_source and r.target_year_id=p_target));
end $$;

-- The commit re-checks every learner against the outcome it rests on: an
-- approved promotion, conditional promotion or retention, carried into the
-- grade that outcome leads to. The section is left empty, deliberately.
create or replace function edunexus.commit_next_year_placement(p_source uuid,p_target uuid,p_grade smallint,p_seed bigint,p_hash text,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare pair record; entry jsonb; e edunexus.enrollments; p edunexus.promotion_decisions; placed edunexus.enrollments; target_grade integer; done jsonb:='[]'::jsonb; learner uuid;
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
    if target_grade<0 or target_grade>6 then raise exception using errcode='P2102',message='That outcome leads past the grades this school teaches'; end if;
    if p_grade is not null and target_grade<>p_grade then raise exception using errcode='P2102',message='A learner is carried into the grade their outcome leads to'; end if;
    select coalesce(merged_into,id) into learner from edunexus.learners where id=e.learner_id;
    placed:=edunexus.place_enrollment(learner,p_target,target_grade::smallint,null,(pair.target).starts_on,'regular');
    done:=done||jsonb_build_object('source_enrollment_id',e.id,'learner_id',learner,'action',p.action,'enrollment_id',placed.id,'section_id',null,'grade_level',target_grade);
  end loop;
  insert into edunexus.next_year_placements(source_year_id,target_year_id,grade_level,seed,review_hash,entries,reason,actor_user_id,request_id)
  values(p_source,p_target,p_grade,p_seed,p_hash,done,btrim(p_reason),edunexus.actor_id(),nullif(current_setting('edunexus.request_id',true),'')::uuid);
  return jsonb_build_object('placed',jsonb_array_length(done),'entries',done);
end $$;
