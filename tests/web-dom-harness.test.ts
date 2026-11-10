// @vitest-environment happy-dom
import { useEffect, useState } from 'react';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mount, serverApi, type ServerApi } from './helpers/dom.js';
import { ApiError, type Api } from '../web/api';

/**
 * The harness itself, held to what `AGENTS.md` asks of it: a screen's data
 * paths driven in a real DOM against the real API, so a fetch, a refusal and a
 * version conflict all run end to end.
 *
 * This file exists because `tests/helpers/dom.ts` was lost with `tests/` in the
 * 0.86.1 recovery, and a harness nothing exercises is a harness that quietly
 * stops working. Every assertion below would pass against a mock; what makes
 * them worth running is that none of them is talking to one. The path is the
 * real client, a real HTTP request, the real operation table, the real Zod
 * contract, the real role gate and the migrations' own SQL under row security.
 */

let db: TestDatabase;
let server: ServerApi;

const year2026 = '00000000-0000-4000-9000-000000000001';
const sectionA = '00000000-0000-4000-9000-00000000000a';
const sectionB = '00000000-0000-4000-9000-00000000000b';
const kinderA = '00000000-0000-4000-9000-00000000000c';
const ana = '00000000-0000-4000-9001-000000000001';
const ben = '00000000-0000-4000-9001-000000000002';
/** Kai is in Kindergarten, which is not a scholastic block, so Kai has no SF10. */
const kai = '00000000-0000-4000-9001-000000000003';
const anaEnrollment = '00000000-0000-4000-9002-000000000001';
const benEnrollment = '00000000-0000-4000-9002-000000000002';
const kaiEnrollment = '00000000-0000-4000-9002-000000000003';

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
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,0,'Kinder A',$3)`, [kinderA, year2026, ids.teacher]);
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values
    ($1,'Ana','Reyes','female','2017-05-02','136170000001'),($2,'Ben','Lacsamana','male','2015-03-11','136170000002'),
    ($3,'Kai','Pucay','male','2021-01-20','136170000003')`, [ana, ben, kai]);
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
    ($1,$2,$3,3,$4,'2026-06-01','2026-06-01','regular'),($5,$6,$3,5,$7,'2026-06-01','2026-06-01','regular'),
    ($8,$9,$3,0,$10,'2026-06-01','2026-06-01','regular')`,
    [anaEnrollment, ana, year2026, sectionA, benEnrollment, ben, sectionB, kaiEnrollment, kai, kinderA]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

/**
 * A screen reduced to the one thing every screen does: read through the client
 * in an effect, then render what came back or what was refused. Anything that
 * works here works for a real screen, because it is the same client.
 */
function Reader({ api, path }: { api: Api; path: string }) {
  const [state, setState] = useState<{ text: string; code?: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<Record<string, unknown>>(path)
      .then(data => { if (live) setState({ text: JSON.stringify(data) }); })
      .catch((error: unknown) => {
        if (!live) return;
        setState(error instanceof ApiError ? { text: error.message, code: error.code } : { text: String(error) });
      });
    return () => { live = false; };
  }, [api, path]);
  if (!state) return createElement('p', null, 'Loading');
  return createElement('div', null,
    createElement('p', { className: 'body' }, state.text),
    createElement('p', { className: 'code' }, state.code ?? 'none'));
}

const read = async (path: string) => {
  const m = await mount(createElement(Reader, { api: server.api, path }));
  // Wait for the effect's request to land, rather than for a fixed number of
  // ticks: the request is real, so how long it takes is not the test's business.
  await m.until(v => v.text() !== 'Loading', `the read of ${path} to answer`);
  return { body: m.all('.body')[0]?.textContent ?? '', code: m.all('.code')[0]?.textContent ?? '', m };
};

describe('the DOM harness drives the real API', () => {
  it('runs a screen’s effect, sends a real request and renders what the database answered', async () => {
    server.signInAs('principal');
    const before = server.sent.length;
    const { body, code, m } = await read(`/learners/${ana}/prior-records`);

    // The request actually left the client, at the path the client builds.
    expect(server.sent.slice(before).map(s => `${s.method} ${s.path}`))
      .toContain(`GET /api/v1/learners/${ana}/prior-records`);
    expect(code).toBe('none');
    // And what rendered is the database's own answer, not a fixture.
    const data = JSON.parse(body) as { learner: { last_name: string }; may_write: boolean; prior_years: unknown[] };
    expect(data.learner.last_name).toBe('Reyes');
    expect(data.may_write).toBe(true);
    expect(data.prior_years).toEqual([]);
    m.unmount();
  });

  it('carries a refusal’s own code to the screen, through the client’s ApiError', async () => {
    server.signInAs('principal');
    // Kai's only school year is Kindergarten, so there is no SF10 to lay out:
    // the form begins at Grade 1, and a blank permanent record is the one thing
    // a Kinder learner's records must not be replaced by.
    const { body, code, m } = await read(`/learners/${kai}/forms/sf10`);
    expect(code).toBe('SF10_NOT_YET');
    expect(body).toMatch(/Kindergarten/);
    expect(body).toMatch(/SF5-K|ECCD/);
    m.unmount();

    // And the distinction holds: Ana has a recorded Grade 3 year, so she does
    // have one. A refusal that fired for everybody would prove nothing.
    const hers = await read(`/learners/${ana}/forms/sf10`);
    expect(hers.code).toBe('none');
    expect(hers.body).toMatch(/Reyes/);
    hers.m.unmount();
  });

  it('applies row security to the signed-in teacher, not a filter in the test', async () => {
    // `teacher` advises Grade 3 A, which is Ana's.
    server.signInAs('teacher');
    const mine = await read(`/learners/${ana}/prior-records`);
    expect(mine.code).toBe('none');
    expect(mine.body).toMatch(/Reyes/);
    mine.m.unmount();

    // Ben is in Grade 5 B, which `otherTeacher` advises. The same screen, the
    // same path, a different signed-in staff member: the database decides.
    const theirs = await read(`/learners/${ben}/prior-records`);
    expect(theirs.code).toBe('NOT_FOUND');
    expect(theirs.body).not.toMatch(/Lacsamana/);
    theirs.m.unmount();
  });

  it('refuses a write the role may not make, at the role gate rather than in the module', async () => {
    server.signInAs('teacher');
    // Next year's classes is manager-only, and the gate refuses before the body
    // is even read — so the message is about whose request it is, not its fields.
    await expect(server.api(`/academic-years/${year2026}/next-year-classes?target_year_id=${year2026}`))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('reports a version conflict as a conflict the screen must act on', async () => {
    server.signInAs('principal');
    const created = await server.api<{ id: string; version: number }>(`/learners/${ana}/prior-years`, 'POST', {
      year: {
        start_year: 2024, grade_level: 2, school_name: 'Balili Elementary School', school_code: '135617',
        school_address: 'Balili, La Trinidad, Benguet', section_name: 'Sampaguita', adviser_name: 'A. Dela Cruz',
        general_average: 89.5, remark: 'passed', source: 'Adviser class record spreadsheet 2024-2025',
      },
      subjects: [{ subject_id: null, code: 'FILIPINO', name: 'Filipino', q1: 88, q2: 89, q3: 90, q4: 91, final: 89.5, remark: 'passed' }],
      reason: 'Initial historical encoding from the school spreadsheet',
    });
    expect(created.version).toBe(1);

    // Changing it at the version it was read at succeeds.
    const edit = (version: number) => server.api<{ version: number }>(`/prior-years/${created.id}`, 'PATCH', {
      version,
      year: {
        start_year: 2024, grade_level: 2, school_name: 'Balili Elementary School', school_code: '135617',
        school_address: 'Balili, La Trinidad, Benguet', section_name: 'Sampaguita', adviser_name: 'A. Dela Cruz',
        general_average: 90, remark: 'passed', source: 'Adviser class record spreadsheet 2024-2025',
      },
      subjects: [{ subject_id: null, code: 'FILIPINO', name: 'Filipino', q1: 88, q2: 89, q3: 90, q4: 91, final: 90, remark: 'passed' }],
      reason: 'Corrected the general average against the signed class record',
    });
    expect((await edit(created.version)).version).toBe(2);

    // Sending the stale version again is refused, and the client reports it as a
    // conflict — which is what tells a screen to re-read rather than retry.
    const conflict = await edit(created.version).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ApiError);
    expect((conflict as ApiError).isConflict).toBe(true);
    expect((conflict as ApiError).status).toBe(409);
  });

  it('maps a field rejection to its own field, which is what Editor needs', async () => {
    server.signInAs('principal');
    const refused = await server.api(`/learners/${ana}/prior-years`, 'POST', {
      // Kindergarten is not a scholastic block on the SF10-ES.
      year: { start_year: 2022, grade_level: 0, school_name: 'Balili Elementary School', school_code: '135617', general_average: null, remark: null, source: 'x'.repeat(20) },
      subjects: [{ subject_id: null, code: 'FILIPINO', name: 'Filipino', q1: null, q2: null, q3: null, q4: null, final: null, remark: null }],
      reason: 'Initial historical encoding from the school spreadsheet',
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    const fields = (refused as ApiError).fields;
    expect(fields.map(f => f.path)).toContain('year.grade_level');
    expect(fields.find(f => f.path === 'year.grade_level')!.message).toMatch(/Kindergarten/);
  });

  it('tells the client its session is gone when the API refuses the account', async () => {
    const before = server.sessionLost();
    // A user id with no `edunexus.staff` row: the authenticator accepts the
    // string, and the API then finds nobody for it. This is what a revoked
    // account looks like from the browser, and the client must end the session
    // rather than leave a signed-in shell making requests that all refuse.
    server.signInWithToken('00000000-0000-4000-8000-00000000009f');
    await expect(server.api(`/learners/${ana}/prior-records`)).rejects.toBeInstanceOf(ApiError);
    expect(server.sessionLost()).toBeGreaterThan(before);
    server.signInAs('principal');
  });
});
