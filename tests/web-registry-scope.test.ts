// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { Learners } from '../web/screens/Learners';
import { available, hiddenByAssignment, routes } from '../web/routes';

/**
 * What the Learner registry offers each role, in a real DOM against the real
 * API.
 *
 * Two changes of 2026-11-05, both asked for and both only about the interface:
 * an adviser is no longer asked to choose a grade level, because they read only
 * the learners in the classes they advise and the filter could only narrow
 * their own class; and the registry no longer carries a second way into
 * Academic history, which the rail already holds.
 *
 * The permission is **not** tested here. Hiding a select box is not a
 * permission, so the scope an adviser cannot widen is held in
 * `tests/registry-grade-filter.test.ts` against the API itself — including the
 * case where the grade parameter is sent anyway. This file holds only what each
 * role is shown.
 */

let db: TestDatabase;
let server: ServerApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const mine = '00000000-0000-4000-9000-00000000000a';
const theirs = '00000000-0000-4000-9000-00000000000b';

const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const officer = { user_id: ids.officer, role: 'administrative_officer', display_name: 'Administrative Officer' };
const route = routes.find(r => r.id === 'learners')!;

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000003']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$3,3,'Masigla',$4),($2,$3,4,'Narra',$5)`, [mine, theirs, year2026, ids.teacher, ids.otherTeacher]);
  await db.pg.query(`insert into edunexus.learners(id,lrn,first_name,last_name,sex,birth_date) values
    ('00000000-0000-4000-9001-000000000001','136170000001','Ana','Reyes','female','2017-05-02'),
    ('00000000-0000-4000-9001-000000000002','136170000002','Ben','Lacsamana','male','2016-03-11')`);
  // Ana is in the adviser's own Grade 3 class; Ben is in another adviser's Grade 4.
  await db.pg.query(`select * from edunexus.place_enrollment('00000000-0000-4000-9001-000000000001'::uuid,$1::uuid,3::smallint,$2::uuid,'2026-06-01','regular')`,
    [year2026, mine]);
  await db.pg.query(`select * from edunexus.place_enrollment('00000000-0000-4000-9001-000000000002'::uuid,$1::uuid,4::smallint,$2::uuid,'2026-06-01','regular')`,
    [year2026, theirs]);
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First','2026-06-01','2026-08-31'),($1,2,'Second','2026-09-01','2026-11-30'),
    ($1,3,'Third','2026-12-01','2027-01-31'),($1,4,'Fourth','2027-02-01','2027-03-31')`, [year2026]);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2026]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('what an adviser is shown', () => {
  it('lists their own learners straight away, with no grade to choose first', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    // Their own learner, without a filter being touched.
    await screen.until(m => m.text().includes('Reyes'), 'their own learner');
    // And nobody else's, which is row security rather than the screen.
    expect(screen.text()).not.toContain('Lacsamana');
    screen.unmount();
  });

  it('is not offered a grade-level filter', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Reyes'), 'their own learner');
    expect(screen.text()).not.toContain('Grade level this year');
    expect(screen.text()).not.toContain('Any grade');
    // The filters they do keep are still there: this removed one control, not the finder.
    expect(screen.text()).toContain('Name or LRN');
    screen.unmount();
  });
});

describe('what a manager is shown', () => {
  it('keeps the grade-level filter for the principal, and sees the whole school', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    expect(screen.text()).toContain('Grade level this year');
    // Both classes, which is the school-wide visibility that must not change.
    expect(screen.text()).toContain('Lacsamana');
    screen.unmount();
  });

  it('updates the registry immediately when Any grade is selected', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Lacsamana'), 'the school-wide registry');
    const grade = screen.field('Grade level this year');
    expect(grade).toBeInstanceOf(HTMLSelectElement);
    await screen.type(grade, '3');
    await screen.until(m => m.text().includes('Reyes') && !m.text().includes('Lacsamana'), 'the filtered registry');
    await screen.type(grade, '');
    await screen.until(m => m.text().includes('Reyes') && m.text().includes('Lacsamana'), 'the unfiltered registry');
    screen.unmount();
  });

  it('keeps it for the administrative officer too', async () => {
    server.signInAs('officer');
    const screen = await mountScreen(Learners as never, server, officer, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    expect(screen.text()).toContain('Grade level this year');
    expect(screen.text()).toContain('Lacsamana');
    screen.unmount();
  });
});

describe('Academic history is reached from the rail, and only from there', () => {
  it('is gone from the registry for both roles', async () => {
    for (const [who, me] of [['teacher', teacher], ['principal', principal]] as const) {
      server.signInAs(who);
      const screen = await mountScreen(Learners as never, server, me, { route });
      await screen.until(m => m.text().includes('Reyes'), `a learner, as ${who}`);
      // The shortcut lived inside the learner's own panel, so the row has to be
      // opened before this can mean anything. Asserting on the closed list
      // passed with the shortcut still in the file, which is what made the
      // first version of this case useless.
      await screen.click(screen.all('button.row-toggle')[0]!);
      await screen.until(m => m.text().includes('Enrolments') || m.text().includes('Correct the details')
        || m.all('tr.row-panel').length > 0, `the open panel, as ${who}`);
      expect(screen.text(), who).not.toContain('Academic history before EDUNEXUS');
      // and no link to that screen is left behind in the markup
      expect(screen.all('a').some(a => (a.getAttribute('href') ?? '').includes('prior-records')), who).toBe(false);
      screen.unmount();
    }
  });

  it('still has its own screen in the rail, for both roles', () => {
    // The destination is untouched: removing the shortcut must not remove the
    // route, or the historical records become unreachable.
    const history = routes.find(r => r.id === 'prior-records');
    expect(history).toBeTruthy();
    expect(history?.hiddenFor ?? []).not.toContain('teacher');
    expect(history?.manager).not.toBe(true);
  });
});

/**
 * The Setup screens an adviser is not offered.
 *
 * Both were readable and had a teacher guide saying so, which is the thing that
 * made them look like part of an adviser's job. Neither is: every control on
 * School years & sections is a manager's, and School profile is the heading the
 * forms an adviser issues already print — the attendance rule that used to give
 * them a reason to open it moved to the calendar in 0.90.5.
 *
 * `hiddenFor` only hides. The API still answers both reads, so nothing an
 * adviser could previously do becomes a refusal, and no permission moved.
 */
describe('what an adviser is not offered in the navigation', () => {
  const route = (id: string) => routes.find(r => r.id === id)!;

  it('leaves School profile and School years out of an adviser’s navigation', () => {
    for (const id of ['school', 'years']) {
      expect(available(route(id), 'teacher'), id).toBe(false);
    }
  });

  it('keeps both for the principal and the administrative officer', () => {
    for (const id of ['school', 'years']) {
      expect(available(route(id), 'principal'), id).toBe(true);
      expect(available(route(id), 'administrative_officer'), id).toBe(true);
    }
  });

  it('changes no permission: the reads are still allowed', () => {
    // `hiddenFor` is navigation only, and neither route is manager-gated at the
    // API. A screen hidden from a role whose API also refused it would be a
    // permission change dressed as a menu change.
    for (const id of ['school', 'years']) {
      expect('manager' in route(id) && route(id).manager, id).toBeFalsy();
    }
  });

  it('still leaves an adviser the screens their work actually needs', () => {
    // A guard against hiding too much: these are the adviser's own screens.
    for (const id of ['attendance', 'calendar', 'learners', 'prior-records', 'report-cards']) {
      expect(available(route(id), 'teacher'), id).toBe(true);
    }
  });
});

/**
 * Academic history, closed to the advisers who can never use it.
 *
 * An SF10 scholastic block is Grade 1 to Grade 6; Kindergarten is never one,
 * it is the credential presented for Grade 1 (and `0051`'s writer refuses any
 * other grade with `P2504`). So an adviser whose classes are all Kindergarten
 * or Grade 1 has no previous school year to encode for anybody in them.
 *
 * Their classes decide it rather than their role, which is why it is not
 * `hiddenFor`.
 */
describe('Academic history and the grades an adviser teaches', () => {
  it('closes it to an adviser who teaches only Kindergarten, only Grade 1, or both', () => {
    for (const grades of [[0], [1], [0, 1], [1, 0, 1]]) {
      expect(hiddenByAssignment('teacher', grades), grades.join('+')).toEqual(['prior-records']);
    }
  });

  it('leaves it open as soon as one class is Grade 2 or above', () => {
    // The learners in that one class do have a previous year to encode.
    for (const grades of [[2], [0, 2], [1, 6], [3, 4, 5]]) {
      expect(hiddenByAssignment('teacher', grades), grades.join('+')).toEqual([]);
    }
  });

  it('never narrows a manager, whose view is the whole school', () => {
    for (const role of ['principal', 'administrative_officer']) {
      expect(hiddenByAssignment(role, [0, 1]), role).toEqual([]);
    }
  });

  it('leaves an adviser with no sections yet alone', () => {
    // Between assignments is not "only early grades": losing the screen
    // silently would be indistinguishable from a fault.
    expect(hiddenByAssignment('teacher', [])).toEqual([]);
  });
});
