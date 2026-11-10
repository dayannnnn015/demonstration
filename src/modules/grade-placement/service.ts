import { blockedPreview, wouldRefuse } from '../../core/dry-run.js';
import type { z } from 'zod';
import type { Context } from '../foundation/service.js';
import { AppError } from '../../core/errors.js';
import { correctionColumns } from '../enrollment-timeline/service.js';
import { placementSchemas as s, type PlacementOperationId } from './contracts.js';

export async function executePlacement(id: PlacementOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  async function record() { await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, [input.id]]); }
  if (id === 'placementHistory') {
    if (!(await tx.query('select id from edunexus.enrollments where id=$1', [input.id]))[0]) throw new AppError(404, 'NOT_FOUND', 'The enrollment was not found.');
    const q = input.query as z.infer<typeof s.history>;
    const rows = await tx.query(`select ${correctionColumns} from edunexus.enrollment_corrections where enrollment_id=$1 and correction_kind='placement'
      and ($2::integer is null or enrollment_version<$2) order by enrollment_version desc limit $3`, [input.id, q.before_version ?? null, q.limit + 1]);
    await record();
    return { items: rows.slice(0, q.limit), pagination: { limit: q.limit, next_before_version: rows.length > q.limit ? rows[q.limit - 1]!.enrollment_version : null } };
  }
  const b = input.body as z.infer<typeof s.correct>;
  const params = [input.id, b.version, b.grade_level, JSON.stringify(b.entries), b.reason];
  if (id === 'placementPreview') {
    const [row] = await tx.query('select edunexus.preview_enrollment_placement($1,$2,$3,$4::jsonb,$5) as preview', params);
    const preview = row!.preview as Record<string, unknown>;
    const refusal = await wouldRefuse(tx, () => tx.query(`select ${correctionColumns} from edunexus.correct_enrollment_placement($1,$2,$3,$4::jsonb,$5,$6)`, [...params, preview.review_hash]));
    await record(); return blockedPreview(preview, refusal);
  }
  const [row] = await tx.query(`select ${correctionColumns} from edunexus.correct_enrollment_placement($1,$2,$3,$4::jsonb,$5,$6)`, [...params, b.review_hash]);
  await record(); return row;
}
