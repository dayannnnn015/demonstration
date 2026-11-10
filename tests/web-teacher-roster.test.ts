// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { Learners } from '../web/screens/Learners';
import { PriorRecords } from '../web/screens/PriorRecords';
import { routes } from '../web/routes';

/**
 * The two new screens' data paths, in a real DOM against the real API.
 *
 * Both are about a permission, so a test that mocked the server would prove
 * nothing: what has to hold is that **the row policy and the role gate decide
 * what appears**, not the screen's guess at the role. So an adviser really
 * signs in, really reads their own sections, really takes a learner in through
 * `place_enrollment`, and the refusals really come back with the server's own
 * codes.
 */

let db: TestDatabase;
let server: ServerApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
/** The year after it, drafted but not activated: the case an adviser meets every May. */
const year2027 = '00000000-0000-4000-9000-000000000002';
const masigla = '00000000-0000-4000-9000-00000000000a';
const narra = '00000000-0000-4000-9000-00000000000b';
const mabuhay = '00000000-0000-4000-9000-00000000000c';
let unplaced = '';

/** Four consecutive quarters, which `guard_year` requires before a year can be activated. */
const quarters = (year: string, from: number) => db.pg.query(
  `insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First Quarter',($2||'-06-01')::date,($2||'-08-31')::date),
    ($1,2,'Second Quarter',($2||'-09-01')::date,($2||'-11-30')::date),
    ($1,3,'Third Quarter',($2||'-12-01')::date,($3||'-01-31')::date),
    ($1,4,'Fourth Quarter',($3||'-02-01')::date,($3||'-03-31')::date)`,
  [year, String(from), String(from + 1)]);

const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const route = routes.find(r => r.id === 'learners')!;
const historyRoute = routes.find(r => r.id === 'prior-records')!;

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values
    ($1,2026,'2026-06-01','2027-03-31','draft'),($2,2027,'2027-06-01','2028-03-31','draft')`, [year2026, year2027]);
  // 2026 is the year the school is running: an adviser builds a class only in an
  // activated year, so the screen's own gate needs one to let anything through.
  await quarters(year2026, 2026);
  await quarters(year2027, 2027);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$4,3,'Masigla',$5),($2,$4,3,'Narra',$6),($3,$7,4,'Mabuhay',$5)`,
    [masigla, narra, mabuhay, year2026, ids.teacher, ids.otherTeacher, year2027]);
  await db.pg.query(`insert into edunexus.learners(id,lrn,first_name,last_name,sex,birth_date) values
    ('00000000-0000-4000-9001-000000000001','136170000001','Ana','Reyes','female','2017-05-02'),
    ('00000000-0000-4000-9001-000000000002','136170000002','Ben','Lacsamana','male','2017-03-11')`);
  unplaced = '00000000-0000-4000-9001-000000000001';
  // Ana is registered at Grade 3 with no class; Ben is already in Narra.
  await db.pg.query(`select * from edunexus.place_enrollment($1::uuid,$2::uuid,3::smallint,null,'2026-06-01','regular')`, [unplaced, year2026]);
  await db.pg.query(`select * from edunexus.place_enrollment('00000000-0000-4000-9001-000000000002'::uuid,$1::uuid,3::smallint,$2::uuid,'2026-06-01','regular')`,
    [year2026, narra]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('an adviser takes a learner into their class', () => {
  it('offers the action, lists only their own class, and the learner waiting for it', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Add learner'), 'the adviser action');
    await screen.click(screen.byText('Add learner', 'button'));
    // The class picker holds the sections row security gave them, and no more.
    await screen.until(m => m.text().includes('Masigla'), 'their own class');
    expect(screen.text()).not.toContain('Narra');
    // Ana is waiting; Ben is in somebody's class and so is not offered.
    await screen.until(m => m.text().includes('Reyes'), 'the waiting learner');
    expect(screen.text()).toContain('Give them this class');
    expect(screen.text()).not.toContain('Lacsamana');
    screen.unmount();
  });

  // The empty table used to read "No learners are currently assigned to your
  // sections." and stop, which is true and useless: it describes the adviser's
  // own class and says nothing about the learners waiting to be taken into it,
  // so an adviser read it as "there is nobody" and went no further. Masigla
  // holds nobody here while Ana waits at its grade, which is exactly that case.
  it('points an adviser whose class is empty at the learners waiting for it', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('No learners in your classes yet'), 'the empty state');
    expect(screen.text()).not.toContain('No learners are currently assigned to your sections');
    // It names the way in, and the registry is not called empty: it is not.
    expect(screen.text()).toContain('Add learner');
    expect(screen.text()).not.toContain('The registry is empty');
    screen.unmount();
  });

  it('takes the learner in, and the class is theirs afterwards', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Add learner'), 'the adviser action');
    await screen.click(screen.byText('Add learner', 'button'));
    await screen.until(m => m.text().includes('Reyes'), 'the waiting learner');
    // Tick the row, then send it: the batch is one request per learner.
    const tick = screen.all('input.batch-check')[0]!;
    await screen.click(tick);
    await screen.until(m => m.all('button').some(b => /Take 1 learner into my class/.test(b.textContent ?? '')), 'the send button');
    await screen.submit(screen.all('button').find(b => /Take 1 learner into my class/.test(b.textContent ?? ''))!);
    await screen.until(m => m.text().includes('In my class'), 'the learner taken in');

    // The record, not the screen: one enrolment, now in Masigla.
    const rows = await db.pg.query<{ section_id: string | null }>(
      `select section_id from edunexus.enrollments where learner_id=$1 and record_state='valid'`, [unplaced]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.section_id).toBe(masigla);
    screen.unmount();
  });

  it('shows a manager the register’s own action instead, never the adviser one', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Register a learner'), 'the manager action');
    expect(screen.text()).not.toContain('Add learner');
    screen.unmount();
  });
});

describe('school-wide encoding oversight', () => {
  it('shows a manager every class, its adviser and the work left, naming no learner', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(PriorRecords as never, server, principal, { route: historyRoute });
    await screen.until(m => m.text().includes('Across the school'), 'the oversight card');
    await screen.until(m => m.text().includes('Masigla'), 'the classes');
    const text = screen.text();
    expect(text).toContain('Narra');
    expect(text).toContain('Teacher');
    expect(text).toContain('Not started');
    // Counts only: no learner's name appears anywhere on it.
    expect(text).not.toContain('Reyes');
    expect(text).not.toContain('Lacsamana');
    screen.unmount();
  });

  it('is not shown to an adviser at all', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(PriorRecords as never, server, teacher, { route: historyRoute });
    await screen.until(m => m.text().includes('You encode your own learners'), 'the adviser notice');
    expect(screen.text()).not.toContain('Across the school');
    screen.unmount();
  });

  it('writes no privacy access row when a manager opens it', async () => {
    const before = await db.pg.query<{ n: string }>('select count(*) n from edunexus.record_access_events');
    server.signInAs('principal');
    const screen = await mountScreen(PriorRecords as never, server, principal, { route: historyRoute });
    await screen.until(m => m.text().includes('Masigla'), 'the classes');
    const after = await db.pg.query<{ n: string }>('select count(*) n from edunexus.record_access_events');
    // The whole reason this view is counts rather than a list.
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
    screen.unmount();
  });
});

/**
 * A class in a school year the principal has not activated.
 *
 * This is what the school met: the principal created next year, an adviser
 * opened **Add learner**, and no learner appeared — correctly, because nobody is
 * registered into a year that has not begun, but with nothing on the screen
 * saying so. Worse, the two writes behind the sheet disagree about the first
 * day: giving a class to a learner the office has registered is a
 * `move_enrollment`, which refuses a future date, while enrolling one who holds
 * no enrolment is a `place_enrollment`, which does not. So the school builds its
 * classes only once the year is activated (decided 2026-11-06), and the sheet
 * says that before anything is clicked.
 */
describe('a class in a school year that is not running yet', () => {
  it('names the school year of every class, and opens on the one the school is running', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Add learner'), 'the adviser action');
    await screen.click(screen.byText('Add learner', 'button'));
    await screen.until(m => m.text().includes('Masigla'), 'the class picker');
    // Both classes are the adviser's, and each option says which year it belongs to.
    const options = screen.all('option').map(o => o.textContent ?? '');
    expect(options).toContain('Grade 3 · Masigla — 2026–2027');
    expect(options).toContain('Grade 4 · Mabuhay — 2027–2028');
    // `/sections` orders by a uuid, so the opening choice has to be the year's, not the list's.
    expect(screen.field('My class')?.value).toBe(masigla);
    screen.unmount();
  });

  it('refuses the unactivated year up front, offers no take-in, and reads no learner for it', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Add learner'), 'the adviser action');
    await screen.click(screen.byText('Add learner', 'button'));
    // The sheet opens on the running year and reads its list, which is logged as
    // it should be. Counted from here, so what is asserted is the switch alone.
    // Ana was taken in by the test above, so the running year's list is empty —
    // and an empty list is still a read, and still logged.
    await screen.until(m => m.text().includes('Nobody is waiting for this class'), 'the running year’s list');
    const before = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource='pullableList'`);
    await screen.type(screen.field('My class'), mabuhay);
    await screen.until(m => m.text().includes('has not been activated yet'), 'the refusal');

    const text = screen.text();
    expect(text).toContain('A principal activates a school year');
    // Neither write is offered: not the take-in, and not the registration either.
    expect(screen.all('button').some(b => /Take \d+ learner/.test(b.textContent ?? ''))).toBe(false);
    expect(text).not.toContain('Register a new learner into my class');
    expect(text).not.toContain('First day in the class');
    // And nothing was read for it: the list names learners, and naming one is logged.
    const after = await db.pg.query<{ n: string }>(`select count(*) n from edunexus.record_access_events where resource='pullableList'`);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
    screen.unmount();
  });

  it('refuses an activated year whose classes have not begun, which is where the 409 came from', async () => {
    // The principal closes the year that ended and activates the new one, before June.
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
    await db.pg.query(`update edunexus.academic_years set status='closed' where id=$1`, [year2026]);
    await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2027]);

    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Add learner'), 'the adviser action');
    await screen.click(screen.byText('Add learner', 'button'));
    await screen.until(m => m.text().includes('has not started yet'), 'the refusal');
    expect(screen.text()).toContain('2027-06-01');
    expect(screen.all('button').some(b => /Take \d+ learner/.test(b.textContent ?? ''))).toBe(false);
    screen.unmount();
  });

  // The live failure of 2026-11-06, reported as "it just keeps loading". Before
  // the barrier existed the sheet opened on whatever `/sections` returned first
  // — ordered by `academic_year_id`, a uuid, so it could land on a **closed**
  // year — and `read_pullable_learners` refuses a closed year through
  // `may_advise_section`. The fetch's only `catch` set the status line and never
  // set `answer`, so `candidates` stayed null and BatchSheet drew its skeleton
  // for ever. A refusal must therefore be a statement, never a spinner.
  it('states the refusal for a closed year instead of spinning a skeleton for ever', async () => {
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
    // The case above may already have closed it, and a closed year is immutable,
    // so this reaches the state rather than assuming which test ran first.
    const [state] = await db.pg.query<{ status: string }>(`select status from edunexus.academic_years where id=$1`, [year2026]);
    if (state!.status !== 'closed') {
      await db.pg.query(`update edunexus.academic_years set status='closed' where id=$1`, [year2026]);
      await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2027]);
    }

    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Add learner'), 'the adviser action');
    await screen.click(screen.byText('Add learner', 'button'));
    // Choose the closed year's class deliberately: it is still one they advise.
    await screen.until(m => m.text().includes('My class'), 'the class picker');
    await screen.type(screen.field('My class'), masigla);

    await screen.until(m => m.text().includes('school year is closed'), 'the closed-year refusal');
    // Nothing is left loading, and nothing is offered to act on.
    expect(screen.all('.skeleton-table').length).toBe(0);
    expect(screen.all('.skeleton').length).toBe(0);
    expect(screen.all('input.batch-check').length).toBe(0);
    expect(screen.all('button').some(b => /Take \d+ learner/.test(b.textContent ?? ''))).toBe(false);
    screen.unmount();
  });
});
