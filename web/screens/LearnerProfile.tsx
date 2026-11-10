import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message, query } from '../api';
import { Icon } from '../components/icons';
import { Affects } from '../components/affects';
import { profileFields } from '../record-fields';
import { IdentityHistory, LrnCorrection, LrnHistory, ReviewActions } from './Reviews';
import {
  Badge, Callout, Cell, Editor, FormSheet, StatusLine, Table, Task, Unrecorded,
  gradeName, idle, learnerName as learnerNameOf, localToday, sentence, shown, value, type Status,
} from '../components/primitives';

/**
 * Where a learner sits in the active school year, as `GET /learners` reports it
 * beside each row. The registry owns the shape; this screen only reads it.
 */
type Placement = { enrollment_id: string; academic_year_id: string; grade_level: number; section_id: string | null; section_name: string | null; status: string };

/**
 * One learner’s report cards year by year, from
 * `GET /learners/{id}/sf9-history`. An issued SF9 is never overwritten by a
 * later grade’s: each card hangs off its own enrolment, so this is a list of
 * what has been issued rather than a list of stored documents.
 */
type CardYear = {
  enrollment_id: string; academic_year_id: string; start_year: number; grade_level: number;
  section_name: string | null; card: 'issued' | 'in_progress' | 'no_card' | 'voided';
  issuance: { id: string; serial: number; issued_at: string; data_hash: string; corrected: boolean; reason: string | null } | null;
  issued_count: number;
};

type Tab = 'profile' | 'enrollment';
/*
 * Two parts, not three. **Academic history was removed on the user's
 * instruction of 2026-11-05**, the day after it was added, and it agrees with
 * the older decision it was already being careful about: 0.90.2 took the
 * shortcut *Academic history before EDUNEXUS* out of this same panel because
 * the navigation rail already carries that screen. The signpost tab was the
 * last trace of a second door here, and it is gone too; the screen, the route
 * and every historical record are untouched.
 */
const tabs: [Tab, string][] = [['profile', 'Learner profile'], ['enrollment', 'Enrollment']];

/**
 * One learner, opened from the registry, in two parts rather than one column.
 *
 * The parts are two different questions, and deliberately not the same record:
 * the **profile** is the one permanent identity row in `learners`, and the
 * **enrollment** is the annual timeline in `enrollments`. They used to be one
 * panel, which made whichever was being looked for the hardest to find and
 * invited the reading that correcting a name was correcting a year. Academic
 * history is neither of them and is not here at all — see `tabs` above.
 *
 * **It shows only fields the record actually holds**, which is `profileFields`:
 * the name, LRN, birth date, sex, one line of address (0053) and the parent or
 * guardian with a contact number (0056). Each of the last three left the
 * learner-fields gate on a named decision, recorded in `docs/constraints.md`;
 * everything the gate still blocks — mother tongue, religion, indigenous group,
 * a relationship taxonomy, a second guardian — is named in the profile as *not
 * collected* rather than left as an empty line, because a profile is where an
 * empty line most readily reads as nothing to report.
 */
export function LearnerDetail({ api, learner, manager, setStatus, reload, yearLabel, sectionLabel, onIdentity, onView, onSf9 }: {
  api: Api; learner: Row; manager: boolean;
  setStatus: (s: Status) => void; reload: () => void;
  yearLabel: (id: unknown) => string; sectionLabel: (id: unknown) => string;
  onIdentity: () => void; onView: (enrollment: Row) => void; onSf9: (enrollment: Row) => void;
}) {
  const [tab, setTab] = useState<Tab>('profile');
  const [editing, setEditing] = useState(false);
  const id = String(learner.id);
  const placement = (learner.placement as Placement | null) ?? null;

  const initials = [learner.first_name, learner.last_name].map(part => String(part ?? '').trim().charAt(0)).join('').toUpperCase();
  return (
    <>
      {/*
        Who this is, before anything else (the UI notes of 8 November, note 9): the name, the LRN and where they are this
        year, the three things a reader opens a learner to check. Initials only: the workspace holds no photograph of a
        child, and this does not change that.
      */}
      <div className="learner-head">
        <span className="learner-mark" aria-hidden="true">{initials}</span>
        <div className="learner-head-text">
          <b>{learnerNameOf(learner)}</b>
          <span>
            {learner.lrn == null ? <Unrecorded label="LRN missing" /> : <span className="mono">LRN {value(learner, 'lrn')}</span>}
            <span aria-hidden="true"> · </span>
            {placement
              ? <>{gradeName(placement.grade_level)}{placement.section_name ? ` · ${placement.section_name}` : null} · {yearLabel(placement.academic_year_id)}{placement.section_name ? null : <> <Badge tone="attention">No section yet</Badge></>}</>
              : <Unrecorded label="Not enrolled this year" />}
          </span>
        </div>
        {manager && tab === 'profile' ? (
          <button type="button" className="btn secondary" onClick={() => setEditing(true)}>
            <Icon name="user" size={15} />Edit profile
          </button>
        ) : null}
      </div>

      <div className="segmented" role="tablist" aria-label="What to read about this learner">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'profile' ? (
        <>
          {/*
            Editing is an action, not a disclosure. It was folded inside a
            `Task` titled "Correct the details", which is where every *reviewed*
            workflow on this panel lives — and a plain correction is not one of
            those, so it read as unavailable. **Edit profile** opens a sheet
            over the panel, which is the workspace's rule for a form that
            writes a record, and the reviewed workflows stay folded below.
          */}
          <div className="fact-groups">
          <section className="fact-group" aria-labelledby={`${id}-personal`}>
          <h3 id={`${id}-personal`}>Personal information</h3>
          <dl className="facts">
            {/* An LRN the school has not been issued yet is a gap in the record, not a value someone left out. */}
            <div><dt>Learner reference number</dt><dd>{learner.lrn == null ? <Unrecorded label="LRN missing" /> : <span className="mono">{value(learner, 'lrn')}</span>}</dd></div>
            <div><dt>Last name</dt><dd>{shown(learner, 'last_name')}</dd></div>
            <div><dt>First name</dt><dd>{shown(learner, 'first_name')}</dd></div>
            <div><dt>Middle name</dt><dd>{shown(learner, 'middle_name', 'None recorded')}</dd></div>
            <div><dt>Extension</dt><dd>{shown(learner, 'name_extension', 'None')}</dd></div>
            <div><dt>Birth date</dt><dd><span className="mono">{value(learner, 'birth_date')}</span></dd></div>
            <div><dt>Sex as recorded on school forms</dt><dd>{sentence(value(learner, 'sex'))}</dd></div>
          </dl>
          </section>

          <section className="fact-group" aria-labelledby={`${id}-address`}>
          <h3 id={`${id}-address`}>Address</h3>
          <dl className="facts">
            <div><dt>Address</dt><dd>{shown(learner, 'address', 'No address recorded')}</dd></div>
          </dl>
          </section>

          {/*
            The parent or guardian, added by migration 0056 on the user's
            decision of 2026-11-05. One name and one number: there is no
            relationship field, because nothing supplied says which
            relationships the school records or how it writes them, and a list
            invented here would refuse a real family. A guardian nobody has
            written down is unrecorded — never "no guardian".
          */}
          <section className="fact-group" aria-labelledby={`${id}-guardian`}>
          <h3 id={`${id}-guardian`}>Parent or guardian</h3>
          <dl className="facts">
            <div><dt>Parent or guardian</dt><dd>{shown(learner, 'guardian_name', 'No guardian recorded')}</dd></div>
            <div><dt>Contact number</dt><dd>{learner.guardian_contact == null || learner.guardian_contact === ''
              ? <Unrecorded label="No number recorded" />
              : <span className="mono">{value(learner, 'guardian_contact')}</span>}</dd></div>
          </dl>
          </section>
          </div>

          {/* The explanations, folded: they answer a question a reader may have, and were four paragraphs between the facts. */}
          <Task title="What this record does not hold" note="And where the address and guardian print">
            <p className="muted">
              Beyond the fields above, EDUNEXUS holds nothing else about a child or their family: no mother tongue, religion or indigenous group, no second
              guardian, no relationship field, no guardian address or email, and no breakdown of the address line. These are not blank fields waiting to be
              filled in — they are not collected, and which of them the school may keep is its own answer to give, in the reviewed field list it still owes.
            </p>
            <p className="muted">
              The address is one line, as the school’s own learner information writes it, and the guardian’s number is kept exactly as recorded. Neither prints
              on a DepEd form: none of the forms the school has supplied has a box for them.
            </p>
          </Task>

          {manager ? (
            <>
              {learner.lrn == null ? (
                <Task title="Fill the official LRN" note="Recorded once, and never cleared">
                  <p className="muted">EDUNEXUS never invents an LRN. Enter it only when the school has been issued one.</p>
                  <Editor submitLabel="Assign LRN" setStatus={setStatus} onSaved={reload} warning={<Affects what="lrn" />}
                    fields={[{ key: 'lrn', label: 'Learner Reference Number', pattern: '[0-9 -]{12,20}', maxLength: 20, hint: 'Exactly twelve digits, leading zeroes included.' }]}
                    onSubmit={data => api(`/learners/${id}/lrn`, 'PATCH', { ...data, version: learner.version })} />
                </Task>
              ) : (
                <Task title="Correct the assigned LRN" note="Reviewed, and the old number kept">
                  <LrnCorrection api={api} learner={learner} setStatus={setStatus} onDone={reload} />
                  <h3>Earlier corrections</h3>
                  <LrnHistory api={api} learnerId={id} />
                </Task>
              )}
              <Task title="Identity links" note="Duplicate records of the same child">
                <p className="muted">When two registry entries are the same child, link the duplicate to the record that is kept. Both stay on file.</p>
                <ReviewActions>
                  <button type="button" className="btn secondary" onClick={onIdentity}>This is the same child as another record</button>
                </ReviewActions>
                <IdentityHistory api={api} learnerId={id} />
              </Task>
              <p className="card-note">
                <a href={`#/access?record=${id}`}>Who has opened this record</a> — the privacy access log, narrowed to this learner, including every read of their enrollments.
              </p>
            </>
          ) : (
            <Callout tone="info" title="Corrections stay with the office">
              You read the learners in the classes you advise, and the API refuses a profile correction from an adviser however this screen is reached. Correcting a
              profile, assigning an LRN or linking a duplicate record is a principal’s or an administrative officer’s, so that one spelling of a name is the school’s.
              Ask the office, naming what is wrong and what it should say.
            </Callout>
          )}
        </>
      ) : null}

      {tab === 'enrollment' ? (
        <>
          <h3>This school year</h3>
          {placement ? (
            <dl className="facts">
              <div><dt>School year</dt><dd>{yearLabel(placement.academic_year_id)}</dd></div>
              <div><dt>Grade level</dt><dd>{gradeName(placement.grade_level)}</dd></div>
              {/* Three different things, and the interface says which: in a class,
                  enrolled at a grade with no class yet, or not enrolled at all. */}
              <div><dt>Section</dt><dd>{placement.section_name ?? <Badge tone="attention">No section yet</Badge>}</dd></div>
              <div><dt>Status</dt><dd>{sentence(placement.status)}</dd></div>
            </dl>
          ) : (
            <p><Unrecorded label="Not enrolled in the active school year" /></p>
          )}
          {/*
            Taking a learner back out of the class, for an adviser who took in
            the wrong one. The school asked for it on 2026-11-07: the pull was
            built and its undo was not, so the only remedy was to ask the
            office. It returns the enrolment to having **no class** — the state
            it was pulled from — and never moves the learner to another class,
            never withdraws them and never touches their record, all of which
            remain a manager's. A manager has it too, as the quickest way to
            undo a placement.
          */}
          {placement && placement.section_id && placement.status === 'enrolled' ? (
            <ReleaseFromClass
              api={api}
              placement={placement}
              sectionLabel={sectionLabel}
              setStatus={setStatus}
              reload={reload}
            />
          ) : null}
          <EnrollmentHistory api={api} learnerId={id} manager={manager} yearLabel={yearLabel} sectionLabel={sectionLabel} onView={onView} onSf9={onSf9} />
        </>
      ) : null}

      {/*
        One record, corrected in place. `profileFields` is the same list the
        registration sheet and the SF10 edit, so a field cannot exist on one and
        not the others, and the same manager-only `PATCH /learners/:id` carries
        it: there is no second learner row and no second copy of a field
        anywhere. The version goes with it, so a competing correction is a 409
        rather than a silent overwrite.
      */}
      {editing ? (
        <FormSheet
          title="Edit profile"
          note="The one permanent record for this learner. Correcting it here is what the registry, the class list, the register and the forms read from their next read — it never creates a second record."
          submitLabel="Save profile"
          wide
          fields={profileFields}
          initial={learner}
          warning={<Affects what="learner" />}
          onSubmit={data => api(`/learners/${id}`, 'PATCH', { ...data, version: learner.version })}
          onSaved={() => { setEditing(false); reload(); setStatus({ text: 'Profile saved.', kind: 'done' }); }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}

/**
 * A learner's enrolment history, read when their row is opened.
 *
 * It used to sit behind a folded panel and a "Load enrollment records" button:
 * every enrolment returned is named in the privacy audit, so the registry must
 * not fetch them for a list nobody asked for. Opening one learner's record *is*
 * that asking — it is deliberate, it is one learner, and the access row it
 * writes says exactly that. The list itself still never loads them, which is
 * the rule that mattered; the two clicks in front of it were not.
 */
export function EnrollmentHistory({ api, learnerId, manager, yearLabel, sectionLabel, onView, onSf9 }: {
  api: Api; learnerId: string; manager: boolean;
  yearLabel: (id: unknown) => string; sectionLabel: (id: unknown) => string;
  onView: (enrollment: Row) => void; onSf9: (enrollment: Row) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cards, setCards] = useState<CardYear[] | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  useEffect(() => {
    let live = true;
    setRows(null);
    void api<Page>(`/enrollments${query({ learner_id: learnerId, limit: 100, record_state: manager ? 'all' : undefined })}`)
      .then(result => { if (live) setRows(result.items); })
      .catch(error => { if (live) { setRows([]); setStatus({ kind: 'error', text: message(error) }); } });
    return () => { live = false; };
  }, [api, learnerId, manager]);
  // The report card each year reached. A second read rather than a field on the
  // enrolment: the enrolment list is shared by five screens, and whether a form
  // was issued is not part of an enrolment record.
  useEffect(() => {
    let live = true;
    setCards(null);
    void api<{ items: CardYear[] }>(`/learners/${learnerId}/sf9-history`)
      .then(result => { if (live) setCards(result.items); })
      .catch(() => { if (live) setCards([]); });
    return () => { live = false; };
  }, [api, learnerId]);
  const cardFor = (enrollment: unknown) => cards?.find(c => c.enrollment_id === enrollment);
  return (
    <>
      <h3>School years</h3>
      <p className="muted">Every year this learner has been enrolled, and the report card it reached. An issued SF9 stays as it was issued: the next grade starts a card of its own, and neither overwrites the other. Reading them is recorded in the privacy access log.</p>
      <StatusLine status={status} />
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={r => String(r.id)}
        empty={<p className="muted">This learner has no enrollment records yet.</p>}
        columns={[
          { header: 'School year', cell: r => yearLabel(r.academic_year_id) },
          { header: 'Grade', cell: r => gradeName(r.grade_level) },
          { header: 'Section', cell: r => sectionLabel(r.section_id) },
          { header: 'Status', cell: r => sentence(value(r, 'status')) },
          { header: 'Enrolled', cell: r => <span className="mono">{value(r, 'enrolled_on')}</span> },
          { header: 'Latest change', cell: r => `${value(r, 'effective_on')} · ${sentence(value(r, 'last_reason'))}` },
          { header: 'Record', cell: r => (r.record_state === 'voided' ? <Badge tone="stopped">Voided</Badge> : <Badge tone="good">Valid</Badge>) },
          {
            // Which SF9 this year reached. Kindergarten prints none, and says so
            // rather than offering a card `sf9Get` refuses.
            header: 'Report card',
            cell: r => {
              const card = cardFor(r.id);
              if (cards === null) return <span className="muted">Reading…</span>;
              if (!card) return <Unrecorded label="Not known" />;
              if (card.card === 'voided') return <span className="muted">Not shown for a voided record</span>;
              if (card.card === 'no_card') return <Badge tone="neutral">No Kindergarten card</Badge>;
              if (card.card === 'in_progress') return <Badge tone="info">In progress</Badge>;
              return (
                <Cell
                  title={<Badge tone="good">Issued no. {card.issuance!.serial}</Badge>}
                  meta={`${card.issuance!.issued_at.slice(0, 10)}${card.issued_count > 1 ? ` · corrected; all ${card.issued_count} issues kept` : ''}`}
                />
              );
            },
          },
          {
            header: 'Attendance',
            // The SF9 here is this year's card, not the current one the registry
            // row opens, and it is the only way to reach a past year's.
            cell: r => (r.record_state === 'voided' ? <span className="muted">Not shown for a voided record</span>
              : <span className="row-actions">
                  <button type="button" className="btn ghost small" onClick={() => onView(r)}>View the year</button>
                  <button type="button" className="btn secondary small form-open" onClick={() => onSf9(r)}><Icon name="form" size={14} />SF9</button>
                </span>),
          },
        ]}
      />
    </>
  );
}

/**
 * Taking a learner back out of a class.
 *
 * The mirror of an adviser's pull, and deliberately only that: the enrolment
 * returns to having no class, which is the state it was pulled from. It never
 * moves the learner into another class, never withdraws them from school and
 * never touches their record — all three stay a manager's, and
 * `release_learner_from_section` (0062) refuses them whoever asks.
 *
 * It costs something, so it goes through `Confirm` and takes a reason that is
 * kept with the enrolment for good.
 */
function ReleaseFromClass({ api, placement, sectionLabel, setStatus, reload }: {
  api: Api; placement: Placement; sectionLabel: (id: unknown) => string;
  setStatus: (s: Status) => void; reload: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const where = placement.section_name ?? sectionLabel(placement.section_id);

  return (
    <>
      <Task title="Take out of this class" note="Returns the learner to having no class" tone="warn">
        <p className="muted">
          For a learner taken in by mistake. They stay on the registry and stay enrolled for the year at {gradeName(placement.grade_level)} — only the class is
          given back, and any adviser of that grade can take them in afterwards. Their marks, grades and history are untouched.
        </p>
        <p className="card-note">
          <button type="button" className="btn secondary" onClick={() => setAsking(true)}>
            <Icon name="back" size={15} />Take out of {where}
          </button>
        </p>
      </Task>

      {asking ? (
        <FormSheet
          title={`Take this learner out of ${where}?`}
          note="They keep their place on the registry and their enrolment for this school year. Only the class is given back, and the office is told so it can be settled."
          submitLabel="Take out of the class"
          fields={[{
            key: 'reason', label: 'Reason', type: 'textarea', wide: true, minLength: 10, maxLength: 500,
            hint: '10–500 characters on one line, kept with the enrolment for good.',
          }]}
          onSubmit={async data => {
            // The placement beside a registry row carries no version, so the
            // enrolment is read for its own: a release is a mutation like any
            // other and takes the version the caller last read, or the API
            // answers P0003 rather than overwriting a competing change.
            const held = await api<Row>(`/enrollments/${placement.enrollment_id}`);
            return api(`/enrollments/${placement.enrollment_id}/release`, 'POST', {
              version: Number(held.version), effective_on: localToday(), reason: data.reason,
            });
          }}
          onSaved={() => { setAsking(false); setStatus({ kind: 'done', text: `Taken out of ${where}. They are on the registry with no class.` }); reload(); }}
          onClose={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}
