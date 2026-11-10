import { useEffect, useState, type ReactNode } from 'react';
import type { Api, Row } from '../api';
import { message } from '../api';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { PrintCopy } from '../components/print';
import { SeededNotice } from '../components/seeded';
import { Badge, Callout, FormSheet, StatusLine, TableSkeleton, idle, learnerName, localToday, type Status, ScrollArea } from '../components/primitives';
import { Affects } from '../components/affects';
import { IssueFlow, issuedLine } from '../forms/shared';
import { Sf9Sheet, sf9Page } from '../forms/sf9';
import { Sf10Sheet } from '../forms/sf10';
import { fingerprint, type Issuance, type Sf10Form, type Sf9Form } from '../forms/types';
import { profileFields } from '../record-fields';

// The SF9 and SF10 open in a view of their own that takes the working area
// beside the rail (the group leader's note of 12 October), read when opened —
// the read is in the privacy log — and shown as they print. Issuing records a
// fingerprint of exactly what the form said; a later one with different
// content is a reasoned correction of it.

const footerFor = (label: string) => (issuance: Issuance | null) =>
  issuance ? issuedLine(label, issuance) : `Printed ${localToday()} from EDUNEXUS. Not issued: this copy is not recorded as an issued ${label}.`;
const issueCost = (label: string) => `This records the ${label} exactly as it stands, under your name, and prints it. Parents keep what is printed, so check the grades against the ECR first.`;
const issuedText = (label: string, issuance: Issuance) =>
  issuance.reprint ? `${label} no. ${issuance.serial} printed again; nothing had changed.` : `${label} issued as no. ${issuance.serial}.`;
const IssuedBadge = ({ issuance }: { issuance?: Issuance | null | undefined }) =>
  (issuance ? <Badge tone="info">Issued as no. {issuance.serial} · {fingerprint(issuance.data_hash)}</Badge> : null);

/**
 * A learner's SF9, typed where it prints. "Type on the card" turns each box
 * the adviser fills — every term's grade, the subject averages and remarks,
 * the general average, the observed values and the comments or narratives —
 * into an input in its own cell; the changed boxes are reviewed together and
 * recorded in one request through the same writer as Promotion → Report card,
 * so every check, version and journal entry applies. Attendance is not typed:
 * it is counted from the register by the school's rule, so the card always
 * agrees with the SF2, and the view says where to change it.
 */
export function Sf9Dialog({ api, me, learner, enrollment, onClose }: { api: Api; me: Row; learner: Row; enrollment: Row; onClose: () => void }) {
  const url = `/enrollments/${String(enrollment.id)}/forms/sf9`;
  const [form, setForm] = useState<Sf9Form | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  const [issuing, setIssuing] = useState(false);
  const [printing, setPrinting] = useState<Issuance | null | false>(false);

  useEffect(() => { void api<Sf9Form>(url).then(setForm).catch(error => setStatus({ text: message(error), kind: 'error' })); }, [api, url]);

  const actions = form ? (
    <>
      <IssuedBadge issuance={form.last_issuance} />
      <button type="button" className="btn secondary" onClick={() => setPrinting(null)}><Icon name="print" size={15} />Print a working copy</button>
      <button type="button" className="btn" onClick={() => setIssuing(true)}>Issue this SF9</button>
    </>
  ) : undefined;

  return (
    <Sheet full title={`SF9 · ${learnerName(learner)}`} actions={actions} onClose={onClose}
      note="The report card for this school year, as it prints. Grades are entered on Promotion → Report card, so this view only shows what is recorded. Opening it is recorded in the privacy access log.">
      <StatusLine status={status} />
      {form ? (
        <>
          {/* One warning reads as a sentence; several are one per month now that each names its own dates, and a paragraph of them hides the list. */}
          {form.warnings.length ? (
            <Callout tone="attention" title="Before you issue it">
              {form.warnings.length === 1 ? form.warnings[0] : <ul>{form.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
            </Callout>
          ) : null}
          <ScrollArea className="paper-frame" label="The SF9, scrolls sideways"><Sf9Sheet form={form} /></ScrollArea>
          {issuing ? (
            <IssueFlow
              label="SF9" cost={issueCost('SF9')}
              issue={reason => api<{ issuance: Issuance; form: Sf9Form }>(`${url}/issuances`, 'POST', reason ? { reason } : {})}
              onIssued={issuance => { setIssuing(false); setForm({ ...form, last_issuance: issuance }); setPrinting(issuance); setStatus({ text: issuedText('SF9', issuance), kind: 'done' }); }}
              onClose={() => setIssuing(false)}
              setStatus={setStatus}
            />
          ) : null}
          <PrintCopy printing={printing !== false} onPrinted={() => setPrinting(false)} page={sf9Page[form.layout]}>
            <SeededNotice me={me} />
            <Sf9Sheet form={form} footer={footerFor('SF9')(printing || null)} />
          </PrintCopy>
        </>
      ) : !status.text ? <TableSkeleton columns={4} /> : null}
    </Sheet>
  );
}

/** The permanent record in the same view: every graded school year the caller may read, printed or issued. */
function FormDialog<F extends Sf10Form>({ api, me, title, note, url, label, render, onClose, learnerId }: {
  api: Api; me: Row; title: string; note: string; url: string; label: 'SF10';
  render: (form: F, footer?: string) => ReactNode; onClose: () => void;
  /** Whose details the form prints; a manager corrects them here, on the form, with what else they change said first. */
  learnerId?: string;
}) {
  const [form, setForm] = useState<F | null>(null);
  const [status, setStatus] = useState<Status>(idle);
  const [issuing, setIssuing] = useState(false);
  const [printing, setPrinting] = useState<Issuance | null | false>(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);
  const manager = me.role === 'principal' || me.role === 'administrative_officer';
  useEffect(() => { void api<F>(url).then(setForm).catch(error => setStatus({ text: message(error), kind: 'error' })); }, [api, url, tick]);
  // Read fresh when opened, so the save goes against the version on file now.
  const editDetails = async () => {
    try { setEditing(await api<Row>(`/learners/${learnerId}`)); } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
  };
  const actions = form ? (
    <>
      <IssuedBadge issuance={form.last_issuance} />
      {manager && learnerId ? <button type="button" className="btn secondary" onClick={() => void editDetails()}><Icon name="learners" size={15} />Edit learner details</button> : null}
      <button type="button" className="btn secondary" onClick={() => setPrinting(null)}><Icon name="print" size={15} />Print a working copy</button>
      <button type="button" className="btn" onClick={() => setIssuing(true)}>Issue this {label}</button>
    </>
  ) : undefined;

  return (
    <Sheet full title={title} note={note} actions={actions} onClose={onClose}>
      <StatusLine status={status} />
      {form ? (
        <>
          {!form.blocks.length ? <Callout tone="attention" title="Before you issue it">No graded school year is on record for this learner yet.</Callout> : null}
          <ScrollArea className="paper-frame" label="The form, scrolls sideways">{render(form)}</ScrollArea>
          {issuing ? (
            <IssueFlow
              label={label} cost={issueCost(label)}
              issue={reason => api<{ issuance: Issuance; form: F }>(`${url}/issuances`, 'POST', reason ? { reason } : {})}
              onIssued={issuance => { setIssuing(false); setForm({ ...form, last_issuance: issuance }); setPrinting(issuance); setStatus({ text: issuedText(label, issuance), kind: 'done' }); }}
              onClose={() => setIssuing(false)}
              setStatus={setStatus}
            />
          ) : null}
          {editing ? (
            <FormSheet title="Edit learner details" note="Correct the details exactly as the birth certificate or PSA record shows them. An assigned LRN is not changed here."
              warning={<Affects what="learner" />} submitLabel="Save details" fields={profileFields} initial={editing}
              onSubmit={data => api(`/learners/${learnerId}`, 'PATCH', { ...data, version: editing.version })}
              onSaved={() => { setEditing(null); setTick(t => t + 1); setStatus({ text: 'Learner details saved. The SF10 now shows them.', kind: 'done' }); }}
              onClose={() => setEditing(null)} />
          ) : null}
          <PrintCopy printing={printing !== false} onPrinted={() => setPrinting(false)} page="sf10">
            <SeededNotice me={me} />
            {render(form, footerFor(label)(printing || null))}
          </PrintCopy>
        </>
      ) : !status.text ? <TableSkeleton columns={4} /> : null}
    </Sheet>
  );
}

export function Sf10Dialog({ api, me, learner, onClose }: { api: Api; me: Row; learner: Row; onClose: () => void }) {
  return (
    <FormDialog<Sf10Form> api={api} me={me} label="SF10" title={`SF10 · ${learnerName(learner)}`}
      note="The permanent record: every graded school year you may read. Opening it is recorded in the privacy access log."
      url={`/learners/${String(learner.id)}/forms/sf10`} learnerId={String(learner.id)}
      render={(form, footer) => <Sf10Sheet form={form} footer={footer} />} onClose={onClose} />
  );
}
