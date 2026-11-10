import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The one-off transcription of the academic history the school already holds on
 * paper, and what it must and must not do to the SF10.
 *
 * The thing under test is the distinction the whole increment exists for: a
 * learner has exactly one cumulative SF10, so a transcribed year and a year
 * EDUNEXUS recorded itself have to land on the same record, in year order, and
 * a year that is already one of them must be refused as the other rather than
 * printed twice. Kindergarten is tested for what it is *not*: the SF10-ES has
 * no scholastic block for it, so it is refused as a block and recorded as the
 * credential presented for Grade 1 instead, carrying no grade.
 */

let db: TestDatabase;
let api: TestApi;

const year2026 = '00000000-0000-4000-9000-000000000001';
const sectionA = '00000000-0000-4000-9000-00000000000a';
const sectionB = '00000000-0000-4000-9000-00000000000b';
/** Ana is in Grade 3 A, which `teacher` advises. Ben is in Grade 5 B, which `otherTeacher` advises. */
const ana = '00000000-0000-4000-9001-000000000001';
const ben = '00000000-0000-4000-9001-000000000002';
const anaEnrollment = '00000000-0000-4000-9002-000000000001';
const benEnrollment = '00000000-0000-4000-9002-000000000002';

const filipino = { subject_id: null, code: 'FILIPINO', name: 'Filipino', q1: 88, q2: 89, q3: 90, q4: 91, final: 89.5, remark: 'passed' };
const english = { subject_id: null, code: 'ENGLISH', name: 'English', q1: 85, q2: 86, q3: null, q4: null, final: 85.5, remark: 'passed' };

/** A Grade 2 year of Ana's, as the school's own spreadsheet carries it. */
const grade2 = {
  start_year: 2024, grade_level: 2, school_name: 'Balili Elementary School', school_code: '135617',
  school_address: 'Balili, La Trinidad, Benguet', section_name: 'Sampaguita', adviser_name: 'A. Dela Cruz',
  general_average: 89.5, remark: 'passed', source: 'Adviser class record spreadsheet 2024-2025, received 2026-11-03',
};
const reason = 'Initial historical encoding from the school spreadsheet';

const encode = (learner: string, token: string, year: Record<string, unknown>, subjects: unknown[] = [filipino, english]) =>
  api.post(`/api/v1/learners/${learner}/prior-years`, token, { year, subjects, reason });

/** Whatever `read_learner_prior_records` answers with, for the caller given. */
const read = async (learner: string, token: string) => (await api.get(`/api/v1/learners/${learner}/prior-records`, token)).data as {
  may_write: boolean; prior_years: { id: string; start_year: number; grade_level: number; version: number; subjects: unknown[] }[];
  recorded_years: { start_year: number; grade_level: number }[]; eligibility: { credential: string } | null;
};

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  // The forms read their heading from the school profile, so there has to be one.
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
    ($1,$2,$3,3,$4,'2026-06-01','2026-06-01','regular'),($5,$6,$3,5,$7,'2026-06-01','2026-06-01','regular')`,
    [anaEnrollment, ana, year2026, sectionA, benEnrollment, ben, sectionB]);
});
afterAll(async () => { await db.database.close(); });

describe('encoding a previous school year', () => {
  it('puts the year on the learner’s own permanent record, with its learning areas as entered', async () => {
    const made = await encode(ana, tokens.principal, grade2);
    expect(made.status).toBe(201);
    expect(made.data.start_year).toBe(2024);
    expect(made.data.grade_level).toBe(2);
    // The general average is the document's own number, carried as entered.
    expect(Number(made.data.general_average)).toBe(89.5);
    const subjects = made.data.subjects as { name: string; q1: number | null; q3: number | null }[];
    expect(subjects.map(s => s.name)).toEqual(['Filipino', 'English']);
    // A quarter the document does not carry stays empty. It is never a zero.
    expect(subjects[1]!.q3).toBeNull();
  });

  it('refuses a school year EDUNEXUS already holds, and says where its grades are entered', async () => {
    const clash = await encode(ana, tokens.principal, { ...grade2, start_year: 2026, grade_level: 3 });
    expect(clash.status).toBe(409);
    expect(clash.code).toBe('PRIOR_YEAR_IN_SYSTEM');
    expect(clash.message).toMatch(/Promotion/);
  });

  it('refuses a Kindergarten scholastic block, because the form has none, and names the eligibility block instead', async () => {
    const kinder = await encode(ana, tokens.principal, { ...grade2, start_year: 2022, grade_level: 0 });
    expect(kinder.status).toBe(422);
    // The contract catches it first, so the refusal has to read properly there too.
    expect(kinder.fields.map(f => f.path)).toContain('year.grade_level');
    expect(kinder.fields.find(f => f.path === 'year.grade_level')!.message).toMatch(/Kindergarten/);

    // And the database refuses it on its own, for a caller that never met the
    // contract: the backend is the authority, not the form in front of it.
    await expect(db.pg.query(`select edunexus.write_learner_prior_year(null,0,$1,$2,$3,$4)`,
      [ana, JSON.stringify({ ...grade2, start_year: 2022, grade_level: 0 }), JSON.stringify([filipino]), reason]))
      .rejects.toMatchObject({ code: 'P2504' });
  });

  it('refuses the same learning area twice in one year, however it was capitalised', async () => {
    const twice = await encode(ana, tokens.principal, { ...grade2, start_year: 2023, grade_level: 1 },
      [filipino, { ...filipino, name: 'filipino' }]);
    expect(twice.status).toBe(409);
    expect(twice.code).toBe('PRIOR_SUBJECT_DUPLICATE');
  });

  it('refuses a second block for a school year already encoded', async () => {
    const again = await encode(ana, tokens.principal, grade2);
    expect(again.status).toBe(409);
    // Either the explicit guard or its unique index; both say the year is taken.
    expect(again.message).toMatch(/already/i);
  });

  it('refuses a year with no learning area at all', async () => {
    const empty = await encode(ana, tokens.principal, { ...grade2, start_year: 2023, grade_level: 1 }, []);
    expect(empty.status).toBe(422);
  });

  it('refuses a grade above 100 and a third decimal place, as the ECR entry does', async () => {
    const over = await encode(ana, tokens.principal, { ...grade2, start_year: 2023, grade_level: 1 }, [{ ...filipino, final: 101 }]);
    expect(over.status).toBe(422);
    const third = await encode(ana, tokens.principal, { ...grade2, start_year: 2023, grade_level: 1 }, [{ ...filipino, final: 88.255 }]);
    expect(third.status).toBe(422);
  });
});

describe('correcting and removing a transcribed year', () => {
  it('refuses a save at a version that is no longer current', async () => {
    const [block] = (await read(ana, tokens.principal)).prior_years;
    const stale = await api.patch(`/api/v1/prior-years/${block!.id}`, tokens.principal,
      { version: block!.version + 5, year: grade2, subjects: [filipino, english], reason: 'Correcting at a stale version on purpose' });
    expect(stale.status).toBe(409);
    expect(stale.code).toBe('VERSION_CONFLICT');
  });

  it('refuses a save that changes nothing', async () => {
    const [block] = (await read(ana, tokens.principal)).prior_years;
    const same = await api.patch(`/api/v1/prior-years/${block!.id}`, tokens.principal,
      { version: block!.version, year: grade2, subjects: [filipino, english], reason: 'Saving the identical block again on purpose' });
    expect(same.status).toBe(409);
    expect(same.code).toBe('PRIOR_NO_CHANGES');
  });

  it('pages the journal newest first by number, not by the text of its id', async () => {
    /*
     * The trap this guards is one line of SQL. The journal selects `id::text`
     * so a bigint survives JSON, and that gives the output column the name
     * `id`; a bare `id` in ORDER BY binds to the *output* column before the
     * input one, so the identity column sorts as text. Row "9" then outranks
     * row "10" and the newest entries never reach the first page, while the
     * cursor taken from that page skips whatever it missed.
     *
     * It needs more than nine rows to show at all, which is why it has a test
     * of its own rather than being left to the cases above.
     */
    const iris = '00000000-0000-4000-9001-000000000011';
    await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
      values($1,'Iris','Sacla','female','2016-06-06','136170000011')`, [iris]);
    // Twelve journal entries: one create, then eleven corrections of it.
    const made = await encode(iris, tokens.principal, { ...grade2, start_year: 2020, grade_level: 1 }, [filipino]);
    let version = Number(made.data.version);
    for (let n = 0; n < 11; n += 1) {
      const saved = await api.patch(`/api/v1/prior-years/${String(made.data.id)}`, tokens.principal, {
        version, year: { ...grade2, start_year: 2020, grade_level: 1, general_average: 70 + n }, subjects: [filipino],
        reason: `Correcting the general average against the document, pass ${n + 1}`,
      });
      expect(saved.status, `correction ${n + 1}`).toBe(200);
      version = Number(saved.data.version);
    }

    const page = (await api.get(`/api/v1/learners/${iris}/prior-record-events?limit=10`, tokens.principal)).data as {
      items: { id: string }[]; pagination: { next_before_id: string | null };
    };
    const numbers = page.items.map(i => Number(i.id));
    expect(numbers).toHaveLength(10);
    // Strictly descending, and the newest entry really is the highest id.
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    const [highest] = await db.pg.query<{ max: string }>(
      `select max(id)::text as max from edunexus.learner_prior_record_events where learner_id=$1`, [iris]);
    expect(numbers[0]).toBe(Number(highest!.max));
    // Nothing above the cursor is left behind: the next page continues below it.
    expect(Number(page.pagination.next_before_id)).toBe(numbers[9]);
    const next = (await api.get(`/api/v1/learners/${iris}/prior-record-events?limit=10&before_id=${page.pagination.next_before_id}`, tokens.principal)).data as {
      items: { id: string }[];
    };
    const rest = next.items.map(i => Number(i.id));
    expect(rest.every(n => n < numbers[9]!)).toBe(true);
    // Twelve entries in all, and the two pages account for every one of them.
    expect(new Set([...numbers, ...rest]).size).toBe(12);
  });

  it('records a correction and keeps what the block said before, in the journal', async () => {
    const [block] = (await read(ana, tokens.principal)).prior_years;
    const fixed = await api.patch(`/api/v1/prior-years/${block!.id}`, tokens.principal,
      { version: block!.version, year: { ...grade2, general_average: 90.25 }, subjects: [filipino, english], reason: 'Correcting the average against the signed form' });
    expect(fixed.status).toBe(200);
    expect(Number(fixed.data.general_average)).toBe(90.25);
    const journal = await api.get(`/api/v1/learners/${ana}/prior-record-events`, tokens.principal);
    const items = journal.data.items as { action: string; before_snapshot: { general_average: string } | null; after_snapshot: { general_average: string } }[];
    expect(items[0]!.action).toBe('update');
    expect(Number(items[0]!.before_snapshot!.general_average)).toBe(89.5);
    expect(Number(items[0]!.after_snapshot.general_average)).toBe(90.25);
  });

  it('takes the learning areas with a removed block, and rolls the whole change back if the journal cannot be written', async () => {
    const made = await encode(ana, tokens.principal, { ...grade2, start_year: 2021, grade_level: 1 }, [filipino]);
    const id = String(made.data.id);
    // The journal's request id is not null, so a write with none fails at the
    // journal and nothing else of the change may survive it.
    await db.pg.query(`select set_config('edunexus.request_id','',false)`);
    await expect(db.pg.query(`select edunexus.delete_learner_prior_year($1,$2,$3)`,
      [id, Number(made.data.version), 'Removing a block while the journal cannot be written'])).rejects.toThrow();
    await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
    expect((await db.pg.query(`select 1 from edunexus.learner_prior_years where id=$1`, [id])).length).toBe(1);

    const gone = await api.post(`/api/v1/prior-years/${id}/removal`, tokens.principal,
      { version: Number(made.data.version), reason: 'Removing a block encoded from the wrong document' });
    expect(gone.status).toBe(201);
    expect((await db.pg.query(`select 1 from edunexus.learner_prior_years where id=$1`, [id])).length).toBe(0);
    expect((await db.pg.query(`select 1 from edunexus.learner_prior_grades where prior_year_id=$1`, [id])).length).toBe(0);
    // What it said is kept, which is the point of removing it through a writer.
    expect((await db.pg.query(`select 1 from edunexus.learner_prior_record_events where prior_year_id=$1 and action='delete'`, [id])).length).toBe(1);
  });
});

describe('who may encode', () => {
  it('lets an adviser encode for a learner currently in their own section', async () => {
    const mine = await encode(ana, tokens.teacher, { ...grade2, start_year: 2023, grade_level: 1, general_average: 87 }, [filipino]);
    expect(mine.status).toBe(201);
    expect((await read(ana, tokens.teacher)).may_write).toBe(true);
  });

  it('lets an adviser encode several previous grade levels, not only the grade they teach', async () => {
    // `teacher` advises Grade 3 A. The point of the arrangement is that they
    // hold the documents for their class's *earlier* years, so nothing here may
    // tie the grade of a transcribed year to the grade the adviser teaches.
    const dina = '00000000-0000-4000-9001-000000000004';
    await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
      values($1,'Dina','Olmedo','female','2017-01-20','136170000004')`, [dina]);
    await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
      values('00000000-0000-4000-9002-000000000004',$1,$2,3,$3,'2026-06-01','2026-06-01','regular')`, [dina, year2026, sectionA]);

    for (const [startYear, grade] of [[2023, 1], [2024, 2]] as const) {
      const made = await encode(dina, tokens.teacher, { ...grade2, start_year: startYear, grade_level: grade }, [filipino, english]);
      expect(made.status, `Grade ${grade}`).toBe(201);
    }
    const history = await read(dina, tokens.teacher);
    expect(history.prior_years.map(y => [y.start_year, y.grade_level])).toEqual([[2023, 1], [2024, 2]]);
  });

  it('refuses an adviser another adviser’s learner, over HTTP and in SQL alike', async () => {
    const theirs = await encode(ben, tokens.teacher, { ...grade2, start_year: 2023, grade_level: 4 }, [filipino]);
    // Not found rather than forbidden: a teacher is not told which learners exist.
    expect(theirs.status).toBe(404);
    expect((await api.get(`/api/v1/learners/${ben}/prior-records`, tokens.teacher)).status).toBe(404);

    // The same boundary under the row policy, not only in the service: every
    // row this adviser can read belongs to a learner in a section they advise,
    // and Ben, who is in another adviser's, is not among them.
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.teacher]);
    const seen = await db.database.transaction(async tx => tx.query(`select learner_id from edunexus.learner_prior_years`));
    const mine = await db.pg.query<{ learner_id: string }>(
      `select distinct e.learner_id from edunexus.enrollments e join edunexus.sections s on s.id=e.section_id where s.adviser_user_id=$1`, [ids.teacher]);
    expect(new Set(seen.map(r => String(r.learner_id)))).toEqual(
      new Set(mine.map(r => String(r.learner_id)).filter(id => seen.some(s => String(s.learner_id) === id))));
    expect(seen.map(r => String(r.learner_id))).not.toContain(ben);
    expect(seen.map(r => String(r.learner_id))).toContain(ana);
    const [allowed] = await db.pg.query<{ ana: boolean; ben: boolean }>(
      `select edunexus.may_write_prior_records($1) ana, edunexus.may_write_prior_records($2) ben`, [ana, ben]);
    expect(allowed).toEqual({ ana: true, ben: false });
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  });

  it('lets a manager read and encode for any learner', async () => {
    expect((await read(ben, tokens.principal)).may_write).toBe(true);
    expect((await encode(ben, tokens.officer, { ...grade2, start_year: 2023, grade_level: 4 }, [filipino])).status).toBe(201);
  });
});

describe('the credential presented for Grade 1', () => {
  it('records a Kindergarten credential, and carries no grade', async () => {
    const saved = await api.patch(`/api/v1/learners/${ana}/eligibility`, tokens.principal, {
      version: 0, credential: 'kinder_progress_report', school_name: 'Balili Elementary School', school_code: '135617',
      source: 'Kinder progress report on file, checked 2026-11-03', reason: 'Encoding the credential presented for Grade 1',
    });
    expect(saved.status).toBe(200);
    expect(saved.data.credential).toBe('kinder_progress_report');
    // Nothing on this record is a grade, and nothing on it can become one.
    expect(Object.keys(saved.data)).not.toContain('general_average');
  });

  it('refuses a PEPT rating against a credential that is not a PEPT', async () => {
    const wrong = await api.patch(`/api/v1/learners/${ben}/eligibility`, tokens.principal, {
      version: 0, credential: 'eccd_checklist', pept_rating: '84',
      source: 'ECCD checklist on file, checked 2026-11-03', reason: 'Encoding a rating against the wrong credential',
    });
    expect(wrong.status).toBe(422);
    expect(wrong.code).toBe('PRIOR_CREDENTIAL_FIELDS');
  });
});

describe('the SF10 the whole thing exists for', () => {
  it('is one cumulative record: transcribed years and recorded years in one series, each year once', async () => {
    const sf10 = (await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.principal)).data as {
      blocks: { origin: string; grade_level: number; school_year: { start_year: number }; school: { name: string; district: string | null };
        subjects: { name: string; terms: Record<string, number | null> }[]; general_average: { value: number | null } }[];
      eligibility: { credential: string } | null; last_school_year: number; eligible_grade: number | null;
    };
    // Grade 1 (2023) and Grade 2 (2024) transcribed, Grade 3 (2026) recorded.
    expect(sf10.blocks.map(b => [b.school_year.start_year, b.grade_level, b.origin]))
      .toEqual([[2023, 1, 'encoded'], [2024, 2, 'encoded'], [2026, 3, 'register']]);
    // One block per year: no year appears twice, which is the fault this guards.
    expect(new Set(sf10.blocks.map(b => b.school_year.start_year)).size).toBe(sf10.blocks.length);
    // A transcribed block reads its quarters as the four the form rules.
    const g2 = sf10.blocks.find(b => b.grade_level === 2)!;
    expect(g2.subjects.map(s => s.name)).toEqual(['Filipino', 'English']);
    expect(g2.subjects[0]!.terms['1']).toBe(88);
    expect(Number(g2.general_average.value)).toBe(90.25);
    // Its school heading is its own, and the district is filled because the
    // school ID says this is this school.
    expect(g2.school.name).toBe('Balili Elementary School');
    expect(g2.school.district).toBe('La Trinidad');
    // Kindergarten is on the record as the credential, never as a block.
    expect(sf10.eligibility?.credential).toBe('kinder_progress_report');
    expect(sf10.blocks.some(b => b.grade_level === 0)).toBe(false);
    expect(sf10.last_school_year).toBe(2026);
  });

  it('leaves a previous school’s district, division and region blank rather than filling in this school’s', async () => {
    const elsewhere = await encode(ben, tokens.principal,
      { ...grade2, start_year: 2022, grade_level: 3, school_name: 'Mankayan Central School', school_code: '135642' }, [filipino]);
    expect(elsewhere.status).toBe(201);
    const sf10 = (await api.get(`/api/v1/learners/${ben}/forms/sf10`, tokens.principal)).data as {
      blocks: { school_year: { start_year: number }; school: { name: string; school_code: string | null; district: string | null; division: string | null; region: string | null } }[];
    };
    const other = sf10.blocks.find(b => b.school_year.start_year === 2022)!;
    expect(other.school.name).toBe('Mankayan Central School');
    expect(other.school.school_code).toBe('135642');
    expect([other.school.district, other.school.division, other.school.region]).toEqual([null, null, null]);
  });

  it('gives no eligible grade from a transcription: only an approved outcome decides one', async () => {
    const sf10 = (await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.principal)).data as {
      blocks: { origin: string; outcome: { action: string | null; eligible_grade: number | null } }[]; eligible_grade: number | null;
    };
    for (const block of sf10.blocks.filter(b => b.origin === 'encoded')) {
      expect(block.outcome).toEqual({ action: null, eligible_grade: null });
    }
    // Ana's Grade 3 has no approved promotion decision, so the certification names no grade.
    expect(sf10.eligible_grade).toBeNull();
  });

  it('keeps a learner who is enrolled at a grade but not yet in a class on their own record', async () => {
    // 0048 made the section optional; read_sf10_source still inner-joined
    // `sections`, so this learner's whole permanent record silently vanished.
    const cris = '00000000-0000-4000-9001-000000000003';
    await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
      values($1,'Cris','Bugnay','male','2016-07-09','136170000003')`, [cris]);
    await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
      values('00000000-0000-4000-9002-000000000003',$1,$2,4,null,'2026-06-01','2026-06-01','regular')`, [cris, year2026]);

    const sf10 = (await api.get(`/api/v1/learners/${cris}/forms/sf10`, tokens.principal)).data as {
      blocks: { grade_level: number; section_name: string | null; origin: string }[];
    };
    expect(sf10.blocks).toHaveLength(1);
    expect(sf10.blocks[0]).toMatchObject({ grade_level: 4, origin: 'register' });
    // The class they have not been put in is an absent record, not a blank.
    expect(sf10.blocks[0]!.section_name).toBeNull();
  });

  /**
   * Kindergarten, as DepEd's SF10-ES actually structures it: the credential that
   * admits a learner to Grade 1, in the eligibility block, and never a
   * scholastic block of its own. So the SF10 begins at Grade 1, and a learner
   * still in Kindergarten does not have one — their records are the SF5-K and
   * the ECCD checklist, which EDUNEXUS neither holds nor replaces.
   */
  describe('Kindergarten', () => {
    const kai = '00000000-0000-4000-9001-000000000005';
    const sectionK = '00000000-0000-4000-9000-0000000000c0';

    beforeAll(async () => {
      await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,0,'Kinder A',$3)`,
        [sectionK, year2026, ids.teacher]);
      await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
        values($1,'Kai','Pucay','male','2021-02-02','136170000005')`, [kai]);
      await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
        values('00000000-0000-4000-9002-000000000005',$1,$2,0,$3,'2026-06-01','2026-06-01','regular')`, [kai, year2026, sectionK]);
    });

    it('gives a learner still in Kindergarten no SF10 at all, and says what their records are instead', async () => {
      const got = await api.get(`/api/v1/learners/${kai}/forms/sf10`, tokens.principal);
      expect(got.status).toBe(409);
      expect(got.code).toBe('SF10_NOT_YET');
      expect(got.message).toMatch(/begins when a learner enters Grade 1/);
      // Their own records are named, so nobody reads this as a missing record.
      expect(got.message).toMatch(/SF5-K/);
      expect(got.message).toMatch(/ECCD checklist/);
      // And it cannot be issued either, so no blank permanent record gets a serial.
      expect((await api.post(`/api/v1/learners/${kai}/forms/sf10/issuances`, tokens.principal, {})).code).toBe('SF10_NOT_YET');
    });

    it('still lets their Kindergarten year be read as a Kindergarten record, untouched', async () => {
      // EDUNEXUS holds the enrolment; the screen reads it and offers nothing to
      // encode. Nothing here removes or supersedes it.
      const history = await read(kai, tokens.teacher);
      expect(history.recorded_years.map(y => y.grade_level)).toEqual([0]);
      expect(history.prior_years).toEqual([]);
    });

    it('gives a Grade 1 learner the credential in the eligibility block and a Grade 1 scholastic record', async () => {
      const noel = '00000000-0000-4000-9001-000000000006';
      await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
        values($1,'Noel','Camdas','male','2020-04-04','136170000006')`, [noel]);
      const sectionG1 = '00000000-0000-4000-9000-0000000000c1';
      await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,1,'Masigla',$3)`,
        [sectionG1, year2026, ids.teacher]);
      await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
        values('00000000-0000-4000-9002-000000000006',$1,$2,1,$3,'2026-06-01','2026-06-01','regular')`, [noel, year2026, sectionG1]);
      await api.patch(`/api/v1/learners/${noel}/eligibility`, tokens.principal, {
        version: 0, credential: 'kindergarten_certificate', school_name: 'Balili Elementary School', school_code: '135617',
        source: 'Kindergarten certificate of completion presented at registration',
        reason: 'Encoding the credential presented for Grade 1 at registration',
      });
      const sf10 = (await api.get(`/api/v1/learners/${noel}/forms/sf10`, tokens.principal)).data as {
        blocks: { grade_level: number; origin: string }[]; eligibility: { credential: string } | null;
      };
      expect(sf10.eligibility?.credential).toBe('kindergarten_certificate');
      // One block, Grade 1. Kinder is not among them, and was not turned into Grade 1.
      expect(sf10.blocks.map(b => [b.grade_level, b.origin])).toEqual([[1, 'register']]);
    });
  });

  it('carries a Grade 6 learner’s transcribed Grades 1 to 5 and their current Grade 6', async () => {
    const elsa = '00000000-0000-4000-9001-000000000007';
    const sectionG6 = '00000000-0000-4000-9000-0000000000c6';
    await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,6,'Matatag',$3)`,
      [sectionG6, year2026, ids.otherTeacher]);
    await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
      values($1,'Elsa','Bandao','female','2014-09-09','136170000007')`, [elsa]);
    await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
      values('00000000-0000-4000-9002-000000000007',$1,$2,6,$3,'2026-06-01','2026-06-01','regular')`, [elsa, year2026, sectionG6]);
    for (const grade of [1, 2, 3, 4, 5]) {
      const made = await encode(elsa, tokens.principal, { ...grade2, start_year: 2020 + grade, grade_level: grade }, [filipino, english]);
      expect(made.status, `Grade ${grade}`).toBe(201);
    }
    const sf10 = (await api.get(`/api/v1/learners/${elsa}/forms/sf10`, tokens.principal)).data as {
      blocks: { grade_level: number; origin: string; school_year: { start_year: number } }[];
    };
    expect(sf10.blocks.map(b => [b.school_year.start_year, b.grade_level, b.origin])).toEqual([
      [2021, 1, 'encoded'], [2022, 2, 'encoded'], [2023, 3, 'encoded'], [2024, 4, 'encoded'], [2025, 5, 'encoded'], [2026, 6, 'register'],
    ]);
  });

  it('adds next year to the same record without duplicating a year already on it', async () => {
    // What happens from the second school year onwards: nothing is encoded
    // again, and the record grows by one block rather than becoming a new one.
    const before = (await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.principal)).data as { blocks: { school_year: { start_year: number } }[] };
    const year2027 = '00000000-0000-4000-9000-000000000002';
    await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2027,'2027-06-01','2028-03-31','draft')`, [year2027]);
    const sectionNext = '00000000-0000-4000-9000-0000000000c4';
    await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,4,'Rosal',$3)`,
      [sectionNext, year2027, ids.teacher]);
    await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
      values('00000000-0000-4000-9002-000000000008',$1,$2,4,$3,'2027-06-01','2027-06-01','regular')`, [ana, year2027, sectionNext]);

    const after = (await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.principal)).data as {
      blocks: { grade_level: number; origin: string; school_year: { start_year: number } }[]; last_school_year: number;
    };
    expect(after.blocks).toHaveLength(before.blocks.length + 1);
    // Every earlier year is still there, once each, and in order.
    const years = after.blocks.map(b => b.school_year.start_year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(years.length);
    expect(after.blocks.at(-1)).toMatchObject({ grade_level: 4, origin: 'register' });
    expect(after.last_school_year).toBe(2027);
    // A year EDUNEXUS holds cannot be transcribed on top of itself, which is
    // what keeps the record from gaining a second copy of a year it already has.
    expect((await encode(ana, tokens.principal, { ...grade2, start_year: 2026, grade_level: 3 })).code).toBe('PRIOR_YEAR_IN_SYSTEM');
    // Next year itself is refused for a different reason, and the right one: a
    // school year that has not begun has no document to copy.
    expect((await encode(ana, tokens.principal, { ...grade2, start_year: 2027, grade_level: 4 })).code).toBe('PRIOR_YEAR_RANGE');
  });

  /**
   * The outward join to `sections`, and whether letting an unplaced enrollment
   * through can also let a *duplicate* through.
   *
   * It cannot, and the reason is worth writing down rather than testing once:
   * the join is on `sections.id`, the primary key, so it matches at most one
   * row. An inner join on a primary key can only ever drop rows; making it
   * outward can only ever keep one. Neither can multiply. What decides how many
   * blocks a learner gets is the enrollment rows themselves, so that is what
   * these check.
   */
  describe('one block per school year, with the outward join', () => {
    const fred = '00000000-0000-4000-9001-000000000008';
    const years: Record<number, string> = {
      2022: '00000000-0000-4000-9000-000000000022',
      2023: '00000000-0000-4000-9000-000000000023',
      2024: '00000000-0000-4000-9000-000000000024',
    };

    beforeAll(async () => {
      for (const [start, id] of Object.entries(years)) {
        await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,$2,$3,$4,'draft')`,
          [id, Number(start), `${start}-06-01`, `${Number(start) + 1}-03-31`]);
      }
      const placed = '00000000-0000-4000-9000-0000000000f1';
      await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,1,'Aguho',$3)`,
        [placed, years[2022], ids.teacher]);
      await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
        values($1,'Fred','Tiwaken','male','2015-11-11','136170000008')`, [fred]);
      // 2022 placed in a section; 2023 enrolled at a grade with no section at
      // all; 2024 placed, plus a voided enrollment in the same year.
      await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
        values('00000000-0000-4000-9002-0000000000f1',$1,$2,1,$3,'2022-06-01','2022-06-01','regular')`, [fred, years[2022], placed]);
      await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
        values('00000000-0000-4000-9002-0000000000f2',$1,$2,2,null,'2023-06-01','2023-06-01','regular')`, [fred, years[2023]]);
      const placed24 = '00000000-0000-4000-9000-0000000000f4';
      await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,3,'Balete',$3)`,
        [placed24, years[2024], ids.teacher]);
      await db.pg.query(`insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
        values('00000000-0000-4000-9002-0000000000f3',$1,$2,3,$3,'2024-06-01','2024-06-01','regular')`, [fred, years[2024], placed24]);
      /*
       * No voided row in this fixture, deliberately. Three guards in 0008 stand
       * between a test and one: a row cannot be created voided ("create a valid
       * record first"), a second row cannot be added to a year that already has
       * a valid one, and voiding needs a matching reviewed command in the same
       * transaction. Reaching that state is the enrollment-review workflow's own
       * subject, and `read_sf10_source`'s `record_state='valid'` filter predates
       * this change and is untouched by it.
       */
    });

    it('adds no row: the join is on the sections primary key, so it matches at most one', async () => {
      const [counts] = await db.pg.query<{ plain: string; joined: string }>(
        `select (select count(*) from edunexus.enrollments e where e.learner_id=$1 and e.record_state='valid') plain,
                (select count(*) from edunexus.enrollments e left join edunexus.sections s on s.id=e.section_id
                   where e.learner_id=$1 and e.record_state='valid') joined`, [fred]);
      expect(Number(counts!.joined)).toBe(Number(counts!.plain));
    });

    it('gives exactly one block per valid enrollment, placed and unplaced alike', async () => {
      const sf10 = (await api.get(`/api/v1/learners/${fred}/forms/sf10`, tokens.principal)).data as {
        blocks: { grade_level: number; section_name: string | null; school_year: { start_year: number } }[];
      };
      // Three valid enrollments, three blocks: the unplaced 2023 one is kept by
      // the outward join, and neither of the placed ones is doubled by it.
      expect(sf10.blocks.map(b => [b.school_year.start_year, b.grade_level, b.section_name])).toEqual([
        [2022, 1, 'Aguho'], [2023, 2, null], [2024, 3, 'Balete'],
      ]);
      const valid = await db.pg.query(`select 1 from edunexus.enrollments where learner_id=$1 and record_state='valid'`, [fred]);
      expect(sf10.blocks).toHaveLength(valid.length);
      // And no school year appears twice.
      const pairs = sf10.blocks.map(b => `${b.school_year.start_year}/${b.grade_level}`);
      expect(new Set(pairs).size).toBe(pairs.length);
    });

    it('cannot be given a second enrollment in a school year it already holds', async () => {
      // This is what actually decides whether a year can appear twice, and it
      // sits upstream of the join: a unique index on (learner, year) where the
      // record is valid, and a trigger that refuses a second row outright.
      await expect(db.pg.query(
        `insert into edunexus.enrollments(id,learner_id,academic_year_id,grade_level,section_id,enrolled_on,effective_on,last_reason)
         values('00000000-0000-4000-9002-0000000000f7',$1,$2,2,null,'2023-06-01','2023-06-01','regular')`, [fred, years[2023]]))
        .rejects.toThrow(/already/i);
      const [count] = await db.pg.query<{ n: string }>(
        `select count(*) n from edunexus.enrollments where learner_id=$1 and academic_year_id=$2 and record_state='valid'`, [fred, years[2023]]);
      expect(Number(count!.n)).toBe(1);
    });

    it('cannot have two profiles linked into one outside the reviewed workflow', async () => {
      /*
       * The only remaining way two enrollments could meet in one school year is
       * across two profiles later found to be the same child, because the read
       * gathers from the kept profile and everything linked into it.
       *
       * That state cannot be fabricated: `merged_into` refuses to move without
       * a matching reviewed identity command in the same transaction, and the
       * reconciliation workflow that issues one carries its own conflict checks
       * (`P0200`). So the duplicate-year case the join was suspected of
       * producing cannot be reached from either direction.
       */
      const ghost = '00000000-0000-4000-9001-000000000009';
      await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
        values($1,'Fredd','Tiwaken','male','2015-11-11','136170000018')`, [ghost]);
      await expect(db.pg.query(`update edunexus.learners set merged_into=$2 where id=$1`, [ghost, fred]))
        .rejects.toThrow(/Reviewed identity command required/);
      // Still two separate records, each with its own, and neither doubled.
      expect((await db.pg.query(`select 1 from edunexus.learners where merged_into is not null`)).length).toBe(0);
    });
  });

  /**
   * What the privacy log actually holds for an SF10 read: which learner, and
   * which member of staff — not merely that an SF10 was looked at.
   */
  describe('the privacy access log', () => {
    const latest = async (resource: string) => (await db.pg.query<{ actor_user_id: string; record_ids: string[]; resource: string; request_id: string }>(
      `select actor_user_id,record_ids,resource,request_id from edunexus.record_access_events where resource=$1 order by id desc limit 1`, [resource]))[0]!;

    it('names the learner, their enrollments and the member of staff who read it', async () => {
      await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.teacher);
      const row = await latest('sf10Get');
      expect(row.resource).toBe('sf10Get');
      // Who read it, by their own staff id.
      expect(row.actor_user_id).toBe(ids.teacher);
      // Which learner, by their permanent id, and the enrollments shown with them.
      expect(row.record_ids).toContain(ana);
      expect(row.record_ids).toContain(anaEnrollment);
      expect(row.request_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('records the reader, so two members of staff reading the same record are told apart', async () => {
      await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.principal);
      expect((await latest('sf10Get')).actor_user_id).toBe(ids.principal);
      await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.officer);
      expect((await latest('sf10Get')).actor_user_id).toBe(ids.officer);
    });

    it('still names the learner when the record is nothing but transcribed years', async () => {
      // The case learner-based logging exists for: no enrollment anywhere, so
      // there is no enrollment id to log, and an audit row naming nothing would
      // be the one gap in it.
      const gina = '00000000-0000-4000-9001-000000000010';
      await db.pg.query(`insert into edunexus.learners(id,first_name,last_name,sex,birth_date,lrn)
        values($1,'Gina','Alos','female','2014-03-03','136170000010')`, [gina]);
      expect((await encode(gina, tokens.principal, { ...grade2, start_year: 2021, grade_level: 5 }, [filipino])).status).toBe(201);

      const sf10 = (await api.get(`/api/v1/learners/${gina}/forms/sf10`, tokens.principal)).data as {
        blocks: { origin: string; enrollment_id: string | null }[];
      };
      expect(sf10.blocks).toHaveLength(1);
      expect(sf10.blocks[0]).toMatchObject({ origin: 'encoded', enrollment_id: null });

      const row = await latest('sf10Get');
      expect(row.actor_user_id).toBe(ids.principal);
      // Exactly the learner, and nothing else, because there is nothing else to name.
      expect(row.record_ids).toEqual([gina]);
    });

    it('names the learner and the writer on an encoding write too, not only on a read', async () => {
      const made = await encode(ana, tokens.teacher, { ...grade2, start_year: 2019, grade_level: 1 }, [filipino]);
      expect(made.status).toBe(201);
      const row = await latest('priorRecordsWrite');
      expect(row.record_ids).toEqual([ana]);
      expect(row.actor_user_id).toBe(ids.teacher);
    });
  });

  it('names the learner and every enrollment it showed in the privacy access log', async () => {
    const before = (await db.pg.query(`select 1 from edunexus.record_access_events where resource='sf10Get'`)).length;
    await api.get(`/api/v1/learners/${ana}/forms/sf10`, tokens.principal);
    const rows = await db.pg.query<{ record_ids: string[] }>(`select record_ids from edunexus.record_access_events where resource='sf10Get' order by id desc limit 1`);
    expect((await db.pg.query(`select 1 from edunexus.record_access_events where resource='sf10Get'`)).length).toBe(before + 1);
    // The learner is named even though two of the three blocks have no enrollment.
    expect(rows[0]!.record_ids).toContain(ana);
    expect(rows[0]!.record_ids).toContain(anaEnrollment);
  });
});
