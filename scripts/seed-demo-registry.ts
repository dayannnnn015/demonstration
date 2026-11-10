import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/http-app.js';
import { createDatabase, type Database } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { operatorDatabase, operatorFailure } from './operator-db.js';
import { children, lrn, random, type Family } from './seed/people.js';
import { syntheticAccounts } from './seed/reset.js';
import type { Call } from './seed/school.js';

/**
 * A demonstration registry: learner profiles, one class per grade, and the
 * school year those classes sit in. Deliberately **not** the demonstration
 * itself.
 *
 *   npm run seed:demo-registry -- --rehearse
 *     Against a throwaway in-memory database. Touches nothing shared.
 *
 *   SEED_CONFIRM=seed-demo-registry npm run seed:demo-registry
 *     The hosted database named by DATABASE_URL (the runtime login, as the API
 *     uses it) and MIGRATION_DATABASE_URL (the operator, for the parts no API
 *     call may do). Refuses unless the database holds no school year, section,
 *     learner or enrolment, so it only ever lands on a freshly reset database.
 *
 * ## What it creates, and why each piece has to be here
 *
 * The request was learner profiles only, with no enrolment and no class. Two
 * facts about the schema make that impossible to take literally:
 *
 * 1. **`edunexus.learners` carries no grade level.** Name, LRN, birth date,
 *    sex, address and guardian are the whole profile; a learner is "in Grade 3"
 *    only by way of an enrolment. A registry of bare profiles therefore has no
 *    grade distribution at all, so "learners across Kinder to Grade 6" can only
 *    mean a birth-date cohort per grade.
 * 2. **Promotion is keyed on an enrolment.** `promotion_decisions.enrollment_id`
 *    references one, `promotion_section` refuses a *closed* year (`P1900`), and
 *    `next_year_pair` wants the target year to be `source.start_year + 1`. So
 *    demonstrating promotion needs a source year that is **active**, with
 *    classes holding learners to promote out of.
 *
 * So this seeds the thing promotion promotes *from*, and stops there: the
 * source year, its three terms, one class per grade, and the learners in them.
 *
 * ## What it deliberately does not create
 *
 * Nothing the operator said they would demonstrate themselves: no next school
 * year, no promotion recommendation or decision, no next-year placement, no
 * adviser pull. Nor anything that would be inventing school policy or school
 * records: no subject catalogue (`web/learning-areas.ts` is a proposal a
 * manager reviews, never a seed), no attendance day rule (the principal records
 * it), no instructional calendar, no attendance mark, no grade, no report card,
 * no public-site content, and no school head on the forms' heading.
 *
 * Every record is attributed to one synthetic principal under the reserved
 * `.invalid` domain, so `npm run reset:seeded-data` finds and removes it, and
 * so no invented record is ever journalled under a real person's name. It has
 * no password and its address is unroutable, so no one can sign in as it.
 */
const domain = 'balili-es.invalid';
const rehearse = process.argv.includes('--rehearse');
/**
 * Rehearsal only: after seeding a throwaway database, walk the five operations
 * the operator intends to demonstrate, so the seed is known to support them
 * before a demonstration depends on it. Refused outside `--rehearse`, because
 * running it is exactly what the operator asked not be done for them.
 */
const prove = rehearse && process.argv.includes('--prove');
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const perGrade = Number(flag('per-grade') ?? 10);
const admissions = Number(flag('new') ?? 10);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const started = Date.now();
const log = (message: string) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${message}`);

const grades = [0, 1, 2, 3, 4, 5, 6];
const gradeName = (g: number) => (g === 0 ? 'Kinder' : `Grade ${g}`);
/**
 * The source year is **2025-2026**, not the current one, and the reason is the
 * demonstration's fourth step. An adviser taking a learner into a class goes
 * through `move_enrollment`, which refuses a movement dated in the future
 * ("movement must advance the timeline within an open year and cannot be future
 * dated"). So the year the operator creates and pulls into has to be a year
 * that contains today. Seeding 2025-2026 makes the year they create 2026-2027,
 * which does — `next_year_pair` requires the target to be exactly
 * `source.start_year + 1`. Seeding the current year instead would push the new
 * year to 2027-2028, and every pull into it would be refused until June 2027.
 */
const sourceStartYear = 2025;
const yearStart = '2025-06-09', yearEnd = '2026-04-10';
const terms = [['Term 1', '2025-06-09', '2025-09-16'], ['Term 2', '2025-09-17', '2025-12-19'], ['Term 3', '2026-01-05', '2026-04-10']] as const;

/** The loader: one synthetic principal, named so no screen can mistake it for a real member of staff. */
const loader = { id: randomUUID(), name: 'Demo Setup (seeded data)' };
const loaderEmail = `demo.setup@${domain}`;
const notice = 'Every learner here is invented for a demonstration, and will be wiped before EDUNEXUS holds real records.';

/** Barangays of La Trinidad, so an address reads like one the school would hold. One line, as 0053 requires. */
const barangays = ['Alapang', 'Alno', 'Ambiong', 'Bahong', 'Balili', 'Beckel', 'Betag', 'Bineng', 'Cruz', 'Lubas', 'Pico', 'Poblacion', 'Puguis', 'Shilan', 'Tawang', 'Wangal'];
const guardianWomen = ['Marilou', 'Jocelyn', 'Esperanza', 'Rowena', 'Marites', 'Lorna', 'Elena', 'Cristina', 'Nenita', 'Perlita', 'Araceli', 'Remedios'];
const guardianMen = ['Rodolfo', 'Alfredo', 'Eduardo', 'Nestor', 'Virgilio', 'Rolando', 'Edgardo', 'Bernardo', 'Marcelo', 'Teodoro'];

type Operator = { query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>; close(): Promise<void> };
type Seeded = { first: string; middle: string | null; last: string; extension: string | null; sex: 'female' | 'male'; birth: string; lrn: string; address: string | null; guardian_name: string | null; guardian_contact: string | null };

/** Keeps this off any database that might hold a real record, and off one already seeded. */
async function preflight(op: Operator) {
  const [marker] = await op.query("select to_regclass('edunexus.seeded_data_notice') is not null as ready");
  if (!marker?.ready) throw new Error('Apply migration 0025 first: npm run db:migrate');
  const [counts] = await op.query(`select
    (select count(*) from edunexus.seeded_data_notice)::int notices, (select count(*) from edunexus.academic_years)::int years,
    (select count(*) from edunexus.sections)::int sections, (select count(*) from edunexus.learners)::int learners,
    (select count(*) from edunexus.enrollments)::int enrollments, (select count(*) from edunexus.staff)::int staff`);
  console.log('Before seeding:', JSON.stringify(counts));
  if (Number(counts!.notices)) throw new Error('This database is already seeded. Reset it first: RESET_CONFIRM=wipe-seeded-data npm run reset:seeded-data');
  for (const key of ['years', 'sections', 'learners', 'enrollments']) {
    if (Number(counts![key])) throw new Error(`Refusing to seed: the database already holds ${key}. This only runs on a database with no school records.`);
  }
  return Number(counts!.staff);
}

/** The API as the loader, retrying only what the API says recorded nothing. */
function asLoader(op: Operator, database: Database, known: Set<string>) {
  const app = createApp({
    database, logger: pino({ level: 'error' }, pino.destination(2)), origins: [],
    auth: { async verify(token) { if (!known.has(token)) throw new AppError(401, 'AUTH_REQUIRED', 'Not a seeded identity.'); return { userId: token }; } },
  });
  return (actor: string): Call => {
    const send = async (method: 'get' | 'post' | 'patch', path: string, body?: object) => {
      let dropped = false;
      for (let attempt = 0; ; attempt++) {
        let call = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${actor}`);
        if (body) call = call.send(body);
        const response = await call;
        if (response.status < 300) return response.body.data;
        const code = response.body?.error?.code;
        if (code === 'RATE_LIMITED' && attempt < 5) { await op.query('delete from edunexus.request_buckets where user_id=$1', [actor]); continue; }
        if (code === 'RETRY_REQUIRED' && attempt < 14) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
        if ((code === 'SERVICE_UNAVAILABLE' || response.status === 503) && attempt < 6) { dropped = true; await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        if (dropped && method !== 'get' && response.status === 409) { log(`  ${method.toUpperCase()} ${path}: already recorded before the connection dropped`); return null; }
        throw new Error(`${method.toUpperCase()} ${path}: ${response.status} ${JSON.stringify(response.body?.error ?? response.body)}`);
      }
    };
    return { get: path => send('get', path), post: (path, body) => send('post', path, body), patch: (path, body) => send('patch', path, body) };
  };
}

/**
 * The learners of one grade, as profiles ready to register. `children` gives the
 * names and a birth date in the right band for the grade; the identity key is
 * checked against every learner already generated, because two learners of the
 * same name and birth date are the duplicate the registry refuses.
 */
function profiles(grade: number, count: number, families: Family[], taken: Set<string>, sequence: () => number, salt = 0): Seeded[] {
  const next = random(20261106 + grade * 17 + salt);
  const out: Seeded[] = [];
  // `children` dates a birth so the learner is the right age for that grade in
  // SY 2026-2027. These learners sit a year earlier, in 2025-2026, so the cohort
  // asked for is one grade up: that puts them the right age for `grade` now, and
  // the right age again for `grade + 1` once the operator promotes them.
  const cohort = grade + 1;
  // Asks for more than it needs: a repeated identity is dropped rather than renamed.
  for (const child of children(cohort, count * 4 + 8, families, 20261106 + grade + salt)) {
    if (out.length >= count) break;
    const key = `${child.first}|${child.middle ?? ''}|${child.last}|${child.birth}`.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    // A fifth of the learners have no address on file, and a sixth no guardian: `Unrecorded` has something to draw.
    const hasAddress = next() > 0.2, hasGuardian = next() > 0.16;
    const guardianFirst = next() < 0.7 ? guardianWomen[Math.floor(next() * guardianWomen.length)]! : guardianMen[Math.floor(next() * guardianMen.length)]!;
    out.push({
      first: child.first, middle: child.middle, last: child.last, extension: child.extension, sex: child.sex, birth: child.birth,
      lrn: lrn(cohort, sequence()),
      address: hasAddress ? `${1 + Math.floor(next() * 240)} ${barangays[Math.floor(next() * barangays.length)]}, La Trinidad, Benguet` : null,
      guardian_name: hasGuardian ? `${guardianFirst} ${child.last}` : null,
      guardian_contact: hasGuardian ? `09${String(10 + Math.floor(next() * 89))}${String(Math.floor(next() * 10000000)).padStart(7, '0')}` : null,
    });
  }
  if (out.length < count) throw new Error(`Could not generate ${count} distinct learners for ${gradeName(grade)}.`);
  return out;
}

async function seed(op: Operator, database: Database) {
  const keptStaff = await preflight(op);
  log(`Creating the seed loader and the seeded-data notice (${keptStaff} real staff accounts stay as they are)`);
  await op.query('begin');
  try {
    await op.query("select set_config('edunexus.actor_id',$1,true), set_config('edunexus.request_id',$2,true)", [loader.id, randomUUID()]);
    await op.query("insert into edunexus.staff (user_id,display_name,role) values ($1,$2,'principal')", [loader.id, loader.name]);
    await op.query('insert into edunexus.seeded_data_notice (note) values ($1)', [notice]);
    await op.query('commit');
  } catch (error) { await op.query('rollback'); throw error; }

  // Only a rehearsal that proves the demonstration path may act as anyone but the loader.
  const others = prove ? (await op.query('select user_id::text id from edunexus.staff')).map(r => String(r.id)) : [];
  const as = asLoader(op, database, new Set([loader.id, ...others]));
  const api = as(loader.id);

  log(`School year ${sourceStartYear}-${sourceStartYear + 1} and its three terms, left active as the year to promote out of`);
  const year = await api.post('/academic-years', { start_year: sourceStartYear, starts_on: yearStart, ends_on: yearEnd })
    ?? (await api.get('/academic-years')).items.find((y: { start_year: number }) => y.start_year === sourceStartYear);
  for (const [index, [name, from, to]] of terms.entries()) {
    await api.post(`/academic-years/${year.id}/periods`, { ordinal: index + 1, name, starts_on: from, ends_on: to })
      ?? (await api.get(`/academic-years/${year.id}/periods`)).items.find((p: { ordinal: number }) => p.ordinal === index + 1);
  }
  await api.patch(`/academic-years/${year.id}/status`, { version: year.version, status: 'active' });

  log('One class per grade, Kinder to Grade 6');
  const sections = new Map<number, { id: string; version: number }>();
  for (const grade of grades) {
    const row = await api.post('/sections', { academic_year_id: year.id, grade_level: grade, name: 'A', adviser_user_id: null })
      ?? (await api.get(`/sections?academic_year_id=${year.id}&limit=100`)).items.find((s: { grade_level: number; name: string }) => s.grade_level === grade && s.name === 'A');
    sections.set(grade, { id: row.id, version: row.version });
  }

  // Every class gets the one real teacher account as its adviser, and the reason is
  // not cosmetic: `promotionsRecommend` refuses anyone whose role is not `teacher`
  // (src/modules/report-records/service.ts), so a class with no adviser has no one
  // who may endorse an outcome, and its learners could not be promoted at all. No
  // teacher is invented to spread the load, because an invented account would show
  // up in the staff list and would have to be wiped again. Reassign them freely
  // once the school's own teacher accounts exist.
  const real = await op.query(`select s.user_id::text id, s.display_name from edunexus.staff s join auth.users u on u.id=s.user_id
    where s.role='teacher' and s.active and not ${syntheticAccounts('u.email')} order by s.created_at`);
  let advised: string | null = null;
  if (real[0]) {
    for (const grade of grades) {
      const section = sections.get(grade)!;
      const saved = await api.patch(`/sections/${section.id}`, { version: section.version, adviser_user_id: real[0].id });
      if (saved?.version) section.version = saved.version;
    }
    advised = String(real[0].display_name);
    log(`Every class is advised by the real teacher account ${advised}, so outcomes can be endorsed`);
  } else log('No real teacher account: every class is left unadvised, and NO learner can be promoted until one advises it.');

  log(`Learner profiles: ${perGrade} per grade enrolled, ${admissions} registered and not enrolled`);
  const families: Family[] = [];
  const taken = new Set<string>();
  const counters = new Map<number, number>();
  const sequence = (grade: number) => () => { const n = (counters.get(grade) ?? 0) + 1; counters.set(grade, n); return n; };
  const distribution = new Map<number, number>();

  for (const grade of grades) {
    const section = sections.get(grade)!;
    for (const p of profiles(grade, perGrade, families, taken, sequence(grade))) {
      const body = { first_name: p.first, middle_name: p.middle, last_name: p.last, name_extension: p.extension, birth_date: p.birth, sex: p.sex, lrn: p.lrn, address: p.address, guardian_name: p.guardian_name, guardian_contact: p.guardian_contact };
      const learner = await api.post('/learners', body)
        ?? (await api.get(`/learners?lrn=${p.lrn}&limit=10`)).items[0];
      await api.post('/enrollments', { learner_id: learner.id, section_id: section.id, enrolled_on: yearStart, entry_kind: 'regular' })
        ?? (await api.get(`/enrollments?learner_id=${learner.id}&limit=10`)).items[0];
    }
    distribution.set(grade, perGrade);
    log(`  ${gradeName(grade)}: ${perGrade} enrolled in ${gradeName(grade)}-A`);
  }

  // Newly admitted learners: on the registry, in no school year and no class, so
  // enrolling them is the operator's to demonstrate. Their LRN sequence starts at
  // 500 so it can never collide with the enrolled cohort's.
  const admitted: string[] = [];
  for (const [i, grade] of grades.entries()) {
    const want = Math.floor(admissions / grades.length) + (i < admissions % grades.length ? 1 : 0);
    if (!want) continue;
    counters.set(grade, 500 + (counters.get(grade) ?? 0));
    for (const p of profiles(grade, want, families, taken, sequence(grade), 7717)) {
      const body = { first_name: p.first, middle_name: p.middle, last_name: p.last, name_extension: p.extension, birth_date: p.birth, sex: p.sex, lrn: p.lrn, address: p.address, guardian_name: p.guardian_name, guardian_contact: p.guardian_contact };
      const learner = await api.post('/learners', body) ?? (await api.get(`/learners?lrn=${p.lrn}&limit=10`)).items[0];
      admitted.push(learner.id);
    }
    log(`  ${gradeName(grade)} age cohort: ${want} registered, not enrolled`);
  }

  const [after] = await op.query(`select (select count(*) from edunexus.learners)::int learners, (select count(*) from edunexus.enrollments)::int enrollments,
    (select count(*) from edunexus.sections)::int sections, (select count(*) from edunexus.academic_years)::int years,
    (select count(*) from edunexus.promotion_decisions)::int promotions, (select count(*) from edunexus.attendance_marks)::int marks,
    (select count(*) from edunexus.report_grades)::int grades, (select count(*) from edunexus.subjects)::int subjects,
    (select count(*) from edunexus.staff)::int staff`);
  log(`Done: ${JSON.stringify(after)}`);
  log(`Not created, for the operator to demonstrate: next school year, promotion, next-year placement, adviser pull.`);
  if (advised) log(`Teacher-scoped reading can be shown as ${advised}, who advises every class in the source year.`);
  log(`${admitted.length} learners are on the registry with no enrolment, ready to be enrolled live.`);
  if (prove) await proveDemo(op, api, as, year.id, sections, real[0] ? String(real[0].id) : null);
}

/** Walks the five operations the operator intends to demonstrate. Rehearsal only. */
async function proveDemo(op: Operator, api: Call, as: (id: string) => Call, sourceYear: string, sections: Map<number, { id: string; version: number }>, teacher: string | null) {
  const why = 'Rehearsing the demonstration workflow against a throwaway database.';
  log('--- proving the demonstration workflow ---');

  log('1. Creating next school year 2026-2027 as a draft, the year that contains today');
  const target = await api.post('/academic-years', { start_year: 2026, starts_on: '2026-06-08', ends_on: '2027-04-08' });
  for (const [i, [name, from, to]] of [['Term 1', '2026-06-08', '2026-09-15'], ['Term 2', '2026-09-16', '2026-12-18'], ['Term 3', '2027-01-04', '2027-04-08']].entries())
    await api.post(`/academic-years/${target.id}/periods`, { ordinal: i + 1, name, starts_on: from, ends_on: to });

  log('2. Recommending as the adviser, approving as the principal');
  if (!teacher) { log('   cannot prove: no teacher account to endorse outcomes'); return; }
  const adviser = as(teacher);
  let approved = 0;
  for (const grade of grades) {
    const section = sections.get(grade)!;
    const roll = await api.get(`/enrollments?section_id=${section.id}&limit=100`);
    const ids = (roll.items as { id: string }[]).map(e => e.id);
    if (!ids.length) continue;
    const recommended = await adviser.post(`/sections/${section.id}/promotion-recommendations`, { entries: ids.map(id => ({ enrollment_id: id, action: 'promoted', version: 0 })), reason: why });
    await api.post(`/sections/${section.id}/promotion-decisions`, {
      entries: (recommended.entries as { enrollment_id: string; version: number }[]).map(e => ({ enrollment_id: e.enrollment_id, decision: 'approved', version: e.version })), reason: why,
    });
    approved += ids.length;
  }
  log(`   ${approved} outcomes approved`);

  log('3. Carrying them into next year (enrolled at the next grade, with no class)');
  const whole = await api.get(`/academic-years/${sourceYear}/next-year-classes?target_year_id=${target.id}&seed=0`);
  log(`   preview: ${whole.placements.length} to carry into ${JSON.stringify((whole.grades as { grade_level: number }[]).map(g => g.grade_level))}, ${whole.unplaced.length} left out (${JSON.stringify([...new Set((whole.unplaced as { reason: string }[]).map(u => u.reason))])})`);

  // One grade at a time, which is what the screen's grade filter sends and what
  // keeps this under `record_access_events`' cap of 100 record ids. Carrying
  // every grade at once writes two ids per learner and so breaks above 50
  // learners; that cap is a live defect, reported rather than worked around here.
  let carried = 0;
  for (const g of (whole.grades as { grade_level: number }[]).map(x => x.grade_level)) {
    const view = await api.get(`/academic-years/${sourceYear}/next-year-classes?target_year_id=${target.id}&seed=0&grade_level=${g}`);
    const done = await api.post(`/academic-years/${sourceYear}/next-year-classes`, { target_year_id: target.id, seed: 0, grade_level: g, review_hash: view.review_hash, reason: why });
    carried += Number(done.placed ?? 0);
    log(`   ${gradeName(g)}: carried ${done.placed}`);
  }
  log(`   carried ${carried} in all, each enrolled at their next grade with no class`);

  log('4. An adviser pulls a carried learner into their own class');
  if (!teacher) { log('   skipped: no real teacher account in this fixture'); }
  else {
    const next5 = await api.post('/sections', { academic_year_id: target.id, grade_level: 5, name: 'A', adviser_user_id: teacher });
    const mine = as(teacher);
    const pullable = await mine.get(`/sections/${next5.id}/pullable-learners?limit=50`);
    const first = (pullable.items as { learner_id: string; enrollment_version?: number }[])[0];
    if (!first) log('   nobody pullable; check the carried grade levels');
    else {
      await mine.post(`/sections/${next5.id}/pulls`, { learner_id: first.learner_id, enrolled_on: today, entry_kind: 'regular', ...(first.enrollment_version ? { version: first.enrollment_version } : {}) });
      log(`   pulled 1 of ${(pullable.items as unknown[]).length} pullable learners into ${gradeName(5)}-A`);
    }

    log('5. Verifying what each role can read');
    const asManager = await api.get(`/enrollments?academic_year_id=${target.id}&limit=100`);
    const asTeacher = await mine.get(`/enrollments?academic_year_id=${target.id}&limit=100`);
    log(`   manager reads ${asManager.items.length} enrolments next year; the adviser reads ${asTeacher.items.length}`);
    const [disclosed] = await op.query('select count(*)::int n from edunexus.record_access_events');
    log(`   ${disclosed?.n} record_access_events rows written, as every learner list must`);
  }
  log('--- the demonstration workflow is supported by this seed ---');
}

if (rehearse) {
  const { testDatabase } = await import('../tests/helpers/database.js');
  const db = await testDatabase();
  const op: Operator = { async query(text, params) { return db.pg.query<Record<string, unknown>>(text, params); }, close: async () => {} };
  try {
    await op.query('alter table auth.users add column if not exists email text');
    await op.query('insert into auth.users(id,email) values ($1,$2)', [loader.id, loaderEmail]);
    await seed(op, db.database);
  } finally { await db.database.close(); }
} else {
  if (process.env.SEED_CONFIRM !== 'seed-demo-registry') {
    console.error('This writes invented records into the hosted database. Rehearse with --rehearse, or set SEED_CONFIRM=seed-demo-registry to run it for real.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL, the runtime login the API itself uses.'); process.exit(1); }
  const sql = operatorDatabase();
  const reserved = await sql.reserve();
  const op: Operator = { async query(text, params = []) { return [...await reserved.unsafe(text, params as never[])] as Record<string, unknown>[]; }, close: async () => { reserved.release(); await sql.end({ timeout: 5 }); } };
  const database = createDatabase(process.env.DATABASE_URL, process.env.DATABASE_SSL !== 'false', 4);
  try {
    // One synthetic sign-in identity, with every token column set so Supabase's own tools can list it.
    const columns = new Set((await op.query("select column_name from information_schema.columns where table_schema='auth' and table_name='users'")).map(r => String(r.column_name)));
    const blank = ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'email_change', 'phone_change', 'phone_change_token', 'reauthentication_token'].filter(c => columns.has(c));
    const values: Record<string, unknown> = {
      id: loader.id, instance_id: '00000000-0000-0000-0000-000000000000', aud: 'authenticated', role: 'authenticated', email: loaderEmail,
      raw_app_meta_data: JSON.stringify({ provider: 'email', providers: ['email'], seeded: true }), raw_user_meta_data: JSON.stringify({ seeded: true }),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...Object.fromEntries(blank.map(c => [c, ''])),
    };
    const keys = Object.keys(values).filter(k => columns.has(k));
    await op.query(`insert into auth.users (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map(k => values[k]));
    await seed(op, database);
  }
  catch (error) { console.error(error instanceof Error ? error.message : error); operatorFailure(error); }
  finally { await database.close(); await op.close(); }
}
