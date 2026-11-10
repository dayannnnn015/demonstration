import { readdir, readFile } from 'node:fs/promises';
import { operatorDatabase, operatorFailure } from './operator-db.js';
import { migrationName, migrationPlan } from './migration-plan.js';

try {
  const sql = operatorDatabase();
  try {
    const names = (await readdir('database/migrations')).filter(n => migrationName.test(n));
    const files = await Promise.all(names.map(async name => ({ name, source: (await readFile(`database/migrations/${name}`, 'utf8')).replace(/\r\n/g, '\n') })));
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(82412000)`;
      await tx.unsafe(`create schema if not exists edunexus_meta;
        revoke all on schema edunexus_meta from public;
        create table if not exists edunexus_meta.migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now());`);
      const recorded = await tx`select name, checksum from edunexus_meta.migrations`;
      // Refuses before applying anything if an applied file changed, and the whole run is one transaction.
      for (const file of migrationPlan(files, new Map(recorded.map(r => [String(r.name), String(r.checksum)])))) {
        await tx.unsafe(file.source);
        await tx`insert into edunexus_meta.migrations (name,checksum) values (${file.name},${file.checksum})`;
        console.log(`Applied ${file.name} (commit pending)`);
      }
    });
    console.log('All migrations committed successfully.');
  } finally { await sql.end({ timeout: 5 }); }
} catch (error) { operatorFailure(error); }
