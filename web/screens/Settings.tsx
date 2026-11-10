import { useEffect, useState } from 'react';
import { message } from '../api';
import type { ScreenProps } from '../routes';
import { Callout, PageHeader, TableSkeleton } from '../components/primitives';
import { Accessibility, Preferences } from './ProfilePreferences';
import { Learning, type Mine, type Profile } from './Profile';

/**
 * How the workspace looks and behaves for one person — and nothing about who
 * they are.
 *
 * **Split from My profile on the user's instruction of 2026-11-05.** The two
 * were one screen of eight cards, and the specification they were reviewed
 * against on 2026-11-05 (0.90.9) already named them as two things: *My profile*
 * and *Settings & Accessibility*. The split follows the line that was already
 * there. Who you are, how you sign in and what you have done stay on **My
 * profile**; what you can change about the interface is here.
 *
 * **No preference moved, changed or was added.** These are the same
 * `Preferences`, `Accessibility` and `Learning` cards, reading and writing the
 * same `staff_profiles` columns through the same `save_my_profile` — so a
 * choice made before this split is the choice this screen opens with, and
 * nothing needed a migration. The screen reads `/me/profile` itself rather than
 * being handed it, because a route is entered directly from the rail, from the
 * command palette and from a bookmarked hash.
 *
 * It is `offRail: false` deliberately, unlike My profile: a person looking for
 * the text size should find it in the navigation, not only behind their own
 * name in the top bar.
 */
export function Settings(props: ScreenProps) {
  const { api, token, route, account } = props;
  const [mine, setMine] = useState<Mine | null>(null);
  const [failed, setFailed] = useState('');

  const load = () => api<Mine>('/me/profile').then(row => { setMine(row); setFailed(''); return row; });
  useEffect(() => { setMine(null); void load().catch(error => setFailed(message(error))); }, [api, token]);

  /** A saved preference shows here and in the top bar at once, as it did when these cards sat on My profile. */
  const saved = (profile: Profile) => {
    setMine(m => (m ? { ...m, profile } : m));
    account?.updateMe({ profile });
  };
  const reread = async () => { const row = await load(); account?.updateMe({ profile: row.profile }); };

  if (failed) return <><PageHeader route={route} /><Callout tone="stopped" title="Your settings could not be read">{failed}</Callout></>;
  if (!mine) return <><PageHeader route={route} /><div className="card"><div className="card-body"><TableSkeleton columns={2} rows={3} /></div></div></>;

  return (
    <>
      <PageHeader route={route} />
      <Preferences api={api} role={mine.role} profile={mine.profile} onSaved={saved} onConflict={reread} />
      <Accessibility api={api} profile={mine.profile} onSaved={saved} onConflict={reread} />
      <Learning role={mine.role} />
    </>
  );
}
