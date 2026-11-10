// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ids, testDatabase, type TestDatabase } from './helpers/database.js';
import { mountScreen, serverApi, type ServerApi } from './helpers/dom.js';
import { Settings } from '../web/screens/Settings.js';
import { Profile } from '../web/screens/Profile.js';
import { available, routes } from '../web/routes.js';

/**
 * Settings, split out of My profile, and reached from the account menu.
 *
 * The split moved cards between two screens and changed no preference, which is
 * the thing worth proving: a move like this breaks quietly, by leaving a card
 * on both screens, on neither, or writing to a different column than it reads.
 * So the cases are *where* each card is, that the move is complete in both
 * directions, and that a choice saved on the new screen lands in
 * `staff_profiles` through the same writer as before.
 *
 * Placement is asserted against the route table and the shell's own source,
 * not by mounting the shell: `offRail` is what keeps it out of the navigation,
 * and the account menu is a fixed list of items rather than a rendering of
 * routes, so an entry there has to be read from the file that holds it.
 */

let db: TestDatabase;
let server: ServerApi;
const principal = { user_id: ids.principal, role: 'principal', display_name: 'Principal' };
const teacher = { user_id: ids.teacher, role: 'teacher', display_name: 'Teacher' };
const route = (id: string) => routes.find(r => r.id === id)!;
// A plain repo-relative path, as tests/web-help.test.ts reads screen source: vitest runs from the repo root.
const shell = readFileSync('web/components/AppShell.tsx', 'utf8');

beforeAll(async () => {
  db = await testDatabase();
  server = await serverApi(db);
});
afterAll(async () => { await server.close(); await db.database.close(); });

describe('where Settings lives', () => {
  it('is its own screen, open to every role', () => {
    expect(route('settings')).toBeTruthy();
    expect(route('settings').built).toBe(true);
    // Not manager-only: these are one person's own choices, whoever they are.
    expect('manager' in route('settings') && route('settings').manager).toBeFalsy();
    for (const role of ['principal', 'administrative_officer', 'teacher']) {
      expect(available(route('settings'), role), role).toBe(true);
    }
  });

  it('is in the account menu beside My profile, and not on the rail', () => {
    // `offRail` is the whole mechanism that keeps it out of the navigation, so
    // it is asserted rather than described. Both screens carry it: they belong
    // to the person, and the rail is the school's records.
    expect(route('settings').offRail).toBe(true);
    expect(route('profile').offRail).toBe(true);
    // And the menu item exists, in the one place that list is written.
    expect(shell).toContain('My profile');
    expect(shell).toContain('/>Settings');
    expect(shell).toContain('onSettings');
    // Reached by name too, because the palette searches the route table and
    // does not care that a route is off the rail.
    expect(route('settings').nav).toBe('Settings');
  });
});

describe('the split is complete in both directions', () => {
  it('shows the preference cards on Settings', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Settings as never, server, principal, { route: route('settings') });
    await screen.until(m => m.text().includes('Preferences'), 'the preference cards');
    const text = screen.text();
    expect(text).toContain('Preferences');
    expect(text).toContain('Accessibility');
    expect(text).toContain('Learning EDUNEXUS');
    screen.unmount();
  });

  it('no longer shows them on My profile, which keeps who you are', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Profile as never, server, principal, { route: route('profile') });
    // Wait for the profile itself to arrive before asserting on an absence,
    // or this passes against a screen that has simply not loaded.
    await screen.until(m => m.text().includes('Your picture'), 'the profile');
    const text = screen.text();
    expect(text).not.toContain('Learning EDUNEXUS');
    // "Accessibility" as a card heading is gone. Checked on headings rather
    // than the whole text, so an unrelated sentence mentioning the word does
    // not make this pass or fail by accident.
    const headings = screen.all('h2').map(h => (h.textContent ?? '').trim());
    expect(headings).not.toContain('Preferences');
    expect(headings).not.toContain('Accessibility');
    // What My profile does keep.
    expect(headings).toContain('Signing in');
    screen.unmount();
  });

  it('gives an adviser the same Settings screen', async () => {
    server.signInAs('teacher');
    const screen = await mountScreen(Settings as never, server, teacher, { route: route('settings') });
    await screen.until(m => m.text().includes('Accessibility'), 'the accessibility card');
    screen.unmount();
  });
});

describe('no preference changed in the move', () => {
  it('saves a choice through the same writer, into the same column it reads', async () => {
    server.signInAs('principal');
    const screen = await mountScreen(Settings as never, server, principal, { route: route('settings') });
    await screen.until(m => m.text().includes('Preferences'), 'the preference cards');

    // There is no `staff_profiles` row yet, and that is not an oversight:
    // `read_my_profile` is `stable` and answers with the defaults, so a person
    // who has never chosen anything stores nothing. The row appears on the
    // first save, which is what this case is really about.
    const before = await db.pg.query<{ n: number }>('select count(*)::int n from edunexus.staff_profiles where user_id=$1', [ids.principal]);
    expect(Number(before[0]!.n)).toBe(0);

    // Chosen the way a person chooses it: the control, not the endpoint. Each
    // preference is a `role="radiogroup"` of buttons labelled by a `pref-<key>`
    // heading, so the group is found by that and the option by its own label.
    const group = screen.all('[role="radiogroup"]').find(g => g.getAttribute('aria-labelledby') === 'pref-theme');
    expect(group, 'the theme radiogroup on Settings').toBeTruthy();
    const dark = [...group!.querySelectorAll<HTMLElement>('[role="radio"]')].find(b => (b.textContent ?? '').trim() === 'Dark');
    expect(dark, 'a Dark option').toBeTruthy();
    expect(dark!.getAttribute('aria-checked'), 'not already dark').toBe('false');
    await screen.click(dark!);

    for (let i = 0; i < 40; i++) {
      const [row] = await db.pg.query<{ theme: string }>('select theme from edunexus.staff_profiles where user_id=$1', [ids.principal]);
      if (row!.theme === 'dark') break;
      await screen.settle();
    }
    // Exactly one row, in the column the screen reads back: the move between
    // screens did not add a second place a preference can live, and Settings
    // writes where My profile used to.
    const after = await db.pg.query<{ theme: string }>('select theme from edunexus.staff_profiles where user_id=$1', [ids.principal]);
    expect(after).toHaveLength(1);
    expect(after[0]!.theme).toBe('dark');

    // And the screen shows the choice it just saved, which is the read path.
    const chosen = screen.all('[role="radiogroup"]').find(g => g.getAttribute('aria-labelledby') === 'pref-theme');
    expect(chosen?.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.trim()).toBe('Dark');
    screen.unmount();
  });
});
