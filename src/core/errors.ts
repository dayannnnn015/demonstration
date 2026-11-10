export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: { path: string; message: string }[]) { super(message); }
}

/**
 * The unique rules a person runs into by typing something already recorded,
 * keyed by the constraint PostgreSQL names. Each is said beside the field the
 * screen asked for, or in words when no one field is to blame; any other
 * conflict keeps the generic answer, since its constraint name is internal.
 */
const duplicates: Record<string, { field?: string; message: string }> = {
  learners_lrn_key: { field: 'lrn', message: 'This LRN is already recorded for another learner. Search for it before registering.' },
  sections_year_grade_name_idx: { field: 'name', message: 'This grade already has a section with this name this school year.' },
  academic_years_start_year_key: { field: 'start_year', message: 'This school year is already recorded.' },
  reporting_periods_academic_year_id_ordinal_key: { field: 'ordinal', message: 'This school year already has a period with this number.' },
  subjects_code_key: { field: 'code', message: 'This code is already in the catalog.' },
  section_subjects_section_id_subject_id_key: { field: 'subject_id', message: 'This section already offers this subject. Reactivate it rather than adding it again.' },
  assessment_policy_drafts_code_key: { field: 'code', message: 'A policy draft already has this code.' },
  assessment_adoption_active_idx: { field: 'policy_id', message: 'This policy is already adopted for this school year.' },
  assessment_binding_active_idx: { field: 'offering_id', message: 'This learning area already has a policy bound. Release it before binding another.' },
  assessment_tasks_offering_id_reporting_period_id_component__key: { field: 'sequence', message: 'This component already has an assessment with this number this term.' },
  staff_invitation_open_idx: { field: 'email', message: 'An invitation for this address is already waiting.' },
  enrollments_valid_learner_year_idx: { message: 'This learner is already enrolled this school year. To change their section, or to take back a learner who left, record a movement on that enrollment.' },
  // Raised by the enrollment guards rather than an index, so known by their words.
  'Identity already enrolled in this year': { message: 'This learner is already enrolled this school year. To change their section, or to take back a learner who left, record a movement on that enrollment.' },
  'Identity already has a valid enrollment in this year': { message: 'This learner is already enrolled this school year. To change their section, or to take back a learner who left, record a movement on that enrollment.' },
  academic_years_one_active_idx: { message: 'Another school year is active. Close it before activating this one.' },
  attendance_followup_open_idx: { message: 'This learner already has an open follow-up case.' },
  roster_submission_waiting_idx: { message: 'This section already has a class list waiting for review.' },
  staff_name_request_open_idx: { message: 'You already have a correction waiting. Withdraw it on My profile to ask for a different one.' },
  learner_prior_year_idx: { field: 'year.start_year', message: 'This school year is already encoded for this learner. Open that year and correct it instead of adding it again.' },
  learner_prior_grade_name_idx: { message: 'The same learning area is listed twice in this school year. Each one is listed once, as the document prints it.' },
  learner_eligibility_learner_id_key: { message: 'This learner already has a credential recorded for Grade 1. Correct the one on file instead.' },
};
const constraintOf = (error: unknown) => { const e = error as { constraint?: unknown; constraint_name?: unknown } | null; const name = e?.constraint ?? e?.constraint_name; return typeof name === 'string' ? name : undefined; };

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P0002') return new AppError(404, 'NOT_FOUND', 'The record was not found.');
  if (code === 'P0003') return new AppError(409, 'VERSION_CONFLICT', 'The record changed. Refresh before saving.');
  if (code === 'P0004') return new AppError(409, 'PREVIEW_EXPIRED', 'The import preview expired. Create and review a new preview.');
  if (code === 'P0005') return new AppError(409, 'PREVIEW_CHANGED', 'The import differs from the reviewed preview. Create and review a new preview.');
  if (code === 'P0006') return new AppError(409, 'PREVIEW_LIMIT', 'You have ten pending previews. Complete one or wait for a preview to expire.');
  if (code === 'P0100') return new AppError(409, 'TIMELINE_DATES', 'Use increasing dates within the school year and after birth. Movements cannot be future-dated.');
  if (code === 'P0101') return new AppError(409, 'TIMELINE_TRANSITION', 'Start with enrollment, then use valid reassignment, withdrawal, and reentry transitions and reasons.');
  if (code === 'P0102') return new AppError(409, 'TIMELINE_SECTION', 'Every section must match the enrollment school year and grade.');
  if (code === 'P0103') return new AppError(409, 'TIMELINE_UNCHANGED', 'The proposed timeline has no changes.');
  if (code === 'P0104') return new AppError(409, 'TIMELINE_REVIEW_CHANGED', 'The proposal or related records changed. Preview and review the correction again.');
  if (code === 'P0105') return new AppError(409, 'YEAR_CLOSED', 'A closed school year cannot be corrected through this workflow.');
  if (code === 'P0200') return new AppError(409, 'IDENTITY_CONFLICT', 'Resolve the conflicts shown in the identity preview before confirming.');
  if (code === 'P0201') return new AppError(409, 'LINKED_LEARNER_READ_ONLY', 'This profile is linked. Use the retained learner or review reversal of the identity link.');
  if (code === 'P0202') return new AppError(409, 'IDENTITY_REVIEW_CHANGED', 'The profiles, memberships, or enrollment history changed. Preview and review again.');
  if (code === 'P0300') return new AppError(409, 'ENROLLMENT_RECORD_CONFLICT', 'Resolve the conflicts shown in the enrollment record preview before confirming.');
  if (code === 'P0301') return new AppError(409, 'VOIDED_ENROLLMENT_READ_ONLY', 'This enrollment was voided. Review restoration before editing its timeline or recording movements.');
  if (code === 'P0302') return new AppError(409, 'ENROLLMENT_RECORD_REVIEW_CHANGED', 'The enrollment, related records, or review changed. Preview and review again.');
  if (code === 'P0303') return new AppError(409, 'LRN_REQUIRED', 'This learner has no LRN on file. Record it on the Learner registry before enrolling them.', [{ path: 'learner_id', message: 'No LRN on file. Fill the official LRN on this learner’s record first.' }]);
  if (code === 'P0400') return new AppError(409, 'PLACEMENT_UNCHANGED', 'The grade is unchanged. Use timeline review for a correction within the same grade.');
  if (code === 'P0401') return new AppError(409, 'PLACEMENT_HISTORY_CHANGED', 'Grade-placement corrections preserve every date, movement type, and reason. Review only the grade and replacement sections.');
  if (code === 'P0500') return new AppError(409, 'CALENDAR_DATES', 'Use distinct dates inside the school year and read at most 62 dates at a time.');
  if (code === 'P0501') return new AppError(409, 'CALENDAR_UNCHANGED', 'The calendar proposal has no changes.');
  if (code === 'P0502') return new AppError(409, 'CALENDAR_CONFLICT', 'Resolve the conflicts the calendar preview shows: a school day not set yet, a section with its own schedule, or marks already recorded in a session the change would stop.');
  if (code === 'P0503') return new AppError(409, 'CALENDAR_REVIEW_CHANGED', 'The calendar proposal or related school records changed. Preview and review again.');
  if (code === 'P0600') return new AppError(409, 'ATTENDANCE_DATE', 'Select a date inside the section school year.');
  if (code === 'P0601') return new AppError(409, 'ATTENDANCE_YEAR', 'Record attendance only in an active year and on or before today.');
  if (code === 'P0602') return new AppError(409, 'ATTENDANCE_ENROLLMENT', 'The learner was not enrolled in this section on that date. Refresh the dated roster.');
  if (code === 'P0603') return new AppError(409, 'ATTENDANCE_SESSION', 'There is no classroom session to mark on that date: the calendar holds a weekend, a holiday, a free half day, an alternative-delivery day or nothing at all for it. Marks are taken only in a classroom session; the principal or administrative officer sets the calendar.');
  if (code === 'P0604') return new AppError(409, 'ATTENDANCE_UNCHANGED', 'The attendance proposal has no changes.');
  if (code === 'P0605') return new AppError(409, 'ATTENDANCE_REVIEW_CHANGED', 'The attendance proposal or related records changed. Preview and review again.');
  if (code === 'P0606') return new AppError(409, 'ATTENDANCE_DEPENDENCY', 'Existing attendance conflicts with this correction. Review and clear affected marks before changing the enrollment or schedule.');
  if (code === 'P1200') return new AppError(409, 'POLICY_DRAFT_UNCHANGED', 'The assessment-policy draft proposal has no changes.');
  if (code === 'P1201') return new AppError(409, 'POLICY_COMPONENTS', 'Use 1 to 10 distinct components with positive integer basis-point weights totaling 10000 (100%).');
  if (code === 'P1300') return new AppError(409, 'ADOPTION_STATE', 'Adopt the current unarchived draft revision. A withdrawn adoption cannot be withdrawn again.');
  if (code === 'P1301') return new AppError(409, 'ADOPTION_YEAR', 'Adopt inside an open school year, on a date within that year.');
  if (code === 'P1302') return new AppError(409, 'POLICY_DRAFT_ADOPTED', 'Withdraw the standing adoption before archiving this draft.');
  if (code === 'P1400') return new AppError(409, 'BINDING_STATE', 'Bind a standing adoption. A released binding cannot be released again.');
  if (code === 'P1401') return new AppError(409, 'BINDING_SCOPE', 'Bind an active offering whose school year matches the adoption and whose section grade the adopted revision applies to.');
  if (code === 'P1402') return new AppError(409, 'ADOPTION_BOUND', 'Release the subject bindings before withdrawing this adoption.');
  if (code === 'P1403') return new AppError(409, 'OFFERING_BOUND', 'Release the assessment-policy binding before retiring this offering.');
  if (code === 'P1500') return new AppError(409, 'INVITATION_STATE', 'This invitation was already completed or cancelled. Request a new one.');
  if (code === 'P1700') return new AppError(409, 'SUBMISSION_CLOSED', 'This class list is no longer waiting.');
  if (code === 'P1701') return new AppError(403, 'NOT_SECTION_ADVISER', 'Submit a list only for a section you currently advise, or for a grade you currently advise a class at.');
  if (code === 'P1702') return new AppError(409, 'SUBMISSION_YEAR', 'The school year is closed, or the enrollment date falls outside it.');
  if (code === 'P1703') return new AppError(409, 'SUBMISSION_WAITING', 'A list for this section or grade is already waiting. Withdraw it first, or ask a manager to decide it.');
  if (code === 'P2000') return new AppError(409, 'PROMOTION_APPROVED', 'This outcome is approved. The principal or administrative officer returns it before it can change.');
  if (code === 'P2200') return new AppError(409, 'ANNOUNCEMENT_ARCHIVED', 'An archived announcement is kept as it was. Write a new one instead.');
  if (code === 'P2201') return new AppError(409, 'ANNOUNCEMENT_STATE', 'The announcement is not in a state that allows this. Read it again.');
  if (code === 'P2402') return new AppError(409, 'NAME_REQUEST_DECIDED', 'This request is already decided or withdrawn. Read it again.');
  if (code === 'P2403') return new AppError(409, 'OWN_NAME_REQUEST', 'Nobody decides their own correction. Another principal or administrative officer decides it.');
  if (code === 'P2401') return new AppError(409, 'SESSION_UNKNOWN', 'This sign-in cannot be told apart from your others. Sign out, sign in again, then try once more.');
  if (code === 'P2400') return new AppError(409, 'PHOTO_MISSING', 'There is no photo on this profile. Upload one first, or choose initials or an icon.');
  if (code === 'P2500') return new AppError(403, 'PRIOR_RECORD_FORBIDDEN', 'Encode previous school years only for the learners currently in the sections you advise. A principal or administrative officer may encode for anyone.');
  if (code === 'P2501') return new AppError(409, 'PRIOR_LEARNER_LINKED', 'This profile was linked into another as the same child. Encode the history on the record that is kept.');
  if (code === 'P2502') {
    return new AppError(409, 'PRIOR_YEAR_IN_SYSTEM', 'EDUNEXUS already holds this school year for this learner, so it is already a block on their SF10. Enter its grades on Promotion → Report card instead.',
      [{ path: 'year.start_year', message: 'This school year is already recorded in EDUNEXUS. Its grades are entered on Promotion, not here.' }]);
  }
  if (code === 'P2503') {
    return new AppError(422, 'PRIOR_YEAR_RANGE', 'Encode a school year that has already begun.',
      [{ path: 'year.start_year', message: 'A school year from 1990 up to this one. A year still to come has no record to copy.' }]);
  }
  if (code === 'P2504') {
    return new AppError(422, 'PRIOR_GRADE_RANGE', 'A scholastic block is Grade 1 to Grade 6. A Kindergarten record is the credential presented for Grade 1: record it under Eligibility for Grade 1, which carries no grade.',
      [{ path: 'year.grade_level', message: 'Grade 1 to Grade 6. Kindergarten goes under Eligibility for Grade 1.' }]);
  }
  if (code === 'P2505') return new AppError(409, 'PRIOR_SUBJECT_DUPLICATE', 'The same learning area appears twice in this school year. Each one is listed once, as the document prints it.');
  if (code === 'P2506') return new AppError(409, 'PRIOR_NO_CHANGES', 'Nothing has changed.');
  if (code === 'P2507') return new AppError(422, 'PRIOR_SUBJECTS_REQUIRED', 'A school year needs at least one learning area. A year with no grades at all is not encoded: leave it out, and the SF10 prints it blank.');
  if (code === 'P2602') return new AppError(409, 'LEARNER_IN_CLASS', 'This learner is already in a class this school year. A principal or administrative officer moves a learner between classes.');
  if (code === 'P2603') return new AppError(409, 'LEARNER_OTHER_GRADE', 'This learner is registered at another grade this school year. A principal or administrative officer corrects a grade placement.');
  if (code === 'P2604') return new AppError(409, 'VERSION_CONFLICT', 'This learner was taken in or changed while the list was open. Read the list again and take them in from it.');
  if (code === 'P2605') return new AppError(409, 'LEARNER_ALREADY_ON_REGISTRY', 'A learner with this name and birth date is already on the registry. Open that record instead, or say in writing why this is a different child.', [{ path: 'distinct_reason', message: 'Say why this is a different child, in 10 to 500 characters.' }]);
  if (code === 'P2606') return new AppError(409, 'LEARNER_NOT_IN_CLASS', 'This learner is already in no class.');
  if (code === 'P2600') return new AppError(403, 'NOT_YOUR_CLASS', 'Take learners only into a class you advise. A principal or administrative officer can place a learner in any class.');
  if (code === 'P2601') return new AppError(409, 'LEARNER_ALREADY_ON_REGISTRY', 'A learner with this name and birth date is already on the school registry. Take that learner into your class instead of making a second record for the same child; the office can help if it is a different child with the same name.');
  if (code === 'P2508') return new AppError(422, 'PRIOR_CREDENTIAL_FIELDS', 'Name the credential presented for Grade 1, and only the fields that credential has: a rating belongs to a PEPT, and words in the box belong to an "other" credential.');
  if (code === 'P2300') return new AppError(409, 'FAQ_ARCHIVED', 'An archived question is kept as it was. Write a new one instead.');
  if (code === 'P2301') return new AppError(409, 'FAQ_STATE', 'The question is not in a state that allows this. Read it again.');
  if (code === 'P2100') return new AppError(409, 'NEXT_YEAR_INVALID', 'Next year’s classes go into the school year right after this one, while it is a draft or active.');
  if (code === 'P2102') return new AppError(409, 'PLACEMENT_INELIGIBLE', 'A learner is placed only from an approved promotion or retention, into a section of the grade it leads to.');
  if (code === 'P2001') return new AppError(409, 'PROMOTION_MISSING', 'There is no recommended outcome to decide for this learner.');
  if (code === 'P2002') {
    // Which of the three the readiness read found; the screen shows the missing terms beside this.
    const said = String((error as { message?: unknown } | null)?.message ?? '');
    const why = said === 'no_periods' ? 'This school year has no reporting periods configured yet.'
      : said === 'no_offerings' ? 'This class has no learning areas offered yet, so there are no grades to complete.'
      : 'Every term’s grades, each subject average and remark, and each learner’s general average must be recorded first.';
    return new AppError(409, 'PROMOTION_NOT_OPEN', `Promotion is not open for this class yet. ${why}`);
  }
  if (code === 'P1900') return new AppError(409, 'RECORD_YEAR_CLOSED', 'A closed school year’s records are read only.');
  if (code === 'P1901') return new AppError(409, 'NO_KINDERGARTEN_CARD', 'There is no Kindergarten card to record for: the school has not supplied its Kindergarten assessment policy.');
  if (code === 'P1902') return new AppError(409, 'NOT_IN_SECTION', 'Record only for learners in this section.');
  if (code === 'P1903') return new AppError(422, 'GRADE_RANGE', 'A grade is a number from 0 to 100 with at most two decimal places, as the ECR shows it.');
  if (code === 'P1904') return new AppError(409, 'NO_CHANGES', 'Nothing has changed.');
  if (code === 'P1905') return new AppError(409, 'PERIOD_YEAR', 'Use a reporting period of this school year.');
  if (code === 'P1906') return new AppError(422, 'VALUE_MARK', 'Mark each behaviour statement AO, SO, RO or NO.');
  if (code === 'P1908') {
    // The database names the term it refused; its words are the period's own name, never built from a record.
    const said = String((error as { message?: unknown } | null)?.message ?? '');
    const which = /^[^\n"]{1,60}$/.test(said) ? `${said} has` : 'That term has';
    return new AppError(409, 'PERIOD_NOT_STARTED', `${which} not started yet. Grades are encoded for a term once it begins, on the date the school configured for it.`);
  }
  if (code === 'P1907') {
    // The database says which card holds what was refused; its words are literal, never built from a record.
    const said = String((error as { message?: unknown } | null)?.message ?? '');
    const which = /^[A-Z][^\n"]{3,200}$/.test(said) ? `: ${said.charAt(0).toLowerCase()}${said.slice(1)}` : '';
    return new AppError(409, 'CARD_HAS_NO_BOX', `This learner’s report card has no box for that${which}. It would be recorded but never printed on the SF9 or SF10.`);
  }
  if (code === 'P2700') return new AppError(404, 'NOTIFICATION_NOT_FOUND', 'The notification was not found.');
  if (code === 'P1800') return new AppError(403, 'PRINCIPAL_ONLY', 'Only the principal records the school’s attendance rule.');
  if (code === 'P1801') return new AppError(409, 'RULE_UNCHANGED', 'The rule is already recorded that way.');
  if (code === 'P1802') return new AppError(409, 'REISSUE_REASON', 'This form was issued before with different content. Give the reason it is being corrected.');
  if (code === 'P1704') return new AppError(409, 'SUBMISSION_IMPORT', 'Accept a class list only with an import you committed for its section.');
  if (code === 'P1600') return new AppError(409, 'TASK_STATE', 'This assessment is archived or its school year is closed.');
  if (code === 'P1601') return new AppError(409, 'TASK_COMPONENT', 'Use a component code of the assessment policy bound to this learning area. With no policy bound now, the principal binds one first.');
  if (code === 'P1602') return new AppError(409, 'TASK_PERIOD', 'Use a reporting period of the offering school year.');
  if (code === 'P1603') return new AppError(409, 'ASSESSMENT_UNCHANGED', 'The proposal has no changes.');
  if (code === 'P1604') return new AppError(409, 'TASK_MAXIMUM', 'Recorded scores exceed the proposed maximum. Correct those scores first.');
  if (code === 'P1605') return new AppError(409, 'SCORE_RANGE', 'Each raw score must be between zero and the assessment maximum.');
  if (code === 'P1606') return new AppError(409, 'SCORE_ENROLLMENT', 'Record scores only for valid enrollments in this section.');
  if (code === 'P1100') return new AppError(409, 'OFFERING_YEAR_CLOSED', 'Closed-year subject offerings are read only.');
  if (code === 'P1101') return new AppError(409, 'OFFERING_SUBJECT', 'Use an active subject applicable to the section grade.');
  if (code === 'P1102') return new AppError(409, 'OFFERING_REFRESH_LOCKED', 'Subject details can only be refreshed while the school year is draft.');
  if (code === 'P1103') return new AppError(409, 'OFFERING_UNCHANGED', 'The subject offering proposal has no changes.');
  if (code === 'P1000') return new AppError(409, 'SUBJECT_UNCHANGED', 'The subject proposal has no changes.');
  if (code === 'P0900') return new AppError(409, 'FOLLOWUP_ASSIGNEE', 'Assign an active principal or administrative officer.');
  if (code === 'P0901') return new AppError(409, 'FOLLOWUP_DUE_DATE', 'Use a current or future new due date, and clear it when closing the case.');
  if (code === 'P0902') return new AppError(409, 'FOLLOWUP_BLOCKED', 'Resolve the issues shown in the follow-up review.');
  if (code === 'P0903') return new AppError(409, 'FOLLOWUP_REVIEW_CHANGED', 'The follow-up, evidence or proposal changed. Refresh and review again.');
  if (code === 'P0904') return new AppError(409, 'FOLLOWUP_TRANSITION', 'This action is not available in the current follow-up state.');
  if (code === 'P0800') return new AppError(409, 'MONITOR_RANGE', 'Choose 1 to 31 nonfuture dates within the section school year.');
  if (code === 'P0700') return new AppError(409, 'MONTH_RANGE', 'Use the first day of a month that overlaps the school year.');
  if (code === 'P0701') return new AppError(409, 'MONTH_YEAR', 'Monthly transitions require an active school year.');
  if (code === 'P0702') return new AppError(409, 'MONTH_TRANSITION', 'This action is not available in the current month status.');
  if (code === 'P0703') return new AppError(409, 'MONTH_INCOMPLETE', 'Resolve the monthly calendar, attendance or date issues before submitting.');
  if (code === 'P0704') return new AppError(409, 'MONTH_REVIEW_CHANGED', 'The monthly data or review changed. Refresh and review again.');
  if (code === 'P0707') return new AppError(409, 'MONTH_FROZEN', 'A manager must return or reopen the affected attendance month before editing.');
  if (code === 'P0708') return new AppError(409, 'MONTH_DEPENDENCY', 'This change affects a submitted or locked month. Return or reopen the affected months first.');
  if (code === 'P0709') return new AppError(409, 'MONTH_SIZE', 'Monthly review currently supports at most 1000 distinct enrollments per section.');
  if (code === '23505') {
    const known = duplicates[constraintOf(error) ?? ''] ?? duplicates[String((error as { message?: unknown } | null)?.message ?? '')];
    if (!known) return new AppError(409, 'ALREADY_EXISTS', 'A conflicting record already exists.');
    return new AppError(409, 'ALREADY_EXISTS', known.message, known.field ? [{ path: known.field, message: known.message }] : undefined);
  }
  if (code === '23503' || code === '23001') return new AppError(409, 'INVALID_REFERENCE', 'The referenced record does not exist or is still in use.');
  if (code === '23514') {
    // A rule a migration raised says which rule it was, in words written for it
    // and never built from a record's values. A CHECK constraint's own message
    // names a table and a constraint instead, so that stays generic.
    const said = (error as { message?: unknown } | null)?.message;
    const raised = !constraintOf(error) && typeof said === 'string' && /^[A-Z][^\n"]{3,200}$/.test(said) && !/violates|relation/i.test(said);
    return new AppError(409, 'RULE_VIOLATION', raised ? `This change breaks a school record rule: ${said.charAt(0).toLowerCase()}${said.slice(1).replace(/\.$/, '')}.` : 'This change violates a school record rule. Check dates, status, and assignments.');
  }
  if (code === '42501') return new AppError(403, 'FORBIDDEN', 'You do not have permission for this operation.');
  if (code === '40001' || code === '40P01' || code === '55P03') return new AppError(409, 'RETRY_REQUIRED', 'Another change is in progress. Refresh the record and try again.');
  // A connection dropped mid-request carries no SQLSTATE, only node-postgres's message; nothing was committed with it.
  const dropped = !code && /^(Connection terminated|Client has encountered a connection error)/.test((error as { message?: string } | null)?.message ?? '');
  if (code === '57014' || code?.startsWith('08') || code === 'CONNECTION_CLOSED' || code === 'CONNECT_TIMEOUT' || dropped) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.');
  }
  // The database is older than the code running against it: a function, column
  // or table this release added has not been migrated onto it yet. It used to
  // answer the bare "The request could not be completed.", which sent the
  // school hunting through the file they were importing — the one place the
  // fault was not. It names itself now, because the fix is one command and
  // nobody can guess it from a blank 500.
  if (code === '42883' || code === '42703' || code === '42P01') {
    return new AppError(503, 'SCHEMA_BEHIND',
      'This database is missing a change this version of EDUNEXUS needs. Apply the pending migrations (npm run db:migrate), then try again. Nothing was written.');
  }
  // An unmapped database error used to answer "The request could not be
  // completed." and nothing else, which is unactionable for the school and
  // undiagnosable for whoever they report it to: the academic history refused
  // this way for three sessions running and the cause could not be read off
  // it. The SQLSTATE is appended when it is one — five plain alphanumerics,
  // never anything the database put a value into — so the next report carries
  // the one fact that identifies the fault.
  const sqlstate = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
  return new AppError(500, 'INTERNAL_ERROR',
    sqlstate ? `The request could not be completed. Quote this code if you report it: ${sqlstate}.` : 'The request could not be completed.');
}
