import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Api, Row } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { Icon } from '../components/icons';
import { Sheet } from '../components/overlay';
import { ScopePickers, sectionName, useScope } from '../components/scope';
import { Badge, Callout, Cell, EmptyState, PageHeader, Select, StatusLine, Table, TableSkeleton, Task, Unrecorded, gradeName, idle, localToday, sentence, yearName, type Status, ScrollArea, Spinner } from '../components/primitives';

type Props = { api: Api; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

export type Component = { code: string; name: string; weight_basis_points: number };
type Draft = { id: string; code: string; name: string; source_reference: string; grade_levels: number[]; components: Component[]; status: 'draft' | 'archived'; version: number };
type Adoption = {
  id: string; academic_year_id: string; policy_id: string; policy_version: number; policy_snapshot: Omit<Draft, 'id'> & { id: string };
  grade_levels: number[]; adopted_on: string; adoption_reference: string; status: 'adopted' | 'withdrawn'; version: number;
};
type Binding = { id: string; offering_id: string; adoption_id: string; section_id: string; academic_year_id: string; status: 'bound' | 'released'; version: number };
type Offering = { id: string; subject_snapshot: { code: string; name: string }; active: boolean; display_order: number; version: number };
type Event = { id: string; action: string; reason: string; recorded_at: string } & Record<string, unknown>;

/** A component row as typed: the weight stays text until it is sent, so "37.5" is not rounded while someone types it. */
export type ComponentDraft = { code: string; name: string; percent: string };

/**
 * A percentage as typed, in integer basis points, or null when it is not one.
 * Two decimal places is the most a basis point can hold, so a third is refused
 * rather than rounded: rounding a weight is exactly the kind of rule this
 * system does not get to invent.
 */
export function basisPoints(percent: string): number | null {
  const text = percent.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const points = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return points >= 1 && points <= 10000 ? points : null;
}

/** Basis points written back as the percentage a person typed: 3750 is "37.5". */
export const percentText = (points: number) => {
  const whole = Math.floor(points / 100), rest = points % 100;
  return rest ? `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}` : String(whole);
};

/**
 * Why a set of components would be refused, or null. These are the API's own
 * rules — one to ten components, distinct codes, every weight a positive
 * number of basis points, all of them together exactly 100% — and nothing more.
 * There is no default weight to fall back on and no rule about what a
 * component should be called.
 */
export function componentProblem(rows: ComponentDraft[]): string | null {
  if (!rows.length) return 'Add at least one component.';
  if (rows.length > 10) return 'A policy holds at most ten components.';
  const codes = rows.map(r => r.code.trim().toUpperCase());
  if (codes.some(c => !/^[A-Z][A-Z0-9_-]{0,23}$/.test(c))) return 'Every component needs a code that starts with a letter: letters, digits, _ and -, up to 24.';
  if (new Set(codes).size !== codes.length) return 'Two components share a code. Each code must be distinct.';
  if (rows.some(r => !r.name.trim())) return 'Every component needs a name.';
  const points = rows.map(r => basisPoints(r.percent));
  if (points.some(p => p === null)) return 'Every weight is a percentage above 0 and at most 100, with no more than two decimal places.';
  const total = points.reduce<number>((sum, p) => sum + (p ?? 0), 0);
  if (total !== 10000) return `The weights total ${percentText(total)}%. They must total exactly 100%.`;
  return null;
}

export const totalPercent = (rows: ComponentDraft[]) => percentText(rows.reduce((sum, r) => sum + (basisPoints(r.percent) ?? 0), 0));

const toRows = (components: Component[]): ComponentDraft[] => components.map(c => ({ code: c.code, name: c.name, percent: percentText(c.weight_basis_points) }));
const toComponents = (rows: ComponentDraft[]): Component[] => rows.map(r => ({ code: r.code.trim(), name: r.name.trim(), weight_basis_points: basisPoints(r.percent)! }));
const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');
const gradesText = (grades: number[]) => grades.map(g => gradeName(g).replace('Grade ', '')).join(', ');

async function collect<T>(api: Api, path: string, params: Record<string, string | undefined>) {
  const items: T[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page = await api<{ items: T[]; pagination: { next_after_id: string | null } }>(`${path}${query({ ...params, limit: 100, after_id: after })}`);
    items.push(...page.items);
    if (!page.pagination.next_after_id) return items;
    after = page.pagination.next_after_id;
  }
  return items;
}

/** Components as a register: code, name, weight, and the total beneath. */
export function Components({ components }: { components: Component[] }) {
  return (
    <Table
      rows={components}
      rowKey={c => c.code}
      columns={[
        { header: 'Code', cell: c => <b className="mono">{c.code}</b> },
        { header: 'Component', cell: c => c.name },
        { header: 'Weight', cell: c => `${percentText(c.weight_basis_points)}%`, numeric: true },
      ]}
    />
  );
}

function ReasonField({ id, label = 'Reason', value, onChange }: { id: string; label?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field wide">
      <label className="label" htmlFor={id}>{label}</label>
      <textarea id={id} minLength={10} maxLength={500} value={value} onChange={event => onChange(event.target.value)} />
      <span className="hint">10–500 characters on one line, kept in the permanent history.</span>
    </div>
  );
}

function History({ api, path, versionKey }: { api: Api; path: string; versionKey: string }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  useEffect(() => { void api<{ items: Event[] }>(`${path}${query({ limit: 10 })}`).then(p => setRows(p.items)).catch(() => setRows([])); }, [api, path]);
  return (
    <Table
      loading={rows === null}
      rows={rows ?? []}
      rowKey={r => r.id}
      empty={<p className="muted">No history was returned.</p>}
      columns={[
        { header: 'Version', cell: r => <span className="mono">{String(r[versionKey])}</span> },
        { header: 'Action', cell: r => sentence(r.action) },
        { header: 'Reason', cell: r => r.reason },
        { header: 'Recorded', cell: r => <span className="mono">{new Date(r.recorded_at).toLocaleString()}</span> },
      ]}
    />
  );
}

// ------------------------------------------------------------------ drafts

/**
 * Create or revise a draft. Every field comes from the school: the screen
 * starts with no components and no weights, because any number it suggested
 * would be read as the system's opinion of a DepEd rule.
 */
function DraftSheet({ api, draft, onClose, onDone }: { api: Api; draft: Draft | null; onClose: () => void; onDone: (text: string) => void }) {
  const id = useId();
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(draft?.code ?? '');
  const [name, setName] = useState(draft?.name ?? '');
  const [source, setSource] = useState(draft?.source_reference ?? '');
  const [grades, setGrades] = useState<number[]>(draft?.grade_levels ?? []);
  const [rows, setRows] = useState<ComponentDraft[]>(draft ? toRows(draft.components) : [{ code: '', name: '', percent: '' }]);
  const [state, setState] = useState<'draft' | 'archived'>(draft?.status ?? 'draft');
  const [reason, setReason] = useState('');
  const problem = componentProblem(rows);
  const put = (index: number, patch: Partial<ComponentDraft>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) { setStatus({ text: problem, kind: 'error' }); return; }
    if (!grades.length) { setStatus({ text: 'Choose at least one grade the draft applies to.', kind: 'error' }); return; }
    const body = { name: tidy(name), source_reference: tidy(source), grade_levels: [...grades].sort(), components: toComponents(rows), status: state, reason: tidy(reason) };
    setBusy(true);
    setStatus({ text: 'Saving…', kind: 'busy' });
    try {
      if (draft) await api(`/assessment-policy-drafts/${draft.id}`, 'PATCH', { ...body, version: draft.version });
      else await api('/assessment-policy-drafts', 'POST', { ...body, code: code.trim() });
      onDone(draft ? 'Draft revised.' : 'Draft recorded.');
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={draft ? `Revise ${draft.code}` : 'Record a policy draft'} note="An unapproved draft. Recording it approves nothing and computes nothing; the weights are the school’s, typed as the school gave them." wide onClose={onClose}>
      <StatusLine status={status} />
      <form noValidate onSubmit={event => void submit(event)}>
        <div className="form-grid">
          {draft ? null : (
            <div className="field">
              <label className="label" htmlFor={`${id}-code`}>Code</label>
              <input id={`${id}-code`} maxLength={24} value={code} onChange={event => setCode(event.target.value)} />
              <span className="hint">Permanent, stored in capitals.</span>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} maxLength={120} value={name} onChange={event => setName(event.target.value)} />
          </div>
          <div className="field wide">
            <label className="label" htmlFor={`${id}-source`}>Source reference</label>
            <textarea id={`${id}-source`} minLength={10} maxLength={500} value={source} onChange={event => setSource(event.target.value)} />
            <span className="hint">Where these components and weights come from — the DepEd order or school memorandum. A reference is supplied text; it does not prove the content is right.</span>
          </div>
          <fieldset className="field choose wide">
            <legend className="label">Applies to</legend>
            <span className="checks">
              {[1, 2, 3, 4, 5, 6].map(g => (
                <label key={g} className="check-line">
                  <input type="checkbox" checked={grades.includes(g)} onChange={event => setGrades(event.target.checked ? [...grades, g] : grades.filter(x => x !== g))} />
                  <span>Grade {g}</span>
                </label>
              ))}
            </span>
            <span className="hint">Grades 1–6 only. Kindergarten has no numeric assessment policy here: it waits on the school’s own Kindergarten policy.</span>
          </fieldset>
        </div>

        <h3>Components</h3>
        <ScrollArea>
          <table>
            <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col" className="numeric">Weight (%)</th><th scope="col" className="actions">Remove</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td><input aria-label={`Component ${index + 1} code`} maxLength={24} value={row.code} onChange={event => put(index, { code: event.target.value })} /></td>
                  <td><input aria-label={`Component ${index + 1} name`} maxLength={120} value={row.name} onChange={event => put(index, { name: event.target.value })} /></td>
                  <td className="numeric"><input aria-label={`Component ${index + 1} weight`} inputMode="decimal" value={row.percent} onChange={event => put(index, { percent: event.target.value })} /></td>
                  <td className="actions">{rows.length > 1 ? <button type="button" className="btn ghost small" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</button> : null}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={2}>Total</th><td className="numeric"><b>{totalPercent(rows)}%</b></td><td /></tr></tfoot>
          </table>
        </ScrollArea>
        <div className="form-actions">
          <button type="button" className="btn secondary small" disabled={rows.length >= 10} onClick={() => setRows([...rows, { code: '', name: '', percent: '' }])}>Add a component</button>
        </div>
        {problem ? <p className="muted">{problem}</p> : null}

        <div className="form-grid">
          {draft ? (
            <div className="field">
              <label className="label" htmlFor={`${id}-state`}>State</label>
              <Select id={`${id}-state`} value={state} onChange={event => setState(event.target.value as typeof state)}>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </Select>
            </div>
          ) : null}
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
        </div>
        <div className="form-actions"><button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Saving…</> : draft ? 'Save this revision' : 'Record the draft'}</button></div>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ adoptions

/** Record that the school adopted one exact draft revision for one school year. */
function AdoptSheet({ api, drafts, years, onClose, onDone }: { api: Api; drafts: Draft[]; years: Row[]; onClose: () => void; onDone: (text: string) => void }) {
  const id = useId();
  const open = years.filter(y => y.status !== 'closed');
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [yearId, setYearId] = useState(String((open.find(y => y.status === 'active') ?? open[0])?.id ?? ''));
  const [policyId, setPolicyId] = useState(String(drafts[0]?.id ?? ''));
  const year = open.find(y => y.id === yearId);
  const [on, setOn] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const draft = drafts.find(d => d.id === policyId);
  useEffect(() => { if (year) setOn(localToday() < String(year.starts_on) ? String(year.starts_on) : localToday() > String(year.ends_on) ? String(year.ends_on) : localToday()); }, [yearId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setStatus({ text: 'Recording…', kind: 'busy' });
    try {
      await api('/assessment-policy-adoptions', 'POST', { academic_year_id: yearId, policy_id: draft.id, policy_version: draft.version, adopted_on: on, adoption_reference: tidy(reference), reason: tidy(reason) });
      onDone(`${draft.code} is recorded as adopted.`);
    } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title="Record an adoption" note="Records that the school adopted this exact revision for one school year. It is a record of the school’s decision, not EDUNEXUS approving the content." wide onClose={onClose}>
      <StatusLine status={status} />
      <form noValidate onSubmit={event => void submit(event)}>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor={`${id}-year`}>School year</label>
            <Select id={`${id}-year`} value={yearId} onChange={event => setYearId(event.target.value)}>
              {open.map(y => <option key={String(y.id)} value={String(y.id)}>{yearName(y)} — {sentence(String(y.status))}</option>)}
            </Select>
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-draft`}>Draft</label>
            <Select id={`${id}-draft`} value={policyId} onChange={event => setPolicyId(event.target.value)}>
              {drafts.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name} (version {d.version})</option>)}
            </Select>
            <span className="hint">The revision adopted is the draft’s current version, frozen from this moment. Later revisions of the draft never change it.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-on`}>Adopted on</label>
            <input id={`${id}-on`} type="date" className="date-input" value={on} min={String(year?.starts_on ?? '')} max={String(year?.ends_on ?? '')} onChange={event => setOn(event.target.value)} />
          </div>
          <div className="field wide">
            <label className="label" htmlFor={`${id}-ref`}>School record of the decision</label>
            <textarea id={`${id}-ref`} minLength={10} maxLength={500} value={reference} onChange={event => setReference(event.target.value)} />
            <span className="hint">The memorandum or minutes carrying the decision. Supplied text, kept with the adoption; it is not proof that the content is correct.</span>
          </div>
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
        </div>
        {draft ? <><h3>Components being adopted</h3><Components components={draft.components} /></> : null}
        <div className="form-actions"><button type="submit" className="btn" disabled={busy || !draft} aria-busy={busy}>{busy ? 'Recording…' : 'Record the adoption'}</button></div>
      </form>
    </Sheet>
  );
}

/** A one-way action with a reason: withdraw an adoption, release a binding. */
function ReasonSheet({ title, note, label, run, onClose, onDone }: {
  title: string; note: string; label: string; run: (reason: string) => Promise<unknown>; onClose: () => void; onDone: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Sheet title={title} note={note} onClose={onClose}>
      <StatusLine status={status} />
      <form noValidate onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        setStatus({ text: 'Recording…', kind: 'busy' });
        try { await run(tidy(reason)); onDone(); }
        catch (error) { setStatus({ text: message(error), kind: 'error' }); }
        finally { setBusy(false); }
      }}>
        <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
        <div className="form-actions"><button type="submit" className="btn danger" disabled={busy} aria-busy={busy}>{busy ? 'Recording…' : label}</button></div>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ bindings

function BindSheet({ api, offering, adoptions, section, onClose, onDone }: {
  api: Api; offering: Offering; adoptions: Adoption[]; section: Row; onClose: () => void; onDone: (text: string) => void;
}) {
  const id = useId();
  const usable = adoptions.filter(a => a.status === 'adopted' && a.grade_levels.includes(Number(section.grade_level)));
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [adoptionId, setAdoptionId] = useState(usable[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const adoption = usable.find(a => a.id === adoptionId);
  return (
    <Sheet title={`Bind ${offering.subject_snapshot.code} in ${sectionName(section)}`} note="Records which adopted policy governs this subject in this section. It is a scoping record: no score, total or grade exists anywhere." wide onClose={onClose}>
      <StatusLine status={status} />
      {!usable.length ? (
        <Callout tone="attention" title="No adoption applies to this section">
          No standing adoption in this school year covers {gradeName(section.grade_level)}. Record one first.
        </Callout>
      ) : (
        <form noValidate onSubmit={async event => {
          event.preventDefault();
          if (!adoption) return;
          setBusy(true);
          setStatus({ text: 'Recording…', kind: 'busy' });
          try {
            await api('/assessment-policy-bindings', 'POST', { offering_id: offering.id, offering_version: offering.version, adoption_id: adoption.id, adoption_version: adoption.version, reason: tidy(reason) });
            onDone(`${offering.subject_snapshot.code} is bound to ${adoption.policy_snapshot.code}.`);
          } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
          finally { setBusy(false); }
        }}>
          <div className="form-grid">
            <div className="field wide">
              <label className="label" htmlFor={`${id}-adoption`}>Adopted policy</label>
              <Select id={`${id}-adoption`} value={adoptionId} onChange={event => setAdoptionId(event.target.value)}>
                {usable.map(a => <option key={a.id} value={a.id}>{a.policy_snapshot.code} — {a.policy_snapshot.name} (adopted {a.adopted_on})</option>)}
              </Select>
              <span className="hint">Only standing adoptions in this school year that cover {gradeName(section.grade_level)}.</span>
            </div>
            <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} />
          </div>
          {adoption ? <Components components={adoption.policy_snapshot.components} /> : null}
          <div className="form-actions"><button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Recording…' : 'Record the binding'}</button></div>
        </form>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ screen

type Sheetful =
  | { kind: 'draft'; draft: Draft | null }
  | { kind: 'adopt' }
  | { kind: 'withdraw'; adoption: Adoption }
  | { kind: 'bind'; offering: Offering }
  | { kind: 'release'; binding: Binding; offering: Offering | undefined };

/**
 * The school's assessment policy, as three records it decides and EDUNEXUS
 * keeps: an unapproved draft of components and weights, the school's adoption
 * of one exact revision for a year, and which section subjects an adoption
 * governs. None of the three computes anything. The weights are the school's,
 * typed in as given, and no screen here or anywhere else turns them into a
 * total, an average or a grade.
 */
export function Policies({ api, setStatus, reload, token, route }: Props) {
  const scope = useScope(api, token);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [draftFilter, setDraftFilter] = useState<'draft' | 'archived' | 'all'>('draft');
  const [adoptions, setAdoptions] = useState<Adoption[] | null>(null);
  const [adoptionFilter, setAdoptionFilter] = useState<'adopted' | 'withdrawn' | 'all'>('adopted');
  const [offerings, setOfferings] = useState<Offering[] | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [sheet, setSheet] = useState<Sheetful | null>(null);
  const id = useId();
  const { yearId, sectionId, section } = scope;

  useEffect(() => {
    setDrafts(null);
    void collect<Draft>(api, '/assessment-policy-drafts', { status: draftFilter }).then(setDrafts).catch(() => setDrafts([]));
  }, [api, draftFilter, token]);

  useEffect(() => {
    if (!yearId) return;
    setAdoptions(null);
    void collect<Adoption>(api, '/assessment-policy-adoptions', { academic_year_id: yearId, status: adoptionFilter }).then(setAdoptions).catch(() => setAdoptions([]));
  }, [api, yearId, adoptionFilter, token]);

  useEffect(() => {
    if (!sectionId) { setOfferings(null); setBindings([]); return; }
    setOfferings(null);
    void Promise.all([
      collect<Offering>(api, `/sections/${sectionId}/subjects`, { active: 'true' }),
      collect<Binding>(api, '/assessment-policy-bindings', { section_id: sectionId, status: 'bound' }),
    ]).then(([o, b]) => { setOfferings(o.sort((x, y) => x.display_order - y.display_order || x.subject_snapshot.code.localeCompare(y.subject_snapshot.code))); setBindings(b); })
      .catch(() => { setOfferings([]); setBindings([]); });
  }, [api, sectionId, token]);

  const done = (text: string) => { setSheet(null); setStatus({ text, kind: 'done' }); reload(); };
  const adoptionOf = (binding: Binding | undefined) => adoptions?.find(a => a.id === binding?.adoption_id);
  const unarchived = (drafts ?? []).filter(d => d.status === 'draft');

  return (
    <>
      <PageHeader route={route} actions={<button type="button" className="btn" onClick={() => setSheet({ kind: 'draft', draft: null })}><Icon name="plus" size={15} />Record a draft</button>} />

      <Callout tone="info" title="EDUNEXUS supplies no weights of its own">
        Every component and percentage here is typed in from the school’s own documents. Nothing on this screen approves a policy, and nothing anywhere computes a total, an average, a transmuted grade or a passing mark from it: grading waits on the school’s grading enclosure and sample class records.
      </Callout>

      <div className="card">
        <div className="card-head">
          <div><h2>Drafts</h2><p className="card-note">Unapproved drafts of components and weights, Grades 1–6. Revising one keeps every earlier revision.</p></div>
        </div>
        <div className="card-head">
          <div className="toolbar">
            <div className="field inline">
              <label className="label" htmlFor={`${id}-drafts`}>Show</label>
              <Select id={`${id}-drafts`} value={draftFilter} onChange={event => setDraftFilter(event.target.value as typeof draftFilter)}>
                <option value="draft">Drafts</option>
                <option value="archived">Archived</option>
                <option value="all">Everything</option>
              </Select>
            </div>
          </div>
        </div>
        <Table
          loading={drafts === null}
          rows={drafts ?? []}
          rowKey={d => d.id}
          empty={<EmptyState title="No drafts" body="Record the school’s policy as a draft, exactly as its documents give it." />}
          columns={[
            { header: 'Code', cell: d => <b className="mono">{d.code}</b> },
            { header: 'Draft', cell: d => <Cell title={d.name} meta={`Grades ${gradesText(d.grade_levels)}`} /> },
            { header: 'Components', cell: d => d.components.map(c => `${c.code} ${percentText(c.weight_basis_points)}%`).join(' · ') },
            { header: 'State', cell: d => <Badge tone="attention">{d.status === 'archived' ? 'Archived, unapproved' : 'Unapproved draft'}</Badge> },
            { header: 'Version', cell: d => <span className="mono">{d.version}</span>, numeric: true },
          ]}
          detailLabel="Open"
          detail={d => (
            <>
              <p className="muted">Source: {d.source_reference}</p>
              <Components components={d.components} />
              <div className="form-actions"><button type="button" className="btn secondary" onClick={() => setSheet({ kind: 'draft', draft: d })}>Revise, archive or restore</button></div>
              <Task title="Revision history" note="Newest first"><History api={api} path={`/assessment-policy-drafts/${d.id}/events`} versionKey="policy_version" /></Task>
            </>
          )}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div><h2>Adoptions</h2><p className="card-note">The school’s decision to use one exact draft revision for a school year, frozen as it was.</p></div>
          <div className="card-head-actions">
            <button type="button" className="btn secondary" disabled={!unarchived.length || !scope.years?.some(y => y.status !== 'closed')} onClick={() => setSheet({ kind: 'adopt' })}>Record an adoption</button>
          </div>
        </div>
        <div className="card-head">
          <div className="toolbar">
            <ScopePickers scope={scope} />
            <div className="field inline">
              <label className="label" htmlFor={`${id}-adoptions`}>Adoptions</label>
              <Select id={`${id}-adoptions`} value={adoptionFilter} onChange={event => setAdoptionFilter(event.target.value as typeof adoptionFilter)}>
                <option value="adopted">Standing</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="all">Everything</option>
              </Select>
            </div>
          </div>
        </div>
        <Table
          loading={adoptions === null && !!yearId}
          rows={adoptions ?? []}
          rowKey={a => a.id}
          empty={<EmptyState title="No adoptions in this year" body="An adoption records the school’s decision to use one draft revision for this school year." />}
          columns={[
            { header: 'Policy', cell: a => <Cell title={<><b className="mono">{a.policy_snapshot.code}</b> {a.policy_snapshot.name}</>} meta={`Revision ${a.policy_version}, Grades ${gradesText(a.grade_levels)}`} /> },
            { header: 'Adopted on', cell: a => <span className="mono">{a.adopted_on}</span> },
            { header: 'School record', cell: a => a.adoption_reference },
            { header: 'State', cell: a => (a.status === 'adopted' ? <Badge tone="good">Standing</Badge> : <Badge tone="neutral">Withdrawn</Badge>) },
          ]}
          detailLabel="Open"
          detail={a => (
            <>
              <h3>The revision as adopted</h3>
              <p className="muted">Frozen at adoption. The draft may have been revised since; this does not change.</p>
              <Components components={a.policy_snapshot.components} />
              {a.status === 'adopted' ? (
                <div className="form-actions"><button type="button" className="btn secondary" onClick={() => setSheet({ kind: 'withdraw', adoption: a })}>Withdraw this adoption</button></div>
              ) : null}
              <Task title="History" note="Newest first"><History api={api} path={`/assessment-policy-adoptions/${a.id}/events`} versionKey="adoption_version" /></Task>
            </>
          )}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div><h2>Bindings for {section ? sectionName(section) : 'a section'}</h2><p className="card-note">Which adopted policy governs each subject this section takes. Pick the section above.</p></div>
        </div>
        {scope.sections?.length === 0 ? <EmptyState title="No sections in this year" body="Bindings belong to a section’s subjects." /> : (
          <Table
            loading={offerings === null && !!sectionId}
            rows={offerings ?? []}
            rowKey={o => o.id}
            empty={<EmptyState title="No subjects offered" body="Offer subjects to this section on the Subjects and offerings screen first." />}
            columns={[
              { header: 'Subject', cell: o => <Cell title={<><b className="mono">{o.subject_snapshot.code}</b> {o.subject_snapshot.name}</>} /> },
              {
                header: 'Governed by', cell: o => {
                  const binding = bindings.find(b => b.offering_id === o.id);
                  const adoption = adoptionOf(binding);
                  if (!binding) return <Unrecorded label="No policy bound" />;
                  return adoption ? <><b className="mono">{adoption.policy_snapshot.code}</b> {adoption.policy_snapshot.name}</> : <Badge tone="info">Bound</Badge>;
                },
              },
            ]}
            detailLabel="Manage"
            detail={o => {
              const binding = bindings.find(b => b.offering_id === o.id);
              if (binding) {
                return (
                  <>
                    <p className="muted">Releasing is one-way. Bind again afterwards if a different adoption should govern this subject.</p>
                    <div className="form-actions"><button type="button" className="btn secondary" onClick={() => setSheet({ kind: 'release', binding, offering: o })}>Release this binding</button></div>
                    <Task title="History" note="Newest first"><History api={api} path={`/assessment-policy-bindings/${binding.id}/events`} versionKey="binding_version" /></Task>
                  </>
                );
              }
              return <div className="form-actions"><button type="button" className="btn secondary" onClick={() => setSheet({ kind: 'bind', offering: o })}>Bind an adopted policy</button></div>;
            }}
          />
        )}
      </div>

      {sheet?.kind === 'draft' ? <DraftSheet api={api} draft={sheet.draft} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === 'adopt' ? <AdoptSheet api={api} drafts={unarchived} years={scope.years ?? []} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === 'withdraw' ? (
        <ReasonSheet
          title={`Withdraw ${sheet.adoption.policy_snapshot.code}`}
          note="One-way. The frozen revision and its history are kept, and the policy can be adopted again afterwards. Every subject it governs must be released first."
          label="Withdraw the adoption"
          run={reason => api(`/assessment-policy-adoptions/${sheet.adoption.id}/withdrawal`, 'POST', { version: sheet.adoption.version, reason })}
          onClose={() => setSheet(null)}
          onDone={() => done('Adoption withdrawn.')}
        />
      ) : null}
      {sheet?.kind === 'bind' && section ? <BindSheet api={api} offering={sheet.offering} adoptions={adoptions ?? []} section={section} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.kind === 'release' ? (
        <ReasonSheet
          title={`Release ${sheet.offering?.subject_snapshot.code ?? 'this binding'}`}
          note="One-way. The adoption and its frozen revision are kept; bind again if a different adoption should govern this subject."
          label="Release the binding"
          run={reason => api(`/assessment-policy-bindings/${sheet.binding.id}/release`, 'POST', { version: sheet.binding.version, reason })}
          onClose={() => setSheet(null)}
          onDone={() => done('Binding released.')}
        />
      ) : null}
      {scope.years === null ? <div className="card"><TableSkeleton columns={4} /></div> : null}
    </>
  );
}
