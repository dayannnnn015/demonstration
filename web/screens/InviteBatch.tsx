import { useEffect, useId, useMemo, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { query } from '../api';
import { BatchSheet, type Candidate } from '../components/batch';
import { Sheet } from '../components/overlay';
import { Callout, sentence } from '../components/primitives';

export type Person = { line: number; name: string; email: string; role: string; problem?: string };

const roleWords: Record<string, string> = {
  teacher: 'teacher', adviser: 'teacher', 'subject teacher': 'teacher',
  'administrative officer': 'administrative_officer', administrative_officer: 'administrative_officer', ao: 'administrative_officer', officer: 'administrative_officer',
  principal: 'principal', 'school principal': 'principal',
};
// The API's own email test, so a line it would refuse is marked here instead.
const emailPattern = /^[^@\s\u0000-\u001f\u007f]+@[^@\s\u0000-\u001f\u007f]+\.[^@\s\u0000-\u001f\u007f]+$/;

/**
 * Reads the staff list as it comes: one person per line, name and email and an
 * optional permission level, split by commas or tabs, which is what a pasted
 * spreadsheet column gives. Columns are found by what they hold rather than by
 * position, so "email, name" and "name, email, role" both read. A missing
 * level means teacher, the level twenty-seven of the thirty-three hold.
 */
export function parseStaff(text: string): Person[] {
  const people: Person[] = [];
  text.split('\n').forEach((raw, index) => {
    const parts = raw.split(/[\t,;]/).map(p => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const line = index + 1;
    const email = parts.find(p => p.includes('@'));
    const roleText = parts.find(p => roleWords[p.toLowerCase()]);
    const name = parts.filter(p => p !== email && p !== roleText).join(' ').replace(/\s+/g, ' ');
    // A header row copied with the sheet is skipped rather than reported.
    if (!email && /name/i.test(raw) && /mail/i.test(raw)) return;
    const person: Person = { line, name, email: (email ?? '').toLowerCase(), role: roleText ? roleWords[roleText.toLowerCase()]! : 'teacher' };
    if (!email) person.problem = 'No email address on this line';
    else if (!emailPattern.test(person.email) || person.email.length > 254) person.problem = 'Not a single valid email address';
    else if (!name) person.problem = 'No name on this line';
    else if (name.length > 150) person.problem = 'Name longer than 150 characters';
    people.push(person);
  });
  const seen = new Set<string>();
  for (const person of people) {
    if (!person.problem && seen.has(person.email)) person.problem = 'This email is already listed above';
    seen.add(person.email);
  }
  return people;
}

export function inviteCandidates(people: Person[], waiting: Set<string>, staffRole: string): Candidate[] {
  return people.map(p => ({
    key: String(p.line),
    label: p.email || `line ${p.line}`,
    chosen: true,
    blocked: p.problem
      ?? (waiting.has(p.email) ? 'Already has an invitation waiting' : undefined)
      ?? (staffRole !== 'principal' && p.role !== 'teacher' ? 'Only the principal can request this permission level' : undefined),
    cells: [<span className="mono">{p.line}</span>, p.name ? <b>{p.name}</b> : <span className="muted">No name</span>, p.email ? <span className="mono">{p.email}</span> : <span className="muted">No email</span>, sentence(p.role)],
  }));
}

/** Every email with an invitation still waiting, across every page. */
async function waitingEmails(api: Api) {
  const emails = new Set<string>();
  let after: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page = await api<Page & { pagination: { next_after_id: string | null } }>(`/staff-invitations${query({ status: 'requested', limit: 100, after_id: after })}`);
    for (const row of page.items) emails.add(String(row.email).toLowerCase());
    if (!page.pagination.next_after_id) break;
    after = page.pagination.next_after_id;
  }
  return emails;
}

/**
 * Requests invitations for a list of staff in one reviewed step. Each line
 * becomes its own invitation request, recorded with the reason given; nobody
 * is emailed here. Creating each account stays a separate, deliberate action on
 * the request's own row, because that is the step that sends an email, and
 * thirty emails sent by one click through a rate-limited mail service is not
 * something to discover afterwards.
 */
export function InviteList({ api, me, onClose }: { api: Api; me: Row; onClose: (written: number) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState<Set<string> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { void waitingEmails(api).then(setWaiting).catch(() => setFailed(true)); }, [api]);
  const people = useMemo(() => parseStaff(text), [text]);
  const candidates = useMemo(() => (reviewing && waiting ? inviteCandidates(people, waiting, String(me.role)) : null), [reviewing, waiting, people, me.role]);

  if (reviewing) {
    return (
      <BatchSheet
        title="Request invitations from a list"
        note="Each line is its own invitation request. A refused line does not stop the others."
        intro={<Callout tone="info" title="No email is sent yet">This records who should get an account. Open each request afterwards to create the account, which is what emails the invitation.</Callout>}
        headers={['Line', 'Name', 'Email', 'Permission level']}
        candidates={candidates}
        empty={<p className="muted">No one was listed.</p>}
        verb={n => (n === 1 ? 'Request 1 invitation' : `Request ${n} invitations`)}
        past="Requested"
        reread={async () => setWaiting(await waitingEmails(api))}
        send={(key, reason) => {
          const person = people.find(p => String(p.line) === key)!;
          return api('/staff-invitations', 'POST', { email: person.email, display_name: person.name, role: person.role, reason });
        }}
        onClose={onClose}
      />
    );
  }

  const usable = people.filter(p => !p.problem).length;
  return (
    <Sheet title="Request invitations from a list" note="Paste the staff list, then review it before anything is recorded." wide onClose={() => onClose(0)}>
      {failed ? <Callout tone="stopped" title="Waiting invitations could not be read">Nothing was requested. Close this and try again.</Callout> : null}
      <form noValidate onSubmit={event => { event.preventDefault(); setReviewing(true); }}>
        <div className="form-grid">
          <div className="field wide">
            <label className="label" htmlFor={`${id}-list`}>Staff list</label>
            <textarea id={`${id}-list`} className="tall" value={text} onChange={event => setText(event.target.value)}
              placeholder={'Full name, email, permission level\nJuana Dela Cruz, juana@example.com, teacher\nPedro Santos, pedro@example.com, administrative officer'} />
            <span className="hint">One person per line: full name and email, and the permission level if not teacher. Commas or tabs, so a pasted spreadsheet works. {people.length ? `${people.length} line${people.length === 1 ? '' : 's'} read, ${usable} usable.` : ''}</span>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={waiting === null || !people.length}>Review the list</button>
          <button type="button" className="btn secondary" onClick={() => onClose(0)}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
