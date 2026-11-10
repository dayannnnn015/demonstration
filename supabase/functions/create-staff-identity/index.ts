// Creates one Supabase Auth identity for a staff invitation, and nothing else.
//
// This function exists so the EDUNEXUS runtime never has to hold a service-role
// key. Minting an Auth user requires that key, and a key in the Vercel runtime
// could create, alter or delete any identity in the project, principals
// included. Here the key is confined to a single deployment whose only reachable
// action is "invite this address". There is no update path and no delete path.
//
// Deployed with --no-verify-jwt: the caller is the EDUNEXUS API, which holds no
// Supabase user session, so the shared secret below is the only gate. Keep it
// long and random, and rotate it in both places at once.
//
// Deploy:  supabase functions deploy create-staff-identity --no-verify-jwt
// Secrets: supabase secrets set EDUNEXUS_PROVISION_SECRET=... EDUNEXUS_INVITE_REDIRECT=...
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ROLES = ['principal', 'administrative_officer', 'teacher'];

/** Constant-time comparison, so a wrong secret leaks no length or prefix. */
function secretMatches(expected: string, presented: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(presented);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = Deno.env.get('EDUNEXUS_PROVISION_SECRET') ?? '';
  const presented = request.headers.get('x-edunexus-provision-secret') ?? '';
  if (secret.length < 32 || !secretMatches(secret, presented)) return json(401, { error: 'unauthorized' });

  let body: { email?: unknown; display_name?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return json(400, { error: 'invalid_body' }); }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const role = typeof body.role === 'string' ? body.role : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json(400, { error: 'invalid_email' });
  if (!displayName || displayName.length > 150) return json(400, { error: 'invalid_display_name' });
  if (!ROLES.includes(role)) return json(400, { error: 'invalid_role' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // The redirect is taken from this function's own configuration, never from the
  // caller, so a compromised caller cannot point invitation links elsewhere.
  const redirectTo = Deno.env.get('EDUNEXUS_INVITE_REDIRECT') ?? undefined;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    // Display name and role are recorded for the operator's benefit only.
    // EDUNEXUS reads permissions from edunexus.staff, never from user metadata.
    data: { display_name: displayName, invited_role: role },
  });

  if (error) {
    const code = (error as { code?: string }).code ?? '';
    const status = (error as { status?: number }).status ?? 0;
    // An address that already has an identity is linked through the ordinary
    // provision endpoint instead; this function never touches an existing user.
    if (code === 'email_exists' || status === 422) return json(409, { error: 'email_exists' });
    if (status === 429) return json(429, { error: 'rate_limited' });
    return json(502, { error: 'invite_failed' });
  }
  if (!data.user?.id) return json(502, { error: 'invite_failed' });
  return json(200, { user_id: data.user.id });
});
