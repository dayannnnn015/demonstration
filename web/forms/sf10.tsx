import type { ReactNode } from 'react';
import { remarkWord, schoolYearLabel, shownGrade, type Sf10Block, type Sf10Form } from './types';

// The SF10-ES in the layout of DepEd's permanent-record workbook (the 2025
// revision the school supplied): the learner, eligibility for Grade 1, one
// scholastic block per school year, and the certification boxes. What EDUNEXUS
// does not hold — remedial classes, a signature — is left as the form's own
// blank lines.
//
// A block is a year EDUNEXUS recorded itself or one transcribed from the
// school's own documents (0051), and the two print identically: the permanent
// record is one continuous history and the form has one shape for a year.

type Block = Sf10Block;

function Scholastic({ block }: { block: Block | null }) {
  // Each block carries its own school heading, because a transferee's earlier
  // year was taught somewhere else and the form's heading has those fields for
  // exactly that. An empty block prints blank, as the workbook rules it.
  const s = block?.school;
  const periods = block?.periods.length ? block.periods : [1, 2, 3, 4].map(n => ({ id: `q${n}`, ordinal: n, name: String(n) }));
  return (
    <div className="sf10-block">
      <table className="paper-grid sf10-head">
        <tbody>
          <tr><th>School:</th><td>{s?.name ?? ''}</td><th>School ID:</th><td>{s?.school_code ?? ''}</td></tr>
          <tr><th>District:</th><td>{s?.district ?? ''}</td><th>Division:</th><td>{s?.division ?? ''}</td></tr>
          <tr><th>Region:</th><td>{s?.region ?? ''}</td><th>School Year:</th><td>{block ? schoolYearLabel(block.school_year.start_year) : ''}</td></tr>
          <tr><th>Classified as Grade:</th><td>{block?.grade_level ?? ''}</td><th>Section:</th><td>{block?.section_name ?? ''}</td></tr>
          <tr><th>Name of Adviser/Teacher:</th><td>{block?.adviser_name ?? ''}</td><th>Signature:</th><td /></tr>
        </tbody>
      </table>
      <table className="paper-grid sf10-grades">
        <thead>
          <tr><th rowSpan={2}>Learning Areas</th><th colSpan={periods.length}>Quarterly Rating</th><th rowSpan={2}>Final Rating</th><th rowSpan={2}>Remarks</th></tr>
          <tr>{periods.map(p => <th key={p.id}>{p.ordinal}</th>)}</tr>
        </thead>
        <tbody>
          {(block?.subjects ?? []).map(subject => (
            <tr key={subject.key}>
              <td>{subject.name}</td>
              {periods.map(p => <td key={p.id} className="numeric">{shownGrade(subject.terms[p.id])}</td>)}
              <td className="numeric">{shownGrade(subject.final)}</td><td className="numeric">{remarkWord(subject.remark).toUpperCase()}</td>
            </tr>
          ))}
          {block ? null : [0, 1, 2, 3, 4].map(i => <tr key={i}><td>&nbsp;</td>{periods.map(p => <td key={p.id} />)}<td /><td /></tr>)}
          <tr className="card-average"><td><b>General Average</b></td>{periods.map(p => <td key={p.id} />)}<td className="numeric"><b>{shownGrade(block?.general_average.value)}</b></td>
            <td className="numeric">{remarkWord(block?.general_average.remark ?? null).toUpperCase()}</td></tr>
        </tbody>
      </table>
      <table className="paper-grid sf10-remedial">
        <thead>
          <tr><th>Remedial Classes</th><th colSpan={4}>Conducted from: ____________ to ____________</th></tr>
          <tr><th>Learning Areas</th><th>Final Rating</th><th>Remedial Class Mark</th><th>Recomputed Final Grade</th><th>Remarks</th></tr>
        </thead>
        <tbody>{[0, 1].map(i => <tr key={i}><td>&nbsp;</td><td /><td /><td /><td /></tr>)}</tbody>
      </table>
    </div>
  );
}

function Certification({ form }: { form: Sf10Form }) {
  const l = form.learner;
  const name = `${l.first_name}${l.middle_name ? ` ${l.middle_name}` : ''} ${l.last_name}${l.name_extension ? ` ${l.name_extension}` : ''}`;
  return (
    <div className="sf10-certification">
      <h4>CERTIFICATION</h4>
      <p>I CERTIFY that this is a true record of <b>{name.toUpperCase()}</b> with LRN <b>{l.lrn ?? '____________'}</b> and that he/she is eligible for admission to Grade <b>{form.eligible_grade ?? '______'}</b>.</p>
      <p>School Name: <b>{form.school.name}</b> &nbsp; School ID: <b>{form.school.school_code ?? ''}</b> &nbsp; Division: <b>{form.school.division ?? ''}</b> &nbsp; Last School Year Attended: <b>{form.last_school_year ? schoolYearLabel(form.last_school_year) : ''}</b></p>
      <div className="card-signatures">
        <div className="card-signature"><b>&nbsp;</b><span>Date</span></div>
        <div className="card-signature"><b>{form.school.school_head_name?.toUpperCase() ?? ''}</b><span>Signature of Principal/School Head over Printed Name</span></div>
        <div className="card-signature"><b>&nbsp;</b><span>(Affix School Seal here)</span></div>
      </div>
    </div>
  );
}

/**
 * The scholastic blocks laid into the panels their grades belong to: Grade 1
 * in the first, Grade 6 in the sixth, and an empty panel wherever a year has
 * not been recorded or transcribed yet.
 *
 * **Nothing is ever dropped.** A repeated grade gives two blocks the same
 * panel; the earlier school year keeps it and the later one is placed after
 * the six, in its own order. The same is true of anything outside Grade 1 to
 * Grade 6, which the writers refuse but the form must not lose if it ever
 * arrives. A permanent academic record silently losing a year is the one
 * failure this layout exists to prevent.
 */
export function placeByGrade(source: Block[]): (Block | null)[] {
  const panels: (Block | null)[] = [null, null, null, null, null, null];
  const overflow: Block[] = [];
  // Oldest first, so a repeated grade leaves the earlier year in the panel.
  for (const block of [...source].sort((a, b) => a.school_year.start_year - b.school_year.start_year)) {
    const slot = block.grade_level - 1;
    if (slot >= 0 && slot < panels.length && panels[slot] === null) panels[slot] = block;
    else overflow.push(block);
  }
  return [...panels, ...overflow];
}

/** Four scholastic blocks to a sheet, as the workbook rules them. */
const PER_SHEET = 4;
/** Front and back: the workbook's own eight, and the unit a duplex sheet pairs in. */
const PER_LEAF = PER_SHEET * 2;

export function Sf10Sheet({ form, footer }: { form: Sf10Form; footer?: ReactNode }) {
  const l = form.learner;
  /*
   * The workbook rules four scholastic blocks to a sheet and eight across a
   * leaf, front and back. A learner's record fills them in order, and the empty
   * ones are printed too: this is a permanent record added to each year, and
   * the back of the sheet carries the years still to come rather than being
   * left blank.
   *
   * A record can outgrow one leaf — six elementary years plus a repeated grade
   * is nine blocks — so it continues onto further leaves instead of stopping at
   * eight. It used to stop: blocks past the eighth were sliced off and silently
   * lost from a permanent academic record.
   *
   * Blocks are rounded up to a whole leaf, never a half one, so the page count
   * stays even and every sheet printed two-sided has a front and a back.
   *
   * **A block sits in the panel for its grade, not the next free one** (asked
   * for 2026-11-07). A learner in Grade 3 whose earlier years have not been
   * transcribed yet has their Grade 3 year in the *third* panel and the first
   * two left empty, so the form shows at a glance which years are still
   * missing from a permanent record. Filling from the top instead made a
   * one-year record look like a complete one that began at Grade 1.
   */
  const blocks: (Block | null)[] = placeByGrade(form.blocks);
  const total = Math.max(PER_LEAF, Math.ceil(blocks.length / PER_LEAF) * PER_LEAF);
  while (blocks.length < total) blocks.push(null);
  const sheets = Array.from({ length: total / PER_SHEET }, (_, i) => blocks.slice(i * PER_SHEET, (i + 1) * PER_SHEET));
  const last = sheets.length - 1;
  return (
    <div className="paper sf10">
      {sheets.map((sheet, page) => (
        <div className="card-page portrait" key={page}>
          {page === 0 ? <FrontMatter form={form} learner={l} /> : null}
          <h4 className="sf10-band">SCHOLASTIC RECORD{page ? ' (continued)' : ''}</h4>
          <div className="sf10-blocks">
            {sheet.map((b, i) => <Scholastic key={b?.key ?? `empty${page * PER_SHEET + i}`} block={b} />)}
          </div>
          {page === 0 ? <p className="card-small">Revised 2025 based on DepEd Order No. 10, s. 2024</p> : null}
          {page === last ? (
            <>
              <h4 className="sf10-band">For Transfer Out /Elementary School Completer Only</h4>
              <Certification form={form} />
            </>
          ) : null}
        </div>
      ))}
      {footer ? <p className="print-foot">{footer}</p> : null}
    </div>
  );
}

/** The head of the record: the title, the learner, and eligibility for Grade 1. Printed once, on the first sheet. */
function FrontMatter({ form, learner: l }: { form: Sf10Form; learner: Sf10Form['learner'] }) {
  return (
    <>
        <div className="sf10-title">
          <span className="card-small">SF10-ES</span>
          {/* The Department's seal at the left and its wordmark at the right, as
              the SF10-ES workbook prints them. The seal is the same file the SF9
              heading uses; both are served from this origin, because `img-src
              'self'` blocks a remote one and a permanent record should not need
              a third-party host to print. */}
          <img className="sf10-seal" src="/images/deped-seal-v2-320.png" alt="" width={320} height={320} />
          <div className="sf10-title-text">
            <p>Republic of the Philippines</p>
            <p>Department of Education</p>
            <h3>Learner Permanent Academic Record for Elementary School (SF10-ES)</h3>
            <p>(Formerly Form 137)</p>
          </div>
          <img className="sf10-wordmark" src="/images/deped-wordmark-v1-420.png" alt="" width={420} height={339} />
        </div>
        <h4 className="sf10-band">LEARNER’S PERSONAL INFORMATION</h4>
        <table className="paper-grid sf10-head">
          <tbody>
            <tr><th>LAST NAME:</th><td>{l.last_name.toUpperCase()}</td><th>FIRST NAME:</th><td>{l.first_name.toUpperCase()}</td><th>NAME EXTN. (Jr,I,II)</th><td>{l.name_extension ?? ''}</td><th>MIDDLE NAME:</th><td>{(l.middle_name ?? '').toUpperCase()}</td></tr>
            <tr><th>Learner Reference Number (LRN):</th><td colSpan={2}>{l.lrn ?? ''}</td><th>Birthdate (mm/dd/yyyy):</th><td colSpan={2}>{l.birth_date ? `${l.birth_date.slice(5, 7)}/${l.birth_date.slice(8, 10)}/${l.birth_date.slice(0, 4)}` : ''}</td><th>Sex:</th><td>{l.sex === 'male' ? 'MALE' : 'FEMALE'}</td></tr>
          </tbody>
        </table>
        <h4 className="sf10-band">ELIGIBILITY FOR ELEMENTARY SCHOOL ENROLLMENT</h4>
        <Eligible form={form} />
    </>
  );
}

/** A plain-date to the mm/dd/yyyy the form asks for, and nothing at all when there is no date. */
const formDate = (on: string | null | undefined) => (on ? `${on.slice(5, 7)}/${on.slice(8, 10)}/${on.slice(0, 4)}` : '');
/** The form's own tick box, filled or empty. Text, not an image: the workspace loads no image for a glyph. */
const box = (on: boolean) => (on ? '☒' : '☐');
/** A box the record does not fill keeps the form's ruled line, so the paper can be completed by hand. */
const line = (text: string | null | undefined, blank = '______________________') => (text ? text : blank);

/**
 * The eligibility block: the credential presented for Grade 1, which is where a
 * learner's Kindergarten record goes. The SF10-ES has no scholastic block for
 * Kinder and EDUNEXUS records no Kindergarten grade, so this block carries the
 * credential and the school that issued it, and no number.
 *
 * With nothing recorded it prints exactly as it did before — empty boxes and
 * ruled lines — so a learner whose credential has not been encoded yet still
 * gets a form that can be completed by hand.
 */
function Eligible({ form }: { form: Sf10Form }) {
  const e = form.eligibility;
  return (
    <>
      <p className="sf10-eligibility">
        Credential Presented for Grade 1: {box(e?.credential === 'kinder_progress_report')} Kinder Progress Report &nbsp;
        {box(e?.credential === 'eccd_checklist')} ECCD Checklist &nbsp;
        {box(e?.credential === 'kindergarten_certificate')} Kindergarten Certificate of Completion
      </p>
      <p className="sf10-eligibility">
        Name of School: {line(e?.school_name)} &nbsp; School ID: {line(e?.school_code, '__________')} &nbsp;
        Address of School: {line(e?.school_address)}
      </p>
      <p className="sf10-eligibility">
        Other Credential Presented: {box(e?.credential === 'pept')} PEPT Passer Rating: {line(e?.pept_rating, '______')} &nbsp;
        Date of Examination/Assessment (mm/dd/yyyy): {line(formDate(e?.examined_on), '__________')} &nbsp;
        {box(e?.credential === 'others')} Others (Pls. Specify): {line(e?.credential_other, '____________')}
      </p>
      <p className="sf10-eligibility">
        Name and Address of Testing Center: {line(e?.testing_center, '______________________________')} &nbsp;
        Remark: {line(e?.remark, '____________')}
      </p>
    </>
  );
}
