import type { z } from 'zod';
import type { Context } from '../foundation/service.js';
import { AppError } from '../../core/errors.js';
import { calendarSchemas as s, type CalendarOperationId } from './contracts.js';

const columns = 'id,academic_year_id,section_id,calendar_version,review_snapshot,review_hash,reason,actor_user_id,request_id,recorded_at';
export async function executeCalendar(id: CalendarOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  async function record() { await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, [input.id]]); }
  if (id === 'calendarGet') {
    const q = input.query as z.infer<typeof s.get>;
    const [row] = await tx.query('select edunexus.read_instructional_calendar($1,$2,$3,$4) as calendar', [input.id, q.section_id ?? null, q.from, q.to]);
    await record(); return row!.calendar;
  }
  if (id === 'calendarHistory') {
    if (!(await tx.query('select id from edunexus.academic_years where id=$1', [input.id]))[0]) throw new AppError(404, 'NOT_FOUND', 'The school year was not found.');
    const q = input.query as z.infer<typeof s.history>;
    const rows = await tx.query(`select ${columns} from edunexus.calendar_review_events where academic_year_id=$1
      and ($2::integer is null or calendar_version<$2) order by calendar_version desc limit $3`, [input.id, q.before_version ?? null, q.limit + 1]);
    await record();
    return { items: rows.slice(0, q.limit), pagination: { limit: q.limit, next_before_version: rows.length > q.limit ? rows[q.limit - 1]!.calendar_version : null } };
  }
  const b = input.body as z.infer<typeof s.commit>;
  const params = [input.id, b.section_id, b.version, JSON.stringify(b.changes), b.reason];
  if (id === 'calendarPreview') {
    const [row] = await tx.query('select edunexus.preview_instructional_calendar($1,$2,$3,$4::jsonb,$5) as preview', params);
    await record(); return row!.preview;
  }
  const [row] = await tx.query(`select ${columns} from edunexus.commit_instructional_calendar($1,$2,$3,$4::jsonb,$5,$6)`, [...params, b.review_hash]);
  await record(); return row;
}
