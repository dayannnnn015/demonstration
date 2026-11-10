import { useEffect, useState, type FormEvent } from 'react';
import type { Api, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { clamp, firstOf, lastOf, monthName, monthOf, step, weekday, type Month } from '../dates';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { ScopePickers, useScope } from '../components/scope';
import { Sf4Report } from './Sf4';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, PrintButton, StatusLine, Table, TableSkeleton,
  idle, localToday, type Status,
} from '../components/primitives';
import { Session } from './Calendar';
import { Affects } from '../components/affects';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended';
type Status2 = 'draft' | 'submitted' | 'locked';
type Action = 'submit' | 'return' | 'lock' | 'reopen';
type Schedule = { day_on: string; source: 'school' | 'section' | 'unconfigured'; configured: boolean; am: Mode | null; pm: Mode | null; day_type: string | null; label: string | null };
type Counts = { expected_sessions: number; missing_sessions: number; present_sessions: number; absent_sessions: number };
type Summary = Counts & { member_count: number; dates_requested: number; unconfigured_dates: number; unsupported_sessions: number };
type Day = Counts & { day_on: string; schedule: Schedule; eligible_learners: number };
type Review = { month_on: string; from: string; to: string; summary: Summary; days: Day[] };
type Current = {
  month_on: string; from: string; to: string; status: Status2; version: number; snapshot_id: string | null;
  review: Review; data_hash: string; issues: string[]; can_submit: boolean; source: 'live' | 'submission_snapshot';
};
type Plan = Current & { action: Action; target_status: Status2; reason: string; can_commit: boolean; review_hash: string | null };

/**
 * What blocks a submission, in words a school head can act on. The API returns
 * these as codes; a code names the rule to whoever wrote it and nothing at all
 * to the person who has to fix the month.
 */
export const issueText: Record<string, string> = {
  YEAR_NOT_ACTIVE: 'The school year is not active. A month is submitted only while its year is running.',
  MONTH_NOT_ENDED: 'This month has not finished yet. It can be submitted once its last date has passed — a month ending today cannot.',
  UNCONFIGURED_DATES: 'Some dates in this month have no schedule. Every date the month covers has to be configured on the Instructional calendar screen, weekends included: a date nobody has set is unknown, not a holiday.',
  UNSUPPORTED_ADM: 'Some sessions are alternative delivery. Recording and converting alternative-delivery participation needs the school’s approved rules, which have not been supplied, so a month holding one cannot be submitted.',
  MISSING_MARKS: 'Some classroom sessions have no mark. Every eligible classroom session needs an explicit present or absent on the Daily attendance screen before the month can be submitted.',
};

const actionName: Record<Action, string> = { submit: 'Submit this month', return: 'Return to draft', lock: 'Lock this month', reopen: 'Reopen this month' };
/** The names the tour of closing a month points at. */
const tourName: Record<Action, string> = { submit: 'month-submit', return: 'month-return', lock: 'month-lock', reopen: 'month-reopen' };

const actionNote: Record<Action, string> = {
  submit: 'Submitting freezes the month. Its marks, the calendar dates it covers and its membership become read-only, and an immutable snapshot of who was enrolled and what was marked is kept.',
  return: 'Returning puts the month back to draft so its marks can be corrected. The snapshot already taken is kept as evidence and nothing recorded is deleted.',
  lock: 'Locking keeps the month frozen and its submitted snapshot intact. A locked month is reopened explicitly, with a reason.',
  reopen: 'Reopening puts a locked month back to draft so its marks can be corrected. Every snapshot already taken is kept as evidence.',
};

export const allowed: Record<Status2, Action[]> = { draft: ['submit'], submitted: ['return', 'lock'], locked: ['reopen'] };

const statusTone = (status: Status2) => (status === 'locked' ? 'good' : status === 'submitted' ? 'info' : 'neutral');
export const statusName = (status: Status2) => (status === 'locked' ? 'Locked' : status === 'submitted' ? 'Submitted' : 'Draft');

/**
 * A transition is proposed, previewed and confirmed with the hash the preview
 * returned. The hash binds the whole dataset for a submission, so a mark
 * changed underneath it invalidates the review rather than slipping into it.
 */
function TransitionSheet({ api, sectionId, monthOn, version, action, onClose, onDone }: {
  api: Api; sectionId: string; monthOn: string; version: number; action: Action;
  onClose: () => void; onDone: (text: string) => void;
}) {
  const [status, setStatus] = useState<Status>(idle);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const review = async (event: FormEvent) => {
    event.preventDefault();
    const body = { month_on: monthOn, version, action, reason: reason.trim().replace(/\s+/g, ' ') };
    setBusy(true);
    setStatus({ text: 'Reviewing…', kind: 'busy' });
    try {
      const result = await api<Plan>(`/sections/${sectionId}/attendance/months/preview`, 'POST', body);
      setSent(body);
      setPlan(result);
      setStatus(result.can_commit ? idle : { text: 'This month cannot be submitted yet. What is outstanding is listed below.', kind: 'error' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!sent || !plan?.review_hash) return;
    setBusy(true);
    setStatus({ text: 'Recording…', kind: 'busy' });
    try {
      await api(`/sections/${sectionId}/attendance/months/transitions`, 'POST', { ...sent, review_hash: plan.review_hash, reviewed: true });
      onDone(`This month is now ${statusName(plan.target_status).toLowerCase()}.`);
    } catch (error) {
      // The month or its data moved under the review, so the hash is dead.
      if (error instanceof ApiError && error.isConflict) { setPlan(null); setSent(null); }
      setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={actionName[action]} note={actionNote[action]} wide onClose={onClose}>
      <StatusLine status={status} />
      <Affects what="month" />

      {plan ? (
        <>
          {plan.issues.length ? (
            <Callout tone="stopped" title="Not ready">
              <ul>{plan.issues.map(code => <li key={code}>{issueText[code] ?? code}</li>)}</ul>
            </Callout>
          ) : null}

          <p className="card-note">
            {statusName(plan.status)} → <b>{statusName(plan.target_status)}</b> · {plan.review.summary.member_count} learners ·
            {' '}<span className="mono">{plan.from}</span> to <span className="mono">{plan.to}</span>
          </p>
          <p className="muted">
            {plan.review.summary.present_sessions} present, {plan.review.summary.absent_sessions} absent,
            {' '}{plan.review.summary.missing_sessions} unmarked of {plan.review.summary.expected_sessions} classroom sessions.
            These are raw session counts, not school days, attendance credits or a rate.
          </p>

          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || !plan.can_commit || !plan.review_hash} aria-busy={busy} onClick={() => void confirm()}>
              {busy ? 'Recording…' : 'Confirm this review'}
            </button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setPlan(null); setSent(null); setStatus(idle); }}>
              Change something
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={event => void review(event)}>
          <div className="form-grid">
            <div className="field wide">
              <label className="label" htmlFor="mon-reason">Reason</label>
              <textarea id="mon-reason" required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              <span className="hint">10–500 characters, kept with the transition for good. Say what was checked, or what has to be corrected.</span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Reviewing…' : 'Review this change'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/**
 * One section, one month, and the decision to freeze it.
 *
 * Submission is what turns a month of daily marks into evidence: it takes an
 * immutable snapshot of who was enrolled and what each of them was marked, and
 * closes the month against later edits until somebody explicitly returns it.
 * Everything counted here is a raw AM/PM classroom session. None of it is a
 * school day, an attendance credit, a percentage or an SF4 total, because the
 * rules that turn sessions into any of those have not been supplied.
 */
export function Months({ api, me, setStatus, reload, token, route }: Props) {
  const scope = useScope(api, token);
  const [month, setMonth] = useState<Month | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [acting, setActing] = useState<Action | null>(null);
  const [failed, setFailed] = useState(false);

  const { year, sectionId } = scope;

  useEffect(() => {
    if (!year) return;
    setMonth(monthOf(clamp(localToday(), String(year.starts_on), String(year.ends_on))));
  }, [year?.id, year?.starts_on, year?.ends_on]);

  const monthOn = month ? firstOf(month) : '';

  useEffect(() => {
    if (!sectionId || !monthOn) { setCurrent(null); return; }
    setCurrent(null);
    setFailed(false);
    void api<Current>(`/sections/${sectionId}/attendance/months${query({ month_on: monthOn })}`)
      .then(setCurrent)
      .catch(() => { setCurrent(null); setFailed(true); });
  }, [api, sectionId, monthOn, token]);

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={5} /></div></>;
  if (!scope.years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState title="No school year yet" body="A month belongs to a school year. Create one on the School years screen first." /></div>
      </>
    );
  }
  if (scope.sections?.length === 0) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card">
          <div className="card-head"><div className="toolbar"><ScopePickers scope={scope} /></div></div>
          <EmptyState title="No sections in this year" body="Create a section on School years & sections before consolidating a month." />
        </div>
      </>
    );
  }

  const status = current?.status ?? 'draft';
  const summary = current?.review.summary;
  const closed = year?.status === 'closed';
  const actions = closed ? [] : allowed[status];

  const back = month ? step(month, -1) : null;
  const forward = month ? step(month, 1) : null;
  const canGoBack = !!(back && year && lastOf(back) >= String(year.starts_on));
  const canGoForward = !!(forward && year && firstOf(forward) <= String(year.ends_on));

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {current ? <PrintButton label="Print this month" /> : null}
          {actions.map(action => (
            <button
              key={action}
              type="button"
              className={action === 'submit' || action === 'lock' ? 'btn' : 'btn secondary'}
              // The readiness check below already says why; a button that can only
              // lead to a refusal is not offered.
              disabled={!current || (action === 'submit' && !current.can_submit)}
              onClick={() => setActing(action)}
              data-tour={tourName[action]}
            >{actionName[action]}</button>
          ))}
        </>}
      />

      <div className="card">
        <div className="card-head">
          <div className="toolbar" data-tour="month-pick">
            <ScopePickers scope={scope} />
            {month ? (
              <div className="field inline">
                <span className="label">Month</span>
                <span className="month-nav">
                  <button type="button" className="btn ghost small" disabled={!canGoBack} aria-label="Previous month" onClick={() => back && setMonth(back)}><Icon name="back" size={14} /></button>
                  <b>{monthName(month)}</b>
                  <button type="button" className="btn ghost small" disabled={!canGoForward} aria-label="Next month" onClick={() => forward && setMonth(forward)}><Icon name="forward" size={14} /></button>
                </span>
              </div>
            ) : null}
          </div>
          <div className="card-head-actions">
            {current ? <Badge tone={statusTone(status)}>{statusName(status)}</Badge> : null}
            {current?.source === 'submission_snapshot' ? <Badge tone="info">Frozen snapshot</Badge> : null}
            {closed ? <Badge tone="neutral">Closed year — read only</Badge> : null}
          </div>
        </div>

        {failed ? <div className="card-body"><Callout tone="stopped" title="This month could not be read">The month falls outside this section’s school year, or the request failed. Use the arrows to move inside the year.</Callout></div> : null}

        {current ? (
          <div className="card-body">
            <p className="card-note">
              <span className="mono">{current.from}</span> to <span className="mono">{current.to}</span> · {summary?.member_count} learners ·
              {' '}{summary?.dates_requested} dates, {summary?.unconfigured_dates} without a schedule
            </p>
            {status === 'draft' && current.issues.length ? (
              <Callout tone="attention" title="Not ready to submit">
                <ul>{current.issues.map(code => <li key={code}>{issueText[code] ?? code}</li>)}</ul>
              </Callout>
            ) : status === 'draft' ? (
              <Callout tone="info" title="Ready to submit">Every date this month covers has a schedule and every eligible classroom session has an explicit mark.</Callout>
            ) : null}
          </div>
        ) : null}

        <Table
          loading={current === null && !failed}
          rows={current?.review.days ?? []}
          rowKey={day => day.day_on}
          empty={<EmptyState title="No dates in this month" body="This month falls outside the school year. Use the arrows to move inside it." />}
          columns={[
            { header: 'Date', cell: day => <Cell title={<span className="mono">{day.day_on}</span>} meta={weekday(day.day_on)} /> },
            { header: 'Morning', cell: day => <Session day={day.schedule} part="am" /> },
            { header: 'Afternoon', cell: day => <Session day={day.schedule} part="pm" /> },
            { header: 'Learners', cell: day => day.eligible_learners, numeric: true },
            { header: 'Present', cell: day => day.present_sessions, numeric: true },
            { header: 'Absent', cell: day => day.absent_sessions, numeric: true },
            { header: 'Unmarked', cell: day => (day.missing_sessions ? <Badge tone="attention">{day.missing_sessions}</Badge> : day.missing_sessions), numeric: true },
          ]}
        />

        {summary ? (
          <div className="card-body">
            <p className="card-note">
              {summary.expected_sessions} classroom sessions expected · {summary.present_sessions} present ·
              {' '}{summary.absent_sessions} absent · {summary.missing_sessions} unmarked ·
              {' '}{summary.unsupported_sessions} alternative delivery
            </p>
            <p className="muted">
              Every figure above is a count of raw AM and PM classroom sessions. None of them is a school day, an attendance credit, a percentage or an SF4 total: the school’s approved mark meanings, half-day rules and conversion rules have not been supplied, so EDUNEXUS counts what was recorded and computes nothing from it.
            </p>
          </div>
        ) : null}
      </div>

      {year && monthOn ? <Sf4Report api={api} me={me} year={year} monthOn={monthOn} setStatus={setStatus} /> : null}

      {acting && current ? (
        <TransitionSheet
          api={api}
          sectionId={sectionId}
          monthOn={monthOn}
          version={current.version}
          action={acting}
          onClose={() => setActing(null)}
          onDone={text => { setActing(null); setStatus({ text, kind: 'done' }); reload(); }}
        />
      ) : null}
    </>
  );
}
