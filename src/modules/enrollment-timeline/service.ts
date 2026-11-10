import type { z } from 'zod';
import type { Context } from '../foundation/service.js';
import { AppError } from '../../core/errors.js';
import { blockedPreview, wouldRefuse } from '../../core/dry-run.js';
import { timelineSchemas as s, type TimelineOperationId } from './contracts.js';

export const correctionColumns = 'id,enrollment_id,enrollment_version,before_entries,after_entries,first_affected_on,reason,review_hash,actor_user_id,request_id,recorded_at,correction_kind,previous_grade_level,corrected_grade_level';
export async function executeTimeline(id: TimelineOperationId, ctx: Context, input: { body: unknown; query: unknown; id?: string }) {
  const { tx } = ctx;
  async function record() { await tx.query('select edunexus.record_access($1,$2::uuid[])', [id, [input.id]]); }
  switch (id) {
    case 'timelineGet': {
      const [row] = await tx.query('select edunexus.get_enrollment_timeline($1) as timeline', [input.id]);
      await record(); return row!.timeline;
    }
    case 'timelinePreview': {
      const b = input.body as z.infer<typeof s.preview>;
      const [row] = await tx.query('select edunexus.preview_enrollment_timeline($1,$2,$3::jsonb,$4) as preview', [input.id, b.version, JSON.stringify(b.entries), b.reason]);
      const preview = row!.preview as Record<string, unknown>;
      const refusal = await wouldRefuse(tx, () => tx.query(`select ${correctionColumns} from edunexus.correct_enrollment_timeline($1,$2,$3::jsonb,$4,$5)`, [input.id, b.version, JSON.stringify(b.entries), b.reason, preview.review_hash]));
      await record(); return blockedPreview(preview, refusal);
    }
    case 'timelineCorrect': {
      const b = input.body as z.infer<typeof s.correct>;
      const [row] = await tx.query(`select ${correctionColumns} from edunexus.correct_enrollment_timeline($1,$2,$3::jsonb,$4,$5)`, [input.id, b.version, JSON.stringify(b.entries), b.reason, b.review_hash]);
      await record(); return row;
    }
    case 'timelineCorrectionHistory': {
      const [enrollment] = await tx.query('select id from edunexus.enrollments where id=$1', [input.id]);
      if (!enrollment) throw new AppError(404, 'NOT_FOUND', 'The record was not found.');
      const q = input.query as z.infer<typeof s.history>;
      const rows = await tx.query(`select ${correctionColumns} from edunexus.enrollment_corrections where enrollment_id=$1 and ($2::integer is null or enrollment_version<$2) order by enrollment_version desc limit $3`, [input.id, q.before_version ?? null, q.limit + 1]);
      await record();
      return { items: rows.slice(0, q.limit), pagination: { limit: q.limit, next_before_version: rows.length > q.limit ? rows[q.limit - 1]!.enrollment_version : null } };
    }
  }
}
