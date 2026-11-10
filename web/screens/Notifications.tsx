import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message, query } from '../api';
import { available, routes } from '../routes';
import { Icon } from '../components/icons';
import { Callout, Cell, EmptyState, Table, Unrecorded, type Status } from '../components/primitives';

type Props = { api: Api; me: Row; token: number; setStatus: (s: Status) => void; popover?: boolean; onUnreadChange?: (count: number) => void };

/**
 * Your own notifications. Nobody else's: the row policy behind this list
 * answers only rows addressed to the caller, so a principal opening it reads
 * their own inbox and not the school's.
 *
 * **No row here names a learner**, and that is the reason this screen has no
 * learner column to add later. Every list under /learners and /enrollments
 * writes a `record_access_events` row naming the records it returned, so a
 * notification that previewed names would put an access row behind every poll
 * of the bell and bury the privacy audit. A notification says what happened and
 * to which class; the screen it points at is the one that logs the disclosure.
 */

/**
 * What each kind says, in the words of the work rather than the column's.
 *
 * `closed` is what the row says to a reader the screen is shut to. Without it
 * the row named a screen and stopped, which is how a principal came to be told
 * a class list was waiting and shown the name of the one place they could not
 * open — a dead end reported by the school. Naming who does the work is the
 * fix; widening the screen is not, because the division of work is the
 * school's to set and they have set it.
 */
const says: Record<string, { text: string; goes?: string[]; closed?: string }> = {
  // Where each kind leads, in order of preference: the first screen this reader may open (the UI notes of
  // 8 November, note 5). A class list waits on Admissions, where both managers approve it since 0.96.0, so the
  // principal is no longer shown a screen that is shut to them.
  roster_submitted: { text: 'A class list is waiting to be imported', goes: ['enrollment', 'imports'], closed: 'The administrative officer imports it' },
  roster_withdrawn: { text: 'A class list was withdrawn before it was decided', goes: ['enrollment', 'imports'], closed: 'Nothing is waiting for you' },
  roster_imported: { text: 'Your class list was imported', goes: ['imports'] },
  roster_declined: { text: 'Your class list was declined — it needs correcting', goes: ['imports'] },
  learner_placed: { text: 'A learner was placed in a class', goes: ['enrollment', 'learners'] },
  learner_moved: { text: 'A learner was moved between classes', goes: ['enrollment', 'learners'] },
  learner_withdrawn: { text: 'A learner was withdrawn', goes: ['enrollment', 'learners'] },
  learner_reentered: { text: 'A learner re-entered', goes: ['enrollment', 'learners'] },
  learner_unplaced: { text: 'A learner is registered at a grade with no class', goes: ['enrollment', 'learners'] },
  month_submitted: { text: 'A monthly consolidation was submitted', goes: ['months', 'attendance'] },
  month_returned: { text: 'Your monthly consolidation was returned', goes: ['months', 'attendance'] },
  month_locked: { text: 'A monthly consolidation was locked', goes: ['months', 'attendance'] },
  promotion_endorsed: { text: 'Promotion outcomes are waiting for approval', goes: ['report-cards'] },
  promotion_approved: { text: 'Your promotion outcomes were approved', goes: ['report-cards'] },
  promotion_returned: { text: 'Your promotion outcomes were returned', goes: ['report-cards'] },
  adviser_assigned: { text: 'You were made adviser of a class', goes: ['staff', 'learners'] },
  adviser_removed: { text: 'You are no longer adviser of a class', goes: ['staff', 'learners'] },
  calendar_changed: { text: 'The instructional calendar changed', goes: ['calendar'] },
  year_activated: { text: 'A school year was activated', goes: ['years', 'overview'] },
  year_closed: { text: 'A school year was closed', goes: ['years', 'overview'] },
  next_year_placed: { text: 'Next year’s classes were completed', goes: ['next-year', 'learners'] },
};

/** The class a notification is about, from the only facts its payload may carry. */
export function describeSubject(payload: Row) {
  const name = payload.section_name ? String(payload.section_name) : '';
  const grade = payload.grade_level === undefined || payload.grade_level === null
    ? '' : Number(payload.grade_level) === 0 ? 'Kindergarten' : `Grade ${String(payload.grade_level)}`;
  return [grade, name].filter(Boolean).join(' — ');
}

/**
 * Where a notification points, when the reader is allowed that screen.
 *
 * `hiddenFor` hides a screen from a role's navigation without changing what the
 * API allows, and `routeFor` answers Overview for a screen a role may not open
 * — so an unconditional link would land that reader on the Overview with no
 * explanation. The link is offered when the screen is theirs to open, and what
 * happens instead is named in words when it is not.
 *
 * Roster import is the case that matters: it is `hiddenFor: ['principal']`,
 * because on this school's division of work the administrative officer
 * imports, and the principal is still told a list is waiting. 0.95.4 opened
 * the screen to them and 0.95.5 closed it again at the school's word, so the
 * remaining fault was the wording — a row that named a screen and stopped. It
 * now names who does the work (`closed` above). Nothing here is a permission:
 * `decide_roster_submission` checks `is_manager()` and would accept either.
 */
function pointsAt(kind: string, role: unknown) {
  const goes = says[kind]?.goes ?? [];
  const candidates = goes.map(id => routes.find(r => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const open = candidates.find(r => available(r, role));
  if (open) return { route: open, open: true };
  return candidates[0] ? { route: candidates[0], open: false } : null;
}

/**
 * The address a notification opens: its screen, at the school year and class it is about, and for a class list
 * waiting, that list (the UI notes of 8 November, note 5). **Never a learner**: `learner_id` is not read here, by
 * design, because an address reaches browser history on a shared staffroom screen, and the screen it opens is the
 * one that names a learner and writes the access row for it.
 */
export function sourceOf(row: Row, routeId: string) {
  const ask = new URLSearchParams();
  if (row.academic_year_id) ask.set('year', String(row.academic_year_id));
  if (row.section_id) ask.set('section', String(row.section_id));
  if (row.subject_table === 'roster_submissions' && row.subject_id && routeId === 'enrollment') ask.set('list', String(row.subject_id));
  const q = ask.toString();
  return `#/${routeId}${q ? `?${q}` : ''}`;
}

export function Notifications({ api, me, token, setStatus, popover = false, onUnreadChange }: Props) {
  const [status, setFilter] = useState<'unread' | 'all'>('unread');
  const [before, setBefore] = useState('');
  const [rows, setRows] = useState<Page | null>(null);
  const [clearing, setClearing] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setRows(null);
    void api<Page>(`/notifications${query({ status, limit: 25, before_id: before })}`)
      .then(setRows)
      .catch(() => setRows({ items: [] }));
  }, [api, status, before, token, refresh]);
  useEffect(() => {
    void api<{ unread: number }>('/notifications/count')
      .then(answer => onUnreadChange?.(Number(answer.unread) || 0))
      .catch(() => undefined);
  }, [api, refresh, onUnreadChange]);

  const show = (next: 'unread' | 'all') => { setBefore(''); setFilter(next); };

  const readOne = async (id: string) => {
    try {
      await api(`/notifications/read`, 'POST', { id });
      setRefresh(n => n + 1);
    } catch (error) { setStatus({ kind: 'error', text: message(error) }); }
  };

  const readAll = async () => {
    setClearing(true);
    try {
      const done = await api<{ marked: number }>(`/notifications/read-all`, 'POST', {});
      setRefresh(n => n + 1);
      setStatus({ kind: 'done', text: done.marked
        ? `Marked ${done.marked} ${done.marked === 1 ? 'notification' : 'notifications'} as read.`
        : 'Nothing was unread.' });
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    } finally { setClearing(false); }
  };

  const items = rows?.items ?? [];
  return (
    <div className={popover ? 'notification-popover' : undefined} role={popover ? 'dialog' : undefined} aria-label={popover ? 'Notifications' : undefined}>
      <div className={`card${popover ? ' notification-card' : ''}`}>
        <div className="card-head"><div>
          <h2>Notifications</h2>
          <p className="card-note">Yours alone, and no learner is named in one.</p>
        </div>
          <button type="button" className="btn secondary small" aria-busy={clearing} disabled={clearing || !items.some(r => r.read_at === null)} onClick={() => void readAll()}>
            <Icon name="check" size={14} />{clearing ? 'Marking…' : 'Mark all as read'}
          </button>
        </div>
        <div className="card-tools">
          <div className="segmented" role="group" aria-label="Which notifications to show">
            {([['unread', 'Unread'], ['all', 'Everything']] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={status === key} className={status === key ? 'active' : undefined} onClick={() => show(key)}>{label}</button>
            ))}
          </div>
        </div>
        <Table
          loading={rows === null}
          rows={items}
          rowKey={r => String(r.id)}
          empty={status === 'unread'
            ? <EmptyState title="Nothing unread" body="You are up to date. Choose Everything to see the ones you have already read." />
            : <EmptyState title="No notifications yet" body="When a class list is submitted or decided, or a learner’s class changes, it will appear here." />}
          columns={[
            { header: 'When', cell: r => <span className="mono">{new Date(String(r.created_at)).toLocaleString()}</span> },
            { header: 'What happened', cell: r => {
              const about = describeSubject((r.payload ?? {}) as Row);
              const to = pointsAt(String(r.kind), me.role);
              const text = says[String(r.kind)]?.text ?? String(r.kind);
              const href = to?.open ? sourceOf(r, to.route.id) : null;
              // The whole line opens where it happened, and reading it there marks it read.
              const follow = () => { if (r.read_at === null) void api('/notifications/read', 'POST', { id: String(r.id) }).then(() => setRefresh(n => n + 1)).catch(() => undefined); };
              return (
                <Cell
                  title={href ? <a className="notification-link" href={href} onClick={follow}>{text}</a> : text}
                  meta={<>
                    {about ? <span>{about}</span> : null}
                    {href
                      ? <a href={href} onClick={follow}>Open on {to!.route.nav}</a>
                      : to ? <span className="muted">{says[String(r.kind)]?.closed ?? `On ${to.route.nav}`}</span> : null}
                  </>}
                />
              );
            } },
            { header: 'Who', cell: r => (r.actor_name
              ? <b>{String(r.actor_name)}</b>
              // Since 0066 the actor of your own notification is named,
              // whoever you are, so this is now the rare case rather than
              // every adviser's: a staff record that can no longer be read.
              // Still drawn rather than blanked — absence is stated here as
              // everywhere else.
              : <Unrecorded label="Not recorded" />) },
            { header: 'Read', cell: r => (r.read_at
              ? <span className="muted">Read</span>
              : <button type="button" className="btn ghost small" onClick={() => void readOne(String(r.id))}>Mark as read</button>) },
          ]}
        />
        <div className="pager">
          <span>25 per page, newest first</span>
          <div className="pager-nav">
            <button type="button" className="btn secondary small" disabled={!before} onClick={() => setBefore('')}>Newest</button>
            <button type="button" className="btn secondary small" disabled={!rows?.pagination?.next_before_id} onClick={() => setBefore(String(rows!.pagination!.next_before_id))}>Older</button>
          </div>
        </div>
      </div>

      <Callout tone="info" title="What is notified, and what is not">
        EDUNEXUS notifies you about work that has moved: a class list submitted or decided, a learner’s class changed, a consolidation or an outcome sent on. It does <b>not</b> notify anyone about a learner’s absences — the school has no approved alert rule, and the system will not invent one. Nor does it notify on routine recording: a mark, a score, an opened record or a saved draft stays on its own screen and in the activity and access logs.
      </Callout>
    </div>
  );
}
