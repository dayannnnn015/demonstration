import { useEffect, useRef, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import { Icon } from '../components/icons';
import { addressAsks } from '../components/scope';
import { Sheet } from '../components/overlay';
import { StatusBadge, type Submission } from './RosterSubmissions';
import {
  Badge, Callout, Cell, Editor, EmptyState, StatusLine, Table, Task, idle, gradeName, type Status,
} from '../components/primitives';

/**
 * Approving an adviser's class list, on Enrollment.
 *
 * An adviser's list is a **file**, not records: `roster_submissions.csv` holds
 * the CSV they sent and nothing exists on the registry until a manager imports
 * it. So "approve" here is not a flag being set — it is the import running,
 * and the school asked for that to be one button rather than a screen of its
 * own (decided 2026-11-06).
 *
 * The three calls behind the button are the same three Roster import makes, in
 * the same order, because `decide_roster_submission` will accept a list *only*
 * with an import the approver themselves committed for that section (`P1704`):
 *
 *   1. `POST /roster-imports/preview` — every row checked against the registry.
 *   2. `POST /roster-imports/:id/commit` — the whole file, or none of it.
 *   3. `POST /roster-submissions/:id/decision` — accepted, carrying the receipt.
 *
 * **It sends no resolutions, and that is the limit of this screen.** A row that
 * might be a learner already on file is a question only a person can answer,
 * and answering it is what Roster import's duplicate resolution is for. Here
 * the preview simply comes back unable to commit, nothing is written, and the
 * refusal says so in the school's own words. Guessing the answer would be the
 * one thing this system must never do: two records for one child.
 */
export function WaitingLists({ api, manager, token, setStatus, reload }: {
  api: Api; manager: boolean; token: number; setStatus: (s: Status) => void; reload: () => void;
}) {
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [show, setShow] = useState<'submitted' | 'all'>('submitted');
  const [open, setOpen] = useState<Submission | null>(null);
  const [tick, setTick] = useState(0);
  // A notification about one list opens its review here, once, if it is still waiting (the UI notes of 8 November, note 5).
  const askedList = useRef(addressAsks().get('list'));

  useEffect(() => {
    if (!manager) { setRows([]); return; }
    void api<Page<Submission>>(`/roster-submissions${query({ status: show, limit: 50 })}`)
      .then(r => setRows(r.items)).catch(() => setRows([]));
  }, [api, manager, token, show, tick]);

  useEffect(() => {
    const id = askedList.current;
    const found = id ? (rows ?? []).find(s => s.id === id && s.status === 'submitted') : undefined;
    if (!found) return;
    askedList.current = null;
    void api<Submission>(`/roster-submissions/${found.id}`).then(setOpen).catch(error => setStatus({ kind: 'error', text: message(error) }));
  }, [rows]);

  if (!manager) return null;
  // Nothing waiting and nothing asked for: the card stays off the screen rather
  // than taking a third of it to say so.
  if (rows && !rows.length && show === 'submitted') return null;

  const waiting = (rows ?? []).filter(s => s.status === 'submitted').length;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Class lists from advisers</h2>
            <p className="card-note">
              An adviser prepares the list; it becomes learner records only when you approve it here.
            </p>
          </div>
          <div className="card-head-actions">
            {waiting ? <Badge tone="info">{waiting} waiting</Badge> : null}
            <button type="button" className="btn ghost small" onClick={() => setShow(show === 'submitted' ? 'all' : 'submitted')}>
              {show === 'submitted' ? 'Show all' : 'Show only waiting'}
            </button>
          </div>
        </div>
        <Table
          loading={rows === null}
          rows={rows ?? []}
          rowKey={s => s.id}
          empty={<EmptyState title="Nothing in this state" body="Lists advisers submit appear here, waiting for you to approve them." />}
          columns={[
            { header: 'For', cell: s => <Cell
              title={s.section_name ? `${gradeName(s.grade_level)} · ${s.section_name}` : `${s.grade_level === null ? 'Several grades' : gradeName(s.grade_level)} — no class yet`}
              meta={s.submitted_by_name ?? 'An adviser'} /> },
            { header: 'Learners', cell: s => s.row_count, numeric: true },
            { header: 'Submitted', cell: s => <span className="mono">{new Date(s.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span> },
            { header: 'State', cell: s => <StatusBadge status={s.status} /> },
            { header: '', cell: s => (s.status === 'submitted'
              ? <button type="button" className="btn secondary small" onClick={() => void (async () => {
                  try { setOpen(await api<Submission>(`/roster-submissions/${s.id}`)); }
                  catch (error) { setStatus({ kind: 'error', text: message(error) }); }
                })()}>Review</button>
              : null) },
          ]}
        />
      </div>

      {open ? (
        <ApprovalSheet
          api={api}
          submission={open}
          onClose={() => setOpen(null)}
          onDone={text => { setOpen(null); setTick(n => n + 1); setStatus({ kind: 'done', text }); reload(); }}
        />
      ) : null}
    </>
  );
}

/**
 * What a list's grade is called, when it may not have one.
 *
 * A list whose rows carry their own grades records `grade_level` as null, and
 * `gradeName` reads null as 0 — so every one of these places called a
 * mixed-grade list "Kindergarten", including the sentence telling the manager
 * what approving would do. Null means several, and says so.
 */
const listGrade = (grade: number | null) => (grade === null ? 'the grade each row names' : gradeName(grade));

type Profile = { lrn: string | null; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null; birth_date: string; sex: string };
type Issue = { row: number; field: string; code: string; message: string };
type PreviewRow = { row: number; profile: Profile | null; action: 'create' | 'use_existing' | null };
type Preview = { can_commit: boolean; preview_id: string | null; rows: PreviewRow[]; issues: Issue[] };
type Receipt = { preview_id: string; items: { row: number }[] };

const reasonField = {
  key: 'reason', label: 'Reason', type: 'textarea', minLength: 10, maxLength: 500, wide: true,
  hint: '10–500 characters on one line. The adviser reads this, and it is kept with the list for good.',
};

/** One waiting list, read, then approved in a single act or declined with a reason. */
function ApprovalSheet({ api, submission, onClose, onDone }: {
  api: Api; submission: Submission; onClose: () => void; onDone: (text: string) => void;
}) {
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Preview | null>(null);

  // A list is for a class, or for a grade with no class (0061). Which it is
  // decides how it is imported, and the two must match or the acceptance is
  // refused with P1704.
  const toClass = submission.section_id !== null;
  const label = toClass
    ? `${gradeName(submission.grade_level)} · ${submission.section_name}`
    : `${submission.grade_level === null ? 'several grades' : gradeName(submission.grade_level)}, with no class yet`;

  // The payload every one of the three calls is made with. Built once, because
  // the commit must match the preview byte for byte or the API refuses it, and
  // the decision must name the section the submission carries or `P1704` does.
  const payload = {
    ...(toClass
      ? { section_id: submission.section_id }
      // Omitted when the list has no single grade: its rows carry their own,
      // and sending null made the API read it as 0 — Kindergarten — until that
      // was refused, after which approving a mixed list answered "expected
      // number, received NaN" instead.
      : { section_id: null, academic_year_id: submission.academic_year_id,
          ...(submission.grade_level === null ? {} : { grade_level: submission.grade_level }) }),
    enrolled_on: submission.enrolled_on,
    entry_kind: submission.entry_kind,
    csv: submission.csv ?? '',
    resolutions: [],
  };

  const approve = async () => {
    setBusy(true);
    setProblems(null);
    setLocal({ kind: 'busy', text: 'Checking every row against the registry…' });
    try {
      const preview = await api<Preview>('/roster-imports/preview', 'POST', payload);
      if (!preview.can_commit || !preview.preview_id) {
        setProblems(preview);
        setLocal({ kind: 'error', text: 'This list cannot be imported as it stands. Nothing has been written.' });
        return;
      }
      setLocal({ kind: 'busy', text: 'Importing…' });
      const receipt = await api<Receipt>(`/roster-imports/${preview.preview_id}/commit`, 'POST', { ...payload, confirmed: true });
      // The import is what the database will accept as approval, so the
      // decision carries its receipt. If this one fails the learners are
      // already in, which the message says rather than hides.
      try {
        await api(`/roster-submissions/${submission.id}/decision`, 'POST', {
          version: submission.version, decision: 'accepted', import_id: preview.preview_id,
          reason: `Approved on Enrollment and imported, receipt ${preview.preview_id}.`,
        });
      } catch (error) {
        onDone(`${receipt.items.length} learners were imported, but the adviser’s list could not be marked approved: ${message(error)}`);
        return;
      }
      onDone(`${receipt.items.length === 1 ? 'One learner' : `${receipt.items.length} learners`} imported ${toClass ? `into ${label}` : `onto the registry at ${listGrade(submission.grade_level)}, in no class`}. The adviser has been told.`);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'PREVIEW_CHANGED' || error.code === 'PREVIEW_EXPIRED')) {
        setLocal({ kind: 'error', text: 'The registry changed while this was being checked. Nothing was written — try again.' });
      } else setLocal({ kind: 'error', text: message(error) });
    } finally { setBusy(false); }
  };

  const rows = (submission.csv ?? '').trim().split(/\r?\n/).slice(1).filter(Boolean);

  return (
    <Sheet title={`Class list for ${label}`} note={`Submitted by ${submission.submitted_by_name ?? 'an adviser'}. ${submission.row_count} ${submission.row_count === 1 ? 'learner' : 'learners'}.`} wide onClose={onClose}>
      <StatusLine status={status} />

      <Task title="What this list holds" note="Exactly as the adviser sent it">
        <p className="muted">
          These are not learner records yet. Approving checks every row against the registry and, only if every one of them is clear, creates the records and
          {toClass
            ? <> enrols them into {label} from <span className="mono">{submission.enrolled_on}</span>.</>
            : <> enrols them at {listGrade(submission.grade_level)} from <span className="mono">{submission.enrolled_on}</span> <b>with no class</b>. The advisers of each grade then take in the ones who are theirs.</>}
        </p>
        <Table
          rows={rows.map((line, n) => ({ id: String(n), cells: line.split(',') }))}
          rowKey={r => r.id}
          empty={<EmptyState title="This list is empty" body="Decline it and ask the adviser to send it again." />}
          columns={[
            { header: 'LRN', cell: r => <span className="mono">{r.cells[0] || '—'}</span> },
            { header: 'Name', cell: r => [r.cells[1], r.cells[2], r.cells[3], r.cells[4]].filter(Boolean).join(' ') },
            { header: 'Born', cell: r => <span className="mono">{r.cells[5] ?? ''}</span> },
            { header: 'Sex', cell: r => r.cells[6] ?? '' },
          ]}
        />
      </Task>

      {problems ? (
        <Callout tone="attention" title="This list needs a decision only a person can make">
          <p>
            Nothing has been written. The rows below match, or may match, learners already on the registry, and EDUNEXUS will not guess which — two records for
            one child is the worst thing it can be made to hold.
          </p>
          <ul>
            {problems.issues.slice(0, 10).map((issue, n) => <li key={n}>Row {issue.row}: {issue.message}</li>)}
          </ul>
          <p>
            Resolving them is done on <b>Roster import</b>, where each row can be pointed at the learner it means. On this school’s division of work that screen
            is the administrative officer’s. The other way is to <b>decline</b> this list with a reason, and the adviser sends a corrected one.
          </p>
        </Callout>
      ) : null}

      <div className="form-actions">
        <button type="button" className="btn" aria-busy={busy} disabled={busy || !rows.length} onClick={() => void approve()}>
          <Icon name="check" size={15} />{busy ? 'Approving…' : 'Approve and import'}
        </button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Close</button>
      </div>

      <Task title="Decline this list" note="The adviser is told, and sends a corrected one" tone="warn">
        <Editor
          fields={[reasonField]}
          submitLabel="Decline"
          setStatus={setLocal}
          onSubmit={data => api(`/roster-submissions/${submission.id}/decision`, 'POST', {
            version: submission.version, decision: 'declined', import_id: null, reason: data.reason,
          })}
          onSaved={() => onDone('Class list declined. The adviser has been told.')}
        />
      </Task>
    </Sheet>
  );
}
