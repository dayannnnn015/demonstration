import type { z } from 'zod';
import type { Row } from '../../core/db.js';
import type { Context } from '../foundation/service.js';
import { monthSchemas as s, type MonthOperationId } from './contracts.js';
const columns = 'id,month_id,month_version,action,snapshot_id,review_snapshot,review_hash,reason,actor_user_id,request_id,recorded_at';
export async function executeMonth(id: MonthOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  const record = async (ids: unknown[] = [input.id]) => tx.query('select edunexus.record_access($1,$2::uuid[])', [id, ids]);
  if (id === 'monthGet' || id === 'monthStatus') {
    const q = input.query as z.infer<typeof s.get>;
    const [row] = await tx.query(`select edunexus.${id === 'monthGet' ? 'read_attendance_month' : 'read_attendance_month_status'}($1,$2) as result`, [input.id, q.month_on]);
    await record(); return row!.result;
  }
  if (id === 'monthSnapshot') {
    const q = input.query as z.infer<typeof s.members>;
    const [row] = await tx.query('select edunexus.read_attendance_month_members($1,$2,$3,$4,$5) as result', [input.id, q.month_on, q.snapshot_id ?? null, q.limit, q.after_id ?? null]);
    const result = row!.result as Row & { items: Row[] }; await record(result.items.map(v => v.enrollment_id)); return result;
  }
  if (id === 'monthHistory') {
    const q = input.query as z.infer<typeof s.history>;
    await tx.query('select edunexus.read_attendance_month_status($1,$2)', [input.id, q.month_on]);
    const rows = await tx.query(`select ${columns} from edunexus.attendance_month_events where month_id=(select id from edunexus.attendance_months where section_id=$1 and month_on=$2)
      and ($3::integer is null or month_version<$3) order by month_version desc limit $4`, [input.id, q.month_on, q.before_version ?? null, q.limit + 1]);
    await record(); return { items: rows.slice(0, q.limit), pagination: { limit: q.limit, next_before_version: rows.length > q.limit ? rows[q.limit-1]!.month_version : null } };
  }
  const b = input.body as z.infer<typeof s.commit>;
  const params = [input.id, b.month_on, b.version, b.action, b.reason];
  if (id === 'monthPreview') {
    const [row] = await tx.query('select edunexus.preview_attendance_month($1,$2,$3,$4,$5) as result', params);
    await record(); return row!.result;
  }
  const [row] = await tx.query(`select ${columns} from edunexus.commit_attendance_month($1,$2,$3,$4,$5,$6)`, [...params, b.review_hash]);
  await record(); return row;
}
