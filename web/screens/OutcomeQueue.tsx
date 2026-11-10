import { useEffect, useState } from 'react';
import type { Api } from '../api';
import { Icon } from '../components/icons';
import { Cell, Table, gradeName } from '../components/primitives';

type Entry = { sections: { id: string; grade_level: number; name: string; adviser_name: string | null; learners: number; outcomes: { recorded: number; approved: number; returned: number } }[] };

/** A screen opened from a link that names what to open, as `#/report-cards?section=…&approve=1`. */
export const hashParams = () => new URLSearchParams(globalThis.location?.hash.split('?')[1] ?? '');
/** Takes the request out of the address once it is acted on, so a reload does not act on it again. */
export const forgetHashParams = () => {
  const route = globalThis.location?.hash.split('?')[0];
  if (route && globalThis.location.hash.includes('?')) history.replaceState(null, '', route);
};

/**
 * End-of-year outcomes waiting for the principal or administrative officer,
 * on the Overview (the group's note of 28 October: endorsements should come to
 * the principal's dashboard). It reads only counts, the same ones Grade entry
 * shows, so it names no learner and writes no access row. Approving happens on
 * Promotion, opened at that section's approval; once every learner of a grade
 * has an approved outcome, next year's classes are offered for that grade,
 * still as the reviewed draw (decision D3a).
 */
export function OutcomeQueue({ api, yearId, token }: { api: Api; yearId: string; token: number }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  useEffect(() => {
    if (!yearId) { setEntry(null); return; }
    void api<Entry>(`/academic-years/${yearId}/grade-entry`).then(setEntry).catch(() => setEntry(null));
  }, [api, yearId, token]);
  if (!entry) return null;
  const waiting = entry.sections
    .map(s => ({ ...s, waiting: s.outcomes.recorded - s.outcomes.approved - s.outcomes.returned }))
    .filter(s => s.waiting > 0)
    .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name));
  // Whether every learner of this year's grade has an approved outcome; a grade with no sections holds nobody to wait for.
  const settled = (grade: number) => {
    const rooms = entry.sections.filter(s => s.grade_level === grade);
    const learners = rooms.reduce((n, s) => n + s.learners, 0);
    const approved = rooms.reduce((n, s) => n + s.outcomes.approved, 0);
    const pending = rooms.reduce((n, s) => n + s.outcomes.recorded - s.outcomes.approved - s.outcomes.returned, 0);
    return { has: learners > 0, done: learners === 0 || (approved >= learners && pending === 0) };
  };
  // Next year's Grade T is drawn from this year's Grade T−1 promoted and Grade T retained, so it is offered once both
  // are settled. Grade 6's promoted leave the school, and Kindergarten next year holds only its own retained.
  const grades = [0, 1, 2, 3, 4, 5, 6].filter(t => {
    const below = t > 0 ? settled(t - 1) : { has: false, done: true }, same = settled(t);
    return (below.has || same.has) && below.done && same.done;
  });
  if (!waiting.length && !grades.length) return null;
  return (
    <div className="card outcome-queue" data-tour="overview-outcomes">
      <div className="card-head"><div>
        <h2>End-of-year outcomes</h2>
        <p className="card-note">Endorsed by the advisers and waiting for you. An approved outcome prints on the learner’s SF9 and SF10.</p>
      </div></div>
      {waiting.length ? (
        <Table
          rows={waiting}
          rowKey={s => s.id}
          columns={[
            { header: 'Section', cell: s => <Cell title={`${gradeName(s.grade_level)} · ${s.name}`} meta={s.adviser_name ?? 'No adviser'} /> },
            { header: 'Waiting', numeric: true, cell: s => <b className="num">{s.waiting}</b> },
            { header: '', cell: s => <a className="btn small" href={`#/report-cards?section=${s.id}&approve=1`}><Icon name="check" size={14} />Review and approve</a> },
          ]}
        />
      ) : null}
      {grades.length ? (
        <div className="card-body">
          <p className="card-note">Every learner who goes into {grades.length === 1 ? 'this grade' : 'these grades'} next year has an approved outcome, so the classes can be drawn. Nobody is placed until you check the draw and enrol it.</p>
          <div className="form-actions">
            {grades.map(t => (
              <a key={t} className="btn secondary" href={`#/next-year?grade=${t}`}><Icon name="forward" size={15} />Prepare next year’s {gradeName(t)}</a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
