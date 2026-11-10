import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Api, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { Sheet } from '../components/overlay';
import { ScopePickers, sectionName, useScope } from '../components/scope';
import { forgetHashParams, hashParams } from './OutcomeQueue';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, Select, StatusLine, Table, TableSkeleton, Unrecorded, gradeName, idle, learnerName, type Status,
} from '../components/primitives';
import { coreValues, marks, valueCodes } from '../forms/values';
import { Confirm } from '../components/overlay';
import { PrintCopy } from '../components/print';
import { SeededNotice } from '../components/seeded';
import { Icon } from '../components/icons';
import { Sf9Sheet, sf9Page } from '../forms/sf9';
import { issuedLine } from '../forms/shared';
import type { Issuance, Sf9Form } from '../forms/types';
import { localToday } from '../components/primitives';
import { descriptiveGrading } from '../deped';
import { CardEditor, cardParts, termOpen, unstartedTerms } from './CardEditor';
import { Affects, type Reach } from '../components/affects';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };
type Period = { id: string; ordinal: number; name: string; starts_on: string; ends_on: string };
type Offering = { id: string; display_order: number; active: boolean; code: string; name: string };
type GradeRow = { offering_id: string; reporting_period_id: string | null; grade: number | null; remark: 'passed' | 'failed' | null; version: number };
type Note = { kind: string; reporting_period_id: string | null; month_on: string | null; body: string | null; version: number };
export type ReportLearner = {
  enrollment_id: string; status: string; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null; sex: 'male' | 'female'; lrn: string | null;
  grades: GradeRow[]; summary: { general_average: number | null; remark: 'passed' | 'failed' | null; version: number } | null;
  values: { reporting_period_id: string; ratings: Record<string, string>; version: number }[]; notes: Note[];
};
export type ReportRecords = {
  section: { id: string; grade_level: number; name: string; adviser_name: string | null };
  school_year: { id: string; start_year: number; starts_on: string; ends_on: string; status: string };
  periods: Period[]; offerings: Offering[]; learners: ReportLearner[];
};

/** A grade as the ECR shows it: up to 100, at most two decimal places. A blank means none is recorded. */
export function gradeProblem(text: string) {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return 'Type the grade as the ECR shows it, such as 88 or 88.5.';
  if (Number(value) > 100) return 'A grade is at most 100.';
  return null;
}

type Column = { key: string; label: string; kind: 'grade' | 'remark' | 'mark' | 'text' | 'choice'; title?: string | undefined; options?: [string, string][] };
type Stored = { values: Record<string, string>; version: number };

/**
 * A class's entries in one table: a box per learner per column, the stored
 * value beside what is typed, and a reviewed save that sends only learners
 * whose boxes changed, each with the version it was read at. The same shape
 * serves grades, the general average, observed values and comments.
 */
export function EntryTable({ learners, columns, stored, toEntry, save, what, readOnly, setStatus, onSaved, suggested = 'Transcribed from the class record (ECR).', extra = [], locked, onDirty }: {
  learners: ReportLearner[]; columns: Column[]; stored: (l: ReportLearner) => Stored;
  toEntry: (l: ReportLearner, values: Record<string, string>, version: number) => Record<string, unknown>;
  save: (entries: Record<string, unknown>[], reason: string) => Promise<unknown>;
  what: string; readOnly: boolean; setStatus: (s: Status) => void; onSaved: () => void;
  /** The reason the review starts with; the adviser can change it. */
  suggested?: string;
  /** Read-only columns shown after the learner, for what the entry is decided beside. */
  extra?: { header: string; cell: (l: ReportLearner) => ReactNode }[];
  /** A learner whose row cannot be edited, with why. */
  locked?: (l: ReportLearner) => string | null;
  /** How many learners hold boxes typed but not recorded, so the screen can ask before they are left. */
  onDirty?: ((count: number) => void) | undefined;
}) {
  // The parent keys this table by what it records (section, learning area, column, term), so a switch starts a
  // fresh one and a draft can never carry over into another learning area (testing finding F28). A reload of the
  // same records keeps the draft: after a conflict, what was typed stays and only what is on file is read again.
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [reviewing, setReviewing] = useState(false);
  const valueOf = (l: ReportLearner, key: string) => draft[l.enrollment_id]?.[key] ?? stored(l).values[key] ?? '';
  const set = (l: ReportLearner, key: string, value: string) => setDraft(d => ({ ...d, [l.enrollment_id]: { ...d[l.enrollment_id], [key]: value } }));
  const changed = learners.filter(l => columns.some(c => (draft[l.enrollment_id]?.[c.key] ?? null) !== null && draft[l.enrollment_id]![c.key]!.trim() !== (stored(l).values[c.key] ?? '')));
  const problems = changed.flatMap(l => columns.filter(c => c.kind === 'grade').map(c => gradeProblem(valueOf(l, c.key))).filter(Boolean));
  useEffect(() => { onDirty?.(changed.length); }, [changed.length]);
  useEffect(() => () => onDirty?.(0), []);
  const shown = (c: Column, v: string) => (!v ? <Unrecorded label="Not recorded" /> : c.kind === 'remark' ? (v === 'passed' ? 'Passed' : 'Failed') : c.kind === 'choice' ? (c.options?.find(o => o[0] === v)?.[1] ?? v) : c.kind === 'text' ? <span className="note-text">{v}</span> : <span className="mono">{v}</span>);

  return (
    <>
      <Table
        stack
        rows={learners}
        rowKey={l => l.enrollment_id}
        empty={<EmptyState title="No learners in this section" body="Learners appear here once they are enrolled in the section." />}
        columns={[
          { header: 'Learner', cell: l => <Cell title={learnerName(l)} meta={l.status === 'withdrawn' ? 'Withdrawn' : l.sex === 'male' ? 'Male' : 'Female'} /> },
          ...extra,
          ...columns.map(c => ({
            header: c.label,
            cell: (l: ReportLearner) => readOnly || locked?.(l) ? <span title={locked?.(l) ?? undefined}>{shown(c, stored(l).values[c.key] ?? '')}</span> : (
              // The form-control styles hang on .field; this one has no label of its own and no bottom margin.
              <div className={`field cell-field ${c.kind}`}>{
              c.kind === 'grade' ? <input className={`score-input${gradeProblem(valueOf(l, c.key)) ? ' invalid' : ''}`} inputMode="decimal" aria-label={`${c.label} for ${learnerName(l)}`} value={valueOf(l, c.key)} onChange={e => set(l, c.key, e.target.value)} />
              : c.kind === 'text' ? <textarea className="note-input" rows={2} maxLength={1000} aria-label={`${c.label} for ${learnerName(l)}`} value={valueOf(l, c.key)} onChange={e => set(l, c.key, e.target.value)} />
              : <Select aria-label={`${c.label} for ${learnerName(l)}`} value={valueOf(l, c.key)} onChange={e => set(l, c.key, e.target.value)} title={c.title}>
                  <option value="">{c.kind === 'mark' ? '·' : 'None'}</option>
                  {(c.kind === 'remark' ? [['passed', 'Passed'], ['failed', 'Failed']] : c.kind === 'choice' ? c.options ?? [] : marks.map(([code]) => [code, code])).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </Select>
              }</div>
            ),
          })),
        ]}
      />
      {readOnly ? null : (
        <div className="card-body">
          {problems.length ? <p className="field-error">{problems[0]}</p> : null}
          <div className="form-actions">
            <button type="button" className="btn" disabled={!changed.length || !!problems.length} onClick={() => setReviewing(true)} data-tour="rc-review">
              {changed.length ? `Review ${changed.length} ${changed.length === 1 ? 'learner' : 'learners'}` : 'Nothing changed yet'}
            </button>
            {changed.length ? <button type="button" className="btn ghost" onClick={() => setDraft({})}>Discard changes</button> : null}
          </div>
        </div>
      )}
      {reviewing ? (
        <ReviewSheet
          what={what} suggested={suggested} reach={reachOf(what)}
          rows={changed.map(l => ({ learner: l, before: stored(l).values, after: Object.fromEntries(columns.map(c => [c.key, valueOf(l, c.key).trim()])) }))}
          columns={columns} shown={shown}
          onClose={() => setReviewing(false)}
          submit={reason => save(changed.map(l => toEntry(l, Object.fromEntries(columns.map(c => [c.key, valueOf(l, c.key).trim()])), stored(l).version)), reason)}
          onDone={text => { setReviewing(false); setDraft({}); setStatus({ text, kind: 'done' }); onSaved(); }}
          onConflict={onSaved}
        />
      ) : null}
    </>
  );
}

/** What a recorded entry also changes: grades reach the SF10 and promotion, a comment only the card. */
const reachOf = (what: string): Reach => (what === 'Remarks' ? 'remarks' : what === 'Endorsements' ? 'outcome' : /grade|average/i.test(what) ? 'grades' : 'card');

function ReviewSheet({ what, suggested, reach, rows, columns, shown, onClose, submit, onDone, onConflict }: {
  what: string; suggested: string; reach: Reach; rows: { learner: ReportLearner; before: Record<string, string>; after: Record<string, string> }[]; columns: Column[];
  shown: (c: Column, v: string) => ReactNode; onClose: () => void; submit: (reason: string) => Promise<unknown>; onDone: (text: string) => void; onConflict: () => void;
}) {
  const [reason, setReason] = useState(suggested);
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const go = async (event: FormEvent) => {
    event.preventDefault();
    const text = reason.replace(/\s+/g, ' ').trim();
    if (text.length < 10) { setLocal({ kind: 'error', text: 'Give a reason of at least 10 characters.' }); return; }
    setBusy(true);
    setLocal({ kind: 'busy', text: 'Recording…' });
    try { await submit(text); onDone(`${what} recorded for ${rows.length} ${rows.length === 1 ? 'learner' : 'learners'}.`); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setLocal({ kind: 'error', text: 'Someone changed one of these records after you opened the page. It has been reloaded; check it and record again.' });
        onConflict();
      } else setLocal({ kind: 'error', text: message(error) });
    } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Record ${what.toLowerCase()} for ${rows.length} ${rows.length === 1 ? 'learner' : 'learners'}`} note="Check each change against the class record before recording it." wide onClose={onClose}>
      <StatusLine status={status} />
      <Affects what={reach} />
      <Table
        rows={rows}
        rowKey={r => r.learner.enrollment_id}
        columns={[
          { header: 'Learner', cell: r => <Cell title={learnerName(r.learner)} /> },
          ...columns.map(c => ({ header: c.label, cell: (r: typeof rows[number]) => (r.before[c.key] ?? '') === r.after[c.key] ? <span className="muted">Unchanged</span>
            : <span className="change">{shown(c, r.before[c.key] ?? '')} <span aria-hidden="true">→</span> {r.after[c.key] ? shown(c, r.after[c.key]!) : <Badge tone="attention">Cleared</Badge>}</span> })),
        ]}
      />
      <form onSubmit={go}>
        <div className="form-grid">
          <div className="field wide">
            <label className="label" htmlFor={`${id}-reason`}>Reason</label>
            <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            <span className="hint">10–500 characters, kept with these records for good. Say where they came from.</span>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Recording…' : 'Record these'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Keep editing</button>
        </div>
      </form>
    </Sheet>
  );
}

const numberOrNull = (text: string) => (text ? Number(text) : null);
const asText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
type Tab = 'card' | 'grades' | 'average' | 'values' | 'comments' | 'promotion' | 'summary';

/**
 * What the report cards print beyond attendance, entered by the adviser:
 * each learning area's grades per term and its final grade and remark, the
 * general average, the observed values and the term comments. Grades are the
 * ones the DepEd ECR already computed; EDUNEXUS records them and computes none.
 */
export function ReportCards({ api, me, manager, setStatus, token, route }: Props) {
  const scope = useScope(api, token);
  // Opened from the Overview's queue as `#/report-cards?section=…&approve=1`: that section, with its approval open.
  const asked = useRef(hashParams());
  useEffect(() => {
    const id = asked.current.get('section');
    if (id && scope.sections?.some(s => s.id === id) && scope.sectionId !== id) scope.setSectionId(id);
  }, [scope.sections]);
  const [records, setRecords] = useState<ReportRecords | null>(null);
  const [failed, setFailed] = useState('');
  const [chosenTab, setTab] = useState<Tab>('promotion');
  const [waiting, setWaiting] = useState<{ id: string; grade_level: number; name: string; adviser_name: string | null; waiting: number }[] | null>(null);
  const [column, setColumn] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [tick, setTick] = useState(0);
  const { sectionId, section } = scope;
  // Every table on the screen says how many learners it holds typed but not recorded. Moving to another tab,
  // section, learning area, column or term with any of them asks first, and so does closing the page: the
  // tables are keyed by what they record, so moving would otherwise drop them without a word (finding F28).
  const dirtyBy = useRef<Record<string, number>>({});
  const [dirty, setDirty] = useState(0);
  const dirtyFor = (key: string) => (count: number) => { dirtyBy.current[key] = count; setDirty(Object.values(dirtyBy.current).reduce((a, b) => a + b, 0)); };
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const guard = (then: () => void) => (dirty ? setLeaving(() => then) : then());
  const guardedScope = { ...scope, setYearId: (id: string) => guard(() => scope.setYearId(id)), setSectionId: (id: string) => guard(() => scope.setSectionId(id)) };
  const unsaved = useRef(0);
  unsaved.current = dirty;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsaved.current) { event.preventDefault(); event.returnValue = ''; } };
    globalThis.addEventListener?.('beforeunload', warn);
    return () => globalThis.removeEventListener?.('beforeunload', warn);
  }, []);

  useEffect(() => {
    if (!sectionId) return;
    setFailed('');
    void api<ReportRecords>(`/sections/${sectionId}/report-records`).then(r => {
      setRecords(r);
      // The subject average comes first: it is what the cards and the promotion turn on (the group leader's notes, 10 October).
      setColumn(current => (current === 'final' || r.periods.some(p => p.id === current) ? current : 'final'));
      setPeriodId(current => (r.periods.some(p => p.id === current) ? current : r.periods[0]?.id ?? ''));
    }).catch(error => { setRecords(null); setFailed(message(error)); });
  }, [api, sectionId, token, tick]);
  const reload = () => setTick(t => t + 1);
  useEffect(() => {
    if (!manager || !scope.year) { setWaiting(null); return; }
    type Entry = { sections: { id: string; grade_level: number; name: string; adviser_name: string | null; outcomes: { recorded: number; approved: number; returned: number } }[] };
    void api<Entry>(`/academic-years/${String(scope.year.id)}/grade-entry`)
      .then(e => setWaiting(e.sections.map(s => ({ id: s.id, grade_level: s.grade_level, name: s.name, adviser_name: s.adviser_name, waiting: s.outcomes.recorded - s.outcomes.approved - s.outcomes.returned })).filter(s => s.waiting > 0)))
      .catch(() => setWaiting(null));
  }, [api, manager, scope.year?.id, token, tick]);

  const learners = useMemo(() => records?.learners ?? [], [records]);
  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={5} /></div></>;
  if (!scope.years.length || scope.sections?.length === 0) {
    return <><PageHeader route={route} /><div className="card"><EmptyState title="No section yet" body={manager ? 'Report cards belong to a section of a school year.' : 'You can record report cards for a section you currently advise.'} /></div></>;
  }
  const readOnly = records?.school_year.status === 'closed';
  const kinder = records?.section.grade_level === 0;
  const grade = records?.section.grade_level ?? 0;
  const final = column === 'final';
  // A term that has not begun records nothing: the API refuses it with
  // PERIOD_NOT_STARTED, so the tables for it are shown read only rather than
  // taking an adviser's typing and losing it on save.
  const unstarted = records ? unstartedTerms(records.periods) : [];
  const shut = (period: string) => unstarted.some(p => p.id === period);
  const termShut = !!periodId && shut(periodId);
  const notStartedYet = (p: Period) => (termOpen(p) ? '' : ' — not started');
  const WaitingNote = ({ term }: { term: Period | undefined }) => (
    <div className="card-body">
      <Callout tone="info" title={`${term?.name ?? 'This term'} has not started yet`}>
        It begins on {term?.starts_on ?? 'its configured date'}. Grades for a term are encoded once it begins, on the schedule the school configured — finishing one term does not open the next. What is shown here is what is on file.
      </Callout>
    </div>
  );

  // DepEd Order No. 15, s. 2026 grades Grade 1 descriptively from 2026–2027, and the school's Grade 1 card prints narratives, not grades.
  const descriptive = records ? descriptiveGrading(grade, records.school_year.start_year) : false;
  // Promotion comes first: the screen is named for it, from the group leader's notes of 9 October.
  // The card itself, box by box, sits beside the class tables (the group leader's notes, 11 October).
  // No Subject averages tab since 0.111.0 (asked 2026-11-09, item 6): term grades, subject averages and remarks are
  // typed on the Report card tab, a learner's whole card at a time, or on the SF9 itself, and Class summary still lays
  // the class side by side. Its class grid by learning area is the one thing that went. To restore it, put
  // ['grades', 'Subject averages'] back here and its `tab === 'grades'` block, both in git history at 0.110.0.
  const allTabs: [Tab, string][] = [['promotion', 'Promotion'], ['card', 'Report card'], ['average', 'General average'], ['values', 'Observed values'], ['comments', grade === 1 ? 'Narratives' : 'Comments'], ['summary', 'Class summary']];
  // Only the tables whose records this grade's card prints: observed values are on the Grades 4–6 card,
  // narratives on Grade 1's and comments on Grades 2–3's (testing finding F27). A table for a box the card
  // does not have would record work no SF9 or SF10 ever shows.
  const parts = cardParts(grade, descriptive);
  const tabs = allTabs.filter(([key]) => (key === 'grades' || key === 'average' || key === 'summary' ? parts.grades : key === 'values' ? parts.values : key === 'comments' ? parts.notes.length > 0 : true));
  const tab = tabs.some(([key]) => key === chosenTab) ? chosenTab : 'promotion';

  return (
    <>
      <PageHeader route={route} actions={records && !kinder && records.learners.length ? <SectionCards api={api} me={me} gradeLevel={records.section.grade_level} learners={records.learners.map(l => ({ enrollment_id: l.enrollment_id, status: l.status, name: learnerName(l) }))} setStatus={setStatus} /> : undefined} />
      {manager && waiting?.length ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2 data-tour="rc-waiting">Endorsements waiting for approval</h2>
              <p className="card-note">Advisers have endorsed these learners’ outcomes. Open a section to approve each one or return it to the adviser.</p>
            </div>
          </div>
          <Table
            rows={waiting}
            rowKey={s => s.id}
            columns={[
              { header: 'Section', cell: s => <Cell title={`${gradeName(s.grade_level)} · ${s.name}`} meta={s.adviser_name ?? 'No adviser'} /> },
              { header: 'Waiting', cell: s => <b className="mono">{s.waiting}</b> },
              { header: 'Review', cell: s => <button type="button" className="btn small secondary" onClick={() => guard(() => { scope.setSectionId(s.id); setTab('promotion'); })}>Open {s.name}</button> },
            ]}
          />
        </div>
      ) : null}
      <div className="card">
        <div className="card-head">
          <div className="toolbar" data-tour="rc-pick"><ScopePickers scope={guardedScope} /></div>
          {records ? <div className="card-head-actions">{readOnly ? <Badge tone="neutral">Closed year · read only</Badge> : null}</div> : null}
        </div>
        <div className="card-body">
          {failed ? <Callout tone="stopped" title="These records could not be read">{failed}</Callout> : null}
          {descriptive ? (
            <Callout tone="info" title={`${gradeName(grade)} is graded descriptively this school year`}>
              Under DepEd Order No. 15, s. 2026, {gradeName(grade)} receives performance levels and narratives instead of numeric grades, and the school’s {gradeName(grade)} card prints each term’s narratives. Record them under <b>Narratives</b>. The performance levels A to E go on the card’s competency pages, which the school has not supplied yet.
            </Callout>
          ) : (
            <Callout tone="info" title={manager ? 'Grades are entered by the adviser' : 'Grades come from the ECR'}>
              {manager
                ? <>The adviser enters the grades and general averages from the ECR. Use <b>Report card</b> only to record a correction, then review the updated card before approving the learner’s endorsed outcome.</>
                : <>Type each grade, final grade, remark and general average exactly as the DepEd class record (ECR) computed it. EDUNEXUS keeps and prints them; it does not compute or round a grade.</>}
            </Callout>
          )}
        </div>
        {records && kinder ? (
          <>
            <div className="card-body"><Callout tone="info" title="No Kindergarten card yet">The school has not supplied its Kindergarten progress report, so there are no grades to record. Each learner’s end-of-year outcome is still recorded below, for Grade 1 next year.</Callout></div>
            <PromotionPanel api={api} me={me} manager={manager} records={records} setStatus={setStatus} descriptive onDecided={reload}
              openApprove={asked.current.get('approve') === '1' && asked.current.get('section') === sectionId} onApproveOpened={() => { asked.current = new URLSearchParams(); forgetHashParams(); }} />
          </>
        ) : null}
        {records && !kinder ? (
          <>
            <div className="card-head">
              <div className="segmented" role="tablist" aria-label="What to record" data-tour="rc-tabs">
                {tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : undefined} onClick={() => (key === tab ? undefined : guard(() => setTab(key)))}>{label}</button>)}
              </div>
            </div>
            {tab === 'average' ? (
              <EntryTable
                key={`average|${sectionId}`} onDirty={dirtyFor('average')}
                learners={learners}                 readOnly={readOnly || manager} setStatus={setStatus} onSaved={reload} what="General averages"
                columns={[{ key: 'general_average', label: 'General average', kind: 'grade' }, { key: 'remark', label: 'Remark', kind: 'remark' }]}
                stored={l => ({ values: { general_average: asText(l.summary?.general_average), remark: l.summary?.remark ?? '' }, version: l.summary?.version ?? 0 })}
                toEntry={(l, v, version) => ({ enrollment_id: l.enrollment_id, general_average: numberOrNull(v.general_average!), remark: v.remark || null, version })}
                save={(entries, reason) => api(`/sections/${sectionId}/report-summaries`, 'POST', { entries, reason })}
              />
            ) : null}
            {tab === 'values' || tab === 'comments' ? (
              <div className="card-head">
                <div className="toolbar">
                  <div className="field inline">
                    <span className="label">Term</span>
                    <Select aria-label="Term" value={periodId} onChange={e => { const next = e.target.value; guard(() => setPeriodId(next)); }}>
                      {records.periods.map(p => <option key={p.id} value={p.id}>{p.name}{notStartedYet(p)}</option>)}
                    </Select>
                  </div>
                </div>
              </div>
            ) : null}
            {(tab === 'values' || tab === 'comments') && termShut ? <WaitingNote term={records.periods.find(p => p.id === periodId)} /> : null}
            {tab === 'values' && periodId ? (
              <>
                <div className="card-body">
                  <p className="card-note">Printed on the Grades 4–6 card, the only card with observed values. Marks: {marks.map(([c, l]) => `${c} ${l}`).join(', ')}.</p>
                  <ol className="value-legend">{coreValues.flatMap(v => v.statements.map(s => <li key={s.code}><b>{s.code}</b> {v.value.replace(/^\d\.\s*/, '')}: {s.text}</li>))}</ol>
                </div>
                <EntryTable
                  key={`values|${sectionId}|${periodId}`} onDirty={dirtyFor('values')}
                  learners={learners} readOnly={readOnly || manager || termShut} setStatus={setStatus} onSaved={reload} what="Observed values"
                  columns={valueCodes.map(code => ({ key: code, label: code, kind: 'mark' as const, title: coreValues.flatMap(v => v.statements).find(s => s.code === code)?.text }))}
                  stored={l => { const row = l.values.find(v => v.reporting_period_id === periodId); return { values: row?.ratings ?? {}, version: row?.version ?? 0 }; }}
                  toEntry={(l, v, version) => ({ enrollment_id: l.enrollment_id, ratings: Object.fromEntries(valueCodes.map(code => [code, v[code] || null])), version })}
                  save={(entries, reason) => api(`/sections/${sectionId}/report-values`, 'POST', { reporting_period_id: periodId, entries, reason })}
                />
              </>
            ) : null}
            {tab === 'card' ? <CardEditor key={`card|${sectionId}`} onDirty={dirtyFor('card')} api={api} records={records} descriptive={descriptive} readOnly={readOnly} manager={manager} setStatus={setStatus} onSaved={reload} /> : null}
            {tab === 'summary' ? <ClassSummary me={me} records={records} /> : null}
            {tab === 'promotion' ? <PromotionPanel key={`promotion|${sectionId}`} onDirty={dirtyFor('promotion')} api={api} me={me} manager={manager} records={records} setStatus={setStatus} descriptive={descriptive} onDecided={reload}
              openApprove={asked.current.get('approve') === '1' && asked.current.get('section') === sectionId} onApproveOpened={() => { asked.current = new URLSearchParams(); forgetHashParams(); }} /> : null}
            {tab === 'comments' && periodId ? (
              grade === 1 ? (
                <>
                  {(['can_do', 'to_improve'] as const).map(kind => (
                    <div key={kind}>
                      <div className="card-body"><h3>{kind === 'can_do' ? 'What your child can do (Mga Nagagawa)' : 'What your child is learning to improve (Dapat Linangin)'}</h3></div>
                      <NoteTable key={`${kind}|${sectionId}|${periodId}`} onDirty={dirtyFor(kind)} kind={kind} periodId={periodId} learners={learners} readOnly={readOnly || manager || termShut} api={api} sectionId={sectionId} setStatus={setStatus} onSaved={reload} />
                    </div>
                  ))}
                </>
              ) : <NoteTable key={`comment|${sectionId}|${periodId}`} onDirty={dirtyFor('comment')} kind="comment" periodId={periodId} learners={learners} readOnly={readOnly || manager || termShut} api={api} sectionId={sectionId} setStatus={setStatus} onSaved={reload} />
            ) : null}
          </>
        ) : null}
        {!records && !failed && sectionId ? <div className="card-body"><TableSkeleton columns={4} /></div> : null}
      </div>
      {records && section ? <p className="muted page-note">{sectionName(section)} · {gradeName(records.section.grade_level)}. Every saved batch is kept in the change history with its reason.</p> : null}
      {leaving ? (
        <Confirm title="Leave without recording?" tone="plain" confirmLabel="Leave without recording"
          body={`${dirty} ${dirty === 1 ? 'learner has' : 'learners have'} boxes typed here but not recorded yet. Leaving discards them; what is on file stays as it is.`}
          onClose={() => setLeaving(null)}
          onConfirm={() => { const then = leaving; setLeaving(null); then(); }} />
      ) : null}
    </>
  );
}

function NoteTable({ kind, periodId, learners, readOnly, api, sectionId, setStatus, onSaved, onDirty }: {
  kind: 'can_do' | 'to_improve' | 'comment'; periodId: string; learners: ReportLearner[]; readOnly: boolean; api: Api; sectionId: string; setStatus: (s: Status) => void; onSaved: () => void;
  onDirty?: ((count: number) => void) | undefined;
}) {
  const label = kind === 'comment' ? 'Teacher’s comment' : kind === 'can_do' ? 'Can do' : 'Learning to improve';
  return (
    <EntryTable
      learners={learners} readOnly={readOnly} setStatus={setStatus} onSaved={onSaved} onDirty={onDirty} what={kind === 'comment' ? 'Comments' : 'Narratives'} suggested="The adviser’s written comments for this term."
      columns={[{ key: 'body', label, kind: 'text' }]}
      stored={l => { const n = l.notes.find(x => x.kind === kind && x.reporting_period_id === periodId); return { values: { body: n?.body ?? '' }, version: n?.version ?? 0 }; }}
      toEntry={(l, v, version) => ({ enrollment_id: l.enrollment_id, body: v.body || null, version })}
      save={(entries, reason) => api(`/sections/${sectionId}/report-notes`, 'POST', { kind, reporting_period_id: periodId, entries, reason })}
    />
  );
}

/**
 * Every learner's SF9 for the section at once: printed as they stand, or
 * issued and printed. Issuing records each card's fingerprint; a card that
 * changed since it was last issued is a correction, which needs its own
 * reason, so it is left out and named rather than reissued silently.
 */
export function SectionCards({ api, me, gradeLevel, learners: all, setStatus }: {
  api: Api; me: Row; gradeLevel: number; learners: { enrollment_id: string; status: string; name: string }[]; setStatus: (s: Status) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [printing, setPrinting] = useState<{ form: Sf9Form; issuance: Issuance | null }[] | null>(null);
  const learners = all.filter(l => l.status === 'enrolled');
  const gather = async (issue: boolean) => {
    setBusy(true);
    setStatus({ text: `Preparing ${learners.length} report cards…`, kind: 'busy' });
    const cards: { form: Sf9Form; issuance: Issuance | null }[] = [];
    const skipped: string[] = [];
    try {
      for (const l of learners) {
        if (!issue) { cards.push({ form: await api<Sf9Form>(`/enrollments/${l.enrollment_id}/forms/sf9`), issuance: null }); continue; }
        try { cards.push(await api<{ form: Sf9Form; issuance: Issuance }>(`/enrollments/${l.enrollment_id}/forms/sf9/issuances`, 'POST', {})); }
        catch (error) { if (error instanceof ApiError && error.code === 'REISSUE_REASON') skipped.push(l.name); else throw error; }
      }
      setPrinting(cards);
      setStatus({ text: issue ? `${cards.length} report cards issued and sent to print.${skipped.length ? ` Not reissued, because they changed since they were issued: ${skipped.join('; ')}. Open each in the learner registry to issue a correction with a reason.` : ''}` : `${cards.length} report cards sent to print.`, kind: skipped.length ? 'error' : 'done' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); setConfirming(false); }
  };
  return (
    <>
      {/* One control for the section's cards, which asks whether to issue them: two buttons side by side
          read as the same thing twice (the group's note, 28 October). */}
      <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(true)}><Icon name="print" size={15} />Print the section’s SF9s</button>
      {confirming ? (
        <Sheet title={`Print ${learners.length} report cards`} note="Every learner currently enrolled in the section, each on its own sheet." onClose={() => setConfirming(false)}>
          <div className="choice-list">
            <div className="choice">
              <div><b>Print them as they stand</b><p className="muted">For checking against the ECR, or a copy for the class. Nothing is recorded.</p></div>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => void gather(false)}>Print as they stand</button>
            </div>
            <div className="choice">
              <div><b>Issue them, then print</b><p className="muted">Each card is recorded exactly as it stands, under your name, and printed. Parents keep what is printed, so check the grades against the ECR first. A card that changed since it was last issued is left out and named.</p></div>
              <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void gather(true)}>{busy ? 'Preparing…' : 'Issue and print'}</button>
            </div>
          </div>
        </Sheet>
      ) : null}
      {/* Every learner in the section shares a grade, so the batch prints on the one page the first card's layout names. */}
      {printing ? (
        <PrintCopy printing onPrinted={() => setPrinting(null)} page={printing[0] ? sf9Page[printing[0].form.layout] : undefined}>
          <SeededNotice me={me} />
          {printing.map(({ form, issuance }) => <Sf9Sheet key={form.enrollment.id} form={form} footer={issuance ? issuedLine('SF9', issuance) : `Printed ${localToday()} from EDUNEXUS. Not issued.`} />)}
        </PrintCopy>
      ) : null}
    </>
  );
}

type Promotion = { enrollment_id: string; action: 'promoted' | 'conditionally_promoted' | 'retained' | 'remedial' | null; status: 'recommended' | 'approved' | 'returned'; version: number; recommended_by: string | null; decided_by: string | null };
// The SF10 workbook's three words, and DepEd Order No. 15, s. 2026's conditional promotion after the Summer Remedial Class.
const outcomes: [string, string][] = [['promoted', 'Promoted'], ['conditionally_promoted', 'Conditionally promoted'], ['retained', 'Retained'], ['remedial', 'Remedial']];
const outcomeWord = (a: string | null | undefined) => outcomes.find(o => o[0] === a)?.[1] ?? '';
const statusTone = { recommended: 'info', approved: 'good', returned: 'attention' } as const;
const statusWord = { recommended: 'Endorsed · waiting for approval', approved: 'Approved', returned: 'Returned to the adviser' } as const;

/**
 * Whether promotion is open for this class, and what is still missing.
 * `GET /sections/{id}/promotion-readiness` counts records only — it reads no
 * grade and names no learner, which is why the dashboard can ask for it.
 */
type Readiness = {
  ready: boolean; blocked_by: 'incomplete' | 'no_periods' | 'no_offerings' | null; missing_total: number; learners: number; offerings: number;
  requires: { descriptive: boolean; grades: boolean; note_kinds: string[] };
  periods: { id: string; ordinal: number; name: string; starts_on: string; ends_on: string; open: boolean; missing: number; complete: boolean }[];
  final: { missing_grades: number; missing_remarks: number; complete: boolean };
  general_average: { missing: number; complete: boolean };
};

/** What a class is still waiting for, in the adviser's own terms: one line per thing, never a total alone. */
function NotReady({ gate, manager }: { gate: Readiness; manager: boolean }) {
  const rows: { what: string; missing: number; note?: string | undefined }[] = [
    ...gate.periods.map(p => ({ what: gate.requires.grades ? `${p.name} term grades` : `${p.name} narratives`, missing: p.missing,
      note: p.open ? undefined : `This term starts on ${p.starts_on}; its grades cannot be encoded yet.` })),
    ...(gate.requires.grades ? [
      { what: 'Subject averages', missing: gate.final.missing_grades },
      { what: 'Subject remarks', missing: gate.final.missing_remarks },
      { what: 'General averages', missing: gate.general_average.missing },
    ] : []),
  ];
  return (
    <div className="card-body">
      <Callout tone="attention" title="Promotion is not open for this class yet">
        {gate.blocked_by === 'no_periods'
          ? <>This school year has no reporting periods configured. A manager configures them on <b>School years</b> while the year is a draft.</>
          : gate.blocked_by === 'no_offerings'
            ? <>This class has no learning areas offered, so there are no grades to complete. Offer them on <b>Subjects &amp; offerings</b> first.</>
            : <>Every term’s grades, each subject average and remark, and each learner’s general average have to be recorded for all {gate.learners} {gate.learners === 1 ? 'learner' : 'learners'} first. {gate.missing_total} {gate.missing_total === 1 ? 'record is' : 'records are'} still missing. {manager ? 'The adviser records them; this list is what to ask them for.' : 'Record them on the tabs beside this one.'}</>}
      </Callout>
      {gate.blocked_by === 'incomplete' ? (
        <Table
          rows={rows}
          rowKey={r => r.what}
          columns={[
            { header: 'Required', cell: r => <Cell title={r.what} meta={r.note} /> },
            { header: 'Still missing', cell: r => (r.missing ? <b className="mono">{r.missing}</b> : <Badge tone="good">Complete</Badge>) },
          ]}
        />
      ) : null}
    </div>
  );
}

/**
 * Each learner's end-of-year outcome: the adviser recommends it beside the
 * general average and remarks entered from the ECR, and the principal or
 * administrative officer approves it or returns it. An approved outcome is
 * printed on the SF9 and SF10 and is what next year's classes are prepared
 * from. EDUNEXUS decides nothing here: the outcomes are the school's.
 */
function PromotionPanel({ api, me, manager, records, setStatus, descriptive = false, onDecided, onDirty, openApprove, onApproveOpened }: { api: Api; me: Row; manager: boolean; records: ReportRecords; setStatus: (s: Status) => void; descriptive?: boolean; onDecided?: () => void; onDirty?: ((count: number) => void) | undefined; openApprove?: boolean; onApproveOpened?: () => void }) {
  const [items, setItems] = useState<Promotion[] | null>(null);
  const [gate, setGate] = useState<Readiness | null>(null);
  const [tick, setTick] = useState(0);
  const [deciding, setDeciding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [head, setHead] = useState<{ name: string | null; position: string | null }>({ name: null, position: null });
  useEffect(() => {
    void api<{ items: Promotion[] }>(`/academic-years/${records.school_year.id}/promotions${query({ section_id: records.section.id })}`)
      .then(r => setItems(r.items)).catch(error => setStatus({ text: message(error), kind: 'error' }));
  }, [api, records, tick]);
  // The same gate the API enforces. Asked for here rather than worked out from the
  // records on the page, so what the screen shows and what the writers accept
  // cannot drift apart.
  useEffect(() => {
    void api<Readiness>(`/sections/${records.section.id}/promotion-readiness`)
      .then(setGate).catch(error => setStatus({ text: message(error), kind: 'error' }));
  }, [api, records, tick]);
  // The school head signs the promotion report beside the adviser, as on every form.
  useEffect(() => { void api<Row>('/school').then(r => setHead({ name: (r.school_head_name as string | null) ?? null, position: (r.school_head_position as string | null) ?? null })).catch(() => undefined); }, [api]);
  useEffect(() => {
    if (!openApprove || !items || !gate || !manager) return;
    if (gate.ready && items.some(i => i.action && i.status !== 'approved') && records.school_year.status !== 'closed') setDeciding(true);
    // A link from an Overview opened earlier, or a bookmark: say why there is nothing to approve rather than opening nothing.
    else setStatus({ kind: 'done', text: `Nothing in ${records.section.name} waits for approval now; it was decided after the link was made.` });
    onApproveOpened?.();
  }, [openApprove, items, gate]);
  if (!items || !gate) return <div className="card-body"><TableSkeleton columns={4} /></div>;
  const byId = new Map(items.map(i => [i.enrollment_id, i]));
  const readOnly = records.school_year.status === 'closed';
  const failed = (l: ReportLearner) => l.grades.filter(g => g.reporting_period_id === null && g.remark === 'failed').length;
  const waiting = items.filter(i => i.action && i.status !== 'approved');
  const learners = records.learners.filter(l => l.status === 'enrolled');
  const counts = outcomes.map(([key, word]) => `${items.filter(i => i.action === key && i.status === 'approved').length} ${word.toLowerCase()}`).join(', ');
  return (
    <>
      <div className="card-body">
        <p className="card-note">The adviser endorses each learner’s outcome, as the school decided it from the ECR’s final grades, and the principal or administrative officer approves it or returns it. The approved outcome fills the report card’s and permanent record’s “eligible for admission to Grade”. Approved so far: {counts}; {waiting.length} waiting.</p>
        {gate.ready ? <p className="card-note">An approved outcome also <b>enrols the learner into next school year</b> at the grade it leads to, with no class yet, so next year’s adviser can take them into theirs. <b>Only a promotion enrols</b>: a retained learner’s outcome is recorded and approved and moves them nowhere, so they are enrolled for next year with everyone else when its classes are set up. Nothing is deleted: this year’s enrolment, grades and outcome all stay exactly as they are. If next school year has not been created yet, an approved promotion is recorded and the enrolment follows the moment it is.</p> : null}
        <div className="form-actions">
          {manager && gate.ready && waiting.length && !readOnly ? <button type="button" className="btn" onClick={() => setDeciding(true)} data-tour="rc-approve">Approve or return {waiting.length} {waiting.length === 1 ? 'endorsement' : 'endorsements'}</button> : null}
          <button type="button" className="btn secondary" onClick={() => setPrinting(true)} data-tour="rc-print"><Icon name="print" size={15} />Print the promotion report</button>
        </div>
      </div>
      {gate.ready ? null : <NotReady gate={gate} manager={manager} />}
      <EntryTable
        onDirty={onDirty}
        learners={learners} readOnly={readOnly || manager || !gate.ready} setStatus={setStatus} what="Endorsements" suggested="Endorsed from the class’s end-of-year promotion report."
        onSaved={() => setTick(t => t + 1)}
        extra={[
          ...(descriptive ? [] : [{ header: 'General average', cell: (l: ReportLearner) => l.summary?.general_average === null || l.summary?.general_average === undefined ? <Unrecorded label="Not recorded" /> : <span className="mono">{String(l.summary.general_average)} {l.summary.remark === 'failed' ? 'Failed' : l.summary.remark === 'passed' ? 'Passed' : ''}</span> },
          { header: 'Areas failed', cell: (l: ReportLearner) => (l.grades.some(g => g.reporting_period_id === null) ? String(failed(l)) : <Unrecorded label="No final grades" />) }]),
          { header: 'Status', cell: l => { const p = byId.get(l.enrollment_id); return p?.action ? <Badge tone={statusTone[p.status]}>{statusWord[p.status]}</Badge> : <span className="muted">No outcome yet</span>; } },
        ]}
        locked={l => (byId.get(l.enrollment_id)?.status === 'approved' ? 'Approved. The principal or administrative officer returns it before it can change.' : null)}
        columns={[{ key: 'action', label: 'Endorsed outcome', kind: 'choice', options: outcomes }]}
        stored={l => { const p = byId.get(l.enrollment_id); return { values: { action: p?.action ?? '' }, version: p?.version ?? 0 }; }}
        toEntry={(l, v, version) => ({ enrollment_id: l.enrollment_id, action: v.action || null, version })}
        save={(entries, reason) => api(`/sections/${records.section.id}/promotion-recommendations`, 'POST', { entries, reason })}
      />
      {deciding ? <DecideSheet api={api} records={records} items={waiting} onClose={() => setDeciding(false)}
        onDone={text => { setDeciding(false); setTick(t => t + 1); setStatus({ text, kind: 'done' }); onDecided?.(); }} /> : null}
      <PrintCopy printing={printing} onPrinted={() => setPrinting(false)} long>
        <SeededNotice me={me} />
        <div className="paper">
          <h2>Promotion report</h2>
          <p className="paper-sub">{gradeName(records.section.grade_level)} · {records.section.name} · School Year {records.school_year.start_year}–{records.school_year.start_year + 1} · Adviser {records.section.adviser_name ?? ''}</p>
          <table className="paper-grid card-table promotion-report">
            <thead><tr><th>No.</th><th>Learner</th><th>LRN</th>{descriptive ? null : <><th>General average</th><th>Remark</th><th>Areas failed</th></>}<th>Outcome</th><th>Status</th></tr></thead>
            {(['male', 'female'] as const).map(sex => {
              const group = learners.filter(l => l.sex === sex);
              if (!group.length) return null;
              return (
                <tbody key={sex}>
                  <tr className="group-row"><th colSpan={descriptive ? 5 : 8}>{sex === 'male' ? 'MALE' : 'FEMALE'} · {group.length}</th></tr>
                  {group.map((l, i) => { const p = byId.get(l.enrollment_id); const average = l.summary?.general_average; return (
                    <tr key={l.enrollment_id}><td className="numeric">{i + 1}</td><td>{learnerName(l)}</td><td>{l.lrn ?? <Unrecorded label="No LRN" />}</td>
                      {descriptive ? null : <><td className="numeric">{average === null || average === undefined ? <Unrecorded label="Not recorded" /> : String(average)}</td>
                        <td>{l.summary?.remark === 'passed' ? 'Passed' : l.summary?.remark === 'failed' ? 'Failed' : <Unrecorded label="Not recorded" />}</td>
                        <td className="numeric">{l.grades.some(g => g.reporting_period_id === null) ? failed(l) : <Unrecorded label="No final grades" />}</td></>}
                      <td>{p?.action ? outcomeWord(p.action) : <Unrecorded label="No outcome yet" />}</td><td>{p?.action ? statusWord[p.status] : <Unrecorded label="Not endorsed" />}</td></tr>); })}
                </tbody>
              );
            })}
          </table>
          {/* A tally of the decisions recorded, by outcome: counts of what the school decided, never a grade. */}
          <p className="paper-sub promotion-tally">{outcomes.map(([key, word]) => `${word}: ${learners.filter(l => byId.get(l.enrollment_id)?.action === key).length}`).join(' · ')} · No outcome yet: {learners.filter(l => !byId.get(l.enrollment_id)?.action).length} · Approved: {learners.filter(l => byId.get(l.enrollment_id)?.status === 'approved').length} of {learners.length}</p>
          <div className="paper-signatures">
            <div><p>Prepared by:</p><p className="signature-name">{records.section.adviser_name ?? ''}</p><p>Class adviser</p></div>
            <div><p>Approved by:</p><p className="signature-name">{head.name ?? ''}</p><p>{head.position ?? 'School head'}</p></div>
          </div>
          <p className="print-foot">Printed {localToday()} from EDUNEXUS. Outcomes are the school’s decisions as recorded; EDUNEXUS computes none of them.</p>
        </div>
      </PrintCopy>
    </>
  );
}

/** An approver's review: each waiting outcome approved, returned, or left for later, with one reason for the batch. */
function DecideSheet({ api, records, items, onClose, onDone }: { api: Api; records: ReportRecords; items: Promotion[]; onClose: () => void; onDone: (text: string) => void }) {
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(items.filter(i => i.status === 'recommended').map(i => [i.enrollment_id, 'approved'])));
  const [reason, setReason] = useState('Approved after checking the promotion report against the ECR.');
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const name = (eid: string) => { const l = records.learners.find(x => x.enrollment_id === eid); return l ? learnerName(l) : eid; };
  const chosen = items.filter(i => choice[i.enrollment_id]);
  const go = async (event: FormEvent) => {
    event.preventDefault();
    const text = reason.replace(/\s+/g, ' ').trim();
    if (text.length < 10) { setLocal({ kind: 'error', text: 'Give a reason of at least 10 characters.' }); return; }
    setBusy(true);
    try {
      const done = await api<{ advanced: number; waiting_for_next_year: number; entries: { advance: { why?: string } }[] }>(`/sections/${records.section.id}/promotion-decisions`, 'POST',
        { entries: chosen.map(i => ({ enrollment_id: i.enrollment_id, decision: choice[i.enrollment_id], version: i.version })), reason: text });
      const approved = chosen.filter(i => choice[i.enrollment_id] === 'approved').length;
      // What the approval did next, in the same words the API answered with: a
      // learner was enrolled for next year, or is waiting for that year to exist.
      const moved = done.advanced ? ` ${done.advanced} ${done.advanced === 1 ? 'learner was' : 'learners were'} enrolled into next school year with no class yet.` : '';
      const held = done.waiting_for_next_year
        ? ` ${done.waiting_for_next_year} ${done.waiting_for_next_year === 1 ? 'learner is' : 'learners are'} waiting for next school year to be created, and will be enrolled when it is.`
        : '';
      // A retention enrols nobody (0071), so it is said rather than left for
      // someone to notice when the learner is missing from next year.
      const kept = done.entries.filter(e => e.advance.why === 'retained').length;
      const stay = kept
        ? ` ${kept} retained ${kept === 1 ? 'learner was' : 'learners were'} not enrolled for next year: a retention is recorded only, so enrol them when next year's classes are set up.`
        : '';
      onDone(`${approved} ${approved === 1 ? 'outcome' : 'outcomes'} approved${chosen.length - approved ? `, ${chosen.length - approved} returned to the adviser` : ''}.${moved}${held}${stay}`);
    } catch (error) { setLocal({ kind: 'error', text: message(error) }); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title="Approve or return endorsements" note={`${gradeName(records.section.grade_level)} · ${records.section.name}. An approved outcome is printed on the learner’s forms.`} wide onClose={onClose}>
      <StatusLine status={status} />
      <Affects what="outcome" />
      <Callout tone="info" title="Approving also enrols the learner for next year">
        An approved promotion enrols the learner into next school year at the next grade, with no class yet, so next year’s adviser can take them in. <b>A retention enrols nobody</b> — it is recorded as the school’s decision and nothing else, so a retained learner is enrolled for next year separately. This year’s records are untouched, and a learner already enrolled next year is not enrolled twice. If next school year does not exist yet, an approved promotion is recorded and the enrolment follows when it is created.
      </Callout>
      <Table
        rows={items}
        rowKey={i => i.enrollment_id}
        columns={[
          { header: 'Learner', cell: i => <Cell title={name(i.enrollment_id)} meta={i.recommended_by ? `Recommended by ${i.recommended_by}` : undefined} /> },
          { header: 'Outcome', cell: i => outcomeWord(i.action) },
          { header: 'Now', cell: i => <Badge tone={statusTone[i.status]}>{statusWord[i.status]}</Badge> },
          { header: 'Decision', cell: i => (
            <div className="field cell-field choice">
              <Select aria-label={`Decision for ${name(i.enrollment_id)}`} value={choice[i.enrollment_id] ?? ''} onChange={e => setChoice(c => ({ ...c, [i.enrollment_id]: e.target.value }))}>
                <option value="">Leave for now</option><option value="approved">Approve</option><option value="returned">Return to the adviser</option>
              </Select>
            </div>
          ) },
        ]}
      />
      <form onSubmit={go}>
        <div className="form-grid">
          <div className="field wide">
            <label className="label" htmlFor={`${id}-reason`}>Reason</label>
            <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy || !chosen.length} aria-busy={busy}>{busy ? 'Recording…' : `Record ${chosen.length} ${chosen.length === 1 ? 'decision' : 'decisions'}`}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * The section's grades for one term, or its final grades, side by side, as
 * they were entered: for the adviser to check against the ECR, and to print.
 * Boys first, then girls, as the school's forms list them. Nothing is totalled,
 * averaged or ranked: the general average shown is the one entered.
 */
function ClassSummary({ me, records }: { me: Row; records: ReportRecords }) {
  const [column, setColumn] = useState('final');
  const [printing, setPrinting] = useState(false);
  const final = column === 'final';
  const offerings = records.offerings.filter(o => o.active);
  const period = records.periods.find(p => p.id === column);
  const order = (sex: string) => records.learners.filter(l => l.status === 'enrolled' && l.sex === sex);
  const rows = [...order('male'), ...order('female')];
  const grade = (l: ReportLearner, offering: string) => l.grades.find(g => g.offering_id === offering && g.reporting_period_id === (final ? null : column));
  const missing = rows.reduce((n, l) => n + offerings.filter(o => grade(l, o.id)?.grade == null).length + (final && l.summary?.general_average == null ? 1 : 0), 0);
  const label = final ? 'Subject averages' : period?.name ?? '';
  return (
    <>
      <div className="card-head">
        <div className="toolbar">
          <div className="field inline">
            <span className="label">Column</span>
            <Select aria-label="Summary column" value={column} onChange={e => setColumn(e.target.value)}>
              <option value="final">Subject averages and general average</option>
              {records.periods.map(p => <option key={p.id} value={p.id}>{p.name} grades</option>)}
            </Select>
          </div>
          <button type="button" className="btn secondary" onClick={() => setPrinting(true)}><Icon name="print" size={15} />Print the class summary</button>
        </div>
        <p className="card-note">{missing ? `${missing} ${missing === 1 ? 'grade is' : 'grades are'} not recorded yet for ${final ? 'the subject averages' : label}.` : `Every grade for ${final ? 'the subject averages' : label} is recorded.`} Each grade is shown as it was entered from the ECR.</p>
      </div>
      <Table
        rows={rows}
        rowKey={l => l.enrollment_id}
        empty={<EmptyState title="No learners" body="This section has no enrolled learners." />}
        columns={[
          { header: 'Learner', cell: l => <Cell title={learnerName(l)} meta={l.sex === 'male' ? 'Male' : 'Female'} /> },
          ...offerings.map(o => ({ header: o.code || o.name, cell: (l: ReportLearner) => { const g = grade(l, o.id); return g?.grade == null ? <Unrecorded label="Not recorded" /> : <span className="mono">{String(g.grade)}{final && g.remark === 'failed' ? ' F' : ''}</span>; } })),
          ...(final ? [{ header: 'General average', cell: (l: ReportLearner) => (l.summary?.general_average == null ? <Unrecorded label="Not recorded" /> : <b className="mono">{String(l.summary.general_average)} {l.summary.remark === 'passed' ? 'Passed' : l.summary.remark === 'failed' ? 'Failed' : ''}</b>) }] : []),
        ]}
      />
      <PrintCopy printing={printing} onPrinted={() => setPrinting(false)} landscape>
        <SeededNotice me={me} />
        <div className="paper">
          <h2>Class summary · {label}</h2>
          <p className="paper-sub">{gradeName(records.section.grade_level)} · {records.section.name} · School Year {records.school_year.start_year}–{records.school_year.start_year + 1} · Adviser {records.section.adviser_name ?? ''}</p>
          <table className="paper-grid card-table">
            <thead><tr><th>No.</th><th>Learner</th>{offerings.map(o => <th key={o.id}>{o.code || o.name}</th>)}{final ? <><th>General average</th><th>Remark</th></> : null}</tr></thead>
            <tbody>
              {(['male', 'female'] as const).map(sex => [
                <tr key={sex} className="card-average"><td colSpan={2 + offerings.length + (final ? 2 : 0)}><b>{sex === 'male' ? 'MALE' : 'FEMALE'}</b></td></tr>,
                ...order(sex).map((l, i) => (
                  <tr key={l.enrollment_id}><td className="numeric">{i + 1}</td><td>{learnerName(l)}</td>
                    {offerings.map(o => { const g = grade(l, o.id); return <td key={o.id} className="numeric">{g?.grade == null ? '' : String(g.grade)}{final && g?.remark === 'failed' ? ' F' : ''}</td>; })}
                    {final ? <><td className="numeric">{l.summary?.general_average ?? ''}</td><td>{l.summary?.remark === 'passed' ? 'Passed' : l.summary?.remark === 'failed' ? 'Failed' : ''}</td></> : null}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          <p className="print-foot">{offerings.map(o => `${o.code || o.name}: ${o.name}`).join(' · ')}. A blank cell is a grade not recorded; F marks a final grade recorded as failed. Printed {localToday()} from EDUNEXUS, as entered from the ECR; nothing on it is computed.</p>
        </div>
      </PrintCopy>
    </>
  );
}
