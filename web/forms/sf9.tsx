import type { ReactNode } from 'react';
import { coreValues } from './values';
import { cardName, days, remarkWord, schoolYearLabel, shownGrade, type Sf9Form } from './types';
import { dayAndMonth } from '../dates';

// The SF9 in the layout of the school's own card for the learner's grade:
// Grade 1's descriptive card, the Grades 2–3 performance report on terms, and
// the Grades 4–6 progress report card with observed values. Every grade is
// printed as it was entered from the ECR; an empty cell is one not recorded.

// The Grades 4–6 card the school supplied (its face reads 2024–2025) prints DO 8, s. 2015's descriptors.
// DepEd Order No. 15, s. 2026, Table 11 replaces them from 2026–2027 with the scale the Grades 2–3 cards already print.
const descriptors46: [string, string, string][] = [
  ['Outstanding', '90-100', 'Passed'], ['Very Satisfactory', '85-89', 'Passed'], ['Satisfactory', '80-84', 'Passed'],
  ['Fairly Satisfactory', '75-79', 'Passed'], ['Did Not Meet Expectations', 'Below 75', 'Failed'],
];
const descriptors23: [string, string, string][] = [
  ['90-100', 'Advancing', 'Passed'], ['80-89', 'Benchmarking', 'Passed'], ['75-79', 'Connecting', 'Passed'], ['65-74', 'Developing', 'Failed'], ['0-64', 'Emerging', 'Failed'],
];
const levels: [string, string, string][] = [
  ['A', 'Advancing (Namumukod-tangi)', 'Consistently demonstrates advanced skills, understanding, and values beyond expectations; applies learning independently, confidently, and with initiative across tasks and situations.'],
  ['B', 'Benchmarking (Naipamamalas)', 'Demonstrates expected skills, understanding, and values at grade level with consistency; performs tasks accurately and independently in most situations.'],
  ['C', 'Connecting (Natutungo)', 'Shows developing skills, understanding, and values; able to apply learning in familiar tasks with minimal guidance and support.'],
  ['D', 'Developing (Nagpapaunlad)', 'Demonstrates emerging skills, understanding, and values; requires regular guidance, practice, and support to improve performance.'],
  ['E', 'Emerging (Nagsisimula)', 'Beginning to demonstrate basic skills, understanding, and values; requires close supervision, structured support, and targeted intervention.'],
];
const certify = 'This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.';

/**
 * Which @page rule each card prints on, keyed by the layout the form itself
 * reports rather than by grade level. The three cards are three different
 * sheets — Grade 1 A4 upright, Grades 2-3 A4 wide, Grades 4-6 A4 wide at a
 * wider margin — and app.css records which of the school's reference forms sets
 * each one. Grades 4-6 is A4, not Letter, decided 2026-11-02: the school's Word
 * file says Letter, but its three other references are A4, the staffroom dialog
 * defaults to it, and Letter spilled the card onto a third sheet.
 * This is not cosmetic: laid out on the wrong page box, the print dialog
 * shrinks the whole card to fit the paper in the tray, which is what made the
 * text unreadable and left a third of the sheet empty. Both places that print
 * an SF9 — the learner's own card and the section's batch — read it from here.
 */
export const sf9Page: Record<Sf9Form['layout'], string> = { grade1: 'sf9-g1', grades2_3: 'sf9-g23', grades4_6: 'sf9-g46' };
const short = (month: string) => month.slice(0, 3);

/*
 * The card was once typed where it prints: every box the adviser fills was an
 * input in its own cell. That was removed on 3 November 2026 so that the SF9 is
 * only ever a reading of what is recorded. A report card is now entered in one
 * place, Promotion → Report card, which goes through the same writer with its
 * own review, version check and journal entry; a second way in was a second
 * way for the two to disagree. Nothing here takes a value, by design — if
 * typing ever returns it belongs behind that one writer, not in the sheet.
 */
/** A month under way is counted to date and starred, so a partial month never reads as a whole one. */
const star = (to?: string) => (to ? '*' : '');
function ToDate({ form }: { form: Sf9Form }) {
  const month = form.attendance.rows.find(r => r.to_date);
  const total = form.attendance.total.to_date;
  if (!month && !total) return null;
  return <p className="card-small">* {month ? `${month.label} is counted to ${dayAndMonth(month.to_date!)}; the month is not over.` : ''}{total ? ` The total is to ${dayAndMonth(total)}.` : ''}</p>;
}

/**
 * The two seals at the head of the card, as the DepEd forms place them: the
 * Department's on the left, the school's on the right, the heading centred
 * between them.
 *
 * They are files, not vector redraws like the EDUNEXUS mark in
 * `components/brand.tsx`: a seal is photographic detail rather than geometry,
 * and `img-src 'self'` already serves the sign-in page's hillside from
 * `/images/`, so two more same-origin files need no change to the policy. They
 * must stay same-origin — the policy blocks a remote URL, and a report card
 * should not depend on a third-party host being up on the day it is printed.
 * Each name carries its version, as the hero illustration's does.
 *
 * Both carry transparency. The Department's artwork as published sits on a grey
 * gradient, which printed as a box around the seal; that background was cut
 * away by flood-filling inwards from the border, so the white inside the ring
 * and the open book is left alone.
 *
 * Empty alt text on purpose: the Department and the school are both named in
 * the heading between them, so announcing either again would only repeat.
 */
const DepedSeal = () => <img className="card-seal" src="/images/deped-seal-v2-320.png" alt="" width={320} height={320} />;
const SchoolSeal = () => <img className="card-seal" src="/images/balili-seal-v1-231.png" alt="" width={231} height={223} />;

function Heading({ form, title }: { form: Sf9Form; title: string }) {
  const s = form.school;
  return (
    <div className="card-heading">
      <DepedSeal />
      <div className="card-heading-text">
        <p>Republic of the Philippines</p>
        <p>Department of Education</p>
        {s.region ? <p>{s.region}</p> : null}
        {s.division ? <p>{s.division}</p> : null}
        {s.district ? <p>{s.district}</p> : null}
        <p className="card-school">{s.name.toUpperCase()}</p>
        {s.school_code ? <p>School ID {s.school_code}</p> : null}
        <h3>{title}</h3>
        <p>School Year {schoolYearLabel(form.school_year.start_year).replace(' - ', '-')}</p>
      </div>
      <SchoolSeal />
    </div>
  );
}
const Line = ({ label, value }: { label: string; value: ReactNode }) => <span className="card-line"><span>{label}</span><b>{value}</b></span>;
const Signature = ({ name, role }: { name: string | null | undefined; role: string }) => (
  <div className="card-signature"><b>{name ? name.toUpperCase() : ''}</b><span>{role}</span></div>
);
function Transfer({ form, adviserLabel, headLabel }: { form: Sf9Form; adviserLabel: string; headLabel: string }) {
  // The Grades 4–6 card has no certifying sentence and no "Admitted to Grade" line, and cancels eligibility "for" transfer.
  const older = form.layout === 'grades4_6';
  return (
    <div className="card-box">
      <h4>Certificate of Transfer</h4>
      {older ? null : <p>{certify}</p>}
      <p>{older ? null : <>Admitted to Grade: ____________ &nbsp; </>}Eligible for Admission to Grade: <b className="card-fill">{form.outcome.eligible_grade ?? '____________'}</b></p>
      <p>Approved:</p>
      <div className="card-signatures">
        <Signature name={form.enrollment.adviser_name} role={adviserLabel} />
        <Signature name={form.school.school_head_name} role={headLabel} />
      </div>
      <h4>Cancellation of Eligibility {older ? 'for' : 'to'} Transfer</h4>
      <p>Admitted in: ______________________ &nbsp; Date: ______________</p>
      <div className="card-signatures"><Signature name={form.school.school_head_name} role={headLabel} /></div>
    </div>
  );
}

function Grades({ form, finalLabel }: { form: Sf9Form; finalLabel: string }) {
  const grade = (key: string, shown: number | null | undefined, _label: string, bold = false) =>
    <td key={key} className="numeric">{bold ? <b>{shownGrade(shown)}</b> : shownGrade(shown)}</td>;
  const remark = (key: string, shown: 'passed' | 'failed' | null, _label: string) =>
    <td key={key} className="numeric">{remarkWord(shown)}</td>;
  return (
    <table className="paper-grid card-table">
      <thead>
        <tr><th rowSpan={2}>Learning Areas</th><th colSpan={form.periods.length}>{form.layout === 'grades4_6' && form.periods.length === 4 ? 'Quarter' : 'Term'}</th><th rowSpan={2}>{finalLabel}</th><th rowSpan={2}>Remarks</th></tr>
        <tr>{form.periods.map(p => <th key={p.id}>{form.layout === 'grades4_6' ? p.ordinal : `T${p.ordinal}`}</th>)}</tr>
      </thead>
      <tbody>
        {form.subjects.map(s => (
          <tr key={s.offering_id}>
            <td>{s.name}</td>
            {form.periods.map(p => grade(`g:${s.offering_id}:${p.id}`, s.terms[p.id], `${s.name}, ${p.name}`))}
            {grade(`g:${s.offering_id}:final`, s.final, `${s.name}, ${finalLabel}`)}{remark(`r:${s.offering_id}`, s.remark, `${s.name}, remarks`)}
          </tr>
        ))}
        <tr className="card-average"><td colSpan={form.periods.length + 1}><b>General Average</b></td>{grade('a:grade', form.general_average.value, 'General average', true)}{remark('a:remark', form.general_average.remark, 'General average, remarks')}</tr>
      </tbody>
    </table>
  );
}

function MonthTable({ form, rows, corner }: { form: Sf9Form; rows: [string, 'class_days' | 'present' | 'absent' | 'tardy'][]; corner: string }) {
  return (
    <table className="paper-grid card-table attendance">
      <thead><tr><th>{corner}</th>{form.attendance.rows.map(r => <th key={r.from}>{short(r.label)}{star(r.to_date)}</th>)}<th>Total{star(form.attendance.total.to_date)}</th></tr></thead>
      <tbody>
        {rows.map(([label, key]) => (
          <tr key={key}><td>{label}</td>{form.attendance.rows.map(r => <td key={r.from} className="numeric">{days(r[key])}</td>)}<td className="numeric">{days(form.attendance.total[key])}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** The Grades 4–6 progress report card: a folded sheet, front and back. */
function Card46({ form }: { form: Sf9Form }) {
  const tardy = form.rule?.mixed_day === 'tardy';
  return (
    <>
      <div className="card-page">
        <div className="card-half">
          <h4>Attendance Record</h4>
          <MonthTable form={form} corner="Academic Months" rows={[['No. of School Days', 'class_days'], ['No. of School Days Present', 'present'], ...(tardy ? [['No. of Times Tardy', 'tardy']] as [string, 'tardy'][] : [])]} />
          <ToDate form={form} />
          {tardy ? null : <p className="card-small">Times tardy are not recorded under the school’s attendance rule.</p>}
          <h4>Parent/Guardian’s Signature</h4>
          {form.periods.map(p => <p key={p.id} className="card-sign-line">{p.name} ______________________________</p>)}
        </div>
        <div className="card-half">
          <p className="card-small">DepEd School Form 9</p>
          <Heading form={form} title="PROGRESS REPORT CARD" />
          <Line label="Name:" value={cardName(form.learner)} />
          <Line label="LRN:" value={form.learner.lrn ?? ''} />
          <span className="card-pair"><Line label="Age:" value={form.learner.age_at_start?.years ?? ''} /><Line label="Gender:" value={form.learner.sex === 'male' ? 'Male' : 'Female'} /></span>
          <span className="card-pair"><Line label="Grade:" value={form.enrollment.grade_level} /><Line label="Section:" value={form.enrollment.section_name} /></span>
          <p className="card-letter">Dear Parent/s:<br />This report card shows the ability and progress your child has made in the different learning areas as well as his/her progress in character development.<br />The school welcomes you for a visit if you desire to know more about the progress of your child.</p>
          <div className="card-signatures">
            <Signature name={form.enrollment.adviser_name} role="Teacher-Adviser" />
            <Signature name={form.school.school_head_name} role={form.school.school_head_position ?? 'Principal'} />
          </div>
          <Transfer form={form} adviserLabel="Teacher-Adviser" headLabel={form.school.school_head_position ?? 'Principal'} />
        </div>
      </div>
      <div className="card-page">
        <div className="card-half">
          <h4>Report on Learning Progress and Achievement</h4>
          <Grades form={form} finalLabel="Final Grade" />
          <table className="paper-grid card-table descriptors">
            <thead><tr><th>Descriptors</th><th>Grading Scale</th><th>Remarks</th></tr></thead>
            <tbody>{(form.school_year.start_year >= 2026 ? descriptors23.map(([scale, word, remark]): [string, string, string] => [word, scale, remark]) : descriptors46).map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="card-half">
          <h4>Report on Learner’s Observed Values</h4>
          <table className="paper-grid card-table">
            <thead><tr><th rowSpan={2}>Core Values</th><th rowSpan={2}>Behavior Statements</th><th colSpan={form.periods.length}>{form.periods.length === 4 ? 'Quarter' : 'Term'}</th></tr>
              <tr>{form.periods.map(p => <th key={p.id}>{p.ordinal}</th>)}</tr></thead>
            <tbody>
              {coreValues.flatMap(v => v.statements.map((st, i) => (
                <tr key={st.code}>
                  {i === 0 ? <td rowSpan={v.statements.length}><b>{v.value}</b></td> : null}
                  <td>{st.text}</td>
                  {form.periods.map(p => <td key={p.id} className="numeric">{form.values[p.id]?.[st.code] ?? ''}</td>)}
                </tr>
              )))}
            </tbody>
          </table>
          <table className="paper-grid card-table descriptors">
            <thead><tr><th>Marking</th><th>Non-numerical Rating</th></tr></thead>
            <tbody>{[['AO', 'Always Observed'], ['SO', 'Sometimes Observed'], ['RO', 'Rarely Observed'], ['NO', 'Not Observed']].map(([m, r]) => <tr key={m}><td>{m}</td><td>{r}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** The Grades 2–3 learner's performance report, one landscape sheet. */
function Card23({ form }: { form: Sf9Form }) {
  return (
    <div className="card-page">
      <div className="card-half">
        <Heading form={form} title="LEARNER'S PERFORMANCE REPORT" />
        <span className="card-pair"><Line label="Name:" value={cardName(form.learner)} /><Line label="Age:" value={form.learner.age_at_start?.years ?? ''} /></span>
        <span className="card-pair"><Line label="LRN:" value={form.learner.lrn ?? ''} /><Line label="Sex:" value={form.learner.sex === 'male' ? 'Male' : 'Female'} /></span>
        <span className="card-pair"><Line label="Grade:" value={form.enrollment.grade_level} /><Line label="Section:" value={form.enrollment.section_name} /></span>
        <p className="card-letter">Dear Parents,<br />This Performance Report presents your child’s progress and achievement in the different learning areas.<br />The school welcomes you to reach out should you wish to know more about your child’s learning and performance.</p>
        <div className="card-signatures">
          <Signature name={form.school.school_head_name} role="School Head" />
          <Signature name={form.enrollment.adviser_name} role="Adviser" />
        </div>
        <h4>Learning Progress and Achievement</h4>
        <Grades form={form} finalLabel={form.enrollment.grade_level === 3 ? 'Ave.' : 'Final Grade'} />
        <table className="paper-grid card-table descriptors">
          <thead><tr><th>Grading Scale</th><th>Descriptors</th><th>Remarks</th></tr></thead>
          <tbody>{descriptors23.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card-half">
        <h4>Attendance Record</h4>
        <MonthTable form={form} corner="Month" rows={[['No. of Class Days', 'class_days'], ['No. of Days Present', 'present'], ['No. of Days Absent', 'absent']]} />
        <ToDate form={form} />
        <h4>Teacher’s Comments / Remarks</h4>
        {form.periods.map(p => (
          <div key={p.id} className="card-comment"><b>{p.name}</b>
            <p>{form.notes[p.id]?.comment ?? ''}</p>
          </div>
        ))}
        <h4>Parent/s Guardian’s Signature</h4>
        {form.periods.map(p => <p key={p.id} className="card-sign-line">{p.name} ______________________________</p>)}
        <Transfer form={form} adviserLabel="Adviser" headLabel="School Head" />
      </div>
    </div>
  );
}

/** The Grade 1 learner's progress report card: narratives by term, no grades. */
function Card1({ form }: { form: Sf9Form }) {
  const ageText = (a: Sf9Form['learner']['age_at_start']) => (a ? `${a.years} years, ${a.months} months` : '');
  const terms = [...new Set(form.attendance.rows.map(r => r.term ?? ''))];
  return (
    <div className="card-page portrait">
      <Heading form={form} title="LEARNER'S PROGRESS REPORT CARD" />
      <span className="card-pair"><Line label="Name:" value={cardName(form.learner)} /><Line label="LRN:" value={form.learner.lrn ?? ''} /></span>
      <span className="card-pair"><Line label="Section:" value={form.enrollment.section_name} /><Line label="Teacher:" value={form.enrollment.adviser_name ?? ''} /><Line label="Birthdate:" value={form.learner.birth_date ?? ''} /></span>
      <span className="card-pair"><Line label="Age of the Child (Beginning of SY):" value={ageText(form.learner.age_at_start)} /><Line label="Age of the Child (End of SY):" value={ageText(form.learner.age_at_end)} /></span>
      <p className="card-letter">This report provides a descriptive account of your child’s learning progress for each term. It highlights what your child can already do, what they are currently developing, and how they can be further supported.<br />This report is based on varied evidence of learning, including classroom activities, observations, learner outputs, and assessments. It is designed to give a clearer and more meaningful understanding of your child’s development rather than relying on numerical or letter grades.</p>
      <div className="card-columns">
        <div>
          {form.periods.map(p => (
            <div key={p.id} className="card-term">
              <h4>{p.name.toUpperCase()}</h4>
              <div className="card-comment"><b>What Your Child Can Do (Mga Nagagawa)</b>
                <p>{form.notes[p.id]?.can_do ?? ''}</p>
              </div>
              <div className="card-comment"><b>What Your Child Is Learning To Improve (Dapat Linangin)</b>
                <p>{form.notes[p.id]?.to_improve ?? ''}</p>
              </div>
              <p className="card-sign-line">Parent’s/Guardian’s Signature: ______________________</p>
            </div>
          ))}
        </div>
        <div>
          <h4>Attendance Record</h4>
          <table className="paper-grid card-table attendance">
            <thead><tr><th>Term</th><th>Month</th><th>No. of Class Days</th><th>No. Days Present</th><th>No. of Times Absent</th></tr></thead>
            <tbody>
              {terms.flatMap(term => form.attendance.rows.filter(r => (r.term ?? '') === term).map((r, i, all) => (
                <tr key={r.from + term}>
                  {i === 0 ? <td rowSpan={all.length}>{term}</td> : null}
                  <td>{r.label}{star(r.to_date)}</td><td className="numeric">{days(r.class_days)}</td><td className="numeric">{days(r.present)}</td><td className="numeric">{days(r.absent)}</td>
                </tr>
              )))}
              <tr className="card-average"><td colSpan={2}><b>TOTAL{star(form.attendance.total.to_date)}</b></td><td className="numeric">{days(form.attendance.total.class_days)}</td><td className="numeric">{days(form.attendance.total.present)}</td><td className="numeric">{days(form.attendance.total.absent)}</td></tr>
            </tbody>
          </table>
          <ToDate form={form} />
          <h4>Important Note to Parents/Guardians</h4>
          <p className="card-small">A detailed record of your child’s progress across specific learning competencies is attached in the succeeding pages. This includes the monitoring of skills in Reading and Literacy, Language, Mathematics, Good Manners and Right Conduct, and Makabansa.</p>
          <p className="card-small">Performance levels used in monitoring:</p>
          <table className="paper-grid card-table descriptors">
            <thead><tr><th>Letter Grade</th><th>Descriptor</th><th>Description</th></tr></thead>
            <tbody>{levels.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
          <Transfer form={form} adviserLabel="Adviser" headLabel="School Head" />
        </div>
      </div>
    </div>
  );
}

export function Sf9Sheet({ form, footer }: { form: Sf9Form; footer?: ReactNode }) {
  return (
    <div className={`paper sf9 sf9-${form.layout}`}>
      {form.layout === 'grade1' ? <Card1 form={form} /> : form.layout === 'grades2_3' ? <Card23 form={form} /> : <Card46 form={form} />}
      {footer ? <p className="print-foot">{footer}</p> : null}
    </div>
  );
}
