// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { ReportCards } from '../web/screens/ReportCards';
import { routes } from '../web/routes';

/**
 * Promotion's own gate, and the term window, in a real DOM against the real API.
 *
 * Mocking the server here would prove nothing worth having: the whole point of
 * both rules is that **the API decides** and the screen only reports what it
 * decided. So the readiness really comes from `read_promotion_readiness`, the
 * term really has a start date the database compares against today, and the
 * refusals really carry the server's own codes.
 */

let db: TestDatabase;
let server: ServerApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const sampaguita = '00000000-0000-4000-9000-00000000000a';
const route = routes.find(r => r.id === 'report-cards')!;
const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  // Two terms have begun and the third has not: the case the school described,
  // where finishing the second must not open the third.
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First Quarter','2026-06-01','2026-08-31'),($1,2,'Second Quarter','2026-09-01','2026-12-31'),
    ($1,3,'Third Quarter','2027-01-01','2027-03-31')`, [year2026]);
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,2,'Sampaguita',$3)`,
    [sampaguita, year2026, ids.teacher]);
  await db.pg.query(`insert into edunexus.learners(id,lrn,first_name,last_name,sex,birth_date) values
    ('00000000-0000-4000-9001-000000000001','136170000401','Ana','Reyes','female','2018-05-02')`);
  await db.pg.query(`select id from edunexus.place_enrollment('00000000-0000-4000-9001-000000000001',$1,2::smallint,$2,'2026-06-01','regular')`,
    [year2026, sampaguita]);
  await db.pg.query(`insert into edunexus.subjects(code,name,kind,grade_levels,active) values('FIL','Filipino','learning_area','{2}',true)`);
  await db.pg.query(`insert into edunexus.section_subjects(section_id,academic_year_id,subject_id,subject_snapshot,display_order,active)
    select $1,$2,s.id,jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'kind',s.kind,'grade_levels',s.grade_levels,'active',s.active,'version',s.version),1,true
    from edunexus.subjects s where s.code='FIL'`, [sampaguita, year2026]);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('the Promotion screen reports the API’s own gate', () => {
  it('says promotion is not open, and names what is still missing term by term', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(ReportCards as never, server, teacher, { route });
    await screen.until(m => m.text().includes('Promotion is not open for this class yet'), 'the closed gate');
    const text = screen.text();
    // Each term is named with its own count, not one total.
    expect(text).toContain('First Quarter term grades');
    expect(text).toContain('Second Quarter term grades');
    expect(text).toContain('Third Quarter term grades');
    expect(text).toContain('Subject averages');
    expect(text).toContain('General averages');
    // And the term nobody can fill yet says why it cannot be filled.
    expect(text).toContain('This term starts on 2027-01-01');
    // No approval or endorsement is offered while it is closed.
    expect(text).not.toContain('Approve or return');
    screen.unmount();
  });

  it('marks a term that has not started on the report card, and will not take grades for it', async () => {
    // Since 0.111.0 term grades are typed on the Report card tab (the Subject averages tab was removed at the school's
    // request), so the rule is checked where the typing now happens.
    server.signInAs('teacher');
    const screen = await mountScreen(ReportCards as never, server, teacher, { route });
    await screen.until(m => m.byText('Report card', 'button') !== null, 'the tabs');
    expect(screen.byText('Subject averages', 'button')).toBeNull();
    await screen.click(screen.byText('Report card', 'button'));
    await screen.until(m => m.text().includes('not started yet'), 'the card');
    // The one that has not begun is named, with the date it begins, and its boxes take no typing.
    expect(screen.text()).toContain('Third Quarter (from 2027-01-01)');
    screen.unmount();
  });

  it('refuses a grade for the unstarted term at the API, whatever the screen shows', async () => {
    const [offering] = await db.pg.query<{ id: string }>('select id from edunexus.section_subjects where section_id=$1', [sampaguita]);
    const [third] = await db.pg.query<{ id: string }>(`select id from edunexus.reporting_periods where academic_year_id=$1 and ordinal=3`, [year2026]);
    const [held] = await db.pg.query<{ id: string }>('select id from edunexus.enrollments where section_id=$1', [sampaguita]);
    server.signInAs('teacher');
    await expect(server.api(`/section-subjects/${offering!.id}/report-grades`, 'POST', {
      reporting_period_id: third!.id, reason: 'Trying to encode a term that has not started.',
      entries: [{ enrollment_id: held!.id, grade: 90, version: 0 }],
    })).rejects.toMatchObject({ code: 'PERIOD_NOT_STARTED' });
    // And the term that has begun is accepted, so the rule is a date and not a lock on everything.
    const [first] = await db.pg.query<{ id: string }>(`select id from edunexus.reporting_periods where academic_year_id=$1 and ordinal=1`, [year2026]);
    await server.api(`/section-subjects/${offering!.id}/report-grades`, 'POST', {
      reporting_period_id: first!.id, reason: 'Encoding the first quarter, which has begun.',
      entries: [{ enrollment_id: held!.id, grade: 88, version: 0 }],
    });
    const [saved] = await db.pg.query<{ grade: string }>(
      'select grade from edunexus.report_grades where enrollment_id=$1 and reporting_period_id=$2', [held!.id, first!.id]);
    expect(Number(saved!.grade)).toBe(88);
  });
});
