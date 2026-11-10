-- Next year's classes: continuing learners enrolled into the following school
-- year from their approved end-of-year outcomes. A promoted learner moves up a
-- grade (Kindergarten to Grade 1), a retained learner stays, and a Grade 6
-- learner promoted has completed elementary school and is not placed. Which
-- section each learner joins is drawn by the API from a seed the manager sees
-- and can repeat, balanced by sex and size; the draw never decides who moves
-- up. A commit is one transaction through enroll_learner, all rows or none,
-- recorded with its seed and the fingerprint of the preview the manager
-- approved. No class size is enforced: the school has given no capacity.
create table edunexus.next_year_placements (
  id bigint generated always as identity primary key,
  source_year_id uuid not null references edunexus.academic_years(id) on delete restrict,
  target_year_id uuid not null references edunexus.academic_years(id) on delete restrict,
  grade_level smallint check(grade_level between 0 and 6),
  seed bigint not null check(seed between 0 and 2147483647),
  review_hash text not null check(review_hash ~ '^[0-9a-f]{64}$'),
  entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 1 and 1000),
  reason text not null check(length(btrim(reason)) between 10 and 500),
  actor_user_id uuid not null references edunexus.staff(user_id) on delete restrict,request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check(source_year_id<>target_year_id)
);
create index next_year_placement_years_idx on edunexus.next_year_placements(source_year_id,target_year_id,id desc);
create index next_year_placement_target_idx on edunexus.next_year_placements(target_year_id);
create index next_year_placement_actor_idx on edunexus.next_year_placements(actor_user_id);
alter table edunexus.next_year_placements enable row level security;
create policy manager_read on edunexus.next_year_placements for select to edunexus_app using(edunexus.is_manager());
grant select on edunexus.next_year_placements to edunexus_app;
create trigger audit_record after insert on edunexus.next_year_placements for each row execute function edunexus.audit_record();

-- The two years: next year's classes go into the school year right after the source, while it is a draft or active.
create function edunexus.next_year_pair(p_source uuid,p_target uuid,out source edunexus.academic_years,out target edunexus.academic_years) language plpgsql security definer set search_path='' as $$
begin
  if not edunexus.is_manager() then raise exception using errcode='42501',message='Manager access required'; end if;
  select * into source from edunexus.academic_years where id=p_source for share;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  select * into target from edunexus.academic_years where id=p_target for share;
  if not found then raise exception using errcode='P0002',message='School year not found'; end if;
  if target.start_year<>source.start_year+1 or target.status='closed' then
    raise exception using errcode='P2100',message='Next year''s classes go into the school year right after this one, while it is a draft or active'; end if;
end $$;

-- Everything the API needs to draw a preview: the source year's learners with
-- their outcomes and whether they are already enrolled next year, and the
-- target year's sections with the learners already in them, by sex.
create function edunexus.read_next_year_source(p_source uuid,p_target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
      join edunexus.sections s on s.id=e.section_id left join edunexus.promotion_decisions p on p.enrollment_id=e.id
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

-- The commit re-checks every placement against the outcome it rests on: an
-- approved promotion or retention, into a section of the grade it leads to.
create function edunexus.commit_next_year_placement(p_source uuid,p_target uuid,p_grade smallint,p_seed bigint,p_hash text,p_entries jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
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
    select * into p from edunexus.promotion_decisions where enrollment_id=e.id and status='approved' and action in ('promoted','retained');
    if not found then raise exception using errcode='P2102',message='A learner is placed only from an approved promotion or retention'; end if;
    target_grade:=e.grade_level+case when p.action='promoted' then 1 else 0 end;
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

alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory','enrollmentAttendance','enrollmentScores',
  'sf2Get','sf2Issue','sf9Get','sf9Issue','sf10Get','sf10Issue','reportRecordsGet','reportRecordsWrite',
  'promotionsGet','promotionsWrite','gradeSummaryGet','nextYearPreview','nextYearCommit'
));

revoke all on function edunexus.next_year_pair(uuid,uuid),edunexus.read_next_year_source(uuid,uuid),
  edunexus.commit_next_year_placement(uuid,uuid,smallint,bigint,text,jsonb,text) from public;
grant execute on function edunexus.read_next_year_source(uuid,uuid),edunexus.commit_next_year_placement(uuid,uuid,smallint,bigint,text,jsonb,text) to edunexus_app;
