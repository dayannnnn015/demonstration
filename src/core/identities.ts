import { AppError } from './errors.js';
import { z } from 'zod';

export interface IdentityProvisioner { create(request: { email: string; displayName: string; role: string }): Promise<string>; }

/**
 * Calls the isolated Supabase Edge Function that mints one Auth identity.
 *
 * The service-role key lives in that function, not here: a key in this runtime
 * could create, alter or delete any identity in the project. This client can
 * only ask for an invitation to one address, and only ever receives an id back.
 */
export function createIdentityProvisioner(options: { url: string; secret: string; fetcher?: typeof fetch }): IdentityProvisioner {
  const fetcher = options.fetcher ?? fetch;
  return {
    async create({ email, displayName, role }) {
      let response: Response;
      try {
        response = await fetcher(options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-edunexus-provision-secret': options.secret },
          body: JSON.stringify({ email, display_name: displayName, role }),
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
      } catch { throw new AppError(503, 'IDENTITY_SERVICE_UNAVAILABLE', 'The account service did not confirm the result. The operator must check whether the identity was created before retrying.'); }
      let payload: unknown;
      try { payload = await response.json(); } catch { /* Handled by status below. */ }
      if (response.status === 409) throw new AppError(409, 'IDENTITY_EXISTS', 'That address already has an account. Link the existing identity instead of creating one.');
      if (response.status === 429) throw new AppError(503, 'IDENTITY_SERVICE_UNAVAILABLE', 'The account service is rate limited. The invitation is unchanged; try again shortly.');
      if (response.status === 401) throw new AppError(500, 'IDENTITY_SERVICE_REJECTED', 'The account service rejected this system. The deployment operator must check its shared secret.');
      const result=z.object({user_id:z.uuid()}).safeParse(payload);
      if (!response.ok || !result.success) throw new AppError(502, 'IDENTITY_SERVICE_FAILED', 'The account service did not confirm a valid identity. The operator must check the identity service before retrying.');
      return result.data.user_id;
    },
  };
}
