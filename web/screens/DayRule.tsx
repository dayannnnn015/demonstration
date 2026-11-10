import { useEffect, useState } from 'react';
import type { Api, Row } from '../api';
import { Sheet } from '../components/overlay';
import { Editor, Table, Task, Unrecorded, type Field, type Status } from '../components/primitives';
import type { DayRule } from '../forms/types';
import { Affects } from '../components/affects';

type State = { rule: (DayRule & { updated_at: string }) | null; history: { rule_version: number; mixed_day: string; single_session_day: string; reason: string; recorded_by: string | null; recorded_at: string }[] };

export const mixedWords: Record<string, string> = {
  tardy: 'Tardy: half-shaded on the SF2 (upper half if the morning was missed, lower half if the afternoon) and counted present',
  absent: 'Absent: marked x on the SF2 and counted absent for the day',
  half_day: 'Half a day: counted half present and half absent',
};
export const singleWords: Record<string, string> = {
  counts: 'A day of classes, marked by that one session',
  not_counted: 'Not a day of classes',
};
// The rule as the card reads it at a glance; the editor keeps the full wording, where it is being decided.
const mixedShort: Record<string, string> = { tardy: 'Tardy, counted present', absent: 'Absent for the day', half_day: 'Half a day present' };
const singleShort: Record<string, string> = { counts: 'A day of classes', not_counted: 'Not a day of classes' };

// Neither question has a default: nothing is selected until somebody chooses, and the API refuses an empty answer.
const fields: Field[] = [
  { key: 'mixed_day', label: 'A learner present for one session and absent for the other', wide: true, type: 'radios', options: Object.entries(mixedWords) },
  { key: 'single_session_day', label: 'A date with only one classroom session', wide: true, type: 'radios', options: Object.entries(singleWords) },
  { key: 'reason', label: 'Where the school approved this', type: 'textarea', minLength: 10, maxLength: 500, wide: true,
    hint: 'For example the memo, meeting or DepEd issuance the rule comes from. Kept with the rule for good.' },
];

/**
 * The school's rule for turning a morning and an afternoon mark into the SF2's
 * one daily mark. EDUNEXUS has no default for it: the SF2's totals, the SF4's
 * attendance columns and the report cards' days present all wait until the
 * principal records it here, and every change is kept with its reason.
 */
export function DayRuleCard({ api, me, setStatus, token }: { api: Api; me: Row; setStatus: (s: Status) => void; token: number }) {
  const [state, setState] = useState<State | null>(null);
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { void api<State>('/attendance-day-rule').then(setState).catch(() => setState(null)); }, [api, token, tick]);
  const principal = me.role === 'principal';
  const rule = state?.rule;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 data-tour="school-rule">Attendance rule for the school forms</h2>
          <p className="card-note">How a morning and an afternoon mark become the SF2’s one mark a day.</p>
        </div>
        <div className="card-head-actions">
          {principal && state ? <button type="button" className="btn" onClick={() => setEditing(true)}>{rule ? 'Change the rule' : 'Record the rule'}</button> : <span className="muted">Recorded by the principal</span>}
        </div>
      </div>
      <div className="card-body">
        {state ? (
          <dl className="facts">
            <div><dt>One session present, one absent</dt><dd>{rule ? mixedShort[rule.mixed_day] ?? rule.mixed_day : <Unrecorded />}</dd></div>
            <div><dt>A date with one classroom session</dt><dd>{rule ? singleShort[rule.single_session_day] ?? rule.single_session_day : <Unrecorded />}</dd></div>
          </dl>
        ) : null}
        {state?.history.length ? (
          <Task title="How it was recorded" note={`${state.history.length} ${state.history.length === 1 ? 'version' : 'versions'}`}>
            <Table
              rows={state.history}
              rowKey={h => String(h.rule_version)}
              columns={[
                { header: 'Version', cell: h => h.rule_version, numeric: true },
                { header: 'Rule', cell: h => `${mixedShort[h.mixed_day] ?? h.mixed_day}; one-session dates: ${(singleShort[h.single_session_day] ?? h.single_session_day).toLowerCase()}` },
                { header: 'Recorded', cell: h => `${h.recorded_by ?? 'Unknown'}, ${new Date(h.recorded_at).toLocaleDateString()}` },
                { header: 'Reason', cell: h => h.reason },
              ]}
            />
          </Task>
        ) : null}
      </div>
      {editing && state ? (
        <Sheet title={rule ? 'Change the school’s attendance rule' : 'Record the school’s attendance rule'} note="Forms already issued keep what they said; forms prepared from now on follow the new rule." onClose={() => setEditing(false)}>
          <Editor fields={fields} initial={rule ?? undefined} submitLabel="Record the rule" setStatus={setStatus} warning={<Affects what="dayRule">Forms already issued keep what they said; forms prepared from now on follow the new rule.</Affects>}
            onSubmit={data => api('/attendance-day-rule', 'POST', { ...data, version: rule?.version ?? 0 })}
            onSaved={() => { setEditing(false); setTick(t => t + 1); setStatus({ text: 'The school’s attendance rule is recorded.', kind: 'done' }); }} />
        </Sheet>
      ) : null}
    </div>
  );
}
