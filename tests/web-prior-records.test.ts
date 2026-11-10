// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PriorRecords } from '../web/screens/PriorRecords';
import { Sf10Sheet } from '../web/forms/sf10';
import { routes } from '../web/routes';
import type { Sf10Form } from '../web/forms/types';

/**
 * The encoding screen's own paths, and the one thing the whole increment is for:
 * that a transcribed year actually prints on the SF10, in the official layout,
 * beside the years EDUNEXUS recorded itself.
 *
 * The screen is driven through a stubbed `api` rather than the in-process API,
 * because `tests/helpers/dom.ts` — which points the workspace client at a real
 * API over PGlite — was lost with `tests/` and has not been rebuilt. The API
 * behind these calls is covered against the real SQL in
 * `tests/prior-records.test.ts`; what is checked here is the screen.
 */

// React wants to be told it is in a test, or every act() warns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const route = routes.find(r => r.id === 'prior-records')!;
const learner = { id: 'l1', first_name: 'Ana', last_name: 'Reyes', lrn: '136170000001', placement: { grade_level: 3 } };

const records = {
  learner, may_write: true,
  school: { name: 'Balili Elementary School', school_code: '135617', address: 'Balili, La Trinidad', region: 'CAR', division: 'Benguet', district: 'La Trinidad' },
  eligibility: {
    id: 'el1', learner_id: 'l1', credential: 'kinder_progress_report', credential_other: null,
    school_name: 'Balili Elementary School', school_code: '135617', school_address: null,
    pept_rating: null, examined_on: null, testing_center: null, remark: null, source: 'Kinder progress report on file', version: 1,
  },
  prior_years: [{
    id: 'py1', learner_id: 'l1', start_year: 2024, grade_level: 2, school_name: 'Balili Elementary School', school_code: '135617',
    school_address: null, section_name: 'Sampaguita', adviser_name: 'A. Dela Cruz', general_average: 89.5, remark: 'passed',
    source: 'Adviser class record 2024-2025', version: 1,
    subjects: [{ subject_id: null, code: 'FILIPINO', name: 'Filipino', display_order: 1, q1: 88, q2: 89, q3: 90, q4: 91, final: 89.5, remark: 'passed' }],
  }],
  recorded_years: [{ academic_year_id: 'y1', start_year: 2026, grade_level: 3, section_name: 'Rosal', status: 'enrolled' }],
};

/** A learner still in Kindergarten: nothing to encode, and no SF10 yet. */
const kinder = { id: 'k1', first_name: 'Kai', last_name: 'Pucay', lrn: '136170000005', placement: { grade_level: 0 } };
const kinderRecords = {
  ...records, learner: kinder, eligibility: null, prior_years: [],
  recorded_years: [{ academic_year_id: 'y1', start_year: 2026, grade_level: 0, section_name: 'Kinder A', status: 'enrolled' }],
};

let host: HTMLDivElement;
const sent: { path: string; method: string; body: unknown }[] = [];
/** Which learner the search answers with, so one stub serves both cases. */
let searchAnswers = learner;

/** The workspace client, narrowed to what this screen calls. */
const api = (async (path: string, method = 'GET', body?: unknown) => {
  sent.push({ path, method, body });
  if (path.startsWith('/learners/l1/prior-records')) return records;
  if (path.startsWith('/learners/k1/prior-records')) return kinderRecords;
  if (/^[/]learners[/][0-9a-f-]{36}$/.test(path)) return learner;
  if (path.startsWith('/learners?')) return { items: [searchAnswers] };
  return {};
}) as never;

beforeEach(() => { host = document.createElement('div'); document.body.append(host); sent.length = 0; searchAnswers = learner; });
afterEach(() => { host.remove(); });

/** Mount the screen and let its effects settle, as the shell mounts it. */
async function mount(role: 'principal' | 'teacher' = 'principal') {
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(PriorRecords, {
      api, me: { role }, manager: role !== 'teacher', setStatus: () => undefined, reload: () => undefined, token: 0, route,
    }));
  });
  return root;
}
const press = async (label: string, within: ParentNode = host) => {
  const button = [...within.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(label));
  expect(button, `no button reading “${label}”`).toBeTruthy();
  await act(async () => { (button as HTMLButtonElement).click(); });
};

type Input = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
/**
 * Typing into a controlled React input.
 *
 * Assigning `.value` directly is not enough: React keeps its own tracker of
 * what a control last held and skips an event whose value it believes unchanged,
 * so the keystroke never reaches the screen's state. Going through the
 * prototype's own setter is what makes React see it, exactly as a real
 * keystroke does.
 */
async function type(within: ParentNode, selector: string, value: string) {
  const field = within.querySelector<Input>(selector);
  expect(field, `no control at ${selector}`).toBeTruthy();
  const proto = field instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype
    : field instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
    field!.dispatchEvent(new window.Event('input', { bubbles: true }));
    field!.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
const submit = async (form: Element) => {
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
};
/** Search for the learner and open their history, which is where every path below starts. */
async function openHistory() {
  await type(host, 'input[name="search"]', 'Reyes');
  await submit(host.querySelector('form.toolbar')!);
  await press('Open the history');
}

describe('the Academic history screen', () => {
  it('renders, and asks for the learner before anything else', async () => {
    await mount();
    // The page's description is folded away until asked for, so what proves the
    // header rendered is its control rather than the sentence behind it. The
    // sentence itself is `route.lede`, and that it appears on opening is pinned
    // in tests/web-page-description.test.ts.
    expect(host.textContent).toContain('What is this page for?');
    expect(host.textContent).toContain('Find the learner first');
    // No learner record is read until one is named. The oversight card a
    // manager sees does read the school's school years and its encoding counts,
    // which name nobody and write no access row -- that is the whole bargain it
    // makes, so those two reads are expected here and nothing else is.
    expect(sent.every(r => r.path === '/academic-years' || /encoding-progress/.test(r.path))).toBe(true);
    expect(sent.some(r => r.path.startsWith('/learners'))).toBe(false);
  });

  it('opens the learner the Learner registry handed it, reading them itself', async () => {
    location.hash = '#/prior-records?learner=11111111-1111-4111-8111-111111111111';
    try {
      await mount();
      // Only the id travels in the link: the screen reads the learner, so the
      // link cannot put a name on screen the caller may not be allowed to see.
      expect(sent.some(r => r.path === '/learners/11111111-1111-4111-8111-111111111111')).toBe(true);
      // The learner is open: the finder's empty state is gone, and the way
      // back to it is the icon beside the arrows that step between learners.
      expect(host.textContent).not.toContain('Find the learner first');
      expect([...host.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Find another learner')).toBe(true);
    } finally { location.hash = ''; }
  });

  it('shows one continuous history, in year order, saying where each year came from', async () => {
    await mount();
    await openHistory();

    const rows = [...host.querySelectorAll('tbody tr')].map(r => r.textContent ?? '');
    const years = rows.filter(r => r.includes('2024') || r.includes('2026'));
    expect(years).toHaveLength(2);
    // The transcribed year first, then the year EDUNEXUS holds: one series.
    expect(years[0]).toContain('2024 - 2025');
    expect(years[0]).toContain('Copied from a document');
    expect(years[1]).toContain('2026 - 2027');
    expect(years[1]).toContain('Recorded in EDUNEXUS');
    // A year EDUNEXUS holds is not edited here, and says where its grades go.
    expect(years[1]).toContain('On Promotion');
    // Kindergarten is on the record as the credential, never as a year with grades.
    expect(host.textContent).toContain('Where a Kindergarten record goes');
  });

  it('offers a Kindergarten learner nothing to encode, and says what their records are', async () => {
    searchAnswers = kinder;
    await mount();
    await openHistory();

    expect(host.textContent).toContain('This learner is in Kindergarten, so there is nothing to encode yet');
    // Their own records are named, so this does not read as a record EDUNEXUS lost.
    expect(host.textContent).toContain('SF5-K');
    expect(host.textContent).toContain('ECCD checklist');
    // And there is no year to add, because they have no previous grade.
    const add = [...host.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('Add a school year'));
    expect(add).toBeTruthy();
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * The control that fills the rows from the school's own report cards.
   *
   * It had no test, and it was reported as doing nothing. The cause was
   * layout, not logic — the button sat inside the sentence beside it, whose
   * second line painted over the button's lower half and took the clicks — so
   * what is pinned here is the behaviour that was being blamed, at two grades,
   * because the whole point of the control is that the list follows the grade.
   */
  /**
   * Why this one exists: the offer rendered only when it had something to
   * add, so on opening the sheet — grade still on *Choose…* — there was
   * nothing at all, and it was reported twice as a feature never built.
   */
  /**
   * Asked for on 2026-11-10: the sheet carried too much prose to read.
   *
   * Every hint follows the workspace's one notes switch, which is off by
   * default, so the form opens as labels and boxes. What is pinned here is that
   * the explanation is reachable rather than deleted, and that a field's own
   * rejection is **not** a note and is never folded away with them.
   */
  it('opens without its notes, and shows them on the one switch', async () => {
    await mount();
    await openHistory();
    await press('Add a school year');
    const sheet = document.querySelector('.sheet-body')!;

    expect(sheet.textContent).not.toContain('A quarter the document does not carry is left empty');
    expect(sheet.querySelector('.hint')).toBeNull();

    await press('Show the notes', sheet);
    expect(sheet.textContent).toContain('A quarter the document does not carry is left empty');
    expect(sheet.querySelector('.hint')).toBeTruthy();
  });

  /**
   * The box was asked to go on 2026-11-10. The SF10 still prints a General
   * Average row per block, so a year that already carries one must keep it: a
   * correction that sent null would have wiped a figure off an official form.
   */
  it('no longer offers a General average box, and keeps the one a year already carries', async () => {
    await mount();
    await openHistory();
    await press('Add a school year');
    let sheet = document.querySelector('.sheet-body')!;
    expect(sheet.querySelector('input[name="general_average"]')).toBeNull();
    await press('Close', sheet).catch(() => undefined);

    // The year on record carries 89.5. Correcting it must not send null.
    const root = await mount();
    await openHistory();
    await press('Correct');
    sheet = document.querySelector('.sheet-body')!;
    expect(sheet.querySelector('input[name="general_average"]')).toBeNull();
    await type(sheet, 'textarea[name="reason"]', 'Checked again against the adviser class record.');
    await submit(sheet.querySelector('form')!);
    const save = sent.find(s => s.method === 'PATCH');
    expect((save!.body as { year: { general_average: number | null } }).year.general_average).toBe(89.5);
    root.unmount();
  });

  it('says the areas can be listed before a grade is chosen, and offers them after', async () => {
    await mount();
    await openHistory();
    await press('Add a school year');
    const sheet = document.querySelector('.sheet-body')!;
    const offer = () => sheet.querySelector('.area-proposal')!;

    // No grade yet, so no list can be named - but the reader is told it exists.
    expect(offer().textContent).toContain('Choose the grade level above');
    expect(offer().querySelector('button')).toBeNull();

    await type(sheet, 'select[name="grade_level"]', '2');
    expect(offer().querySelector('button')?.textContent).toContain('List the Grade 2 learning areas');

    // Once every area is listed there is nothing left to offer, and it says so
    // rather than vanishing, which is the fault this test is here for.
    await press('List the Grade 2 learning areas', sheet);
    expect(offer().querySelector('button')).toBeNull();
    expect(offer().textContent).toContain('is already listed');
  });

  it('fills the learning areas from the grade the year is at', async () => {
    await mount();
    await openHistory();
    await press('Add a school year');
    const sheet = document.querySelector('.sheet-body')!;

    // Grade 1 prints five areas on this school's card.
    await type(sheet, 'select[name="grade_level"]', '1');
    await press('List the Grade 1 learning areas', sheet);
    const names = () => [...sheet.querySelectorAll<HTMLInputElement>('input[name^="name-"]')].map(i => i.value).filter(Boolean);
    expect(names()).toEqual(['Language', 'Reading and Literacy', 'Mathematics', 'GMRC (Good Manners and Right Conduct)', 'Makabansa']);

    // The three empty rows it started with are gone rather than left under the list.
    expect(sheet.querySelectorAll('input[name^="name-"]')).toHaveLength(5);

    // A typed row is the document's own and survives; the offer then names only what is missing.
    await type(sheet, 'input[name="name-0"]', 'Mother Tongue');
    await press('List the Grade 1 learning areas', sheet);
    expect(names()).toContain('Mother Tongue');
    expect(names()).toContain('Language');
    expect(names().filter(n => n === 'Language')).toHaveLength(1);
  });

  it('offers the areas of the grade chosen, not of the learner’s current one', async () => {
    await mount();
    await openHistory();
    await press('Add a school year');
    const sheet = document.querySelector('.sheet-body')!;

    await type(sheet, 'select[name="grade_level"]', '4');
    // Grades 4-6 print ten, so the offer is not a fixed list.
    await press('List the Grade 4 learning areas', sheet);
    expect(sheet.querySelectorAll('input[name^="name-"]')).toHaveLength(10);
  });

  it('sends one request carrying the year and its learning areas together', async () => {
    await mount();
    await openHistory();
    await press('Add a school year');

    const sheet = document.querySelector('.sheet-body')!;
    expect(sheet.textContent).toContain('Learning areas');
    await type(sheet, 'input[name="start_year"]', '2023');
    await type(sheet, 'select[name="grade_level"]', '1');
    await type(sheet, 'input[name="source"], textarea[name="source"]', 'Adviser class record spreadsheet 2023-2024');
    // No reason box when adding a year (decision U-D2, 0.103.0): the document named above is where it came from.
    expect(sheet.querySelector('textarea[name="reason"]')).toBeNull();
    await type(sheet, 'input[name="name-0"]', 'Filipino');
    await type(sheet, 'input[name="final-0"]', '87.5');
    await type(sheet, 'input[name="q1-0"]', '86');

    await submit(sheet.querySelector('form')!);

    const save = sent.find(s => s.method === 'POST');
    expect(save?.path).toBe('/learners/l1/prior-years');
    const body = save!.body as { year: Record<string, unknown>; subjects: Record<string, unknown>[]; reason: string };
    expect(body.year.start_year).toBe(2023);
    expect(body.year.grade_level).toBe(1);
    expect(body.reason).toBe('Added the 2023 - 2024 school year, Grade 1, on Academic history, from the document named.');
    // The school defaults to this school, so Balili's own years need no typing.
    expect(body.year.school_name).toBe('Balili Elementary School');
    expect(body.year.school_code).toBe('135617');
    // A blank general average is no average: never a zero, and never computed from the rows.
    expect(body.year.general_average).toBeNull();
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0]).toMatchObject({ name: 'Filipino', q1: 86, final: 87.5 });
    // A quarter nobody typed stays empty.
    expect(body.subjects[0]!.q2).toBeNull();
  });
});

/** A learner with Kinder as a credential, a transcribed Grade 1 and 2, and a recorded Grade 3. */
const sf10: Sf10Form = {
  form: 'sf10',
  school: { name: 'Balili Elementary School', school_code: '135617', address: 'Balili', region: 'CAR', division: 'Benguet', district: 'La Trinidad', school_head_name: 'M. Principal', school_head_position: 'School Principal I' },
  learner: { id: 'l1', first_name: 'Ana', middle_name: 'S', last_name: 'Reyes', name_extension: null, sex: 'female', lrn: '136170000001', birth_date: '2017-05-02' },
  eligibility: {
    credential: 'kinder_progress_report', credential_other: null, school_name: 'Balili Elementary School', school_code: '135617',
    school_address: 'Balili, La Trinidad', pept_rating: null, examined_on: null, testing_center: null, remark: null,
  },
  blocks: [
    {
      key: 'p:1', origin: 'encoded', enrollment_id: null, prior_year_id: '1', grade_level: 1, section_name: 'Ilang-Ilang', adviser_name: 'B. Santos',
      school: { name: 'Balili Elementary School', school_code: '135617', address: 'Balili', region: 'CAR', division: 'Benguet', district: 'La Trinidad' },
      school_year: { id: null, start_year: 2023 }, periods: [1, 2, 3, 4].map(n => ({ id: String(n), ordinal: n, name: String(n) })),
      subjects: [{ key: 'p:1:1', offering_id: null, code: 'LANGUAGE', name: 'Language', terms: { '1': 86, '2': 87, '3': null, '4': null }, final: 86.5, remark: 'passed' }],
      general_average: { value: 86.5, remark: 'passed' }, outcome: { action: null, eligible_grade: null },
    },
    {
      key: 'p:2', origin: 'encoded', enrollment_id: null, prior_year_id: '2', grade_level: 2, section_name: 'Sampaguita', adviser_name: 'A. Dela Cruz',
      school: { name: 'Mankayan Central School', school_code: '135642', address: 'Mankayan', region: null, division: null, district: null },
      school_year: { id: null, start_year: 2024 }, periods: [1, 2, 3, 4].map(n => ({ id: String(n), ordinal: n, name: String(n) })),
      subjects: [{ key: 'p:2:1', offering_id: null, code: 'FILIPINO', name: 'Filipino', terms: { '1': 88, '2': 89, '3': 90, '4': 91 }, final: 89.5, remark: 'passed' }],
      general_average: { value: 89.5, remark: 'passed' }, outcome: { action: null, eligible_grade: null },
    },
    {
      key: 'e:3', origin: 'register', enrollment_id: 'en3', prior_year_id: null, grade_level: 3, section_name: 'Rosal', adviser_name: 'C. Teacher',
      school: { name: 'Balili Elementary School', school_code: '135617', address: 'Balili', region: 'CAR', division: 'Benguet', district: 'La Trinidad' },
      school_year: { id: 'y1', start_year: 2026 }, periods: [1, 2, 3, 4].map(n => ({ id: `q${n}`, ordinal: n, name: String(n) })),
      subjects: [{ key: 'o:1', offering_id: 'o1', code: 'FILIPINO', name: 'Filipino', terms: { q1: 90, q2: 91, q3: null, q4: null }, final: null, remark: null }],
      general_average: { value: null, remark: null }, outcome: { action: null, eligible_grade: null },
    },
  ],
  last_school_year: 2026, eligible_grade: null, kindergarten_here: false,
};

describe('the SF10 as it prints', () => {
  const markup = () => renderToStaticMarkup(createElement(Sf10Sheet, { form: sf10 }));

  it('prints transcribed years and recorded years in the one official layout', () => {
    const html = markup();
    expect(html).toContain('Learner Permanent Academic Record for Elementary School (SF10-ES)');
    for (const year of ['2023 - 2024', '2024 - 2025', '2026 - 2027']) expect(html).toContain(year);
    // Each block prints its own school: a transferee's earlier year was taught elsewhere.
    expect(html).toContain('Mankayan Central School');
    expect(html).toContain('135642');
    // And nothing of this school is put in that block's district, division or region.
    const mankayan = html.slice(html.indexOf('Mankayan Central School'), html.indexOf('Mankayan Central School') + 600);
    expect(mankayan).not.toContain('La Trinidad');
    // A transcribed grade prints exactly as it was entered.
    expect(html).toContain('>86.5<');
    expect(html).toContain('>89.5<');
  });

  it('prints the Kindergarten credential in the eligibility block, with no grade', () => {
    const html = markup();
    expect(html).toContain('ELIGIBILITY FOR ELEMENTARY SCHOOL ENROLLMENT');
    // The chosen box is ticked and the others are not.
    expect(html).toMatch(/☒ Kinder Progress Report/);
    expect(html).toMatch(/☐ ECCD Checklist/);
    expect(html).toMatch(/☐ Kindergarten Certificate of Completion/);
    // There is no scholastic block for Kinder, and the credential carries no number.
    expect(html).not.toContain('Classified as Grade:</th><td>0<');
  });

  it('keeps the form’s own blank lines when no credential has been encoded yet', () => {
    const blank = renderToStaticMarkup(createElement(Sf10Sheet, { form: { ...sf10, eligibility: null } }));
    expect(blank).toMatch(/☐ Kinder Progress Report/);
    expect(blank).not.toMatch(/☒/);
    // So the sheet can still be completed by hand.
    expect(blank).toContain('______________________');
  });

  it('pairs every sheet front and back, so a nine-year record still duplexes', () => {
    const many = { ...sf10, blocks: Array.from({ length: 9 }, (_, i) => ({ ...sf10.blocks[0]!, key: `k${i}`, school_year: { id: null, start_year: 2016 + i } })) };
    const pages = renderToStaticMarkup(createElement(Sf10Sheet, { form: many })).match(/class="card-page portrait"/g) ?? [];
    // Nine blocks is three sheets of four, rounded up to a whole leaf: four.
    expect(pages).toHaveLength(4);
    // And no year is lost off the end, which is the fault this guards.
    for (let year = 2016; year <= 2024; year += 1) expect(renderToStaticMarkup(createElement(Sf10Sheet, { form: many }))).toContain(`${year} - ${year + 1}`);
  });
});

/**
 * Who has to search, and who is simply shown their learners.
 *
 * An adviser's list is the learners in the classes they advise — already
 * theirs to read — so it is shown on opening and there is no grade to choose.
 * A manager's is the whole school, and every list under /learners writes a
 * `record_access_events` row naming what it returned, so theirs still starts
 * from a search.
 */
describe('finding a learner on Academic history', () => {
  it('shows an adviser their own learners on opening, with no grade filter', async () => {
    await mount('teacher');
    // The list is read without anything being chosen first.
    expect(sent.some(r => r.path.startsWith('/learners?'))).toBe(true);
    expect(host.textContent).not.toContain('Find the learner first');
    // And the control that could only ever narrow their own class is gone.
    expect(host.textContent).not.toContain('Grade level now');
    expect(host.textContent).not.toContain('Any grade');
  });

  it('lists the school when a manager searches with Any grade, which used to come back empty', async () => {
    await mount('principal');
    // Nothing read yet: a manager starts from a search.
    expect(sent.some(r => r.path.startsWith('/learners?'))).toBe(false);
    expect(host.textContent).toContain('Find the learner first');

    // Submit the finder with every field left at its empty value — which is
    // exactly what "Any grade" is. The gate used to be
    // `Object.values(search).some(Boolean)`, so this cleared the list and the
    // screen reported no learners in the school.
    await press('Search');

    expect(sent.some(r => r.path.startsWith('/learners?'))).toBe(true);
    expect(host.textContent).not.toContain('Find the learner first');
  });

  it('keeps the grade filter for a manager', async () => {
    await mount('principal');
    expect(host.textContent).toContain('Grade level now');
  });
});
