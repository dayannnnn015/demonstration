import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The enrollment emitters (0058).
 *
 * The case this file exists for is the first one: **an import notifies once,
 * with a count, not once per learner.** `place_enrollment` is called in a loop
 * by the reviewed import and by next year's placement, so emitting there would
 * have sent an adviser one notification per child and the office several
 * hundred for one year's promotion. The notification is sent by the function
 * that represents the act a person took, and the test that would have caught
 * the other design is `counts the import once`.
 *
 * The rest is about who is affected by a movement, and about the thing that
 * must stay true however many emitters are added: no notification names a
 * learner.
 */

let db: TestDatabase;
let api: TestApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const masigla = '00000000-0000-4000-9000-00000000000a';
const narra = '00000000-0000-4000-9000-00000000000b';

const header = 'lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address';
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: string[][]) => [header, ...rows.map(r => r.map(cell).join(','))].join('\r\n') + '\r\n';
const row = (n: number) => [`1361700005${String(n).padStart(2, '0')}`, `Imported${n}`, '', `Pupil${n}`, '',
  '2017-05-02', 'female', 'Purok 4, Balili, La Trinidad, Benguet'];

const onto = { enrolled_on: '2026-06-01', entry_kind: 'regular' as const };

/** Review and import in one step, as the screen does once a manager has confirmed. */
async function bring(rows: string[][], section: string | null, grade = 3) {
  const payload = section
    ? { ...onto, section_id: section, csv: csv(rows), resolutions: [] }
    : { ...onto, section_id: null, academic_year_id: year2026, grade_level: grade, csv: csv(rows), resolutions: [] };
  const sent = await api.post('/api/v1/roster-imports/preview', tokens.officer, payload);
  expect(sent.status, JSON.stringify(sent.data.issues ?? sent.message)).toBe(201);
  const done = await api.post(`/api/v1/roster-imports/${String(sent.data.preview_id)}/commit`, tokens.officer, { ...payload, confirmed: true });
  expect(done.status, done.message ?? '').toBe(201);
  return done.data as unknown as { items: { learner_id: string; enrollment_id: string }[] };
}

/** Somebody's notifications, newest first, straight from the table. */
const inboxOf = (who: string) =>
  db.pg.query<{ kind: string; payload: Record<string, unknown>; learner_id: string | null; section_id: string | null }>(
    'select kind,payload,learner_id,section_id from edunexus.notifications where recipient_user_id=$1 order by id desc', [who]);

const move = (id: string, version: number, body: Record<string, unknown>, who = tokens.officer) =>
  api.post(`/api/v1/enrollments/${id}/movements`, who, { version, ...body });

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$3,3,'Masigla',$4),($2,$3,3,'Narra',$5)`, [masigla, narra, year2026, ids.teacher, ids.otherTeacher]);
});
afterAll(async () => { await db.database.close(); });

describe('an import notifies once', () => {
  it('counts the import once, however many learners it brought in', async () => {
    await bring([row(1), row(2), row(3), row(4), row(5)], masigla);

    // Five learners, one notification. Emitting from `place_enrollment` would
    // have made this five, which is the whole reason it does not.
    const mine = (await inboxOf(ids.teacher)).filter(n => n.kind === 'learner_placed');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toEqual({ section_name: 'Masigla', grade_level: 3, count: 5 });
    // The count is the notification's only reference to the learners, and no
    // learner is identified by it.
    expect(mine[0]!.learner_id).toBeNull();
    expect(JSON.stringify(mine[0])).not.toContain('Imported');
    expect(JSON.stringify(mine[0])).not.toContain('Pupil');
  });

  it('tells the office, not an adviser, when learners land at a grade with no class', async () => {
    await bring([row(6), row(7)], null);

    const unplaced = (await inboxOf(ids.principal)).filter(n => n.kind === 'learner_unplaced');
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]!.payload).toEqual({ grade_level: 3, count: 2 });
    // Nobody advises these learners yet, so no adviser is told.
    expect((await inboxOf(ids.teacher)).filter(n => n.kind === 'learner_unplaced')).toHaveLength(0);
    expect((await inboxOf(ids.otherTeacher)).filter(n => n.kind === 'learner_unplaced')).toHaveLength(0);
    // The officer committed it, so the officer is not told about their own act.
    expect((await inboxOf(ids.officer)).filter(n => n.kind === 'learner_unplaced')).toHaveLength(0);
  });
});

describe('who a movement affects', () => {
  it('tells both advisers when a learner moves between their classes, each in their own terms', async () => {
    const brought = await bring([row(10)], masigla);
    const enrolment = brought.items[0]!.enrollment_id;
    const [before] = await db.pg.query<{ version: number }>('select version from edunexus.enrollments where id=$1', [enrolment]);

    const moved = await move(enrolment, before!.version, { action: 'reassigned', effective_on: '2026-06-15', section_id: narra });
    expect(moved.status, moved.message ?? '').toBe(201);

    // The class gaining the learner hears one arrived.
    expect((await inboxOf(ids.otherTeacher))[0]!).toMatchObject({ kind: 'learner_placed', payload: { section_name: 'Narra', grade_level: 3 } });
    // The class losing them hears one moved, and the class named is the one they left.
    expect((await inboxOf(ids.teacher))[0]!).toMatchObject({ kind: 'learner_moved', payload: { section_name: 'Masigla', grade_level: 3 } });
    // The other manager is told; the officer who did it is not.
    expect((await inboxOf(ids.principal))[0]!.kind).toBe('learner_moved');
    expect((await inboxOf(ids.officer)).filter(n => n.kind === 'learner_moved')).toHaveLength(0);
  });

  it('tells the adviser of the class a withdrawn learner was in', async () => {
    const brought = await bring([row(11)], masigla);
    const enrolment = brought.items[0]!.enrollment_id;
    const [before] = await db.pg.query<{ version: number }>('select version from edunexus.enrollments where id=$1', [enrolment]);

    const gone = await move(enrolment, before!.version, { action: 'withdrawn', effective_on: '2026-06-20', exit_reason: 'transfer_out' });
    expect(gone.status, gone.message ?? '').toBe(201);

    const mine = await inboxOf(ids.teacher);
    expect(mine[0]!).toMatchObject({ kind: 'learner_withdrawn', payload: { section_name: 'Masigla' } });
    // It carries the learner's id so a screen can link to the record, and still
    // names nobody: the id is not a name, and following it is what gets logged.
    expect(mine[0]!.learner_id).toBe(brought.items[0]!.learner_id);
    expect(Object.keys(mine[0]!.payload).sort()).toEqual(['grade_level', 'section_name']);
  });

  it('does not tell an adviser about their own pull, but does tell the office', async () => {
    // A learner registered at the grade with no class, taken in by the adviser
    // through their own endpoint. `POST /enrollments/:id/movements` is
    // `manager: true` and refuses a teacher at the HTTP layer before the SQL is
    // reached, so the adviser's route in is `POST /sections/:id/pulls`, which
    // calls `move_enrollment` for a learner who already holds an enrolment.
    const brought = await bring([row(12)], null);
    const enrolment = brought.items[0]!.enrollment_id;
    const [before] = await db.pg.query<{ version: number }>('select version from edunexus.enrollments where id=$1', [enrolment]);
    const mineBefore = (await inboxOf(ids.teacher)).length;

    const taken = await api.post(`/api/v1/sections/${masigla}/pulls`, tokens.teacher,
      { learner_id: brought.items[0]!.learner_id, enrolled_on: '2026-06-22', entry_kind: 'regular', version: before!.version });
    expect(taken.status, taken.message ?? '').toBe(201);

    // They did it themselves, so nothing new is addressed to them.
    expect((await inboxOf(ids.teacher)).length).toBe(mineBefore);
    // There was no previous class, so no other adviser is told either.
    expect((await inboxOf(ids.otherTeacher)).filter(n => n.kind === 'learner_moved')).toHaveLength(0);
    // The office is told, which is how a manager learns a class filled itself.
    expect((await inboxOf(ids.principal))[0]!.kind).toBe('learner_moved');
    expect((await inboxOf(ids.officer))[0]!.kind).toBe('learner_moved');
  });
});

describe('what every enrollment notification may say', () => {
  it('never carries a key outside the closed list, across every row emitted here', async () => {
    const all = await db.pg.query<{ payload: Record<string, unknown> }>('select payload from edunexus.notifications');
    expect(all.length).toBeGreaterThan(5);
    const allowed = new Set(['section_name', 'grade_level', 'row_count', 'count', 'month', 'year_label', 'decision']);
    const stray = all.flatMap(n => Object.keys(n.payload)).filter(key => !allowed.has(key));
    expect(stray).toEqual([]);
  });
});
