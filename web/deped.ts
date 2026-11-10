/**
 * Facts taken from DepEd's own orders, each with its source, for the screens
 * that offer them. None of this is applied by itself: a manager reviews a
 * proposal built from it, the same as the report cards' learning areas, and
 * the school's own calendar and decisions come first wherever they differ.
 *
 * DepEd Order No. 9, s. 2026 (signed 16 April 2026), Guidelines on the
 * Implementation of the Three-Term School Calendar in Basic Education, applies
 * to all public elementary and secondary schools. DepEd Order No. 15, s. 2026
 * (signed 4 June 2026), Revised Guidelines on Classroom Assessment, Grading
 * System, and Awards and Recognition, applies from school year 2026–2027 and
 * repeals DO No. 8, s. 2015.
 */
import type { Listed } from './calendar-fill';

export type DepedCalendar = {
  source: string;
  start_year: number;
  starts_on: string;
  ends_on: string;
  terms: { name: string; starts_on: string; ends_on: string }[];
  holidays: Listed[];
  breaks: Listed[];
  /** Counted as class days by the order but held as guided asynchronous learning: the school says how it marks them. */
  asynchronous: Listed[];
  /** Annex B's class days per month, which the proposal is checked against. */
  classDays: Record<string, number>;
};

/** SY 2026–2027 from DO No. 9, s. 2026: the summary on page 27 and the monthly calendar in Annex B. */
export const deped2026: DepedCalendar = {
  source: 'DepEd Order No. 9, s. 2026',
  start_year: 2026,
  starts_on: '2026-06-08',
  ends_on: '2027-04-08',
  terms: [
    { name: 'Term 1', starts_on: '2026-06-08', ends_on: '2026-09-15' },
    { name: 'Term 2', starts_on: '2026-09-16', ends_on: '2026-12-18' },
    { name: 'Term 3', starts_on: '2027-01-04', ends_on: '2027-04-08' },
  ],
  holidays: [
    { from: '2026-06-12', to: '2026-06-12', label: 'Independence Day' },
    { from: '2026-08-21', to: '2026-08-21', label: 'Ninoy Aquino Day' },
    { from: '2026-08-31', to: '2026-08-31', label: 'National Heroes Day' },
    { from: '2026-11-01', to: '2026-11-01', label: 'All Saints’ Day' },
    { from: '2026-11-02', to: '2026-11-02', label: 'All Souls’ Day' },
    { from: '2026-11-30', to: '2026-11-30', label: 'Bonifacio Day' },
    { from: '2026-12-08', to: '2026-12-08', label: 'Feast of the Immaculate Conception of Mary' },
    { from: '2026-12-24', to: '2026-12-24', label: 'Christmas Eve' },
    { from: '2026-12-25', to: '2026-12-25', label: 'Christmas Day' },
    { from: '2026-12-30', to: '2026-12-30', label: 'Rizal Day' },
    { from: '2026-12-31', to: '2026-12-31', label: 'Last Day of the Year' },
    { from: '2027-01-01', to: '2027-01-01', label: 'New Year’s Day' },
    { from: '2027-02-06', to: '2027-02-06', label: 'Chinese New Year' },
    { from: '2027-03-25', to: '2027-03-25', label: 'Maundy Thursday' },
    { from: '2027-03-26', to: '2027-03-26', label: 'Good Friday' },
    { from: '2027-03-27', to: '2027-03-27', label: 'Black Saturday' },
  ],
  breaks: [{ from: '2026-12-19', to: '2027-01-03', label: 'Year-end break' }],
  asynchronous: [
    { from: '2026-09-10', to: '2026-09-15', label: 'Wellness break of learners (guided asynchronous learning)' },
    { from: '2026-12-17', to: '2026-12-18', label: 'Wellness break of learners (guided asynchronous learning)' },
  ],
  classDays: {
    '2026-06': 16, '2026-07': 23, '2026-08': 19, '2026-09': 22, '2026-10': 22, '2026-11': 19,
    '2026-12': 13, '2027-01': 20, '2027-02': 20, '2027-03': 21, '2027-04': 6,
  },
};

/** The DepEd calendar for a school year, where an order has been issued for it. */
export const depedCalendar = (startYear: number) => (startYear === deped2026.start_year ? deped2026 : null);

/**
 * DO No. 15, s. 2026, Table 12 (KS1 transition to descriptive grading): Grade 1
 * is graded descriptively from 2026–2027, Grade 2 from 2027–2028 and Grade 3
 * from 2028–2029. A descriptively graded learner gets performance levels and
 * narratives, not a numeric grade or a general average.
 */
export function descriptiveGrading(gradeLevel: number, startYear: number) {
  if (gradeLevel < 1 || gradeLevel > 3 || startYear < 2026) return false;
  return gradeLevel <= startYear - 2025;
}
