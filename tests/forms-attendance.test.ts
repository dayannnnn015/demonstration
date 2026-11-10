import { describe, expect, it } from 'vitest';
import { attendanceFor, attendanceTotal, computeSf9, type AttendanceRow, type Sf9Source } from '../src/modules/forms/cards.js';
import type { DayRule, Session } from '../src/modules/forms/attendance.js';

/**
 * What the SF9's ATTENDANCE RECORD counts, and — the point of this file — what
 * leaves a month empty on it.
 *
 * The card blanks a month rather than guessing, which is right, but on the card
 * a blank looks the same whatever caused it. These cases pin each cause to the
 * figure it produces, so "there are marks in October, why is October empty?"
 * has an answer that can be read off the code rather than argued about.
 */

const rule: DayRule = { mixed_day: 'tardy', single_session_day: 'counts', version: 1 };
type Day = Sf9Source['days'][number];

/** A date the calendar holds classes on both sessions, with whatever was marked. */
const day = (day_on: string, mark_am: Session, mark_pm: Session, over: Partial<Day> = {}): Day =>
  ({ day_on, am: 'classroom', pm: 'classroom', configured: true, mark_am, mark_pm, ...over });

/** Five class days, Monday to Friday, every session present. */
const week = (from: number, marks: [Session, Session][] = []): Day[] =>
  Array.from({ length: 5 }, (_, i) => {
    const pair = marks[i] ?? ['present', 'present'];
    return day(`2026-10-${String(from + i).padStart(2, '0')}`, pair[0]!, pair[1]!);
  });

const row = (over: Partial<AttendanceRow & { started: boolean }> = {}): AttendanceRow & { started: boolean } =>
  ({ label: 'October', term: null, from: '2026-10-01', to: '2026-10-31', class_days: 5, present: 5, absent: 0, tardy: 0, known: true, started: true, unmarked: [], unset: [], ...over });

/** A date after every October case below, so October has wholly run. */
const after = '2026-11-30';

describe('the SF9 attendance record', () => {
  it('counts a fully marked month', () => {
    const counted = attendanceFor(week(5), rule, '2026-10-01', '2026-10-31', after);
    expect(counted).toMatchObject({ class_days: 5, present: 5, absent: 0, tardy: 0, known: true });
  });

  it('counts an absence and a tardy day the way the SF2 does', () => {
    const days = week(5, [['present', 'present'], ['absent', 'absent'], ['absent', 'present'], ['present', 'absent'], ['present', 'present']]);
    // Under the tardy rule a mixed day is present and tardy at once, which is why present is 4 and not 3.
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', after)).toMatchObject({ class_days: 5, present: 4, absent: 1, tardy: 2, known: true });
  });

  it('leaves a month empty when one session of one day is unmarked, and names the day', () => {
    // The case that prompted this file: the register plainly has marks, and the month is still empty.
    const days = week(5, [['present', 'present'], ['present', null], ['present', 'present'], ['present', 'present'], ['present', 'present']]);
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', after))
      .toMatchObject({ class_days: 5, present: null, absent: null, tardy: null, known: false, started: true, unmarked: ['2026-10-06'], unset: [] });
  });

  it('leaves a month empty for a class day the learner has no mark on at all', () => {
    const days = week(5, [['present', 'present'], [null, null], ['present', 'present'], ['present', 'present'], ['present', 'present']]);
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', after)).toMatchObject({ class_days: 5, present: null, known: false });
  });

  it('counts a single-session day from the one session the school holds', () => {
    const days = [...week(5).slice(0, 4), day('2026-10-09', 'present', null, { pm: 'no_class' })];
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', after)).toMatchObject({ class_days: 5, present: 5, known: true });
  });

  it('blanks the days of classes too when a date is unconfigured or on alternative delivery, and names it', () => {
    const unset = [...week(5).slice(0, 4), day('2026-10-09', null, null, { configured: false, am: null, pm: null })];
    expect(attendanceFor(unset, rule, '2026-10-01', '2026-10-31', after)).toMatchObject({ class_days: null, present: null, known: false, unset: ['2026-10-09'] });
    const adm = [...week(5).slice(0, 4), day('2026-10-09', null, null, { am: 'alternative_delivery' })];
    expect(attendanceFor(adm, rule, '2026-10-01', '2026-10-31', after)).toMatchObject({ class_days: null, present: null, known: false, unset: ['2026-10-09'] });
  });

  it('names nothing for a month that is fully counted', () => {
    expect(attendanceFor(week(5), rule, '2026-10-01', '2026-10-31', after)).toMatchObject({ known: true, unmarked: [], unset: [] });
  });

  it('counts a month under way to the last day held, and says which', () => {
    // Today is the 7th and nobody has marked it yet: the 5th and 6th are the month so far.
    const days = [...week(5).slice(0, 2), day('2026-10-07', null, null), day('2026-10-08', null, null)];
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', '2026-10-07'))
      .toMatchObject({ class_days: 2, present: 2, known: true, to_date: '2026-10-06' });
  });

  it('shows a month wholly to come as days of classes and nothing else', () => {
    const days = week(5).map(d => ({ ...d, mark_am: null, mark_pm: null }));
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', '2026-09-01'))
      .toMatchObject({ class_days: 5, present: null, known: false, started: false });
  });

  it('fills in nothing at all with no rule recorded', () => {
    expect(attendanceFor(week(5), null, '2026-10-01', '2026-10-31', after)).toMatchObject({ class_days: null, present: null, known: false });
  });

  it('refuses the year total while one begun month is unknown, and ignores months not begun', () => {
    const begun = [row({ label: 'September' }), row({ label: 'October', present: null, known: false })];
    expect(attendanceTotal(begun)).toMatchObject({ class_days: null, present: null });
    const fine = [row({ label: 'September' }), row({ label: 'October' }), row({ label: 'November', started: false, known: false, present: null, class_days: 20 })];
    // The two months that have run are totalled; the one still to come is left out and marks the total as to date.
    expect(attendanceTotal(fine)).toMatchObject({ class_days: 10, present: 10, to_date: '2026-10-31' });
  });
});

describe('what the card says about an empty month', () => {
  /** The card's own warning for one month's worth of days, without building a whole SF9 around it. */
  const warningFor = (days: Day[], today: string) => {
    const r = attendanceFor(days, rule, '2026-10-01', '2026-10-31', today);
    return { ...r, blanked: !r.known && r.started && (r.unmarked.length > 0 || r.unset.length > 0) };
  };

  it('treats a month with a gap that has begun as needing an explanation', () => {
    const days = week(5, [['present', 'present'], ['present', null], ['present', 'present'], ['present', 'present'], ['present', 'present']]);
    expect(warningFor(days, '2026-11-30').blanked).toBe(true);
  });

  it('says nothing about a month wholly still to come', () => {
    const days = week(5).map(d => ({ ...d, mark_am: null, mark_pm: null }));
    // Nothing has happened yet, so there is no gap to name and no warning to give.
    expect(warningFor(days, '2026-09-01')).toMatchObject({ blanked: false, started: false, unmarked: [], unset: [] });
  });

  it('collects every unmarked day of the month, not just the first', () => {
    const days = week(5, [['present', null], ['present', 'present'], [null, 'present'], ['present', 'present'], [null, null]]);
    expect(attendanceFor(days, rule, '2026-10-01', '2026-10-31', '2026-11-30').unmarked)
      .toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
  });

  /** A Grade 3 card over one October, which is all the warning needs. */
  const card = (days: Day[], today = '2026-11-30') => computeSf9({
    school: {}, today,
    learner: { id: 'l1', first_name: 'Juan', middle_name: null, last_name: 'Dela Cruz', name_extension: null, sex: 'male', lrn: null, birth_date: '2017-05-02' },
    enrollment: { id: 'e1', grade_level: 3, status: 'enrolled', section_id: 's1', section_name: 'A', adviser_name: 'Adviser' },
    school_year: { id: 'y1', start_year: 2026, starts_on: '2026-10-01', ends_on: '2026-10-31', status: 'active' },
    periods: [], offerings: [], grades: [], summary: null, values: [], notes: [], days,
  }, rule).warnings;

  it('names the unmarked dates on the card itself, so the gap can be found', () => {
    const days = week(5, [['present', null], ['present', 'present'], [null, 'present'], ['present', 'present'], ['present', 'present']]);
    expect(card(days)).toEqual(['October is empty because 2 days have a session nobody marked (5 and 7 October). A missing mark is never counted as present, so mark it on the register and this month fills in.']);
  });

  it('says so differently when the calendar, not the register, is what is missing', () => {
    const days = [...week(5).slice(0, 4), day('2026-10-09', null, null, { configured: false, am: null, pm: null })];
    expect(card(days)[0]).toContain('October is empty because one date is not set on the calendar');
  });

  it('warns about nothing when every day of the month is marked', () => {
    expect(card(week(5))).toEqual([]);
  });
});
