import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createApp } from '../src/http-app.js';
import type { Database, Query, Row } from '../src/core/db.js';
import { withPostgres } from './disposable-postgres.js';

/**
 * A local load measurement of the busiest moment the school will have: every
 * adviser submitting the morning register at once.
 *
 * It runs the real API in this process against a real PostgreSQL 17 server in
 * a throwaway container, seeded like the school — 27 sections of 35 synthetic
 * learners, 945 in all, each section with its own adviser — and then has all
 * 27 advisers read their register, preview their marks and confirm them at the
 * same instant. Every academic writer takes one shared advisory lock with a
 * three-second lock timeout, so what this measures is whether 27 simultaneous
 * confirmations queue within that budget or start answering RETRY_REQUIRED.
 *
 * It is a local measurement, not the hosted acceptance run: there is no
 * network between the API and the database here, the connection pool is one
 * process's rather than Vercel's and Supabase's, and authentication is the
 * test verifier rather than Supabase JWTs. It says whether the database design
 * holds under this contention; the hosted run still has to say whether the
 * deployment does. Synthetic data only, and the container is removed after.
 */
const ADVISERS = Number(process.env.LOAD_ADVISERS ?? 27);
const CLASS_SIZE = Number(process.env.LOAD_CLASS_SIZE ?? 35);
const POOL = Number(process.env.LOAD_POOL ?? 30);
const principal = '00000000-0000-4000-8000-0000000000aa';
const reason = 'Synthetic load measurement of the morning register.';
const days = ['2001-06-25', '2001-06-26', '2001-06-27'];

type Sample = { step: string; ms: number; status: number; code?: string };

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : 0;
};

async function main(url: string) {
  const admin = new pg.Pool({ connectionString: url, max: 2 });
  await admin.query('drop database if exists edunexus_load with (force)');
  await admin.query('drop role if exists edunexus_app');
  await admin.query('create database edunexus_load');
  const target = new URL(url); target.pathname = '/edunexus_load';
  const pool = new pg.Pool({
    connectionString: target.toString(), max: POOL,
    types: { getTypeParser(oid: number, format?: string) { return oid === 1082 ? (v: string) => v : pg.types.getTypeParser(oid, format as never); } } as never,
  });
  const sql = (text: string, params: unknown[] = []) => pool.query(text, params);

  try {
    await sql('create schema auth; create table auth.users (id uuid primary key);');
    for (const file of (await readdir('database/migrations')).filter(f => f.endsWith('.sql')).sort()) await sql(await readFile(`database/migrations/${file}`, 'utf8'));
    await sql("insert into edunexus.school_profile(name,address) values('Synthetic load school','Synthetic address')");

    const advisers = Array.from({ length: ADVISERS }, () => randomUUID());
    for (const [i, id] of [principal, ...advisers].entries()) {
      await sql('insert into auth.users(id) values($1)', [id]);
      await sql('insert into edunexus.staff(user_id,display_name,role) values($1,$2,$3)', [id, i ? `Synthetic adviser ${i}` : 'Synthetic principal', i ? 'teacher' : 'principal']);
    }
    const year = randomUUID();
    await sql("insert into edunexus.academic_years(id,start_year,starts_on,ends_on) values($1,2001,'2001-06-25','2002-03-31')", [year]);
    await sql("insert into edunexus.reporting_periods(academic_year_id,ordinal,name,starts_on,ends_on) values($1,1,'Synthetic term','2001-06-25','2002-03-31')", [year]);
    const sections = advisers.map(() => randomUUID());
    for (const [i, id] of sections.entries()) {
      await sql('insert into edunexus.sections(id,academic_year_id,grade_level,name,adviser_user_id) values($1,$2,$3,$4,$5)', [id, year, 1 + (i % 6), `Synthetic section ${i + 1}`, advisers[i]]);
    }
    await sql("update edunexus.academic_years set status='active' where id=$1", [year]);

    const database: Database = {
      async transaction<T>(work: (tx: Query) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query('begin'); await client.query('set local role edunexus_app');
          const result = await work({ async query<R extends Row>(text: string, params: unknown[] = []) { return (await client.query(text, params)).rows as R[]; } });
          await client.query('commit'); return result;
        } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
      },
      async close() { await pool.end(); },
    };
    const app = createApp({ database, logger: pino({ enabled: false }), origins: [], auth: { async verify(token) { return { userId: token }; } } });
    const call = (actor: string, method: 'get' | 'post', path: string, body?: object) => {
      const r = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${actor}`);
      return body ? r.send(body) : r;
    };

    // Seed the roster as the principal would, through the database's own enrolment function.
    const client = await pool.connect();
    try {
      await client.query('begin'); await client.query('set local role edunexus_app');
      await client.query(`select set_config('edunexus.actor_id',$1,true),set_config('edunexus.request_id',$2,true)`, [principal, randomUUID()]);
      for (const [s, section] of sections.entries()) {
        for (let n = 0; n < CLASS_SIZE; n++) {
          const [learner] = (await client.query("insert into edunexus.learners(first_name,last_name,birth_date,sex) values('Synthetic',$1,'1994-01-01',$2) returning id", [`Learner ${s}-${n}`, n % 2 ? 'male' : 'female'])).rows;
          await client.query("select edunexus.enroll_learner($1,$2,'2001-06-25','regular')", [learner.id, section]);
        }
      }
      await client.query('commit');
    } finally { client.release(); }

    const calendar = { version: 0, section_id: null, reason, changes: days.map(day_on => ({ day_on, action: 'set', am: 'classroom', pm: 'classroom', day_type: 'regular', label: 'Synthetic day' })) };
    const cp = await call(principal, 'post', `/academic-years/${year}/calendar/preview`, calendar);
    await call(principal, 'post', `/academic-years/${year}/calendar/corrections`, { ...calendar, review_hash: cp.body.data.review_hash, reviewed: true });
    console.log(`Seeded ${ADVISERS} sections × ${CLASS_SIZE} learners = ${ADVISERS * CLASS_SIZE} enrolments. Pool ${POOL} connections.\n`);

    const samples: Sample[] = [];
    const timed = async (step: string, run: () => Promise<request.Response>) => {
      const start = performance.now();
      const response = await run();
      samples.push({ step, ms: performance.now() - start, status: response.status, code: response.body?.error?.code });
      return response;
    };

    /** One adviser's register for one date: read, preview, confirm. */
    const register = async (i: number, day: string, session: 'am' | 'pm') => {
      const actor = advisers[i]!, section = sections[i]!;
      const sheet = await timed('read register', () => call(actor, 'get', `/sections/${section}/attendance?day_on=${day}&limit=100`));
      if (sheet.status !== 200) return;
      const items = sheet.body.data.items as { enrollment_id: string; am: string | null; pm: string | null }[];
      // Both sessions travel together; the one not being marked is sent back unchanged.
      const changes = items.map((row, n) => ({ enrollment_id: row.enrollment_id, am: session === 'am' ? (n % 9 ? 'present' : 'absent') : row.am, pm: session === 'pm' ? 'present' : row.pm }));
      const body = { day_on: day, version: sheet.body.data.version, changes, reason };
      const preview = await timed('preview marks', () => call(actor, 'post', `/sections/${section}/attendance/preview`, body));
      if (preview.status !== 201) return;
      await timed('confirm marks', () => call(actor, 'post', `/sections/${section}/attendance/corrections`, { ...body, review_hash: preview.body.data.review_hash, reviewed: true }));
    };

    const wave = async (label: string, work: (i: number) => Promise<unknown>) => {
      const before = samples.length;
      const start = performance.now();
      await Promise.all(advisers.map((_, i) => work(i)));
      const wall = performance.now() - start;
      const mine = samples.slice(before);
      console.log(`### ${label}\n\nAll ${ADVISERS} advisers at once. Wall clock ${Math.round(wall)} ms.\n`);
      console.log('| Step | Requests | Failed | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|---|');
      for (const step of [...new Set(mine.map(s => s.step))]) {
        const rows = mine.filter(s => s.step === step), failed = rows.filter(s => s.status >= 400);
        const ms = rows.map(s => s.ms);
        console.log(`| ${step} | ${rows.length} | ${failed.length}${failed.length ? ` (${[...new Set(failed.map(f => f.code))].join(', ')})` : ''} | ${Math.round(percentile(ms, 50))} | ${Math.round(percentile(ms, 95))} | ${Math.round(Math.max(...ms))} |`);
      }
      console.log('');
      return mine;
    };

    await wave('Morning register, first marks of the day', i => register(i, days[0]!, 'am'));
    await wave('Afternoon register, same date, pairs carried back', i => register(i, days[0]!, 'pm'));
    await wave('Next morning', i => register(i, days[1]!, 'am'));
    await wave('Monitor reads, five in a row per adviser', async i => {
      for (let n = 0; n < 5; n++) await timed('monitor window', () => call(advisers[i]!, 'get', `/sections/${sections[i]}/attendance/monitor?from=${days[0]}&to=${days[2]}&limit=100`));
    });

    const [marks] = (await sql('select count(*)::int n, count(*) filter (where am is not null and pm is not null)::int complete from edunexus.attendance_marks')).rows;
    console.log(`Marks on file: ${marks.n} rows, ${marks.complete} with both sessions. Expected ${ADVISERS * CLASS_SIZE * 2} rows for two dates.`);
    const failed = samples.filter(s => s.status >= 400);
    console.log(failed.length ? `\n${failed.length} requests failed.` : '\nNo request failed.');
    return failed.length ? 1 : 0;
  } finally {
    await pool.end().catch(() => {});
    await admin.query('drop database if exists edunexus_load with (force)').catch(() => {});
    await admin.query('drop role if exists edunexus_app').catch(() => {});
    await admin.end();
  }
}

const status = process.env.LOAD_PG_URL ? await main(process.env.LOAD_PG_URL) : await withPostgres('edunexus-load-test', '55434', main);
process.exit(status);
