// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { PriorRecords } from '../web/screens/PriorRecords';
import { routes } from '../web/routes';

/**
 * The Academic history screen against the real API, which is what
 * `tests/web-prior-records.test.ts` could not do: that file drives the screen
 * through a stubbed client, because this harness was lost with `tests/` in the
 * 0.86.1 recovery. It stays — a stub is still the quickest way to assert the
 * layout of something the server would need a long fixture to produce — and
 * what is added here is the half it cannot reach.
 *
 * So the point of this file is the paths a stub cannot prove: that the search
 * the screen sends is one the API accepts, that what comes back is shaped the
 * way the screen reads it, and that the manager/teacher boundary the screen
 * draws is the one the database actually enforces rather than one the test
 * handed it.
 */

let db: TestDatabase;
let server: ServerApi;

const year2026 = '00000000-0000-4000-9000-000000000001';
const sectionA = '00000000-0000-4000-9000-00000000000a';
const sectionB = '00000000-0000-4000-9000-00000000000b';
const ana = '00000000-0000-4000-9001-000000000001';
const ben = '00000000-0000-4000-9001-000000000002';

const route = routes.find(r => r.id === 'prior-records')!;
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','135617','Balili, La Trinidad, Benguet','Cordillera Administrative Region','Benguet','La Trinidad')`);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'A',$3)`, [sectionA, year2026, ids.teacher]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,5,'B',$3)`, [sectionB, year2026, ids.otherTeacher]);
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values
    ($1,'Ana','Reyes','female','2017-05-02','136170000001'),($2,'Ben','Lacsamana','male','2015-03-11','136170000002')`, [ana, ben]);
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
    ('00000000-0000-4000-9002-000000000001',$1,$2,3,$3,'2026-06-01','2026-06-01','regular'),
    ('00000000-0000-4000-9002-000000000002',$4,$2,5,$5,'2026-06-01','2026-06-01','regular')`,
    [ana, year2026, sectionA, ben, sectionB]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

/** The screen as a role sees it, with the real client behind it. */
const open = async (who: 'principal' | 'teacher') => {
  server.signInAs(who);
  return mountScreen(PriorRecords as never, server, who === 'principal' ? principal : teacher, { route });
};

/** Search as the Finder does — type, then submit its form — and wait for the API's rows. */
const search = async (m: Awaited<ReturnType<typeof open>>, text: string) => {
  const field = m.field('Name or LRN');
  await m.type(field, text);
  await m.submit(field);
  await m.until(v => !/Find the learner first/.test(v.text()), 'the search to run');
};

describe('Academic history against the real API', () => {
  it('starts from the learner, and says so rather than listing the school', async () => {
    const m = await open('principal');
    // The screen deliberately does not page the registry: every learner list
    // writes a privacy access row, so this one waits to be asked.
    expect(m.text()).toMatch(/Find the learner first/);
    expect(server.sent.filter(s => s.path.includes('/learners?'))).toHaveLength(0);
    m.unmount();
  });

  it('sends a search the API accepts, and reads back what it answered', async () => {
    const m = await open('principal');
    const before = server.sent.length;
    await search(m, 'Reyes');

    // The request the screen built was accepted: a 422 would have left the
    // table empty and put a refusal on the status line instead.
    const asked = server.sent.slice(before).filter(s => s.path.startsWith('/api/v1/learners?'));
    expect(asked.length).toBeGreaterThan(0);
    expect(m.status.filter(Boolean)).toHaveLength(0);

    // And the row is the database's learner, read through the screen's own
    // column definitions: the name, the LRN and the grade they are in now.
    expect(m.text()).toMatch(/Reyes/);
    expect(m.text()).toMatch(/136170000001/);
    expect(m.text()).toMatch(/Grade 3/);
    m.unmount();
  });

  it('shows an adviser only their own learners, because the row policy does', async () => {
    // `teacher` advises Grade 3 A, which is Ana's, and not Grade 5 B.
    const mine = await open('teacher');
    await search(mine, 'Reyes');
    expect(mine.text()).toMatch(/Reyes/);
    mine.unmount();

    // Ben is in Grade 5 B, which `otherTeacher` advises. Searching his name by
    // name finds nobody — not because the screen filtered him out, but because
    // the row policy never returned him.
    const theirs = await open('teacher');
    await search(theirs, 'Lacsamana');
    expect(theirs.text()).toMatch(/No learners match/);
    expect(theirs.text()).not.toMatch(/Lacsamana/);
    theirs.unmount();

    // The same search as a manager finds him, which is what proves the first
    // half was row security and not a typo.
    const office = await open('principal');
    await search(office, 'Lacsamana');
    expect(office.text()).toMatch(/Lacsamana/);
    office.unmount();
  });

  it('opens one learner’s history, and that read is the deliberate one', async () => {
    const m = await open('principal');
    await search(m, 'Reyes');
    const before = server.sent.length;
    await m.click(m.byText('Open the history', 'button'));
    await m.until(v => /Reyes/.test(v.text()) && !/Open the history/.test(v.text()), 'the learner’s history to open');

    // Opening a learner reads their records; the list never did.
    expect(server.sent.slice(before).map(s => s.path))
      .toContain(`/api/v1/learners/${ana}/prior-records`);
    // A manager may encode, so the screen offers it.
    expect(m.byText('Add a school year', 'button')).not.toBeNull();
    m.unmount();
  });

  it('offers encoding to an adviser for their own learner, which is the one exception', async () => {
    const m = await open('teacher');
    await search(m, 'Reyes');
    await m.click(m.byText('Open the history', 'button'));
    await m.until(v => !/Open the history/.test(v.text()), 'the learner’s history to open');

    // The adviser exception (decided 2026-11-03): an adviser encodes the
    // historical records of the learners currently in the sections they advise.
    // `may_write` comes from the database, not from the screen's own guess at
    // the role, which is the thing this test is for.
    expect(m.byText('Add a school year', 'button')).not.toBeNull();
    m.unmount();
  });
});
