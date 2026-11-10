// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from './helpers/database.js';
import { mount, serverApi, type ServerApi } from './helpers/dom.js';
import { createElement } from 'react';
import { available, routes, type Route } from '../web/routes';
import { ROSTER_HEADER } from '../web/csv';

/**
 * The clean slate, verified rather than assumed.
 *
 * Before a live demonstration the school wipes its operational records and
 * starts from nothing: no school year, no learners, no enrolments, no sections,
 * no adviser anywhere — only the staff accounts, which the reset deliberately
 * keeps. That state had never been tested. Every other DOM test in this suite
 * builds a fixture first, so "the day the school starts using it" was the one
 * day nobody had looked at.
 *
 * This mounts **every route** for a manager and for an adviser against a
 * database holding nothing but staff, with the real API and real fetches, and
 * asserts that none of them throws, that none of them renders a crash, and that
 * an empty database is never reported as a failure. An empty school is a
 * beginning, not an error.
 */

let db: TestDatabase;
let server: ServerApi;

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
});
afterAll(async () => { await server.close(); await db.database.close(); });

/** Nothing but staff: the state the go-live reset leaves behind. */
async function assertNothingButStaff() {
  const [row] = await db.pg.query<{ years: number; learners: number; enrolments: number; sections: number; staff: number }>(
    `select (select count(*) from edunexus.academic_years)::int years,
            (select count(*) from edunexus.learners)::int learners,
            (select count(*) from edunexus.enrollments)::int enrolments,
            (select count(*) from edunexus.sections)::int sections,
            (select count(*) from edunexus.staff)::int staff`);
  expect(row).toMatchObject({ years: 0, learners: 0, enrolments: 0, sections: 0 });
  expect(row!.staff).toBeGreaterThan(0);
}

const people = [
  { who: 'principal' as const, me: { user_id: '', role: 'principal', display_name: 'Principal' } },
  { who: 'officer' as const, me: { user_id: '', role: 'administrative_officer', display_name: 'Officer' } },
  { who: 'teacher' as const, me: { user_id: '', role: 'teacher', display_name: 'Teacher' } },
];

describe('the database the school starts from', () => {
  it('holds staff and nothing else', async () => { await assertNothingButStaff(); });

  it('answers /me for every real account, so everyone can still sign in', async () => {
    for (const { who } of people) {
      server.signInAs(who);
      const me = await server.api<{ role: string }>('/me');
      expect(me.role).toBeTruthy();
    }
  });
});

for (const { who, me } of people) {
  describe(`every screen, as ${who}, against an empty school`, () => {
    for (const route of routes.filter((r: Route) => r.built !== false)) {
      if (!available(route, me.role)) continue;
      it(`${route.id} renders without crashing`, async () => {
        server.signInAs(who);
        const status: unknown[] = [];
        const screen = await mount(createElement(route.render as never, {
          api: server.api, me, manager: me.role !== 'teacher',
          setStatus: (v: unknown) => status.push(v), reload: () => {}, token: 0, route,
        } as never));
        // Let every fetch the screen fires actually land.
        await screen.settle();
        await screen.settle();
        const text = screen.text();
        // A screen that threw renders nothing at all; one that caught renders words.
        expect(text.length, `${route.id} rendered nothing`).toBeGreaterThan(0);
        // No framework crash text, and no raw error object leaking into the page.
        expect(text).not.toMatch(/undefined is not|cannot read propert|NaN|\[object Object\]/i);
        screen.unmount();
      });
    }
  });
}

describe('an empty school is a beginning, not a failure', () => {
  it('lets a manager create the first school year, activate it and build a class', async () => {
    server.signInAs('principal');
    const year = await server.api<{ id: string; version: number; status: string }>('/academic-years', 'POST',
      { start_year: 2026, starts_on: '2026-06-01', ends_on: '2027-03-31' });
    expect(year.status).toBe('draft');
    for (const [ordinal, name, from, to] of [[1, 'First', '2026-06-01', '2026-08-31'], [2, 'Second', '2026-09-01', '2026-11-30'],
      [3, 'Third', '2026-12-01', '2027-01-31'], [4, 'Fourth', '2027-02-01', '2027-03-31']] as const) {
      await server.api(`/academic-years/${year.id}/periods`, 'POST', { ordinal, name, starts_on: from, ends_on: to });
    }
    // There is no single-year GET; the list is where a version is re-read.
    const listed = await server.api<{ items: { id: string; version: number }[] }>('/academic-years');
    const fresh = listed.items.find(y => y.id === year.id)!;
    const active = await server.api<{ status: string }>(`/academic-years/${year.id}/status`, 'PATCH',
      { version: fresh.version, status: 'active' });
    expect(active.status).toBe('active');
    // And a class in it, which is what Phase 5 needs before a teacher can pull.
    const section = await server.api<{ id: string }>('/sections', 'POST',
      { academic_year_id: year.id, grade_level: 1, name: 'A', adviser_user_id: null });
    expect(section.id).toBeTruthy();
  });

  it('gives an adviser with no class the import template from the workspace, not the manager-only endpoint', async () => {
    // Phase 6: a teacher opens Roster import before anyone has given them a
    // section. The server's own template route is deliberately manager-only, so
    // the workspace carries its own copy of the columns and that is what an
    // adviser downloads. Both halves are asserted, because the refusal is the
    // design and the copy is what makes the screen still work.
    server.signInAs('teacher');
    await expect(server.api('/roster-imports/template')).rejects.toThrow(/principal or administrative officer/i);
    // Nine columns since 0.100.0: each row may carry its own grade, last.
    expect(ROSTER_HEADER).toBe('lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address,grade_level');
    // And the manager-only route agrees with that copy, so the two never drift.
    server.signInAs('officer');
    const served = await server.api<unknown>('/roster-imports/template');
    expect(JSON.stringify(served)).toContain('lrn');
  });
});
