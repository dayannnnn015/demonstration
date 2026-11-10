import { useEffect, useState } from 'react';
import type { Api } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { clamp, shift, span, weekday } from '../dates';
import { ScopePickers, useScope } from '../components/scope';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, PrintButton, Select, Table, TableSkeleton,
  Unrecorded, byLearnerName, learnerName, localToday, type Status,
} from '../components/primitives';
import { MarkValue, type Mark } from './Attendance';

type Props = { api: Api; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

type View = 'all' | 'with_absences' | 'incomplete';
type Class = 'not_eligible' | 'unconfigured' | 'unsupported_adm' | 'no_classroom' | 'incomplete' | 'absent' | 'attended';
type Evidence = { day_on: string; eligible: boolean; am: Mark; pm: Mark; classification: Class };
type Summary = {
  eligible_dates: number; expected_sessions: number; present_sessions: number; absent_sessions: number;
  missing_sessions: number; unsupported_sessions: number; unconfigured_dates: number;
  absent_classroom_dates: number; longest_absent_date_run: number; trailing_absent_date_run: number; needs_completion: boolean;
};
type Member = {
  enrollment_id: string; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null;
  summary: Summary; dates: Evidence[];
};
type Result = {
  visibility: 'full_historical_roster' | 'current_access_only';
  from: string; to: string; view: View; calendar_version: number;
  days: { day_on: string; configured: boolean; month_status: 'draft' | 'submitted' | 'locked' }[];
  items: Member[];
  pagination: { limit: number; next_after_id: string | null };
};

const views: [View, string][] = [
  ['all', 'Everyone in the window'],
  ['with_absences', 'Only those with a recorded absence'],
  ['incomplete', 'Only those with something unrecorded'],
];

/**
 * Why a chosen window cannot be read, or null when it can.
 *
 * The API refuses anything outside these bounds with a single `MONITOR_RANGE`
 * code, which does not say which of the four rules was broken. Checking them
 * here means the reader is told what to change before a request is spent, and
 * each rule gets its own sentence.
 */
export function windowProblem(from: string, to: string, earliest: string, latest: string): string | null {
  if (!from || !to) return null;
  if (from > to) return 'The first date is after the last one.';
  const width = span(from, to);
  if (width > 31) return `That window covers ${width} dates. Choose 31 or fewer — this is a bounded read, not a whole-year report.`;
  if (to > latest) return 'The window cannot end after today, or after the school year does. Today has sessions that simply have not been recorded yet, and they are not absences.';
  if (from < earliest) return 'The window cannot start before the school year does.';
  return null;
}

/**
 * What one date says about one learner. `unconfigured` and `incomplete` are
 * absences of a record, not observations, so they carry the unrecorded mark
 * rather than a badge: a date nobody configured and a session nobody marked
 * are unknown, and reading either as an absence is the mistake this whole
 * module is built to prevent.
 */
export function Classification({ value }: { value: Class }) {
  if (value === 'absent') return <Badge tone="attention">Absent</Badge>;
  if (value === 'attended') return <Badge tone="good">Attended</Badge>;
  if (value === 'no_classroom') return <Badge tone="neutral">No class</Badge>;
  if (value === 'unsupported_adm') return <Badge tone="info">Alternative delivery</Badge>;
  if (value === 'not_eligible') return <Badge tone="neutral">Not enrolled</Badge>;
  if (value === 'unconfigured') return <Unrecorded label="No schedule" />;
  return <Unrecorded label="Not marked" />;
}

/**
 * Recorded absences and gaps in recording, inside a window somebody chose.
 *
 * Every number here is bounded by that window and describes what was written
 * down, not what it means. There is no threshold, no risk label and no alert:
 * the school has confirmed it has no approved absence rule, so EDUNEXUS shows
 * the evidence and leaves the judgement to the staff reading it. A run that
 * started before `from` is not inspected, which is why the window is stated on
 * screen beside every count it produced.
 */
export function Monitor({ api, setStatus, token, route }: Props) {
  const scope = useScope(api, token);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState<View>('all');
  const [result, setResult] = useState<Result | null>(null);
  const [extra, setExtra] = useState<Member[]>([]);
  const [failed, setFailed] = useState(false);

  const { year, sectionId } = scope;
  const today = localToday();
  // The API reads no future date, so the window ends at today or at the end of
  // the year, whichever comes first.
  const latest = year ? (String(year.ends_on) < today ? String(year.ends_on) : today) : '';
  const earliest = year ? String(year.starts_on) : '';
  const started = !!year && earliest <= latest;

  useEffect(() => {
    if (!year || !started) { setFrom(''); setTo(''); return; }
    // A fortnight is long enough to show a run forming and short enough to stay
    // inside the API's 31-date limit without arithmetic at the edges.
    setTo(latest);
    setFrom(clamp(shift(latest, -13), earliest, latest));
  }, [year?.id, earliest, latest, started]);

  const width = from && to ? span(from, to) : 0;
  const rangeProblem = windowProblem(from, to, earliest, latest);

  const ready = !!sectionId && !!from && !!to && !rangeProblem;

  useEffect(() => {
    if (!ready) { setResult(null); return; }
    setResult(null);
    setExtra([]);
    setFailed(false);
    void api<Result>(`/sections/${sectionId}/attendance/monitor${query({ from, to, view, limit: 100 })}`)
      .then(setResult)
      .catch(() => { setResult(null); setFailed(true); });
  }, [api, sectionId, from, to, view, ready, token]);

  const more = async () => {
    const cursor = result?.pagination.next_after_id;
    if (!cursor) return;
    try {
      const page = await api<Result>(`/sections/${sectionId}/attendance/monitor${query({ from, to, view, limit: 100, after_id: cursor })}`);
      setExtra(current => [...current, ...page.items]);
      setResult(current => (current ? { ...current, pagination: page.pagination } : current));
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
  };

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={6} /></div></>;
  if (!scope.years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState title="No school year yet" body="Attendance evidence belongs to a school year. Create one on the School years screen first." /></div>
      </>
    );
  }
  if (scope.sections?.length === 0) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card">
          <div className="card-head"><div className="toolbar"><ScopePickers scope={scope} /></div></div>
          <EmptyState title="No section to look at" body="You are not the current adviser of any section in this school year, and none has been created for it." />
        </div>
      </>
    );
  }

  const items = [...(result?.items ?? []), ...extra].sort(byLearnerName);
  const frozen = result?.days.find(day => day.month_status !== 'draft')?.month_status;

  return (
    <>
      <PageHeader route={route} actions={items.length ? <PrintButton label="Print this window" /> : null} />

      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <ScopePickers scope={scope} />
            <div className="field inline">
              <label className="label" htmlFor="mon-from">From</label>
              <input id="mon-from" type="date" className="date-input" value={from} min={earliest} max={latest} onChange={event => event.target.value && setFrom(event.target.value)} />
            </div>
            <div className="field inline">
              <label className="label" htmlFor="mon-to">To</label>
              <input id="mon-to" type="date" className="date-input" value={to} min={earliest} max={latest} onChange={event => event.target.value && setTo(event.target.value)} />
            </div>
            <div className="field inline">
              <label className="label" htmlFor="mon-view">Show</label>
              <Select id="mon-view" value={view} onChange={event => setView(event.target.value as View)}>
                {views.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </Select>
            </div>
          </div>
          <div className="card-head-actions">
            {width ? <Badge tone="neutral">{width} {width === 1 ? 'date' : 'dates'}</Badge> : null}
            {frozen ? <Badge tone="info">Month {frozen}</Badge> : null}
            {result?.visibility === 'current_access_only' ? <Badge tone="info">Your current learners</Badge> : null}
          </div>
        </div>

        {!started ? (
          <div className="card-body"><Callout tone="attention" title="This school year has not started">There are no past dates in it yet, so there is nothing to look at. Choose another year.</Callout></div>
        ) : null}
        {rangeProblem ? <div className="card-body"><Callout tone="attention" title="Adjust the window">{rangeProblem}</Callout></div> : null}
        {failed ? <div className="card-body"><Callout tone="stopped" title="This window could not be read">The section or the dates are outside what you can open, or the request failed.</Callout></div> : null}

        <Table
          loading={result === null && !failed && started && !rangeProblem}
          rows={items}
          rowKey={row => row.enrollment_id}
          empty={<EmptyState
            title={view === 'all' ? 'Nobody in this window' : 'Nothing matched'}
            body={view === 'all'
              ? 'No learner has a valid enrolment in this section on any date in the window.'
              : 'No learner in this window matches that filter. Widen the window or show everyone.'}
          />}
          columns={[
            { header: 'Learner', cell: row => <Cell title={learnerName(row)} meta={`${row.summary.eligible_dates} ${row.summary.eligible_dates === 1 ? 'date' : 'dates'} enrolled`} /> },
            { header: 'Present', cell: row => row.summary.present_sessions, numeric: true },
            { header: 'Absent', cell: row => row.summary.absent_sessions, numeric: true },
            { header: 'Unmarked', cell: row => (row.summary.missing_sessions ? <Badge tone="attention">{row.summary.missing_sessions}</Badge> : row.summary.missing_sessions), numeric: true },
            { header: 'Absent dates', cell: row => row.summary.absent_classroom_dates, numeric: true },
            { header: 'Longest run', cell: row => row.summary.longest_absent_date_run, numeric: true },
            { header: 'Run at the end', cell: row => row.summary.trailing_absent_date_run, numeric: true },
            { header: 'Complete', cell: row => (row.summary.needs_completion ? <Badge tone="attention">Something missing</Badge> : <Badge tone="good">Nothing missing</Badge>) },
          ]}
          detailLabel="Dates"
          detail={row => (
            <>
              <p className="muted">
                Every date in the window, including the ones this learner was not enrolled for. A run of absent dates is broken by an
                attended date, an unmarked one, a date with no schedule and an alternative-delivery date; an explicit no-class date is
                skipped without breaking it.
              </p>
              <Table
                rows={row.dates}
                rowKey={date => date.day_on}
                empty={<p className="muted">No dates in the window.</p>}
                columns={[
                  { header: 'Date', cell: date => <Cell title={<span className="mono">{date.day_on}</span>} meta={weekday(date.day_on)} /> },
                  { header: 'Morning', cell: date => (date.eligible ? <MarkValue mark={date.am} /> : <Unrecorded label="Not enrolled" />) },
                  { header: 'Afternoon', cell: date => (date.eligible ? <MarkValue mark={date.pm} /> : <Unrecorded label="Not enrolled" />) },
                  { header: 'Reads as', cell: date => <Classification value={date.classification} /> },
                ]}
              />
            </>
          )}
        />

        {result ? (
          <div className="card-body">
            <p className="card-note">
              {items.length} {items.length === 1 ? 'learner' : 'learners'} ·
              {' '}<span className="mono">{result.from}</span> to <span className="mono">{result.to}</span> ·
              {' '}{result.days.filter(day => !day.configured).length} of {result.days.length} dates without a schedule
            </p>
            {result.pagination.next_after_id ? (
              <button type="button" className="btn ghost small" onClick={() => void more()}>Show more learners</button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Callout tone="info" title="Observations, not a threshold">
        These are raw classroom sessions somebody wrote down, counted only inside the window above. A run of absences may have started before it, because no date before <span className="mono">{from || 'the first date'}</span> is read. Nothing here is an official attendance credit, a rate, a dropout signal or a risk score, and nothing here raises an alert: the school has confirmed it has no approved absence rule, so acting on what this shows is a decision for the staff reading it. A case is opened by hand on the Follow-up cases screen.
      </Callout>
    </>
  );
}
