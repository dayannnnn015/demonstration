import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { clamp, dayAndMonth, firstOf, lastOf, monthName, monthOf, shift, weekday } from '../dates';
import { classListWorkbook, fileSlug, registerWorkbook, type ClassRow, type RegisterDay } from '../csv';
import { downloadXlsx } from '../xlsx';
import { sf2Workbook, typedPair } from '../forms/sf2';
import { levelName, type Sf2Form } from '../forms/types';
import { Icon } from '../components/icons';
import { Confirm, Sheet } from '../components/overlay';
import { ScopePickers, useScope } from '../components/scope';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, PrintButton, StatusLine, Table, TableSkeleton,
  Unrecorded, byLearnerName, gradeName, idle, learnerName, localToday, yearName, type Status,
} from '../components/primitives';
import { Affects } from '../components/affects';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended';
export type Mark = 'present' | 'absent' | null;
type Part = 'am' | 'pm';
type Schedule = { day_on: string; source: 'school' | 'section' | 'unconfigured'; configured: boolean; am: Mode | null; pm: Mode | null; day_type: string | null; label: string | null };
type Pair = { am: Mark; pm: Mark };
type Learner = Pair & {
  enrollment_id: string; enrollment_version: number; learner_id: string; recorded_learner_id: string;
  first_name: string; middle_name: string | null; last_name: string; name_extension: string | null;
};
type Context = {
  section: { id: string; grade_level: number; name: string };
  school_year: { id: string; starts_on: string; ends_on: string; status: 'draft' | 'active' | 'closed' };
  day_on: string; version: number; calendar_version: number;
  visibility: 'full_historical_roster' | 'current_access_only';
  month_status?: 'draft' | 'submitted' | 'locked'; month_version?: number;
  schedule: Schedule;
};
type SheetData = Context & { recording_available: boolean; items: Learner[]; pagination: { limit: number; next_after_id: string | null } };
type Change = { enrollment_id: string; am: Mark; pm: Mark };
type Proposal = { day_on: string; version: number; changes: Change[]; reason: string };
type Plan = Context & {
  changes: (Change & { first_name: string; last_name: string; before: Pair; after: Pair; changed: boolean })[];
  changed_count: number; review_hash: string;
};
type Event = {
  id: string; attendance_version: number; reason: string; recorded_at: string;
  review_snapshot: { day_on: string; changed_count: number; changes: { enrollment_id: string; first_name: string; last_name: string; before: Pair; after: Pair; changed: boolean }[] };
};

const marks: [Mark, string][] = [['present', 'Present'], ['absent', 'Absent'], [null, 'Not marked']];
const markName = (mark: Mark) => marks.find(([key]) => key === mark)?.[1] ?? 'Not marked';

/**
 * What a key typed on a learner marks: the SF2 grid's own letters, taken from
 * it rather than restated, so the register and the form a teacher corrects it
 * on cannot drift apart.
 *
 * The form's Delete and Backspace are deliberately left out. A blank cell on
 * the SF2 *is* a presence, so clearing one there means present; here "not
 * marked" is its own value, and a key that reads as "clear this" must never
 * record a presence nobody observed.
 */
const typedMarks: Record<string, Pair> = { x: typedPair.x!, p: typedPair.p!, m: typedPair.m!, a: typedPair.a! };
const typedKeys = Object.keys(typedMarks);

/**
 * The same learner's other session, or the next learner's, the way the SF2's
 * grid moves: a typed mark carries the register down the class list, which is
 * the order the paper one is read in. A row with no control in that column —
 * a session with no class — is skipped rather than landed on.
 */
function nextInColumn(from: HTMLElement): HTMLInputElement | null {
  const td = from.closest('td'), tr = td?.closest('tr');
  if (!td || !tr) return null;
  let row: Element | null = tr;
  while ((row = row.nextElementSibling)) {
    const radios = (row as HTMLTableRowElement).cells?.[td.cellIndex]?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    if (radios?.length) return [...radios].find(radio => radio.checked) ?? radios[0]!;
  }
  return null;
}

/** Why a session cannot take a classroom mark, in the school's own words. */
export const sessionBlock = (schedule: Schedule, part: Part): string | null => {
  const mode = schedule[part];
  if (!schedule.configured || !mode) return 'Not configured';
  if (mode === 'classroom') return null;
  return mode === 'no_class' ? 'No class' : mode === 'suspended' ? 'Suspended' : 'Alternative delivery';
};

/**
 * A recorded mark, or the mark that says nobody has said yet.
 *
 * An unmarked session is the case this whole module exists to preserve: it is
 * unknown, never zero and never "present". So it is drawn rather than blanked,
 * exactly as an unconfigured calendar date is.
 */
export function MarkValue({ mark }: { mark: Mark }) {
  if (mark === 'present') return <Badge tone="good">Present</Badge>;
  if (mark === 'absent') return <Badge tone="attention">Absent</Badge>;
  return <Unrecorded label="Not marked" />;
}

/** Before and after for one learner, as the review panel reads them across a row. */
export function PairValue({ value }: { value: Pair }) {
  return <>{markName(value.am)} · {markName(value.pm)}</>;
}

/**
 * The control an adviser uses thirty-odd times, twice a day.
 *
 * Three radios rather than a select: marking a class is the one task in this
 * system done at speed against a paper list, and a select costs two
 * interactions per session where a chip costs one. Clearing back to unknown is
 * one of the three, because a mark recorded by mistake has to be removable
 * without inventing a value in its place — the API clears a mark with an
 * explicit null, and this is where that null comes from.
 *
 * A letter typed on it sets the learner's whole day and moves to the next
 * learner, so a class of thirty can be taken from the keyboard at the speed
 * the paper list is read. The arrow keys are left to the radio group, which
 * already moves between the three chips: an adviser using a screen reader
 * loses nothing to the shortcut.
 */
function MarkChoice({ name, legend, value, onChange, onType }: {
  name: string; legend: string; value: Mark; onChange: (mark: Mark) => void; onType?: ((to: Pair) => void) | undefined;
}) {
  return (
    <>
      <fieldset
        className="marks"
        data-tour="att-mark"
        aria-keyshortcuts={onType ? typedKeys.join(' ') : undefined}
        onKeyDown={event => {
          if (!onType || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
          const typed = typedMarks[event.key.toLowerCase()];
          if (!typed) return;
          event.preventDefault();
          onType(typed);
          nextInColumn(event.currentTarget)?.focus();
        }}
      >
        <legend className="sr-only">{legend}</legend>
        {marks.map(([key, text]) => (
          <label key={key ?? 'none'} className="mark">
            <input
              type="radio"
              name={name}
              value={key ?? ''}
              checked={value === key}
              onChange={() => onChange(key)}
            />
            <span className={`mark-chip ${key ?? 'none'}`}>{text}</span>
          </label>
        ))}
      </fieldset>
      {/* The register is carried to a classroom on paper, and a printed radio
          is an empty circle. The chosen value prints as its own word. */}
      <span className="mark-print">{markName(value)}</span>
    </>
  );
}

/**
 * The learners whose marks have actually moved, as the API wants them.
 *
 * Both sessions travel together. A change *replaces* a learner's AM/PM pair
 * rather than patching one half of it, so the session nobody touched is sent
 * back unchanged — leaving it out would clear it. A learner marked and then
 * put back exactly as they were is not a change at all, and is dropped here
 * rather than being sent for the API to refuse as a no-op.
 */
/**
 * A draft carried over a fresh read of the sheet. A session the adviser
 * changed keeps their mark; a session they left as it was takes what is on
 * file now, so a mark someone else recorded meanwhile is never sent back
 * over with the old value.
 */
export function rebase(draft: Record<string, Pair>, before: (Pair & { enrollment_id: string })[], after: (Pair & { enrollment_id: string })[]): Record<string, Pair> {
  const was = new Map(before.map(row => [row.enrollment_id, row]));
  const out: Record<string, Pair> = {};
  for (const row of after) {
    const mine = draft[row.enrollment_id];
    if (!mine) continue;
    const old = was.get(row.enrollment_id) ?? row;
    out[row.enrollment_id] = { am: mine.am !== old.am ? mine.am : row.am, pm: mine.pm !== old.pm ? mine.pm : row.pm };
  }
  return out;
}

export function pending(items: (Pair & { enrollment_id: string })[], draft: Record<string, Pair>): Change[] {
  const out: Change[] = [];
  for (const row of items) {
    const next = draft[row.enrollment_id];
    if (!next || (next.am === row.am && next.pm === row.pm)) continue;
    out.push({ enrollment_id: row.enrollment_id, am: next.am, pm: next.pm });
  }
  return out;
}

/**
 * Preview, read, then confirm with the hash the preview returned, so what is
 * committed is what somebody looked at. A 409 throws the hash away and sends
 * the adviser back to the sheet: it is never replayed against whatever is
 * there now, because the version it was built on has moved.
 */
const stale = 'Someone recorded this date while you were marking. The register has been read again with their marks, and yours are kept: review again before recording.';

export function ReviewSheet({ api, sectionId, dayOn, version, changes, onClose, onDone, onStale }: {
  api: Api; sectionId: string; dayOn: string; version: number; changes: Change[];
  onClose: () => void; onDone: (text: string) => void; onStale: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>(idle);
  // Today's own register taken in class is the everyday case, so its reason is offered and can be changed; a past date is a correction and starts blank, because only the person correcting it knows why.
  const [reason, setReason] = useState(dayOn === localToday() ? `Register taken in class on ${dayAndMonth(dayOn)}.` : '');
  const [sent, setSent] = useState<Proposal | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const review = async (event?: FormEvent) => {
    event?.preventDefault();
    // The API's reason is a single line; a textarea can hold newlines, and a
    // pasted one would be refused for a formatting rule nobody was shown.
    const body: Proposal = { day_on: dayOn, version, changes, reason: reason.trim().replace(/\s+/g, ' ') };
    setBusy(true);
    setStatus({ text: 'Reviewing…', kind: 'busy' });
    try {
      const result = await api<Plan>(`/sections/${sectionId}/attendance/preview`, 'POST', body);
      setSent(body);
      setPlan(result);
      setStatus(idle);
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        await onStale().catch(() => undefined);
        setStatus({ text: stale, kind: 'error' });
      } else setStatus({ text: message(error), kind: 'error' });
    }
    finally { setBusy(false); }
  };

  // Today's register taken in class already has its reason, so the sheet opens on the review itself: pressing
  // Review on the register and again in here was the redundant step the group noted (28 October). A correction
  // to another date still starts at its reason, because only the person making it knows why.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (reason.trim().length >= 10) void review();
  }, []);

  const confirm = async () => {
    if (!sent || !plan) return;
    setBusy(true);
    setStatus({ text: 'Recording…', kind: 'busy' });
    try {
      await api(`/sections/${sectionId}/attendance/corrections`, 'POST', { ...sent, review_hash: plan.review_hash, reviewed: true });
      onDone(`${plan.changed_count} ${plan.changed_count === 1 ? 'learner' : 'learners'} updated.`);
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        // Someone else recorded this date first, often the adviser's own phone. The sheet is read again,
        // the adviser's marks are kept over what is on file now, and they review the result.
        setPlan(null); setSent(null);
        await onStale().catch(() => undefined);
        setStatus({ text: stale, kind: 'error' });
        return;
      }
      setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  const count = `${changes.length} ${changes.length === 1 ? 'learner' : 'learners'}`;

  return (
    <Sheet
      title="Review these marks"
      note={`${count} on ${weekday(dayOn)}, ${dayAndMonth(dayOn)}. Nothing is recorded until you confirm what the review shows.`}
      wide
      onClose={onClose}
    >
      <StatusLine status={status} />
      <Affects what="register" />

      {plan ? (
        <>
          <p className="card-note">
            {plan.changed_count} of {plan.changes.length} {plan.changes.length === 1 ? 'learner changes' : 'learners change'}. A session already holding exactly what you marked is left alone.
          </p>

          <Table
            rows={[...plan.changes].sort(byLearnerName)}
            rowKey={row => row.enrollment_id}
            columns={[
              { header: 'Learner', cell: row => learnerName(row) },
              { header: 'Now', cell: row => <PairValue value={row.before} /> },
              { header: 'After', cell: row => <PairValue value={row.after} /> },
              { header: 'Changes', cell: row => (row.changed ? <Badge tone="info">Yes</Badge> : <Badge tone="neutral">No change</Badge>) },
            ]}
          />

          <div className="form-actions">
            <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
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
              <label className="label" htmlFor="att-reason">Reason</label>
              <textarea id="att-reason" required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              <span className="hint">10–500 characters, kept with the marks for good. Say where they came from: the class register, a correction, a late report.</span>
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

/** Manager-only. Every reviewed change to this section and date, newest first. */
function History({ api, sectionId, dayOn }: { api: Api; sectionId: string; dayOn: string }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); setRows(null); setCursor(null); }, [sectionId, dayOn]);

  useEffect(() => {
    if (!open) return;
    void api<Page<Event>>(`/sections/${sectionId}/attendance/corrections${query({ day_on: dayOn, limit: 5 })}`)
      .then(page => { setRows(page.items); setCursor(page.pagination?.next_before_version ?? null); })
      .catch(() => { setRows([]); setCursor(null); });
  }, [api, sectionId, dayOn, open]);

  const older = async () => {
    if (cursor === null) return;
    try {
      const page = await api<Page<Event>>(`/sections/${sectionId}/attendance/corrections${query({ day_on: dayOn, limit: 5, before_version: cursor })}`);
      setRows(current => [...(current ?? []), ...page.items]);
      setCursor(page.pagination?.next_before_version ?? null);
    } catch { setCursor(null); }
  };

  if (!open) {
    return (
      <div className="card">
        <div className="card-head"><h2>Change history</h2></div>
        <div className="card-body">
          <p className="muted">Every reviewed change to this date, newest first. Use it to check a save whose response you never saw, before recording it a second time.</p>
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
        empty={<EmptyState title="No changes yet" body="Nothing has been recorded against this section on this date." />}
        columns={[
          { header: 'Version', cell: row => <span className="mono">{row.attendance_version}</span> },
          { header: 'Learners changed', cell: row => row.review_snapshot.changed_count, numeric: true },
          { header: 'Recorded', cell: row => <span className="mono">{new Date(row.recorded_at).toLocaleString()}</span> },
        ]}
        detailLabel="Open"
        detail={row => (
          <>
            <p>{row.reason}</p>
            <hr className="rule" />
            <Table
              rows={row.review_snapshot.changes.filter(change => change.changed)}
              rowKey={change => change.enrollment_id}
              empty={<p className="muted">This review changed nothing.</p>}
              columns={[
                { header: 'Learner', cell: change => learnerName(change) },
                { header: 'Was', cell: change => <PairValue value={change.before} /> },
                { header: 'Became', cell: change => <PairValue value={change.after} /> },
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
 * One section, one date, both sessions.
 *
 * The register an adviser fills twice a day. Marks are held locally until they
 * are reviewed together, because the API records a batch atomically against one
 * shared sheet version: saving each chip as it is clicked would be thirty
 * writes, thirty version bumps and thirty chances for two staff members to
 * overwrite each other's half of the same class.
 */
export function Attendance({ api, me, manager, setStatus, reload, token, route, views, startOn }: Props & { views?: ReactNode; startOn?: string | undefined }) {
  const group = useId();
  const scope = useScope(api, token);
  const [dayOn, setDayOn] = useState(startOn ?? localToday());
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [extra, setExtra] = useState<Learner[]>([]);
  const [draft, setDraft] = useState<Record<string, Pair>>({});
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const unsaved = useRef(0);
  // Closing the tab, reloading or pulling to refresh on a phone would drop every mark not yet recorded.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsaved.current) { event.preventDefault(); event.returnValue = ''; } };
    globalThis.addEventListener?.('beforeunload', warn);
    return () => globalThis.removeEventListener?.('beforeunload', warn);
  }, []);
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openedBack, setOpenedBack] = useState('');
  const [exporting, setExporting] = useState(false);
  const settled = useRef(false);

  const { year, sectionId } = scope;

  // On a weekend or a holiday the register would open on a date nobody can
  // mark. Once per visit, and only while the date is still today, step back to
  // the most recent classroom date in the last two weeks and say so. The
  // calendar is read only when today's own sheet already says it holds no
  // class, because each calendar read is a line in the privacy access log.
  useEffect(() => {
    if (settled.current || !year || !sectionId || !sheet) return;
    settled.current = true;
    const today = localToday();
    if (dayOn !== today || sheet.schedule.am === 'classroom' || sheet.schedule.pm === 'classroom') return;
    const from = clamp(shift(today, -13), String(year.starts_on), today);
    void api<{ days: { day_on: string; am: string | null; pm: string | null }[] }>(`/academic-years/${year.id}/calendar${query({ from, to: today, section_id: sectionId })}`)
      .then(calendar => {
        const classroom = (d: { am: string | null; pm: string | null }) => d.am === 'classroom' || d.pm === 'classroom';
        const todays = calendar.days.find(d => d.day_on === today);
        if (!todays || classroom(todays)) return;
        const last = [...calendar.days].reverse().find(classroom);
        if (!last) return;
        setDayOn(current => (current === today ? last.day_on : current));
        setOpenedBack(today);
      })
      .catch(() => undefined);
  }, [api, year?.id, sectionId, sheet]);

  // Open on a date inside the chosen year, so the first read is never outside it.
  useEffect(() => {
    if (!year) return;
    setDayOn(current => clamp(current, String(year.starts_on), String(year.ends_on)));
  }, [year?.id, year?.starts_on, year?.ends_on]);

  useEffect(() => {
    if (!sectionId || !dayOn) { setSheet(null); return; }
    setSheet(null);
    setExtra([]);
    setDraft({});
    setFailed(false);
    void api<SheetData>(`/sections/${sectionId}/attendance${query({ day_on: dayOn, limit: 100 })}`)
      .then(setSheet)
      .catch(() => { setSheet(null); setFailed(true); });
  }, [api, sectionId, dayOn, token]);

  // While the database holds seeded records, a saved file says so in its name: a spreadsheet carries no banner.
  const fileName = (what: string) => `${me.seeded_data ? 'SEEDED-' : ''}edunexus-${what}.xlsx`;
  const sectionTitle = () => (scope.section ? `${gradeName(scope.section.grade_level)} ${String(scope.section.name)}` : 'section');
  const sectionSlug = () => fileSlug(sectionTitle());

  /** Every enrollment in the section, as the Enrollment screen lists them: one access row per page, naming them. */
  const downloadClassList = async () => {
    if (!sectionId) return;
    setExporting(true);
    setStatus({ text: 'Collecting the class list…', kind: 'busy' });
    try {
      const rows: ClassRow[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await api<Page<ClassRow>>(`/enrollments${query({ section_id: sectionId, limit: 100, offset })}`);
        rows.push(...page.items);
        if (!page.pagination?.has_more) break;
      }
      await downloadXlsx(fileName(`class-list-${sectionSlug()}`), classListWorkbook(rows, `Class list: ${sectionTitle()}`));
      setStatus({ text: `Downloaded the class list: ${rows.length} ${rows.length === 1 ? 'learner' : 'learners'}.`, kind: 'done' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setExporting(false); }
  };

  /**
   * The month of the date on screen, a sheet per class date up to today, read
   * the way the register itself reads them. Dates with no classroom session are
   * left out rather than drawn as empty columns.
   */
  const downloadMonth = async () => {
    if (!sectionId || !year) return;
    setExporting(true);
    const month = monthOf(dayOn);
    const from = clamp(firstOf(month), String(year.starts_on), String(year.ends_on));
    const to = clamp(lastOf(month), String(year.starts_on), clamp(localToday(), String(year.starts_on), String(year.ends_on)));
    try {
      if (to < from) throw new Error(`${monthName(month)} has not started yet.`);
      setStatus({ text: `Reading the calendar for ${monthName(month)}…`, kind: 'busy' });
      const calendar = await api<{ days: { day_on: string; am: Mode | null; pm: Mode | null }[] }>(`/academic-years/${year.id}/calendar${query({ from, to, section_id: sectionId })}`);
      const classDays = calendar.days.filter(d => d.am === 'classroom' || d.pm === 'classroom');
      const days: RegisterDay[] = [];
      for (const [index, day] of classDays.entries()) {
        setStatus({ text: `Reading ${day.day_on} (${index + 1} of ${classDays.length})…`, kind: 'busy' });
        const items: RegisterDay['items'] = [];
        let after: string | undefined;
        for (;;) {
          const page = await api<SheetData>(`/sections/${sectionId}/attendance${query({ day_on: day.day_on, limit: 100, after_id: after })}`);
          items.push(...page.items);
          if (!page.pagination.next_after_id) break;
          after = page.pagination.next_after_id;
        }
        days.push({ day_on: day.day_on, schedule: { am: day.am, pm: day.pm }, items });
      }
      await downloadXlsx(fileName(`register-${sectionSlug()}-${firstOf(month).slice(0, 7)}`), registerWorkbook(days, `Register: ${sectionTitle()}, ${monthName(month)}`));
      setStatus({ text: `Downloaded ${monthName(month)}: ${days.length} class ${days.length === 1 ? 'date' : 'dates'}.`, kind: 'done' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setExporting(false); }
  };

  /** The month's SF2 in the school template's layout, the same file the School Form 2 screen saves. */
  const downloadSf2 = async () => {
    if (!sectionId) return;
    setExporting(true);
    const month = monthOf(dayOn);
    try {
      setStatus({ text: `Preparing the SF2 for ${monthName(month)}…`, kind: 'busy' });
      const form = await api<Sf2Form>(`/sections/${sectionId}/forms/sf2${query({ month_on: firstOf(month) })}`);
      await downloadXlsx(`${me.seeded_data ? 'SEEDED-' : ''}SF2 ${levelName(form.section.grade_level)} ${form.section.name} ${form.month_on.slice(0, 7)}.xlsx`,
        sf2Workbook(form, `Printed ${localToday()} from EDUNEXUS. Not issued: issue it on School Form 2 to record it.`));
      setStatus({ text: form.completeness.complete ? `Saved the SF2 for ${monthName(month)}.` : `Saved the SF2 for ${monthName(month)}. Some figures are still empty: ${form.completeness.rule_recorded ? 'not every day of the month is marked yet' : 'the school’s attendance rule is not recorded yet'}.`, kind: 'done' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setExporting(false); }
  };

  const more = async () => {
    const cursor = sheet?.pagination.next_after_id;
    if (!cursor) return;
    try {
      const page = await api<SheetData>(`/sections/${sectionId}/attendance${query({ day_on: dayOn, limit: 100, after_id: cursor })}`);
      setExtra(current => [...current, ...page.items]);
      setSheet(current => (current ? { ...current, pagination: page.pagination } : current));
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
  };

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={4} /></div></>;
  if (!scope.years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState title="No school year yet" body="Attendance belongs to a school year. Create one on the School years screen first." /></div>
      </>
    );
  }
  if (scope.sections?.length === 0) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card">
          <div className="card-head"><div className="toolbar"><ScopePickers scope={scope} /></div></div>
          <EmptyState
            title={manager ? 'No sections in this year' : 'No section assigned to you'}
            body={manager
              ? 'Create a section on School years & sections before recording attendance.'
              : 'You are not the current adviser of any section in this school year. A principal or administrative officer assigns advisers.'}
          />
        </div>
      </>
    );
  }

  const items = [...(sheet?.items ?? []), ...extra].sort(byLearnerName);
  const schedule = sheet?.schedule;
  const editable = sheet?.recording_available === true;
  const today = localToday();

  const pairOf = (row: Learner): Pair => draft[row.enrollment_id] ?? { am: row.am, pm: row.pm };
  const setPart = (row: Learner, part: Part, mark: Mark) =>
    setDraft(current => ({ ...current, [row.enrollment_id]: { ...(current[row.enrollment_id] ?? { am: row.am, pm: row.pm }), [part]: mark } }));

  const changes = pending(items, draft);
  unsaved.current = changes.length;
  /** Moving to another date or section with marks not yet recorded asks first; nothing is dropped silently. */
  const guard = (then: () => void) => (changes.length ? setLeaving(() => then) : then());
  const guardedScope = { ...scope, setYearId: (id: string) => guard(() => scope.setYearId(id)), setSectionId: (id: string) => guard(() => scope.setSectionId(id)) };
  /** Reads the sheet again without dropping the draft, rebased on what is on file now. */
  const refresh = async () => {
    if (!sectionId) return;
    const before = items;
    const next = await api<SheetData>(`/sections/${sectionId}/attendance${query({ day_on: dayOn, limit: 100 })}`);
    setDraft(current => rebase(current, before, next.items));
    setExtra([]);
    setSheet(next);
  };
  const sessionOpen = (part: Part) => !!schedule && !sessionBlock(schedule, part);
  const unmarkedIn = (part: Part) => items.filter(row => pairOf(row)[part] === null).length;
  // Only a learner nobody has marked is filled in, and only in a session that holds a class; the adviser
  // still marks each absence, and nothing is recorded until the review. A blank is never taken as present.
  const fillPresent = (parts: Part[]) => setDraft(current => {
    const next = { ...current };
    for (const row of items) {
      let pair = next[row.enrollment_id] ?? { am: row.am, pm: row.pm };
      for (const part of parts) if (sessionOpen(part) && pair[part] === null) pair = { ...pair, [part]: 'present' };
      next[row.enrollment_id] = pair;
    }
    return next;
  });
  /**
   * One key sets the learner's whole day, because that is how a register is
   * read aloud: a name, then whether they were there. A session with no class
   * keeps whatever it holds — the other half of the day is not evidence about
   * it — and like every other mark here, nothing is recorded until the review.
   */
  const typeDay = (row: Learner, to: Pair) => setDraft(current => {
    const now = current[row.enrollment_id] ?? { am: row.am, pm: row.pm };
    return { ...current, [row.enrollment_id]: { am: sessionOpen('am') ? to.am : now.am, pm: sessionOpen('pm') ? to.pm : now.pm } };
  });

  const overBatch = changes.length > 100;

  const closedBecause = (): string | null => {
    if (!sheet || editable) return null;
    if (sheet.school_year.status !== 'active') return `This school year is ${sheet.school_year.status}. Attendance is recorded only in an active year.`;
    if (sheet.day_on > today) return 'This date is in the future. It can be read to prepare, but marks are recorded on or before the day itself.';
    if (sheet.month_status && sheet.month_status !== 'draft') return `This month has been ${sheet.month_status}, which freezes its marks. A principal or administrative officer returns or reopens the month on the Monthly consolidation screen before it can be edited.`;
    if (!schedule?.configured) return 'Nobody has configured this date. It is not a school day, not a holiday and not an absence, and attendance cannot be recorded against it. Set it on the Instructional calendar screen first.';
    return 'Neither session on this date is a classroom session, so no classroom mark can be recorded against it.';
  };

  const blocked = closedBecause();
  const backOn = year && dayOn > String(year.starts_on) ? shift(dayOn, -1) : null;
  const nextOn = year && dayOn < String(year.ends_on) ? shift(dayOn, 1) : null;

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {items.length ? <PrintButton label="Print this register" /> : null}
          {sectionId ? <button type="button" className="btn secondary" disabled={exporting} onClick={() => void downloadClassList()} data-tour="att-files"><Icon name="download" size={15} />Class list</button> : null}
          {sectionId && year ? <button type="button" className="btn secondary" disabled={exporting} onClick={() => void downloadSf2()}><Icon name="download" size={15} />SF2 (Excel)</button> : null}
          {sectionId && year ? <button type="button" className="btn ghost" disabled={exporting} onClick={() => void downloadMonth()}><Icon name="download" size={15} />Raw marks (Excel)</button> : null}
          {editable ? (
            <button type="button" className="btn" disabled={!changes.length || overBatch} onClick={() => setReviewing(true)} data-tour="att-review">
              <Icon name="check" size={15} />Review {changes.length === 1 ? '1 mark' : `${changes.length || ''} marks`.trim()}
            </button>
          ) : null}
        </>}
      />
      {views}

      <div className="card register-card">
        {/* On paper the register says what it is: on screen the top bar and the pickers say it. */}
        <div className="print-only register-title">
          <h2>Daily attendance register</h2>
          <p>{sectionTitle()} · {weekday(dayOn)}, {dayAndMonth(dayOn)} {dayOn.slice(0, 4)}{year ? ` · School year ${yearName(year)}` : ''}</p>
        </div>
        <div className="card-head">
          <div className="toolbar" data-tour="att-pick">
            <ScopePickers scope={guardedScope} />
            <div className="field inline">
              <label className="label" htmlFor="att-day">Date</label>
              <span className="month-nav">
                <button type="button" className="btn ghost small" disabled={!backOn} aria-label="Previous day" onClick={() => backOn && guard(() => setDayOn(backOn))}><Icon name="back" size={14} /></button>
                <input
                  id="att-day"
                  type="date"
                  className="date-input"
                  value={dayOn}
                  min={year ? String(year.starts_on) : undefined}
                  max={year ? String(year.ends_on) : undefined}
                  onChange={event => { const picked = event.target.value; if (picked && year) guard(() => setDayOn(clamp(picked, String(year.starts_on), String(year.ends_on)))); }}
                />
                <button type="button" className="btn ghost small" disabled={!nextOn} aria-label="Next day" onClick={() => nextOn && guard(() => setDayOn(nextOn))}><Icon name="forward" size={14} /></button>
              </span>
            </div>
          </div>
          <div className="card-head-actions">
            <Badge tone="neutral">{weekday(dayOn)}</Badge>
            {sheet?.month_status && sheet.month_status !== 'draft' ? <Badge tone="attention">Month {sheet.month_status}</Badge> : null}
            {sheet?.visibility === 'current_access_only' ? <Badge tone="info">Your current learners</Badge> : null}
          </div>
        </div>

        {schedule ? (
          <div className="card-body">
            {openedBack && openedBack !== dayOn ? (
              <p className="card-note">Opened on the last classroom day, because today ({weekday(openedBack)}, <span className="mono">{openedBack}</span>) has no class.</p>
            ) : null}
            <p className="card-note register-schedule">
              Morning: <b>{sessionBlock(schedule, 'am') ?? 'Classroom'}</b> · Afternoon: <b>{sessionBlock(schedule, 'pm') ?? 'Classroom'}</b>
              {schedule.label ? <> · {schedule.label}</> : null}
            </p>
            {editable && items.length && (sessionOpen('am') || sessionOpen('pm')) ? (
              <div className="form-actions fill-present" data-tour="att-fill">
                <span className="muted">Mark every learner not yet marked present:</span>
                {sessionOpen('am') ? <button type="button" className="btn small secondary" disabled={!unmarkedIn('am')} onClick={() => fillPresent(['am'])}>Morning</button> : null}
                {sessionOpen('pm') ? <button type="button" className="btn small secondary" disabled={!unmarkedIn('pm')} onClick={() => fillPresent(['pm'])}>Afternoon</button> : null}
                {sessionOpen('am') && sessionOpen('pm') ? <button type="button" className="btn small secondary" disabled={!unmarkedIn('am') && !unmarkedIn('pm')} onClick={() => fillPresent(['am', 'pm'])}>Both sessions</button> : null}
              </div>
            ) : null}
            {editable && items.length && (sessionOpen('am') || sessionOpen('pm')) ? (
              <p className="card-note">
                Or take the register from the keyboard, the same letters the SF2 takes: <b>x</b> absent all day, <b>p</b> present all day, <b>m</b> absent in the morning only, <b>a</b> absent in the afternoon only. Each one marks the whole day and moves to the next learner. Nothing is recorded until you review.
              </p>
            ) : null}
          </div>
        ) : null}

        {blocked ? <div className="card-body"><Callout tone="attention" title="Marks cannot be recorded here">{blocked}</Callout></div> : null}
        {overBatch ? <div className="card-body"><Callout tone="stopped" title="Too many at once">{changes.length} learners are marked for review and the API records at most 100 in one batch. Review some of them first.</Callout></div> : null}
        {failed ? <div className="card-body"><Callout tone="stopped" title="This sheet could not be read">The section or date is outside what you can open, or the request failed. Check which school year the date belongs to.</Callout></div> : null}

        <Table
          stack
          loading={sheet === null && !failed}
          rows={items}
          rowKey={row => row.enrollment_id}
          empty={<EmptyState
            title="No learners on this date"
            body="Nobody was enrolled in this section on this date, so there is nothing to mark. A learner appears here from the effective date of their enrolment or transfer in."
          />}
          columns={[
            { header: 'Learner', cell: row => <Cell title={learnerName(row)} /> },
            {
              header: 'Morning',
              cell: row => {
                const stop = schedule ? sessionBlock(schedule, 'am') : 'Not configured';
                if (stop && row.am === null) return <Unrecorded label={stop} />;
                if (!editable || stop) return <MarkValue mark={pairOf(row).am} />;
                return <MarkChoice name={`${group}-am-${row.enrollment_id}`} legend={`Morning, ${learnerName(row)}`} value={pairOf(row).am} onChange={mark => setPart(row, 'am', mark)} onType={to => typeDay(row, to)} />;
              },
            },
            {
              header: 'Afternoon',
              cell: row => {
                const stop = schedule ? sessionBlock(schedule, 'pm') : 'Not configured';
                if (stop && row.pm === null) return <Unrecorded label={stop} />;
                if (!editable || stop) return <MarkValue mark={pairOf(row).pm} />;
                return <MarkChoice name={`${group}-pm-${row.enrollment_id}`} legend={`Afternoon, ${learnerName(row)}`} value={pairOf(row).pm} onChange={mark => setPart(row, 'pm', mark)} onType={to => typeDay(row, to)} />;
              },
            },
          ]}
        />

        {sheet ? (
          <div className="print-only register-foot">
            <p>{items.length} {items.length === 1 ? 'learner' : 'learners'} · printed {localToday()} from EDUNEXUS, with the marks recorded by then{changes.length ? `; ${changes.length} marked on screen and not yet recorded are left out` : ''}. A session nobody marked is shown as not marked: it is neither present nor absent.</p>
            <p className="register-sign"><span>Adviser’s signature</span><span>Date</span></p>
          </div>
        ) : null}
        {sheet ? (
          <div className="card-body no-print">
            <p className="card-note">
              {items.length} {items.length === 1 ? 'learner' : 'learners'} on this date · sheet version <span className="mono">{sheet.version}</span>
              {changes.length ? <> · {changes.length} marked, not yet recorded </> : null}
              {changes.length ? <button type="button" className="btn ghost small" onClick={() => setDraft({})}>Undo my marks</button> : null}
              {/* The header's review button is a long way up a phone screen after a class of thirty. */}
              {editable && changes.length && !overBatch ? <button type="button" className="btn small" onClick={() => setReviewing(true)}><Icon name="check" size={14} />Review {changes.length} {changes.length === 1 ? 'mark' : 'marks'}</button> : null}
            </p>
            {sheet.pagination.next_after_id ? (
              <button type="button" className="btn ghost small" onClick={() => void more()}>Show more learners</button>
            ) : null}
            {sheet.visibility === 'current_access_only' ? (
              <p className="muted">This is your current class list, not a historical report: a learner who has since transferred out is not shown here even if they were marked on this date. A principal or administrative officer sees the full dated roster.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {manager && sectionId ? <div className="no-print"><History api={api} sectionId={sectionId} dayOn={dayOn} /></div> : null}

      <div className="no-print"><Callout tone="info" title="An unmarked session stays unknown">
        A session nobody has marked is not an absence and not a presence: it is unrecorded, and it is drawn that way. Marking everyone present fills in only the learners nobody has marked yet, and nothing is recorded until you review. The SF2 counts each day from these marks by the rule the principal records on the instructional calendar; a month with an unmarked session stays empty there until it is marked.
      </Callout></div>

      {reviewing && sheet ? (
        <ReviewSheet
          api={api}
          sectionId={sectionId}
          dayOn={dayOn}
          version={sheet.version}
          changes={changes}
          onClose={() => setReviewing(false)}
          onDone={text => { setReviewing(false); setDraft({}); setStatus({ text, kind: 'done' }); reload(); }}
          onStale={refresh}
        />
      ) : null}
      {leaving ? (
        <Confirm title="Leave without recording?" tone="plain" confirmLabel="Leave without recording"
          body={`${changes.length} ${changes.length === 1 ? 'learner is' : 'learners are'} marked on this register but not recorded yet. Leaving discards ${changes.length === 1 ? 'that mark' : 'those marks'}; what is on file stays as it is.`}
          onClose={() => setLeaving(null)}
          onConfirm={() => { const then = leaving; setLeaving(null); setDraft({}); then(); }} />
      ) : null}
    </>
  );
}
