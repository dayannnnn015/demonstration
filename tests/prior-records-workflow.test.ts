import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The historical-encoding workflow end to end, in the order the school actually
 * does it, through the real API over the real SQL.
 *
 * Unlike `tests/prior-records.test.ts`, which checks each rule on its own, this
 * is one continuous journey for one learner and the cases run in sequence and
 * depend on each other. That is deliberate: what is being verified here is not
 * a rule but a *process* — the office registers and enrols, the office encodes
 * what it holds, the class is assigned later, the adviser encodes the rest, and
 * the SF10 has to be whole and correctly attributed at every step of it.
 *
 * The journey, with the step each case covers:
 *
 *   1. The office registers Hannah and enrols her at Grade 4 with no section.
 *   2. The office encodes her Grade 1 and her Kindergarten credential.   (1)
 *   3. Her SF10 is already complete, with no section anywhere on it.     (3)
 *   4. Her adviser-to-be cannot touch her yet: she is in nobody's class.
 *   5. The office assigns her to Grade 4 Masigla.                        (4)
 *   6. Nothing historical is lost, and the current year gains its class. (4)
 *   7. Her adviser encodes Grades 2 and 3 from the class records.        (2)
 *   8. The SF10 reads as one record: history and the current year.       (5)
 *   9. Three members of staff read it and leave three distinct entries.  (6)
 */

let db: TestDatabase;
let api: TestApi;

const year2026 = '00000000-0000-4000-9000-000000000001';
/** Grade 4 Masigla, advised by `teacher` — the master class Hannah joins at step 5. */
const masigla = '00000000-0000-4000-9000-00000000000a';
/** Grade 5 Narra, advised by `otherTeacher`, so there is a boundary to test against. */
const narra = '00000000-0000-4000-9000-00000000000b';

/** Filled in as the journey runs, because each step builds on the last. */
const hannah = { id: '', enrollment: '', version: 0 };

const area = (name: string, code: string, final: number) =>
  ({ subject_id: null, code, name, q1: final - 2, q2: final - 1, q3: final, q4: final + 1, final, remark: 'passed' as const });
const areas = [area('Filipino', 'FILIPINO', 88), area('English', 'ENGLISH', 86), area('Mathematics', 'MATHEMATICS', 90)];

/** One previous school year, as the school's own document carries it. */
const priorYear = (startYear: number, grade: number) => ({
  start_year: startYear, grade_level: grade, school_name: 'Balili Elementary School', school_code: '135617',
  school_address: 'Km. 5, Balili, La Trinidad, Benguet', section_name: 'Sampaguita', adviser_name: 'A. Dela Cruz',
  general_average: 88, remark: 'passed' as const,
  source: `Adviser class record ${startYear}-${startYear + 1}, handed over 2026-11-04`,
});
const sf10For = async (learner: string, token: string) => (await api.get(`/api/v1/learners/${learner}/forms/sf10`, token)).data as {
  learner: { id: string; lrn: string | null };
  blocks: { origin: string; grade_level: number; section_name: string | null; enrollment_id: string | null;
    school: { name: string; district: string | null }; school_year: { start_year: number };
    subjects: { name: string }[]; general_average: { value: number | null } }[];
  eligibility: { credential: string; school_name: string | null } | null;
  last_school_year: number | null;
};
/**
 * The newest access row for a resource.
 *
 * `order by` is qualified, and must be: `id::text` names the output column `id`,
 * and a bare `id` in ORDER BY binds to that output column, sorting the identity
 * column as text — so row 9 would outrank row 10 and this would report a stale
 * row as the newest. It did, while this file was being written, which is how the
 * same fault was found in the journal queries themselves.
 */
const lastAccess = async (resource: string) => (await db.pg.query<{ actor_user_id: string; record_ids: string[]; request_id: string; id: string }>(
  `select id::text,actor_user_id,record_ids,request_id from edunexus.record_access_events
   where resource=$1 order by edunexus.record_access_events.id desc limit 1`, [resource]))[0]!;

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','135617','Km. 5, Balili, La Trinidad, Benguet','Cordillera Administrative Region','Benguet','La Trinidad')`);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,4,'Masigla',$3)`,
    [masigla, year2026, ids.teacher]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,5,'Narra',$3)`,
    [narra, year2026, ids.otherTeacher]);
});
afterAll(async () => { await db.database.close(); });

describe('the historical-encoding workflow, end to end', () => {
  it('1 — the office registers the learner and enrols her at Grade 4 with no section yet', async () => {
    const made = await api.post('/api/v1/learners', tokens.officer, {
      first_name: 'Hannah', middle_name: 'Bayan', last_name: 'Oclarit', sex: 'female',
      birth_date: '2016-08-14', lrn: '136170000111',
    });
    expect(made.status).toBe(201);
    hannah.id = String(made.data.id);

    // Which class she joins is decided later and by someone else (0048), so she
    // is enrolled at a grade and nothing more.
    const enrolled = await api.post('/api/v1/enrollments', tokens.officer, {
      learner_id: hannah.id, academic_year_id: year2026, grade_level: 4, enrolled_on: '2026-06-01',
    });
    expect(enrolled.status).toBe(201);
    expect(enrolled.data.section_id).toBeNull();
    hannah.enrollment = String(enrolled.data.id);
    hannah.version = Number(enrolled.data.version);
  });

  it('2 — the office encodes her Grade 1 and the credential she presented for Grade 1', async () => {
    const grade1 = await api.post(`/api/v1/learners/${hannah.id}/prior-years`, tokens.principal, {
      year: priorYear(2022, 1), subjects: areas,
      reason: 'Initial historical encoding from the Grade 1 class record',
    });
    expect(grade1.status).toBe(201);

    const credential = await api.patch(`/api/v1/learners/${hannah.id}/eligibility`, tokens.principal, {
      version: 0, credential: 'kinder_progress_report',
      school_name: 'Balili Elementary School', school_code: '135617',
      source: 'Kinder progress report in the learner’s folder, checked 2026-11-04',
      reason: 'Encoding the credential presented for Grade 1 at initial implementation',
    });
    expect(credential.status).toBe(200);
    expect(credential.data.credential).toBe('kinder_progress_report');
  });

  it('3 — her SF10 is already whole, with no section recorded anywhere on it', async () => {
    const sf10 = await sf10For(hannah.id, tokens.principal);
    // The encoded Grade 1, and the Grade 4 she is enrolled in but not placed in.
    expect(sf10.blocks.map(b => [b.school_year.start_year, b.grade_level, b.origin])).toEqual([[2022, 1, 'encoded'], [2026, 4, 'register']]);
    // This is the fault the outward join fixed: the unplaced year used to take
    // the whole record with it. Its class is an absent record, not a blank.
    const current = sf10.blocks.find(b => b.origin === 'register')!;
    expect(current.section_name).toBeNull();
    expect(current.enrollment_id).toBe(hannah.enrollment);
    // And the history is there in full, with the credential above it.
    expect(sf10.eligibility?.credential).toBe('kinder_progress_report');
    expect(sf10.blocks[0]!.subjects.map(s => s.name)).toEqual(['Filipino', 'English', 'Mathematics']);
    expect(sf10.learner.lrn).toBe('136170000111');
  });

  it('4 — the adviser who will teach her cannot reach her yet, because she is in nobody’s class', async () => {
    // Not an accident of this module: `can_read_enrollment` joins sections, so
    // an unplaced learner is invisible to every teacher by the existing policy.
    expect((await api.get(`/api/v1/learners/${hannah.id}/prior-records`, tokens.teacher)).status).toBe(404);
    expect((await api.post(`/api/v1/learners/${hannah.id}/prior-years`, tokens.teacher, {
      year: priorYear(2023, 2), subjects: areas, reason: 'Encoding before the class has been assigned',
    })).status).toBe(404);
  });

  it('5 — the office assigns her to Grade 4 Masigla', async () => {
    const moved = await api.post(`/api/v1/enrollments/${hannah.enrollment}/movements`, tokens.officer, {
      version: hannah.version, action: 'reassigned', effective_on: '2026-08-01', section_id: masigla,
    });
    expect(moved.status).toBe(201);
    expect(moved.data.section_id).toBe(masigla);
    hannah.version = Number(moved.data.version);
  });

  it('6 — nothing historical is lost by the assignment, and the current year gains its class', async () => {
    const sf10 = await sf10For(hannah.id, tokens.principal);
    // The same two blocks, in the same order. The encoded year is untouched by
    // a change to the current enrolment, because it is not an enrolment.
    expect(sf10.blocks.map(b => [b.school_year.start_year, b.grade_level, b.origin])).toEqual([[2022, 1, 'encoded'], [2026, 4, 'register']]);
    expect(sf10.blocks[0]!.general_average.value).toBe(88);
    expect(sf10.eligibility?.credential).toBe('kinder_progress_report');
    // And the current year now prints the class she was put in.
    expect(sf10.blocks[1]!.section_name).toBe('Masigla');
  });

  it('7 — her adviser encodes Grades 2 and 3 from the class records they hold', async () => {
    // The whole reason advisers encode: these are their own documents.
    const history = (await api.get(`/api/v1/learners/${hannah.id}/prior-records`, tokens.teacher)).data as { may_write: boolean };
    expect(history.may_write).toBe(true);
    for (const [startYear, grade] of [[2023, 2], [2024, 3]] as const) {
      const made = await api.post(`/api/v1/learners/${hannah.id}/prior-years`, tokens.teacher, {
        year: priorYear(startYear, grade), subjects: areas,
        reason: `Encoding Grade ${grade} from the class record held by the adviser`,
      });
      expect(made.status, `Grade ${grade}`).toBe(201);
    }
    // Still only their own learners: Hannah's classmate-to-be in Narra is not theirs.
    const elsewhere = await api.post('/api/v1/learners', tokens.officer, {
      first_name: 'Ivan', middle_name: null, last_name: 'Camdas', sex: 'male', birth_date: '2015-02-02', lrn: '136170000112',
    });
    await api.post('/api/v1/enrollments', tokens.officer, { learner_id: String(elsewhere.data.id), section_id: narra, enrolled_on: '2026-06-01' });
    expect((await api.post(`/api/v1/learners/${String(elsewhere.data.id)}/prior-years`, tokens.teacher, {
      year: priorYear(2023, 4), subjects: areas, reason: 'Encoding for a learner in another adviser’s class',
    })).status).toBe(404);
  });

  it('8 — the SF10 reads as one record: the encoded years and the current one, in order', async () => {
    const sf10 = await sf10For(hannah.id, tokens.principal);
    expect(sf10.blocks.map(b => [b.school_year.start_year, b.grade_level, b.origin, b.section_name])).toEqual([
      [2022, 1, 'encoded', 'Sampaguita'],
      [2023, 2, 'encoded', 'Sampaguita'],
      [2024, 3, 'encoded', 'Sampaguita'],
      [2026, 4, 'register', 'Masigla'],
    ]);
    // One block per school year, each year once: the record is cumulative, not repeated.
    const years = sf10.blocks.map(b => b.school_year.start_year);
    expect(new Set(years).size).toBe(years.length);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    // Kindergarten is above them as the credential, and is never a block.
    expect(sf10.eligibility?.school_name).toBe('Balili Elementary School');
    expect(sf10.blocks.some(b => b.grade_level === 0)).toBe(false);
    // Every block names the school that taught it, and this school's district
    // because the school ID says it is this school.
    for (const block of sf10.blocks) {
      expect(block.school.name).toBe('Balili Elementary School');
      expect(block.school.district).toBe('La Trinidad');
    }
    expect(sf10.last_school_year).toBe(2026);
    // An encoded year carries no promotion decision, so none was invented for her.
    const encoded = sf10.blocks.filter(b => b.origin === 'encoded');
    expect(encoded).toHaveLength(3);
    expect(encoded.every(b => b.enrollment_id === null)).toBe(true);
  });

  it('9 — three members of staff read it and leave three entries that can be told apart', async () => {
    const seen: { actor: string; id: string; request: string; records: string[] }[] = [];
    for (const [actor, token] of [[ids.principal, tokens.principal], [ids.teacher, tokens.teacher], [ids.officer, tokens.officer]] as const) {
      const got = await api.get(`/api/v1/learners/${hannah.id}/forms/sf10`, token);
      expect(got.status, `${actor} reading the SF10: ${got.code ?? ''} ${got.message ?? ''}`).toBe(200);
      const row = await lastAccess('sf10Get');
      expect(row.actor_user_id).toBe(actor);
      // Named by the learner's permanent id, not merely "an SF10 was viewed".
      expect(row.record_ids).toContain(hannah.id);
      expect(row.record_ids).toContain(hannah.enrollment);
      seen.push({ actor: row.actor_user_id, id: row.id, request: row.request_id, records: row.record_ids });
    }
    // Three separate rows, each its own staff member and its own request.
    expect(new Set(seen.map(s => s.id)).size).toBe(3);
    expect(seen.map(s => s.actor)).toEqual([ids.principal, ids.teacher, ids.officer]);
    expect(new Set(seen.map(s => s.request)).size).toBe(3);

    // The same, read back through the log a manager actually reads it through.
    const log = (await api.get(`/api/v1/record-access-events?record_id=${hannah.id}&limit=50`, tokens.principal)).data as {
      items: { actor_user_id: string; resource: string; record_ids: string[] }[];
    };
    const reads = log.items.filter(r => r.resource === 'sf10Get');
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(new Set(reads.map(r => r.actor_user_id))).toEqual(new Set([ids.principal, ids.teacher, ids.officer]));
    // A teacher cannot read the privacy log at all.
    expect((await api.get('/api/v1/record-access-events', tokens.teacher)).status).toBe(403);
  });
});
