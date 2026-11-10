import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Api, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { ScopePickers, sectionName, useScope } from '../components/scope';
import {
  Badge, Callout, Cell, Editor, EmptyState, FormSheet, PageHeader, PrintButton, Select, StatusLine, Table, Task as Disclosure,
  Unrecorded, idle, learnerName, localToday, type Field, type Status, BlockSkeleton, TableSkeleton } from '../components/primitives';

type Props = { api: Api; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

type Offering = { id: string; display_order: number; active: boolean; subject_snapshot: { code: string; name: string } };
type Component = { code: string; name: string };
type Components = { offering_id: string; bound: boolean; components: Component[] };
export type Task = {
  id: string; reporting_period_id: string; component_code: string; sequence: number; title: string;
  max_score: number | string; status: 'open' | 'archived'; version: number;
};
export type SheetRow = {
  enrollment_id: string; last_name: string; first_name: string; middle_name: string | null; name_extension: string | null;
  raw_score: number | string | null; version: number;
};
type ScoreSheet = { task: Task; items: SheetRow[] };
export type Entry = { enrollment_id: string; raw_score: number | null; version: number; before: number | null; name: string };

const reasonField: Field = { key: 'reason', label: 'Reason', type: 'textarea', minLength: 10, maxLength: 500, wide: true, hint: '10–500 characters on one line, kept in the permanent history of this change.' };
const mark = /^\d+(?:\.\d{1,2})?$/;

/** A stored mark as a number, or null when nothing is recorded. Never zero for a blank. */
export const stored = (raw: number | string | null) => (raw === null || raw === '' ? null : Number(raw));

/** A mark as it reads on paper: no trailing zeroes added, and nothing rounded. */
export const shownMark = (raw: number | string | null) => {
  const value = stored(raw);
  return value === null ? '' : String(value);
};

/**
 * What is wrong with a typed mark, or null when it can be sent. An empty box
 * is not a problem: it means nothing is recorded, and against a recorded mark
 * it means clear it. The maximum is the task's own, and two decimal places is
 * the column's storage bound, not a rounding rule — a third place is refused,
 * never rounded away.
 */
export function markProblem(text: string, max: number) {
  const value = text.trim();
  if (!value) return null;
  if (!mark.test(value)) return 'Use a number such as 18 or 17.5, with at most two decimal places.';
  if (Number(value) > max) return `The maximum for this assessment is ${shownMark(max)}.`;
  return null;
}

/**
 * The entries a class sheet would send. Only learners whose box differs from
 * what is stored are included, so an untouched learner can never be cleared
 * or rewritten by a batch they were not part of; each carries the version it
 * was read at, and a blank against a recorded mark is an explicit null.
 */
export function pendingEntries(rows: SheetRow[], draft: Record<string, string>): Entry[] {
  const entries: Entry[] = [];
  for (const row of rows) {
    if (!(row.enrollment_id in draft)) continue;
    const text = draft[row.enrollment_id]!.trim();
    const before = stored(row.raw_score);
    const after = text ? Number(text) : null;
    if (after === before) continue;
    entries.push({ enrollment_id: row.enrollment_id, raw_score: after, version: row.version, before, name: learnerName(row) });
  }
  return entries;
}

/** The next free number for an assessment of this component in this period, so "Written work 3" follows 2. */
export const nextSequence = (tasks: Task[], component: string) =>
  Math.min(99, Math.max(0, ...tasks.filter(t => t.component_code === component).map(t => t.sequence)) + 1);

/** Surname, then given names, then id so that two learners of one name keep a stable order. */
export const byName = (a: SheetRow, b: SheetRow) =>
  a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name) || a.enrollment_id.localeCompare(b.enrollment_id);

/**
 * Enter moves to the next learner's box, as a marks list is typed down a
 * column from a paper record, and never submits anything: recording a batch
 * is always a separate, reviewed step.
 */
const nextOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const boxes = [...document.querySelectorAll<HTMLInputElement>('input.score-input')];
  const next = boxes[boxes.indexOf(event.currentTarget) + (event.shiftKey ? -1 : 1)];
  next?.focus();
  next?.select();
};

const taskName = (task: Task, components: Component[]) =>
  `${components.find(c => c.code === task.component_code)?.name ?? task.component_code} ${task.sequence}: ${task.title}`;

async function collect<T>(api: Api, path: string, params: Record<string, string | number | undefined>) {
  const items: T[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = await api<{ items: T[]; pagination: { next_after_id: string | null } } & Record<string, unknown>>(`${path}${query({ ...params, after_id: after })}`);
    items.push(...page.items);
    if (!page.pagination.next_after_id) return { items, page };
    after = page.pagination.next_after_id;
  }
  throw new Error('The list is longer than this screen can read.');
}

/** The mark the reviewer is about to replace, drawn the way the sheet draws it. */
function Mark({ value }: { value: number | null }) {
  return value === null ? <Unrecorded label="Not recorded" /> : <span className="mono">{shownMark(value)}</span>;
}

/**
 * The review before a batch is recorded: every learner whose mark changes,
 * what it was and what it becomes, and the reason that goes into the history.
 * A version conflict does not retry. It reloads the sheet, keeps what was
 * typed and sends the adviser back here, where the new "before" is visible —
 * so nobody overwrites a colleague's mark without having seen it.
 */
function RecordSheet({ api, task, entries, onClose, onDone, onConflict }: {
  api: Api; task: Task; entries: Entry[]; onClose: () => void; onDone: (text: string) => void; onConflict: () => void;
}) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = reason.replace(/\s+/g, ' ').trim();
    if (text.length < 10) { setStatus({ kind: 'error', text: 'Give a reason of at least 10 characters.' }); return; }
    setBusy(true);
    setStatus({ kind: 'busy', text: 'Recording…' });
    try {
      await api(`/assessment-tasks/${task.id}/scores`, 'POST', {
        entries: entries.map(({ enrollment_id, raw_score, version }) => ({ enrollment_id, raw_score, version })),
        reason: text,
      });
      onDone(`${entries.length} ${entries.length === 1 ? 'mark' : 'marks'} recorded.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setStatus({ kind: 'error', text: 'Someone recorded a mark for one of these learners after you opened the sheet. It has been reloaded with your typing kept; check the marks shown as before, then record again.' });
        onConflict();
      } else {
        setStatus({ kind: 'error', text: message(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Record ${entries.length} ${entries.length === 1 ? 'mark' : 'marks'}`} note={`${task.title}, out of ${shownMark(task.max_score)}`} wide onClose={onClose}>
      <StatusLine status={status} />
      <Table
        rows={entries}
        rowKey={e => e.enrollment_id}
        empty={<p className="muted">Nothing has changed.</p>}
        columns={[
          { header: 'Learner', cell: e => <Cell title={e.name} /> },
          { header: 'Recorded now', cell: e => <Mark value={e.before} /> },
          { header: 'Becomes', cell: e => (e.raw_score === null ? <Badge tone="attention">Cleared</Badge> : <Mark value={e.raw_score} />) },
        ]}
      />
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field wide">
            <label className="label" htmlFor={`${id}-reason`}>Reason</label>
            <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            <span className="hint">10–500 characters, kept with the marks for good. Say where they came from: the class record, a correction, a late paper.</span>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy || !entries.length} aria-busy={busy}>{busy ? 'Recording…' : 'Record these marks'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Keep editing</button>
        </div>
      </form>
    </Sheet>
  );
}

type ScoreEvent = { id: string; entries: { enrollment_id: string; before: number | string | null; after: number | string | null }[]; reason: string; recorded_at: string };
type TaskEvent = { id: string; task_version: number; action: 'create' | 'update'; before_snapshot: Task | null; after_snapshot: Task; reason: string; recorded_at: string };

/** What changed between two revisions of an assessment, in the words of its form. */
export function taskChanges(before: Task | null, after: Task) {
  if (!before) return [`Added, out of ${shownMark(after.max_score)}`];
  const changes: string[] = [];
  if (before.title !== after.title) changes.push(`Title “${before.title}” → “${after.title}”`);
  if (stored(before.max_score) !== stored(after.max_score)) changes.push(`Maximum ${shownMark(before.max_score)} → ${shownMark(after.max_score)}`);
  if (before.status !== after.status) changes.push(after.status === 'archived' ? 'Archived' : 'Reopened for marks');
  return changes.length ? changes : ['No field changed'];
}

/**
 * Manager-only. Every recorded batch of marks for one assessment, newest first,
 * with what each learner's mark was and became. Closed until asked for, because
 * reading it names learners and so writes a row into the privacy access log.
 * Names come from the sheet already on screen; a learner no longer on it is
 * named by that fact rather than by a bare identifier.
 */
function ScoreHistory({ api, taskId, rows }: { api: Api; taskId: string; rows: SheetRow[] }) {
  const [events, setEvents] = useState<ScoreEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); setEvents(null); setCursor(null); }, [taskId]);

  const load = async (before?: string) => {
    try {
      const page = await api<{ items: ScoreEvent[]; pagination: { next_before_id: string | null } }>(`/assessment-tasks/${taskId}/score-events${query({ limit: 10, before_id: before })}`);
      setEvents(current => [...(before ? current ?? [] : []), ...page.items]);
      setCursor(page.pagination.next_before_id);
    } catch { if (!before) setEvents([]); setCursor(null); }
  };
  useEffect(() => { if (open) void load(); }, [open, taskId]);

  const name = (id: string) => {
    const row = rows.find(r => r.enrollment_id === id);
    return row ? learnerName(row) : <Unrecorded label="No longer on this sheet" />;
  };

  return (
    <div className="card">
      <div className="card-head"><h2>Changes to these marks</h2></div>
      {!open ? (
        <div className="card-body">
          <p className="muted">Every recorded batch, newest first, with each mark as it was and as it became. Use it to check a save whose response you never saw before recording it again. Opening it is logged, because it names learners.</p>
          <button type="button" className="btn ghost small" onClick={() => setOpen(true)}><Icon name="activity" size={14} />Show changes to these marks</button>
        </div>
      ) : (
        <>
          <Table
            loading={events === null}
            rows={events ?? []}
            rowKey={e => e.id}
            empty={<EmptyState title="No marks recorded yet" body="Each batch recorded against this assessment appears here." />}
            columns={[
              { header: 'Recorded', cell: e => <span className="mono">{new Date(e.recorded_at).toLocaleString()}</span> },
              { header: 'Learners changed', numeric: true, cell: e => e.entries.length },
              { header: 'Reason', cell: e => e.reason },
            ]}
            detailLabel="Open"
            detail={e => (
              <Table
                rows={e.entries}
                rowKey={entry => entry.enrollment_id}
                empty={<p className="muted">This batch changed nothing.</p>}
                columns={[
                  { header: 'Learner', cell: entry => name(entry.enrollment_id) },
                  { header: 'Was', cell: entry => <Mark value={stored(entry.before)} /> },
                  { header: 'Became', cell: entry => (entry.after === null ? <Badge tone="attention">Cleared</Badge> : <Mark value={stored(entry.after)} />) },
                ]}
              />
            )}
          />
          {cursor ? <div className="card-body"><button type="button" className="btn ghost small" onClick={() => void load(cursor)}>Show older changes</button></div> : null}
        </>
      )}
    </div>
  );
}

/** Manager-only. Every revision of one assessment: added, retitled, a new maximum, archived. */
function TaskHistory({ api, taskId }: { api: Api; taskId: string }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const load = async (before?: number) => {
    try {
      const page = await api<{ items: TaskEvent[]; pagination: { next_before_version: number | null } }>(`/assessment-tasks/${taskId}/events${query({ limit: 5, before_version: before })}`);
      setEvents(current => [...(before ? current ?? [] : []), ...page.items]);
      setCursor(page.pagination.next_before_version);
    } catch { if (!before) setEvents([]); setCursor(null); }
  };
  useEffect(() => { void load(); }, [taskId]);
  if (events === null) return <BlockSkeleton lines={2} />;
  if (!events.length) return <Unrecorded label="No history returned" />;
  return (
    <>
      <ul className="history-list">
        {events.map(e => (
          <li key={e.id}>
            <span className="mono">{new Date(e.recorded_at).toLocaleString()}</span> · {taskChanges(e.before_snapshot, e.after_snapshot).join('; ')}
            <span className="muted"> — {e.reason}</span>
          </li>
        ))}
      </ul>
      {cursor !== null ? <button type="button" className="btn ghost small" onClick={() => void load(cursor)}>Show older</button> : null}
    </>
  );
}

/**
 * Raw marks for one assessment, for one section.
 *
 * Everything on this screen is a mark somebody gave. Nothing is added up,
 * averaged, weighted, converted to a percentage or transmuted, and there is no
 * column for any of those: the school has not supplied its grading enclosure,
 * and a total drawn here would be read as a grade. An unrecorded learner is
 * drawn as unrecorded, never as zero.
 *
 * Assessments exist only under a component of the policy the school adopted
 * and a manager bound to this subject, so until that has happened the screen
 * says what is missing and offers nothing to type into.
 */
export function Scores({ api, manager, setStatus, reload, token, route }: Props) {
  const scope = useScope(api, token);
  const [offerings, setOfferings] = useState<Offering[] | null>(null);
  const [offeringId, setOfferingId] = useState('');
  const [periods, setPeriods] = useState<Row[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [components, setComponents] = useState<Components | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [sheet, setSheet] = useState<ScoreSheet | null>(null);
  const [sheetFailed, setSheetFailed] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sheetToken, setSheetToken] = useState(0);
  const ids = useId();

  const { sectionId, yearId } = scope;
  useEffect(() => {
    if (!sectionId) { setOfferings(null); setOfferingId(''); return; }
    setOfferings(null);
    void collect<Offering>(api, `/sections/${sectionId}/subjects`, { active: 'true', limit: 100 })
      .then(r => {
        const sorted = r.items.sort((a, b) => a.display_order - b.display_order || a.subject_snapshot.code.localeCompare(b.subject_snapshot.code));
        setOfferings(sorted);
        setOfferingId(current => (sorted.some(o => o.id === current) ? current : sorted[0]?.id ?? ''));
      })
      .catch(() => { setOfferings([]); setOfferingId(''); });
  }, [api, sectionId, token]);

  useEffect(() => {
    if (!yearId) { setPeriods([]); setPeriodId(''); return; }
    void api<{ items: Row[] }>(`/academic-years/${yearId}/periods`).then(r => {
      setPeriods(r.items);
      // Open on the period the school is in, falling back to the first.
      const today = localToday();
      setPeriodId(current => (r.items.some(p => p.id === current) ? current
        : String((r.items.find(p => String(p.starts_on) <= today && today <= String(p.ends_on)) ?? r.items[0])?.id ?? '')));
    }).catch(() => { setPeriods([]); setPeriodId(''); });
  }, [api, yearId, token]);

  useEffect(() => {
    if (!offeringId) { setComponents(null); return; }
    setComponents(null);
    void api<Components>(`/section-subjects/${offeringId}/assessment-components`).then(setComponents)
      .catch(() => setComponents({ offering_id: offeringId, bound: false, components: [] }));
  }, [api, offeringId, token]);

  useEffect(() => {
    if (!offeringId || !periodId) { setTasks(null); return; }
    setTasks(null);
    void collect<Task>(api, `/section-subjects/${offeringId}/assessment-tasks`, { reporting_period_id: periodId, status: showArchived ? 'all' : 'open', limit: 100 })
      .then(r => {
        const sorted = r.items.sort((a, b) => a.component_code.localeCompare(b.component_code) || a.sequence - b.sequence);
        setTasks(sorted);
        setTaskId(current => (sorted.some(t => t.id === current) ? current : (sorted.find(t => t.status === 'open') ?? sorted[0])?.id ?? ''));
      })
      .catch(() => { setTasks([]); setTaskId(''); });
  }, [api, offeringId, periodId, showArchived, token]);

  // A different assessment is a different sheet, so typing never carries across.
  useEffect(() => { setDraft({}); }, [taskId]);

  useEffect(() => {
    if (!taskId) { setSheet(null); return; }
    // A refresh of the same assessment keeps the sheet on screen until the new
    // one lands, so an open review is not unmounted mid-conflict and its
    // explanation lost with it.
    setSheet(current => (current?.task.id === taskId ? current : null));
    setSheetFailed(false);
    void collect<SheetRow>(api, `/assessment-tasks/${taskId}/scores`, { limit: 100 })
      .then(r => setSheet({ task: r.page.task as Task, items: r.items }))
      .catch(() => { setSheet(null); setSheetFailed(true); });
  }, [api, taskId, token, sheetToken]);

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={4} /></div></>;

  const yearStatus = String(scope.year?.status ?? 'draft');
  const closed = yearStatus === 'closed';
  const offering = offerings?.find(o => o.id === offeringId);
  const bound = components?.bound ?? false;
  const componentList = components?.components ?? [];
  const task = sheet?.task;
  const max = task ? Number(task.max_score) : 0;
  const editable = !!task && task.status === 'open' && !closed;
  // A class list reads by surname, the way the paper record does.
  const rows = [...(sheet?.items ?? [])].sort(byName);
  const entries = pendingEntries(rows, draft);
  const problems = rows.filter(row => row.enrollment_id in draft && markProblem(draft[row.enrollment_id]!, max));
  const unrecorded = rows.filter(row => stored(row.raw_score) === null).length;
  const canAdd = bound && !!periodId && !closed && componentList.length > 0;

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {rows.length ? <PrintButton label="Print this sheet" /> : null}
          <button type="button" className="btn secondary" disabled={!canAdd} onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add an assessment</button>
          <button type="button" className="btn" disabled={!editable || !entries.length || problems.length > 0 || entries.length > 100} onClick={() => setRecording(true)}>
            {entries.length ? `Record ${entries.length} ${entries.length === 1 ? 'mark' : 'marks'}` : 'Record marks'}
          </button>
        </>}
      />

      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <ScopePickers scope={scope} />
            <div className="field inline">
              <label className="label" htmlFor={`${ids}-subject`}>Subject</label>
              <Select id={`${ids}-subject`} value={offeringId} onChange={e => setOfferingId(e.target.value)} disabled={!offerings?.length}>
                {(offerings ?? []).map(o => <option key={o.id} value={o.id}>{o.subject_snapshot.name}</option>)}
              </Select>
            </div>
            <div className="field inline">
              <label className="label" htmlFor={`${ids}-period`}>Reporting period</label>
              <Select id={`${ids}-period`} value={periodId} onChange={e => setPeriodId(e.target.value)} disabled={!periods.length}>
                {periods.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
              </Select>
            </div>
          </div>
          <div className="card-head-actions">
            {closed ? <Badge tone="neutral">Closed year — read only</Badge> : null}
          </div>
        </div>

        {scope.sections?.length === 0 ? (
          <EmptyState title="No section to show" body={manager ? 'This school year has no sections yet.' : 'You are not the current adviser of any section in this school year.'} />
        ) : offerings?.length === 0 ? (
          <EmptyState title={`No subjects offered to ${sectionName(scope.section)}`} body="Assessments belong to a subject a section takes. Subjects are offered on the Subjects and offerings screen." />
        ) : !periods.length ? (
          <EmptyState title="No reporting periods" body="Every assessment belongs to a reporting period of the school year. Add them on the Reporting periods screen." />
        ) : components && !bound ? (
          <div className="card-body">
            <Callout tone="attention" title={`No assessment policy is bound to ${offering?.subject_snapshot.name ?? 'this subject'}`}>
              {manager
                ? 'Assessments can only be named under a component of the policy the school adopted. Record the adoption and bind it to this subject on the Assessment policies screen, once the school has supplied its policy.'
                : 'Assessments can only be named under a component of the policy the school adopted. The principal or an administrative officer binds it to this subject once the school has supplied it.'}
            </Callout>
          </div>
        ) : (
          <>
            <div className="card-head">
              <div>
                <h2>Assessments</h2>
                <p className="card-note">Named under the components of the policy bound to this subject. Nothing here is weighted or totalled.</p>
              </div>
              <label className="check-line">
                <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                <span>Include archived</span>
              </label>
            </div>
            <Table
              stack
              loading={tasks === null}
              rows={tasks ?? []}
              rowKey={t => t.id}
              empty={<EmptyState title="No assessments in this period" body={canAdd ? 'Add the first one: its component, its number and the maximum a learner can score.' : 'None has been added for this subject and period.'} />}
              columns={[
                { header: 'Component', cell: t => <Cell title={componentList.find(c => c.code === t.component_code)?.name ?? t.component_code} meta={<code>{t.component_code}</code>} /> },
                { header: 'No.', numeric: true, cell: t => <span className="mono">{t.sequence}</span> },
                { header: 'Title', cell: t => (t.id === taskId ? <b>{t.title}</b> : t.title) },
                { header: 'Maximum', numeric: true, cell: t => <span className="mono">{shownMark(t.max_score)}</span> },
                { header: 'State', cell: t => (t.status === 'open' ? <Badge tone="good">Open</Badge> : <Badge tone="neutral">Archived</Badge>) },
              ]}
              detailLabel="Open"
              detail={t => (
                <>
                  {t.id !== taskId ? (
                    <p><button type="button" className="btn secondary small" onClick={() => setTaskId(t.id)}>Show this class sheet</button></p>
                  ) : <p className="muted">This is the class sheet shown below.</p>}
                  {manager ? <Disclosure title="History of this assessment" note="Newest first"><TaskHistory api={api} taskId={t.id} /></Disclosure> : null}
                  {!closed ? (
                    <Disclosure title="Correct this assessment" note="Title, maximum, or archive it">
                      <p className="muted">Its component and number are fixed once it exists. A maximum cannot go below a mark already recorded; correct that mark first.</p>
                      <Editor
                        fields={[
                          { key: 'title', label: 'Title', maxLength: 120 },
                          { key: 'max_score', label: 'Maximum score', type: 'number', min: 0.01, max: 10000 },
                          { key: 'status', label: 'State', options: [['open', 'Open for marks'], ['archived', 'Archived']] },
                          reasonField,
                        ]}
                        initial={{ ...t, max_score: shownMark(t.max_score) }}
                        setStatus={setStatus}
                        onSaved={reload}
                        onSubmit={data => api(`/assessment-tasks/${t.id}`, 'PATCH', { ...data, version: t.version })}
                      />
                    </Disclosure>
                  ) : null}
                </>
              )}
            />
          </>
        )}
      </div>

      {taskId && bound ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{task ? taskName(task, componentList) : 'Class sheet'}</h2>
              <p className="card-note">
                {task ? <>Out of <b className="mono">{shownMark(task.max_score)}</b>. </> : null}
                Raw marks as given. A blank box means nothing is recorded, not zero.
              </p>
            </div>
            <div className="card-head-actions">
              {task?.status === 'archived' ? <Badge tone="neutral">Archived — read only</Badge> : null}
            </div>
          </div>
          {sheetFailed ? <div className="card-body"><Callout tone="stopped" title="This sheet could not be read">The assessment is outside what you can open, or the request failed.</Callout></div> : null}
          {entries.length > 100 ? <div className="card-body"><Callout tone="stopped" title="Too many at once">The API records at most 100 marks in one batch. Record some of them first.</Callout></div> : null}
          <Table
            stack
            loading={sheet === null && !sheetFailed}
            rows={rows}
            rowKey={r => r.enrollment_id}
            empty={<EmptyState title="No learners in this section" body="A learner appears here once they are enrolled in this section." />}
            columns={[
              { header: 'Learner', cell: r => <Cell title={learnerName(r)} /> },
              {
                header: 'Raw score',
                cell: r => {
                  const recorded = stored(r.raw_score);
                  if (!editable) return <Mark value={recorded} />;
                  const text = draft[r.enrollment_id] ?? shownMark(r.raw_score);
                  const problem = r.enrollment_id in draft ? markProblem(text, max) : null;
                  const inputId = `${ids}-score-${r.enrollment_id}`;
                  return (
                    <span className={`score-cell${problem ? ' bad' : ''}`}>
                      <input
                        id={inputId}
                        className="score-input mono"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`Raw score, ${learnerName(r)}`}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? `${inputId}-error` : undefined}
                        value={text}
                        onChange={e => { const next = e.target.value; setDraft(d => ({ ...d, [r.enrollment_id]: next })); }}
                        onKeyDown={nextOnEnter}
                      />
                      {!text.trim() && recorded !== null ? <Unrecorded label="Will be cleared" /> : null}
                      <span className="mark-print">{recorded === null ? 'Not recorded' : shownMark(recorded)}</span>
                      {problem ? <span className="field-error" id={`${inputId}-error`}><Icon name="alert" size={14} />{problem}</span> : null}
                    </span>
                  );
                },
              },
              {
                header: 'State',
                cell: r => {
                  const changing = entries.find(e => e.enrollment_id === r.enrollment_id);
                  if (changing) return changing.raw_score === null ? <Badge tone="attention">To be cleared</Badge> : <Badge tone="info">Changed</Badge>;
                  return stored(r.raw_score) === null ? <Unrecorded label="Not recorded" /> : <Badge tone="neutral">Recorded</Badge>;
                },
              },
            ]}
          />
          {sheet ? (
            <div className="card-body">
              <p className="card-note">
                {rows.length} {rows.length === 1 ? 'learner' : 'learners'} · {unrecorded} with no mark recorded
                {entries.length ? <> · {entries.length} changed, not yet recorded <button type="button" className="btn ghost small" onClick={() => setDraft({})}>Undo my changes</button></> : null}
              </p>
              {!manager ? <p className="muted">This is your current class list. A learner who has since transferred out is not shown; a principal or administrative officer keeps their marks.</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {manager && taskId && bound && sheet ? <ScoreHistory api={api} taskId={taskId} rows={rows} /> : null}

      <Callout tone="info" title="No total, average or grade is computed">
        EDUNEXUS records the marks teachers give and nothing more. Totals, weighting, percentages, transmutation and grades wait on the school’s grading enclosure and sample class records, and no screen shows one before then.
      </Callout>

      {adding && offeringId ? (
        <FormSheet
          title="Add an assessment"
          note={`${offering?.subject_snapshot.name ?? ''}, ${String(periods.find(p => p.id === periodId)?.name ?? '')}`}
          submitLabel="Add assessment"
          initial={{ component_code: componentList[0]?.code ?? '', sequence: String(nextSequence(tasks ?? [], componentList[0]?.code ?? '')) }}
          fields={[
            { key: 'component_code', label: 'Component', options: componentList.map(c => [c.code, `${c.name} (${c.code})`] as [string, string]) },
            { key: 'sequence', label: 'Number', type: 'number', min: 1, max: 99, hint: 'Unique within this component and period, so "Written work 3" is unambiguous.' },
            { key: 'title', label: 'Title', maxLength: 120, hint: 'As the class knows it, for example "Quiz on fractions".' },
            { key: 'max_score', label: 'Maximum score', type: 'number', min: 0.01, max: 10000, hint: 'The most a learner can score. At most two decimal places.' },
            reasonField,
          ]}
          onSubmit={data => api(`/section-subjects/${offeringId}/assessment-tasks`, 'POST', { ...data, reporting_period_id: periodId })}
          onSaved={() => { setAdding(false); reload(); setStatus({ text: 'Assessment added.', kind: 'done' }); }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {recording && task ? (
        <RecordSheet
          api={api}
          task={task}
          entries={entries}
          onClose={() => setRecording(false)}
          onConflict={() => setSheetToken(t => t + 1)}
          onDone={text => { setRecording(false); setDraft({}); setStatus({ text, kind: 'done' }); setSheetToken(t => t + 1); }}
        />
      ) : null}
    </>
  );
}
