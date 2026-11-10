// @vitest-environment happy-dom
import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mount, mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { Subjects } from '../web/screens/Subjects';
import { PriorRecords } from '../web/screens/PriorRecords';
import { Learners } from '../web/screens/Learners';
import { Staff } from '../web/screens/Staff';
import { NextYear } from '../web/screens/NextYear';
import { AddSections } from '../web/screens/SetupBatch';
import { Editor, Table } from '../web/components/primitives';
import { ApiError } from '../web/api';
import { routes } from '../web/routes';
import { roleLine } from '../web/screens/Overview';

/**
 * The UI notes of 8 November, U1 (docs/ui-notes-plan.md), held on 0.102.2.
 *
 * - **Note 3, decision U-D2.** Subjects & offerings and Academic history ask for
 *   no reason when something is *added*; the journal still carries one, written
 *   in the system's words, under the person who acted. A correction to a
 *   learner's historical record still asks why.
 * - **Note 4.** A list read again keeps its rows on screen, dimmed and out of
 *   reach, instead of dropping to a skeleton that closes the open row.
 * - **Note 6.** The front page changes page at once: no view transition.
 */

let db: TestDatabase;
let server: ServerApi;
const year = '00000000-0000-4000-9000-000000000001';
const section = '00000000-0000-4000-9000-00000000000a';
const ana = '00000000-0000-4000-9001-000000000001';
/** The adviser's second class, and a colleague's: note 10 is about an adviser who holds two. */
const second = '00000000-0000-4000-9000-00000000000b';
const colleague = '00000000-0000-4000-9000-00000000000c';
const ben = '00000000-0000-4000-9001-000000000002';
const cora = '00000000-0000-4000-9001-000000000003';
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const otherTeacher = { user_id: ids.otherTeacher, role: 'teacher', display_name: 'Other Teacher' };

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`insert into edunexus.school_profile(id,name,school_code,address,region,division,district)
    values(1,'Balili Elementary School','135617','Balili, La Trinidad, Benguet','Cordillera Administrative Region','Benguet','La Trinidad')`);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000011']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'A',$3)`, [section, year, ids.teacher]);
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values($1,'Ana','Reyes','female','2017-05-02','136170000001')`, [ana]);
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
    ('00000000-0000-4000-9002-000000000001',$1,$2,3,$3,'2026-06-01','2026-06-01','regular')`, [ana, year, section]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$3,4,'B',$4),($2,$3,4,'C',$5)`,
    [second, colleague, year, ids.teacher, ids.otherTeacher]);
  await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn) values
    ($1,'Ben','Lacsamana','male','2016-03-11','136170000002'),($2,'Cora','Dizon','female','2016-04-04','136170000003')`, [ben, cora]);
  await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason) values
    ('00000000-0000-4000-9002-000000000002',$1,$3,4,$4,'2026-06-01','2026-06-01','regular'),
    ('00000000-0000-4000-9002-000000000003',$2,$3,4,$5,'2026-06-01','2026-06-01','regular')`, [ben, cora, year, second, colleague]);
  // The registry reads placements in the active year, and a year is activated only once its terms are set.
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First','2026-06-01','2026-09-15'),($1,2,'Second','2026-09-16','2026-12-18'),($1,3,'Third','2027-01-04','2027-03-31')`, [year]);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('reasons the screen writes (note 3, U-D2)', () => {
  it('adds a subject with no reason box, and journals the system’s reason under the manager', async () => {
    server.signInAs('principal');
    const m = await mountScreen(Subjects as never, server, principal, { route: routes.find(r => r.id === 'subjects')! });
    await m.until(v => v.byText('Add a subject', 'button') !== null, 'the add action');
    await m.click(m.byText('Add a subject', 'button'));
    await m.until(v => v.text().includes('Add to the catalog'), 'the sheet');
    expect(m.field('Reason')).toBeNull();
    expect(m.all('textarea')).toHaveLength(0);

    // By exact label inside the sheet: the catalog's own filter is labelled "Code or name".
    const inSheet = (label: string) => {
      const found = m.all('.sheet label').find(l => (l.textContent ?? '').trim() === label);
      return found ? m.host.querySelector<HTMLInputElement>(`[id="${found.getAttribute('for')}"]`) : null;
    };
    await m.type(inSheet('Code'), 'read3');
    await m.type(inSheet('Name'), 'Reading');
    const grade3 = m.all('label.check-line').find(l => (l.textContent ?? '').trim() === 'Grade 3')!.querySelector('input');
    await m.click(grade3);
    await m.submit(m.byText('Add to the catalog', 'button'));
    // The harness's reload() is a no-op, so the sheet closing is the sign the API accepted it.
    await m.until(v => !v.text().includes('Add to the catalog'), 'the sheet to close');

    const [event] = await db.pg.query<{ reason: string; actor_user_id: string }>(
      `select e.reason,e.actor_user_id from edunexus.subject_events e join edunexus.subjects s on s.id=e.subject_id where s.code='READ3'`);
    expect(event).toEqual({ reason: 'Added to the subject catalog on Subjects & offerings.', actor_user_id: ids.principal });
    m.unmount();
  });

  it('opens a new school year on Academic history with no reason box, and a correction with one', async () => {
    server.signInAs('principal');
    const m = await mountScreen(PriorRecords as never, server, principal, { route: routes.find(r => r.id === 'prior-records')! });
    await m.type(m.field('Name or LRN'), 'Reyes');
    await m.submit(m.field('Name or LRN'));
    await m.until(v => v.byText('Open the history', 'button') !== null, 'the search');
    await m.click(m.byText('Open the history', 'button'));
    await m.until(v => v.byText('Add a school year', 'button') !== null, 'the history');
    await m.click(m.byText('Add a school year', 'button'));
    await m.until(v => v.text().includes('Document this was copied from'), 'the year sheet');
    // The document the year was read from is still asked for: that is the record of where it came from.
    expect(m.field('Document this was copied from')).not.toBeNull();
    expect(m.field('Reason for this entry')).toBeNull();
    expect(m.field('Reason for this correction')).toBeNull();
    m.unmount();
  });
});

describe('a list read again (note 4)', () => {
  it('keeps its rows on screen, dimmed and inert, and the open row open, instead of a skeleton', async () => {
    const rows = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Ben' }];
    const table = (loading: boolean, list: typeof rows) => createElement(Table<{ id: string; name: string }>, {
      rows: list, loading, rowKey: r => r.id, columns: [{ header: 'Name', cell: r => r.name }], detail: r => `Details of ${r.name}`,
    });
    const m = await mount(table(false, rows));
    await m.click(m.all('button.row-toggle')[0]!);
    expect(m.text()).toContain('Details of Ana');

    await act(async () => { m.root.render(table(true, [])); });
    await m.settle();
    expect(m.all('.skeleton-table')).toHaveLength(0);
    const wrap = m.all('.table-wrap.refreshing')[0]!;
    expect(wrap.getAttribute('aria-busy')).toBe('true');
    expect(wrap.hasAttribute('inert')).toBe(true);
    expect(m.text()).toContain('Details of Ana');

    await act(async () => { m.root.render(table(false, [rows[0]!, { id: '3', name: 'Cora' }])); });
    await m.settle();
    expect(m.all('.table-wrap.refreshing')).toHaveLength(0);
    expect(m.text()).toContain('Cora');
    expect(m.text()).toContain('Details of Ana');

    // A list never shown before still starts as a skeleton: there is nothing to keep.
    await act(async () => { m.root.render(table(true, [])); });
    m.unmount();
    const fresh = await mount(table(true, []));
    expect(fresh.all('.skeleton-table')).toHaveLength(1);
    fresh.unmount();
  });
});

describe('the front page (note 6)', () => {
  it('changes page without a view transition, and plays its opening only on arrival', () => {
    const site = readFileSync('web/site/Site.tsx', 'utf8');
    const css = readFileSync('web/styles/site.css', 'utf8');
    expect(site).not.toMatch(/startViewTransition/);
    expect(css).not.toMatch(/view-transition/);
    expect(css).not.toMatch(/\.notice:hover \{[^}]*translate: 0/);
    // Every opening animation is scoped to the page a visitor arrived at.
    for (const rule of css.match(/^\s*[^@\n{]*\{[^}]*animation: (?:art-in|copy-in|line-up|card-in|ping|settle)[^}]*\}/gm) ?? []) {
      expect(rule.trim(), rule).toMatch(/^\.opening /);
    }
  });
});

describe('the learner registry (U2: notes 10, 5 and 9)', () => {
  const route = routes.find(r => r.id === 'learners')!;
  const rowNames = (m: Awaited<ReturnType<typeof mountScreen>>) => m.all('tbody tr').map(tr => tr.querySelector('.cell-title')?.textContent ?? '').filter(Boolean);

  it('offers an adviser with two classes each class on its own, and only their own', async () => {
    server.signInAs('teacher');
    const m = await mountScreen(Learners as never, server, teacher, { route });
    await m.until(v => v.text().includes('Lacsamana') && v.text().includes('Reyes'), 'both classes');
    const pick = m.field('Class') as HTMLSelectElement;
    expect(pick).toBeInstanceOf(HTMLSelectElement);
    expect([...pick.options].map(o => o.textContent)).toEqual(['All my classes', 'Grade 3 · A', 'Grade 4 · B']);
    await m.type(pick, second);
    await m.until(v => !v.text().includes('Reyes'), 'one class');
    expect(rowNames(m)).toEqual(['Lacsamana, Ben']);
    await m.type(pick, '');
    await m.until(v => v.text().includes('Reyes'), 'both again');
    m.unmount();
  });

  it('offers no Class filter to an adviser with one class, who has nothing to choose between', async () => {
    server.signInAs('otherTeacher');
    const m = await mountScreen(Learners as never, server, otherTeacher, { route });
    await m.until(v => v.text().includes('Dizon'), 'their class');
    expect(m.field('Class')).toBeNull();
    m.unmount();
  });

  it('says "duplicate entries" rather than "linked into another"', async () => {
    server.signInAs('principal');
    const m = await mountScreen(Learners as never, server, principal, { route });
    await m.until(v => v.text().includes('Reyes'), 'the registry');
    expect(m.text()).toContain('Show duplicate entries');
    expect(m.text()).not.toContain('linked into another');
    m.unmount();
  });

  it('opens a learner on who they are: the name, the LRN and the class this year', async () => {
    server.signInAs('principal');
    const m = await mountScreen(Learners as never, server, principal, { route });
    await m.until(v => v.text().includes('Reyes'), 'the registry');
    const row = m.all('tbody tr').find(tr => (tr.textContent ?? '').includes('Reyes'))!;
    await m.click(row.querySelector<HTMLElement>('button.row-toggle'));
    await m.until(v => v.all('.learner-head').length > 0, 'the profile');
    const head = m.all('.learner-head')[0]!.textContent ?? '';
    expect(head).toContain('Reyes, Ana');
    expect(head).toContain('LRN 136170000001');
    expect(head).toContain('Grade 3 · A');
    // The explanations are folded, not gone.
    expect(m.all('details.task > summary').some(x => (x.textContent ?? '').includes('What this record does not hold'))).toBe(true);
    m.unmount();
  });
});

describe('a colleague on Staff access (U4: note 9)', () => {
  it('opens on who they are: name, permission level, position and the classes they advise', async () => {
    server.signInAs('principal');
    const m = await mountScreen(Staff as never, server, principal, { route: routes.find(r => r.id === 'staff')! });
    await m.until(v => v.all('tbody tr button.row-toggle').length > 0 && v.text().includes('Teacher'), 'the staff list');
    const row = m.all('tbody tr').find(tr => tr.querySelector('.person b')?.textContent === 'Teacher')!;
    await m.click(row.querySelector<HTMLElement>('button.row-toggle'));
    await m.until(v => v.all('.staff-head').length > 0, 'the colleague’s header');
    const head = (m.all('.staff-head')[0]!.textContent ?? '').replace(/\s+/g, ' ');
    expect(head).toContain('Teacher');
    expect(head).toContain('Adviser of Grade 3 · A, Grade 4 · B');
    expect(head).toContain('Access active');
    m.unmount();
  });
});

describe('next year’s classes (U5: note 2)', () => {
  const next = '00000000-0000-4000-9000-000000002027';
  beforeAll(async () => {
    await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2027,'2027-06-07','2028-03-31','draft')`, [next]);
    // Ana's outcome is approved, so she moves up; Ben and Cora have none yet.
    await db.pg.query(`insert into edunexus.promotion_decisions(enrollment_id,action,status,recommended_by,decided_by) values($1,'promoted','approved',$2,$3)`,
      ['00000000-0000-4000-9002-000000000001', ids.teacher, ids.principal]);
  });

  it('shows the year as steps, a card per grade, learners grouped by their new grade, and the rest grouped by why', async () => {
    server.signInAs('principal');
    const m = await mountScreen(NextYear as never, server, principal, { route: routes.find(r => r.id === 'next-year')! });
    await m.until(v => v.all('.grade-card').length > 0, 'the grades next year');
    const steps = m.all('.step').map(x => (x.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(steps[0]).toContain('2026–2027 into 2027–2028');
    expect(steps[1]).toContain('2 still waiting on an outcome');
    expect(steps[2]).toContain('1 ready to enrol');
    // Enrolling the one decided is possible while two wait, so step 3 is ready rather than current.
    expect(m.all('.step.ready')).toHaveLength(1);
    const card = (m.all('.grade-card')[0]!.textContent ?? '').replace(/\s+/g, ' ');
    expect(card).toContain('Grade 4');
    expect(card).toContain('0 male');
    expect(card).toContain('1 female');
    expect(m.all('.carry-group h3').map(h => (h.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual(['Grade 4 · 1 learner']);
    expect(m.all('details.task > summary').some(x => (x.textContent ?? '').includes('No outcome recorded · 2'))).toBe(true);
    // Nothing on it is a rate: counts only.
    expect(m.text()).not.toMatch(/%/);
    m.unmount();
  });
});

describe('a rejected save says each problem once (asked 2026-11-09)', () => {
  const fields = [
    { key: 'name', label: 'Period name', maxLength: 60 },
    { key: 'starts_on', label: 'First day', type: 'date' },
    { key: 'ends_on', label: 'Last day', type: 'date' },
  ];
  const rejecting = (message: string) => async () => {
    throw new ApiError(422, 'VALIDATION_ERROR', message, [{ path: 'starts_on', message: 'Required.' }, { path: 'ends_on', message: 'Required.' }]);
  };

  it('draws no summary when every rejected field is in sight, and puts the reader on the first one', async () => {
    const m = await mount(createElement(Editor, { fields, submitLabel: 'Add the period', setStatus: () => undefined, onSubmit: rejecting('Review the request fields.') }));
    await m.submit(m.byText('Add the period', 'button'));
    await m.until(v => v.all('.field-error').length === 2, 'the two messages beside their fields');
    expect(m.all('.error-summary')).toHaveLength(0);
    expect(m.text().match(/Required\./g)).toHaveLength(2);
    expect(document.activeElement).toBe(m.field('First day'));
    expect(m.field('First day')!.getAttribute('aria-describedby')).toContain('-error');
    m.unmount();
  });

  it('keeps a summary for a message that belongs to no one field, naming the fields without repeating them', async () => {
    const m = await mount(createElement(Editor, { fields, submitLabel: 'Add the period', setStatus: () => undefined, onSubmit: rejecting('Periods must not overlap another period.') }));
    await m.submit(m.byText('Add the period', 'button'));
    await m.until(v => v.all('.error-summary').length === 1, 'the summary');
    const box = m.all('.error-summary')[0]!;
    expect(box.textContent).toContain('Periods must not overlap another period.');
    expect([...box.querySelectorAll('li button')].map(b => b.textContent)).toEqual(['First day', 'Last day']);
    // Each "Required." is said once, beside its field.
    expect(m.text().match(/Required\./g)).toHaveLength(2);
    m.unmount();
  });
});

describe('Create sections takes names one at a time (asked 2026-11-09)', () => {
  it('shows each grade’s sections as chips, adds by Enter, splits a pasted list, offers the next letter, and reviews exactly those', async () => {
    server.signInAs('principal');
    const m = await mount(createElement(AddSections, { api: server.api, year: { id: year, start_year: 2026 }, onClose: () => undefined }));
    await m.until(v => v.byText('Review the sections', 'button') !== null && !v.byText('Review the sections', 'button')!.hasAttribute('disabled'), 'the sheet');
    expect(m.text()).not.toMatch(/separated by commas/);
    const chips = (grade: string) => [...(m.host.querySelector(`[aria-label="${grade} sections"]`)?.querySelectorAll('.chip span') ?? [])].map(c => c.textContent);
    expect(chips('Grade 2')).toEqual(['A', 'B', 'C', 'D']);

    await m.click(m.host.querySelector<HTMLElement>('[aria-label="Remove Grade 2 B"]'));
    expect(chips('Grade 2')).toEqual(['A', 'C', 'D']);

    const box = m.field('Grade 2') as HTMLInputElement;
    await m.type(box, 'Sampaguita');
    await act(async () => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await m.settle();
    expect(chips('Grade 2')).toEqual(['A', 'C', 'D', 'Sampaguita']);

    await m.type(box, 'e, F, a');
    await m.click(box.parentElement!.querySelector<HTMLElement>('button.btn.secondary'));
    // "a" is A again, ignoring case, so it is not added twice.
    expect(chips('Grade 2')).toEqual(['A', 'C', 'D', 'Sampaguita', 'e', 'F']);

    // Grade 1 still ends at D, so its next letter is offered.
    const grade1 = (m.field('Grade 1') as HTMLInputElement).parentElement!;
    await m.click([...grade1.querySelectorAll<HTMLElement>('button')].find(b => b.textContent === 'Add E') ?? null);
    expect(chips('Grade 1')).toEqual(['A', 'B', 'C', 'D', 'E']);

    await m.submit(m.byText('Review the sections', 'button'));
    await m.until(v => v.all('tbody tr').length > 0, 'the review');
    const reviewed = m.all('tbody tr').filter(tr => (tr.textContent ?? '').includes('Grade 2')).map(tr => tr.querySelector('b')?.textContent);
    expect(reviewed).toEqual(['A', 'C', 'D', 'Sampaguita', 'e', 'F']);
    m.unmount();
  });
});

describe('a filter row stays in line (asked 2026-11-10)', () => {
  // A line of text under one filter makes that field taller, and a toolbar aligns its items to the bottom, so every
  // other box and checkbox in the row drops out of line with it. A count belongs beside the label instead.
  const toolbars = (file: string) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/className="toolbar">([\s\S]*?)<div className="card-head-actions">/g)].map(m => m[1]!);
  };

  it('puts no hint line under a filter on Grade offerings or the class-list import', () => {
    for (const file of ['web/screens/Subjects.tsx', 'web/screens/Imports.tsx']) {
      const found = toolbars(file);
      expect(found.length).toBeGreaterThan(0);
      for (const bar of found) expect(bar).not.toContain('className="hint"');
    }
  });

  it('still says how many classes the grade has, beside its label', () => {
    expect(readFileSync('web/screens/Subjects.tsx', 'utf8')).toContain("'One class' : `${gradeSections.length} classes, one card`");
  });
});

describe('the Overview says who you are here (asked 2026-11-10)', () => {
  // "palagay nga agad dito kung principal/AO, tas sa adviser palagay ung grade level na tinuturuan"
  const rooms = [
    { id: 's1', grade_level: 3, name: 'B', adviser_user_id: 't1' },
    { id: 's2', grade_level: 1, name: 'A', adviser_user_id: 't1' },
    { id: 's3', grade_level: 2, name: 'C', adviser_user_id: 't2' },
    { id: 's4', grade_level: 4, name: 'D', adviser_user_id: null },
  ];
  it('names the principal and the administrative officer by role', () => {
    expect(roleLine({ user_id: 'p', role: 'principal' }, rooms)).toBe('Principal');
    expect(roleLine({ user_id: 'a', role: 'administrative_officer' }, rooms)).toBe('Administrative officer');
  });
  it('names an adviser by the classes they advise, lowest grade first, and no one else’s', () => {
    expect(roleLine({ user_id: 't1', role: 'teacher' }, rooms)).toBe('Adviser of Grade 1 – A and Grade 3 – B');
    expect(roleLine({ user_id: 't2', role: 'teacher' }, rooms)).toBe('Adviser of Grade 2 – C');
  });
  it('says plainly when a teacher advises no class, rather than inventing one', () => {
    expect(roleLine({ user_id: 't9', role: 'teacher' }, rooms)).toBe('Teacher · no class to advise this school year');
    // A section with no adviser must not match a person whose id is missing.
    expect(roleLine({ role: 'teacher' }, rooms)).toBe('Teacher · no class to advise this school year');
  });
});
