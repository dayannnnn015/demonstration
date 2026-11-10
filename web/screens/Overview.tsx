import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { query } from '../api';
import { actionName, isJournal, recordName } from '../activity';
import {
  Badge, EmptyState, PrintButton, Table, Unrecorded,
  gradeName, localToday, sentence, value, yearName, type Status,
} from '../components/primitives';
import { Donut, StatTile, Timeline, type Slice } from '../components/figures';
import { GettingStarted } from './GettingStarted';
import { OutcomeQueue } from './OutcomeQueue';

/**
 * The workspace landing screen.
 *
 * It reads the school profile, school years, reporting periods, sections, staff
 * and the audit log — and deliberately reads no learner or enrollment record at
 * all. Every list under `/learners` and `/enrollments` writes a row into
 * `record_access_events` naming the exact records returned, so a dashboard that
 * counted 897 enrolments on each load would bury the privacy audit under its
 * own noise and make it useless for the thing it exists to catch.
 *
 * How many learners are enrolled comes from `/enrollment-counts`, which answers
 * with numbers by grade and names no record, so it writes no access row. It is
 * the only learner figure here, and paging the roster to count it would defeat
 * the audit this paragraph describes.
 *
 * Nothing here is computed from a mark or a score. The figures are calendar and
 * roster facts: which stretch of the year today falls in, how many sections
 * exist at each grade, who holds access. Averages, attendance rates and
 * academic standing stay behind their gates in docs/constraints.md, and the
 * screen draws their absence rather than leaving it to be guessed at.
 */

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

/** Attendance and enrolment are both dated records, so the day is worth stating. */
const longDate = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** The name someone is greeted by, which is the first word of how they are filed. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Who the person is here, said under their name (asked 2026-11-10): the principal or the administrative officer by
 * role, and an adviser by the classes they advise this school year, read from the sections this screen already loads.
 */
export function roleLine(me: Row, rooms: Row[]) {
  const role = me.role === 'principal' ? 'Principal' : me.role === 'administrative_officer' ? 'Administrative officer' : 'Teacher';
  const mine = rooms
    .filter(r => r.adviser_user_id != null && r.adviser_user_id === me.user_id)
    .sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || String(a.name).localeCompare(String(b.name)));
  if (!mine.length) return me.role === 'teacher' ? 'Teacher · no class to advise this school year' : role;
  // "Grade 3 – A", the way a class is named on the school's own forms, and "and" between two, so one class reads as one.
  const classes = new Intl.ListFormat('en', { type: 'conjunction' }).format(mine.map(r => `${gradeName(r.grade_level)} – ${String(r.name)}`));
  return `${me.role === 'teacher' ? 'Adviser' : `${role} · adviser`} of ${classes}`;
}

const covering = (periods: Row[], today: string) =>
  periods.find(p => String(p.starts_on) <= today && today <= String(p.ends_on));

/** Where each figure on the school forms comes from: recorded as the school computed it, or counted by the school's own rule. */
const SOURCES = (rule: boolean | null): [string, string][] => [
  ['Grades and general average', 'Entered from the ECR, never computed here'],
  ['Days present and absent', rule === null ? 'Counted by the principal’s attendance rule' : rule ? 'Counted by the principal’s attendance rule' : 'Waiting on the principal’s attendance rule'],
  ['End-of-year outcomes', 'Recorded by the adviser, approved by the principal'],
  ['Class ranking and honors', 'Not computed'],
];

type Counts = { scope: 'school' | 'current_access'; enrolled: number; withdrawn: number; grades: { grade_level: number; enrolled: number; withdrawn: number }[] };

export function Overview({ api, me, manager, token }: {
  api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number;
}) {
  const [years, setYears] = useState<Row[] | null>(null);
  const [periods, setPeriods] = useState<Row[]>([]);
  const [sections, setSections] = useState<Row[] | null>(null);
  const [staff, setStaff] = useState<Row[]>([]);
  const [staffRead, setStaffRead] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [recent, setRecent] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [rule, setRule] = useState<boolean | null>(null);
  const today = localToday();

  useEffect(() => {
    setYears(null);
    void api<Page>('/academic-years').then(r => setYears(r.items)).catch(() => setYears([]));
    // Whether the principal has recorded the attendance rule; it names no learner.
    void api<{ rule: unknown }>('/attendance-day-rule').then(r => setRule(r.rule !== null)).catch(() => setRule(null));
  }, [api, token]);

  const year = years?.find(y => y.status === 'active')
    ?? [...(years ?? [])].sort((a, b) => Number(b.start_year) - Number(a.start_year))[0];
  const yearId = year ? String(year.id) : '';

  useEffect(() => {
    if (!yearId) { setPeriods([]); setSections([]); return; }
    setSections(null);
    void api<Page>(`/academic-years/${yearId}/periods`).then(r => setPeriods(r.items)).catch(() => setPeriods([]));
    void (async () => {
      const all: Row[] = [];
      for (let offset = 0; ; offset += 100) {
        const result = await api<Page>(`/sections${query({ academic_year_id: yearId, limit: 100, offset })}`);
        all.push(...result.items);
        if (!result.pagination?.has_more) break;
      }
      setSections(all);
    })().catch(() => setSections([]));
  }, [api, yearId, token]);

  useEffect(() => {
    if (!yearId) { setCounts(null); return; }
    void api<Counts>(`/enrollment-counts${query({ academic_year_id: yearId })}`).then(setCounts).catch(() => setCounts(null));
  }, [api, yearId, token]);

  useEffect(() => {
    if (!manager) return;
    void api<Page>(`/staff${query({ limit: 100 })}`).then(r => { setStaff(r.items); setStaffRead(true); }).catch(() => { setStaff([]); setStaffRead(false); });
    void api<Page>(`/staff-invitations${query({ status: 'requested', limit: 50 })}`).then(r => setPending(r.items.length)).catch(() => setPending(null));
    // History rows echo the change they record, so read past them to six real ones.
    void api<Page>(`/audit-events${query({ limit: 40 })}`).then(r => setRecent(r.items.filter(e => !isJournal(String(e.entity_table))).slice(0, 6))).catch(() => setRecent([]));
  }, [api, manager, token]);

  const loading = years === null || (Boolean(yearId) && sections === null);
  const rooms = sections ?? [];
  const period = covering(periods, today);
  const active = year?.status === 'active';

  // Sections per grade, Kindergarten first, skipping grades the school has none of.
  const byGrade: Slice[] = [...new Set(rooms.map(r => Number(r.grade_level)))]
    .sort((a, b) => a - b)
    .map(grade => ({ label: gradeName(grade), count: rooms.filter(r => Number(r.grade_level) === grade).length }));

  const unassigned = rooms.filter(r => r.adviser_user_id == null).length;
  const activeStaff = staff.filter(s => s.active !== false);
  const teachers = activeStaff.filter(s => s.role === 'teacher').length;
  const staffName = (id: unknown) => staff.find(s => s.user_id === id)?.display_name;

  const adviser = (row: Row) => {
    if (row.adviser_user_id == null) return <Unrecorded label="No adviser" />;
    if (row.adviser_user_id === me.user_id) return <b>You</b>;
    const named = staffName(row.adviser_user_id);
    return named ? String(named) : <span className="muted">Assigned</span>;
  };

  const started = (
    <GettingStarted
      api={api} me={me} token={token}
      facts={{
        active: year?.status === 'active', periods: periods.length, sections: rooms.length, unassigned,
        teachers: manager && staffRead ? teachers : null, enrolled: !year ? 0 : counts ? counts.enrolled : null, rule,
      }}
    />
  );

  if (loading) return <OverviewSkeleton />;

  if (!year) {
    return (
      <>
      {started}
      <div className="card">
        <EmptyState
          title="No school year exists yet"
          body="EDUNEXUS records everything against a school year. Create one under School years, add its reporting periods, then activate it."
        />
      </div>
      </>
    );
  }

  return (
    <>
      <div className="greeting">
        <div>
          <p className="greeting-eyebrow">{longDate()}</p>
          <h2>{greeting()}, {firstName(String(me.display_name))}</h2>
          <p className="greeting-role">{roleLine(me, rooms)}</p>
          <p className="greeting-sub">
            {active
              ? <>Records you enter go into <b>{yearName(year)}</b>{period ? <> during <b>{String(period.name)}</b></> : null}.</>
              : <>No school year is active, so no new records can be entered yet.</>}
          </p>
        </div>
        {active ? <Badge tone="good">Year active</Badge> : <Badge tone="attention">{sentence(value(year, 'status'))}</Badge>}
      </div>

      {/* What waits for a decision comes before the setup list, which can run long (found in the browser, 28 October). */}
      {manager ? <OutcomeQueue api={api} yearId={yearId} token={token} /> : null}

      {started}

      <div className="tiles">
        <StatTile
          accent={0}
          label="School year"
          value={yearName(year)}
          meta={<span className="mono">{value(year, 'starts_on')} → {value(year, 'ends_on')}</span>}
        />
        <StatTile
          accent={1}
          label="Reporting periods"
          value={periods.length}
          meta={period ? <>Now in <b>{String(period.name)}</b></> : 'None covers today'}
        />
        <StatTile
          accent={2}
          label={manager ? 'Sections' : 'Sections you advise'}
          value={rooms.length}
          meta={byGrade.length ? `Across ${byGrade.length} grade ${byGrade.length === 1 ? 'level' : 'levels'}` : 'None created yet'}
        />
        <StatTile
          accent={4}
          label={manager ? 'Learners enrolled' : 'Your learners'}
          value={counts ? counts.enrolled : <Unrecorded label="Not read" />}
          meta={counts ? `${counts.withdrawn} withdrawn this year · voided records not counted` : 'The count could not be read'}
        />
        {manager ? (
          <StatTile
            accent={3}
            label="Staff with access"
            value={activeStaff.length}
            meta={<>{teachers} {teachers === 1 ? 'teacher' : 'teachers'}{pending ? <> · {pending} invitation{pending === 1 ? '' : 's'} waiting</> : null}</>}
          />
        ) : (
          <StatTile
            accent={3}
            label="Your access"
            value="Teacher"
            meta="Read-only, for your currently assigned learners"
          />
        )}
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head"><div>
            <h2>The school year</h2>
            <p className="card-note">Where today falls among the reporting periods this year is divided into.</p>
          </div></div>
          <div className="card-body">
            {periods.length ? (
              <Timeline
                from={String(year.starts_on)}
                to={String(year.ends_on)}
                today={today}
                spans={[...periods]
                  .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
                  .map(p => ({ label: String(p.name), from: String(p.starts_on), to: String(p.ends_on) }))}
              />
            ) : (
              <EmptyState
                title="No reporting periods yet"
                body="A school year is divided into reporting periods while it is still a draft. Add them under Reporting periods."
              />
            )}
          </div>
        </div>

        {counts?.grades.length ? (
          <div className="card">
            <div className="card-head"><div>
              <h2>{manager ? 'Learners by grade' : 'Your learners by grade'}</h2>
              <p className="card-note">Currently enrolled, from a count that names nobody. Withdrawn learners are not in the ring.</p>
            </div></div>
            <div className="card-body">
              <Donut
                slices={counts.grades.filter(g => g.enrolled).map(g => ({ label: gradeName(g.grade_level), count: g.enrolled }))}
                centreValue={counts.enrolled}
                centreLabel={counts.enrolled === 1 ? 'learner' : 'learners'}
              />
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head"><div>
            <h2>Sections by grade</h2>
            <p className="card-note">How many classes exist at each grade level in this school year.</p>
          </div></div>
          <div className="card-body">
            {byGrade.length ? (
              <Donut slices={byGrade} centreValue={rooms.length} centreLabel={rooms.length === 1 ? 'section' : 'sections'} />
            ) : (
              <EmptyState title="No sections yet" body="Create the school's classes on School years & sections, then give each an adviser on Staff access." />
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>{manager ? 'Sections and their advisers' : 'Your sections'}</h2>
            <p className="card-note">
              {unassigned
                ? `${unassigned} ${unassigned === 1 ? 'section has' : 'sections have'} no adviser. Attendance cannot be recorded for a section until one is assigned.`
                : !rooms.length ? 'Nothing is set up for this school year yet.'
                : manager ? 'Every section in this school year has an adviser.'
                : 'The sections you currently advise in this school year.'}
            </p>
          </div>
          {rooms.length ? <div className="card-head-actions"><PrintButton /></div> : null}
        </div>
        <Table
          rows={[...rooms].sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || String(a.name).localeCompare(String(b.name)))}
          rowKey={r => String(r.id)}
          empty={<EmptyState
            title={manager ? 'No sections yet' : 'You advise no sections'}
            body={manager
              ? 'Create the school\'s classes on School years & sections.'
              : 'A principal or administrative officer assigns advisers. Until then there are no learners for you to read.'}
          />}
          columns={[
            { header: 'Grade', cell: r => gradeName(r.grade_level) },
            { header: 'Section', cell: r => <b>{value(r, 'name')}</b> },
            { header: 'Adviser', cell: adviser },
          ]}
        />
      </div>

      {manager && recent.length ? (
        <div className="card">
          <div className="card-head"><div>
            <h2>Latest recorded changes</h2>
            <p className="card-note">What changed and who changed it. Values, learner names and credentials are never copied into this log; the Activity log has every entry.</p>
          </div></div>
          <Table
            rows={recent}
            rowKey={r => String(r.id)}
            columns={[
              { header: 'When', cell: r => <span className="mono">{new Date(String(r.occurred_at)).toLocaleString()}</span> },
              { header: 'Record', cell: r => recordName(String(r.entity_table)) },
              { header: 'Action', cell: r => actionName(r) },
              { header: 'By', cell: r => {
                const who = staff.find(s => s.user_id === r.actor_user_id);
                return who ? String(who.display_name) : <Unrecorded label="Not on the staff list" />;
              } },
            ]}
          />
        </div>
      ) : null}

      {/* Drawn, not omitted. A reader who expects a general average on a school
          dashboard should see that its absence was decided — and by whom. */}
      <div className="card">
        <div className="gated">
          <h3>Where the figures on the school forms come from</h3>
          <div className="gated-row">
            {SOURCES(rule).map(([figure, waiting]) => (
              <div className="gated-box" key={figure}>
                <b>{figure}</b>
                <span>{waiting}</span>
              </div>
            ))}
          </div>
          <p>
            Grades, general averages and outcomes are typed from the school’s own class records and printed as entered: EDUNEXUS
            computes none of them. Attendance on the SF2, SF4 and report cards is counted from the register by the rule the principal
            records on the instructional calendar. An unmarked session and an unentered score stay unknown rather than counting as zero, so a month
            with a gap stays empty instead of being guessed.
          </p>
        </div>
      </div>
    </>
  );
}

/** The Overview while it is read, in its own shape: the greeting, the tiles and the cards under them. */
function OverviewSkeleton() {
  return (
    <div className="overview-skeleton" role="status" aria-busy="true">
      <span className="sr-only">Loading the overview…</span>
      <div className="greeting" aria-hidden="true">
        <div className="skeleton-stack"><span className="skeleton short" /><span className="skeleton title" /><span className="skeleton" /></div>
      </div>
      <div className="tiles" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <div className="tile" key={i}><span className="skeleton short" /><span className="skeleton title" /><span className="skeleton half" /></div>)}
      </div>
      <div className="split" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => <div className="card" key={i}><div className="card-head"><span className="skeleton half" /></div><div className="card-body"><span className="skeleton figure" /></div></div>)}
      </div>
    </div>
  );
}
