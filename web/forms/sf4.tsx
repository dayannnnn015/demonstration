import type { ReactNode } from 'react';
import { monthName, monthOf } from '../dates';
import { XWorkbook, type XStyle } from '../xlsx';
import { levelName, percent, schoolYearLabel, two, type MaybeTrio, type Sf4Form, type Sf4Row, type Trio } from './types';

// The SF4 in the column groups of the school's own workbook: registered
// learners, attendance (daily average and percentage for the month), NLPA,
// transferred out and transferred in, each split male, female and total, the
// movements as A (before the month), B (the month) and A+B. Then the grade and
// school totals, the mortality block, and the staff with no advisory class.

const trioOf = (t: Trio | MaybeTrio | null | undefined) => [t?.male ?? null, t?.female ?? null, t?.total ?? null];
const counts = (t: Trio | MaybeTrio | null | undefined) => trioOf(t).map(n => (n === null ? '' : String(n)));

/** The thirty-six figures of one SF4 row, in the form's order, already formatted for the page. */
export function sf4Figures(row: Sf4Row) {
  return [
    ...counts(row.registered),
    ...trioOf(row.average_daily_attendance).map(two), ...trioOf(row.percentage).map(percent),
    ...[row.dropout, row.transferred_out, row.transferred_in].flatMap(s => [...counts(s.a), ...counts(s.b), ...counts(s.ab)]),
  ];
}

const statusName = { draft: 'Not submitted', submitted: 'Submitted', locked: 'Locked' } as const;

export function Sf4Sheet({ form, footer, statuses }: { form: Sf4Form; footer?: ReactNode; statuses?: boolean }) {
  const month = monthName(monthOf(form.month_on));
  const sexes = (key: string) => ['M', 'F', 'T'].map(x => <th key={key + x}>{x}</th>);
  const spans = (key: string) => ['(A) Cumulative as of Previous Month', '(B) For the Month', '(A+B) Cumulative as of End of the Month'].map(x => <th key={key + x} colSpan={3}>{x}</th>);
  const row = (key: string, cells: ReactNode[], figures: string[], className?: string) => (
    <tr key={key} className={className}>{cells}{figures.map((f, i) => <td key={i} className="numeric">{f}</td>)}</tr>
  );
  const death = form.school_total.death;
  return (
    <div className="paper sf4">
      <h2>School Form 4 (SF4) Monthly Learner&apos;s Movement and Attendance</h2>
      <p className="paper-sub">(This replaces Form 3 &amp; STS Form 4-Absenteeism and Dropout Profile)</p>
      <table className="paper-fields">
        <tbody>
          <tr><th>School ID</th><td>{form.school.school_code ?? ''}</td><th>Region</th><td>{form.school.region ?? ''}</td><th>Division</th><td>{form.school.division ?? ''}</td><th>District</th><td>{form.school.district ?? ''}</td></tr>
          <tr><th>School Name</th><td colSpan={3}>{form.school.name}</td><th>School Year</th><td>{schoolYearLabel(form.school_year.start_year)}</td><th>Report for the Month of</th><td>{month}</td></tr>
        </tbody>
      </table>
      <div className="paper-scroll">
        <table className="paper-grid sf4-grid">
          <thead>
            <tr>
              <th rowSpan={3}>GRADE/ YEAR LEVEL</th><th rowSpan={3}>SECTION</th><th rowSpan={3}>NAME OF ADVISER</th><th rowSpan={3}>POSITION</th><th rowSpan={3}>MAJOR / SPECIALIZATION</th>
              <th colSpan={3} rowSpan={2}>REGISTERED LEARNERS (As of End of the Month)</th>
              <th colSpan={6}>ATTENDANCE</th><th colSpan={9}>NLPA</th><th colSpan={9}>TRANSFERRED OUT</th><th colSpan={9}>TRANSFERRED IN</th>
              {statuses ? <th rowSpan={3} className="no-print">SF2</th> : null}
            </tr>
            <tr><th colSpan={3}>Daily Average</th><th colSpan={3}>Percentage for the Month</th>{spans('d')}{spans('o')}{spans('i')}</tr>
            <tr>{sexes('r')}{sexes('a')}{sexes('p')}{['d', 'o', 'i'].flatMap(g => ['a', 'b', 'ab'].flatMap(p => sexes(g + p)))}</tr>
          </thead>
          <tbody>
            {form.grades.flatMap(g => [
              ...form.sections.filter(s => s.grade_level === g.grade_level).map(s => (
                <tr key={s.section_id} className={s.completeness.complete ? undefined : 'sf4-incomplete'}>
                  <td>{levelName(s.grade_level)}</td><td>{s.name}</td><td>{s.adviser_name ?? ''}</td><td>{s.adviser_position ?? ''}</td><td>{s.adviser_specialization ?? ''}</td>
                  {sf4Figures(s).map((f, i) => <td key={i} className="numeric">{f}</td>)}
                  {statuses ? <td className="no-print">{statusName[s.month_status]}</td> : null}
                </tr>
              )),
              row(`g${g.grade_level}`, [<td key="l" colSpan={5}><b>{levelName(g.grade_level)} total</b></td>], [...sf4Figures(g), ...(statuses ? [''] : [])], 'sf4-total'),
            ])}
            {row('school', [<td key="l" colSpan={5}><b>TOTAL</b></td>], [...sf4Figures(form.school_total), ...(statuses ? [''] : [])], 'sf4-total')}
          </tbody>
        </table>
      </div>
      <div className="sf4-foot">
        <table className="paper-grid sf4-mortality">
          <thead><tr><th>Mortality (Death)</th><th colSpan={3}>Previous Month</th><th colSpan={3}>For the Month</th><th colSpan={3}>Cumulative as of End of the Month</th></tr>
            <tr><th><span className="sr-only">Sex</span></th>{sexes('a')}{sexes('b')}{sexes('c')}</tr></thead>
          <tbody><tr><td>School total</td>{[...counts(death.a), ...counts(death.b), ...counts(death.ab)].map((f, i) => <td key={i} className="numeric">{f}</td>)}</tr></tbody>
        </table>
        {form.other_staff.length ? (
          <table className="paper-grid sf4-staff">
            <thead><tr><th>Name of personnel without advisory class</th><th>Position</th><th>Major / Specialization or task</th></tr></thead>
            <tbody>{form.other_staff.map(p => <tr key={p.name + p.role}><td>{p.name}</td><td>{p.position ?? (p.role === 'administrative_officer' ? 'Administrative Officer' : '')}</td><td>{p.specialization ?? ''}</td></tr>)}</tbody>
          </table>
        ) : null}
        <div className="paper-signatures">
          <p>Prepared and submitted by:</p>
          <p className="signature-name">{form.school.school_head_name ?? ''}</p>
          <p className="signature-label">{form.school.school_head_position ?? 'School Head'}</p>
        </div>
      </div>
      {footer ? <p className="print-foot">{footer}</p> : null}
    </div>
  );
}

export function sf4Workbook(form: Sf4Form, footer?: string) {
  const book = new XWorkbook();
  const sheet = book.sheet('SF4');
  sheet.setup = { landscape: true, paper: 'legal', fitWidth: true, freeze: { rows: 8, cols: 2 } };
  const border: XStyle = { border: true, size: 8 }, head: XStyle = { ...border, bold: true, align: 'center', wrap: true };
  const num: XStyle = { ...border, align: 'center' }, total: XStyle = { ...num, bold: true, fill: 'F2F2F2' };
  const last = 5 + 36;
  sheet.width(1, 12).width(2, 16).width(3, 24).width(4, 13).width(5, 15);
  // Averages and percentages are wider than a count: 16.00 and 100.00% must not show as #####.
  for (let c = 6; c <= last; c++) sheet.width(c, c >= 12 && c <= 14 ? 7.6 : c >= 9 && c <= 11 ? 6.2 : 5.2);
  sheet.merge(1, 1, 1, last, 'School Form 4 (SF4) Monthly Learner’s Movement and Attendance', { bold: true, size: 14, align: 'center' });
  sheet.merge(2, 1, 2, last, '(This replaces Form 3 & STS Form 4-Absenteeism and Dropout Profile)', { italic: true, size: 8, align: 'center' });
  sheet.set(3, 1, 'School ID', { size: 9 }).set(3, 2, form.school.school_code ?? '', { bold: true, size: 9 }).set(3, 4, 'Region', { size: 9 }).set(3, 5, form.school.region ?? '', { bold: true, size: 9 });
  sheet.merge(3, 12, 3, 14, 'Division', { size: 9 }).merge(3, 15, 3, 24, form.school.division ?? '', { bold: true, size: 9 }).merge(3, 26, 3, 28, 'District', { size: 9 }).merge(3, 29, 3, 38, form.school.district ?? '', { bold: true, size: 9 });
  sheet.set(4, 1, 'School Name', { size: 9 }).merge(4, 2, 4, 5, form.school.name, { bold: true, size: 9 });
  sheet.merge(4, 12, 4, 14, 'School Year', { size: 9 }).merge(4, 15, 4, 20, schoolYearLabel(form.school_year.start_year), { bold: true, size: 9 });
  sheet.merge(4, 26, 4, 30, 'Report for the Month of', { size: 9 }).merge(4, 31, 4, 38, monthName(monthOf(form.month_on)), { bold: true, size: 9 });
  ['GRADE/ YEAR LEVEL', 'SECTION', 'NAME OF ADVISER', 'POSITION', 'MAJOR / SPECIALIZATION'].forEach((h, i) => sheet.merge(6, 1 + i, 8, 1 + i, h, head));
  sheet.merge(6, 6, 7, 8, 'REGISTERED LEARNERS (As of End of the Month)', head);
  sheet.merge(6, 9, 6, 14, 'ATTENDANCE', head).merge(7, 9, 7, 11, 'Daily Average', head).merge(7, 12, 7, 14, 'Percentage for the Month', head);
  ['NLPA', 'TRANSFERRED OUT', 'TRANSFERRED IN'].forEach((h, g) => {
    const start = 15 + g * 9;
    sheet.merge(6, start, 6, start + 8, h, head);
    ['(A) Cumulative as of Previous Month', '(B) For the Month', '(A+B) Cumulative as of End of the Month'].forEach((p, i) => sheet.merge(7, start + i * 3, 7, start + i * 3 + 2, p, { ...head, size: 6 }));
  });
  for (let c = 6; c <= last; c++) sheet.set(8, c, ['M', 'F', 'T'][(c - 6) % 3]!, head);
  sheet.height(6, 24).height(7, 30);
  let row = 9;
  // Figures go in as numbers, so the sheet can be checked or totalled in Excel.
  const figures = (r: Sf4Row) => [
    ...trioOf(r.registered), ...trioOf(r.average_daily_attendance), ...trioOf(r.percentage).map(p => (p === null ? null : p / 100)),
    ...[r.dropout, r.transferred_out, r.transferred_in].flatMap(s => [...trioOf(s.a), ...trioOf(s.b), ...trioOf(s.ab)]),
  ];
  const put = (r: Sf4Row, style: XStyle) => figures(r).forEach((v, i) => sheet.set(row, 6 + i, v, { ...style, ...(i >= 3 && i < 6 ? { format: '0.00' } : i >= 6 && i < 9 ? { format: '0.00%' } : {}) }));
  for (const g of form.grades) {
    for (const s of form.sections.filter(x => x.grade_level === g.grade_level)) {
      [levelName(s.grade_level), s.name, s.adviser_name ?? '', s.adviser_position ?? '', s.adviser_specialization ?? ''].forEach((v, i) => sheet.set(row, 1 + i, v, { ...border, wrap: true }));
      put(s, num); row++;
    }
    sheet.merge(row, 1, row, 5, `${levelName(g.grade_level)} total`, { ...border, bold: true, fill: 'F2F2F2' }); put(g, total); row++;
  }
  sheet.merge(row, 1, row, 5, 'TOTAL', { ...border, bold: true, fill: 'F2F2F2' }); put(form.school_total, total); row += 2;
  sheet.merge(row, 1, row + 1, 3, 'Mortality (Death)', head);
  ['Previous Month', 'For the Month', 'Cumulative as of End of the Month'].forEach((h, i) => sheet.merge(row, 4 + i * 3, row, 6 + i * 3, h, head));
  for (let c = 4; c <= 12; c++) sheet.set(row + 1, c, ['M', 'F', 'T'][(c - 4) % 3]!, head);
  const death = form.school_total.death;
  sheet.merge(row + 2, 1, row + 2, 3, 'School total', border);
  [...trioOf(death.a), ...trioOf(death.b), ...trioOf(death.ab)].forEach((v, i) => sheet.set(row + 2, 4 + i, v, num));
  row += 4;
  if (form.other_staff.length) {
    sheet.merge(row, 1, row, 3, 'Name of personnel without advisory class', head).set(row, 4, 'Position', head).set(row, 5, 'Major / Specialization or task', head); row++;
    for (const p of form.other_staff) { sheet.merge(row, 1, row, 3, p.name, { ...border, wrap: true }).set(row, 4, p.position ?? '', { ...border, wrap: true }).set(row, 5, p.specialization ?? '', { ...border, wrap: true }); row++; }
    row++;
  }
  sheet.set(row++, 30, 'Prepared and submitted by:', { size: 8 });
  sheet.merge(row++, 30, row - 1, 38, form.school.school_head_name ?? '', { bold: true, size: 9, align: 'center' });
  sheet.merge(row++, 30, row - 1, 38, form.school.school_head_position ?? 'School Head', { size: 8, align: 'center' });
  if (footer) sheet.merge(row + 1, 1, row + 1, last, footer, { italic: true, size: 7 });
  return book;
}
