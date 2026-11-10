import { useEffect, useId, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { clamp } from '../dates';
import { Icon } from '../components/icons';
import { ScopePickers, sectionName, useScope } from '../components/scope';
import { ROSTER_HEADER, csvProblem, csvStats, rosterFileText, rosterTemplateWorkbook } from '../csv';
import { FileRules } from '../components/filerules';
import { downloadXlsx } from '../xlsx';
import { LateRowSheet, csvRow } from './LateLearner';
import {
  Badge, Button, Callout, Cell, Editor, EmptyState, PageHeader, Select, StatusLine, Table, TableSkeleton, Task, Unrecorded,
  gradeName, idle, learnerName, localToday, sentence, type Status,
} from '../components/primitives';

type Profile = { lrn: string | null; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null; birth_date: string; sex: 'male' | 'female' };
type Issue = { row: number; field: string; code: string; message: string };
type Checked = { row_count: number; rows: (Profile | null)[]; issues: Issue[] };
export type Submission = {
  id: string; section_id: string | null; academic_year_id: string; enrolled_on: string; entry_kind: 'regular' | 'transfer_in'; row_count: number;
  status: 'submitted' | 'withdrawn' | 'accepted' | 'declined'; version: number; created_at: string; grade_level: number;
  submitted_by_name: string | null; section_name: string | null; csv?: string;
};
type Props = { api: Api; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

/** Where a half-typed class list waits out a page refresh. */
const DRAFT = 'edunexus-ui-roster-draft';
const clearDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch { /* nothing to clean up */ } };

const reasonField = { key: 'reason', label: 'Reason', type: 'textarea', minLength: 10, maxLength: 500, wide: true, hint: '10–500 characters on one line, kept with the list for good.' };

const statusBadge: Record<Submission['status'], [string, 'info' | 'neutral' | 'good' | 'stopped']> = {
  submitted: ['Waiting for review', 'info'], withdrawn: ['Withdrawn', 'neutral'], accepted: ['Imported', 'good'], declined: ['Declined', 'stopped'],
};
export const StatusBadge = ({ status }: { status: Submission['status'] }) => <Badge tone={statusBadge[status][1]}>{statusBadge[status][0]}</Badge>;
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * An adviser's own route to a roster import. They check their class list's
 * format, which reads nothing from the registry, and submit it with a reason;
 * a principal or administrative officer then imports it through the reviewed
 * import, where duplicates are resolved, because learner records stay in
 * managers' hands. The adviser follows the list's state here.
 */
export function RosterSubmit({ api, setStatus, token, route }: Props) {
  const id = useId();
  const scope = useScope(api, token);
  const [enrolledOn, setEnrolledOn] = useState('');
  const [kind, setKind] = useState<'regular' | 'transfer_in'>('regular');
  // The list being built, kept across a refresh. The school lost a morning's
  // typing to one: learners added through **Add learner** live only in this
  // state until the list is submitted, and a reload emptied it.
  //
  // `sessionStorage`, not `localStorage`, and that is the whole of the
  // decision. A draft list holds learner names, birth dates and LRNs, so it
  // follows the rule sessions follow here: it dies with the tab, and a
  // staffroom machine does not keep one adviser's list for the next person.
  // It is cleared the moment the list is submitted, and a private window
  // throwing on access costs the feature and nothing else.
  const [csv, setCsv] = useState(() => {
    try { return sessionStorage.getItem(DRAFT) ?? ''; } catch { return ''; }
  });
  const [checked, setChecked] = useState<Checked | null>(null);
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Submission[] | null>(null);
  const [tick, setTick] = useState(0);
  const [late, setLate] = useState(false);
  const { year } = scope;

  useEffect(() => { if (year) setEnrolledOn(clamp(localToday(), String(year.starts_on), String(year.ends_on))); }, [year?.id]);
  useEffect(() => { setChecked(null); }, [csv, scope.sectionId, enrolledOn, kind]);
  useEffect(() => {
    try { if (csv.trim()) sessionStorage.setItem(DRAFT, csv); else sessionStorage.removeItem(DRAFT); } catch { /* a private window refuses, which costs only the draft */ }
  }, [csv]);
  useEffect(() => {
    void api<Page<Submission>>(`/roster-submissions${query({ status: 'all', limit: 50 })}`).then(r => setMine(r.items)).catch(() => setMine([]));
  }, [api, token, tick]);

  /*
   * Every list lands on the registry with no class, at the grades its rows
   * say. **Any grade may be submitted** (decided 2026-11-07, the school's
   * second asking): a submission creates nothing, and the office reads every
   * row before it becomes a record, so which classes this adviser happens to
   * advise does not decide what they may put on a list.
   *
   * The grade chosen here stands only for the rows that leave theirs empty.
   * It defaults to a grade this adviser advises, because that is almost
   * always the answer — but it is a default, not a limit.
   */
  // No `grade_level` at all: each row carries its own, and a row that carries
  // none is refused on its own line rather than quietly taking a grade chosen
  // for the whole file. It is never sent as null either — the API reads a null
  // as 0, which is Kindergarten, and would invent a grade nobody named.
  const body = () => ({ section_id: null, academic_year_id: scope.yearId, enrolled_on: enrolledOn, entry_kind: kind, csv });
  const runCheck = async () => {
    setBusy(true);
    setLocal({ text: 'Checking the list…', kind: 'busy' });
    try {
      const result = await api<Checked>('/roster-submissions/check', 'POST', body());
      setChecked(result);
      setLocal(result.issues.length ? { text: `${result.issues.length} ${result.issues.length === 1 ? 'problem' : 'problems'} to fix. Each is shown beside its row.`, kind: 'error' } : { text: `All ${result.row_count} rows are in order. Give a reason and submit.`, kind: 'done' });
    } catch (error) { setLocal({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={4} /></div></>;
  // Only a missing school year stops this screen. Advising no class used to
  // stop it too, back when a list had to be for a grade you advised; it no
  // longer does, so an adviser waiting on their class assignment can still
  // prepare and send a list.
  if (!scope.years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState
          title="No school year yet"
          body="A list belongs to a school year. A principal or administrative officer creates one on School years & sections."
        /></div>
      </>
    );
  }

  const problem = csvProblem(csv);
  const stats = csvStats(csv);
  // How many of this adviser's lists are waiting. It is shown, never enforced:
  // `0064` dropped the one-list-per-grade index, and this screen went on
  // refusing a second list for a release afterwards — the database allowed it
  // and the button did not, which is the worst of the two.
  const waitingCount = (mine ?? []).filter(s => s.status === 'submitted').length;
  const issuesFor = (row: number) => (checked?.issues ?? []).filter(i => i.row === row);

  return (
    <>
      <PageHeader route={route} actions={<button type="button" className="btn secondary" data-tour="roster-template" onClick={() => { void downloadXlsx('edunexus-class-list-template.xlsx', rosterTemplateWorkbook()).catch(error => setStatus({ text: message(error), kind: 'error' })); }}><Icon name="imports" size={15} />Download the template</button>} />
      <Callout tone="info" title="You submit; the office imports">
        Check your list here and submit it. The principal or administrative officer approves it on <b>Enrollment</b>, which is what turns it into learner records — until then none of these learners is on the registry. You will see its state below.
      </Callout>

      {late ? (
        <LateRowSheet onClose={() => setLate(false)} onAdd={row => {
          // A late learner is one more row of the list: the header starts it if the list is empty.
          setCsv(current => `${current.trim() ? current.replace(/\s*$/, '') : ROSTER_HEADER}\r\n${csvRow(row)}\r\n`);
          setLate(false);
          setLocal({ text: `${row.last_name}, ${row.first_name} is on your list. Check the list, then submit it.`, kind: 'done' });
        }} />
      ) : null}
      <div className="card">
        <div className="card-head" data-tour="roster-form"><div><h2>Your class list</h2><p className="card-note">One file, up to 50 learners, joining on one date. Each carries their own grade level, and they are registered at it with no class; the advisers of each grade then take in their own.</p></div></div>
        <div className="card-head">
          <div className="toolbar">
            <ScopePickers scope={scope} yearOnly />
            {/*
              No grade picker here. Every learner carries their own grade —
              typed on **Add learner**, or in the template's `grade_level`
              column — so a grade for the whole list was a second place to say
              the same thing, and the school asked for it to go (2026-11-07).
              A row that names no grade is said on its own line when the list
              is checked, which is where the other row problems are said too.
            */}
            <div className="field inline">
              <label className="label" htmlFor={`${id}-on`}>First day at school</label>
              <input id={`${id}-on`} type="date" className="date-input" value={enrolledOn} min={String(year?.starts_on ?? '')} max={String(year?.ends_on ?? '')} onChange={event => setEnrolledOn(event.target.value)} />
            </div>
            <div className="field inline">
              <label className="label" htmlFor={`${id}-kind`}>Joining as</label>
              <Select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
                <option value="regular">Regular enrollment</option>
                <option value="transfer_in">Transferred in</option>
              </Select>
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field wide">
              <label className="label" htmlFor={`${id}-file`}>Excel or CSV file</label>
              <input id={`${id}-file`} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                try { setCsv(await rosterFileText(file)); } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
              }} />
              <FileRules header={ROSTER_HEADER} />
            </div>
          </div>
          <Task title="Paste the CSV text instead" note="For a list copied from a text editor">
            <div className="field wide">
              <label className="label" htmlFor={`${id}-text`}>CSV text</label>
              <textarea id={`${id}-text`} className="mono" rows={8} value={csv} onChange={event => setCsv(event.target.value)} />
            </div>
          </Task>
          {csv ? <p className="card-note">{stats.rows} {stats.rows === 1 ? 'row' : 'rows'}, {stats.bytes.toLocaleString()} bytes{problem ? ` — ${problem}` : ''} · Kept while this tab is open, so a refresh does not lose it.</p> : null}
          <StatusLine status={status} />
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || !csv || !!problem} aria-busy={busy} onClick={() => void runCheck()} data-tour="roster-check">{busy ? 'Checking…' : 'Check the list'}</button>
            <button type="button" className="btn secondary" onClick={() => setLate(true)} data-tour="roster-late">Add learner</button>
            {csv ? <button type="button" className="btn ghost" disabled={busy} onClick={() => { clearDraft(); setCsv(''); setChecked(null); }}>Start the list again</button> : null}
          </div>
        </div>
        {checked ? (
          <Table
            stack
            rows={checked.rows.map((profile, i) => ({ row: i + 1, profile }))}
            rowKey={r => String(r.row)}
            columns={[
              { header: 'Row', cell: r => <span className="mono">{r.row}</span>, numeric: true },
              { header: 'Learner', cell: r => (r.profile ? <Cell title={learnerName(r.profile)} meta={r.profile.lrn ? `LRN ${r.profile.lrn}` : <Unrecorded label="LRN missing" />} /> : <Unrecorded label="Unreadable row" />) },
              { header: 'Birth date', cell: r => (r.profile ? <span className="mono">{r.profile.birth_date}</span> : null) },
              { header: 'Sex', cell: r => (r.profile ? sentence(r.profile.sex) : null) },
              { header: 'Check', cell: r => (issuesFor(r.row).length ? <span className="batch-area">{issuesFor(r.row).map(i => <span key={i.field + i.code} className="batch-note"><Badge tone="stopped">{sentence(i.field.replace(/_/g, ' '))}</Badge> {i.message}</span>)}</span> : <Badge tone="good">In order</Badge>) },
            ]}
          />
        ) : null}
        {checked && !checked.issues.length ? (
          <div className="card-body">
            {waitingCount ? (
              <Callout tone="info" title={waitingCount === 1 ? 'You have one list waiting' : `You have ${waitingCount} lists waiting`}>
                You can send this one as well — the office decides them separately, and nothing has to be withdrawn first. Each is listed below with its state.
              </Callout>
            ) : null}
            {(
              <Editor
                fields={[reasonField]}
                submitLabel={`Submit ${checked.row_count} ${checked.row_count === 1 ? 'learner' : 'learners'} for review`}
                setStatus={setLocal}
                onSubmit={data => api('/roster-submissions', 'POST', { ...body(), reason: data.reason })}
                onSaved={() => { clearDraft(); setCsv(''); setChecked(null); setTick(t => t + 1); setStatus({
                  text: `List of ${checked.row_count} ${checked.row_count === 1 ? 'learner' : 'learners'} submitted for review. Once the office approves it, they are on the registry with no class, and each grade's advisers take in the ones who are theirs.`,
                  kind: 'done' }); }}
              />
            )}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-head" data-tour="roster-sent"><div><h2>Lists you have submitted</h2><p className="card-note">Newest first.</p></div></div>
        <Table
          loading={mine === null}
          rows={mine ?? []}
          rowKey={s => s.id}
          empty={<EmptyState title="None yet" body="A class list you submit appears here with its state." />}
          columns={[
            { header: 'For', cell: s => (s.section_name
              ? `${gradeName(s.grade_level)} · ${s.section_name}`
              : `${gradeName(s.grade_level)} — no class yet`) },
            { header: 'Learners', cell: s => s.row_count, numeric: true },
            { header: 'Submitted', cell: s => <span className="mono">{when(s.created_at)}</span> },
            { header: 'State', cell: s => <StatusBadge status={s.status} /> },
          ]}
          detailLabel="Open"
          detail={s => (s.status !== 'submitted' ? <p className="muted">{s.status === 'accepted'
            ? (s.section_name ? 'Imported: the learners are on your register.' : 'Imported: the learners are on the registry at this grade, in no class. Take in the ones who are yours from Learner registry.')
            : s.status === 'declined' ? 'Declined. Ask the office why, then submit a corrected list.' : 'Withdrawn by you.'}</p> : (
            <Task title="Withdraw this list" note="Kept as a record" tone="warn">
              <Editor fields={[reasonField]} submitLabel="Withdraw" setStatus={setLocal}
                onSubmit={data => api(`/roster-submissions/${s.id}/withdrawal`, 'POST', { version: s.version, reason: data.reason })}
                onSaved={() => { setTick(t => t + 1); setStatus({ text: 'Class list withdrawn.', kind: 'done' }); }} />
            </Task>
          ))}
        />
      </div>
    </>
  );
}

/**
 * The lists advisers have submitted, for a manager. Opening one fills the
 * import above with it; committing that import then accepts the list with the
 * import's receipt. Declining needs a reason the adviser can read.
 */
export function AdviserLists({ api, token, onOpen, setStatus }: { api: Api; token: number; onOpen: (s: Submission) => void; setStatus: (s: Status) => void }) {
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [show, setShow] = useState<'submitted' | 'all'>('submitted');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void api<Page<Submission>>(`/roster-submissions${query({ status: show, limit: 50 })}`).then(r => setRows(r.items)).catch(() => setRows([]));
  }, [api, token, show, tick]);
  if (rows && !rows.length && show === 'submitted') return null;
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Class lists from advisers</h2><p className="card-note">Open one to import it below. Committing that import accepts the list.</p></div>
        <div className="card-head-actions">
          <Select aria-label="Which lists" value={show} onChange={event => setShow(event.target.value as typeof show)}>
            <option value="submitted">Waiting</option>
            <option value="all">All</option>
          </Select>
        </div>
      </div>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={s => s.id}
        empty={<EmptyState title="Nothing in this state" body="Lists advisers submit appear here." />}
        columns={[
          { header: 'Section', cell: s => <Cell title={`${gradeName(s.grade_level)} · ${s.section_name}`} meta={s.submitted_by_name ?? 'An adviser'} /> },
          { header: 'Learners', cell: s => s.row_count, numeric: true },
          { header: 'Submitted', cell: s => <span className="mono">{when(s.created_at)}</span> },
          { header: 'State', cell: s => <StatusBadge status={s.status} /> },
        ]}
        detailLabel="Open"
        detail={s => (s.status !== 'submitted' ? <p className="muted">This list has been {statusBadge[s.status][0].toLowerCase()}.</p> : (
          <>
            <div className="form-actions sheet-tools">
              <Button
                label="Open in the import"
                setStatus={setStatus}
                onRun={async () => onOpen(await api<Submission>(`/roster-submissions/${s.id}`))}
              />
            </div>
            <Task title="Decline this list" note="The adviser sees that it was declined" tone="warn">
              <Editor fields={[reasonField]} submitLabel="Decline" setStatus={setStatus}
                onSubmit={data => api(`/roster-submissions/${s.id}/decision`, 'POST', { version: s.version, decision: 'declined', import_id: null, reason: data.reason })}
                onSaved={() => { setTick(t => t + 1); setStatus({ text: 'Class list declined.', kind: 'done' }); }} />
            </Task>
          </>
        ))}
      />
    </div>
  );
}
