import { z } from 'zod';
import { uuid } from '../foundation/contracts.js';

const version = z.number().int().min(1).max(2147483646);
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const fields = {
  version, action: z.enum(['void', 'restore']),
  reason_code: z.enum(['duplicate_record', 'incorrect_entry', 'restoration']),
  reason: z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/, 'Use a single line of text.'),
  replacement_enrollment_id: uuid.nullable().default(null),
};
function validAction(value: z.infer<z.ZodObject<typeof fields>>) {
  return value.action === 'restore'
    ? value.reason_code === 'restoration' && value.replacement_enrollment_id === null
    : value.reason_code === 'duplicate_record'
      ? value.replacement_enrollment_id !== null
      : value.reason_code === 'incorrect_entry' && value.replacement_enrollment_id === null;
}
const actionMessage = 'Duplicate voids require a retained enrollment; incorrect-entry voids and restorations do not.';
export const enrollmentRecordSchemas = {
  preview: z.strictObject(fields).refine(validAction, actionMessage),
  review: z.strictObject({ ...fields, review_hash: reviewHash, reviewed: z.literal(true) }).refine(validAction, actionMessage),
  history: z.strictObject({ limit: z.coerce.number().int().min(1).max(10).default(5), before_version: z.coerce.number().int().min(2).max(2147483647).optional() }),
};
export const enrollmentRecordOperations = ([
  { id: 'enrollmentRecordPreview', method: 'post', path: '/api/v1/enrollments/:id/record-review/preview', summary: 'Review voiding or restoring an annual record, preserving its original timeline', body: enrollmentRecordSchemas.preview },
  { id: 'enrollmentRecordReview', method: 'post', path: '/api/v1/enrollments/:id/record-review', summary: 'Confirm the unchanged record review with immutable evidence and current version', body: enrollmentRecordSchemas.review },
  { id: 'enrollmentRecordHistory', method: 'get', path: '/api/v1/enrollments/:id/record-review', summary: 'Read protected void/restoration snapshots, newest first', query: enrollmentRecordSchemas.history },
] as const).map(operation => ({ ...operation, module: 'enrollment-records' as const, manager: true as const }));
export type EnrollmentRecordOperationId = typeof enrollmentRecordOperations[number]['id'];

const recordState = z.enum(['valid', 'voided']);
const enrollment = z.object({
  id: uuid, learner_id: uuid, academic_year_id: uuid, grade_level: z.number().int(), section_id: uuid,
  enrolled_on: z.iso.date(), effective_on: z.iso.date(), status: z.enum(['enrolled', 'withdrawn']),
  last_reason: z.string(), version: z.number().int(), record_state: recordState,
});
const profile = z.object({
  id: uuid, lrn: z.string().nullable(), first_name: z.string(), middle_name: z.string().nullable(), last_name: z.string(),
  name_extension: z.string().nullable(), birth_date: z.iso.date(), sex: z.enum(['male', 'female']),
  version: z.number().int(), merged_into: uuid.nullable(), identity_revision: z.number().int(),
});
const entry = z.object({ event_type: z.enum(['enrolled', 'reassigned', 'withdrawn', 'reentered']), effective_on: z.iso.date(), section_id: uuid, reason: z.string() });
const snapshot = z.object({
  enrollment, learner: profile, recorded_learner: profile, timeline: z.array(entry),
  school_year: z.object({ id: uuid, start_year: z.number().int(), starts_on: z.iso.date(), ends_on: z.iso.date(), status: z.enum(['draft', 'active', 'closed']), version: z.number().int() }),
  related_enrollments: z.array(z.object({ id: uuid, version: z.number().int(), record_state: recordState, recorded_learner_id: uuid })),
  dependent_enrollment_ids: z.array(uuid),
  replacement: z.object({ enrollment, learner: profile, recorded_learner: profile, timeline: z.array(entry) }).nullable(),
  action: fields.action, reason_code: fields.reason_code, reason: z.string(), replacement_enrollment_id: uuid.nullable(),
  actor_user_id: uuid, issues: z.array(z.string()), can_commit: z.boolean(),
});
const event = z.object({
  id: uuid, enrollment_id: uuid, enrollment_version: z.number().int(), action: fields.action,
  reason_code: fields.reason_code, reason: z.string(), replacement_enrollment_id: uuid.nullable(),
  review_snapshot: snapshot, review_hash: reviewHash, actor_user_id: uuid, request_id: uuid, recorded_at: z.iso.datetime(),
});
export const enrollmentRecordResponses: Record<string, z.ZodType> = {
  enrollmentRecordPreview: snapshot.extend({ review_hash: reviewHash.nullable(), blocked: z.object({ code: z.string(), message: z.string() }).optional().describe('What Confirm would refuse, found by running the commit and rolling it back') }),
  enrollmentRecordReview: event,
  enrollmentRecordHistory: z.object({ items: z.array(event), pagination: z.object({ limit: z.number().int(), next_before_version: z.number().int().nullable() }) }),
};
