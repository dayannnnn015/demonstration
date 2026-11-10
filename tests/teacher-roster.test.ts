import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * An adviser takes their own learners into their own class (step 7), and the
 * office sees how far the historical encoding has got (step 6).
 *
 * Step 7 reverses the rule that only managers change learner records, so the
 * cases below are mostly about **what did not widen**: an adviser cannot take a
 * learner out of a colleague's class, cannot touch another section, cannot make
 * a second record for a child already on the registry, and still cannot read a
 * learner who is not theirs. A widening that only ever gets tested for the happy
 * path is how a role gate quietly becomes decoration.
 *
 * Step 6's test is almost entirely about what it does **not** do: it names no
 * learner and writes no privacy access row, because a school-wide view that
 * paged the registry would bury the audit the system exists to keep.
 */

let db: TestDatabase;
let api: TestApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
/** Masigla is `teacher`'s, Narra is `otherTeacher`'s, both Grade 3. Malaya is `teacher`'s second, Grade 4. */
const masigla = '00000000-0000-4000-9000-00000000000a';
const narra = '00000000-0000-4000-9000-00000000000b';
const malaya = '00000000-0000-4000-9000-00000000000c';

let unplaced = '';        // Grade 3, no class — the case the whole feature exists for
let unplacedFour = '';    // Grade 4, no class
let placedElsewhere = ''; // already in Narra
let noEnrolment = '';     // on the registry, not enrolled this year

const learner = (n: number, over: Record<string, unknown> = {}) => ({
  lrn: `1361700002${String(n).padStart(2, '0')}`, first_name: `Pull${n}`, middle_name: null,
  last_name: `Candidate${n}`, name_extension: null, birth_date: '2017-05-02', sex: 'female', address: null, ...over,
});

/** Registers a learner as the office and returns the id. */
async function register(n: number, over: Record<string, unknown> = {}) {
  const made = await api.post('/api/v1/learners', tokens.officer, learner(n, over));
  expect(made.status, made.message ?? '').toBe(201);
  return String(made.data.id);
}
async function enrol(learnerId: string, grade: number, section: string | null) {
  const made = await api.post('/api/v1/enrollments', tokens.officer,
    { learner_id: learnerId, section_id: section, academic_year_id: year2026, grade_level: grade, enrolled_on: '2026-06-01' });
  expect(made.status, made.message ?? '').toBe(201);
  return made.data as Record<string, unknown>;
}
const pullable = (section: string, token: string, search?: string) =>
  api.get(`/api/v1/sections/${section}/pullable-learners${search ? `?search=${encodeURIComponent(search)}` : ''}`, token);
const pull = (section: string, token: string, body: Record<string, unknown>) =>
  api.post(`/api/v1/sections/${section}/pulls`, token, { enrolled_on: '2026-06-15', ...body });

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$4,3,'Masigla',$5),($2,$4,3,'Narra',$6),($3,$4,4,'Malaya',$5)`,
    [masigla, narra, malaya, year2026, ids.teacher, ids.otherTeacher]);

  unplaced = await register(1); await enrol(unplaced, 3, null);
  unplacedFour = await register(2); await enrol(unplacedFour, 4, null);
  placedElsewhere = await register(3); await enrol(placedElsewhere, 3, narra);
  noEnrolment = await register(4, { first_name: 'Returning', last_name: 'Learner' });
});
afterAll(async () => { await db.database.close(); });

describe('what an adviser may take in', () => {
  it('lists the learners registered at their grade with no class yet', async () => {
    const got = await pullable(masigla, tokens.teacher);
    expect(got.status).toBe(200);
    const items = got.data.items as { learner_id: string; how: string; enrollment_id: string | null }[];
    expect(items.map(i => i.learner_id)).toEqual([unplaced]);
    expect(items[0]!.how).toBe('assign');
    expect(items[0]!.enrollment_id).not.toBeNull();
    expect(got.data.section).toMatchObject({ grade_level: 3, name: 'Masigla' });
  });

  it('leaves out a learner at another grade, and one already in somebody’s class', async () => {
    const items = (await pullable(masigla, tokens.teacher)).data.items as { learner_id: string }[];
    const listed = items.map(i => i.learner_id);
    expect(listed).not.toContain(unplacedFour);
    expect(listed).not.toContain(placedElsewhere);
    // The adviser's other section, at Grade 4, sees the Grade 4 learner instead.
    const four = (await pullable(malaya, tokens.teacher)).data.items as { learner_id: string }[];
    expect(four.map(i => i.learner_id)).toEqual([unplacedFour]);
  });

  it('finds a learner with no enrolment this year only when searched for, and says they would be enrolled', async () => {
    const bare = (await pullable(masigla, tokens.teacher)).data.items as { learner_id: string }[];
    expect(bare.map(i => i.learner_id)).not.toContain(noEnrolment);
    const found = (await pullable(masigla, tokens.teacher, 'Returning')).data.items as { learner_id: string; how: string }[];
    const row = found.find(i => i.learner_id === noEnrolment);
    expect(row?.how).toBe('enrol');
  });

  it('refuses a section the caller does not advise, and names no learner in the refusal', async () => {
    const got = await pullable(narra, tokens.teacher);
    expect(got.status).toBe(403);
    expect(got.code).toBe('NOT_YOUR_CLASS');
    expect(JSON.stringify(got.data)).not.toContain('Candidate');
  });

  it('lets a manager read any section’s list', async () => {
    expect((await pullable(narra, tokens.officer)).status).toBe(200);
  });

  it('logs every learner it named, because they are outside the caller’s own class', async () => {
    const before = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource='pullableList'`);
    await pullable(masigla, tokens.teacher);
    const after = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource='pullableList'`);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n) + 1);
    const [row] = await db.pg.query<{ record_ids: string[]; actor_user_id: string }>(
      `select record_ids,actor_user_id from edunexus.record_access_events where resource='pullableList' order by id desc limit 1`);
    expect(row!.record_ids).toContain(unplaced);
    expect(row!.actor_user_id).toBe(ids.teacher);
  });
});

describe('taking a learner in', () => {
  it('gives a class to the enrolment they already hold, without a second learner record', async () => {
    const listed = (await pullable(masigla, tokens.teacher)).data.items as { learner_id: string; enrollment_id: string; enrollment_version: number }[];
    const row = listed[0]!;
    const done = await pull(masigla, tokens.teacher, { learner_id: row.learner_id, version: row.enrollment_version });
    expect(done.status, done.message ?? '').toBe(201);
    expect(done.data.how).toBe('assign');
    const enrollment = done.data.enrollment as { id: string; section_id: string };
    expect(enrollment.section_id).toBe(masigla);
    expect(enrollment.id).toBe(row.enrollment_id);

    // One learner record and one enrolment: the whole point of a pull.
    const [learners] = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.learners where id=$1 or merged_into=$1`, [unplaced]);
    expect(Number(learners!.n)).toBe(1);
    const [rows] = await db.pg.query<{ n: string }>(
      `select count(*) n from edunexus.enrollments where learner_id=$1 and academic_year_id=$2 and record_state='valid'`, [unplaced, year2026]);
    expect(Number(rows!.n)).toBe(1);
    // Journalled as a movement on that enrolment, under the adviser's own name.
    const events = await db.pg.query<{ event_type: string; actor_user_id: string }>(
      `select event_type,actor_user_id from edunexus.enrollment_events where enrollment_id=$1 order by enrollment_version`, [row.enrollment_id]);
    expect(events.map(e => e.event_type)).toEqual(['enrolled', 'reassigned']);
    expect(events[1]!.actor_user_id).toBe(ids.teacher);

    // And now the adviser can read them, which they could not before.
    expect((await api.get(`/api/v1/enrollments/${row.enrollment_id}`, tokens.teacher)).status).toBe(200);
    // Taken, so no longer on the list.
    expect(((await pullable(masigla, tokens.teacher)).data.items as unknown[]).length).toBe(0);
  });

  it('enrols a learner who holds no enrolment this year, at the section’s grade', async () => {
    const done = await pull(masigla, tokens.teacher, { learner_id: noEnrolment });
    expect(done.status, done.message ?? '').toBe(201);
    expect(done.data.how).toBe('enrol');
    const enrollment = done.data.enrollment as { section_id: string; grade_level: number };
    expect(enrollment.section_id).toBe(masigla);
    expect(enrollment.grade_level).toBe(3);
  });

  it('refuses a learner already in another adviser’s class, rather than moving them', async () => {
    const done = await pull(masigla, tokens.teacher, { learner_id: placedElsewhere, version: 1 });
    expect(done.status).toBe(409);
    expect(done.code).toBe('LEARNER_IN_CLASS');
    const [row] = await db.pg.query<{ section_id: string }>(`select section_id from edunexus.enrollments where learner_id=$1`, [placedElsewhere]);
    expect(row!.section_id).toBe(narra);
  });

  it('refuses a section the caller does not advise', async () => {
    const done = await pull(narra, tokens.teacher, { learner_id: unplacedFour });
    expect(done.status).toBe(403);
  });

  it('refuses a stale version, so two advisers cannot both claim one unplaced learner', async () => {
    // A name no earlier learner's words are part of: since 0.98.0 the office's registration refuses a likely duplicate.
    const fresh = await register(10, { first_name: 'Stale', last_name: 'Claimant' }); await enrol(fresh, 3, null);
    const listed = (await pullable(masigla, tokens.teacher)).data.items as { learner_id: string; enrollment_version: number }[];
    const row = listed.find(i => i.learner_id === fresh)!;
    const first = await pull(masigla, tokens.teacher, { learner_id: fresh, version: row.enrollment_version });
    expect(first.status).toBe(201);
    const second = await pull(malaya, tokens.teacher, { learner_id: fresh, version: row.enrollment_version });
    expect(second.status).toBe(409);
  });

  it('still refuses an adviser every movement that is not taking an unplaced learner in', async () => {
    // The widening is one transition only. Withdrawing, re-entering and moving a
    // learner between classes stay a manager's, and the API refuses them before
    // reading the body.
    const [row] = await db.pg.query<{ id: string; version: number }>(
      `select id,version from edunexus.enrollments where learner_id=$1`, [unplaced]);
    const moved = await api.post(`/api/v1/enrollments/${row!.id}/movements`, tokens.teacher,
      { version: row!.version, action: 'withdrawn', effective_on: '2026-07-01', section_id: null, exit_reason: 'transfer_out' });
    expect(moved.status).toBe(403);
    const reassigned = await api.post(`/api/v1/enrollments/${row!.id}/movements`, tokens.teacher,
      { version: row!.version, action: 'reassigned', effective_on: '2026-07-01', section_id: malaya, exit_reason: null });
    expect(reassigned.status).toBe(403);
  });
});

describe('an adviser registering a new learner', () => {
  it('is refused outright since 0.99.0: every learner an adviser brings in is approved by the office first', async () => {
    // Migration 0063 withdrew the grant on `register_learner_into_section` rather than dropping it, so one line
    // puts it back if the school changes its mind. Until then a new child, a child already on the registry and a
    // duplicate LRN are all the same answer, and none of them writes anything: the adviser sends a one-row class
    // list instead, which the office reviews.
    const tries = [
      learner(20, { first_name: 'Brand', last_name: 'New', address: 'Purok 4, Balili' }),
      learner(21, { first_name: 'Pull1', last_name: 'Candidate1' }),
      learner(1, { first_name: 'Different', last_name: 'Child', birth_date: '2016-01-01' }),
    ];
    for (const body of tries) {
      const made = await api.post(`/api/v1/sections/${masigla}/learners`, tokens.teacher, { ...body, enrolled_on: '2026-06-15' });
      expect(made.status, made.message ?? '').toBe(403);
    }
    const written = await db.pg.query(`select 1 from edunexus.learners where last_name in ('New','Child')`);
    expect(written).toHaveLength(0);
  });

  it('refuses a section the caller does not advise', async () => {
    const made = await api.post(`/api/v1/sections/${narra}/learners`, tokens.teacher,
      { ...learner(22), enrolled_on: '2026-06-15' });
    expect(made.status).toBe(403);
  });

  it('does not widen anything else: a teacher still cannot create a bare learner or correct a profile', async () => {
    expect((await api.post('/api/v1/learners', tokens.teacher, learner(23))).status).toBe(403);
    const [row] = await db.pg.query<{ id: string; version: number }>(`select id,version from edunexus.learners where id=$1`, [unplaced]);
    const patched = await api.patch(`/api/v1/learners/${row!.id}`, tokens.teacher,
      { first_name: 'Renamed', middle_name: null, last_name: 'Candidate1', name_extension: null, birth_date: '2017-05-02', sex: 'female', address: null, version: row!.version });
    expect(patched.status).toBe(403);
  });
});

describe('an adviser still sees only their own learners', () => {
  it('reads their own class and not a colleague’s, after taking learners in', async () => {
    const mine = await api.get('/api/v1/learners?limit=100', tokens.teacher);
    const ids_ = (mine.data.items as { id: string }[]).map(l => l.id);
    expect(ids_).toContain(unplaced);
    expect(ids_).not.toContain(placedElsewhere);
    // The office sees the whole school.
    const all = await api.get('/api/v1/learners?limit=100', tokens.officer);
    expect((all.data.items as { id: string }[]).map(l => l.id)).toContain(placedElsewhere);
  });

  it('may encode the historical records of a learner they took in, and not of anyone else', async () => {
    // The 2026-11-03 exception, now reached through a pull: the adviser took
    // this learner into their class, so the learner's history is theirs to type.
    const mine = await api.get(`/api/v1/learners/${unplaced}/prior-records`, tokens.teacher);
    expect(mine.status).toBe(200);
    expect(mine.data.may_write).toBe(true);
    const theirs = await api.get(`/api/v1/learners/${placedElsewhere}/prior-records`, tokens.teacher);
    expect(theirs.status).toBe(404);
  });
});

describe('school-wide oversight of the encoding', () => {
  const progress = (token: string) => api.get(`/api/v1/academic-years/${year2026}/encoding-progress`, token);

  it('counts every section of the year, with its adviser named and the work left', async () => {
    // One encoded year for a learner in Masigla, so a section with work done and
    // sections with none can be told apart.
    await api.post(`/api/v1/learners/${unplaced}/prior-years`, tokens.teacher, {
      year: { start_year: 2024, grade_level: 2, school_name: 'Balili Elementary School', school_code: null, school_address: null,
        section_name: null, adviser_name: null, general_average: 88, remark: 'passed', source: 'Adviser class record spreadsheet 2024-2025' },
      subjects: [{ subject_id: null, code: null, name: 'Filipino', q1: null, q2: null, q3: null, q4: null, final: 88, remark: 'passed' }],
      reason: 'Historical encoding from the adviser spreadsheet',
    });
    const got = await progress(tokens.principal);
    expect(got.status).toBe(200);
    const sections = got.data.sections as { id: string; name: string; adviser_name: string | null; learners: number;
      with_years: number; with_credential: number; with_nothing: number; encoded_years: number }[];
    expect(sections.map(s => s.name)).toEqual(['Masigla', 'Narra', 'Malaya']);
    const mine = sections.find(s => s.id === masigla)!;
    expect(mine.adviser_name).toBe('Teacher');
    expect(mine.learners).toBeGreaterThan(0);
    expect(mine.with_years).toBe(1);
    expect(mine.encoded_years).toBe(1);
    // Which classes still have work: the count a manager acts on.
    expect(mine.with_nothing).toBe(mine.learners - 1);
    const other = sections.find(s => s.id === narra)!;
    expect(other.adviser_name).toBe('Other Teacher');
    expect(other.with_years).toBe(0);
    expect(other.with_nothing).toBe(other.learners);
  });

  it('counts the learners in no class yet too, so the school total is the whole school', async () => {
    const got = await progress(tokens.principal);
    const unplacedRows = got.data.unplaced as { grade_level: number; learners: number; with_nothing: number }[];
    // The Grade 4 learner nobody has taken in is still somebody's work to do.
    expect(unplacedRows.some(u => u.grade_level === 4 && u.learners >= 1)).toBe(true);
  });

  it('names no learner and writes no privacy access row', async () => {
    const before = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events`);
    const got = await progress(tokens.principal);
    const after = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events`);
    // The whole reason this is counts: opening it logs nothing.
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
    // And no learner's name is anywhere in the answer.
    const text = JSON.stringify(got.data);
    for (const name of ['Pull1', 'Candidate1', 'Brand', 'Returning']) expect(text).not.toContain(name);
  });

  it('is refused to an adviser, who oversees nothing school-wide', async () => {
    expect((await progress(tokens.teacher)).status).toBe(403);
  });
});
