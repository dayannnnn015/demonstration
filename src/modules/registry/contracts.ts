import { z } from 'zod';
import { firstCapital, lrnDigits, plainName, plainNameMessage, singleSpaced } from '../../core/text.js';
import {uuid,gradeLevel} from '../foundation/contracts.js';
const text = (max: number) => z.string().trim().overwrite(singleSpaced).overwrite(firstCapital).min(1).max(max).regex(plainName, plainNameMessage);
const version = z.number().int().min(1).max(2147483646);
const date = z.iso.date();
const lrn = z.string().overwrite(lrnDigits).regex(/^[0-9]{12}$/, 'LRN must contain exactly 12 digits.');
const birthDate = date.refine(value => value >= '1900-01-01' && value <= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), 'Birth date must be a past or current date from 1900 onward.');
const page = { limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) };
// `address` (0053), `guardian_name` and `guardian_contact` (0056) are the whole
// of what the learner-fields gate has been opened for, each on a named decision:
// a learner whose address or guardian the school has not written down is
// unrecorded, never blank, and nothing else about a child or their family is
// held until the school supplies its reviewed field list. A hopeful extra key
// is a 422 rather than a silently dropped field — `tests/registry-address.test.ts`
// asserts that, and still does for `contact_number`, which is the *learner's*
// own number and is not this.
//
// `guardian_contact` takes digits and the punctuation a number is written with,
// so a mobile, a landline with an area code and two numbers on one line all
// pass. It is deliberately not normalised to +63 and has no minimum length:
// the school's own records are the authority on how it writes a number, and a
// stricter rule invented here would refuse a real one. It must contain at
// least one digit, because a contact number is a number.
const guardianContact = z.string().trim().overwrite(singleSpaced).min(1).max(40)
  .regex(/^[0-9+()/,\s-]+$/, 'Use digits and the punctuation a number is written with: + - ( ) / , and spaces.')
  .regex(/[0-9]/, 'A contact number needs at least one digit. Leave it empty if the school has not recorded one.');
const profile = { first_name: text(100), middle_name: text(100).nullable(), last_name: text(100), name_extension: text(20).nullable(), birth_date: birthDate, sex: z.enum(['male', 'female']), address: text(300).nullable(), guardian_name: text(150).nullable(), guardian_contact: guardianContact.nullable() };
export const registrySchemas = {
  // Every new learner carries an LRN (the user's decision of 14 October). A record from before, without one, is still read and completed through learnerLrn.
  learnerCreate: z.strictObject({ ...profile, middle_name: profile.middle_name.default(null), name_extension: profile.name_extension.default(null), address: profile.address.default(null), guardian_name: profile.guardian_name.default(null), guardian_contact: profile.guardian_contact.default(null), lrn: z.string({ error: 'The LRN is required: all twelve digits.' }).overwrite(lrnDigits).regex(/^[0-9]{12}$/, 'LRN must contain exactly 12 digits.') }),
  learnerUpdate: z.strictObject({ ...profile, version }),
  learnerLrn: z.strictObject({ version, lrn }),
  // grade_level narrows to learners holding a valid enrolment at that grade in
  // the *active* school year, which is the year each row's placement reports.
  // Matching any year made the filter and the row disagree for a promoted learner.
  // It is a property of an enrolment, not of a learner, so it is matched with a
  // subquery rather than a column; row security on enrollments still applies,
  // which is what keeps a teacher filtering by grade to their own learners.
  learnerQuery: z.strictObject({ ...page, search: text(100).min(2).optional(), birth_date: date.optional(), lrn: lrn.optional(), sex: z.enum(['male', 'female']).optional(), grade_level: gradeLevel.optional(), section_id: uuid.optional(), include_linked: z.enum(['true','false']).default('false') }),
  // A section, or a year and a grade. Giving a section is the older, shorter
  // way of saying all three, since a section has only one year and one grade;
  // giving the year and grade without one enrols a learner who has no class
  // yet. Assigning that class later is a movement, not another enrolment.
  enrollmentCreate: z.strictObject({
    learner_id: uuid, section_id: uuid.nullable().default(null),
    academic_year_id: uuid.optional(), grade_level: gradeLevel.optional(),
    enrolled_on: date, entry_kind: z.enum(['regular', 'transfer_in']).default('regular'),
  }).refine(v => v.section_id !== null || (v.academic_year_id !== undefined && v.grade_level !== undefined),
    'Give a section_id, or an academic_year_id and grade_level to enrol without one.'),
  enrollmentQuery: z.strictObject({ ...page, academic_year_id: uuid.optional(), section_id: uuid.optional(), learner_id: uuid.optional(), status: z.enum(['enrolled', 'withdrawn']).optional(), record_state: z.enum(['valid', 'voided', 'all']).default('valid') }),
  movement: z.strictObject({ version, action: z.enum(['reassigned', 'withdrawn', 'reentered']), effective_on: date, section_id: uuid.nullable().default(null), exit_reason: z.enum(['transfer_out', 'withdrawal', 'dropout', 'death']).nullable().default(null) }).refine(v => v.action === 'withdrawn' ? v.section_id === null && v.exit_reason !== null : v.section_id !== null && v.exit_reason === null, 'Withdrawals require exit_reason and no section; reassignment/reentry require section_id and no exit_reason.'),
  // Releasing a learner back to having no class: the mirror of an adviser's
  // pull, and only that. There is no section to give, because the enrolment
  // returns to having none.
  release: z.strictObject({ version, effective_on: date, reason: text(500).min(10) }),
  historyQuery: z.strictObject(page),
  countQuery: z.strictObject({ academic_year_id: uuid }),
  accessQuery: z.strictObject({ limit: page.limit, before_id: z.string().regex(/^[1-9][0-9]{0,17}$/).optional(), actor_user_id: uuid.optional(), record_id: uuid.optional() }),
};
/**
 * What `POST /learners` takes: `learnerCreate` plus the one field a duplicate
 * needs. It is a separate schema rather than another key on `learnerCreate`
 * because the adviser's own registration spreads that shape into its own body
 * (`teacher-roster`), and a field meant for the office must never arrive
 * inside an adviser's profile — `register_learner_into_section` checks its
 * keys against a closed list and refuses the whole call for an unknown one.
 *
 * `distinct_reason` is only read when a learner of the same first name, last
 * name and birth date is already on the registry. Then it is required, so a
 * genuinely different child with the same name is registered by saying why in
 * writing rather than by clicking past a warning.
 */
export const learnerRegister = registrySchemas.learnerCreate.extend({ distinct_reason: text(500).min(10).nullable().default(null) });

export const registryOperations = ([
  { id: 'learnerList', method: 'get', path: '/api/v1/learners', summary: 'Search learners visible to the current staff member', query: registrySchemas.learnerQuery },
  { id: 'learnerCreate', method: 'post', path: '/api/v1/learners', summary: 'Create a learner with their twelve-digit LRN; refused when one of the same name and birth date is already on the registry unless distinct_reason says why this is a different child', body: learnerRegister, manager: true },
  { id: 'learnerGet', method: 'get', path: '/api/v1/learners/:id', summary: 'Read a visible learner profile' },
  { id: 'learnerUpdate', method: 'patch', path: '/api/v1/learners/:id', summary: 'Correct learner profile fields without changing an assigned LRN', body: registrySchemas.learnerUpdate, manager: true },
  { id: 'learnerLrn', method: 'patch', path: '/api/v1/learners/:id/lrn', summary: 'Assign the official LRN to a learner whose LRN is pending', body: registrySchemas.learnerLrn, manager: true },
  { id: 'enrollmentList', method: 'get', path: '/api/v1/enrollments', summary: 'List visible annual enrollments', query: registrySchemas.enrollmentQuery },
  { id: 'enrollmentCreate', method: 'post', path: '/api/v1/enrollments', summary: 'Enroll a learner once in a school year and assign a section', body: registrySchemas.enrollmentCreate, manager: true },
  { id: 'enrollmentGet', method: 'get', path: '/api/v1/enrollments/:id', summary: 'Read a visible annual enrollment' },
  { id: 'enrollmentMove', method: 'post', path: '/api/v1/enrollments/:id/movements', summary: 'Append a dated section change, withdrawal, or reentry; supply the current enrollment version', body: registrySchemas.movement, manager: true },
  { id: 'enrollmentRelease', method: 'post', path: '/api/v1/enrollments/:id/release', summary: 'Take a learner back out of a class you advise, returning the enrollment to having no class; never moves them to another class or withdraws them', body: registrySchemas.release },
  { id: 'enrollmentHistory', method: 'get', path: '/api/v1/enrollments/:id/history', summary: 'Read original movement records, which may be superseded by corrections; use /timeline for effective history', query: registrySchemas.historyQuery, manager: true },
  { id: 'enrollmentCounts', method: 'get', path: '/api/v1/enrollment-counts', summary: 'Count valid annual enrollments by grade and status within what the caller may read; names no learner or enrollment and writes no access record', query: registrySchemas.countQuery },
  { id: 'recordAccessList', method: 'get', path: '/api/v1/record-access-events', summary: 'Review access to learner and enrollment records without raw search terms or profile values, optionally narrowed to one staff member or one record ID', query: registrySchemas.accessQuery, manager: true },
] as const).map(operation => ({ ...operation, module: 'registry' as const }));
export type RegistryOperationId = typeof registryOperations[number]['id'];

const timestamps = { version: z.number().int(), created_at: z.iso.datetime(), updated_at: z.iso.datetime() };
// Response schemas describe persisted values, without date-relative input refinements.
const learner = z.object({ id: uuid, lrn: lrn.nullable(), first_name: z.string(), middle_name: z.string().nullable(), last_name: z.string(), name_extension: z.string().nullable(), birth_date: date, sex: z.enum(['male', 'female']), address: z.string().nullable().describe('One line, as the school\'s own learner information carries it. Null where the school has not recorded one, which is unrecorded rather than blank'),
  guardian_name: z.string().nullable().describe('The parent or guardian the school contacts, one line, as its own records write it — including any relationship it writes there. Null where none is recorded, which is unrecorded rather than none existing'),
  guardian_contact: z.string().nullable().describe('That guardian\'s contact number as the school recorded it, not normalised to any format. Null where none is recorded'),
  merged_into: uuid.nullable(), identity_revision:z.number().int(), ...timestamps });
// section_id is nullable from 0048: a learner is enrolled in a year at a grade,
// and which class they join is decided separately and later. The year and the
// grade are what make the enrolment valid.
const enrollment = z.object({ id: uuid, learner_id: uuid, recorded_learner_id:uuid, record_state: z.enum(['valid', 'voided']), academic_year_id: uuid, grade_level: z.number().int(), section_id: uuid.nullable(), enrolled_on: date, effective_on: date, status: z.enum(['enrolled', 'withdrawn']), last_reason: z.string(), ...timestamps });
const event = z.object({ id: uuid, enrollment_id: uuid, enrollment_version: z.number().int(), event_type: z.enum(['enrolled', 'reassigned', 'withdrawn', 'reentered']), effective_on: date, section_id: uuid, reason: z.string(), actor_user_id: uuid, request_id: uuid.nullable(), recorded_at: z.iso.datetime() });
const paginated = (schema: z.ZodType) => z.object({ items: z.array(schema), pagination: z.object({ limit: z.number(), offset: z.number(), has_more: z.boolean() }) });
/**
 * Where a learner sits in the active school year, for the registry's own list.
 *
 * A grade is a property of an enrolment, never of a learner, so the registry
 * had no way to show one and a reader could not tell which grade a row was in.
 * It is null when the learner holds no valid enrolment in the active year, and
 * also when the caller may not read the one they hold: row security on
 * enrollments and sections decides that, not this schema.
 */
const placement = z.object({
  enrollment_id: uuid, academic_year_id: uuid, grade_level: z.number().int(),
  // Null from 0048: enrolled at a grade, not yet in a class. A learner in that
  // state has a grade to show, so the section joins outward, never inward —
  // an inner join here would hide them from the registry entirely.
  section_id: uuid.nullable(), section_name: z.string().nullable(),
  status: z.enum(['enrolled', 'withdrawn']),
}).nullable().describe('The learner’s valid enrolment in the active school year, or null when they hold none the caller may read');
export const registryResponses: Record<string, z.ZodType> = {
  learnerList: paginated(learner.extend({ placement })), learnerGet: learner, learnerCreate: learner, learnerUpdate: learner, learnerLrn: learner,
  enrollmentList: paginated(enrollment.extend({ learner: z.object({ id: uuid, last_name: z.string(), first_name: z.string(), middle_name: z.string().nullable(), name_extension: z.string().nullable(), lrn: z.string().nullable() }).nullable().describe('The learner this enrollment belongs to, or null when the caller may not read them') })), enrollmentGet: enrollment, enrollmentCreate: enrollment, enrollmentMove: enrollment, enrollmentRelease: enrollment,
  enrollmentHistory: paginated(event).extend({ interpretation: z.literal('original_movements'), timeline_version: z.number().int(), has_corrections: z.boolean(), record_state: z.enum(['valid', 'voided']), usable_for_reporting: z.boolean(), current_grade_level: z.number().int(), academic_year_id: uuid }),
  enrollmentCounts: z.object({ academic_year_id: uuid, scope: z.enum(['school', 'current_access']), record_state: z.literal('valid'), enrolled: z.number().int(), withdrawn: z.number().int(),
    grades: z.array(z.object({ grade_level: z.number().int(), enrolled: z.number().int(), withdrawn: z.number().int() })) }),
  recordAccessList: z.object({ items: z.array(z.object({ id: z.string(), occurred_at: z.iso.datetime(), actor_user_id: uuid, request_id: uuid, resource: z.string(), record_ids: z.array(uuid) })), pagination: z.object({ limit: z.number(), next_before_id: z.string().nullable() }) }),
};
