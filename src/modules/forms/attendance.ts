// The SF2 and SF4 computed from raw marks, by the school's recorded rule and
// the formulas printed on the SF2 itself. Pure functions: the database supplies
// what was recorded, and this file is the only place a mark becomes a day.
//
// Three things are never guessed. A session nobody marked makes the day
// unmarked, never present. A date the calendar has not configured, or one with
// an alternative-delivery session, makes the month's figures wait, because the
// school's rule says nothing about them. And with no rule recorded, nothing
// that depends on one is computed at all.
//
// A day of classes still to come is neither: it has not happened. While a month
// still has one, the SF2's figures are counted to today when every day so far is
// marked, and the form carries `to_date` so it can say they are not the month's.

export type DayRule = { mixed_day: 'tardy' | 'absent' | 'half_day'; single_session_day: 'counts' | 'not_counted'; version: number };
export type Session = 'present' | 'absent' | null;
export type Schedule = { day_on: string; am: string | null; pm: string | null; configured: boolean };
export type DayKind = 'class' | 'no_class' | 'unconfigured' | 'alternative_delivery';
/** The SF2's marks: blank present, x absent, the two half-shadings for tardy, and two EDUNEXUS adds. */
export type DayMark = 'present' | 'absent' | 'late' | 'cutting' | 'half' | 'unmarked';
export type DayValue = { mark: DayMark; present: number; absent: number; tardy: number };
/** A learner's cell on a day of classes: the SF2 mark, or 'waiting' with no rule, beside the two marks it came from. */
export type Sf2Cell = { mark: DayMark | 'waiting' | 'pending'; present: number; absent: number; tardy: number; am: Session; pm: Session };
export type BySex<T = number> = { male: T; female: T; total: T };

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const trio = (male: number, female: number): BySex => ({ male, female, total: male + female });

/** Whether a date is a day of classes for the SF2, under the school's rule. */
export function dayKind(day: Schedule, rule: DayRule | null): DayKind {
  if (!day.configured) return 'unconfigured';
  if (day.am === 'alternative_delivery' || day.pm === 'alternative_delivery') return 'alternative_delivery';
  const sessions = (day.am === 'classroom' ? 1 : 0) + (day.pm === 'classroom' ? 1 : 0);
  if (sessions === 2) return 'class';
  if (sessions === 1) return rule?.single_session_day === 'counts' ? 'class' : 'no_class';
  return 'no_class';
}

/**
 * One learner's day on a day of classes. Only classroom sessions count; any of
 * them unmarked leaves the day unmarked. A day with one session present and
 * one absent follows the school's rule: tardy (upper half shaded when the
 * morning was missed, lower when the afternoon was, counted present), absent,
 * or half a day each way.
 */
export function dayValue(day: Schedule, am: Session, pm: Session, rule: DayRule): DayValue {
  const marks = [day.am === 'classroom' ? am : undefined, day.pm === 'classroom' ? pm : undefined].filter(m => m !== undefined) as Session[];
  if (!marks.length || marks.some(m => m === null)) return { mark: 'unmarked', present: 0, absent: 0, tardy: 0 };
  if (marks.every(m => m === 'present')) return { mark: 'present', present: 1, absent: 0, tardy: 0 };
  if (marks.every(m => m === 'absent')) return { mark: 'absent', present: 0, absent: 1, tardy: 0 };
  if (rule.mixed_day === 'absent') return { mark: 'absent', present: 0, absent: 1, tardy: 0 };
  if (rule.mixed_day === 'half_day') return { mark: 'half', present: 0.5, absent: 0.5, tardy: 0 };
  return { mark: am === 'absent' ? 'late' : 'cutting', present: 1, absent: 0, tardy: 1 };
}

export type Sf2Source = {
  school: Record<string, string | null>;
  section: { id: string; grade_level: number; name: string; adviser_user_id: string | null; adviser_name: string | null };
  school_year: { id: string; start_year: number; starts_on: string; ends_on: string; status: string };
  month_on: string; from: string; to: string; cutoff: string; month_status: 'draft' | 'submitted' | 'locked';
  /**
   * The month's movements in this section, read from the timeline rather than from
   * the roster below, and shaped as the SF4's are (since 0050). A learner whose
   * departure took effect on the first day of the month has no day on this month's
   * register, and counting from the roster lost them — while the SF4 kept them.
   */
  movements?: Partial<Record<'transfer_in' | 'transfer_out' | 'dropout' | 'death' | 'withdrawal', Movement>>;
  /** The school's date today, so a day of classes still to come is pending rather than unmarked. */
  today: string;
  days: Schedule[];
  at_cutoff: { male: number; female: number };
  learners: {
    enrollment_id: string; first_name: string; middle_name: string | null; last_name: string; name_extension: string | null;
    sex: 'male' | 'female'; lrn: string | null;
    first_entry: { reason: string; effective_on: string; section_id: string } | null;
    events: { event_type: string; reason: string; effective_on: string; section_id: string }[];
    /** The adviser's own remark for the month, such as the school a transfer went to (since 0030). */
    remark?: string | null;
    cells: { day_on: string; am: Session; pm: Session }[];
  }[];
};

const weekdayLabel = ['SUN', 'M', 'T', 'W', 'TH', 'F', 'SAT'];
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** "Last, First Ext Middle", the SF2's own name order. */
export const formName = (l: { last_name: string; first_name: string; middle_name: string | null; name_extension: string | null }) =>
  `${l.last_name}, ${l.first_name}${l.name_extension ? ` ${l.name_extension}` : ''}${l.middle_name ? ` ${l.middle_name}` : ''}`;

const remarkFor = (event: { event_type: string; reason: string; effective_on: string }) => {
  const on = event.effective_on;
  switch (event.reason) {
    case 'transfer_in': return `Transferred in ${on}`;
    case 'transfer_out': return `Transferred out ${on}`;
    case 'dropout': return `Dropped out ${on}`;
    case 'death': return `Deceased ${on}`;
    case 'withdrawal': return `Withdrawn ${on}`;
    case 'return_to_school': return `Returned to school ${on}`;
    case 'section_change': return `Moved into this section ${on}`;
    case 'regular': return `Enrolled ${on}`;
    default: return `${event.event_type} ${on}`;
  }
};

export type Sf2 = ReturnType<typeof computeSf2>;

export function computeSf2(source: Sf2Source, rule: DayRule | null) {
  const kinds = new Map(source.days.map(d => [d.day_on, dayKind(d, rule)]));
  const schedule = new Map(source.days.map(d => [d.day_on, d]));
  // The form's columns are the weekdays of the month, plus any weekend date the school held classes on.
  const columns = source.days
    .filter(d => (weekday(d.day_on) >= 1 && weekday(d.day_on) <= 5) || kinds.get(d.day_on) === 'class')
    .map(d => ({ day_on: d.day_on, date: Number(d.day_on.slice(8, 10)), weekday: weekdayLabel[weekday(d.day_on)]!, kind: kinds.get(d.day_on)! }));
  const classDays = source.days.filter(d => kinds.get(d.day_on) === 'class').map(d => d.day_on);
  const unconfiguredDays = source.days.filter(d => kinds.get(d.day_on) === 'unconfigured').length;
  // Today is still to come until its register is started: an SF2 opened at eight in the morning is not missing today's marks.
  const todayStarted = source.learners.some(l => l.cells.some(c => c.day_on === source.today && (c.am !== null || c.pm !== null)));
  const ahead = (day: string) => day > source.today || (day === source.today && !todayStarted);
  const pendingDays = classDays.filter(ahead).length;
  const stillToCome = (day: string, am: Session, pm: Session) => ahead(day) && am === null && pm === null;
  const alternativeDays = source.days.filter(d => kinds.get(d.day_on) === 'alternative_delivery').length;
  const passedUnset = source.days.filter(d => !ahead(d.day_on) && ['unconfigured', 'alternative_delivery'].includes(kinds.get(d.day_on)!)).length;

  let unmarkedSessions = 0;
  const ordered = [...source.learners].sort((a, b) => (a.sex === b.sex ? 0 : a.sex === 'male' ? -1 : 1)
    || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name) || (a.middle_name ?? '').localeCompare(b.middle_name ?? '') || a.enrollment_id.localeCompare(b.enrollment_id));
  const counters = { male: 0, female: 0 };
  const learners = ordered.map(l => {
    const cells = new Map(l.cells.map(c => [c.day_on, c]));
    const values: Record<string, Sf2Cell | 'out' | 'no_class'> = {};
    let unmarked = 0;
    for (const column of columns) {
      const cell = cells.get(column.day_on);
      if (column.kind !== 'class') { values[column.day_on] = 'no_class'; continue; }
      if (!cell) { values[column.day_on] = 'out'; continue; }
      if (stillToCome(column.day_on, cell.am, cell.pm)) { values[column.day_on] = { mark: 'pending', present: 0, absent: 0, tardy: 0, am: null, pm: null }; continue; }
      const value = rule ? dayValue(schedule.get(column.day_on)!, cell.am, cell.pm, rule) : { mark: 'waiting' as const, present: 0, absent: 0, tardy: 0 };
      values[column.day_on] = { ...value, am: cell.am, pm: cell.pm };
      if (value.mark === 'unmarked') unmarked += 1;
    }
    // Sessions, not days, so the count matches what the register shows as missing.
    for (const day of classDays) {
      const cell = cells.get(day); const s = schedule.get(day)!;
      if (!cell || stillToCome(day, cell.am, cell.pm)) continue;
      if (s.am === 'classroom' && cell.am === null) unmarkedSessions += 1;
      if (s.pm === 'classroom' && cell.pm === null) unmarkedSessions += 1;
    }
    const memberDays = classDays.filter(d => cells.has(d));
    const counted = memberDays.map(d => values[d]).filter((v): v is Sf2Cell => typeof v === 'object');
    // Every day so far marked: the month's totals, or while days are still to come, its totals to today.
    const complete = !!rule && unmarked === 0;
    // Five consecutive days of classes absent, counting only days the learner belonged to the section.
    let run = 0, longest = 0;
    for (const day of memberDays) { const v = values[day]; run = typeof v === 'object' && v.absent === 1 ? run + 1 : 0; longest = Math.max(longest, run); }
    const memberThrough = memberDays.length ? memberDays[memberDays.length - 1]! : null;
    const leftEvent = l.events.some(e => e.event_type === 'withdrawn');
    const remarks = l.events.filter(e => !(e.event_type === 'enrolled' && e.reason === 'regular' && e.effective_on <= source.cutoff)).map(remarkFor);
    if (!leftEvent && memberThrough && !cells.has(source.to) && l.cells.length) remarks.push(`Moved to another section after ${l.cells[l.cells.length - 1]!.day_on}`);
    if (l.remark) remarks.push(l.remark);
    counters[l.sex] += 1;
    return {
      no: counters[l.sex], enrollment_id: l.enrollment_id, name: formName(l), sex: l.sex, lrn: l.lrn,
      days: values,
      absent: complete ? sum(counted.map(v => v.absent)) : null,
      present: complete ? sum(counted.map(v => v.present)) : null,
      tardy: complete ? sum(counted.map(v => v.tardy)) : null,
      absent_five_consecutive: complete ? longest >= 5 : null,
      registered_at_end: cells.has(source.to),
      remarks,
    };
  });

  const complete = !!rule && unconfiguredDays === 0 && alternativeDays === 0 && unmarkedSessions === 0 && pendingDays === 0;
  // The summary counts to today in a month still under way, once nothing that has passed is unmarked or unset.
  const known = complete || (!!rule && pendingDays > 0 && unmarkedSessions === 0 && passedUnset === 0);
  const heldDays = classDays.length - pendingDays;
  const daily = columns.map(column => {
    if (column.kind !== 'class' || !rule) return { day_on: column.day_on, male: null, female: null, total: null };
    const of = (sex: 'male' | 'female') => {
      const values = learners.filter(l => l.sex === sex).map(l => l.days[column.day_on]).filter((v): v is Sf2Cell => typeof v === 'object');
      return values.some(v => v.mark === 'unmarked' || v.mark === 'pending') ? null : sum(values.map(v => v.present));
    };
    const male = of('male'), female = of('female');
    return { day_on: column.day_on, male, female, total: male === null || female === null ? null : male + female };
  });

  const bySex = (test: (l: typeof learners[number]) => boolean) => trio(learners.filter(l => l.sex === 'male' && test(l)).length, learners.filter(l => l.sex === 'female' && test(l)).length);
  // Since 0050 the source counts the month's movements from the timeline, the same
  // way the SF4 does, so the two forms cannot differ over a learner who left on the
  // first of the month. A database still on 0049 sends none and the roster is read
  // instead: the old undercount, rather than a form that will not open at all.
  const monthEvents = (reason: 'transfer_in' | 'transfer_out' | 'dropout' | 'death' | 'withdrawal') => {
    const seen = source.movements;
    if (seen) return trio(seen[reason]?.b.male ?? 0, seen[reason]?.b.female ?? 0);
    return trio(
      source.learners.filter(l => l.sex === 'male').reduce((n, l) => n + l.events.filter(e => e.reason === reason).length, 0),
      source.learners.filter(l => l.sex === 'female').reduce((n, l) => n + l.events.filter(e => e.reason === reason).length, 0));
  };
  const registered = bySex(l => l.registered_at_end);
  const cutoff = trio(source.at_cutoff.male, source.at_cutoff.female);
  const late = trio(
    source.learners.filter(l => l.sex === 'male' && isLate(l, source)).length,
    source.learners.filter(l => l.sex === 'female' && isLate(l, source)).length);
  const ratio = (a: BySex, b: BySex): BySex<number | null> => ({
    male: b.male ? (a.male / b.male) * 100 : null, female: b.female ? (a.female / b.female) * 100 : null, total: b.total ? (a.total / b.total) * 100 : null });
  // DepEd's formulas, as the SF2 prints them, over the days of classes held so far.
  const totalDaily = known ? trio(sum(daily.map(d => d.male ?? 0)), sum(daily.map(d => d.female ?? 0))) : null;
  const ada = totalDaily && heldDays ? { male: totalDaily.male / heldDays, female: totalDaily.female / heldDays, total: totalDaily.total / heldDays } : null;

  return {
    form: 'sf2' as const,
    school: source.school,
    section: { id: source.section.id, grade_level: source.section.grade_level, name: source.section.name, adviser_name: source.section.adviser_name },
    school_year: { id: source.school_year.id, start_year: source.school_year.start_year },
    month_on: source.month_on, from: source.from, to: source.to, cutoff: source.cutoff, month_status: source.month_status,
    rule: rule ? { mixed_day: rule.mixed_day, single_session_day: rule.single_session_day, version: rule.version } : null,
    columns, learners, daily,
    summary: {
      days_of_classes: classDays.length,
      enrolment_at_cutoff: cutoff,
      late_enrolment: late,
      registered,
      percentage_of_enrolment: ratio(registered, cutoff),
      average_daily_attendance: ada,
      percentage_of_attendance: ada ? ratio(ada, registered) : null,
      absent_five_consecutive: known ? bySex(l => l.absent_five_consecutive === true) : null,
      dropped_out: monthEvents('dropout'),
      transferred_out: monthEvents('transfer_out'),
      transferred_in: monthEvents('transfer_in'),
    },
    completeness: { complete, rule_recorded: !!rule, unmarked_sessions: unmarkedSessions, pending_days: pendingDays, unconfigured_days: unconfiguredDays, alternative_delivery_days: alternativeDays },
    // Only while days of classes are still to come, so a finished month, and every issued one, reads exactly as before.
    // The date is the last day of classes held, or today if none has been yet.
    ...(pendingDays ? { to_date: { as_of: classDays.filter(d => !ahead(d)).pop() ?? source.today, days_held: heldDays } } : {}),
  };
}

/** Enrolled for the first time this month, after the beginning-of-year cut-off, into this section. */
function isLate(l: Sf2Source['learners'][number], source: Sf2Source) {
  const first = l.first_entry;
  return !!first && first.reason === 'regular' && first.effective_on > source.cutoff
    && first.effective_on >= source.from && first.effective_on <= source.to && first.section_id === source.section.id;
}

type Movement = { a: { male: number; female: number }; b: { male: number; female: number } };
export type Sf4Source = {
  school: Record<string, string | null>;
  school_year: { id: string; start_year: number; starts_on: string; ends_on: string; status: string };
  month_on: string; from: string; to: string; today: string;
  sections: {
    section_id: string; grade_level: number; name: string; adviser_name: string | null; adviser_position: string | null; adviser_specialization: string | null;
    month_status: 'draft' | 'submitted' | 'locked';
    registered: { male: number; female: number };
    movement: Partial<Record<'transfer_in' | 'transfer_out' | 'dropout' | 'death' | 'withdrawal', Movement>>;
    days: (Schedule & { groups: ['male' | 'female', Session, Session, number][] })[];
  }[];
  /**
   * Registered learners who are in no class as of the last day of the month
   * (0052). Every figure on the SF4 is grouped by section, so these belong to
   * no section row and no rollup; they are reported on their own and block the
   * form rather than being added into a total that would then not match the
   * rows printed above it.
   */
  unplaced?: { grade_level: number; male: number; female: number }[];
  other_staff: { name: string; role: string; position: string | null; specialization: string | null }[];
};

const span = (m: Movement | undefined) => {
  const a = trio(m?.a.male ?? 0, m?.a.female ?? 0), b = trio(m?.b.male ?? 0, m?.b.female ?? 0);
  return { a, b, ab: trio(a.male + b.male, a.female + b.female) };
};
const addTrio = (x: BySex, y: BySex) => trio(x.male + y.male, x.female + y.female);
const addSpan = (x: ReturnType<typeof span>, y: ReturnType<typeof span>) => ({ a: addTrio(x.a, y.a), b: addTrio(x.b, y.b), ab: addTrio(x.ab, y.ab) });

export type Sf4 = ReturnType<typeof computeSf4>;

export function computeSf4(source: Sf4Source, rule: DayRule | null) {
  const sections = source.sections.map(s => {
    let unmarked = 0, unconfigured = 0, alternative = 0, pending = 0;
    const total = { male: 0, female: 0 };
    let classDays = 0;
    // Today is still to come until this section's register is started, exactly as on the
    // SF2: a consolidation opened at eight in the morning is not missing today's marks,
    // and counting the class as unmarked would flag every section that is simply not due.
    const todayStarted = s.days.some(d => d.day_on === source.today && d.groups.some(([, am, pm]) => am !== null || pm !== null));
    const ahead = (day: string) => day > source.today || (day === source.today && !todayStarted);
    for (const day of s.days) {
      const kind = dayKind(day, rule);
      if (kind === 'unconfigured') { unconfigured += 1; continue; }
      if (kind === 'alternative_delivery') { alternative += 1; continue; }
      if (kind !== 'class' || !rule) continue;
      classDays += 1;
      if (ahead(day.day_on)) { pending += 1; continue; }
      for (const [sex, am, pm, n] of day.groups) {
        const value = dayValue(day, am, pm, rule);
        if (value.mark === 'unmarked') unmarked += n; else total[sex] += value.present * n;
      }
    }
    const complete = !!rule && unmarked === 0 && unconfigured === 0 && alternative === 0 && pending === 0;
    const registered = trio(s.registered.male, s.registered.female);
    const ada = complete && classDays ? { male: total.male / classDays, female: total.female / classDays, total: (total.male + total.female) / classDays } : null;
    return {
      section_id: s.section_id, grade_level: s.grade_level, name: s.name, adviser_name: s.adviser_name,
      adviser_position: s.adviser_position, adviser_specialization: s.adviser_specialization, month_status: s.month_status,
      days_of_classes: rule ? classDays : null, registered, average_daily_attendance: ada, percentage: ada ? percentOf(ada, registered) : null,
      dropout: span(s.movement.dropout), transferred_out: span(s.movement.transfer_out), transferred_in: span(s.movement.transfer_in),
      death: span(s.movement.death), withdrawal: span(s.movement.withdrawal),
      completeness: { complete, unmarked_learner_days: unmarked, pending_days: pending, unconfigured_days: unconfigured, alternative_delivery_days: alternative },
    };
  });
  // Grades, then the school: counts add up; a daily average adds up only when every section's is known.
  const rollup = (rows: typeof sections) => {
    const registered = rows.reduce((t, r) => addTrio(t, r.registered), trio(0, 0));
    const known = rows.every(r => r.average_daily_attendance);
    const ada = known && rows.length ? rows.reduce((t, r) => ({ male: t.male + r.average_daily_attendance!.male, female: t.female + r.average_daily_attendance!.female, total: t.total + r.average_daily_attendance!.total }), { male: 0, female: 0, total: 0 }) : null;
    const zero = span(undefined);
    return {
      registered, average_daily_attendance: ada, percentage: ada ? percentOf(ada, registered) : null,
      dropout: rows.reduce((t, r) => addSpan(t, r.dropout), zero), transferred_out: rows.reduce((t, r) => addSpan(t, r.transferred_out), zero),
      transferred_in: rows.reduce((t, r) => addSpan(t, r.transferred_in), zero), death: rows.reduce((t, r) => addSpan(t, r.death), zero),
      withdrawal: rows.reduce((t, r) => addSpan(t, r.withdrawal), zero),
    };
  };
  // A registered learner in no class belongs to no section row, so no rollup
  // can hold them. Reported beside the form, never folded into it: a grade
  // subtotal has to equal the section rows printed above it (0052).
  const unplaced = (source.unplaced ?? []).map(u => ({ grade_level: u.grade_level, ...trio(u.male, u.female) }));
  const unplacedTotal = unplaced.reduce((n, u) => n + u.total, 0);
  const levels = [...new Set(sections.map(s => s.grade_level))].sort((a, b) => a - b);
  return {
    form: 'sf4' as const,
    school: source.school, school_year: { id: source.school_year.id, start_year: source.school_year.start_year },
    month_on: source.month_on, from: source.from, to: source.to,
    rule: rule ? { mixed_day: rule.mixed_day, single_session_day: rule.single_session_day, version: rule.version } : null,
    sections,
    grades: levels.map(level => ({ grade_level: level, ...rollup(sections.filter(s => s.grade_level === level)) })),
    school_total: rollup(sections),
    unplaced,
    other_staff: source.other_staff,
    completeness: { complete: !!rule && sections.every(s => s.completeness.complete) && unplacedTotal === 0, rule_recorded: !!rule,
      incomplete_sections: sections.filter(s => !s.completeness.complete).length,
      not_submitted: sections.filter(s => s.month_status === 'draft').length,
      unplaced_learners: unplacedTotal },
  };
}

/** The SF4's "percentage for the month": the daily average over the registered learners, per sex and in total. */
function percentOf(ada: BySex, registered: BySex): BySex<number | null> {
  return { male: registered.male ? (ada.male / registered.male) * 100 : null, female: registered.female ? (ada.female / registered.female) * 100 : null,
    total: registered.total ? (ada.total / registered.total) * 100 : null };
}
