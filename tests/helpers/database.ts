import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Database, Query, Row } from '../../src/core/db.js';

/**
 * A throwaway EDUNEXUS database in memory, for the demo and for tests.
 *
 * Every migration is applied in order over the small `auth.users` fixture that
 * 0001's header says a local run supplies, because Supabase owns that table in
 * production. Nothing here reaches a network or a credential.
 *
 * Work runs as `edunexus_app`, the login the API uses, not as the owner. That
 * matters more than it looks: row security is what decides a teacher sees only
 * their own sections, and as the owner every policy is bypassed and the demo
 * would quietly show everybody everything.
 *
 * PGlite is one connection, so transactions are taken one at a time. A caller
 * that holds two at once would deadlock against itself rather than block.
 */

/** The staff the demo and the tests act as. Fixed, so a token is readable in a URL. */
export const ids = {
  principal: '00000000-0000-4000-8000-000000000001',
  officer: '00000000-0000-4000-8000-000000000002',
  teacher: '00000000-0000-4000-8000-000000000003',
  otherTeacher: '00000000-0000-4000-8000-000000000004',
} as const;

const staff: [string, string, 'principal' | 'administrative_officer' | 'teacher'][] = [
  [ids.principal, 'Principal', 'principal'],
  [ids.officer, 'Administrative Officer', 'administrative_officer'],
  [ids.teacher, 'Teacher', 'teacher'],
  [ids.otherTeacher, 'Other Teacher', 'teacher'],
];

export interface TestDatabase {
  database: Database;
  /** Direct access as the owner, for fixtures and assertions that sidestep row security. */
  pg: { query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]> };
  applied: string[];
}

export async function testDatabase(): Promise<TestDatabase> {
  // A `date` comes back as the plain YYYY-MM-DD the column holds, never a JS
  // Date. createDatabase() installs the same parser for oid 1082 against
  // Postgres, and without it here a calendar date would travel as a timestamp
  // and pick up a timezone it never had — which is the one thing this codebase
  // is most careful about.
  const db = new PGlite({ parsers: { 1082: (value: string) => value } });
  await db.exec(`create schema auth; create table auth.users (id uuid primary key, email text);`);

  const names = (await readdir('database/migrations')).filter(n => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
  const applied: string[] = [];
  for (const name of names) {
    const sql = (await readFile(`database/migrations/${name}`, 'utf8')).replace(/\r\n/g, '\n');
    try { await db.exec(sql); applied.push(name); }
    catch (error) { throw new Error(`${name}: ${(error as Error).message}`); }
  }

  for (const [id, name, role] of staff) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}@demo.invalid`]);
    await db.query('insert into edunexus.staff(user_id,display_name,role) values($1,$2,$3)', [id, name, role]);
  }

  // One at a time: PGlite has a single connection, so an overlapping
  // transaction would wait on a BEGIN that cannot be reached.
  let queue: Promise<unknown> = Promise.resolve();
  const serialise = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  const database: Database = {
    async transaction<T>(work: (tx: Query) => Promise<T>): Promise<T> {
      return serialise(async () => {
        const tx: Query = { async query<R extends Row>(text: string, params: unknown[] = []) { return (await db.query<R>(text, params)).rows; } };
        await db.exec('begin');
        // As the API's login, so every row policy applies exactly as it does live.
        await db.exec('set local role edunexus_app');
        try { const result = await work(tx); await db.exec('commit'); return result; }
        catch (error) { try { await db.exec('rollback'); } catch { /* already unwound */ } throw error; }
      });
    },
    async close() { await db.close(); },
  };

  return {
    database,
    pg: { async query<T extends Row>(text: string, params?: unknown[]) { return (await db.query<T>(text, params ?? [])).rows; } },
    applied,
  };
}
