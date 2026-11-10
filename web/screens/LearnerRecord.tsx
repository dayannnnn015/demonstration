import { useEffect, useState } from 'react';
import type { Api, Row } from '../api';
import { message } from '../api';
import { months as monthNames, weekday } from '../dates';
import { Sheet } from '../components/overlay';
import { PrintCopy } from '../components/print';
import { Icon } from '../components/icons';
import { SeededNotice } from '../components/seeded';
import { Badge, Callout, Cell, StatusLine, Table, Unrecorded, gradeName, idle, learnerName, localToday, type Status } from '../components/primitives';

type Month = { month_on: string; expected_sessions: number; present_sessions: number; absent_sessions: number; missing_sessions: number; alternative_delivery_sessions: number; unconfigured_dates: number };
type Absence = { day_on: string; section_id: string; am: 'present' | 'absent' | null; pm: 'present' | 'absent' | null };
type Attendance = { from: string; to: string; months: Month[]; absences: Absence[] };
type Score = { task_id: string; subject_code: string; subject_name: string; period_ordinal: number; period_name: string; component_code: string; sequence: number; title: string; max_score: number; status: 'open' | 'archived'; raw_score: number | null };

export const monthLabel = (monthOn: string) => `${monthNames[Number(monthOn.slice(5, 7)) - 1]} ${monthOn.slice(0, 4)}`;

/** A mark as recorded, beside the maximum it was recorded against. Never a percentage. */
export const markText = (score: Pick<Score, 'raw_score' | 'max_score'>) => (score.raw_score === null ? null : `${score.raw_score} of ${score.max_score}`);

const session = (value: Absence['am']) =>
  value === 'absent' ? <Badge tone="attention">Absent</Badge> : value === 'present' ? <Badge tone="good">Present</Badge> : <Unrecorded label="Not marked" />;

/**
 * One learner's year: attendance counted month by month and every raw mark,
 * read for this one enrollment only. Opening it writes two access rows naming
 * this enrollment and nobody else, which is why it is fetched when asked for
 * rather than with the list. Counts are recorded sessions; nothing here is a
 * rate, a credited school day, a total or a grade.
 *
 * It prints, for a parent conference. A sheet sits inside the app, which the
 * print stylesheet hides, so printing draws the same content once more into a
 * root of its own beside the app and prints only that. The printed page says
 * what it is not: an official form, a rate or a grade.
 */
export function LearnerRecord({ api, me, learner, enrollment, yearLabel, sectionLabel, onClose }: {
  api: Api; me: Row; learner: Row; enrollment: Row; yearLabel: string; sectionLabel: string; onClose: () => void;
}) {
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  const [printing, setPrinting] = useState(false);


  useEffect(() => {
    const id = String(enrollment.id);
    void api<Attendance>(`/enrollments/${id}/attendance-record`).then(setAttendance)
      .catch(error => { setAttendance({ from: '', to: '', months: [], absences: [] }); setStatus({ text: message(error), kind: 'error' }); });
  }, [api, enrollment.id]);

  const where = `${yearLabel} · ${gradeName(enrollment.grade_level)} · ${sectionLabel}`;
  const content = (
    <>
      <h3>Attendance by month</h3>
      <p className="muted">
        Recorded sessions, two a day, counted the way the monthly review counts them{attendance?.from ? `, from ${attendance.from} to ${attendance.to}` : ''}.
        These are sessions, not an attendance rate. The days present and absent on the SF2 and SF9 are counted from them by the school’s attendance rule on the instructional calendar, and stay empty while it is not recorded.
      </p>
      <Table
        stack
        loading={attendance === null}
        rows={attendance?.months ?? []}
        rowKey={m => m.month_on}
        empty={<p className="muted">No month of this school year has started for this learner yet.</p>}
        columns={[
          { header: 'Month', cell: m => <b>{monthLabel(m.month_on)}</b> },
          {
            header: 'Expected', numeric: true,
            // A month the school only partly configured says so beside its count, rather than in a column of its own.
            cell: m => (!m.expected_sessions && m.unconfigured_dates ? <Unrecorded label="Calendar not set" />
              : m.unconfigured_dates ? <Cell title={m.expected_sessions} meta={`${m.unconfigured_dates} dates not set`} /> : m.expected_sessions),
          },
          { header: 'Present', cell: m => m.present_sessions, numeric: true },
          { header: 'Absent', cell: m => m.absent_sessions, numeric: true },
          { header: 'Not marked', cell: m => (m.missing_sessions ? <Badge tone="attention">{m.missing_sessions}</Badge> : 0), numeric: true },
          { header: 'Alternative delivery', cell: m => m.alternative_delivery_sessions, numeric: true },
        ]}
      />

      <h3>Days absent</h3>
      <Table
        loading={attendance === null}
        rows={attendance?.absences ?? []}
        rowKey={a => a.day_on}
        empty={<p className="muted">No absence is recorded this year.</p>}
        columns={[
          { header: 'Date', cell: a => <Cell title={<span className="mono">{a.day_on}</span>} meta={weekday(a.day_on)} /> },
          { header: 'Morning', cell: a => session(a.am) },
          { header: 'Afternoon', cell: a => session(a.pm) },
        ]}
      />

    </>
  );

  return (
    <Sheet title={learnerName(learner)} note={`${where}. Opening this is recorded in the privacy access log.`} wide onClose={onClose}>
      <StatusLine status={status} />
      <div className="form-actions sheet-tools">
        <button type="button" className="btn secondary" disabled={attendance === null} onClick={() => setPrinting(true)}>
          <Icon name="print" size={15} />Print this year
        </button>
      </div>
      {content}
      <Callout tone="info" title="Only this learner">
        Both reads return this one enrollment, so the access log names this learner and no classmate.
      </Callout>
      <PrintCopy printing={printing} onPrinted={() => setPrinting(false)}>
          <SeededNotice me={me} />
          <h1>{learnerName(learner)}</h1>
          <p>{learner.lrn ? `LRN ${String(learner.lrn)}` : 'LRN missing'} · {where}</p>
          {content}
          <p className="print-foot">
            Printed {localToday()} from EDUNEXUS. Recorded sessions and raw marks as entered by the school. This is not an official school form, an attendance rate or a grade.
          </p>
      </PrintCopy>
    </Sheet>
  );
}
