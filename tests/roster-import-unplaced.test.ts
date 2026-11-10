import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * Registering every learner onto the registry first, and settling classes
 * afterwards.
 *
 * The school's first day needs 897 learners on the registry; which class each
 * one joins is decided after that, and often by somebody else. So the class-list
 * import now takes a school year and a grade **without** a section, and this
 * file is mostly about the "afterwards": that assigning a class later is a
 * *movement on the one enrolment* rather than a second enrolment, that the SF4
 * reports the learners who are still in no class instead of quietly leaving them
 * out, and that importing the registry list and then a class list for the same
 * learner is refused rather than enrolling them twice.
 *
 * The last point is the one that would be expensive to get wrong: a learner with
 * two enrolments in one year has two SF10 blocks for it, and a permanent record
 * that says they were in two classes at once.
 */

let db: TestDatabase;
let api: TestApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const masigla = '00000000-0000-4000-9000-00000000000a';
const narra = '00000000-0000-4000-9000-00000000000b';

const header = 'lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address';
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: string[][]) => [header, ...rows.map(r => r.map(cell).join(','))].join('\r\n') + '\r\n';
/** One learner's row, numbered so a file can hold as many as a test needs. */
const row = (n: number, over: Partial<{ first: string; last: string; sex: string; born: string; address: string }> = {}) => [
  `1361700001${String(n).padStart(2, '0')}`, over.first ?? `Learner${n}`, '', over.last ?? `Surname${n}`, '',
  over.born ?? '2017-05-02', over.sex ?? 'female', over.address ?? 'Purok 4, Balili, La Trinidad, Benguet',
];

const onto = { enrolled_on: '2026-06-01', entry_kind: 'regular' as const };
/** Review a file onto the registry at a grade, with no class. */
const previewRegistry = (rows: string[][], grade = 3, year = year2026) =>
  api.post('/api/v1/roster-imports/preview', tokens.officer, { ...onto, section_id: null, academic_year_id: year, grade_level: grade, csv: csv(rows) });
const previewSection = (rows: string[][], section = masigla) =>
  api.post('/api/v1/roster-imports/preview', tokens.officer, { ...onto, section_id: section, csv: csv(rows) });
const commit = (previewId: string, payload: Record<string, unknown>) =>
  api.post(`/api/v1/roster-imports/${previewId}/commit`, tokens.officer, { ...payload, confirmed: true });

/** Review and import in one step, as the screen does once a manager has confirmed. */
async function bring(rows: string[][], grade = 3) {
  const payload = { ...onto, section_id: null, academic_year_id: year2026, grade_level: grade, csv: csv(rows), resolutions: [] };
  const sent = await api.post('/api/v1/roster-imports/preview', tokens.officer, payload);
  expect(sent.status, JSON.stringify(sent.data.issues ?? sent.message)).toBe(201);
  const done = await commit(String(sent.data.preview_id), payload);
  expect(done.status, done.message ?? '').toBe(201);
  return done.data as unknown as { section_id: string | null; grade_level: number; academic_year_id: string;
    items: { row: number; learner_id: string; enrollment_id: string }[] };
}

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','135617','Balili, La Trinidad, Benguet','Cordillera Administrative Region','Benguet','La Trinidad')`);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Masigla',$3)`, [masigla, year2026, ids.teacher]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Narra',$3)`, [narra, year2026, ids.otherTeacher]);
});
afterAll(async () => { await db.database.close(); });

describe('importing onto the registry with no class yet', () => {
  it('registers the learners and enrols them at the grade, with no section', async () => {
    const receipt = await bring([row(1), row(2), row(3)]);
    expect(receipt.items.length).toBe(3);
    // The receipt says plainly that there is no class, and names the grade instead.
    expect(receipt.section_id).toBeNull();
    expect(receipt.grade_level).toBe(3);
    const rows = await db.pg.query<{ section_id: string | null; grade_level: number; status: string; last_reason: string }>(
      `select section_id,grade_level,status,last_reason from edunexus.enrollments where id = any($1::uuid[])`,
      [receipt.items.map(i => i.enrollment_id)]);
    expect(rows.length).toBe(3);
    expect(rows.every(r => r.section_id === null && r.grade_level === 3 && r.status === 'enrolled' && r.last_reason === 'regular')).toBe(true);
    // One enrolment each, and the learners are on the registry with their addresses.
    const [count] = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.learners where address is not null`);
    expect(Number(count!.n)).toBe(3);
  });

  it('says so in the review before anything is written, naming the grade and no section', async () => {
    const sent = await previewRegistry([row(10)], 5);
    expect(sent.status).toBe(201);
    expect(sent.data.section).toBeNull();
    expect(sent.data.grade_level).toBe(5);
    expect(sent.data.academic_year_id).toBe(year2026);
    expect(sent.data.can_commit).toBe(true);
    // A review writes nothing: that learner is not on the registry.
    const [count] = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.learners where lrn=$1`, ['136170000110']);
    expect(Number(count!.n)).toBe(0);
  });

  it('counts the learners on the enrolment totals, and reports them as in no class', async () => {
    const before = await api.get(`/api/v1/enrollment-counts?academic_year_id=${year2026}`, tokens.officer);
    const enrolled = Number(before.data.enrolled);
    await bring([row(20), row(21)], 6);
    const after = await api.get(`/api/v1/enrollment-counts?academic_year_id=${year2026}`, tokens.officer);
    expect(Number(after.data.enrolled)).toBe(enrolled + 2);
    // The grade they are registered at is the grade they count under, class or not.
    const grades = after.data.grades as { grade_level: number; enrolled: number }[];
    expect(grades.find(g => g.grade_level === 6)?.enrolled).toBe(2);
  });

  it('refuses a file with neither a section nor a year, and a row with no grade on its own line, rather than guessing', async () => {
    const sent = await api.post('/api/v1/roster-imports/preview', tokens.officer, { ...onto, csv: csv([row(30)]) });
    expect(sent.status).toBe(422);
    const bare = await api.post('/api/v1/roster-imports/preview', tokens.officer, { ...onto, section_id: null, academic_year_id: year2026, csv: csv([row(30)]) });
    // Since 0.100.0 a file may name no grade, because each row may carry its own. A row with neither is refused on
    // its own line, so nothing is guessed and nothing can be committed.
    expect(bare.status).toBe(201);
    expect(bare.data.can_commit).toBe(false);
    expect(bare.data.preview_id).toBeNull();
    expect(bare.data.issues).toEqual([expect.objectContaining({ row: 1, field: 'grade_level', code: 'GRADE_REQUIRED' })]);
  });

  it('refuses a section that contradicts the year or grade sent with it', async () => {
    const wrongGrade = await api.post('/api/v1/roster-imports/preview', tokens.officer,
      { ...onto, section_id: masigla, grade_level: 5, csv: csv([row(31)]) });
    expect(wrongGrade.status).toBe(422);
    expect(wrongGrade.code).toBe('SECTION_MISMATCH');
  });

  it('refuses a grade that is not Kindergarten to Grade 6, and a year that is not there', async () => {
    const grade = await previewRegistry([row(32)], 9);
    expect(grade.status).toBe(422);
    const year = await previewRegistry([row(32)], 3, '00000000-0000-4000-9000-0000000000ff');
    expect(year.status).toBe(404);
  });

  it('refuses a closed school year', async () => {
    const closed = '00000000-0000-4000-9000-000000000002';
    await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2019,'2019-06-01','2020-03-31','draft')`, [closed]);
    // Draft to active to closed is the only path the year guard allows, and a
    // year cannot be activated without its reporting periods.
    await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
      ($1,1,'First',  '2019-06-01','2019-08-31'),($1,2,'Second','2019-09-01','2019-11-30'),
      ($1,3,'Third',  '2019-12-01','2020-01-31'),($1,4,'Fourth','2020-02-01','2020-03-31')`, [closed]);
    await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [closed]);
    await db.pg.query(`update edunexus.academic_years set status='closed' where id=$1`, [closed]);
    const sent = await api.post('/api/v1/roster-imports/preview', tokens.officer,
      { enrolled_on: '2019-06-03', entry_kind: 'regular', section_id: null, academic_year_id: closed, grade_level: 3, csv: csv([row(33)]) });
    expect(sent.status).toBe(201);
    expect(sent.data.can_commit).toBe(false);
    const issues = sent.data.issues as { code: string }[];
    expect(issues.some(i => i.code === 'YEAR_CLOSED')).toBe(true);
  });

  it('refuses a commit whose destination differs from the one reviewed', async () => {
    const payload = { ...onto, section_id: null, academic_year_id: year2026, grade_level: 3, csv: csv([row(40)]), resolutions: [] };
    const sent = await api.post('/api/v1/roster-imports/preview', tokens.officer, payload);
    expect(sent.status).toBe(201);
    // The grade is part of what was reviewed, so committing at another one is refused.
    const moved = await commit(String(sent.data.preview_id), { ...payload, grade_level: 4 });
    expect(moved.status).toBe(409);
    expect(moved.code).toBe('PREVIEW_CHANGED');
    // And into a section, which is a different destination again.
    const placed = await commit(String(sent.data.preview_id), { ...payload, section_id: masigla, academic_year_id: undefined, grade_level: undefined });
    expect(placed.status).toBe(409);
  });
});

describe('settling the classes afterwards', () => {
  it('assigns a class as a movement on the one enrolment, not a second enrolment', async () => {
    const receipt = await bring([row(50)], 3);
    const enrollment = receipt.items[0]!.enrollment_id;
    const learner = receipt.items[0]!.learner_id;
    const read = await api.get(`/api/v1/enrollments/${enrollment}`, tokens.officer);
    expect(read.data.section_id).toBeNull();

    const moved = await api.post(`/api/v1/enrollments/${enrollment}/movements`, tokens.officer,
      { version: Number(read.data.version), action: 'reassigned', effective_on: '2026-06-15', section_id: masigla, exit_reason: null });
    expect(moved.status, moved.message ?? '').toBe(201);
    expect(moved.data.section_id).toBe(masigla);

    // Still one enrolment for the year. Two would be two SF10 blocks for one year.
    const [count] = await db.pg.query<{ n: string }>(
      `select count(*) n from edunexus.enrollments where learner_id=$1 and academic_year_id=$2 and record_state='valid'`, [learner, year2026]);
    expect(Number(count!.n)).toBe(1);
    // The history records the assignment as a movement, with the enrolment before it.
    const history = await api.get(`/api/v1/enrollments/${enrollment}/history`, tokens.officer);
    const events = (history.data.items as { event_type: string }[]).map(e => e.event_type);
    expect(events).toContain('enrolled');
    expect(events).toContain('reassigned');
  });

  it('lets the adviser of the assigned section read the learner, and no one else’s adviser', async () => {
    const receipt = await bring([row(51)], 3);
    const enrollment = receipt.items[0]!.enrollment_id;
    const read = await api.get(`/api/v1/enrollments/${enrollment}`, tokens.officer);
    // Before a class is assigned, no adviser advises them.
    expect((await api.get(`/api/v1/enrollments/${enrollment}`, tokens.teacher)).status).toBe(404);
    await api.post(`/api/v1/enrollments/${enrollment}/movements`, tokens.officer,
      { version: Number(read.data.version), action: 'reassigned', effective_on: '2026-06-15', section_id: masigla, exit_reason: null });
    // Masigla's adviser now reads them; Narra's does not. Row security, not a filter.
    expect((await api.get(`/api/v1/enrollments/${enrollment}`, tokens.teacher)).status).toBe(200);
    expect((await api.get(`/api/v1/enrollments/${enrollment}`, tokens.otherTeacher)).status).toBe(404);
  });

  it('refuses a class list that would enrol a learner already registered this year', async () => {
    // The registry list first, then the class list for the same child: the
    // second is refused rather than enrolling them twice. Import one or the
    // other, which is what the screen says.
    const receipt = await bring([row(60)], 3);
    expect(receipt.items.length).toBe(1);
    const again = await previewSection([row(60)]);
    expect(again.status).toBe(201);
    expect(again.data.can_commit).toBe(false);
    const issues = again.data.issues as { row: number; code: string; message: string }[];
    // Either answer is honest: it is the same LRN on file, or that learner is
    // already enrolled. Both stop the import and name the row.
    expect(issues.some(i => i.row === 1 && (i.code === 'LRN_EXISTS' || i.code === 'ALREADY_ENROLLED'))).toBe(true);
  });

  it('reports the unplaced learners on the SF4 as counts, and refuses to issue it until they are in a class', async () => {
    // Every SF4 figure is counted by section, so a learner registered at a grade
    // with no class is on no row. Before 0052 they were simply missing from the
    // form and from its totals; now the count is reported on its own.
    const form = await api.get(`/api/v1/academic-years/${year2026}/forms/sf4?month_on=2026-06-01`, tokens.principal);
    expect(form.status).toBe(200);
    const unplaced = form.data.unplaced as { grade_level: number; male: number; female: number; total: number }[];
    expect(unplaced.length).toBeGreaterThan(0);
    expect(unplaced.reduce((n, u) => n + u.total, 0)).toBeGreaterThan(0);
    // Counts by grade and sex, and no learner named: this form names nobody.
    expect(JSON.stringify(unplaced)).not.toMatch(/Learner\d|Surname\d/);
    for (const u of unplaced) expect(u.male + u.female).toBe(u.total);

    // The form may be read while they are unplaced — the school needs to see who
    // is missing — but it may not be *issued*, because the figure the division
    // reads would be short with nothing on the form saying so.
    const issued = await api.post(`/api/v1/academic-years/${year2026}/forms/sf4/issuances`, tokens.principal,
      { month_on: '2026-06-01', reason: 'Issuing the June SF4 for the division office' });
    expect(issued.status).toBe(409);
    expect(issued.code).toBe('FORM_UNPLACED_LEARNERS');
    expect(issued.message).toMatch(/not in a class/);
  });
});
