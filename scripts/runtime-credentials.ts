import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { operatorDatabase, operatorFailure } from './operator-db.js';

try {
  const sql = operatorDatabase();
  try {
    const password = randomBytes(36).toString('hex');
    const url = new URL(process.env.MIGRATION_DATABASE_URL!);
    const ownerUsername = decodeURIComponent(url.username);
    url.username = ownerUsername.startsWith('postgres.') ? `edunexus_app.${ownerUsername.slice('postgres.'.length)}` : 'edunexus_app';
    url.password = password;
    if (url.hostname.endsWith('.pooler.supabase.com')) url.port = '6543';
    await mkdir('.local', { recursive: true });
    // Exclusive creation avoids accidentally rotating an existing credential.
    await writeFile('.local/runtime.env', `DATABASE_URL=${url.toString()}\nDATABASE_SSL=${process.env.DATABASE_SSL === 'false' ? 'false' : 'true'}\n`, { flag: 'wx', mode: 0o600 });
    // The password is generated hexadecimal, never user-controlled SQL input.
    await sql.unsafe(`alter role edunexus_app password '${password}'`);
    console.log('Runtime credential saved to ignored .local/runtime.env. Copy securely into local and Vercel settings.');
  } finally { await sql.end({ timeout: 5 }); }
} catch (error) { operatorFailure(error); }
