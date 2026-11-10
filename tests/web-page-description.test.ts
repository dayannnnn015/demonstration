// @vitest-environment happy-dom
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from './helpers/dom.js';
import { DescriptionToggle, PageHeader } from '../web/components/primitives';
import { catalogCandidates } from '../web/screens/Subjects';
import { reportCardAreas } from '../web/learning-areas';
import { routes } from '../web/routes';

/**
 * A screen's description, folded away until it is asked for.
 *
 * Asked for on 2026-11-09: *"add a toggle that shows and minimizes description,
 * and by default, it should be minimal."* `PageHeader` renders on all 29
 * routes, so this is the one change in the set that alters the first paragraph
 * of every screen in the workspace at once — which is why the behaviour is
 * tested by rendering it rather than by reading the source.
 *
 * The three properties that matter and would each break silently: it starts
 * shut, the sentence really is in the DOM once opened (not merely hidden by a
 * class), and the choice is kept for the tab rather than the machine.
 */

const route = routes.find(r => r.id === 'prior-records')!;
const header = readFileSync('web/components/primitives.tsx', 'utf8');
const css = readFileSync('web/styles/app.css', 'utf8');

const clear = () => { try { sessionStorage.clear(); } catch { /* a private window throws */ } };
beforeEach(clear);

describe('a page description starts minimised', () => {
  it('shows the control and not the sentence', async () => {
    const view = await mount(createElement(PageHeader, { route }));
    expect(view.text()).toContain('What is this page for?');
    expect(view.text()).not.toContain(route.lede);
    view.unmount();
  });

  it('is a disclosure a screen reader can follow', async () => {
    const view = await mount(createElement(PageHeader, { route }));
    const button = view.all('.lede-toggle')[0]!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // It names what it controls, so the relationship survives the sentence being absent.
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    view.unmount();
  });
});

describe('opening it shows the page’s own words', () => {
  it('puts the lede in the DOM, not merely on screen', async () => {
    const view = await mount(createElement(PageHeader, { route }));
    await view.click(view.all('.lede-toggle')[0]!);
    expect(view.text()).toContain(route.lede);
    expect(view.all('.lede-toggle')[0]!.getAttribute('aria-expanded')).toBe('true');
    // The label turns round, because the control now does the opposite thing.
    expect(view.text()).toContain('Hide what this page is for');
    view.unmount();
  });

  it('folds it away again', async () => {
    const view = await mount(createElement(PageHeader, { route }));
    await view.click(view.all('.lede-toggle')[0]!);
    await view.click(view.all('.lede-toggle')[0]!);
    expect(view.text()).not.toContain(route.lede);
    view.unmount();
  });
});

describe('the choice is kept for the tab, not the machine', () => {
  it('is remembered once opened, so the next screen opens the same way', async () => {
    const first = await mount(createElement(PageHeader, { route }));
    await first.click(first.all('.lede-toggle')[0]!);
    first.unmount();
    // A different screen, the same preference: one setting for the workspace.
    const other = routes.find(r => r.id !== route.id && !!r.lede)!;
    const second = await mount(createElement(PageHeader, { route: other }));
    expect(second.text()).toContain(other.lede);
    second.unmount();
  });

  it('keeps it in sessionStorage, which dies with the tab', async () => {
    const view = await mount(createElement(PageHeader, { route }));
    await view.click(view.all('.lede-toggle')[0]!);
    expect(sessionStorage.getItem('edunexus-ui-lede')).toBe('open');
    // A staffroom machine must not hand one person's layout to the next, which
    // is the rule the collapsed rail already follows.
    expect(localStorage.getItem('edunexus-ui-lede')).toBe(null);
    view.unmount();
  });

  it('survives a storage that throws, as a private window’s does', () => {
    // The getter is guarded; without it every screen in a private window would
    // fail to render rather than simply starting shut.
    expect(header).toMatch(/catch \{ return false; \}/);
    expect(header).toContain("catch { /* not worth failing a render over */ }");
  });
});

describe('what the change must not have disturbed', () => {
  it('still shows which form a screen feeds', async () => {
    const feeds = routes.find(r => !!r.feeds)!;
    const view = await mount(createElement(PageHeader, { route: feeds }));
    expect(view.text()).toContain('Feeds');
    expect(view.text()).toContain(feeds.feeds!);
    view.unmount();
  });

  it('still renders a screen’s own actions', async () => {
    const view = await mount(createElement(PageHeader, { route, actions: createElement('button', {}, 'Issue the SF9') }));
    expect(view.text()).toContain('Issue the SF9');
    view.unmount();
  });

  it('leaves the control off the printed page', () => {
    // On paper a description is either printed or it is not; a control to fold
    // it is furniture, and the print block exists to drop furniture.
    expect(css).toContain('@media print { .lede-toggle { display: none; } }');
  });
});

describe('a sheet’s long notes follow the same switch (asked 2026-11-09)', () => {
  // "didn't we add a toggle for descriptions? ... and it's disabled by default?" The learning-area sheets carried a
  // paragraph per row; they are descriptions, so they fold with everything else.
  const noted = reportCardAreas.find(a => !!a.note)!;
  const row = () => createElement('div', {}, ...catalogCandidates([]).find(c => c.key === noted.code)!.cells);

  it('shows a learning area’s name and code, and not its note, until asked', async () => {
    const view = await mount(row());
    expect(view.text()).toContain(noted.name);
    expect(view.text()).toContain(noted.code);
    expect(view.text()).not.toContain(noted.note!);
    view.unmount();
  });

  it('opens the notes and every page description together, and shuts them together', async () => {
    const view = await mount(createElement('div', {}, createElement(PageHeader, { route }), createElement(DescriptionToggle, {}), row()));
    await view.click(view.all('.lede-toggle')[1]!);
    expect(view.text()).toContain(noted.note!);
    // One setting: the page's own description opened with it, and its control says so.
    expect(view.text()).toContain(route.lede);
    expect(view.all('.lede-toggle')[0]!.getAttribute('aria-expanded')).toBe('true');
    await view.click(view.all('.lede-toggle')[0]!);
    expect(view.text()).not.toContain(noted.note!);
    expect(view.all('.lede-toggle')[1]!.getAttribute('aria-expanded')).toBe('false');
    view.unmount();
  });

  it('asks no reason on either learning-area sheet', () => {
    const subjects = readFileSync('web/screens/Subjects.tsx', 'utf8');
    expect(subjects.match(/reasoned=\{false\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
