import { useId, useState, type FormEvent } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import { Sheet } from '../components/overlay';
import { Callout, Cell, Select, StatusLine, Table, gradeName, idle, learnerName, type Status } from '../components/primitives';
import { sectionName } from '../components/scope';
import { lrnDigits } from '../record-fields';

/**
 * One late learner, from the group leader's notes of 10 October: a learner who
 * arrives after the class list went in should not need a whole CSV file.
 *
 * The administrative officer enlists them straight away: the registry is
 * searched first, so a learner already on file is enrolled rather than
 * created twice, and only then is a new record made and enrolled. An adviser
 * cannot create learner records, so for them the same form adds one row to the
 * class list they submit, which the office imports as usual.
 */
export type Profile = { lrn: string | null; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null; birth_date: string; sex: 'male' | 'female';
  /** Address and grade are columns of the class list, not fields of a learner record. Both may be left unset. */
  address?: string | null; grade_level?: number | null };

// Shared with MyClass.tsx, where an adviser registers a learner into their own
// class: the same fields, the same checks and the same shape of profile, so the
// two forms cannot drift into asking for different things about one child.
export const blankLearner = { lrn: '', first_name: '', middle_name: '', last_name: '', name_extension: '', birth_date: '', sex: '', address: '', grade_level: '' };
export type LearnerDraft = typeof blankLearner;
type Draft = LearnerDraft;

export function learnerProblems(d: Draft) {
  const out: [keyof Draft, string][] = [];
  if (!d.last_name.trim()) out.push(['last_name', 'Give the last name.']);
  if (!d.first_name.trim()) out.push(['first_name', 'Give the first name.']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.birth_date)) out.push(['birth_date', 'Give the birth date.']);
  if (d.sex !== 'male' && d.sex !== 'female') out.push(['sex', 'Choose male or female.']);
  if (!/^\d{12}$/.test(lrnDigits(d.lrn))) out.push(['lrn', 'The LRN is required: exactly twelve digits.']);
  return out;
}

export const toLearnerProfile = (d: Draft): Profile => ({
  lrn: lrnDigits(d.lrn) || null, first_name: d.first_name.trim(), middle_name: d.middle_name.trim() || null, last_name: d.last_name.trim(),
  name_extension: d.name_extension.trim() || null, birth_date: d.birth_date, sex: d.sex as Profile['sex'],
  address: d.address.trim() || null, grade_level: d.grade_level === '' ? null : Number(d.grade_level),
});

/** A CSV cell the import reads back as the same text. */
const cell = (v: string | null) => (v === null ? '' : /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// Every column of `ROSTER_HEADER`, in its order. It wrote seven of them until
// 2026-11-07, so a learner added this way silently lost their address; the
// importer padded the short row rather than refusing it, which is why nobody
// saw it. `tests/web-roster-template.test.ts` now holds the two in step.
export const csvRow = (p: Profile) => [p.lrn, p.first_name, p.middle_name, p.last_name, p.name_extension, p.birth_date, p.sex,
  p.address ?? null, p.grade_level === null || p.grade_level === undefined ? null : String(p.grade_level)].map(cell).join(',');

export function LearnerFields({ draft, set, bad }: { draft: Draft; set: (d: Draft) => void; bad: [keyof Draft, string][] }) {
  const id = useId();
  const error = (key: keyof Draft) => bad.find(b => b[0] === key)?.[1];
  const text = (key: keyof Draft, label: string, optional = false, extra: Record<string, unknown> = {}) => (
    <div className={`field${error(key) ? ' bad' : ''}`}>
      <label className="label" htmlFor={`${id}-${key}`}>{label}{optional ? <span className="optional">Optional</span> : null}</label>
      <input id={`${id}-${key}`} value={draft[key]} aria-invalid={!!error(key)} aria-describedby={error(key) ? `${id}-${key}-error` : undefined}
        onChange={e => set({ ...draft, [key]: e.target.value })} {...extra} />
      {error(key) ? <span className="field-error" id={`${id}-${key}-error`}>{error(key)}</span> : null}
    </div>
  );
  return (
    <div className="form-grid">
      {text('last_name', 'Last name', false, { maxLength: 80, autoComplete: 'off' })}
      {text('first_name', 'First name', false, { maxLength: 80, autoComplete: 'off' })}
      {text('middle_name', 'Middle name', true, { maxLength: 80, autoComplete: 'off' })}
      {text('name_extension', 'Name extension', true, { maxLength: 10, placeholder: 'Jr., III' })}
      {text('birth_date', 'Birth date', false, { type: 'date' })}
      <div className={`field${error('sex') ? ' bad' : ''}`}>
        <label className="label" htmlFor={`${id}-sex`}>Sex</label>
        <Select id={`${id}-sex`} value={draft.sex} aria-invalid={!!error('sex')} onChange={e => set({ ...draft, sex: e.target.value })}>
          <option value="">Choose</option><option value="female">Female</option><option value="male">Male</option>
        </Select>
        {error('sex') ? <span className="field-error">{error('sex')}</span> : null}
      </div>
      {text('lrn', 'LRN', false, { inputMode: 'numeric', maxLength: 20, className: 'mono', placeholder: 'All 12 digits' })}
      {text('address', 'Address', true, { maxLength: 300, autoComplete: 'off' })}
      {/*
        The grade this learner is enrolling at, asked for on 2026-11-07. It is
        a column of the list rather than a field of the learner record — a
        learner has no grade, an enrolment does — so it sits here with the
        address rather than among the name fields.
      */}
      <div className="field">
        <label className="label" htmlFor={`${id}-grade_level`}>Grade level<span className="optional">Optional</span></label>
        <Select id={`${id}-grade_level`} value={draft.grade_level} onChange={e => set({ ...draft, grade_level: e.target.value })}>
          <option value="">Use the grade chosen for the list</option>
          {[0, 1, 2, 3, 4, 5, 6].map(g => <option key={g} value={String(g)}>{gradeName(g)}</option>)}
        </Select>
        <span className="hint">Which grade this learner is enrolling at. Leave it as it is for the grade the rest of the list uses.</span>
      </div>
    </div>
  );
}

/** The adviser's version: one row added to the class list they are about to check and submit. */
export function LateRowSheet({ onAdd, onClose }: { onAdd: (row: Profile) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(blankLearner);
  const [bad, setBad] = useState<[keyof Draft, string][]>([]);
  const add = (event: FormEvent) => {
    event.preventDefault();
    const found = learnerProblems(draft);
    setBad(found);
    if (!found.length) onAdd(toLearnerProfile(draft));
  };
  return (
    <Sheet title="Add learner" note="The learner is added as one row of your class list. Check and submit the list as usual; the office enrols them." onClose={onClose}>
      <form noValidate onSubmit={add}>
        <LearnerFields draft={draft} set={setDraft} bad={bad} />
        <div className="form-actions">
          <button type="submit" className="btn">Add to my list</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

/** The office's version: search the registry, then enrol the learner on file or create and enrol a new one. */
export function EnlistSheet({ api, year, sections, onClose, onDone }: {
  api: Api; year: Row; sections: Row[]; onClose: () => void; onDone: (text: string) => void;
}) {
  const id = useId();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const [draft, setDraft] = useState<Draft>(blankLearner);
  const [bad, setBad] = useState<[keyof Draft, string][]>([]);
  const [sectionId, setSectionId] = useState(String(sections[0]?.id ?? ''));
  const [enrolledOn, setEnrolledOn] = useState(today < String(year.starts_on) ? String(year.starts_on) : today > String(year.ends_on) ? String(year.ends_on) : today);
  const [kind, setKind] = useState<'regular' | 'transfer_in'>('transfer_in');
  const [matches, setMatches] = useState<Row[] | null>(null);
  const [created, setCreated] = useState<Row | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const section = sections.find(s => s.id === sectionId);

  const enrol = async (learner: Row) => {
    await api('/enrollments', 'POST', { learner_id: learner.id, section_id: sectionId, enrolled_on: enrolledOn, entry_kind: kind });
    onDone(`${learnerName(learner)} enrolled in ${gradeName(section?.grade_level)} · ${String(section?.name ?? '')} from ${enrolledOn}.`);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (error) {
      const fields = error instanceof ApiError ? (error.fields ?? []) : [];
      if (fields.length) setBad(fields.map(f => [f.path as keyof Draft, f.message]));
      setStatus({ kind: 'error', text: message(error) });
    } finally { setBusy(false); }
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    const found = learnerProblems(draft);
    setBad(found);
    if (found.length || !sectionId) { setStatus(found.length ? { kind: 'error', text: 'Fix the fields marked below.' } : { kind: 'error', text: 'Choose a section.' }); return; }
    void run(async () => {
      setStatus({ kind: 'busy', text: 'Looking for a record already on file…' });
      const p = toLearnerProfile(draft);
      // Same surname and birth date: the registry's own search, recorded in the access log like any other.
      const page = await api<Page>(`/learners${query({ search: p.last_name, birth_date: p.birth_date, limit: 20 })}`);
      const same = page.items.filter(r => String(r.first_name).trim().toLowerCase() === p.first_name.toLowerCase() || (p.lrn && r.lrn === p.lrn));
      if (same.length) { setMatches(same); setStatus({ kind: 'idle', text: '' }); return; }
      setMatches([]);
      await createAndEnrol();
    });
  };
  const createAndEnrol = async () => {
    setStatus({ kind: 'busy', text: 'Creating the record…' });
    const learner = created ?? await api<Row>('/learners', 'POST', toLearnerProfile(draft));
    setCreated(learner);
    setStatus({ kind: 'busy', text: 'Enrolling…' });
    await enrol(learner);
  };

  return (
    <Sheet title="Enlist one late learner" note={`Into a section of ${yearLabel(year)}, without a class-list file.`} wide onClose={onClose}>
      <StatusLine status={status} />
      {created ? <Callout tone="attention" title="The record was created">{learnerName(created)} is now in the registry. If the enrollment was refused, fix the section or date and enrol again; the record is not created twice.</Callout> : null}
      {matches?.length ? (
        <>
          <Callout tone="attention" title="Already on file?">A learner with the same name and birth date is in the registry. Enrol that record, unless this is a different child.</Callout>
          <Table rows={matches} rowKey={r => String(r.id)} columns={[
            { header: 'Learner', cell: r => <Cell title={learnerName(r)} meta={r.lrn ? `LRN ${String(r.lrn)}` : 'LRN missing'} /> },
            { header: 'Birth date', cell: r => <span className="mono">{String(r.birth_date)}</span> },
            { header: 'Enrol', cell: r => <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => enrol(r))}>Enrol this record</button> },
          ]} />
          <div className="form-actions">
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void run(createAndEnrol)}>None of these: create a new record</button>
            <button type="button" className="btn ghost" onClick={() => setMatches(null)}>Change the details</button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={search}>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor={`${id}-section`}>Section</label>
              <Select id={`${id}-section`} value={sectionId} onChange={e => setSectionId(e.target.value)}>
                {sections.map(s => <option key={String(s.id)} value={String(s.id)}>{sectionName(s)}</option>)}
              </Select>
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-on`}>First day in the section</label>
              <input id={`${id}-on`} type="date" value={enrolledOn} min={String(year.starts_on)} max={String(year.ends_on)} onChange={e => setEnrolledOn(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-kind`}>Joining as</label>
              <Select id={`${id}-kind`} value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
                <option value="transfer_in">Transferred in</option>
                <option value="regular">Regular enrollment, late</option>
              </Select>
            </div>
          </div>
          <LearnerFields draft={draft} set={setDraft} bad={bad} />
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Working…' : created ? 'Enrol again' : 'Check the registry and enrol'}</button>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

const yearLabel = (y: Row) => `${String(y.start_year)}–${Number(y.start_year) + 1}`;
