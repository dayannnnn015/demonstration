import { useId, useState, type FormEvent } from 'react';
import type { Api } from '../api';
import { ApiError, message, query } from '../api';
import { dayAndMonth } from '../dates';
import { Affects } from '../components/affects';
import { Sheet } from '../components/overlay';
import { Badge, Cell, StatusLine, Table, idle, type Status } from '../components/primitives';
import { pairWords, type Pair } from '../forms/sf2';

export type MarkChange = { enrollment_id: string; name: string; day_on: string; before: Pair; after: Pair };
export type RemarkChange = { enrollment_id: string; name: string; before: string; after: string; version: number };

type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended' | null;
type DaySheet = {
  version: number; recording_available: boolean; month_status?: 'draft' | 'submitted' | 'locked';
  schedule: { am: Mode; pm: Mode };
  items: (Pair & { enrollment_id: string })[];
  pagination: { next_after_id: string | null };
};
type Planned = { day_on: string; body: { day_on: string; version: number; changes: (Pair & { enrollment_id: string })[]; reason: string }; review_hash: string; changed: number };
type Refusal = { day_on: string; text: string };

/**
 * The SF2's changes, reviewed and recorded. Each date's marks go through the
 * register's own preview and confirmation, against that date's current
 * version, so a submitted or locked month, a closed year, a section the caller
 * does not advise or someone else's newer marks refuse the change exactly as
 * they would on the register. Remarks go to the same report notes the Remarks
 * sheet writes.
 */
export function Sf2EditReview({ api, sectionId, monthOn, marks, remarks, onClose, onDone, onConflict }: {
  api: Api; sectionId: string; monthOn: string; marks: MarkChange[]; remarks: RemarkChange[];
  onClose: () => void; onDone: (text: string) => void; onConflict: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ days: Planned[]; refused: Refusal[] } | null>(null);
  const days = [...new Set(marks.map(m => m.day_on))].sort();
  const text = reason.replace(/\s+/g, ' ').trim();

  const readDay = async (day: string) => {
    const first = await api<DaySheet>(`/sections/${sectionId}/attendance${query({ day_on: day, limit: 100 })}`);
    for (let after = first.pagination.next_after_id; after;) {
      const page = await api<DaySheet>(`/sections/${sectionId}/attendance${query({ day_on: day, limit: 100, after_id: after })}`);
      first.items.push(...page.items);
      after = page.pagination.next_after_id;
    }
    return first;
  };

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (text.length < 10) { setStatus({ kind: 'error', text: 'Give a reason of at least 10 characters. It is kept with each date’s record.' }); return; }
    setBusy(true);
    const planned: Planned[] = [], refused: Refusal[] = [];
    try {
      for (const [index, day] of days.entries()) {
        setStatus({ kind: 'busy', text: `Checking ${dayAndMonth(day)} (${index + 1} of ${days.length})…` });
        const sheet = await readDay(day);
        if (!sheet.recording_available) {
          refused.push({ day_on: day, text: sheet.month_status && sheet.month_status !== 'draft'
            ? `The month is ${sheet.month_status}. It takes no changes until it is returned or reopened on Monthly consolidation.`
            : 'This date cannot be recorded by you: only the section’s adviser records its register, in a school year that is open.' });
          continue;
        }
        // A session with no class keeps what it holds; only classroom sessions are marked.
        const changes = marks.filter(m => m.day_on === day).map(m => ({
          enrollment_id: m.enrollment_id,
          am: sheet.schedule.am === 'classroom' ? m.after.am : null,
          pm: sheet.schedule.pm === 'classroom' ? m.after.pm : null,
        }));
        const body = { day_on: day, version: sheet.version, changes, reason: text };
        try {
          const result = await api<{ review_hash: string; changed_count: number }>(`/sections/${sectionId}/attendance/preview`, 'POST', body);
          planned.push({ day_on: day, body, review_hash: result.review_hash, changed: result.changed_count });
        } catch (error) { refused.push({ day_on: day, text: message(error) }); }
      }
      setPlan({ days: planned, refused });
      setStatus(idle);
    } catch (error) { setStatus({ kind: 'error', text: message(error) }); }
    finally { setBusy(false); }
  };

  const record = async () => {
    if (!plan) return;
    setBusy(true);
    let done = 0;
    try {
      for (const [index, day] of plan.days.entries()) {
        setStatus({ kind: 'busy', text: `Recording ${dayAndMonth(day.day_on)} (${index + 1} of ${plan.days.length})…` });
        await api(`/sections/${sectionId}/attendance/corrections`, 'POST', { ...day.body, review_hash: day.review_hash, reviewed: true });
        done += 1;
      }
      if (remarks.length) {
        setStatus({ kind: 'busy', text: 'Recording the remarks…' });
        await api(`/sections/${sectionId}/report-notes`, 'POST', {
          kind: 'sf2_remark', month_on: monthOn, reason: text,
          entries: remarks.map(r => ({ enrollment_id: r.enrollment_id, body: r.after.trim() || null, version: r.version })),
        });
      }
      const parts = [done ? `${done} ${done === 1 ? 'date' : 'dates'} of the register` : '', remarks.length ? `${remarks.length} ${remarks.length === 1 ? 'remark' : 'remarks'}` : ''].filter(Boolean);
      onDone(`Recorded ${parts.join(' and ')}. The SF2 now shows them.${plan.refused.length ? ` ${plan.refused.length} ${plan.refused.length === 1 ? 'date was' : 'dates were'} refused and not recorded.` : ''}`);
    } catch (error) {
      const before = done ? `${done} ${done === 1 ? 'date was' : 'dates were'} recorded before this stopped. ` : '';
      if (error instanceof ApiError && error.isConflict) {
        setStatus({ kind: 'error', text: `${before}Someone changed these marks after you checked them, so nothing more was recorded. The SF2 has been read again; check the changes once more.` });
        setPlan(null);
        onConflict();
      } else setStatus({ kind: 'error', text: `${before}${message(error)}` });
    } finally { setBusy(false); }
  };

  const nothingToRecord = !!plan && !plan.days.length && !remarks.length;
  return (
    <Sheet title="Review the changes on this SF2" wide onClose={() => { if (!busy) onClose(); }}
      note="Nothing is recorded until you confirm. Each date is recorded in the daily register, under your name, with the reason below.">
      <StatusLine status={status} />
      <Affects what={remarks.length ? (marks.length ? ['register', 'remarks'] : 'remarks') : 'register'} />
      {marks.length ? (
        <Table rows={marks} rowKey={m => `${m.enrollment_id}|${m.day_on}`} columns={[
          { header: 'Learner', cell: m => <Cell title={m.name} /> },
          { header: 'Date', cell: m => dayAndMonth(m.day_on) },
          { header: 'Recorded', cell: m => pairWords(m.before) },
          { header: 'Now', cell: m => <b>{pairWords(m.after)}</b> },
        ]} />
      ) : null}
      {remarks.length ? (
        <Table rows={remarks} rowKey={r => r.enrollment_id} columns={[
          { header: 'Learner', cell: r => <Cell title={r.name} /> },
          { header: 'Remark recorded', cell: r => r.before || <span className="muted">None</span> },
          { header: 'Now', cell: r => (r.after.trim() ? <b>{r.after.trim()}</b> : <Badge tone="attention">Cleared</Badge>) },
        ]} />
      ) : null}
      {plan ? (
        <>
          {plan.refused.length ? (
            <div className="error-summary" role="alert">
              <h3>{plan.refused.length === 1 ? 'One date cannot be recorded' : `${plan.refused.length} dates cannot be recorded`}</h3>
              <ul>{plan.refused.map(r => <li key={r.day_on}><b>{dayAndMonth(r.day_on)}</b>: {r.text}</li>)}</ul>
            </div>
          ) : null}
          {plan.days.length ? <p className="card-note">Checked: {plan.days.map(d => `${dayAndMonth(d.day_on)} (${d.changed} ${d.changed === 1 ? 'learner' : 'learners'})`).join(', ')}.</p> : null}
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || nothingToRecord} aria-busy={busy} onClick={() => void record()}>{busy ? 'Recording…' : 'Record these changes'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setPlan(null)}>Change the reason</button>
          </div>
        </>
      ) : (
        <form onSubmit={check}>
          <div className="form-grid">
            <div className="field wide">
              <label className="label" htmlFor={`${id}-reason`}>Reason</label>
              <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              <span className="hint">10–500 characters, kept with each date’s record for good. Say why the marks change, for example a late excuse letter.</span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Checking…' : 'Check these changes'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Keep editing</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
