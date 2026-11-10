import { z } from 'zod';
import {uuid,gradeLevel} from '../foundation/contracts.js';
import { registrySchemas, registryResponses } from '../registry/contracts.js';

const reason = z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/, 'Use a single line of text.');
const version = z.number().int().min(1).max(2147483646);
const row = z.number().int().min(1).max(50);
const resolution = z.discriminatedUnion('action', [
  z.strictObject({ row, action: z.literal('use_existing'), learner_id: uuid, version }),
  z.strictObject({ row, action: z.literal('create_distinct'), reason }),
]);
/**
 * Where an imported class list lands.
 *
 * A section is the older, shorter way of saying all three, since a section has
 * only one year and one grade. Giving the year and the grade **without** a
 * section registers the learners and enrols them with no class yet, which is how
 * a school puts every learner on the registry before classes are settled;
 * assigning a class afterwards is a movement on that enrolment, not a second
 * enrolment. The same shape, and the same words, as `enrollmentCreate` for one
 * learner — this is that endpoint in bulk, not a second way of enrolling.
 */
const target = {
  section_id: uuid.nullable().default(null),
  academic_year_id: uuid.optional(),
  grade_level: gradeLevel.optional(),
};
// A section says all three. Without one, the school year is still required —
// but the grade is not, since 2026-11-07: the template carries a grade per
// row, so a file may name its own grades and a row that names none is refused
// on its own line.
const placed = (v: { section_id: string | null; academic_year_id?: string | undefined }) =>
  v.section_id !== null || v.academic_year_id !== undefined;
const placedMessage = 'Give a section_id, or an academic_year_id; a grade_level for the whole file is optional when the rows carry their own.';
const importBody = {
  ...target, enrolled_on: z.iso.date(), entry_kind: z.enum(['regular', 'transfer_in']).default('regular'),
  csv: z.string().min(1).max(24000), resolutions: z.array(resolution).max(50).default([]),
};
export const reviewSchemas = {
  preview: z.strictObject(importBody).refine(placed, placedMessage),
  commit: z.strictObject({ ...importBody, confirmed: z.literal(true) }).refine(placed, placedMessage),
  correction: z.strictObject({ version, previous_lrn: registrySchemas.learnerLrn.shape.lrn, corrected_lrn: registrySchemas.learnerLrn.shape.lrn, reason, reviewed: z.literal(true) }),
};
export type ImportInput = z.infer<typeof reviewSchemas.preview>;
export const reviewOperations = ([
  { id: 'importTemplate', method: 'get', path: '/api/v1/roster-imports/template', summary: 'Get the EDUNEXUS class-list template\'s own columns, limits and instructions, which both the CSV and the Excel template carry' },
  { id: 'importPreview', method: 'post', path: '/api/v1/roster-imports/preview', summary: 'Validate a class roster and review explicit duplicate resolutions without creating learners', body: reviewSchemas.preview },
  { id: 'importGet', method: 'get', path: '/api/v1/roster-imports/:id', summary: 'Read your preview status or committed import receipt' },
  { id: 'importCommit', method: 'post', path: '/api/v1/roster-imports/:id/commit', summary: 'Confirm the identical reviewed payload; commit all rows atomically or return the original receipt on retry', body: reviewSchemas.commit },
  { id: 'lrnCorrect', method: 'post', path: '/api/v1/learners/:id/lrn-corrections', summary: 'Record a manager-reviewed LRN correction with previous value, version, and reason', body: reviewSchemas.correction },
  { id: 'lrnCorrectionHistory', method: 'get', path: '/api/v1/learners/:id/lrn-corrections', summary: 'Read protected, immutable LRN correction history', query: registrySchemas.historyQuery },
] as const).map(operation => ({ ...operation, module: 'registry-review' as const, manager: true as const }));
export type ReviewOperationId = typeof reviewOperations[number]['id'];

const profile = z.object({ lrn: z.string().nullable(), first_name: z.string(), middle_name: z.string().nullable(), last_name: z.string(), name_extension: z.string().nullable(), birth_date: z.iso.date(), sex: z.enum(['male', 'female']) });
export const candidateSchema = profile.extend({ id: uuid, version: z.number().int() });
export const previewRowSchema = z.object({ row, profile: profile.nullable(), action: z.enum(['create', 'use_existing']).nullable(), learner_id: uuid.nullable(),
  grade_level: z.number().int().nullable().describe('The grade this learner is enrolled at: their own row’s grade level column, or the grade given for the whole file'),
  candidates: z.array(candidateSchema), candidates_truncated: z.boolean() });
export const issueSchema = z.object({ row: z.number().int().min(0), field: z.string(), code: z.string(), message: z.string() });
export const receiptSchema = z.object({ preview_id: uuid, section_id: uuid.nullable().describe('Null when the learners were enrolled with no class yet; assigning one afterwards is a movement on the enrolment'), academic_year_id: uuid, grade_level: z.number().int().nullable().describe('The grade asked for the whole file, or null when its rows carried their own'), items: z.array(z.object({ row, learner_id: uuid, enrollment_id: uuid, action: z.enum(['create', 'use_existing']), resolution_reason: z.string().nullable() })) });
export const reviewResponses: Record<string, z.ZodType> = {
  importTemplate: z.object({ format: z.literal('edunexus-roster-v2'), csv: z.string(), max_rows: z.literal(50), max_csv_bytes: z.literal(24000), max_request_bytes: z.literal(32768), preview_minutes: z.literal(30), instructions: z.array(z.string()) }),
  importPreview: z.object({ can_commit: z.boolean(), preview_id: uuid.nullable(), expires_at: z.iso.datetime().nullable(),
    section: z.object({ id: uuid, name: z.string(), grade_level: z.number(), academic_year_id: uuid, version: z.number() }).nullable()
      .describe('Null when the import enrols with no class yet'),
    academic_year_id: uuid, grade_level: z.number().int().describe('The grade the learners are enrolled at, from the section where one was given'),
    rows: z.array(previewRowSchema), issues: z.array(issueSchema) }),
  importGet: z.object({ id: uuid, row_count: z.number(), created_at: z.iso.datetime(), expires_at: z.iso.datetime(), committed_at: z.iso.datetime().nullable(), status: z.enum(['pending', 'expired', 'committed']), receipt: receiptSchema.nullable() }),
  importCommit: receiptSchema,
  lrnCorrect: registryResponses.learnerGet!,
  lrnCorrectionHistory: z.object({ items: z.array(z.object({ id: uuid, learner_id: uuid, learner_version: z.number(), previous_lrn: z.string(), corrected_lrn: z.string(), reason: z.string(), actor_user_id: uuid, request_id: uuid, recorded_at: z.iso.datetime() })), pagination: z.object({ limit: z.number(), offset: z.number(), has_more: z.boolean() }) }),
};
