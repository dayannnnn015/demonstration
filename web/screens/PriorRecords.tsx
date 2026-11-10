import { useCallback, useEffect, useId, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { Icon } from '../components/icons';
import { Affects } from '../components/affects';
import { Confirm, Sheet } from '../components/overlay';
import { reportCardAreas } from '../learning-areas';
import { credentialName, schoolYearLabel, shownGrade, type Credential } from '../forms/types';
import { EncodingProgress } from './EncodingProgress';
import {
  Badge, Callout, Cell, Control, DescriptionToggle, Editor, EmptyState, Finder, PageHeader, StatusLine, Table, Task, Unrecorded,
  gradeName, idle, learnerName, useDescriptions, type Field, type Status,
} from '../components/primitives';

/**
 * Where the academic history the school already holds on paper is typed in.
 *
 * This is a one-off. EDUNEXUS derives the SF10 from what it recorded itself, so
 * on the day the school starts using it a Grade 3 learner has one scholastic
 * block and five empty ones, while their Kinder-to-Grade-2 history sits in an
 * adviser's own spreadsheets. Typing it here puts those years onto the same
 * cumulative SF10 — one permanent record per learner, never one per year — and
 * once a year is encoded it is never encoded again: from then on EDUNEXUS adds
 * each new year itself, from the enrolment and the grades entered on Promotion.
 *
 * Three things this screen will not do, each of them deliberate:
 *
 * - It records no Kindergarten grade. The SF10-ES has no scholastic block for
 *   Kinder; Kinder is the credential that makes a learner eligible for Grade 1,
 *   so it is recorded under Eligibility for Grade 1 and carries no number.
 * - It computes nothing. The General Average is the one the document already
 *   carries. There is no total, no average and no transmutation here or in the
 *   API behind it.
 * - It changes no current record. An encoded year is a copy of a document, not
 *   an enrolment: it touches nobody's current grade, section or register, and a
 *   year EDUNEXUS already holds is refused rather than duplicated.
 */
export function PriorRecords({ api, manager, setStatus, route, token }: {
  api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route;
}) {
  const [search, setSearch] = useState<Record<string, string>>({ search: '', grade_level: '' });
  /*
   * Whether to list learners at all.
   *
   * A teacher's list is the learners in the classes they advise — about twenty,
   * all of them already theirs to read — so it is shown on opening and there is
   * nothing to choose first. A manager's is the whole school, and every list
   * under /learners writes a `record_access_events` row naming exactly the
   * records it returned, so theirs still starts from a search rather than
   * logging a read of the registry every time the screen is opened.
   *
   * `applied` is the fix for a real bug: the gate used to be
   * `Object.values(search).some(Boolean)`, and **"Any grade" is the empty
   * value**, so a manager choosing it cleared the list instead of widening it —
   * the filter looked like it had found nobody in the school. Applying the
   * finder is now what opens the list, whatever values it carries.
   */
  const [applied, setApplied] = useState(false);
  const [found, setFound] = useState<Page | null>(null);
  const [chosen, setChosen] = useState<Row | null>(null);
  // A learner the Learner registry handed over, as `#/prior-records?learner=<id>`.
  // Only the id travels: the screen reads the learner itself, so the link cannot
  // put a name on screen that the caller may not be allowed to see.
  const [asked, setAsked] = useState(() => learnerFromHash(typeof location === 'undefined' ? '' : location.hash));
  useEffect(() => {
    if (!asked) return;
    let live = true;
    void api<Row>(`/learners/${asked}`)
      .then(row => { if (live) { setChosen(row); setAsked(''); } })
      .catch(error => { if (live) { setAsked(''); setStatus({ kind: 'error', text: message(error) }); } });
    return () => { live = false; };
  }, [api, asked, setStatus]);
  const [records, setRecords] = useState<Records | null>(null);
  /** The learners the search found, and where in them the open one sits, so the
   *  arrows can move between them without going back to the list. */
  const siblings = found?.items ?? [];
  const at = chosen ? siblings.findIndex(r => String(r.id) === String(chosen.id)) : -1;
  const step = (by: number) => {
    const next = siblings[at + by];
    if (next) { setChosen(next); setRecords(null); }
  };
  const [editing, setEditing] = useState<{ block: EncodedYear | null } | null>(null);
  const [removing, setRemoving] = useState<EncodedYear | null>(null);
  const [beat, setBeat] = useState(0);
  const again = useCallback(() => setBeat(n => n + 1), []);

  const searching = !manager || applied || Object.values(search).some(Boolean);
  /**
   * A learner whose only school year is Kindergarten. They have no previous
   * grade to copy and no SF10 yet, so the screen says so instead of offering a
   * year to add. Read from the record once it loads, not from the search row,
   * because the record is what the API answered for.
   */
  const noBlockYet = records !== null && !records.prior_years.length
    && records.recorded_years.length > 0 && records.recorded_years.every(y => y.grade_level <= 1);
  /** Kindergarten only, which has its own wording: they have no SF10 at all yet. */
  const inKinder = noBlockYet && records.recorded_years.every(y => y.grade_level === 0);
  useEffect(() => {
    if (!searching) { setFound(null); return; }
    let live = true;
    void api<Page>(`/learners${query({ ...search, limit: 25 })}`)
      .then(r => { if (live) setFound(r); })
      .catch(error => { if (live) { setFound({ items: [] }); setStatus({ kind: 'error', text: message(error) }); } });
    return () => { live = false; };
  }, [api, search, searching, setStatus, token]);

  useEffect(() => {
    if (!chosen) { setRecords(null); return; }
    let live = true;
    setRecords(null);
    void api<Records>(`/learners/${String(chosen.id)}/prior-records`)
      .then(r => { if (live) setRecords(r); })
      .catch(error => { if (live) { setChosen(null); setStatus({ kind: 'error', text: message(error) }); } });
    return () => { live = false; };
  }, [api, chosen, beat, setStatus, token]);

  // One continuous history, in year order, whichever of the two places each
  // year came from. A year EDUNEXUS holds is shown and never edited here: its
  // grades are entered on Promotion and reach the SF10 from there.
  const timeline: TimelineRow[] = records
    ? [
        ...records.prior_years.map(y => ({ key: `p:${y.id}`, start_year: y.start_year, grade_level: y.grade_level, encoded: y } as TimelineRow)),
        ...records.recorded_years.map(y => ({ key: `r:${y.academic_year_id}`, start_year: y.start_year, grade_level: y.grade_level, recorded: y } as TimelineRow)),
      ].sort((a, b) => a.start_year - b.start_year || a.grade_level - b.grade_level)
    : [];

  return (
    <>
      <PageHeader
        route={route}
        actions={chosen && records?.may_write
          ? <button type="button" className="btn" disabled={noBlockYet} onClick={() => setEditing({ block: null })}><Icon name="plus" size={15} />Add a school year</button>
          : null}
      />

      {manager
        ? null
        : <Callout tone="info" title="You encode your own learners">
            The learners currently in the sections you advise, in an open school year. A principal or administrative officer may encode for anyone.
          </Callout>}

      {/* School-wide oversight, above the learner finder: a manager needs to see
          which of 30 classes still has work before they go looking for a child.
          Counts only, so it names nobody and writes no access row. */}
      {manager && !chosen ? <div className="card"><EncodingProgress api={api} setStatus={setStatus} /></div> : null}

      {chosen ? null : (
        <div className="card">
          <div className="card-tools">
            <Finder
              initial={search}
              onApply={next => { setSearch(next); setApplied(true); }}
              onClear={() => { setSearch({ search: '', grade_level: '' }); setApplied(false); }}
              fields={[
                { key: 'search', label: 'Name or LRN', optional: true, minLength: 2, maxLength: 100, hint: 'At least two characters.' },
                // Managers only. An adviser reads only the learners in the
                // classes they advise, so a grade they do not teach could only
                // ever come back empty; row security is what scopes the list,
                // not the absence of this control.
                ...(manager ? [{ key: 'grade_level', label: 'Grade level now', optional: true,
                  options: [['', 'Any grade'] as [string, string], ...[0, 1, 2, 3, 4, 5, 6].map(g => [String(g), gradeName(g)] as [string, string])] }] satisfies Field[] : []),
              ]}
            />
          </div>
          {searching ? (
            <Table
              loading={found === null}
              rows={found?.items ?? []}
              rowKey={r => String(r.id)}
              empty={<EmptyState title="No learners match" body="Try a shorter name, or a different grade." />}
              columns={[
                { header: 'Learner', cell: r => <Cell title={learnerName(r)} meta={r.lrn == null ? <Unrecorded label="LRN missing" /> : `LRN ${String(r.lrn)}`} /> },
                {
                  header: 'Grade now',
                  cell: r => { const p = r.placement as { grade_level: number } | null; return p ? gradeName(p.grade_level) : <Unrecorded label="Not enrolled this year" />; },
                },
                {
                  header: 'Academic history',
                  cell: r => <button type="button" className="btn secondary small" onClick={() => setChosen(r)}>Open the history</button>,
                },
              ]}
            />
          ) : (
            <EmptyState
              title="Find the learner first"
              body="Search by name or LRN, or choose a grade level — Any grade lists the whole school. A learner’s previous school years are typed onto their own permanent record, so this starts from the learner rather than from a class."
            />
          )}
        </div>
      )}

      {chosen ? (
        <>
          <div className="card">
            <div className="card-tools">
              <p className="card-note">
                <b>{learnerName(chosen)}</b>
                {chosen.lrn == null ? <> · <Unrecorded label="LRN missing" /></> : <> · LRN {String(chosen.lrn)}</>}
              </p>
              <div className="learner-step">
                {at >= 0 && siblings.length > 1 ? <span className="muted">{at + 1} of {siblings.length}</span> : null}
                <button type="button" className="btn ghost small" disabled={at <= 0} aria-label="Previous learner" title="Previous learner"
                  onClick={() => step(-1)}><Icon name="back" size={14} /></button>
                <button type="button" className="btn ghost small" disabled={at < 0 || at >= siblings.length - 1} aria-label="Next learner" title="Next learner"
                  onClick={() => step(1)}><Icon name="forward" size={14} /></button>
                <button type="button" className="btn ghost small" aria-label="Find another learner" title="Find another learner"
                  onClick={() => { setChosen(null); setRecords(null); }}><Icon name="search" size={14} /></button>
              </div>
            </div>
            {inKinder ? (
              <Callout tone="info" title="This learner is in Kindergarten, so there is nothing to encode yet">
                The SF10 begins when a learner enters Grade 1. Kindergarten is not a school year with grades on it — it is the <i>credential</i> that admits a learner to
                Grade 1 — so a Kindergarten learner has no SF10 and no previous years to copy. Their Kindergarten records are the SF5-K and the ECCD checklist, which the
                school keeps and EDUNEXUS neither holds nor replaces. Record the credential they present once they are enrolled in Grade 1.
              </Callout>
            ) : noBlockYet ? (
              <Callout tone="info" title="There is no earlier school year to add for this learner yet">
                A scholastic block on the SF10 is Grade 1 to Grade 6, and Kindergarten is never one — it is the <i>credential</i> that admits a learner to Grade 1. The
                only year behind a Grade 1 learner is Kindergarten, so there is nothing to copy from a document. Record what they presented under <b>Eligibility for
                Grade 1</b> below instead; a school year becomes addable once they have finished one at Grade 1 or above elsewhere.
              </Callout>
            ) : null}
            {chosen.lrn == null ? (
              <Callout tone="attention" title="This learner has no LRN on file">
                The history can still be encoded, and it stays attached to this one permanent record. The SF10 prints its LRN box empty until the number is filled on the Learner registry.
              </Callout>
            ) : null}

            <Task title="School years" note="One cumulative record, in year order">
              <p className="muted">
                Every school year on this learner’s SF10. A year EDUNEXUS recorded itself is shown here but entered on Promotion; only a year copied from the school’s own
                documents is edited here. Each year appears once: encoding a year EDUNEXUS already holds is refused rather than printed twice.
              </p>
              <Table
                loading={records === null}
                rows={timeline}
                rowKey={r => r.key}
                empty={<EmptyState title="No school year on record yet" body="Add the earliest year the school still holds a document for, then work forwards. A year with no document is left out, and the SF10 prints it blank." />}
                columns={[
                  { header: 'School year', cell: r => schoolYearLabel(r.start_year) },
                  { header: 'Grade', cell: r => gradeName(r.grade_level) },
                  {
                    header: 'Where it came from',
                    cell: r => (r.encoded
                      ? <Badge tone="info">Copied from a document</Badge>
                      : <Badge tone="good">Recorded in EDUNEXUS</Badge>),
                  },
                  {
                    header: 'School',
                    cell: r => (r.encoded
                      ? <Cell title={r.encoded.school_name} meta={r.encoded.school_code ? `School ID ${r.encoded.school_code}` : undefined} />
                      : <span className="muted">This school</span>),
                  },
                  {
                    header: 'Section',
                    cell: r => {
                      const name = r.encoded ? r.encoded.section_name : r.recorded?.section_name ?? null;
                      return name ?? <Unrecorded label="No section recorded" />;
                    },
                  },
                  {
                    header: 'Learning areas',
                    cell: r => (r.encoded ? String(r.encoded.subjects.length) : <span className="muted">On Promotion</span>),
                  },
                  {
                    header: 'General average',
                    cell: r => {
                      if (!r.encoded) return <span className="muted">On Promotion</span>;
                      return r.encoded.general_average === null
                        ? <Unrecorded label="Not on the document" />
                        : <span className="mono">{shownGrade(r.encoded.general_average)}</span>;
                    },
                  },
                  {
                    header: 'Record',
                    cell: r => {
                      if (!r.encoded || !records?.may_write) return null;
                      const block = r.encoded;
                      return (
                        <span className="row-actions">
                          <button type="button" className="btn ghost small" onClick={() => setEditing({ block })}>Correct</button>
                          <button type="button" className="btn ghost small" onClick={() => setRemoving(block)}>Remove</button>
                        </span>
                      );
                    },
                  },
                ]}
              />
            </Task>

            <Task title="Eligibility for Grade 1" note="Where a Kindergarten record goes">
              <p className="muted">
                The credential presented when this learner entered Grade 1, and the school that issued it. The SF10 has no scholastic block for Kindergarten — Kinder is this
                credential — so nothing here carries a grade, and EDUNEXUS records no Kindergarten grade anywhere.
              </p>
              {records === null
                ? <p className="muted">Reading the record…</p>
                : records.may_write
                  ? <Eligibility api={api} learner={String(chosen.id)} record={records.eligibility} school={records.school} setStatus={setStatus} onSaved={again} />
                  : <EligibilityRead record={records.eligibility} />}
            </Task>
          </div>

          {records?.may_write ? null : (
            <Callout tone="info" title="You can read this history but not change it">
              This learner is not currently in a section you advise. A principal or administrative officer encodes and corrects their history.
            </Callout>
          )}
        </>
      ) : null}

      {editing && chosen && records ? (
        <YearSheet
          api={api}
          learner={String(chosen.id)}
          learnerLabel={learnerName(chosen)}
          block={editing.block}
          school={records.school}
          taken={records.prior_years.filter(y => y.id !== editing.block?.id).map(y => y.start_year)}
          recorded={records.recorded_years.map(y => y.start_year)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); again(); setStatus({ kind: 'done', text: 'School year saved onto the permanent record.' }); }}
        />
      ) : null}

      {removing ? (
        <Remove api={api} block={removing} onClose={() => setRemoving(null)}
          onDone={text => { setRemoving(null); again(); setStatus({ kind: 'done', text }); }}
          onFailed={text => { setRemoving(null); setStatus({ kind: 'error', text }); }} />
      ) : null}
    </>
  );
}

/** The learner a link from another screen asked for, as `#/prior-records?learner=<id>`. */
export function learnerFromHash(hash: string) {
  const found = /[?&]learner=([0-9a-fA-F-]{36})(?:&|$)/.exec(hash)?.[1];
  return found ? found.toLowerCase() : '';
}

type EncodedSubject = {
  subject_id: string | null; code: string | null; name: string; display_order: number;
  q1: number | null; q2: number | null; q3: number | null; q4: number | null; final: number | null; remark: 'passed' | 'failed' | null;
};
type EncodedYear = {
  id: string; learner_id: string; start_year: number; grade_level: number; school_name: string; school_code: string | null;
  school_address: string | null; section_name: string | null; adviser_name: string | null; general_average: number | null;
  remark: 'passed' | 'failed' | null; source: string; version: number; subjects: EncodedSubject[];
};
type EligibilityRecord = {
  id: string; learner_id: string; credential: Credential; credential_other: string | null; school_name: string | null;
  school_code: string | null; school_address: string | null; pept_rating: string | null; examined_on: string | null;
  testing_center: string | null; remark: string | null; source: string; version: number;
};
type SchoolHeading = { name: string; school_code: string | null; address: string; region: string | null; division: string | null; district: string | null };
type Records = {
  learner: Row; may_write: boolean; school: SchoolHeading; eligibility: EligibilityRecord | null;
  prior_years: EncodedYear[];
  recorded_years: { academic_year_id: string; start_year: number; grade_level: number; section_name: string | null; status: string }[];
};
type TimelineRow = {
  key: string; start_year: number; grade_level: number;
  encoded?: EncodedYear; recorded?: { academic_year_id: string; start_year: number; grade_level: number; section_name: string | null; status: string };
};

const credentialOptions: [string, string][] = (['kinder_progress_report', 'eccd_checklist', 'kindergarten_certificate', 'pept', 'others'] as Credential[])
  .map(c => [c, credentialName[c]]);

/** The credential as the form prints it, for a reader who may not change it. */
function EligibilityRead({ record }: { record: EligibilityRecord | null }) {
  if (!record) return <Unrecorded label="No credential recorded" />;
  return (
    <p className="card-note">
      <b>{credentialName[record.credential]}</b>
      {record.credential_other ? ` — ${record.credential_other}` : ''}
      {record.school_name ? ` · ${record.school_name}` : ''}
      {record.school_code ? ` (School ID ${record.school_code})` : ''}
      {record.pept_rating ? ` · Rating ${record.pept_rating}` : ''}
      {record.examined_on ? ` · Examined ${record.examined_on}` : ''}
    </p>
  );
}

/**
 * The credential, as a flat form, which is what `Editor` is for: it maps a
 * field rejection onto the control that caused it without this screen doing
 * anything. The school fields default to this school, because most learners
 * took their Kinder year here; a transferee's is typed over.
 */
function Eligibility({ api, learner, record, school, setStatus, onSaved }: {
  api: Api; learner: string; record: EligibilityRecord | null; school: SchoolHeading;
  setStatus: (s: Status) => void; onSaved: () => void;
}) {
  const fields: Field[] = [
    { key: 'credential', label: 'Credential presented for Grade 1', options: credentialOptions, choose: !record },
    { key: 'credential_other', label: 'If another credential, which', optional: true, maxLength: 150, hint: 'Only for “Other credential”.' },
    { key: 'school_name', label: 'Name of school', optional: true, maxLength: 150 },
    { key: 'school_code', label: 'School ID', optional: true, pattern: '[0-9]{6}', maxLength: 6, hint: 'Six digits, as the school’s own forms print it.' },
    { key: 'school_address', label: 'Address of school', optional: true, maxLength: 300 },
    { key: 'pept_rating', label: 'PEPT rating', optional: true, maxLength: 30, hint: 'Only for a PEPT credential, exactly as the result sheet reads.' },
    { key: 'examined_on', label: 'Date of examination', type: 'date', optional: true },
    { key: 'testing_center', label: 'Name and address of testing center', optional: true, maxLength: 300 },
    { key: 'remark', label: 'Remark', optional: true, maxLength: 150 },
    { key: 'source', label: 'Document this was copied from', wide: true, minLength: 10, maxLength: 500, hint: 'Which record this came from, so the transcription can be checked later.' },
    // Recording the credential for the first time asks for no reason: the document it was copied from is the record of
    // where it came from, and the system writes the journal's reason (the UI notes of 8 November, decision U-D2).
    // Changing one already recorded is a correction of a learner's record, and still says why.
    ...(record ? [{ key: 'reason', label: 'Reason for this correction', wide: true, type: 'textarea', minLength: 10, maxLength: 500 }] : []),
  ];
  const initial = record ?? { school_name: school.name, school_code: school.school_code, school_address: school.address };
  return (
    <Editor
      fields={fields}
      initial={initial as Record<string, unknown>}
      submitLabel={record ? 'Save the credential' : 'Record the credential'}
      setStatus={setStatus}
      onSaved={onSaved}
      warning={<Affects what="eligibility" />}
      onSubmit={data => {
        const { reason, ...payload } = data;
        return api(`/learners/${learner}/eligibility`, 'PATCH', {
          ...payload, reason: record ? reason : 'Recorded the credential presented for Grade 1 on Academic history, from the document named.', version: record?.version ?? 0,
        });
      }}
    />
  );
}

type SubjectDraft = { key: string; name: string; code: string; q1: string; q2: string; q3: string; q4: string; final: string; remark: string };
const blankSubject = (n: number): SubjectDraft => ({ key: `new-${n}`, name: '', code: '', q1: '', q2: '', q3: '', q4: '', final: '', remark: '' });
const num = (text: string) => (text.trim() === '' ? null : Number(text));
const text = (value: string) => (value.trim() === '' ? null : value.trim());
/** A grade as the document shows it: 89, 88.5 or 88.25. Blank stays blank — a box nobody filled is not a zero. */
const gradeField = { type: 'number', min: 0, max: 100, step: '0.01' };

/**
 * One scholastic block: the year's own fields above its learning areas, saved
 * in a single request so a half-written year never reaches the record.
 *
 * It is built from `Control` rather than `Editor` because it is not a flat list
 * of fields, which means it owns the two things `Editor` would otherwise do —
 * the summary that names every rejected field, and putting each server message
 * beside the control it belongs to, including a message about one row of the
 * grid.
 */
/**
 * The year a school year began, from either way a person writes one.
 *
 * "2015" is the value the record keeps. "2015-2016" is how every document the
 * school is copying from prints it, and typing that was the first thing they
 * did — into a number field, which showed the text and reported nothing, so
 * the form sent an empty year and the refusal named a rule the field appeared
 * to satisfy. Both are read here, along with the en and em dashes a word
 * processor substitutes for the hyphen.
 *
 * A range whose second year is not the first plus one is refused rather than
 * guessed at: "2015-2017" is a mistake, not a school year.
 */
export function startYear(typed: string): number | null {
  const text = typed.trim().replace(/[‐-―]/g, '-');
  const one = /^(\d{4})$/.exec(text);
  if (one) return Number(one[1]);
  const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(text);
  if (!range) return null;
  const from = Number(range[1]), to = Number(range[2]);
  return to === from + 1 ? from : null;
}

function YearSheet({ api, learner, learnerLabel, block, school, taken, recorded, onClose, onSaved }: {
  api: Api; learner: string; learnerLabel: string; block: EncodedYear | null; school: SchoolHeading;
  taken: number[]; recorded: number[]; onClose: () => void; onSaved: () => void;
}) {
  const scope = useId();
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<Record<string, string>>({});
  const [head, setHead] = useState<Record<string, string>>(() => ({
    start_year: block ? String(block.start_year) : '',
    end_year: block ? String(block.start_year + 1) : '',
    grade_level: block ? String(block.grade_level) : '',
    school_name: block ? block.school_name : school.name,
    school_code: block ? block.school_code ?? '' : school.school_code ?? '',
    school_address: block ? block.school_address ?? '' : school.address,
    section_name: block?.section_name ?? '',
    adviser_name: block?.adviser_name ?? '',
    general_average: block?.general_average === null || block?.general_average === undefined ? '' : String(block.general_average),
    remark: block?.remark ?? '',
    source: block?.source ?? '',
    reason: '',
  }));
  const [subjects, setSubjects] = useState<SubjectDraft[]>(() => (block && block.subjects.length
    ? [...block.subjects].sort((a, b) => a.display_order - b.display_order).map((s, i) => ({
        key: `has-${i}`, name: s.name, code: s.code ?? '',
        q1: s.q1 === null ? '' : String(s.q1), q2: s.q2 === null ? '' : String(s.q2),
        q3: s.q3 === null ? '' : String(s.q3), q4: s.q4 === null ? '' : String(s.q4),
        final: s.final === null ? '' : String(s.final), remark: s.remark ?? '',
      }))
    : [blankSubject(0), blankSubject(1), blankSubject(2)]));

  const id = (key: string) => `${scope}-${key}`;
  // The sheet's own prose follows the same switch its fields' hints do, so one
  // control quiets the whole form rather than each paragraph having its own.
  const [notes] = useDescriptions();
  /** The draft is a plain record, so every read of it is a string; a field never typed into is empty, not missing. */
  const h = (key: string) => head[key] ?? '';
  const setField = (key: string, value: string) => {
    setHead(prev => {
      const next = { ...prev, [key]: value };
      // Typing the start fills the end, because a school year ends the year
      // after it begins and nobody should have to type both. It is still a
      // field rather than a label: a document that disagrees can be followed,
      // and the pair is checked before anything is sent.
      if (key === 'start_year') {
        const from = startYear(value);
        next.end_year = from === null ? '' : String(from + 1);
      }
      return next;
    });
    setBad(b => { const { [key]: _gone, ...rest } = b; return rest; });
  };
  const setSubject = (index: number, key: keyof SubjectDraft, value: string) => {
    setSubjects(list => list.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    setBad(b => { const path = `subjects.${index}.${key}`; const { [path]: _gone, ...rest } = b; return rest; });
  };

  // The school's own report cards list these areas for each grade. Offered as a
  // starting list the person edits against the document in front of them, never
  // written by itself: a document that lists different areas is the authority.
  const grade = Number(h('grade_level'));
  const proposal = Number.isInteger(grade) && grade >= 1 && grade <= 6
    ? reportCardAreas
        .filter(a => a.lines[grade as 1 | 2 | 3 | 4 | 5 | 6] !== undefined)
        .sort((a, b) => (a.lines[grade as 1 | 2 | 3 | 4 | 5 | 6] ?? 0) - (b.lines[grade as 1 | 2 | 3 | 4 | 5 | 6] ?? 0))
    : [];
  const listed = new Set(subjects.map(s => s.name.trim().toLowerCase()).filter(Boolean));
  const addable = proposal.filter(a => !listed.has(a.name.toLowerCase()));

  const headFields: Field[] = [
    // Text, not a number input, and that is the fix rather than a preference.
    // The school typed the school year the way their documents print it —
    // "2020-2021" — into a number field. A number input accepts the hyphen as
    // it types, shows what was typed, and then reports an **empty** value, so
    // the form sent nothing and the refusal read "a school year from 1990 up to
    // this one" against a field that plainly held one. Both forms are now read.
    // Two fields, asked for on 2026-11-07. One box for a school year made
    // people type it the way their documents print it, "2021-2022", and the
    // record keeps only the year it began — so the box had to accept a range
    // and quietly discard half of it. Asking for both says plainly what is
    // kept and what is only being checked.
    { key: 'start_year', label: 'School year began', maxLength: 4, pattern: '[0-9]{4}',
      hint: 'The year it began: a 2015 – 2016 school year is 2015. Any year from 1990 to this one.' },
    { key: 'end_year', label: 'School year ended', maxLength: 4, pattern: '[0-9]{4}',
      hint: 'The year after it, filled in for you. It is checked against the start, and only the start is kept.' },
    { key: 'grade_level', label: 'Grade level', options: [['', 'Choose…'], ...[1, 2, 3, 4, 5, 6].map(g => [String(g), gradeName(g)] as [string, string])], choose: true,
      hint: 'Grade 1 to Grade 6. A Kindergarten year is not one of these: it is the credential under Eligibility for Grade 1. Never enter a Kindergarten year’s marks as Grade 1 grades — they are not the same record.' },
    { key: 'school_name', label: 'School that taught the year', maxLength: 150, hint: 'This school, or the previous school for a transferee.' },
    { key: 'school_code', label: 'School ID', optional: true, pattern: '[0-9]{6}', maxLength: 6, hint: 'Six digits. Filling it prints the district, division and region for this school.' },
    { key: 'school_address', label: 'Address of school', optional: true, maxLength: 300 },
    { key: 'section_name', label: 'Section', optional: true, maxLength: 60 },
    { key: 'adviser_name', label: 'Adviser or teacher', optional: true, maxLength: 150 },
    { key: 'remark', label: 'Remark', optional: true, options: [['', 'Not on the document'], ['passed', 'Passed'], ['failed', 'Failed']] },
    { key: 'source', label: 'Document this was copied from', wide: true, minLength: 10, maxLength: 500,
      hint: 'Which spreadsheet, form or photocopy this year was read out of, so the transcription can be checked later.' },
    // A new school year asks for no reason (decision U-D2): *Document this was copied from* already says where it came
    // from, and the system writes the journal's reason. A correction to a year on record still says why.
    ...(block ? [{ key: 'reason', label: 'Reason for this correction', wide: true, type: 'textarea', minLength: 10, maxLength: 500 }] : []),
  ];

  const began = startYear(h('start_year'));
  const ended = h('end_year').trim();
  // The end year is a check on the start, never a second value: the record
  // keeps one year, as an SF10 block does.
  const yearPair = began === null ? null
    : ended === '' ? `Fill the year this school year ended — ${began + 1}.`
      : Number(ended) === began + 1 ? '' : `A school year ends the year after it begins, so ${began} runs to ${began + 1}.`;
  const clash = began !== null
    ? recorded.includes(began)
      ? 'EDUNEXUS already holds this school year for this learner. Its grades are entered on Promotion → Report card, and reach the SF10 from there.'
      : taken.includes(began)
        ? 'This school year is already encoded for this learner. Open that year and correct it instead of adding it again.'
        : ''
    : '';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setBad({});
    if (began === null || yearPair) {
      setBad(began === null
        ? { start_year: 'The year this school year began, as four digits: 2015.' }
        : { end_year: yearPair ?? '' });
      setStatus({ text: 'Check the fields marked below.', kind: 'error' });
      setBusy(false);
      return;
    }
    setStatus({ text: 'Saving…', kind: 'busy' });
    const rows = subjects.filter(s => s.name.trim() !== '' || s.q1 || s.q2 || s.q3 || s.q4 || s.final || s.remark);
    const payload = {
      year: {
        start_year: began, grade_level: Number(h('grade_level')),
        school_name: h('school_name').trim(), school_code: text(h('school_code')), school_address: text(h('school_address')),
        section_name: text(h('section_name')), adviser_name: text(h('adviser_name')),
        // The box is gone from this sheet, asked for on 2026-11-10, but a year
        // already carrying an average keeps it: sending null here would have
        // wiped it on the next correction, and it prints on the SF10.
        general_average: block ? (block.general_average as number | null) : null, remark: text(h('remark')),
        source: h('source').trim(),
      },
      subjects: rows.map(s => ({
        subject_id: null, code: text(s.code.toUpperCase()), name: s.name.trim(),
        q1: num(s.q1), q2: num(s.q2), q3: num(s.q3), q4: num(s.q4), final: num(s.final), remark: text(s.remark),
      })),
      reason: block ? h('reason').trim() : `Added the ${schoolYearLabel(began)} school year, Grade ${h('grade_level')}, on Academic history, from the document named.`,
    };
    try {
      if (block) await api(`/prior-years/${block.id}`, 'PATCH', { ...payload, version: block.version });
      else await api(`/learners/${learner}/prior-years`, 'POST', payload);
      setStatus({ text: 'Saved.', kind: 'done' });
      onSaved();
    } catch (error) {
      // A rejection that names fields belongs beside those fields, including a
      // row of the grid. Anything else is about the record, not the typing.
      const named = error instanceof ApiError ? error.fields : [];
      if (named.length) {
        setBad(Object.fromEntries(named.map(f => [f.path.replace(/^year\./, ''), f.message])));
        setStatus(error instanceof ApiError ? { kind: 'error', text: error.message } : idle);
      } else setStatus({ text: message(error), kind: 'error' });
    } finally { setBusy(false); }
  };

  const problems = Object.entries(bad);
  return (
    <Sheet
      wide
      title={block ? `Correct ${schoolYearLabel(block.start_year)} · ${learnerLabel}` : `Add a school year · ${learnerLabel}`}
      note="One school year as the school's own document records it. Grades are copied, never computed, and a box the document leaves empty is left empty here."
      onClose={onClose}
    >
      <StatusLine status={status} />
      {clash ? <Callout tone="attention" title="This school year is already on the record">{clash}</Callout> : null}
      {problems.length ? (
        <div className="error-summary" role="alert">
          <h3><Icon name="alert" size={16} />{problems.length === 1 ? 'One field needs attention' : `${problems.length} fields need attention`}</h3>
          <ul>
            {problems.map(([path, note]) => (
              <li key={path}>
                <button type="button" onClick={() => document.getElementById(id(path))?.focus()}>{note}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form noValidate onSubmit={save}>
        <Affects what="history" />
        <div className="form-grid">
          {headFields.map(field => (
            <Control key={field.key} field={field} id={id(field.key)} value={head[field.key] ?? ''} error={bad[field.key]} onChange={next => setField(field.key, next)} />
          ))}
        </div>

        <div className="section-head">
          <h3>Learning areas</h3>
          <DescriptionToggle show="Show the notes" hide="Hide the notes" controls={id('areas-note')} />
        </div>
        {notes ? (
          <p className="muted" id={id('areas-note')}>
            As the document lists them, in its own order. A quarter the document does not carry is left empty — a missing grade is never a zero. The final rating and the
            remark are the ones already written on the document.
          </p>
        ) : null}
        {/*
          * Always said, never only sometimes shown.
          *
          * This offer used to render only when there was something to add,
          * which meant it was absent on opening the sheet — the grade starts on
          * *Choose…*, so there is no grade to propose areas for yet — and the
          * reader met an empty table with no sign the list could be filled at
          * all. It was reported as a feature that had never been built. So the
          * line is always here and says which of the three states it is in.
          */}
        <div className="area-proposal">
          {addable.length ? (
            <>
              <button type="button" className="btn ghost small" onClick={() => setSubjects(list => [
                ...list.filter(s => s.name.trim() !== ''),
                ...addable.map((a, i) => ({ ...blankSubject(list.length + i), name: a.name, code: a.code })),
              ])}>
                <Icon name="plus" size={14} />List the {gradeName(grade)} learning areas
              </button>
              {notes ? <p className="card-note">The areas this school’s own report cards print for {gradeName(grade)}. Check them against the document and edit what differs.</p> : null}
            </>
          ) : (
            <p className="card-note">
              {proposal.length
                ? `Every learning area this school’s report cards print for ${gradeName(grade)} is already listed. Add any further area the document carries.`
                : `Choose the grade level above and the learning areas this school’s own report cards print for it can be listed here in one go.`}
            </p>
          )}
        </div>
        <div className="table-wrap grid-form">
          <table className="data">
            <thead>
              <tr>
                <th>Learning area</th><th>1</th><th>2</th><th>3</th><th>4</th><th>Final</th><th>Remark</th><th><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((row, index) => (
                <tr key={row.key}>
                  <td>
                    <Control compact field={{ key: `name-${index}`, label: `Learning area ${index + 1}`, maxLength: 120 }}
                      id={id(`subjects.${index}.name`)} value={row.name} error={bad[`subjects.${index}.name`]} onChange={next => setSubject(index, 'name', next)} />
                  </td>
                  {(['q1', 'q2', 'q3', 'q4', 'final'] as const).map(key => (
                    <td key={key} className="grade-cell">
                      <Control compact field={{ key: `${key}-${index}`, label: `${row.name || `Area ${index + 1}`} ${key === 'final' ? 'final rating' : `quarter ${key.slice(1)}`}`, optional: true, ...gradeField }}
                        id={id(`subjects.${index}.${key}`)} value={row[key]} error={bad[`subjects.${index}.${key}`]} onChange={next => setSubject(index, key, next)} />
                    </td>
                  ))}
                  <td className="remark-cell">
                    <Control compact field={{ key: `remark-${index}`, label: `${row.name || `Area ${index + 1}`} remark`, optional: true, options: [['', '—'], ['passed', 'Passed'], ['failed', 'Failed']] }}
                      id={id(`subjects.${index}.remark`)} value={row.remark} error={bad[`subjects.${index}.remark`]} onChange={next => setSubject(index, 'remark', next)} />
                  </td>
                  <td>
                    <button type="button" className="btn ghost small" aria-label={`Remove learning area ${index + 1}`}
                      onClick={() => setSubjects(list => (list.length > 1 ? list.filter((_, i) => i !== index) : list))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-note">
          <button type="button" className="btn ghost small" onClick={() => setSubjects(list => [...list, blankSubject(list.length)])}>
            <Icon name="plus" size={14} />Add a learning area
          </button>
        </p>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : block ? 'Save this school year' : 'Add this school year'}</button>
        </div>
      </form>
    </Sheet>
  );
}

/** Removing a transcribed year is irreversible on the record, so it says what it costs. */
function Remove({ api, block, onClose, onDone, onFailed }: {
  api: Api; block: EncodedYear; onClose: () => void; onDone: (text: string) => void; onFailed: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Confirm
      title={`Remove ${schoolYearLabel(block.start_year)} from the permanent record?`}
      confirmLabel="Remove this school year"
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        try {
          await api(`/prior-years/${block.id}/removal`, 'POST', { version: block.version, reason: reason.trim() });
          onDone(`${schoolYearLabel(block.start_year)} removed from the permanent record.`);
        } catch (error) { onFailed(message(error)); } finally { setBusy(false); }
      }}
      body={
        <>
          <p>
            {gradeName(block.grade_level)} at {block.school_name}, with {block.subjects.length === 1 ? 'one learning area' : `${block.subjects.length} learning areas`}.
            It stops printing on this learner’s SF10. What it said is kept in the journal, but the block itself has to be typed again from the document to come back.
          </p>
          <label className="label" htmlFor="remove-reason">Reason for removing it</label>
          <textarea id="remove-reason" value={reason} minLength={10} maxLength={500} onChange={event => setReason(event.target.value)} />
        </>
      }
    />
  );
}
