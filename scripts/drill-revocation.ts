import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { operatorDatabase, operatorFailure } from './operator-db.js';
import { syntheticAccounts } from './seed/reset.js';

/**
 * The "Remove someone's access" runbook, drilled on the hosted seeded school.
 *
 *   npm run drill:revocation              says what it would do, and does nothing
 *   npm run drill:revocation -- --confirm runs it
 *
 * The seeded school's synthetic school head and one synthetic subject teacher
 * (`.invalid` identities the go-live wipe removes) get a throwaway password,
 * generated here and never printed, and sign in for real. The school head
 * suspends the teacher through the API; the teacher's next request, with the
 * same still-valid token, must answer STAFF_ACCESS_REQUIRED. Their reads are
 * looked up in the privacy log, they are reinstated, and both identities are
 * put back exactly as they were, sessions ended. Real staff are never touched.
 * Needs the operator credential, the project's service-role key in
 * .local/cloud-keys.json, and a seeded database.
 */
const site = process.env.EDUNEXUS_SITE_URL ?? 'https://edunexus-balili.vercel.app';
const confirm = process.argv.includes('--confirm');

try {
  const sql = operatorDatabase();
  const results: string[] = [];
  try {
    const [principal] = await sql`select s.user_id::text id from edunexus.staff s join auth.users u on u.id=s.user_id where ${sql.unsafe(syntheticAccounts('u.email'))} and s.role='principal' and s.active limit 1`;
    const [teacher] = await sql`select s.user_id::text id, s.version from edunexus.staff s join auth.users u on u.id=s.user_id
      where ${sql.unsafe(syntheticAccounts('u.email'))} and s.role='teacher' and s.active
        and not exists (select 1 from edunexus.sections x join edunexus.academic_years y on y.id=x.academic_year_id where x.adviser_user_id=s.user_id and y.status<>'closed') limit 1`;
    if (!principal || !teacher) throw new Error('This database has no synthetic school head, or no synthetic teacher without a section: seed it first.');
    if (!confirm) { console.log(`Would drill against ${site} with a synthetic school head and a synthetic subject teacher, then restore both. Add -- --confirm to run.`); process.exit(0); }

    const supabase = process.env.SUPABASE_URL!, anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const service = (JSON.parse(readFileSync('.local/cloud-keys.json', 'utf8')) as { name: string; api_key: string }[]).find(k => k.name === 'service_role')!.api_key;
    const admin = (path: string, init: RequestInit = {}) => fetch(`${supabase}/auth/v1/admin${path}`, { ...init, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' } });
    const api = (token: string, method: string, path: string, body?: object) => fetch(`${site}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: site }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const code = async (r: Response) => ((await r.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';
    const ids = [principal.id, teacher.id];
    const before = await sql`select id::text, encrypted_password, email_confirmed_at, banned_until from auth.users where id = any(${ids}::uuid[])`;
    const signIn = async (id: string) => {
      const password = randomBytes(24).toString('base64url');
      if (!(await admin(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) })).ok) throw new Error('Setting a throwaway password failed.');
      const [identity] = await sql`select email from auth.users where id=${id}::uuid`;
      const email = identity?.email;
      const r = await fetch(`${supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const token = ((await r.json()) as { access_token?: string }).access_token;
      if (!token) throw new Error(`Sign-in failed: ${r.status}`);
      return token;
    };
    try {
      const manager = await signIn(principal.id), adviser = await signIn(teacher.id);
      results.push(`Teacher signed in; /me answers ${(await api(adviser, 'GET', '/me')).status}.`);
      const started = Date.now();
      const suspend = await api(manager, 'PATCH', `/staff/${teacher.id}`, { version: teacher.version, active: false });
      const suspended = ((await suspend.json()) as { data?: { version: number } }).data;
      results.push(`Suspended through the API by the school head: ${suspend.status}.`);
      const next = await api(adviser, 'GET', '/me');
      const refused = await code(next);
      results.push(`The teacher's next request, same token: ${next.status} ${refused} (${Date.now() - started} ms after suspending).`);
      if (refused !== 'STAFF_ACCESS_REQUIRED') process.exitCode = 1;
      results.push(`Ending the identity's sessions in Supabase: ${(await admin(`/users/${teacher.id}/logout`, { method: 'POST' })).status}.`);
      const log = await api(manager, 'GET', `/record-access-events?actor_user_id=${teacher.id}&limit=10`);
      results.push(`Privacy access log narrowed to the teacher: ${log.status}.`);
      if (suspended) results.push(`Reinstated through the API: ${(await api(manager, 'PATCH', `/staff/${teacher.id}`, { version: suspended.version, active: true })).status}.`);
    } finally {
      for (const row of before) {
        await sql`update auth.users set encrypted_password=${row.encrypted_password}, email_confirmed_at=${row.email_confirmed_at}, banned_until=${row.banned_until} where id=${row.id}::uuid`;
        await sql`delete from auth.sessions where user_id=${row.id}::uuid`;
      }
      const [active] = await sql`select active from edunexus.staff where user_id=${teacher.id}::uuid`;
      results.push(`Both identities put back as they were, sessions ended; the teacher is ${active?.active ? 'active again' : 'STILL SUSPENDED'}.`);
      if (!active?.active) process.exitCode = 1;
    }
    for (const line of results) console.log(line);
    console.log(process.exitCode ? 'Revocation drill FAILED.' : 'Revocation drill passed.');
  } finally { await sql.end({ timeout: 5 }); }
} catch (error) { operatorFailure(error); }
