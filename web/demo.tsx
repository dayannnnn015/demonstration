import { StrictMode, useEffect, useMemo, useState, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, type Api, type Row } from './api';
import { AppShell, waitingByRoute } from './components/AppShell';
import { Notifications } from './screens/Notifications';
import { BrandMark } from './components/brand';
import { PageHeader, StatusLine, idle, yearName, type Status } from './components/primitives';
import { available, routeFor, routes } from './routes';
import { applyPreferences, followDevice, startScreen, type Preferences } from './preferences';
import './styles/app.css';

/**
 * The workspace over `npm run demo`: the real shell and screens against a
 * local API holding only synthetic records. Sign-in is replaced by choosing a
 * synthetic staff member, whose identifier is the bearer token that API
 * accepts. This page is never part of the production build, which bundles
 * `app.html` alone, and the identifiers mean nothing to the real API.
 */
const people: [string, string, string][] = [
  ['00000000-0000-4000-8000-000000000001', 'Demo Principal', 'Manages every record'],
  ['00000000-0000-4000-8000-000000000002', 'Demo Administrative Officer', 'Manages learner records'],
  ['00000000-0000-4000-8000-000000000003', 'Demo Adviser, Grade 1', 'Has last month’s register and this month’s so far'],
  ['00000000-0000-4000-8000-000000000004', 'Demo Adviser, Grade 2', 'Has one day of the register half-taken'],
  ['00000000-0000-4000-8000-000000000005', 'Demo Adviser, Kindergarten', 'Has outcomes recommended, most of them approved'],
  ['00000000-0000-4000-8000-000000000006', 'Demo Adviser, Grade 3', 'Has the last school week in the register'],
  ['00000000-0000-4000-8000-000000000007', 'Demo Adviser, Grade 4', 'Has the last school week in the register'],
  ['00000000-0000-4000-8000-000000000008', 'Demo Adviser, Grade 5', 'Has the last school week in the register'],
  ['00000000-0000-4000-8000-000000000009', 'Demo Adviser, Grade 6', 'Has the last school week in the register'],
];

const demoApi = (token: string): Api => async <T,>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error ?? {};
    throw new ApiError(response.status, error.code ?? 'REQUEST_FAILED', error.message ?? 'The request failed.', error.fields ?? []);
  }
  return payload.data as T;
};

const currentHash = () => location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '') || 'overview';

function Demo() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem('edunexus-demo-as') ?? ''; } catch { return ''; } });
  const [me, setMe] = useState<Row | null>(null);
  const [page, setPage] = useState(currentHash);
  const [visit, setVisit] = useState(0);
  const [status, setStatus] = useState<Status>(idle);
  const [tick, setTick] = useState(0);
  // undefined until read: the top bar must not say there is no active year before it has looked.
  const [year, setYear] = useState<Row | null | undefined>(undefined);
  const [school, setSchool] = useState<Row | null>(null);
  const api = useMemo(() => demoApi(token), [token]);
  const profile = me?.profile as Preferences | null | undefined;
  useEffect(() => { applyPreferences(profile ?? null); }, [profile]);
  useEffect(() => followDevice(), []);

  useEffect(() => {
    // A link in a sentence changes the address directly; the last screen's message must not follow it to the next.
    let shown = currentHash();
    // A link that names what to open (`#/months?section=…`, from a notification) opens it even on the screen already
    // showing: the screen is mounted afresh, since it reads the address only as it opens (the UI notes of 8 November, note 5).
    const sync = () => { const next = currentHash(); if (next !== shown) setStatus(idle); shown = next; setPage(next); if (location.hash.includes('?')) setVisit(v => v + 1); };
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    try { if (token) sessionStorage.setItem('edunexus-demo-as', token); else sessionStorage.removeItem('edunexus-demo-as'); } catch { /* A private window. */ }
    if (!token) { setMe(null); return; }
    void api<Row>('/me').then(row => {
      setMe(row);
      const start = startScreen((row.profile as Row | null)?.landing, location.hash, id => routes.some(r => r.id === id && available(r, row.role)));
      if (start) { location.hash = `#/${start}`; setPage(start); }
    }).catch(() => setToken(''));
  }, [api, token]);
  useEffect(() => {
    if (!me) return;
    void api<{ items: Row[] }>('/academic-years').then(r => setYear(r.items.find(y => y.status === 'active') ?? null)).catch(() => setYear(null));
    void api<Row>('/school').then(setSchool).catch(() => setSchool(null));
  }, [api, me, tick]);

  // The bell, as the real shell has it, so a notification can be followed to its source in the demo too.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me) { setUnread(0); return; }
    void api<{ unread: number }>('/notifications/count').then(a => setUnread(Number(a.unread) || 0)).catch(() => setUnread(0));
  }, [api, me, tick]);
  // The same counts the real shell asks for, so the demo's rail shows them.
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!me || me.role === 'teacher') { setWaiting({}); return; }
    void api<{ class_lists: number; outcomes: number; name_requests: number }>('/waiting/count').then(w => setWaiting(waitingByRoute(w))).catch(() => setWaiting({}));
  }, [api, me, tick]);

  if (!me) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="brand-mark"><BrandMark size={30} /></span>
            <span className="brand-text"><b>EDUNEXUS<span className="tag-dev">Demo</span></b><span>Synthetic records only</span></span>
          </div>
          <h1>Choose who to be</h1>
          <p className="auth-lede">This is a local demonstration. Every learner, mark and school detail in it is invented, and it disappears when the demo stops.</p>
          <div className="demo-people">
            {people.map(([id, name, note]) => (
              <button key={id} type="button" className="btn secondary demo-person" onClick={() => setToken(id)}>
                <b>{name}</b><span>{note}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const manager = me.role !== 'teacher';
  const route = routeFor(page, me.role);
  const navigate = (id: string) => { location.hash = `#/${id}`; setPage(id); setStatus(idle); setTick(t => t + 1); };
  return (
    <AppShell
      me={me}
      school={school}
      current={route}
      context={year === undefined ? undefined : year ? `${yearName(year)} school year` : 'No active school year'}
      contextTone={year ? 'active' : 'none'}
      waiting={waiting}
      unread={unread}
      notificationPanel={<Notifications api={api} me={me} token={tick} setStatus={setStatus} popover onUnreadChange={setUnread} />}
      onNavigate={navigate}
      onSignOut={() => { setToken(''); location.hash = ''; }}
    >
      {route.ownHeader ? null : <PageHeader route={route} />}
      <StatusLine status={status} />
      <Fragment key={visit}>{route.render({ api, me, manager, setStatus, reload: () => setTick(t => t + 1), token: tick, route, account: { updateMe: patch => setMe(m => (m ? { ...m, ...patch } : m)) } })}</Fragment>
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
