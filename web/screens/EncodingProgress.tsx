import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message } from '../api';
import { Icon } from '../components/icons';
import { StatTile } from '../components/figures';
import { Select } from '../components/primitives';
import {
  Badge, Callout, Cell, EmptyState, Table, Task, Unrecorded, gradeName, sentence, yearName, type Status,
} from '../components/primitives';

/**
 * How far the school has got with the historical encoding, by class.
 *
 * The 4 November brief required that administrators "oversee historical
 * encoding progress across the entire school", and until now Academic history
 * was per-learner only: reached by searching for one child, with no way to see
 * which of 30 classes still had work. This is that view.
 *
 * **It reads counts and nothing else.** Every list under `/learners` and
 * `/enrollments` writes a `record_access_events` row naming the records it
 * returned, so a school-wide view that paged the registry would bury the privacy
 * audit in its own noise — the rule the Overview has followed since 0.27.0. So
 * this names no learner, reads no rating, and writes no access row, exactly as
 * Grade entry does for report cards. A manager who needs a name opens the
 * learner, which logs that read as it should.
 */

type Section = {
  id: string; grade_level: number; name: string; adviser_user_id: string | null; adviser_name: string | null;
  learners: number; with_years: number; with_credential: number; with_nothing: number; encoded_years: number;
};
type Unplaced = { grade_level: number; learners: number; with_years: number; with_credential: number; with_nothing: number };
type Progress = { school_year: { id: string; start_year: number; status: string }; today: string; sections: Section[]; unplaced: Unplaced[] };

/** A section's state in one word, so a manager can scan 30 rows for the ones with work left. */
function state(s: Section) {
  if (!s.learners) return <Badge tone="neutral">No learners</Badge>;
  if (!s.with_nothing) return <Badge tone="good">Every learner started</Badge>;
  if (s.with_years || s.with_credential) return <Badge tone="attention">{s.with_nothing} still to do</Badge>;
  return <Badge tone="stopped">Not started</Badge>;
}

export function EncodingProgress({ api, setStatus }: { api: Api; setStatus: (s: Status) => void }) {
  const [years, setYears] = useState<Row[] | null>(null);
  const [yearId, setYearId] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    let live = true;
    void api<Page>('/academic-years')
      .then(page => {
        if (!live) return;
        setYears(page.items);
        setYearId(String((page.items.find(y => y.status === 'active') ?? page.items[0])?.id ?? ''));
      })
      .catch(() => { if (live) setYears([]); });
    return () => { live = false; };
  }, [api]);

  useEffect(() => {
    if (!yearId) { setProgress(null); return; }
    let live = true;
    setProgress(null);
    void api<Progress>(`/academic-years/${yearId}/encoding-progress`)
      .then(answer => { if (live) setProgress(answer); })
      .catch(error => { if (live) setStatus({ kind: 'error', text: message(error) }); });
    return () => { live = false; };
  }, [api, yearId, setStatus]);

  if (years !== null && !years.length) {
    return <Callout tone="info" title="No school year yet">Create a school year before the encoding can be tracked against its classes.</Callout>;
  }

  const sections = progress?.sections ?? [];
  const unplaced = progress?.unplaced ?? [];
  const placedLearners = sections.reduce((n, s) => n + s.learners, 0);
  const unplacedLearners = unplaced.reduce((n, u) => n + u.learners, 0);
  const learners = placedLearners + unplacedLearners;
  const started = sections.reduce((n, s) => n + (s.learners - s.with_nothing), 0) + unplaced.reduce((n, u) => n + (u.learners - u.with_nothing), 0);
  const encodedYears = sections.reduce((n, s) => n + s.encoded_years, 0);
  const done = sections.filter(s => s.learners && !s.with_nothing).length;
  const untouched = sections.filter(s => s.learners && s.with_nothing === s.learners).length;

  return (
    <Task title="Across the school" note="Counts only — no learner is named here">
      <div className="card-tools">
        <div className="field inline">
          <label className="label" htmlFor="encoding-year">School year</label>
          <Select id="encoding-year" value={yearId} onChange={event => setYearId(event.target.value)}>
            {(years ?? []).map(y => <option key={String(y.id)} value={String(y.id)}>{yearName(y)} — {sentence(String(y.status))}</option>)}
          </Select>
        </div>
      </div>
      <p className="muted">
        Which classes have had a previous school year or the Grade 1 credential typed in for their learners, and which still have none. A learner counts as started once
        they have either. Nothing here reads a rating, and opening this screen records no access to anybody’s records — so it can be watched as often as it is useful.
      </p>

      <div className="tiles">
        <StatTile label="Learners this year" value={progress ? learners : '—'} meta={unplacedLearners ? `${unplacedLearners} in no class yet` : 'all in a class'} accent={0} />
        <StatTile label="Started" value={progress ? started : '—'} meta={learners ? `of ${learners}` : undefined} accent={1} />
        <StatTile label="Classes finished" value={progress ? `${done} of ${sections.length}` : '—'} meta={untouched ? `${untouched} not started` : 'all have begun'} accent={2} />
        <StatTile label="School years encoded" value={progress ? encodedYears : '—'} meta="across every learner" accent={3} />
      </div>

      <Table
        loading={progress === null}
        rows={sections}
        rowKey={s => s.id}
        empty={<EmptyState title="No classes in this school year" body="Create the year’s sections, and each one’s progress appears here." />}
        columns={[
          { header: 'Class', cell: s => <Cell title={`${gradeName(s.grade_level)} · ${s.name}`} meta={s.learners === 1 ? 'one learner' : `${s.learners} learners`} /> },
          { header: 'Adviser', cell: s => s.adviser_name ?? <Unrecorded label="No adviser" /> },
          { header: 'With a previous year', cell: s => (s.learners ? `${s.with_years} of ${s.learners}` : <Unrecorded label="No learners" />), numeric: true },
          { header: 'With the Grade 1 credential', cell: s => (s.learners ? `${s.with_credential} of ${s.learners}` : ''), numeric: true },
          { header: 'Years encoded', cell: s => String(s.encoded_years), numeric: true },
          { header: 'State', cell: state },
        ]}
      />

      {unplaced.length ? (
        <>
          <h3>Registered, but in no class yet</h3>
          <p className="muted">
            These learners are on no class’s row above, because every count here is by class. They are somebody’s work too, so they are counted on their own rather
            than left out — the same reason the SF4 reports them.
          </p>
          <Table
            rows={unplaced}
            rowKey={u => String(u.grade_level)}
            empty={<EmptyState title="Everyone is in a class" body="" />}
            columns={[
              { header: 'Grade', cell: u => gradeName(u.grade_level) },
              { header: 'Learners', cell: u => String(u.learners), numeric: true },
              { header: 'With a previous year', cell: u => `${u.with_years} of ${u.learners}`, numeric: true },
              { header: 'With the Grade 1 credential', cell: u => `${u.with_credential} of ${u.learners}`, numeric: true },
              { header: 'Still to do', cell: u => String(u.with_nothing), numeric: true },
            ]}
          />
        </>
      ) : null}

      <p className="card-note">
        <Icon name="info" size={14} />
        A class marked <i>Not started</i> has no learner with any encoded history. Open a learner below to type one in, or ask their adviser to: an adviser may encode
        for the learners currently in the classes they advise.
      </p>
    </Task>
  );
}
