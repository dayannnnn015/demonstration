import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import postgres from 'postgres';
import pino from 'pino';
import request from 'supertest';
import { withPostgres } from './disposable-postgres.js';
import { operatorDatabase } from './operator-db.js';
import { supabaseCa } from '../src/core/supabase-ca.js';
import { createApp } from '../src/http-app.js';
import { createDatabase } from '../src/core/db.js';

/**
 * The restore drill the runbook asks for, run against a throwaway copy.
 *
 *   npm run drill:restore              says what it would do, and does nothing
 *   npm run drill:restore -- --confirm runs it
 *
 * It copies the live `edunexus` and `edunexus_meta` schemas, and the IDs of the
 * sign-in identities their staff rows point at, into a disposable PostgreSQL
 * in Docker. The copy is streamed from `pg_dump` straight into `psql`, so no
 * dump file ever exists, and the container is removed when the drill ends.
 * Then the copy is proved, not just found: every table's row count against
 * the live database, every migration checksum, the migration runner finding
 * nothing to apply, and the real API, run against the copy as its own runtime
 * role, answering ready and reading the school back.
 *
 * It only reads the live database. Credentials come from .env and are passed
 * to the container in a file that is deleted at the end; nothing prints them.
 * What it prints is counts and timings.
 */
if (!process.argv.includes('--confirm')) {
  console.log('The restore drill copies the live EDUNEXUS schemas into a throwaway Docker PostgreSQL, checks the copy, and deletes it.');
  console.log('It reads the live database and never writes to it. Run it with: npm run drill:restore -- --confirm');
  process.exit(0);
}
const live = process.env.MIGRATION_DATABASE_URL;
if (!live) { console.error('Set MIGRATION_DATABASE_URL (the operator connection) in .env.'); process.exit(1); }

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const log = (message: string) => console.log(`[${elapsed()}] ${message}`);
const container = 'edunexus-restore-drill';
const runtimePassword = 'synthetic-drill-only';
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1 << 26 });

/** Pipes one command's output into another's input, as `a | b` would, and fails if either does. */
function pipe(from: string[], into: string[]) {
  return new Promise<void>((resolve, reject) => {
    const source = spawn('docker', from, { stdio: ['ignore', 'pipe', 'pipe'] });
    const sink = spawn('docker', into, { stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = '';
    source.stderr.on('data', chunk => { errors += String(chunk); });
    sink.stderr.on('data', chunk => { errors += String(chunk); });
    source.stdout.pipe(sink.stdin);
    let pending = 2, failed = false;
    const done = (code: number | null) => {
      if (code !== 0) failed = true;
      if (--pending) return;
      // A failure's own words, minus anything that looks like a connection string.
      if (failed) reject(new Error(errors.replace(/postgres(ql)?:\/\/\S+/g, '[connection]').trim().slice(-2000) || 'The copy failed.'));
      else resolve();
    };
    source.on('close', done);
    sink.on('close', done);
  });
}

const scratchDir = mkdtempSync(join(tmpdir(), 'edunexus-drill-'));
try {
  await withPostgres(container, '55434', async scratchUrl => {
    log('Throwaway PostgreSQL is up.');
    const url = new URL(live);
    // The container reaches the live database with certificate checking on, against the same CA the API trusts.
    writeFileSync(join(scratchDir, 'ca.pem'), [supabaseCa, ...rootCertificates].join('\n'));
    writeFileSync(join(scratchDir, 'live.env'), [
      `PGHOST=${url.hostname}`, `PGPORT=${url.port || '5432'}`, `PGUSER=${decodeURIComponent(url.username)}`,
      `PGPASSWORD=${decodeURIComponent(url.password)}`, `PGDATABASE=${url.pathname.slice(1) || 'postgres'}`,
      'PGSSLMODE=verify-full', 'PGSSLROOTCERT=/tmp/ca.pem',
    ].join('\n'), { mode: 0o600 });
    if (docker('cp', join(scratchDir, 'ca.pem'), `${container}:/tmp/ca.pem`).status !== 0) throw new Error('Could not hand the CA bundle to the container.');
    const liveEnv = ['--env-file', join(scratchDir, 'live.env')];

    const scratch = postgres(scratchUrl, { max: 1, onnotice: () => {} });
    const operator = operatorDatabase();
    try {
      // What Supabase provides and the schema depends on: the runtime role, and the identities staff rows point at.
      await scratch.unsafe(`create role edunexus_app login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
        create schema auth; create table auth.users (id uuid primary key);`);
      await pipe(['exec', ...liveEnv, container, 'psql', '-tAq', '-c', 'copy (select id from auth.users) to stdout'],
        ['exec', '-i', container, 'psql', '-U', 'postgres', '-q', '-c', 'copy auth.users(id) from stdin']);
      log('Sign-in identity IDs copied.');

      await pipe(['exec', ...liveEnv, container, 'pg_dump', '--schema=edunexus', '--schema=edunexus_meta', '--no-owner', '--no-comments'],
        ['exec', '-i', container, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1']);
      const copied = elapsed();
      log('Schemas and data copied.');

      // Every table, counted on both sides. The live database can move while the drill runs; a seeded or quiet one does not.
      const tables = (await operator<{ tablename: string }[]>`select tablename from pg_tables where schemaname='edunexus' order by tablename`).map(r => r.tablename);
      const mismatches: string[] = [];
      let rows = 0;
      for (const table of tables) {
        const [a] = await operator.unsafe(`select count(*)::bigint n from edunexus.${table}`);
        const [b] = await scratch.unsafe(`select count(*)::bigint n from edunexus.${table}`);
        rows += Number(a!.n);
        if (String(a!.n) !== String(b?.n)) mismatches.push(`${table}: live ${a!.n}, copy ${b?.n}`);
      }
      if (mismatches.length) throw new Error(`Row counts differ:\n${mismatches.join('\n')}`);
      log(`All ${tables.length} tables match the live database: ${rows.toLocaleString()} rows.`);

      const liveMigrations = await operator`select name, checksum from edunexus_meta.migrations order by name`;
      const copyMigrations = await scratch`select name, checksum from edunexus_meta.migrations order by name`;
      if (JSON.stringify(liveMigrations) !== JSON.stringify(copyMigrations)) throw new Error('Migration records differ between the live database and the copy.');
      log(`All ${liveMigrations.length} migration checksums match.`);

      const migrate = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { encoding: 'utf8', env: { ...process.env, MIGRATION_DATABASE_URL: scratchUrl, DATABASE_SSL: 'false' } });
      // Live may be behind this checkout by migrations not yet applied there. The copy then takes exactly
      // those, which rehearses applying them live; anything else the runner does is a failed restore.
      const recorded = new Set(liveMigrations.map(m => String(m.name)));
      const pending = readdirSync('database/migrations').filter(n => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && !recorded.has(n)).sort();
      const applied = [...migrate.stdout.matchAll(/Applied (\S+)/g)].map(m => m[1]!).sort();
      if (migrate.status !== 0 || !/All migrations committed/.test(migrate.stdout) || JSON.stringify(applied) !== JSON.stringify(pending)) throw new Error(`The migration runner did not accept the copy as current:
${migrate.stdout}${migrate.stderr}`);
      log(pending.length
        ? `Live is ${pending.length} migration${pending.length === 1 ? '' : 's'} behind this checkout (${pending.join(', ')}); they applied cleanly to the copy, which rehearses applying them live.`
        : 'The migration runner finds nothing to apply.');

      const [ready] = await scratch`select edunexus.is_ready() as ready`;
      if (!ready?.ready) throw new Error('edunexus.is_ready() is false on the copy.');

      // The application itself, against the copy, as the runtime role and nothing more.
      const [manager] = await scratch`select user_id from edunexus.staff where active and role in ('principal','administrative_officer') order by role, user_id limit 1`;
      const runtime = new URL(scratchUrl); runtime.username = 'edunexus_app'; runtime.password = runtimePassword;
      const database = createDatabase(runtime.toString(), false);
      try {
        const app = createApp({ database, logger: pino({ enabled: false }), origins: [], auth: { async verify(token) { return { userId: token }; } } });
        const readiness = await request(app).get('/health/ready');
        if (readiness.status !== 200) throw new Error(`The API is not ready on the copy: ${readiness.status}.`);
        if (!manager) throw new Error('The copy holds no active manager to read it as.');
        const as = (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${manager.user_id}`);
        const school = await as('/school');
        const years = await as('/academic-years');
        if (school.status !== 200 || years.status !== 200) throw new Error(`The API could not read the copy: school ${school.status}, years ${years.status}.`);
        const active = (years.body.data.items as { id: string; status: string }[]).find(y => y.status === 'active');
        let enrolled = 'no active year';
        if (active) {
          const counts = await as(`/enrollment-counts?academic_year_id=${active.id}`);
          const [liveCount] = await operator`select count(*)::int n from edunexus.enrollments where academic_year_id=${active.id} and record_state='valid' and status='enrolled'`;
          if (counts.status !== 200 || counts.body.data.enrolled !== liveCount!.n) throw new Error(`Enrollment counts differ through the API: copy ${counts.body?.data?.enrolled}, live ${liveCount!.n}.`);
          enrolled = `${counts.body.data.enrolled} enrolled in the active year`;
        }
        log(`The API runs on the copy as edunexus_app: ready, reads the school, ${enrolled}, matching the live database.`);
      } finally { await database.close(); }

      console.log('');
      console.log(`Restore drill passed. Copied in ${copied}; proved in ${elapsed()}. The copy is deleted next.`);
    } finally {
      await scratch.end({ timeout: 5 });
      await operator.end({ timeout: 5 });
    }
  });
} catch (error) {
  console.error(`Restore drill FAILED after ${elapsed()}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
