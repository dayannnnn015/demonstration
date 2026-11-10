import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { ApiError, message, query } from '../api';
import type { Route } from '../routes';
import { Icon } from '../components/icons';
import { IdentityHistory, IdentitySheet, ReviewActions } from './Reviews';
import { LearnerRecord } from './LearnerRecord';
import { LearnerDetail } from './LearnerProfile';
import { Sf10Dialog, Sf9Dialog } from './FormDialogs';
import {
  Badge, Callout, Cell, EmptyState, Finder, FormSheet, PageHeader, Pager, idle, localToday, yearName,
  Table, Task, Unrecorded, gradeName, learnerName, sentence, value, type Field, type Status,
} from '../components/primitives';
import { profileFields } from '../record-fields';
import { MyClassSheet } from './MyClass';
import { addressAsks } from '../components/scope';

// The API takes exactly these keys, so the form must not send anything else.

/**
 * Where a learner sits in the active school year, as `GET /learners` reports it
 * beside each row. Null when they hold no valid enrolment this year, and also
 * when the caller may not read the one they hold — row security decides that,
 * so a teacher sees a placement only for the sections they advise.
 */
type Placement = { enrollment_id: string; academic_year_id: string; grade_level: number; section_id: string | null; section_name: string | null; status: string };
const placementOf = (row: Row): Placement | null => (row.placement as Placement | null) ?? null;

/** Read-only Section 2A registry. The API decides what each staff member may see. */
export function Learners({ api, me, manager, setStatus, reload, token, route }: {
  api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route;
}) {
  const [rows, setRows] = useState<Page | null>(null);
  const blank = { search: '', birth_date: '', sex: '', grade_level: '', section_id: '' };
  // A notification about a class opens the registry on that class (the UI notes of 8 November, note 5). Only a class
  // ever travels in the address, never a learner, and row security decides what it shows.
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const section = addressAsks().get('section');
    return section && /^[0-9a-f-]{36}$/i.test(section) ? { ...blank, section_id: section } : blank;
  });
  const [offset, setOffset] = useState(0);
  const [years, setYears] = useState<Row[]>([]);
  const [sections, setSections] = useState<Row[]>([]);
  const [adding, setAdding] = useState(false);
  // An adviser takes learners into a class they advise (0.90.0).
  const [taking, setTaking] = useState(false);
  const [distinct, setDistinct] = useState('');
  const [linked, setLinked] = useState(false);
  const [identity, setIdentity] = useState<{ learner: Row; action: 'link' | 'unlink' } | null>(null);
  const [viewing, setViewing] = useState<{ learner: Row; enrollment: Row } | null>(null);
  const [form, setForm] = useState<{ kind: 'sf9'; learner: Row; enrollment: Row } | { kind: 'sf10'; learner: Row } | null>(null);

  useEffect(() => {
    setRows(null);
    void api<Page>(`/learners${query({ ...filters, include_linked: linked ? 'true' : undefined, limit: 25, offset })}`).then(setRows).catch(() => setRows({ items: [] }));
  }, [api, filters, linked, offset, token]);

  useEffect(() => {
    void api<Page>('/academic-years').then(r => setYears(r.items)).catch(() => setYears([]));
    void (async () => {
      const all: Row[] = [];
      for (let skip = 0; ; skip += 100) {
        const result = await api<Page>(`/sections${query({ limit: 100, offset: skip })}`);
        all.push(...result.items);
        if (!result.pagination?.has_more) break;
      }
      setSections(all);
    })().catch(() => setSections([]));
  }, [api, token]);

  // The SF9 and SF10 open from the registry row itself, from the group leader's notes of 9 October:
  // the forms belong with the learner, not on screens of their own.
  const openSf9 = async (learner: Row) => {
    try {
      const result = await api<Page>(`/enrollments${query({ learner_id: String(learner.id), limit: 100 })}`);
      const valid = result.items.filter(e => e.record_state !== 'voided');
      const active = years.find(y => y.status === 'active');
      const startOf = (e: Row) => Number(years.find(y => y.id === e.academic_year_id)?.start_year ?? 0);
      const pick = valid.find(e => e.academic_year_id === active?.id) ?? [...valid].sort((a, b) => startOf(b) - startOf(a))[0];
      if (!pick) { setStatus({ kind: 'error', text: `${learnerName(learner)} has no enrollment yet, so there is no report card to open.` }); return; }
      setForm({ kind: 'sf9', learner, enrollment: pick });
    } catch (error) { setStatus({ kind: 'error', text: message(error) }); }
  };
  const yearLabel = (id: unknown) => { const y = years.find(r => r.id === id); return y ? `${y.start_year}–${Number(y.start_year) + 1}` : 'Unavailable year'; };
  const sectionLabel = (id: unknown) => String(sections.find(r => r.id === id)?.name ?? 'Unavailable section');
  // The year a registration enrols into. At most one may be active at a time.
  const activeYear = years.find(y => y.status === 'active');
  // The classes the Class filter offers: this year's, and for an adviser only their own (the UI notes of 8 November,
  // note 10). An adviser with one class has nothing to choose between, so the filter appears from two. Row security
  // is what keeps a colleague's class empty for them; this list only keeps it out of the way.
  const classes = sections
    .filter(x => activeYear && x.academic_year_id === activeYear.id && (manager || x.adviser_user_id === me.user_id))
    .filter(x => !manager || !filters.grade_level || String(x.grade_level) === filters.grade_level)
    .sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || String(a.name).localeCompare(String(b.name)));
  const offerClasses = manager ? classes.length > 0 : classes.length > 1;
  const className = (x: Row) => `${gradeName(Number(x.grade_level))} · ${String(x.name)}`;
  const searching = Object.values(filters).some(Boolean);
  const found = rows?.items.length ?? 0;

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {manager
            ? <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Register a learner</button>
            : <button type="button" className="btn" onClick={() => setTaking(true)}><Icon name="enter" size={15} />Add learner</button>}
        </>}
      />

      {manager
        ? null
        : <Callout tone="info" title="You see your own learners">
            Only the learners enrolled in the sections you advise, in an open school year. <b>Add learner</b> takes in a learner the office has already
            registered, or sends a child the school has never held to the office for approval. Correcting a learner’s details stays with a principal or administrative officer.
          </Callout>}

      {taking ? (
        <MyClassSheet
          api={api}
          onClose={written => { setTaking(false); if (written) reload(); }}
          onDone={text => { setStatus({ text, kind: 'done' }); reload(); }}
        />
      ) : null}

      <div className="card">
        <div className="card-tools">
          <Finder
            initial={filters}
            onApply={next => { setFilters(next); setOffset(0); }}
            onFieldChange={(key, next, values) => {
              // Both choose from a list, so they apply at once, as the grade always has.
              // A class of another grade is dropped when the grade changes, so the two never contradict each other.
              if (key === 'grade_level') {
                const keep = sections.some(x => String(x.id) === values.section_id && (!next || String(x.grade_level) === next));
                const adjusted = { ...values, section_id: keep ? values.section_id ?? '' : '' };
                setFilters(adjusted); setOffset(0);
                return adjusted;
              }
              if (key === 'section_id') { setFilters(values); setOffset(0); }
              return undefined;
            }}
            onClear={() => { setFilters(blank); setOffset(0); }}
            fields={[
              { key: 'search', label: 'Name or LRN', optional: true, minLength: 2, maxLength: 100, hint: 'At least two characters.' },
              { key: 'birth_date', label: 'Birth date', type: 'date', optional: true },
              { key: 'sex', label: 'Sex', optional: true, options: [['', 'Any'], ['female', 'Female'], ['male', 'Male']] },
              // Grade is a property of an enrolment, not of a learner, so this
              // asks for anyone enrolled at that grade *in the active school
              // year* — the same year the Grade column shows. It used to match
              // any year, so a promoted learner answered to their old grade
              // while their row showed the new one.
              //
              // Managers only, and not because the API needs the help: an
              // adviser already reads only the learners in the classes they
              // advise, so the filter could only narrow their own class, and
              // offering grades they do not teach invites the reading that the
              // registry is withholding learners from them. Row security is
              // what enforces the scope — `can_read_learner` — and
              // `tests/registry-grade-filter.test.ts` proves a teacher cannot
              // widen it with this parameter.
              ...(manager ? [{ key: 'grade_level', label: 'Grade level this year', optional: true, hint: 'Their grade in the active school year.',
                options: [['', 'Any grade'] as [string, string], ...[0, 1, 2, 3, 4, 5, 6].map(g => [String(g), gradeName(g)] as [string, string])] }] satisfies Field[] : []),
              ...(offerClasses ? [{ key: 'section_id', label: 'Class', optional: true,
                hint: manager ? 'One class this school year.' : 'One of the classes you advise.',
                options: [['', manager ? 'Any class' : 'All my classes'] as [string, string], ...classes.map(x => [String(x.id), className(x)] as [string, string])] }] satisfies Field[] : []),
            ]}
          />
          {manager ? (
            // A child registered twice is kept as a duplicate entry pointing at the record that counts. "Linked into
            // another" was the system's word for it (the UI notes of 8 November, note 5).
            <label className="check-line" title="A child registered twice: the extra entry is kept, pointing at the record that counts.">
              <input type="checkbox" checked={linked} onChange={event => { setLinked(event.target.checked); setOffset(0); }} />
              <span>Show duplicate entries</span>
            </label>
          ) : null}
        </div>
        <Table
          // Each learner a block on a phone, so an opened profile is as wide as the screen rather than the table.
          stack
          loading={rows === null}
          rows={rows?.items ?? []}
          rowKey={r => String(r.id)}
          empty={searching
            ? <EmptyState title="No learners match" body="Try a shorter name, or clear the search to see everyone you have access to." />
            : manager
              ? <EmptyState title="The registry is empty" body="Register the first learner, then enrol them into a section." />
              // An adviser reads only their own classes, so an empty table here says
              // nothing about the school's registry — and saying "none assigned" and
              // stopping sent advisers away believing there was nobody to take in. The
              // learners the office registered at this grade with no class yet are
              // waiting behind Add learner, so the empty state points at it.
              : <EmptyState
                  title="No learners in your classes yet"
                  body="You see the learners enrolled in the sections you advise. Learners the office has already registered at your class’s grade, with no class yet, are waiting under Add learner."
                  action={<button type="button" className="btn" onClick={() => setTaking(true)}><Icon name="enter" size={15} />Add learner</button>}
                />}
          columns={[
            {
              header: 'Learner',
              cell: r => <Cell
                title={<>{learnerName(r)}{r.merged_into ? <> <Badge tone="info">Duplicate entry</Badge></> : null}</>}
                // An LRN the school has not been issued yet is a gap in the
                // record, not a value someone left out.
                meta={r.lrn == null ? <Unrecorded label="LRN missing" /> : `LRN ${value(r, 'lrn')}`}
              />,
            },
            {
              // Grade and section come from the learner's enrolment in the active
              // school year, the only place a grade exists. A learner holding none
              // is not a learner in "Grade nothing": the absence is drawn, not blank.
              header: 'Grade',
              cell: r => { const p = placementOf(r); return p ? gradeName(p.grade_level) : <Unrecorded label="Not enrolled this year" />; },
            },
            {
              // Three different things, and the interface says which: in a
              // class, enrolled at a grade with no class yet, or not enrolled
              // at all. Only the last is an absent record; the middle one is a
              // step of the school's own work that has not happened.
              header: 'Section',
              cell: r => {
                const p = placementOf(r);
                if (!p) return <Unrecorded label="Not enrolled this year" />;
                return p.section_name ?? <Badge tone="attention">No section yet</Badge>;
              },
            },
            { header: 'Birth date', cell: r => <span className="mono">{value(r, 'birth_date')}</span> },
            { header: 'Sex', cell: r => sentence(value(r, 'sex')) },
            {
              header: 'School forms',
              cell: r => (r.merged_into ? <span className="muted">On the kept record</span> : (
                <span className="row-actions">
                  {/* Outlined with a page icon, so they read as something to open at first sight (the group's note, 28 October). */}
                  <button type="button" className="btn secondary small form-open" aria-label={`SF9 report card of ${learnerName(r)}`} onClick={() => void openSf9(r)}><Icon name="form" size={14} />SF9</button>
                  {/* The SF10 begins when a learner enters Grade 1: the form has no
                      scholastic block for Kinder, and a Kinder learner's records are
                      the SF5-K and the ECCD checklist. The API refuses it either way;
                      the row says so rather than offering a form that cannot exist. */}
                  {placementOf(r)?.grade_level === 0
                    ? <span className="muted">SF10 begins at Grade 1</span>
                    : <button type="button" className="btn secondary small form-open" aria-label={`SF10 permanent record of ${learnerName(r)}`} onClick={() => setForm({ kind: 'sf10', learner: r })}><Icon name="form" size={14} />SF10</button>}
                </span>
              )),
            },
          ]}
          actionsLabel="Record"
          detailLabel="Open"
          detail={row => {
            const id = String(row.id);
            if (manager && row.merged_into) {
              return (
                <>
                  <Callout tone="info" title="A duplicate entry">
                    The same child was registered twice. This entry is kept as it was, pointing at the record that counts, and cannot be edited, given an LRN or
                    enrolled. Everything about the child is on the other record.
                  </Callout>
                  <ReviewActions>
                    <button type="button" className="btn secondary" onClick={() => setIdentity({ learner: row, action: 'unlink' })}>Reverse this link</button>
                  </ReviewActions>
                  <Task title="Identity links" note="Newest first"><IdentityHistory api={api} learnerId={id} /></Task>
                </>
              );
            }
            return (
              <LearnerDetail
                api={api}
                learner={row}
                manager={manager}
                setStatus={setStatus}
                reload={reload}
                yearLabel={yearLabel}
                sectionLabel={sectionLabel}
                onIdentity={() => setIdentity({ learner: row, action: 'link' })}
                onView={enrollment => setViewing({ learner: row, enrollment })}
                onSf9={enrollment => setForm({ kind: 'sf9', learner: row, enrollment })}
              />
            );
          }}
        />
        <Pager offset={offset} count={found} hasMore={Boolean(rows?.pagination?.has_more)} onChange={setOffset} />
      </div>

      {viewing ? (
        <LearnerRecord
          api={api}
          me={me}
          learner={viewing.learner}
          enrollment={viewing.enrollment}
          yearLabel={yearLabel(viewing.enrollment.academic_year_id)}
          sectionLabel={sectionLabel(viewing.enrollment.section_id)}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {form?.kind === 'sf9' ? <Sf9Dialog api={api} me={me} learner={form.learner} enrollment={form.enrollment} onClose={() => setForm(null)} /> : null}
      {form?.kind === 'sf10' ? <Sf10Dialog api={api} me={me} learner={form.learner} onClose={() => setForm(null)} /> : null}

      {identity ? (
        <IdentitySheet
          api={api}
          learner={identity.learner}
          action={identity.action}
          onClose={() => setIdentity(null)}
          onDone={text => { setIdentity(null); setStatus({ text, kind: 'done' }); reload(); }}
        />
      ) : null}

      {adding ? (
        <FormSheet
          title="Register a learner"
          note={activeYear
            ? `One permanent record per child, carried across every school year. Giving a grade also enrols them for ${yearName(activeYear)} at that grade, with no section: which class they join is assigned afterwards.`
            : 'One permanent record per child, carried across every school year. No school year is active, so this registers the profile only.'}
          submitLabel="Register learner"
          fields={[
            ...profileFields,
            { key: 'lrn', label: 'LRN', pattern: '[0-9 -]{12,20}', maxLength: 20, hint: 'All twelve digits, as the school’s LIS shows it. Every new learner needs one; EDUNEXUS never invents it.' },
            ...(activeYear ? [{
              key: 'grade_level', label: 'Enrol at grade', optional: true,
              hint: 'Optional. Leave it unset to record the profile alone and enrol them later.',
              options: [['', 'Not yet — register the profile only'] as [string, string],
                ...[0, 1, 2, 3, 4, 5, 6].map(g => [String(g), gradeName(g)] as [string, string])],
            } as Field] : []),
          ]}
          onSubmit={async data => {
            await possibleDuplicate(api, data, distinct, setDistinct);
            const { grade_level: grade, ...profile } = data;
            const learner = await api<Row>('/learners', 'POST', profile);
            // The profile is the record that matters; the enrolment is a second
            // request so a refusal on it cannot lose the learner just registered.
            if (grade !== undefined && String(grade) !== '' && activeYear) {
              // A plain calendar date, never a timestamp: the API answers with
              // YYYY-MM-DD, and slicing keeps that true even if a caller ever
              // hands back an ISO instant, which would be refused by the field.
              const starts = String(activeYear.starts_on).slice(0, 10), today = localToday();
              await api('/enrollments', 'POST', {
                learner_id: String(learner.id), academic_year_id: String(activeYear.id),
                grade_level: Number(grade), enrolled_on: today < starts ? starts : today,
              });
            }
            return learner;
          }}
          onSaved={() => { setAdding(false); reload(); setStatus({ text: 'Learner registered.', kind: 'done' }); }}
          onClose={() => { setAdding(false); setDistinct(''); }}
        />
      ) : null}
    </>
  );
}

/**
 * The same surname and birth date already on file usually means the same child,
 * registered again because a search missed them, so the registry's own search
 * runs first, as the late-learner sheet's does. A match is said beside the
 * name; pressing Register learner again with the same details records a
 * different child. Recording that search writes the usual access row.
 */
export async function possibleDuplicate(api: Api, data: Record<string, unknown>, distinct: string, setDistinct: (key: string) => void) {
  const last = String(data.last_name ?? ''), born = String(data.birth_date ?? '');
  const key = [last, data.first_name, born].join('|').toLowerCase();
  if (key === distinct || last.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(born)) return;
  let found: Row[] = [];
  try { found = (await api<Page>(`/learners${query({ search: last, birth_date: born, limit: 5 })}`)).items; } catch { return; }
  if (!found.length) return;
  setDistinct(key);
  const names = found.map(row => `${learnerName(row)}${row.lrn ? ` (LRN ${String(row.lrn)})` : ''}`).join('; ');
  throw new ApiError(409, 'POSSIBLE_DUPLICATE', 'This child may already be in the registry.', [{ path: 'last_name', message: `Already in the registry with this surname and birth date: ${names}. Open them from the search instead. If this is a different child, press Register learner again.` }]);
}
