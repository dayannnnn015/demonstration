import { z } from 'zod';
import { uuid } from '../foundation/contracts.js';

const version = z.number().int().min(1).max(2147483646);
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z.strictObject({
  event_type: z.enum(['enrolled', 'reassigned', 'withdrawn', 'reentered']),
  effective_on: z.iso.date(), section_id: uuid,
  reason: z.enum(['regular', 'transfer_in', 'section_change', 'transfer_out', 'withdrawal', 'dropout', 'death', 'return_to_school']),
});
const entries = z.array(entry).min(1).max(1000);
const reason = z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/, 'Use a single line of text.');
const proposal = { version, entries, reason };
export const timelineSchemas = {
  preview: z.strictObject(proposal),
  correct: z.strictObject({ ...proposal, review_hash: reviewHash, reviewed: z.literal(true) }),
  // Snapshot history is larger than ordinary list rows; keep pages small.
  history: z.strictObject({ limit: z.coerce.number().int().min(1).max(10).default(5), before_version: z.coerce.number().int().min(2).max(2147483647).optional() }),
};
export const timelineOperations = ([
  { id: 'timelineGet', method: 'get', path: '/api/v1/enrollments/:id/timeline', summary: 'Read the effective timeline after all corrections and subsequent movements' },
  { id: 'timelinePreview', method: 'post', path: '/api/v1/enrollments/:id/timeline/preview', summary: 'Validate and compare a proposed timeline without changing records; maximum JSON body 256 KiB', body: timelineSchemas.preview, bodyLimit: '256kb' },
  { id: 'timelineCorrect', method: 'post', path: '/api/v1/enrollments/:id/timeline/corrections', summary: 'Confirm the reviewed timeline and retain immutable before/after history; maximum JSON body 256 KiB', body: timelineSchemas.correct, bodyLimit: '256kb' },
  { id: 'timelineCorrectionHistory', method: 'get', path: '/api/v1/enrollments/:id/timeline/corrections', summary: 'Read immutable correction snapshots, newest first', query: timelineSchemas.history },
] as const).map(operation => ({ ...operation, module: 'enrollment-timeline' as const, manager: true as const }));
export type TimelineOperationId = typeof timelineOperations[number]['id'];
const state = z.object({ enrolled_on: z.iso.date(), effective_on: z.iso.date(), status: z.enum(['enrolled', 'withdrawn']), section_id: uuid, last_reason: z.string() });
export const correctionResponse = z.object({
  id: uuid, enrollment_id: uuid, enrollment_version: z.number().int(), before_entries: z.array(entry), after_entries: z.array(entry),
  first_affected_on: z.iso.date(), reason: z.string(), review_hash: reviewHash, actor_user_id: uuid, request_id: uuid, recorded_at: z.iso.datetime(),
  correction_kind: z.enum(['timeline', 'placement']), previous_grade_level: z.number().int().nullable(), corrected_grade_level: z.number().int().nullable(),
});
export const revisionPreviewResponse = z.object({
  enrollment_id: uuid, version: z.number().int(), learner_version: z.number().int(), learner_id:uuid,recorded_learner_id:uuid,actor_user_id: uuid,
  review_hash: reviewHash.nullable().describe('Null when the commit would be refused; see blocked'),
  can_commit: z.boolean().optional(), blocked: z.object({ code: z.string(), message: z.string() }).optional().describe('What Confirm would refuse, found by running the commit and rolling it back'),
  correction_kind: z.enum(['timeline', 'placement']), previous_grade_level: z.number().int(), corrected_grade_level: z.number().int(),
  school_year: z.object({ id: uuid, start_year: z.number().int(), starts_on: z.iso.date(), ends_on: z.iso.date(), status: z.enum(['draft', 'active']), version: z.number().int() }),
  sections: z.array(z.object({ id: uuid, name: z.string(), academic_year_id: uuid, grade_level: z.number().int(), adviser_user_id: uuid.nullable(), version: z.number().int() })),
  before_entries: z.array(entry), after_entries: z.array(entry), reason: z.string(), first_affected_on: z.iso.date(), previous_state: state, proposed_state: state,
});
export const timelineResponses: Record<string, z.ZodType> = {
  timelineGet: z.object({ enrollment_id: uuid, academic_year_id: uuid, grade_level: z.number().int(), version: z.number().int(), entries: z.array(entry), latest_correction_id: uuid.nullable(), record_state: z.enum(['valid', 'voided']), usable_for_reporting: z.boolean() }),
  timelinePreview: revisionPreviewResponse,
  timelineCorrect: correctionResponse,
  timelineCorrectionHistory: z.object({ items: z.array(correctionResponse), pagination: z.object({ limit: z.number().int(), next_before_version: z.number().int().nullable() }) }),
};
