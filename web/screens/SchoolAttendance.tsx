import { useEffect, useState } from 'react';
import type { Api } from '../api';
import { query } from '../api';
import type { Route } from '../routes';
import { shift, weekday } from '../dates';
import { Icon } from '../components/icons';
import { Badge, Cell, EmptyState, PageHeader, PrintButton, Table, Unrecorded, gradeName, localToday, type Status } from '../components/primitives';

type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended' | null;
export type SectionDay = {
  section_id: string; grade_level: number; name: string; adviser_name: string | null;
  am: Mode; pm: Mode; configured: boolean; learners: number;
  am_present: number; am_absent: number; am_unmarked: number | null;
  pm_present: number; pm_absent: number; pm_unmarked: number | null;
  recorded_at: string | null;
};
type Props = { api: Api; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

const modeName: Record<string, string> = { alternative_delivery: 'Alternative delivery', no_class: 'No class', suspended: 'Suspended' };
const hasClass = (s: SectionDay) => s.am === 'classroom' || s.pm === 'classroom';

/** One session's counts, or what the calendar says instead when it held no classroom session. */
export function SessionCounts({ mode, configured, present, absent, unmarked }: { mode: Mode; configured: boolean; present: number; absent: number; unmarked: number | null }) {
  if (!configured) return <Unrecorded label="Date not set" />;
  if (mode !== 'classroom') return <span className="muted">{modeName[mode ?? ''] ?? 'No class'}</span>;
  return (
    <Cell
      title={`${present} present · ${absent} absent`}
      meta={unmarked ? <Badge tone="attention">{unmarked} not marked</Badge> : 'All marked'}
    />
  );
}

/**
 * The whole school's register for one day, a section per row, in counts. It
 * is one read that names no learner, so a principal can open it every morning
 * without writing thirty sections of learners into the privacy log. Counts are
 * sessions as recorded; nothing is turned into a rate.
 */
export function SchoolAttendance({ api, setStatus, token, route }: Props) {
  const [dayOn, setDayOn] = useState(localToday());
  const [rows, setRows] = useState<SectionDay[] | null>(null);

  useEffect(() => {
    setRows(null);
    void api<{ sections: SectionDay[] }>(`/attendance/daily-summary${query({ day_on: dayOn })}`)
      .then(r => setRows(r.sections))
      .catch(error => { setRows([]); setStatus({ text: error instanceof Error ? error.message : 'The summary could not be read.', kind: 'error' }); });
  }, [api, dayOn, token]);

  const withClass = (rows ?? []).filter(hasClass);
  const taken = withClass.filter(s => s.recorded_at).length;
  const waiting = withClass.filter(s => (s.am_unmarked ?? 0) + (s.pm_unmarked ?? 0) > 0).length;

  return (
    <>
      <PageHeader route={route} actions={rows?.length ? <PrintButton label="Print this day" /> : undefined} />
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <div className="field inline">
              <label className="label" htmlFor="school-day">Date</label>
              <span className="month-nav">
                <button type="button" className="btn ghost small" aria-label="Previous day" onClick={() => setDayOn(d => shift(d, -1))}><Icon name="back" size={14} /></button>
                <input id="school-day" type="date" className="date-input" value={dayOn} onChange={event => event.target.value && setDayOn(event.target.value)} />
                <button type="button" className="btn ghost small" aria-label="Next day" onClick={() => setDayOn(d => shift(d, 1))}><Icon name="forward" size={14} /></button>
              </span>
            </div>
            <span className="muted">{weekday(dayOn)}</span>
          </div>
          {rows ? (
            <div className="card-head-actions">
              {withClass.length
                ? <Badge tone={taken === withClass.length && !waiting ? 'good' : 'attention'}>{taken} of {withClass.length} sections have taken the register</Badge>
                : <Badge tone="neutral">No section has a class this day</Badge>}
            </div>
          ) : null}
        </div>
        <Table
          stack
          loading={rows === null}
          rows={rows ?? []}
          rowKey={s => s.section_id}
          empty={<EmptyState title="No section on this date" body="This date falls outside every school year, or no section exists yet." />}
          columns={[
            { header: 'Section', cell: s => <Cell title={`${gradeName(s.grade_level)} · ${s.name}`} meta={s.adviser_name ?? <Unrecorded label="No adviser" />} /> },
            { header: 'Learners', cell: s => s.learners, numeric: true },
            { header: 'Morning', cell: s => <SessionCounts mode={s.am} configured={s.configured} present={s.am_present} absent={s.am_absent} unmarked={s.am_unmarked} /> },
            { header: 'Afternoon', cell: s => <SessionCounts mode={s.pm} configured={s.configured} present={s.pm_present} absent={s.pm_absent} unmarked={s.pm_unmarked} /> },
            {
              header: 'Register', cell: s => !hasClass(s) ? <span className="muted">Nothing to take</span>
                : s.recorded_at ? <Cell title={<Badge tone="good">Taken</Badge>} meta={new Date(s.recorded_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} />
                : <Badge tone="attention">Not taken</Badge>,
            },
          ]}
        />
        <div className="card-body">
          <p className="muted">Counts of morning and afternoon sessions as recorded. A session nobody marked is counted as not marked, never as present. Nothing here is an attendance rate; that waits on the school's rule for turning two sessions into a day.</p>
        </div>
      </div>
    </>
  );
}
