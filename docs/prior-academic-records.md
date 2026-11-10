# The academic history the school already holds

> Shipped in **0.87.0**, migration **0051**. Error range **P25xx**.
> Screen: **Academic history**, in the Learners group. Module: `src/modules/prior-records/`.

EDUNEXUS derives the SF10 from what it recorded itself. That is right for a
school that has always used it, and wrong for the day it starts: a learner in
Grade 3 would have one scholastic block and five empty ones, while their
Kinder-to-Grade-2 history sat in an adviser's spreadsheet. This is the one-off
transcription that closes the gap, for **every existing learner from
Kindergarten to Grade 6** — not Grade 6 alone.

## What was already true before this

Worth stating, because three of the four things the brief asked for needed no
code:

| | |
|---|---|
| **One cumulative SF10 per learner** | Already true. `GET /learners/:id/forms/sf10` reads `read_sf10_source(learner)`, which returns one block per school year. No SF10 document is stored; it is derived on every read. The issuance record is keyed by `learner_id`, never by year. |
| **The same SF10 updated in later years** | Already true, and free. Enrol the learner, enter the year's grades on Promotion, and a new block appears on the same record. There is no per-year SF10 to create and none to carry forward. |
| **The official SF10-ES layout and printing** | Already built: `web/forms/sf10.tsx`, `@page sf10` on long bond, four blocks to a sheet over as many whole leaves as the record needs. It was not redesigned. |
| **SF9 from current records only** | Already true. The SF9 is per-enrollment, computed from `report_grades` and the register. Nothing here touches it, and no previous SF9 is ever encoded. |

So the increment is one new module and a merge, not a redesign.

## Why history is not encoded as enrollments

The obvious shortcut is to create a past `academic_year`, a `section`, its
`reporting_periods` and its `section_subjects`, enrol the learner into it and
enter grades the usual way. It is the wrong shape, and expensively so: those
rows are operational. A section invented for 2021 would appear on the SF4, the
register would open for it, promotion would consider it, and the school's own
figures would acquire classes that never met.

A prior year is a copy of a document. It is kept as one, beside the enrollments
rather than among them, and it reaches the SF10 and nothing else.

## The tables

```
learner_prior_years          one learner, one school year, at one grade
  learner_prior_grades       its learning areas, as the document lists them
learner_eligibility          the credential presented for Grade 1
learner_prior_record_events  the journal, with the whole block before and after
```

`learner_prior_years` holds the school that *taught* the year — name, ID,
address — not this school by assumption. The SF10's block heading has those
fields precisely because a transferee's earlier year was taught elsewhere.

`unique(learner_id, start_year)` is both the identity of a block and the rule
that stops a year being encoded twice; one learner is at one grade in one school
year. A repeated grade is a different school year and is unaffected.
`unique(prior_year_id, lower(btrim(name)))` is the brief's duplicate-subject
rule, and it holds however the name was capitalised on the day it was typed.

`source` is required, 10–500 characters: which spreadsheet, form or photocopy
the year was read out of. A permanent record copied out of a document is only as
good as the note saying which document. It is never printed — the form has no
box for it — and it is deliberately left out of the SF10 payload, so correcting
a provenance note is not a correction to the printed form.

`learner_prior_grades` cascades from its block, uniquely in this schema. A
subject row has no life apart from the block, every save rewrites the whole set,
and the journal rather than the row is the record of what the block said.

### Kindergarten is not a block, and the SF10 begins at Grade 1

The SF10-ES has no scholastic block for Kinder. Kinder is the **credential that
makes a learner eligible for Grade 1**, and that is what `learner_eligibility`
holds: the Kinder progress report, the ECCD checklist, the Kindergarten
certificate, a PEPT rating or another credential, with the school that issued
it. It carries no grade.

So `grade_level` is checked `between 1 and 6` and a Kinder block is refused with
the reason, at the contract (`PRIOR_GRADE_RANGE`) and again in the database
(`P2504`) for a caller that never met the contract. The Kindergarten grading
gate is unchanged, and this is how a Kindergarten record still reaches the SF10
(decided 2026-11-03).

The other half of the same rule, and a fault it uncovered: **the SF10 begins
when a learner enters Grade 1.** `sf10Get` used to answer `200` with a blank
SF10-ES for a learner whose only year was Kindergarten. Issuing was already
refused, so no blank record could get a serial — but reading one printed an
empty permanent record for a Kinder learner, which is the one thing their
records must not be replaced by. Theirs are the SF5-K and the ECCD checklist,
which EDUNEXUS does not hold and does not supersede.

`sf10()` now refuses a learner with no Grade 1-to-6 year at all — none recorded
and none transcribed — with `SF10_NOT_YET` (409) and a message that names what
their records *are*, so the refusal cannot read as a record EDUNEXUS lost. It
is thrown in the service rather than the database, because it is a property of
the laid-out form rather than of a row. Two consequences in the workspace:

- The Learner registry shows **SF10 begins at Grade 1** in place of the SF10
  button for a learner whose active-year placement is Kindergarten.
- Academic history says the same for such a learner and disables **Add a school
  year**: they have no previous grade to copy.

**What is deliberately *not* blocked** is recording the credential itself. The
credential is a field on the form, not the form, and it is often recorded as
part of enrolling a learner into Grade 1 — which may happen in either order. A
rule keyed on "has a Grade 1-to-6 year" would refuse exactly that moment, so
the screen explains instead and the form is what refuses to exist.

### Nothing computes a grade

The General Average is the one the source document already carries, which is
exactly the status of `report_summaries` and the ECR (decided 2026-10-08). A
grade reuses `edunexus.report_grade_value`, so "0 to 100, at most two decimal
places, refused rather than rounded" is one rule in one place for both grade
entry and transcription. A quarter the document does not carry stays null: an
empty box is never a zero, here as everywhere else.

## Refusals

| Code | Error | Why |
|---|---|---|
| `P2500` | `PRIOR_RECORD_FORBIDDEN` | Not a learner this caller may encode for |
| `P2501` | `PRIOR_LEARNER_LINKED` | The profile was linked into another; encode on the record that is kept |
| `P2502` | `PRIOR_YEAR_IN_SYSTEM` | EDUNEXUS already holds that year, so it is already a block; its grades are entered on Promotion |
| `P2503` | `PRIOR_YEAR_RANGE` | A school year from 1990 up to this one; a year still to come has no record to copy |
| `P2504` | `PRIOR_GRADE_RANGE` | Grade 1 to 6; Kinder is the eligibility credential |
| `P2505` | `PRIOR_SUBJECT_DUPLICATE` | The same learning area twice in one year |
| `P2506` | `PRIOR_NO_CHANGES` | Nothing changed |
| `P2507` | `PRIOR_SUBJECTS_REQUIRED` | A year with no learning area at all is not encoded; leave it out and the SF10 prints it blank |
| `P2508` | `PRIOR_CREDENTIAL_FIELDS` | A rating belongs to a PEPT, words in the box to an "other" credential |

One more, from the forms module rather than this one, because it is a property
of the laid-out SF10 rather than of a row:

| Error | Why |
|---|---|
| `SF10_NOT_YET` (409) | No Grade 1-to-6 year at all. For a Kindergarten learner the message names the SF5-K and the ECCD checklist as their records; otherwise it says to enrol them or encode the years the school holds a document for |

`P0002` and `P0003` are shared as everywhere: not found, and a version
mismatch. Every mutation takes the caller's last-read `version` and writes its
journal row in the same transaction; if the journal cannot be written the whole
change rolls back, and `tests/prior-records.test.ts` proves it.

**Next free range is now `P26xx`.**

## Who encodes

Managers, for every learner. An adviser, for a learner currently in a section
they advise in an open school year.

That second half **reverses the settled rule** that only managers change learner
records (decided 2026-11-03; the reversal and its reason belong in the
settled-decisions table in `docs/constraints.md`, which is missing from this
branch — see [status](status.md)). The reason is where the documents are: the
historical grades are in the advisers' own spreadsheets and class records, and
routing 897 learners' history through two office accounts would either take a
year or be done by advisers signing in as somebody else.

The scope is the existing policy, not a second one beside it:
`may_write_prior_records(learner)` is `actor_role() is not null and
can_read_learner(learner)`, and for a teacher `can_read_learner` already means
"holds a valid, enrolled, open-year enrollment in a section I advise". Nothing
else about what a teacher may change is widened, and every write is journalled
with a reason under their own name.

Two things that follow from that scope, both confirmed and both tested:

- **An adviser may encode any previous grade level**, not only the grade they
  teach. Nothing ties a transcribed year's grade to the adviser's own: a Grade
  3 adviser encodes their learners' Grades 1 and 2, which is the whole point of
  the arrangement, since those are the documents they hold.
- **It is every section they advise**, not one. Three Kinder advisers hold two
  sections each ([school forms](school-forms.md)), and `can_read_learner` is
  satisfied by any of them, so placement must not assume one section per
  adviser. (A Kinder adviser's learners have nothing to encode yet, by the rule
  above.)

## The merge

`computeSf10` builds one series from two sources and sorts it by school year:

- `origin: 'register'` — a year EDUNEXUS recorded itself, from an enrollment and
  the grades entered from the ECR.
- `origin: 'encoded'` — a year transcribed from the school's own documents.

They print identically, because the SF10 is one continuous record and a
learner's Grade 2 does not become a different kind of fact for having been typed
from a spreadsheet. `origin` exists so a screen can say which is which, and so
that nothing derived from a transcription is mistaken for a decision EDUNEXUS
made:

- An encoded block's `outcome` is always `{action: null, eligible_grade: null}`.
  A transcription carries no promotion decision, because nobody approved one;
  the document's own remark already sits on the General Average line.
- `eligible_grade` on the certification still comes only from the latest
  **recorded** year's approved outcome. A transcription can never manufacture a
  promotion.

An encoded block's district, division and region are filled only when its school
ID matches this school's. For another school EDUNEXUS does not know them, and
the form is left blank rather than filled in with Balili's.

A transcribed block's four quarters are numbered `'1'` to `'4'`, as the SF10-ES
numbers its Quarterly Rating columns. The SF10's block shapes are therefore its
own, not the SF9's: no enrollment, no offering and no reporting period of this
school's, so each of those is nullable, and `key` is what the page draws a row
by.

## Verified: the outward join adds no duplicate block

The join was made outward to stop an unplaced enrollment disappearing. The fair
question is whether letting a row through can also let a *duplicate* through.
It cannot, for a reason that holds generally rather than per case: the join is
`left join sections s on s.id = e.section_id`, and `sections.id` is the primary
key, so it matches **at most one** row. An inner join on a primary key can only
ever drop rows; making it outward can only ever keep one. Neither can multiply.

So what decides how many blocks a learner gets is the enrollment rows, and
those are guarded upstream of the form:

| Guard | Where |
|---|---|
| One valid enrollment per learner per year | `enrollments_valid_learner_year_idx`, unique on `(learner_id, academic_year_id) where record_state='valid'` (0008) |
| A second enrollment row in a year that already has a valid one | refused outright by the enrollment guard (0008), whatever state the new row is in |
| A second valid enrollment across two profiles later linked as one child | the identity guard, `'Identity already has a valid enrollment in this year'` (0008), plus `P0200` in the reconciliation preview |
| Linking one profile into another at all | refused without a matching reviewed identity command in the same transaction, so the state cannot be fabricated |

Four cases in `tests/prior-records.test.ts` prove it rather than assert it:
the join's own arity (`count(*)` with and without it, equal); a learner with
three valid enrollments — placed, **unplaced**, placed — getting exactly three
blocks with no year repeated and the count equal to the valid enrollments; a
second enrollment in a year already held being refused; and an unreviewed
profile link being refused.

Two guards turned out to be stronger than expected while writing those: an
enrollment row cannot be *created* voided ("create a valid record first"), and
voiding one needs a reviewed command in the same transaction. A voided row
beside a valid one is therefore not in the fixture — reaching it is the
enrollment-review workflow's own subject, and `read_sf10_source`'s
`record_state='valid'` filter predates this change and is untouched by it.

## Verified: what the privacy log actually records

Not "an SF10 was viewed". `record_access_events` has `actor_user_id uuid not
null references edunexus.staff(user_id)` and `record_ids uuid[] not null`, and
`record_access` fills the actor from `edunexus.actor_id()` and the request from
`edunexus.request_id`. So every row carries **which member of staff** and
**which records**, by id, with the request that did it.

What this change added is the learner's own id alongside the enrollments, for
the case that has no enrollment to name. Four cases cover it:

- An SF10 read names the learner's permanent id, the enrollments shown with
  them, the reading staff member's id, and a request id.
- Two members of staff reading the same record are told apart — the row carries
  whoever read it, not a generic marker.
- **A record made only of transcribed years** (no enrollment anywhere) logs
  `record_ids = [learner_id]` exactly, so the one case where the old behaviour
  would have logged nothing at all now names the learner.
- An encoding *write* names the learner and the writer too, not only reads.

## Verified: the workflow end to end

`tests/prior-records-workflow.test.ts` is one continuous journey for one learner
through the real API, in the order the school actually does it. The cases run in
sequence and depend on each other, because what is being verified is a process
rather than a rule:

| Step | What happens |
|---|---|
| 1 | The office registers Hannah and enrols her at Grade 4 **with no section** |
| 2 | The office encodes her Grade 1 and her Kindergarten credential |
| 3 | Her SF10 is already whole, with no section recorded anywhere on it |
| 4 | Her adviser-to-be cannot reach her at all — she is in nobody's class |
| 5 | The office assigns her to Grade 4 Masigla, by a dated movement |
| 6 | Nothing historical is lost, and the current year gains its class name |
| 7 | Her adviser encodes Grades 2 and 3 from the class records they hold |
| 8 | The SF10 reads as one record: three encoded years then the current one |
| 9 | Three members of staff read it and leave three distinguishable entries |

Step 4 is **confirmed as intended** (4 November): an adviser reaches a learner
only once that learner has been pulled into the class they advise. It is worth
writing down because it is an interaction rather than a rule either half states
— an unplaced learner is invisible to *every* teacher, since
`can_read_enrollment` joins `sections` — so an adviser cannot encode for a
learner until the office has placed them, and step 7 only works because step 5
happened. That is the order of work, not a gap: it is also why an adviser's list
is empty before placement.

Step 9 also reads the log back through `GET /record-access-events`, the way a
manager actually reads it, and confirms a teacher is refused it outright.

### The bug this journey found

Step 9 failed at first, reporting a stale row as the newest access entry. The
cause was not in the access log but in one line of SQL shape that this codebase
uses in six places:

```sql
select id::text, … from … order by id desc      -- sorts as TEXT
select id::text, … from … order by t.id desc    -- sorts as the bigint
```

`id::text` gives the output column the name `id`, and a bare `id` in `ORDER BY`
binds to the **output** column before the input one. The identity column is then
sorted as text, so `"9"` outranks `"10"` and a newest-first page silently loses
the newest rows — and the `next_before_id` cursor taken from that page skips
whatever it missed. Measured directly: twelve rows, `order by id desc limit 5`
returns **9, 8, 7, 6, 5**.

Three of the journals already qualified it — `audit_events`,
`record_access_events` and `assessment_score_events` all write
`order by edunexus.<table>.id desc`, so the trap had been hit before. Two did
not:

- `priorRecordHistory` in this module — **introduced by this increment**.
- `reportRecordHistory` in `src/modules/report-records/service.ts` —
  **pre-existing**, the same fault in the report-card journal. Fixed here
  because this work proved it: an audit journal that drops its newest page is
  not something to leave in place once demonstrated. One token, no migration,
  no behaviour change beyond correct ordering.

`tests/prior-records.test.ts` now has a case for it that needs twelve journal
entries to show anything at all, which is why none of the earlier cases caught
it. It was confirmed to fail against the unqualified query and pass against the
qualified one, rather than merely being added.

This is the same family as the rule already in `AGENTS.md` — *"use an identity
column, not a random uuid, for any journal paged newest-first"* — one step
further in: having used an identity column, do not then sort it as text.

## The SF4's own version of the same fault

0048 made `enrollments.section_id` nullable, and three forms read enrollments.
The SF10's was the outward join above. The SF4 had the same fault in a different
shape, found while clearing the faults on 4 November and fixed in migration
**0052**.

Every figure on the SF4 is counted by section, and its grade and school rollups
are sums of the section rows. A learner registered at a grade with no class yet
has no section to be grouped under, so they appeared in **no section row, no
grade total and no school total** — the form's "Registered learners as of end of
the month", the figure the division reads, came out short by however many
learners were waiting for a class, with nothing on the form to say so.

Two fixes that were not taken:

- **Adding them to the grade and school rollups** while leaving the section rows
  alone. A grade subtotal would then not equal the section rows printed above
  it, which on a signed form reads as an arithmetic mistake.
- **Inventing a row for them.** The SF4 has one row per section and a Non-Graded
  rollup, and nothing meaning "registered, no class yet". Adding one would be
  inventing a line on a DepEd form.

So it is reported and the form is refused, which is what this codebase already
does with every figure it cannot know: `unplaced` carries the count by grade and
sex, the SF4 screen says which grades are affected and links to Enrollment, and
`sf4Issue` refuses with `FORM_UNPLACED_LEARNERS` until every registered learner
is in a class. That is the step that should have happened anyway, and it is the
school's to take rather than ours to estimate around.

It is counted on the same date the form counts `registered` on — the last day of
the reporting month — so a learner placed before month end is not unplaced.
The refusal also comes **before** the not-submitted gate, because placing a
learner changes that section's register for the month, which a submitted month
would then have to be returned and re-submitted for.

The SF2 needed no change: it is one section's form, and a learner in no section
is not that section's to list.

## A latent bug fixed on the way

`read_sf10_source` inner-joined `sections`. Since `0048` made
`enrollments.section_id` nullable, a learner enrolled at a grade but **not yet
placed in a class silently disappeared from their own permanent record** —
every block of it, not just the section name. The join is outward now, and
`section_name` is nullable through `Sf10Source` and the workspace type.

The SF10's access log also changed. It logged the enrollments it showed; a
record made only of transcribed years has none, so it would have logged nothing
at all. It now names the learner as well, which the form carries regardless.

## Verified

Every scenario the brief asked to be covered has a case of its own: a manager
encoding for a learner outside any adviser's class; an adviser encoding for
their own; an adviser encoding **several previous grade levels** for one
learner; an adviser refused another adviser's learner; a Grade 1 learner with
the credential *and* a Grade 1 block; a current Kindergarten learner with no
SF10 and their own records named; a Grade 3 learner with credential, Grades 1–2
transcribed and Grade 3 recorded; a Grade 6 learner with Grades 1–5 transcribed;
and next year's block joining the same record with no year duplicated.

- `tests/prior-records.test.ts` — 36 cases over the real SQL through the real
  API (`tests/helpers/http.ts`, new: the operation table, the Zod contract, the
  role gate and row security, with only the token stubbed). The happy path,
  every refusal above, manager/teacher isolation in HTTP *and* under the row
  policy, a version conflict, a journal-failure rollback, and the merge itself:
  a Grade 3 learner with Kinder as a credential and Grades 1–2 transcribed
  prints `[[2023,1,'encoded'],[2024,2,'encoded'],[2026,3,'register']]`, each
  year once.
- `tests/prior-records-workflow.test.ts` — the nine-step journey above, through the real API.
- `tests/forms-unplaced.test.ts` — the SF4 fault above: the count by grade and
  sex, the rollups still equalling their rows, the refusal naming the grades, a
  learner placed mid-month counting as placed, and the block lifting once
  everyone is in a class.
- `tests/web-prior-records.test.ts` — 9 cases: the screen in happy-dom, and the SF10
  rendered to markup: both kinds of block in the official layout, a previous
  school's blanks left blank, the credential's box ticked, the form's own ruled
  lines kept when nothing is encoded, and nine years still paired front and
  back over four sheets.
- **Real Chrome over the DevTools Protocol**, print media emulated, against the
  source stylesheet. The case this increment actually produces is a learner the
  school started using EDUNEXUS part-way through: Kinder as the credential,
  Grades 1–3 transcribed, Grades 4–6 recorded, with the eligibility block filled
  rather than ruled — the only thing on the sheet that could have got taller.

  | | `sf10_full` (before: six recorded years) | `sf10_mixed` (three transcribed, three recorded, credential filled) |
  |---|---|---|
  | Page box | 8.5 × 13in long bond, exact | 8.5 × 13in long bond, exact |
  | Shrink at 100% | none | none |
  | Sheets | 2 | 2 |
  | Fill | 1120px of 1188px (94%) | 1120px of 1188px (94%) |
  | Sideways | 756px of 756px, nothing overflowing | 756px of 756px, nothing overflowing |

  Nine and twelve transcribed years still come to four sheets — rounded to whole
  leaves, so duplex always pairs — with no year lost off the end.

  One note for whoever runs that harness next: `.local/sf9-print/harness.tsx`
  reports `OVERFLOWS by 15px`, `cell NaNpt` and `right-most table 0px` for
  *every* SF10 fixture, the empty one included. Those three lines are
  meaningless here — the probe looks for `.card-table` and `.card-cell`, which
  are SF9 class names the SF10 does not use, and it runs without
  `--hide-scrollbars`, so the 15px is the scrollbar. Measured with the SF10's own
  selectors (`.local/sf9-print/sf10-width.tsx`), nothing overflows at all.

## What is not built

- **No import.** Each year is typed, one learner at a time, which the school can
  do at any point after go-live and need not do before it. A bulk importer was
  built on 4 November and **reverted the same day at the user's direction**: it is
  not a go-live requirement, and it may be reconsidered as an enhancement if the
  school asks for one. What that attempt established, should it come back, is
  written up in [the roadmap](roadmap.md#8b-bulk-import-of-the-historical-records--considered-and-declined-for-go-live).
- **No link to the subject catalog is required.** `learner_prior_grades.subject_id`
  exists and is nullable; the screen never sets it. A year taught under an
  earlier curriculum may name an area the catalog never carried, and creating a
  catalog row for it would put a subject nobody chose into the school's own
  list. The screen offers the areas this school's report cards print, from
  `web/learning-areas.ts`, as a starting list the person edits against the
  document — a proposal, never a seed.
- **No LRN is required** to encode. The history attaches to the learner's
  permanent record (`learners.id`) either way, and the screen says plainly that
  the SF10's LRN box prints empty until the number is filled on the registry.
  Requiring one would block honest work on a profile whose LRN is still pending.

