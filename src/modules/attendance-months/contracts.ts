import { z } from 'zod';
import { uuid } from '../foundation/contracts.js';
const month = z.iso.date().regex(/^\d{4}-\d{2}-01$/, 'Use the first day of the month.');
const date = z.iso.date();
const status = z.enum(['draft', 'submitted', 'locked']);
const action = z.enum(['submit', 'return', 'lock', 'reopen']);
const version = z.number().int().min(0).max(2147483646);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const proposal = { month_on: month, version, action, reason: z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]*$/) };
export const monthSchemas = {
  get: z.strictObject({ month_on: month }), preview: z.strictObject(proposal),
  commit: z.strictObject({ ...proposal, review_hash: hash, reviewed: z.literal(true) }),
  history: z.strictObject({ month_on: month, limit: z.coerce.number().int().min(1).max(10).default(5), before_version: z.coerce.number().int().min(1).max(2147483647).optional() }),
  members: z.strictObject({ month_on: month, snapshot_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), after_id: uuid.optional() }),
};
export const monthOperations = ([
  { id: 'monthStatus', method: 'get', path: '/api/v1/sections/:id/attendance/months/status', summary: 'Read assigned-section monthly workflow status without learner details', query: monthSchemas.get },
  { id: 'monthGet', method: 'get', path: '/api/v1/sections/:id/attendance/months', summary: 'Review complete historical monthly readiness or a frozen submission summary', query: monthSchemas.get, manager: true },
  { id: 'monthPreview', method: 'post', path: '/api/v1/sections/:id/attendance/months/preview', summary: 'Review submission, return, lock or reopening with current context and version', body: monthSchemas.preview, manager: true },
  { id: 'monthCommit', method: 'post', path: '/api/v1/sections/:id/attendance/months/transitions', summary: 'Confirm unchanged monthly review and preserve submission snapshots atomically', body: monthSchemas.commit, manager: true },
  { id: 'monthHistory', method: 'get', path: '/api/v1/sections/:id/attendance/months/transitions', summary: 'Read immutable monthly transition evidence', query: monthSchemas.history, manager: true },
  { id: 'monthSnapshot', method: 'get', path: '/api/v1/sections/:id/attendance/months/members', summary: 'Page current monthly review members or a specified immutable submission snapshot', query: monthSchemas.members, manager: true },
] as const).map(op => ({ ...op, module: 'attendance-months' as const }));
export type MonthOperationId = typeof monthOperations[number]['id'];
const section = z.object({ id: uuid, academic_year_id: uuid, grade_level: z.number().int(), name: z.string(), adviser_user_id: uuid.nullable(), version: z.number().int() });
const year = z.object({ id: uuid, start_year: z.number().int(), starts_on: date, ends_on: date, status: z.enum(['draft', 'active', 'closed']), version: z.number().int() });
const state = z.object({ section_id: uuid, academic_year_id: uuid, month_on: month, from: date, to: date, status, version: z.number().int() });
const scope = state.extend({ snapshot_id: uuid.nullable(), section, school_year: year });
const count = z.number().int().nonnegative();
const mode = z.enum(['classroom', 'alternative_delivery', 'no_class', 'suspended']).nullable();
const summary = z.object({ member_count: count, dates_requested: count, unconfigured_dates: count, unsupported_sessions: count, expected_sessions: count, missing_sessions: count, present_sessions: count, absent_sessions: count });
const review = z.object({ section, school_year: year, month_on: month, from: date, to: date, summary,
  days: z.array(z.object({ day_on: date, schedule: z.object({ day_on: date, source: z.enum(['school','section','unconfigured']), configured: z.boolean(), am: mode, pm: mode, day_type: z.string().nullable(), label: z.string().nullable() }), eligible_learners: count, expected_sessions: count, missing_sessions: count, present_sessions: count, absent_sessions: count })) });
const current = scope.extend({ review, data_hash: hash, issues: z.array(z.string()), can_submit: z.boolean(), source: z.enum(['live', 'submission_snapshot']) });
const plan = current.extend({ action, target_status: status, reason: z.string(), actor_user_id: uuid, can_commit: z.boolean() });
const event = z.object({ id: uuid, month_id: uuid, month_version: z.number().int(), action, snapshot_id: uuid, review_snapshot: plan, review_hash: hash, reason: z.string(), actor_user_id: uuid, request_id: uuid, recorded_at: z.iso.datetime() });
const mark = z.enum(['present', 'absent']).nullable();
export const monthResponses: Record<string, z.ZodType> = {
  monthStatus: state, monthGet: current, monthPreview: plan.extend({ review_hash: hash.nullable() }), monthCommit: event,
  monthHistory: z.object({ items: z.array(event), pagination: z.object({ limit: count, next_before_version: z.number().int().nullable() }) }),
  monthSnapshot: z.object({ section_id: uuid, month_on: month, snapshot_id: uuid.nullable(), data_hash: hash, member_count: count,
    items: z.array(z.object({ enrollment_id: uuid, enrollment_version: count, recorded_learner_id: uuid, learner_id: uuid, learner_version: count, first_name: z.string(), middle_name: z.string().nullable(), last_name: z.string(), name_extension: z.string().nullable(), dates: z.array(z.object({ day_on: date, am: mark, pm: mark })) })),
    pagination: z.object({ limit: count, next_after_id: uuid.nullable() }) }),
};
