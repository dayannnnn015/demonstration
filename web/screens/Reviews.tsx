import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import { Sheet } from '../components/overlay';
import { lrnDigits } from '../record-fields';
import { Badge, Callout, Cell, EmptyState, Finder, Select, StatusLine, Table, TableSkeleton, Unrecorded, gradeName, idle, learnerName, sentence, value, type Status, ScrollArea } from '../components/primitives';

/**
 * The reviewed corrections to learner and enrollment records (Sections 2B.1
 * LRN correction, 2B.2 timeline, 2B.3 identity links, 2B.4 void and restore,
 * 2B.5 grade placement). Every one is manager-only and follows the same shape:
 * propose, read the server's own review of the proposal, confirm that exact
 * review. Nothing here is decided in the browser — the rules below are
 * restated only so a manager meets them before a request, and the database
 * checks every one of them again.
 */

export type EventType = 'enrolled' | 'reassigned' | 'withdrawn' | 'reentered';
export type Entry = { event_type: EventType; effective_on: string; section_id: string; reason: string };
type State = { enrolled_on: string; effective_on: string; status: 'enrolled' | 'withdrawn'; section_id: string; last_reason: string };
type Timeline = { enrollment_id: string; academic_year_id: string; grade_level: number; version: number; entries: Entry[]; record_state: 'valid' | 'voided'; usable_for_reporting: boolean };
type RevisionPlan = {
  version: number; review_hash: string | null; can_commit?: boolean; blocked?: { code: string; message: string }; previous_grade_level: number; corrected_grade_level: number; correction_kind: 'timeline' | 'placement';
  sections: { id: string; name: string; grade_level: number; adviser_user_id: string | null }[];
  before_entries: Entry[]; after_entries: Entry[]; reason: string; first_affected_on: string; previous_state: State; proposed_state: State;
};
type Correction = {
  id: string; enrollment_version: number; before_entries: Entry[]; after_entries: Entry[]; first_affected_on: string; reason: string; recorded_at: string;
  correction_kind: 'timeline' | 'placement'; previous_grade_level: number | null; corrected_grade_level: number | null;
};
type Profile = { id: string; lrn: string | null; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null; birth_date: string; sex: string; version: number; merged_into: string | null };
type IdentityPlan = {
  canonical: Profile; duplicate: Profile; action: 'link' | 'unlink'; reason: string; can_commit: boolean; review_hash: string | null; issues: string[];
  conflicting_year_ids: string[]; school_years: { id: string; start_year: number; status: string }[];
  enrollments: { id: string; recorded_learner_id: string; academic_year_id: string; record_state: 'valid' | 'voided'; grade_level: number; section_id: string; status: string; enrolled_on: string }[];
};
type IdentityEvent = { id: string; action: 'link' | 'unlink'; canonical_id: string; duplicate_id: string; before_canonical: Profile; before_duplicate: Profile; reason: string; recorded_at: string };
type RecordPlan = {
  enrollment: Row; learner: Profile; recorded_learner: Profile; timeline: Entry[]; school_year: { start_year: number; status: string };
  replacement: { enrollment: Row; learner: Profile; timeline: Entry[] } | null;
  action: 'void' | 'restore'; reason_code: string; reason: string; issues: string[]; can_commit: boolean; review_hash: string | null;
};
type RecordEvent = { id: string; enrollment_version: number; action: 'void' | 'restore'; reason_code: string; reason: string; replacement_enrollment_id: string | null; recorded_at: string };
type LrnEvent = { id: string; previous_lrn: string; corrected_lrn: string; reason: string; recorded_at: string };

// ---------------------------------------------------------------- vocabulary

export const eventName: Record<EventType, string> = { enrolled: 'Enrolled', reassigned: 'Moved section', withdrawn: 'Withdrawn', reentered: 'Re-entered' };

/** The reasons the API accepts for each kind of entry, in the words a register uses. */
export const entryReasons: Record<EventType, [string, string][]> = {
  enrolled: [['regular', 'Regular enrollment'], ['transfer_in', 'Transferred in']],
  reassigned: [['section_change', 'Section change']],
  withdrawn: [['transfer_out', 'Transferred out'], ['withdrawal', 'Withdrawn by the family'], ['dropout', 'Stopped attending'], ['death', 'Death']],
  reentered: [['return_to_school', 'Returned to school']],
};
const reasonName = (reason: string) => Object.values(entryReasons).flat().find(([key]) => key === reason)?.[1] ?? sentence(reason);

export const identityIssues: Record<string, string> = {
  SOURCE_HAS_LRN: 'The record being linked away has an LRN. Keep the record that carries the correct LRN; this workflow never clears one.',
  IDENTITY_FIELDS_DIFFER: 'The two records disagree on birth date or sex. Verify which is right and correct it on the record first; names may differ and are shown for you to judge.',
  OVERLAPPING_ENROLLMENT_YEARS: 'Both records hold a valid enrollment in the same school year. Void the one entered in error first — a withdrawn enrollment still counts, a voided one does not.',
  TARGET_IS_LINKED: 'The record to keep is itself linked into another. Link to the record it points to instead.',
  SOURCE_IS_LINKED: 'The record being linked away is already linked to another record. Reverse that link first.',
  SOURCE_HAS_LINKS: 'Other records are linked into the one being linked away. Reverse those links first; chains are not allowed.',
  LINK_NOT_FOUND: 'These two records are not currently linked. Reload and check which record this one points to.',
  BIRTH_DATE_CONFLICT: 'An enrollment would start before the birth date that would then apply. Correct the verified birth date or the enrollment history first.',
};

export const recordIssues: Record<string, string> = {
  YEAR_CLOSED: 'The school year is closed. A closed year’s records can be neither voided nor restored.',
  RECORD_STATE_UNCHANGED: 'The record is already in that state.',
  INVALID_REPLACEMENT: 'The record to keep must be a different, valid enrollment in the same school year.',
  REPLACEMENT_IDENTITY_CONFLICT: 'The record to keep belongs to a learner whose birth date, sex or assigned LRN disagrees with this one. Verify the learners before treating them as the same child.',
  REPLACEMENT_IN_USE: 'Another voided record names this one as the record to keep. Restore that record first.',
  ANNUAL_ENROLLMENT_EXISTS: 'This learner already has a valid enrollment in the same school year, so restoring this one would make two.',
  BIRTH_DATE_CONFLICT: 'The enrollment date no longer follows the learner’s birth date. Correct the verified birth date first, or keep this record voided as evidence.',
};

const voidReasons: [string, string][] = [['incorrect_entry', 'Entered in error — no other record replaces it'], ['duplicate_record', 'A duplicate of another enrollment that is kept']];

// ---------------------------------------------------------- pure timeline rules

/**
 * Why a proposed timeline would be refused, entry by entry, or an empty list.
 *
 * These are the API's own rules: the first entry enrols, dates strictly
 * increase, a move needs an enrolled learner and a different section, a
 * withdrawal needs an enrolled learner, and re-entry needs a withdrawn one who
 * did not die. Future dates are left to the server, which knows Manila's date.
 */
export function timelineProblems(entries: Entry[]): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  if (!entries.length) return [{ index: -1, text: 'A timeline needs at least the enrollment itself.' }];
  let status: 'enrolled' | 'withdrawn' | null = null;
  let section = '';
  let died = false;
  entries.forEach((entry, index) => {
    const add = (text: string) => out.push({ index, text });
    if (!entry.effective_on) add('Give this entry a date.');
    else if (index > 0 && entries[index - 1]!.effective_on && entry.effective_on <= entries[index - 1]!.effective_on) add('Dates must strictly increase: this one is not after the entry above it.');
    if (!entryReasons[entry.event_type].some(([key]) => key === entry.reason)) add(`“${reasonName(entry.reason)}” is not a reason for ${eventName[entry.event_type].toLowerCase()}.`);
    if (index === 0 && entry.event_type !== 'enrolled') add('The first entry must be the enrollment.');
    if (index > 0 && entry.event_type === 'enrolled') add('Only the first entry can be the enrollment.');
    if (entry.event_type === 'reassigned') {
      if (status !== 'enrolled') add('A move needs the learner to be enrolled at the time.');
      else if (entry.section_id === section) add('A move has to be to a different section.');
    }
    if (entry.event_type === 'withdrawn' && status !== 'enrolled') add('A withdrawal needs the learner to be enrolled at the time.');
    if (entry.event_type === 'reentered') {
      if (status !== 'withdrawn') add('Re-entry needs the learner to be withdrawn at the time.');
      else if (died) add('Re-entry after a recorded death is refused. Correct the death entry itself if it was recorded in error.');
    }
    if ((entry.event_type === 'enrolled' || entry.event_type === 'reassigned' || entry.event_type === 'reentered') && !entry.section_id) add('Choose a section.');
    status = entry.event_type === 'withdrawn' ? 'withdrawn' : 'enrolled';
    died = entry.event_type === 'withdrawn' && entry.reason === 'death';
    if (entry.event_type !== 'withdrawn') section = entry.section_id;
  });
  return out;
}

/** A withdrawal stays in the section it left, so its section is the one above it rather than a choice. */
export function normalise(entries: Entry[]): Entry[] {
  let section = '';
  return entries.map(entry => {
    if (entry.event_type === 'withdrawn') return { ...entry, section_id: section };
    section = entry.section_id;
    return entry;
  });
}

/** A whole-year grade correction: every date, type and reason kept, each section swapped for its mapped counterpart. */
export const remap = (entries: Entry[], mapping: Record<string, string>): Entry[] =>
  entries.map(entry => ({ ...entry, section_id: mapping[entry.section_id] ?? '' }));

/** The distinct sections a timeline passes through, in the order it meets them. */
export const sectionsOf = (entries: Entry[]) => [...new Set(entries.map(e => e.section_id))];

const tidy = (reason: string) => reason.trim().replace(/\s+/g, ' ');

// ---------------------------------------------------------- shared pieces

/**
 * Propose, read the review, confirm the review. The hash the preview returned
 * is what binds the confirmation to exactly what was read; a conflict kills it,
 * so the review is dropped rather than retried.
 */
function useReview<P extends { review_hash?: string | null; can_commit?: boolean; blocked?: { code: string; message: string } }>(api: Api) {
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<P | null>(null);
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);

  const preview = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setStatus({ text: 'Reviewing…', kind: 'busy' });
    try {
      const result = await api<P>(url, 'POST', body);
      setSent(body);
      setPlan(result);
      // A review whose commit would be refused says so here, before Confirm, in the words Confirm would use.
      setStatus(result.blocked ? { text: `This cannot be confirmed as proposed: ${result.blocked.message}`, kind: 'error' }
        : result.can_commit === false ? { text: 'This cannot be confirmed as proposed. What stands in the way is listed below.', kind: 'error' } : idle);
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const confirm = async (url: string, body: Record<string, unknown>, done: () => void) => {
    if (!plan?.review_hash) return;
    setBusy(true);
    setStatus({ text: 'Recording…', kind: 'busy' });
    try {
      await api(url, 'POST', { ...body, review_hash: plan.review_hash, reviewed: true });
      done();
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) { setPlan(null); setSent(null); }
      setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  const reset = () => { setPlan(null); setSent(null); setStatus(idle); };
  return { status, setStatus, busy, plan, sent, preview, confirm, reset };
}

function ReasonField({ id, value: text, onChange, hint }: { id: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="field wide">
      <label className="label" htmlFor={id}>Reason for this correction</label>
      <textarea id={id} required minLength={10} maxLength={500} value={text} onChange={event => onChange(event.target.value)} />
      <span className="hint">{hint ?? '10–500 characters on one line, kept with the correction for good. Say which school record it was checked against.'}</span>
    </div>
  );
}

function Confirmation({ busy, ready, label, onConfirm, onBack, lost }: { busy: boolean; ready: boolean; label: string; onConfirm: () => void; onBack: () => void; lost?: string }) {
  return (
    <>
      <p className="muted">{lost ?? 'If you confirm and never see a response, check the history before trying again rather than confirming twice.'}</p>
      <div className="form-actions">
        <button type="button" className="btn" disabled={busy || !ready} aria-busy={busy} onClick={onConfirm}>{busy ? 'Recording…' : label}</button>
        <button type="button" className="btn ghost small" disabled={busy} onClick={onBack}>Change something</button>
      </div>
    </>
  );
}

function Issues({ issues, text }: { issues: string[]; text: Record<string, string> }) {
  if (!issues.length) return null;
  return (
    <Callout tone="stopped" title="This cannot be confirmed yet">
      <ul>{issues.map(code => <li key={code}>{text[code] ?? code}</li>)}</ul>
    </Callout>
  );
}

/** A timeline as a register of dated entries, with section names resolved. */
export function EntryTable({ entries, sectionName }: { entries: Entry[]; sectionName: (id: string) => string }) {
  return (
    <Table
      rows={entries.map((entry, index) => ({ ...entry, index }))}
      rowKey={entry => String(entry.index)}
      empty={<p className="muted">No entries.</p>}
      columns={[
        { header: 'Effective', cell: entry => <span className="mono">{entry.effective_on}</span> },
        { header: 'What happened', cell: entry => <Cell title={eventName[entry.event_type]} meta={reasonName(entry.reason)} /> },
        { header: 'Section', cell: entry => (entry.event_type === 'withdrawn' ? <span className="muted">Left {sectionName(entry.section_id)}</span> : sectionName(entry.section_id)) },
      ]}
    />
  );
}

const stateText = (state: State, sectionName: (id: string) => string) =>
  `${state.status === 'withdrawn' ? `Withdrawn (${reasonName(state.last_reason)})` : 'Enrolled'} in ${sectionName(state.section_id)} from ${state.effective_on}`;

// ---------------------------------------------------------- 2B.2 timeline

function EntryEditor({ entries, setEntries, sections, problems }: {
  entries: Entry[]; setEntries: (e: Entry[]) => void; sections: Row[]; problems: { index: number; text: string }[];
}) {
  const id = useId();
  const put = (index: number, patch: Partial<Entry>) => setEntries(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const types = (index: number): EventType[] => (index === 0 ? ['enrolled'] : ['reassigned', 'withdrawn', 'reentered']);
  return (
    <ScrollArea>
      <table>
        <thead>
          <tr><th scope="col">#</th><th scope="col">What happened</th><th scope="col">Effective</th><th scope="col">Section</th><th scope="col">Reason</th><th scope="col" className="actions">Remove</th></tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const here = problems.filter(p => p.index === index);
            return (
              <tr key={index} className={here.length ? 'row-bad' : undefined}>
                <td className="mono">{index + 1}</td>
                <td>
                  <Select aria-label={`Entry ${index + 1}: what happened`} value={entry.event_type}
                    onChange={event => { const type = event.target.value as EventType; put(index, { event_type: type, reason: entryReasons[type][0]![0] }); }}>
                    {types(index).map(type => <option key={type} value={type}>{eventName[type]}</option>)}
                  </Select>
                </td>
                <td>
                  <input aria-label={`Entry ${index + 1}: effective date`} type="date" className="date-input" value={entry.effective_on} onChange={event => put(index, { effective_on: event.target.value })} />
                </td>
                <td>
                  {entry.event_type === 'withdrawn' ? <span className="muted">Stays in the section above</span> : (
                    <Select aria-label={`Entry ${index + 1}: section`} value={entry.section_id} onChange={event => put(index, { section_id: event.target.value })}>
                      <option value="">Choose a section</option>
                      {sections.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
                    </Select>
                  )}
                  {here.length ? <span className="field-error" id={`${id}-${index}`}>{here.map(p => p.text).join(' ')}</span> : null}
                </td>
                <td>
                  <Select aria-label={`Entry ${index + 1}: reason`} value={entry.reason} onChange={event => put(index, { reason: event.target.value })}>
                    {entryReasons[entry.event_type].map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </Select>
                </td>
                <td className="actions">
                  {index > 0 ? <button type="button" className="btn ghost small" onClick={() => setEntries(entries.filter((_, i) => i !== index))}>Remove</button> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

/**
 * Correct the dated history of one annual enrollment: fix a wrong date, remove
 * a movement recorded in error, or add one that was missed. The whole sequence
 * is sent, reviewed and confirmed; the original movements are kept as evidence
 * and never rewritten.
 */
export function TimelineSheet({ api, enrollment, sections, sectionName, onClose, onDone }: {
  api: Api; enrollment: Row; sections: Row[]; sectionName: (id: string) => string; onClose: () => void; onDone: (text: string) => void;
}) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const review = useReview<RevisionPlan>(api);
  const id = useId();
  const choices = sections.filter(s => s.academic_year_id === enrollment.academic_year_id && Number(s.grade_level) === Number(enrollment.grade_level));

  useEffect(() => {
    void api<Timeline>(`/enrollments/${enrollment.id}/timeline`)
      .then(t => { setTimeline(t); setEntries(t.entries); })
      .catch(error => review.setStatus({ text: message(error), kind: 'error' }));
  }, [api, enrollment.id]);

  const problems = timelineProblems(entries);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problems.length || !timeline) return;
    void review.preview(`/enrollments/${enrollment.id}/timeline/preview`, { version: timeline.version, entries: normalise(entries), reason: tidy(reason) });
  };
  const plan = review.plan;

  return (
    <Sheet title="Correct the enrollment timeline" note="Edit the whole dated history, review what changes, then confirm. The original movements stay on file as evidence." wide onClose={onClose}>
      <StatusLine status={review.status} />
      {plan ? (
        <>
          <dl className="facts">
            <div><dt>Earliest date affected</dt><dd className="mono">{plan.first_affected_on}</dd></div>
            <div><dt>Latest state now</dt><dd>{stateText(plan.previous_state, sectionName)}</dd></div>
            <div><dt>Latest state after</dt><dd>{stateText(plan.proposed_state, sectionName)}</dd></div>
          </dl>
          <div className="split">
            <div className="card"><div className="card-head"><h2>As recorded now</h2></div><EntryTable entries={plan.before_entries} sectionName={sectionName} /></div>
            <div className="card"><div className="card-head"><h2>After the correction</h2></div><EntryTable entries={plan.after_entries} sectionName={sectionName} /></div>
          </div>
          <p className="muted">Reason: {plan.reason}</p>
          <Confirmation busy={review.busy} ready={!!plan.review_hash} label="Confirm this correction" onBack={review.reset}
            onConfirm={() => void review.confirm(`/enrollments/${enrollment.id}/timeline/corrections`,
              { version: plan.version, entries: plan.after_entries, reason: plan.reason }, () => onDone('The timeline is corrected.'))} />
        </>
      ) : !timeline ? <TableSkeleton columns={5} rows={3} /> : (
        <form noValidate onSubmit={submit}>
          {!timeline.usable_for_reporting ? <Callout tone="attention" title="This record is voided">A voided record cannot be corrected. Restore it first.</Callout> : null}
          <EntryEditor entries={entries} setEntries={setEntries} sections={choices} problems={tried ? problems : []} />
          <div className="form-actions">
            <button type="button" className="btn secondary small" onClick={() => {
              const last = entries[entries.length - 1];
              const type: EventType = last?.event_type === 'withdrawn' ? 'reentered' : 'reassigned';
              setEntries([...entries, { event_type: type, effective_on: '', section_id: type === 'reentered' ? String(last?.section_id ?? '') : '', reason: entryReasons[type][0]![0] }]);
            }}>Add a movement</button>
            <button type="button" className="btn ghost small" onClick={() => setEntries(timeline.entries)}>Start again from the record</button>
          </div>
          <p className="muted">Sections are limited to {gradeName(enrollment.grade_level)} in this school year: a correction never changes the grade or the year. The grade is corrected separately.</p>
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
          {tried && problems.length ? <Callout tone="attention" title="Fix the marked entries first">Each problem is shown on its entry.</Callout> : null}
          <div className="form-actions"><button type="submit" className="btn" disabled={review.busy} aria-busy={review.busy}>{review.busy ? 'Reviewing…' : 'Review this correction'}</button></div>
        </form>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------- 2B.5 placement

/**
 * Correct the grade a whole year was recorded under. Every date, movement and
 * reason stays; each section is swapped for one in the corrected grade. This is
 * a correction of a recording mistake, never a promotion.
 */
export function PlacementSheet({ api, enrollment, sections, sectionName, onClose, onDone }: {
  api: Api; enrollment: Row; sections: Row[]; sectionName: (id: string) => string; onClose: () => void; onDone: (text: string) => void;
}) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [grade, setGrade] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const review = useReview<RevisionPlan>(api);
  const id = useId();

  useEffect(() => {
    void api<Timeline>(`/enrollments/${enrollment.id}/timeline`).then(setTimeline).catch(error => review.setStatus({ text: message(error), kind: 'error' }));
  }, [api, enrollment.id]);

  const current = Number(enrollment.grade_level);
  const targets = sections.filter(s => s.academic_year_id === enrollment.academic_year_id && String(s.grade_level) === grade);
  const used = timeline ? sectionsOf(timeline.entries) : [];
  const complete = !!grade && used.every(s => mapping[s]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!timeline || !complete) { review.setStatus({ text: 'Choose the corrected grade and a section in it for every section the year passed through.', kind: 'error' }); return; }
    void review.preview(`/enrollments/${enrollment.id}/placement/preview`, { version: timeline.version, grade_level: Number(grade), entries: remap(timeline.entries, mapping), reason: tidy(reason) });
  };
  const plan = review.plan;

  return (
    <Sheet title="Correct the grade placement" note="For a year recorded under the wrong grade. Dates and movements stay exactly as they are; only the grade and its sections change." wide onClose={onClose}>
      <StatusLine status={review.status} />
      {plan ? (
        <>
          <dl className="facts">
            <div><dt>Grade</dt><dd>{gradeName(plan.previous_grade_level)} → <b>{gradeName(plan.corrected_grade_level)}</b></dd></div>
            <div><dt>Latest state after</dt><dd>{stateText(plan.proposed_state, sectionName)}</dd></div>
          </dl>
          <div className="split">
            <div className="card"><div className="card-head"><h2>As recorded now</h2></div><EntryTable entries={plan.before_entries} sectionName={sectionName} /></div>
            <div className="card"><div className="card-head"><h2>After the correction</h2></div><EntryTable entries={plan.after_entries} sectionName={sectionName} /></div>
          </div>
          <p className="muted">Reason: {plan.reason}</p>
          <Confirmation busy={review.busy} ready={!!plan.review_hash} label="Confirm the corrected grade" onBack={review.reset}
            onConfirm={() => void review.confirm(`/enrollments/${enrollment.id}/placement/corrections`,
              { version: plan.version, grade_level: plan.corrected_grade_level, entries: plan.after_entries, reason: plan.reason }, () => onDone('The grade placement is corrected.'))} />
        </>
      ) : !timeline ? <TableSkeleton columns={3} rows={3} /> : (
        <form noValidate onSubmit={submit}>
          <Callout tone="info" title="Not a promotion">
            This corrects a year recorded under the wrong grade. Moving a learner up at the end of a year is a separate workflow that does not exist yet.
          </Callout>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor={`${id}-grade`}>Corrected grade</label>
              <Select id={`${id}-grade`} value={grade} onChange={event => { setGrade(event.target.value); setMapping({}); }}>
                <option value="">Choose the verified grade</option>
                {[0, 1, 2, 3, 4, 5, 6].filter(g => g !== current).map(g => <option key={g} value={String(g)}>{gradeName(g)}</option>)}
              </Select>
              <span className="hint">Recorded now as {gradeName(current)}.</span>
            </div>
          </div>
          {grade && !targets.length ? (
            <Callout tone="attention" title={`No ${gradeName(grade)} section in this school year`}>Add one on School years &amp; sections first.</Callout>
          ) : null}
          {grade && targets.length ? (
            <div className="form-grid">
              {used.map(from => (
                <div className="field" key={from}>
                  <label className="label" htmlFor={`${id}-${from}`}>Instead of {sectionName(from)}</label>
                  <Select id={`${id}-${from}`} value={mapping[from] ?? ''} onChange={event => setMapping(m => ({ ...m, [from]: event.target.value }))}>
                    <option value="">Choose a section</option>
                    {targets.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          ) : null}
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
          <div className="form-actions"><button type="submit" className="btn" disabled={review.busy} aria-busy={review.busy}>{review.busy ? 'Reviewing…' : 'Review this correction'}</button></div>
        </form>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------- finding a learner

/**
 * Search the registry for one learner. It reads only when asked, because every
 * learner list writes a privacy-audit row naming the records it returned.
 */
function LearnerPicker({ api, exclude, onChoose, setStatus }: { api: Api; exclude: string; onChoose: (learner: Row) => void; setStatus: (s: Status) => void }) {
  const [found, setFound] = useState<Row[] | null>(null);
  return (
    <>
      <Finder
        initial={{ search: '', lrn: '' }}
        onApply={async values => {
          setFound(null);
          try { setFound((await api<Page>(`/learners${query({ ...values, limit: 25 })}`)).items.filter(r => r.id !== exclude)); }
          catch (error) { setStatus({ text: message(error), kind: 'error' }); setFound([]); }
        }}
        onClear={() => setFound(null)}
        fields={[
          { key: 'search', label: 'Name or LRN', optional: true, minLength: 2, maxLength: 100, hint: 'At least two characters.' },
          { key: 'lrn', label: 'Exact LRN', optional: true, pattern: '[0-9 -]{12,20}', maxLength: 20 },
        ]}
      />
      {found === null ? <p className="muted">Search for the other record. Nothing is read until you do.</p> : (
        <Table
          rows={found}
          rowKey={r => String(r.id)}
          empty={<EmptyState title="No other learner found" body="Check the spelling or search by LRN." />}
          columns={[
            { header: 'Learner', cell: r => <Cell title={learnerName(r)} meta={r.lrn ? `LRN ${value(r, 'lrn')}` : <Unrecorded label="LRN missing" />} /> },
            { header: 'Birth date', cell: r => <span className="mono">{value(r, 'birth_date')}</span> },
            { header: 'Sex', cell: r => sentence(value(r, 'sex')) },
            { header: '', cell: r => <button type="button" className="btn secondary small" onClick={() => onChoose(r)}>Choose</button> },
          ]}
        />
      )}
    </>
  );
}

function ProfileFacts({ title, profile }: { title: string; profile: Profile }) {
  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2></div>
      <div className="card-body">
        <dl className="facts">
          <div><dt>Name</dt><dd>{learnerName(profile)}</dd></div>
          <div><dt>LRN</dt><dd>{profile.lrn ? <span className="mono">{profile.lrn}</span> : <Unrecorded label="LRN missing" />}</dd></div>
          <div><dt>Birth date</dt><dd className="mono">{profile.birth_date}</dd></div>
          <div><dt>Sex</dt><dd>{sentence(profile.sex)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- 2B.3 identity

/**
 * Record that two registry entries are the same child, or reverse that. Both
 * records stay: the one linked away points at the one kept and is frozen, and
 * every enrollment keeps its original owner. Matching names never do this by
 * themselves — a manager checks the school's own records first.
 */
export function IdentitySheet({ api, learner, action, onClose, onDone }: {
  api: Api; learner: Row; action: 'link' | 'unlink'; onClose: () => void; onDone: (text: string) => void;
}) {
  const [other, setOther] = useState<Row | null>(null);
  const [keep, setKeep] = useState<'this' | 'other'>('this');
  const [reason, setReason] = useState('');
  const review = useReview<IdentityPlan>(api);
  const id = useId();

  // A reversal names the record this one points at, read fresh for its version.
  useEffect(() => {
    if (action !== 'unlink' || !learner.merged_into) return;
    void api<Row>(`/learners/${learner.merged_into}`).then(setOther).catch(error => review.setStatus({ text: message(error), kind: 'error' }));
  }, [api, action, learner.merged_into]);

  const canonical = action === 'unlink' ? other : keep === 'this' ? learner : other;
  const duplicate = action === 'unlink' ? learner : keep === 'this' ? other : learner;
  const body = () => ({
    canonical_id: canonical!.id, duplicate_id: duplicate!.id, canonical_version: canonical!.version, duplicate_version: duplicate!.version, action, reason: tidy(reason),
  });
  const plan = review.plan;
  const yearOf = (yearId: string) => { const y = plan?.school_years.find(s => s.id === yearId); return y ? `${y.start_year}–${y.start_year + 1}` : 'Unknown year'; };

  return (
    <Sheet
      title={action === 'link' ? 'Link a duplicate record' : 'Reverse this link'}
      note={action === 'link'
        ? 'For two registry entries that are the same child. Both stay on file; the one linked away is frozen and points at the one kept.'
        : 'Separates the two records again. The link and everything recorded since stay in the history.'}
      wide
      onClose={onClose}
    >
      <StatusLine status={review.status} />
      {plan ? (
        <>
          <Issues issues={plan.issues} text={identityIssues} />
          <div className="split">
            <ProfileFacts title={plan.action === 'link' ? 'Kept' : 'Currently kept'} profile={plan.canonical} />
            <ProfileFacts title={plan.action === 'link' ? 'Linked away' : 'Separated again'} profile={plan.duplicate} />
          </div>
          <Table
            rows={plan.enrollments}
            rowKey={e => e.id}
            empty={<p className="muted">Neither record has an enrollment.</p>}
            columns={[
              { header: 'School year', cell: e => <>{yearOf(e.academic_year_id)}{plan.conflicting_year_ids.includes(e.academic_year_id) ? <> <Badge tone="stopped">Overlap</Badge></> : null}</> },
              { header: 'Grade', cell: e => gradeName(e.grade_level) },
              { header: 'Recorded under', cell: e => (e.recorded_learner_id === plan.canonical.id ? 'Kept record' : 'Linked record') },
              { header: 'Status', cell: e => sentence(e.status) },
              { header: 'Record', cell: e => (e.record_state === 'voided' ? <Badge tone="stopped">Voided</Badge> : <Badge tone="neutral">Valid</Badge>) },
            ]}
          />
          <p className="muted">Reason: {plan.reason}</p>
          <Confirmation busy={review.busy} ready={plan.can_commit && !!plan.review_hash} label={plan.action === 'link' ? 'Confirm the link' : 'Confirm the reversal'}
            onBack={review.reset} onConfirm={() => void review.confirm('/learner-reconciliations', review.sent!, () => onDone(plan.action === 'link' ? 'The records are linked.' : 'The link is reversed.'))} />
        </>
      ) : action === 'link' && !other ? (
        <>
          <p>Find the other record for <b>{learnerName(learner)}</b>.</p>
          <LearnerPicker api={api} exclude={String(learner.id)} onChoose={setOther} setStatus={review.setStatus} />
        </>
      ) : !other ? <TableSkeleton columns={3} rows={2} /> : (
        <form noValidate onSubmit={event => { event.preventDefault(); void review.preview('/learner-reconciliations/preview', body()); }}>
          {action === 'link' ? (
            <fieldset className="choose">
              <legend className="label">Which record is kept?</legend>
              {(['this', 'other'] as const).map(side => {
                const record = side === 'this' ? learner : other;
                return (
                  <label key={side} className="check-line">
                    <input type="radio" name={`${id}-keep`} checked={keep === side} onChange={() => setKeep(side)} />
                    <span>{learnerName(record)} · {record.lrn ? `LRN ${value(record, 'lrn')}` : 'no LRN'} · born {value(record, 'birth_date')}</span>
                  </label>
                );
              })}
              <span className="hint">Keep the record carrying the correct LRN. The other is frozen and hidden from ordinary lists.</span>
            </fieldset>
          ) : (
            <p>This record points at <b>{learnerName(other)}</b>. Reversing makes them two separate children again.</p>
          )}
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} hint="10–500 characters on one line. Say which school records show these are, or are not, the same child." />
          <div className="form-actions">
            <button type="submit" className="btn" disabled={review.busy} aria-busy={review.busy}>{review.busy ? 'Reviewing…' : 'Review'}</button>
            {action === 'link' ? <button type="button" className="btn ghost small" onClick={() => setOther(null)}>Choose another record</button> : null}
          </div>
        </form>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------- 2B.4 void / restore

/**
 * Void an annual record that should not count, or restore one. Voiding is not
 * a withdrawal: it invents no date and says nothing about the child. The record
 * and its history stay on file as evidence either way.
 */
export function RecordSheet({ api, enrollment, action, learnerName: nameOf, onClose, onDone }: {
  api: Api; enrollment: Row; action: 'void' | 'restore'; learnerName: string; onClose: () => void; onDone: (text: string) => void;
}) {
  const [code, setCode] = useState(action === 'restore' ? 'restoration' : 'incorrect_entry');
  const [owner, setOwner] = useState<Row | null>(null);
  const [candidates, setCandidates] = useState<Row[] | null>(null);
  const [replacement, setReplacement] = useState('');
  const [reason, setReason] = useState('');
  const review = useReview<RecordPlan>(api);
  const id = useId();

  useEffect(() => {
    if (!owner) { setCandidates(null); return; }
    void api<Page>(`/enrollments${query({ learner_id: String(owner.id), academic_year_id: String(enrollment.academic_year_id), limit: 100 })}`)
      .then(page => setCandidates(page.items.filter(e => e.id !== enrollment.id)))
      .catch(error => { review.setStatus({ text: message(error), kind: 'error' }); setCandidates([]); });
  }, [api, owner, enrollment.id, enrollment.academic_year_id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code === 'duplicate_record' && !replacement) { review.setStatus({ text: 'Choose the enrollment that is kept.', kind: 'error' }); return; }
    void review.preview(`/enrollments/${enrollment.id}/record-review/preview`, {
      version: enrollment.version, action, reason_code: code, reason: tidy(reason), replacement_enrollment_id: code === 'duplicate_record' ? replacement : null,
    });
  };
  const plan = review.plan;
  const sectionOf = (row: Row) => `${gradeName(row.grade_level)}, ${sentence(value(row, 'status'))} from ${value(row, 'effective_on')}`;

  return (
    <Sheet
      title={action === 'void' ? 'Void this enrollment' : 'Restore this enrollment'}
      note={action === 'void'
        ? 'For a record that should not count at all. It is not a withdrawal, and the record and its history stay on file as evidence.'
        : 'Makes a voided record count again, if nothing now conflicts with it.'}
      wide
      onClose={onClose}
    >
      <StatusLine status={review.status} />
      {plan ? (
        <>
          <Issues issues={plan.issues} text={recordIssues} />
          <dl className="facts">
            <div><dt>Learner</dt><dd>{learnerName(plan.learner)}</dd></div>
            <div><dt>School year</dt><dd>{plan.school_year.start_year}–{plan.school_year.start_year + 1}</dd></div>
            <div><dt>This record</dt><dd>{sectionOf(plan.enrollment)}</dd></div>
            <div><dt>Becomes</dt><dd><Badge tone={plan.action === 'void' ? 'stopped' : 'good'}>{plan.action === 'void' ? 'Voided' : 'Valid'}</Badge></dd></div>
            {plan.replacement ? <div><dt>Kept instead</dt><dd>{learnerName(plan.replacement.learner)} · {sectionOf(plan.replacement.enrollment)}</dd></div> : null}
          </dl>
          <p className="muted">Reason: {plan.reason}</p>
          <Confirmation busy={review.busy} ready={plan.can_commit && !!plan.review_hash} label={plan.action === 'void' ? 'Confirm and void' : 'Confirm and restore'}
            onBack={review.reset} onConfirm={() => void review.confirm(`/enrollments/${enrollment.id}/record-review`, review.sent!, () => onDone(plan.action === 'void' ? 'The enrollment is voided.' : 'The enrollment is restored.'))} />
        </>
      ) : (
        <form noValidate onSubmit={submit}>
          <p>{nameOf} · {sectionOf(enrollment)}</p>
          {action === 'void' ? (
            <div className="form-grid">
              <div className="field wide">
                <label className="label" htmlFor={`${id}-code`}>Why it should not count</label>
                <Select id={`${id}-code`} value={code} onChange={event => { setCode(event.target.value); setReplacement(''); }}>
                  {voidReasons.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                </Select>
                <span className="hint">A real withdrawal, transfer or death is recorded as a movement instead, with its date.</span>
              </div>
            </div>
          ) : null}
          {code === 'duplicate_record' ? (
            <>
              <h3>The enrollment that is kept</h3>
              {!owner ? <LearnerPicker api={api} exclude="" onChoose={setOwner} setStatus={review.setStatus} /> : (
                <>
                  <p>Enrollments of <b>{learnerName(owner)}</b> in the same school year. <button type="button" className="btn ghost small" onClick={() => { setOwner(null); setReplacement(''); }}>Choose another learner</button></p>
                  <Table
                    loading={candidates === null}
                    rows={candidates ?? []}
                    rowKey={r => String(r.id)}
                    empty={<p className="muted">That learner has no other valid enrollment in this school year.</p>}
                    columns={[
                      { header: 'Choose', className: 'pick', cell: r => <input type="radio" name={`${id}-keep`} aria-label={`Keep ${sectionOf(r)}`} checked={replacement === r.id} onChange={() => setReplacement(String(r.id))} /> },
                      { header: 'Enrollment', cell: r => sectionOf(r) },
                      { header: 'Enrolled', cell: r => <span className="mono">{value(r, 'enrolled_on')}</span> },
                    ]}
                  />
                </>
              )}
            </>
          ) : null}
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
          <div className="form-actions"><button type="submit" className="btn" disabled={review.busy} aria-busy={review.busy}>{review.busy ? 'Reviewing…' : 'Review'}</button></div>
        </form>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------- 2B.1 LRN correction

/**
 * Correct an LRN that was assigned wrongly. There is no server preview for
 * this one, so the review is drawn here — the old and new numbers side by side
 * — and only then is `reviewed: true` sent.
 */
export function LrnCorrection({ api, learner, setStatus, onDone }: { api: Api; learner: Row; setStatus: (s: Status) => void; onDone: () => void }) {
  const [lrn, setLrn] = useState('');
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const problem = !/^[0-9]{12}$/.test(lrn) ? 'An LRN is exactly twelve digits.' : lrn === learner.lrn ? 'That is the LRN already recorded.' : tidy(reason).length < 10 ? 'Give a reason of at least ten characters.' : null;

  if (reviewing) {
    return (
      <>
        <dl className="facts">
          <div><dt>Recorded now</dt><dd className="mono">{value(learner, 'lrn')}</dd></div>
          <div><dt>Corrected to</dt><dd className="mono"><b>{lrn}</b></dd></div>
          <div><dt>Reason</dt><dd>{tidy(reason)}</dd></div>
        </dl>
        <p className="muted">The old number is kept in the correction history. Check the new one against the school’s own record a digit at a time.</p>
        <div className="form-actions">
          <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={async () => {
            setBusy(true);
            setStatus({ text: 'Recording…', kind: 'busy' });
            try {
              await api(`/learners/${learner.id}/lrn-corrections`, 'POST', { version: learner.version, previous_lrn: learner.lrn, corrected_lrn: lrn, reason: tidy(reason), reviewed: true });
              setStatus({ text: 'LRN corrected.', kind: 'done' });
              onDone();
            } catch (error) { setStatus({ text: message(error), kind: 'error' }); setReviewing(false); }
            finally { setBusy(false); }
          }}>{busy ? 'Recording…' : 'Confirm the corrected LRN'}</button>
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => setReviewing(false)}>Change something</button>
        </div>
      </>
    );
  }
  return (
    <form noValidate onSubmit={event => { event.preventDefault(); if (!problem) setReviewing(true); else setStatus({ text: problem, kind: 'error' }); }}>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${id}-lrn`}>Corrected LRN</label>
          <input id={`${id}-lrn`} className="mono" inputMode="numeric" maxLength={20} value={lrn} onChange={event => setLrn(lrnDigits(event.target.value))} />
          <span className="hint">Exactly twelve digits. Recorded now as <span className="mono">{value(learner, 'lrn')}</span>.</span>
        </div>
        <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
      </div>
      <div className="form-actions"><button type="submit" className="btn">Review this correction</button></div>
    </form>
  );
}

// ---------------------------------------------------------- histories

function Older({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" className="btn ghost small" onClick={onClick}>{label}</button>;
}

export function TimelineHistory({ api, enrollmentId, sectionName }: { api: Api; enrollmentId: string; sectionName: (id: string) => string }) {
  const [rows, setRows] = useState<Correction[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const read = async (before?: number) => {
    const page = await api<{ items: Correction[]; pagination: { next_before_version: number | null } }>(`/enrollments/${enrollmentId}/timeline/corrections${query({ limit: 5, before_version: before })}`);
    setRows(current => (before ? [...(current ?? []), ...page.items] : page.items));
    setCursor(page.pagination.next_before_version);
  };
  useEffect(() => { void read().catch(() => setRows([])); }, [enrollmentId]);
  return (
    <>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={r => r.id}
        empty={<p className="muted">This record has never been corrected. Its timeline is the movements as they were recorded.</p>}
        columns={[
          { header: 'Recorded', cell: r => <span className="mono">{new Date(r.recorded_at).toLocaleString()}</span> },
          { header: 'Kind', cell: r => (r.correction_kind === 'placement'
            ? `Grade: ${r.previous_grade_level == null ? 'unknown' : gradeName(r.previous_grade_level)} → ${r.corrected_grade_level == null ? 'unknown' : gradeName(r.corrected_grade_level)}`
            : 'Timeline') },
          { header: 'From', cell: r => <span className="mono">{r.first_affected_on}</span> },
          { header: 'Reason', cell: r => r.reason },
        ]}
        detailLabel="Entries"
        detail={r => (
          <div className="split">
            <div className="card"><div className="card-head"><h2>Before</h2></div><EntryTable entries={r.before_entries} sectionName={sectionName} /></div>
            <div className="card"><div className="card-head"><h2>After</h2></div><EntryTable entries={r.after_entries} sectionName={sectionName} /></div>
          </div>
        )}
      />
      {cursor !== null ? <Older label="Show older corrections" onClick={() => void read(cursor)} /> : null}
    </>
  );
}

export function RecordHistory({ api, enrollmentId }: { api: Api; enrollmentId: string }) {
  const [rows, setRows] = useState<RecordEvent[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const read = async (before?: number) => {
    const page = await api<{ items: RecordEvent[]; pagination: { next_before_version: number | null } }>(`/enrollments/${enrollmentId}/record-review${query({ limit: 5, before_version: before })}`);
    setRows(current => (before ? [...(current ?? []), ...page.items] : page.items));
    setCursor(page.pagination.next_before_version);
  };
  useEffect(() => { void read().catch(() => setRows([])); }, [enrollmentId]);
  return (
    <>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={r => r.id}
        empty={<p className="muted">This record has never been voided or restored.</p>}
        columns={[
          { header: 'Recorded', cell: r => <span className="mono">{new Date(r.recorded_at).toLocaleString()}</span> },
          { header: 'Action', cell: r => <Badge tone={r.action === 'void' ? 'stopped' : 'good'}>{r.action === 'void' ? 'Voided' : 'Restored'}</Badge> },
          { header: 'Why', cell: r => sentence(r.reason_code) },
          { header: 'Reason', cell: r => r.reason },
        ]}
      />
      {cursor !== null ? <Older label="Show older reviews" onClick={() => void read(cursor)} /> : null}
    </>
  );
}

export function IdentityHistory({ api, learnerId }: { api: Api; learnerId: string }) {
  const [rows, setRows] = useState<IdentityEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const read = async (offset = 0) => {
    const page = await api<{ items: IdentityEvent[]; pagination: { has_more: boolean } }>(`/learners/${learnerId}/identity-history${query({ limit: 10, offset })}`);
    setRows(current => (offset ? [...(current ?? []), ...page.items] : page.items));
    setMore(page.pagination.has_more);
  };
  useEffect(() => { void read().catch(() => setRows([])); }, [learnerId]);
  return (
    <>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={r => r.id}
        empty={<p className="muted">This record has never been linked to another.</p>}
        columns={[
          { header: 'Recorded', cell: r => <span className="mono">{new Date(r.recorded_at).toLocaleString()}</span> },
          { header: 'Action', cell: r => <Badge tone={r.action === 'link' ? 'info' : 'neutral'}>{r.action === 'link' ? 'Linked' : 'Reversed'}</Badge> },
          { header: 'Kept', cell: r => learnerName(r.before_canonical) },
          { header: 'Linked away', cell: r => learnerName(r.before_duplicate) },
          { header: 'Reason', cell: r => r.reason },
        ]}
      />
      {more ? <Older label="Show older" onClick={() => void read(rows?.length ?? 0)} /> : null}
    </>
  );
}

export function LrnHistory({ api, learnerId }: { api: Api; learnerId: string }) {
  const [rows, setRows] = useState<LrnEvent[] | null>(null);
  useEffect(() => { void api<Page<LrnEvent>>(`/learners/${learnerId}/lrn-corrections${query({ limit: 50 })}`).then(p => setRows(p.items)).catch(() => setRows([])); }, [api, learnerId]);
  return (
    <Table
      loading={rows === null}
      rows={rows ?? []}
      rowKey={r => r.id}
      empty={<p className="muted">This LRN has never been corrected.</p>}
      columns={[
        { header: 'Recorded', cell: r => <span className="mono">{new Date(r.recorded_at).toLocaleString()}</span> },
        { header: 'Was', cell: r => <span className="mono">{r.previous_lrn}</span> },
        { header: 'Now', cell: r => <span className="mono">{r.corrected_lrn}</span> },
        { header: 'Reason', cell: r => r.reason },
      ]}
    />
  );
}

/** A labelled group of the reviewed actions available on one record. */
export function ReviewActions({ children }: { children: ReactNode }) {
  return <div className="form-actions review-actions">{children}</div>;
}
