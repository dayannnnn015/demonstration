import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Api } from '../api';
import { ApiError, message } from '../api';
import { Confirm, Sheet } from '../components/overlay';
import { Icon } from '../components/icons';
import { Badge, Callout, Select, StatusLine, Table, Unrecorded, learnerName, idle, localToday, type Status, ScrollArea } from '../components/primitives';
import { coreValues, marks, valueCodes } from '../forms/values';
import { gradeProblem, type ReportLearner, type ReportRecords } from './ReportCards';
import { Affects } from '../components/affects';

/**
 * One learner's report card, typed box by box as it prints, from the group
 * leader's notes of 11 October: the learning areas down the side, each term's
 * grade, the subject average and remark across, the general average beneath,
 * and the observed values and the term's narratives or comments after it.
 * Every box that changed is recorded together or not at all, through
 * POST /enrollments/{id}/report-card. Nothing here computes a grade: the
 * subject averages and the general average are typed as the ECR shows them.
 */
export type Box = { key: string; label: string; kind: 'grade' | 'remark' | 'mark' | 'text' };
type Values = Record<string, string>;
/** One learner's records as `GET /enrollments/{id}/report-card` answers: the section's own read, narrowed to that learner. */
export type CardRecords = Omit<ReportRecords, 'learners'> & { learner: ReportLearner };

const NOTE_KINDS: Record<string, string> = { can_do: 'What the learner can do', to_improve: 'What the learner is learning to improve', comment: 'Teacher’s comment' };

function storedValues(l: ReportLearner): Values {
  const out: Values = {};
  for (const g of l.grades) {
    if (g.grade !== null) out[`g:${g.offering_id}:${g.reporting_period_id ?? 'final'}`] = String(g.grade);
    if (g.reporting_period_id === null && g.remark) out[`r:${g.offering_id}`] = g.remark;
  }
  if (l.summary?.general_average !== null && l.summary?.general_average !== undefined) out['a:grade'] = String(l.summary.general_average);
  if (l.summary?.remark) out['a:remark'] = l.summary.remark;
  for (const v of l.values) for (const [code, mark] of Object.entries(v.ratings)) if (mark) out[`v:${v.reporting_period_id}:${code}`] = mark;
  for (const n of l.notes) if (n.reporting_period_id && n.body && n.kind in NOTE_KINDS) out[`n:${n.kind}:${n.reporting_period_id}`] = n.body;
  return out;
}

/** What the card holds for this grade: the school's cards differ by grade, and Grade 1 is descriptive in 2026–2027. */
export function cardParts(grade: number, descriptive: boolean) {
  return { grades: !descriptive, values: grade >= 4, notes: grade === 1 ? ['can_do', 'to_improve'] : grade <= 3 ? ['comment'] : [] };
}

/**
 * A term accepts its records only once it has begun, on the date the school
 * configured for it (2026-11-09). A term already begun never closes, because
 * the ECR's figures arrive after the term is over. The API refuses the rest
 * with `PERIOD_NOT_STARTED`; this is so a box that cannot be recorded is not
 * offered as if it could.
 */
export const termOpen = (period: { starts_on: string }) => period.starts_on <= localToday();
export const unstartedTerms = (periods: { id: string; name: string; starts_on: string }[]) => periods.filter(p => !termOpen(p));

/** The learning areas a card lists: those offered now, and any no longer offered that the learner has a grade in. */
export const cardOfferings = (records: Pick<ReportRecords, 'offerings'>, learner: ReportLearner) =>
  records.offerings.filter(o => o.active || learner.grades.some(g => g.offering_id === o.id));

/** Every box on one learner's card, in the order the card prints them, each with the words a review reads. */
export function cardBoxes(records: Pick<ReportRecords, 'offerings' | 'periods' | 'section'>, learner: ReportLearner, descriptive: boolean): Box[] {
  const parts = cardParts(records.section.grade_level, descriptive);
  const boxes: Box[] = [];
  if (parts.grades) {
    for (const o of cardOfferings(records, learner)) {
      for (const p of records.periods) boxes.push({ key: `g:${o.id}:${p.id}`, label: `${o.name}, ${p.name}`, kind: 'grade' });
      boxes.push({ key: `g:${o.id}:final`, label: `${o.name}, subject average`, kind: 'grade' }, { key: `r:${o.id}`, label: `${o.name}, remark`, kind: 'remark' });
    }
    boxes.push({ key: 'a:grade', label: 'General average', kind: 'grade' }, { key: 'a:remark', label: 'General average, remark', kind: 'remark' });
  }
  if (parts.values) for (const p of records.periods) for (const code of valueCodes) boxes.push({ key: `v:${p.id}:${code}`, label: `${code}, ${p.name}`, kind: 'mark' });
  for (const kind of parts.notes) for (const p of records.periods) boxes.push({ key: `n:${kind}:${p.id}`, label: `${NOTE_KINDS[kind]}, ${p.name}`, kind: 'text' });
  return boxes;
}

/**
 * One card's draft: what each box shows, which boxes changed, and the single
 * request that records them. A box shows the draft if one was typed, else
 * what is recorded; a blank box is not recorded, never zero.
 */
export function useCardDraft(learner: ReportLearner | undefined) {
  const [draft, setDraft] = useState<Values>({});
  const stored = useMemo(() => (learner ? storedValues(learner) : {}), [learner]);
  const value = (key: string) => draft[key] ?? stored[key] ?? '';
  const changedKeys = Object.keys(draft).filter(k => draft[k]!.trim() !== (stored[k] ?? ''));
  return {
    stored, value, changedKeys,
    set: (key: string, v: string) => setDraft(d => ({ ...d, [key]: v })),
    discard: () => setDraft({}),
    problems: changedKeys.filter(k => k.startsWith('g:') || k === 'a:grade').map(k => gradeProblem(value(k))).filter(Boolean) as string[],
    body: () => (learner ? cardBody(learner, changedKeys, value) : {}),
  };
}

/** The card's changed boxes as `POST /enrollments/{id}/report-card` takes them, each part at the version it was read at. */
function cardBody(learner: ReportLearner, changedKeys: string[], value: (key: string) => string) {
  const card: Record<string, unknown> = { grades: [], summary: null, values: [], notes: [] };
  const grades = card.grades as Record<string, unknown>[];
  const touched = new Set<string>();
  for (const k of changedKeys) {
    if (k.startsWith('g:')) { const [, o, p] = k.split(':'); touched.add(`${o}:${p}`); }
    if (k.startsWith('r:')) touched.add(`${k.slice(2)}:final`);
  }
  for (const t of touched) {
    const [o, p] = t.split(':') as [string, string];
    const row = learner.grades.find(g => g.offering_id === o && (g.reporting_period_id ?? 'final') === p);
    const grade = value(`g:${o}:${p}`).trim();
    grades.push({ offering_id: o, reporting_period_id: p === 'final' ? null : p, grade: grade ? Number(grade) : null, ...(p === 'final' ? { remark: value(`r:${o}`) || null } : {}), version: row?.version ?? 0 });
  }
  if (changedKeys.some(k => k.startsWith('a:'))) {
    const average = value('a:grade').trim();
    card.summary = { general_average: average ? Number(average) : null, remark: value('a:remark') || null, version: learner.summary?.version ?? 0 };
  }
  for (const p of new Set(changedKeys.filter(k => k.startsWith('v:')).map(k => k.split(':')[1]!))) {
    const row = learner.values.find(v => v.reporting_period_id === p);
    (card.values as unknown[]).push({ reporting_period_id: p, ratings: Object.fromEntries(valueCodes.map(code => [code, value(`v:${p}:${code}`) || null])), version: row?.version ?? 0 });
  }
  for (const k of changedKeys.filter(k => k.startsWith('n:'))) {
    const [, kind, p] = k.split(':') as [string, string, string];
    const row = learner.notes.find(n => n.kind === kind && n.reporting_period_id === p);
    (card.notes as unknown[]).push({ kind, reporting_period_id: p, body: value(k).trim() || null, version: row?.version ?? 0 });
  }
  return card;
}

export function CardEditor({ api, records, descriptive, readOnly, manager = false, setStatus, onSaved, onDirty }: {
  api: Api; records: ReportRecords; descriptive: boolean; readOnly: boolean; manager?: boolean; setStatus: (s: Status) => void; onSaved: () => void;
  /** How many boxes are typed but not recorded, so the screen can ask before they are left. */
  onDirty?: ((count: number) => void) | undefined;
}) {
  const learners = records.learners;
  const [chosen, setChosen] = useState(learners[0]?.enrollment_id ?? '');
  const [leaving, setLeaving] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const learner = learners.find(l => l.enrollment_id === chosen) ?? learners[0];
  const index = learner ? learners.indexOf(learner) : -1;
  const parts = cardParts(records.section.grade_level, descriptive);
  const offerings = learner ? cardOfferings(records, learner) : [];
  const draft = useCardDraft(learner);
  const { stored, value, set, changedKeys, problems } = draft;
  // Another learner starts a clean card. A fresh read of the same records keeps what was typed: after a conflict
  // the boxes the adviser filled stay, and the boxes they left show what is on file now (testing finding F28).
  // A card that was recorded discards its draft, so what is shown is what is recorded.
  useEffect(() => { draft.discard(); }, [chosen]);
  useEffect(() => { onDirty?.(changedKeys.length); }, [changedKeys.length]);
  useEffect(() => () => onDirty?.(0), []);

  if (!learner) return <div className="card-body"><Callout tone="info" title="No learners in this section">A card appears here once a learner is enrolled in the section.</Callout></div>;

  const go = (id: string) => { if (changedKeys.length) setLeaving(id); else setChosen(id); };
  const changed = cardBoxes(records, learner, descriptive).filter(b => changedKeys.includes(b.key));
  const locked = readOnly || (manager && !correcting);

  const isChanged = (key: string) => changedKeys.includes(key);
  // A term that has not begun is shut, box by box, for the reason `termOpen` gives.
  // The subject average, the general average and their remarks name no term and stay open.
  const waiting = unstartedTerms(records.periods);
  const shut = (period?: string) => !!period && waiting.some(p => p.id === period);
  // The form-control styles hang on .field; a box has no label of its own beyond its aria-label.
  const gradeBox = (key: string, label: string, period?: string) => locked || shut(period) ? <Shown kind="grade" value={stored[key] ?? ''} /> : (
    <div className={`field cell-field grade${isChanged(key) ? ' changed' : ''}`}>
      <input className={`score-input${gradeProblem(value(key)) ? ' invalid' : ''}`} inputMode="decimal" aria-label={label} value={value(key)} onChange={e => set(key, e.target.value)} />
    </div>
  );
  const remarkBox = (key: string, label: string) => locked ? <Shown kind="remark" value={stored[key] ?? ''} /> : (
    <div className={`field cell-field remark${isChanged(key) ? ' changed' : ''}`}>
      <Select aria-label={label} value={value(key)} onChange={e => set(key, e.target.value)}><option value="">None</option><option value="passed">Passed</option><option value="failed">Failed</option></Select>
    </div>
  );

  return (
    <>
      <div className="card-head">
        <div className="toolbar">
          <div className="field inline">
            <span className="label">Learner</span>
            <Select aria-label="Learner" value={learner.enrollment_id} onChange={e => go(e.target.value)}>
              {learners.map(l => <option key={l.enrollment_id} value={l.enrollment_id}>{learnerName(l)}{l.status === 'withdrawn' ? ' (withdrawn)' : ''}</option>)}
            </Select>
          </div>
          <span className="muted">{index + 1} of {learners.length}</span>
        </div>
        <div className="card-head-actions">
          {manager && !readOnly && !correcting ? <button type="button" className="btn secondary small" onClick={() => setCorrecting(true)}>Correct this card</button> : null}
          <button type="button" className="btn ghost small" disabled={index <= 0} aria-label="Previous learner" title="Previous learner"
            onClick={() => go(learners[index - 1]!.enrollment_id)}><Icon name="back" size={14} /></button>
          <button type="button" className="btn ghost small" disabled={index >= learners.length - 1} aria-label="Next learner" title="Next learner"
            onClick={() => go(learners[index + 1]!.enrollment_id)}><Icon name="forward" size={14} /></button>
        </div>
      </div>
      <div className="card-body report-card-editor">
        <p className="card-note">Type each box as the ECR shows it. A blank box stays <i>not recorded</i>; it is never read as zero. {learner.lrn ? <>LRN <span className="mono">{learner.lrn}</span>.</> : 'LRN missing.'}</p>
        {waiting.length ? (
          <Callout tone="info" title={`${waiting.length === 1 ? 'One term has' : `${waiting.length} terms have`} not started yet`}>
            {waiting.map(p => `${p.name} (from ${p.starts_on})`).join(', ')}. Those boxes show what is on file and cannot be typed in: a term’s grades are encoded once it begins, on the date the school configured for it. The subject average, the general average and the remarks name no term and stay open.
          </Callout>
        ) : null}
        {parts.grades ? (
          <section aria-label="Report on learning progress and achievement">
            <h3>Report on learning progress and achievement</h3>
            {offerings.length ? (
              <ScrollArea>
                <table className="card-entry">
                  <thead>
                    <tr><th scope="col">Learning area</th>{records.periods.map(p => <th key={p.id} scope="col">{p.name}</th>)}<th scope="col">Subject average</th><th scope="col">Remark</th></tr>
                  </thead>
                  <tbody>
                    {offerings.map(o => (
                      <tr key={o.id}>
                        <th scope="row">{o.name}{o.active ? null : <span className="muted"> (no longer offered)</span>}</th>
                        {records.periods.map(p => <td key={p.id}>{gradeBox(`g:${o.id}:${p.id}`, `${o.name}, ${p.name}`, p.id)}</td>)}
                        <td>{gradeBox(`g:${o.id}:final`, `${o.name}, subject average`)}</td>
                        <td>{remarkBox(`r:${o.id}`, `${o.name}, remark`)}</td>
                      </tr>
                    ))}
                    <tr className="card-entry-average">
                      <th scope="row" colSpan={records.periods.length + 1}>General average</th>
                      <td>{gradeBox('a:grade', 'General average')}</td>
                      <td>{remarkBox('a:remark', 'General average, remark')}</td>
                    </tr>
                  </tbody>
                </table>
              </ScrollArea>
            ) : <Callout tone="attention" title="No learning areas offered">Offer the section its learning areas on Subjects & offerings first.</Callout>}
          </section>
        ) : null}
        {parts.values ? (
          <section aria-label="Observed values">
            <h3>Report on the learner’s observed values</h3>
            <ScrollArea>
              <table className="card-entry values">
                <thead><tr><th scope="col">Core values</th><th scope="col">Behaviour statements</th>{records.periods.map(p => <th key={p.id} scope="col">{p.name}</th>)}</tr></thead>
                <tbody>
                  {coreValues.flatMap(v => v.statements.map((s, i) => (
                    <tr key={s.code}>
                      {i === 0 ? <th scope="rowgroup" rowSpan={v.statements.length}>{v.value}</th> : null}
                      <td className="statement">{s.text}</td>
                      {records.periods.map(p => {
                        const key = `v:${p.id}:${s.code}`;
                        return <td key={p.id}>{locked || shut(p.id) ? <Shown kind="mark" value={stored[key] ?? ''} /> : (
                          <div className={`field cell-field mark${isChanged(key) ? ' changed' : ''}`}>
                            <Select aria-label={`${s.code}, ${p.name}`} title={s.text} value={value(key)} onChange={e => set(key, e.target.value)}>
                              <option value="">·</option>{marks.map(([c]) => <option key={c} value={c}>{c}</option>)}
                            </Select>
                          </div>
                        )}</td>;
                      })}
                    </tr>
                  )))}
                </tbody>
              </table>
            </ScrollArea>
            <p className="card-note">{marks.map(([c, l]) => `${c} ${l}`).join(' · ')}</p>
          </section>
        ) : null}
        {parts.notes.length ? (
          <section aria-label={records.section.grade_level === 1 ? 'Narratives' : 'Teacher’s comments'}>
            <h3>{records.section.grade_level === 1 ? 'Narratives' : 'Teacher’s comments'}</h3>
            <div className="form-grid">
              {records.periods.flatMap(p => parts.notes.map(kind => {
                const key = `n:${kind}:${p.id}`, label = `${NOTE_KINDS[kind]}, ${p.name}`;
                return (
                  <div key={key} className="field wide">
                    <span className="label">{label}</span>
                    {locked || shut(p.id) ? <Shown kind="text" value={stored[key] ?? ''} /> : <textarea className="note-input" rows={2} maxLength={1000} aria-label={label} value={value(key)} onChange={e => set(key, e.target.value)} />}
                  </div>
                );
              }))}
            </div>
          </section>
        ) : null}
        {locked ? null : (
          <>
            {problems.length ? <p className="field-error">{problems[0]}</p> : null}
            <div className="form-actions">
              <button type="button" className="btn" disabled={!changed.length || !!problems.length} onClick={() => setReviewing(true)}>
                {changed.length ? `Review ${changed.length} ${changed.length === 1 ? 'box' : 'boxes'}` : 'Nothing changed yet'}
              </button>
              {changed.length ? <button type="button" className="btn ghost" onClick={draft.discard}>Discard changes</button> : null}
            </div>
          </>
        )}
      </div>
      {leaving ? (
        <Confirm title="Leave this card without recording it?" tone="plain" confirmLabel="Leave without recording"
          body={`${changed.length === 1 ? '1 box' : `${changed.length} boxes`} on ${learnerName(learner)}’s card changed and ${changed.length === 1 ? 'is' : 'are'} not recorded yet. Leaving discards ${changed.length === 1 ? 'it' : 'them'}.`}
          onClose={() => setLeaving(null)} onConfirm={() => { setChosen(leaving); setLeaving(null); }} />
      ) : null}
      {reviewing ? (
        <CardReview learner={learner} rows={changed.map(b => ({ box: b, before: stored[b.key] ?? '', after: value(b.key).trim() }))}
          onClose={() => setReviewing(false)}
          submit={reason => api(`/enrollments/${learner.enrollment_id}/report-card`, 'POST', { ...draft.body(), reason })}
          onDone={() => { setReviewing(false); draft.discard(); setStatus({ kind: 'done', text: `${learnerName(learner)}’s card recorded: ${changed.length} ${changed.length === 1 ? 'box' : 'boxes'}.` }); onSaved(); }}
          onConflict={onSaved} />
      ) : null}
    </>
  );
}

export function Shown({ kind, value }: { kind: Box['kind']; value: string }): ReactNode {
  if (!value) return <Unrecorded label="Not recorded" />;
  if (kind === 'remark') return value === 'passed' ? 'Passed' : 'Failed';
  if (kind === 'text') return <span className="note-text">{value}</span>;
  return <span className="mono">{value}</span>;
}

export function CardReview({ learner, rows, onClose, submit, onDone, onConflict }: {
  learner: ReportLearner; rows: { box: Box; before: string; after: string }[]; onClose: () => void;
  submit: (reason: string) => Promise<unknown>; onDone: () => void; onConflict: () => void;
}) {
  const [reason, setReason] = useState('Transcribed from the class record (ECR).');
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const go = async (event: FormEvent) => {
    event.preventDefault();
    const text = reason.replace(/\s+/g, ' ').trim();
    if (text.length < 10) { setLocal({ kind: 'error', text: 'Give a reason of at least 10 characters.' }); return; }
    setBusy(true);
    setLocal({ kind: 'busy', text: 'Recording…' });
    try { await submit(text); onDone(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setLocal({ kind: 'error', text: 'Someone changed this card after you opened it, so nothing was recorded. It has been reloaded; check it and record again.' });
        onConflict();
      } else setLocal({ kind: 'error', text: `${message(error)} Nothing on the card was recorded.` });
    } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Record ${learnerName(learner)}’s card`} note="Check each box against the class record. The whole card is recorded together, or nothing is." wide onClose={onClose}>
      <StatusLine status={status} />
      <Affects what={rows.some(r => r.box.kind === 'grade' || r.box.kind === 'remark') ? 'grades' : 'card'} />
      <Table rows={rows} rowKey={r => r.box.key} columns={[
        { header: 'Box', cell: r => r.box.label },
        { header: 'Recorded', cell: r => <Shown kind={r.box.kind} value={r.before} /> },
        { header: 'Now', cell: r => r.after ? <Shown kind={r.box.kind} value={r.after} /> : <Badge tone="attention">Cleared</Badge> },
      ]} />
      <form onSubmit={go}>
        <div className="form-grid">
          <div className="field wide">
            <label className="label" htmlFor={`${id}-reason`}>Reason</label>
            <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            <span className="hint">10–500 characters, kept with these records for good. Say where they came from.</span>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Recording…' : 'Record this card'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Keep editing</button>
        </div>
      </form>
    </Sheet>
  );
}
