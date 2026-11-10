-- A report-card record only where the learner's card prints it (testing finding
-- F27, decided by Claude under the user's instruction of 26 October 2026 to make
-- T7 close to perfect). The class tables offered every table to every grade, so
-- an adviser could record observed values for Grades 1 to 3, a comment for
-- Grades 4 to 6, or a numeric grade for a descriptively graded Grade 1, and no
-- SF9 or SF10 ever printed them: the work simply disappeared.
--
-- The cards are the school's own, as docs/school-forms.md records them:
-- observed values only on the Grades 4 to 6 card; the two narratives only on
-- Grade 1's; a comment only on the Grades 2 to 3 card. DepEd Order No. 15,
-- s. 2026, Table 12 grades Grade 1 descriptively from 2026-2027, Grade 2 from
-- 2027-2028 and Grade 3 from 2028-2029, with no numeric grade or general
-- average (settled 2026-10-08; web/deped.ts holds the same rule).
--
-- Triggers rather than new writers, so every writer and the card's one-step
-- write keep their own checks unchanged. Clearing a record is always allowed,
-- so one recorded before this migration can still be removed.
create function edunexus.report_card_grade(p_enrollment uuid) returns table(grade_level integer,start_year integer)
language sql stable security definer set search_path='' as $$
  select s.grade_level,y.start_year from edunexus.enrollments e
    join edunexus.sections s on s.id=e.section_id join edunexus.academic_years y on y.id=e.academic_year_id
  where e.id=p_enrollment
$$;

create function edunexus.report_card_descriptive(p_grade integer,p_start_year integer) returns boolean
language sql immutable set search_path='' as $$
  select p_grade between 1 and 3 and p_start_year>=2026 and p_grade<=p_start_year-2025
$$;

create function edunexus.guard_report_card_box() returns trigger language plpgsql security definer set search_path='' as $$
declare g integer; y integer; row_value jsonb:=to_jsonb(new);
begin
  -- Each table has its own columns, so the row is read as JSON: a field another table lacks is simply absent.
  select c.grade_level,c.start_year into g,y from edunexus.report_card_grade(new.enrollment_id) c;
  if tg_table_name in ('report_grades','report_summaries') then
    if (coalesce(row_value->>'grade',row_value->>'general_average',row_value->>'remark') is not null) and edunexus.report_card_descriptive(g,y) then
      raise exception using errcode='P1907',message='A descriptively graded learner has no numeric grade or general average on the card';
    end if;
  elsif tg_table_name='report_values' then
    if exists(select 1 from jsonb_each_text(coalesce(row_value->'ratings','{}'::jsonb)) r where r.value is not null) and g<4 then
      raise exception using errcode='P1907',message='Observed values are on the Grades 4 to 6 card only';
    end if;
  elsif tg_table_name='report_notes' and row_value->>'body' is not null then
    if row_value->>'kind' in ('can_do','to_improve') and g<>1 then
      raise exception using errcode='P1907',message='The two narratives are on the Grade 1 card only';
    elsif row_value->>'kind'='comment' and g not in (2,3) then
      raise exception using errcode='P1907',message='A term comment is on the Grades 2 and 3 card only';
    end if;
  end if;
  return new;
end $$;
revoke all on function edunexus.report_card_grade(uuid),edunexus.report_card_descriptive(integer,integer),edunexus.guard_report_card_box() from public;

create trigger report_grades_card_box before insert or update on edunexus.report_grades for each row execute function edunexus.guard_report_card_box();
create trigger report_summaries_card_box before insert or update on edunexus.report_summaries for each row execute function edunexus.guard_report_card_box();
create trigger report_values_card_box before insert or update on edunexus.report_values for each row execute function edunexus.guard_report_card_box();
create trigger report_notes_card_box before insert or update on edunexus.report_notes for each row execute function edunexus.guard_report_card_box();
