import { Pool, types } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { databaseTls } from './database-tls.js';

export type Row = Record<string, unknown>;

/**
 * Refuses a parameter the driver would encode in a way nobody intended.
 *
 * node-postgres sends a JS **array** as a PostgreSQL array literal and a plain
 * **object** as JSON. Every `jsonb` argument in this codebase is serialised
 * with `JSON.stringify` before it is bound — except one, which bound the
 * learning areas of a transcribed school year straight through. Against a real
 * server that is an array literal cast to `jsonb`, which fails `22P02`; the
 * school could not add a school year for three sessions, and no test caught it
 * because PGlite encodes both the same way.
 *
 * So a test cannot be the guard here — this is. An array of primitives is
 * allowed, because `::uuid[]`, `::text[]` and `::smallint[]` arguments are
 * real and common. An array holding anything else, or a plain object, is
 * always a mistake in this codebase and is refused loudly where it is written
 * rather than quietly in production.
 */
export function checkParams(text: string, params: unknown[]) {
  for (const [n, value] of params.entries()) {
    if (value === null || value === undefined || typeof value !== 'object') continue;
    if (value instanceof Date || Buffer.isBuffer(value)) continue;
    const flat = Array.isArray(value) && value.every(v => v === null || typeof v !== 'object');
    if (flat) continue;
    throw new Error(
      `Parameter ${n + 1} is a JavaScript ${Array.isArray(value) ? 'array of objects' : 'object'}, which the driver would not encode as JSON. `
      + `Pass JSON.stringify(...) and cast the parameter, as every other jsonb argument here does. Query: ${text.slice(0, 120)}`);
  }
}
export interface Query {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Database {
  transaction<T>(work: (tx: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(url: string, ssl: boolean, max = 3): Database {
  const pool = new Pool({
    connectionString: url,
    ssl: databaseTls(url, ssl),
    max,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    maxLifetimeSeconds: 1200,
    types: { getTypeParser(oid, format) { return oid === 1082 ? (value: string) => value : types.getTypeParser(oid, format); } },
  });
  pool.on('error', () => console.error('An idle database connection failed; the pool will reconnect.'));
  attachDatabasePool(pool);
  return {
    async transaction<T>(work: (tx: Query) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let discard = false;
      // A connection that drops between two of this transaction's queries emits 'error' on the client, not the pool;
      // unheard, that ends the whole process. The next query fails with it instead, and the client is discarded.
      const dropped = () => { discard = true; };
      client.on('error', dropped);
      try {
        // If this side goes away mid-transaction, the server ends it after 30 idle seconds instead of keeping its locks,
        // the shared academic lock among them, until the network notices. No request pauses that long between queries.
        await client.query("begin; set local idle_in_transaction_session_timeout = '30s'");
        const result = await work({ async query<R extends Row>(text: string, params: unknown[] = []) { checkParams(text, params); return (await client.query<R>(text, params)).rows; } });
        await client.query('commit');
        return result;
      } catch (error) {
        try { await client.query('rollback'); } catch { discard = true; }
        throw error;
      } finally { client.off('error', dropped); client.release(discard); }
    },
    async close() { await pool.end(); },
  };
}

export async function assertRuntimeRole(tx: Query) {
  const [role] = await tx.query<{ safe: boolean }>(
    `select current_user = 'edunexus_app' and not rolsuper and not rolbypassrls
      and not rolcreaterole and not rolcreatedb
      and not exists (select 1 from pg_auth_members where member = r.oid) as safe
     from pg_roles r where rolname = current_user`,
  );
  if (!role?.safe) throw new Error('Unsafe database runtime role');
}
