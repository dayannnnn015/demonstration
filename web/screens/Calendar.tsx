import { useEffect, useState, type FormEvent } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { clamp, firstOf, lastOf, monthName, monthOf, shift, span, step, weekday, type Month } from '../dates';
import { chunks, fillChanges, parseListed, type FillRules, type Listed, type SetChange } from '../calendar-fill';
import { depedCalendar } from '../deped';
import { Icon } from '../components/icons';
import { DayRuleCard } from './DayRule';
import { Sheet } from '../components/overlay';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, PrintButton, Select, StatusLine, Table, TableSkeleton,
  Unrecorded, gradeName, idle, localToday, sentence, yearName, type Status, Spinner } from '../components/primitives';
import { Affects } from '../components/affects';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended';
type Source = 'school' | 'section' | 'unconfigured';
type Day = { day_on: string; source: Source; configured: boolean; am: Mode | null; pm: Mode | null; day_type: string | null; label: string | null };
type Calendar = { calendar_version: number; from: string; to: string; days: Day[]; summary: Record<string, number> };
type Change = { day_on: string; action: 'set'; am: Mode; pm: Mode; day_type: string; label: string } | { day_on: string; action: 'clear' };
type Proposal = { version: number; section_id: string | null; changes: Change[]; reason: string };
type Plan = {
  changes: { day_on: string; action: string; before_effective: Day; after_effective: Day; changed: boolean }[];
  changed_count: number; issues: string[];
  conflicts: { day_on: string; code: string; section_ids: string[] }[];
  can_commit: boolean; review_hash: string | null;
};
type Correction = {
  id: string; section_id: string | null; calendar_version: number; reason: string; recorded_at: string;
  review_snapshot: { changed_count: number; changes: { day_on: string; action: string; after_effective: Day; changed: boolean }[] };
};

const modes: [Mode, string][] = [
  ['classroom', 'Classroom'],
  ['alternative_delivery', 'Alternative delivery'],
  ['no_class', 'No class'],
  ['suspended', 'Suspended'],
];

const dayTypes: [string, string][] = [
  ['regular', 'Regular school day'],
  ['makeup', 'Make-up day'],
  ['holiday', 'Holiday'],
  ['school_break', 'School break'],
  ['weekend', 'Weekend'],
  ['suspension', 'Suspension'],
  ['other', 'Other'],
];

/**
 * What each classification requires of its two sessions. These are the API's
 * own rules, restated so a manager meets them in the form rather than as a
 * refusal afterwards. They are a convenience over the rule, not the rule: the
 * database is still the thing that decides, and every session stays editable.
 */
const suggested: Record<string, [Mode, Mode]> = {
  regular: ['classroom', 'classroom'],
  makeup: ['classroom', 'classroom'],
  holiday: ['no_class', 'no_class'],
  school_break: ['no_class', 'no_class'],
  weekend: ['no_class', 'no_class'],
  suspension: ['suspended', 'suspended'],
  other: ['classroom', 'no_class'],
};

const rules: Record<string, string> = {
  regular: 'Needs a classroom or alternative-delivery session, and cannot be suspended.',
  makeup: 'Needs a classroom or alternative-delivery session, and cannot be suspended.',
  holiday: 'Both sessions must be no class.',
  school_break: 'Both sessions must be no class.',
  weekend: 'Both sessions must be no class.',
  suspension: 'Needs a suspended or alternative-delivery session.',
  other: 'Any combination, chosen explicitly.',
};

const conflictText: Record<string, string> = {
  RECORDED_MARKS: 'Marks are already recorded in a session this change would stop. Clear those marks through the section’s register first, then make the change; the marks stay until then.',
  SECTION_OVERRIDES_PRESENT: 'Sections hold their own schedule for this date. Clear those section exceptions first, change the school baseline, then set any exception still needed.',
  BASE_DAY_UNCONFIGURED: 'The school has no schedule for this date. Set the school baseline before adding a section exception.',
};

const modeName = (mode: Mode | null) => modes.find(([key]) => key === mode)?.[1] ?? '';
const modeTone = (mode: Mode | null) =>
  mode === 'classroom' ? 'good' : mode === 'alternative_delivery' ? 'info' : mode === 'suspended' ? 'attention' : 'neutral';
const sourceName = (source: Source) =>
  source === 'section' ? 'Section exception' : source === 'school' ? 'From the school calendar' : 'Nobody has set this date';

/** Which session a date holds, or the mark that says nobody has said yet. */
export function Session({ day, part }: { day: Day; part: 'am' | 'pm' }) {
  const mode = day[part];
  if (!day.configured || !mode) return <Unrecorded label="Not configured" />;
  return <Badge tone={modeTone(mode)}>{modeName(mode)}</Badge>;
}

/** Both sessions of one date, as the review panel reads them across a row. */
export function Pair({ day }: { day: Day }) {
  if (!day.configured) return <Unrecorded label="Not configured" />;
  return <>{modeName(day.am)} · {modeName(day.pm)}</>;
}

/**
 * The review panel. A calendar change is proposed, previewed, read, and then
 * confirmed with the hash the preview returned, so what is committed is what
 * somebody looked at. A conflict or a version change throws the hash away and
 * sends the manager back to the form; a fresh review is never auto-confirmed.
 */
function ReviewSheet({ api, yearId, version, scope, dates, mode, sections, onClose, onDone }: {
  api: Api;
  yearId: string;
  version: number;
  scope: string;
  dates: string[];
  mode: 'set' | 'clear';
  sections: Row[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [status, setStatus] = useState<Status>(idle);
  const [dayType, setDayType] = useState('regular');
  const [am, setAm] = useState<Mode>('classroom');
  const [pm, setPm] = useState<Mode>('classroom');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState<Proposal | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const sectionName = (id: string) => {
    const section = sections.find(s => s.id === id);
    return section ? `${gradeName(section.grade_level)} · ${String(section.name)}` : id;
  };

  const review = async (event: FormEvent) => {
    event.preventDefault();
    const changes: Change[] = mode === 'clear'
      ? dates.map(day_on => ({ day_on, action: 'clear' as const }))
      : dates.map(day_on => ({ day_on, action: 'set' as const, am, pm, day_type: dayType, label: label.trim() }));
    const body: Proposal = { version, section_id: scope || null, changes, reason: reason.trim() };
    setBusy(true);
    setStatus({ text: 'Reviewing…', kind: 'busy' });
    try {
      const result = await api<Plan>(`/academic-years/${yearId}/calendar/preview`, 'POST', body);
      setSent(body);
      setPlan(result);
      setStatus(result.can_commit ? idle : { text: 'This change is blocked. The conflicts are listed below.', kind: 'error' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!sent || !plan?.review_hash) return;
    setBusy(true);
    setStatus({ text: 'Recording…', kind: 'busy' });
    try {
      await api(`/academic-years/${yearId}/calendar/corrections`, 'POST', { ...sent, review_hash: plan.review_hash, reviewed: true });
      onDone(`${plan.changed_count} ${plan.changed_count === 1 ? 'date' : 'dates'} updated.`);
    } catch (error) {
      // The calendar moved under the review, so the hash is dead. It is never
      // resent against whatever is there now: go back and look again.
      if (error instanceof ApiError && error.isConflict) { setPlan(null); setSent(null); }
      setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  const count = `${dates.length} ${dates.length === 1 ? 'date' : 'dates'}`;
  const note = mode === 'clear'
    ? `${count}. Clearing keeps every change already recorded and leaves the date unknown again.`
    : `${count}. Nothing is written until you confirm what the review shows.`;

  return (
    <Sheet title={mode === 'clear' ? 'Clear these dates' : 'Set a schedule'} note={note} wide onClose={onClose}>
      <StatusLine status={status} />
      <Affects what="calendar" />

      {plan ? (
        <>
          {plan.conflicts.length ? (
            <Callout tone="stopped" title="Blocked">
              <ul>
                {plan.conflicts.map(conflict => (
                  <li key={`${conflict.day_on}-${conflict.code}`}>
                    <span className="mono">{conflict.day_on}</span> — {conflictText[conflict.code] ?? sentence(conflict.code)}
                    {conflict.section_ids.length ? ` Affected: ${conflict.section_ids.map(sectionName).join(', ')}.` : ''}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <p className="card-note">
            {plan.changed_count} of {plan.changes.length} dates change. A date already holding exactly what you proposed is left alone.
          </p>

          <Table
            rows={plan.changes}
            rowKey={row => row.day_on}
            columns={[
              { header: 'Date', cell: row => <Cell title={<span className="mono">{row.day_on}</span>} meta={weekday(row.day_on)} /> },
              { header: 'Now', cell: row => <Cell title={<Pair day={row.before_effective} />} meta={sourceName(row.before_effective.source)} /> },
              { header: 'After', cell: row => <Cell title={<Pair day={row.after_effective} />} meta={sourceName(row.after_effective.source)} /> },
              { header: 'Changes', cell: row => (row.changed ? <Badge tone="info">Yes</Badge> : <Badge tone="neutral">No change</Badge>) },
            ]}
          />

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
            {mode === 'set' ? (
              <>
                <div className="field">
                  <label className="label" htmlFor="cal-type">What kind of day</label>
                  <Select
                    id="cal-type"
                    value={dayType}
                    onChange={event => {
                      const next = event.target.value;
                      const [morning, afternoon] = suggested[next] ?? ['classroom', 'no_class'];
                      setDayType(next); setAm(morning); setPm(afternoon);
                    }}
                  >
                    {dayTypes.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </Select>
                  <span className="hint">{rules[dayType]}</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="cal-label">Label</label>
                  <input id="cal-label" required minLength={1} maxLength={120} value={label} onChange={event => setLabel(event.target.value)} />
                  <span className="hint">What this date is called on the school's own calendar.</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="cal-am">Morning session</label>
                  <Select id="cal-am" value={am} onChange={event => setAm(event.target.value as Mode)}>
                    {modes.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </Select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="cal-pm">Afternoon session</label>
                  <Select id="cal-pm" value={pm} onChange={event => setPm(event.target.value as Mode)}>
                    {modes.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </Select>
                  <span className="hint">A morning-only day is made by closing the afternoon, and the other way round.</span>
                </div>
              </>
            ) : null}
            <div className="field wide">
              <label className="label" htmlFor="cal-reason">Reason</label>
              <textarea id="cal-reason" required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              <span className="hint">10–500 characters, kept with the change for good. Say where the dates came from.</span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Reviewing…' : `Review ${count}`}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/**
 * Sets the school calendar for a whole stretch of dates in one review: weekdays
 * one way, weekends another, and the holidays and breaks typed from the
 * school's approved calendar. It writes through the same preview and
 * confirmation as a month at a time, in batches of up to 60 dates, each its own
 * recorded change with the reason given here. A batch the review blocks stops
 * the run, and the batches already confirmed stay as they are.
 */
function FillRange({ api, year, onClose, onDone }: { api: Api; year: Row; onClose: () => void; onDone: (text: string) => void }) {
  const [status, setStatus] = useState<Status>(idle);
  const [from, setFrom] = useState(clamp(localToday(), String(year.starts_on), String(year.ends_on)));
  const [to, setTo] = useState(String(year.ends_on));
  const [am, setAm] = useState<Mode>('classroom');
  const [pm, setPm] = useState<Mode>('classroom');
  const [classLabel, setClassLabel] = useState('Class day');
  const [weekendLabel, setWeekendLabel] = useState('Weekend');
  const [holidays, setHolidays] = useState('');
  const [breaks, setBreaks] = useState('');
  const [keep, setKeep] = useState(true);
  const [reason, setReason] = useState('');
  const [leaveOut, setLeaveOut] = useState<Listed[]>([]);
  const deped = depedCalendar(Number(year.start_year));
  const lines = (items: Listed[]) => items.map(i => (i.from === i.to ? `${i.from} ${i.label}` : `${i.from} to ${i.to} ${i.label}`)).join('\n');
  const useDeped = () => {
    if (!deped) return;
    setFrom(clamp(deped.starts_on, String(year.starts_on), String(year.ends_on)));
    setTo(clamp(deped.ends_on, String(year.starts_on), String(year.ends_on)));
    setAm('classroom'); setPm('classroom'); setClassLabel('Class day'); setWeekendLabel('Weekend');
    setHolidays(lines(deped.holidays)); setBreaks(lines(deped.breaks)); setLeaveOut(deped.asynchronous);
    setReason(`School calendar from ${deped.source}, checked against the school’s own calendar.`);
  };
  const [plan, setPlan] = useState<{ changes: SetChange[]; counts: Record<string, number>; listed: { day: string; label: string; kind: string }[] } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(0);

  const inYear = from >= String(year.starts_on) && to <= String(year.ends_on) && from <= to;

  const review = async (event: FormEvent) => {
    event.preventDefault();
    const h = parseListed(holidays), b = parseListed(breaks);
    const issues = [...h.problems.map(p => `Holidays, ${p}`), ...b.problems.map(p => `Breaks, ${p}`)];
    if (!inYear) issues.unshift(`Choose dates inside ${yearName(year)}, from ${String(year.starts_on)} to ${String(year.ends_on)}, with the first before the last.`);
    if (!classLabel.trim() || !weekendLabel.trim()) issues.push('Give both labels; each date carries one.');
    if (reason.trim().length < 10) issues.push('Give a reason of at least 10 characters. Say which approved calendar the dates come from.');
    setProblems(issues);
    if (issues.length) return;
    setBusy(true);
    setStatus({ text: 'Reading which dates are already set…', kind: 'busy' });
    try {
      const configured = new Set<string>();
      for (let i = 0; i < span(from, to); i += 62) {
        const last = clamp(shift(from, i + 61), from, to);
        const page = await api<Calendar>(`/academic-years/${String(year.id)}/calendar${query({ from: shift(from, i), to: last })}`);
        for (const day of page.days) if (day.source !== 'unconfigured') configured.add(day.day_on);
      }
      const rulesGiven: FillRules = { from, to, weekday: { am, pm, label: classLabel.trim() }, weekendLabel: weekendLabel.trim(), holidays: h.items, breaks: b.items, keepConfigured: keep, leaveOut };
      const result = fillChanges(rulesGiven, configured);
      const listed = result.changes.filter(c => c.day_type === 'holiday' || c.day_type === 'school_break').map(c => ({ day: c.day_on, label: c.label, kind: c.day_type }));
      setPlan({ ...result, listed });
      setStatus(idle);
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    const batches = chunks(plan.changes);
    let done = 0;
    try {
      for (const [index, batch] of batches.entries()) {
        setStatus({ text: `Recording batch ${index + 1} of ${batches.length}…`, kind: 'busy' });
        const head = await api<Calendar>(`/academic-years/${String(year.id)}/calendar${query({ from: batch[0]!.day_on, to: batch[0]!.day_on })}`);
        const proposal = { version: head.calendar_version, section_id: null, changes: batch, reason: reason.trim() };
        const result = await api<Plan>(`/academic-years/${String(year.id)}/calendar/preview`, 'POST', proposal);
        if (!result.can_commit || !result.review_hash) {
          const first = result.conflicts[0];
          throw new Error(`Batch ${index + 1} is blocked${first ? ` at ${first.day_on}: ${conflictText[first.code] ?? sentence(first.code)}` : '.'}${result.issues.length ? ` ${result.issues.join(' ')}` : ''}`);
        }
        await api(`/academic-years/${String(year.id)}/calendar/corrections`, 'POST', { ...proposal, review_hash: result.review_hash, reviewed: true });
        done += batch.length;
        setApplied(done);
      }
      onDone(`${done} dates set on the school calendar.`);
    } catch (error) {
      const text = error instanceof ApiError ? message(error) : error instanceof Error ? error.message : 'The request failed.';
      setStatus({ text: `${done ? `${done} dates were set before this stopped. ` : ''}${text}`, kind: 'error' });
    } finally { setBusy(false); }
  };

  const batchCount = plan ? chunks(plan.changes).length : 0;
  const sessionModes = modes.filter(([key]) => key !== 'suspended');

  return (
    <Sheet title="Fill a date range" note={`The whole-school calendar of ${yearName(year)}. Nothing is written until you confirm the review.`} wide onClose={() => { if (!busy) onClose(); }}>
      <StatusLine status={status} />
      <Affects what="calendar" />
      {problems.length ? (
        <div className="error-summary" role="alert">
          <h3><Icon name="alert" size={16} />{problems.length === 1 ? 'One thing needs attention' : `${problems.length} things need attention`}</h3>
          <ul>{problems.map(p => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {plan ? (
        <>
          <Callout tone="info" title={`${plan.changes.length} dates will be set`}>
            {plan.counts.classDays} class days, {plan.counts.weekends} weekend days, {plan.counts.holidays} holidays and {plan.counts.breaks} break days.
            {keep ? ` ${plan.counts.kept} dates already set are left as they are.` : ' Dates already set are replaced.'}
            {plan.counts.leftOut ? ` ${plan.counts.leftOut} dates are left unset for the school to decide.` : ''}
            {plan.changes.length ? ` They go in as ${batchCount} recorded ${batchCount === 1 ? 'change' : 'changes'}, each with your reason.` : ''}
          </Callout>
          {plan.listed.length ? (
            <Table
              rows={plan.listed}
              rowKey={row => row.day}
              columns={[
                { header: 'Date', cell: row => <Cell title={<span className="mono">{row.day}</span>} meta={weekday(row.day)} /> },
                { header: 'Kind of day', cell: row => (row.kind === 'holiday' ? 'Holiday' : 'School break') },
                { header: 'Label', cell: row => row.label },
              ]}
            />
          ) : <p className="muted">No holiday or break falls on a date being set.</p>}
          {applied ? <p className="card-note">{applied} of {plan.changes.length} dates recorded.</p> : null}
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || !plan.changes.length} aria-busy={busy} onClick={() => void apply()}>{busy ? 'Recording…' : plan.changes.length ? `Set ${plan.changes.length} dates` : 'Nothing to set'}</button>
            <button type="button" className="btn ghost small" disabled={busy || applied > 0} onClick={() => { setPlan(null); setStatus(idle); }}>Change something</button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={event => void review(event)}>
          {deped ? (
            <Callout tone="info" title={`DepEd’s calendar for ${yearName(year)}`}>
              {deped.source} sets this school year from {deped.starts_on} to {deped.ends_on}, with its holidays and the year-end break.{' '}
              <button type="button" className="btn small secondary" onClick={useDeped}>Fill the form from it</button>
              {leaveOut.length ? <> The learners’ wellness-break days ({leaveOut.map(l => `${l.from} to ${l.to}`).join(', ')}) count as class days in the order but are guided asynchronous learning, so they are left unset: set them yourself once the school says how they are marked. Add the school’s own holidays, such as a town fiesta, before reviewing.</> : null}
            </Callout>
          ) : null}
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="fill-from">First date</label>
              <input id="fill-from" type="date" value={from} min={String(year.starts_on)} max={String(year.ends_on)} onChange={event => setFrom(event.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="fill-to">Last date</label>
              <input id="fill-to" type="date" value={to} min={String(year.starts_on)} max={String(year.ends_on)} onChange={event => setTo(event.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="fill-am">Mondays to Fridays: morning</label>
              <Select id="fill-am" value={am} onChange={event => setAm(event.target.value as Mode)}>{sessionModes.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</Select>
            </div>
            <div className="field">
              <label className="label" htmlFor="fill-pm">Mondays to Fridays: afternoon</label>
              <Select id="fill-pm" value={pm} onChange={event => setPm(event.target.value as Mode)}>{sessionModes.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</Select>
              <span className="hint">{rules.regular}</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="fill-class">Label for a class day</label>
              <input id="fill-class" maxLength={120} value={classLabel} onChange={event => setClassLabel(event.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="fill-weekend">Saturdays and Sundays: label</label>
              <input id="fill-weekend" maxLength={120} value={weekendLabel} onChange={event => setWeekendLabel(event.target.value)} />
              <span className="hint">Recorded as a weekend, with no class in either session.</span>
            </div>
            <div className="field wide">
              <label className="label" htmlFor="fill-holidays">Holidays</label>
              <textarea id="fill-holidays" value={holidays} onChange={event => setHolidays(event.target.value)} placeholder={'2026-08-21 Ninoy Aquino Day\n2026-08-31 National Heroes Day'} />
              <span className="hint">One per line: a date, then its name, from the school's approved calendar. No class in either session.</span>
            </div>
            <div className="field wide">
              <label className="label" htmlFor="fill-breaks">School breaks</label>
              <textarea id="fill-breaks" value={breaks} onChange={event => setBreaks(event.target.value)} placeholder="2026-12-19 to 2027-01-03 Christmas break" />
              <span className="hint">One per line: a date or a range, then its name.</span>
            </div>
            <label className="check-line wide">
              <input type="checkbox" checked={keep} onChange={event => setKeep(event.target.checked)} />
              <span>Leave dates that are already set exactly as they are</span>
            </label>
            <div className="field wide">
              <label className="label" htmlFor="fill-reason">Reason</label>
              <textarea id="fill-reason" minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              <span className="hint">10–500 characters on one line, kept with every batch. Say which approved calendar the dates come from.</span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Reading…</> : 'Review the range'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/** Every calendar change in the year, across both scopes, newest first. */
function History({ api, yearId, sections }: { api: Api; yearId: string; sections: Row[] }) {
  const [rows, setRows] = useState<Correction[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api<Page<Correction>>(`/academic-years/${yearId}/calendar/corrections${query({ limit: 5 })}`)
      .then(page => { setRows(page.items); setCursor(page.pagination?.next_before_version ?? null); })
      .catch(() => { setRows([]); setCursor(null); });
  }, [api, yearId, open]);

  const older = async () => {
    if (cursor === null) return;
    try {
      const page = await api<Page<Correction>>(`/academic-years/${yearId}/calendar/corrections${query({ limit: 5, before_version: cursor })}`);
      setRows(current => [...(current ?? []), ...page.items]);
      setCursor(page.pagination?.next_before_version ?? null);
    } catch { setCursor(null); }
  };

  const scopeName = (id: string | null) => {
    if (!id) return 'Whole school';
    const section = sections.find(s => s.id === id);
    return section ? `${gradeName(section.grade_level)} · ${String(section.name)}` : 'One section';
  };

  if (!open) {
    return (
      <div className="card">
        <div className="card-head"><h2>Change history</h2></div>
        <div className="card-body">
          <p className="muted">Every calendar change in this year, both school and section, newest first. Use it to check a change whose response you never saw, before recording it a second time.</p>
          <button type="button" className="btn ghost small" onClick={() => setOpen(true)}><Icon name="activity" size={14} />Show change history</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head"><h2>Change history</h2></div>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={row => row.id}
        empty={<EmptyState title="No calendar changes yet" body="Nothing has been recorded against this school year's calendar." />}
        columns={[
          { header: 'Version', cell: row => <span className="mono">{row.calendar_version}</span> },
          { header: 'Scope', cell: row => scopeName(row.section_id) },
          { header: 'Dates changed', cell: row => row.review_snapshot.changed_count, numeric: true },
          { header: 'Recorded', cell: row => <span className="mono">{new Date(row.recorded_at).toLocaleString()}</span> },
        ]}
        detailLabel="Open"
        detail={row => (
          <>
            <p>{row.reason}</p>
            <hr className="rule" />
            <Table
              rows={row.review_snapshot.changes.filter(change => change.changed)}
              rowKey={change => change.day_on}
              empty={<p className="muted">This review changed nothing on any date.</p>}
              columns={[
                { header: 'Date', cell: change => <span className="mono">{change.day_on}</span> },
                { header: 'Became', cell: change => <Pair day={change.after_effective} /> },
                { header: 'Label', cell: change => change.after_effective.label ?? <Unrecorded label="Cleared" /> },
              ]}
            />
          </>
        )}
      />
      {cursor !== null ? (
        <div className="card-body"><button type="button" className="btn ghost small" onClick={() => void older()}>Show older changes</button></div>
      ) : null}
    </div>
  );
}

/**
 * A month at a time, because the form these dates feed is a month: the SF2 is
 * one sheet per section per month, and a manager configuring a calendar is
 * working from the same page of the school's own. It also keeps every read
 * inside the API's 62-date limit without arithmetic.
 */
export function Calendar({ api, me, manager, setStatus, reload, token, route }: Props) {
  const [years, setYears] = useState<Row[] | null>(null);
  const [yearId, setYearId] = useState('');
  const [sections, setSections] = useState<Row[]>([]);
  const [scope, setScope] = useState('');
  const [month, setMonth] = useState<Month | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<'set' | 'clear' | null>(null);
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    void api<Page>('/academic-years').then(page => {
      setYears(page.items);
      setYearId(current => (page.items.some(y => y.id === current) ? current : String((page.items.find(y => y.status === 'active') ?? page.items[0])?.id ?? '')));
    }).catch(() => setYears([]));
  }, [api, token]);

  useEffect(() => {
    if (!yearId) return;
    // A section belongs to one year, so changing the year always drops the scope.
    // An adviser opens on their own section, which is the schedule they mark
    // against, and is offered no other: the API refuses a section they do not
    // advise, so listing one would only offer a refusal.
    setScope('');
    void api<Page>(`/sections${query({ academic_year_id: yearId, limit: 100 })}`)
      .then(page => {
        const own = manager ? page.items : page.items.filter(s => s.adviser_user_id === me.user_id);
        setSections(own);
        if (!manager && own[0]) setScope(String(own[0].id));
      })
      .catch(() => setSections([]));
  }, [api, yearId, manager, me.user_id, token]);

  const year = years?.find(y => y.id === yearId);

  // Open on the month the school is actually in, and only fall back to the
  // start of the year when today sits outside it.
  useEffect(() => {
    if (!year) return;
    const starts = String(year.starts_on);
    const ends = String(year.ends_on);
    setMonth(monthOf(clamp(localToday(), starts, ends)));
    setPicked([]);
  }, [yearId, year?.starts_on, year?.ends_on]);

  const range = year && month
    ? {
        from: clamp(firstOf(month), String(year.starts_on), String(year.ends_on)),
        to: clamp(lastOf(month), String(year.starts_on), String(year.ends_on)),
      }
    : null;

  useEffect(() => {
    if (!yearId || !range) return;
    setCalendar(null);
    setPicked([]);
    void api<Calendar>(`/academic-years/${yearId}/calendar${query({ from: range.from, to: range.to, section_id: scope || undefined })}`)
      .then(setCalendar)
      .catch(() => setCalendar(null));
  }, [api, yearId, range?.from, range?.to, scope, token]);

  if (years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={5} /></div></>;
  if (!years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState title="No school year yet" body="A calendar belongs to a school year. Create one on the School years screen first." /></div>
      </>
    );
  }

  const closed = year?.status === 'closed';
  const editable = manager && !closed;
  const days = calendar?.days ?? [];
  // In school scope only a school date can be cleared; in section scope only
  // the section's own exception can, because clearing is what restores
  // inheritance and a date already inherited has nothing to restore.
  const clearable = (day: Day) => (scope ? day.source === 'section' : day.source === 'school');
  const chosen = days.filter(day => picked.includes(day.day_on));
  const canClear = chosen.length > 0 && chosen.every(clearable);
  const summary = calendar?.summary ?? {};

  const back = month ? step(month, -1) : null;
  const forward = month ? step(month, 1) : null;
  const canGoBack = !!(back && year && lastOf(back) >= String(year.starts_on));
  const canGoForward = !!(forward && year && firstOf(forward) <= String(year.ends_on));

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {days.length ? <PrintButton label="Print this month" /> : null}
          {editable ? (
            <>
              {!scope ? <button type="button" className="btn secondary" onClick={() => setFilling(true)} data-tour="calendar-fill">Fill a date range</button> : null}
              <button type="button" className="btn secondary" disabled={!canClear} onClick={() => setSheet('clear')}>Clear dates</button>
              <button type="button" className="btn" disabled={!picked.length} onClick={() => setSheet('set')}><Icon name="plus" size={15} />Set a schedule</button>
            </>
          ) : null}
        </>}
      />

      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <div className="field inline">
              <label className="label" htmlFor="cal-year">School year</label>
              <Select id="cal-year" value={yearId} onChange={event => setYearId(event.target.value)}>
                {years.map(y => <option key={String(y.id)} value={String(y.id)}>{yearName(y)} — {sentence(String(y.status))}</option>)}
              </Select>
            </div>
            <div className="field inline">
              <label className="label" htmlFor="cal-scope">Applies to</label>
              <Select id="cal-scope" value={scope} onChange={event => setScope(event.target.value)}>
                <option value="">Whole school</option>
                {sections.map(s => <option key={String(s.id)} value={String(s.id)}>{gradeName(s.grade_level)} · {String(s.name)}</option>)}
              </Select>
            </div>
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
            {closed ? <Badge tone="neutral">Closed year — read only</Badge> : null}
            {scope ? <Badge tone="info">Section view</Badge> : null}
          </div>
        </div>

        <Table
          loading={calendar === null}
          rows={days}
          rowKey={day => day.day_on}
          empty={<EmptyState title="No dates in this month" body="This month falls outside the school year. Use the arrows to move inside it." />}
          columns={[
            ...(editable ? [{
              header: 'Pick',
              className: 'pick',
              cell: (day: Day) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${day.day_on}`}
                  checked={picked.includes(day.day_on)}
                  onChange={event => setPicked(current => event.target.checked ? [...current, day.day_on] : current.filter(d => d !== day.day_on))}
                />
              ),
            }] : []),
            { header: 'Date', cell: day => <Cell title={<span className="mono">{day.day_on}</span>} meta={weekday(day.day_on)} /> },
            { header: 'Morning', cell: day => <Session day={day} part="am" /> },
            { header: 'Afternoon', cell: day => <Session day={day} part="pm" /> },
            { header: 'Kind of day', cell: day => (day.day_type ? sentence(day.day_type) : <Unrecorded label="Not configured" />) },
            { header: 'Label', cell: day => (day.label ?? <Unrecorded label="Not configured" />) },
            { header: 'Source', cell: day => (day.source === 'unconfigured' ? <Badge tone="neutral">Unknown</Badge> : day.source === 'section' ? <Badge tone="info">Section</Badge> : <Badge tone="neutral">School</Badge>) },
          ]}
        />

        {calendar ? (
          <div className="card-body">
            <p className="card-note">
              {summary.dates_requested} dates read · {summary.configured_days} configured · {summary.unconfigured_days} not configured ·
              {' '}{summary.classroom_sessions} classroom, {summary.alternative_delivery_sessions} alternative delivery,
              {' '}{summary.no_class_sessions} no class, {summary.suspended_sessions} suspended sessions.
            </p>
            <p className="muted">
              These are counts of scheduled sessions. They are not attendance, not school days credited to a learner, and no SF2 or SF4 total is computed from them.
            </p>
            {editable && picked.length ? <p className="card-note">{picked.length} selected. <button type="button" className="btn ghost small" onClick={() => setPicked([])}>Clear selection</button></p> : null}
          </div>
        ) : null}
      </div>

      {/* The other half of the same question. The calendar says which dates are
          days of classes; the rule says how a day's morning and afternoon
          become the SF2's one mark. It used to sit on School profile, which is
          the school's identity and the heading its forms carry, not how a mark
          becomes a day. The card gates its own actions to the principal. */}
      <DayRuleCard api={api} me={me} setStatus={setStatus} token={token} />

      {manager ? <History api={api} yearId={yearId} sections={sections} /> : (
        <Callout tone="info" title="Read only">
          The principal or an administrative officer sets the calendar. Tell them if a date for your section is wrong; attendance can only be recorded on a configured classroom date.
        </Callout>
      )}

      <Callout tone="info" title="Nothing here is assumed">
        No official dates, holidays, weekends or suspensions are supplied by EDUNEXUS. A date nobody has configured stays unknown: it is not a school day, not a holiday and not an absence, and attendance cannot be recorded against it. The school's approved calendar is the only source for these dates.
      </Callout>

      {filling && year ? (
        <FillRange api={api} year={year} onClose={() => setFilling(false)} onDone={text => { setFilling(false); setStatus({ text, kind: 'done' }); reload(); }} />
      ) : null}

      {sheet && range ? (
        <ReviewSheet
          api={api}
          yearId={yearId}
          version={calendar?.calendar_version ?? 0}
          scope={scope}
          dates={picked.slice().sort()}
          mode={sheet}
          sections={sections}
          onClose={() => setSheet(null)}
          onDone={text => { setSheet(null); setPicked([]); setStatus({ text, kind: 'done' }); reload(); }}
        />
      ) : null}
    </>
  );
}
