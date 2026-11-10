import type { Row } from '../api';
import { Icon } from './icons';

/**
 * Temporary: the notice a seeded database carries. `/me` reports it only while
 * migration 0025's row exists, and the go-live reset rebuilds the database
 * without it, so this disappears with the seeded records rather than on a
 * code change. It sits inside the content, so it prints with every page too.
 */
export function SeededNotice({ me }: { me: Row }) {
  const notice = me.seeded_data as { note: string } | null | undefined;
  if (!notice) return null;
  return (
    <div className="seeded-banner" role="note">
      <Icon name="alert" size={16} />
      <p><b>Seeded test data.</b> {notice.note}</p>
    </div>
  );
}
