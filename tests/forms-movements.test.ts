import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';

/**
 * Where the SF2's movement counts and the SF4's come from, against the real SQL.
 *
 * The SF4 is meant to be the sections' own SF2s consolidated, so for one
 * section and one month the two forms must report the same transfers and
 * dropouts. They are read by two different queries, and whether those queries
 * agree is not something reading them settles: a learner who leaves on the
 * first day of a month never appears on that month's register, and whether
 * their departure is still that month's movement is exactly where the two can
 * part company.
 */

/** The movement aggregate both source queries answer with: A before the month, B within it. */
type Movements = Partial<Record<string, { a: { male: number; female: number }; b: { male: number; female: number } }>>;

let db: TestDatabase;
const year = '00000000-0000-4000-9000-000000000001';
const sectionA = '00000000-0000-4000-9000-00000000000a';
const month = '2026-10-01';

/** Enrol a learner in section A from the start of the year, then apply the given events. */
async function learner(n: number, sex: 'male' | 'female', events: [string, string, string][]) {
  const learnerId = `00000000-0000-4000-9001-${String(n).padStart(12, '0')}`;
  const enrollmentId = `00000000-0000-4000-9002-${String(n).padStart(12, '0')}`;
  await db.pg.query(
    `insert into edunexus.learners(id,first_name,last_name,sex,birth_date) values($1,$2,$3,$4,'2017-05-02')`,
    [learnerId, `First${n}`, `Last${n}`, sex]);
  // The enrollment's own trigger writes each timeline event, so the fixture moves the
  // enrollment exactly as the writer functions do rather than inventing its history.
  await db.pg.query(
    `insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
     values($1,$2,$3,3,$4,'2026-06-01','2026-06-01','regular')`,
    [enrollmentId, learnerId, year, sectionA]);
  for (const [, on, reason] of events) {
    await db.pg.query(
      `update edunexus.enrollments set status='withdrawn',last_reason=$2,effective_on=$3 where id=$1`,
      [enrollmentId, reason, on]);
  }
  return enrollmentId;
}

const asManager = async <T>(sql: string, params: unknown[]): Promise<T> => {
  const rows = await db.pg.query<{ payload: T }>(
    `select edunexus.${sql} payload`, params);
  return rows[0]!.payload;
};

beforeAll(async () => {
  db = await testDatabase();
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'A',$3)`, [sectionA, year, ids.teacher]);
  // The actor these security-definer readers run for; both demand a manager.
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);

  await learner(1, 'male', []);
  await learner(2, 'female', []);
  // Leaves on the first day of October: no day of October's register is theirs.
  await learner(3, 'male', [['withdrawn', month, 'transfer_out']]);
  // Leaves in the middle of October, so October's register does hold their days.
  await learner(4, 'female', [['withdrawn', '2026-10-15', 'transfer_out']]);
}, 120000);

afterAll(async () => { await db?.database.close(); });

describe('the movements of one month, as each form reads them', () => {
  it('agrees on a learner who left in the middle of the month', async () => {
    const sf2 = await asManager<{ learners: { events: { reason: string }[] }[] }>('read_sf2_source($1,$2)', [sectionA, month]);
    const mid = sf2.learners.filter(l => l.events.some(e => e.reason === 'transfer_out'));
    expect(mid).toHaveLength(1);
  });

  it('reports the same number of transfers out as the SF4, including the one who left on the first', async () => {
    const sf2 = await asManager<{ movements: Movements }>('read_sf2_source($1,$2)', [sectionA, month]);
    const sf4 = await asManager<{ sections: { section_id: string; movement: Movements }[] }>('read_sf4_source($1,$2)', [year, month]);
    const out = (m: Movements) => (m['transfer_out']?.b.male ?? 0) + (m['transfer_out']?.b.female ?? 0);

    // Two learners left section A during October: one on the 1st, one on the 15th.
    // The one who left on the 1st has no day on October's register, which is exactly
    // the learner the SF2's roster-derived count used to lose.
    expect(out(sf4.sections.find(s => s.section_id === sectionA)!.movement)).toBe(2);
    expect(out(sf2.movements)).toBe(out(sf4.sections.find(s => s.section_id === sectionA)!.movement));
  });

  it('still leaves that learner off the register, because they have no day on it', async () => {
    const sf2 = await asManager<{ learners: { cells: unknown[] }[] }>('read_sf2_source($1,$2)', [sectionA, month]);
    // Three rows: the two who stayed and the one who left mid-month. The counts moved; the roster did not.
    expect(sf2.learners).toHaveLength(3);
  });
});
