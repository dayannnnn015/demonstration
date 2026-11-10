import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The public front page's inner tabs open on a plain title.
 *
 * Asked 2026-11-10: "remove the hero section in each tab except the main one,
 * keep it simple." Announcements, Calendar, Questions and About each opened on
 * a tall dark band with the valley drawn behind the heading; that band is gone,
 * and the heading sits on the page in the page's own ink. Home keeps its
 * hillside — it is the one hero the front page has.
 *
 * (The band this replaces was fixed once already, on 2026-11-09, for drawing an
 * empty dark panel above the heading. Removing it removes that whole class of
 * fault rather than pinning it.)
 */

const css = readFileSync('web/styles/site.css', 'utf8');
const pages = readFileSync('web/site/pages.tsx', 'utf8');
const art = readFileSync('web/site/art.tsx', 'utf8');
const rule = (selector: string) => {
  const found = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!found) throw new Error(`no rule for ${selector}`);
  return found[1]!;
};

describe('the inner tabs open on a plain title', () => {
  it('draws no backdrop behind the heading', () => {
    expect(pages).not.toContain('<Valley');
    expect(art).not.toContain('export function Valley');
    expect(css).not.toContain('.page-head .valley');
  });

  it('is light, in the page’s own ink, not a dark band', () => {
    const head = rule('.page-head');
    expect(head).toContain('background: var(--white)');
    expect(head).not.toContain('var(--night)');
    expect(rule('.page-head h1')).toContain('color: var(--ink)');
  });

  it('is a title, not a banner: no tall padding', () => {
    const inner = rule('.page-head-inner');
    expect(inner).toContain('padding-block:');
    expect(inner).not.toMatch(/clamp\([^)]*\b(?:[6-9]\d|\d{3})px\)/);
  });

  it('keeps one heading per tab', () => {
    // A screen reader lands on each tab by its h1, so the plain title still is one.
    expect(pages).toMatch(/function PageHead[\s\S]*?<h1>\{title\}<\/h1>/);
  });
});

describe('Home keeps its hero', () => {
  it('still draws the hillside behind the school’s name', () => {
    expect(pages).toContain('<section className="hero home-section" id="home">');
    expect(rule('.hero-art img')).toContain('position: absolute');
    // Home's bottom padding is load-bearing: the hillside is drawn there and the words have to clear it.
    expect(rule('.hero-inner')).toContain('clamp(220px, 30vh, 320px)');
  });
});
