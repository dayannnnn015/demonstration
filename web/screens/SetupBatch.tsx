import { useEffect, useId, useMemo, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import { BatchSheet, stopsBatch, type Candidate } from '../components/batch';
import { Sheet } from '../components/overlay';
import { Badge, Callout, Select, StatusLine, Table, gradeName, idle, yearName, type Status } from '../components/primitives';
import { Affects } from '../components/affects';
import { Icon } from '../components/icons';

/** Every section of one year. The list pages by 25 on screen, but a batch must see the whole year. */
export async function allSections(api: Api, yearId: string) {
  const all: Row[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api<Page>(`/sections${query({ academic_year_id: yearId, limit: 100, offset })}`);
    all.push(...page.items);
    if (!page.pagination?.has_more) return all;
  }
}

/** Every active teacher, who are the only people a section can be given to. */
export async function activeTeachers(api: Api) {
  const all: Row[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api<Page>(`/staff${query({ role: 'teacher', limit: 100, offset })}`);
    all.push(...page.items.filter(r => r.active));
    if (!page.pagination?.has_more) return all;
  }
}

/**
 * The SF4's own layout: Kindergarten A–F and A–D for every graded level. It is
 * where the names start, not a rule — every list is edited before anything is
 * created, and the school may name its sections however it likes.
 */
export const sf4Names: Record<number, string[]> = { 0: ['A', 'B', 'C', 'D', 'E', 'F'], 1: ['A', 'B', 'C', 'D'], 2: ['A', 'B', 'C', 'D'], 3: ['A', 'B', 'C', 'D'], 4: ['A', 'B', 'C', 'D'], 5: ['A', 'B', 'C', 'D'], 6: ['A', 'B', 'C', 'D'] };

/**
 * One grade's names, tidied: blanks and repeats dropped (ignoring case) so one name is one section. A pasted list —
 * "A, B, C" or one per line — still splits into names, though nobody is asked to type commas any more.
 */
export function sectionNames(input: string | string[]) {
  const seen = new Set<string>();
  const raw = Array.isArray(input) ? input : [input];
  return raw.flatMap(n => n.split(/[,\n]/)).map(n => n.trim().replace(/\s+/g, ' ')).filter(n => {
    const key = n.toLowerCase();
    if (!n || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The same test as the database's unique index: one name per grade per year, ignoring case and outer spaces. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function sectionCandidates(names: Record<number, string[] | string>, existing: Row[]): Candidate[] {
  return [0, 1, 2, 3, 4, 5, 6].flatMap(grade => sectionNames(names[grade] ?? '').map(name => {
    const taken = existing.some(s => Number(s.grade_level) === grade && sameName(String(s.name), name));
    return {
      key: `${grade}:${name}`,
      label: `${gradeName(grade)} ${name}`,
      chosen: true,
      blocked: taken ? 'Already exists in this year' : name.length > 80 ? 'Longer than 80 characters' : undefined,
      cells: [gradeName(grade), <b>{name}</b>],
    };
  }));
}

/**
 * Creates a year's sections in one reviewed step. Names come first, typed per
 * grade, then the sheet lists every section it would create and skips any the
 * year already has. Advisers are left for the adviser table, because they wait
 * on staff accounts and a section can exist before its adviser does.
 */
export function AddSections({ api, year, onClose }: { api: Api; year: Row; onClose: (written: number) => void }) {
  const id = useId();
  const [names, setNames] = useState<Record<number, string[]>>(sf4Names);
  const [existing, setExisting] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { void allSections(api, String(year.id)).then(setExisting).catch(() => setFailed(true)); }, [api, year.id]);
  const candidates = useMemo(() => (reviewing && existing ? sectionCandidates(names, existing) : null), [reviewing, existing, names]);

  if (reviewing) {
    return (
      <BatchSheet
        title={`Create sections for ${yearName(year)}`}
        note="Each section is its own record. A refused row does not stop the others."
        intro={<Callout tone="info" title="Names only">These are created without an adviser. Assign advisers afterwards from the adviser table, once their accounts exist.</Callout>}
        headers={['Grade', 'Section']}
        candidates={candidates}
        empty={<p className="muted">No section names were typed.</p>}
        verb={n => (n === 1 ? 'Create 1 section' : `Create ${n} sections`)}
        past="Created"
        reasoned={false}
        reread={async () => setExisting(await allSections(api, String(year.id)))}
        send={key => {
          const at = key.indexOf(':');
          return api('/sections', 'POST', { academic_year_id: year.id, grade_level: Number(key.slice(0, at)), name: key.slice(at + 1), adviser_user_id: null });
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <Sheet title={`Create sections for ${yearName(year)}`} note="Add or remove each grade's sections, then review the list before anything is created." wide onClose={() => onClose(0)}>
      {failed ? <Callout tone="stopped" title="This year's sections could not be read">Nothing was created. Close this and try again.</Callout> : null}
      <form noValidate onSubmit={event => { event.preventDefault(); setReviewing(true); }}>
        <Callout tone="info" title="Started from the school's SF4">
          The school's July SF4 lists Kindergarten A to F and A to D for every graded level. Change any list to match this year; names already in the year are skipped.
        </Callout>
        <div className="form-grid batch-reason">
          {[0, 1, 2, 3, 4, 5, 6].map(grade => (
            <SectionChips key={grade} id={`${id}-${grade}`} grade={grade} names={names[grade] ?? []}
              onChange={next => setNames(current => ({ ...current, [grade]: next }))} />
          ))}
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={existing === null}>Review the sections</button>
          <button type="button" className="btn secondary" onClick={() => onClose(0)}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

/** The letter after a grade's last single-letter section, offered as the likely next name: A–D gives E. */
export function nextLetter(names: string[]) {
  const letters = names.filter(n => /^[A-Y]$/i.test(n)).map(n => n.toUpperCase().charCodeAt(0));
  if (!letters.length) return names.length ? null : 'A';
  const next = String.fromCharCode(Math.max(...letters) + 1);
  return names.some(n => n.toUpperCase() === next) ? null : next;
}

/**
 * One grade's sections as separate names (asked 2026-11-09: no comma-separated list). Each name is its own chip,
 * removed with its ×; a new one is typed and added with Enter or Add, and the next letter is a press away. A pasted
 * "A, B, C" still becomes three, so a list copied from elsewhere is not lost.
 */
function SectionChips({ id, grade, names, onChange }: { id: string; grade: number; names: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (text: string) => {
    const merged = sectionNames([...names, text]);
    if (merged.length !== names.length) onChange(merged);
    setDraft('');
  };
  const next = nextLetter(names);
  return (
    <div className="field section-chips">
      <label className="label" htmlFor={id}>{gradeName(grade)} <span className="optional">{names.length || 'No'} section{names.length === 1 ? '' : 's'}</span></label>
      {names.length ? (
        <ul className="chips" aria-label={`${gradeName(grade)} sections`}>
          {names.map(name => (
            <li key={name} className="chip">
              <span>{name}</span>
              <button type="button" aria-label={`Remove ${gradeName(grade)} ${name}`} title="Remove" onClick={() => onChange(names.filter(n => n !== name))}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chip-add">
        <input id={id} value={draft} maxLength={80} placeholder="New section"
          onChange={event => setDraft(event.target.value)}
          // Enter adds the name here rather than submitting the whole sheet for review.
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (draft.trim()) add(draft); } }} />
        {/* One button: what is typed, or else the next letter. */}
        {draft.trim()
          ? <button type="button" className="btn secondary small" onClick={() => add(draft)}>Add</button>
          : next ? <button type="button" className="btn secondary small" onClick={() => add(next)}>Add {next}</button> : null}
      </div>
    </div>
  );
}

type Outcome = { kind: 'done' } | { kind: 'refused'; text: string } | { kind: 'unsent' };

/** How many sections each teacher would hold if the table were saved as it stands. */
export function holdings(sections: Row[], chosen: Record<string, string>) {
  const count: Record<string, number> = {};
  for (const section of sections) {
    const adviser = chosen[String(section.id)] ?? String(section.adviser_user_id ?? '');
    if (adviser) count[adviser] = (count[adviser] ?? 0) + 1;
  }
  return count;
}

/**
 * Every section of the year in one table, each with its adviser chosen from a
 * list, saved together. Only changed rows are sent, each against the version
 * it was read at, so another manager's change in between is refused on its own
 * row rather than overwritten. The list shows how many sections each teacher
 * would then hold: three Kinder advisers hold two each, and anything above that
 * is more likely a slip than a decision.
 */
export function AssignAdvisers({ api, year, onClose }: { api: Api; year: Row; onClose: (written: number) => void }) {
  const [sections, setSections] = useState<Row[] | null>(null);
  const [teachers, setTeachers] = useState<Row[]>([]);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState(0);
  const [retry, setRetry] = useState<Set<string> | null>(null);

  // Every read is a fresh one: sections carry the versions a save is checked against.
  const read = async () => {
    const [s, t] = await Promise.all([allSections(api, String(year.id)), activeTeachers(api)]);
    setSections(s.sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || String(a.name).localeCompare(String(b.name))));
    setTeachers(t.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))));
  };
  useEffect(() => { void read().catch(() => setFailed(true)); }, [api, year.id]);

  const current = (s: Row) => String(s.adviser_user_id ?? '');
  const changed = (sections ?? []).filter(s => (chosen[String(s.id)] ?? current(s)) !== current(s) && outcomes[String(s.id)]?.kind !== 'done');
  const held = holdings(sections ?? [], chosen);
  const name = (userId: string) => String(teachers.find(t => t.user_id === userId)?.display_name ?? 'Someone no longer a teacher');

  const failedRows = (sections ?? []).filter(s => { const o = outcomes[String(s.id)]; return o && o.kind !== 'done'; });

  const save = async (only?: Set<string>) => {
    const rows = only ? changed.filter(s => only.has(String(s.id))) : changed;
    if (!rows.length) { setStatus({ text: 'Read again: those sections already hold the adviser you chose, or nothing is left to send.', kind: 'done' }); return; }
    setBusy(true);
    const next = { ...outcomes };
    let stopped = false, done = 0;
    try {
      for (const [index, section] of rows.entries()) {
        const key = String(section.id);
        if (stopped) { next[key] = { kind: 'unsent' }; continue; }
        setStatus({ text: `Saving ${index + 1} of ${rows.length}…`, kind: 'busy' });
        try {
          await api(`/sections/${key}`, 'PATCH', { version: section.version, adviser_user_id: chosen[key] || null });
          next[key] = { kind: 'done' };
          done += 1;
        } catch (error) {
          next[key] = { kind: 'refused', text: error instanceof ApiError ? message(error) : 'No answer came back. Open this again to see whether it was saved.' };
          stopped = stopsBatch(error);
        }
        setOutcomes({ ...next });
      }
      const refused = rows.filter(s => next[String(s.id)]?.kind === 'refused').length;
      setStatus(done === rows.length ? { text: `Saved: ${done} of ${rows.length}.`, kind: 'done' } : { text: `Saved ${done} of ${rows.length}. ${refused} refused — each row says why.`, kind: 'error' });
      setWritten(w => w + done);
    } finally { setBusy(false); }
  };

  // After the re-read has rendered, so the rows go against their fresh versions.
  useEffect(() => {
    if (!retry) return;
    setRetry(null);
    void save(retry);
  }, [retry]);

  const readAgain = async () => {
    const keys = new Set(failedRows.map(s => String(s.id)));
    setBusy(true);
    setStatus({ text: 'Reading the sections again…', kind: 'busy' });
    try {
      await read();
      setOutcomes(current => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.has(key))));
      setRetry(keys);
    } catch (error) {
      setStatus({ text: error instanceof ApiError ? message(error) : 'The sections could not be read again.', kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={`Advisers for ${yearName(year)}`} note="Only the rows you change are saved, each against the version it was read at." wide onClose={() => { if (!busy) onClose(written); }}>
      <StatusLine status={status} />
      <Affects what="section" />
      {failed ? <Callout tone="stopped" title="The sections or teachers could not be read">Nothing was changed. Close this and try again.</Callout> : (
        <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
          {teachers.length === 0 && sections !== null ? (
            <Callout tone="attention" title="No active teacher yet">A section can only be given to an active teacher. Grant teachers access first, from Staff access or Invitations.</Callout>
          ) : null}
          <Table
            stack
            loading={sections === null}
            rows={sections ?? []}
            rowKey={s => String(s.id)}
            empty={<p className="muted">This year has no sections yet.</p>}
            columns={[
              { header: 'Grade', cell: s => gradeName(s.grade_level) },
              { header: 'Section', cell: s => <b>{String(s.name)}</b> },
              {
                header: 'Adviser', cell: s => {
                  const key = String(s.id);
                  const value = chosen[key] ?? current(s);
                  // Inside .field so the shared select styling applies in a table cell too.
                  return (
                    <div className="field">
                    <Select aria-label={`Adviser for ${gradeName(s.grade_level)} ${String(s.name)}`} value={value} disabled={busy || outcomes[key]?.kind === 'done'}
                      onChange={event => setChosen(c => ({ ...c, [key]: event.target.value }))}>
                      <option value="">Unassigned</option>
                      {current(s) && !teachers.some(t => t.user_id === current(s)) ? <option value={current(s)}>{name(current(s))}</option> : null}
                      {teachers.map(t => <option key={String(t.user_id)} value={String(t.user_id)}>{String(t.display_name)}{held[String(t.user_id)] ? ` (${held[String(t.user_id)]})` : ''}</option>)}
                    </Select>
                    </div>
                  );
                },
              },
              {
                header: 'State', cell: s => {
                  const key = String(s.id);
                  const outcome = outcomes[key];
                  if (outcome?.kind === 'done') return <Badge tone="good">Saved</Badge>;
                  if (outcome?.kind === 'refused') return <span className="batch-area"><Badge tone="stopped">Refused</Badge><span className="batch-note">{outcome.text}</span></span>;
                  if (outcome?.kind === 'unsent') return <Badge tone="neutral">Not sent</Badge>;
                  if ((chosen[key] ?? current(s)) !== current(s)) return <Badge tone="info">Changed</Badge>;
                  const holding = held[current(s)] ?? 0;
                  return current(s) ? (holding > 2 ? <Badge tone="attention">Holds {holding}</Badge> : <span className="muted">Unchanged</span>) : <Badge tone="attention">Unassigned</Badge>;
                },
              },
            ]}
          />
          <p className="hint batch-reason">Only active staff with Teacher access can advise a section, so only they are listed. The number beside a name is how many sections that teacher would hold.</p>
          <div className="form-actions">
            {failedRows.length && !busy ? <button type="button" className="btn" onClick={() => void readAgain()}>Read again and retry {failedRows.length === 1 ? '1 row' : `${failedRows.length} rows`}</button> : null}
            <button type="submit" className={failedRows.length ? 'btn secondary' : 'btn'} disabled={busy || !changed.length} aria-busy={busy}>{busy ? 'Working…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Nothing changed'}</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => onClose(written)}>{written ? 'Done' : 'Cancel'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
