import { readFile } from 'node:fs/promises';
import { operations } from '../src/operations.js';

/**
 * The release checklist's live checks, run rather than remembered.
 *
 * It sends anonymous requests only, so it cannot create, change or read a
 * record: the health and readiness probes and the workspace page must answer
 * 200, the published contract must report the version in package.json, and
 * every documented API operation must refuse a caller with no token with 401.
 * A 401 is expected before any validation, so the placeholder IDs and empty
 * bodies below never reach the database.
 *
 * Usage: `npm run smoke` against the public address, or
 * `npm run smoke -- http://127.0.0.1:3001` against a local server.
 */
const base = (process.argv[2] ?? 'https://edunexus-balili.vercel.app').replace(/\/$/, '');
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const placeholder = '00000000-0000-4000-8000-000000000000';
const failures: string[] = [];

const check = async (label: string, url: string, init: RequestInit, expected: number) => {
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (response.status !== expected) failures.push(`${label}: expected ${expected}, got ${response.status}`);
    return response;
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

for (const path of ['/health/live', '/health/ready']) await check(`GET ${path}`, `${base}${path}`, {}, 200);
// The page answering is not enough: a deploy whose hashed script or stylesheet
// is missing still returns 200 here and draws a blank screen. Fetch each one.
const page = await check('GET /app', `${base}/app`, {}, 200);
const assets = page ? [...(await page.text()).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]!) : [];
if (page && !assets.some(a => a.endsWith('.js'))) failures.push('/app references no script');
for (const asset of assets) await check(`GET ${asset}`, `${base}${asset}`, {}, 200);
// The public front page, its own assets, and its one public read, which needs no token.
const front = await check('GET /', `${base}/`, {}, 200);
const frontAssets = front ? [...(await front.text()).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]!).filter(a => !assets.includes(a)) : [];
if (front && !frontAssets.some(a => a.endsWith('.js'))) failures.push('/ references no script of its own');
for (const asset of frontAssets) await check(`GET ${asset}`, `${base}${asset}`, {}, 200);
const publicSite = await check('GET /api/v1/public/site', `${base}/api/v1/public/site`, {}, 200);
if (publicSite && !('announcements' in ((await publicSite.json()) as { data: object }).data)) failures.push('/api/v1/public/site answered without announcements');
const contract = await check('GET /openapi.json', `${base}/openapi.json`, {}, 200);
const published = contract ? ((await contract.json()) as { info?: { version?: string } }).info?.version : undefined;
if (published !== version) failures.push(`/openapi.json reports ${published ?? 'nothing'}, package.json says ${version}`);

// Sequential and unhurried: this is a check, not a load test, and it should not look like abuse to the edge.
for (const op of operations) {
  const path = op.path.replace(/:[a-z_]+/gi, placeholder);
  const init: RequestInit = op.method === 'get' ? {} : { method: op.method.toUpperCase(), headers: { 'Content-Type': 'application/json' }, body: '{}' };
  await check(`${op.method.toUpperCase()} ${op.path}`, `${base}${path}`, init, 401);
}

const total = operations.length + 6 + assets.length + frontAssets.length;
if (failures.length) {
  console.error(`${failures.length} of ${total} live checks failed against ${base}:\n${failures.map(f => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`All ${total} live checks passed against ${base}: health, readiness, the workspace and its ${assets.length} assets, the front page and its ${frontAssets.length} and its public read answer, the contract reports ${version}, and all ${operations.length} operations refuse an anonymous caller.`);
