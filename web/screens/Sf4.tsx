import { useEffect, useState } from 'react';
import type { Api, Row } from '../api';
import { message, query } from '../api';
import { monthName, monthOf } from '../dates';
import { Icon } from '../components/icons';
import { PrintCopy } from '../components/print';
import { SeededNotice } from '../components/seeded';
import { Badge, Callout, localToday, yearName, type Status, ScrollArea } from '../components/primitives';
import { downloadXlsx } from '../xlsx';
import { Sf4Sheet, sf4Workbook } from '../forms/sf4';
import { IssueFlow, issuedLine } from '../forms/shared';
import { fingerprint, ruleWords, type Issuance, type Sf4Form } from '../forms/types';
import { SchoolDetailsSheet, StaffDetailsSheet } from '../forms/details';

/**
 * The school's SF4 for the month on screen, computed by the API from every
 * section's register, the school's recorded attendance rule and the SF2's
 * formulas. It is read when asked for, names no learner, and adds nothing to
 * the privacy log. Issuing it waits until every section's month is submitted.
 */
export function Sf4Report({ api, me, year, monthOn, setStatus, auto = false }: { api: Api; me: Row; year: Row; monthOn: string; setStatus: (s: Status) => void; auto?: boolean }) {
  const [form, setForm] = useState<Sf4Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [printing, setPrinting] = useState<Issuance | null | false>(false);
  // The SF4's own words — the school's heading, and each adviser's position — are edited here, on the form that prints them.
  const [details, setDetails] = useState<'school' | 'staff' | null>(null);
  const manager = me.role === 'principal' || me.role === 'administrative_officer';
  useEffect(() => { setForm(null); if (auto) void load(); }, [year.id, monthOn]);

  const load = async () => {
    setLoading(true);
    try { setForm(await api<Sf4Form>(`/academic-years/${String(year.id)}/forms/sf4${query({ month_on: monthOn })}`)); }
    catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setLoading(false); }
  };

  const label = monthName(monthOf(monthOn));
  const c = form?.completeness;
  const footer = (issuance: Issuance | null) => issuance ? issuedLine('SF4', issuance) : `Printed ${localToday()} from EDUNEXUS. Not issued: this copy is not recorded as an issued SF4.`;
  const fileName = `${me.seeded_data ? 'SEEDED-' : ''}SF4 ${yearName(year)} ${monthOn.slice(0, 7)}.xlsx`;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>School Form 4 · Monthly learner&apos;s movement and attendance</h2>
          <p className="card-note">{yearName(year)} · {label}. {auto ? 'Counted when the month is chosen' : 'Counted when you ask'}; it names no learner, so it adds nothing to the privacy log.</p>
        </div>
        <div className="card-head-actions">
          {form?.last_issuance ? <Badge tone="info">Issued as no. {form.last_issuance.serial}</Badge> : null}
          {form ? <>
            {manager ? <>
              <button type="button" className="btn ghost" onClick={() => setDetails('school')}>Edit school details</button>
              <button type="button" className="btn ghost" onClick={() => setDetails('staff')}>Edit positions</button>
            </> : null}
            <button type="button" className="btn secondary" onClick={() => setPrinting(null)}><Icon name="print" size={15} />Print</button>
            <button type="button" className="btn secondary" onClick={() => { void downloadXlsx(fileName, sf4Workbook(form, footer(form.last_issuance ?? null))).catch(error => setStatus({ text: message(error), kind: 'error' })); }}><Icon name="imports" size={15} />Excel file</button>
            <button type="button" className="btn" disabled={!c?.complete || !!c.not_submitted} onClick={() => setIssuing(true)} data-tour="sf4-issue">Issue this SF4</button>
          </> : null}
          <button type="button" className="btn secondary" disabled={loading} aria-busy={loading} onClick={() => void load()} data-tour="sf4-prepare">{loading ? 'Counting…' : form ? 'Count again' : `Prepare the SF4 for ${label}`}</button>
        </div>
      </div>
      {form ? (
        <>
          <div className="card-body">
            {!c?.rule_recorded ? (
              <Callout tone="attention" title="Waiting on the school’s attendance rule">
                The daily average and percentage need the school’s rule for turning a morning and an afternoon into a day. The counted columns are complete; the attendance columns fill in once the principal records the rule on <a href="#/calendar">the instructional calendar</a>.
              </Callout>
            ) : c.incomplete_sections ? (
              <Callout tone="attention" title={`${c.incomplete_sections} of ${form.sections.length} sections have unknown attendance this month`}>
                A section with an unmarked session, an unset date or days still to come has no daily average yet, and neither do its grade and the school. Those rows are shaded.
              </Callout>
            ) : null}
            {c?.not_submitted ? <Callout tone="info" title={`${c.not_submitted} of ${form.sections.length} sections have not submitted ${label}`}>The SF4 is compiled from submitted SF2 months, so it can be issued once every section’s month is submitted.</Callout> : null}
            {/* Every figure on this form is counted by section, so a registered
                learner with no class is on no row and in no total. Said here,
                because otherwise the only clue is that Issue refuses. */}
            {c?.unplaced_learners ? (
              <Callout tone="attention" title={`${c.unplaced_learners} registered ${c.unplaced_learners === 1 ? 'learner is' : 'learners are'} not in a class at the end of ${label}`}>
                Every figure on the SF4 is counted by section, so {c.unplaced_learners === 1 ? 'this learner is' : 'these learners are'} on no row and in none of its totals
                — the form would report the school short by {c.unplaced_learners}. {form.unplaced.map(u => `${u.total} at ${u.grade_level === 0 ? 'Kinder' : `Grade ${u.grade_level}`}`).join(', ')}.
                Put {c.unplaced_learners === 1 ? 'them' : 'them'} in a class on <a href="#/enrollment">Enrollment</a>, then count again.
              </Callout>
            ) : null}
            {form.rule ? <p className="card-note">School’s rule (version {form.rule.version}): a learner {ruleWords[form.rule.mixed_day]}.</p> : null}
            {form.last_issuance ? <p className="card-note">Last issued as no. {form.last_issuance.serial}, fingerprint <span className="mono">{fingerprint(form.last_issuance.data_hash)}</span>.</p> : null}
          </div>
          <ScrollArea className="paper-frame" label="The SF4, scrolls sideways"><Sf4Sheet form={form} statuses /></ScrollArea>
        </>
      ) : <div className="card-body"><p className="muted">Prepare it for the month chosen above.</p></div>}
      {details === 'school' ? <SchoolDetailsSheet api={api} onClose={() => setDetails(null)} onSaved={() => { setDetails(null); setStatus({ text: 'School details saved. The SF4 now shows them.', kind: 'done' }); void load(); }} /> : null}
      {details === 'staff' ? <StaffDetailsSheet api={api} onClose={() => { setDetails(null); if (form) void load(); }} onSaved={() => undefined} /> : null}
      {issuing && form ? (
        <IssueFlow
          label="SF4"
          cost={`This records the school’s SF4 for ${label} exactly as it stands, under your name, and prints it. A later issue with different numbers is recorded as a correction.`}
          issue={reason => api<{ issuance: Issuance; form: Sf4Form }>(`/academic-years/${String(year.id)}/forms/sf4/issuances`, 'POST', { month_on: monthOn, ...(reason ? { reason } : {}) })}
          onIssued={issuance => { setIssuing(false); setForm({ ...form, last_issuance: issuance }); setPrinting(issuance); setStatus({ text: `SF4 issued as no. ${issuance.serial}.`, kind: 'done' }); }}
          onClose={() => setIssuing(false)}
          setStatus={setStatus}
        />
      ) : null}
      {form ? (
        <PrintCopy printing={printing !== false} onPrinted={() => setPrinting(false)} landscape>
          <SeededNotice me={me} />
          <Sf4Sheet form={form} footer={footer(printing || null)} />
        </PrintCopy>
      ) : null}
    </div>
  );
}
