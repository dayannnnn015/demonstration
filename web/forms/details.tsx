import { useEffect, useId, useState } from 'react';
import type { Api, Row } from '../api';
import { message } from '../api';
import { Affects } from '../components/affects';
import { Sheet } from '../components/overlay';
import { Editor, FormSheet, Select, StatusLine, TableSkeleton, idle, type Status } from '../components/primitives';
import { schoolFields } from '../record-fields';

/**
 * The school's heading, edited from a form. It is the same record as School
 * profile, read fresh when opened so the save goes against the version on file,
 * and the sheet says first that every form prints it.
 */
export function SchoolDetailsSheet({ api, onClose, onSaved }: { api: Api; onClose: () => void; onSaved: () => void }) {
  const [school, setSchool] = useState<Row | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  useEffect(() => { void api<Row>('/school').then(setSchool).catch(error => setStatus({ text: message(error), kind: 'error' })); }, [api]);
  if (!school) return <Sheet title="School details" onClose={onClose}><StatusLine status={status} />{status.text ? null : <TableSkeleton columns={2} />}</Sheet>;
  return (
    <FormSheet title="School details" note="The same record as School profile." warning={<Affects what="school" />}
      submitLabel="Save details" fields={schoolFields} initial={school}
      onSubmit={data => api('/school', 'PATCH', { ...data, version: school.version })}
      onSaved={onSaved} onClose={onClose} />
  );
}

/**
 * An adviser's position and specialization, which the SF4 prints beside their
 * section. The same staff record as Staff access, one person at a time.
 */
export function StaffDetailsSheet({ api, onClose, onSaved }: { api: Api; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [staff, setStaff] = useState<Row[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [status, setStatus] = useState<Status>(idle);
  const read = () => api<{ items: Row[] }>('/staff?limit=100').then(r => setStaff(r.items.filter(s => s.active !== false))).catch(error => setStatus({ text: message(error), kind: 'error' }));
  useEffect(() => { void read(); }, [api]);
  const person = staff?.find(s => String(s.user_id) === chosen);
  return (
    <Sheet title="Positions and specializations" note="As the SF4 prints them beside each adviser, and below for staff without an advisory class." wide onClose={onClose}>
      <StatusLine status={status} />
      {staff === null ? (status.text ? null : <TableSkeleton columns={2} />) : (
        <>
          <div className="field">
            <label className="label" htmlFor={`${id}-who`}>Staff member</label>
            <Select id={`${id}-who`} value={chosen} onChange={event => setChosen(event.target.value)}>
              <option value="">Choose a person</option>
              {staff.map(s => <option key={String(s.user_id)} value={String(s.user_id)}>{String(s.display_name)}</option>)}
            </Select>
          </div>
          {person ? (
            <Editor key={`${chosen}-${String(person.version)}`} setStatus={setStatus} submitLabel="Save"
              warning={<Affects what="staff" />}
              fields={[
                { key: 'position', label: 'Position', optional: true, maxLength: 120, hint: 'As the SF4 prints it, for example Teacher III or Master Teacher II.' },
                { key: 'specialization', label: 'Major or specialization', optional: true, maxLength: 120 },
              ]}
              initial={person}
              onSubmit={data => api(`/staff/${chosen}`, 'PATCH', { ...data, version: person.version })}
              onSaved={() => { void read(); setStatus({ text: `${String(person.display_name)}’s details saved.`, kind: 'done' }); onSaved(); }} />
          ) : null}
        </>
      )}
    </Sheet>
  );
}
