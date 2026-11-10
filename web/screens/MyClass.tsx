import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { Api, Page } from '../api';
import { message, query } from '../api';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { BatchSheet, type Candidate } from '../components/batch';
import { clamp } from '../dates';
import { sectionName } from '../components/scope';
import {
  Badge, Callout, Cell, Select, StatusLine, Task, Unrecorded, gradeName, idle, localToday, yearName, type Status,
} from '../components/primitives';

/**
 * An adviser takes learners into a class they advise, and registers a new one
 * into it.
 *
 * Both are new to an adviser (0.90.0) and both reverse the rule that only
 * managers change learner records, so the screen is written to make the narrow
 * shape of the widening visible rather than to hide it:
 *
 * - It always names the class. An adviser with two sections chooses which, and
 *   the list is that class's grade and year — not "the registry".
 * - It says what taking a learner in will do to each one: *give them this class*
 *   when they already hold an enrolment with no class, or *enrol them here* when
 *   they hold none this year.
 * - It does not offer a learner already in somebody's class. Moving a learner
 *   between classes stays the office's, and the API refuses it.
 * - Registering says, before the form, that the registry is searched first and
 *   that a child already on it must be taken in rather than typed again. An
 *   adviser cannot search the registry, so the refusal has to be expected
 *   rather than surprising.
 */

type Section = { id: string; name: string; grade_level: number; academic_year_id: string; start_year: number; status: string; starts_on: string; ends_on: string };
type Pullable = {
  learner_id: string; lrn: string | null; first_name: string; middle_name: string | null; last_name: string;
  name_extension: string | null; sex: 'male' | 'female'; birth_date: string; address: string | null;
  enrollment_id: string | null; enrollment_version: number | null; enrolled_on: string | null; how: 'assign' | 'enrol';
};

const fullName = (p: Pullable) => `${p.last_name}, ${p.first_name}${p.name_extension ? ` ${p.name_extension}` : ''}${p.middle_name ? ` ${p.middle_name}` : ''}`;

/**
 * Why this class cannot be built yet, in the school's own words, or `null`.
 *
 * The school builds its classes only once the principal has **activated** the
 * school year (decided 2026-11-06), and the API agrees with that twice over —
 * which is the reason this is a refusal stated up front rather than one the
 * adviser discovers by clicking:
 *
 * - Giving a class to a learner the office has already registered into a year
 *   that has not begun goes through `move_enrollment`, which refuses a movement
 *   dated in the future, so every such take-in comes back `409`. That is the
 *   whole of the case the office prepares for: a year carried over from last
 *   year's outcomes holds nothing but learners with no class.
 * - Enrolling a learner who holds no enrolment that year goes through
 *   `place_enrollment`, which has **no** future-date check, so the same first
 *   day on the same sheet succeeds and writes a future-dated enrolment.
 *
 * One refusal and one silent success for the same date is worse than neither,
 * so neither is offered. Nothing is read for such a class either: the list
 * names learners, and naming one writes a `record_access_events` row.
 */
function barrier(section: Section): { title: string; body: ReactNode } | null {
  if (section.status === 'draft') return {
    title: `The ${yearName(section)} school year has not been activated yet`,
    body: <>
      Its classes are still being planned, and no learner is taken into one until it begins. A principal activates a school year
      on <b>School years &amp; sections</b>.
    </>,
  };
  if (section.status === 'closed') return {
    title: `The ${yearName(section)} school year is closed`,
    body: <>A closed year’s records cannot be changed. Choose the year the school is running.</>,
  };
  if (localToday() < section.starts_on) return {
    title: `The ${yearName(section)} school year has not started yet`,
    body: <>
      Classes begin on <span className="mono">{section.starts_on}</span>. A learner is taken into a class from a day that has come, never from one still
      ahead, so this waits until then.
    </>,
  };
  return null;
}

export function MyClassSheet({ api, onClose, onDone }: {
  api: Api;
  onClose: (written: number) => void;
  onDone: (text: string) => void;
}) {
  const id = useId();
  const [classes, setClasses] = useState<Section[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [search, setSearch] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState<{ section: Section; items: Pullable[] } | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  const [on, setOn] = useState('');
  const [beat, setBeat] = useState(0);
  const again = useCallback(() => setBeat(n => n + 1), []);

  // Only the sections this adviser advises: that is what `/sections` answers
  // for them, by row security rather than by a filter applied here. The school
  // years are read with them, because a class is only ever a class **of a
  // year**: an adviser who advises in two of them is offered the same grade and
  // name twice, `/sections` orders by `academic_year_id` — a uuid, so not
  // chronological — and the row itself says nothing about which year it is. So
  // the year is joined on here, printed in the option, sorted newest first, and
  // it is what decides whether the class can be built at all.
  useEffect(() => {
    let live = true;
    // `/academic-years` takes no pagination: a school has a handful of years.
    void Promise.all([api<Page>(`/sections${query({ limit: 100 })}`), api<Page>('/academic-years')])
      .then(([sections, years]) => {
        if (!live) return;
        const byYear = new Map(years.items.map(y => [String(y.id), y]));
        const rows = sections.items.flatMap((s): Section[] => {
          const y = byYear.get(String(s.academic_year_id));
          return y ? [{
            id: String(s.id), name: String(s.name), grade_level: Number(s.grade_level), academic_year_id: String(s.academic_year_id),
            start_year: Number(y.start_year), status: String(y.status), starts_on: String(y.starts_on), ends_on: String(y.ends_on),
          }] : [];
        }).sort((a, b) => b.start_year - a.start_year || a.grade_level - b.grade_level || a.name.localeCompare(b.name));
        setClasses(rows);
        // Open on a class that can actually be built, not on whichever uuid sorted first.
        const opening = rows.find(s => !barrier(s)) ?? rows[0];
        setSectionId(current => (rows.some(s => s.id === current) ? current : String(opening?.id ?? '')));
      })
      .catch(error => { if (live) { setClasses([]); setStatus({ kind: 'error', text: message(error) }); } });
    return () => { live = false; };
  }, [api]);

  const chosen = classes?.find(s => s.id === sectionId);
  const shut = chosen ? barrier(chosen) : null;

  useEffect(() => {
    if (!sectionId || !chosen || shut) { setAnswer(null); return; }
    let live = true;
    setAnswer(null);
    void api<{ section: Section; items: Pullable[] }>(`/sections/${sectionId}/pullable-learners${query({ ...(asked ? { search: asked } : {}), limit: 50 })}`)
      .then(a => { if (live) setAnswer(a); })
      .catch(error => { if (live) setStatus({ kind: 'error', text: message(error) }); });
    return () => { live = false; };
  }, [api, sectionId, Boolean(chosen), shut !== null, asked, beat]);

  // The first day in the class: today, kept inside the school year. Read from
  // the chosen class rather than from the list, so a class whose list is never
  // fetched still has one.
  useEffect(() => {
    if (!chosen) return;
    setOn(clamp(localToday(), chosen.starts_on, chosen.ends_on));
  }, [chosen?.id]);

  const reread = async () => {
    const a = await api<{ section: Section; items: Pullable[] }>(`/sections/${sectionId}/pullable-learners${query({ ...(asked ? { search: asked } : {}), limit: 50 })}`);
    setAnswer(a);
  };

  const candidates: Candidate[] | null = answer === null ? null : answer.items.map(p => ({
    key: p.learner_id,
    label: fullName(p),
    chosen: false,
    cells: [
      <Cell key="who" title={fullName(p)} meta={p.lrn ? <span className="mono">LRN {p.lrn}</span> : <Unrecorded label="LRN missing" />} />,
      <span key="born" className="mono">{p.birth_date}</span>,
      p.how === 'assign'
        ? <Badge key="how" tone="info">Give them this class</Badge>
        : <Badge key="how" tone="attention">Enrol them here</Badge>,
    ],
  }));

  return (
    <Sheet
      wide
      title="Add learner"
      note="Learners the office has registered, assigned to a class you advise. No learner record is created or duplicated."
      onClose={() => onClose(0)}
    >
      <StatusLine status={status} />

      <Task title="1. The class" note="One you advise">
        <div className="card-tools">
          <div className="field inline">
            <label className="label" htmlFor={`${id}-section`}>My class</label>
            <Select id={`${id}-section`} value={sectionId} onChange={event => setSectionId(event.target.value)} disabled={!classes?.length}>
              {(classes ?? []).map(s => (
                <option key={s.id} value={s.id}>{sectionName(s)} — {yearName(s)}</option>
              ))}
            </Select>
          </div>
          {chosen && !shut ? (
            <div className="field inline">
              <label className="label" htmlFor={`${id}-on`}>First day in the class</label>
              <input id={`${id}-on`} type="date" className="date-input" value={on}
                min={chosen.starts_on} max={chosen.ends_on} onChange={event => setOn(event.target.value)} />
            </div>
          ) : null}
        </div>
        {classes !== null && !classes.length ? (
          <Callout tone="info" title="You advise no class yet">
            A principal or administrative officer assigns advisers to classes on <b>Staff access</b>. Once a class is yours, its learners appear here.
          </Callout>
        ) : null}
        {shut ? <Callout tone="attention" title={shut.title}>{shut.body}</Callout> : null}
      </Task>

      {sectionId && !shut ? (
        <>
          <Task title="2. Who is waiting" note="Registered for this year, at this class’s grade, with no class yet">
            <form
              className="card-tools"
              onSubmit={event => { event.preventDefault(); setAsked(search.trim()); }}
            >
              <div className="field inline">
                <label className="label" htmlFor={`${id}-search`}>Also search the registry by name or LRN</label>
                <input id={`${id}-search`} value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
                <span className="hint">At least two characters. A search also finds a learner with no enrolment this school year, such as one returning to the school.</span>
              </div>
              <button type="submit" className="btn secondary" disabled={search.trim().length === 1}><Icon name="search" size={15} />Search</button>
              {asked ? <button type="button" className="btn ghost" onClick={() => { setSearch(''); setAsked(''); }}>Clear</button> : null}
            </form>
            <p className="muted">
              A learner already in somebody’s class is not offered here: a principal or administrative officer moves a learner between classes. Taking a learner in
              never makes a second record for them — it is the record the office already holds.
            </p>
          </Task>

          <BatchSheet
            title=""
            note=""
            reasoned={false}
            headers={['Learner', 'Born', 'What happens']}
            candidates={candidates}
            intro={null}
            empty={
              <Callout tone="info" title={asked ? 'Nobody matches that search' : 'Nobody is waiting for this class'}>
                {asked
                  ? 'Try a shorter name, or part of the LRN. Only a learner in no class, or with no enrolment this school year, can be taken in.'
                  : <>
                      This list holds only the learners the office has already registered <b>into this school year</b>, at this class’s grade, with no class yet — so
                      an empty list means either that every one of them is in a class already, or that none has been registered at this grade yet. For a school year
                      that has just begun, a principal or administrative officer carries last year’s learners over on <b>Next year’s classes</b>, or registers them
                      on <b>Learner registry</b> and <b>Roster import</b>. A learner returning to the school is found by searching their name or LRN above.
                    </>}
              </Callout>
            }
            verb={count => (count === 1 ? 'Take 1 learner into my class' : `Take ${count} learners into my class`)}
            past="In my class"
            reread={reread}
            send={async key => {
              const row = answer?.items.find(p => p.learner_id === key);
              await api(`/sections/${sectionId}/pulls`, 'POST', {
                learner_id: key, enrolled_on: on, entry_kind: 'regular',
                ...(row?.enrollment_version !== null && row?.enrollment_version !== undefined ? { version: row.enrollment_version } : {}),
              });
            }}
            onClose={written => {
              if (written) { onDone(`${written === 1 ? 'One learner' : `${written} learners`} taken into the class.`); onClose(written); }
              else onClose(0);
            }}
          />

          {/*
            Registering a child the school has never held used to happen right
            here, in one step. It no longer does: the school ruled on
            2026-11-07 that **every** learner an adviser brings in is approved
            by the office first, individually as well as in a class list. One
            learner is a one-row list, which is exactly what Roster import's
            **Add learner** already makes, so there is one workflow
            rather than a reviewed one and an unreviewed one beside it.
          */}
          <Task title="3. A learner the school has never held" note="Sent to the office for approval, like any list">
            <p className="muted">
              A child who is not on the school’s registry yet is put on a list and approved by the principal or administrative officer, exactly as a whole class
              list is — there is no longer a way to add one straight to the registry, because a learner record is theirs to create. Use <b>Add one late
              learner</b> on <a href="#/imports">Roster import</a>: it puts the child on a list of one, which you then submit.
            </p>
            <p className="muted">
              The registry is still checked when the office approves it: if a learner with the same name and birth date is already on file, the import says so
              and that learner is taken in instead — one child has one record, for their whole time at the school.
            </p>
          </Task>
        </>
      ) : null}

    </Sheet>
  );
}

