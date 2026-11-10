// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { Learners } from '../web/screens/Learners';
import { routes } from '../web/routes';
import { ROSTER_HEADER } from '../web/csv';

/**
 * The learner a staff member opens from the registry, in two parts.
 *
 * - The panel offers **two** parts, profile first. Academic history was removed
 *   from here on 2026-11-05, which puts this panel back where 0.90.2 left it:
 *   no door into that screen, because the rail already carries it. The gate for
 *   that is in `tests/web-registry-scope.test.ts`, and it was vacuous on its
 *   first run because it asserted on the *closed* list; the one here opens the
 *   panel, which is the only place such a link could be.
 * - Every field shown is one the record holds, and a field the school has not
 *   recorded is **drawn**, not blanked: the `Unrecorded` rule, and a profile is
 *   where a reader most readily takes a blank for "nothing to report".
 * - **The guardian pair is held and shown** (0056), and the number is kept
 *   exactly as recorded rather than reformatted. What the learner-fields gate
 *   still blocks is asserted refused, because a gate kept by nothing opens by
 *   accident: a relationship field, a guardian email or address, a second
 *   guardian, and the learner's own `contact_number`, which is not the
 *   guardian's.
 * - **Editing is an action, not a disclosure**, and it writes to the same
 *   learner row, so the registry shows the change and **no second learner is
 *   created** — the one thing a "profile" feature can get catastrophically
 *   wrong in a system with one permanent record per child.
 * - An adviser is offered no editor, and the API refuses one anyway.
 */

let db: TestDatabase;
let server: ServerApi;
const year = '00000000-0000-4000-9000-000000000001';
const mine = '00000000-0000-4000-9000-00000000000a';
const theirs = '00000000-0000-4000-9000-00000000000b';
const ana = '00000000-0000-4000-9001-000000000001';
const ben = '00000000-0000-4000-9001-000000000002';

const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const route = routes.find(r => r.id === 'learners')!;

/**
 * Open one named learner's panel. By surname rather than by row index: the
 * registry lists learners the way a register reads, so row 0 is Lacsamana, and
 * a test that corrected "the first row" would be correcting the wrong child.
 */
const openPanel = async (screen: Awaited<ReturnType<typeof mountScreen>>, surname = 'Reyes') => {
  const row = screen.all('tr').find(tr => (tr.textContent ?? '').includes(surname));
  await screen.click(row?.querySelector<HTMLElement>('button.row-toggle') ?? null);
  await screen.until(m => m.all('tr.row-panel').length > 0, `${surname}'s open panel`);
};
/** The open panel's own text, so an assertion cannot read the list behind it. */
const panelText = (screen: Awaited<ReturnType<typeof mountScreen>>) =>
  (screen.all('tr.row-panel')[0]?.textContent ?? '').replace(/\s+/g, ' ');
const openTab = async (screen: Awaited<ReturnType<typeof mountScreen>>, label: string) => {
  await screen.click(screen.all('[role="tab"]').find(t => t.textContent === label) ?? null);
  await screen.settle();
};

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000004']);
  // A year is created as a draft and opened afterwards (`0001`/`0040` refuse
  // any other status on insert); the placement the registry reports is the
  // learner's enrolment in the *active* year, so this one has to be opened.
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$3,3,'Masigla',$4),($2,$3,4,'Narra',$5)`, [mine, theirs, year, ids.teacher, ids.otherTeacher]);
  // Ana as the class-list import writes a complete row; Ben with the two
  // columns the import allows to be blank left blank.
  // Ana carries a guardian and a number written the way a school writes one:
  // a landline with an area code and a mobile, on one line. Ben carries
  // neither, which is unrecorded rather than "no guardian".
  await db.pg.query(`insert into edunexus.learners(id,lrn,first_name,middle_name,last_name,name_extension,sex,birth_date,address,guardian_name,guardian_contact) values
    ($1,'136170000001','Ana','Bituin','Reyes',null,'female','2017-05-02','12 Balili Road, La Trinidad, Benguet','Maria Reyes (mother)','(074) 422-1234 / 0917 555 0101'),
    ($2,'136170000002','Ben',null,'Lacsamana',null,'male','2016-03-11',null,null,null)`, [ana, ben]);
  await db.pg.query(`select * from edunexus.place_enrollment($1::uuid,$2::uuid,3::smallint,$3::uuid,'2026-06-01','regular')`, [ana, year, mine]);
  await db.pg.query(`select * from edunexus.place_enrollment($1::uuid,$2::uuid,4::smallint,$3::uuid,'2026-06-01','regular')`, [ben, year, theirs]);
  // A year cannot be activated until its reporting periods are set: four
  // quarters, as the school's own SF9 reports.
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First', '2026-06-01','2026-08-31'),
    ($1,2,'Second','2026-09-01','2026-11-30'),
    ($1,3,'Third', '2026-12-01','2027-01-31'),
    ($1,4,'Fourth','2027-02-01','2027-03-31')`, [year]);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('the two parts of a learner', () => {
  it('offers the profile and the enrollment, and shows the profile first', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    const tabs = screen.all('[role="tab"]').map(t => t.textContent);
    expect(tabs).toEqual(['Learner profile', 'Enrollment']);
    // The first one is the one selected, so a reader lands on the identity.
    expect(screen.all('[role="tab"][aria-selected="true"]').map(t => t.textContent)).toEqual(['Learner profile']);
    expect(screen.text()).toContain('Personal information');
    screen.unmount();
  });

  it('shows an adviser the same two parts for a learner in their own class', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Reyes'), 'their own learner');
    // Row security, not the screen: the other adviser's learner is not listed.
    expect(screen.text()).not.toContain('Lacsamana');
    await openPanel(screen);
    expect(screen.all('[role="tab"]').map(t => t.textContent)).toEqual(['Learner profile', 'Enrollment']);
    screen.unmount();
  });
});

describe('what the profile shows', () => {
  it('shows the fields the class-list import carried, without a second import', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    const text = screen.text();
    // Every column of the import's own header, read back from the one record it writes.
    expect(text).toContain('136170000001');
    expect(text).toContain('Reyes');
    expect(text).toContain('Ana');
    expect(text).toContain('Bituin');
    expect(text).toContain('2017-05-02');
    expect(text).toContain('Female');
    expect(text).toContain('12 Balili Road, La Trinidad, Benguet');
    screen.unmount();
  });

  it('draws a field the school has not recorded instead of leaving it blank', async () => {
    // Ben has no middle name and no address on file. Neither is evidence of
    // anything, and neither may read as an empty box someone forgot.
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Lacsamana'), 'the learner with blanks');
    await openPanel(screen, 'Lacsamana');
    expect(panelText(screen)).toContain('None recorded');
    expect(panelText(screen)).toContain('No address recorded');
    // No value is blank, and none is an em dash standing in for one. Read from
    // the fact lists themselves rather than the panel's prose, which uses a
    // real em dash in a sentence.
    const values = screen.all('tr.row-panel dl.facts dd').map(dd => (dd.textContent ?? '').trim());
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter(v => v === '' || v === '—')).toEqual([]);
    screen.unmount();
  });

  it('shows the parent or guardian and their number, the number exactly as recorded', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    const text = panelText(screen);
    expect(text).toContain('Parent or guardian');
    expect(text).toContain('Maria Reyes (mother)');
    // Kept as the school wrote it: not stripped to digits, not normalised to
    // +63, not reformatted. A number the school can dial is the whole point.
    expect(text).toContain('(074) 422-1234 / 0917 555 0101');
    screen.unmount();
  });

  it('draws an unrecorded guardian rather than implying the learner has none', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Lacsamana'), 'the learner with blanks');
    await openPanel(screen, 'Lacsamana');
    expect(panelText(screen)).toContain('No guardian recorded');
    expect(panelText(screen)).toContain('No number recorded');
    screen.unmount();
  });

  it('still offers nothing the learner-fields gate blocks, and says what it does not hold', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    const panel = screen.all('tr.row-panel')[0]!;
    const labels = [...panel.querySelectorAll('label, dt')].map(el => (el.textContent ?? '').toLowerCase());
    // One guardian, one number, and nothing else about a family. "Relationship"
    // in particular: it is written into the name, not chosen from a list this
    // project invented.
    for (const banned of ['relationship', 'mother tongue', 'religion', 'indigenous', 'email', 'occupation', 'second guardian']) {
      expect(labels.filter(l => l.includes(banned)), banned).toEqual([]);
    }
    expect(labels.filter(l => l.includes('guardian'))).toHaveLength(1);
    // And the absence is explained, so a reader does not take it for an
    // unfilled box: which of these the school may keep is behind the gate.
    expect(screen.text()).toContain('What this record does not hold');
    screen.unmount();
  });

  it('refuses at the API every family field the gate still blocks', async () => {
    // The screen not drawing a box is not a gate. The contract is strict, so a
    // field somebody adds hopefully is a 422 rather than a silent drop.
    // `contact_number` is the *learner's* own and is not `guardian_contact`.
    server.signInAs('principal');
    for (const extra of ['guardian_relationship', 'guardian_email', 'contact_number', 'religion', 'mother_tongue']) {
      const refused = await server.api('/learners', 'POST', {
        lrn: '136170000900', first_name: 'Gate', last_name: 'Check', birth_date: '2016-01-01', sex: 'male', [extra]: 'something',
      }).then(() => null, (error: unknown) => error as { status?: number });
      expect(refused?.status, extra).toBe(422);
    }
  });

  it('is not ahead of the class-list template, which carries nine columns and still no guardian', () => {
    // A guard against this screen drifting away from the import. The guardian
    // pair was added to the *record* (0056) and deliberately NOT to the
    // published template, so a class list imports as it always did and the
    // guardian is typed per learner. If the template ever gains the two
    // columns, this is the line that says so.
    // 0.100.0 added grade_level, one grade per learner; the guardian pair is still not a column (0.99.0 records
    // that an adviser therefore cannot supply one, and that adding them would be the school's decision).
    expect(ROSTER_HEADER.split(',')).toEqual(['lrn', 'first_name', 'middle_name', 'last_name', 'name_extension', 'birth_date', 'sex', 'address', 'grade_level']);
  });
});

describe('editing the profile', () => {
  it('writes to the same learner record and creates no second learner', async () => {
    const before = await db.pg.query<{ n: string }>('select count(*) as n from edunexus.learners');
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    // Editing is an action now, not a disclosure: **Edit profile** opens a
    // sheet. It used to be folded inside a `Task`, where the reviewed
    // workflows live, and a plain correction read as unavailable there.
    await screen.click(screen.byText('Edit profile', 'button'));
    // A `label` for the contact number exists only inside the sheet — the panel
    // behind it renders that heading as a `dt` — so this waits for the form.
    await screen.until(m => m.all('label').some(l => (l.textContent ?? '').startsWith('Contact number')), 'the edit sheet');
    const address = screen.field('Address');
    await screen.type(address, '7 Km 5, Balili, La Trinidad, Benguet');
    // The guardian is edited in the same sheet and the same request: one
    // record, so one save.
    await screen.type(screen.field('Parent or guardian'), 'Maria Reyes (mother)');
    await screen.type(screen.field('Contact number'), '0917 555 0101');
    await screen.submit(address);
    // The harness's `reload` is deliberately a no-op — the shell's refetch is
    // driven by remounting — so what is waited on is the record, not the
    // markup. The remount is the next case.
    for (let i = 0; i < 40; i++) {
      const [row] = await db.pg.query<{ version: number }>('select version from edunexus.learners where id=$1', [ana]);
      if (row!.version > 1) break;
      await screen.settle();
    }

    // One record, corrected in place: the same id, a bumped version, no insert.
    const after = await db.pg.query<{ n: string }>('select count(*) as n from edunexus.learners');
    expect(after[0]!.n).toBe(before[0]!.n);
    const saved = await db.pg.query<{ address: string; guardian_contact: string; version: number }>('select address,guardian_contact,version from edunexus.learners where id=$1', [ana]);
    expect(saved[0]!.address).toBe('7 Km 5, Balili, La Trinidad, Benguet');
    expect(saved[0]!.guardian_contact).toBe('0917 555 0101');
    expect(saved[0]!.version).toBe(2);
    screen.unmount();
  });

  it('shows the correction in the registry list the same change feeds', async () => {
    // The point of there being one record: what was corrected in the panel is
    // what the list, the class list and the forms read on their next read.
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    expect(screen.text()).toContain('7 Km 5, Balili, La Trinidad, Benguet');
    screen.unmount();
  });

  it('offers an adviser no editor, and tells them whose it is', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Learners as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Reyes'), 'their own learner');
    await openPanel(screen);
    expect(screen.byText('Edit profile', 'button')).toBeNull();
    expect(screen.text()).not.toContain('Identity links');
    expect(screen.text()).toContain('Corrections stay with the office');
    // They still read the guardian of a learner in their own class: the read
    // scope did not change, only who may write.
    expect(panelText(screen)).toContain('Parent or guardian');
    screen.unmount();
  });

  it('refuses an adviser at the API, not only in the screen', async () => {
    // Hiding a Task is not a permission. The same correction, sent directly by
    // an adviser for a learner in their *own* class, is still refused.
    const before = await db.pg.query<{ address: string; version: number }>('select address,version from edunexus.learners where id=$1', [ana]);
    server.signInAs('teacher');
    const refused = await server.api(`/learners/${ana}`, 'PATCH', {
      last_name: 'Reyes', first_name: 'Ana', middle_name: 'Bituin', name_extension: null,
      birth_date: '2017-05-02', sex: 'female', address: 'Anything at all',
      guardian_name: 'Anyone', guardian_contact: '0900 000 0000', version: before[0]!.version,
    }).then(() => null, (error: unknown) => error as { status?: number });
    expect(refused?.status).toBe(403);
    const after = await db.pg.query<{ address: string }>('select address from edunexus.learners where id=$1', [ana]);
    expect(after[0]!.address).toBe(before[0]!.address);
  });
});

describe('the enrollment part', () => {
  it('shows where the learner is this year, and every year they have been enrolled', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    await openTab(screen, 'Enrollment');
    await screen.until(m => m.text().includes('School years'), 'the enrolment history');
    const text = screen.text();
    expect(text).toContain('This school year');
    expect(text).toContain('2026–2027');
    expect(text).toContain('Grade 3');
    expect(text).toContain('Masigla');
    expect(text).toContain('Enrolled');
    screen.unmount();
  });

  /**
   * The SF9 column, asked for on 2026-11-09: *"The learner's profile should
   * preserve access to previously issued SF9 documents."* The access was
   * already there — each year's row has its own **SF9** button, and the card is
   * derived per enrolment so a later grade cannot overwrite an earlier one. What
   * was missing was any way to see which years had been issued, so a reader had
   * no way to tell a preserved card from one never made.
   */
  it('says, for each school year, whether that year’s report card has been issued', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Learners as never, server, principal, { route });
    await screen.until(m => m.text().includes('Reyes'), 'a learner');
    await openPanel(screen);
    await openTab(screen, 'Enrollment');
    await screen.until(m => m.text().includes('Report card'), 'the report-card column');
    // Nothing has been issued for this learner, so the year reads as under way
    // rather than as a blank the reader has to interpret.
    expect(screen.text()).toContain('In progress');
    expect(screen.text()).toContain('neither overwrites the other');
    screen.unmount();
  });
});

/**
 * Academic history is not in this panel at all.
 *
 * It has been taken out of here twice now, which is why the gate is explicit.
 * 0.90.2 removed the shortcut *Academic history before EDUNEXUS* because the
 * navigation rail already carries the screen; 0.91.1 reorganised the panel and
 * gave it a signpost tab with no link; 0.92.0 removed that too, on the user's
 * instruction. The screen, its route and every historical record are untouched
 * — `tests/web-registry-scope.test.ts` asserts the route still exists and is
 * open to an adviser.
 *
 * The companion gate there was vacuous on its first run because it asserted on
 * the *closed* learner list, where nothing inside a learner's panel is
 * rendered. This one opens the panel first, and checks both parts of it.
 */
describe('academic history is not in the registry panel', () => {
  it('offers no tab, no link and no mention of it, for either role', async () => {
    for (const [who, me] of [['principal', principal], ['teacher', teacher]] as const) {
      server.signInAs(who);
      const screen = await mountScreen(Learners as never, server, me, { route });
      await screen.until(m => m.text().includes('Reyes'), `a learner, as ${who}`);
      await openPanel(screen);
      // Both parts, since a link could live in either.
      for (const part of ['Learner profile', 'Enrollment'] as const) {
        await openTab(screen, part);
        expect(screen.all('a').some(a => (a.getAttribute('href') ?? '').includes('prior-records')), `${who}/${part}`).toBe(false);
      }
      expect(screen.all('[role="tab"]').map(t => t.textContent), who).not.toContain('Academic history');
      expect(screen.text(), who).not.toContain('Academic history before EDUNEXUS');
      screen.unmount();
    }
  });

  it('leaves the screen itself reachable, which is where the records are', () => {
    // Removing the door must not remove the room.
    const history = routes.find(r => r.id === 'prior-records');
    expect(history).toBeTruthy();
    expect(history?.manager).not.toBe(true);
    expect(history?.hiddenFor ?? []).not.toContain('teacher');
  });
});
