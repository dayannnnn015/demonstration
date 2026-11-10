import type { Role } from '../routes';

/**
 * Getting started, worked out from the records rather than remembered.
 *
 * Nothing stores who has done what (decided 2026-10-25): each item is a fact
 * about the school's records, so the list is never out of date and needs no
 * table of its own. Every fact comes from a read that writes nothing to the
 * privacy log — the Overview's own reads, the school profile and one row of the
 * subject catalog. The calendar is left out for that reason: its read records
 * an access row for the school year, and the Overview writes none.
 *
 * A fact that could not be read is `null`, and its item says so rather than
 * claiming it is done or not.
 */
export type Facts = {
  /** The school ID and school head are both on the profile. */
  school: boolean | null;
  active: boolean;
  periods: number;
  teachers: number | null;
  sections: number;
  unassigned: number;
  subjects: number | null;
  enrolled: number | null;
  rule: boolean | null;
};

export type Item = {
  id: string;
  title: string;
  done: boolean | null;
  /** What the step is, in a sentence. */
  note: string;
  /** The screen where it is done. */
  route: string;
  /** The tour that shows it, if there is one. */
  tour?: string;
};

const at = (n: number | null, test: (n: number) => boolean) => (n === null ? null : test(n));

export function checklist(role: Role | unknown, f: Facts): Item[] {
  if (role === 'teacher') {
    return [
      { id: 'section', title: 'A section to advise', done: f.sections > 0, route: 'years', note: 'The principal or the administrative officer assigns you to your section. Until then there is no class for you to see.' },
      { id: 'class-list', title: 'Your class list', done: at(f.enrolled, n => n > 0), route: 'imports', tour: 'class-list', note: 'Submit your section’s list from the template; the office imports it, and your learners appear.' },
      { id: 'rule', title: 'The school’s attendance rule', done: f.rule, route: 'school', note: 'Your SF2 is counted by the rule the principal records. Until then it shows your marks without totals.' },
    ];
  }
  return [
    { id: 'school', title: 'The school’s details', done: f.school, route: 'school', tour: 'setup-year', note: 'The school ID, address and school head every form prints.' },
    { id: 'year', title: 'A school year, active', done: f.active, route: 'years', tour: 'setup-year', note: 'Every record belongs to a school year. Nothing new can be recorded until one is active.' },
    { id: 'terms', title: 'Its terms', done: f.periods > 0, route: 'years', tour: 'setup-year', note: 'The terms the year is divided into, added while it is still a draft.' },
    { id: 'staff', title: 'Teachers with accounts', done: at(f.teachers, n => n > 0), route: 'invitations', tour: 'setup-year', note: 'Each teacher is invited, and their account created, before they can be made an adviser.' },
    { id: 'sections', title: 'The year’s sections', done: f.sections > 0, route: 'years', tour: 'setup-year', note: 'The school’s classes for this year.' },
    { id: 'advisers', title: 'An adviser for every section', done: f.sections > 0 && f.unassigned === 0, route: 'staff', tour: 'setup-year', note: 'A section with no adviser has nobody to take its register.' },
    { id: 'subjects', title: 'Learning areas', done: at(f.subjects, n => n > 0), route: 'subjects', tour: 'setup-year', note: 'The learning areas the report cards print, offered to each section.' },
    { id: 'learners', title: 'Learners enrolled', done: at(f.enrolled, n => n > 0), route: 'enrollment', note: 'Learners registered and enrolled in their sections, one at a time or from class lists.' },
    {
      id: 'rule', title: 'The school’s attendance rule', done: f.rule, route: 'school',
      ...(role === 'principal' ? { tour: 'attendance-rule' } : {}),
      note: role === 'principal'
        ? 'How a half-present day counts. Every attendance figure on the SF2, SF4 and report cards waits on it.'
        : 'Recorded by the principal. Every attendance figure on the SF2, SF4 and report cards waits on it.',
    },
  ];
}

/** Shown while anything known is still to do; an unread fact alone does not keep it up. */
export const stillToDo = (items: Item[]) => items.some(item => item.done === false);
