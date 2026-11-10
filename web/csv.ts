/**
 * Spreadsheet files built in the browser from records the screen already read.
 * Nothing is sent anywhere: the file is made here and handed to the browser to
 * save, and the reads that filled it were logged like any other.
 */
import { weekday } from './dates';
import { XWorkbook, readXlsxRows, tableWorkbook, textPx, type XStyle } from './xlsx';

/**
 * One CSV cell. Quoted when it holds a separator, and defused when it starts
 * like a spreadsheet formula: names are typed by people, and a cell beginning
 * `=` or `+` would run in Excel when someone opens the file.
 */
export const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** A file name safe on every system: letters, digits and hyphens. */
export const fileSlug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';

export function downloadCsv(name: string, text: string) {
  const link = document.createElement('a');
  // A byte-order mark, so Excel reads ñ in a learner's name as ñ.
  link.href = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

type Learner = { last_name: string; first_name: string; middle_name: string | null; name_extension: string | null; lrn?: string | null };
export type ClassRow = { status: string; enrolled_on: string; effective_on: string; learner: Learner | null };

const byName = (a: Learner | null, b: Learner | null) =>
  `${a?.last_name ?? ''} ${a?.first_name ?? ''}`.localeCompare(`${b?.last_name ?? ''} ${b?.first_name ?? ''}`);

/** The class list as a register would hold it. A missing LRN is said in words, never left blank. */
function classListTable(rows: ClassRow[]) {
  const sorted = [...rows].sort((a, b) => byName(a.learner, b.learner));
  return sorted.map((r, i) => [i + 1, r.learner?.lrn ?? 'missing', r.learner?.last_name ?? 'not readable', r.learner?.first_name ?? '', r.learner?.middle_name ?? '', r.learner?.name_extension ?? '', r.status, r.enrolled_on, r.effective_on]);
}
export function classListCsv(rows: ClassRow[]) {
  return toCsv(['no', 'lrn', 'last_name', 'first_name', 'middle_name', 'name_extension', 'status', 'enrolled_on', 'latest_change_on'], classListTable(rows));
}
/** The same list as an Excel file, the LRN and dates kept as text so Excel shows them as recorded. */
export function classListWorkbook(rows: ClassRow[], title: string) {
  return tableWorkbook({
    sheet: 'Class list', title, note: 'From EDUNEXUS. Every learner ever enrolled in the section this year, with their current status.',
    header: ['No.', 'LRN', 'Last name', 'First name', 'Middle name', 'Ext.', 'Status', 'Enrolled on', 'Latest change on'],
    rows: classListTable(rows), text: [1, 7, 8], landscape: false,
  });
}

type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended' | null;
export type RegisterDay = {
  day_on: string;
  schedule: { am: Mode; pm: Mode };
  items: (Learner & { enrollment_id: string; am: 'present' | 'absent' | null; pm: 'present' | 'absent' | null })[];
};

const cell = (mode: Mode, mark: 'present' | 'absent' | null) =>
  mode !== 'classroom' ? (mode === 'alternative_delivery' ? 'alternative delivery' : 'no class') : mark ?? 'not marked';

/**
 * A month's marks, a learner per row and a column per session. Every cell says
 * what is there: a mark, "not marked", "no class", or "not enrolled" for a date
 * the learner was not on the section's register. Nothing is counted or totalled.
 */
function registerTable(days: RegisterDay[]) {
  const learners = new Map<string, Learner>();
  for (const day of days) for (const item of day.items) if (!learners.has(item.enrollment_id)) learners.set(item.enrollment_id, item);
  const ordered = [...learners.entries()].sort((a, b) => byName(a[1], b[1]));
  return ordered.map(([id, learner]) => [
    learner.last_name, learner.first_name,
    ...days.flatMap(day => {
      const item = day.items.find(i => i.enrollment_id === id);
      return item ? [cell(day.schedule.am, item.am), cell(day.schedule.pm, item.pm)] : ['not enrolled', 'not enrolled'];
    }),
  ]);
}
export function registerCsv(days: RegisterDay[]) {
  return toCsv(['last_name', 'first_name', ...days.flatMap(d => [`${d.day_on} am`, `${d.day_on} pm`])], registerTable(days));
}
/**
 * One day's code for a learner, as the SF2 writes it: P present all day, A
 * absent all day, A/ absent in the morning, /A absent in the afternoon, and ?
 * for a session nobody marked, which is never read as present. A day with one
 * classroom session is coded by that session alone.
 */
export function dayCode(schedule: RegisterDay['schedule'], item: { am: 'present' | 'absent' | null; pm: 'present' | 'absent' | null } | undefined) {
  if (!item) return 'n.e.';
  const one = (mode: Mode, mark: 'present' | 'absent' | null) => (mode === 'alternative_delivery' ? 'AD' : mode !== 'classroom' ? null : mark === 'present' ? 'P' : mark === 'absent' ? 'A' : '?');
  const am = one(schedule.am, item.am), pm = one(schedule.pm, item.pm);
  if (am === null || pm === null) return am ?? pm ?? 'n.c.';
  if (am === pm) return am;
  if (am === 'A' && pm === 'P') return 'A/';
  if (am === 'P' && pm === 'A') return '/A';
  return `${am}/${pm}`;
}

// The SF2's own weekday letters.
const dayLetters: Record<string, string> = { Monday: 'M', Tuesday: 'T', Wednesday: 'W', Thursday: 'TH', Friday: 'F', Saturday: 'Sa', Sunday: 'Su' };

/**
 * A month's marks on one landscape page: a learner per row and a column a day
 * with the SF2's codes, the key printed under them, the names and dates printed
 * again on any further page (the group's note of 28 October: a column a session,
 * each holding a phrase, ran a month across five pages). Still nothing is
 * counted or totalled: the SF2 is the form that counts them.
 */
export function registerWorkbook(days: RegisterDay[], title: string) {
  const book = new XWorkbook();
  const sheet = book.sheet('Register');
  const learners = new Map<string, Learner>();
  for (const day of days) for (const item of day.items) if (!learners.has(item.enrollment_id)) learners.set(item.enrollment_id, item);
  const ordered = [...learners.entries()].sort((a, b) => byName(a[1], b[1]));
  const cols = 2 + days.length, border: XStyle = { border: true, size: 8 }, head: XStyle = { ...border, bold: true, align: 'center' };
  sheet.setup = { landscape: true, paper: 'a4', fitWidth: true, freeze: { rows: 4, cols: 2 }, repeat: { rows: '3:4' } };
  sheet.width(1, 4.5).width(2, 30); days.forEach((_, i) => sheet.width(3 + i, 4.6));
  sheet.merge(1, 1, 1, cols, title, { bold: true, size: 12 });
  sheet.merge(2, 1, 2, cols, 'From EDUNEXUS: the marks as recorded, one column a day of classes. Nothing here is counted or totalled; the SF2 is the form that counts them.', { italic: true, size: 8, wrap: true });
  sheet.merge(3, 1, 4, 1, 'No.', head).merge(3, 2, 4, 2, 'Learner (last name, first name)', { ...head, wrap: true });
  days.forEach((d, i) => sheet.set(3, 3 + i, Number(d.day_on.slice(8, 10)), head).set(4, 3 + i, dayLetters[weekday(d.day_on)] ?? '', { ...head, size: 7 }));
  ordered.forEach(([id, learner], r) => {
    const row = 5 + r;
    sheet.set(row, 1, r + 1, { ...border, align: 'center' }).set(row, 2, [learner.last_name, [learner.first_name, learner.middle_name, learner.name_extension].filter(Boolean).join(' ')].join(', '), { ...border, wrap: true });
    days.forEach((d, i) => {
      const code = dayCode(d.schedule, d.items.find(x => x.enrollment_id === id));
      // Not on the register that day is shaded, as the SF2 shades a date without classes; an unmarked session is not.
      sheet.set(row, 3 + i, code, { ...border, align: 'center', ...(code === 'n.e.' ? { fill: 'D9D9D9', size: 6 } : code.length > 2 ? { size: 7 } : {}) });
    });
  });
  const key = 5 + ordered.length + 1;
  sheet.merge(key, 1, key, cols, 'Key:  P = present all day   A = absent all day   A/ = absent in the morning   /A = absent in the afternoon   ? = not marked (never counted as present)   AD = alternative delivery   n.c. = no class that day   n.e. = not on this register that day (shaded)', { size: 8, italic: true, wrap: true });
  return book;
}

/** The roster import's limits, which the server enforces; the screens say so before a file is sent. */
export const MAX_BYTES = 24000;
export const MAX_ROWS = 50;

/**
 * The size of a CSV the way the API measures it: UTF-8 bytes, and data records
 * after the header with empty lines skipped. A quoted field holding a line
 * break would make this count high, which is the safe direction — the server
 * still parses the file properly and decides.
 */
export function csvStats(text: string) {
  const bytes = new TextEncoder().encode(text).length;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  return { bytes, rows: Math.max(0, lines.length - 1) };
}

/** What stops a file being sent at all, or null. */
export function csvProblem(text: string): string | null {
  if (!text.trim()) return null;
  const { bytes, rows } = csvStats(text);
  if (bytes > MAX_BYTES) return `This file is ${bytes.toLocaleString()} bytes. One import holds at most ${MAX_BYTES.toLocaleString()}; split the class into smaller files.`;
  if (rows > MAX_ROWS) return `This file has ${rows} learners. One import holds at most ${MAX_ROWS}; split it into smaller files.`;
  if (rows === 0) return 'This file has a header and no learners.';
  return null;
}

/**
 * The roster's columns, which the API requires in this order.
 *
 * This is the one frontend copy of the list `GET /roster-imports/template`
 * publishes, and `tests/registry-address.test.ts` asserts the two are equal. It
 * is a copy rather than a fetch because the template endpoint is manager-only
 * and advisers prepare class lists too, and widening a backend control to save a
 * frontend fetch is not a trade this codebase makes.
 *
 * `address` is last, and was added by migration 0053. It is the only learner
 * field beyond the name, LRN, birth date and sex that EDUNEXUS holds: any
 * further field about a child or their family waits on the school's reviewed
 * field list. A file saved from the earlier seven-column template still imports.
 */
export const ROSTER_HEADER = 'lrn,first_name,middle_name,last_name,name_extension,birth_date,sex,address,grade_level';

/** What each column holds, said in the template itself rather than only on the screen that downloads it. */
const rosterColumnNotes: Record<string, { required: boolean; note: string }> = {
  lrn: { required: true, note: 'All twelve digits, as the school’s LIS shows it, leading zeroes included. This column is already formatted as text; typed into a number column, a twelve-digit LRN becomes 1.36512E+11 and the digits are gone for good.' },
  first_name: { required: true, note: 'As the school’s own forms print it.' },
  middle_name: { required: false, note: 'Optional. Leave it empty where the learner has none recorded.' },
  last_name: { required: true, note: 'As the school’s own forms print it.' },
  name_extension: { required: false, note: 'Jr., III and the like. Optional.' },
  birth_date: { required: true, note: 'YYYY-MM-DD, for example 2017-03-14. A past date. This column is formatted as text so the day and month cannot be swapped by a regional setting.' },
  sex: { required: true, note: 'male or female, as recorded on school forms. M and F are read too.' },
  address: { required: false, note: 'One line, as the school’s own learner information writes it. Optional: an address nobody has recorded is left empty rather than guessed at, and the learner is recorded without one.' },
  grade_level: { required: false, note: 'The grade this learner is enrolling at: 0 for Kindergarten, then 1 to 6. “Kinder” and “Grade 3” are read too. One file may hold several grades, which is how a whole year group is registered at once. Leave it empty to use the grade chosen on the screen for every row — a row that is empty with no grade chosen is refused on its own line.' },
};

/**
 * The class-list template as an Excel file: the rows to fill in, what each
 * column holds, and one worked row.
 *
 * The LRN and birth-date columns are set to text before anyone types in them,
 * and the empty rows are written rather than left absent — an unstyled cell is
 * one Excel formats as a number, and the LRN typed into it loses its digits.
 * This is the template for registering the school's current learners in bulk;
 * registering one learner at a time on the registry is unchanged and is still
 * how a single child is added.
 */
export function rosterTemplateWorkbook() {
  const header = ROSTER_HEADER.split(',');
  const book = new XWorkbook();
  const sheet = book.sheet('Class list');
  const rows = 50;
  sheet.setup = { landscape: true, paper: 'a4', fitWidth: false, freeze: { rows: 3, cols: 1 } };
  sheet.merge(1, 1, 1, header.length, 'EDUNEXUS class list', { bold: true, size: 13 });
  sheet.merge(2, 1, 2, header.length,
    'One learner a row under the header, which stays exactly as it is — the columns are read by position. Read “What each column holds” before filling this in. Shaded headings are required. Up to 50 learners a file, and they need not all be at the same grade: fill in grade_level and one file can register several year groups.',
    { italic: true, size: 9, wrap: true });
  header.forEach((name, i) => sheet.set(3, i + 1, name, {
    bold: true, border: true, size: 9, wrap: true, valign: 'bottom',
    // Required and optional are told apart by colour *and* by the word in the
    // notes sheet, because colour alone says nothing to a reader who cannot see
    // it or who prints this in grey.
    fill: rosterColumnNotes[name]?.required ? 'FFE9C7' : 'F2F2F2',
  }));
  const text = new Set(['lrn', 'birth_date']);
  for (let r = 0; r < rows; r++) header.forEach((name, c) => sheet.set(4 + r, c + 1, null, { border: true, size: 9, ...(text.has(name) ? { format: '@' as const } : {}) }));
  const sex = header.indexOf('sex') + 1;
  sheet.allow(4, sex, 3 + rows, sex, { kind: 'list', values: ['male', 'female'] }, 'male or female', 'Type male or female, as recorded on school forms.');
  // Kindergarten is 0 here, as it is everywhere else in EDUNEXUS. The list is
  // what Excel offers; the importer also reads "Kinder" and "Grade 3", so a
  // file typed by hand outside this template is still read.
  const grade = header.indexOf('grade_level') + 1;
  sheet.allow(4, grade, 3 + rows, grade, { kind: 'list', values: ['0', '1', '2', '3', '4', '5', '6'] },
    '0 for Kindergarten, then 1 to 6', 'Type 0 for Kindergarten, or 1 to 6. Leave it empty to use the grade chosen on the screen.');
  header.forEach((name, c) => {
    const widest = Math.max(...name.split('_').map(word => textPx(word, 9, true)),
      // The grade's own values are one character, so the heading is what has
      // to fit: measured whole rather than by its widest word.
      textPx(name === 'address' ? 'Purok 4, Balili, La Trinidad, Benguet' : name === 'birth_date' ? '0000-00-00' : name === 'grade_level' ? 'grade_level' : '000000000000', 9));
    sheet.width(c + 1, Math.min(44, Math.max(8, Math.ceil((widest + 6) / 7) + 1)));
  });

  const notes = book.sheet('What each column holds');
  notes.setup = { landscape: false, paper: 'a4', fitWidth: true };
  notes.width(1, 22); notes.width(2, 13); notes.width(3, 76);
  notes.merge(1, 1, 1, 3, 'EDUNEXUS class list', { bold: true, size: 13 });
  notes.merge(2, 1, 2, 3, 'Fill the rows in on the “Class list” sheet, then choose the file on Roster import. A manager reviews it before any learner is created.', { italic: true, size: 9, wrap: true });
  notes.set(4, 1, 'Column', { bold: true, border: true, size: 9, fill: 'F2F2F2' });
  notes.set(4, 2, 'Required?', { bold: true, border: true, size: 9, fill: 'F2F2F2' });
  notes.set(4, 3, 'What goes in it', { bold: true, border: true, size: 9, fill: 'F2F2F2' });
  header.forEach((name, i) => {
    const about = rosterColumnNotes[name];
    notes.set(5 + i, 1, name, { border: true, size: 9, valign: 'top' });
    notes.set(5 + i, 2, about?.required ? 'Required' : 'Optional', { border: true, size: 9, valign: 'top', bold: !!about?.required });
    notes.set(5 + i, 3, about?.note ?? '', { border: true, size: 9, wrap: true, valign: 'top' });
  });
  const example: Record<string, string> = {
    lrn: '136170000001', first_name: 'Ana', middle_name: 'Bautista', last_name: 'Reyes', name_extension: '',
    birth_date: '2017-05-02', sex: 'female', address: 'Purok 4, Balili, La Trinidad, Benguet', grade_level: '3',
  };
  const at = 5 + header.length + 1;
  notes.merge(at, 1, at, 3, 'One row, as it would be typed:', { bold: true, size: 10 });
  header.forEach((name, i) => {
    notes.set(at + 1 + i, 1, name, { border: true, size: 9, valign: 'top' });
    notes.merge(at + 1 + i, 2, at + 1 + i, 3, example[name] || '(left empty)', { border: true, size: 9, wrap: true, valign: 'top', italic: !example[name] });
  });
  return book;
}

/**
 * A chosen class-list file as the CSV text the API reads. A CSV is read as it
 * is. An Excel file is read cell by cell from its header row down, so a typed
 * date becomes YYYY-MM-DD and an LRN keeps every digit; the API then checks the
 * rows exactly as it checks a CSV.
 */
export async function rosterFileText(file: File) {
  if (!/\.xlsx$/i.test(file.name)) return file.text();
  const rows = await readXlsxRows(await file.arrayBuffer(), 'Class list');
  const full = ROSTER_HEADER.split(',');
  const matches = (row: string[] | undefined, header: string[]) => header.every((h, i) => (row?.[i] ?? '').trim().toLowerCase() === h);
  // The current template, or the one before `address` was added. The API reads
  // both, so a file somebody already filled in is not refused here either.
  const earlier = full.slice(0, 7);
  const top = rows.findIndex(r => matches(r, full) || matches(r, earlier));
  if (top < 0) throw new Error(`This Excel file has no header row reading ${ROSTER_HEADER}. Start from the template, and keep its header row as it is.`);
  const header = matches(rows[top], full) ? full : earlier;
  const learners = rows.slice(top + 1).map(r => header.map((_, i) => r[i] ?? '')).filter(r => r.some(Boolean));
  return [header.join(','), ...learners.map(r => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
