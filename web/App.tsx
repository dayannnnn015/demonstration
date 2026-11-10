import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, createApi, message, rememberMe, sessionStore, type Page, type Row } from './api';
import { Account, PasswordChange } from './Account';
import { AppShell, waitingByRoute } from './components/AppShell';
import { Notifications } from './screens/Notifications';
import { BrandMark } from './components/brand';
import { Sheet } from './components/overlay';
import { PageHeader, Spinner, StatusLine, idle, yearName, type Status } from './components/primitives';
import { available, hiddenByAssignment, routeFor, routes } from './routes';
import { applyPreferences, followDevice, startScreen, type Preferences } from './preferences';

// A screen may carry its own filter after `?`, as the access log does; the route is what precedes it.
/**
 * Inside the front page's Staff portal panel (0.106.0, the UI notes of 8 November, note 7): `/app?embed=signin`, framed
 * by this origin and no other (the workspace's frame-ancestors is 'self'). The panel shows the sign-in card alone, and a
 * sign-in moves the whole tab into the workspace. Framed or not is checked too, so the address opened on its own is
 * simply the workspace.
 */
const embedded = (() => {
  try { return new URLSearchParams(location.search).get('embed') === 'signin' && window.top !== window.self; } catch { return false; }
})();
/** Leave the panel for the workspace: the tab's session store is shared with the frame, so /app opens signed in. */
const enterWorkspace = () => { try { window.top!.location.assign('/app'); } catch { location.assign('/app'); } };

const currentHash = () => location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '') || 'overview';

export function App() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [me, setMe] = useState<Row | null>(null);
  const [fatal, setFatal] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [page, setPage] = useState(currentHash);
  const [visit, setVisit] = useState(0);
  const [status, setStatus] = useState<Status>(idle);
  const [token, setToken] = useState(0);
  // undefined until read: the top bar must not say there is no active year before it has looked.
  const [year, setYear] = useState<Row | null | undefined>(undefined);
  /** The address and last sign-in on the open session, for My profile to show. */
  const [signedInAs, setSignedInAs] = useState<{ email: string | null; lastSignIn: string | null }>();
  const [school, setSchool] = useState<Row | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/account/config', { cache: 'no-store' });
        if (!response.ok) throw new Error('The sign-in service is unavailable. Try again shortly.');
        const config = await response.json() as { url: string; publishableKey: string };
        setClient(createClient(config.url, config.publishableKey, {
          auth: {
            // The tab's own store by default, so a shared staffroom browser leaves no
            // session behind; "Keep me signed in" on the sign-in page is what moves it
            // somewhere that outlives the tab. See `sessionStore` in web/api.ts.
            persistSession: true,
            storage: sessionStore,
            storageKey: 'edunexus-session',
            detectSessionInUrl: true,
            autoRefreshToken: true,
          },
        }));
      } catch (error) { setFatal(message(error)); }
    })();
  }, []);

  // The address bar follows the screen, so a refresh lands where you were.
  useEffect(() => {
    // A link in a sentence changes the address directly; the last screen's message must not follow it to the next.
    let shown = currentHash();
    // A link that names what to open (`#/months?section=…`, from a notification) opens it even on the screen already
    // showing: the screen is mounted afresh, since it reads the address only as it opens (the UI notes of 8 November, note 5).
    const sync = () => { const next = currentHash(); if (next !== shown) setStatus(idle); shown = next; setPage(next); if (location.hash.includes('?')) setVisit(v => v + 1); };
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, []);

  const lost = useCallback(() => { setMe(null); setSignedIn(false); }, []);
  const api = useMemo(() => (client ? createApi(client, lost) : null), [client, lost]);

  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') lost(); });
    return () => data.subscription.unsubscribe();
  }, [client, lost]);

  useEffect(() => {
    if (!signedIn || !api) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (attempt: number) => void api<Row>('/me').then(row => {
      if (stopped) return;
      setFatal('');
      setMe(row);
      // Signing in with nothing in the address opens the screen chosen on My profile.
      const start = startScreen((row.profile as Row | null)?.landing, location.hash, id => routes.some(r => r.id === id && available(r, row.role)));
      if (start) { location.hash = `#/${start}`; setPage(start); }
    }).catch(error => {
      if (stopped) return;
      // A busy minute, a server hiccup or a dropped connection is not a lost
      // session: try again rather than sending the person back to sign in.
      const passing = !(error instanceof ApiError) || error.status === 429 || error.status >= 500;
      if (passing && attempt < 4) { setFatal(`${message(error)} Trying again…`); timer = setTimeout(() => read(attempt + 1), 5000 * (attempt + 1)); return; }
      setFatal(message(error)); lost();
    });
    read(0);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [signedIn, api, lost]);

  // What the person chose on My profile, applied to the whole page; signing out puts the defaults back,
  // so a shared machine does not show the next person someone else's dark theme or large text.
  const profile = me?.profile as Preferences | null | undefined;
  // Inside the front page's Staff portal panel the sign-in is light, like the always-light page around it.
  useEffect(() => { applyPreferences(embedded ? { theme: 'light' } as Preferences : profile ?? null); }, [profile]);
  useEffect(() => followDevice(), []);

  // The shell's own furniture: the year the top bar names, and the school the
  // rail names. Both are read here rather than by every screen that mentions
  // them, and both are named from their records rather than from a literal —
  // this is the same school name printed on every official form, and activating
  // a year or renaming the school must not leave the wrong one in the frame.
  //
  // Keyed on `token`, which also advances on navigation, so these re-read more
  // often than they change. That is the cheaper mistake: two small reads
  // against a stale name sitting above every screen until a reload.
  useEffect(() => {
    if (!me || !api) return;
    void api<Page>('/academic-years')
      .then(r => setYear(r.items.find(y => y.status === 'active') ?? null))
      .catch(() => setYear(null));
    void api<Row>('/school').then(setSchool).catch(() => setSchool(null));
    // From the session already open in this tab: nothing is fetched and
    // nothing is kept.
    void client?.auth.getSession()
      .then(({ data }) => setSignedInAs({
        email: data.session?.user.email ?? null,
        lastSignIn: data.session?.user.last_sign_in_at ?? null,
      }))
      .catch(() => setSignedInAs(undefined));
  }, [me, api, client, token]);

  // Screens this person's own classes rule out; `hiddenByAssignment` holds
  // the rule and why. Only a teacher is read for, so nothing else costs a request.
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (!me || !api || me.role !== 'teacher') { setHidden([]); return; }
    let live = true;
    void api<Page<{ grade_level: number }>>('/sections?limit=100')
      .then(page => { if (live) setHidden(hiddenByAssignment(me.role, page.items.map(s => Number(s.grade_level)))); })
      .catch(() => { if (live) setHidden([]); });
    return () => { live = false; };
  }, [me, api, token]);

  // How many notifications are unread, for the bell.
  //
  // `/notifications/count` answers a number, names no record and writes no
  // `record_access_events` row, which is the whole reason the bell asks for a
  // count rather than paging the list: a list that named learners would write
  // an access row on every poll and bury the privacy audit in its own noise.
  // It refetches on every navigation (`token`) and once a minute besides, so a
  // tab left open in a staffroom stays roughly current without polling hard.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me || !api) { setUnread(0); return; }
    let live = true;
    const ask = () => {
      void api<{ unread: number }>('/notifications/count')
        .then(answer => { if (live) setUnread(Number(answer.unread) || 0); })
        // A bell that cannot count is silent, never an error: the count is
        // furniture, and a failed poll must not interrupt what someone is typing.
        .catch(() => { if (live) setUnread(0); });
    };
    ask();
    const timer = setInterval(ask, 60000);
    return () => { live = false; clearInterval(timer); };
  }, [me, api, token]);

  // What waits on a principal or administrative officer, for the numbers beside Admissions, Promotion and Staff
  // access (the UI notes of 8 November, note 8). Asked exactly like the bell: numbers only, no access row, on every
  // navigation and once a minute. A teacher decides none of these, so a teacher's rail never asks.
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!me || !api || me.role === 'teacher') { setWaiting({}); return; }
    let live = true;
    const ask = () => {
      void api<{ class_lists: number; outcomes: number; name_requests: number }>('/waiting/count')
        .then(w => { if (live) setWaiting(waitingByRoute(w)); })
        .catch(() => { if (live) setWaiting({}); });
    };
    ask();
    const timer = setInterval(ask, 60000);
    return () => { live = false; clearInterval(timer); };
  }, [me, api, token]);

  // Retrying the staff record after a passing failure shows why, rather than a sign-in form; once signed in,
  // the start screen stays up while the staff record is read, instead of the sign-in heading with no form under it.
  if (!client || !api || (signedIn && !me)) {
    return (
      <div className="starting" role="status" aria-live="polite">
        <div className="starting-card">
          <span className="brand-mark"><BrandMark size={40} /></span>
          <b className="starting-name">EDUNEXUS</b>
          <span className="starting-school">Balili Elementary School</span>
          {fatal
            ? <StatusLine status={{ text: fatal, kind: 'error' }} />
            : <span className="starting-line"><Spinner />{signedIn ? 'Opening your workspace…' : 'Connecting to the sign-in service…'}</span>}
        </div>
      </div>
    );
  }
  if (embedded) return <Account client={client} framed={false} onReady={enterWorkspace} />;
  if (!me) return <Account client={client} onReady={() => { setFatal(''); setSignedIn(true); }} />;

  const manager = me.role !== 'teacher';
  const route = routeFor(page, me.role);
  const account = {
    updateMe: (patch: Row) => setMe(current => (current ? { ...current, ...patch } : current)),
    changePassword: () => setChangingPassword(true), auth: client.auth, signedInAs,
  };
  const navigate = (id: string) => {
    location.hash = `#/${id}`;
    setPage(id);
    setStatus(idle);
    setToken(t => t + 1);
  };

  return (
    <AppShell
      me={me}
      school={school}
      hidden={hidden}
      unread={unread}
      waiting={waiting}
      notificationPanel={
        <Notifications
          api={api}
          me={me}
          token={token}
          setStatus={setStatus}
          popover
          onUnreadChange={setUnread}
        />
      }
      current={route}
      context={year === undefined ? undefined : year ? `${yearName(year)} school year` : 'No active school year'}
      contextTone={year ? 'active' : 'none'}
      onNavigate={navigate}
      // Signing out leaves the workspace for the school's front page; the session is ended first, so the way back is a fresh sign-in.
      // Signing out forgets the choice too, so the next person at this computer starts
      // with the box unticked rather than inheriting somebody else's.
      onSignOut={() => { rememberMe(false); void client.auth.signOut().finally(() => location.assign('/')); }}
      onChangePassword={() => setChangingPassword(true)}
    >
      {route.ownHeader ? null : <PageHeader route={route} />}
      <StatusLine status={status} />
      <Fragment key={visit}>{route.render({ api, me, manager, setStatus, reload: () => setToken(t => t + 1), token, route, account })}</Fragment>
      {changingPassword ? (
        <Sheet title="Change your password" note="You will be asked for the one you use now." onClose={() => setChangingPassword(false)}>
          <PasswordChange auth={client.auth} onDone={text => { setChangingPassword(false); setStatus({ text, kind: 'done' }); }} />
        </Sheet>
      ) : null}
    </AppShell>
  );
}
