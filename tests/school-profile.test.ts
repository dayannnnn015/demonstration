// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { School } from '../web/screens/Setup';
import { routes } from '../web/routes';

/**
 * What School profile shows beyond the record itself (0.90.6).
 *
 * Two additions, both built only from what EDUNEXUS already held, which is why
 * neither needed a field or a migration:
 *
 *  - the heading the official forms print, with the unset lines **named**,
 *    because the forms omit what is unset rather than marking it and the only
 *    way to find out used to be to print an SF9 and look;
 *  - the change history, whose rows the `audit_record` trigger has been
 *    writing since `0001` while no read could ask for one record's own
 *    history, so the journal existed and no screen could show it.
 */

let db: TestDatabase;
let server: ServerApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const route = routes.find(r => r.id === 'school')!;

type Audit = { items: { entity_table: string; changed_fields: string[] | null; operation: string }[] };

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000005']);
  // Deliberately partial: a name and an address, no region, division, district
  // or school head — the state a school is in before it supplies them.
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address)
    values(1,'Balili Elementary School','135617','Km. 5, Balili, La Trinidad, Benguet')`);
  // A change to another kind of record, so the filter has something to exclude.
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('the school’s own change history', () => {
  it('returns only the school’s changes when asked for them', async () => {
    server.signInAs('principal');
    // Edit it, so there is a change and not only the first record.
    const school = await server.api<{ version: number }>('/school');
    const saved = await server.api('/school', 'PATCH', {
      name: 'Balili Elementary School', school_code: '135617',
      address: 'Km. 5, Balili, La Trinidad, Benguet', region: 'Cordillera Administrative Region',
      version: school.version,
    });
    expect(saved).toBeTruthy();

    const mine = await server.api<Audit>('/audit-events?entity_table=school_profile&limit=25');
    expect(mine.items.length).toBeGreaterThan(0);
    // Only the school, though a school year was created too.
    expect([...new Set(mine.items.map(r => r.entity_table))]).toEqual(['school_profile']);
    // And the newest row names the field that moved.
    expect(mine.items[0]!.changed_fields).toContain('region');

    // Unfiltered still answers for everything, so nothing was narrowed for
    // callers that did not ask.
    const all = await server.api<Audit>('/audit-events?limit=25');
    expect(new Set(all.items.map(r => r.entity_table))).toContain('academic_years');
  });

  it('refuses a value that is not one of the journalled tables', async () => {
    server.signInAs('principal');
    // A closed list, not free text: an unbounded value would invite probing.
    await expect(server.api('/audit-events?entity_table=auth.users')).rejects.toThrow();
  });

  it('stays manager-only, as the whole audit always was', async () => {
    server.signInAs('teacher');
    await expect(server.api('/audit-events?entity_table=school_profile')).rejects.toThrow();
  });
});

describe('School profile', () => {
  it('shows the heading the forms print, naming the lines that are not set', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(School as never, server, principal, { route });
    await screen.until(m => m.text().includes('How this prints on the forms'), 'the heading preview');
    const text = screen.text();
    // What is set appears as it will print.
    expect(text).toContain('Republic of the Philippines');
    expect(text).toContain('BALILI ELEMENTARY SCHOOL');
    expect(text).toContain('School ID 135617');
    // What is not set is named rather than silently missing, and the note says
    // what will happen to it.
    expect(text).toContain('Schools division not set');
    expect(text).toContain('District not set');
    expect(text).toMatch(/left out of the heading rather than printed blank/);
    // And the signature line, which is the other thing a form carries.
    expect(text).toContain('The school head is not set');
    screen.unmount();
  });

  it('shows the change history to a manager', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(School as never, server, principal, { route });
    await screen.until(m => m.text().includes('Change history'), 'the history card');
    screen.unmount();
  });

  it('does not show the history to a teacher, whose audit read would be refused', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(School as never, server, teacher, { route, manager: false });
    await screen.until(m => m.text().includes('How this prints on the forms'), 'the heading preview');
    // The preview is theirs to see — it is the heading of forms they print.
    // The journal is not, so the card is not rendered rather than rendering an
    // error where a refusal would land.
    expect(screen.text()).not.toContain('Change history');
    screen.unmount();
  });
});
