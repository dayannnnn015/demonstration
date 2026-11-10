import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { testApi, tokens, type TestApi } from './helpers/http.js';

/**
 * The notification substrate and the roster-submission emitters (0057).
 *
 * Notifications reverse two settled decisions, so most of these cases are about
 * what the reversal did **not** licence. An inbox is personal, so being a
 * manager grants nothing here — the one table in the system where that is true.
 * No notification names a learner, and the database refuses an unlisted payload
 * key rather than trusting whoever writes the next emitter. Nothing but a
 * security-definer writer can send one: the API's own login cannot. And the
 * unread count, which a bell asks for repeatedly, writes no privacy access row.
 *
 * The emitters themselves are asserted through the real roster workflow rather
 * than by calling `notify` directly, because the property worth proving is that
 * a notification lands in the same transaction as the change it reports.
 */

let db: TestDatabase;
let api: TestApi;
const year2026 = '00000000-0000-4000-9000-000000000001';
/**
 * Masigla, Sampaguita, Ilang and Rosal are `teacher`'s; Tanglaw is
 * `otherTeacher`'s. A manager advises none of them: 0001 refuses an adviser who
 * is not an active teacher. Each case that submits gets a section to itself,
 * because 0028 lets only one class list wait per section at a time.
 */
const masigla = '00000000-0000-4000-9000-00000000000a';
const tanglaw = '00000000-0000-4000-9000-00000000000d';
const sampaguita = '00000000-0000-4000-9000-00000000000e';
const ilang = '00000000-0000-4000-9000-00000000000f';
const rosal = '00000000-0000-4000-9000-000000000010';

const header = 'lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address';
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: string[][]) => [header, ...rows.map(r => r.map(cell).join(','))].join('\r\n') + '\r\n';
const row = (n: number) => [`1361700003${String(n).padStart(2, '0')}`, `Listed${n}`, '', `Child${n}`, '',
  '2017-05-02', 'female', 'Purok 4, Balili, La Trinidad, Benguet'];

const onto = { enrolled_on: '2026-06-01', entry_kind: 'regular' as const };
const reason = 'Submitting the class list for the office to import.';

/** An adviser submits a class list for their section, and it waits. */
async function submit(section: string, token: string, rows = [row(1)]) {
  const sent = await api.post('/api/v1/roster-submissions', token, { ...onto, section_id: section, csv: csv(rows), reason });
  expect(sent.status, sent.message ?? '').toBe(201);
  return sent.data as Record<string, unknown>;
}
/** The office imports the same file onto the section, which is what an acceptance needs. */
async function importOnto(section: string, rows = [row(1)]) {
  const payload = { ...onto, section_id: section, csv: csv(rows), resolutions: [] };
  const sent = await api.post('/api/v1/roster-imports/preview', tokens.officer, payload);
  expect(sent.status, JSON.stringify(sent.data.issues ?? sent.message)).toBe(201);
  const done = await api.post(`/api/v1/roster-imports/${String(sent.data.preview_id)}/commit`, tokens.officer, { ...payload, confirmed: true });
  expect(done.status, done.message ?? '').toBe(201);
  return String(sent.data.preview_id);
}
const inbox = async (token: string, query = '') => {
  const got = await api.get(`/api/v1/notifications${query}`, token);
  expect(got.status, got.message ?? '').toBe(200);
  return got.data.items as Record<string, unknown>[];
};
const unread = async (token: string) => {
  const got = await api.get('/api/v1/notifications/count', token);
  expect(got.status, got.message ?? '').toBe(200);
  return got.data.unread as number;
};
const kinds = (items: Record<string, unknown>[]) => items.map(n => String(n.kind));

beforeAll(async () => {
  db = await testDatabase();
  api = await testApi(db);
  await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
  await db.pg.query(`select set_config('edunexus.request_id',$1,false)`, ['00000000-0000-4000-7000-000000000001']);
  await db.pg.query(`insert into edunexus.academic_years(id,start_year,starts_on,ends_on,status) values($1,2026,'2026-06-01','2027-03-31','draft')`, [year2026]);
  await db.pg.query(`insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values
    ($1,$6,3,'Masigla',$7),($2,$6,5,'Tanglaw',$8),($3,$6,3,'Sampaguita',$7),($4,$6,3,'Ilang',$7),($5,$6,3,'Rosal',$7)`,
    [masigla, tanglaw, sampaguita, ilang, rosal, year2026, ids.teacher, ids.otherTeacher]);
});
afterAll(async () => { await db.database.close(); });

describe('an inbox is personal', () => {
  it('tells the office a class list is waiting, and does not tell the adviser who sent it', async () => {
    await submit(masigla, tokens.teacher);
    // Both managers, because a waiting list is work for the office either of them may pick up.
    expect(kinds(await inbox(tokens.principal))).toContain('roster_submitted');
    expect(kinds(await inbox(tokens.officer))).toContain('roster_submitted');
    // The adviser already knows: they are the one who did it.
    expect(await inbox(tokens.teacher)).toEqual([]);
  });

  it('never notifies anyone of their own action, including the manager who did it', async () => {
    const before = await unread(tokens.officer);
    // Reachable only this way round: 0001 refuses an adviser who is not an
    // active teacher, so no manager advises anything, but `submit_roster` lets
    // a manager submit for any section. The officer sends Tanglaw's list.
    await submit(tanglaw, tokens.officer, [row(9)]);
    expect(await unread(tokens.officer)).toBe(before);
    expect(kinds(await inbox(tokens.principal)).filter(k => k === 'roster_submitted')).toHaveLength(2);
  });

  it('shows a manager their own inbox and not the school’s, in SQL as well as over HTTP', async () => {
    // Being a manager grants nothing on this table: no policy mentions
    // is_manager(), so the principal cannot read the officer's inbox even in
    // SQL, where a service-level filter would not save it.
    await db.pg.query(`select set_config('edunexus.actor_id',$1,false)`, [ids.principal]);
    const seen = await db.database.transaction(async tx => tx.query<{ recipient_user_id: string }>('select recipient_user_id from edunexus.notifications'));
    expect(new Set(seen.map(r => String(r.recipient_user_id)))).toEqual(new Set([ids.principal]));
    const everything = await db.pg.query<{ all: string }>('select count(*)::text all from edunexus.notifications');
    // There are more rows than the principal can see, so the filter is the policy's.
    expect(Number(everything[0]!.all)).toBeGreaterThan(seen.length);
  });
});

describe('what a notification may say', () => {
  it('names no learner, and carries only the keys the closed list admits', async () => {
    const [first] = await inbox(tokens.officer);
    const payload = first!.payload as Record<string, unknown>;
    expect(first!.learner_id).toBeNull();
    expect(Object.keys(payload).sort()).toEqual(['grade_level', 'row_count', 'section_name']);
    // The class, the grade and how many rows — and nothing about any child.
    expect(payload.section_name).toBe('Masigla');
    expect(JSON.stringify(first)).not.toContain('Listed1');
    expect(JSON.stringify(first)).not.toContain('Child1');
  });

  it('is the database that refuses an unlisted payload key, not the emitter’s care', async () => {
    await expect(db.pg.query(
      `insert into edunexus.notifications(recipient_user_id,kind,subject_table,subject_id,payload)
       values($1,'roster_submitted','roster_submissions',gen_random_uuid(),jsonb_build_object('learner_name','Juan Dela Cruz'))`,
      [ids.officer])).rejects.toThrow(/notifications_payload_check|violates check constraint/);
  });

  it('cannot be forged by the API’s own login', async () => {
    // `notify` is granted to nobody: only another security-definer writer,
    // inside the transaction that made the change, can send one.
    await expect(db.database.transaction(async tx =>
      tx.query(`select edunexus.notify($1,'roster_submitted','roster_submissions',gen_random_uuid(),null,null,null,'{}'::jsonb)`, [ids.teacher])))
      .rejects.toThrow(/permission denied/i);
    await expect(db.database.transaction(async tx =>
      tx.query(`select edunexus.notify_managers('roster_submitted','roster_submissions',gen_random_uuid(),null,null,null,'{}'::jsonb)`)))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('the roster emitters', () => {
  it('tells the adviser their list was imported, and says so as the decision', async () => {
    const waiting = await submit(sampaguita, tokens.teacher, [row(2)]);
    const preview = await importOnto(sampaguita, [row(2)]);
    const decided = await api.post(`/api/v1/roster-submissions/${String(waiting.id)}/decision`, tokens.officer,
      { version: waiting.version, decision: 'accepted', import_id: preview, reason: 'Imported the class list as submitted.' });
    expect(decided.status, decided.message ?? '').toBe(201);
    const [latest] = await inbox(tokens.teacher);
    expect(latest!.kind).toBe('roster_imported');
    expect((latest!.payload as Record<string, unknown>).decision).toBe('accepted');
    // Named since 0.101.0 (migration 0066), by `notification_actor_name`, which
    // answers only for a notification addressed to the caller. `staff_read` is
    // untouched: the adviser learns the one name that acted on their own inbox
    // row, and still cannot read the officer's staff record.
    expect(latest!.actor_user_id).toBe(ids.officer);
    expect(latest!.actor_name).toBe('Administrative Officer');
    const staff = await api.get('/api/v1/staff?limit=100', tokens.teacher);
    expect(JSON.stringify(staff.data ?? null)).not.toContain('Administrative Officer');
    // A manager reads the same column and does get a name, so the column works
    // and it is the row policy underneath that decides.
    const [forManager] = await inbox(tokens.principal);
    expect(forManager!.actor_name).toBe('Teacher');
  });

  it('tells the adviser a declined list was declined, which is the only correction signal there is', async () => {
    const waiting = await submit(ilang, tokens.teacher, [row(3)]);
    const decided = await api.post(`/api/v1/roster-submissions/${String(waiting.id)}/decision`, tokens.officer,
      { version: waiting.version, decision: 'declined', import_id: null, reason: 'Two birth dates look wrong. Please check and resend.' });
    expect(decided.status, decided.message ?? '').toBe(201);
    // There is no `needs_correction` status on roster_submissions and none was
    // invented to carry a notification: declined is the signal.
    expect(kinds(await inbox(tokens.teacher))).toContain('roster_declined');
  });

  it('tells the office when a waiting list is withdrawn, because it told them it was waiting', async () => {
    const waiting = await submit(rosal, tokens.teacher, [row(4)]);
    const gone = await api.post(`/api/v1/roster-submissions/${String(waiting.id)}/withdrawal`, tokens.teacher,
      { version: waiting.version, reason: 'Sent the wrong file; resending the corrected one.' });
    expect(gone.status, gone.message ?? '').toBe(201);
    expect(kinds(await inbox(tokens.officer))).toContain('roster_withdrawn');
  });
});

describe('reading and counting', () => {
  it('marks one as read, and refuses someone else’s without saying whether it exists', async () => {
    const [mine] = await inbox(tokens.teacher);
    const done = await api.post('/api/v1/notifications/read', tokens.teacher, { id: String(mine!.id) });
    expect(done.status, done.message ?? '').toBe(201);
    expect(done.data.read_at).not.toBeNull();

    // The same id, asked for by the person it is not addressed to.
    const theirs = await api.post('/api/v1/notifications/read', tokens.officer, { id: String(mine!.id) });
    expect(theirs.status).toBe(404);
    expect(theirs.code).toBe('NOTIFICATION_NOT_FOUND');
    const [still] = await db.pg.query<{ read_at: string | null }>('select read_at from edunexus.notifications where id=$1', [mine!.id]);
    expect(still!.read_at).not.toBeNull(); // the teacher's own marking stands, and the officer changed nothing
  });

  it('counts only the unread, and marking all read is a zero the second time rather than a refusal', async () => {
    const before = await unread(tokens.officer);
    expect(before).toBeGreaterThan(0);
    const first = await api.post('/api/v1/notifications/read-all', tokens.officer, {});
    expect(first.status, first.message ?? '').toBe(201);
    expect(first.data.marked).toBe(before);
    expect(await unread(tokens.officer)).toBe(0);
    // Idempotent by design: nothing unread is not an error.
    const again = await api.post('/api/v1/notifications/read-all', tokens.officer, {});
    expect(again.status).toBe(201);
    expect(again.data.marked).toBe(0);
  });

  it('pages newest first off the identity column, which a uuid cursor could not do', async () => {
    // The principal, who was told about every submission and so has the most.
    const all = await inbox(tokens.principal, '?status=all');
    expect(all.length).toBeGreaterThan(2);
    const descending = all.map(n => Number(n.id));
    expect(descending).toEqual([...descending].sort((a, b) => b - a));

    const page = await api.get('/api/v1/notifications?status=all&limit=2', tokens.principal);
    expect((page.data.items as unknown[]).length).toBe(2);
    const cursor = (page.data.pagination as { next_before_id: string }).next_before_id;
    const next = await inbox(tokens.principal, `?status=all&limit=2&before_id=${cursor}`);
    expect(Number(next[0]!.id)).toBeLessThan(Number(cursor));
  });

  it('answers the count without naming a record or writing a privacy access row', async () => {
    const logged = async () => (await db.pg.query<{ n: string }>('select count(*)::text n from edunexus.record_access_events'))[0]!.n;
    const before = await logged();
    await unread(tokens.principal);
    await unread(tokens.teacher);
    await inbox(tokens.principal, '?status=all');
    const after = await logged();
    // A bell that logged an access row per poll would bury the audit it exists
    // to serve, which is why no notification names a learner in the first place.
    expect(after).toBe(before);
  });
});
