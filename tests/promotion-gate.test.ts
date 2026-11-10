import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The three rules the school asked for on 2026-11-09, and the regressions each
 * of them could cause.
 *
 * 1. **Promotion is closed until a class's report cards are complete** — judged
 *    against what *that grade's card prints*, never against "a term exists" or
 *    "some grades are there". Kindergarten prints no card and so waits for
 *    nothing, which is deliberate: its outcome is the credential presented for
 *    Grade 1 and has to stay recordable.
 * 2. **An approved outcome carries the learner into next year by itself** — the
 *    next grade for a promotion, the same grade for a retention, no section, and
 *    the previous year's enrolment left exactly as it was. When next year does
 *    not exist yet the outcome is recorded and the carry-forward runs the moment
 *    it is created.
 * 3. **A term accepts grades only once it has started** — and a term already
 *    begun never closes, because the ECR's figures arrive after the term is over.
 *
 * The cases that matter most here are the ones about what did **not** change:
 * the source enrolment, a second approval, and a batch where one entry is bad.
 */

let db: TestDatabase;
let api: TestApi;

const year2026 = '00000000-0000-4000-9000-000000000001';
const sampaguita = '00000000-0000-4000-9000-00000000000a'; // Grade 2, `teacher`
const ilang = '00000000-0000-4000-9000-00000000000b';      // Grade 2, `otherTeacher`
const munting = '00000000-0000-4000-9000-00000000000c';    // Kindergarten, `teacher`

/** Three terms that have all begun (today is well inside the third), so the gate is satisfiable. */
const terms = [
  { ordinal: 1, name: 'First', starts_on: '2026-06-01', ends_on: '2026-08-31' },
  { ordinal: 2, name: 'Second', starts_on: '2026-09-01', ends_on: '2026-10-31' },
  { ordinal: 3, name: 'Third', starts_on: '2026-11-01', ends_on: '2026-12-31' },
];
let termIds: string[] = [];
/** Created late, in the term-window cases: it starts in February and has not begun. */
let fourthTerm = '';

type Person = { learner: string; enrollment: string; name: string };
const roll: Record<string, Person> = {};
let areas: { id: string; code: string }[] = [];
let kinder: Person;
let elsewhere: Person;
let year2027 = '';

const reason = 'Recorded for the promotion gate regression suite.';

const learner = (n: number, over: Record<string, unknown> = {}) => ({
  lrn: `1361700003${String(n).padStart(2, '0')}`, first_name: `Gate${n}`, middle_name: null,
  last_name: `Learner${n}`, name_extension: null, birth_date: '2018-04-02', sex: n % 2 ? 'male' : 'female', address: null, ...over,
});

async function register(n: number, over: Record<string, unknown> = {}) {
  const made = await api.post('/api/v1/learners', tokens.officer, learner(n, over));
  expect(made.status, made.message ?? '').toBe(201);
  return String(made.data.id);
}
async function enrol(learnerId: string, grade: number, section: string | null, year = year2026) {
  const made = await api.post('/api/v1/enrollments', tokens.officer,
    { learner_id: learnerId, section_id: section, academic_year_id: year, grade_level: grade, enrolled_on: '2026-06-01' });
  expect(made.status, made.message ?? '').toBe(201);
  return String(made.data.id);
}
async function join(n: number, grade: number, section: string | null) {
  const id = await register(n);
  return { learner: id, enrollment: await enrol(id, grade, section), name: `Gate${n}` };
}

const readiness = (section: string, token: string) => api.get(`/api/v1/sections/${section}/promotion-readiness`, token);

/** Every learning area's grade for one term, for the four learners of Sampaguita. */
async function encodeTerm(periodId: string | null, people: Person[], grade = 85) {
  for (const area of areas) {
    const body: Record<string, unknown> = {
      reporting_period_id: periodId, reason,
      entries: people.map(p => (periodId === null
        ? { enrollment_id: p.enrollment, grade, remark: 'passed', version: 0 }
        : { enrollment_id: p.enrollment, grade, version: 0 })),
    };
    const made = await api.post(`/api/v1/section-subjects/${area.id}/report-grades`, tokens.teacher, body);
    expect(made.status, `${area.code}: ${made.message ?? ''}`).toBe(201);
  }
}

async function encodeAverages(people: Person[]) {
  const made = await api.post(`/api/v1/sections/${sampaguita}/report-summaries`, tokens.teacher,
    { reason, entries: people.map(p => ({ enrollment_id: p.enrollment, general_average: 86, remark: 'passed', version: 0 })) });
  expect(made.status, made.message ?? '').toBe(201);
}

/** The outcome a section's learners carry, read straight from the table. */
const outcomes = async () => db.pg.query<{ enrollment_id: string; action: string; status: string; version: number }>(
  `select p.enrollment_id,p.action,p.status,p.version from edunexus.promotion_decisions p
   join edunexus.enrollments e on e.id=p.enrollment_id where e.academic_year_id=$1 order by p.enrollment_id`, [year2026]);

const decisionFor = async (enrollment: string) => {
  const [row] = await db.pg.query<{ version: number }>('select version from edunexus.promotion_decisions where enrollment_id=$1', [enrollment]);
  return row!.version;
};

/** Every valid enrolment a learner holds, newest year last. */
const enrollmentsOf = (learnerId: string) => db.pg.query<{ id: string; academic_year_id: string; grade_level: number; section_id: string | null; status: string }>(
  `select e.id,e.academic_year_id,e.grade_level,e.section_id,e.status from edunexus.enrollments e
   join edunexus.academic_years y on y.id=e.academic_year_id
   where e.learner_id=$1 and e.record_state='valid' order by y.start_year`, [learnerId]);

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  // The year stays a **draft** throughout, because a reporting period can only be
  // configured in one, and the term-window cases add a fourth term late on.
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  for (const t of terms) {
    const made = await api.post(`/api/v1/academic-years/${year2026}/periods`, tokens.officer, t);
    expect(made.status, made.message ?? '').toBe(201);
    termIds.push(String(made.data.id));
  }
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$4,2,'Sampaguita',$5),($2,$4,2,'Ilang',$6),($3,$4,0,'Munting',$5)`,
    [sampaguita, ilang, munting, year2026, ids.teacher, ids.otherTeacher]);

  for (const [code, name] of [['FIL', 'Filipino'], ['MATH', 'Mathematics']] as const) {
    const subject = await api.post('/api/v1/subjects', tokens.officer,
      { code, name, kind: 'learning_area', grade_levels: [0, 1, 2, 3, 4, 5, 6], active: true, reason });
    expect(subject.status, subject.message ?? '').toBe(201);
    const offering = await api.post(`/api/v1/sections/${sampaguita}/subjects`, tokens.officer,
      { subject_id: subject.data.id, subject_version: subject.data.version, display_order: areas.length + 1, reason });
    expect(offering.status, offering.message ?? '').toBe(201);
    areas.push({ id: String(offering.data.id), code });
  }

  roll.promotedA = await join(1, 2, sampaguita);
  roll.promotedB = await join(2, 2, sampaguita);
  roll.retainedC = await join(3, 2, sampaguita);
  roll.lateD = await join(4, 2, sampaguita);
  kinder = await join(5, 0, munting);
  elsewhere = await join(6, 2, ilang);
});
afterAll(async () => { await db.database.close?.(); });

const sampaguitaRoll = () => [roll.promotedA!, roll.promotedB!, roll.retainedC!, roll.lateD!];

describe('promotion waits for the report cards its grade actually prints', () => {
  it('reports exactly what is missing, term by term, and names no learner', async () => {
    const got = await readiness(sampaguita, tokens.teacher);
    expect(got.status, got.message ?? '').toBe(200);
    expect(got.data.ready).toBe(false);
    expect(got.data.blocked_by).toBe('incomplete');
    expect(got.data.learners).toBe(4);
    expect(got.data.offerings).toBe(2);
    expect(got.data.requires).toMatchObject({ grades: true, descriptive: false, note_kinds: [] });
    // 4 learners x 2 areas x 3 terms, plus 8 subject averages, 8 remarks and 4 general averages.
    expect(got.data.missing_total).toBe(24 + 8 + 8 + 4);
    const periods = got.data.periods as { name: string; missing: number; open: boolean; complete: boolean }[];
    expect(periods.map(p => p.name)).toEqual(['First', 'Second', 'Third']);
    expect(periods.every(p => p.open)).toBe(true);
    expect(periods.map(p => p.missing)).toEqual([8, 8, 8]);
    // Counts only: a readiness read must not appear in the privacy log.
    const [counted] = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource like 'promotion%'`);
    expect(Number(counted!.n)).toBe(0);
  });

  it('refuses an endorsement while one required grade is missing', async () => {
    const tried = await api.post(`/api/v1/sections/${sampaguita}/promotion-recommendations`, tokens.teacher,
      { reason, entries: [{ enrollment_id: roll.promotedA!.enrollment, action: 'promoted', version: 0 }] });
    expect(tried.status).toBe(409);
    expect(tried.code).toBe('PROMOTION_NOT_OPEN');
    expect(await outcomes()).toEqual([]);
  });

  it('stays closed when only the first term is complete', async () => {
    await encodeTerm(termIds[0]!, sampaguitaRoll());
    const got = await readiness(sampaguita, tokens.teacher);
    const periods = got.data.periods as { missing: number; complete: boolean }[];
    expect(periods.map(p => p.complete)).toEqual([true, false, false]);
    expect(got.data.ready).toBe(false);
    expect(got.data.missing_total).toBe(16 + 8 + 8 + 4);
  });

  it('stays closed when the third term is missing, and when only the general averages are', async () => {
    await encodeTerm(termIds[1]!, sampaguitaRoll());
    expect((await readiness(sampaguita, tokens.teacher)).data.ready).toBe(false);
    await encodeTerm(termIds[2]!, sampaguitaRoll());
    await encodeTerm(null, sampaguitaRoll());
    const got = await readiness(sampaguita, tokens.teacher);
    expect(got.data.final).toMatchObject({ complete: true });
    expect(got.data.general_average).toMatchObject({ missing: 4, complete: false });
    expect(got.data.ready).toBe(false);
    expect(got.data.missing_total).toBe(4);
  });

  it('opens once every required record is there', async () => {
    await encodeAverages(sampaguitaRoll());
    const got = await readiness(sampaguita, tokens.teacher);
    expect(got.data.ready).toBe(true);
    expect(got.data.blocked_by).toBe(null);
    expect(got.data.missing_total).toBe(0);
  });

  it('is open for Kindergarten with no grades at all, because its card prints none', async () => {
    const got = await readiness(munting, tokens.teacher);
    expect(got.status, got.message ?? '').toBe(200);
    expect(got.data.ready).toBe(true);
    expect(got.data.missing_total).toBe(0);
    expect(got.data.requires).toMatchObject({ grades: false, note_kinds: [] });
    const made = await api.post(`/api/v1/sections/${munting}/promotion-recommendations`, tokens.teacher,
      { reason, entries: [{ enrollment_id: kinder.enrollment, action: 'promoted', version: 0 }] });
    expect(made.status, made.message ?? '').toBe(201);
  });

  it('shows an adviser only their own class, in HTTP and in SQL', async () => {
    const borrowed = await readiness(sampaguita, tokens.otherTeacher);
    expect(borrowed.status).toBe(404);
    const mine = await readiness(ilang, tokens.otherTeacher);
    expect(mine.status).toBe(200);
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.otherTeacher]);
    await expect(db.pg.query('select edunexus.read_promotion_readiness($1)', [sampaguita])).rejects.toThrow();
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  });

  it('refuses a manager approval for a class that is not ready', async () => {
    const tried = await api.post(`/api/v1/sections/${ilang}/promotion-decisions`, tokens.officer,
      { reason, entries: [{ enrollment_id: elsewhere.enrollment, decision: 'approved', version: 1 }] });
    expect(tried.status).toBe(409);
    expect(tried.code).toBe('PROMOTION_NOT_OPEN');
  });
});

describe('an approved outcome carries the learner into next year', () => {
  it('records the endorsements once promotion is open', async () => {
    const made = await api.post(`/api/v1/sections/${sampaguita}/promotion-recommendations`, tokens.teacher, {
      reason, entries: [
        { enrollment_id: roll.promotedA!.enrollment, action: 'promoted', version: 0 },
        { enrollment_id: roll.promotedB!.enrollment, action: 'promoted', version: 0 },
        { enrollment_id: roll.retainedC!.enrollment, action: 'retained', version: 0 },
        { enrollment_id: roll.lateD!.enrollment, action: 'promoted', version: 0 },
      ],
    });
    expect(made.status, made.message ?? '').toBe(201);
    expect(made.data.changed).toBe(4);
  });

  it('refuses an endorsement the adviser did not read the current version of', async () => {
    const tried = await api.post(`/api/v1/sections/${sampaguita}/promotion-recommendations`, tokens.teacher,
      { reason, entries: [{ enrollment_id: roll.promotedA!.enrollment, action: 'retained', version: 99 }] });
    expect(tried.status).toBe(409);
    expect(tried.code).toBe('VERSION_CONFLICT');
  });

  it('approves and reports that next year does not exist yet, advancing nobody', async () => {
    const decided = await api.post(`/api/v1/sections/${sampaguita}/promotion-decisions`, tokens.officer, {
      reason, entries: [
        { enrollment_id: roll.promotedA!.enrollment, decision: 'approved', version: await decisionFor(roll.promotedA!.enrollment) },
        { enrollment_id: roll.promotedB!.enrollment, decision: 'approved', version: await decisionFor(roll.promotedB!.enrollment) },
        { enrollment_id: roll.retainedC!.enrollment, decision: 'approved', version: await decisionFor(roll.retainedC!.enrollment) },
      ],
    });
    expect(decided.status, decided.message ?? '').toBe(201);
    expect(decided.data.changed).toBe(3);
    expect(decided.data.advanced).toBe(0);
    // Two promotions wait for next year; the retention is not a carry-forward at
    // all and says so, rather than being counted among those waiting (0071).
    expect(decided.data.waiting_for_next_year).toBe(2);
    const entries = decided.data.entries as { advance: { advanced: boolean; why: string } }[];
    expect(entries.map(e => e.advance.why)).toEqual(['no_next_year', 'no_next_year', 'retained']);
    // Nothing was enrolled anywhere: the outcome is recorded and waits.
    expect((await enrollmentsOf(roll.promotedA!.learner)).length).toBe(1);
    // Kindergarten was approved too, for the carry-forward below.
    const kinderDecision = await api.post(`/api/v1/sections/${munting}/promotion-decisions`, tokens.officer,
      { reason, entries: [{ enrollment_id: kinder.enrollment, decision: 'approved', version: await decisionFor(kinder.enrollment) }] });
    expect(kinderDecision.status, kinderDecision.message ?? '').toBe(201);
  });

  it('carries every waiting outcome forward the moment next year is created', async () => {
    const made = await api.post('/api/v1/academic-years', tokens.officer, { start_year: 2027, starts_on: '2027-06-01', ends_on: '2028-03-31' });
    expect(made.status, made.message ?? '').toBe(201);
    year2027 = String(made.data.id);

    // Promoted: up one grade. Kindergarten promoted: Grade 1.
    for (const [who, grade] of [[roll.promotedA!, 3], [roll.promotedB!, 3], [kinder, 1]] as const) {
      const held = await enrollmentsOf(who.learner);
      expect(held.length, who.name).toBe(2);
      expect(held[1]).toMatchObject({ academic_year_id: year2027, grade_level: grade, section_id: null, status: 'enrolled' });
    }
    // Not yet approved, so not carried.
    expect((await enrollmentsOf(roll.lateD!.learner)).length).toBe(1);
  });

  /**
   * Narrowed on 2026-11-09: *"automatic enrolment will do only if the learner
   * was recommended for promotion and the ao/principal approves it."* So a
   * retention is recorded and approved and carries the learner nowhere — the
   * case that would otherwise quietly re-enrol them every year.
   */
  it('does not enrol a retained learner, however the carry-forward is reached', async () => {
    const held = await enrollmentsOf(roll.retainedC!.learner);
    expect(held.length).toBe(1);
    expect(held[0]).toMatchObject({ academic_year_id: year2026, grade_level: 2, section_id: sampaguita });
    // The outcome is still the school's, recorded and approved.
    const [outcome] = await db.pg.query<{ action: string; status: string }>(
      'select action,status from edunexus.promotion_decisions where enrollment_id=$1', [roll.retainedC!.enrollment]);
    expect(outcome).toMatchObject({ action: 'retained', status: 'approved' });
    // And the run that was recorded names only the learners it actually placed.
    const placed = await db.pg.query<{ entries: { action: string }[] }>('select entries from edunexus.next_year_placements');
    const actions = placed.flatMap(r => r.entries.map(e => e.action));
    expect(actions).not.toContain('retained');
    expect(actions.every(a => a === 'promoted' || a === 'conditionally_promoted')).toBe(true);
  });

  it('leaves the previous year untouched: same class, same grade, same status', async () => {
    for (const who of [roll.promotedA!, roll.retainedC!]) {
      const [before] = await enrollmentsOf(who.learner);
      expect(before, who.name).toMatchObject({ id: who.enrollment, academic_year_id: year2026, grade_level: 2, section_id: sampaguita, status: 'enrolled' });
    }
    // The grades, the general averages and the outcome are all still there.
    const [counted] = await db.pg.query<{ n: string }>('select count(*) n from edunexus.report_grades where enrollment_id=$1', [roll.promotedA!.enrollment]);
    expect(Number(counted!.n)).toBe(2 * 3 + 2);
    const card = await api.get(`/api/v1/enrollments/${roll.promotedA!.enrollment}/report-card`, tokens.teacher);
    expect(card.status, card.message ?? '').toBe(200);
  });

  it('records the carry-forward where every other one is recorded', async () => {
    const runs = await db.pg.query<{ reason: string; target_year_id: string; entries: unknown[] }>(
      'select reason,target_year_id,entries from edunexus.next_year_placements order by id');
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every(r => r.target_year_id === year2027)).toBe(true);
    expect(runs.some(r => r.reason.includes('when this school year was created'))).toBe(true);
    // Three promotions carried; the retention is not in the run at all (0071).
    expect(runs.flatMap(r => r.entries).length).toBe(3);
  });

  it('advances at once when next year already exists', async () => {
    const decided = await api.post(`/api/v1/sections/${sampaguita}/promotion-decisions`, tokens.officer,
      { reason, entries: [{ enrollment_id: roll.lateD!.enrollment, decision: 'approved', version: await decisionFor(roll.lateD!.enrollment) }] });
    expect(decided.status, decided.message ?? '').toBe(201);
    expect(decided.data.advanced).toBe(1);
    expect(decided.data.waiting_for_next_year).toBe(0);
    const held = await enrollmentsOf(roll.lateD!.learner);
    expect(held.length).toBe(2);
    expect(held[1]).toMatchObject({ academic_year_id: year2027, grade_level: 3, section_id: null });
    const runs = await db.pg.query<{ reason: string }>('select reason from edunexus.next_year_placements order by id');
    expect(runs.some(r => r.reason.includes('when the outcome was approved'))).toBe(true);
  });

  it('does not enrol anyone twice when the approval is submitted again', async () => {
    const again = await api.post(`/api/v1/sections/${sampaguita}/promotion-decisions`, tokens.officer,
      { reason, entries: [{ enrollment_id: roll.lateD!.enrollment, decision: 'approved', version: await decisionFor(roll.lateD!.enrollment) }] });
    expect(again.status).toBe(409);
    expect(again.code).toBe('NO_CHANGES');
    const [counted] = await db.pg.query<{ n: string }>(
      'select count(*) n from edunexus.enrollments where learner_id=$1 and academic_year_id=$2', [roll.lateD!.learner, year2027]);
    expect(Number(counted!.n)).toBe(1);
  });

  it('advances nobody, and changes nothing, when one entry in the batch is refused', async () => {
    // A learner of another adviser's class, mixed into a valid return: the batch must fail whole.
    const tried = await api.post(`/api/v1/sections/${sampaguita}/promotion-decisions`, tokens.officer, {
      reason, entries: [
        { enrollment_id: roll.retainedC!.enrollment, decision: 'returned', version: await decisionFor(roll.retainedC!.enrollment) },
        { enrollment_id: elsewhere.enrollment, decision: 'approved', version: 0 },
      ],
    });
    expect(tried.status).toBe(409);
    expect(tried.code).toBe('NOT_IN_SECTION');
    // The return did not happen either, so the whole transaction rolled back.
    const [row] = await db.pg.query<{ status: string }>('select status from edunexus.promotion_decisions where enrollment_id=$1', [roll.retainedC!.enrollment]);
    expect(row!.status).toBe('approved');
    // And nobody gained a second enrolment next year.
    const [counted] = await db.pg.query<{ n: string }>('select count(*) n from edunexus.enrollments where academic_year_id=$1', [year2027]);
    // Two promotions and Kindergarten carried on year creation, plus lateD; the retention is not there.
    expect(Number(counted!.n)).toBe(4);
  });

  it('closes promotion again when a learner joins the class late', async () => {
    const fresh = await join(7, 2, sampaguita);
    const got = await readiness(sampaguita, tokens.teacher);
    expect(got.data.ready).toBe(false);
    expect(got.data.learners).toBe(5);
    // Their own 6 term grades, 2 subject averages, 2 remarks and 1 general average.
    expect(got.data.missing_total).toBe(6 + 2 + 2 + 1);
    const tried = await api.post(`/api/v1/sections/${sampaguita}/promotion-recommendations`, tokens.teacher,
      { reason, entries: [{ enrollment_id: fresh.enrollment, action: 'promoted', version: 0 }] });
    expect(tried.code).toBe('PROMOTION_NOT_OPEN');
  });

  it('shows the promoted learners to next year’s adviser to pull in', async () => {
    const third = '00000000-0000-4000-9000-00000000001a';
    await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Masigla',$3)`,
      [third, year2027, ids.teacher]);
    const got = await api.get(`/api/v1/sections/${third}/pullable-learners`, tokens.teacher);
    expect(got.status, got.message ?? '').toBe(200);
    const names = (got.data.items as { learner_id: string; how: string }[]).map(i => i.learner_id);
    expect(names).toContain(roll.promotedA!.learner);
    expect(names).toContain(roll.promotedB!.learner);
    // The retained learner holds no enrolment next year at all, so there is nothing at this grade to offer.
    expect(names).not.toContain(roll.retainedC!.learner);
  });

  it('writes the advance into the promotion journal', async () => {
    const [row] = await db.pg.query<{ entries: { advance?: { advanced: boolean; grade_level?: number } }[] }>(
      `select entries from edunexus.promotion_events where section_id=$1 and kind='approve' order by id desc limit 1`, [sampaguita]);
    expect(row!.entries[0]!.advance).toMatchObject({ advanced: true, grade_level: 3 });
  });
});

describe('a term accepts grades only once it has started', () => {
  beforeAll(async () => {
    const made = await api.post(`/api/v1/academic-years/${year2026}/periods`, tokens.officer,
      { ordinal: 4, name: 'Fourth', starts_on: '2027-02-01', ends_on: '2027-03-31' });
    expect(made.status, made.message ?? '').toBe(201);
    fourthTerm = String(made.data.id);
  });

  it('refuses a grade for a term that has not begun', async () => {
    const tried = await api.post(`/api/v1/section-subjects/${areas[0]!.id}/report-grades`, tokens.teacher,
      { reporting_period_id: fourthTerm, reason, entries: [{ enrollment_id: roll.promotedA!.enrollment, grade: 90, version: 0 }] });
    expect(tried.status).toBe(409);
    expect(tried.code).toBe('PERIOD_NOT_STARTED');
    expect(tried.message).toContain('Fourth');
  });

  it('refuses observed values and a narrative for a term that has not begun', async () => {
    const values = await api.post(`/api/v1/sections/${sampaguita}/report-values`, tokens.teacher,
      { reporting_period_id: fourthTerm, reason, entries: [{ enrollment_id: roll.promotedA!.enrollment, ratings: { MD1: 'AO' }, version: 0 }] });
    expect(values.code).toBe('PERIOD_NOT_STARTED');
    const note = await api.post(`/api/v1/sections/${sampaguita}/report-notes`, tokens.teacher,
      { kind: 'comment', reporting_period_id: fourthTerm, reason, entries: [{ enrollment_id: roll.promotedA!.enrollment, body: 'Working well.', version: 0 }] });
    expect(note.code).toBe('PERIOD_NOT_STARTED');
  });

  it('refuses it through the card writer too, which is a different writer entirely', async () => {
    const tried = await api.post(`/api/v1/enrollments/${roll.promotedA!.enrollment}/report-card`, tokens.teacher,
      { reason, grades: [{ offering_id: areas[0]!.id, reporting_period_id: fourthTerm, grade: 91, version: 0 }] });
    expect(tried.status).toBe(409);
    expect(tried.code).toBe('PERIOD_NOT_STARTED');
  });

  it('still accepts a correction to a term that has already begun', async () => {
    const [row] = await db.pg.query<{ version: number }>(
      'select version from edunexus.report_grades where enrollment_id=$1 and offering_id=$2 and reporting_period_id=$3',
      [roll.promotedA!.enrollment, areas[0]!.id, termIds[0]!]);
    const made = await api.post(`/api/v1/section-subjects/${areas[0]!.id}/report-grades`, tokens.teacher,
      { reporting_period_id: termIds[0]!, reason, entries: [{ enrollment_id: roll.promotedA!.enrollment, grade: 88, version: row!.version }] });
    expect(made.status, made.message ?? '').toBe(201);
  });

  it('closes promotion again, because the new term is a required record nobody can fill yet', async () => {
    const got = await readiness(sampaguita, tokens.teacher);
    const periods = got.data.periods as { name: string; open: boolean }[];
    expect(periods.find(p => p.name === 'Fourth')).toMatchObject({ open: false });
    expect(got.data.ready).toBe(false);
    expect(got.data.blocked_by).toBe('incomplete');
  });
});
