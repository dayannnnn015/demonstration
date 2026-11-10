import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keyItems } from '../web/forms/sf2';

/**
 * The SF2's own codes, pinned to the school's form.
 *
 * The school's `SF2_2026_Grade 3 - A.xls` prints one line of codes, and
 * EDUNEXUS reproduces it character for character:
 *
 *   (blank) - Present; (x)- Absent; Tardy (half shaded= Upper for Late Commer,
 *   Lower for Cutting Classes)
 *
 * That line was verified against the school's file on 2026-11-09 by reading the
 * strings out of the workbook. **Its oddities are the school's and must not be
 * tidied:** `(x)-` has no space before the hyphen, `half shaded=` none before
 * the equals, and *Commer* is spelled that way on the form. The obvious
 * "improvement" here is to fix the typo, which would make an issued EDUNEXUS
 * SF2 differ from the one the principal signs. Nothing pinned any of it until
 * this file, so that correction would have passed every test.
 *
 * It matters more than a spelling: the form's code reads a **blank cell as
 * present**, so every mark EDUNEXUS draws for another reason has to be drawn
 * rather than left blank, and the extra line under the codes has to say so.
 */

const sf2 = readFileSync('web/forms/sf2.tsx', 'utf8');
const css = readFileSync('web/styles/app.css', 'utf8');

/** The codes line exactly as the school's workbook holds it. */
const CODES = '(blank) - Present; (x)- Absent; Tardy (half shaded= Upper for Late Commer, Lower for Cutting Classes)';

describe('the SF2 prints the school’s own codes', () => {
  it('carries the codes line character for character, typo included', () => {
    expect(sf2).toContain(CODES);
    // Each oddity on its own, so a failure says which one was tidied.
    expect(sf2).toContain('(x)- Absent');          // no space before the hyphen
    expect(sf2).toContain('half shaded=');          // no space before the equals
    expect(sf2).toContain('Late Commer');           // the school's spelling
    expect(sf2).not.toContain('Late Comer,');       // the tempting correction
  });

  it('prints them under the form’s own numbered headings', () => {
    // The REMARKS column tells the adviser to "refer to legend number 2", so the
    // numbering is load-bearing, not decoration.
    expect(sf2).toContain('1. CODES FOR CHECKING ATTENDANCE');
    expect(sf2).toContain('2. REASONS/CAUSES FOR NLS');
    expect(sf2).toContain('refer to legend number 2');
  });
});

describe('a mark is drawn the way the codes say', () => {
  const key = keyItems({ mixed_day: 'tardy', single_session_day: 'counts', version: 1 });
  const of = (kind: string) => key.find(k => k.kind === kind);

  it('leaves a present day blank and writes x for an absent one', () => {
    expect(of('present')).toMatchObject({ text: '', drawn: 'blank' });
    expect(of('absent')).toMatchObject({ text: 'x', drawn: 'x' });
  });

  it('draws a tardy day as a half-shaded cell, upper for late and lower for cutting', () => {
    // No text in the cell: the shading is the mark, as on the paper.
    expect(of('late')).toMatchObject({ text: '', drawn: 'upper half shaded' });
    expect(of('cutting')).toMatchObject({ text: '', drawn: 'lower half shaded' });
  });

  it('shades the correct half on screen and on paper', () => {
    // `to bottom` fills from the top edge, so the UPPER half carries the shade.
    expect(css).toMatch(/\.sf2-day\.late\s*\{[^}]*linear-gradient\(to bottom,[^}]*50%, transparent 50%\)/);
    // `to top` fills from the bottom edge, so the LOWER half carries it.
    expect(css).toMatch(/\.sf2-day\.cutting\s*\{[^}]*linear-gradient\(to top,[^}]*50%, transparent 50%\)/);
  });

  it('shades the same half in the saved Excel file', () => {
    // web/xlsx.ts takes half: 'top' | 'bottom'; the SF2 must not have them swapped.
    expect(sf2).toMatch(/cell\.mark === 'late' \? 'top' as const : 'bottom' as const/);
  });

  it('offers the tardy codes only when the school’s rule is tardy', () => {
    // With no recorded rule nothing may be presented as a decided day: the
    // mark-meanings gate is still shut for half-day credit and conversion.
    const none = keyItems(null).map(k => k.kind);
    expect(none).not.toContain('late');
    expect(none).not.toContain('cutting');
    const half = keyItems({ mixed_day: 'half_day', single_session_day: 'counts', version: 1 }).map(k => k.kind);
    expect(half).not.toContain('late');
    expect(half).toContain('half');
  });
});

describe('anything EDUNEXUS leaves blank for another reason is named', () => {
  it('says on the copy that a grey, hatched or ? cell is not present', () => {
    // The form's own code reads a blank cell as present, so this line is what
    // stops a grey or hatched cell being read as attendance.
    expect(sf2).toContain('None of them is counted as present.');
    for (const drawn of ['? in red', 'hatched', 'grey']) {
      expect(keyItems(null).map(k => k.drawn)).toContain(drawn);
    }
  });
});
