import { useEffect, useState } from 'react';
import type { Api, Row } from '../api';
import { message } from '../api';
import type { Route } from '../routes';
import { ScopePickers, useScope } from '../components/scope';
import { StatTile } from '../components/figures';
import { Badge, Callout, Cell, EmptyState, PageHeader, Table, TableSkeleton, gradeName, type Status } from '../components/primitives';
import { descriptiveGrading } from '../deped';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };
type Period = { id: string; ordinal: number; name: string; starts_on: string; ends_on: string };
type Section = {
  id: string; grade_level: number; name: string; adviser_name: string | null; learners: number;
  offerings: { id: string; code: string; name: string; recorded: Record<string, number> }[];
  general_averages: number; outcomes: { recorded: number; approved: number; returned: number };
};
type Entry = { school_year: { id: string; start_year: number; status: string }; today: string; periods: Period[]; sections: Section[] };

/** How many of the expected records are in, as counts and a word; never a percentage, since nothing here is a rate. */
function Progress({ done, of, upcoming }: { done: number; of: number; upcoming?: boolean }) {
  if (!of) return <span className="muted">Nothing expected</span>;
  if (!done) return <span className="muted">{upcoming ? 'Not started' : <span className="mono">0 of {of}</span>}</span>;
  return (
    <>
      <span className="mono">{done} of {of}</span>{' '}
      {done >= of ? <Badge tone="good">Complete</Badge> : <Badge tone="attention">{of - done} missing</Badge>}
    </>
  );
}

const recorded = (s: Section, key: string) => s.offerings.reduce((n, o) => n + (o.recorded[key] ?? 0), 0);
const expected = (s: Section) => s.learners * s.offerings.length;

/**
 * The principal's view of report-card entry across the school: for every
 * section, how many grades are recorded for each term and as final grades,
 * how many general averages, and how many outcomes are approved. It counts
 * records, reads no grade and names no learner.
 */
export function GradeEntry({ api, token, route }: Props) {
  const scope = useScope(api, token);
  const { year } = scope;
  const [entry, setEntry] = useState<Entry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!year) return;
    setEntry(null); setFailed(null);
    void api<Entry>(`/academic-years/${year.id}/grade-entry`).then(setEntry).catch(error => setFailed(message(error)));
  }, [api, year?.id, token]);

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={6} /></div></>;
  if (!year) return <><PageHeader route={route} /><div className="card"><EmptyState title="No school year yet" body="Grade entry is followed for a school year. Create the year first." /></div></>;

  // Kindergarten has no card, and a descriptively graded grade (DepEd Order No. 15, s. 2026) has no numeric grades to count.
  const noGrades = (s: Section) => s.grade_level === 0 || (!!entry && descriptiveGrading(s.grade_level, entry.school_year.start_year));
  const noGradesWord = (s: Section) => (s.grade_level === 0 ? 'No card' : 'Descriptive');
  const graded = entry?.sections.filter(s => !noGrades(s)) ?? [];
  const ended = entry?.periods.filter(p => p.ends_on < entry.today) ?? [];
  const latest = ended[ended.length - 1];
  const learners = entry?.sections.reduce((n, s) => n + s.learners, 0) ?? 0;
  const upcoming = (p: Period) => !!entry && p.starts_on > entry.today;

  return (
    <>
      <PageHeader route={route} />
      <div className="card">
        <div className="card-head">
          <div className="toolbar"><ScopePickers scope={scope} yearOnly /></div>
          <p className="card-note">Counts of what advisers have recorded on <b>Report cards</b>, against each section’s current learners and learning areas. A grade is counted once it is recorded; none is read or averaged here. Kindergarten has no card, and Grade 1 is graded descriptively this year under DepEd Order No. 15, s. 2026, so only their outcomes are followed.</p>
        </div>
        {failed ? <div className="card-body"><Callout tone="stopped" title="Grade entry could not be read">{failed}</Callout></div> : !entry ? <div className="card-body"><TableSkeleton columns={6} /></div> : null}
      </div>
      {entry ? (
        <>
          <div className="tiles">
            <StatTile label={latest ? `${latest.name} complete` : 'No term ended yet'} value={latest ? `${graded.filter(s => expected(s) && recorded(s, latest.id) >= expected(s)).length} of ${graded.length}` : 'None'}
              meta={latest ? 'sections with every grade recorded' : 'Counts start when a term ends'} accent={0} />
            <StatTile label="Final grades complete" value={`${graded.filter(s => expected(s) && recorded(s, 'final') >= expected(s)).length} of ${graded.length}`} meta="sections" accent={1} />
            <StatTile label="General averages" value={`${graded.reduce((n, s) => n + s.general_averages, 0)} of ${graded.reduce((n, s) => n + s.learners, 0)}`} meta="learners in numerically graded sections" accent={2} />
            <StatTile label="Outcomes approved" value={`${entry.sections.reduce((n, s) => n + s.outcomes.approved, 0)} of ${learners}`} meta={`${entry.sections.reduce((n, s) => n + s.outcomes.recorded - s.outcomes.approved, 0)} waiting for approval`} accent={3} />
          </div>
          <div className="card">
            <Table
              rows={entry.sections}
              rowKey={s => s.id}
              empty={<EmptyState title="No sections" body="This school year has no sections yet." />}
              detailLabel="Areas"
              detail={s => (s.grade_level === 0 ? <p className="muted">Kindergarten has no report card yet.</p> : noGrades(s) ? <p className="muted">{gradeName(s.grade_level)} is graded descriptively this school year, so there are no numeric grades to count.</p> : !s.offerings.length ? <p className="muted">No learning areas are offered to this section yet.</p> : (
                <Table
                  rows={s.offerings}
                  rowKey={o => o.id}
                  columns={[
                    { header: 'Learning area', cell: o => <Cell title={o.name} meta={o.code} /> },
                    ...entry.periods.map(p => ({ header: p.name, cell: (o: Section['offerings'][number]) => <Progress done={o.recorded[p.id] ?? 0} of={s.learners} upcoming={upcoming(p)} /> })),
                    { header: 'Final grade', cell: o => <Progress done={o.recorded.final ?? 0} of={s.learners} /> },
                  ]}
                />
              ))}
              columns={[
                { header: 'Section', cell: s => <Cell title={`${gradeName(s.grade_level)} · ${s.name}`} meta={s.adviser_name ?? 'No adviser'} /> },
                { header: 'Learners', cell: s => <span className="mono">{s.learners}</span> },
                ...entry.periods.map(p => ({
                  header: p.name,
                  cell: (s: Section) => (noGrades(s) ? <span className="muted">{noGradesWord(s)}</span> : <Progress done={recorded(s, p.id)} of={expected(s)} upcoming={upcoming(p)} />),
                })),
                { header: 'Final grades', cell: s => (noGrades(s) ? <span className="muted">{noGradesWord(s)}</span> : <Progress done={recorded(s, 'final')} of={expected(s)} />) },
                { header: 'Averages', cell: s => (noGrades(s) ? <span className="muted">{noGradesWord(s)}</span> : <Progress done={s.general_averages} of={s.learners} />) },
                { header: 'Outcomes', cell: s => <Cell title={`${s.outcomes.approved} of ${s.learners} approved`} meta={s.outcomes.returned ? `${s.outcomes.returned} returned` : `${s.outcomes.recorded - s.outcomes.approved} waiting`} /> },
              ]}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
