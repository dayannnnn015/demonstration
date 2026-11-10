import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The learner's parent or guardian, and their contact number (0056).
 *
 * Two fields that opened a gate, so the cases are mostly about their edges
 * rather than their happy path — the same shape as `registry-address.test.ts`,
 * for the same reason:
 *
 * - Both **optional**, so a learner the school has written no guardian for is
 *   recorded without one and reads as unrecorded, never as having none.
 * - The number is **kept exactly as recorded**. A landline with an area code, a
 *   mobile, and two numbers on one line all pass, and nothing is normalised to
 *   +63 or stripped to digits. There is **no minimum length and no leading-zero
 *   rule**, because the school's own records are the authority on how it writes
 *   a number and a stricter pattern invented here would refuse a real one.
 * - Letters in the number are refused, because a contact number is a number;
 *   a learner with none is left unrecorded rather than typed "none".
 * - Both are **journalled** like every other learner detail, and the journal
 *   names the field without copying its value — which matters more here than
 *   anywhere else on the record, since this is a third party's phone number.
 * - Both are **writable only through the grants in 0056**, since 0004 grants
 *   the learners table column by column on purpose.
 * - The gate stays shut for everything around them: no relationship field, no
 *   second guardian, no guardian email or address, and still no `contact_number`
 *   of the learner's own.
 */

let db: TestDatabase;
let api: TestApi;
const year = '00000000-0000-4000-9000-000000000001';
const section = '00000000-0000-4000-9000-00000000000a';

const register = (body: Record<string, unknown>, token: string = tokens.officer) => api.post('/api/v1/learners', token, body);
const learner = (over: Record<string, unknown> = {}) => ({
  first_name: 'Ana', middle_name: 'Bautista', last_name: 'Reyes', sex: 'female',
  birth_date: '2017-05-02', lrn: '136170000001', ...over,
});
/** A learner PATCH replaces the whole profile, so a correction sends all of it. */
const correct = (id: string, over: Record<string, unknown>, version: number, token: string = tokens.officer) =>
  api.patch(`/api/v1/learners/${id}`, token, {
    first_name: 'Ana', middle_name: 'Bautista', last_name: 'Reyes', name_extension: null,
    birth_date: '2017-05-02', sex: 'female', address: null, guardian_name: null, guardian_contact: null,
    ...over, version,
  });

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000002']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Sampaguita',$3)`, [section, year, ids.teacher]);
});
afterAll(async () => { await db.database.close(); });

describe('the learner’s parent or guardian', () => {
  it('is recorded with the learner, name and number together', async () => {
    const made = await register(learner({ guardian_name: 'Maria Reyes (mother)', guardian_contact: '0917 555 0101' }));
    expect(made.status, made.message ?? '').toBe(201);
    expect(made.data.guardian_name).toBe('Maria Reyes (mother)');
    expect(made.data.guardian_contact).toBe('0917 555 0101');
  });

  it('is optional: a learner the school has written no guardian for is still registered', async () => {
    const made = await register(learner({ lrn: '136170000002', first_name: 'Ben', last_name: 'Lacsamana', sex: 'male' }));
    expect(made.status, made.message ?? '').toBe(201);
    // Null, not an empty string: unrecorded rather than blank, and never
    // evidence that the child has no guardian.
    expect(made.data.guardian_name).toBeNull();
    expect(made.data.guardian_contact).toBeNull();
  });

  it('keeps a number exactly as the school writes one, in every shape it writes it', async () => {
    const shapes = [
      '09171234567',          // a mobile, run together
      '0917 555 0101',        // a mobile, spaced
      '+63 917 555 0101',     // a mobile with the country code
      '(074) 422-1234',       // a landline with an area code
      '074/422-1234',         // the same, as a form often prints it
      '(074) 422-1234 / 0917 555 0101', // both, which is what a school keeps
    ];
    let lrn = 136170000100;
    // A different child for each number: since 0.98.0 (migration 0062) the same name and birth date is refused as
    // the same child, which is the duplicate check working, not the contact field failing.
    const names = [['Gina', 'Abad'], ['Hector', 'Bello'], ['Ines', 'Cruz'], ['Jose', 'Dizon'], ['Karla', 'Esteban'], ['Leo', 'Flores']];
    for (const [i, contact] of shapes.entries()) {
      const [first_name, last_name] = names[i]!;
      const made = await register(learner({ lrn: String(++lrn), first_name, last_name, guardian_contact: contact }));
      expect(made.status, `${contact}: ${made.message ?? ''}`).toBe(201);
      // Byte for byte. Nothing normalised to +63, nothing stripped to digits:
      // the number a school can dial is the number it wrote down.
      expect(made.data.guardian_contact, contact).toBe(contact);
    }
  });

  it('refuses a number with letters in it, beside the field', async () => {
    for (const bad of ['none', 'ask mother', 'O917 555 0101']) {
      const sent = await register(learner({ lrn: '136170000200', guardian_contact: bad }));
      expect(sent.status, bad).toBe(422);
      expect(sent.fields.some(f => f.path === 'guardian_contact'), bad).toBe(true);
    }
  });

  it('refuses a number with no digit at all, and a pasted line break in either field', async () => {
    const noDigits = await register(learner({ lrn: '136170000201', guardian_contact: '+-()/' }));
    expect(noDigits.status).toBe(422);
    expect(noDigits.fields.some(f => f.path === 'guardian_contact')).toBe(true);
    const broken = await register(learner({ lrn: '136170000202', guardian_name: 'Maria\nReyes' }));
    expect(broken.status).toBe(422);
    expect(broken.fields.some(f => f.path === 'guardian_name')).toBe(true);
    const long = await register(learner({ lrn: '136170000203', guardian_name: 'x'.repeat(151) }));
    expect(long.status).toBe(422);
    expect(long.fields.some(f => f.path === 'guardian_name')).toBe(true);
  });

  it('is corrected with the version, journalled by name and never by value', async () => {
    const made = await register(learner({ lrn: '136170000300', first_name: 'Cris', last_name: 'Molina', sex: 'male' }));
    const id = String(made.data.id);
    const saved = await correct(id, { first_name: 'Cris', last_name: 'Molina', sex: 'male', guardian_name: 'Rosa Molina', guardian_contact: '0917 555 0102' }, Number(made.data.version));
    expect(saved.status, saved.message ?? '').toBe(200);
    expect(saved.data.guardian_contact).toBe('0917 555 0102');
    expect(Number(saved.data.version)).toBe(Number(made.data.version) + 1);

    const [event] = await db.pg.query<{ changed_fields: string[] }>(
      `select changed_fields from edunexus.audit_events where entity_id=$1 order by id desc limit 1`, [id]);
    expect(event!.changed_fields).toContain('guardian_name');
    expect(event!.changed_fields).toContain('guardian_contact');

    /*
     * And the number is nowhere in the journal at all.
     *
     * `edunexus.audit_events` (0001) has `changed_fields text[]` and no
     * before/after snapshot columns, so this table records *which* field
     * changed and never what it changed to or from. That was already true of
     * every learner detail; it is asserted here because this is the first field
     * on `learners` that is **a third party's phone number**, and a journal
     * that copied values would quietly accumulate the guardian contact details
     * of 897 families in a table whose whole point is that it is append-only
     * and never deleted. The whole row is read, not just this event's column,
     * so a snapshot column added later fails this.
     */
    const anywhere = await db.pg.query<{ row: string }>(
      `select to_jsonb(a)::text as row from edunexus.audit_events a where a.entity_id=$1`, [id]);
    for (const { row } of anywhere) {
      expect(row).not.toContain('0917');
      expect(row).not.toContain('Rosa Molina');
    }

    // Cleared back to unrecorded, which is a correction like any other.
    const cleared = await correct(id, { first_name: 'Cris', last_name: 'Molina', sex: 'male' }, Number(saved.data.version));
    expect(cleared.status).toBe(200);
    expect(cleared.data.guardian_name).toBeNull();
    expect(cleared.data.guardian_contact).toBeNull();
  });

  it('refuses a stale version rather than overwriting a competing correction', async () => {
    const made = await register(learner({ lrn: '136170000400', first_name: 'Dina', last_name: 'Oclarit' }));
    const id = String(made.data.id);
    const first = await correct(id, { first_name: 'Dina', last_name: 'Oclarit', guardian_contact: '0917 555 0103' }, Number(made.data.version));
    expect(first.status).toBe(200);
    const stale = await correct(id, { first_name: 'Dina', last_name: 'Oclarit', guardian_contact: '0917 555 0104' }, Number(made.data.version));
    expect(stale.status).toBe(409);
    const [row] = await db.pg.query<{ guardian_contact: string }>('select guardian_contact from edunexus.learners where id=$1', [id]);
    expect(row!.guardian_contact).toBe('0917 555 0103');
  });

  it('is refused to an adviser on an existing learner, exactly as every other learner detail is', async () => {
    const made = await register(learner({ lrn: '136170000500', first_name: 'Eli', last_name: 'Pascua' }));
    const id = String(made.data.id);
    // Their own class or not: correcting a profile is a manager's.
    const refused = await correct(id, { first_name: 'Eli', last_name: 'Pascua', guardian_contact: '0917 555 0105' }, Number(made.data.version), tokens.teacher);
    expect(refused.status).toBe(403);
    const [row] = await db.pg.query<{ guardian_contact: string | null }>('select guardian_contact from edunexus.learners where id=$1', [id]);
    expect(row!.guardian_contact).toBeNull();
  });

  it('leaves the gate shut around it: no relationship, second guardian, email or learner’s own number', async () => {
    // The contract is strict, so a field somebody adds hopefully is refused
    // rather than silently dropped. `contact_number` is the *learner's* own and
    // is deliberately still not a field.
    for (const extra of ['guardian_relationship', 'guardian_email', 'guardian_address', 'guardian_occupation',
      'second_guardian_name', 'mother_name', 'father_name', 'contact_number', 'mother_tongue', 'religion']) {
      const sent = await register(learner({ lrn: '136170000600', [extra]: 'something' }));
      expect(sent.status, extra).toBe(422);
    }
  });

  it('is writable only because 0056 granted the two columns', async () => {
    // 0004 grants `edunexus.learners` column by column so the triggers' own
    // columns cannot be written by the API. A new column is therefore not
    // writable until it is granted, and without the grant this registration
    // answers "permission denied for column guardian_name" as a 403 — which
    // reads like a role problem and is not one. 0053 recorded the same trap.
    const granted = await db.pg.query<{ column_name: string; privilege_type: string }>(
      `select column_name,privilege_type from information_schema.column_privileges
       where table_schema='edunexus' and table_name='learners' and grantee='edunexus_app'
         and column_name in ('guardian_name','guardian_contact')
         and privilege_type in ('INSERT','UPDATE')`);
    const pairs = granted.map(r => `${r.column_name}:${r.privilege_type}`).sort();
    expect(pairs).toEqual(['guardian_contact:INSERT', 'guardian_contact:UPDATE', 'guardian_name:INSERT', 'guardian_name:UPDATE']);
  });
});

describe('an adviser registering a new learner', () => {
  it('can no longer record a guardian, since registering a learner directly was withdrawn', async () => {
    // 0.99.0 (migration 0063): every learner an adviser brings in is approved by the office first, so the grant on
    // `register_learner_into_section` is withdrawn. That was an adviser's only way to record a guardian, and the
    // class-list template has no guardian columns, so a guardian is now a manager's field. Asserted, as the
    // changelog promised, rather than left to be found.
    const made = await api.post(`/api/v1/sections/${section}/learners`, tokens.teacher, {
      first_name: 'Fe', middle_name: null, last_name: 'Tabangay', name_extension: null,
      birth_date: '2017-08-14', sex: 'female', lrn: '136170000700',
      guardian_name: 'Luz Tabangay (aunt)', guardian_contact: '0918 222 3344',
      enrolled_on: '2026-06-01',
    });
    expect(made.status, made.message ?? '').toBe(403);
    const rows = await db.pg.query(`select 1 from edunexus.learners where lrn='136170000700'`);
    expect(rows).toHaveLength(0);
  });

  it('still cannot send a field the gate blocks, because the writer denies unknown keys', async () => {
    const refused = await api.post(`/api/v1/sections/${section}/learners`, tokens.teacher, {
      first_name: 'Gil', middle_name: null, last_name: 'Bayangan', name_extension: null,
      birth_date: '2017-09-09', sex: 'male', lrn: '136170000701',
      guardian_relationship: 'aunt', enrolled_on: '2026-06-01',
    });
    expect(refused.status).toBe(422);
  });
});
