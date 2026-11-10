import { describe, expect, it } from 'vitest';
import { ROSTER_HEADER, rosterFileText, rosterTemplateWorkbook } from '../web/csv';
import { readXlsxRows } from '../web/xlsx';

/**
 * The class-list template the workspace generates, and the reading of a
 * filled-in one.
 *
 * Tested as a round trip, because that is what has to hold: a file written
 * here, typed into and handed back must give the API the cells that were
 * typed, in the columns it publishes. The columns themselves belong to the API
 * — `tests/registry-address.test.ts` asserts the two lists are equal — and this
 * covers the file.
 *
 * Most of it is about Excel rather than about EDUNEXUS, deliberately. A
 * twelve-digit LRN typed into a cell Excel thinks is a number comes back as
 * 1.36512E+11 with its digits gone, and that is the one failure in this feature
 * that destroys a record silently rather than refusing it.
 */

const columns = ROSTER_HEADER.split(',');
const built = () => rosterTemplateWorkbook();
const asFile = (bytes: Uint8Array, name = 'class-list.xlsx') =>
  new File([bytes as unknown as BlobPart], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

/** The template with rows typed into its Class list sheet, as an adviser would hand it back. */
async function filled(rows: (string | number)[][], sheetName = 'Class list') {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await built().bytes()).buffer as ArrayBuffer);
  const sheet = book.getWorksheet(sheetName)!;
  rows.forEach((row, r) => row.forEach((value, c) => { sheet.getCell(4 + r, c + 1).value = value; }));
  return asFile(new Uint8Array(await book.xlsx.writeBuffer()));
}

describe('the generated class-list template', () => {
  it('carries the header the API publishes, with the grade last and the address before it', async () => {
    const rows = await readXlsxRows((await built().bytes()).buffer as ArrayBuffer, 'Class list');
    expect(rows[2]).toEqual(columns);
    // 0.100.0: each learner carries their own grade, in a ninth column after the address.
    expect(columns.slice(-2)).toEqual(['address', 'grade_level']);
  });

  it('keeps the LRN and birth-date columns as text, in the empty rows as well', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await built().bytes()).buffer as ArrayBuffer);
    const sheet = book.getWorksheet('Class list')!;
    // The row under the header, and a row well down the sheet: an unstyled cell
    // is one Excel formats as a number, and the LRN typed into it loses its digits.
    for (const row of [4, 30, 53]) {
      expect(sheet.getCell(row, columns.indexOf('lrn') + 1).numFmt, `row ${row} lrn`).toBe('@');
      expect(sheet.getCell(row, columns.indexOf('birth_date') + 1).numFmt, `row ${row} birth_date`).toBe('@');
    }
  });

  it('explains itself away from the screen: every column named, the required ones said in words, and a worked row', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await built().bytes()).buffer as ArrayBuffer);
    expect(book.worksheets.map(w => w.name)).toEqual(['Class list', 'What each column holds']);
    const notes = book.getWorksheet('What each column holds')!;
    const text = notes.getSheetValues().flat().filter(v => typeof v === 'string').join(' | ');
    for (const column of columns) expect(text, column).toContain(column);
    // Required and optional are said in words, not only in the heading's colour.
    expect(text).toContain('Required');
    expect(text).toContain('Optional');
    // The worked row shows what an address looks like, and that an empty cell is allowed.
    expect(text).toContain('136170000001');
    expect(text).toContain('(left empty)');
  });

  it('tells Excel itself that sex is male or female', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await built().bytes()).buffer as ArrayBuffer);
    const sheet = book.getWorksheet('Class list')!;
    expect(sheet.getCell(4, columns.indexOf('sex') + 1).dataValidation)
      .toMatchObject({ type: 'list', formulae: ['"male,female"'], allowBlank: true });
  });

  it('has nothing a reader would find broken: no cut-off label, no number shown as #####', () => {
    for (const sheet of built().sheets) expect(sheet.fitRows().problems(), sheet.name).toEqual([]);
  });
});

describe('reading a filled-in class list', () => {
  it('hands the API the typed cells, with an address holding commas quoted', async () => {
    const address = 'Purok 4, Balili, La Trinidad, Benguet';
    const file = await filled([
      ['136170000001', 'Ana', 'Bautista', 'Reyes', '', '2017-05-02', 'female', address, '3'],
      ['136170000002', 'Ben', '', 'Lacsamana', '', '2015-03-11', 'male', '', ''],
    ]);
    const csv = await rosterFileText(file);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(ROSTER_HEADER);
    // Quoted, or the commas in the address would make the row eight columns too wide.
    expect(lines[1]).toBe(`136170000001,Ana,Bautista,Reyes,,2017-05-02,female,"${address}",3`);
    expect(lines[2]).toBe('136170000002,Ben,,Lacsamana,,2015-03-11,male,,');
  });

  it('reads the Class list sheet by name, so the notes sheet never shifts the columns', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await built().bytes()).buffer as ArrayBuffer);
    // A sheet of somebody's own, moved to the front of the workbook.
    const mine = book.addWorksheet('My notes');
    mine.getCell(1, 1).value = 'ask the office about Ben';
    book.worksheets.reverse();
    const sheet = book.getWorksheet('Class list')!;
    ['136170000003', 'Cris', '', 'Molina', '', '2017-01-09', 'male', 'Balili, La Trinidad']
      .forEach((value, c) => { sheet.getCell(4, c + 1).value = value; });
    const csv = await rosterFileText(asFile(new Uint8Array(await book.xlsx.writeBuffer())));
    expect(csv).toContain('Cris');
    expect(csv.trim().split('\r\n')[0]).toBe(ROSTER_HEADER);
  });

  it('still reads a file saved from the earlier seven-column template', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Class list');
    columns.slice(0, 7).forEach((name, c) => { sheet.getCell(3, c + 1).value = name; });
    ['136170000004', 'Dina', '', 'Pacalso', '', '2017-04-02', 'female']
      .forEach((value, c) => { sheet.getCell(4, c + 1).value = value; });
    const csv = await rosterFileText(asFile(new Uint8Array(await book.xlsx.writeBuffer())));
    // The earlier header is sent as it was read, and the API accepts both.
    expect(csv.trim().split('\r\n')[0]).toBe(columns.slice(0, 7).join(','));
    expect(csv).toContain('Pacalso');
  });

  it('refuses a file that is not the template, and says what to do', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Class list');
    sheet.getCell(1, 1).value = 'Name';
    sheet.getCell(2, 1).value = 'Ana Reyes';
    await expect(rosterFileText(asFile(new Uint8Array(await book.xlsx.writeBuffer()))))
      .rejects.toThrow(/no header row reading/);
  });

  it('leaves the template’s spare rows out', async () => {
    const file = await filled([['136170000005', 'Elmer', '', 'Bugtong', '', '2017-07-11', 'male', '']]);
    expect((await rosterFileText(file)).trim().split('\r\n').length).toBe(2);
  });
});
