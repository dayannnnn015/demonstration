import { cardFor, gradesOf, lineOf, reportCardAreas } from '../../web/learning-areas.js';
import { children, comment, lrn, narratives, normal, random, termGrade, valueMark, type Child, type Family } from './people.js';

/**
 * A Balili-shaped school of invented records, written through the real API.
 *
 * Every record goes in through the same operations a person would use, with
 * the same validation, version checks and history, so the seeded database
 * behaves exactly as a real one. Since 13 October it reads like a real school,
 * on the user's instruction: made-up but ordinary names, DepEd Order No. 9,
 * s. 2026's calendar, and one learner's attendance, grades, observed values,
 * comments and outcome all following from the same hidden traits (see
 * `people.ts`). Nothing in a name or a reason says it is seeded; the
 * seeded-data banner on every screen and printed page does, and the go-live
 * wipe removes it all.
 */

export type Call = {
  get(path: string): Promise<any>;
  post(path: string, body: object): Promise<any>;
  patch(path: string, body: object): Promise<any>;
};
export type Person = { id: string; name: string };
export type SeedPlan = {
  /** The synthetic principal every setup change is attributed to. */
  loader: string;
  loaderName?: string;
  advisers: Person[];
  subjectTeachers: Person[];
  /** Yesterday and earlier are marked; today is left for someone to take. */
  today: string;
  /** Section sizes as the SF4 reports them, or a few learners each for a quick rehearsal. */
  scale: 'full' | 'small';
  /** How many sections are marked at once. Sections lock separately since 0023. */
  parallel: number;
  as(userId: string): Call;
  log(message: string): void;
};

/** The reasons a school's own staff would give, one per kind of change. */
export const reasons = {
  setup: 'School setup for SY 2026-2027 from the school records.',
  calendar: 'School calendar for SY 2026-2027, DepEd Order No. 9, s. 2026.',
  register: 'Daily attendance taken in class.',
  submit: 'Month checked and submitted to the principal for the SF4.',
  lock: 'SF2 checked and signed by the principal.',
  grades: 'Transcribed from the class record (ECR).',
  values: 'Observed values for the term, from class observation.',
  notes: 'Comments for the progress report.',
  remarks: 'SF2 remarks for the month.',
  movement: 'Learner movement recorded from the transfer papers.',
  followup: 'Absent five consecutive days; the adviser is visiting the home.',
  outcome: 'End-of-year outcome from the final grades.',
  approve: 'Checked against the class record and approved.',
  subjects: 'Learning areas printed on the school report cards.',
  rule: 'Agreed at the faculty meeting: a learner present for one session is marked tardy, as the SF2 codes show.',
};
/** Kept for the older top-up modes; the full seed uses `reasons`. */
export const reason = reasons.setup;
export const notice = 'Every learner, staff member, mark and score here is invented for testing, and will be wiped before EDUNEXUS holds real records.';
/** The school head the seed invents. The go-live wipe keeps the school profile, so it clears exactly this name. */
export const seededSchoolHead = 'Teresita B. Dumalsin';
export const seedSchoolHead = seededSchoolHead;

// DepEd Order No. 9, s. 2026: 8 June to 8 April in three terms.
const yearStart = '2026-06-08', yearEnd = '2027-04-08';
const terms = [['Term 1', '2026-06-08', '2026-09-15'], ['Term 2', '2026-09-16', '2026-12-18'], ['Term 3', '2027-01-04', '2027-04-08']] as const;

/** The SF4's own sizes: 893 learners in thirty sections. */
const fullSizes: Record<number, number[]> = {
  0: [20, 19, 19, 20, 19, 19], 1: [33, 33, 32, 32], 2: [32, 32, 31, 31], 3: [31, 31, 31, 30],
  4: [37, 33, 32, 31], 5: [33, 33, 33, 32], 6: [34, 34, 33, 33],
};

/** The holidays on school days in DO 9's Annex B, and the year-end break. */
const closed: Record<string, [string, 'holiday' | 'school_break']> = {
  '2026-06-12': ['Independence Day', 'holiday'], '2026-08-21': ['Ninoy Aquino Day', 'holiday'], '2026-08-31': ['National Heroes Day', 'holiday'],
  '2026-11-02': ['All Souls’ Day', 'holiday'], '2026-11-30': ['Bonifacio Day', 'holiday'], '2026-12-08': ['Feast of the Immaculate Conception', 'holiday'],
  '2027-03-25': ['Maundy Thursday', 'holiday'], '2027-03-26': ['Good Friday', 'holiday'],
};
const inBreak = (day: string) => day >= '2026-12-19' && day <= '2027-01-03';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); iso(d) <= to; d = new Date(d.getTime() + 86400000)) out.push(iso(d));
  return out;
};
const weekend = (day: string) => { const w = new Date(`${day}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
const schoolDay = (day: string) => !weekend(day) && !closed[day] && !inBreak(day);

/** Runs `work` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; await work(items[index]!, index); }
  }));
}

type Member = { enrollment: string; child: Child; enrolledOn: string; leaves?: { on: string; reason: 'transfer_out' | 'dropout'; remark: string } };
type Section = { id: string; grade: number; name: string; adviser: string; members: Member[] };

const positions: Record<string, [string, string]> = {
  kinder: ['Teacher II', 'Early Childhood Education'], early: ['Teacher I', 'General Education'],
};
const majors = ['English', 'Filipino', 'Mathematics', 'Science', 'ESP/Values Education', 'TLE/EPP', 'General Education'];

export async function seedSchool(plan: SeedPlan) {
  const loader = plan.as(plan.loader);
  const next = random(20261013);

  plan.log('School profile and staff');
  const school = await loader.get('/school');
  await loader.patch('/school', { version: school.version, name: 'Balili Elementary School', school_code: '135617', address: school.address,
    region: 'Cordillera Administrative Region', division: 'Schools Division Office of Benguet', district: 'La Trinidad District',
    school_head_name: plan.loaderName ?? seededSchoolHead, school_head_position: 'Principal I' });
  const staffVersion = new Map<string, number>();
  for (const person of [...plan.advisers, ...plan.subjectTeachers]) {
    const made = await loader.post('/staff', { user_id: person.id, display_name: person.name, role: 'teacher' })
      ?? (await loader.get('/staff?limit=100')).items.find((s: { user_id: string }) => s.user_id === person.id);
    staffVersion.set(person.id, made.version);
  }

  plan.log('School year 2026–2027 and its three terms');
  const year = await loader.post('/academic-years', { start_year: 2026, starts_on: yearStart, ends_on: yearEnd })
    ?? (await loader.get('/academic-years')).items.find((y: { start_year: number }) => y.start_year === 2026);
  const periods: string[] = [];
  for (const [index, [name, from, to]] of terms.entries()) {
    const made = await loader.post(`/academic-years/${year.id}/periods`, { ordinal: index + 1, name, starts_on: from, ends_on: to })
      ?? (await loader.get(`/academic-years/${year.id}/periods`)).items.find((p: { ordinal: number }) => p.ordinal === index + 1);
    periods.push(made.id);
  }
  await loader.patch(`/academic-years/${year.id}/status`, { version: year.version, status: 'active' });

  plan.log('Thirty sections, their advisers and their positions');
  const sizes = plan.scale === 'full' ? fullSizes : Object.fromEntries(Object.entries(fullSizes).map(([g, s]) => [g, s.map(() => 4)]));
  const sections: Section[] = [];
  // Three Kinder advisers hold two sections each, as the SF4 shows; one adviser per graded section.
  let adviserIndex = 0;
  for (const grade of [0, 1, 2, 3, 4, 5, 6]) {
    for (const [index] of sizes[grade]!.entries()) {
      const adviser = plan.advisers[grade === 0 ? Math.floor(index / 2) : 3 + adviserIndex++]!;
      const name = String.fromCharCode(65 + index);
      const row = await loader.post('/sections', { academic_year_id: year.id, grade_level: grade, name, adviser_user_id: adviser.id })
        ?? (await loader.get(`/sections?academic_year_id=${year.id}&limit=100`)).items.find((s: { grade_level: number; name: string }) => s.grade_level === grade && s.name === name);
      sections.push({ id: row.id, grade, name, adviser: adviser.id, members: [] });
    }
  }
  for (const [i, person] of [...plan.advisers, ...plan.subjectTeachers].entries()) {
    const held = sections.find(s => s.adviser === person.id);
    const [position, major] = !held ? ['Teacher III', ['Science', 'Araling Panlipunan', 'MAPEH'][i % 3]!]
      : held.grade === 0 ? positions.kinder! : held.grade <= 3 ? [i % 5 === 0 ? 'Master Teacher I' : ['Teacher I', 'Teacher II', 'Teacher III'][i % 3]!, 'General Education']
        : [i % 4 === 0 ? 'Master Teacher I' : ['Teacher II', 'Teacher III', 'Teacher I'][i % 3]!, majors[i % majors.length]!];
    await loader.patch(`/staff/${person.id}`, { version: staffVersion.get(person.id)!, position, specialization: major });
  }

  plan.log(`Learners and enrollments (${sections.reduce((n, s) => n + sizes[s.grade]![s.name.charCodeAt(0) - 65]!, 0)})`);
  const families: Family[] = [];
  let sequence = 1;
  for (const section of sections) {
    const size = sizes[section.grade]![section.name.charCodeAt(0) - 65]!;
    for (const child of children(section.grade, size, families, section.grade * 1000 + section.name.charCodeAt(0))) {
      // A few arrived after the opening, as transfers in, on a date already past.
      const arrived = next() < 0.03 ? ['2026-07-06', '2026-08-03', '2026-08-17'][Math.floor(next() * 3)]! : yearStart;
      section.members.push({ enrollment: '', child, enrolledOn: arrived < plan.today ? arrived : yearStart });
    }
  }
  const all = sections.flatMap(s => s.members.map(m => ({ s, m })));
  await pool(all, plan.parallel, async ({ s, m }) => {
    const c = m.child;
    // Every new learner carries an LRN since 14 October, transferees included.
    const body = { first_name: c.first, middle_name: c.middle, last_name: c.last, name_extension: c.extension, birth_date: c.birth, sex: c.sex,
      lrn: lrn(s.grade, sequence++) };
    // Recorded before a dropped connection: found again by its LRN, or by its name and birthdate.
    const learner = await loader.post('/learners', body) ?? (await loader.get(`/learners?${body.lrn ? `lrn=${body.lrn}` : `search=${encodeURIComponent(c.last)}&birth_date=${c.birth}`}&limit=100`))
      .items.find((l: { first_name: string; last_name: string }) => l.first_name === c.first && l.last_name === c.last);
    const enrolled = await loader.post('/enrollments', { learner_id: learner.id, section_id: s.id, enrolled_on: m.enrolledOn, entry_kind: m.enrolledOn === yearStart ? 'regular' : 'transfer_in' })
      ?? (await loader.get(`/enrollments?learner_id=${learner.id}&limit=10`)).items[0];
    m.enrollment = enrolled.id;
  });

  // A handful leave during the year: transfers out to another school, and one learner who stops coming.
  const leavers = sections.filter(s => s.grade > 0).flatMap(s => s.members).filter(m => m.enrolledOn === yearStart).sort(() => next() - 0.5).slice(0, plan.scale === 'full' ? 5 : 2);
  const destinations = ['a school in Baguio City', 'a school in Itogon, Benguet', 'a school in Pangasinan', 'a school in Tuba, Benguet'];
  leavers.forEach((m, i) => {
    m.leaves = i === 0 && plan.scale === 'full'
      ? { on: '2026-09-28', reason: 'dropout', remark: 'd.1. Distance between home and school' }
      : { on: ['2026-08-24', '2026-09-21', '2026-09-07'][i % 3]!, reason: 'transfer_out', remark: `Transferred to ${destinations[i % destinations.length]}` };
  });

  plan.log('Instructional calendar for the whole year');
  const year365 = days(yearStart, yearEnd);
  for (let i = 0; i < year365.length; i += 60) {
    const chunk = year365.slice(i, i + 60);
    const calendar = await loader.get(`/academic-years/${year.id}/calendar?from=${chunk[0]}&to=${chunk[chunk.length - 1]}`);
    const changes = chunk.map(day => {
      if (weekend(day)) return { day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'weekend', label: 'Weekend' };
      if (closed[day]) return { day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: closed[day]![1], label: closed[day]![0] };
      if (inBreak(day)) return { day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'school_break', label: 'Christmas break' };
      return { day_on: day, action: 'set', am: 'classroom', pm: 'classroom', day_type: 'regular', label: 'Class day' };
    });
    const body = { version: calendar.calendar_version, section_id: null, changes, reason: reasons.calendar };
    const preview = await loader.post(`/academic-years/${year.id}/calendar/preview`, body);
    await loader.post(`/academic-years/${year.id}/calendar/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
  }

  // The register: each learner absent by their own rate, more so on stormy days in the rainy months, a few
  // off sick for a week at a stretch. Every mark follows from the learner's traits, so it agrees with the grades.
  const marked = year365.filter(day => schoolDay(day) && day < plan.today);
  const stormy = new Set(marked.filter(d => d >= '2026-07-01' && d <= '2026-09-30').filter(() => next() < 0.08));
  const streaks = new Map<string, Set<string>>();
  for (const { m } of all) {
    if (!m.child.traits.streak) continue;
    const pool5 = marked.filter(d => d >= '2026-07-13' && d <= '2026-10-02');
    const start = Math.floor(next() * Math.max(1, pool5.length - 7));
    streaks.set(m.enrollment, new Set(pool5.slice(start, start + 5 + Math.floor(next() * 3))));
  }
  const traitsOf = new Map(all.map(({ m }) => [m.enrollment, m.child.traits]));
  plan.log(`Daily register, ${marked.length} school days in ${sections.length} sections`);
  const byAdviser = [...new Set(sections.map(s => s.adviser))].map(a => sections.filter(s => s.adviser === a));
  const register = async (dates: string[]) => {
    await pool(byAdviser, plan.parallel, async held => {
      for (const section of held) {
        const adviser = plan.as(section.adviser);
        for (const day of dates) for (let attempt = 0; ; attempt++) try {
          const sheet = await adviser.get(`/sections/${section.id}/attendance?day_on=${day}&limit=100`);
          if (!sheet.recording_available) break;
          const roll = random(Number(day.replace(/-/g, '')) * 31 + section.grade * 7 + section.name.charCodeAt(0));
          const changes = (sheet.items as { enrollment_id: string }[]).map(item => {
            const t = traitsOf.get(item.enrollment_id);
            const r = roll();
            if (!t) return { enrollment_id: item.enrollment_id, am: 'present', pm: 'present' };
            if (streaks.get(item.enrollment_id)?.has(day)) return { enrollment_id: item.enrollment_id, am: 'absent', pm: 'absent' };
            const away = t.absence * (stormy.has(day) ? 3 : 1);
            if (r < away) return { enrollment_id: item.enrollment_id, am: 'absent', pm: 'absent' };
            if (r < away + t.late) return { enrollment_id: item.enrollment_id, am: 'absent', pm: 'present' };
            if (r < away + t.late * 1.3) return { enrollment_id: item.enrollment_id, am: 'present', pm: 'absent' };
            return { enrollment_id: item.enrollment_id, am: 'present', pm: 'present' };
          });
          if (!changes.length) break;
          const body = { day_on: day, version: sheet.version, changes, reason: reasons.register };
          const preview = await adviser.post(`/sections/${section.id}/attendance/preview`, body);
          await adviser.post(`/sections/${section.id}/attendance/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
          break;
        } catch (error) {
          // The day is read again and sent again: if the first try was recorded after all, the register refuses a change that changes nothing.
          if (/ATTENDANCE_UNCHANGED/.test((error as Error).message)) break;
          if (attempt >= 3) throw error;
          plan.log(`  ${section.grade}-${section.name} ${day}: ${(error as Error).message.slice(0, 120)}; trying again`);
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
      }
    });
  };
  // Marked up to each leaving date, then the movement, then on: an adviser's sheet lists only who is still in the class.
  const cuts = [...new Set(leavers.map(m => m.leaves!.on).filter(d => d < plan.today))].sort();
  let from = '';
  for (const cut of [...cuts, '9999-12-31']) {
    await register(marked.filter(d => d >= from && d < cut));
    plan.log(`  register marked to ${cut === '9999-12-31' ? 'yesterday' : cut}`);
    for (const m of leavers.filter(l => l.leaves!.on === cut)) {
      const enrollment = await loader.get(`/enrollments/${m.enrollment}`);
      await loader.post(`/enrollments/${m.enrollment}/movements`, { version: enrollment.version, action: 'withdrawn', effective_on: cut, section_id: null, exit_reason: m.leaves!.reason });
      const section = sections.find(s => s.members.includes(m))!;
      await loader.post(`/sections/${section.id}/report-notes`, { kind: 'sf2_remark', month_on: `${cut.slice(0, 7)}-01`, reason: reasons.remarks,
        entries: [{ enrollment_id: m.enrollment, body: m.leaves!.remark, version: 0 }] }).catch(() => undefined);
    }
    from = cut;
  }

  plan.log('Monthly consolidation: June to August locked, September submitted');
  const ended = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].filter(m => { const n = new Date(`${m}T00:00:00Z`); n.setUTCMonth(n.getUTCMonth() + 1); return iso(n) <= plan.today; });
  const transition = async (section: Section, month: string, action: 'submit' | 'lock') => {
    const state = await loader.get(`/sections/${section.id}/attendance/months?month_on=${month}`);
    const body = { month_on: month, version: state.version, action, reason: action === 'submit' ? reasons.submit : reasons.lock };
    const preview = await loader.post(`/sections/${section.id}/attendance/months/preview`, body);
    if (!preview.review_hash) throw new Error(`${section.grade}-${section.name} ${month} ${action}: ${JSON.stringify(preview.issues ?? preview)}`);
    await loader.post(`/sections/${section.id}/attendance/months/transitions`, { ...body, review_hash: preview.review_hash, reviewed: true });
  };
  await pool(sections, plan.parallel, async section => {
    for (const month of ended) {
      await transition(section, month, 'submit');
      if (month !== '2026-09-01') await transition(section, month, 'lock');
    }
  });

  plan.log('Home-visit follow-ups for learners absent five days in a row');
  const visited = all.filter(({ m }) => streaks.has(m.enrollment) && !(m.leaves && m.leaves.on < plan.today));
  for (const [index, { s, m }] of visited.entries()) {
    const run = [...streaks.get(m.enrollment)!].sort();
    const body = { section_id: s.id, from: run[0], to: run[run.length - 1], category: 'absence', assignee_user_id: plan.loader, due_on: null, reason: reasons.followup };
    try {
      const preview = await loader.post(`/enrollments/${m.enrollment}/attendance-follow-ups/preview`, body);
      const opened = await loader.post(`/enrollments/${m.enrollment}/attendance-follow-ups`, { ...body, review_hash: preview.review_hash, reviewed: true });
      if (index % 3 === 2) continue;
      const change = { version: opened.case_version, action: 'resolve', assignee_user_id: plan.loader, due_on: null, reason: 'Home visited; the learner is back in class.' };
      const review = await loader.post(`/attendance-follow-ups/${opened.case_id}/preview`, change);
      await loader.post(`/attendance-follow-ups/${opened.case_id}/events`, { ...change, review_hash: review.review_hash, reviewed: true });
    } catch (error) { plan.log(`  follow-up skipped: ${(error as Error).message.slice(0, 120)}`); }
  }

  plan.log('The report cards’ learning areas, offered to every graded section');
  const subjects = new Map<string, { id: string; version: number }>();
  for (const area of reportCardAreas) {
    subjects.set(area.code, await loader.post('/subjects', { code: area.code, name: area.name, kind: 'learning_area', grade_levels: gradesOf(area), active: true, reason: reasons.subjects })
      ?? (await loader.get('/subjects?limit=100')).items.find((x: { code: string }) => x.code === area.code));
  }
  await pool(sections.filter(s => s.grade > 0), plan.parallel, async section => {
    // Grade 6 takes EPP here; whether it is EPP or TLE is a question still open with the school.
    for (const area of cardFor(section.grade).filter(a => a.code !== 'TLE')) {
      const subject = subjects.get(area.code)!;
      await loader.post(`/sections/${section.id}/subjects`, { subject_id: subject.id, subject_version: subject.version, display_order: lineOf(area, section.grade), reason: reasons.subjects });
    }
  });

  await seedCards(plan, sections, periods);
  await seedAttendanceRule(plan);
  await seedSiteContent(plan);
  plan.log('Seeding finished.');
  return { year: year.id, sections: sections.length, learners: all.length };
}

/**
 * Every term's report card and the year's outcome, as each adviser would type
 * them from the ECR, all from the learner's traits: grades with the subject
 * averages and general average an ECR rounds them to, observed values, comments
 * on Grades 2–3 and narratives on Grade 1 (graded descriptively in 2026–2027).
 * The adviser recommends each outcome from the final grades and the principal
 * approves it. Learners who left are left as they were on the day they left.
 */
async function seedCards(plan: SeedPlan, sections: Section[], periods: string[]) {
  plan.log('Report cards and outcomes, every term');
  const loader = plan.as(plan.loader);
  await pool(sections, plan.parallel, async (section, index) => {
    const adviser = plan.as(section.adviser);
    const next = random(index * 104729 + 17);
    // Who has left by today is left as they were the day they left.
    const stay = section.members.filter(m => !(m.leaves && m.leaves.on < plan.today));
    const outcomes = new Map<string, string>(stay.map(m => [m.enrollment, 'promoted']));
    if (section.grade === 1) {
      for (const period of periods) {
        const written = stay.map(m => ({ m, n: narratives(m.child, next) }));
        await adviser.post(`/sections/${section.id}/report-notes`, { kind: 'can_do', reporting_period_id: period, reason: reasons.notes, entries: written.map(w => ({ enrollment_id: w.m.enrollment, body: w.n.can_do, version: 0 })) });
        await adviser.post(`/sections/${section.id}/report-notes`, { kind: 'to_improve', reporting_period_id: period, reason: reasons.notes, entries: written.map(w => ({ enrollment_id: w.m.enrollment, body: w.n.to_improve, version: 0 })) });
      }
    }
    if (section.grade >= 2) {
      const records = await adviser.get(`/sections/${section.id}/report-records`);
      const offerings = (records.offerings as { id: string; active: boolean }[]).filter(o => o.active);
      // How each learner takes to each area: a little better at some, a little worse at others.
      const lean = new Map(stay.map(m => [m.enrollment, offerings.map(() => 2.2 * normal(next))]));
      const finals = new Map<string, number[]>();
      for (const [o, offering] of offerings.entries()) {
        const grades = stay.map(m => periods.map((_, p) => termGrade(m.child.traits, lean.get(m.enrollment)![o]!, p + 1, next)));
        for (const [p, period] of periods.entries()) {
          await adviser.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: period, reason: reasons.grades,
            entries: stay.map((m, i) => ({ enrollment_id: m.enrollment, grade: grades[i]![p]!, version: 0 })) });
        }
        await adviser.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: null, reason: reasons.grades,
          entries: stay.map((m, i) => {
            const final = Math.round(grades[i]!.reduce((t, g) => t + g, 0) / periods.length);
            finals.set(m.enrollment, [...(finals.get(m.enrollment) ?? []), final]);
            return { enrollment_id: m.enrollment, grade: final, remark: final >= 75 ? 'passed' : 'failed', version: 0 };
          }) });
      }
      await adviser.post(`/sections/${section.id}/report-summaries`, { reason: reasons.grades, entries: stay.map(m => {
        const list = finals.get(m.enrollment)!;
        const average = Math.round(list.reduce((t, g) => t + g, 0) / list.length);
        const failed = list.filter(g => g < 75).length;
        outcomes.set(m.enrollment, failed > 2 || average < 75 ? 'retained' : failed ? 'conditionally_promoted' : 'promoted');
        return { enrollment_id: m.enrollment, general_average: average, remark: average >= 75 ? 'passed' : 'failed', version: 0 };
      }) });
      if (section.grade <= 3) {
        for (const [p, period] of periods.entries()) {
          await adviser.post(`/sections/${section.id}/report-notes`, { kind: 'comment', reporting_period_id: period, reason: reasons.notes,
            entries: stay.map(m => ({ enrollment_id: m.enrollment, body: comment(m.child, p + 1, next), version: 0 })) });
        }
      } else {
        for (const period of periods) {
          await adviser.post(`/sections/${section.id}/report-values`, { reporting_period_id: period, reason: reasons.values,
            entries: stay.map(m => ({ enrollment_id: m.enrollment, version: 0, ratings: Object.fromEntries(['MD1', 'MD2', 'MT1', 'MT2', 'MK1', 'MB1', 'MB2'].map(code => [code, valueMark(m.child.traits, next)])) })) });
        }
      }
    }
    // Kindergarten and Grade 1 move up developmentally (DO 15, sections 63–65); the rest by their final grades.
    const entries = [...outcomes].map(([enrollment_id, action]) => ({ enrollment_id, action, version: 0 }));
    if (!entries.length) return;
    await adviser.post(`/sections/${section.id}/promotion-recommendations`, { entries, reason: reasons.outcome });
    const year = (await loader.get('/academic-years')).items.find((y: { status: string }) => y.status === 'active');
    const waiting = ((await loader.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`)).items as { enrollment_id: string; status: string; version: number }[]).filter(e => e.status === 'recommended');
    if (waiting.length) await loader.post(`/sections/${section.id}/promotion-decisions`, { reason: reasons.approve, entries: waiting.map(e => ({ enrollment_id: e.enrollment_id, decision: 'approved', version: e.version })) });
  });
}

/**
 * An attendance rule for the seeded school, so its SF2 and SF4 show what the
 * filled forms look like. It follows the SF2's own codes, where a learner
 * present for one session is marked tardy (half-shaded), and counts a
 * one-session date as a day of classes. The real principal records the
 * school's own answer over it on School profile, and the go-live wipe removes
 * it with everything else.
 */
export async function seedAttendanceRule(plan: { loader: string; as(userId: string): Call; log(message: string): void }) {
  const loader = plan.as(plan.loader);
  if ((await loader.get('/attendance-day-rule')).rule) return;
  plan.log('The attendance rule for the SF2 and SF4');
  await loader.post('/attendance-day-rule', { version: 0, mixed_day: 'tardy', single_session_day: 'counts', reason: reasons.rule });
}

const canDo = ['Reads short sentences aloud with growing confidence.', 'Counts and groups objects up to 100.', 'Shares and takes turns during group work.', 'Names the parts of a plant and tells what each does.'];
const toImprove = ['Writing letters neatly on the lines.', 'Telling a story in the order it happened.', 'Waiting for a turn to speak in class.', 'Adding numbers with regrouping.'];
const comments = ['Takes part in class and finishes work on time.', 'Reads well; needs more practice with word problems.', 'Works well with classmates and helps others.', 'Is improving steadily; keep reading at home.'];

/**
 * Term 1's report cards for every section that has an adviser, as if each
 * adviser had typed them from an ECR: Grades 2–6 get a grade in every learning
 * area, with a few left unrecorded and three sections one area behind, so Grade
 * entry has something to count; Grade 1, graded descriptively under DepEd
 * Order No. 15, s. 2026, gets its two narratives; Grades 2–3 a comment and
 * Grades 4–6 observed values. Every value is invented, and each adviser writes
 * only their own section, through the same operations the screens use.
 */
export async function seedReportCards(plan: { loader: string; parallel: number; as(userId: string): Call; log(message: string): void; seeded?: (userId: string) => boolean }) {
  const loader = plan.as(plan.loader);
  const year = (await loader.get('/academic-years')).items.find((y: { status: string }) => y.status === 'active');
  const term = (await loader.get(`/academic-years/${year.id}/periods`)).items.find((p: { ordinal: number }) => p.ordinal === 1);
  const sections = ((await loader.get(`/sections?academic_year_id=${year.id}&limit=100`)).items as { id: string; grade_level: number; adviser_user_id: string | null }[])
    .filter(s => s.grade_level > 0 && s.adviser_user_id);
  // A section a real staff member advises is theirs: nothing is written as them.
  const own = sections.filter(s => plan.seeded?.(s.adviser_user_id!) ?? true);
  plan.log(`Term 1 report cards for ${own.length} sections${own.length < sections.length ? `; ${sections.length - own.length} advised by a real account left alone` : ''}`);
  await pool(own, plan.parallel, async (section, index) => {
    const adviser = plan.as(section.adviser_user_id!);
    const records = await adviser.get(`/sections/${section.id}/report-records`);
    type Read = { enrollment_id: string; status: string; grades: unknown[]; notes: unknown[]; values: unknown[] };
    // A section that already has records was seeded by an earlier run that stopped; it is left as it is.
    if ((records.learners as Read[]).some(l => l.grades.length || l.notes.length || l.values.length)) return;
    const learners = (records.learners as Read[]).filter(l => l.status === 'enrolled');
    const next = random(index * 104729 + 7);
    const note = (kind: string, bodies: string[], share: number) => {
      const entries = learners.filter((_, i) => i < Math.ceil(learners.length * share)).map((l, i) => ({ enrollment_id: l.enrollment_id, body: bodies[(i + index) % bodies.length], version: 0 }));
      return entries.length ? adviser.post(`/sections/${section.id}/report-notes`, { kind, reporting_period_id: term.id, entries, reason }) : null;
    };
    if (section.grade_level === 1) {
      await note('can_do', canDo, 1);
      await note('to_improve', toImprove, 0.8);
      return;
    }
    const areas = (records.offerings as { id: string; active: boolean }[]).filter(o => o.active);
    for (const [o, offering] of areas.entries()) {
      if (index % 10 === 3 && o === areas.length - 1) continue;
      const entries = learners.filter((_, i) => (i * 7 + o + index) % 23 !== 0).map(l => ({ enrollment_id: l.enrollment_id, grade: Math.round(74 + next() * 24), version: 0 }));
      if (entries.length) await adviser.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: term.id, entries, reason });
    }
    if (section.grade_level <= 3) { await note('comment', comments, 0.5); return; }
    const marks = ['AO', 'AO', 'SO', 'SO', 'SO', 'RO'];
    const entries = learners.map(l => ({ enrollment_id: l.enrollment_id, version: 0,
      ratings: Object.fromEntries(['MD1', 'MD2', 'MT1', 'MT2', 'MK1', 'MB1', 'MB2'].map(code => [code, marks[Math.floor(next() * marks.length)]])) }));
    if (entries.length) await adviser.post(`/sections/${section.id}/report-values`, { reporting_period_id: term.id, entries, reason });
  });
}

/**
 * Sample notices for the seeded school's front page, published by its synthetic
 * principal. Their dates are DepEd Order No. 9, s. 2026's own calendar, and the
 * rest is the prototype's sample copy; the front page shows a test ribbon while
 * the seeded-data notice exists, and the go-live wipe removes all of it. No phone
 * number or e-mail is invented: the school fills those in itself.
 */
export async function seedSiteContent(plan: { loader: string; as(userId: string): Call; log(message: string): void }) {
  const loader = plan.as(plan.loader);
  const current = await loader.get('/announcements?archived=true');
  // Once the school has notices of its own, they are left alone; a stopped seed's own notices are finished.
  const ours = (title: string) => (current.items as { title: string }[]).some(a => a.title === title);
  plan.log('Notices for the front page');
  const notices = [
    { kind: 'advisory', title: 'No classes on November 2, All Souls’ Day', summary: 'All Souls’ Day is an additional special non-working holiday on the DepEd calendar. Classes resume on Tuesday, November 3.', body: '', pinned: true },
    { kind: 'event', title: 'Family reading orientation', summary: 'A short session on practical reading routines families can continue at home.', body: 'Parents and guardians of Grades 1 to 3 learners are invited.\n\nPlease bring your child’s reading log.', event_on: '2026-10-23', event_time: '1:30 PM to 3:00 PM', venue: 'School library' },
    { kind: 'news', title: 'Second teacher-made summative test on October 29', summary: 'Term 2’s second summative test is set for Thursday, October 29, as on the DepEd school calendar.', body: 'Advisers will send reviewers home the week before.' },
    { kind: 'event', title: 'Term 2 examination', summary: 'The Term 2 examination runs over two days at the start of December.', body: '', event_on: '2026-12-03', event_ends_on: '2026-12-04' },
    { kind: 'event', title: 'PTA meeting and distribution of progress reports', summary: 'Parents and guardians receive their child’s Term 2 progress report from the adviser.', body: '', event_on: '2026-12-15', event_time: '1:30 PM', venue: 'Each child’s classroom' },
    { kind: 'news', title: 'Parents asked to update learner health information', summary: 'Families may submit updated emergency contacts, allergy information and relevant health notes through their class adviser.', body: '' },
    { kind: 'news', title: 'First school-wide reading progress check scheduled', summary: 'Learners will complete a short classroom reading check to help teachers plan focused support for the term.', body: '' },
  ];
  if (current.items.length && !notices.some(n => ours(n.title))) return;
  for (const n of notices.reverse()) {
    if (!ours(n.title)) await loader.post('/announcements', { event_on: null, event_ends_on: null, event_time: null, venue: null, pinned: false, ...n, reason });
  }
  const now = (await loader.get('/announcements?archived=true')).items as { id: string; title: string; status: string; version: number }[];
  for (const made of now.filter(a => a.status === 'draft' && notices.some(n => n.title === a.title))) {
    await loader.post(`/announcements/${made.id}/status`, { version: made.version, action: 'publish', reason });
  }
  if (current.settings?.tagline) return;
  await loader.patch('/site-settings', { version: current.settings?.version ?? 0, reason,
    tagline: 'Learning with care, growing together, and helping every child build strong foundations for the future.',
    about: 'Balili Elementary School supports children through strong classroom foundations, close family partnership, and a school culture grounded in care and responsibility.' });
}

type Learner = {
  enrollment_id: string; status: string;
  grades: { offering_id: string; reporting_period_id: string | null; grade: number | null; remark: string | null; version: number }[];
  summary: { general_average: number | null; remark: string | null; version: number } | null;
  values: { reporting_period_id: string; ratings: Record<string, string>; version: number }[];
  notes: { kind: string; reporting_period_id: string | null; body: string | null; version: number }[];
};

/**
 * Everything the first seed left empty, on the user's instruction of 13 October
 * ("seed the unseeded parts … make up names, details"): the heading every form
 * prints, the seeded staff's positions, the register up to yesterday, every
 * term's grades with the subject averages, general averages and remarks, the
 * observed values and comments of every term, an approved outcome for every
 * learner, and September submitted in every section. Every value goes in through
 * the API as the seeded principal, only where nothing is recorded yet, so it
 * can run again; the go-live wipe removes it. The averages below are invented
 * the way an ECR would show them — the seed makes up an ECR; EDUNEXUS itself
 * still computes no grade.
 */
export async function seedFill(plan: { loader: string; today: string; parallel: number; as(userId: string): Call; log(message: string): void; seeded(userId: string): boolean }) {
  const loader = plan.as(plan.loader);

  // The heading: the division the school's own SF4 names, and an invented school head the go-live wipe clears.
  const school = await loader.get('/school');
  const heading: Record<string, string> = {};
  if (!school.region) heading.region = 'Cordillera Administrative Region';
  if (!school.division) heading.division = 'Schools Division Office of Benguet';
  if (!school.district) heading.district = 'La Trinidad District';
  if (!school.school_head_name) Object.assign(heading, { school_head_name: seededSchoolHead, school_head_position: 'Principal I' });
  if (Object.keys(heading).length) {
    plan.log(`The school heading: ${Object.keys(heading).join(', ')}`);
    await loader.patch('/school', { version: school.version, name: school.name, school_code: school.school_code, address: school.address, ...heading });
  }

  // An LRN for every learner seeded without one, now that every learner carries one: assigned once, through the
  // registry's own reviewed assignment, from a sequence the first seed never reached so none can collide.
  const missing: { id: string; version: number; birth_date: string; last_name: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await loader.get(`/learners?limit=100&offset=${offset}`);
    missing.push(...(page.items as { id: string; version: number; lrn: string | null; birth_date: string; last_name: string }[]).filter(l => l.lrn === null));
    if (!page.pagination?.has_more) break;
  }
  let assigned = 0, serial = 9000;
  for (const learner of missing) {
    // The year a learner of that age started Grade 1 stands in for the grade in the LRN's usual shape.
    const grade = Math.max(0, Math.min(6, 2026 - Number(learner.birth_date.slice(0, 4)) - 6));
    for (;;) {
      // An LRN some learner already holds is refused, and the next is tried; any other refusal stops the fill.
      const done = await loader.patch(`/learners/${learner.id}/lrn`, { version: learner.version, lrn: lrn(grade, serial++) })
        .then(() => true, (error: unknown) => { if (String(error).includes('ALREADY_EXISTS')) return false; throw error; });
      if (done) { assigned += 1; break; }
      if (serial > 9999) throw new Error('No free LRN left in the fill range.');
    }
  }
  if (missing.length) plan.log(`LRNs: ${assigned} learners given one`);

  // Positions and specializations the SF4 prints beside each adviser, for the synthetic staff only.
  const positions = ['Teacher I', 'Teacher II', 'Teacher III', 'Master Teacher I', 'Teacher III', 'Teacher II'];
  const specializations = ['General Education', 'English', 'Filipino', 'Mathematics', 'Science', 'ESP/Values Education', 'TLE/EPP'];
  const staff: { user_id: string; role: string; version: number; position: string | null; specialization: string | null }[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await loader.get(`/staff?limit=100&offset=${offset}`);
    staff.push(...page.items);
    if (!page.pagination?.has_more) break;
  }
  const unplaced = staff.filter(s => plan.seeded(s.user_id) && !s.position);
  if (unplaced.length) plan.log(`Positions for ${unplaced.length} synthetic staff`);
  for (const [i, s] of unplaced.entries()) {
    await loader.patch(`/staff/${s.user_id}`, s.role === 'teacher'
      ? { version: s.version, position: positions[i % positions.length], specialization: specializations[i % specializations.length] }
      : { version: s.version, position: 'Principal I', specialization: 'Educational Management' });
  }

  const year = (await loader.get('/academic-years')).items.find((y: { status: string }) => y.status === 'active');
  const periods = ((await loader.get(`/academic-years/${year.id}/periods`)).items as { id: string; ordinal: number }[]).sort((a, b) => a.ordinal - b.ordinal);
  const sections = (await loader.get(`/sections?academic_year_id=${year.id}&limit=100`)).items as { id: string; grade_level: number; name: string }[];

  // The register: every session not yet marked on a day of classes before today, in this month and the last.
  const months = [-1, 0].map(by => { const d = new Date(`${plan.today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 10); })
    .filter(m => m >= `${year.starts_on.slice(0, 7)}-01`);
  let marked = 0;
  await pool(sections, plan.parallel, async (section, index) => {
    for (const month of months) {
      const form = await loader.get(`/sections/${section.id}/forms/sf2?month_on=${month}`);
      const days = [...new Set((form.learners as { days: Record<string, { mark?: string } | string> }[])
        .flatMap(l => Object.entries(l.days).filter(([day, c]) => typeof c === 'object' && c.mark === 'unmarked' && day < plan.today).map(([day]) => day)))].sort();
      for (const day of days) {
        const sheet = await loader.get(`/sections/${section.id}/attendance?day_on=${day}&limit=100`);
        if (!sheet.recording_available) continue;
        const roll = random(index * 7919 + Number(day.replace(/-/g, '')) % 100000);
        const changes = (sheet.items as { enrollment_id: string; am: string | null; pm: string | null }[]).filter(i => i.am === null || i.pm === null).map(i => {
          const r = roll();
          const pick = r < 0.03 ? ['absent', 'absent'] : r < 0.04 ? ['present', 'absent'] : r < 0.045 ? ['absent', 'present'] : ['present', 'present'];
          return { enrollment_id: i.enrollment_id, am: i.am ?? pick[0], pm: i.pm ?? pick[1] };
        });
        if (!changes.length) continue;
        const body = { day_on: day, version: sheet.version, changes, reason };
        const preview = await loader.post(`/sections/${section.id}/attendance/preview`, body);
        await loader.post(`/sections/${section.id}/attendance/corrections`, { ...body, review_hash: preview.review_hash, reviewed: true });
        marked += changes.length;
      }
    }
  });
  plan.log(`Register: ${marked} learner-days marked`);

  // A month that is over is submitted, so the school's SF4 for it can be issued.
  for (const month of months.filter(m => { const n = new Date(`${m}T00:00:00Z`); n.setUTCMonth(n.getUTCMonth() + 1); return n.toISOString().slice(0, 10) <= plan.today; })) {
    let submitted = 0;
    await pool(sections, plan.parallel, async section => {
      const state = await loader.get(`/sections/${section.id}/attendance/months?month_on=${month}`);
      if (state.status !== 'draft') return;
      const body = { month_on: month, version: state.version, action: 'submit', reason };
      const preview = await loader.post(`/sections/${section.id}/attendance/months/preview`, body);
      if (!preview.review_hash) { plan.log(`  ${section.grade_level}-${section.name} ${month} cannot be submitted: ${JSON.stringify(preview.issues ?? preview)}`); return; }
      await loader.post(`/sections/${section.id}/attendance/months/transitions`, { ...body, review_hash: preview.review_hash, reviewed: true });
      submitted++;
    });
    plan.log(`${month.slice(0, 7)} submitted in ${submitted} more sections`);
  }

  // Report cards, every term, and an approved outcome for every learner.
  plan.log(`Report cards and outcomes for ${sections.length} sections`);
  const marks = ['AO', 'AO', 'AO', 'SO', 'SO', 'RO'];
  await pool(sections, plan.parallel, async (section, index) => {
    const next = random(index * 104729 + 31);
    const outcomes = new Map<string, string>();
    if (section.grade_level > 0) {
      const records = await loader.get(`/sections/${section.id}/report-records`);
      const learners = (records.learners as Learner[]).filter(l => l.status === 'enrolled');
      const offerings = (records.offerings as { id: string; active: boolean }[]).filter(o => o.active);
      const notes = section.grade_level === 1 ? [['can_do', canDo], ['to_improve', toImprove]] as const : section.grade_level <= 3 ? [['comment', comments]] as const : [];
      for (const [kind, bodies] of notes) {
        for (const period of periods) {
          const entries = learners.filter(l => !l.notes.some(n => n.kind === kind && n.reporting_period_id === period.id && n.body))
            .map((l, i) => ({ enrollment_id: l.enrollment_id, body: bodies[(i + period.ordinal + index) % bodies.length], version: l.notes.find(n => n.kind === kind && n.reporting_period_id === period.id)?.version ?? 0 }));
          if (entries.length) await loader.post(`/sections/${section.id}/report-notes`, { kind, reporting_period_id: period.id, entries, reason });
        }
      }
      if (section.grade_level >= 4) {
        for (const period of periods) {
          const entries = learners.filter(l => !l.values.some(v => v.reporting_period_id === period.id))
            .map(l => ({ enrollment_id: l.enrollment_id, version: 0, ratings: Object.fromEntries(['MD1', 'MD2', 'MT1', 'MT2', 'MK1', 'MB1', 'MB2'].map(code => [code, marks[Math.floor(next() * marks.length)]])) }));
          if (entries.length) await loader.post(`/sections/${section.id}/report-values`, { reporting_period_id: period.id, entries, reason });
        }
      }
      if (section.grade_level === 1) { for (const l of learners) outcomes.set(l.enrollment_id, 'promoted'); }
      else {
        // An invented ECR: each learner a level, each term near it, the subject average and the general average as an ECR rounds them.
        const level = new Map(learners.map(l => [l.enrollment_id, 75 + next() * 21]));
        const grade = (l: Learner, offering: string, period: string) => {
          const kept = l.grades.find(g => g.offering_id === offering && g.reporting_period_id === period)?.grade;
          return kept ?? Math.max(68, Math.min(99, Math.round(level.get(l.enrollment_id)! + (next() - 0.5) * 8)));
        };
        const terms = new Map<string, number>();
        for (const offering of offerings) {
          for (const period of periods) {
            const entries = learners.map(l => {
              const g = grade(l, offering.id, period.id);
              terms.set(`${l.enrollment_id}:${offering.id}:${period.id}`, g);
              return l.grades.some(x => x.offering_id === offering.id && x.reporting_period_id === period.id && x.grade !== null) ? null : { enrollment_id: l.enrollment_id, grade: g, version: l.grades.find(x => x.offering_id === offering.id && x.reporting_period_id === period.id)?.version ?? 0 };
            }).filter(Boolean);
            if (entries.length) await loader.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: period.id, entries, reason });
          }
        }
        const finals = new Map<string, number[]>();
        for (const offering of offerings) {
          const entries = learners.map(l => {
            const kept = l.grades.find(g => g.offering_id === offering.id && g.reporting_period_id === null);
            const final = kept?.grade ?? Math.round(periods.reduce((t, p) => t + terms.get(`${l.enrollment_id}:${offering.id}:${p.id}`)!, 0) / periods.length);
            finals.set(l.enrollment_id, [...(finals.get(l.enrollment_id) ?? []), final]);
            return kept?.grade !== undefined && kept?.grade !== null ? null : { enrollment_id: l.enrollment_id, grade: final, remark: final >= 75 ? 'passed' : 'failed', version: kept?.version ?? 0 };
          }).filter(Boolean);
          if (entries.length) await loader.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: null, entries, reason });
        }
        const summaries = learners.filter(l => l.summary?.general_average === null || !l.summary).map(l => {
          const list = finals.get(l.enrollment_id) ?? [];
          const average = list.length ? Math.round(list.reduce((t, g) => t + g, 0) / list.length) : null;
          return { enrollment_id: l.enrollment_id, general_average: average, remark: average === null ? null : average >= 75 ? 'passed' : 'failed', version: l.summary?.version ?? 0 };
        }).filter(s => s.general_average !== null);
        if (summaries.length) await loader.post(`/sections/${section.id}/report-summaries`, { entries: summaries, reason });
        for (const l of learners) {
          const list = finals.get(l.enrollment_id) ?? [];
          const failed = list.filter(g => g < 75).length;
          const average = list.length ? list.reduce((t, g) => t + g, 0) / list.length : 100;
          outcomes.set(l.enrollment_id, failed > 2 || average < 75 ? 'retained' : failed ? 'conditionally_promoted' : 'promoted');
        }
      }
    } else {
      const enrolled = (await loader.get(`/enrollments?section_id=${section.id}&limit=100`)).items as { id: string; status: string; record_state: string }[];
      for (const e of enrolled.filter(e => e.status === 'enrolled' && e.record_state !== 'voided')) outcomes.set(e.id, 'promoted');
    }
    const standing = (await loader.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`)).items as { enrollment_id: string; status: string; version: number }[];
    const recommend = [...outcomes].filter(([id]) => !standing.some(s => s.enrollment_id === id))
      .map(([id, action]) => ({ enrollment_id: id, action, version: 0 }));
    if (recommend.length) await loader.post(`/sections/${section.id}/promotion-recommendations`, { entries: recommend, reason });
    const now = (await loader.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`)).items as { enrollment_id: string; status: string; version: number }[];
    const decide = now.filter(s => s.status === 'recommended').map(s => ({ enrollment_id: s.enrollment_id, decision: 'approved', version: s.version }));
    if (decide.length) await loader.post(`/sections/${section.id}/promotion-decisions`, { entries: decide, reason });
  });
  plan.log('Fill finished.');
}

/**
 * Picks a seed run up where it stopped, once its register is taken: the
 * learners' traits are drawn again from the same seeds and matched to the
 * records by name, so the cards that follow agree with the attendance already
 * recorded. Every step skips what is already there, so it can run again; on
 * 13 October an unsteady connection stopped a full run after an hour of register.
 */
/** The seeded school as the database holds it, each learner matched by name to the traits it was drawn with. */
async function rebuild(plan: SeedPlan) {
  const loader = plan.as(plan.loader);
  const year = (await loader.get('/academic-years')).items.find((y: { status: string }) => y.status === 'active');
  const periods = ((await loader.get(`/academic-years/${year.id}/periods`)).items as { id: string; ordinal: number }[]).sort((a, b) => a.ordinal - b.ordinal).map(p => p.id);
  const rows = ((await loader.get(`/sections?academic_year_id=${year.id}&limit=100`)).items as { id: string; grade_level: number; name: string; adviser_user_id: string }[])
    .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name));
  const sizes = plan.scale === 'full' ? fullSizes : Object.fromEntries(Object.entries(fullSizes).map(([g, s]) => [g, s.map(() => 4)]));
  const families: Family[] = [];
  const sections: Section[] = [];
  let unmatched = 0;
  for (const row of rows) {
    const size = sizes[row.grade_level]?.[row.name.charCodeAt(0) - 65];
    if (!size) continue;
    const drawn = children(row.grade_level, size, families, row.grade_level * 1000 + row.name.charCodeAt(0));
    const enrolled = (await loader.get(`/enrollments?section_id=${row.id}&limit=100`)).items as { id: string; status: string; learner: { first_name: string; middle_name: string | null; last_name: string } | null }[];
    const taken = new Set<string>();
    const members: Member[] = [];
    for (const child of drawn) {
      const e = enrolled.find(x => !taken.has(x.id) && x.learner && x.learner.first_name === child.first && x.learner.last_name === child.last && (x.learner.middle_name ?? null) === child.middle);
      if (!e) { unmatched++; continue; }
      taken.add(e.id);
      members.push({ enrollment: e.id, child, enrolledOn: yearStart, ...(e.status === 'withdrawn' ? { leaves: { on: '0000-01-01', reason: 'transfer_out' as const, remark: '' } } : {}) });
    }
    sections.push({ id: row.id, grade: row.grade_level, name: row.name, adviser: row.adviser_user_id, members });
  }
  plan.log(`${sections.length} sections; ${sections.reduce((n, s) => n + s.members.length, 0)} learners matched to their traits, ${unmatched} not`);
  return { year, periods, sections };
}

export async function seedResume(plan: SeedPlan) {
  const loader = plan.as(plan.loader);
  const { year, periods, sections } = await rebuild(plan);

  plan.log('Monthly consolidation: June to August locked, September submitted');
  const ended = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].filter(m => { const n = new Date(`${m}T00:00:00Z`); n.setUTCMonth(n.getUTCMonth() + 1); return iso(n) <= plan.today; });
  await pool(sections, plan.parallel, async section => {
    for (const month of ended) {
      for (const action of month === '2026-09-01' ? ['submit'] as const : ['submit', 'lock'] as const) {
        const state = await loader.get(`/sections/${section.id}/attendance/months?month_on=${month}`);
        if (action === 'submit' ? state.status !== 'draft' : state.status !== 'submitted') continue;
        const body = { month_on: month, version: state.version, action, reason: action === 'submit' ? reasons.submit : reasons.lock };
        const preview = await loader.post(`/sections/${section.id}/attendance/months/preview`, body);
        if (!preview.review_hash) throw new Error(`${section.grade}-${section.name} ${month} ${action}: ${JSON.stringify(preview.issues ?? preview)}`);
        await loader.post(`/sections/${section.id}/attendance/months/transitions`, { ...body, review_hash: preview.review_hash, reviewed: true });
      }
    }
  });

  plan.log('Home-visit follow-ups for learners absent five days in a row');
  const open = new Set(((await loader.get(`/attendance-follow-ups?academic_year_id=${year.id}&status=all&limit=100`).catch(() => ({ items: [] }))).items as { enrollment_id: string }[]).map(c => c.enrollment_id));
  let opened = 0;
  for (const section of sections) {
    for (const m of section.members.filter(x => x.child.traits.streak && !x.leaves && !open.has(x.enrollment))) {
      const record = await loader.get(`/enrollments/${m.enrollment}/attendance-record`);
      const away = new Set((record.absences as { day_on: string; am: string | null; pm: string | null }[]).filter(a => a.am === 'absent' && a.pm === 'absent').map(a => a.day_on));
      const classDays = days(yearStart, plan.today).filter(d => schoolDay(d) && d < plan.today);
      let run: string[] = [], best: string[] = [];
      for (const d of classDays) { run = away.has(d) ? [...run, d] : []; if (run.length > best.length) best = run; }
      if (best.length < 5) continue;
      const body = { section_id: section.id, from: best[0], to: best[best.length - 1], category: 'absence', assignee_user_id: plan.loader, due_on: null, reason: reasons.followup };
      try {
        const preview = await loader.post(`/enrollments/${m.enrollment}/attendance-follow-ups/preview`, body);
        const made = await loader.post(`/enrollments/${m.enrollment}/attendance-follow-ups`, { ...body, review_hash: preview.review_hash, reviewed: true });
        opened++;
        if (!made || opened % 3 === 0) continue;
        const change = { version: made.case_version, action: 'resolve', assignee_user_id: plan.loader, due_on: null, reason: 'Home visited; the learner is back in class.' };
        const review = await loader.post(`/attendance-follow-ups/${made.case_id}/preview`, change);
        await loader.post(`/attendance-follow-ups/${made.case_id}/events`, { ...change, review_hash: review.review_hash, reviewed: true });
      } catch (error) { plan.log(`  follow-up skipped: ${(error as Error).message.slice(0, 120)}`); }
    }
  }
  plan.log(`  ${opened} follow-up cases`);

  plan.log('The report cards’ learning areas, offered to every graded section');
  const existing = new Map(((await loader.get('/subjects?limit=100')).items as { id: string; version: number; code: string }[]).map(s => [s.code, s]));
  for (const area of reportCardAreas) {
    if (existing.has(area.code)) continue;
    existing.set(area.code, await loader.post('/subjects', { code: area.code, name: area.name, kind: 'learning_area', grade_levels: gradesOf(area), active: true, reason: reasons.subjects })
      ?? (await loader.get('/subjects?limit=100')).items.find((x: { code: string }) => x.code === area.code));
  }
  await pool(sections.filter(s => s.grade > 0), plan.parallel, async section => {
    const offered = new Set(((await loader.get(`/sections/${section.id}/subjects`)).items as { subject_snapshot?: { code: string }; code?: string }[]).map(o => o.subject_snapshot?.code ?? o.code));
    for (const area of cardFor(section.grade).filter(a => a.code !== 'TLE')) {
      if (offered.has(area.code)) continue;
      const subject = existing.get(area.code)!;
      await loader.post(`/sections/${section.id}/subjects`, { subject_id: subject.id, subject_version: subject.version, display_order: lineOf(area, section.grade), reason: reasons.subjects });
    }
  });

  // A section whose cards were written by an earlier, stopped run is left as it is.
  const blank: Section[] = [];
  for (const section of sections) {
    if (section.grade === 0) {
      const outcomes = (await loader.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`)).items as unknown[];
      if (!outcomes.length) blank.push(section);
      continue;
    }
    const records = await loader.get(`/sections/${section.id}/report-records`);
    // An SF2 remark for a learner who left is not a card.
    if (!(records.learners as { grades: unknown[]; notes: { kind: string }[] }[]).some(l => l.grades.length || l.notes.some(n => n.kind !== 'sf2_remark'))) blank.push(section);
  }
  await seedCards(plan, blank, periods);
  await seedAttendanceRule(plan);
  await seedSiteContent(plan);
  plan.log('Seeding finished.');
  return { year: year.id, sections: sections.length };
}

/**
 * Grades recorded under the first model ran low (13 October: 17% below 75 and
 * 15% retained, where a real elementary school promotes nearly everyone). Every
 * grade, subject average, general average and outcome is recorded again from
 * the same traits under `termGrade`'s current model, as the seeded principal
 * correcting the cards against the class record, each change at the version it
 * was read at. Attendance, observed values and comments are left as they are.
 */
export async function seedRegrade(plan: SeedPlan) {
  const loader = plan.as(plan.loader);
  const why = 'Corrected after checking the cards against the class record.';
  const { year, periods, sections } = await rebuild(plan);
  const changed = { grades: 0, outcomes: 0 };
  await pool(sections.filter(s => s.grade >= 2), plan.parallel, async (section, index) => {
    const next = random(index * 7907 + 101);
    const records = await loader.get(`/sections/${section.id}/report-records`);
    const offerings = (records.offerings as { id: string; active: boolean }[]).filter(o => o.active);
    type Read = { enrollment_id: string; grades: { offering_id: string; reporting_period_id: string | null; grade: number | null; version: number }[]; summary: { version: number } | null };
    const read = new Map((records.learners as Read[]).map(l => [l.enrollment_id, l]));
    const stay = section.members.filter(m => !m.leaves && read.has(m.enrollment));
    const version = (m: Member, offering: string, period: string | null) => read.get(m.enrollment)!.grades.find(g => g.offering_id === offering && g.reporting_period_id === period)?.version ?? 0;
    const finals = new Map<string, number[]>();
    for (const offering of offerings) {
      const grades = stay.map(m => { const lean = 2.2 * normal(next); return periods.map((_, p) => termGrade(m.child.traits, lean, p + 1, next)); });
      for (const [p, period] of periods.entries()) {
        await loader.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: period, reason: why,
          entries: stay.map((m, i) => ({ enrollment_id: m.enrollment, grade: grades[i]![p]!, version: version(m, offering.id, period) })) }).catch(e => { if (!/NO_CHANGES/.test(e.message)) throw e; });
      }
      await loader.post(`/section-subjects/${offering.id}/report-grades`, { reporting_period_id: null, reason: why, entries: stay.map((m, i) => {
        const final = Math.round(grades[i]!.reduce((t, g) => t + g, 0) / periods.length);
        finals.set(m.enrollment, [...(finals.get(m.enrollment) ?? []), final]);
        return { enrollment_id: m.enrollment, grade: final, remark: final >= 75 ? 'passed' : 'failed', version: version(m, offering.id, null) };
      }) }).catch(e => { if (!/NO_CHANGES/.test(e.message)) throw e; });
      changed.grades += stay.length * (periods.length + 1);
    }
    const action = new Map<string, string>();
    await loader.post(`/sections/${section.id}/report-summaries`, { reason: why, entries: stay.map(m => {
      const list = finals.get(m.enrollment)!;
      const average = Math.round(list.reduce((t, g) => t + g, 0) / list.length);
      const failed = list.filter(g => g < 75).length;
      action.set(m.enrollment, failed > 2 || average < 75 ? 'retained' : failed ? 'conditionally_promoted' : 'promoted');
      return { enrollment_id: m.enrollment, general_average: average, remark: average >= 75 ? 'passed' : 'failed', version: read.get(m.enrollment)!.summary?.version ?? 0 };
    }) }).catch(e => { if (!/NO_CHANGES/.test(e.message)) throw e; });
    // An approved outcome changes only after it is returned: return the ones the new grades change, recommend again, approve.
    const outcomes = () => loader.get(`/academic-years/${year.id}/promotions?section_id=${section.id}`).then(r => r.items as { enrollment_id: string; action: string; status: string; version: number }[]);
    const differing = (await outcomes()).filter(o => action.has(o.enrollment_id) && o.action !== action.get(o.enrollment_id));
    if (!differing.length) return;
    const approved = differing.filter(o => o.status === 'approved');
    if (approved.length) await loader.post(`/sections/${section.id}/promotion-decisions`, { reason: why, entries: approved.map(o => ({ enrollment_id: o.enrollment_id, decision: 'returned', version: o.version })) });
    const now = new Map((await outcomes()).map(o => [o.enrollment_id, o]));
    await loader.post(`/sections/${section.id}/promotion-recommendations`, { reason: reasons.outcome,
      entries: differing.map(o => ({ enrollment_id: o.enrollment_id, action: action.get(o.enrollment_id)!, version: now.get(o.enrollment_id)!.version })) });
    const waiting = (await outcomes()).filter(o => o.status === 'recommended');
    if (waiting.length) await loader.post(`/sections/${section.id}/promotion-decisions`, { reason: reasons.approve, entries: waiting.map(o => ({ enrollment_id: o.enrollment_id, decision: 'approved', version: o.version })) });
    changed.outcomes += differing.length;
  });
  plan.log(`Regraded: ${changed.grades} grade boxes recorded again, ${changed.outcomes} outcomes changed`);
}
