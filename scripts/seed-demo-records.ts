import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/http-app.js';
import { createDatabase, type Database } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { operatorDatabase, operatorFailure } from './operator-db.js';
import { clamp, comment, narratives, normal, random, staffNames, termGrade, valueMark, type Traits } from './seed/people.js';
import { syntheticAccounts } from './seed/reset.js';
import type { Call } from './seed/school.js';
import { cardFor, gradesOf, lineOf, reportCardAreas } from '../web/learning-areas.js';

/**
 * Academic records for a database already seeded as a demonstration registry.
 *
 *   npm run seed:demo-records -- --rehearse
 *     Builds a throwaway demonstration registry in memory and tops it up, so
 *     the whole run is proved end to end without touching anything shared.
 *
 *   SEED_CONFIRM=seed-demo-records npm run seed:demo-records
 *     The hosted database named by DATABASE_URL (the runtime login, as the API
 *     uses it) and MIGRATION_DATABASE_URL (the operator, for the identities no
 *     API call may create).
 *
 * ## What this is for
 *
 * `seed:demo-registry` seeds the thing promotion promotes *from*: a source
 * school year, one class per grade, and the learners in them. It deliberately
 * stops before any academic record. This adds the records — asked for on
 * 2026-11-06 — so the demonstration has an SF9 to print, an SF10 with a
 * cumulative history behind it, an SF2 with a month of register behind it, and
 * every registered learner in a class.
 *
 * It is a **top-up**: every step reads what is there first and writes only what
 * is missing, so it can be run again after a failure, and run a part at a time
 * with `--parts=`.
 *
 * ## Who writes what, and why it has to be that way
 *
 * The API — not the database — decides who may enter a class record, and since
 * 2026-11-06 a manager is review-only: `src/modules/report-records/service.ts`
 * refuses grades, general averages, observed values, narratives and promotion
 * endorsements to anyone whose role is not `teacher`. The database function
 * `report_section_for_write` would allow a manager; the API is the authority and
 * every record here goes through the API, so a grade can only be entered by the
 * section's own adviser.
 *
 * The demonstration registry gave every class to **the one real teacher
 * account**, so that teacher-scoped reading could be shown. Writing invented
 * grades as that person would journal invented records under a real member of
 * staff's name, which this project does not do. So:
 *
 * 1. one synthetic adviser per class is created under the reserved `.invalid`
 *    domain, with no password and an unroutable address;
 * 2. each class is handed to its synthetic adviser, who enters that class's
 *    register, grades, comments, observed values and endorsement;
 * 3. every class is handed back to the real teacher account at the end.
 *
 * The journal therefore names a synthetic adviser for every invented record,
 * the demonstration still shows a real teacher reading their own classes, and
 * `npm run reset:seeded-data` removes the synthetic accounts with the rest.
 *
 * ## What it will not seed, and why
 *
 * - **No Kindergarten grade or Kinder card.** The Kindergarten assessment
 *   policy gate in `docs/constraints.md` is shut: numeric Kindergarten grading
 *   and Kinder report output need an approved school policy. `P1901` refuses it
 *   at the database too. Kinder classes get the register and an outcome only.
 * - **No assessment policy, weighting, task or score.** The grading-enclosure
 *   gate blocks component arithmetic, and a policy draft is a statement about
 *   how the school grades. Nothing here implies one.
 * - **No school profile change.** The hosted school profile holds the school's
 *   own real details; a seed does not touch them, so the forms' heading stays
 *   whatever the school entered.
 * - **No public-site content.** The front page is readable by anyone, so
 *   publishing invented notices there is not a side effect of seeding records.
 *   `--site` asks for it explicitly.
 * - **No holiday list.** Which days the school closed in SY 2025-2026 is the
 *   school's own record and is not invented here: the calendar marks weekdays
 *   as class days, weekends as weekends, and the gap between Term 2 and Term 3
 *   as the year-end break.
 *
 * Grades are invented the way a class record would show them, which is what an
 * adviser types from the ECR. EDUNEXUS still computes no grade anywhere.
 */
const domain = 'balili-es.invalid';
const rehearse = process.argv.includes('--rehearse');
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const everyPart = ['terms', 'advisers', 'sections', 'subjects', 'calendar', 'rule', 'register', 'months', 'cards', 'outcomes', 'prior', 'followups', 'restore'] as const;
type Part = typeof everyPart[number];
const asked = (flag('parts') ?? 'all').split(',').map(s => s.trim()).filter(Boolean);
for (const part of asked) if (part !== 'all' && !everyPart.includes(part as Part)) {
  console.error(`Unknown part "${part}". Parts: ${everyPart.join(', ')}`);
  process.exit(1);
}
const doing = (part: Part) => asked.includes('all') || asked.includes(part);
/** How many months of register to mark, from the start of the year. The whole year is thousands of requests. */
const registerMonths = Number(flag('register-months') ?? 2);
/** Outcomes are endorsed by the adviser and left waiting, so the principal's approval is still theirs to demonstrate. */
const approve = process.argv.includes('--approve');
const site = process.argv.includes('--site');
const parallel = Number(flag('parallel') ?? 4);
const started = Date.now();
const log = (message: string) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${message}`);

/** The reasons a school's own staff would give. The demonstration year is SY 2025-2026. */
const reasons = {
  setup: 'Demonstration setup for SY 2025-2026 from the school records.',
  calendar: 'School calendar for SY 2025-2026: class days, weekends and the year-end break.',
  register: 'Daily attendance taken in class.',
  submit: 'Month checked and submitted to the principal for the SF4.',
  lock: 'SF2 checked and signed by the principal.',
  grades: 'Transcribed from the class record (ECR).',
  values: 'Observed values for the term, from class observation.',
  notes: 'Comments for the progress report.',
  outcome: 'End-of-year outcome from the final grades.',
  approve: 'Checked against the class record and approved.',
  subjects: 'Learning areas printed on the school report cards.',
  rule: 'Agreed at the faculty meeting: a learner present for one session is marked tardy, as the SF2 codes show.',
  prior: 'Transcribed for the demonstration from the learner’s permanent record.',
  followup: 'Absent five consecutive days; the adviser is visiting the home.',
  enrol: 'Registered learner placed in the class for the demonstration.',
  adviser: 'Adviser recorded for the demonstration records.',
};
/** What the prior-year `source` field says. It names no document, because none exists. */
const priorSource = 'Invented for the EDUNEXUS demonstration; there is no source document behind this record.';

type Operator = { query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>; close(): Promise<void> };
type Section = { id: string; grade: number; name: string; adviser: string | null; version: number };
type Member = { enrollment: string; learner: string; lrn: string | null; first: string; sex: 'female' | 'male'; traits: Traits };

const gradeName = (g: number) => (g === 0 ? 'Kinder' : `Grade ${g}`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); iso(d) <= to; d = new Date(d.getTime() + 86400000)) out.push(iso(d));
  return out;
};
const weekend = (day: string) => { const w = new Date(`${day}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };

/** Runs `work` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; await work(items[index]!, index); }
  }));
}

/**
 * A write whose refusal means it was already recorded.
 *
 * Every reviewed writer here refuses a change that changes nothing —
 * `CALENDAR_UNCHANGED` (`P0501`), `ATTENDANCE_UNCHANGED` (`P0604`),
 * `NO_CHANGES` (`P1904`) — which is right for a person and exactly what a
 * top-up run meets on everything it wrote the first time. Treated as "already
 * there" rather than as a failure, so this can be run again after it stops.
 */
const alreadyThere = /CALENDAR_UNCHANGED|ATTENDANCE_UNCHANGED|NO_CHANGES/;
async function already<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch (error) { if (alreadyThere.test((error as Error).message)) return null; throw error; }
}

/** A stable number from a string, so one learner's traits are the same on every run. */
const hash = (text: string) => { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * One learner's hidden traits, drawn exactly as `children()` draws them but
 * keyed off the learner's own LRN instead of the generator's position. The
 * demonstration registry did not keep the traits it drew, and a record has to
 * agree with itself: the learner who is often absent is the one whose grades
 * are lower, whose observed values are marked lower and whose comment says so.
 */
function traitsFor(key: string): Traits {
  const next = random(hash(key));
  const ability = normal(next);
  const struggle = clamp(-ability, -1.5, 2.5);
  const chronic = next() < 0.05 + (struggle > 1 ? 0.07 : 0);
  const absence = clamp(0.018 + 0.012 * normal(next) + 0.008 * struggle + (chronic ? 0.07 + next() * 0.06 : 0), 0.002, 0.25);
  return { ability, absence, late: clamp(0.006 + 0.006 * normal(next) + (chronic ? 0.01 : 0), 0, 0.05), streak: chronic && next() < 0.5, overage: false };
}

/** The API as a seeded account, retrying only what the API says recorded nothing. */
function asSeeded(op: Operator, database: Database, known: Set<string>) {
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

/** One synthetic sign-in identity, with every token column set so Supabase's own tools can list it. */
async function createIdentity(op: Operator, id: string, address: string) {
  const columns = new Set((await op.query("select column_name from information_schema.columns where table_schema='auth' and table_name='users'")).map(r => String(r.column_name)));
  const blank = ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'email_change', 'phone_change', 'phone_change_token', 'reauthentication_token'].filter(c => columns.has(c));
  const values: Record<string, unknown> = {
    id, instance_id: '00000000-0000-0000-0000-000000000000', aud: 'authenticated', role: 'authenticated', email: address,
    raw_app_meta_data: JSON.stringify({ provider: 'email', providers: ['email'], seeded: true }), raw_user_meta_data: JSON.stringify({ seeded: true }),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...Object.fromEntries(blank.map(c => [c, ''])),
  };
  const keys = Object.keys(values).filter(k => columns.has(k));
  await op.query(`insert into auth.users (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) on conflict (id) do nothing`, keys.map(k => values[k]));
}

/**
 * Keeps this off any database that might hold a real learner record, and off
 * one that was never seeded in the first place.
 *
 * The seeded-data notice is the test: it is what puts the banner on every
 * screen and the ribbon on the front page, and `reset:seeded-data` removes it.
 * A database without it is either real or empty, and neither is ours to write
 * invented grades into.
 */
async function preflight(op: Operator) {
  const [marker] = await op.query("select to_regclass('edunexus.seeded_data_notice') is not null as ready");
  if (!marker?.ready) throw new Error('Apply the migrations first: npm run db:migrate');
  const [counts] = await op.query(`select
    (select count(*) from edunexus.seeded_data_notice)::int notices, (select count(*) from edunexus.academic_years)::int years,
    (select count(*) from edunexus.sections)::int sections, (select count(*) from edunexus.learners)::int learners,
    (select count(*) from edunexus.enrollments)::int enrollments`);
  console.log('Before this run:', JSON.stringify(counts));
  if (!Number(counts!.notices)) throw new Error('This database carries no seeded-data notice, so it is not a seeded demonstration database. Refusing to write invented records into it.');
  if (!Number(counts!.years) || !Number(counts!.sections) || !Number(counts!.learners)) {
    throw new Error('No school year, section or learner here yet. Run npm run seed:demo-registry first — this tops that up, it does not replace it.');
  }
  const [loader] = await op.query(`select user_id::text id, display_name from edunexus.staff s join auth.users u on u.id=s.user_id
    where s.role='principal' and s.active and ${syntheticAccounts('u.email')} order by s.created_at limit 1`);
  if (!loader) throw new Error('No synthetic principal to attribute these records to. The demonstration registry creates it; run that first.');
  return { loader: String(loader.id), loaderName: String(loader.display_name) };
}

async function topUp(op: Operator, database: Database) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const { loader, loaderName } = await preflight(op);
  log(`Writing as the seeded principal ${loaderName}; no record is attributed to a real account.`);

  // Every synthetic account may act, because each class's own adviser has to
  // enter that class's records. A real account is never acted as.
  const synthetic = (await op.query(`select s.user_id::text id from edunexus.staff s join auth.users u on u.id=s.user_id where ${syntheticAccounts('u.email')}`))
    .map(r => String(r.id));
  let as = asSeeded(op, database, new Set(synthetic));
  let api = as(loader);

  // The year to file these records under: the one the school is running, or
  // else the earliest year that is not closed. A closed year is read only
  // (`P1900`), so nothing can be written into one however it is asked for.
  const years = ((await api.get('/academic-years')).items as { id: string; start_year: number; status: string; starts_on: string; ends_on: string; version: number }[])
    .sort((a, b) => a.start_year - b.start_year);
  const named = flag('year');
  const year = named ? years.find(y => String(y.start_year) === named) : years.find(y => y.status === 'active') ?? years.find(y => y.status === 'draft');
  if (!year) throw new Error(`No school year to write into. Years here: ${years.map(y => `${y.start_year} (${y.status})`).join(', ') || 'none'}`);
  if (year.status === 'closed') throw new Error(`School year ${year.start_year} is closed, and a closed year's records are read only (P1900). Nothing can be seeded into it.`);
  log(`Filing these records under the ${year.status === 'active' ? 'running' : 'draft'} school year ${year.start_year}-${year.start_year + 1}`);
  const periods = ((await api.get(`/academic-years/${year.id}/periods`)).items as { id: string; ordinal: number; starts_on: string; ends_on: string }[])
    .sort((a, b) => a.ordinal - b.ordinal).slice();
  /*
   * A draft year with no terms yet gets DepEd Order No. 9, s. 2026's three,
   * and only if its own dates are that order's: 8 June 2026 to 8 April 2027.
   * Term boundaries are the school's calendar, not ours to invent, so a year
   * with any other dates is refused rather than divided into three guesses.
   */
  if (!periods.length && doing('terms')) {
    if (year.starts_on !== '2026-06-08' || year.ends_on !== '2027-04-08') {
      throw new Error(`School year ${year.start_year} has no reporting periods, and its dates (${year.starts_on} to ${year.ends_on}) are not DepEd Order No. 9, s. 2026's, so its terms are not ours to choose. Record them on School years & sections first.`);
    }
    for (const [index, [name, from, to]] of ([['Term 1', '2026-06-08', '2026-09-15'], ['Term 2', '2026-09-16', '2026-12-18'], ['Term 3', '2027-01-04', '2027-04-08']] as const).entries()) {
      const made = await api.post(`/academic-years/${year.id}/periods`, { ordinal: index + 1, name, starts_on: from, ends_on: to });
      periods.push({ id: made.id, ordinal: made.ordinal, starts_on: made.starts_on, ends_on: made.ends_on });
    }
    log('Three terms recorded for this year, DepEd Order No. 9, s. 2026’s own.');
  }
  if (!periods.length) throw new Error(`School year ${year.start_year} has no reporting periods, so there is no term to file a grade under.`);
  /*
   * Only what has already happened.
   *
   * A term still running has no report card, and a year still running has no
   * final grade, no general average and no outcome -- those are year-end
   * records, and inventing one for a term that has not been taught is not
   * seeding but fabricating a record about the future. The rule this follows is
   * the project's own: an unrecorded mark is `null`, never a guess.
   */
  const ended = periods.filter(p => p.ends_on < today);
  const yearOver = year.ends_on < today;
  log(`School year ${year.start_year}-${year.start_year + 1}, ${year.starts_on} to ${year.ends_on}, ${periods.length} terms, ${ended.length} of them over`);
  if (!yearOver) log(`Today is ${today}, so this year gets ${ended.length === 1 ? 'one term' : `${ended.length} terms`} of records and no final grade, general average or outcome: those are year-end records.`);

  const read = async () => ((await api.get(`/sections?academic_year_id=${year.id}&limit=100`)).items as { id: string; grade_level: number; name: string; adviser_user_id: string | null; version: number }[])
    .map(s => ({ id: s.id, grade: s.grade_level, name: s.name, adviser: s.adviser_user_id, version: s.version }))
    .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name));
  let sections: Section[] = await read();
  log(`${sections.length} classes: ${sections.map(s => `${gradeName(s.grade)}-${s.name}`).join(', ')}`);

  // ---------------------------------------------------------------- advisers
  //
  // One synthetic adviser per class, so the class's own records are entered by
  // the account that holds the class. Created once and found again by address
  // on a later run.
  if (doing('advisers')) {
    const names = staffNames(sections.length + 2, 20251106);
    const existing = new Map((await op.query(`select u.email, s.user_id::text id from edunexus.staff s join auth.users u on u.id=s.user_id
      where s.role='teacher' and ${syntheticAccounts('u.email')}`)).map(r => [String(r.email), String(r.id)]));
    let made = 0;
    for (const [index, section] of sections.entries()) {
      const address = `demo.adviser.${section.grade}${section.name.toLowerCase()}@${domain}`;
      let id = existing.get(address);
      if (!id) {
        id = randomUUID();
        await createIdentity(op, id, address);
        await api.post('/staff', { user_id: id, display_name: `${names[index]!.name} (seeded)`, role: 'teacher' });
        made++;
      }
      synthetic.push(id);
      // The API's own writer, so the change is versioned and journalled like any other.
      const held = (await api.get(`/sections/${section.id}`)) as { adviser_user_id: string | null; version: number };
      if (held.adviser_user_id !== id) {
        const saved = await api.patch(`/sections/${section.id}`, { version: held.version, adviser_user_id: id });
        section.version = saved?.version ?? section.version;
      }
      section.adviser = id;
    }
    as = asSeeded(op, database, new Set(synthetic));
    api = as(loader);
    log(`${made} synthetic advisers created; all ${sections.length} classes are held by a synthetic adviser while the records are written`);
    const [position] = await op.query('select 1');
    void position;
    // A position and specialization, because the SF4 prints them beside the section.
    for (const [index, section] of sections.entries()) {
      const staff = (await api.get(`/staff?limit=100`)).items.find((s: { user_id: string }) => s.user_id === section.adviser);
      if (!staff || staff.position) continue;
      const kinder = section.grade === 0;
      await api.patch(`/staff/${section.adviser}`, { version: staff.version,
        position: index % 5 === 0 ? 'Master Teacher I' : ['Teacher I', 'Teacher II', 'Teacher III'][index % 3]!,
        specialization: kinder ? 'Early Childhood Education' : section.grade <= 3 ? 'General Education' : ['English', 'Mathematics', 'Science', 'Araling Panlipunan', 'MAPEH'][index % 5]! });
    }
  }

  // ---------------------------------------------------------------- sections
  //
  // Every registered learner in a class, which is what was asked for. A learner
  // the registry holds with no enrolment this year is enrolled into the class
  // for the grade their LRN says they belong in; a learner already enrolled with
  // no class is given one.
  if (doing('sections')) {
    // The **first** section of each grade by name, so a grade with several
    // classes fills one rather than scattering a handful of learners over all
    // of them. A learner who already holds a class keeps it.
    const byGrade = new Map<number, Section>();
    for (const section of sections) if (!byGrade.has(section.grade)) byGrade.set(section.grade, section);
    const learners = await allPages(api, '/learners');
    const enrolled = await allPages(api, `/enrollments?academic_year_id=${year.id}`);
    const held = new Map(enrolled.map(e => [String(e.learner_id), e as { id: string; section_id: string | null; grade_level: number; version: number }]));
    let placed = 0, given = 0, finished = 0, nowhere = 0;
    for (const learner of learners) {
      const id = String(learner.id);
      const grade = gradeOf(learner, year.start_year);
      if (grade === null) { if (!held.has(id)) finished++; continue; }
      const target = byGrade.get(grade);
      if (!target) { if (!held.has(id)) nowhere++; continue; }
      const enrolment = held.get(id);
      if (!enrolment) {
        await api.post('/enrollments', { learner_id: id, section_id: target.id, enrolled_on: year.starts_on, entry_kind: 'regular' });
        placed++;
      } else if (!enrolment.section_id) {
        const section = byGrade.get(enrolment.grade_level) ?? target;
        const fresh = await api.get(`/enrollments/${enrolment.id}`);
        await api.post(`/enrollments/${enrolment.id}/movements`, { version: fresh.version, action: 'reassigned', effective_on: laterOf(year.starts_on, fresh.effective_on), section_id: section.id, exit_reason: null });
        given++;
      }
    }
    log(`Classes: ${placed} registered learners enrolled into one, ${given} enrolments given the class they had none for`);
    if (finished) log(`  ${finished} learners are past Grade 6 for this year and were left out: they have finished elementary school.`);
    if (nowhere) log(`  ${nowhere} learners belong in a grade this year has no class for, so they stay on the registry with no enrolment.`);
  }

  // The class lists, with each learner's traits, for every step after this one.
  const roster = new Map<string, Member[]>();
  for (const section of sections) {
    const rows = await allPages(api, `/enrollments?section_id=${section.id}`);
    const members: Member[] = [];
    for (const row of rows.filter(r => r.status === 'enrolled')) {
      const learner = await api.get(`/learners/${row.learner_id}`);
      members.push({ enrollment: String(row.id), learner: String(row.learner_id), lrn: learner.lrn ?? null,
        first: String(learner.first_name), sex: learner.sex as 'female' | 'male', traits: traitsFor(String(learner.lrn ?? row.learner_id)) });
    }
    roster.set(section.id, members);
  }
  log(`Class lists read: ${[...roster.values()].reduce((n, m) => n + m.length, 0)} learners in ${sections.length} classes`);

  // ---------------------------------------------------------------- subjects
  if (doing('subjects')) {
    const catalogue = new Map<string, { id: string; version: number }>();
    const already = new Map(((await api.get('/subjects?limit=100')).items as { code: string; id: string; version: number }[]).map(s => [s.code, s]));
    for (const area of reportCardAreas) {
      const made = already.get(area.code)
        ?? await api.post('/subjects', { code: area.code, name: area.name, kind: 'learning_area', grade_levels: gradesOf(area), active: true, reason: reasons.subjects });
      catalogue.set(area.code, { id: made.id, version: made.version });
    }
    // Kinder is left out: there is no Kindergarten card to record for (`P1901`).
    await pool(sections.filter(s => s.grade > 0), parallel, async section => {
      const offered = new Set(((await api.get(`/sections/${section.id}/subjects`)).items as { subject_id: string }[]).map(o => o.subject_id));
      // Grade 6 takes EPP here; whether it is EPP or TLE is a question still open with the school.
      for (const area of cardFor(section.grade).filter(a => a.code !== 'TLE')) {
        const subject = catalogue.get(area.code)!;
        if (offered.has(subject.id)) continue;
        await api.post(`/sections/${section.id}/subjects`, { subject_id: subject.id, subject_version: subject.version, display_order: lineOf(area, section.grade), reason: reasons.subjects });
      }
    });
    log(`Learning areas: ${catalogue.size} in the catalogue, offered to every graded class`);
  }

  // ---------------------------------------------------------------- calendar
  //
  // Weekdays are class days, weekends are weekends, and the gap between the
  // last term and the one before it is the year-end break. No holiday is
  // invented: which days this school closed in SY 2025-2026 is its own record.
  const breakFrom = periods.length > 1 ? nextDay(periods[periods.length - 2]!.ends_on) : null;
  const breakTo = periods.length > 1 ? prevDay(periods[periods.length - 1]!.starts_on) : null;
  const inBreak = (day: string) => !!breakFrom && !!breakTo && breakFrom <= breakTo && day >= breakFrom && day <= breakTo;
  const schoolDay = (day: string) => !weekend(day) && !inBreak(day);
  if (doing('calendar')) {
    const all = days(year.starts_on, year.ends_on);
    for (let i = 0; i < all.length; i += 60) {
      const chunk = all.slice(i, i + 60);
      const calendar = await api.get(`/academic-years/${year.id}/calendar?from=${chunk[0]}&to=${chunk[chunk.length - 1]}`);
      const changes = chunk.map(day => weekend(day) ? { day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'weekend', label: 'Weekend' }
        : inBreak(day) ? { day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'school_break', label: 'Year-end break' }
          : { day_on: day, action: 'set', am: 'classroom', pm: 'classroom', day_type: 'regular', label: 'Class day' });
      const body = { version: calendar.calendar_version, section_id: null, changes, reason: reasons.calendar };
      // Nothing to change: this stretch was filled by an earlier run, and the
      // reviewed writer refuses a proposal that changes nothing.
      const preview = await already(() => api.post(`/academic-years/${year.id}/calendar/preview`, body));
      if (!preview?.review_hash) continue;
      await api.post(`/academic-years/${year.id}/calendar/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
    }
    log(`Instructional calendar: ${all.filter(schoolDay).length} class days from ${year.starts_on} to ${year.ends_on}`);
  }

  // ---------------------------------------------------------------- the rule
  if (doing('rule')) {
    if ((await api.get('/attendance-day-rule')).rule) log('Attendance rule: already recorded, left as it is');
    else {
      await api.post('/attendance-day-rule', { version: 0, mixed_day: 'tardy', single_session_day: 'counts', reason: reasons.rule });
      log('Attendance rule recorded, so the SF2 and SF4 have figures to show. The real principal records the school’s own over it.');
    }
  }

  // ---------------------------------------------------------------- register
  // Never past today: an attendance mark is a record of a session that has
  // happened, and the register refuses one that has not.
  const marked = days(year.starts_on, year.ends_on).filter(d => schoolDay(d) && d <= today);
  const months = [...new Set(marked.map(d => `${d.slice(0, 7)}-01`))].sort().slice(0, Math.max(0, registerMonths));
  const streaks = new Map<string, Set<string>>();
  for (const [, members] of roster) for (const m of members) {
    if (!m.traits.streak) continue;
    const next = random(hash(`${m.enrollment}streak`));
    const within = marked.filter(d => months.includes(`${d.slice(0, 7)}-01`));
    if (within.length < 8) continue;
    const start = Math.floor(next() * Math.max(1, within.length - 7));
    streaks.set(m.enrollment, new Set(within.slice(start, start + 5)));
  }
  if (doing('register') && months.length) {
    const dates = marked.filter(d => months.includes(`${d.slice(0, 7)}-01`));
    log(`Daily register: ${dates.length} class days in ${months.length} month(s) across ${sections.length} classes`);
    let done = 0;
    await pool(sections, parallel, async section => {
      const adviser = as(section.adviser!);
      const members = roster.get(section.id)!;
      const traits = new Map(members.map(m => [m.enrollment, m.traits]));
      for (const day of dates) for (let attempt = 0; ; attempt++) try {
        const sheet = await adviser.get(`/sections/${section.id}/attendance?day_on=${day}&limit=100`);
        if (!sheet.recording_available) break;
        const roll = random(hash(`${section.id}${day}`));
        const changes = (sheet.items as { enrollment_id: string; am: string | null }[]).map(item => {
          const t = traits.get(item.enrollment_id);
          const r = roll();
          if (!t) return { enrollment_id: item.enrollment_id, am: 'present', pm: 'present' };
          if (streaks.get(item.enrollment_id)?.has(day)) return { enrollment_id: item.enrollment_id, am: 'absent', pm: 'absent' };
          if (r < t.absence) return { enrollment_id: item.enrollment_id, am: 'absent', pm: 'absent' };
          if (r < t.absence + t.late) return { enrollment_id: item.enrollment_id, am: 'absent', pm: 'present' };
          if (r < t.absence + t.late * 1.3) return { enrollment_id: item.enrollment_id, am: 'present', pm: 'absent' };
          return { enrollment_id: item.enrollment_id, am: 'present', pm: 'present' };
        });
        if (!changes.length) break;
        const body = { day_on: day, version: sheet.version, changes, reason: reasons.register };
        const preview = await adviser.post(`/sections/${section.id}/attendance/preview`, body);
        await adviser.post(`/sections/${section.id}/attendance/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
        break;
      } catch (error) {
        // Read again and sent again: if the first try was recorded after all, the register refuses a change that changes nothing.
        if (/ATTENDANCE_UNCHANGED/.test((error as Error).message)) break;
        if (attempt >= 3) throw error;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
      log(`  ${gradeName(section.grade)}-${section.name} marked (${++done}/${sections.length})`);
    });
  }

  // ------------------------------------------------------------------ months
  if (doing('months') && months.length) {
    const transition = async (section: Section, month: string, action: 'submit' | 'lock') => {
      const state = await api.get(`/sections/${section.id}/attendance/months?month_on=${month}`);
      if (action === 'submit' && state.status !== 'open') return;
      if (action === 'lock' && state.status !== 'submitted') return;
      const body = { month_on: month, version: state.version, action, reason: action === 'submit' ? reasons.submit : reasons.lock };
      const preview = await api.post(`/sections/${section.id}/attendance/months/preview`, body);
      if (!preview?.review_hash) { log(`  ${gradeName(section.grade)}-${section.name} ${month} ${action}: ${JSON.stringify(preview?.issues ?? preview).slice(0, 160)}`); return; }
      await api.post(`/sections/${section.id}/attendance/months/transitions`, { ...body, review_hash: preview.review_hash, reviewed: true });
    };
    // Every month but the last is locked, so the demonstration has both a signed
    // month and one still on the principal's desk.
    await pool(sections, parallel, async section => {
      for (const [index, month] of months.entries()) {
        await transition(section, month, 'submit');
        if (index < months.length - 1) await transition(section, month, 'lock');
      }
    });
    log(`Monthly consolidation: ${months.length} month(s) submitted, ${Math.max(0, months.length - 1)} locked`);
  }

  // ------------------------------------------------------------------- cards
  //
  // Every term's report card as its adviser would type it from the ECR: a grade
  // in every learning area for Grades 2-6, the two narratives for Grade 1, a
  // comment on Grades 2-3 and observed values on Grades 4-6. Kinder gets none:
  // the Kindergarten assessment policy gate is shut.
  const outcomes = new Map<string, Map<string, string>>();
  if (doing('cards') || doing('outcomes')) {
    await pool(sections, parallel, async (section, index) => {
      const adviser = as(section.adviser!);
      const members = roster.get(section.id)!;
      const mine = new Map<string, string>(members.map(m => [m.enrollment, 'promoted']));
      outcomes.set(section.id, mine);
      if (!doing('cards') || !members.length || section.grade === 0) return;
      const next = random(hash(`${section.id}cards`));
      // A class that already carries records was written by an earlier run and
      // is left exactly as it is. A reviewed writer takes each entry's own
      // version, so writing over one is not a top-up but an edit, and a seed
      // does not edit a record somebody may since have corrected.
      const records = await adviser.get(`/sections/${section.id}/report-records`);
      type Read = { grades: unknown[]; notes: unknown[]; values: unknown[] };
      if ((records.learners as Read[]).some(l => l.grades.length || l.notes.length || l.values.length)) {
        log(`  ${gradeName(section.grade)}-${section.name}: already carries records, left as it is`);
        return;
      }
      if (!ended.length) { log(`  ${gradeName(section.grade)}-${section.name}: no term is over yet, so there is no report card to write`); return; }
      if (section.grade === 1) {
        for (const period of ended) {
          for (const kind of ['can_do', 'to_improve'] as const) {
            await already(() => adviser.post(`/sections/${section.id}/report-notes`, { kind, reporting_period_id: period.id, reason: reasons.notes,
              entries: members.map(m => ({ enrollment_id: m.enrollment, body: narratives(m, next)[kind], version: 0 })) }));
          }
        }
        log(`  ${gradeName(section.grade)}-${section.name}: ${periods.length} terms of narratives`);
        return;
      }
      const offerings = (records.offerings as { id: string; active: boolean }[]).filter(o => o.active);
      if (!offerings.length) { log(`  ${gradeName(section.grade)}-${section.name}: no learning areas offered yet; run --parts=subjects first`); return; }
      // How each learner takes to each area: a little better at some, a little worse at others.
      const lean = new Map(members.map(m => [m.enrollment, offerings.map(() => 2.2 * normal(next))]));
      const finals = new Map<string, number[]>();
      for (const [o, offering] of offerings.entries()) {
        const grades = members.map(m => ended.map((_, p) => termGrade(m.traits, lean.get(m.enrollment)![o]!, p + 1, next)));
        for (const [p, period] of ended.entries()) {
          await already(() => adviser.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: period.id, reason: reasons.grades,
            entries: members.map((m, i) => ({ enrollment_id: m.enrollment, grade: grades[i]![p]!, version: 0 })) }));
        }
        if (!yearOver) continue;
        await already(() => adviser.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: null, reason: reasons.grades,
          entries: members.map((m, i) => {
            const final = Math.round(grades[i]!.reduce((t, g) => t + g, 0) / grades[i]!.length);
            finals.set(m.enrollment, [...(finals.get(m.enrollment) ?? []), final]);
            return { enrollment_id: m.enrollment, grade: final, remark: final >= 75 ? 'passed' : 'failed', version: 0 };
          }) }));
      }
      if (yearOver) await already(() => adviser.post(`/sections/${section.id}/report-summaries`, { reason: reasons.grades, entries: members.map(m => {
        const list = finals.get(m.enrollment)!;
        const average = Math.round(list.reduce((t, g) => t + g, 0) / list.length);
        const failed = list.filter(g => g < 75).length;
        mine.set(m.enrollment, failed > 2 || average < 75 ? 'retained' : failed ? 'conditionally_promoted' : 'promoted');
        return { enrollment_id: m.enrollment, general_average: average, remark: average >= 75 ? 'passed' : 'failed', version: 0 };
      }) }));
      if (section.grade <= 3) {
        for (const [p, period] of ended.entries()) {
          await already(() => adviser.post(`/sections/${section.id}/report-notes`, { kind: 'comment', reporting_period_id: period.id, reason: reasons.notes,
            entries: members.map(m => ({ enrollment_id: m.enrollment, body: comment(m, p + 1, next), version: 0 })) }));
        }
      } else {
        for (const period of ended) {
          await already(() => adviser.post(`/sections/${section.id}/report-values`, { reporting_period_id: period.id, reason: reasons.values,
            entries: members.map(m => ({ enrollment_id: m.enrollment, version: 0,
              ratings: Object.fromEntries(['MD1', 'MD2', 'MT1', 'MT2', 'MK1', 'MB1', 'MB2'].map(code => [code, valueMark(m.traits, next)])) })) }));
        }
      }
      log(`  ${gradeName(section.grade)}-${section.name}: ${offerings.length} areas × ${ended.length} term(s)${yearOver ? ', finals, general averages' : ''} and ${section.grade <= 3 ? 'comments' : 'observed values'}`);
      void index;
    });
    log('Report cards written for every graded class');
  }

  // ---------------------------------------------------------------- outcomes
  if (doing('outcomes') && !yearOver) {
    log(`End-of-year outcomes: school year ${year.start_year}-${year.start_year + 1} is not over, so none is endorsed. An outcome is a record of how the year ended.`);
  } else if (doing('outcomes')) {
    for (const section of sections) {
      const mine = outcomes.get(section.id);
      const members = roster.get(section.id)!;
      if (!mine || !members.length) continue;
      const adviser = as(section.adviser!);
      const waiting = (await api.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`)).items as { enrollment_id: string; status: string | null; version: number }[];
      const recorded = new Set(waiting.filter(e => e.status).map(e => e.enrollment_id));
      const entries = members.filter(m => !recorded.has(m.enrollment)).map(m => ({ enrollment_id: m.enrollment, action: mine.get(m.enrollment) ?? 'promoted', version: 0 }));
      if (entries.length) await already(() => adviser.post(`/sections/${section.id}/promotion-recommendations`, { entries, reason: reasons.outcome }));
      if (!approve) continue;
      const fresh = ((await api.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`)).items as { enrollment_id: string; status: string; version: number }[])
        .filter(e => e.status === 'recommended');
      if (fresh.length) await already(() => api.post(`/sections/${section.id}/promotion-decisions`, { reason: reasons.approve, entries: fresh.map(e => ({ enrollment_id: e.enrollment_id, decision: 'approved', version: e.version })) }));
    }
    log(approve
      ? 'End-of-year outcomes endorsed by each adviser and approved by the principal'
      : 'End-of-year outcomes endorsed by each adviser and left waiting, so approving them is still the principal’s to demonstrate (--approve does it here)');
  }

  // ------------------------------------------------------------------- prior
  //
  // The school years behind this one, as the SF10 carries them: one scholastic
  // block per year from Grade 1 up to the grade below the one the learner is in
  // now, and the credential presented for Grade 1. A block is Grade 1 to Grade
  // 6 — Kindergarten is never one, so a Kinder learner gets neither and a Grade
  // 1 learner gets the credential only.
  if (doing('prior')) {
    const all = sections.flatMap(s => roster.get(s.id)!.map(m => ({ section: s, m })));
    let years = 0, credentials = 0;
    await pool(all, parallel, async ({ section, m }) => {
      const held = await api.get(`/learners/${m.learner}/prior-records`);
      const have = new Set(((held.prior_years ?? []) as { start_year: number }[]).map(y => y.start_year));
      // A year EDUNEXUS holds as an enrolment is not transcribed over: its
      // grades belong on Promotion, and `priorYearRecord` refuses it outright.
      // It is still a year of the learner's record, so the SF10 shows it either
      // way — from the register rather than from a transcription.
      for (const r of (held.recorded_years ?? []) as { start_year: number }[]) have.add(r.start_year);
      for (let grade = 1; grade < section.grade; grade++) {
        const startYear = year.start_year - (section.grade - grade);
        if (have.has(startYear)) continue;
        const next = random(hash(`${m.lrn ?? m.learner}prior${grade}`));
        const areas = cardFor(grade).filter(a => a.code !== 'TLE');
        const finals: number[] = [];
        const subjects = areas.map(area => {
          const lean = 2.2 * normal(next);
          const quarters = [1, 2, 3, 4].map(q => termGrade(m.traits, lean, q, next));
          const final = Math.round(quarters.reduce((t, g) => t + g, 0) / quarters.length);
          finals.push(final);
          return { code: area.code, name: area.name, q1: quarters[0]!, q2: quarters[1]!, q3: quarters[2]!, q4: quarters[3]!,
            final, remark: final >= 75 ? 'passed' : 'failed' };
        });
        const average = Math.round(finals.reduce((t, g) => t + g, 0) / finals.length);
        await api.post(`/learners/${m.learner}/prior-years`, {
          year: { start_year: startYear, grade_level: grade, school_name: held.school?.name ?? 'Balili Elementary School',
            school_code: held.school?.school_code ?? null, school_address: held.school?.address ?? null,
            section_name: 'A', adviser_name: null, general_average: average, remark: average >= 75 ? 'passed' : 'failed', source: priorSource },
          subjects, reason: reasons.prior,
        });
        years++;
      }
      // The credential presented for Grade 1, for anyone who has reached it.
      if (section.grade >= 1 && !held.eligibility) {
        await api.patch(`/learners/${m.learner}/eligibility`, { version: 0, credential: 'kinder_progress_report', credential_other: null,
          school_name: held.school?.name ?? 'Balili Elementary School', school_code: held.school?.school_code ?? null,
          school_address: held.school?.address ?? null, pept_rating: null, examined_on: null, testing_center: null,
          remark: null, source: priorSource, reason: reasons.prior });
        credentials++;
      }
    });
    log(`Previous school years: ${years} scholastic blocks transcribed, ${credentials} Grade 1 credentials recorded`);
  }

  // --------------------------------------------------------------- followups
  if (doing('followups') && streaks.size) {
    let opened = 0;
    for (const section of sections) {
      for (const m of roster.get(section.id)!) {
        const run = streaks.get(m.enrollment);
        if (!run?.size) continue;
        const dates = [...run].sort();
        const body = { section_id: section.id, from: dates[0], to: dates[dates.length - 1], category: 'absence', assignee_user_id: loader, due_on: null, reason: reasons.followup };
        try {
          const preview = await api.post(`/enrollments/${m.enrollment}/attendance-follow-ups/preview`, body);
          await api.post(`/enrollments/${m.enrollment}/attendance-follow-ups`, { ...body, review_hash: preview.review_hash, reviewed: true });
          opened++;
        } catch (error) { void error; }
      }
    }
    log(`Home-visit follow-ups: ${opened} opened for learners absent five days running`);
  }

  // -------------------------------------------------------------------- site
  if (site) {
    const { seedSiteContent } = await import('./seed/school.js');
    await seedSiteContent({ loader, as, log });
  }

  // ----------------------------------------------------------------- restore
  //
  // Every class goes back to the real teacher account, which is the state the
  // demonstration registry left and what lets teacher-scoped reading be shown.
  // Found by who holds it rather than from anything this run remembered, so it
  // works just as well after a run that stopped half way.
  if (doing('restore')) {
    const [real] = await op.query(`select s.user_id::text id, s.display_name from edunexus.staff s join auth.users u on u.id=s.user_id
      where s.role='teacher' and s.active and not ${syntheticAccounts('u.email')} order by s.created_at limit 1`);
    if (!real) log('No real teacher account: the classes stay with their synthetic advisers, and the records name them.');
    else {
      let handed = 0;
      for (const section of await read()) {
        if (!section.adviser || !synthetic.includes(section.adviser)) continue;
        const held = await api.get(`/sections/${section.id}`);
        await api.patch(`/sections/${section.id}`, { version: held.version, adviser_user_id: String(real.id) });
        handed++;
      }
      log(`${handed} classes handed back to the real teacher account ${String(real.display_name)}; the records keep the synthetic adviser who entered them`);
    }
  }

  sections = await read();
  const [after] = await op.query(`select (select count(*) from edunexus.learners)::int learners,
    (select count(*) from edunexus.enrollments)::int enrollments,
    (select count(*) from edunexus.enrollments where section_id is null and record_state='valid')::int without_class,
    (select count(*) from edunexus.subjects)::int subjects, (select count(*) from edunexus.section_subjects)::int offerings,
    (select count(*) from edunexus.attendance_marks)::int marks, (select count(*) from edunexus.report_grades)::int grades,
    (select count(*) from edunexus.report_summaries)::int averages, (select count(*) from edunexus.report_notes)::int notes,
    (select count(*) from edunexus.report_values)::int values, (select count(*) from edunexus.promotion_decisions)::int outcomes,
    (select count(*) from edunexus.learner_prior_years)::int prior_years, (select count(*) from edunexus.learner_eligibility)::int credentials,
    (select count(*) from edunexus.staff)::int staff`);
  log(`Done: ${JSON.stringify(after)}`);
  return after;
}

/** Every page of a list endpoint, so a school's worth of rows is not silently cut at the first page. */
async function allPages(api: Call, path: string) {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api.get(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
    const items = (page.items ?? []) as Record<string, unknown>[];
    out.push(...items);
    if (items.length < 100) return out;
  }
}

/**
 * The grade a registered learner belongs in, from the LRN the seed gave them.
 *
 * `scripts/seed/people.ts` writes the year the learner first enrolled into
 * digits 7 and 8, so the grade is that year counted forward. A learner whose
 * LRN says nothing usable falls back to their birth date against the Grade 1
 * entry age: born September to August, six by the end of August for Grade 1.
 */
function gradeOf(learner: Record<string, unknown>, startYear: number): number | null {
  const lrn = String(learner.lrn ?? '');
  if (/^[0-9]{12}$/.test(lrn)) {
    const first = 2000 + Number(lrn.slice(6, 8));
    const grade = startYear - 1 - first;
    // Past Grade 6 is a learner who has finished elementary school. They are not
    // put back into Grade 6 to make the numbers look fuller.
    if (grade > 6) return null;
    if (grade >= 0) return grade;
  }
  const birth = String(learner.birth_date ?? '');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth)) return null;
  const band = Number(birth.slice(0, 4)) + (Number(birth.slice(5, 7)) >= 9 ? 0 : -1);
  const grade = startYear - 6 - band;
  return grade > 6 ? null : clamp(grade, 0, 6);
}

const nextDay = (day: string) => iso(new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000));
const prevDay = (day: string) => iso(new Date(new Date(`${day}T00:00:00Z`).getTime() - 86400000));
const laterOf = (a: string, b: string) => (a > b ? a : nextDay(b));

if (rehearse) {
  const { testDatabase } = await import('../tests/helpers/database.js');
  const db = await testDatabase();
  const op: Operator = { async query(text, params) { return db.pg.query<Record<string, unknown>>(text, params); }, close: async () => {} };
  try {
    await op.query('alter table auth.users add column if not exists email text');
    await rehearsalRegistry(op, db.database);
    await topUp(op, db.database);
    // Run again over its own output: every step reads what is there first, so a
    // second run must change nothing and refuse nothing. This is the claim that
    // lets a stopped hosted run simply be started again.
    if (process.argv.includes('--twice')) {
      log('--- running again, to prove the top-up is repeatable ---');
      const before = await counts(op);
      await topUp(op, db.database);
      const after = await counts(op);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`A second run changed the records.\n  before ${JSON.stringify(before)}\n  after  ${JSON.stringify(after)}`);
      log('A second run wrote nothing new, as a top-up must.');
    }
    if (process.argv.includes('--prove')) await proveForms(op, db.database);
  } finally { await db.database.close(); }
} else {
  if (process.env.SEED_CONFIRM !== 'seed-demo-records') {
    console.error('This writes invented academic records into the hosted database. Rehearse with --rehearse, or set SEED_CONFIRM=seed-demo-records to run it for real.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL, the runtime login the API itself uses.'); process.exit(1); }
  const sql = operatorDatabase();
  const reserved = await sql.reserve();
  const op: Operator = { async query(text, params = []) { return [...await reserved.unsafe(text, params as never[])] as Record<string, unknown>[]; }, close: async () => { reserved.release(); await sql.end({ timeout: 5 }); } };
  const database = createDatabase(process.env.DATABASE_URL, process.env.DATABASE_SSL !== 'false', 4);
  try { await topUp(op, database); }
  catch (error) { console.error(error instanceof Error ? error.message : error); operatorFailure(error); }
  finally { await database.close(); await op.close(); }
}

/**
 * A demonstration registry of the same shape as `seed:demo-registry` leaves,
 * built in memory so a rehearsal has something to top up. Rehearsal only: it
 * creates identities directly, which only the operator may do.
 */
async function rehearsalRegistry(op: Operator, database: Database) {
  const { children, lrn } = await import('./seed/people.js');
  const principal = randomUUID(), teacher = randomUUID();
  await op.query("select set_config('edunexus.actor_id',$1,true), set_config('edunexus.request_id',$2,true)", [principal, randomUUID()]);
  await op.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [principal, `demo.setup@${domain}`, teacher, 'real.teacher@balili.example']);
  await op.query("insert into edunexus.staff (user_id,display_name,role) values ($1,$2,'principal')", [principal, 'Demo Setup (seeded data)']);
  await op.query("insert into edunexus.staff (user_id,display_name,role) values ($1,$2,'teacher')", [teacher, 'Real Teacher']);
  await op.query('insert into edunexus.seeded_data_notice (note) values ($1)', ['Rehearsal.']);
  // As `scripts/bootstrap.ts` creates it on a real install. No migration inserts
  // this row, and `read_sf10_source` answers `school: null` without it, which
  // `computeSf10` reads straight through — so a rehearsal without it fails in a
  // way no real database can.
  await op.query("insert into edunexus.school_profile (name,address) values ('Balili Elementary School','Tebteb, Balili, La Trinidad, Benguet')");
  const api = asSeeded(op, database, new Set([principal]))(principal);
  const year = await api.post('/academic-years', { start_year: 2025, starts_on: '2025-06-09', ends_on: '2026-04-10' });
  for (const [index, [name, from, to]] of ([['Term 1', '2025-06-09', '2025-09-16'], ['Term 2', '2025-09-17', '2025-12-19'], ['Term 3', '2026-01-05', '2026-04-10']] as const).entries()) {
    await api.post(`/academic-years/${year.id}/periods`, { ordinal: index + 1, name, starts_on: from, ends_on: to });
  }
  if (!process.argv.includes('--draft-year')) await api.patch(`/academic-years/${year.id}/status`, { version: year.version, status: 'active' });
  const families: { last: string; middle: string | null }[] = [];
  let sequence = 1;
  for (const grade of [0, 1, 2, 3, 4, 5, 6]) {
    const section = await api.post('/sections', { academic_year_id: year.id, grade_level: grade, name: 'A', adviser_user_id: teacher });
    for (const [i, child] of children(grade + 1, 4, families, 20251106 + grade).entries()) {
      const learner = await api.post('/learners', { first_name: child.first, middle_name: child.middle, last_name: child.last,
        name_extension: child.extension, birth_date: child.birth, sex: child.sex, lrn: lrn(grade + 1, sequence++), address: null,
        guardian_name: null, guardian_contact: null });
      // Three of each four are enrolled; the fourth is left for this script to place.
      if (i < 3) await api.post('/enrollments', { learner_id: learner.id, section_id: section.id, enrolled_on: '2025-06-09', entry_kind: 'regular' });
    }
  }
  log('Rehearsal registry built: 7 classes, 28 learners, 7 of them registered with no enrolment.');
}

/** The record counts a repeat run must leave untouched. */
async function counts(op: Operator) {
  const [row] = await op.query(`select (select count(*) from edunexus.enrollments)::int enrollments,
    (select count(*) from edunexus.attendance_marks)::int marks, (select count(*) from edunexus.report_grades)::int grades,
    (select count(*) from edunexus.report_summaries)::int averages, (select count(*) from edunexus.report_notes)::int notes,
    (select count(*) from edunexus.report_values)::int values, (select count(*) from edunexus.promotion_decisions)::int outcomes,
    (select count(*) from edunexus.learner_prior_years)::int prior_years, (select count(*) from edunexus.learner_eligibility)::int credentials,
    (select count(*) from edunexus.section_subjects)::int offerings, (select count(*) from edunexus.staff)::int staff`);
  return row!;
}

/**
 * Reads back the four forms the demonstration prints, because a seed is only
 * as good as what the forms make of it. Rehearsal only.
 */
async function proveForms(op: Operator, database: Database) {
  const synthetic = (await op.query(`select s.user_id::text id from edunexus.staff s join auth.users u on u.id=s.user_id where ${syntheticAccounts('u.email')}`)).map(r => String(r.id));
  const [loader] = await op.query(`select s.user_id::text id from edunexus.staff s join auth.users u on u.id=s.user_id
    where s.role='principal' and ${syntheticAccounts('u.email')} limit 1`);
  const api = asSeeded(op, database, new Set(synthetic))(String(loader!.id));
  log('--- reading the forms back ---');
  const all = (await api.get('/academic-years')).items as { id: string; start_year: number; status: string; starts_on: string }[];
  const year = all.find(y => y.status === 'active') ?? all.find(y => y.status === 'draft')!;
  const sections = (await api.get(`/sections?academic_year_id=${year.id}&limit=100`)).items as { id: string; grade_level: number }[];

  const six = sections.find(s => s.grade_level === 6)!;
  const roll = (await api.get(`/enrollments?section_id=${six.id}&limit=100`)).items as { id: string; learner_id: string }[];
  const sf9 = await api.get(`/enrollments/${roll[0]!.id}/forms/sf9`);
  const filled = (sf9.subjects as { final: number | null }[]).filter(s => s.final !== null).length;
  log(`SF9, Grade 6: ${filled} of ${(sf9.subjects as unknown[]).length} learning areas carry a final grade, general average ${sf9.general_average?.value ?? 'none'} (${sf9.general_average?.remark ?? 'no remark'}), outcome ${sf9.outcome?.action ?? 'none yet — the principal approves it'}`);
  if (!filled) throw new Error('The SF9 carries no grade.');

  let sf10: Record<string, any>;
  try { sf10 = await api.get(`/learners/${roll[0]!.learner_id}/forms/sf10`); }
  catch (error) {
    // The API answers 500 without the detail, deliberately. A rehearsal is the
    // one place the detail may be dug out, so the source and the layout are run
    // here by hand to say which of the two failed.
    log(`SF10 refused: ${(error as Error).message}`);
    await op.query("select set_config('edunexus.actor_id',$1,false)", [String(loader!.id)]);
    const [row] = await op.query('select edunexus.read_sf10_source($1) r', [roll[0]!.learner_id]);
    const { computeSf10 } = await import('../src/modules/forms/cards.js');
    log(`  source read: ${JSON.stringify(row?.r).slice(0, 800)}`);
    computeSf10((row as { r: never }).r);
    throw error;
  }
  const blocks = (sf10.years ?? sf10.blocks ?? []) as { grade_level: number }[];
  log(`SF10: ${blocks.length} scholastic blocks, grades ${blocks.map(b => b.grade_level).join(', ')}; eligibility ${sf10.eligibility?.credential ?? 'none'}`);
  if (blocks.length < 2) throw new Error('The SF10 has no cumulative history behind it.');

  const month = `${year.starts_on.slice(0, 7)}-01`;
  const sf2 = await api.get(`/sections/${six.id}/forms/sf2?month_on=${month}`);
  const totals = (sf2.summary ?? {}) as { days_of_classes?: number; enrolment_at_cutoff?: { total?: number }; percentage_of_enrolment?: { total?: number | null } };
  log(`SF2 ${month}: ${(sf2.learners as unknown[] ?? []).length} learners, ${totals.days_of_classes ?? 0} days of classes, ${totals.enrolment_at_cutoff?.total ?? 0} enrolled at the cut-off, attendance ${totals.percentage_of_enrolment?.total ?? 'not computed'}%`);

  const sf4 = await api.get(`/academic-years/${year.id}/forms/sf4?month_on=${month}`);
  log(`SF4 ${month}: ${(sf4.sections as unknown[] ?? []).length} sections reported, ${(sf4.unplaced as unknown[] ?? []).length} unplaced groups`);
  log('--- the forms read back as the demonstration needs them ---');
}
