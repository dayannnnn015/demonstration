// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { Notifications, sourceOf } from '../web/screens/Notifications';
import { routes } from '../web/routes';
import { Enrollment } from '../web/screens/Enrollment';

/**
 * The notification centre's data paths, in a real DOM against the real API.
 *
 * This matters more than a rendering test because every property worth having
 * here belongs to the server, not the screen: **whose** notifications come
 * back is the row policy's answer, and **what a notification may say** is a
 * check constraint's. A mocked server would prove only that the screen agrees
 * with the mock.
 *
 * It also stands in for `tests/web-screens.test.ts`, which `AGENTS.md`
 * describes and which does not exist in this tree -- it was lost with the rest
 * of `tests/` in the 0.86.1 recovery -- so nothing else renders this route at
 * all.
 */

let db: TestDatabase;
let server: ServerApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const masigla = '00000000-0000-4000-9000-00000000000a';
const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const shell = readFileSync('web/components/AppShell.tsx', 'utf8');
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };

const header = 'lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address';
const csv = [header, '136170000401,Listed,,Child,,2017-05-02,female,Purok 4'].join('\r\n') + '\r\n';

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Masigla',$3)`,
    [masigla, year2026, ids.teacher]);

  // A real submission, so the notification under test was emitted by the writer
  // that made the change rather than inserted by the test.
  server.signInAs('teacher');
  await server.api('/roster-submissions', 'POST', {
    section_id: masigla, enrolled_on: '2026-06-01', entry_kind: 'regular', csv,
    reason: 'Submitting the class list for the office to import.',
  });
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('the notification centre', () => {
  it('is only a top-bar popout, never a route or rail item', () => {
    expect(routes.some(r => r.id === 'notifications')).toBe(false);
    expect(shell).toContain('notificationPanel');
    expect(shell).toContain('aria-haspopup="dialog"');
    expect(shell).toContain('onClick={() => setNotifications(open => !open)}');
  });

  it('shows a manager the waiting class list, naming the class and no learner', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Notifications as never, server, principal);
    await screen.until(m => m.text().includes('class list is waiting'), 'the roster notification');

    const text = screen.text();
    expect(text).toContain('Grade 3 — Masigla');
    // The learner in that very class list is not named, and cannot be: the
    // payload's keys are a closed list enforced by a check constraint.
    expect(text).not.toContain('Listed');
    expect(text).not.toContain('Child');
    // A manager may read the submitting teacher's staff row, so they are named.
    expect(text).toContain('Teacher');
  });

  it('shows an adviser nothing of a colleague’s inbox', async () => {
    // The same rows exist; the row policy answers none of them to this reader.
    server.signInAs('teacher');
    const screen = await mountScreen(Notifications as never, server, teacher);
    await screen.until(m => m.text().includes('Nothing unread'), 'the empty state');
    expect(screen.text()).not.toContain('class list is waiting');
  });

  it('marks one as read, and then has nothing unread to show', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Notifications as never, server, principal);
    await screen.until(m => m.text().includes('Mark as read'), 'the row action');

    await screen.click(screen.byText('Mark as read', 'button'));
    await screen.until(m => m.text().includes('Nothing unread'), 'the inbox emptying');

    // Still there under Everything, now marked read rather than gone.
    await screen.click(screen.byText('Everything', 'button'));
    await screen.until(m => m.text().includes('class list is waiting'), 'the read notification');
    expect(screen.text()).toContain('Read');
  });

  it('takes a principal to the waiting list on Admissions, never to a screen shut to them', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Notifications as never, server, principal);
    // Everything, because the case above has already marked it read.
    await screen.until(m => m.text().includes('Everything'), 'the filter');
    await screen.click(screen.byText('Everything', 'button'));
    await screen.until(m => m.text().includes('class list is waiting'), 'the roster notification');
    // Since 0.96.0 both managers approve a class list on Admissions, so the row leads there, at that year and class,
    // with that list to review (the UI notes of 8 November, note 5). Roster import stays shut to the principal (0.95.5),
    // and nothing links to it.
    const [list] = await db.pg.query<{ id: string }>(`select id from edunexus.roster_submissions where section_id=$1 order by created_at desc limit 1`, [masigla]);
    const links = screen.all('a[href^="#/enrollment?"]').map(a => a.getAttribute('href')!);
    expect(links.length).toBeGreaterThan(0);
    const ask = new URLSearchParams(links[0]!.split('?')[1]);
    expect(ask.get('section')).toBe(masigla);
    expect(ask.get('list')).toBe(list!.id);
    expect([...ask.keys()].sort()).toEqual(['list', 'section', 'year']);
    expect(screen.all('a[href^="#/imports"]')).toHaveLength(0);
  });

  it('opens that class list for review when the link is followed to Admissions', async () => {
    const [list] = await db.pg.query<{ id: string }>(`select id from edunexus.roster_submissions where section_id=$1 and status='submitted'`, [masigla]);
    location.hash = `#/enrollment?section=${masigla}&list=${list!.id}`;
    try {
      server.signInAs('principal');
      const screen = await mountScreen(Enrollment as never, server, principal, { route: routes.find(r => r.id === 'enrollment')! });
      await screen.until(m => m.all('.sheet').length > 0, 'the list’s review');
      expect(screen.all('.sheet')[0]!.textContent).toContain('Class list for');
      screen.unmount();
    } finally { location.hash = ''; }
  });

  it('links an adviser to the screen the notification is about', async () => {
    // The adviser's own list was declined, which is a notification addressed to
    // them, and Roster import *is* their screen.
    const [waiting] = await db.pg.query<{ id: string; version: number }>(
      `select id,version from edunexus.roster_submissions where section_id=$1 and status='submitted'`, [masigla]);
    server.signInAs('officer');
    await server.api(`/roster-submissions/${String(waiting!.id)}/decision`, 'POST', {
      version: waiting!.version, decision: 'declined', import_id: null,
      reason: 'Two birth dates look wrong. Please check and resend.',
    });

    server.signInAs('teacher');
    const screen = await mountScreen(Notifications as never, server, teacher);
    await screen.until(m => m.text().includes('needs correcting'), 'the declined notification');
    // Their own screen, at their own class; the list itself is theirs to read there.
    const link = screen.all('a[href^="#/imports?"]')[0]?.getAttribute('href') ?? '';
    expect(new URLSearchParams(link.split('?')[1]).get('section')).toBe(masigla);
    // The manager who declined it is named since 0.101.0, through a function that answers only for the caller's
    // own notification; staff_read is unchanged, so this names nobody else.
    expect(screen.text()).toContain('Administrative Officer');
    expect(screen.text()).not.toContain('Not shown to you');
  });
});

describe('where a notification leads (the UI notes of 8 November, note 5)', () => {
  it('carries a school year and a class, and a waiting list on Admissions, but never a learner', () => {
    const row = { academic_year_id: 'year-1', section_id: 'section-1', learner_id: 'learner-1', subject_table: 'enrollments', subject_id: 'enrollment-1' };
    expect(sourceOf(row, 'learners')).toBe('#/learners?year=year-1&section=section-1');
    expect(sourceOf(row, 'enrollment')).not.toContain('learner-1');
    expect(sourceOf(row, 'enrollment')).not.toContain('enrollment-1');
    expect(sourceOf({ ...row, subject_table: 'roster_submissions', subject_id: 'list-1' }, 'enrollment')).toBe('#/enrollment?year=year-1&section=section-1&list=list-1');
    expect(sourceOf({}, 'calendar')).toBe('#/calendar');
  });
});
