import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The monthly consolidation, promotion outcome and calendar emitters (0059).
 *
 * The attendance three are here on an explicit decision of 2026-11-05: the
 * absence-alert gate covers attendance *figures and thresholds*, not the
 * submit/return/lock workflow around a consolidation. So the case that matters
 * most in this file is the last one -- **no notification carries an attendance
 * figure**. A month notification says a month moved and whose class it was; it
 * says nothing about how often anybody was absent, and if that ever changes the
 * gate has been walked through.
 *
 * The month workflow had no test at all in this tree before this file: its own
 * were lost with the rest of `tests/` in the 0.86.1 recovery. Reaching a
 * submittable month is most of the setup below.
 */

let db: TestDatabase;
let api: TestApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
const masigla = '00000000-0000-4000-9000-00000000000a';
const narra = '00000000-0000-4000-9000-00000000000b';
let enrolment = '';

const inboxOf = (who: string) =>
  db.pg.query<{ kind: string; payload: Record<string, unknown>; section_id: string | null }>(
    'select kind,payload,section_id from edunexus.notifications where recipient_user_id=$1 order by id desc', [who]);
const kindsOf = async (who: string) => (await inboxOf(who)).map(n => n.kind);

/** June 2026, every day configured: one day of classes and the rest closed. */
const june = () => {
  const changes: Record<string, unknown>[] = [];
  for (let day = 1; day <= 30; day++) {
    const on = `2026-06-${String(day).padStart(2, '0')}`;
    changes.push(day === 1
      ? { day_on: on, action: 'set', am: 'classroom', pm: 'classroom', day_type: 'regular', label: 'Classes' }
      : { day_on: on, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'school_break', label: 'No classes' });
  }
  return changes;
};

/** Review then confirm, which is how every one of these workflows commits. */
async function reviewed(previewPath: string, commitPath: string, body: Record<string, unknown>, who: string = tokens.officer) {
  const seen = await api.post(previewPath, who, body);
  expect(seen.status, seen.message ?? '').toBe(201);
  const done = await api.post(commitPath, who, { ...body, review_hash: String(seen.data.review_hash), reviewed: true });
  expect(done.status, done.message ?? '').toBe(201);
  return done;
}

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$3,3,'Masigla',$4),($2,$3,4,'Narra',$5)`, [masigla, narra, year2026, ids.teacher, ids.otherTeacher]);
  await db.pg.query(`insert into edunexus.learners(id,lrn,first_name,last_name,sex,birth_date) values
    ('00000000-0000-4000-a000-000000000001','136170000601','Monthly','Learner','female','2017-05-02')`);
  const [placed] = await db.pg.query<{ id: string }>(
    `select id from edunexus.place_enrollment('00000000-0000-4000-a000-000000000001',$1,3::smallint,$2,'2026-06-01','regular')`, [year2026, masigla]);
  enrolment = String(placed!.id);
  // A year is activated only with consecutively numbered reporting periods.
  //
  // All four have **begun**, which 0069 made matter twice over: a term accepts
  // grades only once it has started, and promotion waits for every term's
  // grades — so a quarter dated into the future would make the promotion cases
  // below unreachable rather than merely unrecorded.
  await db.pg.query(`insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values
    ($1,1,'First Quarter','2026-06-01','2026-07-31'),($1,2,'Second Quarter','2026-08-01','2026-09-15'),
    ($1,3,'Third Quarter','2026-09-16','2026-10-31'),($1,4,'Fourth Quarter','2026-11-01','2027-03-31')`, [year2026]);
  // The month workflow needs an active year; `preview_attendance_month` refuses a draft.
  await db.pg.query(`update edunexus.academic_years set status='active' where id=$1`, [year2026]);
});
afterAll(async () => { await db.database.close(); });

describe('the instructional calendar', () => {
  it('tells every adviser of the year when the school calendar changes', async () => {
    await reviewed(`/api/v1/academic-years/${year2026}/calendar/preview`, `/api/v1/academic-years/${year2026}/calendar/corrections`,
      { version: 0, section_id: null, changes: june(), reason: 'Setting up June: one day of classes and the rest closed.' });

    // Both advisers, because a school-wide calendar decides which days every
    // register has. One notification each for one event is not noise.
    expect(await kindsOf(ids.teacher)).toContain('calendar_changed');
    expect(await kindsOf(ids.otherTeacher)).toContain('calendar_changed');
    // The officer committed it, so is not told about their own act.
    expect(await kindsOf(ids.officer)).not.toContain('calendar_changed');
  });

  it('tells only the one adviser when a single section’s calendar changes', async () => {
    const before = (await inboxOf(ids.otherTeacher)).length;
    await reviewed(`/api/v1/academic-years/${year2026}/calendar/preview`, `/api/v1/academic-years/${year2026}/calendar/corrections`,
      { version: 1, section_id: masigla, changes: [{ day_on: '2026-06-15', action: 'set', am: 'classroom', pm: 'no_class', day_type: 'makeup', label: 'Make-up morning' }],
        reason: 'A make-up morning for this class only, agreed with the adviser.' });

    const mine = await inboxOf(ids.teacher);
    expect(mine[0]!).toMatchObject({ kind: 'calendar_changed', payload: { section_name: 'Masigla', grade_level: 3 } });
    // Narra's adviser is unaffected and hears nothing new.
    expect((await inboxOf(ids.otherTeacher)).length).toBe(before);
  });
});

describe('the monthly consolidation', () => {
  it('reports the month moving between desks, and never a figure from it', async () => {
    // Mark every classroom session June has, so the month is complete. There
    // are two: the first of the month, and the make-up morning the case above
    // added for this section only — which is itself a small proof that a
    // section override really does change what the register asks for.
    await reviewed(`/api/v1/sections/${masigla}/attendance/preview`, `/api/v1/sections/${masigla}/attendance/corrections`,
      { day_on: '2026-06-01', version: 0, changes: [{ enrollment_id: enrolment, am: 'present', pm: 'present' }],
        reason: 'Recording the register for the first day of classes.' }, tokens.teacher);
    await reviewed(`/api/v1/sections/${masigla}/attendance/preview`, `/api/v1/sections/${masigla}/attendance/corrections`,
      { day_on: '2026-06-15', version: 0, changes: [{ enrollment_id: enrolment, am: 'present', pm: null }],
        reason: 'Recording the register for the make-up morning.' }, tokens.teacher);

    const status = await api.get(`/api/v1/sections/${masigla}/attendance/months?month_on=2026-06-01`, tokens.officer);
    expect(status.status, status.message ?? '').toBe(200);
    expect(status.data.can_submit, JSON.stringify(status.data.issues)).toBe(true);

    await reviewed(`/api/v1/sections/${masigla}/attendance/months/preview`, `/api/v1/sections/${masigla}/attendance/months/transitions`,
      { month_on: '2026-06-01', version: Number(status.data.version), action: 'submit', reason: 'Submitting June for the office to check and lock.' });

    // `monthCommit` is manager-only, so the office submits and the *other*
    // manager is the one told. Nothing here counts or compares attendance.
    const told = await inboxOf(ids.principal);
    expect(told[0]!).toMatchObject({ kind: 'month_submitted', payload: { section_name: 'Masigla', grade_level: 3, month: '2026-06' } });
    expect(Object.keys(told[0]!.payload).sort()).toEqual(['grade_level', 'month', 'section_name']);
  });

  it('tells the adviser whose class it is when the month is locked', async () => {
    const status = await api.get(`/api/v1/sections/${masigla}/attendance/months?month_on=2026-06-01`, tokens.officer);
    expect(status.data.status).toBe('submitted');
    await reviewed(`/api/v1/sections/${masigla}/attendance/months/preview`, `/api/v1/sections/${masigla}/attendance/months/transitions`,
      { month_on: '2026-06-01', version: Number(status.data.version), action: 'lock', reason: 'June checked against the register and locked.' });

    const mine = await inboxOf(ids.teacher);
    expect(mine[0]!).toMatchObject({ kind: 'month_locked', payload: { month: '2026-06' } });
  });

  it('reports a reopened month as returned, which is what it is to the adviser', async () => {
    const status = await api.get(`/api/v1/sections/${masigla}/attendance/months?month_on=2026-06-01`, tokens.officer);
    expect(status.data.status).toBe('locked');
    await reviewed(`/api/v1/sections/${masigla}/attendance/months/preview`, `/api/v1/sections/${masigla}/attendance/months/transitions`,
      { month_on: '2026-06-01', version: Number(status.data.version), action: 'reopen', reason: 'Reopening June: a mark needs correcting.' });

    // `reopen` has no kind of its own, deliberately: a locked month reopened is
    // a month back on the adviser's desk, which is what `returned` says.
    expect((await inboxOf(ids.teacher))[0]!.kind).toBe('month_returned');
  });
});

describe('promotion outcomes', () => {
  /**
   * Promotion is closed until the class's report cards are complete (0069), so
   * the endorsement below is only reachable once they are. Masigla's card is
   * Grades 2-3's: a grade in every quarter for every learning area, a subject
   * average and remark, and a general average.
   */
  beforeAll(async () => {
    const reason = 'Setting up the records promotion waits for.';
    const subject = await api.post('/api/v1/subjects', tokens.officer,
      { code: 'FIL', name: 'Filipino', kind: 'learning_area', grade_levels: [3], active: true, reason });
    expect(subject.status, subject.message ?? '').toBe(201);
    const offering = await api.post(`/api/v1/sections/${masigla}/subjects`, tokens.officer,
      { subject_id: subject.data.id, subject_version: subject.data.version, display_order: 1, reason });
    expect(offering.status, offering.message ?? '').toBe(201);
    const quarters = await db.pg.query<{ id: string }>('select id from edunexus.reporting_periods where academic_year_id=$1 order by ordinal', [year2026]);
    for (const q of quarters) {
      const made = await api.post(`/api/v1/section-subjects/${String(offering.data.id)}/report-grades`, tokens.teacher,
        { reporting_period_id: q.id, reason, entries: [{ enrollment_id: enrolment, grade: 85, version: 0 }] });
      expect(made.status, made.message ?? '').toBe(201);
    }
    const final = await api.post(`/api/v1/section-subjects/${String(offering.data.id)}/report-grades`, tokens.teacher,
      { reporting_period_id: null, reason, entries: [{ enrollment_id: enrolment, grade: 85, remark: 'passed', version: 0 }] });
    expect(final.status, final.message ?? '').toBe(201);
    const average = await api.post(`/api/v1/sections/${masigla}/report-summaries`, tokens.teacher,
      { reason, entries: [{ enrollment_id: enrolment, general_average: 85, remark: 'passed', version: 0 }] });
    expect(average.status, average.message ?? '').toBe(201);
    const open = await api.get(`/api/v1/sections/${masigla}/promotion-readiness`, tokens.teacher);
    expect(open.data.ready, JSON.stringify(open.data)).toBe(true);
  });

  it('tells the office that outcomes are waiting, once for the batch and with a count', async () => {
    const [current] = await db.pg.query<{ version: number }>('select version from edunexus.enrollments where id=$1', [enrolment]);
    const sent = await api.post(`/api/v1/sections/${masigla}/promotion-recommendations`, tokens.teacher,
      { entries: [{ enrollment_id: enrolment, version: 0, action: 'promoted' }], reason: 'Recommending the outcome for this learner.' });
    expect(sent.status, sent.message ?? '').toBe(201);
    expect(current).toBeDefined();

    const told = await inboxOf(ids.principal);
    expect(told[0]!).toMatchObject({ kind: 'promotion_endorsed', payload: { section_name: 'Masigla', grade_level: 3, count: 1 } });
    // The adviser endorsed it, so is not told about their own act.
    expect(await kindsOf(ids.teacher)).not.toContain('promotion_endorsed');
  });

  it('tells the adviser when outcomes are approved, and says how many', async () => {
    const [decision] = await db.pg.query<{ version: number }>('select version from edunexus.promotion_decisions where enrollment_id=$1', [enrolment]);
    const done = await api.post(`/api/v1/sections/${masigla}/promotion-decisions`, tokens.principal,
      { entries: [{ enrollment_id: enrolment, version: decision!.version, decision: 'approved' }], reason: 'Approving the recommended outcome for this class.' });
    expect(done.status, done.message ?? '').toBe(201);

    expect((await inboxOf(ids.teacher))[0]!).toMatchObject({ kind: 'promotion_approved', payload: { count: 1 } });
  });

  it('tells the adviser when outcomes are returned instead', async () => {
    const [decision] = await db.pg.query<{ version: number }>('select version from edunexus.promotion_decisions where enrollment_id=$1', [enrolment]);
    const back = await api.post(`/api/v1/sections/${masigla}/promotion-decisions`, tokens.principal,
      { entries: [{ enrollment_id: enrolment, version: decision!.version, decision: 'returned' }], reason: 'Returning this outcome: please check the remark first.' });
    expect(back.status, back.message ?? '').toBe(201);

    expect((await inboxOf(ids.teacher))[0]!.kind).toBe('promotion_returned');
  });

  /**
   * The regression 0060 fixes, tested here because 0059 is what caused it.
   *
   * `0036` widened the outcomes an adviser may endorse to four by replacing
   * `record_promotion_recommendations`. 0059 replaced the same function again to
   * add the notification above and restated it **from 0033**, whose three
   * outcomes did not include `conditionally_promoted` — so from 0059 until 0060
   * the value was refused by the only function that records it, while the
   * table's CHECK, next-year placement, the Zod contract, the SF9, the SF10 and
   * the choice on Promotion all still carried it.
   */
  it('accepts a conditionally promoted outcome, which 0059 dropped and 0060 put back', async () => {
    const [decision] = await db.pg.query<{ version: number }>('select version from edunexus.promotion_decisions where enrollment_id=$1', [enrolment]);
    const sent = await api.post(`/api/v1/sections/${masigla}/promotion-recommendations`, tokens.teacher,
      { entries: [{ enrollment_id: enrolment, version: decision!.version, action: 'conditionally_promoted' }],
        reason: 'Conditionally promoted: two learning areas to make up over the break.' });
    expect(sent.status, sent.message ?? '').toBe(201);
    const [saved] = await db.pg.query<{ action: string; status: string }>('select action,status from edunexus.promotion_decisions where enrollment_id=$1', [enrolment]);
    expect(saved).toMatchObject({ action: 'conditionally_promoted', status: 'recommended' });
  });

  it('still refuses an outcome that is none of the four', async () => {
    const [decision] = await db.pg.query<{ version: number }>('select version from edunexus.promotion_decisions where enrollment_id=$1', [enrolment]);
    const bad = await api.post(`/api/v1/sections/${masigla}/promotion-recommendations`, tokens.teacher,
      { entries: [{ enrollment_id: enrolment, version: decision!.version, action: 'moved_up' }], reason: 'Trying an outcome the school does not have.' });
    expect(bad.status).toBe(422);
  });
});

describe('the absence-alert gate is still shut', () => {
  it('has written no notification carrying any attendance figure, across every emitter', async () => {
    const all = await db.pg.query<{ kind: string; payload: Record<string, unknown> }>('select kind,payload from edunexus.notifications');
    expect(all.length).toBeGreaterThan(6);
    // The closed list from 0056. `count` is a number of learners or entries, and
    // `month` is which month — neither is a figure about anyone's attendance,
    // and no key for one exists to put a figure in.
    const allowed = new Set(['section_name', 'grade_level', 'row_count', 'count', 'month', 'year_label', 'decision']);
    expect(all.flatMap(n => Object.keys(n.payload)).filter(k => !allowed.has(k))).toEqual([]);
    // Nothing anywhere reports a presence, an absence or a rate.
    const words = JSON.stringify(all).toLowerCase();
    for (const word of ['absent', 'present', 'absence', 'percent', 'rate', 'average', 'consecutive']) {
      expect(words, `a notification mentions ${word}`).not.toContain(word);
    }
  });
});
