import { spawnSync } from 'node:child_process';
import { withPostgres } from './disposable-postgres.js';

/**
 * Runs tests/concurrency.pg.test.ts against a throwaway PostgreSQL container,
 * then removes it. The ordinary suite uses PGlite, which runs one transaction
 * at a time and so cannot show two writers interleaving; this is the one test
 * that needs a real server, which is why it is opt-in and needs Docker.
 */
const status = await withPostgres('edunexus-race-test', '55433', async url => {
  const run = spawnSync('npx', ['vitest', 'run', 'tests/concurrency.pg.test.ts'], {
    stdio: 'inherit', shell: true, env: { ...process.env, EDUNEXUS_RACE_PG_URL: url },
  });
  return run.status ?? 1;
});
process.exit(status);
