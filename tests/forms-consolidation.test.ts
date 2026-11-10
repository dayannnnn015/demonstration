import { describe, expect, it } from 'vitest';
import { computeSf2, computeSf4, type DayRule, type Schedule, type Session, type Sf2Source, type Sf4Source } from '../src/modules/forms/attendance.js';

/**
 * The SF2 and the SF4 over one and the same month.
 *
 * They are compiled by different functions from different queries, so the
 * claim that the school's monthly consolidation is the sections' own SF2s
 * added up is a claim that has to be checked rather than assumed. Here one set
 * of marks is turned into both forms the way the two source queries turn it,
 * and the figures are required to agree.
 */

const rule: DayRule = { mixed_day: 'tardy', single_session_day: 'counts', version: 1 };
const after = '2026-11-30';

/** Monday to Friday, both sessions in the classroom. */
const days: Schedule[] = Array.from({ length: 5 }, (_, i) => ({ day_on: `2026-10-0${i + 5}`, am: 'classroom', pm: 'classroom', configured: true }));
const dates = days.map(d => d.day_on);

type Marks = [Session, Session][];
/** Five learners, each with their five days: two absences, one late and one cutting between them. */
const roster: { sex: 'male' | 'female'; marks: Marks }[] = [
  { sex: 'male', marks: [['present', 'present'], ['present', 'present'], ['present', 'present'], ['present', 'present'], ['present', 'present']] },
  { sex: 'male', marks: [['absent', 'absent'], ['present', 'present'], ['present', 'present'], ['absent', 'absent'], ['present', 'present']] },
  { sex: 'male', marks: [['present', 'present'], ['absent', 'present'], ['present', 'present'], ['present', 'present'], ['present', 'present']] },
  { sex: 'female', marks: [['present', 'present'], ['present', 'present'], ['present', 'absent'], ['present', 'present'], ['present', 'present']] },
  { sex: 'female', marks: [['present', 'present'], ['present', 'present'], ['present', 'present'], ['present', 'present'], ['present', 'present']] },
];

const school = {}, school_year = { id: 'y1', start_year: 2026, starts_on: '2026-06-01', ends_on: '2027-03-31', status: 'active' };
const shared = { month_on: '2026-10-01', from: '2026-10-01', to: '2026-10-09', today: after };

/** The SF2's source, as `read_sf2_source` builds it: a cell per membership day, with its two marks. */
const sf2Source = (): Sf2Source => ({
  school, school_year, ...shared, cutoff: '2026-06-05', month_status: 'submitted',
  section: { id: 's1', grade_level: 3, name: 'A', adviser_user_id: 'u1', adviser_name: 'Adviser' },
  days, at_cutoff: { male: 3, female: 2 },
  learners: roster.map((r, i) => ({
    enrollment_id: `e${i}`, first_name: `First${i}`, middle_name: null, last_name: `Last${i}`, name_extension: null,
    sex: r.sex, lrn: null,
    first_entry: { reason: 'regular', effective_on: '2026-06-01', section_id: 's1' }, events: [],
    cells: dates.map((day_on, d) => ({ day_on, am: r.marks[d]![0], pm: r.marks[d]![1] })),
  })),
});

/** The SF4's source, as `read_sf4_source` builds it: the same marks, counted into groups per day. */
const sf4Source = (): Sf4Source => ({
  school, school_year, ...shared,
  sections: [{
    section_id: 's1', grade_level: 3, name: 'A', adviser_name: 'Adviser', adviser_position: 'Teacher I', adviser_specialization: 'General Education',
    month_status: 'submitted', registered: { male: 3, female: 2 }, movement: {},
    days: days.map((d, i) => {
      const counts = new Map<string, ['male' | 'female', Session, Session, number]>();
      for (const r of roster) {
        const [am, pm] = r.marks[i]!, key = `${r.sex}|${am}|${pm}`;
        const found = counts.get(key);
        if (found) found[3] += 1; else counts.set(key, [r.sex, am, pm, 1]);
      }
      return { ...d, groups: [...counts.values()] };
    }),
  }],
  other_staff: [],
});

describe('the SF2 and the SF4 over one month', () => {
  const sf2 = computeSf2(sf2Source(), rule);
  const sf4 = computeSf4(sf4Source(), rule);
  const section = sf4.sections[0]!;

  it('both read the month as complete', () => {
    expect(sf2.completeness.complete).toBe(true);
    expect(section.completeness.complete).toBe(true);
    expect(sf4.completeness.complete).toBe(true);
  });

  it('counts the same days of classes', () => {
    expect(sf2.summary.days_of_classes).toBe(5);
    expect(section.days_of_classes).toBe(sf2.summary.days_of_classes);
  });

  it('registers the same learners at the end of the month', () => {
    expect(sf2.summary.registered).toEqual({ male: 3, female: 2, total: 5 });
    expect(section.registered).toEqual(sf2.summary.registered);
  });

  it('reaches the same average daily attendance, per sex and in total', () => {
    // 25 learner-days less two full absences, with the late and the cutting day each counted present.
    expect(sf2.summary.average_daily_attendance).toEqual({ male: 13 / 5, female: 10 / 5, total: 23 / 5 });
    expect(section.average_daily_attendance).toEqual(sf2.summary.average_daily_attendance);
  });

  it('reaches the same percentage of attendance', () => {
    expect(section.percentage).toEqual(sf2.summary.percentage_of_attendance);
  });

  it('rolls one section up to its grade and to the school unchanged', () => {
    expect(sf4.grades).toHaveLength(1);
    expect(sf4.grades[0]).toMatchObject({ grade_level: 3, registered: section.registered, average_daily_attendance: section.average_daily_attendance });
    expect(sf4.school_total.average_daily_attendance).toEqual(section.average_daily_attendance);
    expect(sf4.school_total.registered).toEqual(section.registered);
  });
});

describe('what the SF4 refuses', () => {
  it('leaves a section with an unmarked session out of every average, and the school total with it', () => {
    const source = sf4Source();
    // One learner's afternoon on the first day goes unrecorded.
    const first = source.sections[0]!.days[0]!;
    first.groups = [['male', 'present', null, 1], ['male', 'present', 'present', 2], ['female', 'present', 'present', 2]];
    const sf4 = computeSf4(source, rule);
    expect(sf4.sections[0]!.average_daily_attendance).toBeNull();
    expect(sf4.sections[0]!.completeness).toMatchObject({ complete: false, unmarked_learner_days: 1 });
    // Counts still add up; an average over a month with a hole in it does not.
    expect(sf4.school_total.registered).toEqual({ male: 3, female: 2, total: 5 });
    expect(sf4.school_total.average_daily_attendance).toBeNull();
    expect(sf4.school_total.percentage).toBeNull();
  });

  it('refuses the school average when only one of two sections is complete', () => {
    const source = sf4Source();
    const second = structuredClone(source.sections[0]!);
    second.section_id = 's2'; second.name = 'B';
    second.days[0]!.groups = [['male', null, null, 3], ['female', 'present', 'present', 2]];
    source.sections.push(second);
    const sf4 = computeSf4(source, rule);
    expect(sf4.sections[0]!.average_daily_attendance).not.toBeNull();
    expect(sf4.sections[1]!.average_daily_attendance).toBeNull();
    expect(sf4.school_total.average_daily_attendance).toBeNull();
    // The registered counts of both sections still total, because counting needs no complete month.
    expect(sf4.school_total.registered).toEqual({ male: 6, female: 4, total: 10 });
  });

  it('counts no average at all with no rule recorded, on either form', () => {
    expect(computeSf2(sf2Source(), null).summary.average_daily_attendance).toBeNull();
    expect(computeSf4(sf4Source(), null).sections[0]!.average_daily_attendance).toBeNull();
    expect(computeSf4(sf4Source(), null).sections[0]!.days_of_classes).toBeNull();
  });

  /**
   * Today, before anyone has taken the register.
   *
   * Both forms call today still to come until a mark is recorded on it, so a
   * consolidation opened at eight in the morning is not "missing today's
   * marks". The SF4 used to count anything not in the future, which put the
   * whole of today's roster into `unmarked_learner_days` and flagged every
   * section that was simply not due yet (fixed 2026-11-03).
   */
  it('agrees with the SF2 about today, before the register is taken', () => {
    const today = '2026-10-09';
    const blank = (source: { sections: { days: { day_on: string; groups: unknown[] }[] }[] }) => {
      const last = source.sections[0]!.days.find(d => d.day_on === today)!;
      last.groups = [['male', null, null, 3], ['female', null, null, 2]];
    };
    const sf4Today = { ...sf4Source(), today };
    blank(sf4Today);
    const sf2Today = { ...sf2Source(), today };
    for (const l of sf2Today.learners) { const cell = l.cells.find(c => c.day_on === today)!; cell.am = null; cell.pm = null; }

    const section = computeSf4(sf4Today, rule).sections[0]!;
    const sf2 = computeSf2(sf2Today, rule);
    // Both hold today over as a day still to come and count the four days behind it.
    expect(sf2.completeness).toMatchObject({ pending_days: 1, unmarked_sessions: 0 });
    expect(sf2.to_date).toMatchObject({ as_of: '2026-10-08', days_held: 4 });
    expect(section.completeness).toMatchObject({ pending_days: 1, unmarked_learner_days: 0 });
  });

  it('counts today once the register is started, so a half-taken class is still a gap', () => {
    const today = '2026-10-09';
    const source = { ...sf4Source(), today };
    // Three marked, two not: the register has been started, so today is no longer held over.
    source.sections[0]!.days.find(d => d.day_on === today)!.groups = [['male', 'present', 'present', 3], ['female', null, null, 2]];
    expect(computeSf4(source, rule).sections[0]!.completeness).toMatchObject({ pending_days: 0, unmarked_learner_days: 2 });
  });

  it('names the sections that have not submitted the month, which is what gates issuing it', () => {
    const source = sf4Source();
    source.sections[0]!.month_status = 'draft';
    expect(computeSf4(source, rule).completeness.not_submitted).toBe(1);
    expect(computeSf4(sf4Source(), rule).completeness.not_submitted).toBe(0);
  });
});
