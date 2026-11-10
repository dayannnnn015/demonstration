-- Automatic enrolment is for a promotion only.
--
-- `0070` carried three approved outcomes into the following school year:
-- `promoted` and `conditionally_promoted` at the next grade, and **`retained`
-- at the same grade**. The school narrowed it on 2026-11-09: *"automatic
-- enrolment will do only if the learner was recommended for promotion and the
-- ao/principal approves it."*
--
-- So a retained learner is no longer enrolled into next year by the approval.
-- Both halves of the sentence still hold for the ones that are: the outcome
-- must have been **recommended by the adviser** and then **approved by the
-- principal or administrative officer** — `advance_approved_enrollment` reads
-- `promotion_decisions`, which only `record_promotion_recommendations` writes
-- and only `decide_promotions` approves, so there is no path into an automatic
-- enrolment that skips either step.
--
-- **`conditionally_promoted` counts as a promotion**, because it is one: DepEd
-- Order No. 15, s. 2026 moves the learner up with subjects to make up, and
-- every other place in this schema already treats it that way —
-- `commit_next_year_placement` (0049) adds a grade for it, and `eligibleFor` in
-- `src/modules/forms/cards.ts` certifies the next grade for it on the SF9 and
-- SF10. If the school means promoted-only, this is the one line to change.
--
-- **What a retained learner gets instead.** Nothing is lost and nothing is
-- hidden: the outcome is still recorded and approved, their current enrolment,
-- grades and SF9 are untouched, and the approval response now says
-- `why: 'retained'` for each of them rather than reporting them as advanced.
-- Enrolling them for the next year is a decision again, by any of the three
-- routes that already exist:
--
--   * the office enrols them on **Enrollment**, as it would any learner;
--   * their adviser takes them in from **Learner registry**, where the pull
--     offers a learner with no enrolment this year on a search; or
--   * a manager carries them forward on **Next year's classes**, which still
--     includes a retention deliberately — that screen is a reviewed preview a
--     manager commits, not a side effect of approving an outcome, and the
--     narrowing above is about the side effect.
--
-- Nothing else changes. The promotion gate, the term window, the journal and
-- the duplicate guard are all 0070's and are untouched.

-- 0070's writer, with retention taken out of the carry-forward.
create or replace function edunexus.advance_approved_enrollment(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e edunexus.enrollments; p edunexus.promotion_decisions; src edunexus.academic_years; tgt edunexus.academic_years;
  l edunexus.learners; learner uuid; target_grade integer; placed edunexus.enrollments;
begin
  select * into p from edunexus.promotion_decisions where enrollment_id=p_enrollment;
  if not found or p.status<>'approved' or p.action is null then return jsonb_build_object('advanced',false,'why','not_approved'); end if;
  -- Only a promotion enrols (2026-11-09). A retention is still a recorded,
  -- approved outcome; it just does not carry the learner anywhere by itself.
  if p.action='retained' then return jsonb_build_object('advanced',false,'why','retained'); end if;
  -- Remedial names no next grade at all: 0034's rule, kept.
  if p.action='remedial' then return jsonb_build_object('advanced',false,'why','remedial'); end if;
  select * into e from edunexus.enrollments where id=p_enrollment;
  if e.record_state<>'valid' or e.status<>'enrolled' then return jsonb_build_object('advanced',false,'why','not_enrolled'); end if;
  -- Every action that reaches here moves up one grade.
  target_grade:=e.grade_level+1;
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

-- 0070's trigger, selecting only the outcomes that now carry forward. The
-- guard above would refuse a retention anyway; narrowing the query too keeps
-- the two from disagreeing about what this feature is for.
create or replace function edunexus.carry_forward_on_new_year() returns trigger language plpgsql security definer set search_path='' as $$
declare src edunexus.academic_years; rec record; step jsonb; moved jsonb:='[]';
begin
  if edunexus.actor_id() is null or nullif(current_setting('edunexus.request_id',true),'') is null then return new; end if;
  select * into src from edunexus.academic_years where start_year=new.start_year-1;
  if not found then return new; end if;
  for rec in select p.enrollment_id id,p.action from edunexus.promotion_decisions p
      join edunexus.enrollments e on e.id=p.enrollment_id
      where e.academic_year_id=src.id and e.record_state='valid' and e.status='enrolled'
        and p.status='approved' and p.action in ('promoted','conditionally_promoted')
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
