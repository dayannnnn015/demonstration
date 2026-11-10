import type { Row } from './api';

/**
 * The change audit records database table names and SQL verbs, which are
 * developer detail: a principal reading "section_subject_events INSERT" learns
 * nothing. These name each record the way its screen does. A table not listed
 * still reads as words rather than as an identifier, so a new module degrades
 * to plain English instead of snake case.
 */
const names: Record<string, string> = {
  school_profile: 'School profile',
  academic_years: 'School year',
  reporting_periods: 'Reporting period',
  sections: 'Section',
  staff: 'Staff access',
  staff_invitations: 'Staff invitation',
  learners: 'Learner',
  enrollments: 'Enrollment',
  enrollment_events: 'Enrollment movement',
  lrn_corrections: 'LRN correction',
  enrollment_corrections: 'Enrollment timeline correction',
  import_previews: 'Roster import review',
  import_batches: 'Roster import',
  instructional_calendars: 'Instructional calendar',
  instructional_days: 'Calendar date',
  calendar_review_events: 'Calendar change',
  attendance_days: 'Attendance sheet',
  attendance_marks: 'Attendance mark',
  attendance_review_events: 'Attendance review',
  attendance_months: 'Attendance month',
  attendance_followups: 'Follow-up case',
  subjects: 'Subject',
  section_subjects: 'Subject offering',
  assessment_policy_drafts: 'Assessment policy draft',
  assessment_policy_adoptions: 'Policy adoption',
  assessment_policy_bindings: 'Policy binding',
  assessment_tasks: 'Assessment',
  assessment_scores: 'Raw score',
};

/**
 * Journal rows: every reviewed change writes its own immutable history row in
 * the same transaction, so each change appears twice in the audit — once for
 * the record, once for its history. A summary shows the record and skips the
 * echo; the full log keeps both, labelled.
 */
export const isJournal = (table: string) => /_events$/.test(table) && !['enrollment_events', 'calendar_review_events', 'attendance_review_events'].includes(table);

const words = (table: string) => {
  const text = table.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function recordName(table: string) {
  if (names[table]) return names[table]!;
  if (isJournal(table)) {
    const base = table.replace(/_events$/, 's');
    return `${names[base] ?? names[table.replace(/_events$/, '')] ?? words(table.replace(/_events$/, ''))} history`;
  }
  return words(table);
}

export const actionName = (row: Row) => (isJournal(String(row.entity_table)) ? 'Recorded' : row.operation === 'INSERT' ? 'Added' : row.operation === 'UPDATE' ? 'Changed' : words(String(row.operation).toLowerCase()));

/** Column names as words, so "display_order, subject_snapshot" reads "display order, subject snapshot". */
export const fieldNames = (fields: unknown) => (Array.isArray(fields) ? fields.map(f => String(f).replace(/_/g, ' ')) : []);
