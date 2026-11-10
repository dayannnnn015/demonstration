import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * `GET /waiting/count`, the numbers the rail draws beside Admissions, Promotion
 * and Staff access (the UI notes of 8 November, note 8; migration 0069).
 *
 * - Each count is what its screen calls waiting, and nothing else: a declined
 *   list, an approved outcome, a past year's endorsement or a decided request
 *   is not counted.
 * - A name request counts only for someone who may decide it: never the
 *   requester, and an administrative officer's only for the principal.
 * - A teacher is answered zeros, not refused, because the rail asks for everyone.
 * - It names nobody and writes no privacy access row, or the rail would bury the
 *   audit on every screen.
 */

let db: TestDatabase;
let api: TestApi;
const year = '00000000-0000-4000-9000-000000002026';
const lastYear = '00000000-0000-4000-9000-000000002025';
const section = '00000000-0000-4000-9000-00000000000a';
const oldSection = '00000000-0000-4000-9000-00000000000b';
const learners = ['01', '02', '03', '04'].map(n => `00000000-0000-4000-9001-0000000000${n}`);
const enrol = (n: number) => `00000000-0000-4000-9002-0000000000${String(n).padStart(2, '0')}`;

const counts = async (token: string) => {
  const got = await api.get('/api/v1/waiting/count', token);
  expect(got.status, got.message ?? '').toBe(200);
  return got.data as { class_lists: number; outcomes: number; name_requests: number };
};

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000069']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values
    ($1,2025,'2025-06-01','2026-03-31','draft'),($2,2026,'2026-06-01','2027-03-31','draft')`, [lastYear, year]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'A',$3),($4,$5,2,'Old',$3)`,
    [section, year, ids.teacher, oldSection, lastYear]);
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values
    ($1,'Ana','Reyes','female','2017-05-02','136170000001'),($2,'Ben','Lacsamana','male','2016-03-11','136170000002'),
    ($3,'Cora','Dizon','female','2016-04-04','136170000003'),($4,'Dan','Abad','male','2016-05-05','136170000004')`, learners);
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
    ($1,$5,$9,3,$10,'2026-06-01','2026-06-01','regular'),($2,$6,$9,3,$10,'2026-06-01','2026-06-01','regular'),
    ($3,$7,$9,3,$10,'2026-06-01','2026-06-01','regular'),($4,$8,$11,2,$12,'2025-06-01','2025-06-01','regular')`,
    [enrol(1), enrol(2), enrol(3), enrol(4), ...learners, year, section, lastYear, oldSection]);
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First','2026-06-01','2026-09-15'),($1,2,'Second','2026-09-16','2026-12-18'),($1,3,'Third','2027-01-04','2027-03-31')`, [year]);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year]);

  // Two class lists waiting, and one already declined.
  await db.pg.query(`insert into edunexus.roster_submissions(section_id,grade_level,academic_year_id,enrolled_on,entry_kind,csv,row_count,status,submitted_by,decided_by) values
    ($1,null,$2,'2026-06-01','regular','lrn',1,'submitted',$3,null),(null,3,$2,'2026-06-01','regular','lrn',1,'submitted',$3,null),
    (null,4,$2,'2026-06-01','regular','lrn',1,'declined',$3,$4)`, [section, year, ids.teacher, ids.officer]);
  // Two outcomes endorsed and waiting this year, one already approved, and one endorsed in last year's class.
  await db.pg.query(`insert into edunexus.promotion_decisions(enrollment_id,action,status,recommended_by,decided_by) values
    ($1,'promoted','recommended',$5,null),($2,'retained','recommended',$5,null),($3,'promoted','approved',$5,$6),($4,'promoted','recommended',$5,null)`,
    [enrol(1), enrol(2), enrol(3), enrol(4), ids.teacher, ids.principal]);
  // A teacher's request and the officer's own: the principal may decide both, the officer only the teacher's.
  await db.pg.query(`insert into edunexus.staff_name_requests(user_id,current_name,requested_name,note,status) values
    ($1,'Teacher','Teacher Santos','My full name, as on my appointment.','pending'),
    ($2,'Administrative Officer','Officer Reyes','My full name, as on my appointment.','pending')`, [ids.teacher, ids.officer]);
});
afterAll(async () => { await db.database.close(); });

describe('what waits on a manager, counted for the rail', () => {
  it('counts what each screen calls waiting, and nothing already decided or from a past year', async () => {
    expect(await counts(tokens.principal)).toEqual({ class_lists: 2, outcomes: 2, name_requests: 2 });
  });

  it('counts for the officer only the corrections they may decide: not their own', async () => {
    expect(await counts(tokens.officer)).toEqual({ class_lists: 2, outcomes: 2, name_requests: 1 });
  });

  it('answers a teacher zeros rather than refusing, since the rail asks for everyone', async () => {
    expect(await counts(tokens.teacher)).toEqual({ class_lists: 0, outcomes: 0, name_requests: 0 });
  });

  it('names nobody and writes no privacy access row', async () => {
    const [before] = await db.pg.query<{ n: string }>('select count(*) n from edunexus.record_access_events');
    const got = await api.get('/api/v1/waiting/count', tokens.principal);
    expect(Object.keys(got.data).sort()).toEqual(['class_lists', 'name_requests', 'outcomes']);
    const [after] = await db.pg.query<{ n: string }>('select count(*) n from edunexus.record_access_events');
    expect(after!.n).toBe(before!.n);
  });

  it('refuses an anonymous caller', async () => {
    expect((await api.get('/api/v1/waiting/count', '')).status).toBe(401);
  });
});
