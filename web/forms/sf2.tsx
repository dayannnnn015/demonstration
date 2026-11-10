import type { ReactNode } from 'react';
import { dayAndMonth, monthName, monthOf } from '../dates';
import { XWorkbook, type XStyle } from '../xlsx';
import { days, levelName, percent, schoolYearLabel, two, type Session, type Sf2Cell, type Sf2Form, type Trio, type MaybeTrio } from './types';

// The SF2 as the school's LIS-generated template (version 2014.2.1.1) lays it
// out: learners males first, each block closed by its per-day total, a combined
// total, the guidelines and legends, the monthly summary, and the two signatures.

const codes = '(blank) - Present; (x)- Absent; Tardy (half shaded= Upper for Late Commer, Lower for Cutting Classes)';
const guidelines = [
  '1. The attendance shall be accomplished daily. Refer to the codes for checking learners’ attendance.',
  '2. Dates shall be written in the columns after Learner’s Name.',
  '3. To compute the following:',
];
const formulas: [string, string, string, string][] = [
  ['a. Percentage of Enrolment =', 'Registered Learners as of end of the month', 'Enrolment as of 1st Friday of the school year', 'x 100'],
  ['b. Average Daily Attendance =', 'Total Daily Attendance', 'Number of School Days in reporting month', ''],
  ['c. Percentage of Attendance for the month =', 'Average daily attendance', 'Registered Learners as of end of the month', 'x 100'],
];
const later = [
  '4. Every end of the month, the class adviser will submit this form to the office of the principal for recording of summary table into School Form 4. Once signed by the principal, this form should be returned to the adviser.',
  '5. The adviser will provide neccessary interventions including but not limited to home visitation to learner/s who were absent for 5 consecutive days and/or those at risk of dropping out.',
  '6.  Attendance performance of learners will be reflected in Form 137 and Form 138 every grading period.',
];
const cutoffNote = '*Beginning of School Year cut-off report is every 1st Friday of the School Year';
const reasons: [string, string[]][] = [
  ['a. Domestic-Related Factors', ['a.1. Had to take care of siblings', 'a.2. Early marriage/pregnancy', 'a.3. Parents’ attitude toward schooling', 'a.4. Family problems']],
  ['b. Individual-Related Factors', ['b.1. Illness', 'b.2. Overage', 'b.3. Death', 'b.4. Drug Abuse', 'b.5. Poor academic performance', 'b.6. Lack of interest/Distractions', 'b.7. Hunger/Malnutrition']],
  ['c. School-Related Factors', ['c.1. Teacher Factor', 'c.2. Physical condition of classroom', 'c.3. Peer influence']],
  ['d. Geographic/Environmental', ['d.1. Distance between home and school', 'd.2. Armed conflict (incl. Tribal wars & clanfeuds)', 'd.3. Calamities/Disasters']],
  ['e. Financial-Related', ['e.1. Child labor, work']],
  ['f. Others (Specify)', []],
];
const remarksHead = 'REMARKS (If DROPPED OUT, state reason, please refer to legend number 2. If TRANSFERRED IN/OUT, write the name of School.)';
// The form's own code reads a blank cell as present, so anything EDUNEXUS leaves blank for another reason is drawn and named.
const drawnHere = 'On this copy: a grey column had no classes; a hatched cell is a day still to come; ? is a session nobody marked. None of them is counted as present.';

/** The colours the screen draws a mark in, so the saved file is the same form and not a second one. */
const SHADE = '6B6B6B', HATCH = 'A6A6A6', NO_CLASS = 'D9D9D9', TOTALS = 'F2F2F2', UNMARKED = 'A52222', UNMARKED_EDGE = 'C02B2B', WAITING = '444444';

export type Sf2KeyItem = {
  /** The cell class on screen, which is also what names its drawing to a reader. */
  kind: string;
  /** What the cell itself shows, if anything. */
  text: string;
  /** How a reader recognises it where there is no character to show. */
  drawn: string;
  words: string;
};
/**
 * What every mark on this SF2 means, in the school's own words.
 *
 * The key printed beside the form, the key written into the saved Excel file
 * and the legend under the paper copy are all this one list. A file a parent is
 * handed must not explain itself differently from the screen it was saved from,
 * and two lists would eventually do exactly that.
 */
export function keyItems(rule: Sf2Form['rule'], editing = false): Sf2KeyItem[] {
  const item = (kind: string, text: string, drawn: string, words: string): Sf2KeyItem => ({ kind, text, drawn, words });
  return [
    item('present', '', 'blank', 'Present all day'),
    item('absent', 'x', 'x', 'Absent all day'),
    ...(rule?.mixed_day === 'tardy' ? [
      item('late', '', 'upper half shaded', 'Late: missed the morning (tardy, counted present)'),
      item('cutting', '', 'lower half shaded', 'Cutting classes: missed the afternoon (tardy, counted present)'),
    ] : rule?.mixed_day === 'half_day' ? [item('half', '½', '½', 'Present for half the day')] : []),
    ...(!rule || editing ? [
      item('waiting', 'A/', 'A/', 'Absent in the morning only'),
      item('waiting', '/A', '/A', 'Absent in the afternoon only'),
    ] : []),
    item('unmarked', '?', '? in red', 'Not marked: nobody recorded it yet, so it counts as neither'),
    item('pending', '', 'hatched', 'A day still to come'),
    item('off', '', 'grey', 'No classes that day, or not in the section yet'),
  ];
}

/** "Total for the Month", or while days of classes are still to come, the total so far. */
export const totalHead = (form: Sf2Form) => (form.to_date ? `Total to ${dayAndMonth(form.to_date.as_of)}` : 'Total for the Month');
/** What the summary's figures cover, said on the form itself while the month is not over. */
export const toDateNote = (form: Sf2Form) => (form.to_date
  ? `The month is not over: figures to ${dayAndMonth(form.to_date.as_of)}, ${form.to_date.days_held} of ${form.summary.days_of_classes} days of classes held.`
  : '');

/** What one learner's cell shows. Without a rule each half shows its own session, so nothing reads as a decided day. */
function cellText(cell: Sf2Cell | undefined) {
  if (!cell || cell === 'out' || cell === 'no_class') return '';
  switch (cell.mark) {
    case 'absent': return 'x';
    case 'half': return '½';
    case 'unmarked': return '?';
    case 'waiting': {
      const half = (m: typeof cell.am) => (m === 'absent' ? 'A' : m === null ? '?' : '');
      return cell.am === 'present' && cell.pm === 'present' ? '' : `${half(cell.am)}/${half(cell.pm)}`;
    }
    default: return '';
  }
}
const cellName: Partial<Record<Exclude<Sf2Cell, string>['mark'], string>> = {
  late: 'Tardy, late comer', cutting: 'Tardy, cutting classes', unmarked: 'Not marked', pending: 'Still to come', half: 'Half a day present',
};
export type Pair = { am: Session; pm: Session };
/**
 * Editing on the form. Marks typed here are the register's own marks: they are
 * held on the page, reviewed, and recorded through the register's API, a date
 * at a time, so every check the register makes still applies.
 */
export type Sf2Edit = {
  pending: (enrollmentId: string, day: string) => Pair | undefined;
  cycle: (enrollmentId: string, day: string, now: Pair) => void;
  set: (enrollmentId: string, day: string, to: Pair) => void;
  editable: (day: string, cell: Sf2Cell | undefined) => boolean;
  remark?: { value: (enrollmentId: string) => string; set: (enrollmentId: string, text: string) => void; changed: (enrollmentId: string) => boolean; fixed: (enrollmentId: string) => string[] } | undefined;
};
/** A click moves a cell on: present all day, absent all day, absent in the morning, absent in the afternoon, and round again. */
export function nextPair(now: Pair): Pair {
  if (now.am === null || now.pm === null) return { am: 'present', pm: 'present' };
  if (now.am === 'present' && now.pm === 'present') return { am: 'absent', pm: 'absent' };
  if (now.am === 'absent' && now.pm === 'absent') return { am: 'absent', pm: 'present' };
  if (now.am === 'absent') return { am: 'present', pm: 'absent' };
  return { am: 'present', pm: 'present' };
}
export const pairWords = (p: Pair) => (p.am === null && p.pm === null ? 'not marked' : p.am === p.pm ? (p.am === 'absent' ? 'absent all day' : p.am === 'present' ? 'present all day' : 'not marked')
  : `${p.am === 'absent' ? 'absent' : p.am === 'present' ? 'present' : 'not marked'} in the morning, ${p.pm === 'absent' ? 'absent' : p.pm === 'present' ? 'present' : 'not marked'} in the afternoon`);
/** What a key typed on a cell marks: the SF2's own x, p for present (a blank cell on the form), and m or a for the one session missed. */
export const typedPair: Record<string, Pair> = {
  x: { am: 'absent', pm: 'absent' }, p: { am: 'present', pm: 'present' }, Delete: { am: 'present', pm: 'present' }, Backspace: { am: 'present', pm: 'present' },
  m: { am: 'absent', pm: 'present' }, a: { am: 'present', pm: 'absent' },
};
/** The next editable cell from this one, the way a spreadsheet moves: rows skip the totals, which have no button. */
function nextCell(from: HTMLElement, key: string): HTMLButtonElement | null {
  const td = from.closest('td'), tr = td?.closest('tr');
  if (!td || !tr) return null;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    let at: Element | null = td;
    while ((at = key === 'ArrowLeft' ? at.previousElementSibling : at.nextElementSibling)) { const b = at.querySelector<HTMLButtonElement>(':scope > button'); if (b) return b; }
    return null;
  }
  let row: Element | null = tr;
  while ((row = key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling)) {
    const b = (row as HTMLTableRowElement).cells?.[td.cellIndex]?.querySelector<HTMLButtonElement>(':scope > button');
    if (b) return b;
  }
  return null;
}
const pairText = (p: Pair) => (p.am === 'absent' && p.pm === 'absent' ? 'x' : p.am === 'absent' ? 'A/' : p.pm === 'absent' ? '/A' : p.am === null || p.pm === null ? '?' : '');

function DayCell({ cell, edit, id, day, name }: { cell: Sf2Cell | undefined; edit?: Sf2Edit | undefined; id: string; day: string; name: string }) {
  if (!cell || cell === 'out' || cell === 'no_class') return <td className="sf2-day off" />;
  if (edit?.editable(day, cell)) {
    const pending = edit.pending(id, day), now = pending ?? { am: cell.am, pm: cell.pm };
    return (
      <td className={`sf2-day editable${pending ? ' edited' : ` ${cell.mark}`}`}>
        <button type="button" aria-label={`${name}, ${dayAndMonth(day)}: ${pairWords(now)}${pending ? ', changed' : ''}. Press to change, or type x, p, m or a.`} title={pairWords(now)}
          onClick={() => edit.cycle(id, day, now)}
          onKeyDown={event => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const typed = typedPair[event.key.length === 1 ? event.key.toLowerCase() : event.key];
            const move = typed ? 'ArrowDown' : event.key.startsWith('Arrow') ? event.key : '';
            if (!typed && !move) return;
            event.preventDefault();
            if (typed) edit.set(id, day, typed);
            // A typed mark moves down to the next learner on the same day, as a register is taken.
            nextCell(event.currentTarget, move)?.focus();
          }}>{pending ? pairText(pending) : cellText(cell)}</button>
      </td>
    );
  }
  const name_ = cellName[cell.mark];
  return <td className={`sf2-day ${cell.mark}`} aria-label={name_} title={name_}>{cellText(cell)}</td>;
}

/**
 * What each cell means, in words, beside the form. The SF2's own code reads a
 * blank cell as present, which nobody guesses; this key says it plainly, with
 * a sample cell drawn exactly as the form draws it, and lists only the codes
 * this school's rule can produce.
 */
export function Sf2Key({ rule, editing = false }: { rule: Sf2Form['rule']; editing?: boolean }) {
  return (
    <div className="sf2-key" role="note" aria-label="What the marks on this SF2 mean">
      <b>What the marks mean</b>
      <ul>{keyItems(rule, editing).map(({ kind, text, words }) => <li key={words}><span className={`sf2-day ${kind}`} aria-hidden="true">{text}</span>{words}</li>)}</ul>
    </div>
  );
}

const trioCells = (t: Trio | MaybeTrio | null, show: (n: number | null) => string = n => (n === null ? '' : String(n))) =>
  [t?.male ?? null, t?.female ?? null, t?.total ?? null].map((n, i) => <td key={i} className="numeric">{show(n)}</td>);

export function Sf2Sheet({ form, footer, edit }: { form: Sf2Form; footer?: ReactNode; edit?: Sf2Edit | undefined }) {
  const males = form.learners.filter(l => l.sex === 'male'), females = form.learners.filter(l => l.sex === 'female');
  const daily = new Map(form.daily.map(d => [d.day_on, d]));
  const month = monthName(monthOf(form.month_on));
  const s = form.summary;
  const block = (rows: Sf2Form['learners'], label: string, key: 'male' | 'female') => (
    <>
      {rows.map(l => (
        <tr key={l.enrollment_id}>
          <td className="numeric">{l.no}</td>
          <td className="sf2-name">{l.name}</td>
          {form.columns.map(c => <DayCell key={c.day_on} cell={l.days[c.day_on]} edit={edit} id={l.enrollment_id} day={c.day_on} name={l.name} />)}
          <td className="numeric">{days(l.absent)}</td>
          <td className="numeric">{days(l.present)}</td>
          {edit?.remark ? (
            <td className={`sf2-remarks editable${edit.remark.changed(l.enrollment_id) ? ' edited' : ''}`}>
              {edit.remark.fixed(l.enrollment_id).length ? <span>{edit.remark.fixed(l.enrollment_id).join('; ')}</span> : null}
              <input aria-label={`Remark for ${l.name}`} maxLength={500} value={edit.remark.value(l.enrollment_id)} onChange={event => edit.remark!.set(l.enrollment_id, event.target.value)} />
            </td>
          ) : <td className="sf2-remarks">{l.remarks.join('; ')}</td>}
        </tr>
      ))}
      <tr className="sf2-total">
        <td className="numeric">{rows.length}</td>
        <td>{label}</td>
        {form.columns.map(c => <td key={c.day_on} className={`numeric${c.kind === 'class' ? '' : ' off'}`}>{days(daily.get(c.day_on)?.[key])}</td>)}
        <td /><td /><td />
      </tr>
    </>
  );
  return (
    <div className="paper sf2">
      <h2>School Form 2 (SF2) Daily Attendance Report of Learners</h2>
      <p className="paper-sub">(This replaces Form 1, Form 2 &amp; STS Form 4 - Absenteeism and Dropout Profile)</p>
      <table className="paper-fields">
        <tbody>
          <tr><th>School ID</th><td>{form.school.school_code ?? ''}</td><th>School Year</th><td>{schoolYearLabel(form.school_year.start_year)}</td><th>Report for the Month of</th><td>{month}</td></tr>
          <tr><th>Name of School</th><td>{form.school.name}</td><th>Grade Level</th><td>{levelName(form.section.grade_level)}</td><th>Section</th><td>{form.section.name}</td></tr>
        </tbody>
      </table>
      <div className="paper-scroll">
        <table className="paper-grid sf2-grid">
          <thead>
            <tr>
              <th rowSpan={2}>No.</th>
              <th rowSpan={2}>NAME<br />(Last Name, First Name, Middle Name)</th>
              {form.columns.map(c => <th key={c.day_on} className={c.kind === 'class' ? 'sf2-date' : 'sf2-date off'}>{c.date}</th>)}
              <th colSpan={2}>{totalHead(form)}</th>
              <th rowSpan={2} className="sf2-remarks">{remarksHead}</th>
            </tr>
            <tr>
              {form.columns.map(c => <th key={c.day_on} className={c.kind === 'class' ? 'sf2-date' : 'sf2-date off'}>{c.weekday}</th>)}
              <th>ABSENT</th><th>PRESENT</th>
            </tr>
          </thead>
          <tbody>
            {block(males, '<=== MALE | TOTAL Per Day ===>', 'male')}
            {block(females, '<=== FEMALE | TOTAL Per Day ===>', 'female')}
            <tr className="sf2-total">
              <td className="numeric">{form.learners.length}</td>
              <td>Combined TOTAL PER DAY</td>
              {form.columns.map(c => <td key={c.day_on} className={`numeric${c.kind === 'class' ? '' : ' off'}`}>{days(daily.get(c.day_on)?.total)}</td>)}
              <td /><td /><td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sf2-foot">
        <div className="sf2-guidelines">
          <p><b>GUIDELINES:</b></p>
          {guidelines.map(g => <p key={g}>{g}</p>)}
          {formulas.map(([label, top, bottom, times]) => (
            <div key={label} className="sf2-formula"><span>{label}</span><span className="fraction"><span>{top}</span><span>{bottom}</span></span><span>{times}</span></div>
          ))}
          {later.map(g => <p key={g}>{g}</p>)}
          <p>{cutoffNote}</p>
        </div>
        <div className="sf2-codes">
          <p><b>1. CODES FOR CHECKING ATTENDANCE</b></p>
          <p>{codes}</p>
          <p className="sf2-drawn">{drawnHere}</p>
          <p><b>2. REASONS/CAUSES FOR NLS</b></p>
          {reasons.map(([group, items]) => <div key={group}><p><b>{group}</b></p>{items.map(i => <p key={i}>{i}</p>)}</div>)}
        </div>
        <div className="sf2-summary">
          <table className="paper-grid">
            <thead>
              <tr><th>Month: {month}</th><th colSpan={3}>No. of Days of Classes: {s.days_of_classes}</th></tr>
              {form.to_date ? <tr><th colSpan={4} className="sf2-to-date">{toDateNote(form)}</th></tr> : null}
              <tr><th>Summary</th><th>M</th><th>F</th><th>TOTAL</th></tr>
            </thead>
            <tbody>
              <tr><td>* Enrolment as of (1st Friday of the school year, {form.cutoff})</td>{trioCells(s.enrolment_at_cutoff)}</tr>
              <tr><td>Late enrolment during the month (beyond cut-off)</td>{trioCells(s.late_enrolment)}</tr>
              <tr><td>Registered Learners as of end of month</td>{trioCells(s.registered)}</tr>
              <tr><td>Percentage of Enrolment as of end of month</td>{trioCells(s.percentage_of_enrolment, percent)}</tr>
              <tr><td>Average Daily Attendance</td>{trioCells(s.average_daily_attendance, two)}</tr>
              <tr><td>Percentage of Attendance for the month</td>{trioCells(s.percentage_of_attendance, percent)}</tr>
              <tr><td>Number of students absent for 5 consecutive days</td>{trioCells(s.absent_five_consecutive)}</tr>
              <tr><td>Dropped out</td>{trioCells(s.dropped_out)}</tr>
              <tr><td>Transferred out</td>{trioCells(s.transferred_out)}</tr>
              <tr><td>Transferred in</td>{trioCells(s.transferred_in)}</tr>
            </tbody>
          </table>
          <div className="paper-signatures">
            <p>I certify that this is a true and correct report.</p>
            <p className="signature-name">{form.section.adviser_name ?? ''}</p>
            <p className="signature-label">(Signature of Adviser over Printed Name)</p>
            <p>Attested by:</p>
            <p className="signature-name">{form.school.school_head_name ?? ''}</p>
            <p className="signature-label">(Signature of School Head over Printed Name)</p>
          </div>
        </div>
      </div>
      {footer ? <p className="print-foot">{footer}</p> : null}
    </div>
  );
}

/**
 * The same form as an Excel sheet, laid out on the template's grid so it prints
 * as the school's template does: A4 landscape, the foot kept on one page. Every label sits in a block wide enough to read it:
 * the summary's labels span the date columns and its figures take the wider
 * total and remarks columns, so nothing is squeezed into a narrow day column.
 */
export function sf2Workbook(form: Sf2Form, footer?: string) {
  const book = new XWorkbook();
  const sheet = book.sheet('SF2');
  const border: XStyle = { border: true, size: 8 }, head: XStyle = { ...border, bold: true, align: 'center', wrap: true }, num: XStyle = { ...border, align: 'center' };
  const off: XStyle = { ...border, fill: NO_CLASS };
  const n = form.columns.length, absentCol = 3 + n, presentCol = absentCol + 1, remarksCol = presentCol + 1;
  // A4 landscape, as the school's own SF2 template is set to print.
  sheet.setup = { landscape: true, paper: 'a4', fitWidth: true, freeze: { rows: 7, cols: 2 } };
  sheet.width(1, 4.5).width(2, 32); form.columns.forEach((_, i) => sheet.width(3 + i, 3.8)); sheet.width(absentCol, 9).width(presentCol, 9).width(remarksCol, 32);
  sheet.merge(1, 1, 1, remarksCol, 'School Form 2 (SF2) Daily Attendance Report of Learners', { bold: true, size: 14, align: 'center' });
  sheet.merge(2, 1, 2, remarksCol, '(This replaces Form 1, Form 2 & STS Form 4 - Absenteeism and Dropout Profile)', { italic: true, size: 8, align: 'center' });
  const month = monthName(monthOf(form.month_on));
  // The header's three fields a row, each a label beside its bold value, in blocks that share the width out.
  const a = 2 + Math.max(1, Math.floor(n * 0.4)), b = Math.min(absentCol - 1, a + Math.max(1, Math.floor(n * 0.3)));
  const field = (label: string, value: string) => ({ rich: [{ text: `${label}  ` }, { text: value, bold: true }] });
  const fieldStyle: XStyle = { size: 9, wrap: true };
  sheet.merge(3, 1, 3, a, field('School ID', form.school.school_code ?? ''), fieldStyle)
    .merge(3, a + 1, 3, b, field('School Year', schoolYearLabel(form.school_year.start_year)), fieldStyle)
    .merge(3, b + 1, 3, remarksCol, field('Report for the Month of', month), fieldStyle);
  sheet.merge(4, 1, 4, a, field('Name of School', form.school.name), fieldStyle)
    .merge(4, a + 1, 4, b, field('Grade Level', levelName(form.section.grade_level)), fieldStyle)
    .merge(4, b + 1, 4, remarksCol, field('Section', form.section.name), fieldStyle);
  // The key, in the template's empty row: a blank cell is the form's code for present, which nobody guesses.
  // The same list the screen's key shows, so the file says exactly what it was saved from.
  sheet.merge(5, 1, 5, remarksCol, `Key:   ${keyItems(form.rule).map(k => `${k.drawn} = ${k.words}`).join('   ')}`, { size: 8, italic: true, wrap: true });
  let row = 6;
  sheet.merge(row, 1, row + 1, 1, 'No.', head).merge(row, 2, row + 1, 2, 'NAME\n(Last Name, First Name, Middle Name)', head);
  form.columns.forEach((c, i) => {
    const shade = c.kind === 'class' ? {} : { fill: 'D9D9D9' };
    sheet.set(row, 3 + i, c.date, { ...head, ...shade }).set(row + 1, 3 + i, c.weekday, { ...head, size: 7, ...shade });
  });
  sheet.merge(row, absentCol, row, presentCol, totalHead(form), head).set(row + 1, absentCol, 'ABSENT', head).set(row + 1, presentCol, 'PRESENT', head);
  sheet.merge(row, remarksCol, row + 1, remarksCol, remarksHead, { ...head, size: 7 });
  row += 2;
  const daily = new Map(form.daily.map(d => [d.day_on, d]));
  const learnerRows = (sex: 'male' | 'female', label: string) => {
    const rows = form.learners.filter(l => l.sex === sex);
    for (const l of rows) {
      sheet.set(row, 1, l.no, num).set(row, 2, l.name, { ...border, wrap: true });
      form.columns.forEach((c, i) => {
        const cell = l.days[c.day_on];
        // Drawn as the screen draws it, in the screen's own colours: a half-shaded
        // tardy day, a hatched day still to come — never left blank, because a blank
        // SF2 cell is the form's code for present — and a red ? nobody marked.
        const style = !cell || typeof cell === 'string' ? off
          : cell.mark === 'late' || cell.mark === 'cutting' ? { ...num, fill: SHADE, half: cell.mark === 'late' ? 'top' as const : 'bottom' as const }
          : cell.mark === 'pending' ? { ...num, fill: HATCH, hatch: true }
          : cell.mark === 'unmarked' ? { ...num, color: UNMARKED, borderColor: UNMARKED_EDGE, bold: true }
          : cell.mark === 'waiting' ? { ...num, color: WAITING }
          : num;
        const text = cellText(cell);
        sheet.set(row, 3 + i, text, text.length > 1 ? { ...style, size: 6 } : style);
      });
      sheet.set(row, absentCol, l.absent, num).set(row, presentCol, l.present, num).set(row, remarksCol, l.remarks.join('; '), { ...border, wrap: true, size: 7 });
      row++;
    }
    // A total row is tinted as it is on screen, so the blocks are as easy to find in the file.
    const totals: XStyle = { ...num, bold: true, fill: TOTALS }, totalText: XStyle = { ...border, bold: true, fill: TOTALS };
    sheet.set(row, 1, rows.length, totals).set(row, 2, label, totalText);
    form.columns.forEach((c, i) => sheet.set(row, 3 + i, daily.get(c.day_on)?.[sex] ?? null, c.kind === 'class' ? { ...totals, size: 7 } : off));
    sheet.set(row, absentCol, null, totalText).set(row, presentCol, null, totalText).set(row, remarksCol, null, totalText);
    row++;
  };
  learnerRows('male', '<=== MALE | TOTAL Per Day ===>');
  learnerRows('female', '<=== FEMALE | TOTAL Per Day ===>');
  const combined: XStyle = { ...num, bold: true, fill: TOTALS }, combinedText: XStyle = { ...border, bold: true, fill: TOTALS };
  sheet.set(row, 1, form.learners.length, combined).set(row, 2, 'Combined TOTAL PER DAY', combinedText);
  form.columns.forEach((c, i) => sheet.set(row, 3 + i, daily.get(c.day_on)?.total ?? null, c.kind === 'class' ? { ...combined, size: 7 } : off));
  sheet.set(row, absentCol, null, combinedText).set(row, presentCol, null, combinedText).set(row, remarksCol, null, combinedText);
  const lastLearnerRow = row;
  row += 2;
  // The foot, as on the school's own SF2: guidelines, then the codes and reasons, then the summary and signatures,
  // side by side. Each block is laid out in short lines and is as tall as its own text, and the three print on one
  // page together (found on paper, 28 October: stacked in one column, the summary was split across two pages).
  const s = form.summary, top = row, LINE = 12;
  const labelFrom = Math.max(4, absentCol - 8), reasonsFrom = Math.max(3, labelFrom - 8), guideTo = reasonsFrom - 1;
  const rowsFor = (text: string, from: number, to: number, size: number, bold = false) => Math.max(1, Math.ceil((sheet.lines(text, from, to, size, bold) * size * 1.2 + 3) / LINE));
  const block = (at: number, from: number, to: number, text: string, style: XStyle, least = 1) => {
    const rows = Math.max(least, rowsFor(text, from, to, style.size ?? 8, !!style.bold));
    sheet.merge(at, from, at + rows - 1, to, text, { valign: 'top', ...style, wrap: true });
    return at + rows;
  };
  let left = top, mid = top, right = top;
  const note = (text: string, style: XStyle = { size: 7 }) => { left = block(left, 1, guideTo, text, style); };
  note('GUIDELINES:', { bold: true, size: 8 });
  for (const g of guidelines) note(g);
  for (const [l, t, bottom, times] of formulas) note(`${l} (${t}) / (${bottom})${times ? ` ${times}` : ''}`);
  for (const g of [...later, cutoffNote]) note(g);
  if (footer) { left++; note(footer, { italic: true, size: 7 }); }
  const legend = (text: string, style: XStyle = { size: 7 }) => { mid = block(mid, reasonsFrom, labelFrom - 1, text, style); };
  legend('1. CODES FOR CHECKING ATTENDANCE', { bold: true, size: 8 });
  legend(codes);
  legend(drawnHere, { size: 7, italic: true });
  mid++;
  legend('2. REASONS/CAUSES FOR NLS', { bold: true, size: 8 });
  for (const [group, items] of reasons) { legend(group, { bold: true, size: 7 }); for (const item of items) legend(item); }
  // A summary line is a label and three figures over the same rows, the label wrapping as it needs.
  const line = (text: string, t: Trio | MaybeTrio | null, format?: XStyle['format']) => {
    const rows = Math.max(2, rowsFor(text, labelFrom, absentCol - 1, 8));
    sheet.merge(right, labelFrom, right + rows - 1, absentCol - 1, text, { ...border, wrap: true, valign: 'center' });
    [t?.male ?? null, t?.female ?? null, t?.total ?? null].forEach((v, i) => sheet.merge(right, absentCol + i, right + rows - 1, absentCol + i, format === '0.00%' && v !== null ? v / 100 : v, { ...num, ...(format ? { format } : {}) }));
    right += rows;
  };
  sheet.merge(right, labelFrom, right + 1, absentCol - 1, `Month: ${month}`, { ...head, align: 'left' }).merge(right, absentCol, right + 1, remarksCol, `No. of Days of Classes: ${s.days_of_classes}`, head); right += 2;
  if (form.to_date) right = block(right, labelFrom, remarksCol, toDateNote(form), { ...head, italic: true, valign: 'center' }, 2);
  sheet.merge(right, labelFrom, right + 1, absentCol - 1, 'Summary', head).merge(right, absentCol, right + 1, absentCol, 'M', head)
    .merge(right, presentCol, right + 1, presentCol, 'F', head).merge(right, remarksCol, right + 1, remarksCol, 'TOTAL', head); right += 2;
  line(`* Enrolment as of (1st Friday of the school year, ${form.cutoff})`, s.enrolment_at_cutoff);
  line('Late enrolment during the month (beyond cut-off)', s.late_enrolment);
  line('Registered Learners as of end of month', s.registered);
  line('Percentage of Enrolment as of end of month', s.percentage_of_enrolment, '0.00%');
  line('Average Daily Attendance', s.average_daily_attendance, '0.00');
  line('Percentage of Attendance for the month', s.percentage_of_attendance, '0.00%');
  line('Number of students absent for 5 consecutive days', s.absent_five_consecutive);
  line('Dropped out', s.dropped_out);
  line('Transferred out', s.transferred_out);
  line('Transferred in', s.transferred_in);
  right++;
  const sign = (text: string, style: XStyle, least = 1) => { right = block(right, labelFrom, remarksCol, text, style, least); };
  sign('I certify that this is a true and correct report.', { size: 8, italic: true });
  sign(form.section.adviser_name ?? '', { bold: true, size: 9, align: 'center', valign: 'bottom' }, 3);
  sign('(Signature of Adviser over Printed Name)', { size: 7, align: 'center' });
  sign('Attested by:', { size: 8, italic: true });
  sign(form.school.school_head_name ?? '', { bold: true, size: 9, align: 'center', valign: 'bottom' }, 3);
  sign('(Signature of School Head over Printed Name)', { size: 7, align: 'center' });
  const bottom = Math.max(left, mid, right) - 1;
  for (let r = top; r <= bottom; r++) if (!sheet.heights.has(r)) sheet.height(r, LINE);
  sheet.setup.keep = [{ from: top, to: bottom }];
  // The dates are printed again at the top of a page only when the learners themselves run onto it.
  if (sheet.fitRows().paginate().pages.some(p => p <= lastLearnerRow)) sheet.setup.repeat = { rows: '6:7' };
  return book;
}
