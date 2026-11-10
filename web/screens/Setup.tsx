import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { Confirm, Sheet } from '../components/overlay';
import { Icon } from '../components/icons';
import {
  Badge, Button, Callout, Editor, EmptyState, FormSheet, PageHeader, Pager, Select, StatusLine, Table,
  FactsSkeleton, TableSkeleton, gradeName, idle, sentence, shown, value, yearName, type Field, type Status,
} from '../components/primitives';

import { AddSections, AssignAdvisers } from './SetupBatch';
import { deped2026, depedCalendar } from '../deped';
import { Affects } from '../components/affects';
import { schoolFields } from '../record-fields';
import { FormHeadingPreview, SchoolHistory } from './SchoolDetails';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

const dateFields: Field[] = [
  { key: 'starts_on', label: 'First day', type: 'date' },
  { key: 'ends_on', label: 'Last day', type: 'date' },
];

type Tone = 'good' | 'neutral' | 'info';
const yearTone = (status: unknown): Tone => (status === 'active' ? 'good' : status === 'closed' ? 'neutral' : 'info');


/**
 * One record, and it is the one printed at the top of every official form. It
 * is read far more often than it is changed, so the screen shows the record
 * and the edit arrives in a sheet when it is asked for.
 */
export function School({ api, me, manager, setStatus, reload, token, route }: Props) {
  const [school, setSchool] = useState<Row | null>(null);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { void api<Row>('/school').then(row => { setSchool(row); setFailed(''); }).catch(error => setFailed(message(error))); }, [api, token]);

  return (
    <>
      <PageHeader route={route} />
      <div className="card">
        <div className="card-head">
          <div>
            <h2>The school’s details</h2>
            <p className="card-note">Printed at the top of every SF2, SF4, SF9 and SF10.</p>
          </div>
          {manager && school ? (
            <div className="card-head-actions">
              <button type="button" className="btn" onClick={() => setEditing(true)} data-tour="school-edit"><Icon name="scores" size={15} />Edit details</button>
            </div>
          ) : null}
        </div>
        <div className="card-body">
          {failed && !school ? <Callout tone="stopped" title="The school’s details could not be read">{failed}</Callout>
            : !school ? <FactsSkeleton count={8} /> : (
            <dl className="facts">
              {schoolFields.map(field => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{shown(school, field.key, 'Not set')}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>


      {school ? <FormHeadingPreview school={school} /> : null}
      {manager ? <SchoolHistory api={api} token={token} /> : null}

      {editing && school ? (
        <FormSheet
          title="Edit school details"
          note="These appear at the top of SF2, SF4, SF9 and SF10."
          warning={<Affects what="school" />}
          submitLabel="Save details"
          fields={schoolFields}
          initial={school}
          onSubmit={data => api('/school', 'PATCH', { ...data, version: school.version })}
          onSaved={() => { setEditing(false); reload(); setStatus({ text: 'School details saved.', kind: 'done' }); }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}

export function SchoolYears(props: Props) {
  const { api, manager, setStatus, reload, token, route } = props;
  const [years, setYears] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [sharedYear, setSharedYear] = useState('');
  useEffect(() => { void api<Page>('/academic-years').then(r => setYears(r.items)).catch(() => setYears([])); }, [api, token]);

  return (
    <>
      <PageHeader
        route={route}
        actions={manager
          ? <button type="button" className="btn" onClick={() => setAdding(true)} data-tour="year-add"><Icon name="plus" size={15} />Add a school year</button>
          : undefined}
      />

      <div className="card">
        <Table
          loading={years === null}
          rows={years ?? []}
          rowKey={r => String(r.id)}
          empty={<EmptyState title="No school years yet" body="Every record in EDUNEXUS is filed under a school year. Create the first one, add its reporting periods, then activate it." />}
          columns={[
            { header: 'School year', cell: r => <b className="num">{yearName(r)}</b> },
            { header: 'First day', cell: r => <span className="mono">{value(r, 'starts_on')}</span> },
            { header: 'Last day', cell: r => <span className="mono">{value(r, 'ends_on')}</span> },
            { header: 'State', cell: r => <Badge tone={yearTone(r.status)}>{sentence(value(r, 'status'))}</Badge> },
          ]}
          detailLabel="Change state"
          detail={manager ? (row => {
            if (row.status === 'closed') return <p className="muted">A closed year is read-only. Reopening needs a reviewed workflow that does not exist yet.</p>;
            const next = row.status === 'draft' ? 'active' : 'closed';
            return next === 'active' ? (
              <>
                <h3>Activate {yearName(row)}</h3>
                <p className="muted">New records are entered against the active year. Only one year can be active, so activating this one stands the current year down.</p>
                <Button
                  label="Activate year"
                  variant="primary"
                  confirmTitle={`Activate ${yearName(row)}?`}
                  confirm={`Every record entered from now on is filed under ${yearName(row)}. Any other active year is stood down. Its reporting periods can no longer be edited.`}
                  confirmLabel="Activate year"
                  setStatus={setStatus}
                  onRun={async () => { await api(`/academic-years/${row.id}/status`, 'PATCH', { version: row.version, status: 'active' }); reload(); }}
                />
              </>
            ) : (
              <>
                <h3>Close {yearName(row)}</h3>
                <p className="muted">Closing locks this year&apos;s setup permanently. Nothing here reopens it.</p>
                <Button
                  label="Close year"
                  variant="danger"
                  confirmTitle={`Close ${yearName(row)}?`}
                  confirm={`Its sections, reporting periods and enrollments become read-only. Nothing in this interface reopens a closed year, and no new records can be filed under it.`}
                  confirmLabel="Close year"
                  setStatus={setStatus}
                  onRun={async () => { await api(`/academic-years/${row.id}/status`, 'PATCH', { version: row.version, status: 'closed' }); reload(); }}
                />
              </>
            );
          }) : undefined}
        />
      </div>

      {adding ? (
        <FormSheet
          title="Add a school year"
          note={years?.some(y => Number(y.start_year) === deped2026.start_year)
            ? 'Created as a draft, so its reporting periods can be set before it opens.'
            : `Created as a draft, so its reporting periods can be set before it opens. The dates are ${deped2026.source}’s for ${deped2026.start_year}–${deped2026.start_year + 1}; change them if the school’s calendar differs.`}
          initial={years?.some(y => Number(y.start_year) === deped2026.start_year) ? undefined : { start_year: deped2026.start_year, starts_on: deped2026.starts_on, ends_on: deped2026.ends_on }}
          submitLabel="Create year"
          fields={[{ key: 'start_year', label: 'Starting year', type: 'number', min: 2000, max: 2199, hint: 'Enter 2026 for the 2026–2027 school year.' }, ...dateFields]}
          onSubmit={data => api('/academic-years', 'POST', data)}
          onSaved={() => { setAdding(false); reload(); setStatus({ text: 'School year created as a draft.', kind: 'done' }); }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {/* One screen for the year, its terms and, since 0.84.0, its sections: the group leader's notes of 10 October,
          and the group's of 28 October (decision D2a), which took Sections & advisers out of the rail. One year
          picker serves both cards. */}
      <YearScoped {...props} page="Reporting periods" embedded shared={{ yearId: sharedYear, setYearId: setSharedYear }} />
      <YearScoped {...props} page="Sections" embedded shared={{ yearId: sharedYear, setYearId: setSharedYear }} />
    </>
  );
}

export function YearScoped({ api, manager, setStatus, reload, token, route, page, embedded = false, shared }: Props & { page: 'Reporting periods' | 'Sections'; embedded?: boolean;
  /** The year chosen on School years & terms, shared by its terms and its sections. */
  shared?: { yearId: string; setYearId: (id: string) => void } }) {
  const [years, setYears] = useState<Row[] | null>(null);
  const [ownYear, setOwnYear] = useState('');
  const yearId = shared ? shared.yearId : ownYear;
  const setYearId = (next: string | ((current: string) => string)) => {
    const value = typeof next === 'function' ? next(yearId) : next;
    if (shared) shared.setYearId(value); else setOwnYear(value);
  };
  const [rows, setRows] = useState<Page | null>(null);
  const [advisers, setAdvisers] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [batch, setBatch] = useState<'sections' | 'advisers' | null>(null);
  const [sheetStatus, setSheetStatus] = useState<Status>(idle);

  useEffect(() => {
    void api<Page>('/academic-years').then(r => {
      setYears(r.items);
      setYearId(current => (r.items.some(y => y.id === current) ? current : String((r.items.find(y => y.status === 'active') ?? r.items[0])?.id ?? '')));
    }).catch(() => setYears([]));
  }, [api, token]);

  useEffect(() => {
    if (!yearId) return;
    setRows(null);
    const path = page === 'Reporting periods'
      ? `/academic-years/${yearId}/periods`
      : `/sections${query({ academic_year_id: yearId, limit: 25, offset })}`;
    void api<Page>(path).then(setRows).catch(() => setRows({ items: [] }));
    if (page === 'Sections' && manager) {
      void (async () => {
        const all: Row[] = [];
        for (let skip = 0; ; skip += 100) {
          const result = await api<Page>(`/staff${query({ role: 'teacher', limit: 100, offset: skip })}`);
          all.push(...result.items.filter(r => r.active));
          if (!result.pagination?.has_more) break;
        }
        setAdvisers(all.sort((x, y) => String(x.display_name).localeCompare(String(y.display_name))));
      })().catch(() => setAdvisers([]));
    }
  }, [api, yearId, page, offset, manager, token]);

  // Inside School years the periods are a second card; that screen draws the header and the empty state.
  if (embedded && (years === null || !years.length)) return null;
  if (years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={4} /></div></>;
  if (!years.length) {
    return (
      <>
        <PageHeader route={route} />
        <div className="card">
          <EmptyState title="No school year yet" body="Reporting periods and sections belong to a school year. Create one from the School years screen first." />
        </div>
      </>
    );
  }

  const selected = years.find(y => y.id === yearId);
  if (!selected) return null;
  const draft = selected.status === 'draft';
  const open = selected.status !== 'closed';
  const periods = page === 'Reporting periods';
  const editable = manager && (periods ? draft : open);

  const periodFields: Field[] = [
    { key: 'ordinal', label: 'Order', type: 'number', min: 1, max: 12, hint: 'First period is 1.' },
    { key: 'name', label: 'Period name', maxLength: 60 },
    ...dateFields,
  ];
  const sectionFields: Field[] = [
    { key: 'name', label: 'Section name', maxLength: 80 },
  ];
  // A section's adviser is set from the teacher's row on Staff access since 0.84.0; a new section may still name one.
  const adviserField: Field = { key: 'adviser_user_id', label: 'Adviser', optional: true, hint: 'Only active staff with Teacher access can advise a section, so only they are listed. It can be changed later on Staff access.', options: [['', 'Unassigned'], ...advisers.map((r): [string, string] => [String(r.user_id), String(r.display_name)])] };

  return (
    <>
      {embedded ? null : <PageHeader
        route={route}
        actions={editable
          ? <>
              {periods ? null : <button type="button" className="btn secondary" onClick={() => setBatch('advisers')} data-tour="sections-assign">Assign advisers</button>}
              {periods ? null : <button type="button" className="btn secondary" onClick={() => setBatch('sections')} data-tour="sections-create"><Icon name="plus" size={15} />Create sections</button>}
              <button type="button" className="btn" onClick={() => { setSheetStatus(idle); setAdding(true); }}>
                <Icon name="plus" size={15} />{periods ? 'Add a period' : 'Add a section'}
              </button>
            </>
          : undefined}
      />}

      <div className="card">
        {embedded && periods ? <div className="card-head" data-tour="year-periods"><div><h2>Reporting periods</h2><p className="card-note">The terms a school year is divided into. They can be changed only while the year is a draft.</p></div></div> : null}
        {embedded && !periods ? (
          <div className="card-head" data-tour="year-sections">
            <div><h2>Sections</h2><p className="card-note">The classes of {yearName(selected)}. A section’s adviser is set on {manager ? <a href="#/staff">Staff access</a> : 'Staff access'}, from the teacher’s row.</p></div>
            {editable ? (
              <div className="card-head-actions">
                <button type="button" className="btn secondary" onClick={() => setBatch('sections')} data-tour="sections-create"><Icon name="plus" size={15} />Create sections</button>
                <button type="button" className="btn" onClick={() => { setSheetStatus(idle); setAdding(true); }}><Icon name="plus" size={15} />Add a section</button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card-head">
            <div className="field inline">
              <label className="label" htmlFor="year-scope">School year</label>
              <Select id="year-scope" value={yearId} onChange={e => { setYearId(e.target.value); setOffset(0); }}>
                {years.map(y => <option key={String(y.id)} value={String(y.id)}>{yearName(y)} — {sentence(String(y.status))}</option>)}
              </Select>
            </div>
            <div className="card-head-actions">
              <Badge tone={yearTone(selected.status)}>{sentence(value(selected, 'status'))}</Badge>
              {embedded && editable ? <button type="button" className="btn" onClick={() => { setSheetStatus(idle); setAdding(true); }}><Icon name="plus" size={15} />Add a period</button> : null}
            </div>
          </div>
        )}

        {periods ? (
          <Table
            loading={rows === null}
            rows={rows?.items ?? []}
            rowKey={r => String(r.id)}
            empty={<EmptyState title="No reporting periods" body={draft ? 'Add the periods this year is divided into. They must not overlap.' : 'This year has no reporting periods and can no longer be edited.'} />}
            columns={[
              { header: 'Order', cell: r => value(r, 'ordinal'), numeric: true },
              { header: 'Name', cell: r => <b>{value(r, 'name')}</b> },
              { header: 'First day', cell: r => <span className="mono">{value(r, 'starts_on')}</span> },
              { header: 'Last day', cell: r => <span className="mono">{value(r, 'ends_on')}</span> },
            ]}
            detail={manager && draft ? (row => (
              <Editor fields={periodFields} initial={row} setStatus={setStatus} onSaved={reload}
                onSubmit={data => api(`/reporting-periods/${row.id}`, 'PATCH', { ...data, version: row.version })} />
            )) : undefined}
          />
        ) : (
          <>
            <Table
              loading={rows === null}
              rows={rows?.items ?? []}
              rowKey={r => String(r.id)}
              empty={<EmptyState title="No sections in this year" body={open ? 'Create a section for each class, then assign its adviser.' : 'This year is closed and its sections can no longer be changed.'} />}
              columns={[
                { header: 'Grade', cell: r => gradeName(r.grade_level) },
                { header: 'Section', cell: r => <b>{value(r, 'name')}</b> },
                { header: 'Adviser', cell: r => {
                  const adviser = advisers.find(a => a.user_id === r.adviser_user_id);
                  if (adviser) return String(adviser.display_name);
                  return r.adviser_user_id ? <span className="muted">Assigned</span> : <Badge tone="attention">Unassigned</Badge>;
                } },
              ]}
              detail={manager && open ? (row => (
                <Editor fields={sectionFields} initial={row} setStatus={setStatus} onSaved={reload} warning={<Affects what="section" />}
                  onSubmit={data => api(`/sections/${row.id}`, 'PATCH', { ...data, version: row.version })} />
              )) : undefined}
            />
            <Pager offset={offset} count={rows?.items.length ?? 0} hasMore={Boolean(rows?.pagination?.has_more)} onChange={setOffset} />
          </>
        )}
      </div>

      {manager && periods && draft && rows?.items.length === 0 && depedCalendar(Number(selected.start_year)) ? (
        <DepedTerms api={api} year={selected} onDone={n => { reload(); setStatus({ text: `${n} reporting periods added.`, kind: 'done' }); }} setStatus={setStatus} />
      ) : null}

      {manager && periods && !draft ? (
        <Callout tone="info" title="This year is no longer a draft">Reporting periods can only be changed while a school year is a draft, so that dates already used by records cannot shift underneath them.</Callout>
      ) : null}

      {batch ? (() => {
        const done = (written: number, text: string) => { setBatch(null); if (!written) return; reload(); setStatus({ text, kind: 'done' }); };
        return batch === 'sections'
          ? <AddSections api={api} year={selected} onClose={n => done(n, n === 1 ? '1 section created.' : `${n} sections created.`)} />
          : <AssignAdvisers api={api} year={selected} onClose={n => done(n, n === 1 ? '1 adviser change saved.' : `${n} adviser changes saved.`)} />;
      })() : null}

      {adding ? (
        <Sheet
          title={periods ? 'Add a reporting period' : 'Add a section'}
          note={periods
            ? `Sits inside ${yearName(selected)} and must not overlap another period.`
            : `A class in ${yearName(selected)}. An adviser sees only the learners in their own sections.`}
          onClose={() => setAdding(false)}
        >
          <StatusLine status={sheetStatus} />
          {periods ? (
            <Editor
              submitLabel="Add period"
              fields={periodFields}
              initial={{ ordinal: (rows?.items.length ?? 0) + 1 }}
              setStatus={setSheetStatus}
              onSubmit={data => api(`/academic-years/${yearId}/periods`, 'POST', data)}
              onSaved={() => { setAdding(false); reload(); setStatus({ text: 'Reporting period added.', kind: 'done' }); }}
            />
          ) : (
            <Editor
              submitLabel="Add section"
              fields={[{ key: 'grade_level', label: 'Grade', type: 'number', choose: true, hint: 'Fixed once the section exists.', options: Array.from({ length: 7 }, (_, g): [string, string] => [String(g), gradeName(g)]) }, ...sectionFields, adviserField]}
              setStatus={setSheetStatus}
              onSubmit={data => api('/sections', 'POST', { ...data, academic_year_id: yearId })}
              onSaved={() => { setAdding(false); reload(); setStatus({ text: 'Section added.', kind: 'done' }); }}
            />
          )}
        </Sheet>
      ) : null}
    </>
  );
}

/** DepEd's three terms for a draft year an order covers, added one period at a time after a confirmation. */
function DepedTerms({ api, year, onDone, setStatus }: { api: Api; year: Row; onDone: (n: number) => void; setStatus: (s: Status) => void }) {
  const deped = depedCalendar(Number(year.start_year))!;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    let n = 0;
    try {
      for (const [i, term] of deped.terms.entries()) {
        await api(`/academic-years/${String(year.id)}/periods`, 'POST', { ordinal: i + 1, name: term.name, starts_on: term.starts_on, ends_on: term.ends_on });
        n++;
      }
      onDone(n);
    } catch (error) {
      setStatus({ kind: 'error', text: `${n ? `${n} of the terms were added before this stopped. ` : ''}${message(error)}` });
      if (n) onDone(n);
    } finally { setBusy(false); setAsking(false); }
  };
  return (
    <>
      <Callout tone="info" title={`DepEd’s three terms for ${yearName(year)}`}>
        {deped.source} divides this school year into {deped.terms.map(t => `${t.name} (${t.starts_on} to ${t.ends_on})`).join(', ')} for every public elementary school.{' '}
        <button type="button" className="btn small secondary" disabled={busy} onClick={() => setAsking(true)}>Add these three terms</button>
      </Callout>
      {asking ? (
        <Confirm title="Add DepEd’s three terms?" confirmLabel="Add the terms" tone="plain" busy={busy}
          body={`${yearName(year)} gets ${deped.terms.length} reporting periods with ${deped.source}’s dates. They can still be changed while the year is a draft.`}
          onConfirm={() => void add()} onClose={() => setAsking(false)} />
      ) : null}
    </>
  );
}
