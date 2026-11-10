import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Where a change made on one screen also shows up. Many records feed the
 * school forms, so a correction typed in one place changes a form somewhere
 * else, and the person making it should know before saving rather than find
 * out from a printout. Each list names only what the forms really read; it is
 * kept here in one place so every screen says the same thing.
 */
export const reaches = {
  school: ['The heading of every SF2, SF4, SF9 and SF10: school name, school ID, region, division and district', 'The school head’s name and position on the forms’ signature lines'],
  staff: ['Their name on the SF2, SF9 and SF10 of every section they advise', 'Their row on the SF4, with its position and specialization columns', 'A change of permission level or access applies from their next request'],
  section: ['The section’s name on its SF2, its row on the SF4, and its learners’ SF9 and SF10', 'Who may open its register and report cards: a new adviser gains them and the previous adviser loses them'],
  lrn: ['The LRN on the learner’s SF9 and SF10, the class list, and the registry search', 'An LRN is recorded once: it cannot be cleared or changed here afterwards'],
  learner: ['Their name, birth date and sex on every SF2, SF9 and SF10 that lists them', 'A change of sex moves them between the SF2’s male and female blocks and the SF4’s counts'],
  register: ['This section’s SF2 for the month: the learner’s cells, totals and summary', 'The school’s SF4 for the month', 'The learner’s days present and absent on the SF9 and SF10'],
  calendar: ['Which dates each section’s register opens for marking', 'Days of classes on every affected SF2, the SF4’s averages, and days of school on the SF9'],
  dayRule: ['Every SF2 and SF4 figure, for every section and month', 'The days present and absent on every SF9 and SF10'],
  grades: ['The learner’s SF9 (report card) and SF10', 'The class summary and the Grade entry counts', 'Promotion, which shows the general average beside the outcome'],
  card: ['The learner’s SF9 (report card) for that term'],
  outcome: ['The eligibility line on the learner’s SF9 and SF10', 'Next year’s classes, which enrol continuing learners from approved outcomes'],
  month: ['Whether the section’s register for the month can still be changed: a submitted or locked month takes no changes until it is returned or reopened', 'Whether the SF4 counts the section as submitted for the month'],
  remarks: ['The remarks column of this month’s SF2'],
  subjects: ['The learning areas printed on the SF9 of every section that offers it', 'Grade entry and the class summary for those sections'],
  movement: ['The learner’s rows on the register from that date', 'The SF2’s remarks and counts, and the SF4’s movement columns, for that month and after'],
  history: ['The learner’s SF10, as a scholastic block in the school year it belongs to',
    'Nothing else. An encoded school year is a copy of a document, not an enrolment: it reaches no register, no SF2, no SF4 and no SF9, and it changes nobody’s current grade or section'],
  eligibility: ['The Eligibility for Elementary School Enrollment block on the learner’s SF10, including the school that issued the credential'],
} as const;
export type Reach = keyof typeof reaches;

/** What else a save changes, in a block that sits above the save button. It folds from its own
 *  heading like any other note, and like them it starts open. */
export function Affects({ what, children }: { what: Reach | Reach[]; children?: ReactNode }) {
  const items = [...new Set((Array.isArray(what) ? what : [what]).flatMap(w => reaches[w]))];
  return (
    <div className="affects" role="note">
      <Icon name="alert" size={15} />
      <details className="fold" open>
        <summary><h3 className="affects-title">Saving this also changes</h3><Icon name="caret" size={12} /></summary>
        <div className="fold-body">
          <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
          <p className="affects-foot">{children ?? 'Forms already issued keep what they said. The next copy printed or issued shows the change.'}</p>
        </div>
      </details>
    </div>
  );
}
