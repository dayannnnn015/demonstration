# The SF2 and the SF4

The two official attendance returns. The SF2 is one section's daily register for
one month; the SF4 is the school's monthly consolidation, compiled from the
sections' submitted months.

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `src/modules/forms/`, `web/forms/` and the
> [changelog](../CHANGELOG.md), in that order of authority — the code is true,
> the changelog says why. Where this file and
> [constraints.md](constraints.md) disagree, that file wins.

## The one rule everything here depends on

**Attendance figures come only from the school's recorded rule.** The principal
records it; nothing else sets it, and there is no default.

```
GET  /api/v1/attendance-day-rule     the rule and its history; null until recorded
POST /api/v1/attendance-day-rule     the principal only, with a reason
```

The rule answers two questions, and only two:

| Field | Values | What it decides |
|---|---|---|
| `mixed_day` | `tardy`, `absent`, `half_day` | What a day is when one session was present and the other absent |
| `single_session_day` | `counts`, `not_counted` | Whether a date with only one classroom session is a day of classes |

`P1800` refuses anyone but the principal; `P1801` refuses recording the rule it
already has. The rule is versioned, and every issued form records the
`day_rule_version` it was computed under, so a form issued before a rule change
can be told from one issued after.

**With no rule recorded, nothing that depends on one is computed at all.** Not
estimated, not defaulted, not left at zero — absent from the response, so the
screen draws `Unrecorded` and the form refuses to issue.

## Where a mark becomes a day

`src/modules/forms/attendance.ts` is **the only place in the system** where a
morning mark and an afternoon mark become one day. It is pure: the database
supplies what was recorded, these functions decide what it means, and no other
module and no screen repeats the arithmetic.

Two functions carry the whole rule.

`dayKind(day, rule)` classifies a date:

| Kind | When |
|---|---|
| `unconfigured` | The calendar has no entry for the date |
| `alternative_delivery` | Either session is alternative delivery |
| `class` | Both sessions are classroom — or one is, and the rule says a single session counts |
| `no_class` | Neither session is classroom, or one is and the rule says it does not count |

`dayValue(day, am, pm, rule)` turns one learner's two marks into a day. Only
classroom sessions count. **Any counting session unmarked leaves the whole day
unmarked** — never present, never zero. Both present is present; both absent is
absent; one of each follows `mixed_day`:

- `tardy` — counted **present**, with a tardy, and the mark distinguishes which
  half was missed: `late` when the morning was, `cutting` when the afternoon was.
  These are the SF2's own two half-shadings, upper and lower.
- `absent` — counted absent.
- `half_day` — 0.5 present and 0.5 absent.

The returned `DayMark` is one of `present`, `absent`, `late`, `cutting`, `half`,
`unmarked` — the SF2's own marks (blank present, `x` absent, the two
half-shadings) plus the two EDUNEXUS adds for what the paper form cannot say.

## Four things that are never guessed

This is the part of the system that most invites a plausible-looking estimate,
so each refusal is deliberate:

1. **A session nobody marked** makes the day unmarked. Absence of a record is
   not evidence.
2. **A date the calendar has not configured** makes the month's figures wait.
   The rule says nothing about an unset date.
3. **A date with an alternative-delivery session** does the same: the rule does
   not cover it, and the conversion rules are behind the
   [mark meanings gate](constraints.md#gates).
4. **A day of classes still to come is none of these.** It has not happened, so
   it is neither missing data nor an unmarked session.

That fourth one is why the SF2 has `to_date`.

### Counting to date, and why `today` is not simply today

While a month still has days of classes ahead of it, the SF2 counts **to date**
and says so: the response carries `to_date: { as_of, days_held }`, present only
while `pending_days > 0`. A finished month, and every issued month, reads
exactly as it did before this existed.

The subtlety is in `todayStarted`:

```ts
const todayStarted = source.learners.some(l => l.cells.some(c => c.day_on === source.today && (c.am !== null || c.pm !== null)));
const ahead = (day: string) => day > source.today || (day === source.today && !todayStarted);
```

**Today is still to come until its register is started.** An SF2 opened at eight
in the morning is not missing today's marks — nobody has taken the register yet.
Without this, every section would show as incomplete first thing every morning,
and the signal would be noise. The SF4 repeats the same test per section, for
the same reason: a consolidation opened at eight is not missing anything.

## The SF2, figure by figure

`GET /api/v1/sections/:id/forms/sf2?month_on=YYYY-MM-01`

### Rows and columns

Columns are the weekdays of the month, **plus any weekend date the school
actually held classes on** — a Saturday class day gets a column, an ordinary
Saturday does not.

Rows are the section's learners, **males then females**, then by surname, first
name, middle name, and `enrollment_id` as the final tie-break so the order is
stable across reads. Each sex is numbered from 1 independently, as the paper form
numbers them. Names print as `formName` builds them: `Last, First Ext Middle` —
the SF2's own order.

A learner's cell on a column is one of:

| Value | Meaning |
|---|---|
| `no_class` | Not a day of classes |
| `out` | The learner did not belong to the section that day |
| `{ mark: 'pending' }` | A day of classes still to come |
| `{ mark: 'waiting' }` | No rule recorded, so the mark cannot be decided |
| a `DayValue` with `am` and `pm` | The decided mark, beside the two it came from |

Carrying `am` and `pm` alongside the decided mark is deliberate: the form shows
one daily mark, and the screen can still show what was actually recorded.

### A learner's own totals

`present`, `absent`, `tardy` and `absent_five_consecutive` are computed **only
when that learner's days are all marked** (`complete`), and are `null`
otherwise. They count only `memberDays` — the days of classes the learner
belonged to the section — so a learner who transferred in mid-month is not
charged with the days before they arrived.

`absent_five_consecutive` is the longest run of absent days of classes, again
over member days only, tested `>= 5`. It is **a count, not an alert**: the
[absence-alert gate](constraints.md#gates) is shut and contested, so nothing
notifies, messages or flags on it. The SF2 counts those learners because the
school's own form has a box for it.

### The summary

DepEd's formulas, as the SF2 itself prints them:

| Figure | How |
|---|---|
| `days_of_classes` | Days of kind `class` in the month |
| `enrolment_at_cutoff` | From the source, by sex |
| `late_enrolment` | First entry into *this* section, reason `regular`, after the cut-off and within the month |
| `registered` | Learners still registered on the month's last day |
| `percentage_of_enrolment` | `registered / enrolment_at_cutoff × 100` |
| `average_daily_attendance` | Total daily attendance ÷ days of classes **held so far** |
| `percentage_of_attendance` | `average_daily_attendance / registered × 100` |
| `absent_five_consecutive` | Learners whose longest absent run reached five |
| `dropped_out`, `transferred_out`, `transferred_in` | The month's movements |

Every one of them is by sex and total.

Two guards sit over all of it. `complete` means the rule is recorded and there
are no unmarked sessions, unconfigured dates, alternative-delivery dates or
pending days. `known` is the weaker condition the to-date figures need: a rule,
no unmarked sessions, and **nothing that has already passed** unset. A daily
column's figure is `null` the moment any learner's cell on it is unmarked or
pending — one missing mark, and that day's average is not stated.

### Movements come from the timeline, not the roster (0050)

Since migration 0050, the month's movements are read from the enrollment
timeline and shaped exactly as the SF4's are. Before that they were counted from
the roster, and **a learner whose departure took effect on the first day of the
month had no day on that month's register, so the roster lost them — while the
SF4 kept them.** The two forms disagreed by one.

The fallback is deliberate: a database still on 0049 sends no `movements`, and
the roster is read instead. That reproduces the old undercount rather than
serving a form that will not open at all.

### Remarks

The remarks column is built from the learner's timeline events, with one
exclusion — an ordinary `enrolled`/`regular` event at or before the cut-off is
not a remark, because being enrolled from the start of the year is not an event
worth printing. Everything else becomes a phrase with its date: *Transferred in
2026-08-14*, *Dropped out …*, *Deceased …*, *Withdrawn …*, *Returned to school
…*, *Moved into this section …*.

One remark is synthesised rather than read: a learner who has not withdrawn, has
member days, but is not on the roster on the month's last day gets *Moved to
another section after <date>*. The adviser's own monthly remark, if they wrote
one, is appended last.

## The SF4, figure by figure

`GET /api/v1/academic-years/:id/forms/sf4?month_on=YYYY-MM-01`

The school's consolidation. One row per section, grade subtotals, a school
total — and the rule that shapes everything about it:

> **Every figure on the SF4 is counted by section**, and the grade and school
> rollups are sums of the section rows.

Movements come as a `span`: `a` and `b` halves with their `ab` sum, matching the
form's own split columns. A rollup adds the counts, but **adds a daily average
only when every section's is known** — one section with an unmarked session and
the grade subtotal is `null`, rather than a sum of what happens to be available.

### The fault that rule caused, and the fix (0052)

Because every figure is grouped by section, **a learner registered at a grade
but not yet in a class belonged to no row and therefore to no total.**
"Registered learners as of end of the month" — the figure the division reads —
came out short, with nothing on the form saying so. Migration 0048 made the
section optional, which is correct for enrolment, and that is what made this
reachable.

Migration 0052 reports them as `unplaced`, a list of `{ grade_level, male,
female, total }`, and they are **deliberately not folded into any rollup**: a
grade subtotal has to equal the section rows printed above it, and inventing a
line the form does not have would be worse than refusing. The screen shows them;
issuance refuses.

## Issuance

```
POST /api/v1/sections/:id/forms/sf2/issuances
POST /api/v1/academic-years/:id/forms/sf4/issuances
GET  /api/v1/form-issuances
```

Issuing records a row in `edunexus.form_issuances`: a serial, a **SHA-256
fingerprint of exactly what the form said**, the `day_rule_version` it was
computed under, the actor, the request ID and a reason. Re-issuing the same scope
with different content is visibly a correction, and `P1802` (`REISSUE_REASON`)
refuses it until a reason is given.

Printing is not issuing. **Print a working copy** makes no server call and
records nothing; Issue records all of the above.

### What issuance refuses, in order

The SF2 refuses on one condition, `FORM_INCOMPLETE`, whose message names every
cause it found: the month is not over and *n* days of classes are still to come;
the principal has not recorded the rule; *n* sessions are not marked; *n* dates
are not set on the calendar; *n* dates have an alternative-delivery session,
which the rule does not cover.

The SF4 checks three things, **in this order, and the order is the point**:

1. `FORM_UNPLACED_LEARNERS` — *n* registered learners are not in a class, named
   by grade. This is checked **first**, before the submission gate, because
   putting a learner in a class changes that section's register for the month,
   which a submitted month would then have to be returned and re-submitted for.
   Saying it first saves that round trip.
2. `FORM_NOT_SUBMITTED` — *n* sections have not submitted this month. The SF4 is
   compiled from submitted SF2s.
3. `FORM_INCOMPLETE` — *n* sections have unmarked sessions, unset dates or days
   still to come; or, if there is no rule, that.

## Privacy

**The SF2 names every learner on it, so its reads are logged like the
register's.** `sf2Get` and `sf2Issue` write a `record_access_events` row naming
every enrollment the form returned.

**The SF4 names nobody.** It is counts by section, so it writes no access row —
the same reasoning that lets `GET /enrollment-counts` feed the Overview.

## The screens

| Screen | File | What it is |
|---|---|---|
| Daily register | `web/screens/Attendance.tsx` | Where the marks are recorded; typed in the SF2's own letters |
| Monthly consolidation | the attendance-months module's screen | Where a section's month is submitted |
| SF2 | `web/forms/sf2.tsx` | The form, on screen and on paper |
| SF4 | `web/screens/Sf4.tsx`, `web/forms/sf4.tsx` | The consolidation |

The register takes the keyboard in the SF2 grid's own letters — `x` absent all
day, `p` present all day, `m` absent in the morning, `a` absent in the afternoon
— imported from `typedPair` in `web/forms/sf2.tsx` rather than restated, **so the
register and the form a teacher corrects it on cannot drift**. The reasoning
behind the three choices there (arrow keys left to the radio group,
`Delete`/`Backspace` deliberately not carried over, a blocked session keeping
what it holds) is recorded in [constraints.md](constraints.md) under 2026-11-03.

Both forms download as Excel through `web/xlsx.ts`, which lays the workbook out
on a grid that measures itself and whose `problems()` names anything cut off or
shown as `#####`. The SF2 prints A4 landscape with its foot side by side and
never split. The download must match the screen — the shading is the form's own
CODES legend, not decoration.

## What is deliberately absent

- **No alert, threshold, notification or message** on any attendance figure. The
  absence-alert gate is shut and contested.
- **No estimated figure.** With no rule, an unmarked session, an unset date or an
  alternative-delivery date, the figure is empty.
- **No importable SF4 average.** The school's filled SF4 carries daily averages
  and percentages; they are exactly what this system declines to compute, and
  importing them would make a second, disagreeing record.
- **No typed attendance on the SF9.** Its boxes are counted from the register by
  the same rule, so the card always agrees with the SF2 and the SF4.
- **No half-day credit, single-session conversion or transfer effective-date
  rule** beyond the two fields the recorded rule carries. Those are behind the
  mark-meanings gate.

## Still unknown

Behind the [mark meanings and conversion rules gate](constraints.md#gates): how a
morning and an afternoon become one daily mark beyond the recorded rule, half-day
credit, single-session days, transfer effective dates, and alternative-delivery
conversion. The form's single daily column also raises whether the school keeps
two-session registers at all.

Behind the [official form templates gate](constraints.md#gates): the process for
correcting an already-issued form.

## Where to look

| | |
|---|---|
| The arithmetic | `src/modules/forms/attendance.ts` — and nowhere else |
| Operations, refusals, issuance | `src/modules/forms/service.ts` |
| Contracts and response shapes | `src/modules/forms/contracts.ts` |
| Error codes | `src/core/errors.ts`, range `P18xx` |
| Migrations | `0050` (movements from the timeline), `0052` (unplaced learners) |
