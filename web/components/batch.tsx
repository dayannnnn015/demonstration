import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, message } from '../api';
import { Icon } from './icons';
import { Sheet } from './overlay';
import { Badge, StatusLine, Table, idle, type Status } from './primitives';

type Outcome = { kind: 'done' } | { kind: 'refused'; text: string } | { kind: 'unsent' };
export type Candidate = { key: string; label: string; cells: ReactNode[]; blocked?: string | undefined; chosen: boolean };

/**
 * Whether a refused write is about the batch rather than its own row, so the
 * rows after it must not be sent. A lost connection leaves it unknown whether
 * the row went in; a sign-out, a lost permission, a rate limit or a server
 * failure would refuse every later row for the same reason.
 */
export const stopsBatch = (error: unknown) =>
  !(error instanceof ApiError) || error.status === 401 || error.status === 403 || error.code === 'RATE_LIMITED' || error.status >= 500;

/** The server's message for a rejected reason. The reason is the same for every row, so it stops the run rather than marking one row. */
const reasonProblem = (error: unknown) =>
  error instanceof ApiError ? error.fields.find(f => f.path.split('.').pop() === 'reason')?.message : undefined;

/**
 * A reviewed batch of independent writes: one request per ticked row, each
 * with the one reason typed here.
 *
 * Every row is its own record with its own journal entry, so the batch is not
 * atomic and does not pretend to be. A refusal is drawn on the row it belongs
 * to and the others still go in. A rejected reason stops the run before
 * anything is written, since it would be rejected for every row, and a
 * refusal `stopsBatch` names marks the rest as never sent. Given `reread`, the
 * sheet can then read the records again and resend only the refused and unsent
 * rows: one that did go in after all now shows as present and is not sent twice,
 * and one refused for a stale version goes again against the fresh one.
 */
export function BatchSheet({ title, note, intro, headers, candidates, empty, problem, verb, past, send, onClose, reread, reasoned = true }: {
  title: string;
  note: string;
  intro: ReactNode;
  headers: string[];
  candidates: Candidate[] | null;
  empty: ReactNode;
  problem?: ReactNode;
  /** The submit label for this many rows. */
  verb: (count: number) => string;
  /** What a row that went in now says. */
  past: string;
  send: (key: string, reason: string) => Promise<unknown>;
  /** Told how many rows went in, so the screen reloads only when something changed. */
  onClose: (written: number) => void;
  /** Reads the records again, so `candidates` and `send` reflect what is there now. */
  reread?: () => Promise<void>;
  /** Whether these writes take a reason. Section setup does not; every journalled write does. */
  reasoned?: boolean;
}) {
  const reasonId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const running = useRef(false);
  const written = useRef(0);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Set<string> | null>(null);

  // Ticked once, when the rows first arrive. Re-seeding later would undo the
  // manager's own choices whenever the parent re-rendered.
  useEffect(() => {
    if (candidates && !chosen) setChosen(new Set(candidates.filter(c => !c.blocked && c.chosen).map(c => c.key)));
  }, [candidates, chosen]);
  useEffect(() => { if (reasonError) box.current?.focus(); }, [reasonError]);

  const open = (c: Candidate) => !c.blocked && outcomes[c.key]?.kind !== 'done';
  const queue = (candidates ?? []).filter(c => open(c) && chosen?.has(c.key));
  const close = () => { if (!running.current) onClose(written.current); };
  // Something went in and nothing ticked is left: the only thing left to do is leave.
  const finished = !busy && written.current > 0 && !queue.length;

  const failed = (candidates ?? []).filter(c => outcomes[c.key] && outcomes[c.key]!.kind !== 'done');

  const run = async (only?: Set<string>) => {
    const rows = only ? queue.filter(c => only.has(c.key)) : queue;
    if (!rows.length) { setStatus({ text: 'Read again: nothing refused can be sent again. Each row says why.', kind: 'done' }); return; }
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setReasonError(undefined);
    const next = { ...outcomes };
    let stopped = false;
    try {
      for (const [index, row] of rows.entries()) {
        if (stopped) { next[row.key] = { kind: 'unsent' }; continue; }
        setStatus({ text: `Sending ${index + 1} of ${rows.length}: ${row.label}…`, kind: 'busy' });
        try {
          await send(row.key, reason);
          next[row.key] = { kind: 'done' };
          written.current += 1;
        } catch (error) {
          const onReason = reasonProblem(error);
          if (onReason) {
            setReasonError(onReason);
            setStatus(idle);
            return;
          }
          next[row.key] = { kind: 'refused', text: error instanceof ApiError ? message(error) : 'No answer came back. Open this again to see whether it was recorded.' };
          stopped = stopsBatch(error);
        }
        setOutcomes({ ...next });
      }
      setOutcomes({ ...next });
      const done = rows.filter(r => next[r.key]?.kind === 'done').length;
      const refused = rows.filter(r => next[r.key]?.kind === 'refused').length;
      const unsent = rows.length - done - refused;
      setStatus(done === rows.length
        ? { text: `${past}: ${done} of ${rows.length}.`, kind: 'done' }
        : { text: `${past}: ${done} of ${rows.length}. ${refused} refused${unsent ? `, ${unsent} not sent` : ''} — each row says why.`, kind: 'error' });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  // Runs after the render that carries the re-read records, so `queue` and `send`
  // are the fresh ones rather than those the refused attempt was made with.
  useEffect(() => {
    if (!retry) return;
    setRetry(null);
    void run(retry);
  }, [retry]);

  const readAgain = async () => {
    if (!reread || running.current) return;
    const keys = new Set(failed.map(c => c.key));
    setBusy(true);
    setStatus({ text: 'Reading the records again…', kind: 'busy' });
    try {
      await reread();
      setOutcomes(current => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.has(key))));
      setRetry(keys);
    } catch (error) {
      setStatus({ text: error instanceof ApiError ? message(error) : 'The records could not be read again.', kind: 'error' });
    } finally { setBusy(false); }
  };

  const choose = (key: string, on: boolean) => setChosen(current => {
    const next = new Set(current ?? []);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const state = (c: Candidate): ReactNode => {
    const outcome = outcomes[c.key];
    if (outcome?.kind === 'done') return <Badge tone="good">{past}</Badge>;
    if (outcome?.kind === 'refused') return <span className="batch-area"><Badge tone="stopped">Refused</Badge><span className="batch-note">{outcome.text}</span></span>;
    if (outcome?.kind === 'unsent') return <Badge tone="neutral">Not sent</Badge>;
    if (c.blocked) return <span className="muted">{c.blocked}</span>;
    return chosen?.has(c.key) ? <Badge tone="info">Ready</Badge> : <span className="muted">Left out</span>;
  };

  return (
    <Sheet title={title} note={note} wide onClose={close}>
      <StatusLine status={status} />
      {intro}
      {problem ?? (
        <form noValidate onSubmit={event => { event.preventDefault(); void run(); }}>
          <Table
            stack
            loading={candidates === null}
            rows={candidates ?? []}
            rowKey={c => c.key}
            empty={empty}
            columns={[
              {
                header: 'Include', cell: c => (open(c)
                  ? <input type="checkbox" className="batch-check" aria-label={`Include ${c.label}`} checked={chosen?.has(c.key) ?? false} disabled={busy} onChange={event => choose(c.key, event.target.checked)} />
                  : null),
              },
              ...headers.map((header, index) => ({ header, cell: (c: Candidate) => c.cells[index] })),
              { header: 'State', cell: state },
            ]}
          />
          {candidates?.length && reasoned ? (
            <div className="form-grid batch-reason">
              <div className={`field wide${reasonError ? ' bad' : ''}`}>
                <label className="label" htmlFor={reasonId}>Reason</label>
                <textarea
                  ref={box}
                  id={reasonId}
                  name="reason"
                  required
                  minLength={10}
                  maxLength={500}
                  value={reason}
                  aria-invalid={reasonError ? true : undefined}
                  aria-describedby={[reasonError ? `${reasonId}-error` : '', `${reasonId}-hint`].filter(Boolean).join(' ')}
                  onChange={event => { setReason(event.target.value); setReasonError(undefined); }}
                />
                {reasonError ? <span className="field-error" id={`${reasonId}-error`}><Icon name="alert" size={14} />{reasonError}</span> : null}
                <span className="hint" id={`${reasonId}-hint`}>10–500 characters on one line. The same reason is kept in the history of every row sent.</span>
              </div>
            </div>
          ) : null}
          <div className="form-actions">
            {reread && failed.length && !busy ? <button type="button" className="btn" onClick={() => void readAgain()}>Read again and retry {failed.length === 1 ? '1 row' : `${failed.length} rows`}</button> : null}
            {candidates?.length && !finished ? <button type="submit" className={reread && failed.length ? 'btn secondary' : 'btn'} disabled={busy || !queue.length} aria-busy={busy}>{busy ? <><span className="btn-mark" aria-hidden="true" />Working…</> : queue.length ? verb(queue.length) : 'Nothing chosen'}</button> : null}
            <button type="button" className={finished ? 'btn' : 'btn secondary'} disabled={busy} onClick={close}>{written.current ? 'Done' : 'Cancel'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

