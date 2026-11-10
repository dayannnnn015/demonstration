import postgres from 'postgres';
import { databaseTls } from '../src/core/database-tls.js';

export function operatorDatabase() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('Set MIGRATION_DATABASE_URL locally. Never add it to the deployed runtime.');
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search) throw new Error('Use a PostgreSQL URL without query options; set DATABASE_SSL separately.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (process.env.DATABASE_SSL === 'false' && !local) throw new Error('Remote operator connections require certificate-verified TLS.');
  return postgres(url, { ssl: databaseTls(url, !(local && process.env.DATABASE_SSL === 'false')), max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
}

export function operatorFailure(error?: unknown) {
  const details = error as { code?: unknown; constraint_name?: unknown; routine?: unknown } | undefined;
  console.error('Operator command failed. No credentials were printed. Check the configuration, database permissions, and input identifiers.');
  for (const [key, value] of Object.entries({ code: details?.code, constraint: details?.constraint_name, routine: details?.routine })) {
    if (typeof value === 'string' && /^[a-zA-Z0-9_]+$/.test(value)) console.error(`${key}: ${value}`);
  }
  process.exitCode = 1;
}
