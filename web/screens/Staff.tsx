import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { query } from '../api';
import { actionName, fieldNames, isJournal, recordName } from '../activity';
import type { Route } from '../routes';
import { Icon } from '../components/icons';
import { InviteList } from './InviteBatch';
import {
  Badge, Callout, Cell, Editor, EmptyState, FormSheet, PageHeader, Pager, Select, Table, Task,
  Unrecorded, sentence, value, type Field, type Status, Spinner } from '../components/primitives';
import { Affects } from '../components/affects';
import { Avatar, type Look } from '../components/avatar';
import { fullPicture } from './Profile';
import { NameRequestQueue } from './ProfileRecords';
import { AssignAdvisers } from './SetupBatch';
import { Confirm } from '../components/overlay';
import { ApiError, message } from '../api';
import { gradeName, yearName } from '../components/primitives';

type Props = { api: Api; me?: Row; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

const roles: [string, string][] = [['teacher', 'Teacher'], ['administrative_officer', 'Administrative officer'], ['principal', 'Principal']];
const nameField: Field = { key: 'display_name', label: 'Full name', maxLength: 150 };
/** A reason is 10–500 characters and belongs in a box that admits a sentence. */
const reasonField: Field = { key: 'reason', label: 'Reason', type: 'textarea', minLength: 10, maxLength: 500, wide: true, hint: 'Kept in the permanent record of this change.' };
const idField: Field = { key: 'user_id', label: 'Supabase Auth user ID', pattern: '[0-9a-fA-F-]{36}', wide: true };

export function Staff({ api, me, setStatus, reload, token, route }: Props & { me: Row }) {
  const [rows, setRows] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [granting, setGranting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [years, setYears] = useState<Row[]>([]);
  const [yearId, setYearId] = useState('');
  const [sections, setSections] = useState<Row[] | null>(null);
  const year = years.find(y => String(y.id) === yearId) ?? null;
  useEffect(() => { setRows(null); void api<Page>(`/staff${query({ limit: 25, offset })}`).then(setRows).catch(() => setRows({ items: [] })); }, [api, offset, token]);
  // The years whose advisers can still change. A teacher's row opens on the active one, or else the newest draft; at the
  // end of a year next year's draft is set up beside it, so both are offered (found in the test pass, N7).
  useEffect(() => {
    void api<Page>('/academic-years').then(r => {
      const open = r.items.filter(y => y.status !== 'closed').sort((a, b) => Number(b.start_year) - Number(a.start_year));
      setYears(open);
      setYearId(current => (open.some(y => String(y.id) === current) ? current : String((open.find(y => y.status === 'active') ?? open[0])?.id ?? '')));
    }).catch(() => setYears([]));
  }, [api, token]);
  useEffect(() => {
    if (!year) { setSections([]); return; }
    setSections(null);
    void (async () => {
      const all: Row[] = [];
      for (let skip = 0; ; skip += 100) {
        const page = await api<Page>(`/sections${query({ academic_year_id: String(year.id), limit: 100, offset: skip })}`);
        all.push(...page.items);
        if (!page.pagination?.has_more) break;
      }
      setSections(all.sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || String(a.name).localeCompare(String(b.name))));
    })().catch(() => setSections([]));
  }, [api, year?.id, token]);
  const allowed = me.role === 'principal' ? roles : roles.slice(0, 1);

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {year && year.status !== 'closed' ? <button type="button" className="btn secondary" onClick={() => setAssigning(true)} data-tour="staff-assign">Assign advisers</button> : null}
          <button type="button" className="btn" onClick={() => setGranting(true)} data-tour="staff-grant"><Icon name="plus" size={15} />Grant access</button>
        </>}
      />

      <NameRequestQueue api={api} token={token} setStatus={setStatus} reload={reload} />

      <div className="card">
        <div className="card-head">
          <div>
            <h2 data-tour="staff-list">People with access</h2>
            <p className="card-note">Suspending blocks someone immediately without deleting anything they recorded.</p>
          </div>
          {years.length > 1 ? (
            <div className="card-head-actions">
              <span className="field inline">
                <label className="label" htmlFor="staff-year">Advisers for</label>
                <Select id="staff-year" value={yearId} onChange={event => setYearId(event.target.value)}>
                  {years.map(y => <option key={String(y.id)} value={String(y.id)}>{yearName(y)} ({y.status === 'active' ? 'active' : 'being set up'})</option>)}
                </Select>
              </span>
            </div>
          ) : null}
        </div>
        <Table
          loading={rows === null}
          rows={rows?.items ?? []}
          rowKey={r => String(r.user_id)}
          empty={<EmptyState title="No staff yet" body="Grant access to an account the operator already created, or request an invitation for a colleague." />}
          columns={[
            { header: 'Name', cell: r => <span className="person"><Avatar name={value(r, 'display_name')} look={r.avatar as Look | null} size="sm" /><b>{value(r, 'display_name')}</b></span> },
            { header: 'Permission level', cell: r => sentence(value(r, 'role')) },
            { header: 'Position', cell: r => (r.position ? String(r.position) : <span className="muted">Not set</span>) },
            { header: 'Access', cell: r => r.active ? <Badge tone="good">Active</Badge> : <Badge tone="stopped">Suspended</Badge> },
          ]}
          detail={row => {
            if (me.role !== 'principal' && row.role !== 'teacher') return <><StaffHead row={row} year={year} sections={sections} /><p className="muted">Only a principal can change an administrative account.</p></>;
            // The SF4 prints each adviser's position and specialization beside their section.
            const fields: Field[] = [nameField,
              { key: 'position', label: 'Position', optional: true, maxLength: 120, hint: 'As the SF4 prints it, for example Teacher III or Master Teacher II.' },
              { key: 'specialization', label: 'Major or specialization', optional: true, maxLength: 120 }];
            if (row.user_id !== me.user_id) fields.push(
              { key: 'role', label: 'Permission level', options: allowed },
              { key: 'active', label: 'Access', options: [['true', 'Active'], ['false', 'Suspended']] },
            );
            return (
              <>
                <StaffHead row={row} year={year} sections={sections} />
                {row.user_id === me.user_id ? <p className="muted">You cannot change your own permission level or access.</p> : null}
                <StaffPhoto api={api} row={row} own={row.user_id === me.user_id} setStatus={setStatus} reload={reload} />
                {row.role === 'teacher' && row.active && year && sections ? <Advises api={api} teacher={row} year={year} sections={sections} setStatus={setStatus} reload={reload} /> : null}
                <Editor fields={fields} initial={row} setStatus={setStatus} onSaved={reload} warning={<Affects what="staff" />}
                  onSubmit={data => api(`/staff/${row.user_id}`, 'PATCH', { ...data, ...('active' in data ? { active: data.active === 'true' } : {}), version: row.version })} />
              </>
            );
          }}
        />
        <Pager offset={offset} count={rows?.items.length ?? 0} hasMore={Boolean(rows?.pagination?.has_more)} onChange={setOffset} />
      </div>

      {assigning && year ? (
        <AssignAdvisers api={api} year={year} onClose={n => { setAssigning(false); if (n) { reload(); setStatus({ text: n === 1 ? '1 adviser change saved.' : `${n} adviser changes saved.`, kind: 'done' }); } }} />
      ) : null}

      {granting ? (
        <FormSheet
          title="Grant access to an existing account"
          note="For an identity the operator already created in Supabase. To start from scratch, use Invitations instead."
          submitLabel="Grant access"
          fields={[idField, nameField, { key: 'role', label: 'Permission level', options: allowed }]}
          onSubmit={data => api('/staff', 'POST', data)}
          onSaved={() => { setGranting(false); reload(); setStatus({ text: 'Access granted.', kind: 'done' }); }}
          onClose={() => setGranting(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Who a colleague is, at the top of their row (the UI notes of 8 November, note 9): their picture or initials, name,
 * permission level, position and specialization as the forms print them, the classes they advise in the year chosen
 * above, and whether their access is on. Everything here is already on the row or on the year's sections; nothing is
 * read for it, and nothing about a learner appears.
 */
function StaffHead({ row, year, sections }: { row: Row; year: Row | undefined | null; sections: Row[] | null | undefined }) {
  const look = row.avatar as Look | null;
  const position = [row.position, row.specialization].filter(Boolean).map(String).join(' · ');
  const advises = (sections ?? []).filter(x => x.adviser_user_id === row.user_id)
    .sort((a, b) => Number(a.grade_level) - Number(b.grade_level) || String(a.name).localeCompare(String(b.name)));
  return (
    <div className="staff-head">
      <Avatar name={value(row, 'display_name')} look={look} size="lg" />
      <div className="staff-head-text">
        <b>{value(row, 'display_name')}</b>
        <span>{sentence(value(row, 'role'))}{position ? ` · ${position}` : null}{position ? null : <> · <Unrecorded label="Position not set" /></>}</span>
        {row.role === 'teacher' ? (
          <span>{advises.length
            ? <>Adviser of {advises.map(x => `${gradeName(Number(x.grade_level))} · ${String(x.name)}`).join(', ')}{year ? ` in ${yearName(year)}` : ''}</>
            : <>Advises no class{year ? ` in ${yearName(year)}` : ''}</>}</span>
        ) : null}
      </div>
      {row.active ? <Badge tone="good">Access active</Badge> : <Badge tone="stopped">Access suspended</Badge>}
    </div>
  );
}

/**
 * A colleague's photo, as their manager sees it, and the way to take it down
 * when it should not be there. The person changes their own on My profile.
 */
function StaffPhoto({ api, row, own, setStatus, reload }: { api: Api; row: Row; own: boolean; setStatus: (s: Status) => void; reload: () => void }) {
  const look = row.avatar as (Look & { version?: number; photo?: { sha256: string; thumb: string } | null }) | null;
  const [full, setFull] = useState<{ sha256: string; base64: string } | null>(null);
  const [taking, setTaking] = useState(false);
  const sha = look?.photo?.sha256;
  useEffect(() => {
    if (!sha) return;
    void fullPicture(api, String(row.user_id), sha).then(setFull);
  }, [sha]);
  if (!look?.photo) return null;
  return (
    <div className="staff-photo">
      <Avatar name={value(row, 'display_name')} look={look} size="lg" image={full} label={`Photo of ${value(row, 'display_name')}`} />
      <div>
        <p className="muted">{own ? 'Your photo. Change or remove it on My profile.' : 'Uploaded by this person. Take it down if it is not a suitable picture of them; they can upload another.'}</p>
        {own ? null : <button type="button" className="btn secondary small" onClick={() => setTaking(true)}>Take down photo</button>}
      </div>
      {taking ? (
        <FormSheet
          title="Take down this photo"
          note={`It is deleted for good, and ${value(row, 'display_name')} shows by their initials until they upload another.`}
          submitLabel="Take down photo"
          fields={[reasonField]}
          onSubmit={data => api(`/staff/${String(row.user_id)}/photo/remove`, 'POST', { version: Number(look.version ?? 0), reason: data.reason })}
          onSaved={() => { setTaking(false); reload(); setStatus({ text: 'The photo was taken down and deleted.', kind: 'done' }); }}
          onClose={() => setTaking(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The sections a teacher advises, set from their own row (decision D2a: the
 * group asked for the adviser to be chosen on the person, not on a separate
 * screen). Each change is the same versioned section update the one-table
 * assignment sends; taking a section from another adviser says so first.
 */
function Advises({ api, teacher, year, sections, setStatus, reload }: { api: Api; teacher: Row; year: Row; sections: Row[]; setStatus: (s: Status) => void; reload: () => void }) {
  const id = String(teacher.user_id);
  const mine = sections.filter(s => s.adviser_user_id === id).map(s => String(s.id));
  const [chosen, setChosen] = useState<string[]>(mine);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { setChosen(sections.filter(s => s.adviser_user_id === id).map(s => String(s.id))); }, [sections, id]);
  const closed = year.status === 'closed';
  const add = sections.filter(s => chosen.includes(String(s.id)) && s.adviser_user_id !== id);
  const release = sections.filter(s => !chosen.includes(String(s.id)) && s.adviser_user_id === id);
  const taken = add.filter(s => s.adviser_user_id);
  const named = (s: Row) => `${gradeName(s.grade_level)} · ${String(s.name)}`;
  const save = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const s of [...release, ...add]) {
        await api(`/sections/${String(s.id)}`, 'PATCH', { version: s.version, adviser_user_id: add.includes(s) ? id : null });
        done++;
      }
      setAsking(false);
      setStatus({ kind: 'done', text: `${String(teacher.display_name)} advises ${chosen.length ? chosen.map(c => named(sections.find(s => String(s.id) === c)!)).join(', ') : 'no section'} in ${yearName(year)}.` });
      reload();
    } catch (error) {
      setAsking(false);
      setStatus({ kind: 'error', text: `${done ? `${done} of the changes were saved before this stopped. ` : ''}${error instanceof ApiError && error.isConflict ? 'A section changed while you were choosing. It has been read again; choose again.' : message(error)}` });
      reload();
    } finally { setBusy(false); }
  };
  return (
    <div className="advises" data-tour="staff-advises">
      <h3>Advises in {yearName(year)}</h3>
      {sections.length ? (
        <>
          <div className="advises-grid" role="group" aria-label={`Sections ${String(teacher.display_name)} advises`}>
            {sections.map(s => {
              const other = s.adviser_user_id && s.adviser_user_id !== id;
              return (
                <label key={String(s.id)} className="advises-option">
                  <input type="checkbox" disabled={closed || busy} checked={chosen.includes(String(s.id))}
                    onChange={e => setChosen(c => (e.target.checked ? [...c, String(s.id)] : c.filter(x => x !== String(s.id))))} />
                  <span>{named(s)}</span>
                  {other ? <span className="muted">advised by someone else</span> : !s.adviser_user_id ? <span className="muted">no adviser</span> : null}
                </label>
              );
            })}
          </div>
          {closed ? <p className="muted">{yearName(year)} is closed; its advisers can no longer change.</p> : (
            <div className="form-actions">
              <button type="button" className="btn" disabled={busy || (!add.length && !release.length)} aria-busy={busy} onClick={() => (taken.length ? setAsking(true) : void save())}>
                {busy ? <><Spinner />Saving…</> : 'Save sections'}
              </button>
              {add.length || release.length ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setChosen(mine)}>Undo changes</button> : null}
            </div>
          )}
        </>
      ) : <p className="muted">{yearName(year)} has no sections yet. Create them on <a href="#/years">School years &amp; sections</a>.</p>}
      {asking ? (
        <Confirm title="Move these sections to this teacher?" tone="plain" busy={busy} confirmLabel="Move and save" onClose={() => setAsking(false)} onConfirm={() => void save()}
          body={`${taken.map(named).join(', ')} ${taken.length === 1 ? 'has' : 'have'} another adviser now. Saving makes ${String(teacher.display_name)} the adviser instead, and the other adviser stops seeing ${taken.length === 1 ? 'that class' : 'those classes'} at once.`} />
      ) : null}
    </div>
  );
}

export function Invitations({ api, me, setStatus, reload, token, route }: Props) {
  // An older API omits the flag; only an explicit false hides the action.
  const canCreate = me?.account_service !== false;
  const [rows, setRows] = useState<Page | null>(null);
  const [status, setFilter] = useState('requested');
  const [asking, setAsking] = useState(false);
  const [listing, setListing] = useState(false);
  useEffect(() => { setRows(null); void api<Page>(`/staff-invitations${query({ status, limit: 50 })}`).then(setRows).catch(() => setRows({ items: [] })); }, [api, status, token]);

  return (
    <>
      <PageHeader
        route={route}
        actions={<>
          {me ? <button type="button" className="btn secondary" onClick={() => setListing(true)} data-tour="invite-list"><Icon name="plus" size={15} />Request from a list</button> : null}
          <button type="button" className="btn" onClick={() => setAsking(true)}><Icon name="plus" size={15} />Request an invitation</button>
        </>}
      />

      {canCreate ? (
        <Callout tone="info" title="How an invitation works">
          Record who should get an account, then open the request and create it. Your colleague is emailed an invitation and chooses their own password.
        </Callout>
      ) : (
        <Callout tone="attention" title="Accounts are created by the operator here">
          This deployment has no account service configured, so EDUNEXUS cannot create an account itself. Record the request, ask the system operator to create the identity, then link it with the ID they give you.
        </Callout>
      )}

      <div className="card">
        <div className="card-head">
          <h2 data-tour="invite-table">Invitations</h2>
          <div className="field inline">
            <label className="label" htmlFor="invite-filter">Show</label>
            <Select id="invite-filter" value={status} onChange={e => setFilter(e.target.value)}>
              {[['requested', 'Waiting on the operator'], ['provisioned', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([key, text]) => (
                <option key={key} value={key}>{text}</option>
              ))}
            </Select>
          </div>
        </div>
        <Table
          loading={rows === null}
          rows={rows?.items ?? []}
          rowKey={r => String(r.id)}
          empty={<EmptyState title="Nothing in this state" body="Requests you record appear here until the operator creates the account." />}
          columns={[
            { header: 'Email', cell: r => <span className="mono">{value(r, 'email')}</span> },
            { header: 'Name', cell: r => <span className="person"><Avatar name={value(r, 'display_name')} look={r.avatar as Look | null} size="sm" /><b>{value(r, 'display_name')}</b></span> },
            { header: 'Permission level', cell: r => sentence(value(r, 'role')) },
            { header: 'State', cell: r => r.status === 'provisioned'
              ? <Badge tone="good">Completed</Badge>
              : r.status === 'cancelled' ? <Badge tone="neutral">Cancelled</Badge> : <Badge tone="attention">Waiting</Badge> },
          ]}
          detailLabel="Open"
          detail={row => {
            if (row.status !== 'requested') return <p className="muted">Completed and cancelled invitations are kept as a record and cannot be changed.</p>;
            return (
              <>
                {/* Three whole forms used to sit open on top of each other here,
                    so the two nobody wanted were always in the way of the one
                    they did. Each is now folded away until it is chosen. */}
                {canCreate ? (
                  <Task title="Create the account" note="Sends an invitation email">
                    <Editor submitLabel="Create the account" setStatus={setStatus} onSaved={reload}
                      fields={[{ ...reasonField, hint: 'An invitation email goes to this address and they choose their own password.' }]}
                      onSubmit={data => api(`/staff-invitations/${row.id}/identity`, 'POST', { ...data, version: row.version })} />
                  </Task>
                ) : null}
                <Task title="Link an account the operator made by hand" note="Needs the Supabase Auth user ID">
                  <Editor submitLabel="Link the account" setStatus={setStatus} onSaved={reload}
                    fields={[{ ...idField, hint: 'Only needed when the operator created the identity in Supabase by hand.' }, reasonField]}
                    onSubmit={data => api(`/staff-invitations/${row.id}/provision`, 'POST', { ...data, version: row.version })} />
                </Task>
                <Task title="Cancel this invitation" note="Kept as a record" tone="warn">
                  <Editor submitLabel="Cancel invitation" setStatus={setStatus} onSaved={reload}
                    fields={[reasonField]}
                    onSubmit={data => api(`/staff-invitations/${row.id}/cancellation`, 'POST', { ...data, version: row.version })} />
                </Task>
              </>
            );
          }}
        />
      </div>

      {listing && me ? (
        <InviteList api={api} me={me} onClose={written => {
          setListing(false);
          if (!written) return;
          reload();
          setStatus({ text: written === 1 ? '1 invitation requested.' : `${written} invitations requested.`, kind: 'done' });
        }} />
      ) : null}

      {asking ? (
        <FormSheet
          title="Request an invitation"
          note="Recorded so the request, who made it and why stay traceable."
          submitLabel="Record request"
          fields={[
            { key: 'email', label: 'School email address', type: 'email', maxLength: 254 },
            nameField,
            { key: 'role', label: 'Permission level', options: roles },
            reasonField,
          ]}
          onSubmit={data => api('/staff-invitations', 'POST', data)}
          onSaved={() => { setAsking(false); reload(); setStatus({ text: 'Invitation request recorded.', kind: 'done' }); }}
          onClose={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}

export function Activity({ api, token }: { api: Api; token: number }) {
  const [rows, setRows] = useState<Page | null>(null);
  const [before, setBefore] = useState('');
  const [staff, setStaff] = useState<Row[]>([]);
  useEffect(() => { setRows(null); void api<Page>(`/audit-events${query({ limit: 25, before_id: before })}`).then(setRows).catch(() => setRows({ items: [] })); }, [api, before, token]);
  useEffect(() => { void api<Page>(`/staff${query({ limit: 100 })}`).then(r => setStaff(r.items)).catch(() => setStaff([])); }, [api, token]);
  return (
    <div className="card">
      <div className="card-head"><div>
        <h2 data-tour="activity-list">Recorded changes</h2>
        <p className="card-note">Field names only. Values, learner names and credentials are never copied here. A reviewed change also writes its own history entry, so it appears twice.</p>
      </div></div>
      <Table
        loading={rows === null}
        rows={rows?.items ?? []}
        rowKey={r => String(r.id)}
        empty={<EmptyState title="No activity yet" body="Every change made in EDUNEXUS is recorded here automatically." />}
        columns={[
          { header: 'When', cell: r => <span className="mono">{new Date(String(r.occurred_at)).toLocaleString()}</span> },
          { header: 'Record', cell: r => <Cell title={recordName(String(r.entity_table))} meta={<code>{value(r, 'entity_table')}</code>} /> },
          { header: 'Action', cell: r => (isJournal(String(r.entity_table)) ? <Badge tone="neutral">History entry</Badge> : actionName(r)) },
          { header: 'By', cell: r => {
            const who = staff.find(s => s.user_id === r.actor_user_id);
            return who ? String(who.display_name) : <Unrecorded label="Not on the staff list" />;
          } },
          { header: 'Fields changed', cell: r => {
            const fields = fieldNames(r.changed_fields);
            return fields.length ? fields.join(', ') : <Unrecorded label="None listed" />;
          } },
        ]}
      />
      <div className="pager">
        <span>25 per page, newest first</span>
        <div className="pager-nav">
          <button type="button" className="btn secondary small" disabled={!before} onClick={() => setBefore('')}>Newest</button>
          <button type="button" className="btn secondary small" disabled={!rows?.pagination?.next_before_id} onClick={() => setBefore(String(rows!.pagination!.next_before_id))}>Older</button>
        </div>
      </div>
    </div>
  );
}
