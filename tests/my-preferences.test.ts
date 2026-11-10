// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { serverApi, type ServerApi } from './helpers/dom.js';
import { applyPreferences } from '../web/preferences';

/**
 * Spacing and the small text size (migration 0055).
 *
 * Two more of a person's own interface settings, saved the way 0043's and
 * 0047's are. What has to hold is what holds for all of them: a person saves
 * only their own, an invalid value cannot reach the record, the choice comes
 * back on the next read, and it reaches the page as an attribute the
 * stylesheets read rather than an inline style the content policy would drop.
 */

let db: TestDatabase;
let server: ServerApi;
type Profile = { density: string; text_size: string; version: number };
const mine = async () => (await server.api<{ profile: Profile }>('/me')).profile;

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('spacing and text size', () => {
  it('start at the design as it is, so nobody is moved without choosing', async () => {
    server.signInAs('teacher');
    const p = await mine();
    expect(p.density).toBe('comfortable');
    expect(p.text_size).toBe('standard');
  });

  it('saves a person’s own choice and reads it back', async () => {
    server.signInAs('teacher');
    const before = await mine();
    await server.api('/me/profile', 'PATCH', { version: before.version, density: 'compact', text_size: 'small' });
    const after = await mine();
    expect(after.density).toBe('compact');
    expect(after.text_size).toBe('small');
  });

  it('does not reach anybody else', async () => {
    // The whole point of a personal setting: a teacher choosing Compact must
    // not move the principal's screens.
    server.signInAs('principal');
    const theirs = await mine();
    expect(theirs.density).toBe('comfortable');
    expect(theirs.text_size).toBe('standard');
  });

  it('refuses a value that is not one of the choices', async () => {
    server.signInAs('teacher');
    const p = await mine();
    await expect(server.api('/me/profile', 'PATCH', { version: p.version, density: 'roomy' })).rejects.toThrow();
    // and the record is untouched by the attempt
    expect((await mine()).density).toBe('compact');
  });

  it('keeps the smaller size out of the default', async () => {
    // `small` was added below Standard. The scale only ever grew before, and a
    // new choice must not quietly shrink anyone who never picked it.
    const html = document.documentElement;
    applyPreferences(null, html);
    expect(html.dataset.text).toBe('standard');
    expect(html.dataset.density).toBe('comfortable');
  });

  it('reaches the page as attributes, never an inline style', () => {
    const html = document.documentElement;
    applyPreferences({ text_size: 'small', density: 'spacious' }, html);
    expect(html.dataset.text).toBe('small');
    expect(html.dataset.density).toBe('spacious');
    // An unknown value falls back rather than being written through.
    applyPreferences({ text_size: 'enormous', density: 'roomy' }, html);
    expect(html.dataset.text).toBe('standard');
    expect(html.dataset.density).toBe('comfortable');
  });

  it('is styled from one place each, so a choice cannot miss a screen', () => {
    const css = readFileSync('web/styles/app.css', 'utf8');
    expect(css).toMatch(/:root\[data-text='small'\] \{ font-size: 93\.75%; \}/);
    // Spacing moves two tokens; every row and card reads them.
    expect(css).toMatch(/:root \{ --row-y: var\(--s3\); --pad-card: var\(--s5\); \}/);
    expect(css).toMatch(/:root\[data-density='compact'\]/);
    expect(css).toMatch(/:root\[data-density='spacious'\]/);
    expect(css).toMatch(/tbody td \{ padding: var\(--row-y\)/);
    expect(css).toMatch(/\.card-body \{ padding: var\(--pad-card\); \}/);
  });
});
