import { shift, span, weekday } from './dates';

/**
 * Turns a manager's description of a stretch of the school calendar into the
 * dated changes the calendar API takes.
 *
 * Nothing here is a default the school did not state. The weekday and weekend
 * rules are shown in the form and confirmed there, and every holiday and break
 * is typed from the school's approved calendar. EDUNEXUS supplies none, and a
 * date the manager leaves out stays unconfigured, as it always has.
 */
export type Mode = 'classroom' | 'alternative_delivery' | 'no_class' | 'suspended';
export type SetChange = { day_on: string; action: 'set'; am: Mode; pm: Mode; day_type: string; label: string };
export type Listed = { from: string; to: string; label: string };
export type FillRules = {
  from: string; to: string;
  weekday: { am: Mode; pm: Mode; label: string };
  weekendLabel: string;
  holidays: Listed[];
  breaks: Listed[];
  /** Leave dates somebody already configured exactly as they are. */
  keepConfigured: boolean;
  /** Dates left unset because how they are held is the school's to say. */
  leaveOut?: Listed[];
};

const iso = /^\d{4}-\d{2}-\d{2}$/;
const real = (date: string) => iso.test(date) && shift(date, 0) === date;

/**
 * Reads one date or one range per line, followed by its label:
 * `2026-08-21 Ninoy Aquino Day`, or `2026-12-19 to 2027-01-03 Christmas break`.
 * A line it cannot read is reported by number rather than skipped, since a
 * holiday quietly dropped becomes a class day.
 */
export function parseListed(text: string) {
  const items: Listed[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2}))?\s+(.+)$/.exec(line);
    if (!match) { problems.push(`Line ${index + 1}: start with a date as YYYY-MM-DD, then a label.`); return; }
    const [, from, to = from, label] = match as unknown as [string, string, string | undefined, string];
    if (!real(from) || !real(to)) { problems.push(`Line ${index + 1}: ${!real(from) ? from : to} is not a calendar date.`); return; }
    if (to < from) { problems.push(`Line ${index + 1}: the range ends before it starts.`); return; }
    if (label.trim().length > 120) { problems.push(`Line ${index + 1}: the label is longer than 120 characters.`); return; }
    items.push({ from, to, label: label.trim() });
  });
  return { items, problems };
}

const within = (day: string, list: Listed[]) => list.find(item => day >= item.from && day <= item.to);

/**
 * The changes for every date from `from` to `to`. A listed holiday wins over a
 * break, a break over a weekend, a weekend over a weekday: a holiday falling on
 * a Saturday is still recorded as the holiday it is.
 */
export function fillChanges(rules: FillRules, configured: Set<string>) {
  const changes: SetChange[] = [];
  const counts = { classDays: 0, weekends: 0, holidays: 0, breaks: 0, kept: 0, leftOut: 0 };
  const total = rules.to >= rules.from ? span(rules.from, rules.to) : 0;
  for (let i = 0; i < total; i++) {
    const day = shift(rules.from, i);
    if (rules.keepConfigured && configured.has(day)) { counts.kept++; continue; }
    if (within(day, rules.leaveOut ?? [])) { counts.leftOut++; continue; }
    const holiday = within(day, rules.holidays);
    const pause = within(day, rules.breaks);
    const name = weekday(day);
    if (holiday) { counts.holidays++; changes.push({ day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'holiday', label: holiday.label }); }
    else if (pause) { counts.breaks++; changes.push({ day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'school_break', label: pause.label }); }
    else if (name === 'Saturday' || name === 'Sunday') { counts.weekends++; changes.push({ day_on: day, action: 'set', am: 'no_class', pm: 'no_class', day_type: 'weekend', label: rules.weekendLabel }); }
    else { counts.classDays++; changes.push({ day_on: day, action: 'set', am: rules.weekday.am, pm: rules.weekday.pm, day_type: 'regular', label: rules.weekday.label }); }
  }
  return { changes, counts };
}

/** The API reads and changes at most 62 dates at a time; 60 keeps every batch inside one request. */
export const chunks = <T,>(items: T[], size = 60) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
