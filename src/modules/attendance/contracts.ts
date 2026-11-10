import { z } from 'zod';
import { uuid } from '../foundation/contracts.js';

const mark = z.enum(['present', 'absent']).nullable();
const date = z.iso.date();
const version = z.number().int().min(0).max(2147483646);
const change = z.strictObject({ enrollment_id: uuid, am: mark, pm: mark });
const proposal = { day_on: date, version, changes: z.array(change).min(1).max(100), reason: z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/) };
export const attendanceSchemas = {
  get: z.strictObject({ day_on: date, limit: z.coerce.number().int().min(1).max(100).default(50), after_id: uuid.optional() }),
  preview: z.strictObject(proposal),
  commit: z.strictObject({ ...proposal, review_hash: z.string().regex(/^[a-f0-9]{64}$/), reviewed: z.literal(true) }),
  history: z.strictObject({ day_on: date, limit: z.coerce.number().int().min(1).max(10).default(5), before_version: z.coerce.number().int().min(1).max(2147483647).optional() }),
};
export const attendanceOperations = ([
  { id: 'attendanceGet', method: 'get', path: '/api/v1/sections/:id/attendance', summary: 'Read a dated attendance sheet within current learner access; null marks remain unknown', query: attendanceSchemas.get },
  { id: 'attendancePreview', method: 'post', path: '/api/v1/sections/:id/attendance/preview', summary: 'Review up to 100 classroom AM/PM mark changes for an active year', body: attendanceSchemas.preview },
  { id: 'attendanceCommit', method: 'post', path: '/api/v1/sections/:id/attendance/corrections', summary: 'Confirm unchanged attendance review atomically, retaining before/after history', body: attendanceSchemas.commit },
  { id: 'attendanceHistory', method: 'get', path: '/api/v1/sections/:id/attendance/corrections', summary: 'Read manager-only attendance review history for one section and date', query: attendanceSchemas.history, manager: true },
] as const).map(op => ({ ...op, module: 'attendance' as const }));
export type AttendanceOperationId = typeof attendanceOperations[number]['id'];
const state = z.object({ am: mark, pm: mark });
const mode = z.enum(['classroom', 'alternative_delivery', 'no_class', 'suspended']).nullable();
const context = z.object({
  section: z.object({ id: uuid, academic_year_id: uuid, grade_level: z.number().int(), name: z.string(), adviser_user_id: uuid.nullable(), version: z.number().int() }),
  school_year: z.object({ id: uuid, start_year: z.number().int(), starts_on: date, ends_on: date, status: z.enum(['draft', 'active', 'closed']), version: z.number().int() }),
  day_on: date, version: z.number().int(), calendar_version: z.number().int(), visibility: z.enum(['full_historical_roster', 'current_access_only']),
  month_status: z.enum(['draft', 'submitted', 'locked']).optional(), month_version: z.number().int().optional(),
  schedule: z.object({ day_on: date, source: z.enum(['school', 'section', 'unconfigured']), configured: z.boolean(), am: mode, pm: mode, day_type: z.string().nullable(), label: z.string().nullable() }),
});
const snapshot = context.extend({ changes: z.array(z.object({ enrollment_id: uuid, enrollment_version: z.number().int(), learner_id: uuid, learner_version: z.number().int(), recorded_learner_id: uuid, first_name: z.string(), last_name: z.string(), before: state, after: state, changed: z.boolean() })), changed_count: z.number().int(), reason: z.string(), actor_user_id: uuid });
const event = z.object({ id: uuid, attendance_day_id: uuid, attendance_version: z.number().int(), review_snapshot: snapshot, review_hash: z.string(), reason: z.string(), actor_user_id: uuid, request_id: uuid, recorded_at: z.iso.datetime() });
export const attendanceResponses: Record<string, z.ZodType> = {
  attendanceGet: context.extend({ recording_available: z.boolean(), items: z.array(state.extend({ enrollment_id: uuid, enrollment_version: z.number().int(), learner_id: uuid, recorded_learner_id: uuid, first_name: z.string(), middle_name: z.string().nullable(), last_name: z.string(), name_extension: z.string().nullable() })), pagination: z.object({ limit: z.number().int(), next_after_id: uuid.nullable() }) }),
  attendancePreview: snapshot.extend({ review_hash: z.string() }), attendanceCommit: event,
  attendanceHistory: z.object({ items: z.array(event), pagination: z.object({ limit: z.number().int(), next_before_version: z.number().int().nullable() }) }),
};
