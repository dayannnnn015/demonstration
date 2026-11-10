import { z } from 'zod';
import { uuid } from '../foundation/contracts.js';

const session = z.enum(['classroom', 'alternative_delivery', 'no_class', 'suspended']);
const dayType = z.enum(['regular', 'holiday', 'school_break', 'weekend', 'makeup', 'suspension', 'other']);
const version = z.number().int().min(0).max(2147483646);
const date = z.iso.date();
const text = (min: number, max: number) => z.string().trim().min(min).max(max).regex(/^[^\u0000-\u001f\u007f]*$/, 'Use a single line of text.');
const set = z.strictObject({ day_on: date, action: z.literal('set'), am: session, pm: session, day_type: dayType, label: text(1, 120) });
const change = z.discriminatedUnion('action', [set, z.strictObject({ day_on: date, action: z.literal('clear') })]);
const proposal = { version, section_id: uuid.nullable().default(null), changes: z.array(change).min(1).max(62), reason: text(10, 500) };
export const calendarSchemas = {
  get: z.strictObject({ section_id: uuid.optional(), from: date, to: date }),
  preview: z.strictObject(proposal),
  commit: z.strictObject({ ...proposal, review_hash: z.string().regex(/^[a-f0-9]{64}$/), reviewed: z.literal(true) }),
  history: z.strictObject({ limit: z.coerce.number().int().min(1).max(10).default(5), before_version: z.coerce.number().int().min(1).max(2147483647).optional() }),
};
export const calendarOperations = ([
  { id: 'calendarGet', method: 'get', path: '/api/v1/academic-years/:id/calendar', summary: 'Read up to 62 explicit calendar dates; section overrides apply only to authorized sections', query: calendarSchemas.get },
  { id: 'calendarPreview', method: 'post', path: '/api/v1/academic-years/:id/calendar/preview', summary: 'Review up to 62 school or section schedule changes and detect override conflicts', body: calendarSchemas.preview, manager: true },
  { id: 'calendarCommit', method: 'post', path: '/api/v1/academic-years/:id/calendar/corrections', summary: 'Confirm the unchanged calendar review atomically, preserving historical configurations', body: calendarSchemas.commit, manager: true },
  { id: 'calendarHistory', method: 'get', path: '/api/v1/academic-years/:id/calendar/corrections', summary: 'Read immutable calendar changes across all scopes, newest first', query: calendarSchemas.history, manager: true },
] as const).map(operation => ({ ...operation, module: 'calendar' as const }));
export type CalendarOperationId = typeof calendarOperations[number]['id'];

const state = z.object({ configured: z.boolean(), am: session.nullable(), pm: session.nullable(), day_type: dayType.nullable(), label: z.string().nullable() });
const effective = state.extend({ day_on: date, source: z.enum(['school', 'section', 'unconfigured']) });
const snapshot = z.object({
  academic_year_id: uuid, calendar_version: z.number().int(), section_id: uuid.nullable(),
  school_year: z.object({ id: uuid, start_year: z.number().int(), starts_on: date, ends_on: date, status: z.enum(['draft', 'active']), version: z.number().int() }),
  section: z.object({ id: uuid, academic_year_id: uuid, grade_level: z.number().int(), name: z.string(), adviser_user_id: uuid.nullable(), version: z.number().int() }).nullable(),
  changes: z.array(z.object({ day_on: date, action: z.enum(['set', 'clear']), before: state, after: state, before_effective: effective, after_effective: effective, changed: z.boolean() })),
  changed_count: z.number().int(), issues: z.array(z.string()), conflicts: z.array(z.object({ day_on: date, code: z.string(), section_ids: z.array(uuid) })),
  can_commit: z.boolean(), actor_user_id: uuid, reason: z.string(),
});
const event = z.object({ id: uuid, academic_year_id: uuid, section_id: uuid.nullable(), calendar_version: z.number().int(), review_snapshot: snapshot, review_hash: z.string(), reason: z.string(), actor_user_id: uuid, request_id: uuid, recorded_at: z.iso.datetime() });
export const calendarResponses: Record<string, z.ZodType> = {
  calendarGet: z.object({ academic_year_id: uuid, calendar_version: z.number().int(), section_id: uuid.nullable(), from: date, to: date, days: z.array(effective),
    summary: z.object({ dates_requested: z.number().int(), configured_days: z.number().int(), unconfigured_days: z.number().int(), classroom_sessions: z.number().int(), alternative_delivery_sessions: z.number().int(), no_class_sessions: z.number().int(), suspended_sessions: z.number().int() }) }),
  calendarPreview: snapshot.extend({ review_hash: z.string().nullable() }),
  calendarCommit: event,
  calendarHistory: z.object({ items: z.array(event), pagination: z.object({ limit: z.number().int(), next_before_version: z.number().int().nullable() }) }),
};
