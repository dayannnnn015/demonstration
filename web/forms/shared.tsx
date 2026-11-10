import { useState } from 'react';
import { ApiError, message } from '../api';
import { lastOf, monthName, step, type Month } from '../dates';
import { Icon } from '../components/icons';
import { Confirm, Sheet } from '../components/overlay';
import { Editor, type Status } from '../components/primitives';
import { fingerprint, type Issuance } from './types';

/** The month arrows every monthly form uses, kept inside the school year. */
export function MonthNav({ month, setMonth, startsOn, endsOn }: { month: Month; setMonth: (m: Month) => void; startsOn: string; endsOn: string }) {
  const back = step(month, -1), forward = step(month, 1);
  return (
    <div className="field inline">
      <span className="label">Month</span>
      <span className="month-nav">
        <button type="button" className="btn ghost small" disabled={lastOf(back) < startsOn} aria-label="Previous month" onClick={() => setMonth(back)}><Icon name="back" size={14} /></button>
        <b>{monthName(month)}</b>
        <button type="button" className="btn ghost small" disabled={`${forward.y}-${String(forward.m).padStart(2, '0')}-01` > endsOn} aria-label="Next month" onClick={() => setMonth(forward)}><Icon name="forward" size={14} /></button>
      </span>
    </div>
  );
}

/** What an issued form prints at its foot, so a paper copy can be traced to its record. */
export const issuedLine = (label: string, issuance: Issuance) =>
  `${label} issued from EDUNEXUS as no. ${issuance.serial} on ${new Date(issuance.issued_at).toLocaleDateString('en-PH', { dateStyle: 'long' })}. Fingerprint ${fingerprint(issuance.data_hash)}.`
  + (issuance.supersedes_id ? ` Corrects an earlier issue: ${issuance.reason ?? ''}` : '');

const reasonField = [{ key: 'reason', label: 'Why it is being corrected', type: 'textarea', minLength: 10, maxLength: 500, wide: true,
  hint: 'This form was issued before with different content. The reason is kept with both records.' }];

/**
 * Issuing records exactly what the form says, so it goes through a
 * confirmation. If the same form was issued before with different content, the
 * API asks why; the reason is asked for then and the request sent again.
 */
export function IssueFlow({ label, cost, issue, onIssued, onClose, setStatus }: {
  label: string; cost: string;
  issue: (reason?: string) => Promise<{ issuance: Issuance }>;
  onIssued: (issuance: Issuance) => void; onClose: () => void; setStatus: (s: Status) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [needsReason, setNeedsReason] = useState(false);
  if (needsReason) {
    return (
      <Sheet title={`Correct the issued ${label}`} note="An earlier issue of this form said something different." onClose={onClose}>
        <Editor fields={reasonField} submitLabel={`Issue the corrected ${label}`} setStatus={setStatus}
          onSubmit={async data => { const result = await issue(String(data.reason)); onIssued(result.issuance); return result; }} />
      </Sheet>
    );
  }
  return (
    <Confirm
      title={`Issue this ${label}?`} tone="plain" busy={busy} confirmLabel={`Issue the ${label}`}
      body={cost}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        try { onIssued((await issue()).issuance); }
        catch (error) {
          if (error instanceof ApiError && error.code === 'REISSUE_REASON') setNeedsReason(true);
          else { setStatus({ text: message(error), kind: 'error' }); onClose(); }
        } finally { setBusy(false); }
      }}
    />
  );
}
