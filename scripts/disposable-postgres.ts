import { spawnSync } from 'node:child_process';

/**
 * A throwaway PostgreSQL 17 server in Docker, for the two checks the embedded
 * PGlite suite cannot make: real lock races and real concurrent load. It binds
 * to localhost only, uses a synthetic password, and is removed afterwards.
 * Nothing here reads .env or touches a hosted database.
 */
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8' });
const pause = (ms: number) => spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`]);

export async function withPostgres<T>(name: string, port: string, work: (url: string) => Promise<T>): Promise<T> {
  const password = 'synthetic-local-only';
  docker('rm', '-f', name);
  const started = docker('run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-p', `127.0.0.1:${port}:5432`, 'postgres:17-alpine',
    '-c', 'max_connections=200');
  if (started.status !== 0) throw new Error(`Could not start a PostgreSQL container. Is Docker running?\n${started.stderr}`);
  try {
    // The image runs a temporary server while it initialises, answers queries on
    // it, then restarts. A query that lands in that window succeeds and the next
    // connection is cut, so wait for the log line marking the real start first.
    let ready = false;
    for (let attempt = 0; attempt < 90 && !ready; attempt++) {
      const initialised = docker('logs', name).stdout.includes('PostgreSQL init process complete');
      ready = initialised && docker('exec', name, 'psql', '-U', 'postgres', '-tAc', 'select 1').stdout.trim() === '1';
      if (!ready) pause(1000);
    }
    if (!ready) throw new Error('PostgreSQL did not become ready.');
    return await work(`postgres://postgres:${password}@127.0.0.1:${port}/postgres`);
  } finally {
    docker('rm', '-f', name);
  }
}
