import type { Query } from './db.js';
import { normalizeError } from './errors.js';

/**
 * Whether a commit would be refused, found by running it inside a savepoint that
 * is always rolled back. A review must never say yes to what Confirm then
 * refuses (testing finding F34): some refusals come from triggers on the rows a
 * commit writes, such as marks a timeline correction would orphan, which a
 * preview that writes nothing cannot see. The commit runs exactly as Confirm
 * would run it, so the two cannot disagree, and nothing it wrote survives.
 */
export async function wouldRefuse(tx: Query, commit: () => Promise<unknown>) {
  await tx.query('savepoint edunexus_review');
  // The attendance guards are deferred constraint triggers, which would otherwise wait for a transaction
  // end that never comes; checking constraints now makes them speak inside the savepoint.
  try { await commit(); await tx.query('set constraints all immediate'); return null; }
  catch (error) { return normalizeError(error); }
  finally { await tx.query('rollback to savepoint edunexus_review'); }
}

/** A preview whose commit would be refused: no hash to confirm with, and the refusal said in the commit's own words. */
export function blockedPreview<T extends Record<string, unknown>>(preview: T, refusal: { code: string; message: string } | null) {
  return refusal ? { ...preview, can_commit: false, review_hash: null, blocked: { code: refusal.code, message: refusal.message } } : preview;
}
