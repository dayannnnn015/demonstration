import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/http-app.js';
import { testDatabase, type TestDatabase } from './helpers/database.js';

/**
 * Staff portal over the front page (0.106.0, the UI notes of 8 November, note 7).
 *
 * The front page frames the workspace's own sign-in rather than carrying a copy of it, so the two content policies
 * move by exactly one word each and no further:
 * - the front page may frame **this origin** (`frame-src 'self'`), still talks to nothing but this origin, and still
 *   may not be framed by anyone;
 * - the workspace may be framed by **this origin** (`frame-ancestors 'self'`) and by no other site, and helmet's
 *   X-Frame-Options says the same for older browsers.
 * The sign-in service is reached from the workspace only, never from the front page.
 */

let db: TestDatabase;
let app: ReturnType<typeof createApp>;
const authUrl = 'https://auth.example.invalid';

const policy = (header: string | undefined) => Object.fromEntries((header ?? '').split(';').map(part => part.trim()).filter(Boolean)
  .map(part => { const [name, ...values] = part.split(/\s+/); return [name!, values.join(' ')]; }));

beforeAll(async () => {
  db = await testDatabase();
  app = createApp({
    database: db.database, logger: pino({ enabled: false }), origins: [],
    auth: { async verify(token) { return { userId: token }; } },
    publicAuth: { url: authUrl, publishableKey: 'synthetic-publishable-key' },
  });
});
afterAll(async () => { await db.database.close(); });

describe('the content policies around Staff portal', () => {
  it('lets the front page frame this origin and nothing else, and reach no sign-in service', async () => {
    const page = await request(app).get('/');
    const csp = policy(page.headers['content-security-policy']);
    expect(csp['frame-src']).toBe("'self'");
    expect(csp['connect-src']).toBe("'self'");
    expect(csp['frame-ancestors']).toBe("'none'");
    expect(page.headers['content-security-policy']).not.toContain(authUrl);
  });

  it('lets the workspace be framed by this origin only, as before by no other site', async () => {
    for (const path of ['/app', '/account/setup']) {
      const page = await request(app).get(path);
      const csp = policy(page.headers['content-security-policy']);
      expect(csp['frame-ancestors'], path).toBe("'self'");
      expect(csp['connect-src'], path).toBe(`'self' ${authUrl}`);
      expect(page.headers['x-frame-options'], path).toBe('SAMEORIGIN');
    }
  });

  it('opens the sign-in in a frame of /app, and the workspace shows the card alone only when it really is framed', () => {
    const site = readFileSync('web/site/Site.tsx', 'utf8');
    expect(site).toContain('src="/app?embed=signin"');
    // Still a link, so a new tab or a page without script lands on the sign-in page.
    expect(site).toMatch(/<a className="portal-link" href="\/app"/);
    const workspace = readFileSync('web/App.tsx', 'utf8');
    expect(workspace).toMatch(/get\('embed'\) === 'signin' && window\.top !== window\.self/);
  });
});
