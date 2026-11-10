import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';
import { ROSTER_HEADER, rosterTemplateWorkbook } from '../web/csv';
import { readXlsxRows } from '../web/xlsx';

/**
 * The learner's address, and the class-list import that carries it.
 *
 * One field, and the tests are mostly about its edges rather than its happy
 * path, because this is the field that opened a gate: it is **optional**, so a
 * learner the school has no address for is recorded without one and reads as
 * unrecorded rather than blank; it is **one line**, so a pasted line break is
 * refused rather than printed into a form; it is **journalled** like every other
 * learner detail; and it is **not writable except through the two grants in
 * 0053**, since 0004 grants the learners table column by column on purpose.
 *
 * The import half asserts the thing that actually breaks over time: that the
 * Excel template the workspace generates carries exactly the columns the API
 * publishes, and that a file saved from the earlier seven-column template still
 * imports.
 */

let db: TestDatabase;
let api: TestApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const section = '00000000-0000-4000-9000-00000000000a';
const address = 'Purok 4, Balili, La Trinidad, Benguet';

const register = (body: Record<string, unknown>, token: string = tokens.officer) => api.post('/api/v1/learners', token, body);
const learner = (over: Record<string, unknown> = {}) => ({
  first_name: 'Ana', middle_name: 'Bautista', last_name: 'Reyes', sex: 'female',
  birth_date: '2017-05-02', lrn: '136170000001', ...over,
});

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Sampaguita',$3)`, [section, year2026, ids.teacher]);
});
afterAll(async () => { await db.database.close(); });

describe('the learner’s address', () => {
  it('is recorded when registering a learner, and read back on the record', async () => {
    const made = await register(learner({ address }));
    expect(made.status).toBe(201);
    expect(made.data.address).toBe(address);
    const read = await api.get(`/api/v1/learners/${String(made.data.id)}`, tokens.officer);
    expect(read.data.address).toBe(address);
  });

  it('is optional: a learner the school has no address for is registered without one, and reads as null rather than empty', async () => {
    const made = await register(learner({ lrn: '136170000002', first_name: 'Ben', last_name: 'Lacsamana', sex: 'male' }));
    expect(made.status).toBe(201);
    // Null, not ''. An address nobody wrote down is unrecorded, and the
    // interface draws that rather than printing a blank.
    expect(made.data.address).toBeNull();
  });

  it('is corrected with the version, and the correction is journalled like every other learner detail', async () => {
    const made = await register(learner({ lrn: '136170000003', first_name: 'Cris', last_name: 'Molina', sex: 'male' }));
    const id = String(made.data.id);
    const before = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.audit_events where entity_id=$1`, [id]);
    // A learner PATCH replaces the whole profile, so every field goes with it,
    // the guardian pair added by 0056 included. Sending a partial body is a 422
    // rather than a silent merge, which is what stops a form that does not know
    // about a field from clearing it.
    const saved = await api.patch(`/api/v1/learners/${id}`, tokens.officer, {
      first_name: 'Cris', middle_name: null, last_name: 'Molina', name_extension: null,
      birth_date: '2017-01-09', sex: 'male', address, guardian_name: null, guardian_contact: null, version: Number(made.data.version),
    });
    expect(saved.status).toBe(200);
    expect(saved.data.address).toBe(address);
    expect(Number(saved.data.version)).toBe(Number(made.data.version) + 1);
    const after = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.audit_events where entity_id=$1`, [id]);
    expect(Number(after[0]!.n)).toBeGreaterThan(Number(before[0]!.n));
    // The change audit names the field that changed and never copies its value.
    const [event] = await db.pg.query<{ changed_fields: string[] }>(
      `select changed_fields from edunexus.audit_events where entity_id=$1 order by id desc limit 1`, [id]);
    expect(event!.changed_fields).toContain('address');

    // Cleared back to unrecorded, which is a correction like any other.
    const cleared = await api.patch(`/api/v1/learners/${id}`, tokens.officer, {
      first_name: 'Cris', middle_name: null, last_name: 'Molina', name_extension: null,
      birth_date: '2017-01-09', sex: 'male', address: null, guardian_name: null, guardian_contact: null, version: Number(saved.data.version),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.data.address).toBeNull();
  });

  it('is one line of plain text: a pasted line break or a 301st character is refused beside the field', async () => {
    const broken = await register(learner({ lrn: '136170000004', address: 'Purok 4\nBalili' }));
    expect(broken.status).toBe(422);
    expect(broken.fields.some(f => f.path === 'address')).toBe(true);
    const long = await register(learner({ lrn: '136170000005', address: 'x'.repeat(301) }));
    expect(long.status).toBe(422);
    expect(long.fields.some(f => f.path === 'address')).toBe(true);
  });

  it('is refused to an adviser, exactly as every other learner detail is', async () => {
    const made = await register(learner({ lrn: '136170000006' }), tokens.teacher);
    expect(made.status).toBe(403);
  });

  it('and the guardian pair are the only learner fields added: nothing else about a child or their family is accepted', async () => {
    // The gate stays shut for everything beyond this one line and the guardian
    // name and number that 0056 added, and the contract is strict, so a field
    // somebody adds hopefully is refused rather than silently dropped.
    //
    // `contact_number` stays on this list and is **not** `guardian_contact`:
    // the number EDUNEXUS holds is the guardian's, and the learner's own number
    // is still a field nobody has asked for. `guardian_relationship` is here
    // for the same reason — one guardian name, written as the school writes it,
    // and no relationship taxonomy invented by us.
    for (const extra of ['mother_tongue', 'religion', 'contact_number', 'barangay', 'guardian_relationship', 'guardian_email', 'guardian_address', 'second_guardian']) {
      const sent = await register(learner({ lrn: '136170000007', [extra]: 'something' }));
      expect(sent.status, extra).toBe(422);
    }
  });
});

describe('the class-list import carries it', () => {
  /** A cell holding a comma is quoted, as a spreadsheet writes it and as the workspace's own Excel reader does: an address has commas in it. */
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = (rows: string[][], header = ROSTER_HEADER) => [header, ...rows.map(r => r.map(cell).join(','))].join('\r\n') + '\r\n';
  const preview = (body: Record<string, unknown>) => api.post('/api/v1/roster-imports/preview', tokens.officer, body);
  const base = { section_id: section, enrolled_on: '2026-06-01', entry_kind: 'regular' as const };

  it('publishes the columns the workspace’s own Excel template is built from', async () => {
    const answer = await api.get('/api/v1/roster-imports/template', tokens.officer);
    expect(answer.status).toBe(200);
    expect(answer.data.format).toBe('edunexus-roster-v2');
    // The one assertion that keeps the generated template and the parser from
    // drifting apart: the workspace holds its own copy of this list, because the
    // template endpoint is manager-only and advisers prepare class lists too.
    expect(String(answer.data.csv).trim()).toBe(ROSTER_HEADER);
    const rows = await readXlsxRows((await rosterTemplateWorkbook().bytes()).buffer as ArrayBuffer, 'Class list');
    expect(rows[2]).toEqual(ROSTER_HEADER.split(','));
  });

  it('reads an address from the file and records it on the learner it creates', async () => {
    const sent = await preview({ ...base, csv: csv([['136170000101', 'Dina', '', 'Pacalso', '', '2017-04-02', 'female', address]]) });
    expect(sent.status).toBe(201);
    const rows = sent.data.rows as { profile: { address: string | null } | null }[];
    expect(rows[0]!.profile?.address).toBe(address);
    const committed = await api.post(`/api/v1/roster-imports/${String(sent.data.preview_id)}/commit`, tokens.officer,
      { ...base, csv: csv([['136170000101', 'Dina', '', 'Pacalso', '', '2017-04-02', 'female', address]]), resolutions: [], confirmed: true });
    expect(committed.status).toBe(201);
    const [row] = await db.pg.query<{ address: string | null }>(`select address from edunexus.learners where lrn=$1`, ['136170000101']);
    expect(row!.address).toBe(address);
  });

  it('still reads a file saved from the earlier template, recording those learners with no address', async () => {
    const earlier = ROSTER_HEADER.split(',').slice(0, 7).join(',');
    const sent = await preview({ ...base, csv: csv([['136170000102', 'Elmer', '', 'Bugtong', '', '2017-07-11', 'male']], earlier) });
    expect(sent.status).toBe(201);
    const rows = sent.data.rows as { profile: { address: string | null } | null }[];
    expect(rows[0]!.profile?.address).toBeNull();
  });

  it('leaves an empty address cell unrecorded rather than storing an empty line', async () => {
    const sent = await preview({ ...base, csv: csv([['136170000103', 'Fely', '', 'Awingan', '', '2017-09-20', 'female', '']]) });
    expect(sent.status).toBe(201);
    const rows = sent.data.rows as { profile: { address: string | null } | null }[];
    expect(rows[0]!.profile?.address).toBeNull();
  });

  it('refuses a header that is neither template, and names the current one', async () => {
    const sent = await preview({ ...base, csv: csv([['136170000104', 'Gina', '', 'Sacla', '', '2017-02-02', 'female', address]], 'lrn,first_name,address') });
    expect(sent.status).toBe(422);
    expect(sent.code).toBe('INVALID_CSV_HEADER');
    expect(sent.message).toContain('address');
  });

  it('refuses an address that is not one plain line, for that row, leaving the rest of the file importable', async () => {
    const sent = await preview({ ...base, csv: csv([
      ['136170000105', 'Hilda', '', 'Tabin', '', '2017-03-03', 'female', 'x'.repeat(301)],
      ['136170000106', 'Igmedio', '', 'Camsol', '', '2017-05-05', 'male', address],
    ]) });
    expect(sent.status).toBe(201);
    const issues = sent.data.issues as { row: number; field: string }[];
    expect(issues.some(i => i.row === 1 && i.field === 'address')).toBe(true);
    // Row 2 is untouched by row 1's problem, and the import as a whole simply
    // cannot be committed until row 1 is fixed.
    const rows = sent.data.rows as ({ profile: { first_name: string } | null })[];
    expect(rows[1]!.profile?.first_name).toBe('Igmedio');
    expect(sent.data.can_commit).toBe(false);
  });
});
