// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { School } from '../web/screens/Setup';
import { Calendar } from '../web/screens/Calendar';
import { routes } from '../web/routes';

/**
 * Where the school's attendance rule is recorded.
 *
 * It moved off School profile on 2026-11-05, which was asked for: that screen
 * is the school's identity and the heading its forms carry, not how a morning
 * and an afternoon mark become one mark on the SF2. It went to the
 * Instructional calendar, the other half of the same question — the calendar
 * says which dates are days of classes.
 *
 * The reason this is a test and not a glance: the rule is the **only** thing
 * the SF2's and SF4's attendance figures are counted by, and both forms are
 * refused without it. Deleting the card rather than moving it would have left
 * it unreachable and quietly broken both, so what has to hold is that it is
 * gone from one screen and really present on the other.
 */

let db: TestDatabase;
let server: ServerApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const section = '00000000-0000-4000-9000-00000000000a';
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const schoolRoute = routes.find(r => r.id === 'school')!;
const calendarRoute = routes.find(r => r.id === 'calendar')!;
const HEADING = 'Attendance rule for the school forms';

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000004']);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address) values(1,'Balili Elementary School','135617','Km. 5, Balili, La Trinidad, Benguet')`);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Masigla',$3)`,
    [section, year2026, ids.teacher]);
  // A year cannot be activated without its reporting periods.
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First','2026-06-01','2026-08-31'),($1,2,'Second','2026-09-01','2026-11-30'),
    ($1,3,'Third','2026-12-01','2027-01-31'),($1,4,'Fourth','2027-02-01','2027-03-31')`, [year2026]);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2026]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('the attendance rule', () => {
  it('is no longer on School profile, which keeps the school’s own details', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(School as never, server, principal, { route: schoolRoute });
    await screen.until(m => m.text().includes('Balili Elementary School'), 'the school’s details');
    expect(screen.text()).not.toContain(HEADING);
    // The screen still does its own job, so this removed a card and not the page.
    expect(screen.text()).toContain('Edit details');
    screen.unmount();
  });

  it('is on the Instructional calendar, and really renders there', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Calendar as never, server, principal, { route: calendarRoute });
    // Past the skeleton and the no-year empty state: the card is below the
    // calendar itself, so the screen has to have loaded for this to mean
    // anything.
    await screen.until(m => m.text().includes(HEADING), 'the attendance rule card');
    expect(screen.text()).toContain(HEADING);
    screen.unmount();
  });
});
