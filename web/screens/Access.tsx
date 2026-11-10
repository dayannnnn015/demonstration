import { csvCell, downloadCsv } from '../csv';
import { useEffect, useState } from 'react';
import type { Api, Page, Row } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { Icon } from '../components/icons';
import { Callout, Cell, EmptyState, Finder, PageHeader, Table, Unrecorded, localToday, type Field, type Status } from '../components/primitives';

type Props = { api: Api; me: Row; token: number; route: Route; setStatus: (s: Status) => void };
type Filter = { actor_user_id: string; record_id: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What each logged read was, in the words of the screen that made it. The
 * table stores the operation's code; a principal answering a parent's question
 * should not have to know that `enrollmentHistory` means the movement list.
 */
const exact: Record<string, string> = {
  learnerList: 'Searched the learner registry',
  learnerGet: 'Opened a learner record',
  enrollmentList: 'Listed enrollments',
  enrollmentGet: 'Opened an enrollment',
  enrollmentHistory: 'Read an enrollment’s movements',
  lrnCorrectionHistory: 'Read LRN corrections',
  attendanceMonitor: 'Read the absence monitor',
};
const families: [string, string][] = [
  ['import', 'Roster import'],
  ['timeline', 'Enrollment timeline correction'],
  ['identity', 'Duplicate identity links'],
  ['enrollmentRecord', 'Enrollment record review'],
  ['placement', 'Grade placement correction'],
  ['calendar', 'Instructional calendar'],
  ['attendance', 'Daily attendance register'],
  ['month', 'Monthly consolidation'],
  ['followup', 'Attendance follow-up'],
  ['score', 'Assessment scores'],
];

export function describeResource(resource: string) {
  if (exact[resource]) return exact[resource]!;
  const family = families.find(([prefix]) => resource.startsWith(prefix));
  return family ? family[1] : resource;
}

/** The record filter a link from another screen asked for, as `#/access?record=<id>`. */
export function recordFromHash(hash: string) {
  const found = /[?&]record=([^&]+)/.exec(hash)?.[1];
  return found && uuid.test(found) ? found.toLowerCase() : '';
}

export { csvCell } from '../csv';

/** The log as a spreadsheet: IDs, times and plain descriptions, never a learner's name. */
export function accessCsv(rows: Row[], names: Map<string, string>) {
  const header = ['occurred_at', 'staff_member', 'staff_user_id', 'what_was_read', 'operation', 'request_id', 'record_count', 'record_ids'];
  const lines = rows.map(r => {
    const ids = Array.isArray(r.record_ids) ? r.record_ids.map(String) : [];
    return [r.occurred_at, names.get(String(r.actor_user_id)) ?? '', r.actor_user_id, describeResource(String(r.resource)), r.resource, r.request_id, ids.length, ids.join(' ')].map(csvCell).join(',');
  });
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}

/**
 * The privacy access log: every read that returned a learner or enrollment
 * record, who made it and which record IDs it returned. It shows IDs rather
 * than names on purpose — resolving a name would itself be a read of the
 * record, and a log that writes to itself on every page turn is noise.
 */
export function Access({ api, me, token, route, setStatus }: Props) {
  const [staff, setStaff] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>(() => ({ actor_user_id: '', record_id: recordFromHash(globalThis.location?.hash ?? '') }));
  const [before, setBefore] = useState('');
  const [rows, setRows] = useState<Page | null>(null);

  useEffect(() => {
    void api<Page>(`/staff${query({ limit: 100 })}`).then(page => setStaff(page.items)).catch(() => setStaff([]));
  }, [api, token]);

  useEffect(() => {
    setRows(null);
    void api<Page>(`/record-access-events${query({ limit: 25, before_id: before, actor_user_id: filter.actor_user_id, record_id: filter.record_id })}`)
      .then(setRows)
      .catch(() => setRows({ items: [] }));
  }, [api, before, filter.actor_user_id, filter.record_id, token]);

  const names = new Map(staff.map(s => [String(s.user_id), String(s.display_name)]));
  const apply = (next: Filter) => { setBefore(''); setFilter(next); };
  const fields: Field[] = [
    { key: 'actor_user_id', label: 'Staff member', optional: true, options: [['', 'Anyone'], ...staff.map(s => [String(s.user_id), String(s.display_name)] as [string, string])] },
    { key: 'record_id', label: 'Record ID', optional: true, pattern: '[0-9a-fA-F-]{36}', hint: 'A learner or enrollment ID, exactly as shown in a row below.' },
  ];
  const narrowed = Boolean(filter.actor_user_id || filter.record_id);
  const [exporting, setExporting] = useState(false);

  // Every page under the current filter, up to a bound a browser can hold. The
  // file is built here and never sent anywhere; reading the log writes nothing.
  const download = async () => {
    setExporting(true);
    setStatus({ text: 'Collecting the log…', kind: 'busy' });
    try {
      const all: Row[] = [];
      let cursor = '';
      let truncated = false;
      for (let page = 0; ; page++) {
        if (page === 50) { truncated = true; break; }
        const result = await api<Page>(`/record-access-events${query({ limit: 100, before_id: cursor, actor_user_id: filter.actor_user_id, record_id: filter.record_id })}`);
        all.push(...result.items);
        const next = result.pagination?.next_before_id;
        if (!next) break;
        cursor = String(next);
      }
      // Through downloadCsv for its byte-order mark: without one, Excel garbles a staff name with ñ.
      // Dated by the school's own day, not UTC's, which is still yesterday before 8 in the morning in the Philippines.
      downloadCsv(`${me.seeded_data ? 'SEEDED-' : ''}edunexus-access-log-${localToday()}.csv`, accessCsv(all, names));
      setStatus({ kind: 'done', text: truncated
        ? `Downloaded the newest ${all.length} reads. The log holds more; narrow it by staff member or record to get the rest.`
        : `Downloaded ${all.length} ${all.length === 1 ? 'read' : 'reads'}.` });
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        route={route}
        actions={<button type="button" className="btn secondary" disabled={exporting || !rows?.items.length} onClick={() => void download()}><Icon name="download" size={15} />{narrowed ? 'Download these reads' : 'Download the log'}</button>}
      />

      <div className="card">
        <div className="card-head"><div>
          <h2>Reads of learner records</h2>
          <p className="card-note">Record IDs only. No name, search term or profile value is copied into this log.</p>
        </div></div>
        <div className="card-tools">
        <Finder
          key={`${filter.actor_user_id}|${filter.record_id}`}
          fields={fields}
          initial={filter}
          onApply={values => apply({ actor_user_id: values.actor_user_id ?? '', record_id: (values.record_id ?? '').trim().toLowerCase() })}
          onClear={() => apply({ actor_user_id: '', record_id: '' })}
        />
        </div>
        <Table
          loading={rows === null}
          rows={rows?.items ?? []}
          rowKey={r => String(r.id)}
          empty={narrowed
            ? <EmptyState title="No reads match" body="Nobody matching this filter has opened a learner or enrollment record." />
            : <EmptyState title="No reads yet" body="Every list or record that returns a learner or enrollment is logged here automatically." />}
          columns={[
            { header: 'When', cell: r => <span className="mono">{new Date(String(r.occurred_at)).toLocaleString()}</span> },
            { header: 'Staff member', cell: r => names.get(String(r.actor_user_id))
              ? <b>{names.get(String(r.actor_user_id))}</b>
              : <Unrecorded label="Not on the staff list" /> },
            { header: 'What was read', cell: r => <Cell title={describeResource(String(r.resource))} meta={<code>{String(r.resource)}</code>} /> },
            { header: 'Records', numeric: true, cell: r => (Array.isArray(r.record_ids) ? r.record_ids.length : 0) },
          ]}
          detailLabel="Open"
          detail={row => {
            const ids = Array.isArray(row.record_ids) ? row.record_ids.map(String) : [];
            return (
              <>
                <p className="card-note">Request <span className="mono">{String(row.request_id)}</span></p>
                {ids.length ? (
                  <ul className="id-list">
                    {ids.map(id => (
                      <li key={id}>
                        <span className="mono">{id}</span>
                        {id !== filter.record_id
                          ? <button type="button" className="btn ghost small" onClick={() => apply({ actor_user_id: '', record_id: id })}>Every read of this record</button>
                          : null}
                      </li>
                    ))}
                  </ul>
                ) : <Unrecorded label="No records returned" />}
              </>
            );
          }}
        />
        <div className="pager">
          <span>25 per page, newest first</span>
          <div className="pager-nav">
            <button type="button" className="btn secondary small" disabled={!before} onClick={() => setBefore('')}>Newest</button>
            <button type="button" className="btn secondary small" disabled={!rows?.pagination?.next_before_id} onClick={() => setBefore(String(rows!.pagination!.next_before_id))}>Older</button>
          </div>
        </div>
      </div>

      <Callout tone="info" title="What this log can and cannot tell you">
        It records that a record was returned to someone, not that they read it closely, and it cannot be edited or deleted by anyone using EDUNEXUS. Counts on the Overview name nobody and so write nothing here.
      </Callout>
    </>
  );
}
