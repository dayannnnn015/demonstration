import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { labelsIn, linksIn } from '../web/help/Prose';
import { editions } from '../web/help';
import { whatsNew } from '../web/help/en/whats-new';
import { routes, type Role } from '../web/routes';

/**
 * Help against the screens it describes.
 *
 * Help is fixed text bundled with the workspace, so it cannot be wrong at
 * runtime — it can only be *stale*, which is worse, because a guide naming a
 * button that was renamed last month sends a teacher looking for something that
 * is not there. Nothing but a test can catch that, and this is the test
 * `AGENTS.md`, `tours.ts` and `whats-new.ts` all say exists.
 *
 * It was lost with `tests/` in the 0.86.1 recovery and rebuilt on 2026-11-05.
 * It found two stale labels the moment it ran, both left by this session.
 *
 * The rule it enforces: every `**Label**` in help must appear verbatim in the
 * screens' own source. So renaming a control means updating its guide, in the
 * same commit, or the gate fails.
 */

const { guides, articles, faq, tours } = editions.en;
const routeIds = new Set(routes.map(r => r.id));

/** Every line of help text there is, with where it came from, so a failure names the file to fix. */
const lines: { where: string; text: string }[] = [
  ...guides.flatMap(g => [
    { where: `guides[${g.route}].summary`, text: g.summary },
    ...g.steps.map((text, i) => ({ where: `guides[${g.route}].steps[${i}]`, text })),
    ...(g.refuses ?? []).map((text, i) => ({ where: `guides[${g.route}].refuses[${i}]`, text })),
  ]),
  ...articles.flatMap(a => [
    { where: `articles[${a.id}].summary`, text: a.summary },
    ...a.body.map((text, i) => ({ where: `articles[${a.id}].body[${i}]`, text })),
  ]),
  ...faq.flatMap(f => [
    { where: `faq[${f.id}].question`, text: f.question },
    ...f.answer.map((text, i) => ({ where: `faq[${f.id}].answer[${i}]`, text })),
  ]),
  ...tours.flatMap(t => [
    { where: `tours[${t.id}].summary`, text: t.summary },
    ...t.steps.flatMap((s, i) => [
      { where: `tours[${t.id}].steps[${i}].title`, text: s.title },
      { where: `tours[${t.id}].steps[${i}].body`, text: s.body },
      ...(s.absent ? [{ where: `tours[${t.id}].steps[${i}].absent`, text: s.absent }] : []),
    ]),
  ]),
  ...whatsNew.flatMap(r => r.items.map((text, i) => ({ where: `whatsNew[${r.version}].items[${i}]`, text }))),
];

/**
 * The screens' own source: everything under `web/` **except `web/help/`**.
 *
 * Excluding the help is the whole point and is easy to get wrong. Scanning all
 * of `web/` makes this test vacuous, because every label then matches the help
 * file it was written in, and the gate passes while naming a button that does
 * not exist. It did exactly that until a deliberately broken label failed to
 * fail, on 2026-11-05.
 */
async function screenSource() {
  const parts: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (path !== 'web/help') await walk(path); }
      else if (/\.tsx?$/.test(entry.name)) parts.push(await readFile(path, 'utf8'));
    }
  };
  await walk('web');
  return parts.join('\n');
}

/**
 * JSX splits text across lines and interpolations, so a label is looked for
 * with runs of whitespace treated as one space, and with the typographic
 * apostrophe and the plain one treated alike — a screen and a guide should not
 * fail this over which quote somebody typed.
 */
const normalise = (text: string) => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

describe('help names only controls the screens have', () => {
  it('finds every **Label** in the screens’ own source', async () => {
    const source = normalise(await screenSource());
    const missing: string[] = [];
    for (const { where, text } of lines) {
      for (const label of labelsIn(text)) {
        if (!source.includes(normalise(label))) missing.push(`${where}: "${label}"`);
      }
    }
    expect(missing, 'help names a control the screens do not have — rename it in the help, or put the control back').toEqual([]);
  });

  it('marks at least one label on most screens, so the rule is doing work', () => {
    // A guard against the rule passing because nothing is marked at all.
    const marked = guides.filter(g => [g.summary, ...g.steps, ...(g.refuses ?? [])].some(text => labelsIn(text).length));
    expect(marked.length).toBeGreaterThan(guides.length / 2);
  });
});

describe('help links only to screens that exist', () => {
  it('names a real route in every {route} link', () => {
    const broken: string[] = [];
    for (const { where, text } of lines) {
      for (const id of linksIn(text)) if (!routeIds.has(id)) broken.push(`${where}: {${id}}`);
    }
    expect(broken).toEqual([]);
  });

  it('writes every guide, FAQ route and tour against a real screen', () => {
    for (const g of guides) expect(routeIds.has(g.route), `guide ${g.route}`).toBe(true);
    for (const f of faq) for (const id of f.routes ?? []) expect(routeIds.has(id), `faq ${f.id} -> ${id}`).toBe(true);
    for (const t of tours) {
      if (t.route) expect(routeIds.has(t.route), `tour ${t.id}`).toBe(true);
      for (const step of t.steps) if (step.route) expect(routeIds.has(step.route), `tour ${t.id} step`).toBe(true);
    }
    for (const a of articles) for (const id of a.path ?? []) expect(routeIds.has(id), `article ${a.id} -> ${id}`).toBe(true);
  });

  it('points every tour step at a `data-tour` attribute a screen carries', async () => {
    const source = await screenSource();
    /**
     * Not every attribute is a literal. The rail writes one per route
     * (`data-tour={`nav-${route.id}`}`) and the monthly screen takes its name
     * from a map of actions, so a name is accepted three ways: written out, in
     * a map or constant as a quoted string, or matching the literal prefix of a
     * template. Anything else is a target no screen can carry.
     */
    const prefixes = [...source.matchAll(/data-tour=\{`([a-z-]*)\$\{/g)].map(m => m[1]!);
    const carried = (name: string) =>
      source.includes(`data-tour="${name}"`)
      || source.includes(`'${name}'`) || source.includes(`"${name}"`)
      || prefixes.some(prefix => prefix.length > 0 && name.startsWith(prefix));
    const missing: string[] = [];
    for (const tour of tours) {
      for (const step of tour.steps) {
        if (!step.target) continue;
        // Alternatives are separated by `|`: a step may point at the rail on a
        // laptop and the menu button on a phone, so one of them is enough.
        if (!step.target.split('|').some(carried)) missing.push(`${tour.id}: ${step.target}`);
      }
    }
    expect(missing, 'a tour points at a control that is gone').toEqual([]);
  });
});

describe('help is shaped as the screens read it', () => {
  it('gives a guide to every screen somebody can actually open', () => {
    // A screen is reachable for a role when its navigation offers it *and* the
    // role is allowed it. `policies` and `scores` are reachable for nobody —
    // retired from the menu when grades became subject averages entered from the
    // ECR, and `policies` is manager-only besides, so it is hidden from the two
    // manager roles and refused to the third. Neither needs a guide. A screen a
    // role can actually open and has no guide is an oversight, which is this.
    const roles: Role[] = ['principal', 'administrative_officer', 'teacher'];
    const opens = (route: typeof routes[number], role: Role) =>
      !(route.hiddenFor ?? []).includes(role) && !('manager' in route && route.manager && role === 'teacher');
    const reachable = routes.filter(r => r.built && roles.some(role => opens(r, role))).map(r => r.id);
    const covered = new Set(guides.map(g => g.route));
    expect(reachable.filter(id => !covered.has(id)), 'a screen a role can open has no guide').toEqual([]);
  });

  it('keeps every FAQ in a group that exists, and every id unique', () => {
    const groups = new Set(editions.en.faqGroups.map(g => g.id));
    for (const f of faq) expect(groups.has(f.group), `faq ${f.id} group ${f.group}`).toBe(true);
    const ids = faq.map(f => f.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('writes What’s new newest first, with a version and a date on each', () => {
    const dates = whatsNew.map(r => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const release of whatsNew) {
      expect(release.version, release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.items.length, release.version).toBeGreaterThan(0);
    }
  });
});
