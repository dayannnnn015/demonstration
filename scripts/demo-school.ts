import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/http-app.js';
import { AppError } from '../src/core/errors.js';
import { testDatabase, ids } from '../tests/helpers/database.js';
import { seedSiteContent } from './seed/school.js';

/**
 * The demo's synthetic school, built through the real API over an in-memory
 * PGlite database: a year in three terms, five sections, a calendar and a
 * register around today, a policy with raw marks, report cards, outcomes and
 * the front page's notices. `npm run demo` serves it, and the tests that need
 * every module holding records at once start from it.
 */
export async function demoSchool(origin?: string) {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo refuses to run with NODE_ENV=production.');
  const db = await testDatabase();
  // Widened to string: a bearer token arrives as one, and `Set<literal>.has`
  // will not take it. The membership check is the point, not the type.
  // Seven advisers, one per grade the demo shows, so a client may sign in as any
  // of them and see only their own class. Fixed identifiers because
  // `web/demo.tsx` lists them on its picker; they are bearer tokens for this
  // throwaway in-memory database and mean nothing to the real API.
  const advisers = {
    k: '00000000-0000-4000-8000-000000000005',
    g3: '00000000-0000-4000-8000-000000000006',
    g4: '00000000-0000-4000-8000-000000000007',
    g5b: '00000000-0000-4000-8000-000000000008',
    g6: '00000000-0000-4000-8000-000000000009',
  } as const;
  const known = new Set<string>([...Object.values(ids), ...Object.values(advisers)]);
  // The browser sends this page's origin on every write, and Vite's proxy passes
  // it through; with no origin allowed, every save in the demo was refused. It
  // is the loopback page below, on a port `strictPort` pins, and nothing else.
  // The loopback page `npm run demo` serves, or the host's own address when
  // the demo is deployed for a walkthrough. One origin, never a wildcard.
  const page = origin ?? 'http://127.0.0.1:5173';
  const app = createApp({
    database: db.database, logger: pino({ enabled: false }), origins: [page],
    auth: { async verify(token) { if (!known.has(token)) throw new AppError(401, 'AUTH_REQUIRED', 'Choose a demo staff member.'); return { userId: token }; } },
  });

  const reason = 'Synthetic demo record, not a real learner or school.';
  const as = (actor: string) => ({
    get: (url: string) => request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${actor}`),
    post: async (url: string, body: object) => {
      await db.pg.query('delete from edunexus.request_buckets');
      const r = await request(app).post(`/api/v1${url}`).set('Authorization', `Bearer ${actor}`).send(body);
      if (r.status >= 300) throw new Error(`${url}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.data;
    },
  });
  const principal = as(ids.principal);

  // Dates around today, so the register, calendar and monitor open on something.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })}T00:00:00Z`);
  const shift = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
  const startYear = today.getUTCMonth() >= 5 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  // The shape of DepEd Order No. 9, s. 2026's year: 8 June to 8 April in three terms. The demo's dates, not a school's.
  const yearStart = `${startYear}-06-08`, yearEnd = `${startYear + 1}-04-08`;

  const year = randomUUID();
  const names = [
    ['Demo', 'Adviser, Grade 1', ids.teacher], ['Demo', 'Adviser, Grade 2', ids.otherTeacher],
  ] as const;
  for (const [key, label] of [['k', 'Kindergarten'], ['g3', 'Grade 3'], ['g4', 'Grade 4'], ['g5b', 'Grade 5'], ['g6', 'Grade 6']] as const) {
    await db.pg.query('insert into auth.users(id,email) values($1,$2)', [advisers[key], `adviser-${key}@demo.invalid`]);
    await db.pg.query("insert into edunexus.staff(user_id,display_name,role) values($1,$2,'teacher')", [advisers[key], `Demo Adviser, ${label}`]);
  }
  await db.pg.query("update edunexus.staff set display_name=$2 where user_id=$1", [ids.principal, 'Demo Principal']);
  await db.pg.query("update edunexus.staff set display_name=$2 where user_id=$1", [ids.officer, 'Demo Administrative Officer']);
  for (const [first, last, id] of names) await db.pg.query("update edunexus.staff set display_name=$2 where user_id=$1", [id, `${first} ${last}`]);
  await db.pg.query("insert into edunexus.school_profile(name,address) values('Demo Elementary School (synthetic records)','Nowhere Road, Demo Town') on conflict (id) do update set name=excluded.name,address=excluded.address");
  await db.pg.query('insert into edunexus.academic_years(id,start_year,starts_on,ends_on) values($1,$2,$3,$4)', [year, startYear, yearStart, yearEnd]);
  const periods: string[] = [];
  for (const [n, from, to] of [[1, yearStart, `${startYear}-09-15`], [2, `${startYear}-09-16`, `${startYear}-12-18`], [3, `${startYear + 1}-01-04`, yearEnd]] as const) {
    const id = randomUUID(); periods.push(id);
    await db.pg.query('insert into edunexus.reporting_periods(id,academic_year_id,ordinal,name,starts_on,ends_on) values($1,$2,$3,$4,$5,$6)', [id, year, n, `Demo term ${n}`, from, to]);
  }
  const sections = { g1: randomUUID(), g2: randomUUID(), k: randomUUID(), g5: randomUUID(), g3: randomUUID(), g4: randomUUID(), g5b: randomUUID(), g6: randomUUID() };
  // Demo Acacia keeps no adviser on purpose: it is how the demo shows a class
  // waiting for one, and a manager typing its cards. Every other grade has one.
  await db.pg.query("insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,1,'Demo Narra',$3),($4,$2,2,'Demo Molave',$5),($6,$2,0,'Demo Sampaguita',$7),($8,$2,5,'Demo Acacia',null)",
    [sections.g1, year, ids.teacher, sections.g2, ids.otherTeacher, sections.k, advisers.k, sections.g5]);
  await db.pg.query("insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Demo Dao',$3),($4,$2,4,'Demo Kamagong',$5),($6,$2,5,'Demo Banaba',$7),($8,$2,6,'Demo Yakal',$9)",
    [sections.g3, year, advisers.g3, sections.g4, advisers.g4, sections.g5b, advisers.g5b, sections.g6, advisers.g6]);
  await db.pg.query("update edunexus.academic_years set status='active' where id=$1", [year]);

  // Learners: plainly synthetic names, a pending LRN for some.
  const first = ['Ana', 'Ben', 'Carla', 'Dino', 'Ella', 'Felix', 'Gina', 'Hugo', 'Iris', 'Jojo', 'Kiko', 'Lia', 'Migo', 'Nina', 'Oli', 'Pia', 'Quin', 'Rina', 'Sol', 'Toni'];
  const last = ['Demoson', 'Samplera', 'Testado', 'Placeholder', 'Fictiva', 'Mockadal', 'Examplo', 'Stubano'];
  const roster: Record<string, string[]> = { g1: [], g2: [], k: [], g5: [], g3: [], g4: [], g5b: [], g6: [] };
  let n = 0;
  for (const [key, grade, count] of [['g1', 1, 18], ['g2', 2, 16], ['k', 0, 10], ['g5', 5, 8],
    ['g3', 3, 15], ['g4', 4, 14], ['g5b', 5, 12], ['g6', 6, 13]] as const) {
    for (let i = 0; i < count; i++, n++) {
      const born = `${startYear - 6 - grade}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`;
      const learner = await principal.post('/learners', { first_name: first[n % first.length], last_name: last[(n * 3) % last.length], birth_date: born, sex: n % 2 ? 'male' : 'female', lrn: `9${String(100000000000 + n).slice(1)}` });
      const enrollment = await principal.post('/enrollments', { learner_id: learner.id, section_id: sections[key], enrolled_on: yearStart });
      roster[key]!.push(enrollment.id);
    }
  }

  // The school calendar for this month and the last: weekdays classroom, weekends no class.
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const days: Date[] = [];
  for (let d = monthStart; d <= monthEnd; d = shift(d, 1)) if (iso(d) >= yearStart && iso(d) <= yearEnd) days.push(d);
  for (let i = 0; i < days.length; i += 60) {
    const calendar = await principal.get(`/academic-years/${year}/calendar?from=${iso(days[0]!)}&to=${iso(days[Math.min(days.length - 1, 61)]!)}`);
    const version = calendar.body.data.calendar_version;
    const changes = days.slice(i, i + 60).map(d => (d.getUTCDay() % 6 === 0
      ? { day_on: iso(d), action: 'set', am: 'no_class', pm: 'no_class', day_type: 'weekend', label: 'Weekend' }
      : { day_on: iso(d), action: 'set', am: 'classroom', pm: 'classroom', day_type: 'regular', label: 'Demo school day' }));
    const body = { version, section_id: null, changes, reason };
    const preview = await principal.post(`/academic-years/${year}/calendar/preview`, body);
    await principal.post(`/academic-years/${year}/calendar/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
  }

  // Grade 1's register for last month and this month up to yesterday, with a few absences, so last
  // month's SF2 is complete and this month's counts to date. Today is left for the adviser to take.
  // Grade 2 has one day half-taken, so the SF2 shows what an unmarked session does.
  const adviser = as(ids.teacher);
  type Taught = 'g1' | 'g2' | 'k' | 'g3' | 'g4' | 'g5b' | 'g6';
  const advises: Record<Taught, string> = {
    g1: ids.teacher, g2: ids.otherTeacher, k: advisers.k,
    g3: advisers.g3, g4: advisers.g4, g5b: advisers.g5b, g6: advisers.g6,
  };
  const adviserOf = (key: Taught) => as(advises[key]);
  const schoolDays = days.filter(d => d.getUTCDay() % 6 !== 0 && d < today && iso(d) >= yearStart);
  const register = async (key: Taught, dates: Date[], mark: (i: number, index: number) => { am: string; pm: string } | null) => {
    for (const [index, day] of dates.entries()) {
      const sheet = await principal.get(`/sections/${sections[key]}/attendance?day_on=${iso(day)}`);
      const changes = roster[key]!.map((id, i) => { const m = mark(i, index); return m ? { enrollment_id: id, ...m } : null; }).filter(Boolean);
      const body = { day_on: iso(day), version: sheet.body.data.version, changes, reason };
      const preview = await adviserOf(key).post(`/sections/${sections[key]}/attendance/preview`, body);
      await adviserOf(key).post(`/sections/${sections[key]}/attendance/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
    }
  };
  await register('g1', schoolDays, (i, index) => {
    const absent = (i + index) % 9 === 0;
    return { am: absent ? 'absent' : 'present', pm: absent || (i === 3 && index % 3 === 0) ? 'absent' : 'present' };
  });
  await register('g2', schoolDays.slice(-3, -2), i => (i > 9 ? null : { am: 'present', pm: 'present' }));
  // The grades added for the demo take the last school week, with a couple of
  // absences each, so every adviser signs in to a register that has been used.
  for (const key of ['k', 'g3', 'g4', 'g5b', 'g6'] as const) {
    await register(key, schoolDays.slice(-5), (i, index) => {
      const absent = (i + index * 2) % 11 === 0;
      return { am: absent ? 'absent' : 'present', pm: absent ? 'absent' : 'present' };
    });
  }

  // Subjects, a policy the demo "school" adopted, and a few assessments with raw marks.
  const draft = await principal.post('/assessment-policy-drafts', { code: 'DEMO', name: 'Demo policy (not a DepEd policy)', source_reference: 'Synthetic demo only; no real weights', grade_levels: [1, 2], status: 'draft', reason,
    components: [{ code: 'WW', name: 'Written work', weight_basis_points: 5000 }, { code: 'PT', name: 'Performance task', weight_basis_points: 5000 }] });
  const adoption = await principal.post('/assessment-policy-adoptions', { academic_year_id: year, policy_id: draft.id, policy_version: draft.version, adopted_on: yearStart, adoption_reference: 'Demo record, not a school decision.', reason });
  const offerings: Record<'g1' | 'g2', string[]> = { g1: [], g2: [] };
  for (const [code, name] of [['DMATH', 'Mathematics (demo)'], ['DREAD', 'Reading (demo)'], ['DARTS', 'Arts (demo)']] as const) {
    const subject = await principal.post('/subjects', { code, name, kind: 'learning_area', grade_levels: [0, 1, 2], active: true, reason });
    for (const key of ['g1', 'g2'] as const) {
      const offering = await principal.post(`/sections/${sections[key]}/subjects`, { subject_id: subject.id, subject_version: subject.version, display_order: code === 'DMATH' ? 10 : code === 'DREAD' ? 20 : 30, reason });
      offerings[key].push(offering.id);
      if (code === 'DARTS') continue;
      await principal.post('/assessment-policy-bindings', { offering_id: offering.id, offering_version: offering.version, adoption_id: adoption.id, adoption_version: adoption.version, reason });
      if (key !== 'g1' || code !== 'DMATH') continue;
      const current = periods[today.toISOString().slice(0, 10) >= `${startYear}-09-16` ? 1 : 0]!;
      for (const [sequence, title, max] of [[1, 'Quiz on place value', 20], [2, 'Quiz on addition', 15]] as const) {
        const task = await principal.post(`/section-subjects/${offering.id}/assessment-tasks`, { reporting_period_id: current, component_code: 'WW', sequence, title, max_score: max, reason });
        const entries = roster.g1!.slice(0, sequence === 1 ? 18 : 11).map((id, i) => ({ enrollment_id: id, raw_score: Math.max(0, max - ((i * 7) % 9)) - (i % 4 === 0 ? 0.5 : 0), version: 0 }));
        await adviser.post(`/assessment-tasks/${task.id}/scores`, { entries, reason });
      }
      await principal.post(`/section-subjects/${offering.id}/assessment-tasks`, { reporting_period_id: current, component_code: 'PT', sequence: 1, title: 'Counting objects in class', max_score: 10, reason });
    }
  }

  // The heading the school forms print, and an attendance rule that says it is the demo's, not a school's.
  await db.pg.query("update edunexus.school_profile set region='Demo Region', division='Demo Division', district='Demo District', school_head_name='Demo Principal', school_head_position='Principal I'");
  const rule = (await principal.get('/attendance-day-rule')).body.data;
  await principal.post('/attendance-day-rule', { version: rule.rule?.version ?? 0, mixed_day: 'tardy', single_session_day: 'counts', reason: 'Demo only: invented for the walkthrough, not any school’s rule.' });

  // The first term's grades as if typed from an ECR, with a few still missing, and some comments. Grade 1 is
  // graded descriptively from 2026–2027 (DepEd Order No. 15, s. 2026), so it gets narratives, not grades.
  const ended = periods[0]!;
  for (const key of ['g2'] as const) {
    for (const [o, offering] of offerings[key].entries()) {
      const learners = roster[key]!.slice(0, key === 'g2' && o === 2 ? -3 : undefined);
      await adviserOf(key).post(`/section-subjects/${offering}/report-grades`, { reporting_period_id: ended, reason: 'Transcribed from the demo class record.',
        entries: learners.map((id, i) => ({ enrollment_id: id, grade: 79 + ((i * 7 + o * 5) % 17) + (i % 4 === 1 ? 0.25 : 0), version: 0 })) });
    }
  }
  await adviser.post(`/sections/${sections.g1}/report-notes`, { kind: 'can_do', reporting_period_id: ended, reason: 'Narratives from the demo class record.',
    entries: roster.g1!.slice(0, 6).map(id => ({ enrollment_id: id, body: 'Reads short sentences aloud and counts objects to 100.', version: 0 })) });
  await as(ids.otherTeacher).post(`/sections/${sections.g2}/report-notes`, { kind: 'comment', reporting_period_id: ended, reason: 'Comments from the demo class record.',
    entries: roster.g2!.slice(0, 5).map(id => ({ enrollment_id: id, body: 'Takes part in class and finishes work on time.', version: 0 })) });

  // A Grade 5 class with no adviser yet, so the Grades 4–6 card (grades and observed values) has a learner to show:
  // a manager may type its cards. Its learning areas are the demo's own, not the school's.
  const g5: string[] = [];
  for (const [code, name] of [['D5FIL', 'Filipino (demo)'], ['D5ENG', 'English (demo)'], ['D5MATH', 'Mathematics (demo, Grade 5)'], ['D5SCI', 'Science (demo)']] as const) {
    const subject = await principal.post('/subjects', { code, name, kind: 'learning_area', grade_levels: [5], active: true, reason });
    g5.push((await principal.post(`/sections/${sections.g5}/subjects`, { subject_id: subject.id, subject_version: subject.version, display_order: g5.length * 10 + 10, reason })).id);
  }
  for (const [i, enrollmentId] of roster.g5!.entries()) {
    await principal.post(`/enrollments/${enrollmentId}/report-card`, {
      grades: g5.flatMap((offering, o) => i < (o === 3 ? 6 : 8)
        ? [{ offering_id: offering, reporting_period_id: ended, grade: 78 + ((i * 5 + o * 7) % 19), version: 0 }]
        : []),
      summary: null,
      values: i < 5 ? [{ reporting_period_id: ended, ratings: { MD1: 'AO', MD2: i % 2 ? 'SO' : 'AO', MT1: 'SO', MT2: 'AO', MK1: 'AO', MB1: 'SO', MB2: i % 3 ? 'AO' : 'RO' }, version: 0 }] : [],
      notes: [],
      reason: 'Transcribed from the demo class record.',
    });
  }

  // Kindergarten's outcomes, most approved, and next school year's sections, so promotion and next year's classes have something to show.
  const outcomes = roster.k!.map((id, i) => ({ enrollment_id: id, action: i === 7 ? 'retained' : 'promoted', version: 0 }));
  await adviserOf('k').post(`/sections/${sections.k}/promotion-recommendations`, { entries: outcomes, reason: 'Demo outcomes, not a school decision.' });
  await principal.post(`/sections/${sections.k}/promotion-decisions`, { entries: outcomes.slice(0, 8).map(e => ({ enrollment_id: e.enrollment_id, decision: 'approved', version: 1 })), reason: 'Demo approval, not a school decision.' });
  const next = await principal.post('/academic-years', { start_year: startYear + 1, starts_on: `${startYear + 1}-06-08`, ends_on: `${startYear + 2}-03-31` });
  for (const [grade, name] of [[0, 'Demo Sampaguita'], [1, 'Demo Narra'], [1, 'Demo Ilang-ilang'], [2, 'Demo Molave'], [3, 'Demo Acacia']] as const) await principal.post('/sections', { academic_year_id: next.id, grade_level: grade, name });
  // The front page's sample notices, the same ones the seeded school carries.
  const send = async (method: 'get' | 'post' | 'patch', url: string, body?: object) => {
    await db.pg.query('delete from edunexus.request_buckets');
    const call = request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${ids.principal}`);
    const r = await (body ? call.send(body) : call);
    if (r.status >= 300) throw new Error(`${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };
  await seedSiteContent({ loader: ids.principal, log: () => {}, as: () => ({ get: url => send('get', url), post: (url, body) => send('post', url, body), patch: (url, body) => send('patch', url, body) }) });
  await db.pg.query('delete from edunexus.request_buckets');
  return { db, app, page, year, next, periods, sections, roster };
}
