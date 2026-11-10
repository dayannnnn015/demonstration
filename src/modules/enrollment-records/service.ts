import { blockedPreview, wouldRefuse } from '../../core/dry-run.js';
import type { z } from 'zod';
import type { Context } from '../foundation/service.js';
import type { Row } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { enrollmentRecordSchemas as s, type EnrollmentRecordOperationId } from './contracts.js';

const columns = 'id,enrollment_id,enrollment_version,action,reason_code,reason,replacement_enrollment_id,review_snapshot,review_hash,actor_user_id,request_id,recorded_at';
type Snapshot = { enrollment: { id: string }; replacement: { enrollment: { id: string } } | null; related_enrollments: { id: string }[]; dependent_enrollment_ids: string[] };
function disclosed(snapshot: Snapshot) {
  return [snapshot.enrollment.id, ...(snapshot.replacement ? [snapshot.replacement.enrollment.id] : []),
    ...snapshot.related_enrollments.map(row => row.id), ...snapshot.dependent_enrollment_ids];
}
export async function executeEnrollmentRecord(id: EnrollmentRecordOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  async function record(ids: string[]) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 100) await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, unique.slice(i, i + 100)]);
  }
  if (id === 'enrollmentRecordHistory') {
    if (!(await tx.query('select id from edunexus.enrollments where id=$1', [input.id]))[0]) throw new AppError(404, 'NOT_FOUND', 'The enrollment was not found.');
    const q = input.query as z.infer<typeof s.history>;
    const rows = await tx.query(`select ${columns} from edunexus.enrollment_record_events
      where enrollment_id=$1 and ($2::integer is null or enrollment_version<$2) order by enrollment_version desc limit $3`, [input.id, q.before_version ?? null, q.limit + 1]);
    const items = rows.slice(0, q.limit);
    await record([input.id!, ...items.flatMap(row => disclosed(row.review_snapshot as Snapshot))]);
    return { items, pagination: { limit: q.limit, next_before_version: rows.length > q.limit ? items.at(-1)!.enrollment_version : null } };
  }
  const b = input.body as z.infer<typeof s.review>;
  const params = [input.id, b.version, b.action, b.reason_code, b.reason, b.replacement_enrollment_id];
  let result: Row;
  if (id === 'enrollmentRecordPreview') {
    const [row] = await tx.query('select edunexus.preview_enrollment_record($1,$2,$3,$4,$5,$6) as preview', params);
    result = row!.preview as Row;
    if (result.can_commit && result.review_hash) result = blockedPreview(result, await wouldRefuse(tx, () => tx.query(`select ${columns} from edunexus.review_enrollment_record($1,$2,$3,$4,$5,$6,$7)`, [...params, result.review_hash]))) as Row;
    await record(disclosed(result as Snapshot));
  } else {
    const rows = await tx.query(`select ${columns} from edunexus.review_enrollment_record($1,$2,$3,$4,$5,$6,$7)`, [...params, b.review_hash]);
    result = rows[0]!;
    await record(disclosed(result.review_snapshot as Snapshot));
  }
  return result;
}
