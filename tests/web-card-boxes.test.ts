import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Grade 1 card's narrative boxes keep a stated height.
 *
 * This is a guard, not the verification. Box geometry cannot be checked in
 * happy-dom, which computes no layout, so the real measurement is
 * `.local/sf9-print/boxes.tsx` — it renders the card in real Chrome with the
 * print stylesheet emulated at A4-less-6mm and reads the boxes' own rects. On
 * 2026-11-05 it reported 23mm for all six boxes and one sheet across short,
 * long and empty remarks.
 *
 * What this file is for is the thing that would quietly undo it: someone
 * tidying the stylesheet back to a content-sized box. Two attempts were
 * measured and rejected on the way here — `min-height` (the original fault,
 * 248px and 275px boxes for a long remark, and a second sheet) and an equal
 * *share* of the column (equal to each other, but 98px against 90px, because a
 * grid row takes its height from its items' max-content). Only an absolute
 * height held in all three cases.
 */

const css = readFileSync('web/styles/app.css', 'utf8');
const rule = (selector: string) => {
  const at = css.indexOf(selector + ' {');
  if (at === -1) return null;
  return css.slice(at, css.indexOf('}', at) + 1);
};

describe('the Grade 1 report card’s remark boxes', () => {
  it('states an absolute height, so the box cannot follow its content', () => {
    const box = rule('.paper.sf9-grade1 .card-comment');
    expect(box).toBeTruthy();
    // An absolute unit: a share of the page would move with the content beside it.
    expect(box).toMatch(/height:\s*\d+(\.\d+)?(mm|pt|in)\s*;/);
    // Not a floor that content can push past, which is what it used to be.
    expect(box).not.toMatch(/min-height:\s*\d/);
    // And a remark longer than the box stays inside its border.
    expect(box).toMatch(/overflow:\s*hidden/);
  });

  it('does not let the shared print floor put the box back on its content', () => {
    // `.print-root .card-comment { min-height: 2.2rem }` applies to every card,
    // so this one has to opt out or the floor becomes the height again.
    expect(css).toMatch(/\.print-root\.sf9-g1 \.card-comment \{[^}]*min-height:\s*0/);
  });

  it('spreads the three terms down the column instead of stacking them at the top', () => {
    const column = rule('.paper.sf9-grade1 .card-columns > div:first-child');
    expect(column).toBeTruthy();
    expect(column).toMatch(/justify-content:\s*space-between/);
    // A margin under every term is a gap under the last one too, which is the
    // unused space at the bottom of the page this replaced.
    expect(rule('.paper.sf9-grade1 .card-term')).toMatch(/margin-bottom:\s*0/);
  });

  it('leaves the Grades 2-3 and 4-6 cards alone', () => {
    // They are a different layout on landscape paper, tuned in their own print
    // pass. Every rule added here is scoped to the Grade 1 card.
    for (const selector of ['.paper.sf9-grade1 .card-comment', '.paper.sf9-grade1 .card-term']) {
      expect(rule(selector)).toBeTruthy();
    }
    expect(css).not.toMatch(/\.paper\.sf9-grades2_3 \.card-comment \{[^}]*height:\s*23mm/);
    expect(css).not.toMatch(/\.paper\.sf9-grades4_6 \.card-comment \{[^}]*height:\s*23mm/);
  });
});

/**
 * Two small fixes to screens that staff type into all day (0.90.8).
 *
 * Both are CSS or markup rather than behaviour, so this is a guard against a
 * tidy-up undoing them, not a measurement.
 */
describe('the boxes a historical grade is typed into', () => {
  it('is wide enough for a grade, with the number spinner out of the way', () => {
    const cell = rule('.grid-form td.grade-cell');
    expect(cell).toBeTruthy();
    // 4.5rem left room for barely two digits once the field's padding and the
    // spinner had taken theirs: 88 fitted, 88.5 did not.
    const width = /width:\s*([\d.]+)rem/.exec(cell ?? '');
    expect(width, 'the grade column states a width').toBeTruthy();
    expect(Number(width![1])).toBeGreaterThanOrEqual(5.5);
    // The spinner is worth about 17px of the narrowest box on the screen, and
    // nobody steps a grade by 0.01.
    expect(css).toMatch(/\.grid-form td\.grade-cell input\[type='number'\][^{]*\{[^}]*appearance: textfield/);
    expect(css).toMatch(/-webkit-inner-spin-button \{[^}]*appearance: none/);
  });
});

describe('moving between learners on the report card', () => {
  it('uses arrows, and still says which is which to a screen reader', () => {
    const editor = readFileSync('web/screens/CardEditor.tsx', 'utf8');
    // The words crowded the row beside the learner picker; the month nav on the
    // forms is the same control and has been arrows since it was built.
    expect(editor).toMatch(/aria-label="Previous learner"[\s\S]{0,200}?<Icon name="back"/);
    expect(editor).toMatch(/aria-label="Next learner"[\s\S]{0,200}?<Icon name="forward"/);
    // An icon-only button with no name is unusable with a screen reader, which
    // `tests/web-buttons.test.ts` gates for the whole workspace.
    expect(editor).toContain('title="Previous learner"');
    expect(editor).toContain('title="Next learner"');
  });
});

describe('the year a historical record began', () => {
  it('accepts any school year from 1990, and its hint does not read as a floor', () => {
    const screen = readFileSync('web/screens/PriorRecords.tsx', 'utf8');
    const field = /\{ key: 'start_year',[\s\S]*?\},/.exec(screen)?.[0] ?? '';
    // Since 0.95.4–0.102.2 the year is typed as four digits beside the year it ended, so the floor is the
    // server's: the contract refuses anything before 1990.
    expect(field).toContain("pattern: '[0-9]{4}'");
    expect(readFileSync('src/modules/prior-records/contracts.ts', 'utf8')).toMatch(/start_year:z\.number\(\)\.int\(\)\.min\(1990/);
    // The hint used 2024 as its worked example, and an example in the position
    // of a rule reads as one. The server's own range is 1990 to this year.
    expect(field).not.toMatch(/2024/);
    expect(field).toContain('Any year from 1990 to this one');
  });
});

/**
 * My profile says which account you are signed in as (0.90.9).
 *
 * A school with shared staffroom computers is exactly where "whose account am
 * I in?" is a real question, and it was the one identity fact My profile did
 * not carry. It comes from the open session rather than from `/me`, because
 * the address lives on `auth.users`, which the API deliberately cannot read —
 * the service-role key is confined to one Edge Function. So there is no
 * endpoint, no column and no migration, and nothing is stored.
 */
describe('the account My profile is signed in as', () => {
  it('is read from the session and shown, never fetched or stored', () => {
    const app = readFileSync('web/App.tsx', 'utf8');
    const profile = readFileSync('web/screens/Profile.tsx', 'utf8');
    // Straight off the open session.
    expect(app).toMatch(/client\?\.auth\.getSession\(\)/);
    expect(app).toMatch(/last_sign_in_at/);
    // Carried on the tools every screen already receives, not a new prop chain.
    expect(readFileSync('web/routes.tsx', 'utf8')).toContain('signedInAs?: {');
    expect(profile).toContain('Signed in as');
    // Absent is drawn, never blank — the workspace's own rule, and this value
    // is genuinely absent in a view with no session behind it.
    expect(profile).toMatch(/signedInAs\?\.email[\s\S]{0,200}?Unrecorded/);
  });

  it('adds no endpoint and no stored field for it', () => {
    // The address is not ours to keep: it belongs to the sign-in service.
    const contracts = readFileSync('src/modules/foundation/contracts.ts', 'utf8');
    expect(contracts).not.toMatch(/signedInAs|last_sign_in_at/);
    // Nor is it a column anywhere: it belongs to the sign-in service. (This
    // once pinned the project's whole migration count, which said nothing
    // about this change and broke the moment an unrelated migration landed.)
    const sql = readFileSync('database/migrations/0043_staff_profiles.sql', 'utf8');
    expect(sql).not.toMatch(/email|last_sign_in/);
  });
});
