import { useEffect, useState, type ReactNode } from 'react';
import type { Api, Row } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { clamp, dayAndMonth, firstOf, monthName, monthOf, type Month } from '../dates';
import { Icon } from '../components/icons';
import { PrintCopy } from '../components/print';
import { ScopePickers, sectionName, useScope } from '../components/scope';
import { SeededNotice } from '../components/seeded';
import { Badge, Callout, EmptyState, PageHeader, TableSkeleton, localToday, type Status, ScrollArea } from '../components/primitives';
import { downloadXlsx } from '../xlsx';
import { Sf2Key, Sf2Sheet, nextPair, sf2Workbook, type Pair, type Sf2Edit } from '../forms/sf2';
import { Sf2EditReview, type MarkChange, type RemarkChange } from './Sf2Edit';
import { SchoolDetailsSheet } from '../forms/details';
import { Affects } from '../components/affects';
import { IssueFlow, MonthNav, issuedLine } from '../forms/shared';
import { fingerprint, levelName, ruleWords, type Issuance, type Sf2Form } from '../forms/types';
import { Sheet } from '../components/overlay';

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "6, 7 and 9 October": dates of one month, as many as are worth reading. */
const datesIn = (dates: string[]) => {
  const days = dates.slice(0, 8).map(d => String(Number(d.slice(8, 10))));
  const more = dates.length - days.length;
  const listed = more ? `${days.join(', ')} and ${more} more` : days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}` : days[0]!;
  return `${listed} ${dayAndMonth(dates[0]!).split(' ')[1]}`;
};
import { EntryTable, type ReportRecords } from './ReportCards';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

const statusName = { draft: 'Not submitted', submitted: 'Submitted', locked: 'Locked' } as const;

/**
 * A section's SF2 for one month, computed by the API from the register, the
 * school's recorded attendance rule and the formulas the form prints. It can
 * be printed or saved as an Excel file at any time; issuing it records exactly
 * what it said, and is refused while any figure is still unknown.
 */
export function Sf2Screen({ api, me, manager, setStatus, token, route, views, onOpenRegister }: Props & { views?: ReactNode; onOpenRegister?: ((day: string) => void) | undefined }) {
  const scope = useScope(api, token);
  const [month, setMonth] = useState<Month | null>(null);
  const [form, setForm] = useState<Sf2Form | null>(null);
  const [failed, setFailed] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [printing, setPrinting] = useState<Issuance | null | false>(false);
  const [remarks, setRemarks] = useState(false);
  const [tick, setTick] = useState(0);
  // A draft month is edited where it prints, with no mode to find first: marks and remarks are held on the page until they are reviewed and recorded.
  const [marks, setMarks] = useState<Record<string, Pair>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<Record<string, { body: string; version: number }> | null>(null);
  const [reviewingEdits, setReviewingEdits] = useState(false);
  const [schoolDetails, setSchoolDetails] = useState(false);
  const { year, sectionId, section } = scope;

  useEffect(() => { if (year) setMonth(monthOf(clamp(localToday(), String(year.starts_on), String(year.ends_on)))); }, [year?.id]);
  const monthOn = month ? firstOf(month) : '';
  useEffect(() => {
    if (!sectionId || !monthOn) return;
    setForm(null); setFailed('');
    void api<Sf2Form>(`/sections/${sectionId}/forms/sf2${query({ month_on: monthOn })}`).then(setForm).catch(error => setFailed(message(error)));
  }, [api, sectionId, monthOn, token, tick]);

  const original = (id: string, day: string): Pair => {
    const cell = form?.learners.find(l => l.enrollment_id === id)?.days[day];
    return cell && typeof cell === 'object' ? { am: cell.am, pm: cell.pm } : { am: null, pm: null };
  };
  const markChanges: MarkChange[] = form ? Object.entries(marks).map(([key, after]) => {
    const [id, day] = key.split('|') as [string, string];
    return { enrollment_id: id, day_on: day, name: form.learners.find(l => l.enrollment_id === id)?.name ?? 'Learner', before: original(id, day), after };
  }).sort((a, b) => a.day_on.localeCompare(b.day_on) || a.name.localeCompare(b.name)) : [];
  const remarkChanges: RemarkChange[] = form && stored ? Object.entries(notes).filter(([id, text]) => text.trim() !== (stored[id]?.body ?? ''))
    .map(([id, text]) => ({ enrollment_id: id, name: form.learners.find(l => l.enrollment_id === id)?.name ?? 'Learner', before: stored[id]?.body ?? '', after: text, version: stored[id]?.version ?? 0 })) : [];
  const pendingCount = markChanges.length + remarkChanges.length;
  const discard = () => { setMarks({}); setNotes({}); };
  const editing = form?.month_status === 'draft';
  const formKey = form ? `${form.section.id}|${form.month_on}` : '';
  // A form read for another section or month starts with nothing held; a re-read of the same one keeps what was typed.
  const [heldFor, setHeldFor] = useState('');
  useEffect(() => { if (formKey && formKey !== heldFor) { discard(); setStored(null); setHeldFor(formKey); } }, [formKey]);
  // The remarks' recorded versions, so a remark typed on the form is saved against what is on file now.
  useEffect(() => {
    if (!form || !editing || form.section.grade_level === 0) return;
    let live = true;
    void api<ReportRecords>(`/sections/${sectionId}/report-records`).then(records => {
      if (live) setStored(Object.fromEntries(records.learners.map(l => { const n = l.notes.find(x => x.kind === 'sf2_remark' && x.month_on === form.month_on); return [l.enrollment_id, { body: n?.body ?? '', version: n?.version ?? 0 }]; })));
    }).catch(() => { if (live) setStored(null); });
    return () => { live = false; };
  }, [api, formKey, editing, tick]);
  useEffect(() => {
    if (!pendingCount) return;
    const hold = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [pendingCount > 0]);
  const today = localToday();
  const put = (id: string, day: string, next: Pair) => {
    const was = original(id, day), key = `${id}|${day}`;
    // Coming back to what is recorded is no change at all.
    setMarks(m => { const copy = { ...m }; if (next.am === was.am && next.pm === was.pm) delete copy[key]; else copy[key] = next; return copy; });
  };
  const edit: Sf2Edit | undefined = editing && form ? {
    pending: (id, day) => marks[`${id}|${day}`],
    editable: (day, cell) => !!cell && typeof cell === 'object' && cell.mark !== 'pending' && day <= today && form.columns.find(c => c.day_on === day)?.kind === 'class',
    cycle: (id, day, now) => put(id, day, nextPair(now)),
    set: put,
    remark: stored ? {
      value: id => notes[id] ?? stored[id]?.body ?? '',
      set: (id, text) => setNotes(n => ({ ...n, [id]: text })),
      changed: id => id in notes && notes[id]!.trim() !== (stored[id]?.body ?? ''),
      // What the form prints from the enrollment record stays as it is; only the adviser's own remark is typed.
      fixed: id => { const l = form.learners.find(x => x.enrollment_id === id); const own = stored[id]?.body; return (l?.remarks ?? []).filter((r, i, all) => !(own && r === own && i === all.length - 1)); },
    } : undefined,
  } : undefined;

  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={6} /></div></>;
  if (!scope.years.length || scope.sections?.length === 0) {
    return <><PageHeader route={route} /><div className="card"><EmptyState title="No section to report" body={manager ? 'An SF2 belongs to a section of a school year. Create the year and its sections first.' : 'You can prepare the SF2 of a section you currently advise.'} /></div></>;
  }

  const fileName = form ? `${me.seeded_data ? 'SEEDED-' : ''}SF2 ${levelName(form.section.grade_level)} ${form.section.name} ${form.month_on.slice(0, 7)}.xlsx` : '';
  const footer = (issuance: Issuance | null) => issuance ? issuedLine('SF2', issuance) : `Printed ${localToday()} from EDUNEXUS. Not issued: this copy is not recorded as an issued SF2.`;
  const c = form?.completeness;
  // The summary's last line is known exactly when every figure is, so it says whether the totals are filled in.
  const known = !!form && form.summary.absent_five_consecutive !== null;
  const unmarkedDays = form ? [...new Set(form.learners.flatMap(l => Object.entries(l.days)
    .filter(([, cell]) => typeof cell === 'object' && cell.mark === 'unmarked').map(([day]) => day)))].sort() : [];

  return (
    <>
      <PageHeader
        route={route}
        actions={form && pendingCount ? <>
          <Badge tone="attention">{`${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} not recorded`}</Badge>
          <button type="button" className="btn" onClick={() => setReviewingEdits(true)}>Review and record</button>
          <button type="button" className="btn ghost" onClick={discard}>Discard changes</button>
        </> : form ? <>
          {manager && editing ? <button type="button" className="btn ghost" onClick={() => setSchoolDetails(true)}>School details</button> : null}
          {/* With the remarks typed in their column, a second place to type them would only disagree with it. */}
          {!stored ? <button type="button" className="btn secondary" onClick={() => setRemarks(true)}>Remarks</button> : null}
          <button type="button" className="btn secondary" onClick={() => setPrinting(null)}><Icon name="print" size={15} />Print</button>
          <button type="button" className="btn secondary" onClick={() => { void downloadXlsx(fileName, sf2Workbook(form, footer(form.last_issuance ?? null))).catch(error => setStatus({ text: message(error), kind: 'error' })); }}><Icon name="imports" size={15} />Excel file</button>
          <button type="button" className="btn" disabled={!c?.complete} onClick={() => setIssuing(true)}>Issue this SF2</button>
        </> : undefined}
      />
      {views}
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            {pendingCount && form ? (
              // Another section or month would strand the changes held here, so the pickers wait until they are recorded or discarded.
              <p className="card-note">Editing {sectionName(section)}, {monthName(monthOf(form.month_on))}. Record or discard the changes to open another month or section.</p>
            ) : (
              <>
                <ScopePickers scope={scope} />
                {month && year ? <MonthNav month={month} setMonth={setMonth} startsOn={String(year.starts_on)} endsOn={String(year.ends_on)} /> : null}
              </>
            )}
          </div>
          {form ? (
            <div className="card-head-actions">
              <Badge tone={form.month_status === 'draft' ? 'neutral' : 'good'}>{statusName[form.month_status]}</Badge>
              {form.last_issuance ? <Badge tone="info">Issued as no. {form.last_issuance.serial}</Badge> : null}
            </div>
          ) : null}
        </div>
        <div className="card-body">
          {failed ? <Callout tone="stopped" title="This SF2 could not be prepared">{failed}</Callout> : null}
          {form && !c?.rule_recorded ? (
            <Callout tone="attention" title="Waiting on the school’s attendance rule">
              The SF2 has one mark a day; EDUNEXUS records a morning and an afternoon. Until the principal records how the school turns the two into a day, each cell shows the morning and the afternoon (A for absent), and no total, average or percentage is filled in. {manager ? <a href="#/calendar">Record it on the instructional calendar.</a> : 'Ask the principal to record it on the instructional calendar.'}
            </Callout>
          ) : null}
          {form && c?.rule_recorded && !c.complete && known && form.to_date ? (
            <Callout tone="info" title={`${monthName(monthOf(form.month_on))} is not over`}>
              Every total is counted to {dayAndMonth(form.to_date.as_of)}: {form.to_date.days_held} of {form.summary.days_of_classes} days of classes held, each one marked. A day still to come is hatched and counts for nothing{c.unconfigured_days ? `, and ${c.unconfigured_days} later date${c.unconfigured_days === 1 ? ' is' : 's are'} not set on the calendar yet` : ''}. The SF2 can be issued once the month’s last day of classes is marked.
            </Callout>
          ) : null}
          {form && c?.rule_recorded && !c.complete && !known ? (
            <Callout tone="attention" title="Some figures are still unknown">
              {sentenceCase([c.pending_days ? `the month is not over: ${c.pending_days} day${c.pending_days === 1 ? ' of classes is' : 's of classes are'} still to come` : '',
                c.unmarked_sessions ? `${c.unmarked_sessions} session${c.unmarked_sessions === 1 ? ' is' : 's are'} not marked (shown as ?)${unmarkedDays.length ? `, on ${datesIn(unmarkedDays)}` : ''}` : '',
                c.unconfigured_days ? `${c.unconfigured_days} date${c.unconfigured_days === 1 ? ' is' : 's are'} not set on the calendar` : '',
                c.alternative_delivery_days ? `${c.alternative_delivery_days} date${c.alternative_delivery_days === 1 ? ' has' : 's have'} an alternative-delivery session, which the school’s rule does not cover` : '']
                .filter(Boolean).join('; '))}. A missing mark is never counted as present, so the totals stay empty until it is recorded, and the SF2 cannot be issued yet.
              {onOpenRegister && unmarkedDays.length ? (
                <div className="callout-actions"><button type="button" className="btn secondary small" onClick={() => onOpenRegister(unmarkedDays[0]!)}>Mark {dayAndMonth(unmarkedDays[0]!)} in the register</button></div>
              ) : null}
            </Callout>
          ) : null}
          {form?.rule ? <p className="card-note">School’s rule (version {form.rule.version}): a learner {ruleWords[form.rule.mixed_day]}; a date with one classroom session {form.rule.single_session_day === 'counts' ? 'is a day of classes decided by that session' : 'is not a day of classes'}.</p> : null}
          {form?.last_issuance ? <p className="card-note">Last issued as no. {form.last_issuance.serial} on {new Date(form.last_issuance.issued_at).toLocaleString()}, fingerprint <span className="mono">{fingerprint(form.last_issuance.data_hash)}</span>. Issuing again with the same content reprints that record; different content needs a reason.</p> : null}
        </div>
        {form && editing ? (
          <div className="card-body">
            <Affects what={stored ? ['register', 'remarks'] : 'register'}>
              Click a day to change it: present, absent all day, absent in the morning, absent in the afternoon, then present again. Or type on it: <b>x</b> absent all day, <b>p</b> present, <b>m</b> absent in the morning only, <b>a</b> absent in the afternoon only; the arrow keys move between days. {stored ? 'Type a remark in the last column. ' : form.section.grade_level === 0 ? 'Kindergarten remarks wait on the Kindergarten report card, so write them on the printed form for now. ' : ''}Changed cells are outlined; nothing is recorded until you review the changes. Forms already issued keep what they said.
            </Affects>
          </div>
        ) : form ? (
          <div className="card-body">
            <Callout tone="info" title={`${monthName(monthOf(form.month_on))} is ${statusName[form.month_status].toLowerCase()}, so this SF2 is read only`}>
              A submitted or locked month’s register takes no changes, here or on the daily register. {manager ? <>To correct it, return or reopen the month on <a href="#/months">Monthly consolidation</a> first.</> : 'To correct it, ask the principal to return the month to you.'}
            </Callout>
          </div>
        ) : null}
        {form ? <div className="card-body sf2-key-body"><Sf2Key rule={form.rule} editing={editing} /></div> : null}
        {form ? <ScrollArea className={`paper-frame${editing ? ' editing' : ''}`} label="The SF2, scrolls sideways"><Sf2Sheet form={form} edit={edit} /></ScrollArea> : !failed ? <div className="card-body"><TableSkeleton columns={8} /></div> : null}
      </div>

      {reviewingEdits && form ? (
        <Sf2EditReview api={api} sectionId={sectionId} monthOn={form.month_on} marks={markChanges} remarks={remarkChanges}
          onClose={() => setReviewingEdits(false)}
          // The sheet stays open to say what happened; the form is read again behind it, and the changes wait to be checked again.
          onConflict={() => setTick(t => t + 1)}
          onDone={text => { setReviewingEdits(false); discard(); setTick(t => t + 1); setStatus({ text, kind: 'done' }); }} />
      ) : null}
      {schoolDetails ? <SchoolDetailsSheet api={api} onClose={() => setSchoolDetails(false)} onSaved={() => { setSchoolDetails(false); setTick(t => t + 1); setStatus({ text: 'School details saved. The SF2 now shows them.', kind: 'done' }); }} /> : null}
      {remarks && form ? (
        <Sheet title={`Remarks for ${monthName(monthOf(form.month_on))}`} note="What the SF2's remarks column asks for and EDUNEXUS does not know: the school a transfer went to or came from, or a dropout's reason code from the form's legend. Movements are already printed from the enrollment record." wide onClose={() => setRemarks(false)}>
          <RemarksEditor api={api} sectionId={sectionId} monthOn={form.month_on} setStatus={setStatus} onSaved={() => setTick(t => t + 1)} />
        </Sheet>
      ) : null}
      {issuing && form ? (
        <IssueFlow
          label="SF2"
          cost={`This records the SF2 of ${sectionName(section)} for ${monthName(monthOf(form.month_on))} exactly as it stands, under your name, and prints it. A later issue with different numbers is recorded as a correction.`}
          issue={reason => api<{ issuance: Issuance; form: Sf2Form }>(`/sections/${sectionId}/forms/sf2/issuances`, 'POST', { month_on: form.month_on, ...(reason ? { reason } : {}) })}
          onIssued={issuance => { setIssuing(false); setForm({ ...form, last_issuance: issuance }); setPrinting(issuance); setStatus({ text: issuance.reprint ? `SF2 no. ${issuance.serial} printed again; nothing had changed.` : `SF2 issued as no. ${issuance.serial}.`, kind: 'done' }); }}
          onClose={() => setIssuing(false)}
          setStatus={setStatus}
        />
      ) : null}
      {form ? (
        <PrintCopy printing={printing !== false} onPrinted={() => setPrinting(false)} landscape>
          <SeededNotice me={me} />
          <Sf2Sheet form={form} footer={footer(printing || null)} />
        </PrintCopy>
      ) : null}
    </>
  );
}

/** The month's SF2 remarks, one per learner now in the section, kept as report notes. */
function RemarksEditor({ api, sectionId, monthOn, setStatus, onSaved }: { api: Api; sectionId: string; monthOn: string; setStatus: (s: Status) => void; onSaved: () => void }) {
  const [records, setRecords] = useState<ReportRecords | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { void api<ReportRecords>(`/sections/${sectionId}/report-records`).then(setRecords).catch(error => setStatus({ text: message(error), kind: 'error' })); }, [api, sectionId, tick]);
  if (!records) return <TableSkeleton columns={2} />;
  if (records.section.grade_level === 0) return <p className="muted">Remarks are kept with the report-card records, which wait on the Kindergarten card. Write them on the printed form for now.</p>;
  return (
    <EntryTable
      learners={records.learners} readOnly={records.school_year.status === 'closed'} setStatus={setStatus} what="Remarks" suggested="Remarks for the SF2, from the learners’ records."
      onSaved={() => { setTick(t => t + 1); onSaved(); }}
      columns={[{ key: 'body', label: 'Remark', kind: 'text' }]}
      stored={l => { const n = l.notes.find(x => x.kind === 'sf2_remark' && x.month_on === monthOn); return { values: { body: n?.body ?? '' }, version: n?.version ?? 0 }; }}
      toEntry={(l, v, version) => ({ enrollment_id: l.enrollment_id, body: v.body || null, version })}
      save={(entries, reason) => api(`/sections/${sectionId}/report-notes`, 'POST', { kind: 'sf2_remark', month_on: monthOn, entries, reason })}
    />
  );
}
