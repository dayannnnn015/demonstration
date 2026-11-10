/**
 * The school forms' Excel files, written with ExcelJS. A form is laid out on a
 * small grid builder first (values, borders, merged blocks, widths, page setup),
 * so a layout can be measured before any file exists: Excel never grows a row to
 * fit wrapped text in a merged block, and it shows ##### for a number wider than
 * its column, so both are worked out here rather than left for the reader to
 * find. ExcelJS is loaded only when a file is made, which keeps it out of every
 * screen that never saves one. Its browser bundle reaches `Function` only as a
 * fallback for a missing `globalThis`, so it runs under the workspace's
 * content policy, which forbids `eval`.
 */
import type { Workbook } from 'exceljs';

export type XStyle = {
  bold?: boolean; italic?: boolean; size?: number; border?: boolean; fill?: string;
  /** Half a cell shaded in `fill`, as the SF2 marks a tardy day: the top half for a late comer, the bottom half for cutting classes. */
  half?: 'top' | 'bottom';
  /** `fill` drawn as thin diagonal lines rather than solid, the way the screen hatches a day still to come. */
  hatch?: boolean;
  /** The ink, where the screen says something in colour: an unmarked session is red on the SF2. */
  color?: string;
  /** The border's colour, where it carries meaning rather than ruling the grid. */
  borderColor?: string;
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'center' | 'bottom'; wrap?: boolean;
  /** A whole number, two decimals, a two-decimal percentage of a fraction, or text kept exactly as typed (an LRN, a date). */
  format?: '0' | '0.00' | '0.00%' | '@'; rotate?: 90;
};
/** Runs of text in one cell, such as a form's label beside its bold value. */
export type XRich = { rich: { text: string; bold?: boolean }[] };
/**
 * What Excel itself will refuse in a cell of a template someone fills in. Only
 * the three shapes a form actually needs: a short list of words, a rating, and
 * a count. It is a courtesy and never the authority — the API checks every cell
 * again, because a file can be filled in anywhere, including in a reader that
 * ignores validation entirely.
 */
export type XRule = { kind: 'list'; values: string[] } | { kind: 'decimal' | 'whole'; min: number; max: number };
export type XValidation = { r1: number; c1: number; r2: number; c2: number; rule: XRule; title: string; message: string };
export type XValue = string | number | XRich | null | undefined;
const plain = (v: XValue) => (v !== null && typeof v === 'object' ? v.rich.map(r => r.text).join('') : v);
type XCell = { v: XValue; s: XStyle };
type Range = { r1: number; c1: number; r2: number; c2: number };

export const columnName = (index: number) => {
  let name = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
export const ref = (row: number, col: number) => `${columnName(col)}${row}`;

const paper = { a4: 9, legal: 5, folio: 14 } as const;
// Each paper's portrait size in points, and the margins `build` sets (0.3 in at the sides, 0.4 in top and bottom).
const paperPt = { a4: [595, 842], legal: [612, 1008], folio: [612, 936] } as const;
const MARGIN_W = 0.6 * 72, MARGIN_H = 0.8 * 72;
const DEFAULT_WIDTH = 8.43, DEFAULT_HEIGHT = 15;

// Arial's advance widths in ems, near enough to tell a label that fits from one that does not.
const em = (ch: string) => {
  if (ch === ' ') return 0.28;
  if ('ijlI.,:;!|\''.includes(ch)) return 0.25;
  if ('frt()[]-/'.includes(ch)) return 0.34;
  if ('mwMW@%'.includes(ch)) return 0.86;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch >= 'A' && ch <= 'Z') return 0.69;
  return 0.54;
};
/** The width of one line of text in pixels at 96 dpi. */
export const textPx = (text: string, size = 10, bold = false) => [...text].reduce((n, ch) => n + em(ch), 0) * size * (96 / 72) * (bold ? 1.08 : 1);
/** A column `width` wide holds this many pixels of text, after Excel's cell margins. */
const columnPx = (width: number) => width * 7 + 5;
const PADDING = 6;

/** How a number reads in its cell, which is what Excel has to fit or replace with #####. */
const shown = (v: number, format: XStyle['format']) =>
  format === '0' ? String(Math.round(v)) : format === '0.00' ? v.toFixed(2) : format === '0.00%' ? `${(v * 100).toFixed(2)}%` : String(v);

/** Lines a paragraph takes when wrapped at `room` pixels, breaking between words as Excel does. */
function wrappedLines(text: string, room: number, size: number, bold: boolean) {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let line = 0; lines++;
    for (const word of paragraph.split(' ')) {
      const w = textPx(word, size, bold), gap = line ? textPx(' ', size, bold) : 0;
      if (line && line + gap + w > room) { lines++; line = w; } else line += gap + w;
      // A word longer than the line is broken inside itself.
      while (line > room) { lines++; line -= room; }
    }
  }
  return lines;
}

export class XSheet {
  readonly cells = new Map<number, Map<number, XCell>>();
  readonly merges: Range[] = [];
  readonly widths = new Map<number, number>();
  readonly heights = new Map<number, number>();
  readonly validations: XValidation[] = [];
  setup: { landscape: boolean; paper: keyof typeof paper; fitWidth: boolean; freeze?: { rows: number; cols: number };
    /** Rows and columns printed again on every page of a sheet too wide for one, such as `{ rows: '4:4', cols: 'A:B' }`. */
    repeat?: { rows?: string; cols?: string };
    /** Row ranges that must print on one page, such as a form's summary and signatures: a page break is put before one that would be split. */
    keep?: { from: number; to: number }[] } = { landscape: false, paper: 'a4', fitWidth: true };
  constructor(readonly name: string) {}

  set(row: number, col: number, v: XValue, style: XStyle = {}) {
    if (!this.cells.has(row)) this.cells.set(row, new Map());
    this.cells.get(row)!.set(col, { v, s: style });
    return this;
  }
  /** A merged block holding one value. Every cell in it carries the style, so a bordered block is bordered all round. */
  merge(row: number, col: number, toRow: number, toCol: number, v: XValue, style: XStyle = {}) {
    for (let r = row; r <= toRow; r++) for (let c = col; c <= toCol; c++) this.set(r, c, r === row && c === col ? v : null, style);
    if (toRow > row || toCol > col) this.merges.push({ r1: row, c1: col, r2: toRow, c2: toCol });
    return this;
  }
  /** What a reader may type down one column of a template, between two rows. */
  allow(r1: number, c1: number, r2: number, c2: number, rule: XRule, title: string, message: string) {
    this.validations.push({ r1, c1, r2, c2, rule, title, message });
    return this;
  }
  width(col: number, width: number) { this.widths.set(col, width); return this; }
  height(row: number, height: number) { this.heights.set(row, height); return this; }

  get(row: number, col: number) { return this.cells.get(row)?.get(col); }
  /** How many lines a text wraps to across columns `from` to `to`, at a font size: for laying out blocks before any row is grown. */
  lines(text: string, from: number, to: number, size: number, bold = false) { return wrappedLines(text, this.roomPx({ r1: 0, c1: from, r2: 0, c2: to }), size, bold); }

  /**
   * Where the pages fall when the sheet is printed: a scale for the width, then
   * rows filled down each page, the repeated rows counted on every page after
   * the first. A range in `setup.keep` that would be split starts a page of its
   * own instead. Excel rounds its scale down to a whole percent, and so does this;
   * a little room is kept spare, because Excel fills a page about 3% short of the arithmetic
   * (measured on paper, 28 October), and a kept block is better on a page of its own than split.
   * Returns the first row of every page after the first, the manual breaks among them,
   * and the scale used.
   */
  paginate() {
    const [short, long] = paperPt[this.setup.paper];
    const [pageW, pageH] = this.setup.landscape ? [long, short] : [short, long];
    const lastCol = Math.max(0, ...[...this.cells.values()].flatMap(cols => [...cols.keys()]), ...this.widths.keys());
    const lastRow = this.lastRow();
    let sheetW = 0; for (let c = 1; c <= lastCol; c++) sheetW += columnPx(this.widths.get(c) ?? DEFAULT_WIDTH) * 0.75;
    const scale = this.setup.fitWidth && sheetW > 0 ? Math.min(1, Math.floor(((pageW - MARGIN_W) / sheetW) * 100) / 100) : 1;
    const room = ((pageH - MARGIN_H) / scale) * 0.93;
    const repeat = /^(\d+):(\d+)$/.exec(this.setup.repeat?.rows ?? '');
    let repeated = 0; if (repeat) for (let r = Number(repeat[1]); r <= Number(repeat[2]); r++) repeated += this.rowHeight(r);
    const height = (from: number, to: number) => { let h = 0; for (let r = from; r <= to; r++) h += this.rowHeight(r); return h; };
    const pages: number[] = [], manual: number[] = [];
    let used = 0;
    for (let r = 1; r <= lastRow; r++) {
      const block = this.setup.keep?.find(k => k.from === r);
      const need = block ? height(block.from, block.to) : this.rowHeight(r);
      const top = pages.length ? repeated : 0;
      if (used + need > room && used > top) {
        pages.push(r);
        if (block) manual.push(r);
        used = repeated;
      }
      used += this.rowHeight(r);
    }
    return { pages, manual, scale };
  }
  private mergeAt(row: number, col: number) { return this.merges.find(m => row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2); }
  private span(row: number, col: number): Range { return this.mergeAt(row, col) ?? { r1: row, c1: col, r2: row, c2: col }; }
  private roomPx(range: Range) { let px = 0; for (let c = range.c1; c <= range.c2; c++) px += columnPx(this.widths.get(c) ?? DEFAULT_WIDTH); return px - PADDING; }
  rowHeight(row: number) { return this.heights.get(row) ?? DEFAULT_HEIGHT; }
  lastRow() { return Math.max(0, ...this.cells.keys(), ...this.heights.keys()); }
  private filled() {
    const out: { row: number; col: number; cell: XCell }[] = [];
    for (const [row, cols] of this.cells) for (const [col, cell] of cols) if (cell.v !== null && cell.v !== undefined && cell.v !== '') out.push({ row, col, cell: { v: plain(cell.v), s: typeof cell.v === 'object' && cell.v.rich.some(r => r.bold) ? { ...cell.s, bold: true } : cell.s } });
    return out;
  }

  /**
   * Grows each row to hold its text. A wrapped block spanning several rows
   * takes what it lacks from its last row. Rows are only ever grown, so a
   * height a layout chose for spacing stays.
   */
  fitRows() {
    for (const { row, col, cell } of this.filled()) {
      if (typeof cell.v !== 'string' || cell.s.rotate) continue;
      const size = cell.s.size ?? 10, range = this.span(row, col);
      if (range.r1 !== row || range.c1 !== col) continue;
      const lines = cell.s.wrap || cell.v.includes('\n') ? wrappedLines(cell.v, this.roomPx(range), size, !!cell.s.bold) : 1;
      const needed = Math.ceil(lines * size * 1.2 + 3);
      let have = 0; for (let r = range.r1; r <= range.r2; r++) have += this.rowHeight(r);
      if (needed > have) this.heights.set(range.r2, this.rowHeight(range.r2) + needed - have);
    }
    return this;
  }

  /**
   * What a reader would find broken: text cut off at a neighbour or a border, a
   * word broken inside itself, or a number shown as #####. The forms' tests
   * require none.
   */
  problems() {
    const found: string[] = [];
    for (const { row, col, cell } of this.filled()) {
      const range = this.span(row, col);
      if (range.r1 !== row || range.c1 !== col || cell.s.rotate) continue;
      const size = cell.s.size ?? 10, bold = !!cell.s.bold, room = this.roomPx(range), at = ref(row, col);
      if (typeof cell.v === 'number') {
        if (cell.s.format && textPx(shown(cell.v, cell.s.format), size, bold) > room) found.push(`${at}: ${shown(cell.v, cell.s.format)} shows as #####`);
        continue;
      }
      const text = String(cell.v);
      if (cell.s.wrap || text.includes('\n')) {
        const word = text.split(/[\s\n]+/).find(w => textPx(w, size, bold) > room);
        if (word) found.push(`${at}: "${word}" is broken inside the word`);
        continue;
      }
      if (textPx(text, size, bold) <= room) continue;
      // Unwrapped text may run on into empty cells to its right, as long as nothing there stops it.
      let spare = 0;
      for (let c = range.c2 + 1; c <= range.c2 + 60 && spare < textPx(text, size, bold) - room; c++) {
        const next = this.get(row, c);
        if ((next && next.v !== null && next.v !== undefined && next.v !== '') || this.mergeAt(row, c) || next?.s.border || cell.s.border || cell.s.align === 'right') { spare = -1; break; }
        spare += columnPx(this.widths.get(c) ?? DEFAULT_WIDTH);
      }
      if (spare < 0 || spare < textPx(text, size, bold) - room) found.push(`${at}: "${text.slice(0, 40)}" is cut off`);
    }
    return found;
  }
}

export class XWorkbook {
  readonly sheets: XSheet[] = [];
  sheet(name: string) { const sheet = new XSheet(name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)); this.sheets.push(sheet); return sheet; }

  /** The finished workbook, every row fitted to its text first. */
  async build(): Promise<Workbook> {
    const module = await import('exceljs');
    const ExcelJS = ((module as { default?: unknown }).default ?? module) as typeof import('exceljs');
    const book = new ExcelJS.Workbook();
    book.creator = 'EDUNEXUS';
    // A fixed date keeps two saves of the same form identical inside.
    book.created = book.modified = new Date(Date.UTC(2026, 0, 1));
    for (const sheet of this.sheets) {
      sheet.fitRows();
      const { landscape, fitWidth, freeze } = sheet.setup;
      const ws = book.addWorksheet(sheet.name, {
        views: [freeze ? { state: 'frozen', xSplit: freeze.cols, ySplit: freeze.rows, showGridLines: false } : { showGridLines: false }],
        pageSetup: {
          paperSize: paper[sheet.setup.paper] as never, orientation: landscape ? 'landscape' : 'portrait',
          ...(fitWidth ? { fitToPage: true, fitToWidth: 1, fitToHeight: 0 } : {}),
          margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
        },
        properties: { defaultRowHeight: DEFAULT_HEIGHT },
      });
      if (sheet.setup.repeat?.rows) ws.pageSetup.printTitlesRow = sheet.setup.repeat.rows;
      if (sheet.setup.repeat?.cols) ws.pageSetup.printTitlesColumn = sheet.setup.repeat.cols;
      // A kept block that would be split begins a page of its own: the break is set after the row above it.
      for (const r of sheet.paginate().manual) ws.getRow(r - 1).addPageBreak();
      for (const [c, w] of sheet.widths) ws.getColumn(c).width = w;
      // Every row's height is written, so Excel prints the rows this measured rather than sizing some itself,
      // and the pages fall where paginate() says (found on paper, 28 October: Excel grew an unset header row and
      // pushed a kept block's last line onto a page of its own).
      for (let r = 1; r <= sheet.lastRow(); r++) ws.getRow(r).height = sheet.rowHeight(r);
      for (const [r, cols] of sheet.cells) for (const [c, { v, s }] of cols) {
        const cell = ws.getCell(r, c);
        const font = { name: 'Arial', size: s.size ?? 10, ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italic: true } : {}), ...(s.color ? { color: { argb: `FF${s.color}` } } : {}) };
        cell.value = typeof v === 'number' ? (Number.isFinite(v) ? v : null) : v === undefined || v === '' ? null
          : typeof v === 'object' && v !== null ? { richText: v.rich.map(r => ({ text: r.text, font: { ...font, ...(r.bold ? { bold: true } : {}) } })) } : v;
        cell.font = font;
        cell.alignment = { horizontal: s.align ?? 'left', vertical: !s.valign || s.valign === 'center' ? 'middle' : s.valign, ...(s.wrap ? { wrapText: true } : {}), ...(s.rotate ? { textRotation: s.rotate } : {}) };
        if (s.border) { const thin = { style: 'thin' as const, ...(s.borderColor ? { color: { argb: `FF${s.borderColor}` } } : {}) }; cell.border = { top: thin, left: thin, bottom: thin, right: thin }; }
        // A hatch is a pattern fill, which every reader draws; the diagonal runs the way the screen's does.
        if (s.fill) cell.fill = { type: 'pattern', pattern: s.hatch ? 'lightDown' : 'solid', fgColor: { argb: `FF${s.fill}` }, ...(s.hatch ? { bgColor: { argb: 'FFFFFFFF' } } : {}) };
        if (s.half) {
          // Four stops draw the hard edge, and every position must be distinct and
          // rising: two stops both at 0.5, which is the obvious way to write it, is
          // invalid OOXML, and Excel answers it by fading across the cell or by
          // repairing the file (found 2026-11-03, reading the styles.xml it wrote).
          const shade = `FF${s.fill ?? '6B6B6B'}`, [first, second] = s.half === 'top' ? [shade, 'FFFFFFFF'] : ['FFFFFFFF', shade];
          cell.fill = { type: 'gradient', gradient: 'angle', degree: 90, stops: [{ position: 0, color: { argb: first } }, { position: 0.499, color: { argb: first } }, { position: 0.5, color: { argb: second } }, { position: 1, color: { argb: second } }] };
        }
        if (s.format) cell.numFmt = s.format;
      }
      for (const v of sheet.validations) {
        // A list is one quoted, comma-separated formula; Excel refuses a bare
        // list and silently drops the whole validation.
        const rule = v.rule.kind === 'list'
          ? { type: 'list' as const, formulae: [`"${v.rule.values.join(',')}"`] }
          : { type: v.rule.kind, operator: 'between' as const, formulae: [v.rule.min, v.rule.max] };
        for (let r = v.r1; r <= v.r2; r++) for (let c = v.c1; c <= v.c2; c++) {
          ws.getCell(r, c).dataValidation = { ...rule, allowBlank: true, showErrorMessage: true, errorStyle: 'warning', errorTitle: v.title, error: v.message } as never;
        }
      }
      for (const m of sheet.merges) ws.mergeCells(m.r1, m.c1, m.r2, m.c2);
    }
    return book;
  }

  async bytes() { return new Uint8Array(await (await this.build()).xlsx.writeBuffer()); }
}

/**
 * A plain list as a workbook: a title, a line saying what it is, a header row
 * and one row per record, every column wide enough for what it holds. Columns
 * named in `text` are kept as typed, so an LRN stays twelve digits instead of
 * turning into 1.36512E+11, and a date stays the date that was recorded.
 */
export function tableWorkbook({ sheet: name, title, note, header, rows, text = [], landscape }: { sheet: string; title: string; note?: string; header: string[]; rows: XValue[][]; text?: number[]; landscape?: boolean }) {
  const book = new XWorkbook();
  const sheet = book.sheet(name);
  const cols = header.length;
  const top = note ? 4 : 3;
  // A month of sessions is too wide to shrink onto one page and still read, so it prints across pages, each repeating the names and the heading.
  const wide = cols > 14;
  sheet.setup = { landscape: landscape ?? cols > 6, paper: 'a4', fitWidth: !wide, freeze: { rows: top, cols: wide ? 2 : 0 }, ...(wide ? { repeat: { rows: `${top}:${top}`, cols: 'A:B' } } : {}) };
  sheet.merge(1, 1, 1, Math.max(1, cols), title, { bold: true, size: 12 });
  if (note) sheet.merge(2, 1, 2, Math.max(1, cols), note, { italic: true, size: 8, wrap: true });
  header.forEach((h, i) => sheet.set(top, i + 1, h, { bold: true, border: true, size: 9, fill: 'F2F2F2', wrap: true, valign: 'bottom' }));
  rows.forEach((row, r) => row.forEach((v, c) => sheet.set(top + 1 + r, c + 1, v, { border: true, size: 9, ...(text.includes(c) ? { format: '@' as const } : {}), ...(typeof v === 'number' ? { align: 'center' as const } : {}) })));
  header.forEach((h, c) => {
    // A heading may wrap between its words, never inside one: a date must stay whole.
    const widest = Math.max(...h.split(' ').map(word => textPx(word, 9, true)), ...rows.map(row => { const v = row[c]; return v === null || v === undefined ? 0 : textPx(String(plain(v)), 9); }));
    sheet.width(c + 1, Math.min(60, Math.max(6, Math.ceil((widest + PADDING) / 7) + 1)));
  });
  return book;
}

/**
 * Reads an .xlsx sheet as rows of text, the way it shows in Excel: the sheet
 * named, or the first one where a workbook has no sheet by that name — a file
 * someone has added a sheet of their own notes to still reads.
 */
export async function readXlsxRows(data: ArrayBuffer, sheetName?: string): Promise<string[][]> {
  const module = await import('exceljs');
  const ExcelJS = ((module as { default?: unknown }).default ?? module) as typeof import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(data);
  const named = sheetName ? book.worksheets.find(w => w.name.trim().toLowerCase() === sheetName.trim().toLowerCase()) : undefined;
  const ws = named ?? book.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const out: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      // The cells a merged block covers read as empty, as Excel shows them.
      // A typed date is held as a date; it reads as the calendar date it shows, never through local time.
      out.push(cell.isMerged && cell.master.address !== cell.address ? '' : cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : String(cell.text ?? '').trim());
    }
    rows[n - 1] = out;
  });
  return Array.from(rows, r => r ?? []);
}

export async function downloadXlsx(name: string, book: XWorkbook) {
  const blob = new Blob([await book.bytes()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
