import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message, query } from '../api';
import { Cell, EmptyState, Table, Unrecorded } from '../components/primitives';

/**
 * Two things School profile was missing, both built only from what EDUNEXUS
 * already holds. No new field, and nothing about DepEd policy is decided here.
 */

const headingFields = [
  ['region', 'Region'], ['division', 'Schools division'], ['district', 'District'],
] as const;

/** "Region and District", "Region, Schools division and District". */
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * What the forms will actually print at their head, from the values on file.
 *
 * Worth a card of its own because **the forms omit what is unset rather than
 * marking it**: every heading line is written `{s.region ? <p>…</p> : null}`,
 * so a missing division simply is not there, and the only way to find out used
 * to be to print an SF9 and look. This shows the same block with the gaps
 * named, which is the workspace's own rule — a missing record is drawn, never
 * blanked.
 *
 * It is deliberately **not** inside `.paper`: that carries the printed sheet's
 * fixed widths and its own light colours, and this is a panel on a screen that
 * has a dark theme. So it is built from tokens like the rest of the workspace.
 */
export function FormHeadingPreview({ school }: { school: Row }) {
  const text = (key: string) => {
    const value = school[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const missing = headingFields.filter(([key]) => !text(key)).map(([, label]) => label);
  const head = text('school_head_name');
  const position = text('school_head_position');

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>How this prints on the forms</h2>
          <p className="card-note">The heading the SF2, SF4, SF9 and SF10 share. Each form adds its own title and school year below it.</p>
        </div>
      </div>
      <div className="card-body">
        <div className="heading-preview">
          <p>Republic of the Philippines</p>
          <p>Department of Education</p>
          {headingFields.map(([key, label]) => (
            <p key={key}>{text(key) ?? <Unrecorded label={`${label} not set`} />}</p>
          ))}
          <p className="heading-school">{String(school.name ?? '').toUpperCase()}</p>
          <p>{text('school_code') ? `School ID ${text('school_code')}` : <Unrecorded label="School ID not set" />}</p>
        </div>
        <p className="card-note">
          {missing.length === 0
            ? 'Every line of the heading is set.'
            : `${list(missing)} ${missing.length === 1 ? 'is' : 'are'} not set, so ${missing.length === 1 ? 'that line is' : 'those lines are'} left out of the heading rather than printed blank.`}
        </p>
        <p className="card-note">
          {head
            ? <>Forms sign off as <b>{head}</b>{position ? `, ${position}` : ', with no position printed under the name'}.</>
            : <>The school head is not set, so the signature line on every form prints with nothing over it.</>}
        </p>
      </div>
    </div>
  );
}

type Event = {
  id: string; occurred_at: string; actor_user_id: string | null;
  operation: string; changed_fields: string[] | null;
};

/**
 * Who changed the school's details, and when.
 *
 * The rows have been written since `0001` — `audit_record` is on
 * `school_profile` like every other versioned table — but the audit read could
 * only be asked for *everything*, so this journal existed and no screen could
 * show it. `GET /audit-events?entity_table=school_profile` is that read, and it
 * stays manager-only exactly as the whole audit always was.
 *
 * It matters more here than it looks: these fields print at the head of every
 * official form the school issues, so "when did the division change, and who
 * changed it" is a question about documents already in parents' hands.
 */
export function SchoolHistory({ api, token }: { api: Api; token: number }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api<Page<Event>>(`/audit-events${query({ entity_table: 'school_profile', limit: 10 })}`)
      .then(page => { if (live) setRows(page.items); })
      .catch(error => { if (live) { setRows([]); setFailed(message(error)); } });
    // Names, so a change reads as a person rather than an identifier. A failure
    // here leaves the history readable with the actor unnamed.
    void api<Page<{ user_id: string; display_name: string }>>('/staff?limit=100')
      .then(page => { if (live) setNames(new Map(page.items.map(s => [s.user_id, s.display_name]))); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [api, token]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Change history</h2>
          <p className="card-note">Newest first. Every change to these details is kept, because every form prints them.</p>
        </div>
      </div>
      <Table
        loading={rows === null}
        rows={rows ?? []}
        rowKey={r => r.id}
        empty={<EmptyState
          title={failed ? 'History unavailable' : 'No changes recorded yet'}
          body={failed ?? 'The school’s details have not been edited since they were first recorded.'} />}
        columns={[
          {
            header: 'What changed',
            cell: r => <Cell
              title={r.changed_fields?.length
                ? list(r.changed_fields.map(f => f.replace(/_/g, ' ')))
                : r.operation === 'INSERT' ? 'First recorded' : 'No field changed'}
              meta={r.operation === 'INSERT' ? 'Created' : 'Edited'} />,
          },
          {
            header: 'By',
            cell: r => (r.actor_user_id
              ? names.get(r.actor_user_id) ?? <Unrecorded label="Account removed" />
              : <Unrecorded label="No actor recorded" />),
          },
          { header: 'When', cell: r => new Date(r.occurred_at).toLocaleString() },
        ]}
      />
    </div>
  );
}
