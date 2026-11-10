import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The Learner registry's grade filter, against the Grade column beside it.
 *
 * Each row reports the learner's placement in the *active* school year, so the
 * filter has to mean the same year or the two contradict each other on screen:
 * the filter used to match a learner who had *ever* been at a grade, so a
 * learner promoted from Grade 3 to Grade 4 came back under "Grade 3" with
 * "Grade 4" printed in their own row.
 */

let db: TestDatabase;
let api: TestApi;

/** Last year, closed, and this year, active: the two a promoted learner spans. */
const lastYear = '00000000-0000-4000-9000-000000002025';
const thisYear = '00000000-0000-4000-9000-000000002026';
const grade3Last = '00000000-0000-4000-9000-00000000a003';
const grade4This = '00000000-0000-4000-9000-00000000a004';
const grade3This = '00000000-0000-4000-9000-00000000b003';
/** Promoted: Grade 3 last year, Grade 4 this year. */
const promoted = '00000000-0000-4000-9001-0000000000a1';
/** Still in Grade 3 this year, for the filter to actually find. */
const current = '00000000-0000-4000-9001-0000000000a2';

const found = async (query: string, token: string = tokens.principal) => {
  const page = (await api.get(`/api/v1/learners${query}`, token)).data as {
    items: { id: string; last_name: string; placement: { grade_level: number } | null }[];
  };
  return page.items;
};

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2025,'2025-06-01','2026-03-31','draft')`, [lastYear]);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [thisYear]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$2,3,'Mabini',$5),($3,$4,4,'Rizal',$5),($6,$4,3,'Bonifacio',$5)`,
    [grade3Last, lastYear, grade4This, thisYear, ids.teacher, grade3This]);
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values
    ($1,'Pia','Promoted','female','2016-01-01','136170000201'),($2,'Carl','Current','male','2016-02-02','136170000202')`, [promoted, current]);
  // Pia: Grade 3 last year, Grade 4 this year. Carl: Grade 3 this year.
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
    ('00000000-0000-4000-9002-0000000000a1',$1,$2,3,$3,'2025-06-01','2025-06-01','regular'),
    ('00000000-0000-4000-9002-0000000000a2',$1,$4,4,$5,'2026-06-01','2026-06-01','regular'),
    ('00000000-0000-4000-9002-0000000000a3',$6,$4,3,$7,'2026-06-01','2026-06-01','regular')`,
    [promoted, lastYear, grade3Last, thisYear, grade4This, current, grade3This]);
  // A year cannot be activated until its reporting periods are set, so the
  // fixture sets them: four quarters, as the school's own SF9 reports.
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First',  '2026-06-01','2026-08-31'),
    ($1,2,'Second', '2026-09-01','2026-11-30'),
    ($1,3,'Third',  '2026-12-01','2027-01-31'),
    ($1,4,'Fourth', '2027-02-01','2027-03-31')`, [thisYear]);
  // Activated only now: one year may be active at a time, by
  // `academic_years_one_active_idx`.
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [thisYear]);
});
afterAll(async () => { await db.database.close(); });

describe('the registry grade filter', () => {
  it('shows each learner the grade they hold in the active school year', async () => {
    const all = await found('?limit=50');
    const pia = all.find(r => r.id === promoted)!;
    const carl = all.find(r => r.id === current)!;
    expect(pia.placement?.grade_level).toBe(4);
    expect(carl.placement?.grade_level).toBe(3);
  });

  it('does not return a promoted learner under the grade they left', async () => {
    // The fault: Pia is in Grade 4 now, so a Grade 3 search must not offer her
    // a row that reads "Grade 4".
    const grade3 = await found('?grade_level=3&limit=50');
    expect(grade3.map(r => r.id)).toEqual([current]);
    expect(grade3.every(r => r.placement?.grade_level === 3)).toBe(true);
  });

  it('returns her under the grade she actually holds', async () => {
    const grade4 = await found('?grade_level=4&limit=50');
    expect(grade4.map(r => r.id)).toEqual([promoted]);
  });

  it('agrees with the Grade column for every grade, which is the property that was broken', async () => {
    for (const grade of [0, 1, 2, 3, 4, 5, 6]) {
      const rows = await found(`?grade_level=${grade}&limit=50`);
      for (const row of rows) {
        expect(row.placement?.grade_level, `${row.last_name} under Grade ${grade}`).toBe(grade);
      }
    }
  });

  it('still filters within what the caller may read', async () => {
    // The adviser holds all three sections here, so they see both learners; the
    // filter narrows their own list rather than widening it.
    const mine = await found('?grade_level=4&limit=50', tokens.teacher);
    expect(mine.map(r => r.id)).toEqual([promoted]);
  });
});

/**
 * The scope an adviser cannot widen, whatever they put in the query.
 *
 * The grade filter was taken off the adviser's registry on 2026-11-05, because
 * an adviser reads only the learners in the classes they advise and the filter
 * could only narrow their own class. Hiding a control is not a permission, so
 * what matters is that the parameter is powerless in their hands — the list is
 * scoped by `can_read_learner` in row security, not by the absence of a select
 * box. These cases hold that, and would hold it if the box came back.
 */
describe('the scope an adviser cannot widen with the filter', () => {
  /** A second Grade 4 class, advised by somebody else. */
  const theirs = '00000000-0000-4000-9000-00000000c004';
  const notMine = '00000000-0000-4000-9001-0000000000a3';

  beforeAll(async () => {
    await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,4,'Lapu-Lapu',$3)`,
      [theirs, thisYear, ids.otherTeacher]);
    await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values($1,'Nina','Notmine','female','2016-03-03','136170000203')`,
      [notMine]);
    await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
      ('00000000-0000-4000-9002-0000000000a4',$1,$2,4,$3,'2026-06-01','2026-06-01','regular')`, [notMine, thisYear, theirs]);
  });

  it('shows a manager every Grade 4 learner in the school', async () => {
    const rows = await found('?grade_level=4&limit=50');
    expect(rows.map(r => r.id).sort()).toEqual([promoted, notMine].sort());
  });

  it('gives an adviser asking for Grade 4 only the Grade 4 learner they advise', async () => {
    // The parameter is the attack: Nina is at exactly the grade asked for, and
    // is in another adviser's class. She must not come back.
    const rows = await found('?grade_level=4&limit=50', tokens.teacher);
    expect(rows.map(r => r.id)).toEqual([promoted]);
    expect(rows.map(r => r.id)).not.toContain(notMine);
  });

  it('gives an adviser with no filter at all exactly their own learners', async () => {
    // What the registry now does for a teacher on opening: no grade asked for,
    // and the answer is already their own classes.
    const rows = await found('?limit=50', tokens.teacher);
    expect(rows.map(r => r.id).sort()).toEqual([promoted, current].sort());
  });

  it('gives the other adviser only theirs, from the same request', async () => {
    const rows = await found('?grade_level=4&limit=50', tokens.otherTeacher);
    expect(rows.map(r => r.id)).toEqual([notMine]);
  });

  it('does not let a name search reach outside the class either', async () => {
    // The same scope, through a different parameter: searching for her by name
    // finds her for a manager and nobody for the adviser who does not teach her.
    expect((await found('?search=Notmine&limit=50')).map(r => r.id)).toEqual([notMine]);
    expect(await found('?search=Notmine&limit=50', tokens.teacher)).toEqual([]);
  });

  // The section filter (the UI notes of 8 November, note 10): an adviser with two classes reads one at a time. It
  // narrows by the class a learner is in this year, exactly as the Section column reads, and only within what the
  // caller may read.
  it('gives an adviser with two classes each class on its own', async () => {
    expect((await found(`?section_id=${grade3This}&limit=50`, tokens.teacher)).map(r => r.id)).toEqual([current]);
    expect((await found(`?section_id=${grade4This}&limit=50`, tokens.teacher)).map(r => r.id)).toEqual([promoted]);
  });

  it('finds nobody when an adviser names a colleague’s class, though a manager finds its learner', async () => {
    expect(await found(`?section_id=${theirs}&limit=50`, tokens.teacher)).toEqual([]);
    expect((await found(`?section_id=${theirs}&limit=50`)).map(r => r.id)).toEqual([notMine]);
  });

  it('reads the active year only, as the Section column does', async () => {
    // Pia was in last year's Mabini; she is in Rizal now, and the row says Rizal.
    expect(await found(`?section_id=${grade3Last}&limit=50`)).toEqual([]);
  });

  it('combines with the other filters, and refuses a section that is not an identifier', async () => {
    expect((await found(`?section_id=${grade4This}&grade_level=4&limit=50`)).map(r => r.id)).toEqual([promoted]);
    expect(await found(`?section_id=${grade4This}&grade_level=3&limit=50`)).toEqual([]);
    expect((await api.get('/api/v1/learners?section_id=not-a-section', tokens.principal)).status).toBe(422);
  });
});
