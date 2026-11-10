import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, GENERIC_REFUSAL, codeFor, message, plainFieldMessage } from '../api';
import { useHelp } from '../help/context';
import { Icon } from './icons';
import { Confirm, Sheet } from './overlay';
import type { Route } from '../routes';

export type Field = {
  key: string;
  label: string;
  /** `checkboxes` is a set chosen from `options`. It is held as a comma-joined
   *  string like every other value and submitted as an array of option keys.
   *  `radios` is one of `options`, laid out as stacked lines rather than a
   *  select, for a choice whose wording is a sentence: a long option overflows
   *  a select and its list is drawn outside the sheet, which is how the
   *  school's attendance rule came to be unreadable. Like `choose`, it starts
   *  on nothing, so a rule is never recorded because nobody moved a default. */
  type?: string;
  optional?: boolean;
  options?: [string, string][];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  hint?: string;
  /** Takes the full width of the form grid. A reason is 10–500 characters and
   *  must not be typed into a box the width of a two-digit ordinal. */
  wide?: boolean;
  /** An option field that starts on *Choose…* rather than its first option, for a fact that must never be
   *  recorded because nobody changed the default: a learner's sex is printed on every form. */
  choose?: boolean;
};

export type Status = { text: string; kind: 'idle' | 'busy' | 'error' | 'done' };
export const idle: Status = { text: '', kind: 'idle' };

const statusIcon = { error: 'alert', busy: 'info', done: 'check', idle: 'info' } as const;

export function StatusLine({ status }: { status: Status }) {
  // A refusal the FAQ explains carries a way to its answer, opened over the page so nothing typed is lost.
  const help = useHelp();
  const code = status.kind === 'error' ? codeFor(status.text) : undefined;
  const answer = code ? help.explain?.(code) : undefined;
  return (
    <p className={`status ${status.kind}`} role="status" aria-live="polite">
      {status.kind === 'idle' ? null : <Icon name={statusIcon[status.kind]} size={16} />}
      {status.text}
      {answer && help.open ? <button type="button" className="status-help" onClick={() => help.open!({ faq: answer.id })}>What does this mean?</button> : null}
    </p>
  );
}

/**
 * A record that does not exist, drawn rather than left blank.
 *
 * This is the one rule the whole system is built around: an unmarked
 * attendance session and an unentered score are null, never zero and never
 * "present". An em dash reads as something a person typed and an empty cell
 * reads as a page that failed to load, so a missing record gets its own mark —
 * ruled diagonally, the way a clerk strikes an unused box on a paper form.
 */
export function Unrecorded({ label = 'Not recorded' }: { label?: string }) {
  return <span className="unrecorded">{label}</span>;
}

/**
 * A small turning mark for something under way: a button that is saving, a
 * start screen. Drawn in CSS, never an image, and still under reduced motion.
 */
export function Spinner() {
  return <span className="btn-mark" aria-hidden="true" />;
}

/**
 * Something is being read. A skeleton is drawn in the shape of what is coming,
 * and says so to a screen reader, which cannot see the shape.
 */
function Loading({ className, children }: { className: string; children: ReactNode }) {
  return <div className={className} role="status" aria-busy="true"><span className="sr-only">Loading…</span>{children}</div>;
}

/** A record's facts, as label and value pairs, still being read. */
export function FactsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Loading className="facts skeleton-facts">
      {Array.from({ length: count }, (_, i) => <div key={i} aria-hidden="true"><span className="skeleton short" /><span className="skeleton" /></div>)}
    </Loading>
  );
}

/** A card's body of text or controls, still being read. */
export function BlockSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Loading className="skeleton-block">
      {Array.from({ length: lines }, (_, i) => <span key={i} aria-hidden="true" className={`skeleton${i === lines - 1 ? ' half' : ''}`} />)}
    </Loading>
  );
}

/** The workspace prints: a section list is carried to a classroom on paper. */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" className="btn secondary" onClick={() => window.print()}>
      <Icon name="print" size={15} />{label}
    </button>
  );
}

export function Button({ label, onRun, setStatus, variant = 'secondary', size, confirm, confirmTitle, confirmLabel, icon }: {
  label: string;
  onRun: () => Promise<unknown> | unknown;
  setStatus: (status: Status) => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | undefined;
  /** The consequence, stated in the screen's own words. Its presence opens a
   *  confirmation before the action runs. */
  confirm?: ReactNode | undefined;
  confirmTitle?: string | undefined;
  confirmLabel?: string | undefined;
  icon?: Parameters<typeof Icon>[0]['name'] | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const classes = ['btn', variant === 'primary' ? '' : variant, size ?? ''].filter(Boolean).join(' ');

  const run = async () => {
    setBusy(true);
    try { await onRun(); } catch (error) { setStatus({ text: message(error), kind: 'error' }); }
    finally { if (alive.current) { setBusy(false); setAsking(false); } }
  };

  return (
    <>
      <button type="button" className={classes} disabled={busy} aria-busy={busy} onClick={() => (confirm ? setAsking(true) : void run())}>
        {busy ? <span className="btn-mark" aria-hidden="true" /> : icon ? <Icon name={icon} size={15} /> : null}
        {/* The same word every other waiting control in the workspace uses, so
            "Working…" means one thing wherever it is read. The caller's own
            label comes back the moment the request lands. */}
        {busy ? 'Working…' : label}
      </button>
      {asking ? (
        <Confirm
          title={confirmTitle ?? label}
          body={confirm}
          confirmLabel={confirmLabel ?? label}
          tone={variant === 'danger' ? 'danger' : 'plain'}
          busy={busy}
          onConfirm={() => void run()}
          onClose={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Every select in the workspace goes through here. The chevron has to be an
 * inline SVG, because the content policy allows no images at all — see the
 * .select-wrap note in app.css.
 */
export function Select({ children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className="select-wrap">
      <select {...props}>{children}</select>
      <Icon name="chevron" size={15} />
    </span>
  );
}

/**
 * `compact` is the filter-row variant: the format hint becomes the input's own
 * placeholder rather than a line beneath it, so every field in the row is the
 * same height and the labels sit on one line.
 */
/**
 * One labelled control, the unit `Editor` and `Finder` are both built from.
 *
 * It is exported for the one shape neither of those covers: a form that is not
 * a flat list of fields, such as a scholastic block where header fields sit
 * above a grid of learning areas saved in the same request. A screen using it
 * directly owns what `Editor` would otherwise do for it — the error summary,
 * mapping `ApiError.fields[]` onto these controls, and clearing a mark when the
 * field is edited. Prefer `Editor` wherever the form really is a list.
 */
export function Control({ field, id, value, error, onChange, compact }: {
  field: Field;
  id: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  // A hint explains rather than records, so it follows the workspace's one
  // notes switch like every other description (0.111.3). Folded away, a form is
  // its labels and its boxes; the explanation is one click above it. The id is
  // computed from whether it is actually drawn, because `aria-describedby`
  // pointing at an element that is not there names nothing to a screen reader.
  const [notes] = useDescriptions();
  const showHint = Boolean(field.hint) && !compact && notes;
  const hintId = showHint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const shared = {
    id,
    name: field.key,
    required: !field.optional,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };
  if (field.type === 'radios') {
    return (
      <fieldset className={`field choose${field.wide ? ' wide' : ''}${error ? ' bad' : ''}`} id={id} tabIndex={-1} aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
        <legend className="label">{field.label}</legend>
        <div className="radios">
          {(field.options ?? []).map(([key, text]) => {
            // "Tardy: half-shaded on the SF2…" reads as a name and its meaning, so it is drawn as one.
            const cut = text.indexOf(': ');
            return (
              <label key={key} className={`radio-line${value === key ? ' on' : ''}`}>
                <input type="radio" name={`${id}-choice`} value={key} checked={value === key} onChange={() => onChange(key)} />
                <span>{cut > 0 ? <><b>{text.slice(0, cut)}</b>{text.slice(cut + 1)}</> : text}</span>
              </label>
            );
          })}
        </div>
        {error ? <span className="field-error" id={errorId}><Icon name="alert" size={14} />{error}</span> : null}
        {showHint ? <span className="hint" id={hintId}>{field.hint}</span> : null}
      </fieldset>
    );
  }
  if (field.type === 'checkboxes') {
    const chosen = value ? value.split(',') : [];
    return (
      <fieldset className={`field choose${field.wide ? ' wide' : ''}${error ? ' bad' : ''}`} id={id} tabIndex={-1} aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
        <legend className="label">{field.label}</legend>
        <span className="checks">
          {(field.options ?? []).map(([key, text]) => (
            <label key={key} className="check-line">
              <input
                type="checkbox"
                name={field.key}
                value={key}
                checked={chosen.includes(key)}
                onChange={e => {
                  const next = e.target.checked ? [...chosen, key] : chosen.filter(k => k !== key);
                  // Kept in option order, so the same set always reads the same way.
                  onChange((field.options ?? []).map(([k]) => k).filter(k => next.includes(k)).join(','));
                }}
              />
              <span>{text}</span>
            </label>
          ))}
        </span>
        {error ? <span className="field-error" id={errorId}><Icon name="alert" size={14} />{error}</span> : null}
        {showHint ? <span className="hint" id={hintId}>{field.hint}</span> : null}
      </fieldset>
    );
  }
  return (
    <div className={`field${field.wide ? ' wide' : ''}${error ? ' bad' : ''}`}>
      <label className="label" htmlFor={id}>
        {field.label}
        {field.optional && !compact ? <span className="optional">Optional</span> : null}
      </label>
      {field.options
        ? <Select {...shared} value={value} onChange={e => onChange(e.target.value)}>
            {field.choose && !value ? <option value="" disabled>Choose…</option> : null}
            {field.options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </Select>
        : field.type === 'textarea'
          ? <textarea
              {...shared}
              value={value}
              minLength={field.minLength}
              maxLength={field.maxLength}
              placeholder={compact ? field.hint : undefined}
              onChange={e => onChange(e.target.value)}
            />
          : <input
              {...shared}
              type={field.type ?? 'text'}
              value={value}
              min={field.min}
              max={field.max}
              minLength={field.minLength}
              maxLength={field.maxLength}
              pattern={field.pattern}
              placeholder={compact ? field.hint : undefined}
              onChange={e => onChange(e.target.value)}
            />}
      {error ? <span className="field-error" id={errorId}><Icon name="alert" size={14} />{error}</span> : null}
      {showHint ? <span className="hint" id={hintId}>{field.hint}</span> : null}
    </div>
  );
}

/** Zod reports `items.0.score`; the control is keyed on the field name alone. */
const fieldKey = (path: string) => path.split('.').filter(part => part && !/^\d+$/.test(part)).pop() ?? path;

/** A versioned save form. Values stay strings until submit, where numbers coerce. */
export function Editor({ fields, initial, submitLabel = 'Save changes', onSubmit, setStatus, onSaved, note, warning }: {
  fields: Field[];
  /** What else a save changes, said before the save rather than discovered after it. */
  warning?: ReactNode;
  initial?: Record<string, unknown> | undefined;
  submitLabel?: string | undefined;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
  setStatus: (status: Status) => void;
  onSaved?: (() => void) | undefined;
  note?: ReactNode;
}) {
  const scope = useId();
  const controlId = (key: string) => `${scope}-${key}`;
  const start = useCallback(() => Object.fromEntries(fields.map(f => {
    const raw = initial?.[f.key];
    const picksFirst = f.options && f.type !== 'checkboxes' && f.type !== 'radios' && !f.choose;
    return [f.key, raw === null || raw === undefined ? (picksFirst ? (f.options?.[0]?.[0] ?? '') : '') : String(raw)];
  })), [fields, initial]);
  const [values, setValues] = useState<Record<string, string>>(start);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<{ key: string; label: string; message: string }[]>([]);
  const [lede, setLede] = useState('');
  const [rejected, setRejected] = useState(0);
  // Whether the rejection needs a summary at all (asked 2026-11-09: the box repeated what each field already said).
  const [jump, setJump] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  // Reset only when what the form describes changes. Screens build `fields`
  // and `initial` inline, so their identity changes on every render of the
  // parent, and resetting on identity wiped whatever was being typed the
  // moment an unrelated fetch landed.
  const signature = JSON.stringify([fields.map(f => [f.key, f.type ?? '', f.options?.map(o => o[0]) ?? null]), initial ?? null]);
  useEffect(() => { setValues(start()); setBad([]); }, [signature]);

  // Where a rejection puts the reader. Every message is already drawn beside its
  // field, so when all the rejected fields are in sight a box above them only says
  // it twice (asked 2026-11-09): focus goes to the first one, and a screen reader
  // reads its message, which `aria-describedby` ties to it. A summary is drawn
  // only when it adds something: a rejected field out of sight in a form taller
  // than its window, or a message from the server that belongs to no one field.
  // Then it names the fields as links to each, and does not repeat their messages.
  useEffect(() => {
    if (!rejected) return;
    const controls = bad.map(f => document.getElementById(controlId(f.key))).filter((el): el is HTMLElement => Boolean(el));
    const outOfSight = controls.some(el => {
      const box = el.getBoundingClientRect();
      const frame = el.closest('.sheet-body')?.getBoundingClientRect() ?? { top: 0, bottom: globalThis.innerHeight };
      return box.top < frame.top || box.bottom > frame.bottom;
    });
    const needed = outOfSight || Boolean(lede);
    setJump(needed);
    if (needed) requestAnimationFrame(() => summary.current?.focus());
    else controls[0]?.focus();
  }, [rejected]);

  const problem = (key: string) => bad.find(f => f.key === key)?.message;

  return (
    // `noValidate` hands validation to the server, which is the authority here
    // anyway. A native browser bubble shows one field at a time, cannot be
    // styled, disappears on the next click and says "Please match the requested
    // format" where the API says "must be exactly twelve digits". The
    // attributes stay on the controls, so a screen reader still announces
    // required and the format hint still reads.
    <form noValidate onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setBad([]);
      setJump(false);
      setStatus({ text: 'Saving…', kind: 'busy' });
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const text = values[field.key] ?? '';
        // A blank number is no number: Number('') is 0, which for a grade is Kindergarten.
        payload[field.key] = field.type === 'number' ? (text.trim() === '' ? null : Number(text))
          : field.type === 'checkboxes' ? (text ? text.split(',') : [])
          : (text.trim() || null);
      }
      try {
        await onSubmit(payload);
        setStatus({ text: 'Saved.', kind: 'done' });
        onSaved?.();
      } catch (error) {
        // A rejection that names fields belongs beside those fields. Anything
        // else — a version conflict, a refusal, a network failure — is about
        // the record rather than the typing, and stays on the page's own line.
        const named = error instanceof ApiError
          ? error.fields
              .map(f => ({ key: fieldKey(f.path), message: f.message }))
              .flatMap(f => { const field = fields.find(x => x.key === f.key); return field ? [{ ...f, message: plainFieldMessage(f.message, field.hint), label: field.label }] : []; })
          : [];
        if (named.length) {
          setBad(named);
          setLede(error instanceof ApiError && error.message !== GENERIC_REFUSAL ? error.message : '');
          setRejected(n => n + 1);
          setStatus(idle);
        } else {
          setStatus({ text: message(error), kind: 'error' });
        }
      } finally { setBusy(false); }
    }}>
      {warning}
      {bad.length && jump ? (
        <div className="error-summary" role="alert" tabIndex={-1} ref={summary}>
          <h3><Icon name="alert" size={16} />{bad.length === 1 ? 'One field needs attention' : `${bad.length} fields need attention`}</h3>
          {lede ? <p>{lede}</p> : null}
          <ul className="error-jumps">
            {bad.map(f => (
              <li key={f.key}>
                {/* A button, not an anchor: the address bar is the router here,
                    so a `#field` href would navigate away from the screen. Its
                    message is beside the field, so the link names the field alone. */}
                <button type="button" onClick={() => document.getElementById(controlId(f.key))?.focus()}>
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="form-grid">
        {fields.map(field => (
          <Control
            key={field.key}
            field={field}
            id={controlId(field.key)}
            value={values[field.key] ?? ''}
            error={problem(field.key)}
            onChange={next => {
              setValues(v => ({ ...v, [field.key]: next }));
              // Editing a rejected field clears its mark: the message described
              // what was there a moment ago, not what is there now.
              setBad(list => list.filter(f => f.key !== field.key));
            }}
          />
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Saving…</> : submitLabel}</button>
        {note}
      </div>
    </form>
  );
}

/**
 * A sheet holding exactly one form — the shape every "add a record" action in
 * the workspace takes.
 *
 * It keeps its own status line. A refusal has to be read where it happened,
 * and the page's line is behind the panel: the version conflict that stopped
 * the save would otherwise be announced to an empty room.
 */
export function FormSheet({ title, note, wide, submitLabel, fields, initial, onSubmit, onSaved, onClose, warning }: {
  title: string;
  warning?: ReactNode;
  note?: string | undefined;
  wide?: boolean | undefined;
  submitLabel: string;
  fields: Field[];
  initial?: Record<string, unknown> | undefined;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
  /** Called only after the server accepted the change. Close the sheet here. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>(idle);
  return (
    <Sheet title={title} note={note} wide={wide} onClose={onClose}>
      <StatusLine status={status} />
      <Editor
        fields={fields}
        initial={initial}
        submitLabel={submitLabel}
        setStatus={setStatus}
        onSubmit={onSubmit}
        onSaved={onSaved}
        warning={warning}
      />
    </Sheet>
  );
}

/** The same controls as an editor, but laid out as one filter row above a list. */
export function Finder({ fields, initial, onApply, onClear, onFieldChange }: {
  fields: Field[];
  initial: Record<string, string>;
  onApply: (values: Record<string, string>) => void;
  onClear?: (() => void) | undefined;
  /** Told of each change; may answer with adjusted values, for a field that depends on another (a class on its grade). */
  onFieldChange?: (key: string, value: string, values: Record<string, string>) => Record<string, string> | void;
}) {
  const scope = useId();
  const [values, setValues] = useState(initial);
  const filled = Object.values(values).some(Boolean);
  return (
    <form className="toolbar" onSubmit={event => { event.preventDefault(); onApply(values); }}>
      <div className="form-grid">
        {fields.map(field => (
          <Control key={field.key} compact field={field} id={`${scope}-${field.key}`} value={values[field.key] ?? ''} onChange={next => {
            const updated = { ...values, [field.key]: next };
            setValues(onFieldChange?.(field.key, next, updated) ?? updated);
          }} />
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn"><Icon name="search" size={15} />Search</button>
        {filled && onClear
          ? <button type="button" className="btn ghost" onClick={() => { const cleared = Object.fromEntries(fields.map(f => [f.key, ''])); setValues(cleared); onClear(); }}>Clear</button>
          : null}
      </div>
    </form>
  );
}

export type Column<T> = { header: string; cell: (row: T) => ReactNode; numeric?: boolean; className?: string };

/**
 * A placeholder shaped like the table it stands in. Three grey bars said
 * nothing about what was coming and the page jumped when the rows landed.
 */
export function TableSkeleton({ columns = 4, rows = 4 }: { columns?: number; rows?: number }) {
  return (
    <Loading className="skeleton-table">
      {Array.from({ length: rows + 1 }, (_, row) => (
        <div className="skeleton-row" key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <span className={`skeleton${column === 0 ? ' s2' : ''}`} key={column} />
          ))}
        </div>
      ))}
    </Loading>
  );
}

const cellClass = <T,>(column: Column<T>) => [column.numeric ? 'numeric' : '', column.className ?? ''].filter(Boolean).join(' ');

/**
 * One open row at a time, and its panel spans the full width of the table
 * rather than being squeezed into the last column. The editors these panels
 * hold are multi-field forms; a 260px cell was never enough room for one.
 *
 * Columns are not sortable. Sorting would reorder the twenty-five rows on
 * screen and leave the other eight hundred where they are, which looks like an
 * answer and is not one. Narrowing a list is the filter row's job.
 */
/**
 * A box that scrolls sideways when what it holds is wider than the screen.
 * Only then does it join the tab order, named, so a keyboard can reach the
 * hidden columns; a table that fits adds no stop.
 */
export function ScrollArea({ className = 'table-wrap', label = 'Table, scrolls sideways', busy, children }: { className?: string; label?: string; busy?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setWide(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    if (element.firstElementChild) watch.observe(element.firstElementChild);
    return () => watch.disconnect();
  }, []);
  return <div ref={box} className={className} aria-busy={busy || undefined} inert={busy || undefined} {...(wide ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}>{children}</div>;
}

export function Table<T>({ rows, columns, empty, detail, detailLabel = 'Edit', actionsLabel = 'Actions', rowKey, loading, stack }: {
  rows: T[];
  columns: Column<T>[];
  empty?: ReactNode;
  detail?: ((row: T) => ReactNode) | undefined;
  detailLabel?: string | undefined;
  actionsLabel?: string | undefined;
  rowKey: (row: T) => string;
  loading?: boolean | undefined;
  /** On a phone, draw each row as a labelled block instead of a line that
   *  scrolls sideways: for registers filled in on a phone, where a hidden
   *  afternoon column is a mark nobody enters. */
  stack?: boolean | undefined;
}) {
  const scope = useId();
  const [open, setOpen] = useState<string | null>(null);
  // A list read again — after a save, a filter or a colleague's change — stays on
  // screen, dimmed and out of reach, until the fresh rows arrive (the UI notes of
  // 8 November). Dropping it to a skeleton closed the open row and threw the page
  // back to the top on every save.
  const shown = useRef<T[]>([]);
  if (!loading) shown.current = rows;
  const refreshing = Boolean(loading) && shown.current.length > 0;
  if (loading && !refreshing) return <TableSkeleton columns={columns.length + (detail ? 1 : 0)} />;
  const list = refreshing ? shown.current : rows;
  if (!list.length) return <>{empty ?? <EmptyState title="Nothing here yet" body="Records you add will appear in this list." />}</>;
  const span = columns.length + (detail ? 1 : 0);
  return (
    <ScrollArea className={`table-wrap${stack ? ' stack' : ''}${refreshing ? ' refreshing' : ''}`} busy={refreshing}>
      <table>
        <thead>
          <tr>
            {columns.map(column => <th key={column.header} scope="col" className={cellClass(column)}>{column.header}</th>)}
            {detail ? <th scope="col" className="actions">{actionsLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {list.map(row => {
            const key = rowKey(row);
            const expanded = open === key;
            const panel = `${scope}-${key}`;
            return (
              <Fragment key={key}>
                <tr>
                  {columns.map(column => <td key={column.header} className={cellClass(column)} data-label={column.header}>{column.cell(row)}</td>)}
                  {detail ? (
                    <td className="actions">
                      <button
                        type="button"
                        className="row-toggle"
                        aria-expanded={expanded}
                        aria-controls={panel}
                        onClick={() => setOpen(expanded ? null : key)}
                      >{detailLabel}<Icon name="chevron" size={14} /></button>
                    </td>
                  ) : null}
                </tr>
                {detail && expanded ? (
                  <tr className="row-panel">
                    <td colSpan={span} id={panel}><div className="panel-inner">{detail(row)}</div></td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

/**
 * One of several things a reader could do to a record, folded away until it is
 * chosen. An invitation panel used to stack three whole forms — create the
 * account, link one made by hand, cancel the request — so the two nobody
 * wanted were always in the way of the one they did.
 */
export function Task({ title, note, tone, children }: { title: string; note?: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <details className={`task${tone === 'warn' ? ' warn' : ''}`}>
      <summary>
        <Icon name="caret" size={13} />
        {title}
        {note ? <span className="task-note">{note}</span> : null}
      </summary>
      <div className="task-body">{children}</div>
    </details>
  );
}

/** A record and the identifier it is filed under, stacked the way a register reads. */
export function Cell({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <span className="cell">
      <span className="cell-title">{title}</span>
      {meta ? <span className="cell-meta">{meta}</span> : null}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div className="form-actions centred">{action}</div> : null}
    </div>
  );
}

const calloutIcon = { info: 'info', attention: 'alert', stopped: 'stop' } as const;

/**
 * A note beside the records it is about.
 *
 * A titled one folds from its own heading, open to begin with. Asked for on
 * 2026-11-10: several screens stack two or three of these above the work, and
 * on a narrow window the warnings are the page. Folding is per note and is not
 * remembered — a reader quietening one card must not quieten the refusal on a
 * screen they have not opened yet, which is what one shared preference would
 * do. An untitled callout has no heading to fold from and is always shown.
 */
export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'attention' | 'stopped' | 'plain'; title?: string; children: ReactNode }) {
  return (
    <div className={`callout ${tone === 'plain' ? '' : tone}`}>
      {tone === 'plain' ? null : <Icon name={calloutIcon[tone]} size={16} />}
      {title ? (
        <details className="fold" open>
          <summary><h3>{title}</h3><Icon name="caret" size={12} /></summary>
          <div className="fold-body">{children}</div>
        </details>
      ) : <div>{children}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'attention' | 'stopped' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Pager({ offset, count, hasMore, onChange, size = 25 }: {
  offset: number; count: number; hasMore: boolean; onChange: (next: number) => void; size?: number;
}) {
  if (!offset && !hasMore) return null;
  return (
    <div className="pager">
      <span>Showing <b className="num">{count ? offset + 1 : 0}–{offset + count}</b></span>
      <div className="pager-nav">
        <button type="button" className="btn secondary small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>
          <Icon name="back" size={14} />Previous
        </button>
        <button type="button" className="btn secondary small" disabled={!hasMore} onClick={() => onChange(offset + size)}>
          Next<Icon name="forward" size={14} />
        </button>
      </div>
    </div>
  );
}

/** The browser's own date, not UTC: at 7am in Benguet, `toISOString` is still yesterday. */
export const localToday = () => {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

export const value = (row: Record<string, unknown>, key: string) => (row[key] == null ? '' : String(row[key]));
/** A value, or the mark that says no record exists — never an em dash. */
export const shown = (row: Record<string, unknown>, key: string, label?: string) =>
  row[key] == null || row[key] === '' ? <Unrecorded label={label ?? 'Not recorded'} /> : String(row[key]);
export const sentence = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1).replaceAll('_', ' ') : '');
export const gradeName = (grade: unknown) => (Number(grade) === 0 ? 'Kindergarten' : `Grade ${Number(grade)}`);
export const yearName = (row: Record<string, unknown>) => `${row.start_year}–${Number(row.start_year) + 1}`;
export const learnerName = (row: Record<string, unknown>) =>
  [value(row, 'last_name'), [value(row, 'first_name'), value(row, 'middle_name'), value(row, 'name_extension')].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

/**
 * A class list in the order its paper register reads: surname, then given
 * names. The API pages rosters by record id, which is stable but meaningless
 * to a reader, so every screen that lists learners sorts what it has loaded.
 */
export const byLearnerName = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  learnerName(a).localeCompare(learnerName(b)) || String(a.enrollment_id ?? a.id ?? '').localeCompare(String(b.enrollment_id ?? b.id ?? ''));

/**
 * The line under the title, and the DepEd form these records end up on. The
 * title itself sits in the top bar, so this carries only what the top bar
 * cannot: the one clause explaining the screen, and the screen's own actions.
 *
 * Creating a record is one of those actions. It used to be a second full-width
 * form parked permanently below the list it added to; it is now a button here
 * that opens a sheet, so a screen is the register it is named after.
 *
 * `Route` is imported as a type only, so this file never pulls the route table
 * — and the screens it declares — back in at runtime.
 */
/**
 * A screen's own description, folded away until it is asked for.
 *
 * Every screen carried its sentence open. That reads as instruction the first
 * time and as furniture every time after, and the screens staff live in are
 * exactly the ones they have already read it on. So it starts minimised (asked
 * for 2026-11-09) behind a control that says what it will show.
 *
 * **One preference for the whole workspace, not one per screen.** Somebody who
 * wants the descriptions wants them everywhere; twenty-nine separate toggles
 * would be twenty-nine things to set and nothing would remember the intent.
 *
 * It is kept in `sessionStorage`, which is where the collapsed rail and the
 * folded navigation groups already live, and for the same reason: a staffroom
 * machine must not hand one person's layout to the next. Every access is
 * guarded, because a private window throws on it rather than returning null.
 */
const LEDE = 'edunexus-ui-lede';
const ledeShown = () => {
  try { return sessionStorage.getItem(LEDE) === 'open'; } catch { return false; }
};
const DESCRIPTIONS = 'edunexus-descriptions';

/**
 * Whether descriptions are shown: one setting for the whole workspace, off by default (0.110.0 folded every page's
 * description; since 0.111.3 the long notes inside sheets follow the same switch, asked 2026-11-09). Opening them
 * anywhere opens them everywhere for the rest of the tab, and every mounted control follows at once.
 */
export function useDescriptions(): [boolean, () => void] {
  const [open, setOpen] = useState(ledeShown);
  useEffect(() => {
    const follow = () => setOpen(ledeShown());
    addEventListener(DESCRIPTIONS, follow);
    return () => removeEventListener(DESCRIPTIONS, follow);
  }, []);
  const toggle = () => {
    const next = !ledeShown();
    try { sessionStorage.setItem(LEDE, next ? 'open' : 'shut'); } catch { /* not worth failing a render over */ }
    setOpen(next);
    dispatchEvent(new Event(DESCRIPTIONS));
  };
  return [open, toggle];
}

/** The switch for a sheet's long notes, drawn like the page's own "What is this page for?". */
export function DescriptionToggle({ show = 'Show the notes', hide = 'Hide the notes', controls }: { show?: string; hide?: string; controls?: string }) {
  const [open, toggle] = useDescriptions();
  return (
    <button type="button" className="lede-toggle" aria-expanded={open} aria-controls={controls} onClick={toggle}>
      <Icon name={open ? 'collapse' : 'expand'} size={14} />
      {open ? hide : show}
    </button>
  );
}

export function PageHeader({ route, actions }: { route: Route; actions?: ReactNode }) {
  const [open, toggle] = useDescriptions();
  const id = useId();
  return (
    <div className="view-head">
      <div className="view-titles">
        <div className="view-lede">
          <button type="button" className="lede-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>
            <Icon name={open ? 'collapse' : 'expand'} size={14} />
            {open ? 'Hide what this page is for' : 'What is this page for?'}
          </button>
          {route.feeds ? <span className="form-chip">Feeds<b>{route.feeds}</b></span> : null}
        </div>
        {open ? <p className="view-sub" id={id}>{route.lede}</p> : null}
      </div>
      {actions ? <div className="view-actions">{actions}</div> : null}
    </div>
  );
}
