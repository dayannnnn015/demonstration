# The SF9 and the SF10

The SF9 is one learner's report card for one school year, in the layout of the
school's own card for their grade. The SF10-ES is one learner's **permanent
academic record** for their whole time in elementary school.

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `src/modules/forms/cards.ts`, `web/forms/` and
> the [changelog](../CHANGELOG.md), in that order of authority. Where this file
> and [constraints.md](constraints.md) disagree, that file wins.
>
> The historical half of the SF10 — the years transcribed from the school's own
> documents — has its own, fuller account in
> [the academic history](prior-academic-records.md), written while that work was
> done. This file does not repeat it.

## What is on these forms, and where every number comes from

**Nothing on either form is computed by EDUNEXUS.** Every grade, final grade,
subject average and general average is the figure the adviser entered from the
DepEd ECR, carried through as entered (2026-10-08). The remarks are the ECR's
remarks. The descriptors are printed from DepEd's own orders.

The **only** counting in `cards.ts` is attendance days, and that goes through the
same two functions as the SF2 — `dayKind` and `dayValue` from
[`attendance.ts`](attendance-forms.md) — so the card can never disagree with the
register or the consolidation.

```
GET  /api/v1/enrollments/:id/forms/sf9
POST /api/v1/enrollments/:id/forms/sf9/issuances
GET  /api/v1/learners/:id/forms/sf10
POST /api/v1/learners/:id/forms/sf10/issuances
```

## The SF9: three cards, not one

`computeSf9` picks the layout from the grade level, and the three are genuinely
different documents, not one document with parts hidden:

| Grade | `layout` | The card |
|---|---|---|
| 1 | `grade1` | The descriptive card: **narratives by term, no grades at all** |
| 2–3 | `grades2_3` | The performance report on terms, with comments |
| 4–6 | `grades4_6` | The progress report card, front and back, with observed values |
| Kindergarten | — | **Refused.** `NO_KINDERGARTEN_CARD` |

Kindergarten is refused because the school has not supplied its Kindergarten
card, and the Kinder assessment policy is behind
[its own gate](constraints.md#gates). A Kinder learner's records are the SF5-K
and the ECCD checklist, which EDUNEXUS neither holds nor replaces.

### Each card prints on its own page box

```css
@page sf9-g1  { size: A4 portrait;  margin: 6mm; }
@page sf9-g23 { size: A4 landscape; margin: 6mm; }
@page sf9-g46 { size: A4 landscape; margin: 12.7mm; }
```

`sf9Page` in `web/forms/sf9.tsx` maps the layout to its rule, keyed by the
layout the form itself reports rather than by grade level, and **both places that
print an SF9 — the learner's own card and the section's batch — read it from
there.**

This is not cosmetic. Laid out on the wrong page box, the print dialog shrinks
the whole card to fit the paper in the tray, which is what made the text
unreadable and left a third of the sheet empty. The Grades 4–6 card is **A4, not
Letter** (decided 2026-11-02): the school's Word file says Letter, but its three
other references are A4, the staffroom dialog defaults to it, and Letter spilled
the card onto a third sheet.

### The descriptors are DepEd's, printed, never applied

Three tables are printed on the cards and **none of them is used to decide
anything**:

- `descriptors46` — DO 8, s. 2015's scale (Outstanding 90–100 … Did Not Meet
  Expectations below 75), which the school's supplied Grades 4–6 card prints.
- `descriptors23` — the Advancing / Benchmarking / Connecting / Developing /
  Emerging scale. **DepEd Order No. 15, s. 2026, Table 11 replaces the 2015
  descriptors with this one from 2026–2027**, which the Grades 2–3 cards already
  print.
- `levels` — the A–E observed-value levels with their full descriptions.

Printing a scale is not computing with it. The passing mark of 75 on the form
does **not** open the grading gate: an output scale is not the arithmetic that
reaches it, and the form gives no weights, transmutation or rounding
(2026-09-19).

### Attendance on the card

`attendanceFor(days, rule, from, to, today)` counts one stretch of dates,
**counting only the dates the learner belonged to a section**. The day counts
need a rule; present, absent and tardy also need every passed day marked.

The Grade 1 card lists each term's months — so a month split between two terms is
listed twice, under each. The other two list the year's months once.

Four outcomes, and the distinctions matter:

| Situation | Result |
|---|---|
| No rule, or any date unset / alternative-delivery | Everything `null`, `known: false`, and `unset` carries the dates |
| Any passed day unmarked | `class_days` known; present/absent/tardy `null`; `unmarked` carries the dates |
| Month finished and complete | All four known |
| Month under way, days so far all marked | Counted **to date**, `to_date` is the last day held |
| Month wholly still to come | `class_days` from the calendar, nothing else, `started: false` |

`attendanceTotal` sums the months **begun so far**. Every one must be known or
the total stays empty; while days of the year are still to come it is a total to
date and carries the date.

**Attendance on the SF9 is never typed.** Typing monthly totals by hand would
make a second, disagreeing record of attendance, which the standing rules forbid.

### The warnings, and why they carry dates

`warnings` is the card's own account of what is missing:

- No rule recorded, so no attendance figure is filled in.
- *n* grades are not recorded for terms that have ended. (The Grade 1 card prints
  narratives, not grades, so `missing` is 0 for it — **a grade a card has no box
  for is not missing.**)
- A month left empty, with **the dates that emptied it**, through `datesIn`:
  *"October is empty because 3 days have a session nobody marked (5, 12 and 19
  October). A missing mark is never counted as present, so mark it on the
  register and this month fills in."*

That last one is the point of the whole mechanism. On the card an empty month
looks the same whatever emptied it, and **nobody can act on that**. Keeping the
dates rather than a bare fact turns "this is blank" into "go and mark these
three days". A month wholly still to come is not a gap and says nothing.

### The outcome and the eligible grade

`eligibleFor(grade, promotion)` reads the approved end-of-year outcome:

| Outcome | Eligible for |
|---|---|
| `promoted`, `conditionally_promoted` | the next grade — **DepEd Order No. 15, s. 2026**, which moves the learner up with back subjects |
| `retained` | the same grade |
| `remedial` | **nothing yet** — the learner is in remedial classes |
| none approved | `null` |

## The SF10: one cumulative record, derived every time

> **The SF10 is one cumulative record per learner, it is never a stored
> document, and it begins at Grade 1.**

It is derived on every read, one scholastic block per school year, from two
places that print identically and sort together:

| `origin` | Where the block came from |
|---|---|
| `register` | A year EDUNEXUS recorded itself — an enrolment and the grades entered from the ECR |
| `encoded` | A year transcribed from the school's own documents (0051) |

They print identically because the permanent record is one continuous history,
and **a learner's Grade 2 does not become a different kind of fact for having
been typed from a spreadsheet.** `origin` exists so a screen can say which is
which, and so that nothing derived from a transcription is mistaken for a
decision EDUNEXUS made.

Blocks sort by `start_year`, then `grade_level`. There is **no per-year SF10 to
create and none to carry forward.**

### Kindergarten is never a block

The SF10-ES has no scholastic block for Kindergarten. Kinder is the credential
that makes a learner eligible for Grade 1, and that is what the form's
eligibility block carries — so it is recorded there, carries no grade, and the
Kindergarten grading gate is untouched.

`computeSf10` filters `grade_level > 0` out of the recorded enrolments and
reports a Kinder enrolment EDUNEXUS holds as `kindergarten_here` instead.

The same rule the other way round: **a learner whose only year is Kindergarten is
refused an SF10** (`SF10_NOT_YET`) rather than handed a blank permanent record,
which is what the read used to do. The refusal names their actual records. The
registry prints *SF10 begins at Grade 1* in place of the button.

### A transcribed year carries no promotion decision

```ts
outcome: { action: null, eligible_grade: null }
```

EDUNEXUS approved no outcome for a year it did not record, and the document's own
remark already sits on the General Average line. The certification reads only the
**recorded** years, so **a transcription can never manufacture a promotion that
nobody approved.**

### Each block names its own school

A transferee's earlier year was taught somewhere else, and the form's block
heading has those fields for exactly that. `headingFor` fills district, division
and region **only when the school code says this is this school**; for another
school EDUNEXUS does not know them, and the form is left blank rather than filled
in with Balili's.

### Page rules and the data loss that was fixed

```css
@page sf10 { size: 8.5in 13in; margin: 8mm; }
```

Long bond, upright, and **its own rule** rather than sharing `@page long` with
Next year.

`PER_SHEET = 4`: four blocks to a leaf, front and back. Blocks are **rounded up
to a whole leaf, never a half one**, so the page count stays even and duplex
always pairs.

It used to be `blocks.slice(0, 4)` and `slice(4, 8)` — a hard cap of eight
blocks, so **a learner with nine or more graded years silently lost the rest off
a *permanent* record.** Six elementary years plus a repeated grade is nine
blocks, so this was reachable. Verified after the fix: 9 years → 16 blocks over 4
sheets, none missing.

### The SF10 reads the same on screen and on paper

The format rules live in `.paper.sf10`, not in `@media print`: 756px content
width, 1120px pages, 7.0pt cells in both. Only `@page`, the page breaks and the
seeded notice are print-only.

This **reverses** the original brief's *"keep screen styles and print styles
separate"*, deliberately and at the user's request, because a permanent record is
checked on screen and signed on paper. Recorded in
[constraints.md](constraints.md) under 2026-11-03.

Two print lessons are worth keeping. `rem` measured against the **root** font
size, not the form's, so `.sf10-grades td { height: 1.2rem }` made rows half
again too tall at 7.5pt — both are now in points. And **a `min-height` alone did
nothing useful**: it stretched the page box while the content stayed at the top.
The page is a flex column, the block grid takes the slack with
`grid-auto-rows: 1fr`, and each block's grade table spreads its rows. 94% fill.

### All six elementary grades, and why no change was needed (2026-11-05)

A clarification asked that the SF10 accommodate **Grade 1 through Grade 6** and
not be limited to four. The four in the code is `PER_SHEET` — four scholastic
blocks **to a printed side**, which is what the school's own workbook rules —
not a limit on grade levels. Nothing capped the grades: `cards.ts` builds one
block per encoded prior year plus one per recorded enrolment and sorts them by
school year then grade, with no slice, and `Sf10Sheet` rounds the slots up to
a whole leaf and continues onto further leaves rather than stopping.

So the requirement was already met, and **no code changed**. What was missing
was a test saying so, which is the thing that would have made the question
unnecessary. `tests/forms-sf10-six-grades.test.ts` now holds, through the real
API:

| The rule | The case |
|---|---|
| Six grade levels, one section each, in order | Grades 1–5 encoded with Grade 6 current gives exactly six blocks, `[1,2,3,4,5,6]`, years 2021–2026 |
| Issued without waiting for all six | A Grade 4 learner with nothing encoded is issued an SF10 with one block |
| A grade not yet encoded stays blank | Grades 1–3 absent from the blocks until encoded, then appearing in order |
| A grade not yet reached stays blank | Grades 5–6 never appear for a Grade 4 learner |
| No figure copied between grades | Each grade is encoded with its own average, 81…85, and each block is asserted against its own |
| Missing is not failed | An unfinished current year carries a null average **and** a null remark |

The copying case is the one that earns its place: pointing one block's average
at a constant makes it fail with `[84,84,84,84,84,null]`, which is what a
copied block would look like on a permanent record.

### One side of long bond was asked for, and is not advisable

It is already long bond — `@page sf10 { size: 8.5in 13in }` — and a complete
six-grade record **already prints on one sheet of paper**: six blocks round up
to eight slots, four to a side, so it is one leaf printed front and back. Not
two sheets.

One *side* is a different request, and three things stand against it:

- **Four blocks to a side is the school's own workbook**, the same document the
  footer citation comes from. Six to a side is a departure from the form a
  receiving school expects, on the one record that follows a learner between
  schools.
- **The side is already 94% full** at four blocks (measured in the print pass
  above). Six blocks is about 141% of it, so everything shrinks by roughly 0.82
  linear — 7pt cells reach about 5.7pt.
- **That size is already known to fail here.** The SF9 print pass found Grades
  4–6 descriptors reaching paper at 5.5pt when the dialog scaled the sheet, and
  recorded that it "made the text unreadable". Shrinking the SF10 to fit would
  reproduce it deliberately.

**Left as it is, pending the user**, who asked "if possible". It is possible
only by departing from the workbook and dropping below legible type, so it is
a decision rather than a layout tweak.

### The footer citation is an open question

Sheet 1 prints *"Revised 2025 based on DepEd Order No. 10, s. 2024"*, from the
workbook the school supplied. The 4 November clarification cites **DepEd Order
No. 58, s. 2017**. The structure matches what is built either way, so the
citation was left as the school's own document has it. **Ask which their current
workbook carries** — it is in the
[official form templates gate](constraints.md#gates).

## Issuance, and why Print and Issue both exist

They are not duplicates:

| | Does |
|---|---|
| **Print a working copy** | No server call. Records nothing |
| **Issue** | Records a serial, a SHA-256 fingerprint of exactly what the form said, the actor, the request ID and a reason |

A different card for the same enrollment, or a different record for the same
learner, is a **correction**, and `REISSUE_REASON` (`P1802`) refuses it until a
reason is written.

Both buttons stayed when *Type on the card* was removed (2026-11-03), because
they do different things. The print button reads **"Print a working copy"** on
both forms.

### One card per grade level, and the history of them (0.104.0, `0070`)

An SF9 belongs to an **enrollment**, which is one learner in one school year at
one grade level -- so the card is already one per grade, and a promoted learner
already starts a blank one. The `form_issuances` CHECK forces an `sf9` row to
name both an `academic_year_id` and an `enrollment_id`, and the prior a reissue
looks for is keyed on that same scope, so **a Grade 2 issuance cannot find,
supersede or overwrite a Grade 1 one**. Nothing in that table is ever updated or
deleted.

`GET /api/v1/learners/{id}/sf9-history` lists it: one row per school year, with
the grade, the class and whether that year’s card is `issued` (with its serial
and fingerprint), `in_progress`, `voided`, or `no_card` -- which is
Kindergarten, where `sf9Get` refuses and the school has supplied no card. It
names no staff member and reads no grade. The learner’s profile shows it as a
**Report card** column beside each school year. See
[the SF9 history](sf9-history.md).

A learner enrolled at a grade with **no class yet** -- every promoted learner,
until their new adviser pulls them in -- has a null `section_name` on the card.
The printed Section box stays blank, as an official form expects of an unknown,
and the card’s own warnings say the learner is not in a class yet.

### Grades have one way in

**"Type on the card" is gone.** The button, the typing mode, the review sheet,
the leave-confirm and the input machinery inside the card component were all
removed, including the component-level code, so there is no unreachable editor
left behind. Grades are entered at **Promotion → Report card** and nowhere else.

This reverses the 0.62.0 decision that the card is typed where it prints (the
group leader's note of 12 October). See
[report-records.md](report-records.md) for where grades are entered now.

## Privacy

| Operation | Access row |
|---|---|
| `sf9Get`, `sf9Issue` | the enrollment |
| `sf10Get`, `sf10Issue` | the learner **and** every enrolment whose grades are on the form |

The SF10's row names the learner as well as the enrolments. A record made only of
transcribed years has no enrolment at all, and before this was fixed it would
have logged **nothing** — the one gap in the privacy audit. The form carries the
learner's name, LRN and birth date whether or not a block came from an
enrolment, so the learner is named.

## The seals

The SF9 and SF10 headings carry the DepEd seal, the DepEd wordmark and the school
seal, from `web/public/images/`, versioned in their file names. These are three
of the entries on the **closed list of images** the workspace loads; the content
policy's single `img-src 'self'` covers them. See
[constraints.md](constraints.md) under 2026-11-02 for the whole list and why a
staff photo is still not on it.

One sharp edge, recorded so it is not rediscovered: the downloaded DepEd wordmark
**was not transparent** — its checkerboard was painted into the pixels (corner
alpha 255, greys 254 and 237). It was keyed out globally rather than
border-filled, because the counters of D, e, o and p are enclosed.

## What is deliberately absent

- **No computed grade, total, average, percentage, MPS, GWA or transmutation**,
  anywhere, including client-side. The General Average box on the SF9 does not
  authorize computing one (2026-09-19).
- **No typed attendance.**
- **No Kindergarten card**, and no numeric Kindergarten grading.
- **No stored SF10.** It is derived on every read.
- **No per-year SF10**, and nothing to carry forward.
- **No pre-printed school head on the SF9's Cancellation block.** The *receiving*
  school completes it; whether Balili's head should be pre-printed is the
  school's call, and it is an open question in the form-templates gate.

## Where to look

| | |
|---|---|
| The layout decisions and attendance counting | `src/modules/forms/cards.ts` |
| Operations, refusals, issuance, privacy rows | `src/modules/forms/service.ts` |
| The three SF9 cards and their page rules | `web/forms/sf9.tsx` |
| The SF10-ES layout and sheet chunking | `web/forms/sf10.tsx` |
| Print CSS | `web/styles/app.css`, the `@page` rules and `.print-root.*` blocks |
| Shared shapes and helpers | `web/forms/types.ts`, `web/forms/shared.tsx`, `web/forms/values.ts` |
| Error codes | `src/core/errors.ts`, range `P18xx` |
| The transcribed years | [prior-academic-records.md](prior-academic-records.md), migration `0051` |
