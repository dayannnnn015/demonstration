import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * What the SF4 does about a learner who is registered at a grade but not yet in
 * a class.
 *
 * Every figure on the form is counted by section, and its grade and school
 * rollups are sums of the section rows, so such a learner belongs to no row and
 * no total: before 0052 they were simply missing, and the form's "Registered
 * learners as of end of the month" — the figure the division reads — came out
 * short with nothing on the form saying so.
 *
 * They are not added into a rollup, because a grade subtotal has to equal the
 * section rows printed above it. They are reported, and the form is refused,
 * which is what this codebase does with every figure it cannot know.
 */

let db: TestDatabase;
let api: TestApi;

const year = '00000000-0000-4000-9000-000000000001';
const sectionA = '00000000-0000-4000-9000-00000000000a';
const month = '2026-10-01';

/** One learner in section A, so the section row has something in it. */
const placed = '00000000-0000-4000-9001-000000000001';
/** Two learners registered at Grade 4 with no class: the ones that used to vanish. */
const waiting = ['00000000-0000-4000-9001-000000000002', '00000000-0000-4000-9001-000000000003'];

const sf4 = async () => (await api.get(`/api/v1/academic-years/${year}/forms/sf4?month_on=${month}`, tokens.principal)).data as {
  sections: { section_id: string; grade_level: number; registered: { male: number; female: number; total: number } }[];
  grades: { grade_level: number; registered: { total: number } }[];
  school_total: { registered: { male: number; female: number; total: number } };
  unplaced: { grade_level: number; male: number; female: number; total: number }[];
  completeness: { complete: boolean; unplaced_learners: number };
};

const learner = async (id: string, n: number, sex: 'male' | 'female', section: string | null) => {
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
    values($1,$2,$3,$4,'2016-05-05',$5)`, [id, `First${n}`, `Last${n}`, sex, `1361700003${String(n).padStart(2, '0')}`]);
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
    values($1,$2,$3,4,$4,'2026-06-01','2026-06-01','regular')`,
    [`00000000-0000-4000-9002-0000000000${String(n).padStart(2, '0')}`, id, year, section]);
};

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','135617','Balili, La Trinidad','CAR','Benguet','La Trinidad')`);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,4,'Masigla',$3)`,
    [sectionA, year, ids.teacher]);
  await learner(placed, 1, 'female', sectionA);
  await learner(waiting[0]!, 2, 'male', null);
  await learner(waiting[1]!, 3, 'female', null);
});
afterAll(async () => { await db.database.close(); });

describe('the SF4 and a learner with no class', () => {
  it('reports them, by the grade they are registered at and by sex', async () => {
    const form = await sf4();
    expect(form.unplaced).toEqual([{ grade_level: 4, male: 1, female: 1, total: 2 }]);
    expect(form.completeness.unplaced_learners).toBe(2);
  });

  it('keeps every total equal to the rows printed above it', async () => {
    const form = await sf4();
    // The section row holds only the learner actually in it.
    expect(form.sections.find(s => s.section_id === sectionA)!.registered.total).toBe(1);
    // And the grade and school totals are still the sum of the section rows, so
    // the form stays internally consistent rather than gaining a total that
    // does not add up on paper.
    expect(form.grades.find(g => g.grade_level === 4)!.registered.total).toBe(1);
    expect(form.school_total.registered.total).toBe(1);
  });

  it('refuses to issue while any registered learner is in no class, and says who', async () => {
    const refused = await api.post(`/api/v1/academic-years/${year}/forms/sf4/issuances`, tokens.principal, { month_on: month });
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('FORM_UNPLACED_LEARNERS');
    expect(refused.message).toMatch(/2 registered learners are not in a class/);
    // The message names where to look, so the principal can act on it.
    expect(refused.message).toMatch(/Grade 4/);
    expect((await sf4()).completeness.complete).toBe(false);
  });

  it('counts a learner placed before the month ends as placed, not as waiting', async () => {
    // The same date the form counts `registered` on: the last day of the month.
    const [enrollment] = await db.pg.query<{ id: string; version: number }>(
      `select id,version from edunexus.enrollments where learner_id=$1`, [waiting[0]]);
    const moved = await api.post(`/api/v1/enrollments/${String(enrollment!.id)}/movements`, tokens.officer, {
      version: Number(enrollment!.version), action: 'reassigned', effective_on: '2026-10-15', section_id: sectionA,
    });
    expect(moved.status).toBe(201);

    const form = await sf4();
    // One left waiting, and the section row has gained the one who was placed.
    expect(form.unplaced).toEqual([{ grade_level: 4, male: 0, female: 1, total: 1 }]);
    expect(form.completeness.unplaced_learners).toBe(1);
    expect(form.sections.find(s => s.section_id === sectionA)!.registered.total).toBe(2);
    expect(form.school_total.registered.total).toBe(2);
  });

  it('reports none, and stops blocking, once every learner is in a class', async () => {
    const [enrollment] = await db.pg.query<{ id: string; version: number }>(
      `select id,version from edunexus.enrollments where learner_id=$1`, [waiting[1]]);
    await api.post(`/api/v1/enrollments/${String(enrollment!.id)}/movements`, tokens.officer, {
      version: Number(enrollment!.version), action: 'reassigned', effective_on: '2026-10-20', section_id: sectionA,
    });
    const form = await sf4();
    expect(form.unplaced).toEqual([]);
    expect(form.completeness.unplaced_learners).toBe(0);
    // All three now counted, which is the figure the division reads.
    expect(form.school_total.registered.total).toBe(3);
    // Issuing is no longer refused for this reason. It may still be refused for
    // the month's own attendance, which is a different gate and not this test's.
    const issued = await api.post(`/api/v1/academic-years/${year}/forms/sf4/issuances`, tokens.principal, { month_on: month });
    expect(issued.code).not.toBe('FORM_UNPLACED_LEARNERS');
  });
});
