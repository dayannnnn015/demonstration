/**
 * The learning areas printed on the school's own report cards, as a proposal a
 * manager reviews before any of it reaches the subject catalog.
 *
 * Nothing here is written by itself. The catalog still seeds nothing: each row
 * becomes a subject only when a manager ticks it and gives a reason, and it is
 * then created through the same journalled endpoint as a subject typed by hand,
 * under that manager's name. Seeding these through a migration would put ten
 * subjects in the catalog that nobody chose, and leave their history unsigned.
 *
 * The rows come from five documents the school supplied on 2026-10-06 and
 * 2026-09-19 — see docs/school-forms.md. Each row says which of them print it,
 * so a disagreement between them is visible rather than settled here. A subject
 * says what a section may take. It carries no weight, component or passing mark,
 * and nothing about how its line on the card is computed.
 */

export type Form = 'sf9-g1' | 'sf9-g2' | 'sf9-g3' | 'sf9-g4-6' | 'sf10-2025';

export const formName: Record<Form, string> = {
  'sf9-g1': 'Grade 1 card',
  'sf9-g2': 'Grade 2 card',
  'sf9-g3': 'Grade 3 card',
  'sf9-g4-6': 'Grades 4–6 card',
  'sf10-2025': 'SF10 (2025)',
};

export type ReportCardArea = {
  code: string;
  /** As the documents print it. Revisable in the catalog later; the code is not. */
  name: string;
  /** Grade → the line it is printed on, counting from 1. The keys are the grades it applies to. */
  lines: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>>;
  from: Form[];
  note?: string;
  /** Grades where the documents disagree about whether a section takes it.
   *  The offering sheet leaves it unticked there, for the manager to decide. */
  disputed?: number[];
};

const cards: Form[] = ['sf9-g1', 'sf9-g2', 'sf9-g3', 'sf9-g4-6', 'sf10-2025'];
const upper: Form[] = ['sf9-g4-6', 'sf10-2025'];
const mapehPart = 'Printed beneath MAPEH, on its own line; see the MAPEH row.';
const mapeh = 'The cards print MAPEH with Music & Arts and Physical Education & Health beneath it, each on its own line. How the MAPEH line relates to the other two is grading arithmetic, which waits on the school.';

export const reportCardAreas: ReportCardArea[] = [
  { code: 'LANGUAGE', name: 'Language', lines: { 1: 1 }, from: ['sf9-g1', 'sf10-2025'] },
  { code: 'READING_LITERACY', name: 'Reading and Literacy', lines: { 1: 2 }, from: ['sf9-g1', 'sf10-2025'] },
  { code: 'FILIPINO', name: 'Filipino', lines: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }, from: ['sf9-g2', 'sf9-g3', 'sf9-g4-6', 'sf10-2025'] },
  { code: 'ENGLISH', name: 'English', lines: { 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, from: ['sf9-g2', 'sf9-g3', 'sf9-g4-6', 'sf10-2025'] },
  { code: 'MATHEMATICS', name: 'Mathematics', lines: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 }, from: cards },
  { code: 'SCIENCE', name: 'Science', lines: { 3: 4, 4: 4, 5: 4, 6: 4 }, from: ['sf9-g3', 'sf9-g4-6', 'sf10-2025'] },
  { code: 'AP', name: 'Araling Panlipunan', lines: { 4: 5, 5: 5, 6: 5 }, from: upper },
  {
    code: 'GMRC', name: 'GMRC (Good Manners and Right Conduct)', lines: { 1: 4, 2: 4, 3: 5, 4: 6, 5: 6, 6: 6 }, from: cards,
    note: 'Printed as “GMRC / Values Education” on the Grades 2 and 3 cards and as “GMRC” on the Grades 4–6 card. This name is the SF10’s.',
  },
  { code: 'MAKABANSA', name: 'Makabansa', lines: { 1: 5, 2: 5, 3: 6 }, from: ['sf9-g1', 'sf9-g2', 'sf9-g3', 'sf10-2025'] },
  {
    code: 'EPP', name: 'Edukasyong Pantahanan at Pangkabuhayan (EPP)', lines: { 4: 7, 5: 7, 6: 7 }, from: upper, disputed: [6],
    note: 'The school’s Grades 4–6 card prints EPP for Grade 6 as well. The SF10 revised in 2025 prints TLE there instead.',
  },
  {
    code: 'TLE', name: 'TLE', lines: { 6: 7 }, from: ['sf10-2025'], disputed: [6],
    note: 'Only the SF10 revised in 2025 lists it, on its Grade 6 panel, where the school’s card prints EPP.',
  },
  { code: 'MAPEH', name: 'MAPEH', lines: { 4: 8, 5: 8, 6: 8 }, from: upper, note: mapeh },
  { code: 'MUSIC_ARTS', name: 'Music & Arts', lines: { 4: 9, 5: 9, 6: 9 }, from: upper, note: mapehPart },
  { code: 'PE_HEALTH', name: 'Physical Education & Health', lines: { 4: 10, 5: 10, 6: 10 }, from: upper, note: mapehPart },
];

/** The grades a row applies to, ascending — the `grade_levels` the catalog takes. */
export const gradesOf = (area: ReportCardArea) => Object.keys(area.lines).map(Number).sort((a, b) => a - b);

/** The line a row is printed on for one grade, or undefined where that grade's card does not print it. */
export const lineOf = (row: ReportCardArea, grade: number) => row.lines[grade as keyof ReportCardArea['lines']];

/** One grade's card, line by line. Kindergarten has none: no Kindergarten card has been supplied. */
export const cardFor = (grade: number) =>
  reportCardAreas
    .filter(row => lineOf(row, grade) !== undefined)
    .sort((a, b) => lineOf(a, grade)! - lineOf(b, grade)! || a.code.localeCompare(b.code));

/** Whether the documents leave this row open for this grade. */
export const disputedFor = (row: ReportCardArea, grade: number) => (row.disputed ?? []).includes(grade);
