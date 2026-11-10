import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { Sheet } from '../components/overlay';
import { PrintCopy } from '../components/print';
import { SeededNotice } from '../components/seeded';
import { Icon } from '../components/icons';
import { StatTile } from '../components/figures';
import { Badge, Callout, Cell, EmptyState, PageHeader, Select, Spinner, StatusLine, Table, TableSkeleton, Task, gradeName, learnerName, localToday, type Status } from '../components/primitives';
import { hashParams } from './OutcomeQueue';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };
type Learner = {
  enrollment_id: string; learner_id: string; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null;
  sex: 'male' | 'female'; from_grade: number; from_section: string | null; action: 'promoted' | 'conditionally_promoted' | 'retained' | 'remedial' | null; outcome_status: string | null;
};
type Reason = 'left' | 'no_outcome' | 'not_approved' | 'remedial' | 'completer' | 'already_enrolled';
type Preview = {
  source_year: { id: string; start_year: number; status: string };
  target_year: { id: string; start_year: number; starts_on: string; status: string };
  grade_level: number | null; review_hash: string;
  grades: { grade_level: number; carried: { male: number; female: number } }[];
  placements: (Learner & { to_grade: number })[];
  unplaced: (Learner & { to_grade: number | null; reason: Reason })[];
  runs: { id: string; grade_level: number | null; seed: number; placed: number; reason: string; actor_name: string | null; recorded_at: string }[];
};

const idle: Status = { kind: 'idle', text: '' };
const yearLabel = (start: number) => `${start}–${start + 1}`;
const outcomeWord = { promoted: 'Promoted', conditionally_promoted: 'Conditionally promoted', retained: 'Retained', remedial: 'Remedial' } as const;
/** Why a learner is not carried forward, in the order a manager acts on them: the ones waiting on someone first. */
const reasonInfo: Record<Reason, { title: string; note: string; act?: boolean }> = {
  not_approved: { title: 'Outcome not approved yet', note: 'Endorsed, waiting on the principal or administrative officer', act: true },
  no_outcome: { title: 'No outcome recorded', note: 'The adviser has not endorsed one', act: true },
  remedial: { title: 'Remedial', note: 'Placed once the remedial class decides', act: true },
  already_enrolled: { title: 'Already enrolled next year', note: 'Nothing to do' },
  completer: { title: 'Completed Grade 6', note: 'Elementary school done' },
  left: { title: 'Left during the year', note: 'Withdrawn or transferred out' },
};
/** This year's class, or a plain statement that they were never given one. */
const fromClass = (l: Learner) => `${gradeName(l.from_grade)}${l.from_section ? ` · ${l.from_section}` : ' · no section'}`;

/**
 * Next year's classes, prepared from this year's approved outcomes. Who moves
 * up is the school's decision, recorded on Report cards; this screen carries
 * them into the grade that decision leads to and enrols them all at once. It
 * assigns no section: a class is given to a learner separately, afterwards.
 */
export function NextYear({ api, me, setStatus, token, route }: Props) {
  const [years, setYears] = useState<Row[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  // Opened from the Overview for one grade, as `#/next-year?grade=3`.
  const [grade, setGrade] = useState(() => { const g = hashParams().get('grade'); return g && /^[0-6]$/.test(g) ? g : ''; });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Set when an enrolment was refused because the preview went stale, until the fresh draw says why.
  const [stale, setStale] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [printing, setPrinting] = useState(false);
  // One grade card pressed narrows the list; null shows every grade.
  const [focus, setFocus] = useState<number | null>(null);
  const id = useId();

  useEffect(() => {
    void api<Page>('/academic-years').then(page => {
      setYears(page.items);
      setSourceId(current => (page.items.some(y => y.id === current) ? current : String((page.items.find(y => y.status === 'active') ?? page.items[0])?.id ?? '')));
    }).catch(error => { setYears([]); setStatus({ kind: 'error', text: message(error) }); });
  }, [api, token]);

  const source = years?.find(y => y.id === sourceId);
  const target = source ? years?.find(y => Number(y.start_year) === Number(source.start_year) + 1) : undefined;

  useEffect(() => {
    if (!source || !target) { setPreview(null); return; }
    setPreview(null); setFailed(null);
    void api<Preview>(`/academic-years/${source.id}/next-year-classes${query({ target_year_id: String(target.id), grade_level: grade || undefined })}`)
      .then(setPreview).catch(error => setFailed(message(error)));
  }, [api, source?.id, target?.id, grade, tick, token]);

  // A refused enrolment is told apart from one that already happened: in another tab, or by a colleague,
  // the same classes may have been enrolled a moment ago, and "nobody was enrolled" would read as a loss.
  useEffect(() => {
    if (!stale || !preview) return;
    setStale(false);
    const last = preview.runs[0];
    setStatus(!preview.placements.length && last
      ? { kind: 'done', text: `Nobody is left to place: ${last.placed} ${last.placed === 1 ? 'learner was' : 'learners were'} already enrolled from this screen${last.actor_name ? ` by ${last.actor_name}` : ''} at ${new Date(last.recorded_at).toLocaleString()}.` }
      : { kind: 'error', text: 'Something changed since that preview was drawn, so nobody was enrolled. It has been drawn again: check it, then enrol.' });
  }, [stale, preview]);

  if (years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={5} /></div></>;
  if (!source) return <><PageHeader route={route} /><div className="card"><EmptyState title="No school year yet" body="Next year’s classes come from a school year’s approved outcomes. Create the year first." /></div></>;

  const count = (...reasons: Reason[]) => preview?.unplaced.filter(u => reasons.includes(u.reason)).length ?? 0;
  // A grade card pressed narrows the list to that grade; pressed again, every grade.
  const shown = (preview?.placements ?? []).filter(p => focus === null || p.to_grade === focus);
  const groups = (preview?.grades ?? []).filter(g => focus === null || g.grade_level === focus)
    .map(g => ({ grade: g, list: shown.filter(p => p.to_grade === g.grade_level) }))
    .filter(g => g.list.length);
  const waitingOn = count('no_outcome', 'not_approved', 'remedial');
  // Where the year stands, as three steps (the UI notes of 8 November, note 2). Counted, never estimated.
  const enrolledBefore = (preview?.runs ?? []).reduce((sum, r) => sum + Number(r.placed), 0);
  // Enrolling the learners already decided is possible while others wait, so the third step is "ready" rather than current then.
  const steps: { title: string; note: string; state: 'done' | 'now' | 'ready' | 'later' }[] = [
    { title: 'Choose the year', note: target ? `${yearLabel(Number(source.start_year))} into ${yearLabel(Number(target.start_year))}` : `No ${yearLabel(Number(source.start_year) + 1)} year yet`, state: target ? 'done' : 'now' },
    { title: 'Check who moves up', note: !preview ? 'Reading the outcomes…' : waitingOn ? `${waitingOn} still waiting on an outcome` : 'Every outcome is decided', state: !target ? 'later' : preview && !waitingOn ? 'done' : 'now' },
    { title: 'Enrol', note: preview?.placements.length ? `${preview.placements.length} ready to enrol` : enrolledBefore ? `${enrolledBefore} enrolled already` : 'Nobody to enrol yet', state: !preview ? 'later' : preview.placements.length ? (waitingOn ? 'ready' : 'now') : enrolledBefore ? 'done' : 'later' },
  ];
  const reasonGroups = (Object.keys(reasonInfo) as Reason[])
    .map(reason => ({ reason, list: (preview?.unplaced ?? []).filter(u => u.reason === reason) }))
    .filter(g => g.list.length);

  return (
    <>
      <PageHeader route={route} actions={preview?.placements.length
        ? <button type="button" className="btn" onClick={() => setEnrolling(true)}><Icon name="enter" size={15} />Enrol {preview.placements.length} {preview.placements.length === 1 ? 'learner' : 'learners'}</button>
        : null} />

      <ol className="steps" aria-label="Where next year’s classes stand">
        {steps.map((step, i) => (
          <li key={step.title} className={`step ${step.state}`} aria-current={step.state === 'now' ? 'step' : undefined}>
            <span className="step-mark" aria-hidden="true">{step.state === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="step-text"><b>{step.title}</b><span>{step.note}</span></span>
          </li>
        ))}
      </ol>

      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <div className="field">
              <label className="label" htmlFor={`${id}-year`}>From the school year</label>
              <Select id={`${id}-year`} value={sourceId} onChange={e => { setSourceId(e.target.value); setFocus(null); }}>
                {years.map(y => <option key={String(y.id)} value={String(y.id)}>{yearLabel(Number(y.start_year))}</option>)}
              </Select>
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-grade`}>Grade next year</label>
              <Select id={`${id}-grade`} value={grade} onChange={e => { setGrade(e.target.value); setFocus(null); }}>
                <option value="">Every grade</option>
                {[0, 1, 2, 3, 4, 5, 6].map(g => <option key={g} value={String(g)}>{gradeName(g)}</option>)}
              </Select>
            </div>
            {preview?.placements.length ? <button type="button" className="btn secondary" onClick={() => setPrinting(true)}><Icon name="print" size={15} />Print the list</button> : null}
          </div>
          <p className="card-note">Each learner moves to the grade their approved outcome on <b>Promotion</b> leads to. No class is chosen here: they wait in the registry at their new grade until an adviser takes them in.</p>
        </div>
        {!target ? (
          <div className="card-body"><Callout tone="attention" title={`No ${yearLabel(Number(source.start_year) + 1)} school year yet`}>Create the {yearLabel(Number(source.start_year) + 1)} school year and its sections on <b>School years &amp; sections</b>, then come back here.</Callout></div>
        ) : failed ? (
          <div className="card-body"><Callout tone="stopped" title="The classes could not be read">{failed}</Callout></div>
        ) : !preview ? (
          <div className="card-body"><TableSkeleton columns={5} /></div>
        ) : null}
      </div>

      {target && preview && !failed ? (
        <>
          <div className="tiles">
            <StatTile label="To enrol" value={preview.placements.length} meta={`into ${yearLabel(preview.target_year.start_year)}, from ${preview.target_year.starts_on}`} accent={0} />
            <StatTile label="Completed Grade 6" value={count('completer')} meta="Not placed: elementary school done" accent={1} />
            <StatTile label="Waiting on an outcome" value={waitingOn} meta="Remedial, or not approved yet" accent={2} />
            <StatTile label="Already enrolled" value={count('already_enrolled')} meta={`in ${yearLabel(preview.target_year.start_year)}`} accent={3} />
          </div>

          {/* One card per grade next year, its boys and girls drawn as counts. Pressing one shows that grade alone. */}
          {preview.grades.length ? (
            <div className="grade-cards" role="group" aria-label="Grades next year">
              {preview.grades.map(g => {
                const total = g.carried.male + g.carried.female;
                const pressed = focus === g.grade_level;
                const boys = total ? (g.carried.male / total) * 100 : 0;
                return (
                  <button key={g.grade_level} type="button" className="grade-card" aria-pressed={pressed}
                    onClick={() => setFocus(pressed ? null : g.grade_level)}>
                    <span className="grade-card-name">{gradeName(g.grade_level)}</span>
                    <b className="grade-card-total">{total}</b>
                    <svg className="grade-card-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                      <rect className="bar-male" x="0" y="0" height="6" width={boys} />
                      <rect className="bar-female" x={boys} y="0" height="6" width={total ? 100 - boys : 0} />
                    </svg>
                    <span className="grade-card-meta"><span className="swatch-m" aria-hidden="true" />{g.carried.male} male <span className="swatch-f" aria-hidden="true" />{g.carried.female} female</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="card"><EmptyState title="Nobody to carry forward" body="No approved outcome in this school year leads into the next one yet. Outcomes are endorsed and approved on Promotion." /></div>
          )}

          {groups.length ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Learners carried forward{focus === null ? '' : ` into ${gradeName(focus)}`}</h2>
                  <p className="card-note">Grouped by the grade they move to. Each is enrolled with no section, and taken into a class afterwards.</p>
                </div>
                {focus === null ? null : <div className="card-head-actions"><button type="button" className="btn ghost" onClick={() => setFocus(null)}>Show every grade</button></div>}
              </div>
              {groups.map(({ grade: g, list }) => (
                <section key={g.grade_level} className="carry-group" aria-labelledby={`${id}-g${g.grade_level}`}>
                  <h3 id={`${id}-g${g.grade_level}`}>{gradeName(g.grade_level)} <span className="muted">· {list.length} {list.length === 1 ? 'learner' : 'learners'}</span></h3>
                  <Table
                    stack
                    rows={list}
                    rowKey={p => p.enrollment_id}
                    columns={[
                      { header: 'Learner', cell: p => <Cell title={learnerName(p)} meta={p.sex === 'male' ? 'Male' : 'Female'} /> },
                      { header: `In ${yearLabel(preview.source_year.start_year)}`, cell: p => fromClass(p) },
                      { header: 'Outcome', cell: p => (p.action ? <Badge tone={p.action === 'retained' ? 'info' : 'good'}>{outcomeWord[p.action]}</Badge> : null) },
                    ]}
                  />
                </section>
              ))}
            </div>
          ) : null}

          {reasonGroups.length ? (
            <div className="card">
              <div className="card-head"><div>
                <h2>Not carried forward</h2>
                <p className="card-note">Grouped by why. Those waiting on an outcome are carried forward once it is approved on Promotion.</p>
              </div></div>
              <div className="card-body">
                {reasonGroups.map(({ reason, list }) => (
                  <Task key={reason} title={`${reasonInfo[reason].title} · ${list.length}`} note={reasonInfo[reason].note}>
                    {reasonInfo[reason].act ? <p className="muted"><a href="#/report-cards">Open Promotion</a> to decide these outcomes.</p> : null}
                    <Table
                      stack
                      rows={list}
                      rowKey={u => u.enrollment_id}
                      columns={[
                        { header: 'Learner', cell: u => <Cell title={learnerName(u)} meta={u.sex === 'male' ? 'Male' : 'Female'} /> },
                        { header: `In ${yearLabel(preview.source_year.start_year)}`, cell: u => fromClass(u) },
                      ]}
                    />
                  </Task>
                ))}
              </div>
            </div>
          ) : null}

          {preview.runs.length ? (
            <Task title="Enrolled from this screen before" note={`${preview.runs.length} ${preview.runs.length === 1 ? 'time' : 'times'}`}>
              <Table
                rows={preview.runs}
                rowKey={r => r.id}
                columns={[
                  { header: 'When', cell: r => <Cell title={new Date(r.recorded_at).toLocaleString()} meta={r.actor_name ?? undefined} /> },
                  { header: 'Grade', cell: r => (r.grade_level === null ? 'Every grade' : gradeName(r.grade_level)) },
                  { header: 'Enrolled', cell: r => r.placed },
                  { header: 'Reason', cell: r => <span className="note-text">{r.reason}</span> },
                ]}
              />
            </Task>
          ) : null}
        </>
      ) : null}
      {enrolling && preview ? <EnrolSheet api={api} preview={preview} onClose={() => setEnrolling(false)}
        onChanged={() => { setPreview(null); setStale(true); setTick(t => t + 1); }}
        onDone={placed => { setEnrolling(false); setTick(t => t + 1); setStatus({ kind: 'done', text: `${placed} ${placed === 1 ? 'learner' : 'learners'} enrolled in ${yearLabel(preview.target_year.start_year)}.` }); }} /> : null}
      {preview ? (
        <PrintCopy printing={printing} onPrinted={() => setPrinting(false)} long>
          <SeededNotice me={me} />
          {preview.grades.map(g => {
            const list = preview.placements.filter(p => p.to_grade === g.grade_level);
            return (
              <div className="paper" key={g.grade_level}>
                <h2>{gradeName(g.grade_level)}</h2>
                <p className="paper-sub">School Year {yearLabel(preview.target_year.start_year)} · Carried forward, not yet in a class</p>
                <table className="paper-grid card-table">
                  <thead><tr><th>No.</th><th>Learner</th><th>Sex</th><th>{yearLabel(preview.source_year.start_year)}</th><th>Outcome</th></tr></thead>
                  <tbody>{list.map((p, i) => (
                    <tr key={p.enrollment_id}><td className="numeric">{i + 1}</td><td>{learnerName(p)}</td><td>{p.sex === 'male' ? 'M' : 'F'}</td>
                      <td>{fromClass(p)}</td><td>{p.action ? outcomeWord[p.action] : ''}</td></tr>
                  ))}</tbody>
                </table>
                <p className="print-foot">{g.carried.male} male, {g.carried.female} female. Printed {localToday()} from EDUNEXUS, before enrolment. Carried forward from approved outcomes; no section is assigned here.</p>
              </div>
            );
          })}
        </PrintCopy>
      ) : null}
    </>
  );
}

/** The one write: every learner drawn, enrolled together, with a reason, from exactly the preview on screen. */
function EnrolSheet({ api, preview, onClose, onChanged, onDone }: { api: Api; preview: Preview; onClose: () => void; onChanged: () => void; onDone: (placed: number) => void }) {
  const [reason, setReason] = useState(`Carried into ${yearLabel(preview.target_year.start_year)} from the approved ${yearLabel(preview.source_year.start_year)} outcomes.`);
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const go = async (event: FormEvent) => {
    event.preventDefault();
    const text = reason.replace(/\s+/g, ' ').trim();
    if (text.length < 10) { setLocal({ kind: 'error', text: 'Give a reason of at least 10 characters.' }); return; }
    setBusy(true);
    try {
      const done = await api<{ placed: number }>(`/academic-years/${preview.source_year.id}/next-year-classes`, 'POST',
        { target_year_id: preview.target_year.id, grade_level: preview.grade_level, review_hash: preview.review_hash, reason: text });
      onDone(done.placed);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PLACEMENT_CHANGED') { onChanged(); onClose(); return; }
      setLocal({ kind: 'error', text: message(error) });
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={`Enrol ${preview.placements.length} ${preview.placements.length === 1 ? 'learner' : 'learners'} in ${yearLabel(preview.target_year.start_year)}`}
      note={`All of them or none, from ${preview.target_year.starts_on}, each at the grade their outcome leads to and none in a section.`} onClose={onClose}>
      <StatusLine status={status} />
      <Callout tone="info">Nobody is given a section here. Each learner is enrolled at their next grade and waits in the registry until they are taken into a class. If anything changed since this preview was read, nothing is enrolled and it is read again.</Callout>
      <form onSubmit={go}>
        <Table rows={preview.grades} rowKey={g => String(g.grade_level)} columns={[
          { header: 'Grade next year', cell: g => gradeName(g.grade_level) },
          { header: 'Carried into it', cell: g => <span className="mono">{g.carried.male} M · {g.carried.female} F</span> },
        ]} />
        <div className="form-grid">
          <div className="field wide">
            <label className="label" htmlFor={`${id}-reason`}>Reason</label>
            <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Enrolling…</> : `Enrol ${preview.placements.length}`}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
