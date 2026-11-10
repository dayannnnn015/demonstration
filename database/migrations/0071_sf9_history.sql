-- The SF9 history on a learner's profile: one row per school year, saying
-- whether that year's report card was issued.
--
-- Asked for on 2026-11-09, with four other things that turned out to be true
-- already and are worth writing down here, because the next person to read this
-- request will reasonably assume all five needed building.
--
-- **The SF9 is already one card per enrollment, and always has been.**
-- `read_sf9_source` takes an *enrollment*, and every report-card record --
-- `report_grades`, `report_summaries`, `report_values`, `report_notes` -- hangs
-- off `enrollment_id`. A promotion creates a new enrollment for the new year and
-- grade (0070), and that enrollment has no records, so the next grade's card is
-- blank with nothing to reset and the previous grade's is untouched with nothing
-- to preserve. There is no stored SF9 document to overwrite: the card is derived
-- on every read, the way the SF10 is.
--
-- **An issuance is already scoped to the enrollment too.** `form_issuances` has
-- a CHECK that an `sf9` row names both an `academic_year_id` and an
-- `enrollment_id`, so every issued card is already tied to the learner, the
-- school year, the grade level and that year's own academic records. The prior
-- `record_form_issuance` looks for is keyed on that same scope, so a Grade 2
-- issuance cannot find, supersede or overwrite a Grade 1 one -- it is a new row
-- with `supersedes_id` null. And nothing is ever updated or deleted: a
-- correction appends a row naming the one it replaces.
--
-- `tests/sf9-per-grade.test.ts` asserts each of those, because none of it is
-- obvious from any one file and a later change to the issuance scope would break
-- it silently.
--
-- **What genuinely did not exist is the history itself.** Nothing could answer
-- "which of this learner's years have an issued card", so the profile's school
-- years table showed no card status at all. `form_issuances` cannot answer it
-- either: an `sf9` row has `learner_id` NULL by that same CHECK, so
-- `formIssuanceList`'s `learner_id` filter matches none of them, and its row
-- policy shows a teacher only the forms **they themselves** issued.
--
-- So: one read, per learner, joining each enrollment to its latest sf9
-- issuance.
--
--   * The join to `sections` is **outward**. A learner enrolled at a grade with
--     no class yet is exactly what a promoted learner is between the approval
--     and their new adviser's pull, and an inner join would drop the very row
--     the school wants to see as "In progress" (0049 and 0051 each learned this
--     the same way).
--   * `can_read_enrollment` decides every row, so **the read scope does not
--     widen**: a manager sees every year, and a teacher sees the years of the
--     classes they currently advise, which is what they can already read
--     everywhere else.
--   * It is `security definer`, so it bypasses `form_issuances`' own policy --
--     deliberately, and narrowly. It discloses *that* a card was issued, its
--     serial and its fingerprint, all of which are printed on the card the
--     caller may already print. It does **not** disclose who issued it: a staff
--     name is the part 0.92.0 refused to widen for and 0.101.0 opened only
--     through a function that could name one person on one of your own
--     notifications. There is no actor here at all.
--   * It reads **no grade**. Whether a card was issued is not a grade, and
--     nothing in this file touches `report_grades`.
create function edunexus.read_sf9_history(p_learner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l edunexus.learners;
begin
  perform pg_advisory_xact_lock_shared(82412001);
  if edunexus.actor_role() is null then raise exception using errcode='42501',message='Active staff required'; end if;
  -- A merged learner's records answer under the record that was kept, as the SF10's own read does.
  select retained.* into l from edunexus.learners original join edunexus.learners retained on retained.id=coalesce(original.merged_into,original.id)
    where original.id=p_learner;
  if not found or not edunexus.can_read_learner(l.id) then raise exception using errcode='P0002',message='Learner not found'; end if;
  return jsonb_build_object(
    'learner',jsonb_build_object('id',l.id,'first_name',l.first_name,'middle_name',l.middle_name,'last_name',l.last_name,
      'name_extension',l.name_extension,'lrn',l.lrn),
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
        'enrollment_id',e.id,'academic_year_id',y.id,'start_year',y.start_year,'year_status',y.status,
        'grade_level',e.grade_level,'section_name',s.name,'record_state',e.record_state,'enrollment_status',e.status,
        -- Kindergarten prints no card: the school has supplied none, and a Kinder
        -- learner's records are the SF5-K and the ECCD checklist, which EDUNEXUS
        -- neither holds nor replaces. `sf9Get` refuses it, so the history says so
        -- rather than offering a card that cannot be read.
        'card',case when e.record_state<>'valid' then 'voided' when e.grade_level=0 then 'no_card'
          when i.id is not null then 'issued' else 'in_progress' end,
        'issuance',case when i.id is null then null else jsonb_build_object('id',i.id,'serial',i.serial,
          'issued_at',i.issued_at,'data_hash',i.data_hash,'corrected',i.supersedes_id is not null,'reason',i.reason) end,
        'issued_count',(select count(*) from edunexus.form_issuances f where f.form='sf9' and f.enrollment_id=e.id)
      ) order by y.start_year,e.grade_level,e.id),'[]'::jsonb)
      from edunexus.enrollments e
      join edunexus.academic_years y on y.id=e.academic_year_id
      -- Outward: a learner with no class yet still has a card in progress.
      left join edunexus.sections s on s.id=e.section_id
      left join lateral (select f.* from edunexus.form_issuances f where f.form='sf9' and f.enrollment_id=e.id order by f.serial desc limit 1) i on true
      where e.learner_id in (select id from edunexus.learners where coalesce(merged_into,id)=l.id)
        and (edunexus.is_manager() or e.record_state='valid')
        and edunexus.can_read_enrollment(e.id)));
end $$;

-- The history names the learner's enrollments, so reading it is logged like
-- every other read that names a record.
alter table edunexus.record_access_events drop constraint record_access_events_resource_check;
alter table edunexus.record_access_events add constraint record_access_events_resource_check check(resource in (
  'learnerList','learnerGet','enrollmentList','enrollmentGet','enrollmentHistory','lrnCorrectionHistory','importPreview','importCommit','importGet',
  'timelineGet','timelinePreview','timelineCorrect','timelineCorrectionHistory','identityPreview','identityReconcile','identityHistory',
  'enrollmentRecordPreview','enrollmentRecordReview','enrollmentRecordHistory','placementPreview','placementCorrect','placementHistory',
  'calendarGet','calendarPreview','calendarCommit','calendarHistory','attendanceGet','attendancePreview','attendanceCommit','attendanceHistory',
  'monthStatus','monthGet','monthPreview','monthCommit','monthHistory','monthSnapshot','attendanceMonitor',
  'followupList','followupGet','followupOpenPreview','followupOpen','followupChangePreview','followupChange','followupHistory',
  'scoreSheet','scoreRecord','scoreHistory','enrollmentAttendance','enrollmentScores',
  'sf2Get','sf2Issue','sf9Get','sf9Issue','sf9History','sf10Get','sf10Issue','reportRecordsGet','reportRecordsWrite',
  'promotionsGet','promotionsWrite','gradeSummaryGet','nextYearPreview','nextYearCommit',
  'priorRecordsGet','priorRecordsWrite','priorRecordHistory','pullableList','learnerPull','learnerRegister'
));

revoke all on function edunexus.read_sf9_history(uuid) from public;
grant execute on function edunexus.read_sf9_history(uuid) to edunexus_app;
