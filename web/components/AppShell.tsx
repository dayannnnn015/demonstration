import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Row } from '../api';
import { onApiBusy } from '../api';
import { groups, routes, type Route, available } from '../routes';
import { BrandMark } from './brand';
import { Icon } from './icons';
import { CommandPalette } from './palette';
import { editions, faqForCode } from '../help';
import { TourOverlay } from './tour';
import { HelpContext, type HelpTopic } from '../help/context';
import { HelpSheet } from '../screens/Help';
import { sentence } from './primitives';
import { SeededNotice } from './seeded';
import { UpdateNotice } from './update';
import { Avatar, type Look } from './avatar';
export { SeededNotice } from './seeded';


/**
 * Says so, in words, while the workspace is waiting on the server.
 *
 * Held back for a moment first. Most requests answer faster than the eye, and a
 * notice that flashes on every click is read as a fault rather than as
 * progress — so nothing is said until the wait is long enough to be noticed,
 * and then it is said plainly. It clears the instant the last request lands.
 */
function useWorking(after = 300) {
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onApiBusy(busy => {
      clearTimeout(timer);
      if (busy) timer = setTimeout(() => setWorking(true), after);
      else setWorking(false);
    });
    return () => { clearTimeout(timer); stop(); };
  }, [after]);
  return working;
}

/**
 * Interface preferences live in sessionStorage, alongside the session itself.
 * A staffroom machine is shared, so a collapsed rail should not outlive the tab
 * any more than the sign-in does. Every access is guarded: a private window
 * throws here rather than returning null.
 */
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(`edunexus-ui-${key}`);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch { return fallback; }
}
const remember = (key: string, value: unknown) => {
  try { sessionStorage.setItem(`edunexus-ui-${key}`, JSON.stringify(value)); } catch { /* not worth failing a render over */ }
};

/** Dismiss on outside click or Escape, handing focus back to the trigger. */
function useDismiss(open: boolean, close: () => void) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      wrap.current?.querySelector('button')?.focus();
    };
    addEventListener('mousedown', away);
    addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', key); };
  }, [open, close]);
  return wrap;
}

function ProfileMenu({ me, onSignOut, onChangePassword, onProfile, onSettings }: { me: Row; onSignOut: () => void; onChangePassword?: (() => void) | undefined; onProfile: () => void; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useDismiss(open, () => setOpen(false));
  const name = String(me.display_name);
  return (
    <div className="profile" ref={wrap} data-tour="profile">
      <button type="button" className="profile-trigger" aria-label={`${name}, ${sentence(String(me.role))}: account menu`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(v => !v)}>
        <Avatar name={name} look={me.profile as Look | null} />
        <span className="profile-text">
          <b>{name}</b>
          <span>{sentence(String(me.role))}</span>
        </span>
        <Icon name="chevron" size={14} />
      </button>
      {open ? (
        <div className="menu" role="menu">
          <div className="menu-head">
            <b>{name}</b>
            <span>{sentence(String(me.role))}</span>
          </div>
          <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); onProfile(); }}>
            <Icon name="user" size={16} />My profile
          </button>
          {/* Settings sits here rather than on the rail, by the user's
              instruction of 2026-11-06: it belongs with the person, beside
              their own profile and their own password, not among the school's
              records. It is still reached by Ctrl+K, which searches the whole
              route table and does not care that a route is `offRail`. */}
          <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
            <Icon name="settings" size={16} />Settings
          </button>
          {onChangePassword ? (
            <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); onChangePassword(); }}>
              <Icon name="eye-off" size={16} />Change password
            </button>
          ) : null}
          <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>
            <Icon name="signout" size={16} />Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Which rail item each waiting count belongs to: the screen where that work is done. */
export const waitingByRoute = (w: { class_lists: number; outcomes: number; name_requests: number }): Record<string, number> =>
  ({ enrollment: Number(w.class_lists) || 0, 'report-cards': Number(w.outcomes) || 0, staff: Number(w.name_requests) || 0 });

/** A count of work waiting, drawn as a number and read aloud as one: "Admissions, 3 waiting". */
const shownCount = (n: number) => (n > 99 ? '99+' : String(n));

function NavGroup({ group, items, current, collapsed, open, onToggle, onNavigate, waiting = {} }: {
  group: string;
  items: Route[];
  current: Route;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate: (id: string) => void;
  /** What waits on the viewer, by route id (the UI notes of 8 November, note 8). */
  waiting?: Record<string, number> | undefined;
}) {
  const holdsCurrent = items.some(route => route.id === current.id);
  // A folded group still says that something inside it is waiting, so folding it never hides the work.
  const folded = items.reduce((sum, route) => sum + (waiting[route.id] ?? 0), 0);
  return (
    <div className="nav" data-open={open}>
      {collapsed ? <hr className="nav-rule" /> : (
        <button type="button" className="nav-group" aria-expanded={open} onClick={onToggle}>
          <Icon name="caret" size={12} />
          <span>{group}</span>
          {/* Collapsing the group that holds the current page is allowed; a dot
              says where you are, so the rail never loses your position. */}
          {!open && holdsCurrent ? <Icon name="dot" size={8} /> : null}
          {!open && folded ? <span className="nav-count">{shownCount(folded)}<span className="sr-only"> waiting</span></span> : null}
        </button>
      )}
      {open || collapsed ? (
        <div className="nav-items">
          {items.map(route => {
            const count = waiting[route.id] ?? 0;
            const named = count ? `${route.nav}, ${count} waiting` : route.nav;
            return (
              <button
                key={route.id}
                type="button"
                className="nav-item"
                aria-current={route.id === current.id ? 'page' : 'false'}
                title={collapsed ? named : undefined}
                aria-label={collapsed ? named : undefined}
                onClick={() => onNavigate(route.id)}
                data-tour={`nav-${route.id}`}
              >
                <Icon name={route.icon} size={17} />
                <span className="nav-label">{route.nav}</span>
                {count ? <span className="nav-count">{shownCount(count)}<span className="sr-only"> waiting</span></span> : null}
                {route.built ? null : <span className="soon">Soon</span>}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ me, school, current, context, contextTone, hidden = [], unread = 0, waiting, notificationPanel, onNavigate, onSignOut, onChangePassword, children }: {
  me: Row;
  /** The school profile record. The rail states what it reads, never a literal:
   *  this is the same name printed on every official form, and it is editable. */
  school?: Row | null | undefined;
  current: Route;
  /** The active school year, or whatever else names the records on screen; undefined while it is still being read. */
  context?: string | undefined;
  /** Whether that year is open for new records. Ochre when nothing is. */
  contextTone?: 'active' | 'none' | undefined;
  /** Screens this person's own assignments rule out, on top of their role.
   *  Kept out of the rail and the command palette alike. */
  hidden?: string[] | undefined;
  /** How many notifications are unread. The shell only draws it: App.tsx asks
   *  for the count, which names no record and writes no access row, so it may
   *  be asked for repeatedly. */
  unread?: number | undefined;
  /** What waits on a manager, by route id, for the numbers beside those rail items. App.tsx asks
   *  `/waiting/count`, which names no record and writes no access row. */
  waiting?: Record<string, number> | undefined;
  notificationPanel?: ReactNode;
  onNavigate: (id: string) => void;
  onSignOut: () => void;
  onChangePassword?: (() => void) | undefined;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [tour, setTour] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [collapsed, setCollapsed] = useState(() => remembered('rail-collapsed', false));
  const [shut, setShut] = useState(() => remembered<string[]>('nav-shut', []));
  const manager = me.role !== 'teacher';
  // `hidden` is what this person's own assignments rule out, on top of what
  // their role does. It leaves the rail and the command palette together, so
  // there is no way in that the other closes.
  const visible = routes.filter(route => available(route, me.role) && !hidden.includes(route.id));
  const working = useWorking();
  const notificationWrap = useDismiss(notifications, () => setNotifications(false));

  const setRail = (next: boolean) => { setCollapsed(next); remember('rail-collapsed', next); };
  const toggleGroup = (group: string) => setShut(open => {
    const next = open.includes(group) ? open.filter(g => g !== group) : [...open, group];
    remember('nav-shut', next);
    return next;
  });

  // The one global shortcut. Held here rather than in the palette so it works
  // from any screen without the palette being mounted and listening.
  const openPalette = useCallback((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    // A tour holds the page until it ends; the palette would open beneath its shade.
    if (document.querySelector('.tour')) return;
    setPalette(true);
  }, []);
  useEffect(() => {
    addEventListener('keydown', openPalette);
    return () => removeEventListener('keydown', openPalette);
  }, [openPalette]);

  // `?` opens this screen's help, unless it is being typed, or something is already open over the page. The top
  // bar's Help button went in 0.82.1 (the group's note: help was everywhere, and the rail is enough); the key stays,
  // because it shows nothing until it is pressed.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (typing || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setHelp({ screen: true });
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  // A link followed from help goes somewhere else, and the help it came from no longer describes the page.
  useEffect(() => {
    // A notification followed to its source closes the bell's list too (the UI notes of 8 November, note 5).
    const away = () => { setHelp(null); setNotifications(false); };
    addEventListener('hashchange', away);
    return () => removeEventListener('hashchange', away);
  }, []);
  const role = me.role;
  // A tour starts from help, and the help it started from would sit under it pointing at nothing.
  const helpValue = useMemo(() => ({ explain: (code: string) => faqForCode(code, role), open: setHelp, tour: (id: string) => { setHelp(null); setTour(id); } }), [role]);
  const touring = tour ? editions.en.tours.find(t => t.id === tour) : undefined;

  return (
    <div className="app" data-rail={collapsed ? 'collapsed' : 'full'} data-drawer={drawer}>
      <a className="skip" href="#main">Skip to content</a>

      {/* Tapping the dimmed page closes the mobile drawer. Everything it covers
          is reachable again once it is closed, so it is not itself a control. */}
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />

      <nav className="rail" aria-label="Sections" data-tour="rail">
        <div className="rail-head">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true"><BrandMark size={24} /></span>
            <span className="brand-text">
              <b>EDUNEXUS<span className="tag-dev">Dev</span>{me.seeded_data ? <span className="tag-dev">Seeded</span> : null}</b>
              <span>Learner records</span>
            </span>
          </span>
          <button type="button" className="rail-close" aria-label="Hide sections" onClick={() => setDrawer(false)}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="rail-school">
          <span className="rail-school-mark" aria-hidden="true"><Icon name="school" size={15} /></span>
          <span className="rail-school-text">
            <b>{school ? String(school.name) : 'School profile'}</b>
            <span>{school?.school_code ? `School ID ${String(school.school_code)}` : 'School ID not set'}</span>
          </span>
        </div>

        <div className="nav-scroll">
          {groups.map(group => {
            const items = visible.filter(route => route.group === group && !route.offRail);
            if (!items.length) return null;
            return (
              <NavGroup
                key={group}
                group={group}
                items={items}
                current={current}
                collapsed={collapsed}
                open={!shut.includes(group)}
                onToggle={() => toggleGroup(group)}
                onNavigate={id => { onNavigate(id); setDrawer(false); }}
                waiting={waiting}
              />
            );
          })}
        </div>

        <div className="rail-foot">
          <button
            type="button"
            className="rail-collapse"
            onClick={() => setRail(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : undefined}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
            <span className="nav-label">Collapse sidebar</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button type="button" className="rail-open" aria-label="Show sections" aria-expanded={drawer} onClick={() => setDrawer(true)} data-tour="rail-open">
            <Icon name="menu" size={20} />
          </button>
          <div className="topbar-title">
            <h1>{current.title}</h1>
          </div>
          <div className="topbar-right">
            {/* Said in words, not only as a moving bar: "Working…" is what a
                person waiting on a slow click needs to be told. `role="status"`
                announces it once to a screen reader without stealing focus. */}
            {working ? (
              <span className="working" role="status">
                <span className="working-mark" aria-hidden="true" />
                Working…
              </span>
            ) : null}
            {/* The scope every record on screen is filed under. A statement,
                not a control: a year is activated on the School years screen,
                where what that means is spelled out. */}
            {context === undefined ? <span className="scope scope-pending" aria-hidden="true"><span className="skeleton" /></span> : context ? (
              <span className={`scope${contextTone === 'none' ? ' none' : ''}`} data-tour="scope">
                {contextTone === 'none'
                  ? <Icon name="alert" size={14} />
                  : <span className="scope-dot" aria-hidden="true" />}
                {context}
              </span>
            ) : null}
            {/* A count rather than a bare dot, and the number is in the
                label too: a screen reader should not have to infer it from
                a badge. No learner is named here or on the screen it opens. */}
            <div className="notification-wrap" ref={notificationWrap}>
              <button type="button" className="bell" onClick={() => setNotifications(open => !open)} data-tour="bell"
                aria-expanded={notifications} aria-haspopup="dialog"
                aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications, none unread'}>
                <Icon name="bell" size={16} />
                {unread ? <span className="bell-count">{unread > 99 ? '99+' : unread}</span> : null}
              </button>
              {notifications ? notificationPanel : null}
            </div>
            <span className="topbar-sep" aria-hidden="true" />
            <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Go to a screen" data-tour="palette">
              <Icon name="search" size={15} />
              <span>Go to a screen</span>
              <kbd className="kbd">Ctrl K</kbd>
            </button>
            <ProfileMenu me={me} onSignOut={onSignOut} onChangePassword={onChangePassword} onProfile={() => onNavigate('profile')} onSettings={() => onNavigate('settings')} />
          </div>
        </header>
        <HelpContext.Provider value={helpValue}>
          <main className="view" id="main"><UpdateNotice /><SeededNotice me={me} />{children}</main>
          {help ? <HelpSheet topic={help} route={current} role={role} onClose={() => setHelp(null)} /> : null}
          {touring ? <TourOverlay tour={touring} role={role} onNavigate={onNavigate} onClose={() => setTour(null)} /> : null}
        </HelpContext.Provider>
      </div>

      {palette ? (
        <CommandPalette
          routes={visible}
          current={current.id}
          role={me.role}
          onNavigate={onNavigate}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </div>
  );
}
