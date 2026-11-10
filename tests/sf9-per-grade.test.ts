import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * One SF9 per grade level, kept apart from every other one.
 *
 * The school asked on 2026-11-09 that an issued SF9 be preserved, that a
 * promoted learner start the next grade with a blank card, and that neither
 * overwrite the other. **Almost all of that is already structural rather than a
 * feature**, and this file exists to say so in a way that cannot quietly stop
 * being true:
 *
 *   * the SF9 is derived per **enrollment** (`read_sf9_source(p_enrollment)`),
 *     and every report-card record hangs off `enrollment_id`;
 *   * a promotion creates a **new enrollment** for the new year and grade, which
 *     has no records, so its card is blank with nothing to reset;
 *   * `form_issuances` is append-only, and the prior it looks for is scoped to
 *     `(form, academic_year_id, enrollment_id)` -- so a Grade 2 issuance cannot
 *     find, supersede or overwrite a Grade 1 one.
 *
 * Nothing above was written for this request. What the cases below are for is
 * that none of it is obvious from any one file, and a later change to the
 * issuance scope or to `read_sf9_source` could break it with no test failing.
 */

let db: TestDatabase;
let api: TestApi;

const year2025 = '00000000-0000-4000-9000-000000000001';
const year2026 = '00000000-0000-4000-9000-000000000002';
const sampaguita = '00000000-0000-4000-9000-00000000000a'; // 2025, Grade 1, `teacher`
const munting = '00000000-0000-4000-9000-00000000000b';    // 2025, Kindergarten, `teacher`
const masigla = '00000000-0000-4000-9000-00000000000c';    // 2026, Grade 2, `teacher`

let terms2025: string[] = [];
let areas: { id: string; code: string }[] = [];
let ana = { learner: '', first: '' };   // Grade 1 in 2025, promoted to Grade 2
let kai = { learner: '', first: '' };   // Kindergarten in 2025
let anaIn2025 = '';
let anaIn2026 = '';
let kaiIn2025 = '';
let firstIssuance: { id: string; serial: number; data_hash: string } | null = null;

const reason = 'Recorded for the SF9 per-grade regression suite.';
const sf9 = (enrollment: string, token = tokens.officer) => api.get(`/api/v1/enrollments/${enrollment}/forms/sf9`, token);
const issueSf9 = (enrollment: string, body: Record<string, unknown> = {}) =>
  api.post(`/api/v1/enrollments/${enrollment}/forms/sf9/issuances`, tokens.officer, body);

/** Every sf9 issuance row in the database, oldest first, read as the owner so no row policy hides one. */
const issuances = () => db.pg.query<{ id: string; serial: number; academic_year_id: string; enrollment_id: string; data_hash: string; supersedes_id: string | null; reason: string | null }>(
  `select id,serial,academic_year_id,enrollment_id,data_hash,supersedes_id,reason from edunexus.form_issuances where form='sf9' order by serial`);

async function register(n: number, first: string, over: Record<string, unknown> = {}) {
  const made = await api.post('/api/v1/learners', tokens.officer, {
    lrn: `1361700005${String(n).padStart(2, '0')}`, first_name: first, middle_name: null,
    last_name: `Card${n}`, name_extension: null, birth_date: '2018-04-02', sex: 'female', address: null, ...over,
  });
  expect(made.status, made.message ?? '').toBe(201);
  return String(made.data.id);
}
async function enrol(learnerId: string, grade: number, section: string | null, year: string, on: string) {
  const made = await api.post('/api/v1/enrollments', tokens.officer,
    { learner_id: learnerId, section_id: section, academic_year_id: year, grade_level: grade, enrolled_on: on });
  expect(made.status, made.message ?? '').toBe(201);
  return String(made.data.id);
}
const decisionFor = async (enrollment: string) => {
  const [row] = await db.pg.query<{ version: number }>('select version from edunexus.promotion_decisions where enrollment_id=$1', [enrollment]);
  return row!.version;
};

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  // The SF10's block heading reads the school profile, and `computeSf10`
  // dereferences it, so a database with no profile row answers 500 on sf10Get.
  // That is a pre-existing fault reported alongside this work, not one of these
  // cases; the row is here so the SF10 regression below tests the SF10.
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','123456','La Trinidad, Benguet','CAR','Benguet','La Trinidad')`);
  // 2025-2026 is over; 2026-2027 is under way. Both stay drafts, because a
  // reporting period can only be configured in one and these tests add none later.
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values
    ($1,2025,'2025-06-02','2026-03-31','draft'),($2,2026,'2026-06-01','2027-03-31','draft')`, [year2025, year2026]);
  for (const [year, from] of [[year2025, 2025], [year2026, 2026]] as const) {
    const spans = from === 2025
      ? [['First', '2025-06-02', '2025-09-30'], ['Second', '2025-10-01', '2025-12-31'], ['Third', '2026-01-01', '2026-03-31']]
      : [['First', '2026-06-01', '2026-08-31'], ['Second', '2026-09-01', '2026-10-31'], ['Third', '2026-11-01', '2027-03-31']];
    for (const [index, [name, starts, ends]] of spans.entries()) {
      const made = await api.post(`/api/v1/academic-years/${year}/periods`, tokens.officer,
        { ordinal: index + 1, name: name!, starts_on: starts!, ends_on: ends! });
      expect(made.status, made.message ?? '').toBe(201);
      if (from === 2025) terms2025.push(String(made.data.id));
    }
  }
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$4,1,'Sampaguita',$6),($2,$4,0,'Munting',$6),($3,$5,2,'Masigla',$6)`,
    [sampaguita, munting, masigla, year2025, year2026, ids.teacher]);

  for (const [code, name] of [['FIL', 'Filipino'], ['MATH', 'Mathematics']] as const) {
    const subject = await api.post('/api/v1/subjects', tokens.officer,
      { code, name, kind: 'learning_area', grade_levels: [0, 1, 2, 3, 4, 5, 6], active: true, reason });
    expect(subject.status, subject.message ?? '').toBe(201);
    const offering = await api.post(`/api/v1/sections/${sampaguita}/subjects`, tokens.officer,
      { subject_id: subject.data.id, subject_version: subject.data.version, display_order: areas.length + 1, reason });
    expect(offering.status, offering.message ?? '').toBe(201);
    areas.push({ id: String(offering.data.id), code });
  }

  ana = { learner: await register(1, 'Ana'), first: 'Ana' };
  kai = { learner: await register(2, 'Kai'), first: 'Kai' };
  anaIn2025 = await enrol(ana.learner, 1, sampaguita, year2025, '2025-06-02');
  kaiIn2025 = await enrol(kai.learner, 0, munting, year2025, '2025-06-02');

  // Ana's whole Grade 1 card: every area in every term, each subject average and
  // remark, and her general average -- which is also what promotion waits for.
  for (const area of areas) {
    for (const term of terms2025) {
      const made = await api.post(`/api/v1/section-subjects/${area.id}/report-grades`, tokens.teacher,
        { reporting_period_id: term, reason, entries: [{ enrollment_id: anaIn2025, grade: 88, version: 0 }] });
      expect(made.status, `${area.code}: ${made.message ?? ''}`).toBe(201);
    }
    const final = await api.post(`/api/v1/section-subjects/${area.id}/report-grades`, tokens.teacher,
      { reporting_period_id: null, reason, entries: [{ enrollment_id: anaIn2025, grade: 88, remark: 'passed', version: 0 }] });
    expect(final.status, final.message ?? '').toBe(201);
  }
  const average = await api.post(`/api/v1/sections/${sampaguita}/report-summaries`, tokens.teacher,
    { reason, entries: [{ enrollment_id: anaIn2025, general_average: 88, remark: 'passed', version: 0 }] });
  expect(average.status, average.message ?? '').toBe(201);
  for (const kind of ['can_do', 'to_improve'] as const) {
    const note = await api.post(`/api/v1/sections/${sampaguita}/report-notes`, tokens.teacher,
      { kind, reporting_period_id: terms2025[0]!, reason, entries: [{ enrollment_id: anaIn2025, body: 'Reads with confidence.', version: 0 }] });
    expect(note.status, note.message ?? '').toBe(201);
  }
});
afterAll(async () => { await db.database.close(); });

describe('the Grade 1 card, before any promotion', () => {
  it('lays out the grades recorded for that enrollment, and nothing else', async () => {
    const got = await sf9(anaIn2025);
    expect(got.status, got.message ?? '').toBe(200);
    expect(got.data.layout).toBe('grade1');
    expect((got.data.enrollment as { grade_level: number; section_name: string }).grade_level).toBe(1);
    expect((got.data.enrollment as { section_name: string }).section_name).toBe('Sampaguita');
    const subjects = got.data.subjects as { code: string; final: number | null; terms: Record<string, number | null> }[];
    expect(subjects.map(s => s.code).sort()).toEqual(['FIL', 'MATH']);
    expect(subjects.every(s => s.final === 88)).toBe(true);
    expect(subjects.every(s => terms2025.every(t => s.terms[t] === 88))).toBe(true);
    expect(got.data.general_average).toMatchObject({ value: 88, remark: 'passed' });
    expect(got.data.last_issuance).toBe(null);
  });

  it('is issued against that enrollment and that school year', async () => {
    const made = await issueSf9(anaIn2025);
    expect(made.status, made.message ?? '').toBe(201);
    const issued = made.data.issuance as { id: string; serial: number; data_hash: string; reprint: boolean };
    expect(issued.reprint).toBe(false);
    firstIssuance = { id: issued.id, serial: issued.serial, data_hash: issued.data_hash };
    const rows = await issuances();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ academic_year_id: year2025, enrollment_id: anaIn2025, supersedes_id: null, reason: null });
  });

  it('refuses a Kindergarten card, because the school has supplied none', async () => {
    const got = await sf9(kaiIn2025);
    expect(got.status).toBe(409);
    expect(got.code).toBe('NO_KINDERGARTEN_CARD');
  });
});

describe('promotion gives the learner a new, blank card', () => {
  it('approves the Grade 1 outcome and enrols her into Grade 2', async () => {
    const endorsed = await api.post(`/api/v1/sections/${sampaguita}/promotion-recommendations`, tokens.teacher,
      { reason, entries: [{ enrollment_id: anaIn2025, action: 'promoted', version: 0 }] });
    expect(endorsed.status, endorsed.message ?? '').toBe(201);
    const decided = await api.post(`/api/v1/sections/${sampaguita}/promotion-decisions`, tokens.officer,
      { reason, entries: [{ enrollment_id: anaIn2025, decision: 'approved', version: await decisionFor(anaIn2025) }] });
    expect(decided.status, decided.message ?? '').toBe(201);
    expect(decided.data.advanced).toBe(1);
    const held = await db.pg.query<{ id: string; grade_level: number; section_id: string | null }>(
      `select id,grade_level,section_id from edunexus.enrollments where learner_id=$1 and academic_year_id=$2 and record_state='valid'`, [ana.learner, year2026]);
    expect(held.length).toBe(1);
    expect(held[0]).toMatchObject({ grade_level: 2, section_id: null });
    anaIn2026 = held[0]!.id;
  });

  it('reads the Grade 2 card as blank, with no Grade 1 grade on it', async () => {
    const got = await sf9(anaIn2026);
    expect(got.status, got.message ?? '').toBe(200);
    expect((got.data.enrollment as { grade_level: number }).grade_level).toBe(2);
    expect(got.data.layout).toBe('grades2_3');
    // Nothing of Grade 1 crosses over: the records all hang off the other enrollment.
    expect(got.data.subjects).toEqual([]);
    expect(got.data.general_average).toMatchObject({ value: null, remark: null });
    expect(got.data.values).toEqual({});
    // A box per term exists on the card either way; every one of them is empty.
    const notes = Object.values(got.data.notes as Record<string, Record<string, string | null>>);
    expect(notes.length).toBe(3);
    expect(notes.every(n => n.can_do === null && n.to_improve === null && n.comment === null)).toBe(true);
    expect(got.data.last_issuance).toBe(null);
    expect((got.data.outcome as { action: string | null }).action).toBe(null);
  });

  it('says the learner has no class yet rather than printing an empty section box', async () => {
    const got = await sf9(anaIn2026);
    // A promoted learner holds an enrolment with no class until an adviser takes
    // them in, which is every promoted learner between approval and the pull.
    expect((got.data.enrollment as { section_name: string | null }).section_name).toBe(null);
    expect(got.data.warnings).toContain('This learner is enrolled at this grade but is not in a class yet, so the section and adviser are blank.');
  });

  it('leaves the Grade 1 card and its issuance exactly as they were', async () => {
    const got = await sf9(anaIn2025);
    expect(got.status, got.message ?? '').toBe(200);
    const subjects = got.data.subjects as { final: number | null }[];
    expect(subjects.length).toBe(2);
    expect(subjects.every(s => s.final === 88)).toBe(true);
    expect(got.data.general_average).toMatchObject({ value: 88 });
    expect((got.data.last_issuance as { id: string }).id).toBe(firstIssuance!.id);
    const rows = await issuances();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ id: firstIssuance!.id, data_hash: firstIssuance!.data_hash, supersedes_id: null });
  });
});

describe('the Grade 2 card is issued separately, and supersedes nothing', () => {
  beforeAll(async () => {
    // The adviser takes her into their Grade 2 class, which is how a promoted
    // learner gets one, then the class is offered its learning areas.
    const pulled = await api.post(`/api/v1/sections/${masigla}/pulls`, tokens.teacher,
      { learner_id: ana.learner, enrolled_on: '2026-06-01', version: 1 });
    expect(pulled.status, pulled.message ?? '').toBe(201);
    const subjects = (await api.get('/api/v1/subjects?limit=100', tokens.officer)).data.items as { id: string; code: string; version: number }[];
    for (const [index, code] of ['FIL', 'MATH'].entries()) {
      const subject = subjects.find(s => s.code === code)!;
      const offering = await api.post(`/api/v1/sections/${masigla}/subjects`, tokens.officer,
        { subject_id: subject.id, subject_version: subject.version, display_order: index + 1, reason });
      expect(offering.status, offering.message ?? '').toBe(201);
      const made = await api.post(`/api/v1/section-subjects/${String(offering.data.id)}/report-grades`, tokens.teacher,
        { reporting_period_id: terms2025.length ? null : null, reason, entries: [{ enrollment_id: anaIn2026, grade: 90, remark: 'passed', version: 0 }] });
      expect(made.status, made.message ?? '').toBe(201);
    }
  });

  it('carries only the Grade 2 grades', async () => {
    const got = await sf9(anaIn2026);
    expect(got.status, got.message ?? '').toBe(200);
    expect((got.data.enrollment as { section_name: string | null }).section_name).toBe('Masigla');
    const subjects = got.data.subjects as { final: number | null }[];
    expect(subjects.length).toBe(2);
    expect(subjects.every(s => s.final === 90)).toBe(true);
    expect(got.data.general_average).toMatchObject({ value: null });
  });

  it('is a second issuance, not a correction of the first', async () => {
    const made = await issueSf9(anaIn2026);
    expect(made.status, made.message ?? '').toBe(201);
    const issued = made.data.issuance as { id: string; serial: number; supersedes_id: string | null; reprint: boolean };
    expect(issued.reprint).toBe(false);
    expect(issued.supersedes_id).toBe(null);
    const rows = await issuances();
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.enrollment_id)).toEqual([anaIn2025, anaIn2026]);
    expect(rows.map(r => r.academic_year_id)).toEqual([year2025, year2026]);
    // The Grade 1 row is byte for byte what it was.
    expect(rows[0]).toMatchObject({ id: firstIssuance!.id, data_hash: firstIssuance!.data_hash, supersedes_id: null, reason: null });
  });

  it('reprints rather than duplicating when nothing has changed', async () => {
    const again = await issueSf9(anaIn2026);
    expect(again.status, again.message ?? '').toBe(201);
    expect((again.data.issuance as { reprint: boolean }).reprint).toBe(true);
    expect((await issuances()).length).toBe(2);
  });

  it('corrects only its own year when the card changes', async () => {
    const [row] = await db.pg.query<{ id: string; version: number; offering_id: string }>(
      `select id,version,offering_id from edunexus.report_grades where enrollment_id=$1 and reporting_period_id is null order by offering_id limit 1`, [anaIn2026]);
    const changed = await api.post(`/api/v1/section-subjects/${row!.offering_id}/report-grades`, tokens.teacher,
      { reporting_period_id: null, reason, entries: [{ enrollment_id: anaIn2026, grade: 91, remark: 'passed', version: row!.version }] });
    expect(changed.status, changed.message ?? '').toBe(201);
    // A different card for the same enrollment is a correction and needs a reason.
    const bare = await issueSf9(anaIn2026);
    expect(bare.status).toBe(409);
    expect(bare.code).toBe('REISSUE_REASON');
    const corrected = await issueSf9(anaIn2026, { reason: 'Corrected the Filipino subject average against the ECR.' });
    expect(corrected.status, corrected.message ?? '').toBe(201);
    const rows = await issuances();
    expect(rows.length).toBe(3);
    // It supersedes the Grade 2 issuance, never the Grade 1 one.
    expect(rows[2]!.supersedes_id).toBe(rows[1]!.id);
    expect(rows[2]!.enrollment_id).toBe(anaIn2026);
    expect(rows[0]).toMatchObject({ id: firstIssuance!.id, data_hash: firstIssuance!.data_hash, supersedes_id: null });
  });

  it('lists both years on the learner’s profile, one card each', async () => {
    const got = await api.get(`/api/v1/learners/${ana.learner}/sf9-history`, tokens.officer);
    expect(got.status, got.message ?? '').toBe(200);
    const items = got.data.items as { start_year: number; grade_level: number; section_name: string | null; card: string; issued_count: number; issuance: { serial: number } | null }[];
    expect(items.map(i => [i.start_year, i.grade_level, i.card])).toEqual([[2025, 1, 'issued'], [2026, 2, 'issued']]);
    expect(items.map(i => i.section_name)).toEqual(['Sampaguita', 'Masigla']);
    // Grade 1 issued once; Grade 2 issued, reprinted (no new row) and corrected.
    expect(items.map(i => i.issued_count)).toEqual([1, 2]);
    expect(items[0]!.issuance!.serial).toBe(firstIssuance!.serial);
  });

  it('says a Kindergarten year prints no card, rather than offering one', async () => {
    const got = await api.get(`/api/v1/learners/${kai.learner}/sf9-history`, tokens.officer);
    expect(got.status, got.message ?? '').toBe(200);
    const items = got.data.items as { grade_level: number; card: string; issuance: unknown }[];
    expect(items.map(i => [i.grade_level, i.card])).toEqual([[0, 'no_card']]);
    expect(items[0]!.issuance).toBe(null);
  });

  it('shows a teacher exactly what can_read_enrollment already shows them', async () => {
    // The history widens no read scope: every row goes through
    // `can_read_enrollment`, which for a teacher is the classes they advise
    // while the year is not closed. `teacher` advises both of Ana's — Sampaguita
    // in 2025 and Masigla in 2026 — and neither year is closed, so both are
    // theirs to read. This is the same answer the SF10 gives them.
    const mine = await api.get(`/api/v1/learners/${ana.learner}/sf9-history`, tokens.teacher);
    expect(mine.status, mine.message ?? '').toBe(200);
    const items = mine.data.items as { start_year: number; grade_level: number }[];
    expect(items.map(i => [i.start_year, i.grade_level])).toEqual([[2025, 1], [2026, 2]]);
    const blocks = ((await api.get(`/api/v1/learners/${ana.learner}/forms/sf10`, tokens.teacher)).data.blocks as { grade_level: number }[]).map(b => b.grade_level);
    expect(items.map(i => i.grade_level)).toEqual(blocks);
    // A teacher who advises none of this learner's classes reads nothing at all.
    const theirs = await api.get(`/api/v1/learners/${ana.learner}/sf9-history`, tokens.otherTeacher);
    expect(theirs.status).toBe(404);
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.otherTeacher]);
    await expect(db.pg.query('select edunexus.read_sf9_history($1)', [ana.learner])).rejects.toThrow();
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  });

  it('names no staff member: the history says a card was issued, never by whom', async () => {
    const got = await api.get(`/api/v1/learners/${ana.learner}/sf9-history`, tokens.officer);
    const text = JSON.stringify(got.data);
    for (const name of ['Principal', 'Administrative Officer', 'Teacher', 'Other Teacher']) {
      expect(text, `the history names ${name}`).not.toContain(name);
    }
    expect(text).not.toContain(ids.officer);
    expect(text).not.toContain(ids.teacher);
  });

  it('names what it returned in the privacy log', async () => {
    const [before] = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource='sf9History'`);
    await api.get(`/api/v1/learners/${ana.learner}/sf9-history`, tokens.officer);
    const [after] = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource='sf9History'`);
    expect(Number(after!.n)).toBe(Number(before!.n) + 1);
    const [named] = await db.pg.query<{ record_ids: string[] }>(
      `select record_ids from edunexus.record_access_events where resource='sf9History' order by id desc limit 1`);
    expect(named!.record_ids).toContain(ana.learner);
    expect(named!.record_ids).toContain(anaIn2025);
    expect(named!.record_ids).toContain(anaIn2026);
  });

  it('leaves the SF10 reading both years as their own blocks', async () => {
    const got = await api.get(`/api/v1/learners/${ana.learner}/forms/sf10`, tokens.officer);
    expect(got.status, got.message ?? '').toBe(200);
    const blocks = got.data.blocks as { grade_level: number; school_year: { start_year: number }; general_average: { value: number | null } }[];
    expect(blocks.map(b => b.grade_level)).toEqual([1, 2]);
    expect(blocks.map(b => b.school_year.start_year)).toEqual([2025, 2026]);
    expect(blocks[0]!.general_average.value).toBe(88);
    expect(blocks[1]!.general_average.value).toBe(null);
  });
});
