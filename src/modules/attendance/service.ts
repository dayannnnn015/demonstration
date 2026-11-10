import type { z } from 'zod';
import type { Row } from '../../core/db.js';
import type { Context } from '../foundation/service.js';
import { AppError } from '../../core/errors.js';
import { attendanceSchemas as s, type AttendanceOperationId } from './contracts.js';

const columns = 'id,attendance_day_id,attendance_version,review_snapshot,review_hash,reason,actor_user_id,request_id,recorded_at';
export async function executeAttendance(id: AttendanceOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  async function record(ids: unknown[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, []]);
    for (let n = 0; n < unique.length; n += 100) await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, unique.slice(n, n + 100)]);
  }
  if (id === 'attendanceGet') {
    const q = input.query as z.infer<typeof s.get>;
    const [row] = await tx.query('select edunexus.read_daily_attendance($1,$2,$3,$4) as sheet', [input.id, q.day_on, q.limit, q.after_id ?? null]);
    const sheet = row!.sheet as Row & { items: Row[] }; await record(sheet.items.map(v => v.enrollment_id)); return sheet;
  }
  if (id === 'attendanceHistory') {
    const q = input.query as z.infer<typeof s.history>;
    // Validate section/date scope without retrieving any learner names.
    const [scope] = await tx.query('select s.id from edunexus.sections s join edunexus.academic_years y on y.id=s.academic_year_id where s.id=$1 and $2::date between y.starts_on and y.ends_on', [input.id, q.day_on]);
    if (!scope) throw new AppError(404, 'NOT_FOUND', 'The section or date was not found.');
    const rows = await tx.query(`select ${columns} from edunexus.attendance_review_events where attendance_day_id=(select id from edunexus.attendance_days where section_id=$1 and day_on=$2)
      and ($3::integer is null or attendance_version<$3) order by attendance_version desc limit $4`, [input.id, q.day_on, q.before_version ?? null, q.limit + 1]);
    const items = rows.slice(0, q.limit);
    await record(items.flatMap(v => ((v.review_snapshot as Row).changes as Row[]).map(c => c.enrollment_id)));
    return { items, pagination: { limit: q.limit, next_before_version: rows.length > q.limit ? rows[q.limit - 1]!.attendance_version : null } };
  }
  const b = input.body as z.infer<typeof s.commit>;
  const params = [input.id, b.day_on, b.version, JSON.stringify(b.changes), b.reason];
  if (id === 'attendancePreview') {
    const [row] = await tx.query('select edunexus.preview_daily_attendance($1,$2,$3,$4::jsonb,$5) as preview', params);
    const preview = row!.preview as Row & { changes: Row[] }; await record(preview.changes.map(v => v.enrollment_id)); return preview;
  }
  const [row] = await tx.query(`select ${columns} from edunexus.commit_daily_attendance($1,$2,$3,$4::jsonb,$5,$6)`, [...params, b.review_hash]);
  await record(b.changes.map(v => v.enrollment_id)); return row;
}
