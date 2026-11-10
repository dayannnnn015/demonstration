import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { clamp, shift, weekday } from '../dates';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { sectionName, useScope } from '../components/scope';
import {
  Badge, Callout, Cell, EmptyState, PageHeader, Select, StatusLine, Table, TableSkeleton,
  Unrecorded, gradeName, idle, learnerName, localToday, sentence, yearName, type Status,
} from '../components/primitives';
import { windowProblem } from './Monitor';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

export type Category = 'absence' | 'recording_gap';
export type CaseStatus = 'open' | 'resolved' | 'cancelled';
export type Action = 'update' | 'resolve' | 'cancel' | 'reopen';
type Names = { first_name: string; middle_name: string | null; last_name: string; name_extension: string | null };
type Tally = { absent_sessions: number; missing_sessions: number; unsupported_sessions: number; unconfigured_dates: number };
type Evidence = {
  evidence_version: 1; available: boolean; enrollment_version: number; record_state: 'valid' | 'voided';
  snapshot: {
    section: { id: string; grade_level: number; name: string };
    school_year: { id: string; start_year: number; status: 'draft' | 'active' | 'closed' };
    from: string; to: string; member: (Names & { enrollment_id: string }) | null;
  };
  summary: Tally;
};
type Fields = {
  id: string; enrollment_id: string; section_id: string; academic_year_id: string; from_on: string; to_on: string;
  category: Category; status: CaseStatus; assignee_user_id: string; due_on: string | null; created_by: string;
  version: number; created_at: string; updated_at: string;
};
type Item = Fields & { overdue: boolean; learner: Names & { id: string } };
type Detail = { record: Fields & { opening_evidence: Evidence }; current_evidence: Evidence; evidence_changed: boolean; overdue: boolean };
type Plan = {
  action: 'open' | Action; version: number; from_on: string; to_on: string; category: Category; target_status: CaseStatus;
  assignee: { user_id: string; display_name: string; role: string }; due_on: string | null; reason: string;
  current_evidence: Evidence; issues: string[]; can_commit: boolean; review_hash: string | null;
};
type Event = { id: string; case_version: number; action: 'open' | Action; review_snapshot: Plan; reason: string; recorded_at: string };
type Candidate = Names & { enrollment_id: string; summary: { absent_sessions: number; missing_sessions: number; unsupported_sessions: number; unconfigured_dates: number } };

export const categoryName: Record<Category, string> = { absence: 'Recorded absence', recording_gap: 'Gap in recording' };

/** The monitor filter that finds learners with evidence for a category. The
 *  database applies the same two tests when it checks a case can be opened. */
export const monitorView: Record<Category, 'with_absences' | 'incomplete'> = { absence: 'with_absences', recording_gap: 'incomplete' };

export const actionsFor = (status: CaseStatus): Action[] => (status === 'open' ? ['update', 'resolve', 'cancel'] : ['reopen']);

export const actionName: Record<Action, string> = { update: 'Update or add a note', resolve: 'Resolve', cancel: 'Cancel', reopen: 'Reopen' };

const actionNote: Record<Action, string> = {
  update: 'Record a note, hand the case to another manager or change its due date. The case stays open.',
  resolve: 'Record that the follow-up is done. This is a decision about the case: it does not mark any absence corrected and does not change attendance.',
  cancel: 'Close a case opened by mistake or twice. Its history is kept.',
  reopen: 'Open this case again. It needs a new due date from today, or none, and no other case for this learner may already be open.',
};

/** Closing a case always clears its due date; the API refuses one otherwise. */
export const closes = (action: Action) => action === 'resolve' || action === 'cancel';

/**
 * What the API would refuse about a due date, in the order it checks, or null.
 *
 * The API answers every one of these with a single `FOLLOWUP_DUE_DATE`, so the
 * reason is found here first. An update may keep a date that has already gone
 * past, because keeping it is not setting it: only a new or changed date has
 * to be today or later.
 */
export function dueProblem(action: Action | 'open', due: string, previous: string | null, today: string): string | null {
  if (action === 'resolve' || action === 'cancel') return null;
  if (!due) return null;
  if (due < today && !(action === 'update' && due === previous)) return 'A new due date cannot be in the past. Choose today or later, or leave it empty.';
  return null;
}

/**
 * The body a case action sends. `due_on` is always present, because the API
 * reads a missing key as a mistake rather than as "no date", and it is null on
 * a closing action whatever the form held.
 */
export const changeBody = (action: Action, version: number, assignee: string, due: string, reason: string) => ({
  version,
  action,
  assignee_user_id: assignee,
  due_on: closes(action) || !due ? null : due,
  reason: tidy(reason),
});

export const tidy = (reason: string) => reason.trim().replace(/\s+/g, ' ');

/** Why a proposal cannot be confirmed, as the thing to do about it. */
export const issueText: Record<string, string> = {
  YEAR_NOT_ACTIVE: 'The school year is not active. A new case can only be opened while its year is running; existing cases can still be managed after it closes.',
  NO_ELIGIBLE_MEMBERSHIP: 'This learner has no valid enrolment in the section on any date in the window. Choose a window the learner was enrolled for.',
  NO_MATCHING_EVIDENCE: 'Nothing in the window matches the category. An absence case needs at least one session marked absent; a gap case needs an unmarked session, an alternative-delivery session or a date with no schedule.',
  OPEN_CASE_EXISTS: 'This learner already has an open case this school year. Update that case, or resolve or cancel it first — only one can be open at a time.',
};

const statusTone = (status: CaseStatus) => (status === 'open' ? 'attention' : status === 'resolved' ? 'good' : 'neutral');

const tallyRows: [keyof Tally, string][] = [
  ['absent_sessions', 'Sessions marked absent'],
  ['missing_sessions', 'Classroom sessions not marked'],
  ['unsupported_sessions', 'Alternative-delivery sessions'],
  ['unconfigured_dates', 'Dates with no schedule'],
];

/** A due date, or the mark saying there is none. */
export function Due({ due, overdue }: { due: string | null; overdue?: boolean }) {
  if (!due) return <Unrecorded label="No due date" />;
  return <><span className="mono">{due}</span>{overdue ? <> <Badge tone="attention">Overdue</Badge></> : null}</>;
}

/**
 * Every manager who can own a case, plus everyone who ever did.
 *
 * The queue names an owner by id, and a manager suspended or moved to teacher
 * since still owns their cases until somebody reassigns them — so names are
 * read from the whole staff list, while only active managers are offered as a
 * new owner.
 */
function useStaff(api: Api, token: number) {
  const [staff, setStaff] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const all: Row[] = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const page = await api<Page>(`/staff${query({ limit: 100, offset })}`);
        all.push(...page.items);
        if (!page.pagination?.has_more) break;
      }
      return all;
    };
    void read().then(rows => { if (alive) setStaff(rows); }).catch(() => { if (alive) setStaff([]); });
    return () => { alive = false; };
  }, [api, token]);
  const owners = (staff ?? []).filter(s => s.active && (s.role === 'principal' || s.role === 'administrative_officer'));
  const nameOf = (id: string) => String(staff?.find(s => s.user_id === id)?.display_name ?? '');
  return { staff, owners, nameOf };
}

function Owner({ id, nameOf }: { id: string; nameOf: (id: string) => string }) {
  const name = nameOf(id);
  return name ? <>{name}</> : <Unrecorded label="Not on the staff list" />;
}

/** Opening evidence beside current evidence, one line per count. */
function Comparison({ opening, current }: { opening: Evidence; current: Evidence }) {
  return (
    <Table
      rows={tallyRows}
      rowKey={([key]) => key}
      columns={[
        { header: 'In the window', cell: ([, label]) => label },
        { header: 'When opened', cell: ([key]) => opening.summary[key], numeric: true },
        { header: 'Now', cell: ([key]) => (current.available ? current.summary[key] : <Unrecorded label="No enrolment now" />), numeric: true },
      ]}
    />
  );
}

/** The same fields every proposal carries: an owner, a due date and a reason. */
function Proposal({ owners, assignee, setAssignee, due, setDue, reason, setReason, dueShown, today, problem }: {
  owners: Row[]; assignee: string; setAssignee: (v: string) => void; due: string; setDue: (v: string) => void;
  reason: string; setReason: (v: string) => void; dueShown: boolean; today: string; problem: string | null;
}) {
  const id = useId();
  return (
    <div className="form-grid">
      <div className="field">
        <label className="label" htmlFor={`${id}-owner`}>Owner</label>
        <Select id={`${id}-owner`} required value={assignee} onChange={event => setAssignee(event.target.value)}>
          <option value="">Choose a manager</option>
          {owners.map(s => <option key={String(s.user_id)} value={String(s.user_id)}>{String(s.display_name)} — {sentence(String(s.role))}</option>)}
        </Select>
        <span className="hint">An active principal or administrative officer. Owning a case organises the work; any manager can still act on it.</span>
      </div>
      {dueShown ? (
        <div className={`field${problem ? ' bad' : ''}`}>
          <label className="label" htmlFor={`${id}-due`}>Due date<span className="optional">Optional</span></label>
          <input id={`${id}-due`} type="date" className="date-input" value={due} min={today} aria-invalid={problem ? true : undefined}
            onChange={event => setDue(event.target.value)} />
          {problem ? <span className="field-error"><Icon name="alert" size={14} />{problem}</span> : null}
          <span className="hint">No reminder is sent. A case past its date is shown as overdue in the queue, nothing more.</span>
        </div>
      ) : null}
      <div className="field wide">
        <label className="label" htmlFor={`${id}-reason`}>Reason</label>
        <textarea id={`${id}-reason`} required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        <span className="hint">10–500 characters on one line, kept with the case for good. Say what was seen, done or decided.</span>
      </div>
    </div>
  );
}

function PlanSummary({ plan, nameOf }: { plan: Plan; nameOf: (id: string) => string }) {
  const member = plan.current_evidence.snapshot.member;
  return (
    <>
      {plan.issues.length ? (
        <Callout tone="stopped" title="This cannot be recorded yet">
          <ul>{plan.issues.map(code => <li key={code}>{issueText[code] ?? code}</li>)}</ul>
        </Callout>
      ) : null}
      <dl className="facts">
        <div><dt>Learner</dt><dd>{member ? learnerName(member) : <Unrecorded label="No enrolment in the window" />}</dd></div>
        <div><dt>Section</dt><dd>{gradeName(plan.current_evidence.snapshot.section.grade_level)} · {plan.current_evidence.snapshot.section.name}</dd></div>
        <div><dt>Window</dt><dd><span className="mono">{plan.from_on}</span> to <span className="mono">{plan.to_on}</span></dd></div>
        <div><dt>Category</dt><dd>{categoryName[plan.category]}</dd></div>
        <div><dt>Owner</dt><dd>{plan.assignee.display_name || nameOf(plan.assignee.user_id)}</dd></div>
        <div><dt>Due</dt><dd><Due due={plan.due_on} /></dd></div>
        <div><dt>Becomes</dt><dd><Badge tone={statusTone(plan.target_status)}>{sentence(plan.target_status)}</Badge></dd></div>
      </dl>
      <Table
        rows={tallyRows}
        rowKey={([key]) => key}
        columns={[
          { header: 'Current evidence', cell: ([, label]) => label },
          { header: 'Count', cell: ([key]) => (plan.current_evidence.available ? plan.current_evidence.summary[key] : <Unrecorded label="No enrolment" />), numeric: true },
        ]}
      />
      <p className="muted">Raw session observations inside the window, not attendance credits, a rate or a risk rating.</p>
    </>
  );
}

/**
 * Open one case: find a learner with matching evidence, name an owner, review,
 * confirm. The learner list is the absence monitor filtered to the category,
 * read when asked for, so choosing a window does not write an access record for
 * a whole class on every keystroke.
 */
function OpenSheet({ api, year, sections, owners, nameOf, onClose, onDone }: {
  api: Api; year: Row; sections: Row[]; owners: Row[]; nameOf: (id: string) => string;
  onClose: () => void; onDone: (text: string) => void;
}) {
  const today = localToday();
  const earliest = String(year.starts_on);
  const latest = String(year.ends_on) < today ? String(year.ends_on) : today;
  const [status, setStatus] = useState<Status>(idle);
  const [sectionId, setSectionId] = useState(String(sections[0]?.id ?? ''));
  const [to, setTo] = useState(latest);
  const [from, setFrom] = useState(clamp(shift(latest, -13), earliest, latest));
  const [category, setCategory] = useState<Category>('absence');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const range = windowProblem(from, to, earliest, latest);
  const due1 = dueProblem('open', due, null, today);
  // Any change to what was searched makes the list describe something else.
  useEffect(() => { setCandidates(null); setCursor(null); setEnrollmentId(''); }, [sectionId, from, to, category]);

  const find = async (after?: string) => {
    setBusy(true);
    try {
      const page = await api<{ items: Candidate[]; pagination: { next_after_id: string | null } }>(
        `/sections/${sectionId}/attendance/monitor${query({ from, to, view: monitorView[category], limit: 100, after_id: after })}`);
      setCandidates(current => (after ? [...(current ?? []), ...page.items] : page.items));
      setCursor(page.pagination.next_after_id);
      setStatus(idle);
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const review = async (event: FormEvent) => {
    event.preventDefault();
    if (!enrollmentId) { setStatus({ text: 'Choose the learner the case is about.', kind: 'error' }); return; }
    if (!assignee) { setStatus({ text: 'Choose who owns the case.', kind: 'error' }); return; }
    if (due1) return;
    const body = { section_id: sectionId, from, to, category, assignee_user_id: assignee, due_on: due || null, reason: tidy(reason) };
    setBusy(true);
    setStatus({ text: 'Reviewing…', kind: 'busy' });
    try {
      const result = await api<Plan>(`/enrollments/${enrollmentId}/attendance-follow-ups/preview`, 'POST', body);
      setSent(body);
      setPlan(result);
      setStatus(result.can_commit ? idle : { text: 'This case cannot be opened as proposed. What stands in the way is listed below.', kind: 'error' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!sent || !plan?.review_hash) return;
    setBusy(true);
    setStatus({ text: 'Opening…', kind: 'busy' });
    try {
      await api(`/enrollments/${enrollmentId}/attendance-follow-ups`, 'POST', { ...sent, review_hash: plan.review_hash, reviewed: true });
      onDone('The case is open.');
    } catch (error) {
      // The evidence or the owner moved under the review, so its hash is dead.
      if (error instanceof ApiError && error.isConflict) { setPlan(null); setSent(null); }
      setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Open a follow-up case" note="A case is a manager's own decision to follow something up. It changes no attendance record and sends no message." wide onClose={onClose}>
      <StatusLine status={status} />
      {plan ? (
        <>
          <PlanSummary plan={plan} nameOf={nameOf} />
          <p className="muted">Reason: {plan.reason}</p>
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || !plan.can_commit || !plan.review_hash} aria-busy={busy} onClick={() => void confirm()}>
              {busy ? 'Opening…' : 'Confirm and open the case'}
            </button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setPlan(null); setSent(null); setStatus(idle); }}>Change something</button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={event => void review(event)}>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor={`${id}-section`}>Section</label>
              <Select id={`${id}-section`} value={sectionId} onChange={event => setSectionId(event.target.value)}>
                {sections.map(s => <option key={String(s.id)} value={String(s.id)}>{sectionName(s)}</option>)}
              </Select>
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-category`}>Category</label>
              <Select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value as Category)}>
                {(Object.keys(categoryName) as Category[]).map(key => <option key={key} value={key}>{categoryName[key]}</option>)}
              </Select>
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-from`}>From</label>
              <input id={`${id}-from`} type="date" className="date-input" value={from} min={earliest} max={latest} onChange={event => event.target.value && setFrom(event.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-to`}>To</label>
              <input id={`${id}-to`} type="date" className="date-input" value={to} min={earliest} max={latest} onChange={event => event.target.value && setTo(event.target.value)} />
            </div>
          </div>
          {range ? <Callout tone="attention" title="Adjust the window">{range}</Callout> : null}

          <div className="form-actions">
            <button type="button" className="btn secondary" disabled={busy || !!range || !sectionId} onClick={() => void find()}>
              <Icon name="search" size={15} />Find learners with this evidence
            </button>
          </div>

          {candidates ? (
            <fieldset className="choose">
              <legend className="label">Learner</legend>
              <Table
                rows={candidates}
                rowKey={row => row.enrollment_id}
                empty={<p className="muted">Nobody in this section has {category === 'absence' ? 'a session marked absent' : 'an unmarked session, an alternative-delivery session or an unscheduled date'} in this window.</p>}
                columns={[
                  {
                    header: 'Choose', className: 'pick', cell: row => (
                      <input type="radio" name={`${id}-learner`} aria-label={learnerName(row)} checked={enrollmentId === row.enrollment_id} onChange={() => setEnrollmentId(row.enrollment_id)} />
                    ),
                  },
                  { header: 'Learner', cell: row => <Cell title={learnerName(row)} /> },
                  { header: 'Absent', cell: row => row.summary.absent_sessions, numeric: true },
                  { header: 'Unmarked', cell: row => row.summary.missing_sessions, numeric: true },
                  { header: 'No schedule', cell: row => row.summary.unconfigured_dates, numeric: true },
                ]}
              />
              {cursor ? <button type="button" className="btn ghost small" disabled={busy} onClick={() => void find(cursor)}>Show more learners</button> : null}
            </fieldset>
          ) : null}

          {candidates?.length ? (
            <>
              <Proposal owners={owners} assignee={assignee} setAssignee={setAssignee} due={due} setDue={setDue} reason={reason} setReason={setReason} dueShown today={today} problem={due1} />
              <div className="form-actions">
                <button type="submit" className="btn" disabled={busy || !enrollmentId} aria-busy={busy}>{busy ? 'Reviewing…' : 'Review this case'}</button>
              </div>
            </>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}

/** Update, resolve, cancel or reopen: propose, review against current evidence, confirm. */
function ActionSheet({ api, detail, action, owners, nameOf, onClose, onDone }: {
  api: Api; detail: Detail; action: Action; owners: Row[]; nameOf: (id: string) => string;
  onClose: () => void; onDone: (text: string) => void;
}) {
  const record = detail.record;
  const today = localToday();
  const [status, setStatus] = useState<Status>(idle);
  // A closed case has no owner decision to keep, but the field still needs one:
  // the current owner is the honest default, and only if they can still own it.
  const [assignee, setAssignee] = useState(owners.some(o => o.user_id === record.assignee_user_id) ? record.assignee_user_id : '');
  const [due, setDue] = useState(action === 'update' ? record.due_on ?? '' : '');
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = dueProblem(action, due, record.due_on, today);

  const review = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignee) { setStatus({ text: 'Choose who owns the case.', kind: 'error' }); return; }
    if (problem) return;
    const body = changeBody(action, record.version, assignee, due, reason);
    setBusy(true);
    setStatus({ text: 'Reviewing…', kind: 'busy' });
    try {
      const result = await api<Plan>(`/attendance-follow-ups/${record.id}/preview`, 'POST', body);
      setSent(body);
      setPlan(result);
      setStatus(result.can_commit ? idle : { text: 'This cannot be recorded as proposed. What stands in the way is listed below.', kind: 'error' });
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!sent || !plan?.review_hash) return;
    setBusy(true);
    setStatus({ text: 'Recording…', kind: 'busy' });
    try {
      await api(`/attendance-follow-ups/${record.id}/events`, 'POST', { ...sent, review_hash: plan.review_hash, reviewed: true });
      onDone(action === 'update' ? 'The case is updated.' : `The case is ${sentence(plan.target_status).toLowerCase()}.`);
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) { setPlan(null); setSent(null); }
      setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={actionName[action]} note={actionNote[action]} wide onClose={onClose}>
      <StatusLine status={status} />
      {plan ? (
        <>
          <PlanSummary plan={plan} nameOf={nameOf} />
          <p className="muted">Reason: {plan.reason}</p>
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || !plan.can_commit || !plan.review_hash} aria-busy={busy} onClick={() => void confirm()}>
              {busy ? 'Recording…' : 'Confirm this review'}
            </button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setPlan(null); setSent(null); setStatus(idle); }}>Change something</button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={event => void review(event)}>
          <Proposal owners={owners} assignee={assignee} setAssignee={setAssignee} due={due} setDue={setDue} reason={reason} setReason={setReason}
            dueShown={!closes(action)} today={today} problem={problem} />
          {closes(action) ? <p className="muted">Closing a case clears its due date.</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Reviewing…' : 'Review this change'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/** Every action on one case, newest first. */
function History({ api, caseId, nameOf }: { api: Api; caseId: string; nameOf: (id: string) => string }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api<Page<Event>>(`/attendance-follow-ups/${caseId}/events${query({ limit: 5 })}`)
      .then(page => { setRows(page.items); setCursor(page.pagination?.next_before_version ?? null); })
      .catch(() => { setRows([]); setCursor(null); });
  }, [api, caseId, open]);

  const older = async () => {
    if (cursor === null) return;
    try {
      const page = await api<Page<Event>>(`/attendance-follow-ups/${caseId}/events${query({ limit: 5, before_version: cursor })}`);
      setRows(current => [...(current ?? []), ...page.items]);
      setCursor(page.pagination?.next_before_version ?? null);
    } catch { setCursor(null); }
  };

  if (!open) {
    return (
      <p>
        <button type="button" className="btn ghost small" onClick={() => setOpen(true)}><Icon name="activity" size={14} />Show case history</button>
        {' '}<span className="muted">Check here before repeating an action whose response you never saw.</span>
      </p>
    );
  }
  return (
    <>
      <h3>Case history</h3>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={row => row.id}
        empty={<p className="muted">No history was returned for this case.</p>}
        columns={[
          { header: 'Version', cell: row => <span className="mono">{row.case_version}</span> },
          { header: 'Action', cell: row => <Badge tone={statusTone(row.review_snapshot.target_status)}>{row.action === 'open' ? 'Opened' : actionName[row.action]}</Badge> },
          { header: 'Owner', cell: row => row.review_snapshot.assignee.display_name || nameOf(row.review_snapshot.assignee.user_id) },
          { header: 'Due', cell: row => <Due due={row.review_snapshot.due_on} /> },
          { header: 'Reason', cell: row => row.reason },
          { header: 'Recorded', cell: row => <span className="mono">{new Date(row.recorded_at).toLocaleString()}</span> },
        ]}
      />
      {cursor !== null ? <button type="button" className="btn ghost small" onClick={() => void older()}>Show older actions</button> : null}
    </>
  );
}

/** One case, read on request: the evidence it was opened on, what the records say now, and what can be done. */
function CaseDetail({ api, item, owners, nameOf, setStatus, reload }: {
  api: Api; item: Item; owners: Row[]; nameOf: (id: string) => string; setStatus: (s: Status) => void; reload: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [acting, setActing] = useState<Action | null>(null);

  useEffect(() => {
    void api<Detail>(`/attendance-follow-ups/${item.id}`).then(setDetail).catch(() => setFailed(true));
  }, [api, item.id, item.version]);

  if (failed) return <Callout tone="stopped" title="This case could not be read">It may have changed since the list was loaded. Refresh the list and open it again.</Callout>;
  if (!detail) return <TableSkeleton columns={3} rows={3} />;
  const { record, current_evidence: current, record: { opening_evidence: opening } } = detail;
  const section = opening.snapshot.section;

  return (
    <>
      <dl className="facts">
        <div><dt>Section when opened</dt><dd>{gradeName(section.grade_level)} · {section.name}</dd></div>
        <div><dt>Window</dt><dd><span className="mono">{record.from_on}</span> ({weekday(record.from_on)}) to <span className="mono">{record.to_on}</span></dd></div>
        <div><dt>Opened</dt><dd><span className="mono">{new Date(record.created_at).toLocaleString()}</span> by <Owner id={record.created_by} nameOf={nameOf} /></dd></div>
        <div><dt>Version</dt><dd className="mono">{record.version}</dd></div>
      </dl>

      {!current.available ? (
        <Callout tone="attention" title="The learner is no longer enrolled in this window">
          A later correction removed the enrolment this case was opened on — voided, moved or re-dated. The opening evidence is kept exactly as it was; the case can still be updated, resolved or cancelled.
        </Callout>
      ) : detail.evidence_changed ? (
        <Callout tone="info" title="The records have changed since this case was opened">
          Something the opening evidence captured is different now. It may be a mark, but it may equally be a name, a calendar date, the month’s status or the school year’s — compare the counts below before reading it as a change in attendance.
        </Callout>
      ) : (
        <p className="muted">The records in the window are exactly as they were when this case was opened.</p>
      )}

      <Comparison opening={opening} current={current} />

      <div className="form-actions">
        {actionsFor(record.status).map(action => (
          <button key={action} type="button" className={action === 'update' || action === 'reopen' ? 'btn' : 'btn secondary'} onClick={() => setActing(action)}>
            {actionName[action]}
          </button>
        ))}
      </div>

      <History api={api} caseId={record.id} nameOf={nameOf} />

      {acting ? (
        <ActionSheet
          api={api}
          detail={detail}
          action={acting}
          owners={owners}
          nameOf={nameOf}
          onClose={() => setActing(null)}
          onDone={text => { setActing(null); setStatus({ text, kind: 'done' }); reload(); }}
        />
      ) : null}
    </>
  );
}

/**
 * The manager's queue of attendance follow-up, and the only place a case is opened.
 *
 * Nothing opens a case automatically and nothing here raises an alert: the
 * school has confirmed it has no approved absence rule, so a case is a
 * manager's own decision, taken on evidence they looked at. Each case keeps the
 * evidence it was opened on, unchanged, and is compared against the records as
 * they stand now — a correction afterwards never rewrites what was seen.
 */
export function Followups({ api, setStatus, reload, token, route }: Props) {
  const scope = useScope(api, token);
  const { owners, nameOf, staff } = useStaff(api, token);
  const [state, setState] = useState<CaseStatus | 'all'>('open');
  const [sectionId, setSectionId] = useState('');
  const [owner, setOwner] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [rows, setRows] = useState<Item[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const id = useId();

  const { yearId, year } = scope;
  const filters = { academic_year_id: yearId, status: state, section_id: sectionId, assignee_user_id: owner, overdue_only: overdue ? 'true' : undefined, limit: 50 };

  useEffect(() => { setSectionId(''); }, [yearId]);

  useEffect(() => {
    if (!yearId) { setRows(null); return; }
    setRows(null);
    setFailed(false);
    void api<{ items: Item[]; pagination: { next_after_id: string | null } }>(`/attendance-follow-ups${query(filters)}`)
      .then(page => { setRows(page.items); setCursor(page.pagination.next_after_id); })
      .catch(() => { setRows([]); setCursor(null); setFailed(true); });
  }, [api, yearId, state, sectionId, owner, overdue, token]);

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await api<{ items: Item[]; pagination: { next_after_id: string | null } }>(`/attendance-follow-ups${query({ ...filters, after_id: cursor })}`);
      setRows(current => [...(current ?? []), ...page.items]);
      setCursor(page.pagination.next_after_id);
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
  };

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={6} /></div></>;
  if (!scope.years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card"><EmptyState title="No school year yet" body="A follow-up case belongs to a school year. Create one on the School years screen first." /></div>
      </>
    );
  }

  const active = year?.status === 'active';
  const sections = scope.sections ?? [];
  const canOpen = active && sections.length > 0 && owners.length > 0;

  return (
    <>
      <PageHeader
        route={route}
        actions={<button type="button" className="btn" disabled={!canOpen} onClick={() => setOpening(true)}><Icon name="plus" size={15} />Open a case</button>}
      />

      {!active && year ? (
        <Callout tone="info" title="New cases need an active school year">
          This year is {String(year.status)}, so no case can be opened in it. Cases already open can still be updated, resolved or cancelled.
        </Callout>
      ) : null}
      {active && staff !== null && !owners.length ? (
        <Callout tone="attention" title="Nobody can own a case">There is no active principal or administrative officer on the staff list.</Callout>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <div className="field inline">
              <label className="label" htmlFor={`${id}-year`}>School year</label>
              <Select id={`${id}-year`} value={yearId} onChange={event => scope.setYearId(event.target.value)}>
                {scope.years.map(y => <option key={String(y.id)} value={String(y.id)}>{yearName(y)} — {sentence(String(y.status))}</option>)}
              </Select>
            </div>
            <div className="field inline">
              <label className="label" htmlFor={`${id}-status`}>Status</label>
              <Select id={`${id}-status`} value={state} onChange={event => setState(event.target.value as CaseStatus | 'all')}>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="cancelled">Cancelled</option>
                <option value="all">Any status</option>
              </Select>
            </div>
            <div className="field inline">
              <label className="label" htmlFor={`${id}-section`}>Section when opened</label>
              <Select id={`${id}-section`} value={sectionId} onChange={event => setSectionId(event.target.value)}>
                <option value="">Every section</option>
                {sections.map(s => <option key={String(s.id)} value={String(s.id)}>{sectionName(s)}</option>)}
              </Select>
            </div>
            <div className="field inline">
              <label className="label" htmlFor={`${id}-owner`}>Owner</label>
              <Select id={`${id}-owner`} value={owner} onChange={event => setOwner(event.target.value)}>
                <option value="">Anyone</option>
                {(staff ?? []).filter(s => s.role !== 'teacher').map(s => (
                  <option key={String(s.user_id)} value={String(s.user_id)}>{String(s.display_name)}{s.active ? '' : ' (suspended)'}</option>
                ))}
              </Select>
            </div>
            <label className="check-line">
              <input type="checkbox" checked={overdue} onChange={event => setOverdue(event.target.checked)} />
              <span>Overdue only</span>
            </label>
          </div>
        </div>

        {failed ? <div className="card-body"><Callout tone="stopped" title="The queue could not be read">The request failed. Try again, or refresh the page.</Callout></div> : null}

        <Table
          loading={rows === null}
          rows={rows ?? []}
          rowKey={row => row.id}
          empty={<EmptyState
            title={state === 'open' ? 'No open cases' : 'No cases match'}
            body={state === 'open'
              ? 'Nothing is being followed up in this school year with these filters. A case is only ever opened by hand.'
              : 'No case in this school year matches these filters.'}
          />}
          columns={[
            { header: 'Learner', cell: row => <Cell title={learnerName(row.learner)} meta={`Version ${row.version}`} /> },
            { header: 'Category', cell: row => categoryName[row.category] },
            { header: 'Window', cell: row => <Cell title={<span className="mono">{row.from_on}</span>} meta={<>to <span className="mono">{row.to_on}</span></>} /> },
            { header: 'Owner', cell: row => <Owner id={row.assignee_user_id} nameOf={nameOf} /> },
            { header: 'Due', cell: row => <Due due={row.due_on} overdue={row.overdue} /> },
            { header: 'Status', cell: row => <Badge tone={statusTone(row.status)}>{sentence(row.status)}</Badge> },
          ]}
          detailLabel="Case"
          detail={row => <CaseDetail api={api} item={row} owners={owners} nameOf={nameOf} setStatus={setStatus} reload={reload} />}
        />

        {rows?.length ? (
          <div className="card-body">
            <p className="card-note">{rows.length} {rows.length === 1 ? 'case' : 'cases'} shown. This is the live queue, not a dated export.</p>
            {cursor ? <button type="button" className="btn ghost small" onClick={() => void more()}>Show more cases</button> : null}
          </div>
        ) : null}
      </div>

      <Callout tone="info" title="No threshold, no alert">
        EDUNEXUS opens no case by itself and sends no reminder or message. The school has confirmed it has no approved absence rule, so whether a pattern needs following up is a decision for the manager who opens the case. Resolving a case records that decision; it does not correct or change any attendance record.
      </Callout>

      {opening && year ? (
        <OpenSheet
          api={api}
          year={year}
          sections={sections}
          owners={owners}
          nameOf={nameOf}
          onClose={() => setOpening(false)}
          onDone={text => { setOpening(false); setStatus({ text, kind: 'done' }); reload(); }}
        />
      ) : null}
    </>
  );
}
