import { useEffect, useId, useState } from 'react';
import type { Api } from '../api';
import { ApiError, message } from '../api';
import type { Route } from '../routes';
import { clamp } from '../dates';
import { Icon } from '../components/icons';
import { ScopePickers, sectionName, useScope } from '../components/scope';
import { AdviserLists, type Submission } from './RosterSubmissions';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, Select, StatusLine, Table, TableSkeleton, Task, Unrecorded,
  gradeName, idle, learnerName, localToday, sentence, type Status,
} from '../components/primitives';

type Props = { api: Api; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

type Profile = { lrn: string | null; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null; birth_date: string; sex: 'male' | 'female' };
type Candidate = Profile & { id: string; version: number };
type PreviewRow = { row: number; profile: Profile | null; action: 'create' | 'use_existing' | null; learner_id: string | null; candidates: Candidate[]; candidates_truncated: boolean };
type Issue = { row: number; field: string; code: string; message: string };
type Preview = { can_commit: boolean; preview_id: string | null; expires_at: string | null; section: { id: string; name: string; grade_level: number } | null; academic_year_id: string; grade_level: number; rows: PreviewRow[]; issues: Issue[] };
type Receipt = { preview_id: string; items: { row: number; learner_id: string; enrollment_id: string; action: 'create' | 'use_existing'; resolution_reason: string | null }[] };
type Template = { csv: string; max_rows: number; max_csv_bytes: number; instructions: string[] };

export type Resolution = { row: number; action: 'use_existing'; learner_id: string; version: number } | { row: number; action: 'create_distinct'; reason: string };

export { MAX_BYTES, MAX_ROWS, csvProblem, csvStats } from '../csv';
import { EnlistSheet } from './LateLearner';
import { ROSTER_HEADER, csvProblem, csvStats, MAX_BYTES, MAX_ROWS, rosterFileText, rosterTemplateWorkbook } from '../csv';
import { FileRules } from '../components/filerules';
import { downloadXlsx } from '../xlsx';

/** The resolutions a preview is sent with, one per row, in row order. */
export const resolutionList = (chosen: Record<number, Resolution>) => Object.values(chosen).sort((a, b) => a.row - b.row);

/**
 * Whether a row needs a person's decision before it can be imported: a
 * possible duplicate or an LRN already on file. The API never guesses which
 * existing learner a row means, and neither does this screen.
 */
export const needsDecision = (issues: Issue[], row: number) => issues.some(i => i.row === row && (i.code === 'POSSIBLE_DUPLICATE' || i.code === 'LRN_EXISTS'));

const tidy = (reason: string) => reason.trim().replace(/\s+/g, ' ');

/** One row's choice between the existing learners it may be, and a different child. */
function Decision({ row, chosen, setChosen }: { row: PreviewRow; chosen: Resolution | undefined; setChosen: (r: Resolution | null) => void }) {
  const id = useId();
  const distinct = chosen?.action === 'create_distinct' ? chosen : null;
  return (
    <fieldset className="choose">
      <legend className="label">Row {row.row}: who is this?</legend>
      {row.candidates.map(c => (
        <label key={c.id} className="check-line">
          <input type="radio" name={`${id}-who`} checked={chosen?.action === 'use_existing' && chosen.learner_id === c.id}
            onChange={() => setChosen({ row: row.row, action: 'use_existing', learner_id: c.id, version: c.version })} />
          <span>The learner already on file: <b>{learnerName(c)}</b> · {c.lrn ? <span className="mono">LRN {c.lrn}</span> : 'no LRN'} · born <span className="mono">{c.birth_date}</span></span>
        </label>
      ))}
      {row.candidates_truncated ? <p className="muted">There may be more matches than these. Search the registry if none of them is right.</p> : null}
      <label className="check-line">
        <input type="radio" name={`${id}-who`} checked={!!distinct} onChange={() => setChosen({ row: row.row, action: 'create_distinct', reason: '' })} />
        <span>A different child with a similar name</span>
      </label>
      {distinct ? (
        <div className="field wide">
          <label className="label" htmlFor={`${id}-why`}>Why they are a different child</label>
          <textarea id={`${id}-why`} minLength={10} maxLength={500} value={distinct.reason}
            onChange={event => setChosen({ ...distinct, reason: event.target.value })} />
          <span className="hint">10–500 characters, kept in the import receipt. Say which school record shows it; leave out unrelated personal details.</span>
        </div>
      ) : null}
      {chosen ? <button type="button" className="btn ghost small" onClick={() => setChosen(null)}>Undecide</button> : null}
    </fieldset>
  );
}

/**
 * Bring in a class list from a CSV, reviewed before anything is written.
 *
 * The file is read into this page's memory and nowhere else: it is not
 * uploaded until the preview, not stored by the server beyond a fingerprint,
 * and gone when the page is left. The commit sends the identical file and
 * decisions that were previewed, so what is imported is exactly what was
 * read on screen.
 */
export function Imports({ api, setStatus, reload, token, route }: Props) {
  const scope = useScope(api, token);
  const [template, setTemplate] = useState<Template | null>(null);
  const [enrolledOn, setEnrolledOn] = useState('');
  const [kind, setKind] = useState<'regular' | 'transfer_in'>('regular');
  /**
   * Every bulk import lands learners **on the registry at a grade, with no
   * class** (decided 2026-11-07). The school chose the one workflow: the
   * office registers by grade, the advisers take in their own from Learner
   * registry. So there is no longer anything to choose here, and the control
   * that asked has gone — a question with one answer is furniture.
   *
   * The value is kept because an adviser's submitted class list, from before
   * the change, is still imported into its own section; `openList` sets it.
   */
  const [into, setInto] = useState<'section' | 'registry'>('registry');
  const [grade, setGrade] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [chosen, setChosen] = useState<Record<number, Resolution>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  // An adviser's list being imported, and one waiting to fill the form once its section is on screen.
  const [fromList, setFromList] = useState<Submission | null>(null);
  const [pendingFill, setPendingFill] = useState<Submission | null>(null);
  const [enlisting, setEnlisting] = useState(false);
  const id = useId();

  useEffect(() => { void api<Template>('/roster-imports/template').then(setTemplate).catch(() => setTemplate(null)); }, [api]);

  const { year, section } = scope;
  useEffect(() => {
    if (!year) return;
    setEnrolledOn(clamp(localToday(), String(year.starts_on), String(year.ends_on)));
  }, [year?.id]);

  // A different file, section, date or kind makes the preview describe
  // something else entirely. A changed decision does not: the rows stay on
  // screen, because that is where decisions are made, and the preview is
  // marked stale until it is run again.
  useEffect(() => { setPreview(null); setSent(null); }, [csv, scope.sectionId, enrolledOn, kind, into, grade]);
  useEffect(() => { setChosen({}); setReceipt(null); }, [csv, scope.sectionId, into, grade]);
  // An adviser's submitted list is always a section's, so opening one puts the
  // choice back to a section rather than importing their class onto no class.
  useEffect(() => { if (fromList) setInto('section'); }, [fromList]);

  // The year and section switch first; the list goes in once they are the ones on screen,
  // so the date reset that follows a change of year cannot overwrite it.
  useEffect(() => {
    if (!pendingFill || scope.yearId !== pendingFill.academic_year_id || scope.sectionId !== pendingFill.section_id) return;
    setEnrolledOn(pendingFill.enrolled_on);
    setKind(pendingFill.entry_kind);
    setFileName('');
    setCsv(pendingFill.csv ?? '');
    setPendingFill(null);
  }, [pendingFill, scope.yearId, scope.sectionId]);

  const openList = (list: Submission) => {
    setFromList(list);
    setPendingFill(list);
    scope.setYearId(list.academic_year_id);
    // A list submitted at a grade has no section to open into, and since 0061
    // the two shapes are imported differently: that one lands on the registry
    // at its grade, which is what `into` selects below.
    if (list.section_id) { setInto('section'); scope.setSectionId(list.section_id); }
    else { setInto('registry'); setGrade(String(list.grade_level)); }
    setLocal({ text: list.section_name
      ? `Opened the class list for ${gradeName(list.grade_level)} · ${list.section_name}. Preview it below.`
      : `Opened the list for ${gradeName(list.grade_level)}, which lands on the registry with no class. Preview it below.`, kind: 'done' });
  };

  const problem = csvProblem(csv);
  const stats = csvStats(csv);
  const closed = year?.status === 'closed';
  /**
   * Whether a destination has been chosen. A section says all three. Without
   * one the school year is enough: since the template carries a grade per row
   * the file may name its own, so **the grade here is optional** and stands
   * only for the rows that leave theirs empty. Requiring it was what stopped
   * a mixed-grade file being imported at all.
   */
  const target = into === 'section' ? !!scope.sectionId : !!scope.yearId;

  // Into a section, or onto the registry at a grade with no class yet. The
  // second is how a school puts every learner on the registry before classes
  // are settled; assigning a class afterwards is a movement on the enrolment,
  // not a second enrolment.
  const body = () => ({
    ...(into === 'section'
      ? { section_id: scope.sectionId }
      // Omitted entirely when nothing is chosen, rather than sent as a null
      // or a NaN: the API reads its absence as "every row says its own".
      : { section_id: null, academic_year_id: scope.yearId, ...(grade === '' ? {} : { grade_level: Number(grade) }) }),
    enrolled_on: enrolledOn, entry_kind: kind, csv,
    resolutions: resolutionList(chosen).map(r => (r.action === 'create_distinct' ? { ...r, reason: tidy(r.reason) } : r)),
  });

  const runPreview = async () => {
    setBusy(true);
    setLocal({ text: 'Checking the file…', kind: 'busy' });
    const payload = body();
    try {
      const result = await api<Preview>('/roster-imports/preview', 'POST', payload);
      setPreview(result);
      setSent(payload);
      setLocal(result.can_commit ? { text: 'Every row is ready. Read the list below, then confirm.', kind: 'done' } : { text: 'Some rows need attention before anything can be imported.', kind: 'error' });
    } catch (error) { setLocal({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!preview?.preview_id || !sent) return;
    setBusy(true);
    setLocal({ text: 'Importing…', kind: 'busy' });
    try {
      const result = await api<Receipt>(`/roster-imports/${preview.preview_id}/commit`, 'POST', { ...sent, confirmed: true });
      setReceipt(result);
      setPreview(null);
      setLocal(idle);
      let note = '';
      // Only the very list the adviser sent, imported into their section, accepts it; the database checks the same.
      if (fromList && sent.section_id === fromList.section_id && sent.csv === fromList.csv) {
        try {
          await api(`/roster-submissions/${fromList.id}/decision`, 'POST', { version: fromList.version, decision: 'accepted', import_id: preview.preview_id, reason: `Imported through the reviewed roster import, receipt ${preview.preview_id}.` });
          note = ' The adviser\'s list is marked imported.';
        } catch (error) { note = ` The import succeeded, but the adviser's list could not be marked imported: ${message(error)}`; }
        setFromList(null);
      }
      setStatus({ text: `${result.items.length} ${result.items.length === 1 ? 'learner' : 'learners'} imported and enrolled.${note}`, kind: 'done' });
      reload();
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'PREVIEW_CHANGED' || error.code === 'PREVIEW_EXPIRED' || error.code === 'NOT_FOUND')) { setPreview(null); setSent(null); }
      setLocal({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  const download = () => {
    if (!template) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([template.csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'edunexus-roster-template.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={4} /></div></>;
  // A year with no sections yet is no longer a dead end: learners can be
  // registered onto it at a grade, which is the whole point of that mode.
  if (!scope.years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState title="No school year to import into" body="An import enrols learners for one school year. Create the year first; its sections can come afterwards." /></div>
      </>
    );
  }

  const stale = !!sent && JSON.stringify(body()) !== JSON.stringify(sent);
  const byRow = (row: number) => (preview?.issues ?? []).filter(i => i.row === row);
  const batch = byRow(0);
  const creating = preview?.rows.filter(r => r.action === 'create').length ?? 0;
  const existing = preview?.rows.filter(r => r.action === 'use_existing').length ?? 0;

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          <button type="button" className="btn secondary" onClick={() => { void downloadXlsx('edunexus-class-list-template.xlsx', rosterTemplateWorkbook()).catch(error => setStatus({ text: message(error), kind: 'error' })); }}>
            <Icon name="imports" size={15} />Download the template (Excel)
          </button>
          <button type="button" className="btn secondary" disabled={!template} onClick={download}><Icon name="imports" size={15} />Template as CSV</button>
          <button type="button" className="btn" disabled={!scope.year || !scope.sections?.length} onClick={() => setEnlisting(true)}><Icon name="plus" size={15} />Enlist one late learner</button>
        </>}
      />
      {enlisting && scope.year && scope.sections?.length ? (
        <EnlistSheet api={api} year={scope.year} sections={scope.sections} onClose={() => setEnlisting(false)}
          onDone={text => { setEnlisting(false); reload(); setStatus({ text, kind: 'done' }); }} />
      ) : null}

      <AdviserLists api={api} token={token} onOpen={openList} setStatus={setStatus} />

      <div className="card">
        {fromList ? (
          <div className="card-body">
            <Callout tone="info" title={`Importing the list ${fromList.submitted_by_name ?? 'an adviser'} submitted`}>
              For {gradeName(fromList.grade_level)} · {fromList.section_name}, {fromList.row_count} {fromList.row_count === 1 ? 'learner' : 'learners'}. Preview it as any import, resolve any learner already on file, and confirm. Confirming marks the adviser's list imported, as long as the section and the list are unchanged.
              {' '}<button type="button" className="btn ghost small" onClick={() => setFromList(null)}>Stop using this list</button>
            </Callout>
          </div>
        ) : null}
        <div className="card-head">
          <div>
            <h2>1. Which grade, and from when</h2>
            <p className="card-note">
              {into === 'section'
                ? 'An adviser’s own class list, imported into their class.'
                : 'Every learner in one file is registered and enrolled at one grade, with no class yet. Their advisers take in the ones who are theirs afterwards.'}
            </p>
          </div>
        </div>
        <div className="card-body">
          {fromList ? <p className="muted">An adviser’s submitted class list is imported into their section.</p> : null}
          {into === 'registry' ? (
            <Callout tone="info" title="These learners will have no class until an adviser takes them in">
              They are on the registry and enrolled for the year, so they count on the enrolment totals. They appear as <b>not in a class</b> on the SF4, which is
              refused until every registered learner is in one, and they are on no section’s register. Each adviser then takes in the learners at their class’s
              grade, from <b>Add learner</b> on <b>Learner registry</b>; a manager can place one on <b>Enrollment</b>. A learner already enrolled this year is
              refused a second time, so import each learner once.
              {' '}The template has a <span className="mono">grade_level</span> column, so one file can hold several grades; choose <b>Enrol at grade</b> only to
              stand for the rows that leave theirs empty. A row with neither is named on its own line below.
            </Callout>
          ) : null}
        </div>
        <div className="card-head">
          <div className="toolbar">
            <ScopePickers scope={scope} yearOnly={into === 'registry'} />
            {into === 'registry' ? (
              <div className="field inline">
                <label className="label" htmlFor={`${id}-grade`}>Enrol at grade<span className="optional">Optional</span></label>
                <Select id={`${id}-grade`} value={grade} onChange={event => setGrade(event.target.value)}>
                  <option value="">Each row says its own</option>
                  {[0, 1, 2, 3, 4, 5, 6].map(g => <option key={g} value={String(g)}>{gradeName(g)}</option>)}
                </Select>
              </div>
            ) : null}
            <div className="field inline">
              <label className="label" htmlFor={`${id}-on`}>{into === 'section' ? 'First day in the section' : 'First day enrolled'}</label>
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
          <div className="card-head-actions">{closed ? <Badge tone="neutral">Closed year — cannot import</Badge> : null}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>2. The class list</h2>
            <p className="card-note">The EDUNEXUS class-list template, as an Excel or CSV file, up to {MAX_ROWS} learners. It stays in this page until you preview it.</p>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field wide">
              <label className="label" htmlFor={`${id}-file`}>Excel or CSV file</label>
              <input id={`${id}-file`} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                try { setCsv(await rosterFileText(file)); } catch (error) { setFileName(''); setStatus({ text: message(error), kind: 'error' }); }
              }} />
              <FileRules header={template?.csv.trim() ?? ROSTER_HEADER} />
            </div>
          </div>
          <Task title="Paste the CSV text instead" note="For a list copied from a text editor">
            <div className="field wide">
              <label className="label" htmlFor={`${id}-text`}>CSV text</label>
              <textarea id={`${id}-text`} className="mono" rows={8} value={csv} onChange={event => { setFileName(''); setCsv(event.target.value); }} />
            </div>
          </Task>
          {csv ? (
            <p className="card-note">
              {fileName ? <><b>{fileName}</b> · </> : null}{stats.rows} {stats.rows === 1 ? 'learner' : 'learners'} · {stats.bytes.toLocaleString()} of {MAX_BYTES.toLocaleString()} bytes
              {' '}<button type="button" className="btn ghost small" onClick={() => { setCsv(''); setFileName(''); }}>Clear</button>
            </p>
          ) : null}
          {problem ? <Callout tone="attention" title="This file cannot be sent">{problem}</Callout> : null}
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || !csv.trim() || !!problem || !target || !enrolledOn || closed} aria-busy={busy && !preview} onClick={() => void runPreview()}>
              {busy && !preview ? 'Checking…' : preview ? 'Preview again' : 'Preview the import'}
            </button>
          </div>
        </div>
      </div>

      <StatusLine status={status} />

      {preview ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>3. Review</h2>
              <p className="card-note">
                {preview.section
                  ? <>Into <b>{gradeName(preview.section.grade_level)} · {preview.section.name}</b></>
                  : <>Onto the registry at <b>{gradeName(preview.grade_level)}</b>, <b>with no class yet</b></>}
                {' '}from <span className="mono">{enrolledOn}</span> as {kind === 'regular' ? 'regular enrollment' : 'transfers in'}.
                {preview.can_commit ? <> {creating} new {creating === 1 ? 'record' : 'records'}, {existing} already on file.</> : null}
              </p>
            </div>
          </div>
          {batch.length ? <div className="card-body"><Callout tone="stopped" title="The whole import is refused"><ul>{batch.map(i => <li key={i.code}>{i.message}</li>)}</ul></Callout></div> : null}
          <Table
            rows={preview.rows}
            rowKey={r => String(r.row)}
            empty={<p className="muted">The file had no learners.</p>}
            columns={[
              { header: 'Row', cell: r => <span className="mono">{r.row}</span>, numeric: true },
              { header: 'Learner', cell: r => (r.profile ? <Cell title={learnerName(r.profile)} meta={r.profile.lrn ? <span className="mono">LRN {r.profile.lrn}</span> : <Unrecorded label="LRN missing" />} /> : <Unrecorded label="Unreadable row" />) },
              { header: 'Born', cell: r => (r.profile ? <span className="mono">{r.profile.birth_date}</span> : null) },
              { header: 'Sex', cell: r => (r.profile ? sentence(r.profile.sex) : null) },
              {
                header: 'Will', cell: r => {
                  const issues = byRow(r.row);
                  if (issues.length) return <ul className="plain">{issues.map(i => <li key={i.code + i.field} className="field-error"><Icon name="alert" size={14} />{i.message}</li>)}</ul>;
                  return r.action === 'use_existing' ? <Badge tone="info">Enrol the learner on file</Badge> : <Badge tone="good">Register and enrol</Badge>;
                },
              },
            ]}
            detailLabel="Decide"
            actionsLabel="Duplicates"
            detail={r => (needsDecision(preview.issues, r.row) || chosen[r.row]
              ? <Decision row={r} chosen={chosen[r.row]} setChosen={next => setChosen(current => {
                  const copy = { ...current };
                  if (next) copy[r.row] = next; else delete copy[r.row];
                  return copy;
                })} />
              : <p className="muted">Nothing to decide for this row.</p>)}
          />
          <div className="card-body">
            {stale ? (
              <Callout tone="attention" title="Your decisions changed since this preview">
                Preview again so the server checks them. Nothing can be imported from a preview that no longer matches what is on screen.
                <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => void runPreview()}>Preview again</button></div>
              </Callout>
            ) : preview.can_commit && preview.preview_id ? (
              <>
                <p className="muted">
                  This review holds until {preview.expires_at ? <span className="mono">{new Date(preview.expires_at).toLocaleTimeString()}</span> : 'it expires'}. Importing writes every row or none: a failure on one row imports nothing.
                  If you confirm and never see a response, confirm again — the same review returns the original receipt rather than importing twice.
                </p>
                <div className="form-actions">
                  <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void commit()}>
                    {busy ? 'Importing…' : `Import ${preview.rows.length} ${preview.rows.length === 1 ? 'learner' : 'learners'}`}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Open a row marked for a decision, choose who it is, then preview again. Existing records are never overwritten: a row that disagrees with the learner on file is corrected on the registry first.</p>
            )}
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="card">
          <div className="card-head"><div><h2>Imported</h2><p className="card-note">Receipt <span className="mono">{receipt.preview_id}</span>. The class is on the Enrollment screen.</p></div></div>
          <Table
            rows={receipt.items}
            rowKey={r => String(r.row)}
            columns={[
              { header: 'Row', cell: r => <span className="mono">{r.row}</span>, numeric: true },
              { header: 'Result', cell: r => (r.action === 'create' ? 'Registered and enrolled' : 'Existing learner enrolled') },
              { header: 'Reason given', cell: r => r.resolution_reason ?? <Unrecorded label="None needed" /> },
            ]}
          />
        </div>
      ) : null}

      <Callout tone="info" title="What this does not do">
        This is the EDUNEXUS template, not a DepEd LIS export or an arbitrary spreadsheet. It never overwrites a learner already on file, never fills in a pending LRN, and never guesses a date or a spelling. Imports into {section ? sectionName(section) : 'a section'} are logged, and the file itself is not kept.
      </Callout>
    </>
  );
}
