import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/http-app.js';
import { createDatabase, type Database } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { operatorDatabase, operatorFailure } from './operator-db.js';
import { notice, seedAttendanceRule, seedFill, seedRegrade, seedReportCards, seedResume, seedSchool, seedSchoolHead, seedSiteContent, type Call, type Person } from './seed/school.js';
import { staffNames } from './seed/people.js';
import { syntheticAccounts } from './seed/reset.js';

/**
 * Seeds a database with a Balili-shaped school of invented records. Temporary:
 * the go-live reset rebuilds the database without any of it.
 *
 *   npm run seed:test-data -- --rehearse
 *     The full school, against a throwaway in-memory database. Touches nothing shared.
 *
 *   SEED_CONFIRM=seed-production npm run seed:test-data -- --report-cards
 *     Adds Term 1's report cards, and the seeded attendance rule if no rule
 *     is recorded, to a database seeded before they were part of the seed. Refuses unless the seeded-data notice is there, writes as
 *     the seeded staff only, leaves alone a section a real account advises or
 *     one that already has records, and so can be run again if it stops.
 *
 *   SEED_CONFIRM=seed-production npm run seed:test-data -- --fill
 *     Fills what the seed left empty (13 October): the forms' heading, the
 *     synthetic staff's positions, the register up to yesterday, every term's
 *     grades with averages and general averages, observed values and comments,
 *     and an approved outcome for every learner. Only empty boxes, so it can run
 *     again; refuses unless the seeded-data notice is there. With --rehearse it
 *     runs after a throwaway seed.
 *
 *   SEED_CONFIRM=seed-production npm run seed:test-data
 *     The hosted database named by DATABASE_URL (the runtime login, as the API
 *     uses it) and MIGRATION_DATABASE_URL (the operator, for the parts no API
 *     call may do). Refuses unless migration 0025 is applied and the database
 *     holds no school year, section, learner, subject or policy yet.
 *
 * The operator writes exactly three kinds of thing: the synthetic sign-in
 * identities, the synthetic manager every change is attributed to, and the
 * seeded-data notice. Everything else goes through the API as that manager or
 * as a synthetic adviser, with the API's own validation, versions and history.
 * The identities have unroutable addresses under the reserved `.invalid` domain
 * and no password, so no one can sign in as them and no mail can reach anyone;
 * their domain is how the reset finds every one of them.
 */
const domain = 'balili-es.invalid';
const rehearse = process.argv.includes('--rehearse');
// A rehearsal may pretend it is another day, or seed a few learners per section, to reach a step quickly.
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const today = (rehearse && flag('today')) || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const scale = rehearse && process.argv.includes('--small') ? 'small' : 'full';
const started = Date.now();
const log = (message: string) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${message}`);

// Made-up names a school's staff list might carry; the banner, not the name, says they are invented.
const names = staffNames(30);
const loader: Person = { id: randomUUID(), name: seedSchoolHead };
const advisers: Person[] = names.slice(0, 27).map(n => ({ id: randomUUID(), name: n.name }));
const subjectTeachers: Person[] = names.slice(27).map(n => ({ id: randomUUID(), name: n.name }));
const everyone = [loader, ...advisers, ...subjectTeachers];
const email = (person: Person) => `${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@${domain}`;

type Operator = { query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>; close(): Promise<void> };

/** The checks that keep this from ever landing on a database with real school records in it. */
async function preflight(op: Operator) {
  const [marker] = await op.query("select to_regclass('edunexus.seeded_data_notice') is not null as ready");
  if (!marker?.ready) throw new Error('Apply migration 0025 first: npm run db:migrate');
  const [counts] = await op.query(`select
    (select count(*) from edunexus.seeded_data_notice)::int notices, (select count(*) from edunexus.academic_years)::int years,
    (select count(*) from edunexus.sections)::int sections, (select count(*) from edunexus.learners)::int learners,
    (select count(*) from edunexus.enrollments)::int enrollments, (select count(*) from edunexus.subjects)::int subjects,
    (select count(*) from edunexus.assessment_policy_drafts)::int policies, (select count(*) from edunexus.staff)::int staff`);
  console.log('Before seeding:', JSON.stringify(counts));
  if (Number(counts!.notices)) throw new Error('This database is already seeded. Reset it before seeding again.');
  for (const key of ['years', 'sections', 'learners', 'enrollments', 'subjects', 'policies']) {
    if (Number(counts![key])) throw new Error(`Refusing to seed: the database already holds ${key}. Seeding is only for a database with no school records.`);
  }
}

/** One synthetic sign-in identity per person, with every token column set so Supabase's own tools can list them. */
async function createIdentities(op: Operator) {
  const columns = new Set((await op.query("select column_name from information_schema.columns where table_schema='auth' and table_name='users'")).map(r => String(r.column_name)));
  const blank = ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'email_change', 'phone_change', 'phone_change_token', 'reauthentication_token'].filter(c => columns.has(c));
  for (const person of everyone) {
    const values: Record<string, unknown> = {
      id: person.id, instance_id: '00000000-0000-0000-0000-000000000000', aud: 'authenticated', role: 'authenticated', email: email(person),
      raw_app_meta_data: JSON.stringify({ provider: 'email', providers: ['email'], seeded: true }), raw_user_meta_data: JSON.stringify({ seeded: true }),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ...Object.fromEntries(blank.map(c => [c, ''])),
    };
    const keys = Object.keys(values).filter(k => columns.has(k));
    await op.query(`insert into auth.users (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map(k => values[k]));
  }
}

/** The API as seeded staff, retrying only what the API says recorded nothing. */
function asSeeded(op: Operator, database: Database, known: Set<string>) {
  const app = createApp({
    // Only the API's own errors, so a failed run says why; a request log for a whole school would bury it.
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
        // A refused rate limit and a busy database both mean nothing was recorded, so the same request may go again.
        if (code === 'RATE_LIMITED' && attempt < 5) { await op.query('delete from edunexus.request_buckets where user_id=$1', [actor]); continue; }
        // A busy lock, or one held by a transaction orphaned by a dropped connection until the server notices: wait it out.
        if (code === 'RETRY_REQUIRED' && attempt < 14) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
        // A dropped or busy database connection: usually nothing was committed, so the request goes again.
        if ((code === 'SERVICE_UNAVAILABLE' || response.status === 503) && attempt < 6) { dropped = true; await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        // Unless the connection dropped after the commit: then the write is there already and its retry is refused as a
        // duplicate or as changing nothing. That write is done; the caller looks up what it needs from it.
        if (dropped && method !== 'get' && response.status === 409) { log(`  ${method.toUpperCase()} ${path}: already recorded before the connection dropped`); return null; }
        throw new Error(`${method.toUpperCase()} ${path}: ${response.status} ${JSON.stringify(response.body?.error ?? response.body)}`);
      }
    };
    return { get: path => send('get', path), post: (path, body) => send('post', path, body), patch: (path, body) => send('patch', path, body) };
  };
}

/** Term 1's report cards for a school seeded before they were part of the seed. */
async function topUp(op: Operator, database: Database) {
  const [state] = await op.query('select (select count(*) from edunexus.seeded_data_notice)::int notices');
  if (!Number(state!.notices)) throw new Error('No seeded-data notice: refusing to add invented records to a database whose records may be real.');
  const seeded = await op.query(`select s.user_id::text id, s.display_name, s.role::text from edunexus.staff s join auth.users u on u.id=s.user_id where ${syntheticAccounts('u.email')}`);
  const seedLoader = seeded.find(s => s.role === 'principal');
  if (!seedLoader) throw new Error('The seed loader is missing; this database was not seeded by this script.');
  const ids = new Set(seeded.map(s => String(s.id)));
  const as = asSeeded(op, database, ids);
  await seedReportCards({ loader: String(seedLoader.id), parallel: 6, as, log, seeded: id => ids.has(id) });
  await seedAttendanceRule({ loader: String(seedLoader.id), as, log });
  await seedSiteContent({ loader: String(seedLoader.id), as, log });
  const [after] = await op.query('select (select count(*) from edunexus.report_grades)::int grades, (select count(*) from edunexus.report_notes)::int notes, (select count(*) from edunexus.report_values)::int marks');
  log(`Done: ${JSON.stringify(after)}`);
}

/** What the first seed left empty, filled on the user's instruction of 13 October. */
async function fill(op: Operator, database: Database) {
  const [state] = await op.query('select (select count(*) from edunexus.seeded_data_notice)::int notices');
  if (!Number(state!.notices)) throw new Error('No seeded-data notice: refusing to add invented records to a database whose records may be real.');
  const seeded = await op.query(`select s.user_id::text id, s.role::text from edunexus.staff s join auth.users u on u.id=s.user_id where ${syntheticAccounts('u.email')}`);
  const seedLoader = seeded.find(s => s.role === 'principal');
  if (!seedLoader) throw new Error('The seed loader is missing; this database was not seeded by this script.');
  const ids = new Set(seeded.map(s => String(s.id)));
  await seedFill({ loader: String(seedLoader.id), today, parallel: 6, as: asSeeded(op, database, ids), log, seeded: id => ids.has(id) });
  const [after] = await op.query(`select (select count(*) from edunexus.report_grades)::int grades, (select count(*) from edunexus.report_summaries)::int general_averages,
    (select count(*) from edunexus.promotion_decisions where status='approved')::int approved, (select count(*) from edunexus.attendance_marks)::int marks`);
  log(`Done: ${JSON.stringify(after)}`);
}

/** A full seed that stopped after its register: everything after it, skipping what is there (13 October). */
async function resume(op: Operator, database: Database) {
  const [state] = await op.query('select (select count(*) from edunexus.seeded_data_notice)::int notices');
  if (!Number(state!.notices)) throw new Error('No seeded-data notice: refusing to add invented records to a database whose records may be real.');
  const seeded = await op.query(`select s.user_id::text id, s.role::text from edunexus.staff s join auth.users u on u.id=s.user_id where ${syntheticAccounts('u.email')}`);
  const seedLoader = seeded.find(s => s.role === 'principal');
  if (!seedLoader) throw new Error('The seed loader is missing; this database was not seeded by this script.');
  const as = asSeeded(op, database, new Set(seeded.map(s => String(s.id))));
  const result = await seedResume({ loader: String(seedLoader.id), advisers: [], subjectTeachers: [], today, scale, parallel: 3, as, log });
  await linkRealTeachers(op, as, String(seedLoader.id), result.year);
  const [after] = await op.query(`select (select count(*) from edunexus.report_grades)::int grades, (select count(*) from edunexus.report_summaries)::int general_averages,
    (select count(*) from edunexus.promotion_decisions where status='approved')::int approved, (select count(*) from edunexus.attendance_followups)::int follow_ups`);
  log(`Done: ${JSON.stringify(after)}`);
}

/** Every grade, average and outcome recorded again under the current grade model (13 October). */
async function regrade(op: Operator, database: Database) {
  const [state] = await op.query('select (select count(*) from edunexus.seeded_data_notice)::int notices');
  if (!Number(state!.notices)) throw new Error('No seeded-data notice: refusing to change records that may be real.');
  const seeded = await op.query(`select s.user_id::text id, s.role::text from edunexus.staff s join auth.users u on u.id=s.user_id where ${syntheticAccounts('u.email')}`);
  const seedLoader = seeded.find(s => s.role === 'principal');
  if (!seedLoader) throw new Error('The seed loader is missing; this database was not seeded by this script.');
  await seedRegrade({ loader: String(seedLoader.id), advisers: [], subjectTeachers: [], today, scale, parallel: 3, as: asSeeded(op, database, new Set(seeded.map(s => String(s.id)))), log });
  const [after] = await op.query(`select (select count(*) from edunexus.report_summaries where general_average < 75)::int below_75,
    (select count(*) from edunexus.promotion_decisions where action='retained')::int retained, (select count(*) from edunexus.promotion_decisions where status='approved')::int approved`);
  log(`Done: ${JSON.stringify(after)}`);
}

/** A real teacher account testing the system advises a Grade 4 section, as it did before the seed was rebuilt. */
async function linkRealTeachers(op: Operator, as: (actor: string) => Call, loaderId: string, year: string) {
  const real = await op.query(`select s.user_id::text id from edunexus.staff s join auth.users u on u.id=s.user_id where s.role='teacher' and s.active and not ${syntheticAccounts('u.email')} order by s.created_at`);
  const grade4 = (await as(loaderId).get(`/sections?academic_year_id=${year}&limit=100`)).items.filter((s: { grade_level: number }) => s.grade_level === 4)
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  for (const [i, teacher] of real.entries()) {
    const section = grade4[i];
    if (!section || section.adviser_user_id === teacher.id) continue;
    await as(loaderId).patch(`/sections/${section.id}`, { version: section.version, adviser_user_id: teacher.id });
    log(`Grade 4-${section.name} is advised by a real teacher account`);
  }
}

async function run(op: Operator, database: Database, identities: (op: Operator) => Promise<void>) {
  await preflight(op);
  log(`Creating ${everyone.length} synthetic identities, the seed loader and the notice`);
  await op.query('begin');
  try {
    await identities(op);
    await op.query("select set_config('edunexus.actor_id',$1,true), set_config('edunexus.request_id',$2,true)", [loader.id, randomUUID()]);
    await op.query("insert into edunexus.staff (user_id,display_name,role) values ($1,$2,'principal')", [loader.id, loader.name]);
    await op.query('insert into edunexus.seeded_data_notice (note) values ($1)', [notice]);
    await op.query('commit');
  } catch (error) { await op.query('rollback'); throw error; }

  const as = asSeeded(op, database, new Set(everyone.map(p => p.id)));
  const result = await seedSchool({ loader: loader.id, loaderName: loader.name, advisers, subjectTeachers, today, scale, parallel: rehearse ? 6 : 3, as, log });
  await linkRealTeachers(op, as, loader.id, result.year);
  const [after] = await op.query(`select (select count(*) from edunexus.sections)::int sections, (select count(*) from edunexus.enrollments)::int enrollments,
    (select count(*) from edunexus.attendance_marks)::int marks, (select count(*) from edunexus.subjects)::int subjects, (select count(*) from edunexus.assessment_scores)::int scores`);
  log(`Done: ${JSON.stringify({ ...result, ...after })}`);
}

if (rehearse) {
  const { testDatabase } = await import('../tests/helpers/database.js');
  const db = await testDatabase();
  // `pg.query` answers with the rows themselves, not a result object, so there
  // is no `.rows` to reach for. It changed when tests/helpers/database.ts was
  // rebuilt after the recovery, and this was the one caller left behind.
  const op: Operator = { async query(text, params) { return db.pg.query<Record<string, unknown>>(text, params); }, close: async () => {} };
  // The test fixture's auth.users holds an id and nothing else.
  try {
    // Hosted, auth.users carries the address the fill tells synthetic staff apart by; the fixture's carries an id only.
    await op.query('alter table auth.users add column if not exists email text');
    await run(op, db.database, async o => { for (const p of everyone) await o.query('insert into auth.users(id,email) values ($1,$2)', [p.id, email(p)]); });
    if (process.argv.includes('--fill')) await fill(op, db.database);
  }
  finally { await db.database.close(); }
} else {
  if (process.env.SEED_CONFIRM !== 'seed-production') {
    console.error('This writes invented records into the hosted database. Rehearse with --rehearse, or set SEED_CONFIRM=seed-production to run it for real.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL, the runtime login the API itself uses.'); process.exit(1); }
  const sql = operatorDatabase();
  const reserved = await sql.reserve();
  const op: Operator = { async query(text, params = []) { return [...await reserved.unsafe(text, params as never[])] as Record<string, unknown>[]; }, close: async () => { reserved.release(); await sql.end({ timeout: 5 }); } };
  // Four connections, not eight: over an unsteady link the pooler drops fewer, and the seed spends less time recovering.
  const database = createDatabase(process.env.DATABASE_URL, process.env.DATABASE_SSL !== 'false', 4);
  try { await (process.argv.includes('--regrade') ? regrade(op, database) : process.argv.includes('--resume') ? resume(op, database) : process.argv.includes('--fill') ? fill(op, database) : process.argv.includes('--report-cards') ? topUp(op, database) : run(op, database, createIdentities)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); operatorFailure(error); }
  finally { await database.close(); await op.close(); }
}
