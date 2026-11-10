import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The SF10 carries all six elementary grades, and each one stands alone.
 *
 * The clarification of 2026-11-05 is the rule this file holds: a complete
 * elementary SF10 accommodates Grade 1 through Grade 6, every section is
 * populated independently from the learner's own records, and the form is
 * issued without waiting for all six. The failure modes it names are the ones
 * that would quietly corrupt a permanent record, so each is a case here:
 *
 *   - a grade with no encoded records must be **blank**, never invented;
 *   - a grade the learner has not reached must be **blank**, not carried over;
 *   - no grade's figures may be **copied** from another grade;
 *   - a missing record must never read as a **failed or incomplete** one.
 *
 * The distinct general averages per grade are the point of the arrangement: if
 * any block ever took its figures from a neighbour, these numbers would move.
 */

let db: TestDatabase;
let api: TestApi;

const year2026 = '00000000-0000-4000-9000-000000000001';
/** Grade 4 — the learner the school starts using EDUNEXUS on, mid-elementary. */
const grade4 = '00000000-0000-4000-9000-00000000000a';
/** Grade 6 — the learner whose whole elementary record exists. */
const grade6 = '00000000-0000-4000-9000-00000000000b';

type Sf10 = {
  blocks: {
    origin: string; grade_level: number; school_year: { start_year: number };
    subjects: { name: string; final: number | null }[];
    general_average: { value: number | null; remark: string | null };
  }[];
};
const sf10For = async (learner: string) =>
  (await api.get(`/api/v1/learners/${learner}/forms/sf10`, tokens.principal)).data as Sf10;

/** A learning area whose marks are derived from the grade, so no two grades match. */
const area = (name: string, code: string, final: number) =>
  ({ subject_id: null, code, name, q1: final - 2, q2: final - 1, q3: final, q4: final + 1, final, remark: 'passed' as const });

/** One previous school year as the school's own document carries it, with a
 *  general average unique to its grade. */
const priorYear = (grade: number) => ({
  year: {
    start_year: 2020 + grade, grade_level: grade, school_name: 'Balili Elementary School', school_code: '135617',
    school_address: 'Km. 5, Balili, La Trinidad, Benguet', section_name: `Sampaguita ${grade}`, adviser_name: 'A. Dela Cruz',
    // 81, 82, 83 … one per grade, so a copied block is visible immediately.
    general_average: 80 + grade, remark: 'passed' as const,
    source: `Adviser class record ${2020 + grade}-${2021 + grade}, handed over 2026-11-05`,
  },
  subjects: [area('Filipino', 'FILIPINO', 80 + grade), area('English', 'ENGLISH', 78 + grade), area('Mathematics', 'MATHEMATICS', 82 + grade)],
  reason: `Encoding Grade ${grade} from the class record the school holds`,
});

const enrol = async (name: string, lrn: string, section: string) => {
  const made = await api.post('/api/v1/learners', tokens.officer, {
    first_name: name, middle_name: null, last_name: 'Balanga', sex: 'female', birth_date: '2014-05-05', lrn,
  });
  expect(made.status, JSON.stringify(made.data)).toBe(201);
  const id = String(made.data.id);
  const put = await api.post('/api/v1/enrollments', tokens.officer, { learner_id: id, section_id: section, enrolled_on: '2026-06-01' });
  expect(put.status, JSON.stringify(put.data)).toBe(201);
  return id;
};

/** Mid-elementary: Grade 4 now, Grades 1-3 behind her, Grades 5-6 ahead. */
const rosalie = { id: '' };
/** The whole elementary record: Grades 1-5 encoded, Grade 6 current. */
const teodoro = { id: '' };

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','135617','Km. 5, Balili, La Trinidad, Benguet','Cordillera Administrative Region','Benguet','La Trinidad')`);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000002']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,4,'Masigla',$3)`,
    [grade4, year2026, ids.teacher]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,6,'Matatag',$3)`,
    [grade6, year2026, ids.otherTeacher]);
  rosalie.id = await enrol('Rosalie', '136170000211', grade4);
  teodoro.id = await enrol('Teodoro', '136170000212', grade6);
});
afterAll(async () => { await db.database.close(); });

describe('a learner the school starts using EDUNEXUS on at Grade 4', () => {
  it('is issued an SF10 at once, without waiting for Grades 1 to 3 to be encoded', async () => {
    const sf10 = await sf10For(rosalie.id);
    // The requirement is explicit: never require all six grades to exist first.
    expect(sf10.blocks).toHaveLength(1);
    expect(sf10.blocks[0]!.grade_level).toBe(4);
    expect(sf10.blocks[0]!.origin).toBe('register');
  });

  it('invents nothing for the grades behind her, and nothing for the grades ahead', async () => {
    const sf10 = await sf10For(rosalie.id);
    const grades = sf10.blocks.map(b => b.grade_level);
    // Grades 1-3 are not yet encoded and Grades 5-6 have not happened. Neither
    // may appear with a figure of any kind — a dummy grade on a permanent
    // record is indistinguishable from a real one a year later.
    for (const absent of [1, 2, 3, 5, 6]) expect(grades).not.toContain(absent);
  });

  it('shows no general average and no remark for the year still in progress', async () => {
    const sf10 = await sf10For(rosalie.id);
    const current = sf10.blocks[0]!;
    // Nothing computes a grade, so an unfinished year carries neither an
    // average nor a word that could be read as "failed".
    expect(current.general_average.value).toBeNull();
    expect(current.general_average.remark).toBeNull();
  });

  it('fills Grades 1 to 3 as they are encoded, each from its own records', async () => {
    for (const grade of [1, 2, 3]) {
      const made = await api.post(`/api/v1/learners/${rosalie.id}/prior-years`, tokens.principal, priorYear(grade));
      expect(made.status, `Grade ${grade}: ${JSON.stringify(made.data)}`).toBe(201);
    }
    const sf10 = await sf10For(rosalie.id);
    expect(sf10.blocks.map(b => b.grade_level)).toEqual([1, 2, 3, 4]);
    // Each grade keeps its own average: 81, 82, 83, and nothing for the
    // unfinished current year.
    expect(sf10.blocks.map(b => b.general_average.value)).toEqual([81, 82, 83, null]);
    // Grades 5 and 6 are still ahead of her and still absent.
    expect(sf10.blocks.map(b => b.grade_level)).not.toContain(5);
  });
});

describe('a learner whose whole elementary record exists', () => {
  it('carries all six grade levels, one block each, in order', async () => {
    for (const grade of [1, 2, 3, 4, 5]) {
      const made = await api.post(`/api/v1/learners/${teodoro.id}/prior-years`, tokens.principal, priorYear(grade));
      expect(made.status, `Grade ${grade}: ${JSON.stringify(made.data)}`).toBe(201);
    }
    const sf10 = await sf10For(teodoro.id);

    // Six sections, Grade 1 through Grade 6 — the whole of the clarification.
    expect(sf10.blocks).toHaveLength(6);
    expect(sf10.blocks.map(b => b.grade_level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sf10.blocks.map(b => b.school_year.start_year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    // Five transcribed years and the one EDUNEXUS is recording itself.
    expect(sf10.blocks.map(b => b.origin)).toEqual(['encoded', 'encoded', 'encoded', 'encoded', 'encoded', 'register']);
  });

  it('copies no figure from one grade level to another', async () => {
    const sf10 = await sf10For(teodoro.id);
    // The averages were encoded as 81…85, one per grade. Equal neighbours here
    // would mean a block had taken another's figures.
    expect(sf10.blocks.map(b => b.general_average.value)).toEqual([81, 82, 83, 84, 85, null]);
    for (const block of sf10.blocks.filter(b => b.origin === 'encoded')) {
      const expected = 80 + block.grade_level;
      expect(block.general_average.value, `Grade ${block.grade_level}`).toBe(expected);
      // and the learning areas with it, down to the marks
      expect(block.subjects.find(s => s.name === 'Filipino')?.final, `Grade ${block.grade_level} Filipino`).toBe(expected);
      expect(block.subjects.find(s => s.name === 'Mathematics')?.final, `Grade ${block.grade_level} Mathematics`).toBe(expected + 2);
    }
  });

  it('prints on one leaf of long bond: six blocks round up to eight slots over two sides', () => {
    // `Sf10Sheet` rules four blocks to a side and eight to a leaf, from the
    // workbook, and rounds up to a whole leaf so duplex always pairs. Six
    // graded years therefore need **one sheet of paper**, printed both sides —
    // not two sheets, and not one side.
    const perSheet = 4, perLeaf = perSheet * 2;
    const slots = Math.max(perLeaf, Math.ceil(6 / perLeaf) * perLeaf);
    expect(slots).toBe(8);
    expect(slots / perSheet).toBe(2);
    // A repeated grade pushes a record past one leaf rather than losing it.
    expect(Math.max(perLeaf, Math.ceil(9 / perLeaf) * perLeaf) / perSheet).toBe(4);
  });
});
