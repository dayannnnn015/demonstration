/**
 * What text a request may carry. PostgreSQL cannot store NUL, so before 0.74.3
 * a NUL in a learner's name answered 500; the other control characters were
 * stored and then printed into forms, CSV and Excel files.
 */

/** Any text: no control character but a tab or a line break. For writing kept in paragraphs; a CSV file is checked row by row instead. */
export const plainText = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

/**
 * A name as a form or heading prints it: one line, and no invisible formatting
 * character either. A zero-width space or a direction override would make the
 * printed name read differently from the recorded one, which the roster import
 * has refused since 2B.1.
 */
export const plainName = /^[^\p{Cc}\p{Cf}]*$/u;
export const plainNameMessage = 'Use one line of plain text, with no hidden characters.';
/** A short code a school types and a form prints, such as MATH or WW: refused in words, never by showing the pattern. */
export const shortCode = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
export const shortCodeMessage = 'Start with a letter, then use letters, digits, - or _, with no spaces, up to 24 characters.';

/** Collapses a run of spaces typed or pasted inside a name, so "Maria  Clara" is stored, printed and found as "Maria Clara". */
export const singleSpaced = (value: string) => value.replace(/ {2,}/g, ' ');

/**
 * Strips the spaces and dashes an LRN is often copied with ("1234 5678 9012",
 * "1234-5678-9012"). Only separators go: every digit stays, in order, so the
 * result is the same LRN or it is refused.
 */
export const lrnDigits = (value: string) => value.replace(/[\s-]/g, '');

/**
 * Raises the first letter of a value a person typed, and changes nothing else.
 *
 * The school asked for it (2026-11-07) after transcribing documents into the
 * registry and the academic history: a name typed "isabella", a source typed
 * "from spreadsheet". These are printed onto official forms, so the casing is
 * the school's own record and not a preference.
 *
 * **It raises, and never lowers.** "LRN", "DepEd", "ECCD" and a surname like
 * "de la Cruz" are all left exactly as typed past the first character, because
 * a rule that normalised the rest would corrupt more than it tidied. A value
 * starting with a digit or a bracket — "2015-2016", "(074) 422-1234" — has no
 * first letter to raise and is returned untouched.
 */
export const firstCapital = (value: string) => {
  const at = value.search(/\p{L}/u);
  if (at === -1) return value;
  const letter = value[at]!;
  const raised = letter.toLocaleUpperCase();
  // A script with no case, and a letter already capital, both come back as
  // they were rather than through a needless rebuild of the string.
  return raised === letter ? value : value.slice(0, at) + raised + value.slice(at + 1);
};
