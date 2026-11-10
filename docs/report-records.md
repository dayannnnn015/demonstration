# Report-card records

Where every grade on an SF9 or an SF10 is actually entered: the learning areas'
grades per term, their final grades and remarks, the general average, the
observed values, the narratives and comments, and the end-of-year outcome.

> **Written 2026-11-04 from the code.** The original of this document was lost
> with the rest of `docs/` in the 0.86.1 recovery and exists in no branch and no
> commit, so this is written from `src/modules/report-records/`,
> `web/screens/ReportCards.tsx`, `web/screens/CardEditor.tsx` and the
> [changelog](../CHANGELOG.md), in that order of authority. Where this file and
> [constraints.md](constraints.md) disagree, that file wins.

## The rule this module exists to hold

> **Grades are entered from the DepEd ECR. Nothing here computes one.**

Decided 2026-10-08, and it **supersedes Section 4B.2, grade calculation** — the
old roadmap's "Next: calculation" is no longer the plan. Advisers copy what the
ECR already computed; EDUNEXUS records it as an observation, the same status an
attendance mark has.

There is no total, average, percentage, MPS, GWA, transmutation, weighting or
rounding anywhere in this module, in the database functions behind it, or in the
screens over it. The contract file says so in a comment on the operations list,
and it is enforced by there being nothing to call.

The one thing that *looks* like arithmetic is a refusal:

```ts
const grade = z.number().min(0).max(100)
  .refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
          'At most two decimal places, as the ECR shows it.').nullable();
```

A grade with a third decimal place is **refused, never rounded** — beside its own
box in the interface, and again in the database. Rounding it would be EDUNEXUS
deciding a rule it has not been given.

## The operations

```
GET  /api/v1/sections/:id/report-records            the whole section
POST /api/v1/section-subjects/:id/report-grades     one learning area, one term
POST /api/v1/sections/:id/report-summaries          general averages
POST /api/v1/sections/:id/report-values             observed values, one term
POST /api/v1/sections/:id/report-notes              narratives, comments, SF2 remarks
GET  /api/v1/enrollments/:id/report-card            one learner, with versions
POST /api/v1/enrollments/:id/report-card            one learner, box by box
GET  /api/v1/academic-years/:id/promotions          end-of-year outcomes
POST /api/v1/sections/:id/promotion-recommendations the adviser recommends
POST /api/v1/sections/:id/promotion-decisions       a manager approves or returns
GET  /api/v1/academic-years/:id/grade-entry         counts per section, manager only
GET  /api/v1/sections/:id/report-record-events      the journal, newest first
```

Only two are manager-only: `promotionsDecide` and `gradeEntryGet`. Everything
else is open to the section's current adviser under the row policies, in a year
that is not closed.

## What gets recorded

### Grades

`reportGradesRecord` takes one learning area (a `section_subjects` offering) and
one reporting period, up to 100 learners at a time.

**A null `reporting_period_id` means the final grade** — the subject average, the
*Final Grade* box on the Grades 4–6 card and *Ave.* on the Grade 3 card — and
that is the only entry that also carries a `remark` of `passed` or `failed`.

Copying one learning area down a whole class is the quickest way to work from the
ECR, which is why the class table exists alongside the per-learner card.

### The general average

`reportSummariesRecord`: each learner's `general_average` and its `remark`,
exactly as the ECR computed them. The SF9's General Average box does **not**
authorize computing one (2026-09-19) — it is typed because the ECR already
holds it.

### Observed values

`reportValuesRecord`, one reporting period at a time. Four core values and
**seven** behaviour statements, as the school's Grades 4–6 card prints them:

| Code | Core value |
|---|---|
| `MD1`, `MD2` | Maka-Diyos |
| `MT1`, `MT2` | Makatao |
| `MK1` | Makakalikasan |
| `MB1`, `MB2` | Makabansa |

Each is marked `AO` (Always Observed), `SO` (Sometimes Observed), `RO` (Rarely
Observed) or `NO` (Not Observed) — or left null, which means not recorded and is
drawn as such. The statements themselves are in `web/forms/values.ts`.

### Narratives, comments and SF2 remarks

`reportNotesRecord` covers four `kind`s, and which card has a box for which is
part of the layout, not a preference:

| `kind` | Where it prints |
|---|---|
| `can_do` | Grade 1: *What Your Child Can Do (Mga Nagagawa)* |
| `to_improve` | Grade 1: *What Your Child Is Learning To Improve (Dapat Linangin)* |
| `comment` | Grades 2–3: the term's comment |
| `sf2_remark` | The learner's own remark on a month's SF2 |

`sf2_remark` is the one keyed by `month_on` rather than a reporting period,
because the SF2 is monthly. It is how a transfer's destination school reaches the
register's remarks column.

A note body is trimmed, 1–1000 characters, and **refuses a tab, a carriage return
and every other control character, and text that is only spaces** — with that
said beside the box. Line breaks are kept; hidden characters are not. A hidden
character in a comment used to answer 500 (fixed in 0.76.0).

### The whole card at once

`reportCardRecord` records one learner's card **as it prints** — term grades,
subject averages and remarks, the general average, observed values and term
narratives — **all in one transaction or none.** Every part is checked and
journalled exactly as the class tables are, by the same database writers, so the
per-learner route cannot be a weaker way in than the per-column one.

`reportCardGet` is the matching read: the section's own read, narrowed to one
enrollment, so **every row check applies as it does there** and the access log
names only that learner. Each box comes back with the version it was last
recorded at, which is what makes a box-by-box save version-safe.

## End-of-year outcomes

Two steps, two roles, and **never derived from grades**:

1. `promotionsRecommend` — the adviser records each learner's outcome in the SF10
   workbook's own words: `promoted`, `conditionally_promoted`, `retained`,
   `remedial`. An already-approved outcome changes only after it is returned.
2. `promotionsDecide` — a manager approves, or returns to the adviser, with a
   reason.

A Kindergarten section, which has no card, records its outcomes on the same tab.

`conditionally_promoted` exists because **DepEd Order No. 15, s. 2026** moves a
learner up with back subjects. `eligibleFor` in `cards.ts` reads the approved
outcome to decide the grade the SF9 and SF10 certify the learner eligible for;
`remedial` yields none yet.

> **Superseded 2026-11-09 by 0070 (0.108.0).** The paragraph below was true
> until then, and the distinction it drew is worth keeping: approving an outcome
> and *choosing a class* are still two acts. What changed is that approval now
> **enrols the learner into next school year** at the grade their outcome leads
> to, with **no section** -- which is still not placing them in a class. An
> adviser takes them into one afterwards, exactly as 0049 decided. Approval also
> still activates no reporting period. See [the promotion gate](promotion-gate.md).

**Approval still places nobody (D3a, 0.83.0.)** Approving an outcome and placing
a learner in next year's class are two separate, separately reviewed acts. See
[next-year-classes.md](next-year-classes.md).

### Two gates on this module since 0069

**A term accepts its records only once it has started.** A trigger on
`report_grades`, `report_values` and `report_notes` refuses a reporting period
whose `starts_on` is after today in Manila (`P1908` -> `PERIOD_NOT_STARTED`), so
all four writers -- `record_report_grades`, `record_report_values`,
`record_report_notes` and `record_report_card` -- obey one rule. A term already
begun never closes, and a record naming no term (the subject average, the
general average, the SF2 month remark) is not gated.

**Promotion waits for the records this grade’s card prints.**
`GET /api/v1/sections/:id/promotion-readiness` counts them against the section’s
currently enrolled learners; both promotion writers refuse with `P2002` ->
`PROMOTION_NOT_OPEN` while one is missing. It reads **no grade value** -- the rule
at the top of this file is untouched -- and names no learner, so it writes no
access row, for the same reason `read_grade_entry` writes none. Kindergarten
waits for nothing; a descriptively graded grade waits for its term narratives.

## Grade entry: the oversight view, and the pattern to copy

`GET /api/v1/academic-years/:id/grade-entry`, manager-only. For every section of
a year it counts the grades recorded per learning area and reporting period, the
general averages, and the outcomes recorded, approved and returned — against the
section's current learners.

```ts
case 'gradeEntryGet': {
  // Counts only: no learner is named, so no access row is written.
```

**This is the shape every school-wide progress view in EDUNEXUS must have.** Every
list under `/learners` and `/enrollments` writes a `record_access_events` row
naming the exact records it returned, so a dashboard that read the roster would
bury the privacy audit in its own noise. A counting read names nobody and writes
nothing, which is the only reason it may skip the audit.

It is the named model for the school-wide encoding oversight in
[the roadmap](roadmap.md#6-school-wide-encoding-oversight--an-unmet-requirement).

## Privacy

Every write names the learners it touched; every read names the learners it
returned.

```ts
async function logged(tx, resource, ids) { if (ids.length) await tx.query('select edunexus.record_access($1,$2::uuid[])', [resource, [...new Set(ids)]]); }
```

The journal is the interesting case. **Its entries carry each learner's grades,
so reading it is a read of their report-card records** — and a page can name more
enrollments than one access row holds, so they are logged a hundred at a time.

## The journal, and the paging bug that was in it

Every mutation writes an immutable `report_record_events` row with before/after
snapshots, the actor, a reason and the request ID. `reportRecordHistory` pages it
newest-first.

It had a real bug, **pre-existing**, found while building the encoded-history
journal which had the same one:

```sql
-- wrong
select id::text, … from edunexus.report_record_events order by id desc
-- right
select id::text, … order by edunexus.report_record_events.id desc
```

`id::text` takes the output name `id`, and **a bare `id` in `ORDER BY` binds to
that output column**, sorting the identity column as *text*. Row 9 then outranks
row 10, the newest page of an audit journal silently loses its newest rows, and
the cursor skips the rest. The audit, access and score journals already qualified
their order-by; this one and the new one did not.

This is why `AGENTS.md` says to use an identity column, not a random uuid, for a
journal paged newest-first — and why the qualification matters even then.

## Where grades are entered in the interface

**One way in: Promotion → Report card.** *Type on the card* was removed on
2026-11-03, reversing the 0.62.0 decision that the card is typed where it prints.
The button, the typing mode, the review sheet, the leave-confirm and the input
machinery inside the SF9 component all went, including the component-level code,
so there is no unreachable editor left behind.

| | |
|---|---|
| `web/screens/ReportCards.tsx` | The class tables: one learning area down a whole section |
| `web/screens/CardEditor.tsx` | The shared draft (`useCardDraft`), the box list (`cardBoxes`) and the review (`CardReview`) |
| `web/learning-areas.ts` | The learning areas the school's cards print — **a proposal a manager reviews, never a seed** |

**Report cards → Class summary** shows one term's grades, or the final grades
with the general average, for the whole section side by side, boys then girls,
exactly as entered; anything missing is drawn as not recorded. It prints on long
bond, landscape, for checking against the ECR. **Nothing on it is totalled,
averaged or ranked.**

Four faults found in the 0.76.0 testing pass are worth knowing, because each was
a way to lose a grade: grades typed for one learning area were carried into the
next when the adviser switched without recording, and would have been recorded
there; a colleague's change meanwhile wiped every box typed in a column or on a
card; tabs, terms and sections switched without asking; and each grade was
offered tables its card never prints — observed values on Grades 1–3, comments on
Grades 4–6, numbers for a descriptive Grade 1 — now refused by the database too
(migration `0041`).

## What is deliberately absent

- **Nothing computes a grade.** No total, average, percentage, MPS, GWA or
  transmutation, including client-side.
- **No rounding.** A third decimal place is refused.
- **No ranking.** Not on the class summary, not anywhere.
- **No outcome derived from grades.** An outcome is a recorded decision.
- **No quiz and score screens.** *Quiz and test scores* and *Assessment policies*
  left every menu in 0.60.0 — "no more quizzes and scores, since the ECR is out".
  **The API and any recorded marks are kept**, for the day the school adopts a
  grading rule. The screens went; the records did not.
- **No numeric Kindergarten grading**, and no Kinder card.

## Where to look

| | |
|---|---|
| Contracts, schemas, the operations list | `src/modules/report-records/contracts.ts` |
| Service, privacy logging, the journal | `src/modules/report-records/service.ts` |
| Error codes | `src/core/errors.ts`, range `P19xx` |
| How the records reach paper | [report-card-forms.md](report-card-forms.md) |
| Outcomes into next year's classes | [next-year-classes.md](next-year-classes.md) |
| Years the school already holds on paper | [prior-academic-records.md](prior-academic-records.md) |
