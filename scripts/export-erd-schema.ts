// No cloud connection or records: rebuild only the schema in disposable PGlite.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const pg = await PGlite.create();
try {
  await pg.exec('create schema auth; create table auth.users (id uuid primary key)');
  const migrations = [];
  for (const file of (await readdir('database/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = await readFile(`database/migrations/${file}`, 'utf8');
    await pg.exec(sql);
    migrations.push({ file, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  const columns = (await pg.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(`select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='edunexus' order by table_name,ordinal_position`)).rows;
  const constraints = (await pg.query(`select c.relname as table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='edunexus' and k.contype in ('f','p','u') order by c.relname,k.conname`)).rows;
  const indexes = (await pg.query(`select tablename,indexdef from pg_indexes where schemaname='edunexus' and indexdef like '%UNIQUE%' order by tablename,indexname`)).rows;
  await mkdir('docs/diagrams/paper', { recursive: true });
  await writeFile('docs/diagrams/paper/schema-reference.json', JSON.stringify({ migrations, columns, constraints, indexes }, null, 2) + '\n');
  console.log(`Verified ${migrations.length} migrations and ${new Set(columns.map(c => c.table_name)).size} tables; exported schema metadata only.`);
} finally { await pg.close(); }
