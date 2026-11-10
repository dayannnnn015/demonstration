import { useEffect, useState } from 'react';
import { ApiError, message, query, type Api, type Page, type Row } from '../api';
import { actionName, fieldNames, isJournal, recordName } from '../activity';
import { describeResource } from './Access';
import { Icon } from '../components/icons';
import { Confirm } from '../components/overlay';
import {
  Badge, Callout, Cell, EmptyState, FormSheet, StatusLine, Table, Unrecorded, idle, sentence, value, type Field, type Status,
} from '../components/primitives';

export type NameRequest = {
  id: string; current_name: string; requested_name: string | null; current_position: string | null; requested_position: string | null;
  note: string; status: 'pending' | 'approved' | 'declined' | 'withdrawn'; decision_reason: string | null; decided_by: string | null;
  decided_at: string | null; created_at: string; version: number;
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const noteField: Field = { key: 'note', label: 'Why it should change', type: 'textarea', minLength: 10, maxLength: 500, wide: true,
  hint: 'For example: “My surname is spelled Bautista on my PRC ID.” The principal or administrative officer reads this.' };

/** What the request asks for, said as a change: "Ana Cruz → Ana Dela Cruz". */
export function Asked({ r }: { r: Pick<NameRequest, 'current_name' | 'requested_name' | 'current_position' | 'requested_position'> }) {
  return (
    <span className="asked">
      {r.requested_name ? <span>Name: {r.current_name} <Icon name="forward" size={12} /> <b>{r.requested_name}</b></span> : null}
      {r.requested_position ? <span>Position: {r.current_position ?? <Unrecorded label="Not set" />} <Icon name="forward" size={12} /> <b>{r.requested_position}</b></span> : null}
    </span>
  );
}

/**
 * On My profile: asking for your name or position to be corrected, and what
 * became of the last request. The correction itself is the manager's to make,
 * because both print on official forms.
 */
export function NameCorrection({ api, mine, onChanged }: { api: Api; mine: Row & { name_request?: NameRequest | null }; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(idle);
  const r = mine.name_request ?? null;
  const withdraw = async () => {
    if (!r) return;
    setBusy(true);
    try {
      await api(`/me/name-requests/${r.id}/withdraw`, 'POST', { version: r.version });
      setWithdrawing(false);
      setStatus({ kind: 'done', text: 'Your request is withdrawn.' });
      onChanged();
    } catch (error) {
      setWithdrawing(false);
      setStatus({ kind: 'error', text: error instanceof ApiError && error.code === 'NAME_REQUEST_DECIDED' ? 'It was decided before you withdrew it; the page now shows the decision.' : message(error) });
      onChanged();
    } finally { setBusy(false); }
  };
  return (
    <div className="setting name-correction" data-tour="profile-name">
      <div>
        <b>Is your name or position wrong?</b>
        <StatusLine status={status} />
        {r?.status === 'pending' ? (
          <p className="muted">You asked on {day(r.created_at)}: <Asked r={r} />. It waits for the principal or the administrative officer.</p>
        ) : r?.status === 'approved' ? (
          <p className="muted">Corrected on {day(r.decided_at)} by {r.decided_by}: <Asked r={r} />.</p>
        ) : r?.status === 'declined' ? (
          <p className="muted">Your request of {day(r.created_at)} was declined by {r.decided_by}: “{r.decision_reason}”</p>
        ) : (
          <p className="muted">Ask for it to be corrected. The principal or the administrative officer checks it and makes the change, which then prints on the forms.</p>
        )}
      </div>
      {r?.status === 'pending'
        ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setWithdrawing(true)}>Withdraw the request</button>
        : <button type="button" className="btn secondary" onClick={() => { setStatus(idle); setAsking(true); }}>Ask for a correction</button>}
      {asking ? (
        <FormSheet
          title="Ask for a correction"
          note="Change what is wrong and leave the rest. Nothing changes until the principal or the administrative officer approves it."
          submitLabel="Send the request"
          fields={[
            { key: 'display_name', label: 'Full name', maxLength: 150, hint: 'As it should print on the SF2, SF4 and SF9.' },
            { key: 'position', label: 'Position', optional: true, maxLength: 120, hint: 'For example Teacher III or Master Teacher II.' },
            noteField,
          ]}
          initial={{ display_name: mine.display_name, position: mine.position ?? '' }}
          onSubmit={data => api('/me/name-requests', 'POST', { display_name: data.display_name, position: data.position || null, note: data.note })}
          onSaved={() => { setAsking(false); setStatus({ kind: 'done', text: 'Your request is sent. You will see the decision here.' }); onChanged(); }}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {withdrawing ? (
        <Confirm title="Withdraw your request?" confirmLabel="Withdraw" tone="plain" busy={busy} onClose={() => setWithdrawing(false)} onConfirm={() => void withdraw()}
          body="Nothing about your name or position changes. You can ask again at any time." />
      ) : null}
    </div>
  );
}

/** On Staff access: the corrections staff asked for, for a manager to decide. */
export function NameRequestQueue({ api, token, setStatus, reload }: { api: Api; token: number; setStatus: (s: Status) => void; reload: () => void }) {
  const [rows, setRows] = useState<Page | null>(null);
  const [deciding, setDeciding] = useState<{ row: Row; decision: 'approve' | 'decline' } | null>(null);
  useEffect(() => { void api<Page>('/name-requests').then(setRows).catch(() => setRows({ items: [] })); }, [api, token]);
  if (!rows?.items.length) return null;
  return (
    <div className="card" data-tour="staff-name-requests">
      <div className="card-head"><div>
        <h2>Corrections asked for</h2>
        <p className="card-note">Staff asking for their name or position to be corrected. Approving changes it on every form printed from now on; forms already issued keep what they said.</p>
      </div></div>
      <Table
        rows={rows.items}
        rowKey={r => String(r.id)}
        columns={[
          { header: 'Asked by', cell: r => <Cell title={value(r, 'requested_by')} meta={sentence(value(r, 'role'))} /> },
          { header: 'Correction', cell: r => <Asked r={r as unknown as NameRequest} /> },
          { header: 'Why', cell: r => value(r, 'note') },
          { header: 'Asked on', cell: r => day(String(r.created_at)) },
          { header: '', cell: r => r.may_decide ? (
            <span className="row-actions">
              <button type="button" className="btn small" onClick={() => setDeciding({ row: r, decision: 'approve' })}>Approve</button>
              <button type="button" className="btn ghost small" onClick={() => setDeciding({ row: r, decision: 'decline' })}>Decline</button>
            </span>
          ) : <span className="muted">{r.yours ? 'Yours: another manager decides it' : 'The principal decides this one'}</span> },
        ]}
      />
      {deciding ? (
        <FormSheet
          title={deciding.decision === 'approve' ? 'Approve this correction' : 'Decline this correction'}
          note={deciding.decision === 'approve' ? `${value(deciding.row, 'requested_by')}'s record changes now, and every form printed from now on shows it.` : 'Nothing changes. They see your reason on their profile.'}
          submitLabel={deciding.decision === 'approve' ? 'Approve' : 'Decline'}
          fields={[{ key: 'reason', label: 'Reason', type: 'textarea', minLength: 10, maxLength: 500, wide: true, hint: deciding.decision === 'approve' ? 'For example: “Checked against the PRC ID.”' : 'Said to them on their profile.' }]}
          onSubmit={data => api(`/name-requests/${String(deciding.row.id)}/decide`, 'POST', { version: deciding.row.version, decision: deciding.decision, reason: data.reason })}
          onSaved={() => { setStatus({ kind: 'done', text: deciding.decision === 'approve' ? 'Approved. The staff record is corrected.' : 'Declined. Their record is unchanged.' }); setDeciding(null); reload(); }}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * On My profile: what you yourself recorded, and which learner records you were
 * shown, from the same journals the principal reads. It names no learner, only
 * how many records each read returned, so reading it is not itself a read.
 */
export function MyActivity({ api, token }: { api: Api; token: number }) {
  const [kind, setKind] = useState<'changes' | 'reads'>('changes');
  const [before, setBefore] = useState('');
  const [rows, setRows] = useState<Page | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    setRows(null);
    void api<Page>(`/me/activity${query({ kind, before_id: before, limit: 15 })}`).then(r => { setRows(r); setFailed(''); }).catch(error => { setFailed(message(error)); setRows({ items: [] }); });
  }, [api, kind, before, token]);
  const choose = (next: 'changes' | 'reads') => { setKind(next); setBefore(''); };
  return (
    <div className="card" data-tour="profile-activity">
      <div className="card-head"><div>
        <h2>Your activity</h2>
        <p className="card-note">The same records the principal reads in the activity and privacy logs, for you alone. Field names only; no learner is named here.</p>
      </div>
        <div className="segmented" role="tablist" aria-label="Activity">
          <button type="button" role="tab" aria-selected={kind === 'changes'} className={kind === 'changes' ? 'active' : ''} onClick={() => choose('changes')}>Changes you made</button>
          <button type="button" role="tab" aria-selected={kind === 'reads'} className={kind === 'reads' ? 'active' : ''} onClick={() => choose('reads')}>Records you were shown</button>
        </div>
      </div>
      {failed ? <Callout tone="stopped">{failed}</Callout> : null}
      <Table
        loading={rows === null}
        rows={rows?.items ?? []}
        rowKey={r => String(r.id)}
        empty={<EmptyState title={kind === 'changes' ? 'No changes yet' : 'No learner records shown yet'} body={kind === 'changes' ? 'What you record in EDUNEXUS appears here, newest first.' : 'Each list or page of learner records you open appears here, newest first.'} />}
        columns={kind === 'changes' ? [
          { header: 'When', cell: r => <span className="mono">{new Date(String(r.occurred_at)).toLocaleString('en-PH')}</span> },
          { header: 'Record', cell: r => recordName(String(r.entity_table)) },
          { header: 'Action', cell: r => (isJournal(String(r.entity_table)) ? <Badge tone="neutral">History entry</Badge> : actionName(r)) },
          { header: 'Fields', cell: r => { const f = fieldNames(r.changed_fields); return f.length ? f.join(', ') : <Unrecorded label="None listed" />; } },
        ] : [
          { header: 'When', cell: r => <span className="mono">{new Date(String(r.occurred_at)).toLocaleString('en-PH')}</span> },
          { header: 'What you opened', cell: r => describeResource(String(r.resource)) },
          { header: 'Records shown', numeric: true, cell: r => <span className="num">{Number(r.record_count)}</span> },
        ]}
      />
      <div className="pager">
        <span>15 at a time, newest first</span>
        <div className="pager-nav">
          <button type="button" className="btn secondary small" disabled={!before} onClick={() => setBefore('')}>Newest</button>
          <button type="button" className="btn secondary small" disabled={!rows?.pagination?.next_before_id} onClick={() => setBefore(String(rows!.pagination!.next_before_id))}>Older</button>
        </div>
      </div>
    </div>
  );
}
