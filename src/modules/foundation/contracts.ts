import { z } from 'zod';
import { firstCapital, plainName, plainNameMessage, singleSpaced } from '../../core/text.js';

export const uuid = z.uuid();

/**
 * A grade level: 0 for Kindergarten, then 1 to 6.
 *
 * `z.coerce.number()` is how these arrive from a query string, and it reads
 * **null as 0** — so a caller sending `grade_level: null` to mean "none" was
 * silently asking for Kindergarten. An adviser's class list did exactly that
 * and was refused for a grade they do not advise, with a message about
 * advising that made no sense to them.
 *
 * Null is now refused rather than read as a grade. Omit the field to mean
 * none; a grade has to be said.
 */
export const gradeLevel = z.preprocess(v => (v === null ? Number.NaN : v), z.coerce.number().int().min(0).max(6));
const name = (max: number) => z.string().trim().overwrite(singleSpaced).overwrite(firstCapital).min(1).max(max).regex(plainName, plainNameMessage);
const date = z.iso.date();
const version = z.number().int().positive().max(2147483646);
export const staffRole = z.enum(['principal', 'administrative_officer', 'teacher']);
const pagination = { limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) };

export const schemas = {
  // The heading and signature fields every form prints; each is optional so an older client's update leaves them as they are.
  schoolUpdate: z.strictObject({ version, name: name(150), school_code: z.string().regex(/^[0-9]{6}$/).nullable(), address: name(300),
    region: name(150).nullable().optional(), division: name(150).nullable().optional(), district: name(150).nullable().optional(),
    school_head_name: name(150).nullable().optional(), school_head_position: name(150).nullable().optional() }),
  staffCreate: z.strictObject({ user_id: uuid, display_name: name(150), role: staffRole }),
  staffUpdate: z.strictObject({ version, display_name: name(150).optional(), role: staffRole.optional(), active: z.boolean().optional(),
    position: name(120).nullable().optional(), specialization: name(120).nullable().optional() }).refine(v => Object.keys(v).length > 1, 'Provide a change'),
  staffQuery: z.strictObject({ ...pagination, role: staffRole.optional() }),
  yearCreate: z.strictObject({ start_year: z.number().int().min(2000).max(2199), starts_on: date, ends_on: date }).refine(v => v.ends_on > v.starts_on, 'Year end must follow its start'),
  yearTransition: z.strictObject({ version, status: z.enum(['active', 'closed']) }),
  periodCreate: z.strictObject({ ordinal: z.number().int().min(1).max(12), name: name(60), starts_on: date, ends_on: date }).refine(v => v.ends_on >= v.starts_on, 'Period end must follow its start'),
  periodUpdate: z.strictObject({ version, ordinal: z.number().int().min(1).max(12), name: name(60), starts_on: date, ends_on: date }).refine(v => v.ends_on >= v.starts_on, 'Period end must follow its start'),
  sectionCreate: z.strictObject({ academic_year_id: uuid, grade_level: z.number().int().min(0).max(6), name: name(80), adviser_user_id: uuid.nullable().default(null) }),
  sectionUpdate: z.strictObject({ version, name: name(80).optional(), adviser_user_id: uuid.nullable().optional() }).refine(v => Object.keys(v).length > 1, 'Provide a change'),
  sectionQuery: z.strictObject({ ...pagination, academic_year_id: uuid.optional() }),
  auditQuery: z.strictObject({ limit: pagination.limit, before_id: z.string().regex(/^[1-9][0-9]{0,17}$/).optional(),
    entity_table: z.enum(['school_profile', 'staff', 'academic_years', 'reporting_periods', 'sections']).optional() }),
};

export const operations = [
  { id: 'me', method: 'get', path: '/api/v1/me', summary: 'Get the active staff profile and session assurance' },
  { id: 'schoolGet', method: 'get', path: '/api/v1/school', summary: 'Read the school profile' },
  { id: 'schoolUpdate', method: 'patch', path: '/api/v1/school', summary: 'Update the school profile', body: schemas.schoolUpdate, manager: true },
  { id: 'staffList', method: 'get', path: '/api/v1/staff', summary: 'List staff accounts', query: schemas.staffQuery, manager: true },
  { id: 'staffCreate', method: 'post', path: '/api/v1/staff', summary: 'Authorize an existing Supabase Auth identity', body: schemas.staffCreate, manager: true },
  { id: 'staffUpdate', method: 'patch', path: '/api/v1/staff/:id', summary: 'Update staff identity details or access', body: schemas.staffUpdate, manager: true },
  { id: 'yearList', method: 'get', path: '/api/v1/academic-years', summary: 'List school years' },
  { id: 'yearCreate', method: 'post', path: '/api/v1/academic-years', summary: 'Create a draft school year', body: schemas.yearCreate, manager: true },
  { id: 'yearTransition', method: 'patch', path: '/api/v1/academic-years/:id/status', summary: 'Activate or close a school year', body: schemas.yearTransition, manager: true },
  { id: 'periodList', method: 'get', path: '/api/v1/academic-years/:id/periods', summary: 'List reporting periods' },
  { id: 'periodCreate', method: 'post', path: '/api/v1/academic-years/:id/periods', summary: 'Create a reporting period in a draft year', body: schemas.periodCreate, manager: true },
  { id: 'periodUpdate', method: 'patch', path: '/api/v1/reporting-periods/:id', summary: 'Correct a reporting period in a draft year', body: schemas.periodUpdate, manager: true },
  { id: 'sectionList', method: 'get', path: '/api/v1/sections', summary: 'List sections visible to the current staff member', query: schemas.sectionQuery },
  { id: 'sectionGet', method: 'get', path: '/api/v1/sections/:id', summary: 'Get a visible section' },
  { id: 'sectionCreate', method: 'post', path: '/api/v1/sections', summary: 'Create a section and optionally assign an adviser', body: schemas.sectionCreate, manager: true },
  { id: 'sectionUpdate', method: 'patch', path: '/api/v1/sections/:id', summary: 'Rename a section or reassign its adviser', body: schemas.sectionUpdate, manager: true },
  { id: 'auditList', method: 'get', path: '/api/v1/audit-events', summary: 'Read the append-only change audit, newest first, optionally for one kind of record', query: schemas.auditQuery, manager: true },
] as const;

export type OperationId = typeof operations[number]['id'];
export type StaffRole = z.infer<typeof staffRole>;
